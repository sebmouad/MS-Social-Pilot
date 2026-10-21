#!/usr/bin/env node
/*
 * Full-page screenshots of the local synthetic preview, for design review.
 * Never point it at production. Credentials come from the environment, not arguments.
 *
 *   PREVIEW_BASE_URL=http://localhost:3200 \
 *   PREVIEW_QA_EMAIL=preview-qa@example.test PREVIEW_QA_PASSWORD=... \
 *   node scripts/preview-screenshots.cjs <outDir> /home /plan "/plan@390" "/results?theme=warm"
 *
 * A route ending in @<width> is captured at that width (phone height 844); others at 1440x900.
 * PLAYWRIGHT_CHROMIUM (optional) overrides the browser path; the cloud image uses /opt/pw-browsers/chromium.
 */
const path = require('path');
const fs = require('fs');

let chromium;
for (const candidate of ['playwright', path.join(__dirname, '../../node_modules/playwright')]) {
  try { ({ chromium } = require(candidate)); break; } catch { /* try next */ }
}
if (!chromium) { console.error('Playwright is not installed. Run npm ci at the repository root.'); process.exit(1); }

const base = process.env.PREVIEW_BASE_URL || 'http://localhost:3200';
const email = process.env.PREVIEW_QA_EMAIL;
const password = process.env.PREVIEW_QA_PASSWORD;
const [outDir, ...routes] = process.argv.slice(2);
if (!outDir || routes.length === 0) { console.error('Usage: preview-screenshots.cjs <outDir> <route[@width]>...'); process.exit(1); }
if (!email || !password) { console.error('Set PREVIEW_QA_EMAIL and PREVIEW_QA_PASSWORD.'); process.exit(1); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) { console.error('Refusing a non-local PREVIEW_BASE_URL.'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${base}/sign-in`);
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL(url => !String(url).includes('sign-in'), { timeout: 60000 }), page.keyboard.press('Enter')]);
  for (const entry of routes) {
    const [route, width] = entry.split('@');
    await page.setViewportSize({ width: Number(width || 1440), height: width ? 844 : 900 });
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(800);
    const name = (route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root') + (width ? `_${width}` : '');
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`${name}.png height=${height}`);
  }
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
