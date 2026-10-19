import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';
import { configurationOwner } from '../src/lib/config/ownership';
import { FACEBOOK_NATIVE_CONFIG, FACEBOOK_NATIVE_TRANSPORT_CONFIG, facebookNativePolicyFrom, facebookNativeTransportPolicyFrom } from '../src/platforms/facebook/native-config';
import { FACEBOOK_NATIVE_CAPABILITIES } from '../src/platforms/facebook/native-capabilities';

describe('Facebook-owned native Root configuration', () => {
  it('registers every native setting under its platform owner without advertising a format', () => {
    expect(CONFIG_SCHEMA_VERSION).toBeGreaterThanOrEqual(76);
    for (const setting of [...FACEBOOK_NATIVE_CONFIG,...FACEBOOK_NATIVE_TRANSPORT_CONFIG]) {
      expect(CONFIG_BY_KEY.get(setting.key)).toMatchObject({key:setting.key,consumption:setting.consumption});
      expect(configurationOwner(setting.key)).toEqual({kind:'platform',id:'facebook'});
      expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true);
    }
    expect(FACEBOOK_NATIVE_CAPABILITIES.every(value=>value.wired===false)).toBe(true);
    expect([...FACEBOOK_NATIVE_CONFIG,...FACEBOOK_NATIVE_TRANSPORT_CONFIG].every(value=>value.consumption==='configured')).toBe(true);
  });
  it('rejects credential upload origins with paths, credentials, fragments or non-HTTPS schemes', () => {
    for (const origin of ['http://rupload.facebook.com','https://evil.test/video-upload','https://token@rupload.facebook.com','https://rupload.facebook.com?token=x','https://rupload.facebook.com#fragment']) {
      expect(()=>facebookNativeTransportPolicyFrom({'facebook.native.uploadOrigins':[origin]})).toThrow();
    }
    expect(()=>facebookNativeTransportPolicyFrom({'facebook.native.uploadOrigins':[]})).toThrow();
  });
  it('applies explicit operator transport values with validated ceilings', () => {
    expect(facebookNativeTransportPolicyFrom({'facebook.native.uploadOrigins':['https://uploads.example.test'],'facebook.native.maxUploadBytes':4096,'facebook.native.maxResponseBytes':2048})).toEqual({uploadOrigins:['https://uploads.example.test'],maxUploadBytes:4096,maxResponseBytes:2048});
    for (const invalid of [null,0,-1,Infinity,NaN,1.2]) expect(()=>facebookNativeTransportPolicyFrom({'facebook.native.maxUploadBytes':invalid})).toThrow();
  });
  it('refuses inconsistent native execution limits before dispatch', () => {
    expect(()=>facebookNativePolicyFrom({'facebook.native.reel.minDurationSeconds':100,'facebook.native.reel.maxDurationSeconds':90})).toThrow();
    expect(()=>facebookNativePolicyFrom({'facebook.native.scheduleMinSeconds':86400,'facebook.native.scheduleMaxSeconds':3600})).toThrow();
    expect(facebookNativePolicyFrom().reel.maxDurationSeconds).toBeGreaterThan(0);
  });
});
