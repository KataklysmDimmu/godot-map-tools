import sharp from 'sharp';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Heightmap, Province, World } from '../types';

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
  const pixels = new Uint8Array(width * height * 3);

  // 1. Draw grayscale heightmap background
  for (let i = 0; i < data.length; i++) {
    const val = Math.round(Math.max(0, Math.min(1, data[i])) * 180); // slight dim
    const pIdx = i * 3;
    pixels[pIdx] = val;
    pixels[pIdx + 1] = val;
    pixels[pIdx + 2] = val;
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