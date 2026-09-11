import { Board, HEIGHT, SIZE, scoreForLines } from './board';
import { cellsForPiece, planeLabel, randomPlane, randomType } from './pieces';
import type { ActivePiece, GamePhase, GameStats, PieceType, Plane } from './types';

export interface SpawnedPreview {
  type: PieceType;
  plane: Plane;
}

function makePreview(): SpawnedPreview {
  return { type: randomType(), plane: randomPlane() };
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
  private lockResets = 0;
  private readonly maxLockResets = 12;

  reset(): void {
    this.board = new Board();
    this.next = makePreview();
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
    this.next = makePreview();
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
    const kicks: Array<[number, number, number]> = [
      [0, 0, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0, 0, 1],
      [-2, 0, 0],
      [2, 0, 0],
      [0, -1, 0],
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

  softDrop(): boolean {
    return this.tryMove(0, -1, 0);
  }

  hardDrop(): number {
    if (this.phase !== 'playing' || !this.active) return 0;
    let dist = 0;
    while (this.tryMove(0, -1, 0)) dist++;
    this.lockPiece();
    return dist;
  }

  /** Gravity tick. Returns true if piece locked. */
  tickGravity(): boolean {
    if (this.phase !== 'playing' || !this.active) return false;
    if (this.tryMove(0, -1, 0)) return false;
    // Cannot move down — lock unless we've been resetting forever.
    this.lockPiece();
    return true;
  }

  private lockPiece(): void {
    if (!this.active) return;
    this.board.lock(this.active);
    this.active = null;
    const cleared = this.board.clearFullLayers();
    if (cleared > 0) {
      this.stats.lines += cleared;
      this.stats.score += scoreForLines(cleared, this.stats.level);
      this.updateSpeed();
    }
    this.stats.score += 10;
    if (!this.spawn()) {
      // game over already set in spawn
    }
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
