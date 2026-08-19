# Architecture

## Overview

worldgen follows a **pipeline architecture**: Config → Generate → Export. Each stage is independent.

```
worldgen/
  src/
    index.ts           ← Entry point, orchestrates 5 phases
    types.ts           ← Shared types
    config.ts          ← Configuration loading + validation
    
    generators/        ← Phase 1-5 actual algorithms
      heightmap.ts     ← Perlin noise → elevation
      provinces.ts     ← Voronoi + Lloyd relaxation → regions
      settlements.ts   ← Poisson disk + clustering → settlements
      routes.ts        ← MST + A* → trade routes
      colors.ts        ← Deterministic color assignment
    
    exporters/         ← Output formats
      png.ts           ← Rasterization to image
      geojson.ts       ← Routes to GeoJSON
      json.ts          ← Full world state
      gltf.ts          ← 3D mesh export
      godot.ts         ← Godot scene (future)
    
    utils/             ← Reusable algorithms
      pathfinding.ts   ← A* implementation
      geometry.ts      ← Voronoi, distance, intersection
      rasterization.ts ← Bresenham, flood fill
      math.ts          ← HSV→RGB, noise helpers
    
    cli/               ← Command-line tool
      commands.ts      ← Commander.js integration
      formatters.ts    ← Progress bars, output formatting
```

## Data Flow

```
Config (JSON)
    ↓
generateHeightmap()
    ↓ Float32Array elevation grid
generateProvinces()
    ↓ Voronoi cells + Lloyd smoothing
generateSettlements()
    ↓ Settlement objects + hierarchy
generateRoutes()
    ↓ Route paths + metadata
computeBorders()
    ↓ Border edges from Voronoi
    ↓
World object {config, heightmap, provinces, settlements, routes, borders}
    ↓
    ├→ exportPNG()      → heightmap.png, provinces.png, routes.png
    ├→ exportGeoJSON()  → routes.geojson
    ├→ exportJSON()     → world.json
    └→ exportGLTF()     → world.gltf
```

## Key Components

### generators/heightmap.ts

**Input:** WorldConfig
**Output:** Heightmap { data, width, height, minElev, maxElev }

Uses Perlin noise (via `perlin-noise` lib):
1. Create noise generator with seed
2. Sample octaves (6 by default)
3. Blend with persistence/lacunarity
4. Normalize to 0-1
5. Return Float32Array

```typescript
// Pseudocode
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let value = 0;
    for (let octave = 0; octave < octaves; octave++) {
      const freq = Math.pow(2, octave) * scale;
      const amp = Math.pow(persistence, octave);
      value += perlin(x * freq, y * freq) * amp;
    }
    heightmap[y * width + x] = value / totalAmplitude;
  }
}
```

### generators/provinces.ts

**Input:** WorldConfig, Heightmap
**Output:** Province[] with { id, cellIndices, color, settlements, area, centerX, centerY }

Uses Voronoi (via `delaunay-fast`):
1. Generate K random seed points (K = provinceCount)
2. Compute Delaunay triangulation
3. Extract Voronoi diagram
4. Lloyd relaxation: move seeds to cell centroids N times
5. Assign each pixel to nearest seed
6. Assign unique colors (see colors.ts)
7. Return provinces

```typescript
// Pseudocode
let seeds = poissonDiskSample(width, height, minDistance);
for (let iter = 0; iter < lloydIterations; iter++) {
  const voronoi = computeVoronoi(seeds);
  seeds = voronoi.cells.map(cell => cell.centroid);
}
const provinces = seeds.map((seed, id) => ({
  id,
  color: colorForProvince(id),
  ...voronoi.cells[id]
}));
```

### generators/settlements.ts

**Input:** WorldConfig, Province[]
**Output:** Settlement[]

Hierarchical placement:
1. Use Poisson disk sampling to place K capitals (K = ceil(settlementCount / (1 + satellitesPerCapital)))
2. Assign each capital to nearest province
3. For each capital, place N satellites in that province using Poisson disk
4. Classify by type (capital vs major vs minor)
5. Return flattened settlement list

```typescript
// Pseudocode
const capitals = poissonDiskSample(width, height, capitalDistance);
const settlements = [];

for (const capital of capitals) {
  settlements.push({
    x: capital.x, y: capital.y,
    type: 'capital',
    parentProvinceId: nearestProvince(capital),
    population: 1000
  });
  
  const satelliteArea = provinces[capital.provinceId].boundary;
  const satellites = poissonDiskSample(satelliteArea, satelliteDistance);
  
  for (const sat of satellites.slice(0, satellitesPerCapital)) {
    settlements.push({
      x: sat.x, y: sat.y,
      type: 'minor',
      parentProvinceId: capital.provinceId,
      population: 100
    });
  }
}
```

### generators/routes.ts

**Input:** WorldConfig, Settlement[], Heightmap
**Output:** Route[]

