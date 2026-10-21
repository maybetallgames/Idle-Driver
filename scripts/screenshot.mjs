// Takes a phone-sized screenshot of the built game so changes can be checked without a device.
// Usage: npm run screenshot [-- out.png]   (builds first, then serves dist/ with vite preview)
import { chromium } from 'playwright';
import { preview } from 'vite';

const out = process.argv[2] ?? 'screenshot.png';
const server = await preview({ preview: { port: 4173, strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  for (let i = 0; i < 15; i++) await page.click('#honk');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`Saved ${out}. miles=${await page.textContent('#miles')} speed=${await page.textContent('#speed')}`);
  if (errors.length) {
    console.error('Page errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
