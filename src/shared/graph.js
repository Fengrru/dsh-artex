// Deterministic layered layout for the exploration graph. Kept free of React
// so the Host, the browser bundle and node --test all share one implementation.

export const GRAPH_LAYER = {
  begin: 0,
  goal: 1,
  intent: 2,
  hint: 3,
  fact: 3,
  digest: 3,
  finding: 4,
}

export function payloadOf(node) {
  if (!node?.payload) return {}
  if (typeof node.payload === 'object') return node.payload
  try {
    return JSON.parse(node.payload)
  } catch {
    return {}
  }
}

export function nodeLabel(node) {
  const payload = payloadOf(node)
  return String(
    payload.text || payload.name || payload.summary || payload.goal
      || payload.detail || payload.hint || node?.type || '',
  )
}

function idOrder(a, b) {
  const na = Number(a?.id)
  const nb = Number(b?.id)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

export function layoutGraph(nodes, edges, {
  width = 1000,
  height = 600,
  padding = 70,
} = {}) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.id !== undefined)
  const layers = new Map()
  for (const node of list) {
    const layer = GRAPH_LAYER[node.type] ?? 2
    if (!layers.has(layer)) layers.set(layer, [])
    layers.get(layer).push(node)
  }
  const layerIds = [...layers.keys()].sort((a, b) => a - b)
  const maxLayer = layerIds.length ? layerIds[layerIds.length - 1] : 0
  const minLayer = layerIds.length ? layerIds[0] : 0
  const span = Math.max(1, maxLayer - minLayer)
  const positioned = []
  const byId = new Map()

  for (const layer of layerIds) {
    const group = layers.get(layer).slice().sort(idOrder)
    const x = maxLayer === minLayer
      ? width / 2
      : padding + ((layer - minLayer) / span) * (width - padding * 2)
    group.forEach((node, index) => {
      const y = group.length === 1
        ? height / 2
        : padding + ((index + 0.5) / group.length) * (height - padding * 2)
      const item = { ...node, x, y, label: nodeLabel(node), layer }
      positioned.push(item)
      byId.set(String(node.id), item)
    })
  }

  const linkedEdges = (Array.isArray(edges) ? edges : [])
    .map((edge) => ({
      ...edge,
      from: byId.get(String(edge.src)),
      to: byId.get(String(edge.dst)),
    }))
    .filter((edge) => edge.from && edge.to)

  const byType = {}
  for (const node of positioned) byType[node.type || 'unknown'] = (byType[node.type || 'unknown'] || 0) + 1

  return { nodes: positioned, edges: linkedEdges, byType, width, height, byId }
}
