import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { GraphNode, PortfolioGraph } from '@/lib/types'
import { dominantLanguage, getConnections } from '@/lib/graphUtils'

interface Props {
  node: GraphNode | null
  graph: PortfolioGraph
  onClose: () => void
  onSelectNode: (node: GraphNode) => void
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] font-mono ${
        ok ? 'bg-accent/20 text-accent' : 'bg-white/5 text-gray-500'
      }`}
    >
      {label}: {ok ? 'sí' : 'no'}
    </span>
  )
}

export function DetailPanel({ node, graph, onClose, onSelectNode }: Props) {
  if (!node) return null

  const lang = dominantLanguage(node)
  const connections = getConnections(graph, node.id)

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[80vh] overflow-y-auto rounded-t-lg border-t border-white/10 bg-surface p-5 text-sm shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-full md:w-[420px] md:rounded-none md:border-l md:border-t-0"
      aria-label={`Detalle de ${node.repo.name}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="mb-3 rounded border border-white/15 px-2 py-1 font-mono text-xs text-gray-300 hover:border-accent hover:text-accent"
      >
        cerrar ✕
      </button>

      {/* Cabecera */}
      <header className="mb-4">
        <h2 className="font-sans text-xl font-semibold text-gray-100">{node.repo.name}</h2>
        <p className="mt-1 text-gray-400">{node.summary.pitch}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-gray-400">
          {lang && <span className="rounded bg-white/5 px-2 py-0.5">{lang}</span>}
          <span className="rounded bg-white/5 px-2 py-0.5">{node.analysis.status}</span>
          <a href={node.repo.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            repo
          </a>
          {node.repo.homepage && (
            <a href={node.repo.homepage} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              demo
            </a>
          )}
        </div>
      </header>

      {/* Resumen */}
      <details open className="mb-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          Resumen
        </summary>
        <p className="mt-2 text-gray-300">{node.summary.summary}</p>
        {node.summary.highlights.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-1 text-gray-400">
            {node.summary.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 font-mono text-[10px] text-gray-500">confianza del informe: {node.summary.confidence}</p>
      </details>

      {/* Stack y dependencias */}
      <details className="mb-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          Stack y dependencias
        </summary>
        <ul className="mt-2 space-y-1 text-gray-300">
          <li title={node.analysis.primaryFramework.evidence}>
            framework: {node.analysis.primaryFramework.value ?? '—'}
          </li>
          <li title={node.analysis.runtime.evidence}>runtime: {node.analysis.runtime.value ?? '—'}</li>
          <li title={node.analysis.database.evidence}>DB: {node.analysis.database.value ?? '—'}</li>
          <li title={node.analysis.buildTools.evidence}>
            build: {node.analysis.buildTools.value.join(', ') || '—'}
          </li>
          <li title={node.analysis.testTools.evidence}>
            test: {node.analysis.testTools.value.join(', ') || '—'}
          </li>
        </ul>
        {node.analysis.dependencies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {node.analysis.dependencies.slice(0, 20).map((dep) => (
              <span
                key={`${dep.name}-${dep.type}`}
                title={`${dep.name}@${dep.version || 's/v'} (${dep.type})`}
                className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
              >
                {dep.name}
              </span>
            ))}
          </div>
        )}
        {node.summary.techNotes.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-1 text-gray-500">
            {node.summary.techNotes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </details>

      {/* Métricas */}
      <details className="mb-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          Métricas
        </summary>
        <ul className="mt-2 space-y-1 text-gray-300">
          <li>commits: {node.repo.commitCount}</li>
          <li>días de vida: {node.analysis.daysAlive}</li>
          <li>último push: hace {node.analysis.daysSinceLastPush} días</li>
          <li>archivos: {node.analysis.fileCount}</li>
          <li>stars: {node.repo.stars} · forks: {node.repo.forks}</li>
        </ul>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge ok={node.analysis.hasTests} label="tests" />
          <Badge ok={node.analysis.hasCI} label="CI" />
          <Badge ok={node.analysis.hasDocker} label="Docker" />
          <Badge ok={node.analysis.hasDocs} label="docs" />
        </div>
      </details>

      {/* Estructura */}
      <details className="mb-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          Estructura ({node.analysis.topLevelDirs.length} directorios de primer nivel)
        </summary>
        <ul className="mt-2 space-y-1 font-mono text-xs text-gray-400">
          {node.analysis.topLevelDirs.map((dir) => (
            <li key={dir}>/{dir}</li>
          ))}
          {node.analysis.topLevelDirs.length === 0 && <li>sin subdirectorios</li>}
        </ul>
      </details>

      {/* Conexiones */}
      <details className="mb-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          Conexiones ({connections.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {connections.map((c) => (
            <li key={c.node.id}>
              <button
                type="button"
                onClick={() => onSelectNode(c.node)}
                className="text-left text-accent hover:underline"
              >
                {c.node.repo.name}
              </button>
              <span className="ml-2 font-mono text-[10px] text-gray-500">peso {c.weight.toFixed(2)}</span>
              <ul className="ml-3 list-inside list-disc text-[11px] text-gray-500">
                {c.reasons.map((r) => (
                  <li key={r.kind}>{r.detail}</li>
                ))}
              </ul>
            </li>
          ))}
          {connections.length === 0 && <li className="text-gray-500">sin conexiones por encima del umbral</li>}
        </ul>
      </details>

      {/* README */}
      <details className="border-t border-white/10 pt-3">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-gray-400">
          README
        </summary>
        <div className="prose prose-invert prose-sm mt-2 max-w-none text-gray-300">
          {node.repo.readme ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {node.repo.readme}
            </ReactMarkdown>
          ) : (
            <p className="text-gray-500">sin README</p>
          )}
        </div>
      </details>
    </aside>
  )
}
