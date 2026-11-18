// The city of Azura Bay, generated once from a seed: a grid of streets and blocks, one or
// more buildings per block with a pavement ring around them, two parks, street trees and
// lamps, kerbside parking spots, and the named places the story visits. Everything the
// simulation collides with or navigates by comes from here; the city itself never changes.
import { CITY } from './config.js';
import { pick, range, rangeInt } from './random.js';

const ROOF_COLORS = ['#c96f4a', '#b8574f', '#7d8ca3', '#94a187', '#c2a15c', '#8a6f9e', '#5f8a8b', '#a3a380', '#bf7f68', '#6d7f99'];
const WALL_COLORS = ['#e3d7c3', '#d9c6a5', '#cbb59b', '#e8e0d0', '#d3b8a6', '#c9d1c0'];

/** Named story locations, pinned to fixed blocks so the missions always have a home. */
const SPECIALS = [
  { key: 'noodle', name: 'VOSS NOODLE BAR', col: 3, row: 3, roof: '#d94f3d' },
  { key: 'safehouse', name: "ROOK'S PLACE", col: 3, row: 4, roof: '#7d8ca3' },
  { key: 'cannery', name: 'OLD CANNERY', col: 6, row: 1, roof: '#8a6f4d' },
  { key: 'garage', name: 'SKYPARK GARAGE', col: 1, row: 6, roof: '#5f8a8b' },
  { key: 'marina', name: 'MARINA STORES', col: 7, row: 3, roof: '#4a7fa5' },
  { key: 'bank', name: 'AZURA BANK', col: 4, row: 2, roof: '#c2a15c' },
  { key: 'hotel', name: 'HOTEL LUMIERE', col: 2, row: 5, roof: '#8a6f9e' },
  { key: 'hospital', name: 'ST MARINA HOSPITAL', col: 5, row: 5, roof: '#e8e0d0' },
  { key: 'station', name: 'CENTRAL STATION', col: 4, row: 6, roof: '#6d7f99' },
  { key: 'market', name: 'PORT MARKET', col: 1, row: 2, roof: '#94a187' },
];

/** Blocks given over to grass and trees instead of buildings. */
const PARK_BLOCKS = [
  { col: 2, row: 2 },
  { col: 6, row: 5 },
];

/** The rectangle of block (col, row): the land between four streets. */
export function blockRect(col, row) {
  return {
    x: col * CITY.pitch + CITY.road,
    y: row * CITY.pitch + CITY.road,
    w: CITY.block,
    h: CITY.block,
  };
}

/** The centre line of vertical street i (0..cols) or horizontal street j (0..rows). */
export function streetCenterX(i) {
  return i * CITY.pitch + CITY.road / 2;
}
export function streetCenterY(j) {
  return j * CITY.pitch + CITY.road / 2;
}

/** True when the point lies on a street rather than inside a block. */
export function isOnStreet(x, y) {
  if (x < 0 || y < 0 || x > CITY.size || y > CITY.size) return false;
  return x % CITY.pitch < CITY.road || y % CITY.pitch < CITY.road;
}

/** A random point on a random street, kept away from intersections. */
export function randomStreetPoint(random) {
  const vertical = random() < 0.5;
  const line = rangeInt(random, 0, CITY.cols);
  const along = range(random, CITY.road + 30, CITY.size - CITY.road - 30);
  return vertical ? { x: streetCenterX(line), y: along } : { x: along, y: streetCenterY(line) };
}

function makeBuilding(random, rect, index, label, roof) {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    index,
    label: label ?? null,
    roof: roof ?? pick(random, ROOF_COLORS),
    wall: pick(random, WALL_COLORS),
    /** A rooftop box (air-con unit, water tank) on some buildings, as a fraction rect. */
    prop: random() < 0.55 ? { fx: range(random, 0.08, 0.6), fy: range(random, 0.08, 0.6), fw: range(random, 0.16, 0.3), fh: range(random, 0.14, 0.26) } : null,
  };
}

