// Screenshot + DOM audit of a local preview (synthetic data only). Usage from rebuild/:
//   PW=<qa password> ROUTES="/home /content" WIDTHS=1440,390 node scripts/dev/ui-audit.mjs <out-dir>
// Optional: BASE (default http://localhost:3300), EMAIL (default preview-qa@example.test).
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE=process.env.BASE||'http://localhost:3300', OUT=process.argv[2], PW=process.env.PW, EMAIL=process.env.EMAIL||'preview-qa@example.test';
if(!OUT||!PW){console.error('usage: PW=... node scripts/dev/ui-audit.mjs <out-dir>');process.exit(2)}
fs.mkdirSync(OUT,{recursive:true});
const routes=(process.env.ROUTES||'').split(' ').filter(Boolean);
const widths=(process.env.WIDTHS||'1440,390').split(',').map(Number);
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await page.goto(BASE+'/sign-in');
await page.fill('input[type=email]',EMAIL);
await page.fill('input[type=password]',PW);
await Promise.all([page.waitForURL(u=>!u.pathname.startsWith('/sign-in'),{timeout:60000}),page.click('button[type=submit]')]);
const report=[];
for(const w of widths){
 await page.setViewportSize({width:w,height:w>800?900:844});
 for(const r of routes){
  const errs=[]; const onC=m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))}; page.on('console',onC);
  const onE=e=>errs.push('PAGEERROR '+e.message.slice(0,200)); page.on('pageerror',onE);
  let status=0; try{const resp=await page.goto(BASE+r,{waitUntil:'networkidle',timeout:90000}); status=resp?.status();}catch(e){errs.push('GOTO '+e.message.slice(0,100))}
  await page.waitForTimeout(400);
  const info=await page.evaluate(()=>{
   const vis=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0};
   const name=e=>(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')&&document.getElementById(e.getAttribute('aria-labelledby'))?.textContent||e.textContent||e.getAttribute('title')||e.querySelector('img[alt]')?.alt||'').trim();
   const unnamed=[...document.querySelectorAll('button,a[href],[role=button]')].filter(vis).filter(e=>!name(e)).map(e=>e.outerHTML.slice(0,140));
   const inputs=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).filter(e=>!(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.title)).map(e=>e.outerHTML.slice(0,140));
   const overflow=document.documentElement.scrollWidth-document.documentElement.clientWidth;
   const wide=[...document.querySelectorAll('body *')].filter(vis).filter(e=>e.getBoundingClientRect().right>innerWidth+2&&!e.closest('[style*=overflow],.table-wrap,[class*=scroll]')).slice(0,5).map(e=>e.tagName+'.'+e.className.toString().slice(0,60));
   const small=innerWidth<500?[...document.querySelectorAll('button,a[href],input,select')].filter(vis).filter(e=>{const b=e.getBoundingClientRect();return b.height<32&&b.width<200}).slice(0,8).map(e=>(name(e)||e.outerHTML).slice(0,50)+':'+Math.round(e.getBoundingClientRect().height)):[];
   const h1=[...document.querySelectorAll('h1')].map(h=>h.textContent.trim().slice(0,60));
   const imgsNoAlt=[...document.querySelectorAll('img:not([alt])')].length;
   const raw=(document.body.innerText.match(/\b(undefined|NaN|null|\[object Object\]|Error:|TypeError)\b/g)||[]);
   return {unnamed,inputs,overflow,wide,small,h1,imgsNoAlt,raw,height:document.documentElement.scrollHeight,title:document.title};
  });
  const file=`${OUT}/${w}${r.replace(/\//g,'_')||'_root'}.png`;
  await page.screenshot({path:file,fullPage:true}).catch(()=>{});
  report.push({w,r,status,url:page.url().replace(BASE,''),...info,errs:[...new Set(errs)].slice(0,5)});
  page.off('console',onC); page.off('pageerror',onE);
  console.error(w,r,status);
 }
}
fs.writeFileSync(OUT+'/report.json',JSON.stringify(report,null,1));
await browser.close();
