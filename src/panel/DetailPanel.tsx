import type { GraphNode } from '@/lib/types'

interface Props {
  node: GraphNode | null
  onClose: () => void
}

export function DetailPanel({ node, onClose }: Props) {
  if (!node) return null

  return (
    <aside className="fixed right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-surface p-6 text-sm">
      <button type="button" onClick={onClose} className="mb-4 text-accent">
        cerrar
      </button>
      <h2 className="font-sans text-xl font-semibold">{node.repo.name}</h2>
      <p className="mt-1 text-gray-400">{node.summary.pitch}</p>
      <p className="mt-4 text-gray-300">{node.summary.summary}</p>
    </aside>
  )
}
