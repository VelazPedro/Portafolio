import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DependencyRef, EvidencedField, ProjectStatus, ProjectType, RepoAnalysis } from '../src/lib/types'
import type { RawRepoData } from './fetch-repos'

const RAW_DIR = path.resolve(process.cwd(), '.cache/raw')
const ANALYZED_DIR = path.resolve(process.cwd(), '.cache/analyzed')
const PAUSADO_THRESHOLD_DAYS = 90
const ARCHIVADO_THRESHOLD_DAYS = 548

// ---- Parsers de manifiestos ----

function splitPySpec(spec: string): { name: string; version: string } {
  const match = /^([A-Za-z0-9_.-]+)\s*(\[[^\]]*\])?\s*(.*)$/.exec(spec.trim())
  const name = match?.[1] ?? spec.trim()
  const version = (match?.[3] ?? '').trim()
  return { name, version }
}

export function parsePackageJson(content: string): DependencyRef[] {
  const json = JSON.parse(content) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps: DependencyRef[] = []
  for (const [name, version] of Object.entries(json.dependencies ?? {})) {
    deps.push({ name, version, type: 'prod' })
  }
  for (const [name, version] of Object.entries(json.devDependencies ?? {})) {
    deps.push({ name, version, type: 'dev' })
  }
  return deps
}

export function parseRequirementsTxt(content: string): DependencyRef[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
    .map((line) => {
      const { name, version } = splitPySpec(line.split(';')[0] ?? line)
      return { name, version, type: 'prod' as const }
    })
}

function extractTomlSection(content: string, sectionName: string): string | null {
  const lines = content.split(/\r?\n/)
  let capturing = false
  const captured: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line)
    if (sectionMatch) {
      capturing = sectionMatch[1] === sectionName
      continue
    }
    if (capturing) captured.push(rawLine)
  }
  return captured.length > 0 ? captured.join('\n') : null
}

function parseTomlKeyValueSection(section: string, type: 'prod' | 'dev'): DependencyRef[] {
  const deps: DependencyRef[] = []
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!match?.[1]) continue
    const name = match[1]
    if (name === 'python') continue
    const rawValue = match[2] ?? ''
    const versionMatch = /"([^"]*)"/.exec(rawValue)
    deps.push({ name, version: versionMatch?.[1] ?? rawValue.trim(), type })
  }
  return deps
}

export function parsePyprojectToml(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []

  const poetryProd = extractTomlSection(content, 'tool.poetry.dependencies')
  if (poetryProd) deps.push(...parseTomlKeyValueSection(poetryProd, 'prod'))
  const poetryDev =
    extractTomlSection(content, 'tool.poetry.group.dev.dependencies') ??
    extractTomlSection(content, 'tool.poetry.dev-dependencies')
  if (poetryDev) deps.push(...parseTomlKeyValueSection(poetryDev, 'dev'))

  const arrayMatch = /(?<!optional-)dependencies\s*=\s*\[([\s\S]*?)\]/.exec(content)
  if (arrayMatch?.[1]) {
    const specs = [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')
    for (const spec of specs) {
      const { name, version } = splitPySpec(spec)
      deps.push({ name, version, type: 'prod' })
    }
  }

  return deps
}

export function parsePomXml(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []
  const blocks = content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)
  for (const block of blocks) {
    const body = block[1] ?? ''
    const groupId = /<groupId>([^<]+)<\/groupId>/.exec(body)?.[1] ?? ''
    const artifactId = /<artifactId>([^<]+)<\/artifactId>/.exec(body)?.[1] ?? ''
    const version = /<version>([^<]+)<\/version>/.exec(body)?.[1] ?? ''
    const scope = /<scope>([^<]+)<\/scope>/.exec(body)?.[1] ?? ''
    if (!artifactId) continue
    deps.push({
      name: groupId ? `${groupId}:${artifactId}` : artifactId,
      version,
      type: scope === 'test' ? 'dev' : 'prod',
    })
  }
  return deps
}

export function parseCargoToml(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []
  const prod = extractTomlSection(content, 'dependencies')
  if (prod) deps.push(...parseTomlKeyValueSection(prod, 'prod'))
  const dev = extractTomlSection(content, 'dev-dependencies')
  if (dev) deps.push(...parseTomlKeyValueSection(dev, 'dev'))
  return deps
}

