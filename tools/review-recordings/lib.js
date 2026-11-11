// Screen-recording helpers for the Meta App Review videos: 1920x1080, a caption bar naming the permission and the step,
// a cursor dot, and a box drawn around every element before it is clicked or typed into.
const { chromium } = require('playwright');
const fs = require('fs');
const U = 'https://' + new URL(process.env.SP_URL).host;
const W = 1920, H = 1080;

const OVERLAY = `
(() => {
  if (window.__rec) return; window.__rec = true;
  const css = document.createElement('style');
  css.textContent = \`
    #rec-cap,#rec-box,#rec-dot{inset:auto;margin:0;overflow:visible}
    #rec-cap{position:fixed;left:50%;bottom:28px;border:0;transform:translateX(-50%);z-index:2147483647;max-width:1500px;padding:16px 28px;border-radius:14px;
      background:rgba(10,12,20,.88);color:#fff;font:600 26px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none}
    #rec-cap small{display:block;margin-bottom:4px;color:#8fc1ff;font:700 19px/1.3 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em}
    #rec-box{position:fixed;z-index:2147483646;background:transparent;padding:0;border:4px solid #ff3b30;border-radius:10px;box-shadow:0 0 0 6px rgba(255,59,48,.25);pointer-events:none;transition:all .25s ease}
    #rec-dot{position:fixed;z-index:2147483647;padding:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,59,48,.85);border:3px solid #fff;pointer-events:none;transition:left .45s ease,top .45s ease}
  \`;
  document.documentElement.appendChild(css);
  window.__recRaise = () => { for (const id of ['rec-box', 'rec-dot', 'rec-cap']) { const el = document.getElementById(id); if (!el) continue;
    if (!el.popover) el.popover = 'manual'; try { if (el.matches(':popover-open')) el.hidePopover(); if (el.style.display !== 'none') el.showPopover(); } catch {} } };
})();`;

async function overlay(page) { await page.evaluate(OVERLAY).catch(() => {}); }
const shown = new WeakMap();
async function caption(page, perm, text) {
  shown.set(page, [perm, text]);
  await overlay(page);
  await page.evaluate(([perm, text]) => {
    let el = document.getElementById('rec-cap');
    if (!el) { el = document.createElement('div'); el.id = 'rec-cap'; document.documentElement.appendChild(el); }
    el.innerHTML = ''; const s = document.createElement('small'); s.textContent = perm; el.appendChild(s); el.appendChild(document.createTextNode(text)); window.__recRaise?.();
  }, [perm, text]).catch(() => {});
}
async function restore(page) { const last = shown.get(page); const has = await page.evaluate(() => Boolean(document.getElementById('rec-cap'))).catch(() => true); if (last && !has) await caption(page, last[0], last[1]); }
async function box(page, locator) {
  await overlay(page); await restore(page);
  // Centre the target in its scrolling area, so it is never boxed half-hidden at an edge.
  await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  await page.waitForTimeout(350);
  const r = await locator.boundingBox();
  if (!r) return null;
  await page.evaluate(r => {
    let b = document.getElementById('rec-box'); if (!b) { b = document.createElement('div'); b.id = 'rec-box'; document.documentElement.appendChild(b); }
    Object.assign(b.style, { left: (r.x - 8) + 'px', top: (r.y - 8) + 'px', width: (r.width + 16) + 'px', height: (r.height + 16) + 'px', display: 'block' });
    let d = document.getElementById('rec-dot'); if (!d) { d = document.createElement('div'); d.id = 'rec-dot'; document.documentElement.appendChild(d); }
    d.style.left = (r.x + r.width / 2) + 'px'; d.style.top = (r.y + r.height / 2) + 'px';
    // Keep the caption off whatever is being pointed at: it moves to the top when the target is low on the screen.
    const cap = document.getElementById('rec-cap'); if (cap) { const low = r.y + r.height > window.innerHeight - 190; cap.style.bottom = low ? 'auto' : '28px'; cap.style.top = low ? '84px' : 'auto'; } window.__recRaise?.();
  }, r);
  return r;
}
async function unbox(page) { await page.evaluate(() => { const b = document.getElementById('rec-box'); if (b) { b.style.display = 'none'; try { b.hidePopover(); } catch {} } window.__recRaise?.(); }).catch(() => {}); }
const pause = (page, ms) => page.waitForTimeout(ms);
async function click(page, locator, hold = 900) { await box(page, locator); await pause(page, hold); await locator.click(); await pause(page, 300); await unbox(page); }
async function type(page, locator, text, delay = 45) { await box(page, locator); await pause(page, 500); await locator.click(); await locator.pressSequentially(text, { delay }); await pause(page, 400); await unbox(page); }
async function go(page, path) { await page.goto(U + path, { waitUntil: 'networkidle', timeout: 90000 }); await overlay(page); await restore(page); }
async function scroll(page, dy, steps = 8) { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(page, 90); } }

/** Opens a recording browser, signs in on the visible sign-in page, runs the script, then saves the video as mp4. */
async function record(name, perm, script, options = {}) {
  const dir = `${__dirname}/raw-${name}`; fs.rmSync(dir, { recursive: true, force: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light', recordVideo: { dir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  // A full page load drops the caption: put it back as soon as the new page is ready.
  page.on('load', () => { restore(page).catch(() => {}); });
  page.on('domcontentloaded', () => { restore(page).catch(() => {}); });
  page.on('pageerror', e => console.log(name, 'PAGEERROR', String(e).slice(0, 160)));
  try {
    if (options.signIn === false) {
      // A continuation clip: signed in out of view, it starts on the page it needs.
      await ctx.request.post(U + '/api/auth/sign-in', { headers: { Origin: U }, data: { email: process.env.SP_USER, password: process.env.SP_PASSWORD } });
      await go(page, options.start ?? '/home');
      await script({ caption: t => caption(page, perm, t), click: (l, h) => click(page, l, h), type: (l, t, d) => type(page, l, t, d), go: p => go(page, p), pause: ms => pause(page, ms), box: l => box(page, l), unbox: () => unbox(page), scroll: (dy, s) => scroll(page, dy, s), page });
      await pause(page, 1500);
      return;
    }
    await go(page, '/sign-in');
    await caption(page, perm, 'Sign in to MS Social Pilot');
    await pause(page, 1200);
    await type(page, page.getByLabel('Email'), process.env.SP_USER, 30);
    await box(page, page.getByLabel('Password', { exact: true })); await page.getByLabel('Password', { exact: true }).fill(process.env.SP_PASSWORD); await pause(page, 500); await unbox(page);
    await click(page, page.getByRole('button', { name: 'Sign in', exact: true }));
    await page.waitForURL(url => !/sign-in/.test(url.pathname), { timeout: 60000 });
    await page.waitForLoadState('networkidle'); await overlay(page);
    await script({ caption: t => caption(page, perm, t), click: (l, h) => click(page, l, h), type: (l, t, d) => type(page, l, t, d), go: p => go(page, p), pause: ms => pause(page, ms), box: l => box(page, l), unbox: () => unbox(page), scroll: (dy, s) => scroll(page, dy, s), page });
    await pause(page, 1500);
  } finally {
    const video = page.video(); await ctx.close(); await b.close();
    const webm = await video.path();
    const out = `${__dirname}/${name}.mp4`;
    require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out]);
    const secs = require('child_process').execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
    console.log(name, '->', out, Math.round(Number(secs)), 's');
  }
}
module.exports = { record, U };
