import { OperationError } from '@/lib/operation-error';

const invalidDestinationFormats = () => new OperationError('invalid_request', 'Choose a valid publishing format for each selected destination.');

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parse the explicit per-destination intent without allowing stale or out-of-scope keys. */
export function parseDestinationFormats(
  value: unknown,
  targetIds: readonly string[],
  maxTargets: number,
): Record<string, string> {
  if (!Array.isArray(targetIds) || !Number.isSafeInteger(maxTargets) || maxTargets < 0 || targetIds.length > maxTargets) throw invalidDestinationFormats();
  const selected = new Set<string>();
  for (const targetId of targetIds) {
    if (!validIdentifier(targetId, 200) || selected.has(targetId)) throw invalidDestinationFormats();
    selected.add(targetId);
  }
  if (value === undefined || value === null) return Object.create(null) as Record<string, string>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidDestinationFormats();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidDestinationFormats();
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxTargets || keys.some(key => typeof key !== 'string' || !validIdentifier(key, 200) || !selected.has(key))) throw invalidDestinationFormats();

  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || !validIdentifier(descriptor.value, 128)) throw invalidDestinationFormats();
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function requiredFormat(value: unknown): string {
  if (!validIdentifier(value, 128)) throw invalidDestinationFormats();
  return value;
}

/** Resolve intent without converting an invalid explicit/stored value into another format. */
export function resolveDestinationFormat(input: {
  explicit?: string;
  stored?: string | null;
  legacy?: string | null;
  defaultId?: string;
}): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidDestinationFormats();
  if (input.explicit !== undefined) return requiredFormat(input.explicit);
  if (input.stored !== undefined && input.stored !== null) return requiredFormat(input.stored);
  if (input.legacy !== undefined && input.legacy !== null) return requiredFormat(input.legacy);
  return requiredFormat(input.defaultId);
}
