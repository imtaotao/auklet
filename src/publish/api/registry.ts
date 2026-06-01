import { isPlainObject, isString } from 'aidly';

export function getPublishRegistry(publishConfig: unknown) {
  if (!isPlainObject(publishConfig)) return undefined;
  const registry = Reflect.get(publishConfig, 'registry');
  return isString(registry) && registry.length > 0 ? registry : undefined;
}
