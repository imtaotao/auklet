import type { AukletEnvContext } from '#auklet/env';

export type CliValueOptions = {
  label: string;
  context: AukletEnvContext;
};

export type DeferredCliValue = {
  raw: string;
  resolve(context: AukletEnvContext): string | undefined;
};

export function createDeferredCliValue(
  value: string,
  options: {
    label: string;
  },
) {
  return {
    raw: value,
    resolve(context) {
      return resolveCliValue(value, { label: options.label, context });
    },
  } satisfies DeferredCliValue;
}

export function resolveCliValue(
  value: string | undefined,
  options: CliValueOptions,
) {
  return options.context.resolveValue(value, { label: options.label });
}

export function resolveCliBoolean(
  value: boolean | string | undefined,
  options: CliValueOptions,
) {
  return options.context.resolveBoolean(value, { label: options.label });
}
