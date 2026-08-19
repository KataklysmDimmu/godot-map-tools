import { WorldConfig, Heightmap, Province, Settlement, Route, BorderEdge, World } from './types';
import { generateHeightmap } from './generators/heightmap';
import { generateProvinces } from './generators/provinces';
import { generateSettlements } from './generators/settlements';
import { generateRoutes } from './generators/routes';
import { computeBorders } from './utils/geometry';

export async function generateWorld(config: WorldConfig): Promise<World> {
  // Phase 1: Heightmap
  const heightmap: Heightmap = generateHeightmap(config.width, config.height, {
    seed: config.seed,
  });

  // Phase 2: Provinces
  const provinces: Province[] = await generateProvinces(config, heightmap);

  // Phase 3: Settlements
  const settlements: Settlement[] = await generateSettlements(config, provinces);

  // Phase 4: Routes
  const routes: Route[] = await generateRoutes(config, settlements, heightmap);

  // Phase 5: Borders
  const borders: BorderEdge[] = computeBorders(provinces, config.width, config.height);

  return {
    config,
    heightmap,
    provinces,
    settlements,
    routes,
    borders,
  };
}

export default generateWorld;