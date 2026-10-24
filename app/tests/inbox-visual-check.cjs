/** File-based synthetic component fixture. Run from rebuild/: node tests/inbox-visual-check.cjs
 * No server, database or provider calls. Action/router stubs are intentional; this
 * checks component scroll/layout only, not Next/RSC transport or live workflows.
 */
const { build } = require('esbuild');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('node:path');
const os = require('node:os');
const project = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-quality-visual-'));
console.log('Synthetic visual fixture:', out);
(async () => {
 await build({ stdin: { resolveDir: project, sourcefile: 'inbox-visual-fixture.tsx', loader: 'tsx', contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InboxList} from './src/modules/inbox/ui/InboxList';
import {inboxListRows} from './src/modules/inbox/ui/InboxListRows';
import {InboxCopyProvider} from './src/modules/inbox/ui/copy-context';
import {inboxCustomerCopy, resolveInboxCatalog} from './src/modules/inbox/customer-copy';
import {ThreadScroll} from './src/modules/inbox/ui/ThreadScroll';
import {ToastProvider} from './src/components/Toast';
import styles from './src/modules/inbox/ui/inbox.module.css';
import './src/styles/tokens.css';
import './src/styles/components.css';
const locale = new URLSearchParams(location.search).get('locale') || 'en';
const copy = resolveInboxCatalog('inboxCopy', inboxCustomerCopy)[locale];
const names = ['Atlas Kitchen', 'Rabat Reads', 'Casablanca Studio', 'Safi Ceramics', 'Fes Table', 'Essaouira Market', 'Marrakech Garden', 'Tangier Coffee', 'Agadir Walks', 'Meknes Bakery'];
const people = ['Nadia Bennani', 'Mehdi Alaoui', 'Sofia Amrani', 'Youssef Naciri', 'Meryem Idrissi'];
const items = Array.from({length:60}, (_,i)=>({key: (i%2?'comment:':'message:')+i, kind:i%2?'comment':'message',id:String(i),author:people[i%people.length],preview:i%2?'Can I book two places for the Saturday workshop?':'Thank you for the details. Are you also open on Sunday?',time:new Date(Date.UTC(2026,9,21,12,0,-i)),target:{id:'page-'+i%10,name:names[i%10],provider:'facebook'},unread:i%3===0?2:0,needsReply:i%3===0,resolved:false,hidden:false,context:null,rating:null,recommendation:null,sentiment:null}));
const abilities = new Map(names.map((_,i)=>['page-'+i,{write:true,resolve:true,hide:true,remove:true}]));
const makePage = (offset)=>({items:items.slice(offset,offset+20),cursor:offset?'position-'+offset:null,timeZone:'Africa/Casablanca'});
const rows = (offset)=>inboxListRows(makePage(offset),abilities,{},'message:0',locale,inboxCustomerCopy,180);
function App(){const [count,setCount]=useState(25);return <ToastProvider><InboxCopyProvider catalog={inboxCustomerCopy}><main data-module="inbox" style={{padding:'24px',maxWidth:'1450px',margin:'auto'}}><header style={{marginBottom:20}}><small>MS Social Pilot · Atlas collective</small><h1>{copy.title}</h1><p>{copy.description}</p></header><div className={styles.split} data-open={new URLSearchParams(location.search).get('thread')==='yes'?'true':'false'}><section className={styles.listPane} aria-label={copy.conversationsAndComments}><InboxList rows={rows(0)} total={60} olderCursor="position-20" location={{}} title={copy.open} locale={locale} maxItems={20} pageLimit={3} loadMoreAction={async input=>{const offset=Number(input.cursor.replace('position-',''));return {ok:true,rows:rows(offset),total:60,olderCursor:offset+20<60?'position-'+(offset+20):null}}}/></section><section className={styles.threadPane}><h2>{copy.conversationWith('Nadia Bennani')}</h2><p>{names[0]} · Messenger</p><ThreadScroll label={copy.historyLabel} resetKey="message:0"><ol className={styles.entries}>{Array.from({length:count},(_,i)=><li key={i} className={styles.entry} data-from={i%2?'channel':'person'}><strong>{i%2?'Atlas Kitchen':'Nadia Bennani'}</strong><p>{i%2?'We have two places left for Saturday. Would you like the morning session?':'That would be wonderful. Can I bring a friend to the workshop?'}</p></li>)}</ol></ThreadScroll><button className="ui-button ui-button--secondary" onClick={()=>setCount(n=>n+1)}>Add synthetic message</button><form className={styles.reply}><label htmlFor="reply">{locale==='fr'?'Votre réponse':'Your reply'}</label><textarea id="reply" placeholder={locale==='fr'?'Écrivez votre réponse…':'Write your reply…'}/><button type="button" className="ui-button ui-button--primary">{locale==='fr'?'Envoyer':'Send reply'}</button></form></section></div></main></InboxCopyProvider></ToastProvider>}
createRoot(document.getElementById('root')).render(<App/>);` }, outfile: out+'/fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx:'automatic', tsconfig:project+'/tsconfig.json', plugins:[{name:'fixture-boundaries',setup(b){
 b.onResolve({filter:/server\/(actions|providers)$/}, args=>({path:args.path,namespace:'fixture-server'}));
 b.onLoad({filter:/.*/,namespace:'fixture-server'},()=>({contents:'export const canManageInbox=async()=>true; export const canManageInboxWorkflow=async()=>true; export const inboxCapabilities=async()=>({});',loader:'js'}));
 b.onResolve({filter:/bulk-action$/},args=>({path:args.path,namespace:'fixture-bulk'}));
 b.onLoad({filter:/.*/,namespace:'fixture-bulk'},()=>({contents:'export const runBulkInboxAction=async()=>({ok:false,error:"Fixture only"});',loader:'js'}));
 b.onResolve({filter:/^next\/navigation$/},args=>({path:args.path,namespace:'fixture-nav'}));
 b.onLoad({filter:/.*/,namespace:'fixture-nav'},()=>({contents:'export const useRouter=()=>({refresh(){},replace(){},push(){}});export const usePathname=()=>"/inbox";export const useSearchParams=()=>new URLSearchParams();',loader:'js'}));
 }}] });
 fs.writeFileSync(out+'/index.html','<!doctype html><html data-theme="vivid" data-mode="light" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-sans,Arial,sans-serif)}*{box-sizing:border-box}h1{margin:8px 0}h2{margin:0;font-size:19px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
 const browser=await chromium.launch({headless:true});
 const results=[];
 for(const theme of ['vivid','meta','warm','clean']) for(const mode of ['light','dark']) for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+out+'/index.html');await page.waitForSelector('[data-inbox-list-scroll]');
  await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.mode=mode},{theme,mode});
  const metrics=await page.evaluate(()=>{const scroll=document.querySelector('[data-inbox-list-scroll]');return {overflow:document.documentElement.scrollWidth>innerWidth,listScrolls:scroll.scrollHeight>scroll.clientHeight,rows:document.querySelectorAll('[data-inbox-item]').length}});
  await page.locator('[data-inbox-list-scroll]').evaluate(el=>{el.scrollTop=el.scrollHeight});
  await page.waitForFunction(()=>document.querySelectorAll('[data-inbox-item]').length>20);
  await page.screenshot({path:out+'/'+theme+'-'+mode+'-'+width+'.png',fullPage:true});
  results.push({theme,mode,width,...metrics,appended:await page.locator('[data-inbox-item]').count(),errors});await page.close();
 }
 console.log(JSON.stringify(results,null,2));await browser.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
