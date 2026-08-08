import { useMemo, useState } from 'react'
import type { GraphNode } from '@/lib/types'
import { dominantLanguage } from '@/lib/graphUtils'

interface Props {
  nodes: GraphNode[]
  onSelectNode: (node: GraphNode) => void
}

type SortKey = 'name' | 'language' | 'status' | 'commits' | 'createdAt'

export function ListView({ nodes, onSelectNode }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const sorted = useMemo(() => {
    const copy = [...nodes]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = a.repo.name.localeCompare(b.repo.name)
          break
        case 'language':
          cmp = (dominantLanguage(a) ?? '').localeCompare(dominantLanguage(b) ?? '')
          break
        case 'status':
          cmp = a.analysis.status.localeCompare(b.analysis.status)
          break
        case 'commits':
          cmp = a.repo.commitCount - b.repo.commitCount
          break
        case 'createdAt':
          cmp = new Date(a.repo.createdAt).getTime() - new Date(b.repo.createdAt).getTime()
          break
      }
      return sortAsc ? cmp : -cmp
    })
    return copy
  }, [nodes, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Nombre' },
    { key: 'language', label: 'Lenguaje' },
    { key: 'status', label: 'Estado' },
    { key: 'commits', label: 'Commits' },
    { key: 'createdAt', label: 'Creado' },
  ]

  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full border-collapse font-mono text-sm">
        <caption className="sr-only">Lista de proyectos, equivalente accesible del grafo</caption>
        <thead>
          <tr className="border-b border-white/10 text-left text-gray-400">
            {headers.map((h) => (
              <th key={h.key} scope="col" className="px-2 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort(h.key)}
                  className="hover:text-accent"
                  aria-sort={sortKey === h.key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                >
                  {h.label} {sortKey === h.key ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((node) => (
            <tr key={node.id} className="border-b border-white/5 text-gray-300 hover:bg-white/5">
              <td className="px-2 py-2">
                <button type="button" onClick={() => onSelectNode(node)} className="text-left text-accent hover:underline">
                  {node.repo.name}
                </button>
              </td>
              <td className="px-2 py-2">{dominantLanguage(node) ?? '—'}</td>
              <td className="px-2 py-2">{node.analysis.status}</td>
              <td className="px-2 py-2">{node.repo.commitCount}</td>
              <td className="px-2 py-2">{new Date(node.repo.createdAt).getFullYear()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p className="mt-4 text-gray-500">Sin proyectos que coincidan con los filtros.</p>}
    </div>
  )
}
