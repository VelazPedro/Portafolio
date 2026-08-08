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

interface D3Force {
  strength?: (v: number) => D3Force
  distance?: (v: number) => D3Force
}

interface FGMethods {
  zoomToFit(durationMs?: number, padding?: number): void
  centerAt(x?: number, y?: number, durationMs?: number): void
  d3Force(name: string): D3Force | undefined
  d3ReheatSimulation(): void
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
  linkDirectionalParticles?: (link: FGLinkRendered) => number
  linkDirectionalParticleWidth?: number
  linkDirectionalParticleColor?: () => string
  linkDirectionalParticleSpeed?: number
  onNodeHover?: (node: GraphNode | null) => void
  onNodeClick?: (node: GraphNode) => void
  onEngineStop?: () => void
  cooldownTicks?: number
  warmupTicks?: number
  d3AlphaDecay?: number
  minZoom?: number
  maxZoom?: number
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

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100
  const lN = l / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lN - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const R = Math.round((r + m) * 255)
  const G = Math.round((g + m) * 255)
  const B = Math.round((b + m) * 255)
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`
}

/** Sube saturación y ajusta luminosidad para un color más vívido, preservando el matiz. */
function vivid(hex: string, lightness = 58): string {
  const [h, s] = hexToHsl(hex)
  return hslToHex(h, Math.max(s, 80), lightness)
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

  // react-force-graph muta los objetos que recibe (les agrega x/y/vx/vy a los
  // nodos, y reemplaza edge.source/target de string a referencia de nodo).
  // Si le pasáramos las referencias originales del estado de React, esa
  // mutación corrompería graph.edges para siempre (source/target dejarían de
  // ser strings comparables). Por eso se clona todo acá.
  const graphData = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const pos = staticLayout?.get(n.id)
      return pos ? { ...n, fx: pos.x, fy: pos.y, x: pos.x, y: pos.y } : { ...n }
    })
    const links = graph.edges.map((e) => ({ ...e }))
    return { nodes, links }
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
      const isActive = node.id === activeId
      const radius = Math.max(10, Math.sqrt(node.size) * 4.6)
      const fillColor = vivid(node.color, 58)
      const borderColor = vivid(node.color, 78)

      ctx.save()
      ctx.globalAlpha = dimmed ? 0.18 : 1

      if (!dimmed) {
        ctx.shadowColor = fillColor
        ctx.shadowBlur = isActive ? 28 : 16
      }

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = fillColor
      ctx.fill()

      ctx.shadowBlur = 0
      ctx.lineWidth = isActive ? 4 : 2.5
      ctx.strokeStyle = isActive ? '#ffffff' : borderColor
      if (node.dashedBorder) ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()

      if (globalScale > 1.1 || isActive) {
        ctx.font = `${13 / globalScale}px "Space Grotesk", system-ui, sans-serif`
        ctx.fillStyle = isActive ? '#ffffff' : '#e5e7eb'
        ctx.textAlign = 'center'
        ctx.globalAlpha = dimmed ? 0.18 : 1
        ctx.fillText(node.repo.name, x, y + radius + 12 / globalScale)
        ctx.globalAlpha = 1
      }
    },
    [neighborIds, activeId],
  )

  const isLinkActive = useCallback(
    (link: FGLinkRendered) => {
      if (!neighborIds) return true
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source
      const targetId = typeof link.target === 'object' ? link.target.id : link.target
      return neighborIds.has(sourceId) && neighborIds.has(targetId)
    },
    [neighborIds],
  )

  const linkColor = useCallback(
    (link: FGLinkRendered) => (isLinkActive(link) ? 'rgba(94, 234, 212, 0.9)' : 'rgba(180, 195, 215, 0.55)'),
    [isLinkActive],
  )

  const hasFittedRef = useRef(false)
  const nodeIdsKey = graph.nodes.map((n) => n.id).join(',')

  useEffect(() => {
    hasFittedRef.current = false
  }, [nodeIdsKey])

  // Con pocos nodos, la repulsión/distancia por defecto de d3-force los deja
  // pegados o superpuestos. Se separan a mano y se reinicia la simulación.
  useEffect(() => {
    if (reducedMotion) return
    fgRef.current?.d3Force('charge')?.strength?.(-260)
    fgRef.current?.d3Force('link')?.distance?.(150)
    fgRef.current?.d3ReheatSimulation()
  }, [nodeIdsKey, reducedMotion])

  const handleEngineStop = useCallback(() => {
    if (hasFittedRef.current) return
    hasFittedRef.current = true
    fgRef.current?.zoomToFit(400, 80)
  }, [])

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
        linkWidth={(link) => (isLinkActive(link) ? 5 : 3)}
        linkColor={linkColor}
        linkDirectionalParticles={(link) => (isLinkActive(link) ? 3 : 0)}
        linkDirectionalParticleWidth={3}
        linkDirectionalParticleColor={() => '#5eead4'}
        linkDirectionalParticleSpeed={0.004}
        onNodeHover={(node) => setHoveredId(node ? node.id : null)}
        onNodeClick={(node) => onSelectNode(node)}
        onEngineStop={handleEngineStop}
        cooldownTicks={reducedMotion ? 0 : 150}
        warmupTicks={reducedMotion ? 0 : undefined}
        minZoom={0.3}
        maxZoom={8}
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
