// src/types.ts - Core type definitions

export interface WorldConfig {
  seed: number;
  width: number;
  height: number;
  scale: number; // pixels per cell
  heightmapOctaves: number;
  heightmapPersistence: number;
  heightmapLacunarity: number;
  waterLevel: number; // 0-1, elevation threshold for water
  
  settlementCount: number;
  satellitesPerCapital: number; // 3-4 typical
  capitalProminence: number; // 0-1, how spread out capitals are
  
  provinceCount: number; // number of Voronoi cells
  lloydIterations: number; // smoothing iterations
  
  routeWeighting: 'distance' | 'terrain-aware' | 'hybrid';
  terrainDifficulty: number; // how much terrain affects routes (0-1)
}

export interface Heightmap {
  data: Float32Array;
  width: number;
  height: number;
  minElev: number;
  maxElev: number;
}

export interface Province {
  id: number;
  cellIndices: number[]; // Voronoi cell indices
  color: {r: number; g: number; b: number};
  settlements: Settlement[];
  area: number;
  centerX: number;
  centerY: number;
}

export interface Settlement {
  id: number;
  x: number;
  y: number;
  type: 'capital' | 'major' | 'minor';
  parentProvinceId: number;
  population: number; // relative to type
  name?: string;
}

export interface Route {
  id: number;
  type: 'trade' | 'regional' | 'local';
  fromSettlement: number;
  toSettlement: number;
  path: Array<{x: number; y: number}>; // simplified path
  distance: number;
  terrain_difficulty: number;
}

export interface World {
  config: WorldConfig;
  heightmap: Heightmap;
  provinces: Province[];
  settlements: Settlement[];
  routes: Route[];
  borders: BorderEdge[];
}

export interface BorderEdge {
  from: {x: number; y: number};
  to: {x: number; y: number};
  provinceIds: [number, number];
}

// Export formats
export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: {
    type: string;
    coordinates: any[];
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// Rasterization targets
export interface RasterMap {
  data: Uint8Array | Uint32Array;
  width: number;
  height: number;
  channels: number; // 1 for grayscale, 3 for RGB, 4 for RGBA
}