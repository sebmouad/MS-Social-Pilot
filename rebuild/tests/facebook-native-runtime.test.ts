import { afterEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({values:new Map<string,unknown>(),secret:'private-app-secret' as string|null,create:vi.fn((..._args:unknown[])=>({transport:true}))}));
vi.mock('../src/server/config/store',()=>({runtimeConfig:async(key:string)=>state.values.get(key),runtimeConfigBatch:async(keys:readonly string[])=>Object.fromEntries(keys.map(key=>[key,state.values.get(key)])),runtimeSecret:async()=>state.secret}));
vi.mock('../src/platforms/facebook/formats/transport',()=>({createFacebookNativeTransport:state.create}));
vi.mock('../src/platforms/facebook/media-journal',()=>({facebookMediaJournal:vi.fn()}));
import { configuredFacebookNativeTransport } from '../src/platforms/facebook/runtime';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
const setup=()=>{for(const [key,entry] of CONFIG_BY_KEY)state.values.set(key,entry.defaultValue);};
afterEach(()=>{state.values.clear();state.secret='private-app-secret';vi.clearAllMocks();});

describe('Root-configured Facebook native transport',()=>{
 it('injects current private signing material and validated operator transport limits without dispatch',async()=>{
  setup();state.values.set('facebook.native.uploadOrigins',['https://uploads.example.test']);state.values.set('facebook.native.maxUploadBytes',4096);
  const controller=new AbortController();
  await configuredFacebookNativeTransport('private-page-token',{signal:controller.signal});
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({appSecretProofEnabled:true,appSecret:state.secret}), 'private-page-token', {uploadOrigins:['https://uploads.example.test'],maxUploadBytes:4096,maxResponseBytes:1048576},fetch,controller.signal);
 });
 it('refuses a required missing signing secret before constructing transport',async()=>{
  setup();state.secret=null;await expect(configuredFacebookNativeTransport('token')).rejects.toThrow('signing configuration is unavailable');expect(state.create).not.toHaveBeenCalled();
 });
 it('reads changed policy on the next construction and refuses malformed trust settings before transport',async()=>{
  setup();await configuredFacebookNativeTransport('token');
  state.values.set('facebook.native.maxResponseBytes',2048);await configuredFacebookNativeTransport('token');
  expect(state.create.mock.calls[1]?.[2]).toMatchObject({maxResponseBytes:2048});
  state.values.set('facebook.native.uploadOrigins',['http://unsafe.example.test']);
  await expect(configuredFacebookNativeTransport('token')).rejects.toThrow();
  expect(state.create).toHaveBeenCalledTimes(2);
 });
});
