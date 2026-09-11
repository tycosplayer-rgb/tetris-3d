import { Engine } from './game/engine';
import { InputController, axisMapFromCamera, type MoveDir } from './game/input';
import { GameRenderer } from './game/render';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const scoreEl = document.querySelector('#score')!;
const linesEl = document.querySelector('#lines')!;
const levelEl = document.querySelector('#level')!;
const nextEl = document.querySelector('#next-label')!;
const overlay = document.querySelector('#overlay')!;
const overlayTitle = document.querySelector('#overlay-title')!;
const overlayMsg = document.querySelector('#overlay-msg')!;
const btnStart = document.querySelector('#btn-start')!;
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

function updateHud(): void {
  scoreEl.textContent = String(engine.stats.score);
  linesEl.textContent = String(engine.stats.lines);
  levelEl.textContent = String(engine.stats.level);
  nextEl.textContent = engine.nextLabel();
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
  if (engine.phase !== 'playing') return;
  const { dx, dz } = input.dirToDelta(dir);
  if (engine.tryMove(dx, 0, dz)) needsSync = true;
}

function rotate(): void {
  if (engine.phase !== 'playing') return;
  if (engine.tryRotate()) needsSync = true;
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
    showOverlay('Paused', 'Swipe to move · Tap to rotate', 'Resume');
    btnPause.textContent = 'Resume';
  } else {
    hideOverlay();
    btnPause.textContent = 'Pause';
    lastT = performance.now();
  }
}


function maybeGameOver(): void {
  if (engine.phase === 'over') {
    showOverlay('Game Over', `Score ${engine.stats.score} · Lines ${engine.stats.lines}`, 'Restart');
  }
}

const input = new InputController(canvas, {
  onMove: move,
  onRotate: rotate,
  onSoftDropStart: () => {
    softDropping = true;
  },
  onSoftDropEnd: () => {
    softDropping = false;
  },
  onHardDrop: () => {
    if (engine.phase !== 'playing') return;
    engine.hardDrop();
    needsSync = true;
    maybeGameOver();
  },
  onPause: togglePause,
  onRestart: restartGame,
});

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

btnHard.addEventListener('click', () => {
  if (engine.phase !== 'playing') return;
  engine.hardDrop();
  needsSync = true;
  maybeGameOver();
});

btnSoft.addEventListener('pointerdown', (e) => {
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

showOverlay('3D Tetris', 'Swipe to move · Tap to rotate · Swipe down to hard drop', 'Start');
syncView();

function frame(now: number): void {
  const dt = Math.min(100, now - lastT);
  lastT = now;

  if (engine.phase === 'playing') {
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

  if (needsSync) syncView();
  renderer.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
