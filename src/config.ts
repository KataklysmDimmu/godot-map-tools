// src/config.ts - Configuration defaults and loader

import { WorldConfig } from './types.js';
import * as fs from 'fs/promises';
// import * as path from 'path';

export const DEFAULT_CONFIG: WorldConfig = {
  // World dimensions
  seed: 42,
  width: 2048,        // pixels
  height: 2048,       // pixels
  scale: 1,           // 1 pixel = 1 cell

  // Heightmap generation (Simplex-noise FBM)
  heightmapOctaves: 6,
  heightmapPersistence: 0.5,
  heightmapLacunarity: 2.0,
  waterLevel: 0.4,    // 40% of terrain is water

  // Settlements
  settlementCount: 25,
  satellitesPerCapital: 3,
  capitalProminence: 0.6,    // how spread out capitals are (0 = clustered, 1 = max spread)

  // Provinces (Voronoi-style jittered grid + Lloyd relaxation)
  provinceCount: 20,
  lloydIterations: 4,

  // Routes
  routeWeighting: 'hybrid',
  terrainDifficulty: 0.5,

  // Map shaping
  mapStyle: 'continental',
  edgeFalloff: 0.4,
  landmassCount: 2,
};

export async function loadConfig(configPath: string): Promise<WorldConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(content);
    
    // Merge with defaults (user config overrides)
    const merged = {
      ...DEFAULT_CONFIG,
      ...userConfig,
    };
    
    validateConfig(merged);
    return merged;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${err.message}`);
    }
    throw err;
  }
}

export function validateConfig(config: WorldConfig): void {
  const errors: string[] = [];
  
  if (config.width < 256 || config.width > 8192) {
    errors.push('width must be between 256 and 8192');
  }
  if (config.height < 256 || config.height > 8192) {
    errors.push('height must be between 256 and 8192');
  }
  if (config.settlementCount < 1 || config.settlementCount > 500) {
    errors.push('settlementCount must be between 1 and 500');
  }
  if (config.provinceCount < 2 || config.provinceCount > 200) {
    errors.push('provinceCount must be between 2 and 200');
  }
  if (config.waterLevel < 0 || config.waterLevel > 1) {
    errors.push('waterLevel must be between 0 and 1');
  }
  if (config.satellitesPerCapital < 0 || config.satellitesPerCapital > 10) {
    errors.push('satellitesPerCapital must be between 0 and 10');
  }
  
  if (errors.length > 0) {
    throw new Error('Invalid config:\n  ' + errors.join('\n  '));
  }
}