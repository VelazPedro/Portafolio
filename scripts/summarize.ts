import { config as loadEnv } from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { RepoAnalysis, RepoSummary } from '../src/lib/types'
import type { RawRepoData } from './fetch-repos'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

const RAW_DIR = path.resolve(process.cwd(), '.cache/raw')
const ANALYZED_DIR = path.resolve(process.cwd(), '.cache/analyzed')
const SUMMARIES_DIR = path.resolve(process.cwd(), '.cache/summaries')
const README_TRUNCATE_CHARS = 4000
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

const repoSummarySchema = z.object({
  pitch: z.string().min(1),
  summary: z.string().min(1),
  highlights: z.array(z.string()).min(2).max(4),
  techNotes: z.array(z.string()).min(2).max(4),
  domain: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(5).max(8),
  confidence: z.enum(['alta', 'media', 'baja']),
})

interface SummaryCacheEntry {
  inputHash: string
  summary: RepoSummary
}

function buildPrompt(raw: RawRepoData, analysis: RepoAnalysis): string {
  const readme = raw.readme ? raw.readme.slice(0, README_TRUNCATE_CHARS) : '(sin README)'
  const stackLines = [
    `tipo de proyecto: ${analysis.projectType.value}`,
    `framework principal: ${analysis.primaryFramework.value ?? 'ninguno detectado'}`,
    `runtime: ${analysis.runtime.value ?? 'desconocido'}`,
    `base de datos: ${analysis.database.value ?? 'ninguna detectada'}`,
    `build tools: ${analysis.buildTools.value.join(', ') || 'ninguno'}`,
    `test tools: ${analysis.testTools.value.join(', ') || 'ninguno'}`,
    `dependencias principales: ${analysis.dependencies.slice(0, 15).map((d) => d.name).join(', ') || 'ninguna'}`,
  ].join('\n')

  const metricsLines = [
    `commits: ${raw.commitCount}`,
    `dias de vida: ${analysis.daysAlive}`,
    `dias desde el ultimo push: ${analysis.daysSinceLastPush}`,
    `estado: ${analysis.status}`,
    `tests: ${analysis.hasTests ? 'si' : 'no'}, CI: ${analysis.hasCI ? 'si' : 'no'}, Docker: ${analysis.hasDocker ? 'si' : 'no'}`,
  ].join('\n')

  return `Analizá este repositorio de software y devolvé UN ÚNICO objeto JSON, sin markdown ni texto antes o después.

Nombre: ${raw.meta.name}
Descripción: ${raw.meta.description ?? '(sin descripción)'}
Topics: ${raw.meta.topics.join(', ') || '(sin topics)'}

Directorios de primer nivel: ${analysis.topLevelDirs.join(', ') || '(sin subdirectorios)'}

Stack inferido:
${stackLines}

Métricas:
${metricsLines}

README (truncado a ${README_TRUNCATE_CHARS} caracteres):
"""
${readme}
"""

Reglas estrictas:
- Tono técnico y sobrio. Nunca uses primera persona.
- Prohibido inventar features que no aparezcan en la evidencia de arriba (README, stack, métricas).
- Prohibidas frases de relleno tipo "solución robusta y escalable".
- Si la evidencia es insuficiente o el README es pobre, usá confidence "baja" y un summary honesto y corto.
- keywords en minúscula, conceptos concretos, no genéricos.

Devolvé exactamente este shape JSON (sin comentarios, sin texto adicional):
{
  "pitch": "1 oración: qué es y para quién",
  "summary": "3-5 oraciones: problema, enfoque, resultado",
  "highlights": ["2 a 4 decisiones técnicas destacables"],
  "techNotes": ["2 a 4 notas concretas sobre el stack"],
  "domain": "dominio funcional en minúscula, ej: devtools, datos, educación",
  "keywords": ["5 a 8 conceptos en minúscula"],
  "confidence": "alta" | "media" | "baja"
}`
}

function hashInput(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('respuesta sin objeto JSON')
  return JSON.parse(trimmed.slice(start, end + 1))
}

async function callModel(client: Anthropic, prompt: string): Promise<RepoSummary> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = message.content[0]
  const text = block && block.type === 'text' ? block.text : ''
  const parsed = repoSummarySchema.parse(extractJson(text))
  return parsed
}

async function summarizeOne(client: Anthropic, repoName: string): Promise<void> {
  const raw = JSON.parse(await readFile(path.join(RAW_DIR, `${repoName}.json`), 'utf-8')) as RawRepoData
  const analysis = JSON.parse(await readFile(path.join(ANALYZED_DIR, `${repoName}.json`), 'utf-8')) as RepoAnalysis

  const prompt = buildPrompt(raw, analysis)
  const inputHash = hashInput(prompt)

  const cachePath = path.join(SUMMARIES_DIR, `${repoName}.json`)
  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf-8')) as SummaryCacheEntry
    if (cached.inputHash === inputHash) {
      console.log(`[cache] ${repoName}: sin cambios en el input`)
      return
    }
  }

  let summary: RepoSummary
  try {
    summary = await callModel(client, prompt)
  } catch (firstErr) {
    console.warn(`[retry] ${repoName}: fallo de parseo/validación, reintentando una vez (${firstErr instanceof Error ? firstErr.message : String(firstErr)})`)
    summary = await callModel(client, `${prompt}\n\nIMPORTANTE: tu respuesta anterior no cumplió el shape JSON exacto. Devolvé SOLO el objeto JSON válido, sin texto adicional.`)
  }

  const entry: SummaryCacheEntry = { inputHash, summary }
  await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8')
  console.log(`[ok] ${repoName}: confidence=${summary.confidence}`)
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY no definido. Cargalo en .env.local (ver .env.local.example).')
    process.exitCode = 1
    return
  }

  await mkdir(SUMMARIES_DIR, { recursive: true })
  const client = new Anthropic({ apiKey })

  let files: string[]
  try {
    files = await readdir(ANALYZED_DIR)
  } catch {
    console.error(`No existe ${ANALYZED_DIR}. Corré primero: npm run pipeline:analyze`)
    process.exitCode = 1
    return
  }

  const repoNames = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  if (repoNames.length === 0) {
    console.warn('No hay repos analizados para resumir en .cache/analyzed/')
    return
  }

  for (const repoName of repoNames) {
    try {
      await summarizeOne(client, repoName)
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
