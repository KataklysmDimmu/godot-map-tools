import { RGB, hsvToRgb } from '../utils/math';

/**
 * Generates a visually distinct, deterministic RGB color for a given province ID
 * using the golden ratio hue spread.
 */
export function colorForProvince(id: number): RGB {
  const goldenRatioConjugate = 0.618033988749895;
  const hue = (id * goldenRatioConjugate) % 1.0;
  const sat = 0.7 + (id % 100) / 500; // 0.70 - 0.90
  const val = 0.65 + (id % 50) / 250; // 0.65 - 0.85

  return hsvToRgb(hue, sat, val);
}