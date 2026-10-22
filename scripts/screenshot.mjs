// Takes a phone-sized screenshot of the built game so changes can be checked without a device.
// Usage: npm run screenshot [-- out.png] [--mile 430] [--levels camera:5,radar:2] [--cash 500] [--takeover storm]
// (builds first, then serves dist/ with vite preview)
// --mile shows that spot on the real route instead of the saved game position.
import { chromium } from 'playwright';
import { preview } from 'vite';

const args = process.argv.slice(2);
const mileAt = args.indexOf('--mile');
const mile = mileAt >= 0 ? args.splice(mileAt, 2)[1] : undefined;
// --levels camera:5,radar:2 starts from a save with those upgrades.
const levelsAt = args.indexOf('--levels');
const levels = levelsAt >= 0 ? Object.fromEntries(args.splice(levelsAt, 2)[1].split(',').map((p) => [p.split(':')[0], Number(p.split(':')[1])])) : undefined;
// --cash 500 starts with that much money; --state '{"followers":300}' sets any other save fields; --takeover storm starts stuck on that takeover;
// --crash spin starts in that crash (--wait 4000 picks the moment); --tired 0.7 sets Dad's tiredness.
const take = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args.splice(at, 2)[1] : undefined; };
const cash = Number(take('--cash') ?? 5);
const extra = JSON.parse(take('--state') ?? '{}');
// --away 7200 pretends you were gone that many seconds (shows the welcome-back summary).
const away = Number(take('--away') ?? 0);
const takeover = take('--takeover');
const crash = take('--crash');
const tired = Number(take('--tired') ?? 0);
const wait = Number(take('--wait') ?? 2500);
const out = args[0] ?? 'screenshot.png';
const server = await preview({ preview: { port: 4173, strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (levels || away || cash !== 5 || takeover || crash || tired || mile || Object.keys(extra).length) {
    const save = {
      version: 3, odometer: Number(mile ?? 0), cash, levels: levels ?? {}, untilTakeover: 1e6, takeovers: 0, tiredness: tired, crashes: crash ? 1 : 0,
      ...(takeover ? { takeover: { kind: takeover, waited: 4 } } : {}),
      ...(crash ? { crash: { kind: crash, left: 60, cost: 12 } } : {}),
      ...extra,
    };
    await page.addInitScript(([s, away]) => localStorage.setItem('idle-driver-save', JSON.stringify({ ...s, lastTick: Date.now() - away * 1000 })), [save, away]);
  }
  // Fixed traffic seed so screenshots are comparable.
  await page.goto(`${url}?seed=1${mile ? `&mile=${mile}` : ''}`);

  if (!takeover && !crash && !away) for (let i = 0; i < 15; i++) await page.click('#honk');
  // Wait for the map around the car to load, then a moment for the camera to settle.
  await page.waitForSelector('#view[data-ready]', { timeout: 90_000 });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`Saved ${out}. place="${await page.textContent('#place')}" cash=${await page.textContent('#cash')}`);
  if (errors.length) {
    console.error('Page errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
