import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type Ref,
} from 'react'
import ForceGraph2DImpl from 'react-force-graph-2d'
import type { GraphEdge, GraphNode, PortfolioGraph } from '@/lib/types'

interface FGMethods {
  zoomToFit(durationMs?: number, padding?: number): void
  centerAt(x?: number, y?: number, durationMs?: number): void
}

type FGNodeRendered = GraphNode & { x?: number; y?: number; fx?: number; fy?: number }
type FGLinkRendered = Omit<GraphEdge, 'source' | 'target'> & {
  source: string | GraphNode
  target: string | GraphNode
}

interface TypedForceGraphProps {
  ref?: Ref<FGMethods>
  graphData: { nodes: GraphNode[]; links: GraphEdge[] }
  backgroundColor?: string
  nodeId?: string
  nodeVal?: (node: GraphNode) => number
  nodeCanvasObject?: (node: FGNodeRendered, ctx: CanvasRenderingContext2D, globalScale: number) => void
  linkWidth?: (link: FGLinkRendered) => number
  linkColor?: (link: FGLinkRendered) => string
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode) => void
  cooldownTicks?: number
  warmupTicks?: number
  d3AlphaDecay?: number
}

const ForceGraph2D = ForceGraph2DImpl as unknown as ComponentType<TypedForceGraphProps>

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])
  return reduced
}

function computeStaticLayout(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const radius = Math.max(120, nodes.length * 18)
  const positions = new Map<string, { x: number; y: number }>()
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, nodes.length)
    positions.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  })
  return positions
}

interface Props {
  graph: PortfolioGraph
  selectedId: string | null
  onSelectNode: (node: GraphNode) => void
}

export function ForceGraph({ graph, selectedId, onSelectNode }: Props) {
  const fgRef = useRef<FGMethods | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  const staticLayout = useMemo(
    () => (reducedMotion ? computeStaticLayout(graph.nodes) : null),
    [reducedMotion, graph.nodes],
  )

  const graphData = useMemo(() => {
    if (!staticLayout) return { nodes: graph.nodes, links: graph.edges }
    const nodes = graph.nodes.map((n) => {
      const pos = staticLayout.get(n.id)
      return pos ? { ...n, fx: pos.x, fy: pos.y, x: pos.x, y: pos.y } : n
    }) as GraphNode[]
    return { nodes, links: graph.edges }
  }, [graph, staticLayout])

  const activeId = focusedId ?? hoveredId ?? selectedId

  const neighborIds = useMemo(() => {
    if (!activeId) return null
    const ids = new Set<string>([activeId])
    for (const edge of graph.edges) {
      if (edge.source === activeId) ids.add(edge.target)
      if (edge.target === activeId) ids.add(edge.source)
    }
    return ids
  }, [activeId, graph.edges])

  const nodeCanvasObject = useCallback(
    (node: FGNodeRendered, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const dimmed = neighborIds !== null && !neighborIds.has(node.id)
      const radius = Math.max(3, Math.sqrt(node.size) * 2)

      ctx.globalAlpha = dimmed ? 0.15 : 1
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()
      if (node.id === activeId) {
        ctx.strokeStyle = '#5eead4'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (node.dashedBorder) {
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = '#9ca3af'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (globalScale > 1.5 || node.id === activeId) {
        ctx.font = `${12 / globalScale}px "Space Grotesk", system-ui, sans-serif`
        ctx.fillStyle = '#e5e7eb'
        ctx.textAlign = 'center'
        ctx.fillText(node.repo.name, x, y + radius + 10 / globalScale)
      }
      ctx.globalAlpha = 1
    },
    [neighborIds, activeId],
  )

  const linkColor = useCallback(
    (link: FGLinkRendered) => {
      if (!neighborIds) return 'rgba(148, 163, 184, 0.35)'
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source
      const targetId = typeof link.target === 'object' ? link.target.id : link.target
      const active = neighborIds.has(sourceId) && neighborIds.has(targetId)
      return active ? 'rgba(94, 234, 212, 0.8)' : 'rgba(148, 163, 184, 0.08)'
    },
    [neighborIds],
  )

  const nodeButtonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (index + 1) % graph.nodes.length
      nodeButtonsRef.current[next]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (index - 1 + graph.nodes.length) % graph.nodes.length
      nodeButtonsRef.current[prev]?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const node = graph.nodes[index]
      if (node) onSelectNode(node)
    }
  }

  return (
    <div className="relative h-full w-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#0b0d10"
        nodeId="id"
        nodeVal={(node) => node.size}
        nodeCanvasObject={nodeCanvasObject}
        linkWidth={(link) => 1 + link.weight * 3}
        linkColor={linkColor}
        onNodeHover={(node) => setHoveredId(node ? node.id : null)}
        onNodeClick={(node) => onSelectNode(node)}
        cooldownTicks={reducedMotion ? 0 : 100}
        warmupTicks={reducedMotion ? 0 : undefined}
      />

      {/* Navegación por teclado: lista accesible oculta visualmente, equivalente a recorrer el grafo con Tab/flechas */}
      <ul className="sr-only" aria-label="Navegación por teclado entre proyectos del grafo">
        {graph.nodes.map((node, i) => (
          <li key={node.id}>
            <button
              ref={(el) => {
                nodeButtonsRef.current[i] = el
              }}
              type="button"
              onFocus={() => setFocusedId(node.id)}
              onBlur={() => setFocusedId((curr) => (curr === node.id ? null : curr))}
              onKeyDown={(e) => handleKeyDown(e, i)}
              onClick={() => onSelectNode(node)}
            >
              {node.repo.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
