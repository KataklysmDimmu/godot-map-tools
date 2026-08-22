# godot-map-tools

Procedural world generator for game development. Generates provinces, settlements, trade routes, and terrain heightmaps. **Engine-agnostic exports** (PNG / GeoJSON / JSON / glTF) that drop straight into Godot, Blender, or any engine.

> The name says "Godot", but the output is plain data — use it with whatever you build in.

## Features

- 🗺️ **Terrain generation** — Simplex-noise fractal heightmap (FBM), seeded and deterministic
- 🏛️ **Province generation** — Jittered-grid seed points + Lloyd relaxation (Voronoi-style regions)
- 🏘️ **Settlement placement** — One capital per province + Poisson-disk-sampled satellites, named procedurally
- 🛤️ **Route generation** — Kruskal MST (trade network) + capital feeder routes, A* pathfinding with water/slope cost
- 🎨 **Auto-coloring** — Golden-ratio hue spread, one distinct, deterministic color per province
- 🌊 **Animated ocean** — Water shader (WebGL for the UI, plus a Godot 4 `spatial` back-pocket variant)
- 📦 **Multi-format export** — PNG (heightmap / provinces / routes), GeoJSON, JSON, glTF mesh
- 🖥️ **WebUI** — Live 2D/3D preview with presets (Island, Continent, Archipelago, Bannerlord)

## Getting Started

### Prerequisites

- Node.js 18+
- Linux / macOS / Windows

### Install & Build

```bash
# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build
```

### CLI Usage

```bash
# Generate with defaults
npm run generate

# Or use the dev runner (no build step needed)
npm run dev generate

# Custom config file + output directory
npm run dev generate -c examples-continent.config.json -o ./output

# CLI overrides
npm run dev generate --seed 12345 --width 2048 --height 2048 --provinces 40 --settlements 60

# Print the default configuration
npm run dev config

# Validate a config file (JSON syntax + schema validation)
npm run dev validate examples-basic.config.json

# Launch the interactive WebUI (http://localhost:3000)
npm run ui
```

**Commands:** `generate`, `config`, `validate <path>`, `serve` (`-p/--port`, default 3000).

**`generate` options:** `-c/--config`, `-o/--output` (default `./output`), `-s/--seed`, `-w/--width`, `-h/--height`, `-p/--provinces`, `--settlements`.

### Config File

The default config (from `src/config.ts`) is:

```json
{
  "seed": 42,
  "width": 2048,
  "height": 2048,
  "scale": 0.002,
  "heightmapOctaves": 6,
  "heightmapPersistence": 0.5,
  "heightmapLacunarity": 2.0,
  "provinceCount": 20,
  "settlementCount": 25,
  "waterLevel": 0.4,
  "routeWeighting": "hybrid",
  "terrainDifficulty": 0.5,
  "mapStyle": "continental",
  "edgeFalloff": 0.4,
  "landmassCount": 2,
  "polarEffect": 0.5
}
```

See `examples-basic.config.json` and `examples-continent.config.json` for ready-made templates.

> **Config fields are all consumed.** `types.ts` defines `satellitesPerCapital`, `capitalProminence`, `lloydIterations`, `terrainDifficulty`, `mapStyle`, `edgeFalloff`, `landmassCount`, and `routeWeighting` — and the server's `POST /api/generate` reads every one (no hard-coded values). `satellitesPerCapital` is the authoritative control for how many satellite settlements surround each provincial capital; `landmassCount` shapes both `archipelago` (island clusters) and `continental` (N separate continents). `scale` is a **relative** noise frequency interpreted against a 1000px reference — land area is **resolution-independent**, so widening the map grows the continents (more total land) rather than shrinking them; `~0.003` gives broad coherent continents.

## Output Files

After a `generate` run, the output directory contains:

| File | Description |
|------|-------------|
| `heightmap.png` | Grayscale elevation map (0=water, 255=peak) |
| `provinces.png` | RGB color map, one unique color per province |
| `routes.png` | Terrain + route overlay + settlement markers |
| `routes.geojson` | Route paths + metadata as GeoJSON `LineString` features |
| `world.json` | Lean world data (provinces, settlements, routes, borders) |
| `world.gltf` | 3D terrain mesh (heightmap-driven, UV-mapped, base64-embedded) |

## WebUI

```bash
npm run ui          # starts the Express server on :3000
```

