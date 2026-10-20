// Simple canvas scene: sky, mountains that grow as the trip progresses, scrolling road, the SUV.

export function drawRoad(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  timeMs: number,
  speed: number,
  progress: number,
) {
  const w = canvas.width;
  const h = canvas.height;
  const horizon = h * 0.55;

  ctx.fillStyle = '#87c5ea';
  ctx.fillRect(0, 0, w, h);

  // Mountains get taller the closer we are.
  const mh = 10 + progress * 60;
  ctx.fillStyle = '#6b7f99';
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  for (let i = 0; i <= 6; i++) {
    const x = (i / 6) * w;
    const peak = horizon - mh * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
    ctx.lineTo(x - w / 12, horizon);
    ctx.lineTo(x, peak);
  }
  ctx.lineTo(w, horizon);
  ctx.closePath();
  ctx.fill();
  if (progress > 0.5) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = Math.min(1, (progress - 0.5) * 2);
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6) * w;
      const peak = horizon - mh * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
      ctx.beginPath();
      ctx.moveTo(x, peak);
      ctx.lineTo(x - 8, peak + 10);
      ctx.lineTo(x + 8, peak + 10);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#5a9e4b';
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.fillStyle = '#444';
  ctx.fillRect(0, h * 0.7, w, h * 0.22);

  // Dashed center line scrolls with speed (log-scaled so it stays readable).
  const scroll = (timeMs / 1000) * (40 + Math.log10(1 + speed) * 120);
  ctx.fillStyle = '#f4d35e';
  const dash = 30;
  for (let x = -((scroll % (dash * 2))); x < w; x += dash * 2) {
    ctx.fillRect(x, h * 0.8, dash, 3);
  }

  // The SUV, with a little bounce.
  const bounce = Math.sin(timeMs / 120) * 1.2;
  ctx.font = '42px serif';
  ctx.textBaseline = 'bottom';
  ctx.save();
  ctx.scale(-1, 1); // emoji faces left by default; flip to drive right
  ctx.fillText('🚙', -(w * 0.35), h * 0.86 + bounce);
  ctx.restore();
}
