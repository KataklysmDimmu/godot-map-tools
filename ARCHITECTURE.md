# Architecture

## Overview

`godot-map-tools` follows a **pipeline architecture**: Config → Generate → Export. Each stage is independent and pure (no global state between them), which keeps the WebUI and CLI interchangeable front-ends over the same core.

```
godot-map-tools/
  src/
    index.ts           ← Entry point, orchestrates the 5 phases
    types.ts           ← Shared types
    config.ts          ← DEFAULT_CONFIG + loadConfig()/validateConfig() (not yet wired into CLI)

    generators/        ← Phase 1-5 actual algorithms
      heightmap.ts     ← Simplex-noise FBM → elevation
      provinces.ts     ← Jittered grid + Lloyd relaxation → regions
      settlements.ts   ← Capital-per-province + Poisson-disk satellites
      routes.ts        ← Kruskal MST + feeders, A* paths, RDP simplify
      colours.ts       ← Deterministic color assignment (British spelling)
      shader_water.glsl           ← Animated ocean (WebGL, used by UI)
      shader_water_godot.gdshader ← Godot 4 spatial variant (back-pocket, unwired)

    exporters/         ← Output formats
      png.ts           ← Rasterization to image (sharp)
      geojson.ts       ← Routes to GeoJSON
      json.ts          ← Lean world state
      gltf.ts          ← 3D mesh export

    utils/             ← Reusable algorithms
      math.ts          ← PRNG, FNV-1a hash, clamp, hsv<->rgb
      pathfinding.ts   ← A* (MinHeap) + RDP + path length
      geometry.ts      ← Distance, point-in-polygon, computeBorders()

    cli/               ← Command-line tool
      commands.ts      ← Commander.js integration
      formatters.ts    ← Banner + summary

    server/
      app.ts           ← Express WebUI backend (POST /api/generate)

  public/
    index.html         ← WebUI (vanilla + Three.js via CDN import map)
```

> **Filename note:** the color module is `colours.ts` (British spelling). It is the only module with that spelling — watch imports.

## Data Flow

```
WorldConfig (JSON)
    ↓
generateHeightmap()            → Heightmap { data: Float32Array, width, height, minElev, maxElev }
    ↓
generateProvinces()            → Province[] { id, color, centerX, centerY, area, cellIndices[], settlements[] }
    ↓
generateSettlements()          → Settlement[] { id, x, y, type, parentProvinceId, population, name }
    ↓
generateRoutes()               → Route[] { id, type, fromSettlement, toSettlement, path[], distance, terrain_difficulty }
    ↓
computeBorders()               → BorderEdge[] { from, to, provinceIds, points[] }
    ↓
World { config, heightmap, provinces, settlements, routes, borders }
    ↓
    ├→ exportHeightmapPNG()  → heightmap.png
    ├→ exportProvincesPNG()  → provinces.png
    ├→ exportRoutesPNG()     → routes.png
    ├→ exportRoutesGeoJSON() → routes.geojson
    ├→ exportWorldJSON()     → world.json
    └→ exportWorldGLTF()     → world.gltf
```

**Important ordering caveat:** `generateProvinces()` receives the `Heightmap` and **now uses it** — seeds are snapped onto land (`snapToLand` prefers coasts), Lloyd relaxation samples land cells only, and rasterization skips water entirely. As a result province borders follow coastlines and no province owns open water (`computeBorders` already treats unassigned `-1` water cells as no-border, so coastal province edges terminate at the shoreline). Settlements (via `preferLand`) and routes (via A* water penalty) are also terrain-aware. See *Known Deviations*.

## Key Components

### utils/math.ts

The deterministic backbone.

- `createPRNG(seed: number | string)` → `() => number` — **Mulberry32** PRNG. String seeds are hashed via **FNV-1a** (`hashString`) first. This is what makes a given seed reproduce the exact same world.
- `hsvToRgb(h, s, v)` / `rgbToHsv(r, g, b)` — color conversion.
- `clamp(v, min, max)`.

### generators/heightmap.ts

**Input:** `width`, `height`, `{ seed, octaves, persistence, lacunarity, scale }`
**Output:** `Heightmap`

Uses **simplex-noise** (`createNoise2D` from the `simplex-noise` package) driven by the PRNG. Fractal Brownian motion:

```
for each pixel (x, y):
  elevation = 0; amplitude = 1; frequency = scale; total = 0
  for o in 0..octaves:
    elevation += noise2D(x*frequency, y*frequency) * amplitude
    total     += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  data[y*w + x] = (elevation / total + 1) / 2   // normalize to 0..1
```