Open `http://localhost:3000`. The 2D view renders the heightmap/province/route/settlement layers; the 3D view (Three.js, loaded via CDN import map) builds an orbitable terrain mesh with an animated water plane and route/settlement markers. Presets and PNG/JSON export are built in.

## For Godot

The intended pipeline is:

1. Generate exports (`world.gltf` + `world.json`).
2. Import `world.gltf` into Godot as a `Mesh`/scene (it carries geometry + UVs; recolor in Godot if desired).
3. Read `world.json` at runtime to place settlement markers / drive gameplay.

Minimal Godot-side loader sketch (illustrative — adapt to your scene tree):

```gdscript
# Place at runtime from world.json (user:// after copying into res://)
extends Node3D

@export var world_json_path := "res://world/world.json"
@export var height_scale := 120.0

func _ready() -> void:
	var json := JSON.parse_string(FileAccess.get_file_as_string(world_json_path))
	if typeof(json) != TYPE_DICTIONARY:
		push_error("Failed to parse world.json")
		return
	for settlement in json["settlements"]:
		var marker := MeshInstance3D.new()
		marker.mesh = SphereMesh.new()
		# x/y are image-space; center the map around origin to match the glTF export
		marker.position = Vector3(
			settlement["x"] - json["config"]["width"] * 0.5,
			get_height_at(settlement["x"], settlement["y"]) * height_scale,
			settlement["y"] - json["config"]["height"] * 0.5
		)
		add_child(marker)

# You must provide a height sampler (e.g. sample the imported heightmap Image/Texture).
func get_height_at(x: int, y: int) -> float:
	return 0.0
```

> A polished, ready-to-paste Godot integration script is **not** included yet — see *Known Limitations*.

## Architecture

```
src/
  index.ts            ← generateWorld(): orchestrates the 5-phase pipeline
  types.ts            ← Shared interfaces (WorldConfig, World, Province, Route, …)
  config.ts           ← DEFAULT_CONFIG + loadConfig()/validateConfig() (wired into CLI)

  cli/
    commands.ts       ← Commander.js CLI (generate/config/validate/serve)
    formatters.ts     ← Banner + run summary

  generators/
    heightmap.ts      ← Simplex-noise FBM → Float32Array elevation
    provinces.ts      ← Jittered grid + Lloyd relaxation → region map
    settlements.ts    ← Capital-per-province + Poisson-disk satellites
    routes.ts         ← Kruskal MST + feeders, A* paths, RDP simplify
    colours.ts        ← Deterministic golden-ratio province colors
    shader_water.glsl ← Animated water (WebGL, used by the UI)
    shader_water_godot.gdshader ← Godot 4 spatial variant (back-pocket, unwired)

  exporters/
    png.ts            ← Heightmap / provinces / routes PNG (sharp)
    geojson.ts        ← Routes → GeoJSON
    json.ts           ← Lean world state
    gltf.ts           ← Terrain mesh → glTF

  utils/
    math.ts           ← PRNG (Mulberry32 + FNV-1a), clamp, hsv<->rgb
    pathfinding.ts    ← A* (MinHeap) + Ramer–Douglas–Peucker + path length
    geometry.ts       ← computeBorders()

  server/
    app.ts            ← Express WebUI backend (POST /api/generate)

public/
  index.html          ← WebUI (vanilla + Three.js via CDN import map)
```

For a deep dive into each stage, see `ARCHITECTURE.md`.

## Performance

Single-threaded. Complexity is linear in heightmap pixels, province count, and settlement count; route generation scales with A* path length. The code is structured so route generation and per-format export could be parallelized later. Concrete timings depend on resolution and route complexity — benchmark on your target hardware with `npm run generate` at your chosen size.

## Known Limitations

- **Provinces are land-only but not slope-aware** — province seeds are snapped to land (coasts preferred) and Lloyd relaxation + rasterization run over land only, so borders follow coastlines and never claim open water. They still do not weight by elevation (mountains can split a province), only by land/water.
- **`edgeFalloff` only applies to continental maps** — the archipelago map style ignores `edgeFalloff`; only the continental branch in `heightmap.ts` uses it for radial drowning.
- **glTF has no vertex colors or water** — unlike the 3D WebUI view, `world.gltf` is a bare UV-mapped heightmesh; recolor/water in your target engine.
- **`'local'` route type declared but unused** — only `'trade'` and `'regional'` routes are produced.
- **`computeBorders` assumes a square map when dimensions are omitted** — if called without `width`/`height` it infers a square side from the max cell index; always pass dims (the pipeline does) to avoid distorted borders on non-square maps.
- **Non-square maps distort landmass shape** — the heightmap field is isotropic (circles stay circular) but at small resolutions (≤512px) only 1–2 noise features form, so continents look elongated on non-square maps. Use a **square** width=height (the WebUI default is now 512×512) for rounder continents; the polar caps also add horizontal bands that exaggerate a tall look. This is cosmetic, not a correctness bug.
- **Tests** — `npm test` runs 40 tests covering math utilities, config loading/validation, heightmap generation, province generation, settlement placement, polar effect, and the full `generateWorld` pipeline.

