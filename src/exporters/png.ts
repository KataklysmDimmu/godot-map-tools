import sharp from 'sharp';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Heightmap, Province, World } from '../types';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export async function exportHeightmapPNG(heightmap: Heightmap, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const { width, height, data } = heightmap;
  const pixels = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i++) {
    pixels[i] = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
  }

  await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(outputPath);
}

export async function exportProvincesPNG(
  provinces: Province[],
  width: number,
  height: number,
  outputPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const pixels = new Uint8Array(width * height * 3);

  for (const province of provinces) {
    const { r, g, b } = province.color;
    for (const idx of province.cellIndices) {
      const pIdx = idx * 3;
      pixels[pIdx] = r;
      pixels[pIdx + 1] = g;
      pixels[pIdx + 2] = b;
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(outputPath);
}

export async function exportRoutesPNG(
  world: World,
  outputPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const { width, height, data } = world.heightmap;
  const waterLevel = world.config.waterLevel;
  const pixels = new Uint8Array(width * height * 3);

  // 1. Draw background with biome gradient + polar ice tint
  for (let y = 0; y < height; y++) {
    const lat = y / height;
    const poleDist = Math.min(lat, 1 - lat);
    const iceFactor = smoothstep(0.28, 0.08, poleDist);

    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const h = data[i];
      const pIdx = i * 3;

      let r, g, b;

      if (h < waterLevel) {
        // Ocean: depth-based gradient
        const depth = (waterLevel - h) / waterLevel;
        r = Math.round(15 + depth * 25);
        g = Math.round(50 + depth * 60);
        b = Math.round(120 + depth * 80);
      } else {
        // Land: elevation-based biome gradient
        const landH = (h - waterLevel) / (1 - waterLevel);
        const beachWidth = 0.04;
        const snowLine = 0.75 - iceFactor * 0.35;

        if (landH < beachWidth) {
          const t = landH / beachWidth;
          r = Math.round(194 + t * 30);
          g = Math.round(178 + t * 40);
          b = Math.round(128 + t * 20);
        } else if (landH < 0.35) {
          const t = (landH - beachWidth) / (0.35 - beachWidth);
          r = Math.round(60 + t * 20);
          g = Math.round(140 - t * 50);
          b = Math.round(40 + t * 10);
        } else if (landH < snowLine) {
          const t = (landH - 0.35) / Math.max(0.01, snowLine - 0.35);
          r = Math.round(100 + t * 60);
          g = Math.round(90 + t * 50);
          b = Math.round(70 + t * 40);
        } else {
          const t = (landH - snowLine) / Math.max(0.01, 1 - snowLine);
          r = Math.round(200 + t * 55);
          g = Math.round(200 + t * 55);
          b = Math.round(210 + t * 45);
        }

        // Polar ice blend
        if (iceFactor > 0.1 && landH > beachWidth) {
          const iceBlend = smoothstep(0.1, 0.8, iceFactor);
          r = Math.round(r + (230 - r) * iceBlend);
          g = Math.round(g + (235 - g) * iceBlend);
          b = Math.round(b + (245 - b) * iceBlend);
        }
      }

      pixels[pIdx] = Math.min(255, r);
      pixels[pIdx + 1] = Math.min(255, g);
      pixels[pIdx + 2] = Math.min(255, b);
    }
  }

  // 2. Draw routes overlay
  for (const route of world.routes) {
    const isTrade = route.type === 'trade';
    const r = isTrade ? 240 : 80;
    const g = isTrade ? 180 : 160;
    const b = isTrade ? 40 : 240;

    for (let i = 0; i < route.path.length - 1; i++) {
      drawLine(pixels, width, height, route.path[i], route.path[i + 1], r, g, b, isTrade ? 2 : 1);
    }
  }

  // 2b. Draw rivers overlay (blue), width tapers from headwater to mouth.
  for (const river of world.rivers) {
    const path = river.path;
    const widths = river.widths || path.map(() => 2);
    for (let i = 0; i < path.length - 1; i++) {
      const w = Math.max(1, (widths[i] + widths[i + 1]) / 2);
      drawLine(pixels, width, height, path[i], path[i + 1], 40, 110, 240, Math.round(w));
    }
  }

  // 3. Draw settlements as markers
  for (const s of world.settlements) {
    drawCircle(pixels, width, height, s.x, s.y, s.type === 'capital' ? 5 : 3, 255, 50, 50);
  }

  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(outputPath);
}

function drawLine(
  pixels: Uint8Array,
  w: number,
  h: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  r: number,
  g: number,
  b: number,
  thickness: number = 1
): void {
  let x0 = Math.round(p1.x);
  let y0 = Math.round(p1.y);
  const x1 = Math.round(p2.x);
  const y1 = Math.round(p2.y);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    for (let ty = -thickness + 1; ty < thickness; ty++) {
      for (let tx = -thickness + 1; tx < thickness; tx++) {
        const px = x0 + tx;
        const py = y0 + ty;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const idx = (py * w + px) * 3;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
        }
      }
    }

    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawCircle(
  pixels: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const idx = (py * w + px) * 3;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
        }
      }
    }
  }
}