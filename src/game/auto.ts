import { Board, HEIGHT, SIZE } from './board';
import { cellsForPiece } from './pieces';
import type { ActivePiece, Plane, PieceType } from './types';

export interface Placement {
  plane: Plane;
  rotation: number;
  x: number;
  z: number;
  y: number;
  score: number;
}

export interface PieceSpec {
  type: PieceType;
  plane: Plane;
}

/** Drop piece as far down as possible at fixed x/z/rotation. Returns null if no fit. */
function dropPlacement(
  board: Board,
  type: PieceType,
  plane: Plane,
  rotation: number,
  x: number,
  z: number,
): ActivePiece | null {
  const piece: ActivePiece = { type, plane, rotation, x, y: HEIGHT - 1, z };
  let y = HEIGHT - 1;
  let found = false;
  for (; y >= 0; y--) {
    piece.y = y;
    if (board.fits(piece)) {
      found = true;
      break;
    }
  }
  if (!found) return null;
  while (piece.y > 0) {
    piece.y -= 1;
    if (!board.fits(piece)) {
      piece.y += 1;
      break;
    }
  }
  return { ...piece };
}

function columnHeights(board: Board): Int16Array {
  const h = new Int16Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      let height = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        if (board.cells[y][z][x] !== null) {
          height = y + 1;
          break;
        }
      }
      h[z * SIZE + x] = height;
    }
  }
  return h;
}

function countHoles(board: Board): { holes: number; deepHoles: number } {
  let holes = 0;
  let deepHoles = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      let blocked = false;
      let run = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const filled = board.cells[y][z][x] !== null;
        if (filled) {
          blocked = true;
          if (run > 0) {
            holes += run;
            if (run >= 2) deepHoles += run;
            run = 0;
          }
        } else if (blocked) {
          run++;
        }
      }
      if (run > 0) {
        holes += run;
        if (run >= 2) deepHoles += run;
      }
    }
  }
  return { holes, deepHoles };
}

/** Prefer nearly-full low layers; sparse mid-height clutter is bad. */
function layerPackingScore(board: Board): number {
  let score = 0;
  for (let y = 0; y < HEIGHT; y++) {
    let filled = 0;
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (board.cells[y][z][x] !== null) filled++;
      }
    }
    if (filled === 0) continue;
    const frac = filled / (SIZE * SIZE);
    const lowBias = (HEIGHT - y) / HEIGHT;
    score += frac * frac * 520 * lowBias;
    if (filled >= SIZE * SIZE - 8) score += 1100 * lowBias;
    if (filled >= SIZE * SIZE - 4) score += 2000 * lowBias;
    // Half-built layers that are not near full are a trap (wall-ish shelves).
    if (filled > 8 && filled < SIZE * SIZE * 0.45) score -= (0.45 - frac) * 800 * lowBias;
  }
  return score;
}

/**
 * Punish "ridge / wall" shapes: clusters of tall columns glued together
 * while large areas of the footprint stay low.
 */
function wallPenalty(heights: Int16Array): number {
  let maxH = 0;
  let minH = HEIGHT;
  let sum = 0;
  for (let i = 0; i < heights.length; i++) {
    const hh = heights[i];
    sum += hh;
    if (hh > maxH) maxH = hh;
    if (hh < minH) minH = hh;
  }
  const avg = sum / heights.length;
  if (maxH <= 1) return 0;

  const tallThresh = Math.max(avg + 1.5, maxH - 1);
  let tall = 0;
  let edgePairs = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x;
      if (heights[i] < tallThresh) continue;
      tall++;
      const neigh = [
        x > 0 ? heights[z * SIZE + (x - 1)] : -1,
        x + 1 < SIZE ? heights[z * SIZE + (x + 1)] : -1,
        z > 0 ? heights[(z - 1) * SIZE + x] : -1,
        z + 1 < SIZE ? heights[(z + 1) * SIZE + x] : -1,
      ];
      for (const n of neigh) {
        if (n >= tallThresh) edgePairs++;
      }
    }
  }
  // Many tall cells that are mutually adjacent ⇒ a wall/ridge.
  const cluster = edgePairs / 2;
  const spreadGap = maxH - minH;
  return tall * 80 + cluster * 140 + spreadGap * spreadGap * 45;
}

