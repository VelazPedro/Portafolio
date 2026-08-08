import type { GraphNode } from '@/lib/types'

interface Props {
  nodes: GraphNode[]
  onSelectNode: (node: GraphNode) => void
}

export function TimelineView({ nodes, onSelectNode }: Props) {
  const sorted = [...nodes].sort(
    (a, b) => new Date(a.repo.createdAt).getTime() - new Date(b.repo.createdAt).getTime(),
  )

  if (sorted.length === 0) {
    return <p className="p-4 text-gray-500">Sin proyectos que coincidan con los filtros.</p>
  }

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const minTime = first ? new Date(first.repo.createdAt).getTime() : 0
  const maxTime = last ? new Date(last.repo.createdAt).getTime() : minTime
  const span = Math.max(1, maxTime - minTime)

  return (
    <div className="h-full overflow-auto p-8">
      <div className="relative mx-4 mt-16 h-1 rounded bg-white/10">
        {sorted.map((node) => {
          const t = new Date(node.repo.createdAt).getTime()
          const pct = ((t - minTime) / span) * 100
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node)}
              className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pct}%` }}
            >
              <span
                className="block rounded-full border-2 border-bg"
                style={{ width: 12, height: 12, backgroundColor: node.color }}
              />
              <span className="pointer-events-none absolute left-1/2 top-4 w-max -translate-x-1/2 rounded bg-surface px-2 py-1 font-mono text-[10px] text-gray-300 opacity-0 shadow group-hover:opacity-100 group-focus:opacity-100">
                {node.repo.name}
                <br />
                {new Date(node.repo.createdAt).toLocaleDateString()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
