import { findBestPlacement, type Placement } from './game/auto';
import { Engine } from './game/engine';
import { InputController, axisMapFromCamera, type MoveDir } from './game/input';
import { GameRenderer } from './game/render';
import { gameAudio } from './game/audio';

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
const btnMute = document.querySelector<HTMLButtonElement>('#btn-mute')!;
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

/**
 * manual | semi (CPU until I) | full (CPU always) | train (I-only CPU).
 * semi/train kept in code for later debugging; hidden from the cycle for now.
 */
type PlayMode = 'manual' | 'semi' | 'full' | 'train' | 'stack';
/** Flip true to put 半自动 / 自动训练 back in the button cycle. */
const SHOW_DEBUG_PLAY_MODES = false;
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
  btnAuto.classList.toggle('active', playMode !== 'manual');
  btnAuto.textContent =
    playMode === 'manual'
      ? '手动'
      : playMode === 'stack'
        ? '垒'
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
  if (engine.tryMove(dx, 0, dz)) {
    gameAudio.play('move');
    needsSync = true;
  }
}

function rotate(): void {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  if (engine.tryRotate()) {
    gameAudio.play('rotate');
    needsSync = true;
  }
}

function flip(): void {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  if (engine.tryFlip()) {
    gameAudio.play('flip');
    needsSync = true;
  }
}

function refreshAxis(): void {
  const { cam, target } = renderer.getCameraPose();
  input.setAxisMap(axisMapFromCamera(cam.x, cam.y, cam.z, target.x, target.y, target.z));
}

function startGame(): void {
  gameAudio.unlock();
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
  gameAudio.play('start');
}

function restartGame(): void {
  startGame();
}

function togglePause(): void {
  if (engine.phase === 'ready' || engine.phase === 'over') return;
  engine.togglePause();
  gameAudio.play('pause');
  if (engine.phase === 'paused') {
    const pauseHint =
      playMode === 'semi'
        ? '半自动已暂停'
        : playMode === 'full'
          ? '自动已暂停'
          : playMode === 'train'
            ? '自动训练已暂停（仅长条）'
            : playMode === 'stack'
              ? '垒模式已暂停（无重力，软降/硬降放置）'
              : 'Swipe · Tap rotate · Flip button';
    showOverlay('Paused', pauseHint, 'Resume');
    btnPause.textContent = 'Resume';
  } else {
    hideOverlay();
    btnPause.textContent = 'Pause';
    lastT = performance.now();
  }
}


function playLockOrClear(cleared: number): void {
  if (cleared > 0) gameAudio.play('clear', cleared);
  else gameAudio.play('lock');
}

function doHardDrop(playHardWhoosh = true): void {
  if (playHardWhoosh) gameAudio.play('hard');
  const { cleared } = engine.hardDrop();
  playLockOrClear(cleared);
  needsSync = true;
  maybeGameOver();
}

function maybeGameOver(): void {
  if (engine.phase === 'over') {
    autoTarget = null;
    gameAudio.play('over');
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
  const order: PlayMode[] = SHOW_DEBUG_PLAY_MODES
    ? ['manual', 'semi', 'full', 'train', 'stack']
    : ['manual', 'stack', 'full'];
  // If we were left in a hidden debug mode, jump back into the public cycle.
  const i = order.indexOf(playMode);
  const next = order[i < 0 ? 0 : (i + 1) % order.length]!;
  setPlayMode(next);
}

function isStackMode(): boolean {
  return playMode === 'stack';
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
    doHardDrop(false);
    autoTarget = null;
    return;
  }

  // Flip face first (XY↔XZ), then in-plane rotate, then slide.
  // If flip/rotate fails near the ceiling, soft-drop for headroom — never hard-drop yet
  // (that was dumping every I on the spawn footprint).
  if (a.plane !== t.plane) {
    if (!engine.tryFlip()) {
      if (!engine.softDrop()) {
        doHardDrop(false);
        autoTarget = null;
      }
    }
    needsSync = true;
    return;
  }

  if (a.rotation !== t.rotation) {
    if (!engine.tryRotate()) {
      if (!engine.softDrop()) {
        doHardDrop(false);
        autoTarget = null;
      }
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
      doHardDrop(false);
      autoTarget = null;
    }
    needsSync = true;
    return;
  }

  doHardDrop(false);
  autoTarget = null;
  autoPieceKey = '';
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
    doHardDrop(true);
  },
  onPause: togglePause,
  onRestart: restartGame,
}, stage);

input.attach();
refreshAxis();

// Browsers require a gesture before AudioContext can play loudly.
document.body.addEventListener(
  'pointerdown',
  () => {
    gameAudio.unlock();
  },
  { passive: true },
);

btnStart.addEventListener('click', () => {
  gameAudio.unlock();
  if (engine.phase === 'paused') {
    togglePause();
    return;
  }
  startGame();
});

btnRestart.addEventListener('click', restartGame);
btnPause.addEventListener('click', togglePause);

btnMute.addEventListener('click', () => {
  gameAudio.unlock();
  const muted = gameAudio.toggleMute();
  btnMute.textContent = muted ? '🔇' : '🔊';
  btnMute.classList.toggle('muted', muted);
  btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
});

btnAuto.addEventListener('click', () => {
  gameAudio.unlock();
  cyclePlayMode();
});

btnFlip.addEventListener('click', () => {
  flip();
});

btnHard.addEventListener('click', () => {
  if (isCpuPlaying() || engine.phase !== 'playing') return;
  doHardDrop(true);
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
  'Swipe · Tap rotate · Flip · 按钮：手动 / 垒 / 自动',
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
    } else if (isStackMode()) {
      // 垒模式：自然降落速度为 0；仅按住软降时才下落。
      if (softDropping) {
        const interval = Math.min(80, engine.dropMs / 8);
        dropAcc += dt;
        while (dropAcc >= interval) {
          dropAcc -= interval;
          if (engine.phase !== 'playing') break;
          const grav = engine.tickGravity();
          needsSync = true;
          if (grav.locked) {
            playLockOrClear(grav.cleared);
            maybeGameOver();
          }
          if (engine.phase !== 'playing') break;
        }
      } else {
        dropAcc = 0;
      }
    } else {
      const interval = softDropping ? Math.min(80, engine.dropMs / 8) : engine.dropMs;
      dropAcc += dt;
      while (dropAcc >= interval) {
        dropAcc -= interval;
        if (engine.phase !== 'playing') break;
        const grav = engine.tickGravity();
        needsSync = true;
        if (grav.locked) {
          playLockOrClear(grav.cleared);
          maybeGameOver();
        }
        if (engine.phase !== 'playing') break;
      }
    }
  }

  if (needsSync) syncView();
  renderer.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