/**
 * Floor contact is good.
 * "Down" contact on short columns is OK (filling); on already-tall columns it
 * is what makes cyan I-bars keep stacking into a wall at ~ (4,4).
 */
function contactScore(before: Board, piece: ActivePiece, heights: Int16Array): number {
  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  const set = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
  let sum = 0;
  let maxH = 0;
  for (let i = 0; i < heights.length; i++) {
    sum += heights[i];
    if (heights[i] > maxH) maxH = heights[i];
  }
  const avg = sum / heights.length;

  let floor = 0;
  let downGood = 0;
  let downBad = 0;
  let side = 0;
  for (const c of cells) {
    if (c.y === 0) floor++;
    if (c.y > 0 && !set.has(`${c.x},${c.y - 1},${c.z}`)) {
      if (before.cells[c.y - 1][c.z][c.x] !== null) {
        const colH = heights[c.z * SIZE + c.x];
        // Stacking onto a local high column / the global max ⇒ wall growth.
        if (colH >= avg + 0.5 || (maxH >= 2 && colH >= maxH)) downBad++;
        else downGood++;
      }
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c.x + dx;
      const nz = c.z + dz;
      if (set.has(`${nx},${c.y},${nz}`)) continue;
      if (!before.inBounds(nx, c.y, nz)) {
        side += 0.25;
        continue;
      }
      if (before.cells[c.y][nz][nx] !== null) side++;
    }
  }
  const sideWeight = piece.plane === 'XZ' ? -70 : -20;
  return floor * 90 + downGood * 35 - downBad * 160 + side * sideWeight;
}