export function parseGoMod(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []
  const blockMatch = /require\s*\(([\s\S]*?)\)/.exec(content)
  const lines = blockMatch?.[1] ? blockMatch[1].split(/\r?\n/) : []
  const singleLineMatches = [...content.matchAll(/^require\s+(\S+)\s+(\S+)/gm)]
  for (const m of singleLineMatches) {
    if (m[1] && m[2]) deps.push({ name: m[1], version: m[2], type: 'prod' })
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^(\S+)\s+(\S+)/.exec(line)
    if (!match?.[1] || !match[2]) continue
    const isIndirect = /\/\/\s*indirect/.test(line)
    deps.push({ name: match[1], version: match[2], type: isIndirect ? 'dev' : 'prod' })
  }
  return deps
}

export function parseComposerJson(content: string): DependencyRef[] {
  const json = JSON.parse(content) as {
    require?: Record<string, string>
    'require-dev'?: Record<string, string>
  }
  const deps: DependencyRef[] = []
  for (const [name, version] of Object.entries(json.require ?? {})) {
    if (name === 'php') continue
    deps.push({ name, version, type: 'prod' })
  }
  for (const [name, version] of Object.entries(json['require-dev'] ?? {})) {
    deps.push({ name, version, type: 'dev' })
  }
  return deps
}

export function parseGemfile(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []
  let groupDepth = 0
  let inDevGroup = false
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const groupStart = /^group\s+(.+?)\s+do/.exec(line)
    if (groupStart) {
      groupDepth += 1
      if (/:development|:test/.test(groupStart[1] ?? '')) inDevGroup = true
      continue
    }
    if (line === 'end' && groupDepth > 0) {
      groupDepth -= 1
      if (groupDepth === 0) inDevGroup = false
      continue
    }
    const gemMatch = /^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(line)
    if (gemMatch?.[1]) {
      deps.push({ name: gemMatch[1], version: gemMatch[2] ?? '', type: inDevGroup ? 'dev' : 'prod' })
    }
  }
  return deps
}

export function parseCsproj(content: string): DependencyRef[] {
  const deps: DependencyRef[] = []
  const matches = content.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)
  for (const m of matches) {
    if (m[1] && m[2]) deps.push({ name: m[1], version: m[2], type: 'prod' })
  }
  return deps
}

