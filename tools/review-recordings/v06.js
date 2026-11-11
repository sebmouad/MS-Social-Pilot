const { record } = require('./lib');
const TEXT = 'Des gaufres salées au jambon et au fromage, dorées dehors et fondantes dedans : un dîner prêt en 20 minutes que toute la famille adore. Vous les servez avec une salade ou une soupe ? 🧇 #Gaufres #RecetteFacile';
record('06-pages_manage_posts', 'pages_manage_posts', async r => {
  const { page } = r;
  await r.caption('The person writes a post for one of their Pages');
  await r.click(page.getByRole('link', { name: 'Create post' }).first()); await page.waitForLoadState('networkidle'); await r.pause(1200);
  await r.caption('1. Choose the Page');
  await r.click(page.getByRole('button', { name: /Cuisine Pleine d’Envie.*Facebook/ }).first());
  await r.caption('2. Write the text');
  await r.type(page.getByPlaceholder('What do you want to share?'), TEXT, 18);
  await r.caption('3. Add a photo from the library');
  await r.click(page.getByRole('button', { name: 'From library' })); await r.pause(2500);
  const dlg = page.locator('dialog[open]').last();
  await r.click(dlg.getByRole('button', { name: 'Image 9', exact: true }));
  await r.click(dlg.getByRole('button', { name: /Add selected/ })); await r.pause(3500);
  await r.caption('The preview shows the post as it will appear on the Page');
  await r.box(page.getByText('Preview', { exact: true }).locator('xpath=ancestor::*[self::section or self::aside or self::div][1]').first()); await r.pause(3500); await r.unbox();
  await r.caption('4. Publish now: the app creates the post on the Page with pages_manage_posts');
  await r.click(page.locator('button[aria-haspopup="menu"]').last());
  await r.click(page.getByRole('menuitem', { name: 'Publish now' }), 1400);
  await r.pause(1500);
  const confirm = page.locator('dialog[open]').last().getByRole('button', { name: /Publish/ });
  if (await confirm.count()) { await r.click(confirm.first(), 1200); }
  await r.caption('The post is sent to Facebook');
  await page.getByText(/Published|View on Facebook|posted|Sent/i).first().waitFor({ timeout: 150000 }).catch(() => console.log('no published text seen'));
  await r.pause(2500);
  await r.caption('In Posts, the new post is listed as Published, with a link to it on Facebook');
  await r.go('/content?status=published'); await r.pause(2000);
  const row = page.locator('main tbody tr').filter({ hasText: /gaufres salées au jambon/ }).first();
  await r.box(row); await r.pause(2500);
  await r.click(row); await r.pause(2500);
  const link = page.locator('dialog[open]').last().getByRole('link', { name: /View on Facebook/ });
  if (await link.count()) { await r.box(link.first()); await r.pause(3500); await r.unbox(); }
  await page.keyboard.press('Escape');
  await r.caption('pages_manage_posts is used only to publish, schedule and delete the posts the person writes for their own Pages');
  await r.pause(3500);
}).catch(e => { console.error(e); process.exit(1); });
