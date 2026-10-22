// Takes a phone-sized screenshot of the built game so changes can be checked without a device.
// Usage: npm run screenshot [-- out.png] [--mile 430] [--levels camera:5,radar:2]   (builds first, then serves dist/ with vite preview)
// --mile shows that spot on the real route instead of the saved game position.
import { chromium } from 'playwright';
import { preview } from 'vite';

const args = process.argv.slice(2);
const mileAt = args.indexOf('--mile');
const mile = mileAt >= 0 ? args.splice(mileAt, 2)[1] : undefined;
// --levels camera:5,radar:2 starts from a save with those upgrades.
const levelsAt = args.indexOf('--levels');
const levels = levelsAt >= 0 ? Object.fromEntries(args.splice(levelsAt, 2)[1].split(',').map((p) => [p.split(':')[0], Number(p.split(':')[1])])) : undefined;
const out = args[0] ?? 'screenshot.png';
const server = await preview({ preview: { port: 4173, strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (levels) {
    await page.addInitScript((lv) => localStorage.setItem('idle-driver-save', JSON.stringify({ version: 2, odometer: 0, miles: 0, levels: lv, lastTick: Date.now() })), levels);
  }
  // Fixed traffic seed so screenshots are comparable.
  await page.goto(`${url}?seed=1${mile ? `&mile=${mile}` : ''}`);

  for (let i = 0; i < 15; i++) await page.click('#honk');
  // Wait for the map around the car to load, then a moment for the camera to settle.
  await page.waitForSelector('#view[data-ready]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`Saved ${out}. place="${await page.textContent('#place')}" miles=${await page.textContent('#miles')}`);
  if (errors.length) {
    console.error('Page errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
