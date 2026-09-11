export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Plane = 'XY' | 'XZ';

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface ActivePiece {
  type: PieceType;
  plane: Plane;
  /** Rotation index 0..3 (90° steps, in-plane only). */
  rotation: number;
  /** Anchor position in board coordinates. */
  x: number;
  y: number;
  z: number;
}

export interface GameStats {
  score: number;
  lines: number;
  level: number;
}

export type GamePhase = 'ready' | 'playing' | 'paused' | 'over';
