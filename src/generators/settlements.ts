import { WorldConfig, Province, Settlement, Heightmap } from '../types';
import { createPRNG, clamp } from '../utils/math';

interface Point {
  x: number;
  y: number;
}

type SettlementType = Settlement['type'];

// Snap a candidate point onto land (or the highest ground available). Settlements
// should never sit on open water: we expand a search ring until we find a cell
// above the water level, preferring coasts. If the map is nearly all water, we
// fall back to the single highest cell in the whole heightmap so the settlement
// at least lands on the "driest" spot rather than in the sea.
function preferLand(x: number, y: number, heightmap: Heightmap, waterLevel: number): Point {
  const { width, height, data } = heightmap;
  const cx = clamp(Math.round(x), 0, width - 1);
  const cy = clamp(Math.round(y), 0, height - 1);

  // One full-map pass to record the global highest cell as a guaranteed fallback.
  let globalDry: Point = { x: cx, y: cy };
  let globalDryElev = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > globalDryElev) {
      globalDryElev = data[i];
      globalDry = { x: i % width, y: Math.floor(i / width) };
    }
  }

  const maxRadius = Math.max(8, Math.floor(Math.min(width, height) * 0.5));
  let landBest: Point | null = null;
  let landBestScore = -Infinity;

  for (let radius = 2; radius <= maxRadius; radius += 2) {
    for (let dy = -radius; dy <= radius; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue; // ring only
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const e = data[ny * width + nx] || 0;
        if (e < waterLevel) continue; // never place on open water
        // Prefer just-above-water (coastal) cells over high peaks.
        const score = -Math.abs(e - (waterLevel + 0.04));
        if (score > landBestScore) {
          landBestScore = score;
          landBest = { x: nx, y: ny };
        }
      }
    }
    if (landBest) break; // found land on this ring — stop expanding
  }

  return landBest ?? globalDry;
}

