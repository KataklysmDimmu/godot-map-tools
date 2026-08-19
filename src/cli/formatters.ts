import { World } from '../types';

export function printBanner(): void {
  console.log('\n===========================================');
  console.log('       GODOT MAP TOOLS - WORLDGEN          ');
  console.log('===========================================\n');
}

export function printSummary(world: World, elapsedMs: number): void {
  console.log('\n-------------------------------------------');
  console.log(' Generation Complete!');
  console.log('-------------------------------------------');
  console.log(` Dimensions:   ${world.config.width} x ${world.config.height}`);
  console.log(` Seed:         ${world.config.seed}`);
  console.log(` Provinces:    ${world.provinces.length}`);
  console.log(` Settlements:  ${world.settlements.length}`);
  console.log(` Trade Routes: ${world.routes.length}`);
  console.log(` Time Elapsed: ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log('-------------------------------------------\n');
}