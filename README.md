# 3D Tetris

Playable 3D Tetris with **camera-aligned touch controls**, classic tetrominoes, and dual spawn planes (XY / XZ).

Built with **Vite + Three.js + TypeScript**.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
|-------|--------|
| **Swipe / drag** | Move on the footprint (XZ). Directions match the **tilted camera**: screen-left = left from your view, screen-up = deeper into the well. |
| **Swipe down** | **Hard drop** (once per gesture once the swipe is long enough). |
| **Tap / click** | Rotate **in-plane only** (XY pieces rotate in XY; XZ pieces rotate in XZ). No free 3D tumbling. |
| **↓ Soft** (hold) / Arrow Down / S | Soft drop |
| **⬇ Hard** / Space | Hard drop |
| **Pause** / P | Pause / resume |
| **Restart** / R | New game |

Keyboard also supports WASD / arrows for camera-aligned moves and **X / Z / K** to rotate.

## Rules

- Playfield footprint is **square** (`8 × 8`) with height `16`. Gravity is along **−Y**.
- Clear **complete horizontal layers** (full XZ slices).
- Spawn: **P(XY) = P(XZ) = ½**, then uniform among the 7 classic types **I O T S Z J L**.
- Score / lines / level (speed up every 10 lines), ghost preview, game over + restart.

## Temporary limits (MVP)

- No SRS-perfect wall-kick tables (simple offset kicks).
- No hold piece / bag randomizer (independent rolls).
- No audio, no orbit camera, no multiplayer.
- Layer clear has no fancy particle effects.
- Desktop mouse: click = rotate, drag = move (same as touch).

## License

MIT
