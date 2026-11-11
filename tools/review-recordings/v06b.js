const { record } = require('./lib');
record('06b-tail', 'pages_manage_posts', async r => {
  const { page } = r;
  await r.caption('In Posts, the new post is listed as Published');
  await r.pause(1500);
  const row = page.locator('main tbody tr').filter({ hasText: /gaufres salées au jambon et au fromage, dorées dehors/ }).first();
  await row.waitFor({ timeout: 30000 });
  await r.box(row); await r.pause(3000);
  await r.caption('Its details show where it was published, with a link to the post on Facebook');
  await r.click(row); await r.pause(2500);
  const link = page.locator('dialog[open]').last().getByRole('link', { name: /View on Facebook/ });
  if (await link.count()) { await r.box(link.first()); await r.pause(4000); await r.unbox(); } else console.log('no View on Facebook link');
  await page.keyboard.press('Escape'); await r.pause(800);
  await r.caption('pages_manage_posts is used only to publish, schedule and delete the posts the person writes for their own Pages');
  await r.pause(4000);
}, { signIn: false, start: '/content?status=published' }).catch(e => { console.error(e); process.exit(1); });
