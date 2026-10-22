import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

/** Plush fabric of the prize bed. */
export function fabricTexture(color = '#f59cc4'): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const a = Math.random() * 0.12;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(120,20,60,${a})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Holographic back panel seen in the video's machine. */
export function holoTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#c9d6ff');
  grad.addColorStop(0.25, '#f4c6ff');
  grad.addColorStop(0.5, '#c6fff1');
  grad.addColorStop(0.75, '#fff3c6');
  grad.addColorStop(1, '#c9d6ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 16) {
    for (let x = (y / 16) % 2 ? 8 : 0; x < 512; x += 16) {
      g.fillStyle = `hsla(${(x + y) % 360},90%,85%,0.6)`;
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Printed cardboard for snack/tissue boxes. */
export function boxTexture(color: string, label: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 8; i++) g.fillRect(0, i * 16, 256, 6);
  g.fillStyle = '#fff';
  g.font = 'bold 44px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 128, 64);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cabinet side art (yellow with balloons/polka dots like the video's machine). */
export function cabinetArtTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#ffd21f';
  g.fillRect(0, 0, 512, 512);
  const colors = ['#ff6b9a', '#6bc5ff', '#8cf07a', '#b98cff', '#ff9a3d'];
  for (let i = 0; i < 40; i++) {
    g.fillStyle = colors[i % colors.length];
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 10 + Math.random() * 30, 8 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
