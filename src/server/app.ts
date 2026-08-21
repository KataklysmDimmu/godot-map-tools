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
        seed: b.seed ?? 42,
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
      } as WorldConfig;

      const world = await generateWorld(config);

      // Send raw generation data for in-browser canvas rendering
      res.json({
        config: world.config,
        heightmap: {
          width: world.heightmap.width,
          height: world.heightmap.height,
          data: Array.from(world.heightmap.data),
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
