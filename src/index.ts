import { WorldConfig, Heightmap, Province, Settlement, Route, BorderEdge, World, River } from './types'
import { generateHeightmap } from './generators/heightmap';
import { generateProvinces } from './generators/provinces';
import { generateSettlements } from './generators/settlements';
import { generateRoutes } from './generators/routes';
import { generateRivers } from './generators/hydrology';
import { computeBorders } from './utils/geometry';

export async function generateWorld(config: WorldConfig): Promise<World> {
  // Phase 1: Heightmap
  const heightmap: Heightmap = generateHeightmap(config.width, config.height, {
    seed: config.seed,
    octaves: config.heightmapOctaves,
    persistence: config.heightmapPersistence,
    lacunarity: config.heightmapLacunarity,
    scale: config.scale,
    mapStyle: config.mapStyle,
    edgeFalloff: config.edgeFalloff,
    landmassCount: config.landmassCount,
    polarEffect: config.polarEffect,
    waterLevel: config.waterLevel,
  });

  // Phase 1b: Rivers (hydrology) — independent of provinces/settlements.
  const rivers: River[] = generateRivers(config, heightmap);

  // Phase 2: Provinces
  const provinces: Province[] = await generateProvinces(config, heightmap);

  // Phase 3: Settlements
  const settlements: Settlement[] = await generateSettlements(config, provinces, heightmap);

  // Phase 4: Routes
  const routes: Route[] = await generateRoutes(config, settlements, heightmap);

  // Phase 5: Borders (terrain-aware when enabled)
  const borders: BorderEdge[] = computeBorders(
    provinces,
    config.width,
    config.height,
    config.terrainAwareBorders ? heightmap : undefined,
    config.terrainDifficulty ?? 0.5,
    config.waterLevel ?? 0.4,
  );

  return {
    config,
    heightmap,
    provinces,
    settlements,
    routes,
    rivers,
    borders,
  };
}

export default generateWorld;