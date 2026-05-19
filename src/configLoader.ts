import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { aukletConfigFile } from '#auklet/config';
import type { AukletConfig, LoadAukletConfigOptions } from '#auklet/types';

const importAukletConfigModule = async (configPath: string, href: string) => {
  try {
    return (await import(href)) as Record<string, unknown>;
  } catch (error) {
    if (!isUnknownTsExtensionError(error) || !configPath.endsWith('.ts')) {
      throw error;
    }
    return importTsOptionsModule(href);
  }
};

const importTsOptionsModule = async (href: string) => {
  const configPath = fileURLToPath(href);
  const source = fs.readFileSync(configPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: configPath,
  });
  const tempFile = path.join(
    path.dirname(configPath),
    `.auklet.config.${process.pid}.${Date.now()}.mjs`,
  );

  fs.writeFileSync(tempFile, output.outputText);
  try {
    return (await import(pathToFileURL(tempFile).href)) as Record<
      string,
      unknown
    >;
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
};

const isUnknownTsExtensionError = (error: unknown) => {
  return (
    error instanceof TypeError &&
    'code' in error &&
    error.code === 'ERR_UNKNOWN_FILE_EXTENSION'
  );
};

const asRecord = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

export function resolveAukletConfigModule(module: Record<string, unknown>) {
  const candidates = [
    module,
    asRecord(module.default),
    asRecord(module['module.exports']),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const config = asRecord(candidate.config);
    if (config) {
      return config as AukletConfig;
    }
  }
  return {};
}

export async function loadAukletConfig(
  packageRoot: string,
  options: LoadAukletConfigOptions = {},
) {
  const configPath = path.join(
    packageRoot,
    options.configFile ?? aukletConfigFile,
  );
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const url = pathToFileURL(configPath);
  if (options.cacheBust) {
    url.searchParams.set('t', Date.now().toString());
  }

  if (configPath.endsWith('.ts')) {
    const module = await importTsOptionsModule(url.href);
    return resolveAukletConfigModule(module);
  }

  const module = await importAukletConfigModule(configPath, url.href);
  return resolveAukletConfigModule(module);
}
