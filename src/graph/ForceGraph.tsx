import { useCallback, useMemo, useRef, useState, type ComponentType, type Ref } from 'react'
import ForceGraph2DImpl from 'react-force-graph-2d'
import type { GraphEdge, GraphNode, PortfolioGraph } from '@/lib/types'

interface FGMethods {
  zoomToFit(durationMs?: number, padding?: number): void
}

type FGNodeRendered = GraphNode & { x?: number; y?: number }
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
}

const ForceGraph2D = ForceGraph2DImpl as unknown as ComponentType<TypedForceGraphProps>

interface Props {
  graph: PortfolioGraph
  onSelectNode: (node: GraphNode) => void
}

export function ForceGraph({ graph, onSelectNode }: Props) {
  const fgRef = useRef<FGMethods | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const neighborIds = useMemo(() => {
    if (!hoveredId) return null
    const ids = new Set<string>([hoveredId])
    for (const edge of graph.edges) {
      if (edge.source === hoveredId) ids.add(edge.target)
      if (edge.target === hoveredId) ids.add(edge.source)
    }
    return ids
  }, [hoveredId, graph.edges])

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
      if (node.dashedBorder) {
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = '#9ca3af'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (globalScale > 1.5) {
        ctx.font = `${12 / globalScale}px "Space Grotesk", system-ui, sans-serif`
        ctx.fillStyle = '#e5e7eb'
        ctx.textAlign = 'center'
        ctx.fillText(node.repo.name, x, y + radius + 10 / globalScale)
      }
      ctx.globalAlpha = 1
    },
    [neighborIds],
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

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={{ nodes: graph.nodes, links: graph.edges }}
      backgroundColor="#0b0d10"
      nodeId="id"
      nodeVal={(node) => node.size}
      nodeCanvasObject={nodeCanvasObject}
      linkWidth={(link) => 1 + link.weight * 3}
      linkColor={linkColor}
      onNodeHover={(node) => setHoveredId(node ? node.id : null)}
      onNodeClick={(node) => onSelectNode(node)}
      cooldownTicks={100}
    />
  )
}
