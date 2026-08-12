import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  screen2GraphCoords(x: number, y: number): { x: number; y: number }
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
  nodePointerAreaPaint?: (node: FGNodeRendered, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => void
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

// Radio en unidades de mundo (no píxeles de pantalla) usado TANTO para el
// dibujo visible como para el área de click (nodePointerAreaPaint más abajo).
// Tienen que compartir esta misma función: el área de click por defecto de
// react-force-graph-2d usa sqrt(val)*nodeRelSize SIN el mínimo de 10 que
// aplicamos acá, así que para nodos chicos (val bajo) el círculo dibujado
// queda visualmente más grande que su zona clickeable real, y clickear cerca
// del borde falla en silencio. Si se cambia este número, cambia para los dos.
function nodeRadius(node: GraphNode): number {
  return Math.max(10, Math.sqrt(node.size) * 4.6)
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
      const radius = nodeRadius(node)
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

  // Dibuja el área de click con el mismo radio que el círculo visible
  // (ver comentario en nodeRadius). Sin esto, react-force-graph-2d usa su
  // propio radio por defecto para detectar clicks, que no coincide con lo
  // que se ve en pantalla.
  const nodePointerAreaPaint = useCallback((node: FGNodeRendered, color: string, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0
    const y = node.y ?? 0
    ctx.beginPath()
    ctx.arc(x, y, nodeRadius(node), 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
  }, [])

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

  // El grafo tarda ~150 ticks animados (unos 2-3s en pantalla) en asentarse
  // la primera vez, y durante toda esa ventana los nodos se siguen moviendo.
  // Un click hecho en ese lapso apunta a donde el nodo ESTABA, no a donde
  // termina, y se percibe como "el grafo no responde al click" — react-force-graph
  // no expone ningún método para saltar ese asentamiento de forma sincrónica
  // (tickFrame/isEngineRunning existen en la librería pero el wrapper de React
  // no los reenvía). La solución robusta es no dejar clickear nada hasta que
  // onEngineStop confirme que la simulación realmente terminó: `ready` gatea
  // pointer-events sobre el propio grafo, así nunca hay ventana para clickear
  // un nodo en movimiento. No sacar este gate sin reemplazarlo por algo
  // equivalente.
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    hasFittedRef.current = false
    setReady(false)
  }, [nodeIdsKey])

  // Con pocos nodos, la repulsión/distancia por defecto de d3-force los deja
  // pegados o superpuestos, así que se separan a mano y se reinicia la
  // simulación con esa fuerza. useLayoutEffect (no useEffect) para que corra
  // antes del primer tick real (que llega recién en el siguiente frame).
  useLayoutEffect(() => {
    if (reducedMotion) return
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength?.(-260)
    fg.d3Force('link')?.distance?.(150)
    fg.d3ReheatSimulation()
  }, [nodeIdsKey, reducedMotion])

  const handleEngineStop = useCallback(() => {
    setReady(true)
    if (hasFittedRef.current) return
    hasFittedRef.current = true
    fgRef.current?.zoomToFit(400, 80)
  }, [])

  const interactive = reducedMotion || ready

  // Detección de click/hover/arrastre propia, independiente del picking
  // interno de react-force-graph-2d (que lee píxeles de un canvas oculto
  // —shadow canvas— para saber qué nodo tocaste, y el drag nativo depende
  // de ese mismo mecanismo). Algunos navegadores/extensiones de privacidad
  // bloquean o alteran esa lectura como medida anti-fingerprinting: el
  // dibujo se ve perfecto pero ningún click ni arrastre funciona nunca, sin
  // ningún error visible. screen2GraphCoords es pura transformación de
  // zoom/pan (sin leer píxeles), así que este cálculo funciona siempre.
  // onNodeClick/onNodeHover de la librería quedan igual como respaldo, pero
  // esta es la vía que de verdad hay que sostener.
  const containerRef = useRef<HTMLDivElement | null>(null)

  const findNodeAtPoint = useCallback(
    (clientX: number, clientY: number): FGNodeRendered | null => {
      const fg = fgRef.current
      const el = containerRef.current
      if (!fg || !el) return null
      const rect = el.getBoundingClientRect()
      const { x: gx, y: gy } = fg.screen2GraphCoords(clientX - rect.left, clientY - rect.top)
      let closest: FGNodeRendered | null = null
      let closestDist = Infinity
      for (const node of graphData.nodes as FGNodeRendered[]) {
        if (node.x === undefined || node.y === undefined) continue
        const dist = Math.hypot(gx - node.x, gy - node.y)
        if (dist <= nodeRadius(node) && dist < closestDist) {
          closestDist = dist
          closest = node
        }
      }
      return closest
    },
    [graphData],
  )

  // Mousedown sobre un nodo empieza el arrastre; si el mouse nunca se mueve
  // más que DRAG_TOLERANCE_PX se interpreta como click al soltar (mismo
  // criterio que usa la librería internamente). mousemove/mouseup van en
  // window, no en el contenedor, porque el cursor puede salirse del área
  // del grafo en medio del arrastre.
  const dragRef = useRef<{ node: FGNodeRendered; startClientX: number; startClientY: number; moved: boolean } | null>(
    null,
  )
  const DRAG_TOLERANCE_PX = 4
  // Reheat de la simulación durante el arrastre, espaciado en el tiempo: sin
  // esto habría que elegir entre no reactivar nunca la física (nodos vecinos
  // quedan estáticos mientras arrastrás) o reactivarla una sola vez al
  // empezar (cooldownTicks se agota si mantenés apretado más de ~2-3s y el
  // resto de nodos se congela hasta que soltás). Reenganchar cada cierto
  // intervalo mientras el mouse sigue en movimiento mantiene la simulación
  // viva todo lo que dure el arrastre.
  const lastReheatAtRef = useRef(0)
  const REHEAT_INTERVAL_MS = 400

  const handleContainerMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (dragRef.current) return
      const node = findNodeAtPoint(e.clientX, e.clientY)
      setHoveredId(node ? node.id : null)
    },
    [findNodeAtPoint],
  )

  // onMouseDownCapture (no onMouseDown): react-force-graph-2d ata su propio
  // pan/zoom (d3-zoom) directamente al <canvas>, un descendiente de este div.
  // Un handler en fase de "bubble" corre DESPUÉS de que el canvas ya recibió
  // el evento y arrancó su propio pan — preventDefault() no lo frena porque
  // es un listener nativo distinto en otro elemento. stopPropagation() en
  // fase de CAPTURA (de afuera hacia adentro) sí lo frena, porque corre antes
  // de que el evento llegue al canvas. Sin esto, arrastrar un nodo también
  // paneaba toda la cámara al mismo tiempo (mismo delta del mouse aplicado
  // dos veces: al nodo y a la vista).
  const handleContainerMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!interactive) return
      const node = findNodeAtPoint(e.clientX, e.clientY)
      if (!node) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { node, startClientX: e.clientX, startClientY: e.clientY, moved: false }
    },
    [findNodeAtPoint, interactive],
  )

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      const fg = fgRef.current
      const el = containerRef.current
      if (!drag || !fg || !el) return
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_TOLERANCE_PX) return
        drag.moved = true
        // Reactiva la simulación para que los nodos conectados reaccionen al
        // arrastre (si no, quedan estáticos: "las físicas no funcionan").
        // No se toca `ready` acá: el hit-test propio (findNodeAtPoint) lee
        // las posiciones mutadas en vivo, no una copia vieja, así que no hay
        // riesgo de clickear "donde el nodo estaba" como en el asentamiento
        // inicial — bloquear la interacción acá solo generaba el cartel
        // "acomodando nodos" en cada arrastre, por mínimo que fuera.
        fg.d3ReheatSimulation()
        lastReheatAtRef.current = performance.now()
      } else {
        // Sin este re-reheat periódico, cooldownTicks se agota si el drag
        // dura más de unos segundos: el motor para por completo y el resto
        // de nodos queda congelado (no siguen al nodo arrastrado) hasta soltar.
        const now = performance.now()
        if (now - lastReheatAtRef.current > REHEAT_INTERVAL_MS) {
          fg.d3ReheatSimulation()
          lastReheatAtRef.current = now
        }
      }
      const rect = el.getBoundingClientRect()
      const { x, y } = fg.screen2GraphCoords(e.clientX - rect.left, e.clientY - rect.top)
      drag.node.x = x
      drag.node.y = y
      drag.node.fx = x
      drag.node.fy = y
      setHoveredId(drag.node.id)
    }

    const handleWindowMouseUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (!drag.moved) {
        onSelectNode(drag.node)
        return
      }
      // Soltar el nodo: fx/fy lo tenían fijo (d3-force ignora la física
      // mientras están seteados). Sin este reset, todo nodo arrastrado queda
      // pegado en su lugar para siempre y pierde movilidad.
      drag.node.fx = undefined
      drag.node.fy = undefined
      fgRef.current?.d3ReheatSimulation()
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [onSelectNode, setReady])

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
      <div
        ref={containerRef}
        className={interactive ? '' : 'pointer-events-none'}
        style={{ cursor: hoveredId ? 'pointer' : 'default' }}
        onMouseDownCapture={handleContainerMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={() => setHoveredId(null)}
      >
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          backgroundColor="#0b0d10"
          nodeId="id"
          nodeVal={(node) => node.size}
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
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
      </div>

      {!interactive && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-surface/80 px-2 py-1 font-mono text-[10px] text-gray-400">
          acomodando nodos…
        </div>
      )}

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
