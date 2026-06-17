import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPlainObject } from 'aidly';
import { aukletConfigFiles, isAukletConfigFile } from '#auklet/config';
import type { AukletConfig, LoadAukletConfigOptions } from '#auklet/types';

const asRecord = (value: unknown) => {
  return isPlainObject(value) ? value : null;
};

let configImportVersion = 0;

const assertSupportedConfigFile = (configFile: string) => {
  const basename = path.basename(configFile);
  if (isAukletConfigFile(basename)) return;

  throw new Error(
    '[auklet] unsupported config file: ' +
      basename +
      '. Use auklet.config.js or auklet.config.mjs and export `config`.',
  );
};

export function resolveAukletConfigPath(
  packageRoot: string,
  configFile?: string,
) {
  if (!fs.existsSync(packageRoot)) return null;

  if (configFile) {
    assertSupportedConfigFile(configFile);
    const configPath = path.join(packageRoot, configFile);
    return fs.existsSync(configPath) ? configPath : null;
  }

  const configPaths = aukletConfigFiles
    .map((file) => path.join(packageRoot, file))
    .filter((file) => fs.existsSync(file));

  if (configPaths.length > 1) {
    throw new Error(
      '[auklet] found multiple config files: ' +
        configPaths.map((file) => path.basename(file)).join(', ') +
        '. Keep only one auklet config file.',
    );
  }

  if (configPaths[0]) return configPaths[0];

  for (const file of fs.readdirSync(packageRoot)) {
    if (file.startsWith('auklet.config.') && !isAukletConfigFile(file)) {
      assertSupportedConfigFile(file);
    }
  }

  return null;
}

export function resolveAukletConfigModule(module: Record<string, unknown>) {
  const config = asRecord(module.config);

  if (!config) {
    throw new Error('[auklet] config file must export `config`.');
  }
  return config as AukletConfig;
}

export async function loadAukletConfig(
  packageRoot: string,
  options: LoadAukletConfigOptions = {},
) {
  const configPath = resolveAukletConfigPath(packageRoot, options.configFile);

  if (!configPath) {
    return {};
  }

  const url = pathToFileURL(configPath);
  if (options.cacheBust) {
    configImportVersion += 1;
    url.searchParams.set('t', configImportVersion.toString());
  }

  const module = (await import(url.href)) as Record<string, unknown>;
  return resolveAukletConfigModule(module);
}
