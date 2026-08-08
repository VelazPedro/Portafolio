import type { GraphNode } from '@/lib/types'
import { dominantLanguage } from '@/lib/graphUtils'

interface Props {
  nodes: GraphNode[]
  onSelectNode: (node: GraphNode) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'long' })
}

export function TimelineView({ nodes, onSelectNode }: Props) {
  const sorted = [...nodes].sort(
    (a, b) => new Date(b.repo.createdAt).getTime() - new Date(a.repo.createdAt).getTime(),
  )

  if (sorted.length === 0) {
    return <p className="p-8 text-gray-500">Sin proyectos que coincidan con los filtros.</p>
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-8 md:px-10">
      <ol className="relative mx-auto max-w-3xl border-l border-white/15 pl-8">
        {sorted.map((node) => {
          const lang = dominantLanguage(node)
          return (
            <li key={node.id} className="mb-10 last:mb-0">
              <span
                className="absolute -left-[9px] mt-1.5 block h-4 w-4 rounded-full border-2 border-bg"
                style={{ backgroundColor: node.color }}
                aria-hidden="true"
              />
              <div className="rounded-lg border border-white/10 bg-surface p-4 transition-colors hover:border-accent/50">
                <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs text-gray-500">
                  <time dateTime={node.repo.createdAt}>{formatDate(node.repo.createdAt)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{node.analysis.status}</span>
                  {lang && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{lang}</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onSelectNode(node)}
                  className="text-left font-sans text-lg font-semibold text-gray-100 hover:text-accent"
                >
                  {node.repo.name}
                </button>
                <p className="mt-1 text-sm text-gray-300">{node.summary.pitch}</p>
                {node.summary.keywords.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {node.summary.keywords.slice(0, 5).map((kw) => (
                      <span key={kw} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
