const { record } = require('./lib');
record('02-business_management', 'business_management', async r => {
  const { page } = r;
  await r.caption('Pages and ad accounts can be owned by a Meta business portfolio');
  await r.go('/settings/channels'); await r.pause(1500);
  await r.caption('business_management reads the portfolio assets this person can use: its Pages and ad accounts');
  await r.click(page.getByRole('button', { name: 'Manage selections' })); await r.pause(1200);
  const list = page.locator('dialog[open]').last();
  await r.box(list.getByText('Top Recettes')); await r.pause(2500);
  await r.box(list.getByText(/Ad account · act_/).first()); await r.pause(2500); await r.unbox();
  await r.caption('The person ticks the assets this workspace may use, then saves');
  await r.box(list.getByRole('button', { name: 'Save selections' })); await r.pause(2000); await r.unbox();
  await r.click(list.getByRole('button', { name: 'Cancel' }));
  await r.caption('The selected business ad account then appears in Ads, with its results');
  await r.go('/ads'); await r.pause(2000);
  await r.box(page.locator('main tbody tr').filter({ hasText: 'Top Recettes' }).first()); await r.pause(3000); await r.unbox();
  await r.caption('business_management is used only to find the Pages and ad accounts of the person’s business portfolios');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