export function createCity(random) {
  const buildings = [];
  const parks = [];
  const trees = [];
  const lamps = [];
  const specials = {};
  const specialAt = new Map(SPECIALS.map((s) => [`${s.col},${s.row}`, s]));
  const parkAt = new Set(PARK_BLOCKS.map((p) => `${p.col},${p.row}`));

  for (let row = 0; row < CITY.rows; row += 1) {
    for (let col = 0; col < CITY.cols; col += 1) {
      const block = blockRect(col, row);
      const key = `${col},${row}`;
      if (parkAt.has(key)) {
        parks.push({ ...block, col, row });
        const count = rangeInt(random, 7, 11);
        for (let i = 0; i < count; i += 1) {
          trees.push({ x: block.x + range(random, 22, CITY.block - 22), y: block.y + range(random, 22, CITY.block - 22), r: range(random, 11, 17) });
        }
        continue;
      }
      const inner = {
        x: block.x + CITY.pavement,
        y: block.y + CITY.pavement,
        w: CITY.block - CITY.pavement * 2,
        h: CITY.block - CITY.pavement * 2,
      };
      const special = specialAt.get(key);
      if (special) {
        const building = makeBuilding(random, inner, buildings.length, special.name, special.roof);
        buildings.push(building);
        // The story marker stands on the pavement below the building's front door.
        specials[special.key] = {
          key: special.key,
          name: special.name,
          x: building.x + building.w / 2,
          y: building.y + building.h + CITY.pavement / 2 + 4,
          building,
        };
        continue;
      }
      const layout = rangeInt(random, 0, 2);
      if (layout === 0) {
        buildings.push(makeBuilding(random, inner, buildings.length));
      } else if (layout === 1) {
        const gap = 12;
        const w = (inner.w - gap) / 2;
        buildings.push(makeBuilding(random, { x: inner.x, y: inner.y, w, h: inner.h }, buildings.length));
        buildings.push(makeBuilding(random, { x: inner.x + w + gap, y: inner.y, w, h: inner.h }, buildings.length));
      } else {
        const gap = 12;
        const w = (inner.w - gap) / 2;
        const h = (inner.h - gap) / 2;
        buildings.push(makeBuilding(random, { x: inner.x, y: inner.y, w, h }, buildings.length));
        buildings.push(makeBuilding(random, { x: inner.x + w + gap, y: inner.y, w, h }, buildings.length));
        buildings.push(makeBuilding(random, { x: inner.x, y: inner.y + h + gap, w, h }, buildings.length));
        buildings.push(makeBuilding(random, { x: inner.x + w + gap, y: inner.y + h + gap, w, h }, buildings.length));
      }
      // A street tree or two on the block's corners.
      if (random() < 0.7) trees.push({ x: block.x + 9, y: block.y + 9, r: range(random, 8, 12) });
      if (random() < 0.5) trees.push({ x: block.x + CITY.block - 9, y: block.y + CITY.block - 9, r: range(random, 8, 12) });
    }
  }

  // Lamps along every street, on both kerbs, skipping the intersections themselves.
  for (let i = 0; i <= CITY.cols; i += 1) {
    for (let along = CITY.road + 52; along < CITY.size - 20; along += 138) {
      if (along % CITY.pitch < CITY.road + 16) continue;
      lamps.push({ x: streetCenterX(i) - CITY.road / 2 + 5, y: along });
      lamps.push({ x: streetCenterX(i) + CITY.road / 2 - 5, y: along });
    }
  }

  // Kerbside parking: cars tucked against the left kerb of streets, clear of junctions.
  const parkedSpawns = [];
  for (let tries = 0; tries < 400 && parkedSpawns.length < 30; tries += 1) {
    const vertical = random() < 0.5;
    const line = rangeInt(random, 0, CITY.cols);
    const blockIndex = rangeInt(random, 0, CITY.cols - 1);
    const along = blockIndex * CITY.pitch + CITY.road + range(random, 26, CITY.block - 26);
    if (vertical) {
      parkedSpawns.push({ x: streetCenterX(line) - CITY.road / 2 + 14, y: along, angle: Math.PI / 2 });
    } else {
      parkedSpawns.push({ x: along, y: streetCenterY(line) - CITY.road / 2 + 14, angle: 0 });
    }
  }

  // Dee's coupe waits on the street in front of the noodle bar, pointing east.
  const noodle = specials.noodle;
  const coupeSpawn = {
    x: noodle.building.x + noodle.building.w / 2,
    y: noodle.building.y + noodle.building.h + CITY.pavement + CITY.road / 2 - 14,
    angle: 0,
  };

  return {
    size: CITY.size,
    buildings,
    parks,
    trees,
    lamps,
    specials,
    parkedSpawns,
    coupeSpawn,
    colliders: buildings,
  };
}
