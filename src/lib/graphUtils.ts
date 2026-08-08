import type { GraphEdge, GraphNode, PortfolioGraph } from './types'

export interface Connection {
  node: GraphNode
  weight: number
  reasons: GraphEdge['reasons']
}

export function getConnections(graph: PortfolioGraph, nodeId: string): Connection[] {
  const byNodeId = new Map(graph.nodes.map((n) => [n.id, n]))
  const connections: Connection[] = []
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      const node = byNodeId.get(edge.target)
      if (node) connections.push({ node, weight: edge.weight, reasons: edge.reasons })
    } else if (edge.target === nodeId) {
      const node = byNodeId.get(edge.source)
      if (node) connections.push({ node, weight: edge.weight, reasons: edge.reasons })
    }
  }
  return connections.sort((a, b) => b.weight - a.weight)
}

export interface GraphFilters {
  search: string
  language: string | null
  domain: string | null
  year: number | null
  status: string | null
  onlyActive: boolean
  edgeThreshold: number
}

export const defaultFilters: GraphFilters = {
  search: '',
  language: null,
  domain: null,
  year: null,
  status: null,
  onlyActive: false,
  edgeThreshold: 0,
}

export function dominantLanguage(node: GraphNode): string | null {
  const entries = Object.entries(node.repo.languages)
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function nodeMatchesFilters(node: GraphNode, filters: GraphFilters): boolean {
  if (filters.onlyActive && node.analysis.status !== 'activo') return false
  if (filters.status && node.analysis.status !== filters.status) return false
  if (filters.domain && node.summary.domain !== filters.domain) return false
  if (filters.language && dominantLanguage(node) !== filters.language) return false
  if (filters.year && new Date(node.repo.createdAt).getFullYear() !== filters.year) return false
  if (filters.search) {
    const q = filters.search.toLowerCase()
    const haystack = [node.repo.name, node.summary.pitch, ...node.summary.keywords].join(' ').toLowerCase()
    if (!haystack.includes(q)) return false
  }
  return true
}

export function extractFilterOptions(graph: PortfolioGraph) {
  const languages = new Set<string>()
  const domains = new Set<string>()
  const years = new Set<number>()
  const statuses = new Set<string>()
  for (const node of graph.nodes) {
    const lang = dominantLanguage(node)
    if (lang) languages.add(lang)
    domains.add(node.summary.domain)
    years.add(new Date(node.repo.createdAt).getFullYear())
    statuses.add(node.analysis.status)
  }
  return {
    languages: [...languages].sort(),
    domains: [...domains].sort(),
    years: [...years].sort((a, b) => b - a),
    statuses: [...statuses].sort(),
  }
}
