const { record } = require('./lib');
record('03-pages_read_engagement', 'pages_read_engagement', async r => {
  const { page } = r;
  await r.caption('Posts lists what was published on the person’s Pages, with reactions, comments and reach');
  await r.go('/content?status=published'); await r.pause(2000);
  // Today's posts have no engagement yet: show one whose reactions were already read from the Page.
  const index = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('main thead th')].map(th => th.textContent.trim());
    const col = heads.findIndex(text => /^Reactions/.test(text));
    const rows = [...document.querySelectorAll('main tbody tr')];
    const found = rows.findIndex(row => Number((row.children[col]?.textContent || '').replace(/[^0-9]/g, '')) > 0);
    return found < 0 ? 0 : found;
  });
  const chosen = page.locator('main tbody tr').nth(index);
  await chosen.scrollIntoViewIfNeeded(); await r.pause(800);
  await r.box(chosen); await r.pause(2500); await r.unbox();
  await r.caption('Opening a post shows its content and engagement read from the Page');
  await r.click(chosen); await r.pause(2500);
  await r.box(page.locator('dialog[open]').last()); await r.pause(4000); await r.unbox();
  await page.keyboard.press('Escape'); await r.pause(800);
  await r.caption('Post explorer compares the engagement of every published post');
  await r.go('/insights/posts'); await r.pause(2000);
  await r.box(page.locator('main thead').first()); await r.pause(2500); await r.unbox();
  await r.caption('Sorting by reactions puts the most engaging posts first');
  await r.click(page.locator('main thead th').filter({ hasText: /^Reactions/ }).first().locator('button').first(), 900); await page.waitForLoadState('networkidle'); await r.pause(2500);
  await r.caption('Each post’s reactions, comments, shares and views, read from the Page');
  await r.click(page.locator('main tbody tr').first(), 900); await r.pause(2500);
  await r.box(page.locator('dialog[open] dl').first()); await r.pause(4000); await r.unbox();
  await page.keyboard.press('Escape');
  await r.caption('pages_read_engagement is used to read the person’s own Page posts and their engagement');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