export function parseManifest(filePath: string, content: string): DependencyRef[] {
  const base = filePath.split('/').pop() ?? ''
  try {
    if (base === 'package.json') return parsePackageJson(content)
    if (base === 'requirements.txt') return parseRequirementsTxt(content)
    if (base === 'pyproject.toml') return parsePyprojectToml(content)
    if (base === 'pom.xml') return parsePomXml(content)
    if (base === 'Cargo.toml') return parseCargoToml(content)
    if (base === 'go.mod') return parseGoMod(content)
    if (base === 'composer.json') return parseComposerJson(content)
    if (base === 'Gemfile') return parseGemfile(content)
    if (base.endsWith('.csproj')) return parseCsproj(content)
  } catch (err) {
    console.warn(`[skip] no se pudo parsear ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
  return []
}

// ---- Inferencia de stack ----

const FRAMEWORK_HINTS: Record<string, string> = {
  react: 'React',
  vue: 'Vue',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  next: 'Next.js',
  nuxt: 'Nuxt',
  express: 'Express',
  fastify: 'Fastify',
  flask: 'Flask',
  django: 'Django',
  fastapi: 'FastAPI',
  'spring-boot-starter': 'Spring Boot',
  rails: 'Ruby on Rails',
  laravel: 'laravel/framework',
}

const DATABASE_HINTS: Record<string, string> = {
  pg: 'PostgreSQL',
  psycopg2: 'PostgreSQL',
  'psycopg2-binary': 'PostgreSQL',
  mysql2: 'MySQL',
  'mysql-connector-python': 'MySQL',
  mongoose: 'MongoDB',
  pymongo: 'MongoDB',
  'better-sqlite3': 'SQLite',
  sqlite3: 'SQLite',
  redis: 'Redis',
  ioredis: 'Redis',
}

const TEST_TOOL_HINTS: Record<string, string> = {
  vitest: 'Vitest',
  jest: 'Jest',
  mocha: 'Mocha',
  pytest: 'pytest',
  'junit-jupiter': 'JUnit',
  rspec: 'RSpec',
}

const RUNTIME_BY_MANIFEST: Record<string, string> = {
  'package.json': 'Node',
  'requirements.txt': 'Python',
  'pyproject.toml': 'Python',
  'pom.xml': 'JVM (Java)',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
  'composer.json': 'PHP',
  Gemfile: 'Ruby',
}

function findHint(deps: DependencyRef[], hints: Record<string, string>): { value: string; evidence: string } | null {
  for (const dep of deps) {
    for (const [key, label] of Object.entries(hints)) {
      if (dep.name === key || dep.name.startsWith(`${key}/`) || dep.name.startsWith(key)) {
        return { value: label, evidence: `dependency: ${dep.name}` }
      }
    }
  }
  return null
}

function inferRuntime(raw: RawRepoData): EvidencedField<string | null> {
  for (const manifest of raw.manifests) {
    const base = manifest.path.split('/').pop() ?? ''
    const runtime = RUNTIME_BY_MANIFEST[base]
    if (runtime) return { value: runtime, evidence: `manifiesto: ${manifest.path}` }
  }
  if (raw.manifests.some((m) => m.path.endsWith('.csproj'))) {
    return { value: '.NET', evidence: `manifiesto: ${raw.manifests.find((m) => m.path.endsWith('.csproj'))?.path}` }
  }
  const dominantLang = Object.entries(raw.languages).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return dominantLang
    ? { value: dominantLang, evidence: 'lenguaje dominante por bytes (endpoint /languages)' }
    : { value: null, evidence: 'sin manifiestos ni lenguajes detectados' }
}

function inferBuildTools(filePaths: string[]): EvidencedField<string[]> {
  const tools: string[] = []
  if (filePaths.some((p) => /^vite\.config\.[jt]s$/.test(p))) tools.push('Vite')
  if (filePaths.some((p) => /^webpack\.config\.js$/.test(p))) tools.push('Webpack')
  if (filePaths.some((p) => p === 'next.config.js' || p === 'next.config.ts')) tools.push('Next.js')
  if (filePaths.some((p) => p === 'Makefile')) tools.push('Make')
  if (filePaths.some((p) => p === 'Dockerfile')) tools.push('Docker')
  return {
    value: tools,
    evidence: tools.length > 0 ? `archivos de configuración: ${tools.join(', ')}` : 'sin herramientas de build detectadas',
  }
}

function inferTestTools(deps: DependencyRef[]): EvidencedField<string[]> {
  const found = new Set<string>()
  for (const dep of deps) {
    for (const [key, label] of Object.entries(TEST_TOOL_HINTS)) {
      if (dep.name === key || dep.name.startsWith(key)) found.add(label)
    }
  }
  const tools = [...found]
  return {
    value: tools,
    evidence: tools.length > 0 ? `dependencias: ${tools.join(', ')}` : 'sin herramientas de test detectadas',
  }
}

function inferProjectType(raw: RawRepoData, deps: DependencyRef[]): EvidencedField<ProjectType> {
  const paths = raw.filePaths

  if (paths.some((p) => p.endsWith('.ipynb'))) {
    return { value: 'notebook', evidence: 'archivo .ipynb presente' }
  }

  const desktopHint = findHint(deps, { electron: 'Electron', '@tauri-apps/api': 'Tauri' })
  if (desktopHint) return { value: 'herramienta-escritorio', evidence: desktopHint.evidence }

  const gameHint = findHint(deps, { phaser: 'Phaser', pygame: 'Pygame' })
  if (gameHint || paths.includes('project.godot')) {
    return { value: 'juego', evidence: gameHint?.evidence ?? 'archivo project.godot presente' }
  }

  const packageJsonManifest = raw.manifests.find((m) => m.path === 'package.json')
  if (packageJsonManifest) {
    try {
      const pkg = JSON.parse(packageJsonManifest.content) as { bin?: unknown; main?: unknown; exports?: unknown }
      if (pkg.bin) return { value: 'cli', evidence: 'package.json declara campo "bin"' }
    } catch {
      // manifiesto invalido, se ignora para esta heuristica
    }
  }
  const cliHint = findHint(deps, { click: 'click', typer: 'typer', commander: 'commander', yargs: 'yargs' })
  if (cliHint) return { value: 'cli', evidence: cliHint.evidence }

  const webHint = findHint(deps, FRAMEWORK_HINTS)
  const hasIndexHtml = paths.includes('index.html')
  const apiFrameworks = ['express', 'fastify', 'flask', 'django', 'fastapi', 'spring-boot-starter']
  const isApiFramework = webHint && apiFrameworks.some((k) => webHint.evidence.includes(k))

  if (isApiFramework) return { value: 'api', evidence: webHint!.evidence }
  if (webHint && (hasIndexHtml || ['React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt'].includes(webHint.value))) {
    return { value: 'web-app', evidence: webHint.evidence }
  }
  if (hasIndexHtml) return { value: 'web-app', evidence: 'index.html presente en el repo' }

  if (packageJsonManifest) {
    try {
      const pkg = JSON.parse(packageJsonManifest.content) as { main?: unknown; module?: unknown; exports?: unknown }
      if (pkg.main || pkg.module || pkg.exports) {
        return { value: 'libreria', evidence: 'package.json declara "main"/"module"/"exports"' }
      }
    } catch {
      // manifiesto invalido, se ignora para esta heuristica
    }
  }

  const dominantLang = Object.entries(raw.languages).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (dominantLang === 'Python' || dominantLang === 'JavaScript' || dominantLang === 'Shell') {
    return { value: 'script', evidence: `lenguaje dominante: ${dominantLang}, sin indicios de web/api/cli` }
  }

  return { value: 'otro', evidence: 'sin heurística concluyente' }
}

// ---- Forma del repo y actividad ----

function inferShape(filePaths: string[]) {
  const fileCount = filePaths.length
  const maxDepth = filePaths.reduce((max, p) => Math.max(max, p.split('/').length - 1), 0)
  const topLevelDirs = [
    ...new Set(filePaths.filter((p) => p.includes('/')).map((p) => p.split('/')[0] ?? '')),
  ]
  const hasTests = filePaths.some(
    (p) =>
      /(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(p) ||
      /\.(test|spec)\.[jt]sx?$/i.test(p) ||
      /(^|\/)test_.*\.py$/i.test(p),
  )
  const hasCI = filePaths.some((p) => p.startsWith('.github/workflows/'))
  const hasDocker = filePaths.some((p) => p === 'Dockerfile' || p.endsWith('/Dockerfile'))
  const hasDocs = filePaths.some((p) => p.startsWith('docs/') || p === 'CONTRIBUTING.md')
  return { fileCount, maxDepth, topLevelDirs, hasTests, hasCI, hasDocker, hasDocs }
}

function inferActivity(createdAt: string, pushedAt: string): {
  daysAlive: number
  daysSinceLastPush: number
  status: ProjectStatus
} {
  const now = Date.now()
  const dayMs = 86_400_000
  const daysAlive = Math.max(0, Math.round((now - new Date(createdAt).getTime()) / dayMs))
  const daysSinceLastPush = Math.max(0, Math.round((now - new Date(pushedAt).getTime()) / dayMs))
  let status: ProjectStatus = 'activo'
  if (daysSinceLastPush > ARCHIVADO_THRESHOLD_DAYS) status = 'archivado-de-facto'
  else if (daysSinceLastPush > PAUSADO_THRESHOLD_DAYS) status = 'pausado'
  return { daysAlive, daysSinceLastPush, status }
}

export function analyzeRepo(raw: RawRepoData): RepoAnalysis {
  const dependencies = raw.manifests.flatMap((m) => parseManifest(m.path, m.content))
  const projectType = inferProjectType(raw, dependencies)
  const primaryFramework = findHint(dependencies, FRAMEWORK_HINTS)
  const database = findHint(dependencies, DATABASE_HINTS)
  const runtime = inferRuntime(raw)
  const buildTools = inferBuildTools(raw.filePaths)
  const testTools = inferTestTools(dependencies)
  const shape = inferShape(raw.filePaths)
  const activity = inferActivity(raw.meta.createdAt, raw.meta.pushedAt)

  return {
    projectType,
    primaryFramework: primaryFramework
      ? { value: primaryFramework.value, evidence: primaryFramework.evidence }
      : { value: null, evidence: 'sin framework detectado en dependencias' },
    runtime,
    database: database
      ? { value: database.value, evidence: database.evidence }
      : { value: null, evidence: 'sin base de datos detectada en dependencias' },
    buildTools,
    testTools,
    dependencies,
    ...shape,
    ...activity,
  }
}

// ---- Orquestación ----

async function main(): Promise<void> {
  await mkdir(ANALYZED_DIR, { recursive: true })
  let files: string[]
  try {
    files = await readdir(RAW_DIR)
  } catch {
    console.error(`No existe ${RAW_DIR}. Corré primero: npm run pipeline:fetch`)
    process.exitCode = 1
    return
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  if (jsonFiles.length === 0) {
    console.warn('No hay repos crudos para analizar en .cache/raw/')
    return
  }

  for (const file of jsonFiles) {
    const repoName = file.replace(/\.json$/, '')
    try {
      const raw = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf-8')) as RawRepoData
      const analysis = analyzeRepo(raw)
      await writeFile(path.join(ANALYZED_DIR, file), JSON.stringify(analysis, null, 2), 'utf-8')
      console.log(`[ok] ${repoName}: tipo=${analysis.projectType.value} runtime=${analysis.runtime.value ?? 'null'} deps=${analysis.dependencies.length}`)
    } catch (err) {
      console.error(`[error] ${repoName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