export async function generateSettlements(
  config: WorldConfig,
  provinces: Province[],
  heightmap: Heightmap
): Promise<Settlement[]> {
  const width = config.width;
  const height = config.height;
  const waterLevel = config.waterLevel || 0.4;
  const prng = createPRNG(
    typeof config.seed === 'number' ? config.seed + 202 : `${config.seed}-settlements`
  );

  const settlements: Settlement[] = [];
  let nextId = 0;

  const numProvinces = provinces.length;
  if (numProvinces === 0) return settlements;

  // `satellitesPerCapital` is the authoritative control. The capital of every
  // province is always placed; satellites are distributed around them. We do NOT
  // cap the total at `settlementCount` (that was clipping satellites to zero when
  // settlementCount < provinces*(1+sats)). `settlementCount` only acts as a floor
  // so very low values still yield one capital per province.
  const satsPerCapital = Math.max(0, Math.floor(config.satellitesPerCapital ?? 3));
  const numCapitals = numProvinces;
  const baseR = Math.max(12, Math.min(width, height) * 0.08); // satellite ring radius

  // `capitalProminence` controls how far the capital sits from the province
  // centroid (0 = centered/clustered, 1 = pushed toward the province edge).
  // We estimate the province radius from its area and offset along a
  // deterministic per-province angle.
  const prominence = Math.max(0, Math.min(1, config.capitalProminence ?? 0.5));

  for (let i = 0; i < numCapitals; i++) {
    const province = provinces[i];
    const provinceRadius = Math.sqrt(province.area / Math.PI);
    const spreadFactor = prominence * provinceRadius * 0.45;
    const spreadAngle = (province.id * 2.399963) + prng() * 0.5; // golden-angle-ish + jitter
    const capX = province.centerX + Math.cos(spreadAngle) * spreadFactor;
    const capY = province.centerY + Math.sin(spreadAngle) * spreadFactor;
    const { x: landX, y: landY } = preferLand(capX, capY, heightmap, waterLevel);

    const capital: Settlement = {
      id: nextId++,
      name: generateSettlementName(prng, 'capital' as SettlementType),
      x: landX,
      y: landY,
      type: 'capital' as SettlementType,
      parentProvinceId: province.id,
      population: Math.floor(5000 + prng() * 15000),
    };

    settlements.push(capital);
    province.settlements.push(capital);
  }

  // SATELLITES are placed *around their own capital*, in a jittered ring, so they
  // branch off the capital rather than being scattered across the whole map (and
  // then snapped to the coast).
  if (satsPerCapital > 0 && numCapitals > 0) {
    for (let i = 0; i < numCapitals; i++) {
      const province = provinces[i];
      const capital = settlements[i]; // capitals were pushed first, in order

      for (let s = 0; s < satsPerCapital; s++) {
        const angle = (s / satsPerCapital) * Math.PI * 2 + prng() * 0.7;
        const radius = baseR * (0.35 + prng() * 1.15);
        const sx = capital.x + Math.cos(angle) * radius;
        const sy = capital.y + Math.sin(angle) * radius;

        const land = preferLand(sx, sy, heightmap, waterLevel);
        const isMajor = prng() < 0.3;
        const type = (isMajor ? 'major' : 'minor') as SettlementType;

        const sat: Settlement = {
          id: nextId++,
          name: generateSettlementName(prng, type),
          x: land.x,
          y: land.y,
          type,
          parentProvinceId: province.id,
          population: isMajor
            ? Math.floor(1000 + prng() * 4000)
            : Math.floor(100 + prng() * 800),
        };

        settlements.push(sat);
        province.settlements.push(sat);
      }
    }
  }

  // After placing capitals + satellites, if settlementCount is higher than
  // the computed total, add extra minor settlements spread across provinces
  // so settlementCount acts as a target floor.
  const targetCount = Math.max(settlements.length, config.settlementCount || 0);
  let provinceIdx = 0;
  while (settlements.length < targetCount) {
    const province = provinces[provinceIdx % numProvinces];
    const capital = settlements[provinceIdx % numCapitals];
    const angle = prng() * Math.PI * 2;
    const radius = baseR * (0.5 + prng() * 1.0);
    const sx = capital.x + Math.cos(angle) * radius;
    const sy = capital.y + Math.sin(angle) * radius;

    const land = preferLand(sx, sy, heightmap, waterLevel);
    settlements.push({
      id: nextId++,
      name: generateSettlementName(prng, 'minor'),
      x: land.x,
      y: land.y,
      type: 'minor',
      parentProvinceId: province.id,
      population: Math.floor(100 + prng() * 800),
    });
    provinceIdx++;
  }

  return settlements;
}

function generateSettlementName(prng: () => number, type: SettlementType): string {
  const prefixes = [
    'Aethel', 'Ald', 'Bael', 'Black', 'Cold', 'Drak', 'Eld', 'Frost',
    'Grey', 'High', 'Iron', 'Krag', 'Moon', 'Nor', 'Oak', 'Raven',
    'Silver', 'Stone', 'Sun', 'Val', 'West', 'Wind', 'Winter', 'Wolf'
  ];

  const suffixesCapital = [
    'gard', 'hold', 'haven', 'spire', 'citadel', 'stead', 'crown', 'keep'
  ];

  const suffixesTown = [
    'ford', 'bridge', 'port', 'cross', 'mouth', 'vale', 'mill', 'cliff'
  ];

  const suffixesMinor = [
    'ham', 'wick', 'ton', 'dell', 'hollow', 'end', 'brook', 'ridge'
  ];

  const prefix = prefixes[Math.floor(prng() * prefixes.length)];
  let suffix: string;

  if (type === 'capital') {
    suffix = suffixesCapital[Math.floor(prng() * suffixesCapital.length)];
  } else if (type === 'major') {
    suffix = suffixesTown[Math.floor(prng() * suffixesTown.length)];
  } else {
    suffix = suffixesMinor[Math.floor(prng() * suffixesMinor.length)];
  }

  return prefix + suffix;
}
