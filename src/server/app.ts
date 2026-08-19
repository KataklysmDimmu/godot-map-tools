import express from 'express';
import * as path from 'node:path';
import { generateWorld } from '../index';
import { WorldConfig } from '../types';

export function createServer(port: number = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve('./public')));

  // API endpoint for procedural generation
  app.post('/api/generate', async (req, res) => {
    try {
      const config: WorldConfig = {
        seed: req.body.seed ?? 42,
        width: Number(req.body.width) || 512,
        height: Number(req.body.height) || 512,
        scale: Number(req.body.scale) || 0.003,
        heightmapOctaves: Number(req.body.octaves) || 6,
        heightmapPersistence: Number(req.body.persistence) || 0.5,
        heightmapLacunarity: Number(req.body.lacunarity) || 2.0,
        provinceCount: Number(req.body.provinces) || 20,
        settlementCount: Number(req.body.settlements) || 30,
        waterLevel: Number(req.body.waterLevel) || 0.4,
        routeWeighting: 'hybrid',
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