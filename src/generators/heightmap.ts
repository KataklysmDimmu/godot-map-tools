import { createNoise2D } from 'simplex-noise';
import { createPRNG } from '../utils/math';
import { Heightmap } from '../types';

export interface HeightmapOptions {
  seed?: number | string;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  scale?: number;
  // Map shaping (driven by the WebUI mapStyle / edgeFalloff / landmassCount)
  mapStyle?: 'continental' | 'archipelago';
  edgeFalloff?: number; // 0-1, how sharply land meets water at the edges
  landmassCount?: number; // number of continent/island clusters (1 = single landmass)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function generateHeightmap(
  width: number,
  height: number,
  options: HeightmapOptions = {}
): Heightmap {
  const {
    seed = 42,
    octaves = 6,
    persistence = 0.5,
    lacunarity = 2.0,
    scale = 0.003,
    mapStyle = 'continental',
    edgeFalloff = 0.4,
    landmassCount = 2,
  } = options;

  const prng = createPRNG(seed);
  const noise2D = createNoise2D(prng);
  const data = new Float32Array(width * height);

  // Pre-place landmass blob centres. Used by both styles: archipelago (islands)
  // and continental (split one landmass into N continents when landmassCount>1).
  const blobs: { cx: number; cy: number; r: number }[] = [];
  if (landmassCount > 0) {
    const count = Math.max(1, Math.round(landmassCount));
    for (let i = 0; i < count; i++) {
      blobs.push({
        cx: prng() * width,
        cy: prng() * height,
        r: Math.min(width, height) * (0.18 + prng() * 0.12),
      });
    }
  }

  const invDiag = 1 / Math.hypot(0.5, 0.5); // normalize centre->corner distance to ~1

  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let elevation = 0;
      let amplitude = 1.0;
      let frequency = scale;
      let totalAmplitude = 0;

      for (let o = 0; o < octaves; o++) {
        elevation += noise2D(x * frequency, y * frequency) * amplitude;
        totalAmplitude += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
      }

      const base = (elevation / totalAmplitude + 1) / 2; // 0..1 FBM

      let shaped = base;

      if (mapStyle === 'archipelago') {
        // Land only where an island blob mask or high noise permits; everything
        // else is open water. Multiplied by noise so coastlines are irregular.
        let mask: number;
        if (blobs.length === 0) {
          mask = smoothstep(0.55, 0.8, base); // scattered peaks become islands
        } else {
          let m = 0;
          for (const b of blobs) {
            const d = Math.hypot(x - b.cx, y - b.cy);
            const radial = 1 - smoothstep(b.r * 0.6, b.r, d);
            if (radial > m) m = radial;
          }
          mask = m * (0.6 + 0.4 * base);
        }
        shaped = mask * (0.35 + 0.65 * base);
      } else {
        // Continental: optional radial edge falloff pushes the margins underwater.
        if (edgeFalloff > 0) {
          const dx = x / width - 0.5;
          const dy = y / height - 0.5;
          const dist = Math.hypot(dx, dy) * invDiag * 2; // 0 centre, ~1 corner
          const fall = smoothstep(1 - edgeFalloff, 1.0, dist);
          shaped = base - fall * 1.2; // dip edges below water
        }
        // When more than one landmass is requested, carve the single continent
        // into N separate continents by masking out the gaps between blob centres.
        // landmassCount === 1 keeps the classic single-continent shape.
        if (landmassCount > 1 && blobs.length > 1) {
          let m = 0;
          for (const b of blobs) {
            const d = Math.hypot(x - b.cx, y - b.cy);
            const radial = 1 - smoothstep(b.r * 0.55, b.r, d);
            if (radial > m) m = radial;
          }
          shaped = shaped * m - (1 - m) * 0.8; // sink the gaps below water
        }
      }

      const clamped = Math.max(0, Math.min(1, shaped));
      data[y * width + x] = clamped;

      if (clamped < minElev) minElev = clamped;
      if (clamped > maxElev) maxElev = clamped;
    }
  }

  return {
    data,
    width,
    height,
    minElev,
    maxElev,
  };
}
