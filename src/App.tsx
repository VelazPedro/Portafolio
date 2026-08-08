import { useEffect, useMemo, useState } from 'react'
import { ForceGraph } from '@/graph/ForceGraph'
import { DetailPanel } from '@/panel/DetailPanel'
import { FilterBar } from '@/filters/FilterBar'
import { ListView } from '@/views/ListView'
import { TimelineView } from '@/views/TimelineView'
import type { GraphNode, PortfolioGraph } from '@/lib/types'
import { defaultFilters, extractFilterOptions, nodeMatchesFilters, type GraphFilters } from '@/lib/graphUtils'

type Tab = 'grafo' | 'timeline' | 'lista'

function App() {
  const [graph, setGraph] = useState<PortfolioGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<GraphFilters>(defaultFilters)
  const [tab, setTab] = useState<Tab>('grafo')

  useEffect(() => {
    fetch('/data/graph.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<PortfolioGraph>
      })
      .then(setGraph)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const filteredNodes = useMemo(() => {
    if (!graph) return []
    return graph.nodes.filter((n) => nodeMatchesFilters(n, filters))
  }, [graph, filters])

  const filteredGraph = useMemo((): PortfolioGraph | null => {
    if (!graph) return null
    const ids = new Set(filteredNodes.map((n) => n.id))
    const edges = graph.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target) && e.weight >= filters.edgeThreshold,
    )
    return { generatedAt: graph.generatedAt, nodes: filteredNodes, edges }
  }, [graph, filteredNodes, filters.edgeThreshold])

  const selectedNode: GraphNode | null = useMemo(() => {
    if (!graph || !selectedId) return null
    return graph.nodes.find((n) => n.id === selectedId) ?? null
  }, [graph, selectedId])

  const options = useMemo(() => (graph ? extractFilterOptions(graph) : { languages: [], domains: [], years: [], statuses: [] }), [graph])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-red-400">
        error cargando graph.json: {error}
      </div>
    )
  }

  if (!graph || !filteredGraph) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-gray-400">
        cargando grafo…
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-bg">
      <nav className="pointer-events-auto absolute right-4 top-4 z-10 flex gap-1 rounded-lg border border-white/10 bg-surface/90 p-1 font-mono text-xs backdrop-blur">
        {(['grafo', 'timeline', 'lista'] as const satisfies readonly Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t}
            className={`rounded px-3 py-1 ${tab === t ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {t}
          </button>
        ))}
      </nav>

      <FilterBar filters={filters} onChange={setFilters} options={options} />

      <main className="h-full w-full pt-2">
        {tab === 'grafo' && (
          <ForceGraph graph={filteredGraph} selectedId={selectedId} onSelectNode={(n) => setSelectedId(n.id)} />
        )}
        {tab === 'timeline' && <TimelineView nodes={filteredNodes} onSelectNode={(n) => setSelectedId(n.id)} />}
        {tab === 'lista' && <ListView nodes={filteredNodes} onSelectNode={(n) => setSelectedId(n.id)} />}
      </main>

      <DetailPanel
        node={selectedNode}
        graph={graph}
        onClose={() => setSelectedId(null)}
        onSelectNode={(n) => setSelectedId(n.id)}
      />
    </div>
  )
}

export default App