/** Heavy tax for parking a piece on columns that are already the tall ridge. */
function ridgeStackPenalty(piece: ActivePiece, heights: Int16Array): number {
  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  let sum = 0;
  let maxH = 0;
  for (let i = 0; i < heights.length; i++) {
    sum += heights[i];
    if (heights[i] > maxH) maxH = heights[i];
  }
  const avg = sum / heights.length;
  if (maxH <= 1) return 0;

  const seen = new Set<string>();
  let penalty = 0;
  let onMax = 0;
  for (const c of cells) {
    const key = `${c.x},${c.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const h = heights[c.z * SIZE + c.x];
    if (h >= maxH && maxH >= 2) {
      onMax++;
      penalty += 420;
    } else if (h >= avg + 1) {
      penalty += 180 * (h - avg);
    }
    // Prefer empty/low columns strongly for flat (XZ) bars.
    if (piece.plane === 'XZ' && h === 0) penalty -= 90;
    if (piece.plane === 'XZ' && h > 0 && h <= avg) penalty -= 25;
  }
  // Classic failure mode: whole I-bar sits on the same ridge (4 cells @ center).
  if (piece.type === 'I' && piece.plane === 'XZ' && onMax >= 2) penalty += 1600;
  if (piece.plane === 'XZ' && onMax >= 3) penalty += 1200;
  return penalty;
}

/**
 * Prefer covering empty cells on the lowest incomplete layer (fill out, don't stack up).
 */
function lowestLayerFillBonus(before: Board, piece: ActivePiece): number {
  let targetY = -1;
  for (let y = 0; y < HEIGHT; y++) {
    let filled = 0;
    let empty = 0;
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (before.cells[y][z][x] !== null) filled++;
        else empty++;
      }
    }
    if (empty > 0 && filled > 0) {
      targetY = y;
      break;
    }
    if (filled === 0) {
      targetY = y;
      break;
    }
  }
  if (targetY < 0) return 0;

  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  let covered = 0;
  let wastedHigh = 0;
  for (const c of cells) {
    if (c.y === targetY && before.cells[c.y][c.z][c.x] === null) covered++;
    if (c.y > targetY) wastedHigh++;
  }
  return covered * 220 - wastedHigh * 160;
}


/** Columns that look like vertical slots (neighbors taller by ≥2). */
function wellColumns(heights: Int16Array): Set<string> {
  const wells = new Set<string>();
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const h = heights[z * SIZE + x];
      const neigh: number[] = [];
      if (x > 0) neigh.push(heights[z * SIZE + (x - 1)]);
      if (x + 1 < SIZE) neigh.push(heights[z * SIZE + (x + 1)]);
      if (z > 0) neigh.push(heights[(z - 1) * SIZE + x]);
      if (z + 1 < SIZE) neigh.push(heights[(z + 1) * SIZE + x]);
      if (neigh.length === 0) continue;
      const nMin = Math.min(...neigh);
      const nMax = Math.max(...neigh);
      // Deep slot between taller stacks, or low column with a tall neighbor.
      if (nMin >= h + 2 || (h <= 2 && nMax >= h + 3)) {
        wells.add(`${x},${z}`);
      }
    }
  }
  return wells;
}

/**
 * I-piece policy (anti-skyscraper):
 * - Vertical I only to fill a *shallow* well up toward neighbors — never grow a tower.
 * - Prefer flat I on the lowest incomplete layer when the board already has tall columns.
 * - XZ I stays flat; reward low corridors, punish stacking.
 */
function longBarBonus(before: Board, piece: ActivePiece, heights: Int16Array): number {
  if (piece.type !== 'I') return 0;
  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  const cols = new Set(cells.map((c) => `${c.x},${c.z}`));
  const ys = new Set(cells.map((c) => c.y));
  const wells = wellColumns(heights);
  const isVertical = piece.plane === 'XY' && cols.size === 1 && ys.size >= 3;
  const isFlatBar = ys.size <= 2 && cols.size >= 3;

  let sum = 0;
  let maxH = 0;
  for (let i = 0; i < heights.length; i++) {
    sum += heights[i];
    if (heights[i] > maxH) maxH = heights[i];
  }
  const avg = sum / heights.length;

  if (piece.plane === 'XY') {
    if (isVertical) {
      const key = [...cols][0]!;
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      const h = heights[cz * SIZE + cx];
      const afterH = h + ys.size; // ~+4 for full I

      // Hard ban: no skyscrapers / stacking on already-high columns.
      if (h >= 3) return -2800;
      if (afterH > avg + 3) return -2200;
      if (afterH >= maxH + 2 && maxH >= 2) return -2400;

      // Only reward filling a real well that stays near neighbor height.
      if (wells.has(key) && h <= 2) {
        const neigh: number[] = [];
        if (cx > 0) neigh.push(heights[cz * SIZE + (cx - 1)]);
        if (cx + 1 < SIZE) neigh.push(heights[cz * SIZE + (cx + 1)]);
        if (cz > 0) neigh.push(heights[(cz - 1) * SIZE + cx]);
        if (cz + 1 < SIZE) neigh.push(heights[(cz + 1) * SIZE + cx]);
        const nMin = neigh.length ? Math.min(...neigh) : h;
        // Good if we close the gap without overshooting neighbors much.
        if (afterH <= nMin + 1) return 900;
        return -800;
      }

      // Early game empty floor column — mild OK once.
      if (h === 0 && maxH <= 1) return 250;
      return -900;
    }

    if (isFlatBar) {
      // Prefer flat fill of low empty cells; don't force vertical when towers exist.
      let emptyLow = 0;
      let onTall = 0;
      for (const c of cells) {
        if (c.y <= 1 && before.cells[c.y][c.z][c.x] === null) emptyLow++;
        const colH = heights[c.z * SIZE + c.x];
        if (colH >= Math.max(2, maxH - 1)) onTall++;
      }
      let score = emptyLow * 120;
      if (Math.min(...ys) >= 2) score -= 900;
      if (onTall >= 3) score -= 1500;
      // If board already has a tower, flat low fill is better than another vertical.
      if (maxH >= 4) score += 400;
      return score;
    }
  }

  if (piece.plane === 'XZ' && isFlatBar) {
    let emptyLow = 0;
    let onTall = 0;
    for (const c of cells) {
      if (c.y <= 1 && before.cells[c.y][c.z][c.x] === null) emptyLow++;
      if (heights[c.z * SIZE + c.x] >= Math.max(2, maxH - 1)) onTall++;
    }
    let score = emptyLow * 110;
    if (Math.min(...ys) >= 2) score -= 1000;
    if (onTall >= 3) score -= 1800;
    return score;
  }

  return 0;
}

/**
 * Vertical (XY) strips: park them in low / empty columns and spread across the footprint.
 */
function verticalStripBonus(_before: Board, piece: ActivePiece, heights: Int16Array): number {
  if (piece.plane !== 'XY') return 0;
  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  const cols = new Map<string, number>();
  let minColH = HEIGHT;
  let sumColH = 0;
  for (const c of cells) {
    const key = `${c.x},${c.z}`;
    if (!cols.has(key)) {
      const h = heights[c.z * SIZE + c.x];
      cols.set(key, h);
      sumColH += h;
      if (h < minColH) minColH = h;
    }
  }
  const n = cols.size || 1;
  const avgCol = sumColH / n;
  // Prefer low columns and covering several distinct footprint cells when shape allows.
  let bonus = (8 - avgCol) * 55 + (4 - minColH) * 30 + n * 40;

  // Single-column tall strips: only a mild nudge on *short* columns; never on towers.
  const ys = new Set(cells.map((c) => c.y));
  if (ys.size >= 3 && n === 1) {
    if (avgCol >= 3) bonus -= 800;
    else bonus += (3 - avgCol) * 40;
  }

  // Don't plant a vertical strip against an existing tall ridge (extends the wall).
  for (const [key, h] of cols) {
    const [xs, zs] = key.split(',').map(Number) as [number, number];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = xs + dx;
      const nz = zs + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
      const nh = heights[nz * SIZE + nx];
      if (nh >= h + 2 && nh >= 3) bonus -= 120;
    }
  }
  return bonus;
}

function evaluateBoard(
  before: Board,
  after: Board,
  cleared: number,
  landingY: number,
  piece: ActivePiece | null,
): number {
  const heights = columnHeights(after);
  let aggregate = 0;
  let maxH = 0;
  let bump = 0;

  for (let i = 0; i < heights.length; i++) {
    const hh = heights[i];
    aggregate += hh;
    if (hh > maxH) maxH = hh;
  }
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE - 1; x++) {
      bump += Math.abs(heights[z * SIZE + x] - heights[z * SIZE + x + 1]);
    }
  }
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE - 1; z++) {
      bump += Math.abs(heights[z * SIZE + x] - heights[(z + 1) * SIZE + x]);
    }
  }

  const { holes, deepHoles } = countHoles(after);
  const pack = layerPackingScore(after);
  const walls = wallPenalty(heights);
  const clearBonus = cleared * 8000 + (cleared >= 2 ? cleared * 3500 : 0) + (cleared >= 3 ? 5000 : 0);
  const danger =
    maxH >= HEIGHT - 5 ? (maxH - (HEIGHT - 6)) * (maxH - (HEIGHT - 6)) * 700 : 0;

  let place = 0;
  if (piece) {
    const heightsBefore = columnHeights(before);
    place += contactScore(before, piece, heightsBefore);
    place -= ridgeStackPenalty(piece, heightsBefore);
    place += lowestLayerFillBonus(before, piece);
    place += verticalStripBonus(before, piece, heightsBefore);
    place += longBarBonus(before, piece, heightsBefore);
    if (piece.plane === 'XZ') {
      // Flat pieces should extend the lowest shelf, not climb the wall.
      place -= landingY * 100;
      if (landingY >= 2) place -= landingY * 160;
    } else {
      place -= landingY * 35;
    }
  }

  return (
    clearBonus +
    pack +
    place -
    walls -
    holes * 1600 -
    deepHoles * 1100 -
    aggregate * 30 -
    bump * 48 -
    maxH * 150 -
    landingY * 20 -
    danger
  );
}

function simulateLock(board: Board, piece: ActivePiece): { board: Board; cleared: number } {
  const next = board.clone();
  next.lock(piece);
  const cleared = next.clearFullLayers();
  return { board: next, cleared };
}

function* iterDrops(board: Board, spec: PieceSpec): Generator<ActivePiece> {
  for (let rotation = 0; rotation < 4; rotation++) {
    const probe = cellsForPiece(spec.type, spec.plane, rotation, 0, 0, 0);
    if (probe.length === 0) continue;
    const xs = probe.map((c) => c.x);
    const zs = probe.map((c) => c.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const x0 = -minX;
    const x1 = SIZE - (maxX - minX) - minX;
    const z0 = -minZ;
    const z1 = SIZE - (maxZ - minZ) - minZ;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const dropped = dropPlacement(board, spec.type, spec.plane, rotation, x, z);
        if (dropped) yield dropped;
      }
    }
  }
}

function scoreDrop(board: Board, dropped: ActivePiece): {
  placement: Placement;
  after: Board;
  cleared: number;
} {
  const { board: after, cleared } = simulateLock(board, dropped);
  const score = evaluateBoard(board, after, cleared, dropped.y, dropped);
  return {
    placement: {
      plane: dropped.plane,
      rotation: dropped.rotation,
      x: dropped.x,
      z: dropped.z,
      y: dropped.y,
      score,
    },
    after,
    cleared,
  };
}

function bestImmediate(
  board: Board,
  spec: PieceSpec,
): { placement: Placement; after: Board; cleared: number } | null {
  let best: { placement: Placement; after: Board; cleared: number } | null = null;
  const planes: Plane[] = [spec.plane, spec.plane === 'XY' ? 'XZ' : 'XY'];
  for (const p of planes) {
    for (const dropped of iterDrops(board, { type: spec.type, plane: p })) {
      const cand = scoreDrop(board, dropped);
      if (!best || cand.placement.score > best.placement.score) best = cand;
    }
  }
  return best;
}

/**
 * Search rotations × footprint for the best drop.
 * Avoids stacking flat pieces into walls; spreads vertical strips into low columns.
 */
export function findBestPlacement(
  board: Board,
  type: PieceType,
  plane: Plane,
  _level: number,
  next?: PieceSpec | null,
): Placement | null {
  const planes: Plane[] = [plane, plane === 'XY' ? 'XZ' : 'XY'];
  const candidates: Array<{ placement: Placement; after: Board; cleared: number }> = [];

  for (const p of planes) {
    for (const dropped of iterDrops(board, { type, plane: p })) {
      candidates.push(scoreDrop(board, dropped));
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.placement.score - a.placement.score);

  const topN = next ? Math.min(10, candidates.length) : 1;
  let best: Placement | null = null;

  for (let i = 0; i < topN; i++) {
    const c = candidates[i]!;
    let total = c.placement.score;
    if (next) {
      const follow = bestImmediate(c.after, next);
      if (follow) {
        total = c.placement.score * 0.5 + follow.placement.score * 0.9;
      } else {
        total -= 5000;
      }
    }
    if (!best || total > best.score) {
      best = { ...c.placement, score: total };
    }
  }

  return best;
}
