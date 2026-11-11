const { record } = require('./lib');
record('04-read_insights', 'read_insights', async r => {
  const { page } = r;
  await r.caption('Insights shows the Page performance figures read with read_insights');
  await r.click(page.getByRole('link', { name: 'Measure', exact: true }).first()); await page.waitForLoadState('networkidle'); await r.pause(2000);
  await r.box(page.locator('.insights-freshness')); await r.pause(3000);
  await r.box(page.locator('main').getByText('Views', { exact: true }).first()); await r.pause(2500); await r.unbox();
  await r.caption('Daily views, reach and engagement for the selected Pages and period');
  await r.scroll(500); await r.pause(3500);
  await r.caption('Audience: followers by country and city, from Page insights');
  await r.go('/insights/audience'); await r.pause(2500); await r.scroll(400); await r.pause(3500);
  await r.caption('The person can refresh the figures from Facebook at any time');
  await r.go('/insights'); await r.pause(1200);
  await r.click(page.getByRole('button', { name: /Sync now/ }).first()); await r.pause(3500);
  await r.caption('read_insights is used only to show the person their own Pages’ performance');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
