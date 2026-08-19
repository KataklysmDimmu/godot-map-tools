import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { World } from '../types';

export async function exportWorldJSON(world: World, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Exclude raw pixel cellIndices to keep world.json clean and lightweight
  const leanWorld = {
    config: world.config,
    provinces: world.provinces.map(({ id, color, centerX, centerY, area, settlements }) => ({
      id,
      color,
      centerX,
      centerY,
      area,
      settlements: settlements?.map((s) => s.id) || [],
    })),
    settlements: world.settlements,
    routes: world.routes,
    borders: world.borders,
  };

  await fs.writeFile(outputPath, JSON.stringify(leanWorld, null, 2), 'utf-8');
}