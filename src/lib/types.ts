export type ProjectType =
  | 'web-app'
  | 'cli'
  | 'libreria'
  | 'api'
  | 'script'
  | 'notebook'
  | 'juego'
  | 'herramienta-escritorio'
  | 'otro'

export type ProjectStatus = 'activo' | 'pausado' | 'archivado-de-facto'

export type Confidence = 'alta' | 'media' | 'baja'

export interface DependencyRef {
  name: string
  version: string
  type: 'prod' | 'dev'
}

export interface EvidencedField<T> {
  value: T
  evidence: string
}

export interface RepoAnalysis {
  projectType: EvidencedField<ProjectType>
  primaryFramework: EvidencedField<string | null>
  runtime: EvidencedField<string | null>
  database: EvidencedField<string | null>
  buildTools: EvidencedField<string[]>
  testTools: EvidencedField<string[]>
  dependencies: DependencyRef[]
  fileCount: number
  maxDepth: number
  topLevelDirs: string[]
  hasTests: boolean
  hasCI: boolean
  hasDocker: boolean
  hasDocs: boolean
  daysAlive: number
  daysSinceLastPush: number
  status: ProjectStatus
}

export interface RepoSummary {
  pitch: string
  summary: string
  highlights: string[]
  techNotes: string[]
  domain: string
  keywords: string[]
  confidence: Confidence
}

export interface RepoMeta {
  name: string
  description: string | null
  url: string
  homepage: string | null
  topics: string[]
  license: string | null
  createdAt: string
  pushedAt: string
  commitCount: number
  stars: number
  forks: number
  languages: Record<string, number>
  defaultBranch: string
}

export interface GraphNode {
  id: string
  repo: RepoMeta
  analysis: RepoAnalysis
  summary: RepoSummary
  size: number
  color: string
  dashedBorder: boolean
  cluster: number
  x?: number
  y?: number
}

export type EdgeReasonKind =
  | 'lenguaje'
  | 'dependencias'
  | 'topics'
  | 'dominio'
  | 'mencion-cruzada'

export interface EdgeReason {
  kind: EdgeReasonKind
  weight: number
  detail: string
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  reasons: EdgeReason[]
}

export interface PortfolioGraph {
  generatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}
