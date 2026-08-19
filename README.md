# worldgen

Procedural world generator for game development. Generates provinces, settlements, trade routes, and terrain in seconds.

**Perfect for Godot, but outputs work with any engine.**

## Features

- 🗺️ **Terrain Generation** - Perlin noise heightmaps with customizable octaves
- 🏛️ **Province Generation** - Voronoi cells with Lloyd relaxation for natural regions
- 🏘️ **Settlement Placement** - Hierarchical capitals + satellite settlements per province
- 🛤️ **Route Generation** - MST trade routes with terrain-aware A* pathfinding
- 🎨 **Auto-coloring** - Unique color per province, deterministic and visually distinct
- 📦 **Multi-format Export** - PNG, GeoJSON, JSON, GLTF mesh

## Getting Started

### Prerequisites

- Node.js 18+
- Linux/macOS/Windows

### Installation

```bash
# Clone or download
cd worldgen

# Install dependencies
npm install

# Build
npm run build

# Try it (uses defaults)
npm run generate
```

### Basic Usage

```bash
# Generate with default config
npm run dev generate

# Custom config
npm run dev generate -c my-config.json -o ./my-world

# With CLI overrides
npm run dev generate --seed 12345 --width 2048 --settlements 30

# Show defaults
npm run dev config

# Validate a config
npm run dev validate examples/continent.config.json
```

### Config File

Create a `config.json`:

```json
{
  "seed": 42,
  "width": 2048,
  "height": 2048,
  "settlementCount": 25,
  "provinceCount": 20,
  "waterLevel": 0.4,
  "routeWeighting": "hybrid"
}
```

See `examples/*.config.json` for templates.

## Output Files

After generation, check the output directory:

- **heightmap.png** - Grayscale elevation map (0=water, 255=mountain)
- **provinces.png** - RGB color map, one unique color per province
- **routes.png** - Routes overlaid on terrain
- **routes.geojson** - Route paths + metadata in GeoJSON format
- **world.json** - Complete world data (settlements, provinces, routes)
- **world.gltf** - 3D mesh with heightmap + colors (import into Godot/Blender)

## For Godot

### Quick Start

1. Generate world:
   ```bash
   npm run generate -- -c godot-config.json -o ./world-export
   ```

2. In Godot, create a terrain script:
   ```gdscript
   extends Node3D
   
   # Import heightmap
   var terrain_mesh = MeshInstance3D.new()
   
   # Load world.json for settlement placement
   var world_data = JSON.parse_string(FileAccess.get_file_as_string("res://world/world.json"))
   
   # Place settlement nodes based on world_data.settlements
   for settlement in world_data.settlements:
       var marker = Node3D.new()
       marker.position = Vector3(settlement.x, get_height_at(settlement.x, settlement.z), settlement.z)
       add_child(marker)
   ```

See `examples/godot-integration.gd` for a complete example (coming soon).

## Architecture

```
src/
  generators/      → Heightmap, Provinces, Settlements, Routes
  exporters/       → PNG, GeoJSON, JSON, GLTF
  utils/           → Pathfinding, Geometry, Rasterization
  cli/             → Command-line interface
```

For deep dive, see `ARCHITECTURE.md`.

## Parameters Reference

See `CONFIG.md` for detailed parameter explanations and tuning tips.

## Performance

- Small world (1024x1024, 20 provinces): ~1s
- Medium world (2048x2048, 40 provinces): ~3s
- Large world (4096x4096, 100 provinces): ~8s

(On a modern CPU. Exact timing depends on route complexity.)

## Development

```bash
# Watch mode (rebuilds on file change)
npm run build -- --watch

# Run tests
npm test

# Build standalone binaries
npm run pkg:all
```

## Known Limitations

- Currently single-threaded (routes scale sublinearly)
- Heightmap doesn't use actual Voronoi-based terrain (placeholder)
- No island/archipelago mode yet
- Godot scene export not yet implemented

See `TODO.md` for roadmap.

## License

MIT - Use freely in commercial projects.

## Contributing

PRs welcome! Please open an issue first for major features.
