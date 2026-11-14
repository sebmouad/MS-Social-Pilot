const { record } = require('./lib');
// Turns one campaign off and back on (the owner's chosen demonstration of ads_management).
const NAME = '01. Cuisine Pleine d’Envie';
record('15-ads_management', 'ads_management', async r => {
  const { page } = r;
  await r.caption('In Ads › Manage the person can turn a campaign off or on');
  await r.click(page.getByRole('link', { name: 'Ads', exact: true }).first()); await page.waitForLoadState('networkidle'); await r.pause(1200);
  await r.click(page.getByRole('link', { name: 'Manage', exact: true }).first()); await page.waitForLoadState('networkidle'); await r.pause(2000);
  const row = () => page.locator('.am-table tbody tr').filter({ hasText: NAME }).first();
  const toggle = () => row().getByRole('switch');
  await r.box(row()); await r.pause(2500); await r.unbox();
  await r.caption('1. Turn the campaign off: the change is sent to Meta with ads_management');
  await r.click(toggle(), 1200);
  await page.waitForFunction(name => [...document.querySelectorAll('.am-table tbody tr')].some(tr => tr.textContent.includes(name) && tr.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false'), NAME, { timeout: 90000 }).catch(() => console.log('switch did not turn off'));
  await r.pause(2500); await r.box(row()); await r.pause(3000); await r.unbox();
  await r.caption('2. Turn it back on: the person confirms first, because it can spend budget again');
  await r.click(toggle(), 1200);
  const confirm = page.locator('dialog[open]').last().getByRole('button', { name: 'Turn on' });
  await confirm.waitFor({ timeout: 15000 }).catch(() => {});
  if (await confirm.count()) { await r.box(page.locator('dialog[open]').last()); await r.pause(2500); await r.click(confirm, 1200); }
  await page.waitForFunction(name => [...document.querySelectorAll('.am-table tbody tr')].some(tr => tr.textContent.includes(name) && tr.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true'), NAME, { timeout: 90000 }).catch(() => console.log('switch did not turn back on'));
  await r.pause(2500); await r.box(row()); await r.pause(2500); await r.unbox();
  await r.caption('Every change made through the app is listed in History');
  await r.go('/ads/manage?level=history'); await r.pause(2500);
  await r.box(page.locator('main table, main ul').filter({ hasText: /Status|status|Cuisine Pleine/ }).first()); await r.pause(4000); await r.unbox();
  await r.caption('ads_management is used only for the changes the person makes: on/off, budget, name and paused new campaigns');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
