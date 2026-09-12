import { Board, HEIGHT, SIZE, scoreForLines } from './board';
import { cellsForPiece, planeLabel, randomPlane, randomType } from './pieces';
import type { ActivePiece, GamePhase, GameStats, PieceType, Plane } from './types';

export interface SpawnedPreview {
  type: PieceType;
  plane: Plane;
}

function makePreview(iOnly = false): SpawnedPreview {
  return { type: iOnly ? 'I' : randomType(), plane: randomPlane() };
}

function spawnFrom(preview: SpawnedPreview): ActivePiece {
  const piece: ActivePiece = {
    type: preview.type,
    plane: preview.plane,
    rotation: 0,
    x: 0,
    y: 0,
    z: 0,
  };
  // Center roughly in footprint; place near top.
  const matrixW = cellsForPiece(piece.type, piece.plane, 0, 0, 0, 0);
  const xs = matrixW.map((c) => c.x);
  const zs = matrixW.map((c) => c.z);
  const ys = matrixW.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const maxY = Math.max(...ys);
  piece.x = Math.floor((SIZE - (maxX - minX + 1)) / 2) - minX;
  piece.z = Math.floor((SIZE - (maxZ - minZ + 1)) / 2) - minZ;
  piece.y = HEIGHT - 1 - maxY;
  return piece;
}

export class Engine {
  board = new Board();
  active: ActivePiece | null = null;
  next: SpawnedPreview = makePreview();
  phase: GamePhase = 'ready';
  stats: GameStats = { score: 0, lines: 0, level: 1 };
  dropMs = 800;
  /** Training: every piece is an I (long bar). */
  spawnIOnly = false;
  private lockResets = 0;
  private readonly maxLockResets = 12;

  reset(): void {
    this.board = new Board();
    this.next = makePreview(this.spawnIOnly);
    this.active = null;
    this.phase = 'ready';
    this.stats = { score: 0, lines: 0, level: 1 };
    this.dropMs = 800;
    this.lockResets = 0;
  }

  start(): void {
    this.reset();
    this.phase = 'playing';
    this.spawn();
  }

  togglePause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'playing';
  }

  private updateSpeed(): void {
    this.stats.level = Math.floor(this.stats.lines / 10) + 1;
    this.dropMs = Math.max(120, 800 - (this.stats.level - 1) * 60);
  }

  spawn(): boolean {
    const piece = spawnFrom(this.next);
    this.next = makePreview(this.spawnIOnly);
    this.lockResets = 0;
    if (!this.board.fits(piece)) {
      this.active = piece;
      this.phase = 'over';
      return false;
    }
    this.active = piece;
    return true;
  }

  tryMove(dx: number, dy: number, dz: number): boolean {
    if (this.phase !== 'playing' || !this.active) return false;
    const next = { ...this.active, x: this.active.x + dx, y: this.active.y + dy, z: this.active.z + dz };
    if (!this.board.fits(next)) return false;
    this.active = next;
    if (dy === 0) this.lockResets = Math.min(this.maxLockResets, this.lockResets + 1);
    return true;
  }

  /** In-plane rotation only (XY → around Z, XZ → around Y). */
  tryRotate(): boolean {
    if (this.phase !== 'playing' || !this.active) return false;
    const next = { ...this.active, rotation: (this.active.rotation + 1) % 4 };
    // Simple wall kicks: try offsets in X/Z (and tiny Y for XY pieces).
    // Extra downward kicks: I flat→upright near the ceiling needs 2–3 cells of headroom.
    const kicks: Array<[number, number, number]> = [
      [0, 0, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0, 0, 1],
      [-2, 0, 0],
      [2, 0, 0],
      [0, -1, 0],
      [0, -2, 0],
      [0, -3, 0],
      [0, -4, 0],
      [-1, -2, 0],
      [1, -2, 0],
      [-2, -2, 0],
      [2, -2, 0],
      [0, 0, -2],
      [0, 0, 2],
      [0, 1, 0],
    ];
    for (const [kx, ky, kz] of kicks) {
      const kicked = { ...next, x: next.x + kx, y: next.y + ky, z: next.z + kz };
      if (this.board.fits(kicked)) {
        this.active = kicked;
        this.lockResets = Math.min(this.maxLockResets, this.lockResets + 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Flip face only: XY ↔ XZ. Keeps the same rotation index (matrix reinterpreted).
   * Does not in-plane-rotate.
   */
  tryFlip(): boolean {
    if (this.phase !== 'playing' || !this.active) return false;
    const flipped = {
      ...this.active,
      plane: (this.active.plane === 'XY' ? 'XZ' : 'XY') as typeof this.active.plane,
    };
    const kicks: Array<[number, number, number]> = [
      [0, 0, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0, 0, 1],
      [0, -1, 0],
      [0, 1, 0],
      [-2, 0, 0],
      [2, 0, 0],
      [0, 0, -2],
      [0, 0, 2],
    ];
    for (const [kx, ky, kz] of kicks) {
      const kicked = { ...flipped, x: flipped.x + kx, y: flipped.y + ky, z: flipped.z + kz };
      if (this.board.fits(kicked)) {
        this.active = kicked;
        this.lockResets = Math.min(this.maxLockResets, this.lockResets + 1);
        return true;
      }
    }
    return false;
  }

  softDrop(): boolean {
    return this.tryMove(0, -1, 0);
  }

  hardDrop(): { dist: number; cleared: number } {
    if (this.phase !== 'playing' || !this.active) return { dist: 0, cleared: 0 };
    let dist = 0;
    while (this.tryMove(0, -1, 0)) dist++;
    const cleared = this.lockPiece();
    return { dist, cleared };
  }

  /** Gravity tick. Returns whether the piece locked and how many layers cleared. */
  tickGravity(): { locked: boolean; cleared: number } {
    if (this.phase !== 'playing' || !this.active) return { locked: false, cleared: 0 };
    if (this.tryMove(0, -1, 0)) return { locked: false, cleared: 0 };
    const cleared = this.lockPiece();
    return { locked: true, cleared };
  }

  /** Lock active piece; returns layers cleared (0 if none / no active). */
  private lockPiece(): number {
    if (!this.active) return 0;
    this.board.lock(this.active);
    this.active = null;
    const cleared = this.board.clearFullLayers();
    if (cleared > 0) {
      this.stats.lines += cleared;
      this.stats.score += scoreForLines(cleared, this.stats.level);
      this.updateSpeed();
    }
    // Score only from cleared layers — locking a piece alone does not add points.
    if (!this.spawn()) {
      // game over already set in spawn
    }
    return cleared;
  }

  ghostCells() {
    if (!this.active) return [];
    let ghost = { ...this.active };
    while (true) {
      const next = { ...ghost, y: ghost.y - 1 };
      if (!this.board.fits(next)) break;
      ghost = next;
    }
    return cellsForPiece(ghost.type, ghost.plane, ghost.rotation, ghost.x, ghost.y, ghost.z);
  }

  nextLabel(): string {
    return `${this.next.type} · ${planeLabel(this.next.plane)}`;
  }
}
