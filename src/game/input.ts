/**
 * Touch / pointer + keyboard input.
 * Swipe directions are mapped using camera-relative axes supplied by the caller
 * so screen-left always moves the piece left from the player's view.
 */

export type MoveDir = 'left' | 'right' | 'forward' | 'back';

export interface InputHandlers {
  onMove: (dir: MoveDir) => void;
  onRotate: () => void;
  onSoftDropStart: () => void;
  onSoftDropEnd: () => void;
  onHardDrop: () => void;
  onPause: () => void;
  onRestart: () => void;
}

export interface AxisMap {
  /** World step for screen-left swipe. */
  left: { dx: number; dz: number };
  right: { dx: number; dz: number };
  /** Screen-up (away from camera on ground). */
  forward: { dx: number; dz: number };
  back: { dx: number; dz: number };
}

const TAP_MAX_MS = 280;
const TAP_MAX_DIST = 18;
const SWIPE_THRESHOLD = 28;
const STEP_PX = 36;

export class InputController {
  private axis: AxisMap = {
    left: { dx: -1, dz: 0 },
    right: { dx: 1, dz: 0 },
    forward: { dx: 0, dz: -1 },
    back: { dx: 0, dz: 1 },
  };

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private accX = 0;
  private accY = 0;
  private moved = false;

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  constructor(
    private readonly target: HTMLElement,
    private readonly handlers: InputHandlers,
  ) {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  setAxisMap(map: AxisMap): void {
    this.axis = map;
  }

  attach(): void {
    this.target.addEventListener('pointerdown', this.onPointerDown);
    this.target.addEventListener('pointermove', this.onPointerMove);
    this.target.addEventListener('pointerup', this.onPointerUp);
    this.target.addEventListener('pointercancel', this.onPointerUp);
    this.target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerUp);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('button, #overlay, #controls, #hud')) return;

    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startT = performance.now();
    this.accX = 0;
    this.accY = 0;
    this.moved = false;
    try {
      this.target.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.hypot(dx, dy) > TAP_MAX_DIST) this.moved = true;

    const stepDx = dx - this.accX;
    const stepDy = dy - this.accY;
    if (Math.hypot(stepDx, stepDy) >= STEP_PX) {
      this.emitSwipe(stepDx, stepDy);
      this.accX = dx;
      this.accY = dy;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const dt = performance.now() - this.startT;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dist = Math.hypot(dx, dy);

    if (!this.moved && dist <= TAP_MAX_DIST && dt <= TAP_MAX_MS) {
      this.handlers.onRotate();
    } else if (dist >= SWIPE_THRESHOLD && this.accX === 0 && this.accY === 0) {
      this.emitSwipe(dx, dy);
    }

    this.pointerId = null;
  }

  private emitSwipe(dx: number, dy: number): void {
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.handlers.onMove(dx < 0 ? 'left' : 'right');
    } else {
      this.handlers.onMove(dy < 0 ? 'forward' : 'back');
    }
  }

  dirToDelta(dir: MoveDir): { dx: number; dz: number } {
    return this.axis[dir];
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this.handlers.onMove('left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this.handlers.onMove('right');
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        this.handlers.onMove('forward');
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        this.handlers.onSoftDropStart();
        break;
      case ' ':
        e.preventDefault();
        this.handlers.onHardDrop();
        break;
      case 'x':
      case 'X':
      case 'k':
      case 'K':
      case 'z':
      case 'Z':
        e.preventDefault();
        this.handlers.onRotate();
        break;
      case 'p':
      case 'P':
        this.handlers.onPause();
        break;
      case 'r':
      case 'R':
        this.handlers.onRestart();
        break;
      default:
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      this.handlers.onSoftDropEnd();
    }
  }
}

/**
 * Build discrete XZ move axes from camera so screen-left ≈ player's left.
 */
export function axisMapFromCamera(
  camX: number,
  _camY: number,
  camZ: number,
  targetX: number,
  _targetY: number,
  targetZ: number,
): AxisMap {
  const fx = targetX - camX;
  const fz = targetZ - camZ;
  const flen = Math.hypot(fx, fz) || 1;
  const dirX = fx / flen;
  const dirZ = fz / flen;

  // Right on XZ = perpendicular to look-on-ground (Y-up).
  let grx = -dirZ;
  let grz = dirX;
  const grlen = Math.hypot(grx, grz) || 1;
  grx /= grlen;
  grz /= grlen;

  const snap = (x: number, z: number): { dx: number; dz: number } => {
    if (Math.abs(x) >= Math.abs(z)) {
      return { dx: x >= 0 ? 1 : -1, dz: 0 };
    }
    return { dx: 0, dz: z >= 0 ? 1 : -1 };
  };

  const right = snap(grx, grz);
  const forward = snap(dirX, dirZ);

  return {
    left: { dx: -right.dx, dz: -right.dz },
    right: { dx: right.dx, dz: right.dz },
    forward: { dx: forward.dx, dz: forward.dz },
    back: { dx: -forward.dx, dz: -forward.dz },
  };
}
