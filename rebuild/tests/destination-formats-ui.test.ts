// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DestinationFormats, effectiveDestinationFormat } from '../src/modules/publishing/components/DestinationFormats';
import type { PublishingFormatDescriptor } from '../src/platforms/types';
const descriptor = (id:string):PublishingFormatDescriptor => ({id,label:`Example ${id}`,media:{kinds:[],maxImages:0,maxVideos:0,mixedKinds:false,linkWithMedia:false,imageAltText:false},firstComment:false,remoteStatus:true,remoteDelete:true,scheduling:{application:true,native:false}});
const target={id:'channel-a',name:'Example channel',publishingFormats:[descriptor('standard'),descriptor('brief')],defaultPublishingFormatId:'standard'};
let container:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('keeps an unavailable saved choice and lets the user deliberately replace it',async()=>{
 function Harness(){const [values,setValues]=useState({'channel-a':'removed'});return createElement(DestinationFormats,{targets:[target],selectedIds:['channel-a'],values,onChange:(id,value)=>setValues(current=>({...current,[id]:value})),formId:'test-form'});}
 await act(async()=>root.render(createElement(Harness)));
 const select=container.querySelector('select')!;
 expect(select.value).toBe('removed');expect(select.getAttribute('aria-invalid')).toBe('true');
 expect(container.querySelector(`label[for="${select.id}"]`)?.textContent).toContain('Example channel');
 expect(document.getElementById(select.getAttribute('aria-describedby')!)).not.toBeNull();
 await act(async()=>{select.value='brief';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(select.value).toBe('brief');expect(select.hasAttribute('aria-invalid')).toBe(false);
});
it('omits unselected destinations and avoids a redundant picker for one valid format',async()=>{
 await act(async()=>root.render(createElement(DestinationFormats,{targets:[target],selectedIds:[],values:{},onChange:()=>{}})));
 expect(container.textContent).toBe('');
 await act(async()=>root.render(createElement(DestinationFormats,{targets:[{...target,publishingFormats:[descriptor('standard')]}],selectedIds:['channel-a'],values:{},onChange:()=>{}})));
 expect(container.querySelector('select')).toBeNull();expect(container.textContent).toContain('Example standard');
 expect(effectiveDestinationFormat(target,{'channel-a':''})).toBe('');
 expect(effectiveDestinationFormat({...target,defaultPublishingFormatId:undefined},{})).toBeUndefined();
});
