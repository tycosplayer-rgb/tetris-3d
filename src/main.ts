import { findBestPlacement, type Placement } from './game/auto';
import { Engine } from './game/engine';
import { InputController, axisMapFromCamera, type MoveDir } from './game/input';
import { GameRenderer } from './game/render';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const scoreEl = document.querySelector('#score')!;
const linesEl = document.querySelector('#lines')!;
const levelEl = document.querySelector('#level')!;
const nextEl = document.querySelector('#next-label')!;
const overlay = document.querySelector('#overlay')!;
const overlayTitle = document.querySelector('#overlay-title')!;
const overlayMsg = document.querySelector('#overlay-msg')!;
const btnStart = document.querySelector('#btn-start')!;
const btnAuto = document.querySelector<HTMLButtonElement>('#btn-auto')!;
const btnFlip = document.querySelector('#btn-flip')!;
const btnSoft = document.querySelector('#btn-soft')!;
const btnHard = document.querySelector('#btn-hard')!;
const btnPause = document.querySelector('#btn-pause')!;
const btnRestart = document.querySelector('#btn-restart')!;

const engine = new Engine();
const renderer = new GameRenderer(canvas);

let softDropping = false;
let dropAcc = 0;
let lastT = performance.now();
let needsSync = true;

/** manual | semi (CPU until I) | full (CPU always) — one button cycles these. */
type PlayMode = 'manual' | 'semi' | 'full' | 'train';
let playMode: PlayMode = 'manual';
let autoTarget: Placement | null = null;
let autoPieceKey = '';
let autoAcc = 0;
const AUTO_STEP_MS = 70;
/** Prevent a catch-up storm (and AI search storm) after a long frame. */
const AUTO_MAX_STEPS_PER_FRAME = 2;

function pieceSpawnKey(): string {
  const a = engine.active;
  if (!a) return '';
  // Stable for one falling piece: type/plane + lines/score change only after lock.
  return `${a.type}:${a.plane}:L${engine.stats.lines}:S${engine.stats.score}`;
}

function updateHud(): void {
  scoreEl.textContent = String(engine.stats.score);
  linesEl.textContent = String(engine.stats.lines);
  levelEl.textContent = String(engine.stats.level);
  nextEl.textContent = engine.nextLabel();
  const cpu = playMode !== 'manual';
  btnAuto.classList.toggle('active', cpu);
  btnAuto.textContent =
    playMode === 'manual'
      ? '手动'
      : playMode === 'semi'
        ? '半自动'
        : playMode === 'full'
          ? '自动'
          : '自动训练';
}

function showOverlay(title: string, msg: string, button = 'Start'): void {
  overlayTitle.textContent = title;
  overlayMsg.textContent = msg;
  btnStart.textContent = button;
  overlay.classList.remove('hidden');
}

function hideOverlay(): void {
  overlay.classList.add('hidden');
}

function syncView(): void {
  renderer.sync(engine.board, engine.active, engine.ghostCells());
  updateHud();
  needsSync = false;
}

function move(dir: MoveDir): void {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  const { dx, dz } = input.dirToDelta(dir);
  if (engine.tryMove(dx, 0, dz)) needsSync = true;
}

function rotate(): void {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  if (engine.tryRotate()) needsSync = true;
}

function flip(): void {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  if (engine.tryFlip()) needsSync = true;
}

function refreshAxis(): void {
  const { cam, target } = renderer.getCameraPose();
  input.setAxisMap(axisMapFromCamera(cam.x, cam.y, cam.z, target.x, target.y, target.z));
}

function startGame(): void {
  engine.start();
  hideOverlay();
  btnPause.textContent = 'Pause';
  dropAcc = 0;
  softDropping = false;
  autoTarget = null;
  autoPieceKey = '';
  autoAcc = 0;
  needsSync = true;
  refreshAxis();
}

function restartGame(): void {
  startGame();
}

