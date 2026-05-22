import { loadAukletConfig } from '#auklet/configLoader';
import { normalizeAukletConfig } from '#auklet/config';
import { createBundleConfigs } from '#auklet/build/bundleConfig';
import { createModuleConfigs } from '#auklet/build/moduleConfig';
import { createBuildContext } from '#auklet/build/tsdown/context';
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
  const config = await loadAukletConfig(packageRoot, { cacheBust: true });
  return defineKernelPackageConfigFromOptions(packageRoot, config);
}
