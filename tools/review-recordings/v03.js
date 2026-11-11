const { record } = require('./lib');
record('03-pages_read_engagement', 'pages_read_engagement', async r => {
  const { page } = r;
  await r.caption('Posts lists what was published on the person’s Pages, with reactions, comments and reach');
  await r.go('/content?status=published'); await r.pause(2000);
  await r.box(page.locator('main tbody tr').first()); await r.pause(2500); await r.unbox();
  await r.caption('Opening a post shows its content and engagement read from the Page');
  await r.click(page.locator('main tbody tr').first()); await r.pause(2500);
  await r.box(page.locator('dialog[open]').last()); await r.pause(4000); await r.unbox();
  await page.keyboard.press('Escape'); await r.pause(800);
  await r.caption('Post explorer compares the engagement of every published post');
  await r.go('/insights/posts'); await r.pause(2000);
  await r.box(page.locator('main thead').first()); await r.pause(2500); await r.unbox();
  await r.click(page.locator('main tbody tr').nth(1), 900); await r.pause(2500);
  await r.box(page.locator('dialog[open] dl').first()); await r.pause(4000); await r.unbox();
  await page.keyboard.press('Escape');
  await r.caption('pages_read_engagement is used to read the person’s own Page posts and their engagement');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