function togglePause(): void {
  if (engine.phase === 'ready' || engine.phase === 'over') return;
  engine.togglePause();
  if (engine.phase === 'paused') {
    const pauseHint =
      playMode === 'semi'
        ? '半自动已暂停'
        : playMode === 'full'
          ? '自动已暂停'
          : playMode === 'train'
            ? '自动训练已暂停（仅长条）'
            : 'Swipe · Tap rotate · Flip button';
    showOverlay('Paused', pauseHint, 'Resume');
    btnPause.textContent = 'Resume';
  } else {
    hideOverlay();
    btnPause.textContent = 'Pause';
    lastT = performance.now();
  }
}

function maybeGameOver(): void {
  if (engine.phase === 'over') {
    autoTarget = null;
    showOverlay('Game Over', `Score ${engine.stats.score} · Lines ${engine.stats.lines}`, 'Restart');
  }
}

function isCpuPlaying(): boolean {
  return playMode === 'semi' || playMode === 'full' || playMode === 'train';
}

function setPlayMode(mode: PlayMode): void {
  playMode = mode;
  engine.spawnIOnly = mode === 'train';
  autoTarget = null;
  autoPieceKey = '';
  autoAcc = 0;
  softDropping = false;
  updateHud();
  // Train always restarts on a fresh I-only board for clean analysis.
  if (mode === 'train') {
    startGame();
  } else if (isCpuPlaying() && (engine.phase === 'ready' || engine.phase === 'over')) {
    startGame();
  }
  if (playMode === 'semi') handoffLongBarIfNeeded();
}

function cyclePlayMode(): void {
  const order: PlayMode[] = ['manual', 'semi', 'full', 'train'];
  const i = order.indexOf(playMode);
  setPlayMode(order[(i + 1) % order.length]!);
}

/** Semi-auto only: on I (long bar), pause and switch to manual. */
function handoffLongBarIfNeeded(): boolean {
  if (playMode !== 'semi' || engine.phase !== 'playing' || !engine.active) return false;
  if (engine.active.type !== 'I') return false;
  setPlayMode('manual');
  engine.togglePause();
  showOverlay('长条', '半自动已切手动，请自己放这一块', '继续');
  btnPause.textContent = 'Resume';
  needsSync = true;
  return true;
}

function ensureAutoTarget(): void {
  const a = engine.active;
  if (!a) {
    autoTarget = null;
    autoPieceKey = '';
    return;
  }
  const key = pieceSpawnKey();
  if (autoTarget && autoPieceKey === key) return;
  try {
    autoTarget = findBestPlacement(engine.board, a.type, a.plane, engine.stats.level, {
      type: engine.next.type,
      plane: engine.next.plane,
    });
  } catch (err) {
    console.error('auto plan failed', err);
    autoTarget = null;
  }
  autoPieceKey = key;
}

/** One auto step: rotate / slide / hard-drop toward best placement. */
function autoStep(): void {
  if (!isCpuPlaying() || engine.phase !== 'playing' || !engine.active) return;
  if (handoffLongBarIfNeeded()) return;
  ensureAutoTarget();
  const a = engine.active;
  const t = autoTarget;
  if (!t) {
    engine.hardDrop();
    needsSync = true;
    autoTarget = null;
    maybeGameOver();
    return;
  }

  // Flip face first (XY↔XZ), then in-plane rotate, then slide.
  if (a.plane !== t.plane) {
    if (!engine.tryFlip()) {
      engine.hardDrop();
      autoTarget = null;
      maybeGameOver();
    }
    needsSync = true;
    return;
  }

  if (a.rotation !== t.rotation) {
    if (!engine.tryRotate()) {
      engine.hardDrop();
      autoTarget = null;
      maybeGameOver();
    }
    needsSync = true;
    return;
  }

  const dx = Math.sign(t.x - a.x);
  const dz = Math.sign(t.z - a.z);
  if (dx !== 0 || dz !== 0) {
    let moved = false;
    if (Math.abs(t.x - a.x) >= Math.abs(t.z - a.z)) {
      if (dx !== 0) moved = engine.tryMove(dx, 0, 0);
      if (!moved && dz !== 0) moved = engine.tryMove(0, 0, dz);
    } else {
      if (dz !== 0) moved = engine.tryMove(0, 0, dz);
      if (!moved && dx !== 0) moved = engine.tryMove(dx, 0, 0);
    }
    if (!moved) {
      engine.hardDrop();
      autoTarget = null;
      maybeGameOver();
    }
    needsSync = true;
    return;
  }

  engine.hardDrop();
  autoTarget = null;
  autoPieceKey = '';
  needsSync = true;
  maybeGameOver();
}