Two-phase routing:
1. **Build settlement graph** with edge weights (distance + terrain cost)
2. **MST (Prim's algorithm)** → primary trade routes
3. **Add secondary routes** → capitals to nearby minors
4. **A* pathfinding** for each route, constrained to terrain
5. **Route simplification** (Ramer-Douglas-Peucker)
6. Return flattened routes

```typescript
// Pseudocode - Phase 1: MST
const graph = buildWeightedGraph(settlements, heightmap, terrainDifficulty);
const mst = primsAlgorithm(graph);

// Phase 2: A* pathfinding per route
for (const edge of mst) {
  const path = astar(edge.from, edge.to, heightmap, terrainCost);
  const simplified = ramDouglasPeucker(path, epsilon);
  routes.push({
    fromSettlement: edge.from,
    toSettlement: edge.to,
    path: simplified,
    terrain_difficulty: computeAverageCost(simplified)
  });
}
```

### generators/colors.ts

**Input:** provinceId (number)
**Output:** { r, g, b }

Deterministic golden-ratio hue spread:

```typescript
function colorForProvince(id: number): RGB {
  const hue = (id * 0.618033988749) % 1.0;  // Golden ratio
  const sat = 0.7 + (id % 100) / 200;       // Slight variation per ID
  const val = 0.65 + (id % 50) / 150;
  return hsvToRgb(hue, sat, val);
}
```

Guarantees:
- Every province is visually distinct
- Deterministic (same ID → same color)
- No black/white (val clamped 0.65-0.8)

### exporters/png.ts

**Input:** World, format ('heightmap' | 'provinces' | 'routes')
**Output:** PNG file via `sharp`

Uses `sharp` for efficient rasterization:
```typescript
// Heightmap: grayscale
const pngData = sharp(Float32ToUint8(heightmap.data), ...)
  .png().toFile('heightmap.png');

// Provinces: RGB
const provincesRGB = new Uint8Array(width * height * 3);
for (let i = 0; i < width * height; i++) {
  const color = provinces[provinceMap[i]].color;
  provincesRGB[i*3] = color.r;
  provincesRGB[i*3+1] = color.g;
  provincesRGB[i*3+2] = color.b;
}
```

### exporters/geojson.ts

**Input:** Route[]
**Output:** GeoJSON FeatureCollection

```typescript
// Convert route path to GeoJSON
const features = routes.map(route => ({
  type: 'Feature',
  properties: {
    id: route.id,
    type: route.type,
    distance: route.distance,
    terrain_difficulty: route.terrain_difficulty
  },
  geometry: {
    type: 'LineString',
    coordinates: route.path.map(p => [p.x, p.y])
  }
}));
```

### exporters/gltf.ts

**Input:** World
**Output:** .gltf file

Uses three.js to build mesh:
1. Create BufferGeometry from heightmap vertices
2. Assign UV coordinates and colors per vertex
3. Create material with color texture
4. Export via GLTFExporter

## Utils

### pathfinding.ts
A* implementation for terrain-aware routing. Key methods:
- `astar(start, goal, heightmap, costFn)` → Path[]
- Uses heuristic: Euclidean distance

### geometry.ts
Reusable math:
- `distance(p1, p2)` → number
- `pointInPolygon(p, poly)` → boolean
- `lineIntersect(l1, l2)` → Point | null
- `voronoiEdges(diagram)` → Edge[] (for borders)

### rasterization.ts
- `bresenham(p1, p2)` → Point[] (line rasterization)
- `floodFill(x, y, image, value)` → void (region filling)
- `rasterizePolygon(poly, image)` → void

### math.ts
- `hsvToRgb(h, s, v)` → RGB
- `rgbToHsv(r, g, b)` → HSV
- `clamp(v, min, max)` → number

## Control Flow

Entry: `src/cli/commands.ts` calls `generate(config)`

```
generate(config):
  1. generateHeightmap(config)
     → heightmap: Float32Array
  
  2. generateProvinces(config, heightmap)
     → provinces: Province[]
  
  3. generateSettlements(config, provinces)
     → settlements: Settlement[]
  
  4. generateRoutes(config, settlements, heightmap)
     → routes: Route[]
  
  5. computeBorders(provinces)
     → borders: BorderEdge[]
  
  → return World { config, heightmap, provinces, settlements, routes, borders }
     ↓
  exporterOrchestrator(world, outputDir):
    → exportPNG(world, 'heightmap') → output/heightmap.png
    → exportPNG(world, 'provinces') → output/provinces.png
    → exportPNG(world, 'routes') → output/routes.png
    → exportGeoJSON(world.routes) → output/routes.geojson
    → exportJSON(world) → output/world.json
    → exportGLTF(world) → output/world.gltf
```

## Performance Notes

**Linear in:**
- Heightmap pixels (width × height)
- Voronoi cells (provinceCount)
- Settlement count

**Superlinear in:**
- Route complexity (A* scales with path length)
- Lloyd iterations (repeated Voronoi)

**Parallelizable:**
- Route generation (each route independently)
- Exporting formats (independent file writes)

Current: Single-threaded, ~3-8s for typical worlds.

With worker threads: Could halve route generation time.
