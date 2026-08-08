import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { portfolioConfig } from '../config/portfolio.config'
import { portfolioGraphSchema } from '../src/lib/graphSchema'
import type { GraphEdge, GraphNode, RepoAnalysis, RepoSummary } from '../src/lib/graphSchema'
import type { RawRepoData } from './fetch-repos'

const RAW_DIR = path.resolve(process.cwd(), '.cache/raw')
const ANALYZED_DIR = path.resolve(process.cwd(), '.cache/analyzed')
const SUMMARIES_DIR = path.resolve(process.cwd(), '.cache/summaries')
const OUTPUT_PATH = path.resolve(process.cwd(), 'public/data/graph.json')

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Java: '#b07219',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Shell: '#89e051',
}
const FALLBACK_COLOR = '#9ca3af'

interface RepoBundle {
  name: string
  raw: RawRepoData
  analysis: RepoAnalysis
  summary: RepoSummary
  summaryIsFallback: boolean
}

interface SummaryCacheEntry {
  inputHash: string
  summary: RepoSummary
}

// ---- Carga de datos por repo ----

function buildFallbackSummary(raw: RawRepoData, analysis: RepoAnalysis): RepoSummary {
  const factualHighlights: string[] = []
  if (analysis.hasCI) factualHighlights.push('Pipeline de CI configurado (.github/workflows)')
  if (analysis.hasDocker) factualHighlights.push('Incluye Dockerfile')
  if (analysis.hasTests) factualHighlights.push('Incluye archivos de test')
  if (analysis.buildTools.value.length > 0) {
    factualHighlights.push(`Build tools detectadas: ${analysis.buildTools.value.join(', ')}`)
  }
  while (factualHighlights.length < 2) factualHighlights.push('Sin evidencia adicional disponible (sin LLM)')

  const techNotes: string[] = [
    `Runtime: ${analysis.runtime.value ?? 'no identificado'}`,
    `${analysis.dependencies.length} dependencias declaradas en manifiestos`,
  ]

  return {
    pitch: raw.meta.description ?? `Proyecto de tipo ${analysis.projectType.value} en ${analysis.runtime.value ?? 'lenguaje no identificado'}.`,
    summary: `Resumen generado sin LLM (ANTHROPIC_API_KEY no configurada al momento del build). ${raw.meta.description ?? 'Sin descripción en GitHub.'} Estado: ${analysis.status}, ${raw.commitCount} commits.`,
    highlights: factualHighlights.slice(0, 4),
    techNotes: techNotes.slice(0, 4),
    domain: 'sin-clasificar',
    keywords: [...new Set([...raw.meta.topics, ...Object.keys(raw.languages)])].map((k) => k.toLowerCase()).slice(0, 8) || ['sin-keywords'],
    confidence: 'baja',
  }
}

