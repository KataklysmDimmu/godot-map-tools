import { createNoise2D } from 'simplex-noise';
import { createPRNG } from '../utils/math';
import { Heightmap } from '../types';

export interface HeightmapOptions {
  seed?: number | string;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  scale?: number;
  mapStyle?: 'continental' | 'archipelago';
  edgeFalloff?: number; // 0-1, how sharply land meets water at the edges
  landmassCount?: number; // number of continent/island clusters (1 = single landmass)
  polarEffect?: number; // 0-1, strength of polar ice caps (0 = none, 1 = strong)
  waterLevel?: number; // 0-1, elevation threshold for water (shifts land/water split)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function fbm(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  scaleX: number,
  scaleY: number,
): number {
  let elevation = 0;
  let amplitude = 1;
  let frequencyX = scaleX;
  let frequencyY = scaleY;
  let totalAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    elevation += noise2D(x * frequencyX, y * frequencyY) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= persistence;
    frequencyX *= lacunarity;
    frequencyY *= lacunarity;
  }

  return (elevation / totalAmplitude + 1) / 2; // 0..1
}

/**
 * Ridged FBM: 1 - |fbm|. Produces sharp mountain *ridges* instead of smooth
 * bumps — the key ingredient for terrain that has visible alpine spines for
 * borders to follow and rivers to spring from. Higher octaves of ridging give
 * fractal, craggy ranges.
 */
function ridgedFbm(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  scaleX: number,
  scaleY: number,
): number {
  let elevation = 0;
  let amplitude = 1;
  let frequencyX = scaleX;
  let frequencyY = scaleY;
  let totalAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    const n = noise2D(x * frequencyX, y * frequencyY);
    const r = 1 - Math.abs(n); // fold: ridges at n≈0
    elevation += r * r * amplitude; // square → sharper crests
    totalAmplitude += amplitude;
    amplitude *= persistence;
    frequencyX *= lacunarity;
    frequencyY *= lacunarity;
  }

  return elevation / totalAmplitude; // 0..1, biased toward ridges
}

