import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CABINET } from '../sim/cabinet';
import type { GeomInfo } from '../worker/protocol';
import { boxTexture, cabinetArtTexture, fabricTexture, holoTexture } from './textures';

export type ViewName = 'front' | 'side' | 'top' | 'claw';

const VIEWS: Record<Exclude<ViewName, 'claw'>, { pos: [number, number, number]; target: [number, number, number] }> = {
  front: { pos: [0.0, -1.42, 0.82], target: [0, 0.0, 0.24] },
  side: { pos: [1.15, -0.25, 0.72], target: [-0.05, 0, 0.2] },
  top: { pos: [0.0, -0.25, 1.55], target: [0, 0, 0.1] },
};

/**
 * Three.js view of the machine. Physics geoms are mirrored 1:1 from MuJoCo (z-up);
 * the cabinet shell, lights and control panel are decoration only.
 */
export class MachineScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private geomObjects: Array<THREE.Object3D | null> = [];
  private dynamicRoot = new THREE.Group();
  private cable: THREE.Mesh;
  private view: ViewName = 'front';
  private lcdTexture: THREE.CanvasTexture | null = null;
  private tmpMat = new THREE.Matrix4();
  private lastHead = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#2a1f3d');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.setView('front');

    this.buildLights();
    this.buildShell();
    this.scene.add(this.dynamicRoot);

    const cableMat = new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 1, 6), cableMat);
    this.scene.add(this.cable);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      // Keep the whole cabinet in view on narrow (phone) screens.
      this.camera.fov = w / h < 0.8 ? 62 : 42;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
  }

  setView(v: ViewName): void {
    this.view = v;
    if (v === 'claw') return;
    const cfg = VIEWS[v];
    this.camera.position.set(...cfg.pos);
    this.controls.target.set(...cfg.target);
    this.controls.update();
  }

  get currentView(): ViewName {
    return this.view;
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#fff4fb', '#4a2a55', 0.9));
    // LED strip under the cabinet roof.
    const top = new THREE.DirectionalLight('#ffffff', 2.2);
    top.position.set(0.1, -0.2, 1.6);
    top.target.position.set(0, 0, 0);
    top.castShadow = true;
    top.shadow.mapSize.set(2048, 2048);
    const sc = top.shadow.camera;
    sc.left = -0.5;
    sc.right = 0.5;
    sc.top = 0.5;
    sc.bottom = -0.5;
    sc.near = 0.5;
    sc.far = 2.5;
    top.shadow.bias = -0.0004;
    this.scene.add(top, top.target);
    const pink = new THREE.PointLight('#ff7fd0', 0.6, 2.5);
    pink.position.set(-0.3, -0.5, 0.6);
    const blue = new THREE.PointLight('#7fb8ff', 0.5, 2.5);
    blue.position.set(0.35, 0.2, 0.75);
    this.scene.add(pink, blue);
  }

  /** Decorative cabinet: yellow frame, roof, base, holo back, control panel. */
  private buildShell(): void {
    const { halfW: W, halfD: D, wallH } = CABINET;
    const yellow = new THREE.MeshStandardMaterial({ color: '#ffcf1a', roughness: 0.45, metalness: 0.1 });
    const art = new THREE.MeshStandardMaterial({ map: cabinetArtTexture(), roughness: 0.6 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    const post = 0.035;
    for (const [x, y] of [
      [-W - post / 2, -D - post / 2],
      [W + post / 2, -D - post / 2],
      [-W - post / 2, D + post / 2],
      [W + post / 2, D + post / 2],
    ]) {
      add(new THREE.BoxGeometry(post, post, wallH + 0.25), yellow, x, y, (wallH + 0.25) / 2 - 0.02);
    }
    // Roof box with a marquee.
    add(new THREE.BoxGeometry(2 * W + 0.1, 2 * D + 0.1, 0.16), yellow, 0, 0, wallH + 0.26);
    const sign = add(new THREE.PlaneGeometry(2 * W, 0.12), new THREE.MeshBasicMaterial({ map: this.marqueeTexture() }), 0, -D - 0.051, wallH + 0.26);
    sign.rotation.x = Math.PI / 2;
    // Base cabinet below the prize bed.
    add(new THREE.BoxGeometry(2 * W + 0.1, 2 * D + 0.1, 0.9), art, 0, 0, -0.47);
    // Holographic back sheet.
    const holo = add(new THREE.PlaneGeometry(2 * W, wallH), new THREE.MeshStandardMaterial({ map: holoTexture(), roughness: 0.2, metalness: 0.5 }), 0, D + 0.012, wallH / 2);
    holo.rotation.x = Math.PI / 2;
    holo.rotation.y = Math.PI;
    // Gantry rails.
    const rail = new THREE.MeshStandardMaterial({ color: '#c8c8d0', metalness: 0.8, roughness: 0.3 });
    add(new THREE.BoxGeometry(0.02, 2 * D, 0.02), rail, -W + 0.02, 0, CABINET.gantryZ + 0.07);
    add(new THREE.BoxGeometry(0.02, 2 * D, 0.02), rail, W - 0.02, 0, CABINET.gantryZ + 0.07);
    // Control panel ledge with joystick and button.
    const panel = add(new THREE.BoxGeometry(2 * W + 0.1, 0.22, 0.05), yellow, 0, -D - 0.13, 0.02);
    panel.rotation.x = -0.25;
    const stick = add(new THREE.CylinderGeometry(0.006, 0.006, 0.08), new THREE.MeshStandardMaterial({ color: '#ffd700' }), -0.12, -D - 0.14, 0.08);
    stick.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.022), new THREE.MeshStandardMaterial({ color: '#ffd400', roughness: 0.3 }), -0.12, -D - 0.14, 0.12);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.02).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ff3355' }), 0.12, -D - 0.14, 0.05);
    // LCD on the panel (texture updated from the board state).
    const lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = 256;
    lcdCanvas.height = 128;
    this.lcdTexture = new THREE.CanvasTexture(lcdCanvas);
    this.lcdTexture.colorSpace = THREE.SRGBColorSpace;
    const lcd = add(new THREE.PlaneGeometry(0.14, 0.07), new THREE.MeshBasicMaterial({ map: this.lcdTexture }), 0.0, -D - 0.12, 0.05);
    lcd.rotation.x = -0.25 + 0.0;
    // Prize door under the chute.
    const door = add(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshStandardMaterial({ color: '#222', transparent: true, opacity: 0.8 }), (CABINET.hole.x0 + CABINET.hole.x1) / 2, -D - 0.052, -0.3);
    door.rotation.x = Math.PI / 2;
  }

  private marqueeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, '#ff4fa3');
    grad.addColorStop(0.5, '#ffb84f');
    grad.addColorStop(1, '#4fd1ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#fff';
    g.font = 'bold 92px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('夾娃娃 ♥ 祝您中獎', 512, 84);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** The LCD canvas on the 3D control panel; caller draws, then calls `lcdUpdated`. */
  get lcdCanvas(): HTMLCanvasElement | null {
    return (this.lcdTexture?.image as HTMLCanvasElement) ?? null;
  }

  lcdUpdated(): void {
    if (this.lcdTexture) this.lcdTexture.needsUpdate = true;
  }

  /** (Re)creates meshes for the compiled MuJoCo model. */
  setModel(geoms: GeomInfo[], prizeOfBody: number[], prizeColors: string[], prizeKinds: string[]): void {
    this.dynamicRoot.clear();
    this.geomObjects = [];
    const metal = new THREE.MeshStandardMaterial({ color: '#d5d6dc', metalness: 0.85, roughness: 0.28 });
    const pinkMetal = new THREE.MeshStandardMaterial({ color: '#e0338c', metalness: 0.5, roughness: 0.35 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 });
    const fabric = new THREE.MeshStandardMaterial({ map: fabricTexture(), roughness: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#dff1ff', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, depthWrite: false });
    const acrylic = new THREE.MeshPhysicalMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false });
    const chute = new THREE.MeshStandardMaterial({ color: '#2c2b33', roughness: 0.8 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#ffcf1a', roughness: 0.45 });
    const boxMats = new Map<number, THREE.Material[]>();
    const plushMats = new Map<number, THREE.Material>();

    for (const g of geoms) {
      const geo = this.geometryFor(g);
      if (!geo) {
        this.geomObjects.push(null);
        continue;
      }
      let mat: THREE.Material | THREE.Material[];
      const n = g.name;
      const prize = prizeOfBody[g.body] ?? -1;
      if (n.startsWith('glass_')) mat = glass;
      else if (n.startsWith('guard_')) mat = acrylic;
      else if (n.startsWith('floor_')) mat = fabric;
      else if (n.startsWith('chute_')) mat = chute;
      else if (n.startsWith('gantry_')) mat = yellow;
      else if (n.endsWith('_sleeve')) mat = rubber;
      else if (n === 'claw_housing') mat = pinkMetal;
      else if (n.startsWith('claw_') || n.startsWith('arm') || n.startsWith('antiswing_')) mat = metal;
      else if (prize >= 0 && n.endsWith('_box')) {
        if (!boxMats.has(prize)) {
          const kind = prizeKinds[prize];
          const side = new THREE.MeshStandardMaterial({ map: boxTexture(prizeColors[prize], kind === 'tissueBox' ? 'Tissue' : '餅乾'), roughness: 0.6 });
          const plain = new THREE.MeshStandardMaterial({ color: prizeColors[prize], roughness: 0.6 });
          boxMats.set(prize, [side, side, plain, plain, side, side]);
        }
        mat = boxMats.get(prize)!;
      } else if (prize >= 0 && g.rgba[3] > 0 && n.match(/_(torso|headball|ear[LR]|armLg|armRg|legLg|legRg)$/)) {
        if (!plushMats.has(prize)) plushMats.set(prize, new THREE.MeshStandardMaterial({ color: prizeColors[prize], roughness: 1 }));
        mat = plushMats.get(prize)!;
      } else {
        const [r, gg, b, a] = g.rgba;
        mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, gg, b), transparent: a < 1, opacity: a, roughness: a < 1 ? 0.1 : 0.5 });
      }
      const mesh = new THREE.Mesh(geo, mat);
      const transparent = n.startsWith('glass_') || n.startsWith('guard_');
      mesh.castShadow = !transparent && !n.startsWith('floor_') && !n.startsWith('chute_');
      mesh.receiveShadow = !transparent;
      if (transparent) mesh.renderOrder = 2;
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.add(mesh);
      this.dynamicRoot.add(holder);
      this.geomObjects.push(holder);
    }
  }

  private geometryFor(g: GeomInfo): THREE.BufferGeometry | null {
    const [a, b, c] = g.size;
    switch (g.type) {
      case 2:
        return new THREE.SphereGeometry(a, 20, 14);
      case 3:
        // MuJoCo capsule: radius a, half-length b along local z.
        return new THREE.CapsuleGeometry(a, 2 * b, 6, 12).rotateX(Math.PI / 2);
      case 4:
        return new THREE.SphereGeometry(1, 24, 16).scale(a, b, c);
      case 5:
        return new THREE.CylinderGeometry(a, a, 2 * b, 28).rotateX(Math.PI / 2);
      case 6:
        return new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
      default:
        return null;
    }
  }

  /** Applies one physics frame. */
  updateFrame(pos: Float32Array, mat: Float32Array, cable: number[]): void {
    const m = this.tmpMat;
    for (let i = 0; i < this.geomObjects.length; i++) {
      const o = this.geomObjects[i];
      if (!o) continue;
      const r = mat.subarray(i * 9, i * 9 + 9);
      // MuJoCo xmat is row-major 3×3.
      m.set(r[0], r[1], r[2], pos[i * 3], r[3], r[4], r[5], pos[i * 3 + 1], r[6], r[7], r[8], pos[i * 3 + 2], 0, 0, 0, 1);
      o.matrix.copy(m);
      o.matrixWorldNeedsUpdate = true;
    }
    const a = new THREE.Vector3(cable[0], cable[1], cable[2]);
    const b = new THREE.Vector3(cable[3], cable[4], cable[5]);
    const len = a.distanceTo(b);
    this.cable.position.copy(a).add(b).multiplyScalar(0.5);
    this.cable.scale.set(1, Math.max(0.001, len), 1);
    this.cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.lastHead.copy(b);
  }

  render(): void {
    if (this.view === 'claw') {
      // Follow cam: looking down past the claw, like peering from the side glass.
      const h = this.lastHead;
      this.camera.position.lerp(new THREE.Vector3(h.x + 0.25, h.y - 0.45, Math.max(0.35, h.z + 0.12)), 0.08);
      this.controls.target.lerp(new THREE.Vector3(h.x, h.y, Math.max(0.05, h.z - 0.18)), 0.12);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
