import { isArray } from 'aidly';
import {
  createDeferredCliValue,
  resolveCliBoolean,
  resolveCliValue,
} from '#auklet/cli/parse/values';
import type { AukletEnvContext } from '#auklet/env';

export function stripArgsSeparator(args: Array<string>) {
  return args.filter((arg) => arg !== '--');
}

export function readFlagValue(
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  flag: string,
) {
  const value = inlineValue ?? args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function readOptionalFlagValue(
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
) {
  if (inlineValue !== undefined) return inlineValue;

  const value = args[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

export function dedupe<T>(items: Array<T>) {
  return [...new Set(items)];
}

export function stringOption(
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
) {
  if (value === undefined) return undefined;
  if (isArray(value)) return stringOption(value.at(-1), label, envContext);
  return resolveCliValue(String(value), { label, context: envContext });
}

export function deferredStringOption(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (isArray(value)) return deferredStringOption(value.at(-1), label);
  return createDeferredCliValue(String(value), { label });
}

export function booleanOption(
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
  defaultValue = false,
) {
  if (value === undefined) return defaultValue;
  if (isArray(value)) {
    return booleanOption(value.at(-1), label, envContext, defaultValue);
  }
  if (typeof value === 'boolean') return value;
  return resolveCliBoolean(String(value), { label, context: envContext });
}

export function stringArrayOption(
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
) {
  if (value === undefined) return [];
  const values = isArray(value)
    ? value.map((item) => stringOption(item, label, envContext)).filter(Boolean)
    : [stringOption(value, label, envContext)].filter(Boolean);
  return values.filter((item): item is string => Boolean(item));
}

export function validateUnknownFlags(
  argv: Record<string, unknown>,
  allowedFlags: Set<string>,
  scope: string,
) {
  for (const flag of Object.keys(argv)) {
    if (!allowedFlags.has(flag)) {
      throw new Error(`[${scope}] unknown option: --${flag}`);
    }
  }
}

export function validateNoPrefixedFlags(
  args: Array<string>,
  allowedFlags: Set<string>,
  scope: string,
) {
  const flag = args.find(
    (arg) => arg.startsWith('--no-') && !allowedFlags.has(arg),
  );
  if (flag) {
    throw new Error(`[${scope}] unknown option: ${flag}`);
  }
}
