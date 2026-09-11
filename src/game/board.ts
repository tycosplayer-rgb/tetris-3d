import { cellsForPiece } from './pieces';
import type { ActivePiece, Cell, PieceType } from './types';

/** Square footprint (X == Z). Sensible vertical height. */
export const SIZE = 8;
export const HEIGHT = 16;

export type BoardCell = PieceType | null;

export class Board {
  /** Indexed [y][z][x] */
  readonly cells: BoardCell[][][];

  constructor() {
    this.cells = [];
    for (let y = 0; y < HEIGHT; y++) {
      const layer: BoardCell[][] = [];
      for (let z = 0; z < SIZE; z++) {
        layer.push(Array.from({ length: SIZE }, () => null));
      }
      this.cells.push(layer);
    }
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < SIZE && y >= 0 && y < HEIGHT && z >= 0 && z < SIZE;
  }

  isEmpty(x: number, y: number, z: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    return this.cells[y][z][x] === null;
  }

  fits(piece: ActivePiece): boolean {
    const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
    return cells.every((c) => this.isEmpty(c.x, c.y, c.z));
  }

  lock(piece: ActivePiece): Cell[] {
    const cells = cellsForPiece(piece.type, piece.plane, piece.rotation, piece.x, piece.y, piece.z);
    for (const c of cells) {
      if (this.inBounds(c.x, c.y, c.z)) {
        this.cells[c.y][c.z][c.x] = piece.type;
      }
    }
    return cells;
  }

  /** Clear full horizontal XZ layers. Returns number of lines cleared. */
  clearFullLayers(): number {
    const remaining: BoardCell[][][] = [];
    let cleared = 0;
    for (let y = 0; y < HEIGHT; y++) {
      let full = true;
      for (let z = 0; z < SIZE && full; z++) {
        for (let x = 0; x < SIZE; x++) {
          if (this.cells[y][z][x] === null) {
            full = false;
            break;
          }
        }
      }
      if (full) {
        cleared++;
      } else {
        remaining.push(this.cells[y]);
      }
    }
    while (remaining.length < HEIGHT) {
      const layer: BoardCell[][] = [];
      for (let z = 0; z < SIZE; z++) {
        layer.push(Array.from({ length: SIZE }, () => null));
      }
      remaining.push(layer);
    }
    for (let y = 0; y < HEIGHT; y++) {
      this.cells[y] = remaining[y];
    }
    return cleared;
  }

  /** True if any cell in the top spawn band is occupied (used for game-over checks). */
  topBlocked(): boolean {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (this.cells[HEIGHT - 1][z][x] !== null) return true;
      }
    }
    return false;
  }
}

export function scoreForLines(lines: number, level: number): number {
  const base = [0, 100, 300, 500, 800];
  const n = Math.min(lines, 4);
  return (base[n] ?? 800) * level;
}