## Changelog

### v0.0.7
- **Rivers (dendritic hydrology)**: `generateRivers` now builds a true drainage network from the flow field — every cell draining enough upstream area becomes river; tributaries merge naturally and connected components become individual rivers with **width that tapers from headwater to mouth** (derived from flow accumulation, so main stems are wide and headwaters thin). Paths are Chaikin-smoothed for natural meander. River count scales with land area × `riverDensity`.
- **Terrain-aware borders (watershed divides)**: `computeBorders` snaps each province border to follow the **watershed divide** (flow-divergence field) within a corridor, so borders run along ridgelines instead of cutting through valleys. Verified: mean ridge-strength under borders rose ~80× (0.004 → 0.325). Strength scales with `terrainDifficulty`.
- **Ridged mountain terrain**: heightmap now blends a **ridged-FBM** term (weighted by elevation) so highlands become craggy alpine ranges with real relief, giving borders ridges to follow and rivers headwaters to spring from.
- **New controls**: `River Density` slider + `Rivers` layer toggle (WebUI), `Terrain-aware borders` checkbox; rivers rendered with variable width in 2D WebUI and PNG export; `WorldConfig.riverDensity` / `terrainAwareBorders` added; `River.widths` added.

### v0.0.6
- **Land now scales with map size (resolution-independent terrain)** — the core Azgaar lesson. Previously `scale` was an absolute pixel frequency, so widening the map kept continent *size* fixed in pixels and land fraction collapsed (62% at 512px → 3% at 4096px). Now `scale` is interpreted relative to a 1000px reference and the FBM uses **per-axis** frequencies (`scale*1000/width`, `scale*1000/height`); landmass peaks use normalized [0,1] coords with a per-axis falloff. A wider/taller map now grows wider/taller continents and **more total land**. Verified: 512px→171k land px, 4096px→294k land px (was shrinking); square maps hold a constant 68% land fraction across 512²–4096².
- **`fbm` now takes per-axis scales** (`scaleX`, `scaleY`) to support anisotropic, resolution-independent terrain.

