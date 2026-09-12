import { Board, HEIGHT, SIZE, scoreForLines } from './board';
import type { ActivePiece, Plane, PieceType } from './types';

export interface Placement {
  rotation: number;
  x: number;
  z: number;
  y: number;
  score: number;
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

function columnHeights(board: Board): number[][] {
  const h: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      let height = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        if (board.cells[y][z][x] !== null) {
          height = y + 1;
          break;
        }
      }
      h[z][x] = height;
    }
  }
  return h;
}

function countHoles(board: Board): number {
  let holes = 0;
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      let blocked = false;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const filled = board.cells[y][z][x] !== null;
        if (filled) blocked = true;
        else if (blocked) holes++;
      }
    }
  }
  return holes;
}

function evaluateBoard(board: Board, cleared: number, landingY: number, level: number): number {
  const heights = columnHeights(board);
  let aggregate = 0;
  let maxH = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const hh = heights[z][x];
      aggregate += hh;
      if (hh > maxH) maxH = hh;
    }
  }

  let bump = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE - 1; x++) {
      bump += Math.abs(heights[z][x] - heights[z][x + 1]);
    }
  }
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE - 1; z++) {
      bump += Math.abs(heights[z][x] - heights[z + 1][x]);
    }
  }

  const holes = countHoles(board);
  const clearBonus =
    cleared * 5200 +
    (cleared >= 2 ? cleared * 1800 : 0) +
    (cleared >= 3 ? 2500 : 0) +
    scoreForLines(cleared, level);

  return (
    clearBonus -
    holes * 380 -
    aggregate * 18 -
    bump * 12 -
    maxH * 55 -
    landingY * 8 -
    (maxH >= HEIGHT - 3 ? (maxH - (HEIGHT - 4)) * 900 : 0)
  );
}

function simulateLock(board: Board, piece: ActivePiece): { board: Board; cleared: number } {
  const next = board.clone();
  next.lock(piece);
  const cleared = next.clearFullLayers();
  return { board: next, cleared };
}

/**
 * Search rotations × footprint for the best drop.
 * Maximizes clears / score while keeping the stack low and hole-free.
 */
export function findBestPlacement(
  board: Board,
  type: PieceType,
  plane: Plane,
  level: number,
): Placement | null {
  let best: Placement | null = null;

  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -3; x < SIZE + 3; x++) {
      for (let z = -3; z < SIZE + 3; z++) {
        const dropped = dropPlacement(board, type, plane, rotation, x, z);
        if (!dropped) continue;
        const { board: after, cleared } = simulateLock(board, dropped);
        const score = evaluateBoard(after, cleared, dropped.y, level);
        if (!best || score > best.score) {
          best = { rotation, x: dropped.x, z: dropped.z, y: dropped.y, score };
        }
      }
    }
  }

  return best;
}
