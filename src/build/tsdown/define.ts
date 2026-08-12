import { loadAukletConfig } from '#auklet/configLoader';
import { normalizeAukletConfig } from '#auklet/config';
import { createBundleConfigs } from '#auklet/build/bundleConfig';
import { createModuleConfigs } from '#auklet/build/moduleConfig';
import { createBuildContext } from '#auklet/build/tsdown/context';
import {
  mergeAukletConfigOverrides,
  readAukletCliConfigOverrides,
} from '#auklet/build/cliOverrides';
import type { AukletConfig } from '#auklet/types';
export type { TsdownFormat } from '#auklet/build/tsdown/types';

export function defineKernelPackageConfigFromOptions(
  packageRoot = process.cwd(),
  config: AukletConfig = {},
) {
  const normalizedConfig = normalizeAukletConfig(config);
  const buildOptions = normalizedConfig.build;
  const formats = buildOptions.formats;
  const context = createBuildContext(
    packageRoot,
    buildOptions,
    normalizedConfig.source,
    normalizedConfig.output,
  );
  const bundleConfigs = createBundleConfigs(context, formats);
  const moduleConfigs = normalizedConfig.modules
    ? createModuleConfigs(context)
    : [];

  return [...bundleConfigs, ...moduleConfigs];
}

export async function defineKernelPackageConfigFromFile(
  packageRoot = process.cwd(),
) {
  const config = mergeAukletConfigOverrides(
    await loadAukletConfig(packageRoot, { cacheBust: true }),
    readAukletCliConfigOverrides(),
  );
  return defineKernelPackageConfigFromOptions(packageRoot, config);
}
