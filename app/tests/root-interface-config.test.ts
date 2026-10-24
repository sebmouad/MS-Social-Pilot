import { expect, it } from 'vitest';
import { CONFIG_BY_KEY, safeConfigShape } from '../src/lib/config/registry';
import { ROOT_INTERFACE_COPY } from '../src/lib/config/root-interface-copy';
it('registers and validates the consumed English/French Root interface catalog', () => {
  const definition = CONFIG_BY_KEY.get('root.interfaceCopy')!;
  expect(safeConfigShape().find(item => item.key === definition.key)?.owner).toEqual({ kind: 'shared' }); expect(definition.consumption).toBe('active');
  expect(definition.schema.safeParse(ROOT_INTERFACE_COPY).success).toBe(true);
  expect(Object.keys(ROOT_INTERFACE_COPY.en).sort()).toEqual(Object.keys(ROOT_INTERFACE_COPY.fr).sort());
  expect(definition.schema.safeParse({ ...ROOT_INTERFACE_COPY, fr: { ...ROOT_INTERFACE_COPY.fr, reset: '' } }).success).toBe(false);
  expect(definition.schema.safeParse({ ...ROOT_INTERFACE_COPY, other: {} }).success).toBe(false);
});