const input = new InputController(canvas, {
  onMove: move,
  onRotate: rotate,
  onFlip: flip,
  onSoftDropStart: () => {
    if (isCpuPlaying()) return;
    softDropping = true;
  },
  onSoftDropEnd: () => {
    softDropping = false;
  },
  onHardDrop: () => {
    if (isCpuPlaying() || engine.phase !== 'playing') return;
    engine.hardDrop();
    needsSync = true;
    maybeGameOver();
  },
  onPause: togglePause,
  onRestart: restartGame,
}, stage);

input.attach();
refreshAxis();

btnStart.addEventListener('click', () => {
  if (engine.phase === 'paused') {
    togglePause();
    return;
  }
  startGame();
});

btnRestart.addEventListener('click', restartGame);
btnPause.addEventListener('click', togglePause);

btnAuto.addEventListener('click', () => {
  cyclePlayMode();
});

btnFlip.addEventListener('click', () => {
  flip();
});

btnHard.addEventListener('click', () => {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  engine.hardDrop();
  needsSync = true;
  maybeGameOver();
});

btnSoft.addEventListener('pointerdown', (e) => {
  if (isCpuPlaying()) return;
  e.preventDefault();
  softDropping = true;
});
const endSoft = () => {
  softDropping = false;
};
btnSoft.addEventListener('pointerup', endSoft);
btnSoft.addEventListener('pointerleave', endSoft);
btnSoft.addEventListener('pointercancel', endSoft);

window.addEventListener('resize', () => {
  renderer.resize();
  refreshAxis();
});

document.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

showOverlay(
  '3D Tetris',
  '按钮：手动 / 半自动 / 自动 / 自动训练（仅长条+CPU）',
  'Start',
);
syncView();

function frame(now: number): void {
  const dt = Math.min(100, now - lastT);
  lastT = now;

  if (engine.phase === 'playing') {
    if (isCpuPlaying()) {
      if (handoffLongBarIfNeeded()) {
        // paused + manual; fall through to sync
      } else {
        autoAcc += dt;
        let steps = 0;
        while (autoAcc >= AUTO_STEP_MS && steps < AUTO_MAX_STEPS_PER_FRAME) {
          autoAcc -= AUTO_STEP_MS;
          steps++;
          if (engine.phase !== 'playing') break;
          try {
            autoStep();
          } catch (err) {
            console.error('auto step failed', err);
            setPlayMode('manual');
            break;
          }
          if (engine.phase !== 'playing') break;
        }
        // Drop excess catch-up time so we never burst-plan dozens of pieces in one frame.
        if (autoAcc > AUTO_STEP_MS * AUTO_MAX_STEPS_PER_FRAME) {
          autoAcc = 0;
        }
      }
    } else {
      const interval = softDropping ? Math.min(80, engine.dropMs / 8) : engine.dropMs;
      dropAcc += dt;
      while (dropAcc >= interval) {
        dropAcc -= interval;
        if (engine.phase !== 'playing') break;
        engine.tickGravity();
        needsSync = true;
        maybeGameOver();
        if (engine.phase !== 'playing') break;
      }
    }
  }

  if (needsSync) syncView();
  renderer.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