/**
 * Generates a heightmap using domain-warped fractal Brownian motion (FBM)
 * with seeded elevation peaks for natural landmasses.
 *
 * Land/water is determined entirely by noise — no artificial blob masks.
 * `landmassCount` seeds N elevated regions that become continents/islands.
 * Coastlines are organic and fractal due to domain warping.
 */
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
    polarEffect = 0.5,
    waterLevel = 0.4,
  } = options;

  const prng = createPRNG(seed);
  const noise2D = createNoise2D(prng);
  // Separate noise for domain warping (different seed)
  const warpNoise = createNoise2D(
    createPRNG(typeof seed === 'number' ? seed + 7777 : `${seed}-warp`)
  );
  const data = new Float32Array(width * height);

  // Seed landmass peak centers — distributed across the map via grid + jitter
  // (cols × rows). Stored in normalized [0,1] coords; the falloff uses a
  // per-axis radius so continents SCALE with each map dimension (a wider map
  // gets wider continents, more total land) — this is the Azgaar-style
  // "land scales with map size" behavior. Aspect ratio is intentionally not
  // forced to circles.
  const peaks: { nx: number; ny: number; strength: number }[] = [];
  if (landmassCount > 0) {
    const count = Math.max(1, Math.round(landmassCount));
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = 1 / cols;
    const cellH = 1 / rows;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const margin = 0.15;
      const jx = margin + prng() * (1 - 2 * margin);
      const jy = margin + prng() * (1 - 2 * margin);
      peaks.push({
        nx: (col + jx) * cellW,
        ny: (row + jy) * cellH,
        strength: 0.35 + prng() * 0.25,
      });
    }
  }

  const mapSize = Math.min(width, height);
  // Isotropic coordinate scale: divide pixel coords by the SHORT dimension so
  // that 1 unit = 1 short-dimension pixel. All radial ops below use these
  // units, which keeps circles circular regardless of map aspect ratio
  // (otherwise non-square maps distort landmasses into ovals).
  const ns = 1 / mapSize;

  // --- Resolution-independent terrain (Azgaar lesson) ---
  // The noise frequency is normalized per-axis by map size so that continent
  // SIZE is a constant FRACTION of the map in BOTH dimensions at any
  // resolution. Without this, `scale` is an absolute pixel frequency: bigger
  // maps get the same-sized features crammed into more ocean, so total land
  // COLLAPSES as width/height grows (62% → 3% from 512px → 4096px). Per-axis
  // normalization means widening the map coarsens the x-frequency → continents
  // grow in x → land area scales with map size. `scale` remains a user control
  // interpreted relative to a 1000px map.
  const refSize = 1000;
  const scaleX = scale * (refSize / width);
  const scaleY = scale * (refSize / height);
  const warpScaleX = scaleX * 0.3;
  const warpScaleY = scaleY * 0.3;
  const warpAmp = mapSize * 0.15;

  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Domain warping: offset sampling coordinates for organic, swirling coastlines
      const wx = warpNoise(x * warpScaleX, y * warpScaleY) * warpAmp;
      const wy = warpNoise(x * warpScaleX + 500, y * warpScaleY + 500) * warpAmp;

      // Base FBM noise with domain warping
      const base = fbm(noise2D, x + wx, y + wy, octaves, persistence, lacunarity, scaleX, scaleY);
      // Ridged FBM — sharp mountain spines. Warped on the same coords so ridges
      // follow the organic coastline flow rather than a grid.
      const ridged = ridgedFbm(noise2D, x + wx, y + wy, octaves, persistence * 0.9, lacunarity, scaleX, scaleY);

      // Add landmass peaks — elevated regions near each peak center.
      // Normalized [0,1] coords with a per-axis radius so continents scale
      // with each map dimension (a wider map → wider continents → more land).
      const nx = x / width;
      const ny = y / height;
      let peakElevation = 0;
      for (const peak of peaks) {
        const dx = nx - peak.nx;
        const dy = ny - peak.ny;
        const dist = Math.hypot(dx, dy);
        const radius = 0.4; // fraction of the normalized map (per axis)
        const falloff = Math.max(0, 1 - dist / radius);
        // Smooth curve for natural-looking slopes
        const smooth = falloff * falloff * (3 - 2 * falloff);
        peakElevation += smooth * peak.strength;
      }

      // Blend noise (base) with ridged mountains. Ridging is weighted by how
      // high the base already is, so lowlands stay smooth and only risen ground
      // becomes craggy alpine ranges — giving borders real ridges to follow
      // and rivers real headwaters. Peaks still seed the continents.
      const mountainMask = Math.max(0, Math.min(1, (base - 0.45) / 0.35)); // 0 below 0.45, 1 above 0.8
      let shaped = base * 0.5 + peakElevation + ridged * mountainMask * 0.55;

      // Water level shifts the entire land/water split. Anchored at the default
      // 0.4 so there is no visual regression at the default; lower values raise
      // the field (more land, wider continental shelves, merging landmasses),
      // higher values lower it (more ocean). This makes the Water Level slider
      // actually shape the terrain instead of only recoloring coastlines.
      shaped = shaped - (waterLevel - 0.4);

      if (mapStyle === 'archipelago') {
        // Sharpen threshold → only peaks remain as islands
        shaped = smoothstep(0.4, 0.7, shaped);
      } else {
        // Continental: optional edge falloff pushes margins underwater.
        // Uses isotropic units (÷ short dimension) so the falloff radius is a
        // true circle in pixel space on any aspect ratio — otherwise a
        // non-square map would clip land into an oval.
        if (edgeFalloff > 0) {
          const ex = x * ns - 0.5 * (width * ns);
          const ey = y * ns - 0.5 * (height * ns);
          const dist = Math.hypot(ex, ey);
          const fall = smoothstep(1 - edgeFalloff, 1.0, dist);
          shaped = shaped - fall * 1.2;
        }
      }

      // Polar ice caps: raise elevation toward north and south edges
      if (polarEffect > 0) {
        const lat = y / height;
        const poleDist = Math.min(lat, 1 - lat);
        const capWidth = 0.18 + polarEffect * 0.12;
        const polar = smoothstep(capWidth, capWidth * 0.4, poleDist);
        shaped = shaped + polar * polarEffect * 0.35;
      }

      const clamped = Math.max(0, Math.min(1, shaped));
      data[y * width + x] = clamped;

      if (clamped < minElev) minElev = clamped;
      if (clamped > maxElev) maxElev = clamped;
    }
  }

  return { data, width, height, minElev, maxElev };
}
