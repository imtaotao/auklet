import type { AukletConfig } from '#auklet/types';

export const aukletCliConfigOverridesEnv = 'AUKLET_CONFIG_OVERRIDES';

export function encodeAukletCliConfigOverrides(config: AukletConfig) {
  return JSON.stringify(config);
}

export function readAukletCliConfigOverrides() {
  const rawConfig = process.env[aukletCliConfigOverridesEnv];
  if (!rawConfig) return {};
  return JSON.parse(rawConfig) as AukletConfig;
}

export function mergeAukletConfigOverrides(
  config: AukletConfig,
  overrides: AukletConfig,
) {
  return {
    ...config,
    ...overrides,
    build:
      config.build || overrides.build
        ? {
            ...config.build,
            ...overrides.build,
          }
        : undefined,
  } satisfies AukletConfig;
}
