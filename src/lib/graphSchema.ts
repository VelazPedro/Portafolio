import { z } from 'zod'

export const projectTypeSchema = z.enum([
  'web-app',
  'cli',
  'libreria',
  'api',
  'script',
  'notebook',
  'juego',
  'herramienta-escritorio',
  'otro',
])

export const projectStatusSchema = z.enum(['activo', 'pausado', 'archivado-de-facto'])

export const confidenceSchema = z.enum(['alta', 'media', 'baja'])

export const dependencyRefSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(['prod', 'dev']),
})

function evidencedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, evidence: z.string() })
}

export const repoAnalysisSchema = z.object({
  projectType: evidencedField(projectTypeSchema),
  primaryFramework: evidencedField(z.string().nullable()),
  runtime: evidencedField(z.string().nullable()),
  database: evidencedField(z.string().nullable()),
  buildTools: evidencedField(z.array(z.string())),
  testTools: evidencedField(z.array(z.string())),
  dependencies: z.array(dependencyRefSchema),
  fileCount: z.number().int().nonnegative(),
  maxDepth: z.number().int().nonnegative(),
  topLevelDirs: z.array(z.string()),
  hasTests: z.boolean(),
  hasCI: z.boolean(),
  hasDocker: z.boolean(),
  hasDocs: z.boolean(),
  daysAlive: z.number().int().nonnegative(),
  daysSinceLastPush: z.number().int().nonnegative(),
  status: projectStatusSchema,
})

export const repoSummarySchema = z.object({
  pitch: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  techNotes: z.array(z.string()),
  domain: z.string(),
  keywords: z.array(z.string()),
  confidence: confidenceSchema,
})

export const repoMetaSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  homepage: z.string().nullable(),
  topics: z.array(z.string()),
  license: z.string().nullable(),
  createdAt: z.string(),
  pushedAt: z.string(),
  commitCount: z.number().int().nonnegative(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  languages: z.record(z.string(), z.number()),
  defaultBranch: z.string(),
  readme: z.string().nullable(),
})

export const graphNodeSchema = z.object({
  id: z.string(),
  repo: repoMetaSchema,
  analysis: repoAnalysisSchema,
  summary: repoSummarySchema,
  size: z.number().positive(),
  color: z.string(),
  dashedBorder: z.boolean(),
  cluster: z.number().int().nonnegative(),
  x: z.number().optional(),
  y: z.number().optional(),
})

export const edgeReasonKindSchema = z.enum(['lenguaje', 'dependencias', 'topics', 'dominio', 'mencion-cruzada'])

export const edgeReasonSchema = z.object({
  kind: edgeReasonKindSchema,
  weight: z.number(),
  detail: z.string(),
})

export const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number(),
  reasons: z.array(edgeReasonSchema),
})

export const portfolioGraphSchema = z.object({
  generatedAt: z.string(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
})

export type ProjectType = z.infer<typeof projectTypeSchema>
export type ProjectStatus = z.infer<typeof projectStatusSchema>
export type Confidence = z.infer<typeof confidenceSchema>
export type DependencyRef = z.infer<typeof dependencyRefSchema>
export type RepoAnalysis = z.infer<typeof repoAnalysisSchema>
export type RepoSummary = z.infer<typeof repoSummarySchema>
export type RepoMeta = z.infer<typeof repoMetaSchema>
export type GraphNode = z.infer<typeof graphNodeSchema>
export type EdgeReasonKind = z.infer<typeof edgeReasonKindSchema>
export type EdgeReason = z.infer<typeof edgeReasonSchema>
export type GraphEdge = z.infer<typeof graphEdgeSchema>
export type PortfolioGraph = z.infer<typeof portfolioGraphSchema>

export type EvidencedField<T> = { value: T; evidence: string }
