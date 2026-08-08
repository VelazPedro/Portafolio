import { useEffect, useState } from 'react'
import { ForceGraph } from '@/graph/ForceGraph'
import { DetailPanel } from '@/panel/DetailPanel'
import { FilterBar } from '@/filters/FilterBar'
import type { GraphNode, PortfolioGraph } from '@/lib/types'

function App() {
  const [graph, setGraph] = useState<PortfolioGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  useEffect(() => {
    fetch('/data/graph.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<PortfolioGraph>
      })
      .then(setGraph)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-red-400">
        error cargando graph.json: {error}
      </div>
    )
  }

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-gray-400">
        cargando grafo…
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-bg">
      <FilterBar />
      <ForceGraph graph={graph} onSelectNode={setSelected} />
      <DetailPanel node={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export default App
