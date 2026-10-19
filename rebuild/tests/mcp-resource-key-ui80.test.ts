// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {McpKeyManager} from '../src/modules/settings/ui/mcp/keys';
vi.mock('../src/modules/settings/ui/settings.module.css',()=>({default:{}}));
let root:ReturnType<typeof createRoot>,container:HTMLDivElement;
const resources=[{id:'a',name:'Bakery',kind:'channel' as const},{id:'b',name:'Shop',kind:'channel' as const},{id:'ad',name:'Campaign account',kind:'adAccount' as const}];
const props={features:[{id:'publishing/posts',name:'Posts',module:'publishing',canRead:true,canWrite:true}],initialKeys:[],maxLifetimeDays:180,defaultLifetimeDays:30,resources,resourcesTruncated:false};
const checkbox=(text:string)=>[...container.querySelectorAll('label')].find(l=>l.textContent?.includes(text))!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
const click=(element:HTMLElement)=>act(async()=>element.click());
async function prepare(){await act(async()=>root.render(createElement(McpKeyManager,props)));const name=container.querySelector<HTMLInputElement>('[name=name]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Automation');name.dispatchEvent(new Event('input',{bubbles:true}));container.querySelector<HTMLInputElement>('[name=features]')!.click();});}
async function submit(){await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'Retry safely.'})})));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe('API key resource selection',()=>{
 it('sends only checked channels and independently checked ad accounts after consent',async()=>{await prepare();await click(checkbox('Bakery'));await click(checkbox('Campaign account'));await submit();expect(fetch).not.toHaveBeenCalled();await click(checkbox('I approve issuing'));await submit();expect(fetch).toHaveBeenCalledTimes(1);const payload=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);expect(payload.resourceScope).toEqual({version:1,mode:'selected',ids:['a'],adAccountIds:['ad']});expect(payload.confirmation).toBe('CREATE MCP KEY Automation');expect(container.querySelector<HTMLInputElement>('[name=name]')!.value).toBe('Automation');expect(checkbox('Bakery').checked).toBe(true);expect(container.textContent).toContain('Retry safely.');});
 it('requires renewed consent when changing to all current and future resources',async()=>{await prepare();await click(checkbox('I approve issuing'));await click(checkbox('All selected channels'));await submit();expect(fetch).not.toHaveBeenCalled();await click(checkbox('I approve issuing'));await submit();const payload=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);expect(payload.resourceScope).toEqual({version:1,mode:'all'});});
 it('keeps an empty selection explicit instead of silently granting every resource',async()=>{await prepare();await click(checkbox('I approve issuing'));await submit();const payload=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);expect(payload.resourceScope).toEqual({version:1,mode:'selected',ids:[],adAccountIds:[]});});
});
