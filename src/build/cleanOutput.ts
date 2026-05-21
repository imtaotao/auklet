import fs from 'node:fs';
import path from 'node:path';
import { normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import type { AukletConfig, LoadAukletConfigOptions } from '#auklet/types';

export function cleanAukletOutputByConfig(
  packageRoot: string,
  config: AukletConfig = {},
) {
  const normalizedConfig = normalizeAukletConfig(config);
  fs.rmSync(path.join(packageRoot, normalizedConfig.output), {
    recursive: true,
    force: true,
  });
}

export async function cleanAukletOutput(
  packageRoot: string,
  options: LoadAukletConfigOptions = {},
) {
  const rawConfig = await loadAukletConfig(packageRoot, options);
  cleanAukletOutputByConfig(packageRoot, rawConfig);
}
