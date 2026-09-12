import * as THREE from 'three';
import { Board, HEIGHT, SIZE, type BoardCell } from './board';
import { PIECE_COLORS, cellsForPiece } from './pieces';
import type { ActivePiece, Cell, PieceType } from './types';

const CELL = 1;
const GAP = 0.06;

export class GameRenderer {
  readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly boardGroup = new THREE.Group();
  private readonly lockedGroup = new THREE.Group();
  private readonly activeGroup = new THREE.Group();
  private readonly ghostGroup = new THREE.Group();
  private readonly geo = new THREE.BoxGeometry(CELL - GAP, CELL - GAP, CELL - GAP);
  private readonly edgeBox = new THREE.BoxGeometry(CELL, CELL, CELL);
  /** Shared edge lines — must NOT create a new EdgesGeometry per cube (leaks VRAM). */
  private readonly edgesGeo = new THREE.EdgesGeometry(this.edgeBox);
  private readonly materials = new Map<PieceType, THREE.MeshStandardMaterial>();
  private readonly edgeMat = new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
  });
  private readonly ghostMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  private readonly camTarget: THREE.Vector3;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0b1020, 1);

    const cx = SIZE / 2;
    const cy = HEIGHT / 2;
    const cz = SIZE / 2;
    // Fill the stage: a bit lower look-at so less empty floor under the well.
    this.camTarget = new THREE.Vector3(cx, cy * 0.42, cz);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 280);
    // Elevated view from +X/+Z corner so both footprint axes are visible.
    this.camera.position.set(cx + SIZE * 2.05, HEIGHT * 1.28, cz + SIZE * 2.3);
    this.camera.lookAt(this.camTarget);

    this.scene.fog = new THREE.Fog(0x0b1020, 45, 95);

    const amb = new THREE.AmbientLight(0x8899bb, 0.55);
    const dir = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(8, 18, 10);
    const fill = new THREE.DirectionalLight(0x6688ff, 0.35);
    fill.position.set(-10, 6, -8);
    this.scene.add(amb, dir, fill);

    this.buildWell();
    this.scene.add(this.boardGroup);
    this.scene.add(this.lockedGroup);
    this.scene.add(this.activeGroup);
    this.scene.add(this.ghostGroup);

    for (const t of Object.keys(PIECE_COLORS) as PieceType[]) {
      this.materials.set(
        t,
        new THREE.MeshStandardMaterial({
          color: PIECE_COLORS[t],
          roughness: 0.45,
          metalness: 0.12,
        }),
      );
    }

    this.resize();
  }

  getCameraPose(): { cam: THREE.Vector3; target: THREE.Vector3 } {
    return { cam: this.camera.position.clone(), target: this.camTarget.clone() };
  }

  private worldPos(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
  }

  private buildWell(): void {
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x152038,
      roughness: 0.9,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 0.2, SIZE + 0.2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(SIZE / 2, 0, SIZE / 2);
    this.boardGroup.add(floor);

    const grid = new THREE.GridHelper(SIZE, SIZE, 0x3a5080, 0x243050);
    grid.position.set(SIZE / 2, 0.01, SIZE / 2);
    this.boardGroup.add(grid);

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a68a8, transparent: true, opacity: 0.55 });
    const corners: Array<[number, number]> = [
      [0, 0],
      [SIZE, 0],
      [0, SIZE],
      [SIZE, SIZE],
    ];
    for (const [x, z] of corners) {
      const pts = [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, HEIGHT, z)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.boardGroup.add(new THREE.Line(geo, edgeMat));
    }

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x101828,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, HEIGHT), wallMat);
    back.position.set(SIZE / 2, HEIGHT / 2, 0);
    this.boardGroup.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, HEIGHT), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(0, HEIGHT / 2, SIZE / 2);
    this.boardGroup.add(left);
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = Math.max(200, parent.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Small downward bias for HUD; keep floor from dominating the bottom.
    const shiftY = Math.round(h * 0.04);
    this.camera.setViewOffset(w, h + shiftY, 0, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const obj = group.children.pop()!;
      group.remove(obj);
      // Shared geometries/materials stay; only drop the Object3D wrapper for GC.
    }
  }

  private addCube(group: THREE.Group, cell: Cell, type: PieceType, ghost = false): void {
    const mat = ghost ? this.ghostMat : this.materials.get(type)!;
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(this.worldPos(cell.x, cell.y, cell.z));
    group.add(mesh);

    if (!ghost) {
      const edges = new THREE.LineSegments(this.edgesGeo, this.edgeMat);
      edges.position.copy(mesh.position);
      group.add(edges);
    }
  }

  sync(board: Board, active: ActivePiece | null, ghost: Cell[]): void {
    this.clearGroup(this.lockedGroup);
    this.clearGroup(this.activeGroup);
    this.clearGroup(this.ghostGroup);

    for (let y = 0; y < HEIGHT; y++) {
      for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
          const t: BoardCell = board.cells[y][z][x];
          if (t) this.addCube(this.lockedGroup, { x, y, z }, t);
        }
      }
    }

    if (active) {
      const cells = cellsForPiece(
        active.type,
        active.plane,
        active.rotation,
        active.x,
        active.y,
        active.z,
      );
      for (const c of cells) this.addCube(this.activeGroup, c, active.type);
      for (const c of ghost) this.addCube(this.ghostGroup, c, active.type, true);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.geo.dispose();
    this.edgeBox.dispose();
    this.edgesGeo.dispose();
    this.ghostMat.dispose();
    this.edgeMat.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
