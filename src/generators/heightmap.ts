import { createNoise2D } from 'simplex-noise';
import { createPRNG } from '../utils/math';
import { Heightmap } from '../types';

export interface HeightmapOptions {
  seed?: number | string;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  scale?: number;
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
  } = options;

  const prng = createPRNG(seed);
  const noise2D = createNoise2D(prng);
  const data = new Float32Array(width * height);

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

      const normalized = (elevation / totalAmplitude + 1) / 2;
      data[y * width + x] = normalized;

      if (normalized < minElev) minElev = normalized;
      if (normalized > maxElev) maxElev = normalized;
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