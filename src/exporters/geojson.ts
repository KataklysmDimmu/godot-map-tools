import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Route } from '../types';

export async function exportRoutesGeoJSON(routes: Route[], outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const geojson = {
    type: 'FeatureCollection',
    features: routes.map((route) => ({
      type: 'Feature',
      properties: {
        id: route.id,
        fromSettlement: route.fromSettlement,
        toSettlement: route.toSettlement,
        type: route.type,
        distance: route.distance,
        terrain_difficulty: route.terrain_difficulty,
      },
      geometry: {
        type: 'LineString',
        coordinates: route.path.map((p) => [p.x, p.y]),
      },
    })),
  };

  await fs.writeFile(outputPath, JSON.stringify(geojson, null, 2), 'utf-8');
}