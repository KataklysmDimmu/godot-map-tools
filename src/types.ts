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

  mapStyle: 'continental' | 'archipelago';
  edgeFalloff: number; // 0-1, how sharply land meets water at the map edges
  landmassCount: number; // number of continents/island clusters (1 = single landmass)
  polarEffect: number; // 0-1, strength of polar ice caps (0 = none, 1 = strong)
  riverDensity: number; // 0-1, how many rivers to carve (scales with land area)
  terrainAwareBorders: boolean; // route province borders along ridge/watershed lines
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

export interface River {
  id: number;
  // Ordered source → mouth (source = headwater, the lowest-accumulation cell;
  // mouth = where it reaches water or the map edge).
  path: Array<{x: number; y: number}>;
  sourceX: number;
  sourceY: number;
  mouthX: number;
  mouthY: number;
  length: number; // in pixels
  order: number;  // Strahler-ish stream order (1 = smallest tributary)
  // Width per path point (px), derived from flow accumulation so the river is
  // thin at its headwaters and widens toward the mouth (jumping where
  // tributaries join). Parallel to `path`.
  widths?: number[];
}

export interface World {
  config: WorldConfig;
  heightmap: Heightmap;
  provinces: Province[];
  settlements: Settlement[];
  routes: Route[];
  rivers: River[];
  borders: BorderEdge[];
}

export interface BorderEdge {
  id: number;
  from: {x: number; y: number};
  to: {x: number; y: number};
  provinceIds: [number, number];
  points?: {x: number; y: number}[];
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