#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { generateWorld } from '../index';
import { WorldConfig } from '../types';
import { DEFAULT_CONFIG, loadConfig, validateConfig } from '../config';
import { exportHeightmapPNG, exportProvincesPNG, exportRoutesPNG } from '../exporters/png';
import { exportRoutesGeoJSON } from '../exporters/geojson';
import { exportWorldJSON } from '../exporters/json';
import { exportWorldGLTF } from '../exporters/gltf';
import { printBanner, printSummary } from './formatters';
import { createServer } from '../server/app'

const program = new Command();

program
  .name('godot-map-tools')
  .description('Procedural world generator for game development.')
  .version('0.0.2');

program
  .command('generate')
  .description('Generate a new procedural world')
  .option('-c, --config <path>', 'Path to JSON configuration file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-s, --seed <seed>', 'Seed number or string')
  .option('-w, --width <pixels>', 'Width of world in pixels')
  .option('-h, --height <pixels>', 'Height of world in pixels')
  .option('-p, --provinces <count>', 'Number of provinces')
  .option('--settlements <count>', 'Number of settlements')
  .option('--landmassCount <count>', 'Number of landmasses')
  .action(async (options) => {
    printBanner();
    const startTime = Date.now();

    let config: WorldConfig;

    if (options.config) {
      config = await loadConfig(path.resolve(options.config));
    } else {
      config = { ...DEFAULT_CONFIG };
    }

    if (options.seed !== undefined) config.seed = isNaN(Number(options.seed)) ? options.seed : Number(options.seed);
    if (options.width) config.width = parseInt(options.width, 10);
    if (options.height) config.height = parseInt(options.height, 10);
    if (options.provinces) config.provinceCount = parseInt(options.provinces, 10);
    if (options.settlements) config.settlementCount = parseInt(options.settlements, 10);
    if (options.landmassCount) config.landmassCount = parseInt(options.landmassCount, 10);

    validateConfig(config);

    const outDir = path.resolve(options.output);
    await fs.mkdir(outDir, { recursive: true });

    console.log(`[1/5] Generating terrain and procedural structures...`);
    const world = await generateWorld(config);

    console.log(`[2/5] Exporting Heightmap PNG...`);
    await exportHeightmapPNG(world.heightmap, path.join(outDir, 'heightmap.png'));

    console.log(`[3/5] Exporting Provinces & Routes PNGs...`);
    await exportProvincesPNG(world.provinces, config.width, config.height, path.join(outDir, 'provinces.png'));
    await exportRoutesPNG(world, path.join(outDir, 'routes.png'));

    console.log(`[4/5] Exporting GeoJSON & World JSON...`);
    await exportRoutesGeoJSON(world.routes, path.join(outDir, 'routes.geojson'));
    await exportWorldJSON(world, path.join(outDir, 'world.json'));

    console.log(`[5/5] Exporting 3D Mesh GLTF...`);
    await exportWorldGLTF(world, path.join(outDir, 'world.gltf'));

    printSummary(world, Date.now() - startTime);
    console.log(`Outputs saved to: ${outDir}\n`);
  });

program
  .command('config')
  .description('Print the default configuration JSON')
  .action(() => {
    console.log(JSON.stringify(DEFAULT_CONFIG, null, 2));
  });

program
  .command('validate <path>')
  .description('Validate a world config file')
  .action(async (configPath) => {
    try {
      const config = await loadConfig(path.resolve(configPath));
      validateConfig(config);
      console.log(`Config file "${configPath}" is valid.`);
    } catch (err: any) {
      console.error(`Validation error in "${configPath}":`, err.message);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Launch the interactive WebUI')
  .option('-p, --port <port>', 'Server port', '3000')
  .action((options) => {
    createServer(parseInt(options.port, 10));
  });

program.parse(process.argv);