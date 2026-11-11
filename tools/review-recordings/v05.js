const { record } = require('./lib');
record('05-pages_read_user_content', 'pages_read_user_content', async r => {
  const { page } = r;
  await r.caption('Inbox collects the comments visitors leave on the person’s Page posts');
  await r.click(page.getByRole('link', { name: 'Engage', exact: true }).first()); await page.waitForLoadState('networkidle'); await r.pause(2000);
  await r.click(page.getByRole('link', { name: /Comments/ }).first()); await page.waitForLoadState('networkidle'); await r.pause(1500);
  const row = page.locator('main li, main [role=listitem]').filter({ hasText: /Hummm/ }).first();
  await r.box(row); await r.pause(2500); await r.unbox();
  await r.caption('Opening a comment shows its text, its author and the post it was left on');
  await r.click(row); await r.pause(2500);
  await r.box(page.locator('main').getByText(/Hummm/).last()); await r.pause(3500);
  await r.box(page.locator('main').getByText('On your post').last()); await r.pause(3000); await r.unbox();
  await r.caption('pages_read_user_content is used to read visitors’ comments on the person’s Page so they can answer them');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
