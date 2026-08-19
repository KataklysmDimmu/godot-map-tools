import { WorldConfig, Province, Settlement } from '../types';
import { createPRNG, clamp } from '../utils/math';

interface Point {
  x: number;
  y: number;
}

type SettlementType = Settlement['type'];

export async function generateSettlements(
  config: WorldConfig,
  provinces: Province[]
): Promise<Settlement[]> {
  const width = config.width;
  const height = config.height;
  const targetCount = config.settlementCount || 30;
  const prng = createPRNG(
    typeof config.seed === 'number' ? config.seed + 202 : `${config.seed}-settlements`
  );

  const settlements: Settlement[] = [];
  let nextId = 0;

  for (const province of provinces) {
    const jitterRadius = Math.min(width, height) * 0.02;
    const angle = prng() * Math.PI * 2;
    const distance = prng() * jitterRadius;

    const capX = clamp(Math.round(province.centerX + Math.cos(angle) * distance), 0, width - 1);
    const capY = clamp(Math.round(province.centerY + Math.sin(angle) * distance), 0, height - 1);

    const capital: Settlement = {
      id: nextId++,
      name: generateSettlementName(prng, 'capital' as SettlementType),
      x: capX,
      y: capY,
      type: 'capital' as SettlementType,
      parentProvinceId: province.id,
      population: Math.floor(5000 + prng() * 15000),
    };

    settlements.push(capital);
    if (province.settlements) {
      province.settlements.push(capital);
    }
  }

  const remainingCount = Math.max(0, targetCount - settlements.length);
  if (remainingCount > 0 && provinces.length > 0) {
    const minDistance = Math.sqrt((width * height) / targetCount) * 0.75;
    
    const existingPoints: Point[] = settlements.map((s) => ({ x: s.x, y: s.y }));
    const candidatePoints = poissonDiskSampling(
      width,
      height,
      minDistance,
      remainingCount,
      existingPoints,
      prng
    );

    for (const pt of candidatePoints) {
      if (settlements.length >= targetCount) break;

      const nearestProvince = findNearestProvince(pt.x, pt.y, provinces);
      const isMajor = prng() < 0.3;
      const type = (isMajor ? 'major' : 'minor') as SettlementType;

      const sat: Settlement = {
        id: nextId++,
        name: generateSettlementName(prng, type),
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        type,
        parentProvinceId: nearestProvince.id,
        population: isMajor
          ? Math.floor(1000 + prng() * 4000)
          : Math.floor(100 + prng() * 800),
      };

      settlements.push(sat);
      if (nearestProvince.settlements) {
        nearestProvince.settlements.push(sat);
      }
    }
  }

  return settlements;
}

function poissonDiskSampling(
  width: number,
  height: number,
  minDist: number,
  maxPoints: number,
  initialPoints: Point[],
  prng: () => number
): Point[] {
  const cellSize = minDist / Math.SQRT2;
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const grid: Int32Array = new Int32Array(gridW * gridH).fill(-1);

  const points: Point[] = [];
  const active: number[] = [];

  function insertPoint(p: Point): number {
    const idx = points.length;
    points.push(p);
    const gx = Math.floor(p.x / cellSize);
    const gy = Math.floor(p.y / cellSize);
    if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
      grid[gy * gridW + gx] = idx;
    }
    return idx;
  }

  for (const p of initialPoints) {
    insertPoint(p);
  }

  if (points.length === 0) {
    const p0 = { x: prng() * width, y: prng() * height };
    active.push(insertPoint(p0));
  } else {
    for (let i = 0; i < points.length; i++) {
      active.push(i);
    }
  }

  const k = 30;
  const generated: Point[] = [];

  while (active.length > 0 && generated.length < maxPoints) {
    const randIdx = Math.floor(prng() * active.length);
    const pointIdx = active[randIdx];
    const point = points[pointIdx];
    let found = false;

    for (let attempt = 0; attempt < k; attempt++) {
      const angle = prng() * Math.PI * 2;
      const radius = minDist * (1 + prng());
      const candidate: Point = {
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      };

      if (candidate.x < 0 || candidate.x >= width || candidate.y < 0 || candidate.y >= height) {
        continue;
      }

      if (isValidSample(candidate, minDist, cellSize, gridW, gridH, grid, points)) {
        const newIdx = insertPoint(candidate);
        active.push(newIdx);
        generated.push(candidate);
        found = true;
        break;
      }
    }

    if (!found) {
      active.splice(randIdx, 1);
    }
  }

  return generated;
}

function isValidSample(
  pt: Point,
  minDist: number,
  cellSize: number,
  gridW: number,
  gridH: number,
  grid: Int32Array,
  points: Point[]
): boolean {
  const gx = Math.floor(pt.x / cellSize);
  const gy = Math.floor(pt.y / cellSize);
  const minDistSq = minDist * minDist;

  const minX = Math.max(0, gx - 2);
  const maxX = Math.min(gridW - 1, gx + 2);
  const minY = Math.max(0, gy - 2);
  const maxY = Math.min(gridH - 1, gy + 2);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const neighborIdx = grid[y * gridW + x];
      if (neighborIdx !== -1) {
        const neighbor = points[neighborIdx];
        const distSq = (pt.x - neighbor.x) ** 2 + (pt.y - neighbor.y) ** 2;
        if (distSq < minDistSq) {
          return false;
        }
      }
    }
  }

  return true;
}

function findNearestProvince(x: number, y: number, provinces: Province[]): Province {
  let nearest = provinces[0];
  let minDistanceSq = Infinity;

  for (const province of provinces) {
    const distSq = (x - province.centerX) ** 2 + (y - province.centerY) ** 2;
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      nearest = province;
    }
  }

  return nearest;
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