async function loadBundles(): Promise<RepoBundle[]> {
  let analyzedFiles: string[]
  try {
    analyzedFiles = await readdir(ANALYZED_DIR)
  } catch {
    throw new Error(`No existe ${ANALYZED_DIR}. Corré primero: npm run pipeline:analyze`)
  }

  const bundles: RepoBundle[] = []
  for (const file of analyzedFiles.filter((f) => f.endsWith('.json'))) {
    const repoName = file.replace(/\.json$/, '')
    try {
      const raw = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf-8')) as RawRepoData
      const analysis = JSON.parse(await readFile(path.join(ANALYZED_DIR, file), 'utf-8')) as RepoAnalysis

      const summaryPath = path.join(SUMMARIES_DIR, file)
      let summary: RepoSummary
      let summaryIsFallback = false
      if (existsSync(summaryPath)) {
        const entry = JSON.parse(await readFile(summaryPath, 'utf-8')) as SummaryCacheEntry
        summary = entry.summary
      } else {
        console.warn(`[fallback] ${repoName}: sin resumen LLM cacheado, uso resumen factual sin LLM (confidence=baja)`)
        summary = buildFallbackSummary(raw, analysis)
        summaryIsFallback = true
      }

      bundles.push({ name: repoName, raw, analysis, summary, summaryIsFallback })
    } catch (err) {
      console.error(`[skip] ${repoName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return bundles
}

// ---- Nodo ----

function dominantLanguage(languages: Record<string, number>): string | null {
  const entries = Object.entries(languages)
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function nodeSize(commitCount: number): number {
  return Math.round(4 + Math.log2(commitCount + 1) * 3 * 10) / 10
}

function buildNode(bundle: RepoBundle, cluster: number): GraphNode {
  const lang = dominantLanguage(bundle.raw.languages)
  return {
    id: bundle.name,
    repo: {
      name: bundle.raw.meta.name,
      description: bundle.raw.meta.description,
      url: bundle.raw.meta.url,
      homepage: bundle.raw.meta.homepage,
      topics: bundle.raw.meta.topics,
      license: bundle.raw.meta.license,
      createdAt: bundle.raw.meta.createdAt,
      pushedAt: bundle.raw.meta.pushedAt,
      commitCount: bundle.raw.commitCount,
      stars: bundle.raw.meta.stars,
      forks: bundle.raw.meta.forks,
      languages: bundle.raw.languages,
      defaultBranch: bundle.raw.meta.defaultBranch,
      readme: bundle.raw.readme,
    },
    analysis: bundle.analysis,
    summary: bundle.summary,
    size: nodeSize(bundle.raw.commitCount),
    color: lang ? (LANGUAGE_COLORS[lang] ?? FALLBACK_COLOR) : FALLBACK_COLOR,
    dashedBorder: bundle.analysis.status !== 'activo',
    cluster,
  }
}

// ---- Aristas ----

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0
  let normA = 0
  let normB = 0
  for (const key of keys) {
    const va = a[key] ?? 0
    const vb = b[key] ?? 0
    dot += va * vb
    normA += va * va
    normB += vb * vb
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  const intersection = [...a].filter((x) => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

function dependencyNameSet(analysis: RepoAnalysis): Set<string> {
  const stopwords = new Set(portfolioConfig.stopwordDependencies.map((s) => s.toLowerCase()))
  return new Set(
    analysis.dependencies.map((d) => d.name.toLowerCase()).filter((name) => !stopwords.has(name)),
  )
}

function topicsKeywordsSet(bundle: RepoBundle): Set<string> {
  return new Set([...bundle.raw.meta.topics, ...bundle.summary.keywords].map((s) => s.toLowerCase()))
}

function readmeMentionsRepo(readme: string | null, targetName: string, targetUrl: string): boolean {
  if (!readme) return false
  const lower = readme.toLowerCase()
  return lower.includes(targetUrl.toLowerCase()) || new RegExp(`\\b${targetName.toLowerCase()}\\b`).test(lower)
}

function computeEdge(a: RepoBundle, b: RepoBundle): GraphEdge {
  const weights = portfolioConfig.edgeWeights
  const reasons: GraphEdge['reasons'] = []

  const langSim = cosineSimilarity(a.raw.languages, b.raw.languages)
  if (langSim > 0) {
    reasons.push({ kind: 'lenguaje', weight: langSim * weights.lenguaje, detail: `similitud de lenguajes: ${(langSim * 100).toFixed(0)}%` })
  }

  const depJaccard = jaccard(dependencyNameSet(a.analysis), dependencyNameSet(b.analysis))
  if (depJaccard > 0) {
    reasons.push({ kind: 'dependencias', weight: depJaccard * weights.dependencias, detail: `dependencias compartidas: ${(depJaccard * 100).toFixed(0)}%` })
  }

  const topicsJaccard = jaccard(topicsKeywordsSet(a), topicsKeywordsSet(b))
  if (topicsJaccard > 0) {
    reasons.push({ kind: 'topics', weight: topicsJaccard * weights.topics, detail: `topics/keywords compartidos: ${(topicsJaccard * 100).toFixed(0)}%` })
  }

  const sameDomain = a.summary.domain === b.summary.domain && a.summary.domain !== 'sin-clasificar'
  if (sameDomain) {
    reasons.push({ kind: 'dominio', weight: weights.dominio, detail: `mismo dominio: ${a.summary.domain}` })
  }

  const crossMention =
    readmeMentionsRepo(a.raw.readme, b.name, b.raw.meta.url) || readmeMentionsRepo(b.raw.readme, a.name, a.raw.meta.url)
  if (crossMention) {
    reasons.push({ kind: 'mencion-cruzada', weight: weights.mencionCruzada, detail: 'un README menciona o enlaza al otro repo' })
  }

  const weight = reasons.reduce((sum, r) => sum + r.weight, 0)
  return { source: a.name, target: b.name, weight: Math.round(weight * 1000) / 1000, reasons }
}

function buildEdges(bundles: RepoBundle[]): GraphEdge[] {
  const allPairs: GraphEdge[] = []
  for (let i = 0; i < bundles.length; i++) {
    for (let j = i + 1; j < bundles.length; j++) {
      const a = bundles[i]
      const b = bundles[j]
      if (!a || !b) continue
      allPairs.push(computeEdge(a, b))
    }
  }

  const hasCrossMention = (e: GraphEdge) => e.reasons.some((r) => r.kind === 'mencion-cruzada')
  const kept = allPairs.filter((e) => e.weight >= portfolioConfig.edgeThreshold || hasCrossMention(e))

  const connected = new Set<string>()
  for (const e of kept) {
    connected.add(e.source)
    connected.add(e.target)
  }

  for (const bundle of bundles) {
    if (connected.has(bundle.name)) continue
    const strongest = allPairs
      .filter((e) => e.source === bundle.name || e.target === bundle.name)
      .sort((a, b) => b.weight - a.weight)[0]
    if (strongest) {
      kept.push(strongest)
      connected.add(strongest.source)
      connected.add(strongest.target)
    }
  }

  return kept
}

// ---- Comunidades (label propagation) ----

function detectCommunities(nodeIds: string[], edges: GraphEdge[]): Map<string, number> {
  const neighbors = new Map<string, { id: string; weight: number }[]>()
  for (const id of nodeIds) neighbors.set(id, [])
  for (const e of edges) {
    neighbors.get(e.source)?.push({ id: e.target, weight: e.weight })
    neighbors.get(e.target)?.push({ id: e.source, weight: e.weight })
  }

  const labels = new Map<string, string>()
  for (const id of nodeIds) labels.set(id, id)

  const maxIterations = 20
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false
    const shuffled = [...nodeIds].sort(() => Math.random() - 0.5)
    for (const id of shuffled) {
      const neigh = neighbors.get(id) ?? []
      if (neigh.length === 0) continue
      const scoreByLabel = new Map<string, number>()
      for (const n of neigh) {
        const label = labels.get(n.id)
        if (!label) continue
        scoreByLabel.set(label, (scoreByLabel.get(label) ?? 0) + n.weight)
      }
      let bestLabel = labels.get(id) ?? id
      let bestScore = -1
      for (const [label, score] of scoreByLabel) {
        if (score > bestScore) {
          bestScore = score
          bestLabel = label
        }
      }
      if (bestLabel !== labels.get(id)) {
        labels.set(id, bestLabel)
        changed = true
      }
    }
    if (!changed) break
  }

  const uniqueLabels = [...new Set(labels.values())].sort()
  const clusterIndex = new Map(uniqueLabels.map((label, idx) => [label, idx]))
  const result = new Map<string, number>()
  for (const id of nodeIds) {
    const label = labels.get(id) ?? id
    result.set(id, clusterIndex.get(label) ?? 0)
  }
  return result
}

// ---- Orquestación ----

export async function main(): Promise<void> {
  const bundles = await loadBundles()
  if (bundles.length === 0) {
    console.warn('No hay repos analizados. Nada que generar.')
    return
  }

  const edges = buildEdges(bundles)
  const clusters = detectCommunities(bundles.map((b) => b.name), edges)

  const nodes = bundles.map((bundle) => buildNode(bundle, clusters.get(bundle.name) ?? 0))

  const graph = {
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
  }

  const validated = portfolioGraphSchema.parse(graph)

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(validated, null, 2), 'utf-8')

  const orphans = nodes.filter((n) => !edges.some((e) => e.source === n.id || e.target === n.id))
  console.log(`[ok] graph.json generado: ${nodes.length} nodos, ${edges.length} aristas, ${orphans.length} huérfanos`)
  if (bundles.some((b) => b.summaryIsFallback)) {
    console.warn('[aviso] algunos nodos usan resumen factual sin LLM (correr pipeline:summarize con ANTHROPIC_API_KEY para reemplazarlos)')
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
