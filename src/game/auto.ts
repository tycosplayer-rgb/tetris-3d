import { Board, HEIGHT, SIZE } from './board';
import { cellsForPiece } from './pieces';
import type { ActivePiece, Plane, PieceType } from './types';

export interface Placement {
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
  // indexed z * SIZE + x
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

/** How packed lower layers are — critical for eventually clearing 8×8 slabs. */
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
    // Prefer nearly-full low layers; punish sparse mid-height clutter.
    const lowBias = (HEIGHT - y) / HEIGHT;
    score += frac * frac * 420 * lowBias;
    // Almost-complete layers are very valuable (one more piece may clear).
    if (filled >= SIZE * SIZE - 8) score += 900 * lowBias;
    if (filled >= SIZE * SIZE - 4) score += 1600 * lowBias;
  }
  return score;
}

function contactBonus(board: Board, piece: ActivePiece): number {
  const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
  const set = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
  let touches = 0;
  const dirs: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const c of cells) {
    for (const [dx, dy, dz] of dirs) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const nz = c.z + dz;
      if (set.has(`${nx},${ny},${nz}`)) continue;
      if (ny < 0) {
        touches += 2; // floor
        continue;
      }
      if (!board.inBounds(nx, ny, nz)) {
        touches += 1; // wall
        continue;
      }
      if (board.cells[ny][nz][nx] !== null) touches += 2;
    }
  }
  return touches * 18;
}

function evaluateBoard(
  board: Board,
  cleared: number,
  landingY: number,
  piece: ActivePiece | null,
): number {
  const heights = columnHeights(board);
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

  const { holes, deepHoles } = countHoles(board);
  const pack = layerPackingScore(board);
  const contact = piece ? contactBonus(board, piece) : 0;

  // Clears matter, but survival (no holes / low stack) matters more early.
  const clearBonus = cleared * 8000 + (cleared >= 2 ? cleared * 3500 : 0) + (cleared >= 3 ? 5000 : 0);

  const danger =
    maxH >= HEIGHT - 5 ? (maxH - (HEIGHT - 6)) * (maxH - (HEIGHT - 6)) * 700 : 0;

  // XY pieces span multiple floors — keep them short and tucked, or they kill clears.
  let planeBias = 0;
  if (piece?.plane === 'XY') {
    planeBias -= landingY * 40;
    planeBias -= Math.max(0, maxH - 6) * 80;
  } else if (piece?.plane === 'XZ') {
    planeBias += 120; // flat pieces are what actually complete layers
    planeBias -= landingY * 10;
  }

  return (
    clearBonus +
    pack +
    contact +
    planeBias -
    holes * 1600 -
    deepHoles * 1100 -
    aggregate * 32 -
    bump * 40 -
    maxH * 140 -
    landingY * 30 -
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

function bestImmediate(
  board: Board,
  spec: PieceSpec,
): { placement: Placement; after: Board; cleared: number } | null {
  let best: { placement: Placement; after: Board; cleared: number } | null = null;
  for (const dropped of iterDrops(board, spec)) {
    const { board: after, cleared } = simulateLock(board, dropped);
    const score = evaluateBoard(after, cleared, dropped.y, dropped);
    if (!best || score > best.placement.score) {
      best = {
        placement: {
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
  }
  return best;
}

/**
 * Search rotations × footprint for the best drop.
 * Uses a survival-first heuristic and one-ply look-ahead on the next piece.
 */
export function findBestPlacement(
  board: Board,
  type: PieceType,
  plane: Plane,
  _level: number,
  next?: PieceSpec | null,
): Placement | null {
  const current: PieceSpec = { type, plane };
  const candidates: Array<{ placement: Placement; after: Board; cleared: number }> = [];

  for (const dropped of iterDrops(board, current)) {
    const { board: after, cleared } = simulateLock(board, dropped);
    const score = evaluateBoard(after, cleared, dropped.y, dropped);
    candidates.push({
      placement: {
        rotation: dropped.rotation,
        x: dropped.x,
        z: dropped.z,
        y: dropped.y,
        score,
      },
      after,
      cleared,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.placement.score - a.placement.score);

  // Look-ahead on top candidates only (keeps mobile FPS stable).
  const topN = next ? Math.min(8, candidates.length) : 1;
  let best: Placement | null = null;

  for (let i = 0; i < topN; i++) {
    const c = candidates[i]!;
    let total = c.placement.score;
    if (next) {
      const follow = bestImmediate(c.after, next);
      if (follow) {
        // Blend in successor board quality (already includes its clear bonus).
        total = c.placement.score * 0.55 + follow.placement.score * 0.85;
      } else {
        total -= 5000; // next piece cannot be placed — avoid
      }
    }
    if (!best || total > best.score) {
      best = { ...c.placement, score: total };
    }
  }

  return best;
}