minElev / maxElev are tracked across the grid.

> The original prototype referenced the `perlin-noise` library; the shipped code uses `simplex-noise`. Heightmap generation is simplex/FBM, **not** a Voronoi-based terrain.

### generators/provinces.ts

**Input:** `WorldConfig`, `_heightmap` (ignored)
**Output:** `Province[]`

1. **Initial seeds** — a *jittered grid* (not Delaunay/Voronoi library): compute `cols × rows` cells from `provinceCount` and aspect ratio, jitter each seed inside its cell.
2. **Lloyd relaxation** — `lloydIterations = 3` passes: assign a coarse sample grid to the nearest seed, move each seed to the mean of its samples. (Note: `config.lloydIterations` is **not** read here — the count is hardcoded 3.)
3. **Rasterize** — for every pixel, find the nearest seed using a **spatial hash grid** (buckets of `gridCellSize ≈ √(w·h / count)`; 3×3 neighborhood search, full search fallback). Pixels are assigned to `province.cellIndices` and `area` is counted.
4. **Recenter** — each province's `centerX/centerY` is recomputed as the true centroid of its assigned pixels.
5. Color via `colorForProvince(id)` (`colours.ts`).

> Province placement is **independent of the heightmap**. There is no edge-falloff, landmass, or archipelago logic despite those params appearing in the WebUI — see *Known Deviations*.

### generators/settlements.ts

**Input:** `WorldConfig`, `Province[]`
**Output:** `Settlement[]`

1. **Capitals** — one per province, placed at the province centroid + small jittered offset (`jitterRadius = min(w,h)*0.02`).
2. **Satellites** — Bridson **Poisson-disk sampling** fills the remaining `targetCount − provinces` points with a minimum spacing derived from the canvas area. Each point is assigned to its nearest province.
3. **Classification** — ~30% chance of `major`, else `minor` (capitals are `capital`). Population is drawn from fixed bands (capital 5000–20000, major 1000–5000, minor 100–900).
4. **Naming** — `generateSettlementName()` concatenates a themed prefix + type-specific suffix (e.g. `Aethelgard`, `Ravenwick`).

Settlements are also pushed onto their parent province's `settlements[]` for downstream use.

### generators/routes.ts

**Input:** `WorldConfig`, `Settlement[]`, `Heightmap`
**Output:** `Route[]`

1. **Candidate edges** — all capital↔capital pairs (weight = Euclidean distance).
2. **Primary (trade) network** — **Kruskal MST** over the candidates (`kruskalMST`, union-find).
3. **Secondary (regional) edges** — each non-capital connects to its province's capital.
4. **Pathfinding** — `astar()` per edge (see `utils/pathfinding.ts`), constrained to land (water penalty) and penalizing slope.
5. **Simplify** — `ramerDouglasPeucker(path, 2.5)`.
6. **Difficulty** — `computeDifficulty()` sums per-step elevation deltas and scales into a 1.0–~N score.

Route types produced: `'trade'` (MST edges), `'regional'` (feeder edges). The `'local'` type exists in `types.ts` but is currently **never generated**.

### generators/colours.ts

**Input:** `provinceId: number`
**Output:** `{ r, g, b }`

Deterministic golden-ratio conjugate hue spread:

```
hue = (id * 0.618033988749895) % 1.0
sat = 0.70 + (id % 100) / 500     // 0.70–0.90
val = 0.65 + (id % 50)  / 250     // 0.65–0.85
return hsvToRgb(hue, sat, val)
```

Guarantees: every province visually distinct, deterministic, no pure black/white.

### exporters/png.ts

`sharp`-backed rasterization.

- `exportHeightmapPNG` — grayscale 0–255.
- `exportProvincesPNG` — RGB from `province.color`, written per `cellIndices`.
- `exportRoutesPNG` — dim grayscale terrain + route polylines (trade = gold/thick, regional = blue/thin via Bresenham `drawLine`) + settlement markers (`drawCircle`).

### exporters/geojson.ts

`routes → FeatureCollection` of `LineString` features with `id, fromSettlement, toSettlement, type, distance, terrain_difficulty` properties.

### exporters/json.ts

Lean `world.json`: `config`, `provinces` (id/color/center/area + settlement **ids** only — raw `cellIndices` are dropped to keep the file small), `settlements`, `routes`, `borders`.

