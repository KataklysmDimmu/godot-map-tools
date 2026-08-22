import express from 'express';
import * as path from 'node:path';
import { generateWorld } from '../index';
import { WorldConfig } from '../types';

export function createServer(port: number = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve('./public')));

  // API endpoint for procedural generation.
  // Reads the full config the WebUI sends (presets, styling, route weighting, …).
  app.post('/api/generate', async (req, res) => {
    try {
      const b = req.body || {};

      const config: WorldConfig = {
        seed: b.seed !== undefined && b.seed !== null && b.seed !== '' ? b.seed : 42,
        width: Number(b.width) || 512,
        height: Number(b.height) || 512,
        scale: Number(b.scale) || 0.003,
        heightmapOctaves: Number(b.octaves) || 6,
        heightmapPersistence: Number(b.persistence) || 0.5,
        heightmapLacunarity: Number(b.lacunarity) || 2.0,
        provinceCount: Number(b.provinces) || 20,
        settlementCount: Number(b.settlements) || 30,
        waterLevel: Number(b.waterLevel) || 0.4,
        lloydIterations: Number(b.lloydIterations) || 3,
        satellitesPerCapital: Number(b.satellitesPerCapital) ?? 3,
        capitalProminence: Number(b.capitalProminence) ?? 0.6,
        routeWeighting: (b.routeWeighting as WorldConfig['routeWeighting']) || 'hybrid',
        terrainDifficulty: Number(b.terrainDifficulty) ?? 0.5,
        mapStyle: (b.mapStyle as WorldConfig['mapStyle']) || 'continental',
        edgeFalloff: Number(b.edgeFalloff) ?? 0.4,
        landmassCount: Number(b.landmassCount) ?? 2,
        polarEffect: Number(b.polarEffect) ?? 0.5,
      } as WorldConfig;

      const world = await generateWorld(config);

      // Wire format: send the heightmap as a compact base64 Float32 buffer
      // instead of a verbose JSON number array (~3.4x smaller). For very large
      // maps (>4096px) we cap the resolution sent to the browser to avoid
      // OOMing the tab; the on-disk exports still use full resolution.
      const MAX_WIRE = 4096;
      const wireScale = Math.max(1, Math.ceil(Math.max(world.heightmap.width, world.heightmap.height) / MAX_WIRE));
      const wW = Math.floor(world.heightmap.width / wireScale);
      const wH = Math.floor(world.heightmap.height / wireScale);
      const wire = new Float32Array(wW * wH);
      if (wireScale === 1) {
        wire.set(world.heightmap.data);
      } else {
        for (let y = 0; y < wH; y++) {
          for (let x = 0; x < wW; x++) {
            const sx = Math.min(world.heightmap.width - 1, x * wireScale);
            const sy = Math.min(world.heightmap.height - 1, y * wireScale);
            wire[y * wW + x] = world.heightmap.data[sy * world.heightmap.width + sx];
          }
        }
      }
      const wireB64 = Buffer.from(wire.buffer, wire.byteOffset, wire.byteLength).toString('base64');

      // Reflect the actual wire (display) dimensions in the returned config so
      // the frontend has a single source of truth. Generation still ran at the
      // full config.width/height; heightmap.{width,height} below are the
      // downsampled display dims the canvas/3D mesh use.
      const wireConfig = { ...world.config, width: wW, height: wH };

      // Send raw generation data for in-browser canvas rendering
      res.json({
        config: wireConfig,
        heightmap: {
          width: wW,
          height: wH,
          data: wireB64,
          encoding: 'base64-f32',
        },
        provinces: world.provinces.map((p) => ({
          id: p.id,
          color: p.color,
          centerX: p.centerX,
          centerY: p.centerY,
          area: p.area,
        })),
        settlements: world.settlements,
        routes: world.routes,
        rivers: world.rivers,
        borders: world.borders,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, () => {
    console.log(`\n===========================================`);
    console.log(` 🗺️  WorldGen WebUI running at: http://localhost:${port}`);
    console.log(`===========================================\n`);
  });
}
