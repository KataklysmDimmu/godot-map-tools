import { WorldConfig, Settlement, Heightmap, Route } from '../types';
import { astar, ramerDouglasPeucker, calculatePathDistance } from '../utils/pathfinding';

type RouteType = Route['type']; // 'trade' | 'regional' | 'local'

interface Edge {
  u: number;
  v: number;
  weight: number;
  type: RouteType;
}

export async function generateRoutes(
  config: WorldConfig,
  settlements: Settlement[],
  heightmap: Heightmap
): Promise<Route[]> {
  if (settlements.length < 2) return [];

  const waterLevel = config.waterLevel || 0.4;
  const terrainDifficulty = config.terrainDifficulty ?? 0.5;
  const routeWeighting = config.routeWeighting || 'hybrid';
  const routes: Route[] = [];

  const candidateEdges: Edge[] = [];
  const capitals = settlements.filter((s) => s.type === 'capital');
  const nonCapitals = settlements.filter((s) => s.type !== 'capital');

  for (let i = 0; i < capitals.length; i++) {
    for (let j = i + 1; j < capitals.length; j++) {
      const dist = Math.hypot(capitals[i].x - capitals[j].x, capitals[i].y - capitals[j].y);
      candidateEdges.push({
        u: capitals[i].id,
        v: capitals[j].id,
        weight: dist,
        type: 'trade' as RouteType,
      });
    }
  }

  const primaryEdges = kruskalMST(candidateEdges, settlements.length);

  const secondaryEdges: Edge[] = [];
  for (const town of nonCapitals) {
    const capital = capitals.find((c) => c.parentProvinceId === town.parentProvinceId) || capitals[0];
    const dist = Math.hypot(town.x - capital.x, town.y - capital.y);
    secondaryEdges.push({
      u: town.id,
      v: capital.id,
      weight: dist,
      type: 'regional' as RouteType,
    });
  }

  const allEdges = [...primaryEdges, ...secondaryEdges];
  const settlementMap = new Map<number, Settlement>(settlements.map((s) => [s.id, s]));

  let nextId = 0;

  for (const edge of allEdges) {
    const from = settlementMap.get(edge.u)!;
    const to = settlementMap.get(edge.v)!;

    const rawPath = astar(
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
      heightmap,
      waterLevel,
      2,
      routeWeighting,
      terrainDifficulty
    );

    // Skip cross-water routes that have no land path (disconnected islands).
    if (!rawPath || rawPath.length < 2) continue;

    const simplified = ramerDouglasPeucker(rawPath, 2.5);
    const distance = calculatePathDistance(simplified);

    routes.push({
      id: nextId++,
      fromSettlement: edge.u,
      toSettlement: edge.v,
      type: edge.type,
      distance,
      terrain_difficulty: computeDifficulty(simplified, heightmap),
      path: simplified,
    } as Route);
  }

  return routes;
}

function kruskalMST(edges: Edge[], numVertices: number): Edge[] {
  edges.sort((a, b) => a.weight - b.weight);

  const parent = Array.from({ length: numVertices + 1 }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] === i) return i;
    return (parent[i] = find(parent[i]));
  }

  function union(i: number, j: number): boolean {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
      return true;
    }
    return false;
  }

  const mst: Edge[] = [];
  for (const edge of edges) {
    if (union(edge.u, edge.v)) {
      mst.push(edge);
    }
  }

  return mst;
}

function computeDifficulty(path: { x: number; y: number }[], heightmap: Heightmap): number {
  if (path.length <= 1) return 1.0;
  let slopeSum = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const h1 = heightmap.data[p1.y * heightmap.width + p1.x] || 0;
    const h2 = heightmap.data[p2.y * heightmap.width + p2.x] || 0;
    slopeSum += Math.abs(h2 - h1);
  }

  return Math.round((1.0 + (slopeSum / path.length) * 10) * 100) / 100;
}