### exporters/gltf.ts

Builds a `BufferGeometry` terrain mesh:

- Subdivided grid (`step = max(1, width/256)`), positions from heightmap × `heightScale = 120`, centered on origin (x,z), elevation on Y.
- `POSITION` + `TEXCOORD_0` buffers + triangle indices, embedded as a single base64 `data:` URI buffer (no external `.bin`).
- **No vertex colors and no water** — unlike the 3D WebUI view. Recolor/water in the target engine.

### utils/pathfinding.ts

- **`astar(start, goal, heightmap, waterLevel, stepSize)`** — A* over an 8-connected grid (step-aligned). Cost = distance × step × (1 + slope×15), plus a `+500` water penalty per water cell (keeps roads on land). Min-heap (`MinHeap<T>`) priority queue. Falls back to a straight `[start, goal]` line if unreachable.
- **`ramerDouglasPeucker(points, epsilon)`** — recursive polyline simplification.
- **`calculatePathDistance(points)`** — summed Euclidean length.

### utils/geometry.ts

- `distance(p1, p2)`, `pointInPolygon(p, poly)`.
- `computeBorders(provinces, width?, height?)` — scans a province-id grid (step 2), records adjacent differing province pairs, RDP-simplifies each shared boundary, and emits `BorderEdge[]`.

### server/app.ts

Express app. `POST /api/generate` builds a `WorldConfig` from the request body (see *Known Deviations* for which fields are honored), calls `generateWorld()`, and returns a JSON payload the WebUI consumes directly (heightmap `data` as an array, provinces/settlements/routes/borders). Serves `public/` statically.

## Control Flow

Entry: `src/cli/commands.ts` → `generate` action → `generateWorld(config)` (`src/index.ts`):

```
generateWorld(config):
  1. generateHeightmap(width, height, { seed, octaves, persistence, lacunarity, scale })
  2. generateProvinces(config, heightmap)        // land-aware: seeds snapped to coast, relaxation + rasterization over land only
  3. generateSettlements(config, provinces, heightmap)  // capitals/satellites snap to land via preferLand
  4. generateRoutes(config, settlements, heightmap)     // A* avoids water/slope
  5. computeBorders(provinces, width, height)
  → World { config, heightmap, provinces, settlements, routes, borders }

exporterOrchestrator(world, outputDir):
  → heightmap.png / provinces.png / routes.png
  → routes.geojson / world.json / world.gltf
```

The WebUI reuses the exact same `generateWorld()` via `server/app.ts`.

## Performance Notes

**Linear in:**
- Heightmap pixels (width × height)
- Province count (rasterization is O(pixels), seed search is spatial-hashed)
- Settlement count (Poisson-disk is near-linear in output points)

**Superlinear in:**
- Route complexity (A* scales with path length; MST is near-linear)
- Lloyd iterations (repeated nearest-seed passes)

**Parallelizable (future):**
- Per-route A* (each route independent)
- Per-format export (independent file writes)

Currently single-threaded. Real-world timings depend on resolution and route count; measure with `npm run generate` at your target size.

## Known Deviations (documentation vs. reality)

These are real gaps in the shipped code, recorded so the docs don't overclaim:

1. **Provinces are land-only but not slope-aware** — `generateProvinces()` now uses the `heightmap`: seeds are snapped onto land (coasts preferred, `snapToLand`), Lloyd relaxation samples land cells only, and rasterization skips water. Borders therefore follow coastlines and no province owns the sea. They still do not weight by elevation, so a tall mountain range can sit inside one province.
2. **`/api/generate` now honors the full param set** (fixed in v0.0.2) — reads all WebUI controls including `mapStyle`, `edgeFalloff`, `landmassCount`, `lloydIterations`, `satellitesPerCapital`, `capitalProminence`, `terrainDifficulty`, and `routeWeighting` (no longer hard-coded to `hybrid`).
3. **`'local'` route type** is declared in `types.ts` but never produced by `routes.ts`.
4. **`gltf.ts` has no colors/water** — differs from the 3D WebUI view.
5. **`config.ts` is orphaned** — `loadConfig()`/`validateConfig()` exist but `commands.ts` loads/validates config files inline and does not call them.
6. **Earlier doc references to `delaunay-fast`, `three`, `@types/three`, and the `expres` typo were removed** as dead dependencies; the WebUI loads Three.js from a CDN. The prototype's "Perlin" reference was wrong — the code uses `simplex-noise`.
