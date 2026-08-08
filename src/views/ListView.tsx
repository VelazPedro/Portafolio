import { useMemo, useState } from 'react'
import type { GraphNode } from '@/lib/types'
import { dominantLanguage } from '@/lib/graphUtils'

interface Props {
  nodes: GraphNode[]
  onSelectNode: (node: GraphNode) => void
}

type SortKey = 'name' | 'language' | 'domain' | 'status' | 'commits' | 'createdAt'

const STATUS_STYLES: Record<string, string> = {
  activo: 'bg-emerald-400/15 text-emerald-300',
  pausado: 'bg-amber-400/15 text-amber-300',
  'archivado-de-facto': 'bg-gray-400/15 text-gray-400',
}

export function ListView({ nodes, onSelectNode }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortAsc, setSortAsc] = useState(false)

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
        case 'domain':
          cmp = a.summary.domain.localeCompare(b.summary.domain)
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

  const headers: { key: SortKey; label: string; className?: string }[] = [
    { key: 'name', label: 'Nombre' },
    { key: 'domain', label: 'Dominio' },
    { key: 'language', label: 'Lenguaje' },
    { key: 'status', label: 'Estado' },
    { key: 'commits', label: 'Commits', className: 'text-right' },
    { key: 'createdAt', label: 'Creado' },
  ]

  if (sorted.length === 0) {
    return <p className="p-8 text-gray-500">Sin proyectos que coincidan con los filtros.</p>
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-lg border border-white/10">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Lista de proyectos, equivalente accesible del grafo</caption>
          <thead>
            <tr className="bg-white/[0.03] text-left text-gray-400">
              {headers.map((h) => (
                <th key={h.key} scope="col" className={`px-4 py-3 font-mono text-xs font-medium uppercase tracking-wide ${h.className ?? ''}`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(h.key)}
                    className="inline-flex items-center gap-1 hover:text-accent focus:text-accent focus:outline-none"
                    aria-sort={sortKey === h.key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                  >
                    {h.label}
                    <span className="text-[10px] text-gray-600">{sortKey === h.key ? (sortAsc ? '↑' : '↓') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.map((node) => (
              <tr key={node.id} className="bg-surface transition-colors hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onSelectNode(node)}
                    className="text-left font-semibold text-gray-100 hover:text-accent focus:text-accent focus:outline-none"
                  >
                    {node.repo.name}
                  </button>
                  <p className="mt-0.5 max-w-md truncate text-xs text-gray-500">{node.summary.pitch}</p>
                </td>
                <td className="px-4 py-3 text-gray-300">{node.summary.domain}</td>
                <td className="px-4 py-3 text-gray-300">{dominantLanguage(node) ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 font-mono text-xs ${STATUS_STYLES[node.analysis.status] ?? 'bg-white/5 text-gray-400'}`}>
                    {node.analysis.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-300">{node.repo.commitCount}</td>
                <td className="px-4 py-3 font-mono text-gray-400">
                  {new Date(node.repo.createdAt).toLocaleDateString('es-AR', { year: 'numeric', month: 'short' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