### v0.0.5
- **Water Level slider now shapes landmass size (HIGH)** — the heightmap refactor had dropped `waterLevel` from `generateHeightmap`, so lowering it only recolored coastlines downstream instead of growing continents. `waterLevel` is now wired back into `generateHeightmap` as a vertical shift on the blended field, anchored at the default `0.4` (no visual regression). Lower values widen continental shelves and merge landmasses; higher values drown more land. Verified monotonic: 0.2→24% land … 0.6→3% land at 256².
- **Default `scale` fixed (MEDIUM)** — `DEFAULT_CONFIG` and both example configs used `scale: 1`, which produced fragmented per-pixel white-noise terrain under the new noise field. Default is now `0.002` (≈ the WebUI's `0.003`), giving coherent continents via `npm run generate`.
- **`/api/generate` payload compacted (MEDIUM)** — the heightmap was sent as a verbose JSON number array (~130 MB at 4096²). It is now a base64-encoded Float32 buffer (`encoding: "base64-f32"`, ~3.4× smaller) with a >4096px downsample cap so the browser tab no longer OOMs. The WebUI decodes it back to a `Float32Array`.
- **Cross-water route fallback removed (MEDIUM)** — `astar` previously returned a straight `[start, goal]` line when no land path existed (disconnected islands), silently drawing roads across the ocean. It now returns `null`; `routes.ts` drops such routes. Verified: an archipelago run produced 0 route points over water.
- **`config.ts`/`DEFAULT_CONFIG` notes** — `scale` guidance added to the config doc; examples updated.

### v0.0.4
- **Heightmap refactor** — `heightmap.ts` rewritten to use domain-warped FBM noise instead of artificial radial blobs. Land/water is now determined entirely by noise with seeded elevation peaks for natural, organic coastlines.
- **`landmassCount` now seeds elevation peaks** — distributed across the map via grid+jitter instead of random clustering.
- **New CLI option** — `--landmassCount` flag added.
- **Heightmap tests** — added `polar.test.ts` with 3 tests.
- **`exportPolarMaskPNG` removed** — was unused dead code.

### v0.0.3
- **CLI now honors all 18 config fields.** `commands.ts` imports `DEFAULT_CONFIG` from `config.ts` (previously it defined its own incomplete config missing `satellitesPerCapital`, `capitalProminence`, `lloydIterations`, `terrainDifficulty`, `mapStyle`, `edgeFalloff`, `landmassCount`).
- **`config.ts` wired into the CLI** — `generate` now uses `loadConfig()` for file-based config and `validateConfig()` runs on the final merged config. The `validate` command now does full schema validation, not just JSON syntax checking.
- **CLI version fixed** — `--version` now prints the correct `0.0.2` (was `0.1.0`).
- **BorderEdge type fixed** — `types.ts` now includes `id: number` and optional `points` array, matching the runtime output and removing the `as unknown as BorderEdge` cast in `geometry.ts`.
- **Tests added** — `npm test` runs 33 tests across math utilities, config, heightmap, provinces, and the full `generateWorld` pipeline.

### v0.0.2
- **Backend now honors the full WebUI parameter set.** `POST /api/generate` reads every control the WebUI sends: `width`, `height`, `octaves`, `persistence`, `lacunarity`, `provinces`, `settlements`, `waterLevel`, `scale`, `lloydIterations`, `satellitesPerCapital`, `capitalProminence`, `terrainDifficulty`, `routeWeighting`, `mapStyle`, `edgeFalloff`, `landmassCount`. (Previously it read 4 fields and hard-coded `routeWeighting: 'hybrid'`.)
- **Terrain-aware settlement placement** — capitals and satellites now snap to the nearest land/coastal cell (`preferLand` in `settlements.ts`); they will not spawn on open water, and fall back to the map's highest ground when a region is mostly sea.
- **Map shaping** — `heightmap.ts` supports `mapStyle: 'continental'` (with `edgeFalloff` radial drowning) and `mapStyle: 'archipelago'` (blob-masked island clusters via `landmassCount`).
- **Polar ice caps** — `polarEffect` (0–1) raises elevation toward the north and south edges of the map, creating snowy polar regions. Higher values produce wider, more pronounced ice caps.
- **Visual overhaul** — Biome-based elevation coloring (beach sand, grasslands, forest, highland rock, snow) across 2D canvas, 3D view, and PNG exports. 3D view upgraded with ACES filmic tone mapping, sky gradient shader, multi-light setup (key/fill/rim), exponential fog, and PCF soft shadows.
- **Route-weighting modes** — `astar` now accepts `routeWeighting` (`distance` | `hybrid` | `terrain-aware`) and `terrainDifficulty`; `distance` ignores terrain/water entirely, while `terrain-aware` more strongly avoids slopes and water. Routes no longer cross water.
- **Lloyd iterations** are now driven by `config.lloydIterations` instead of a hard-coded `3`.
- **capitalProminence consumed** — `settlements.ts` now offsets each province's capital from its centroid (0 = clustered, 1 = spread toward edges).
- **settlementCount acts as a target floor** — after placing capitals + satellites, extra minor settlements fill up to `settlementCount` if the computed total is lower.
- **Dead code removed** — `pointInPolygon` and `distance` (unused in `geometry.ts`) removed.

## Repository Status (cleanup performed)

This repo was tidied on the last pass:

- Removed a **nested duplicate repository** (`godot-map-tools/` containing a second `.git`) that duplicated the root with two stale files. The duplicate was moved outside the repo to `_dup_trash/`, not deleted, so nothing is unrecoverable.
- **Resolved a merge conflict** left in `public/index.html` (literal `<<<<<<<`/`=======`/`>>>>>>>` markers); the advanced WebUI version (2D + 3D) was kept.
- Added a **`.gitignore`** so `node_modules/`, `dist/`, `build/`, and `output/` are no longer untracked stragglers.
- **Pruned dead dependencies** from `package.json`: `expres` (typo, never imported), `delaunay-fast` (unused), and `three`/`@types/three` (the UI loads Three.js from a CDN, not this package).

After any cleanup, run `npm install` to refresh `node_modules` and `package-lock.json` to match the trimmed dependency set.

## License

MIT — use freely in commercial projects.

## Contributing

PRs welcome. Open an issue first for major features.
