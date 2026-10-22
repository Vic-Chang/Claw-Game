/**
 * Yellow-green character LCD like the Feiluoli control panel (4 lines).
 */
export function drawLcd(canvas: HTMLCanvasElement, lines: string[], highlight = -1): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = '#c8e81c';
  g.fillRect(0, 0, w, h);
  // Faint pixel grid.
  g.fillStyle = 'rgba(80,110,0,0.08)';
  for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  const lineH = h / 4;
  g.font = `bold ${Math.floor(lineH * 0.68)}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", monospace`;
  g.textBaseline = 'middle';
  lines.slice(0, 4).forEach((text, i) => {
    const y = lineH * (i + 0.5);
    if (i === highlight) {
      g.fillStyle = '#1f2a00';
      g.fillRect(4, y - lineH * 0.45, w - 8, lineH * 0.9);
      g.fillStyle = '#c8e81c';
    } else {
      g.fillStyle = '#1f2a00';
    }
    g.fillText(text, 8, y);
  });
}
