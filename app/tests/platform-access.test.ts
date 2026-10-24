import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolvePlatformAccess } from '../src/platforms/access';
import { entry } from '../src/lib/config/entry';

const module = { id: 'example', enabledKey: 'example.enabled', access: { includedByDefaultKey: 'example.default', planFeaturesKey: 'example.plans' } };
const definition = (key: string, defaultValue: unknown, schema: z.ZodTypeAny) => entry({ key, defaultValue, schema, group: 'Example', label: key, description: key, kind: 'json', consumption: 'active' });
const definitions = [definition('example.enabled', true, z.boolean()), definition('example.default', false, z.boolean()), definition('example.plans', ['example_access'], z.array(z.string().trim().min(1)))];
const row = (key: string, value: unknown, encrypted = false) => ({ key, value, encrypted });
describe('module-owned platform access', () => {
  it('requires the declared plan key when not included by default', () => {
    expect(resolvePlatformAccess([module], definitions, {})).toEqual({ example: false });
    expect(resolvePlatformAccess([module], definitions, { planFeatures: ['example_access', 'platform_uninstalled'] })).toEqual({ example: true });
  });
  it('reads Root default inclusion and configurable plan key changes', () => {
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.default', true)] })).toEqual({ example: true });
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.plans', ['custom_access'])], planFeatures: ['example_access'] })).toEqual({ example: false });
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.plans', ['custom_access'])], planFeatures: ['custom_access'] })).toEqual({ example: true });
  });
  it('never treats a plan grant as installation or enablement', () => {
    expect(resolvePlatformAccess([], definitions, { planFeatures: ['platform_uninstalled'] })).toEqual({});
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.enabled', false)], planFeatures: ['example_access'] })).toEqual({ example: false });
  });
  it('does not grant empty plan key policies or suspended workspaces', () => {
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.plans', [])], planFeatures: ['example_access'] })).toEqual({ example: false });
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.default', true)], suspended: true })).toEqual({ example: false });
  });
  it.each([
    row('example.enabled', 'true'), row('example.default', true, true), row('example.plans', ['']), row('example.plans', null),
  ])('fails closed on invalid or encrypted policy $key', setting => {
    expect(resolvePlatformAccess([module], definitions, { settings: [row('example.default', true), setting], planFeatures: ['example_access'] })).toEqual({ example: false });
  });
  it('refuses modules whose declared controls are missing from the registry', () => {
    expect(resolvePlatformAccess([module], [], { planFeatures: ['example_access'] })).toEqual({ example: false });
  });
});
