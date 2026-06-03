import fs from 'node:fs';
import path from 'node:path';

export type NpmrcAuthEnvOptions = {
  token?: string;
};

export function findNpmrcWithAuthToken(
  packageRoot: string,
  root: string,
  registry?: string,
) {
  const npmrcFiles = findNpmrcFiles(packageRoot, root);
  return npmrcFiles.find((file) => {
    return hasAuthToken(fs.readFileSync(file, 'utf8'), registry);
  });
}

export function findNpmrcFiles(packageRoot: string, root: string) {
  const files: Array<string> = [];
  let current = path.resolve(packageRoot);
  const boundary = path.resolve(root);

  while (true) {
    const file = path.join(current, '.npmrc');
    if (fs.existsSync(file)) files.push(file);
    if (current === boundary) break;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return files;
}

export function validateNpmrcAuthEnv(
  packageRoot: string,
  root: string,
  options: NpmrcAuthEnvOptions = {},
) {
  const env = createAvailableAuthEnv(options);
  for (const file of findNpmrcFiles(packageRoot, root)) {
    const missing = findMissingNpmrcEnvVars(fs.readFileSync(file, 'utf8'), env);
    if (!missing.length) continue;

    const variable = missing[0];
    throw new Error(
      `[publish] npmrc auth environment is missing: ${variable}\n` +
        `[publish] file: ${file}\n` +
        `[publish] Set ${variable} before retrying, or use --token with an npmrc entry such as:\n` +
        '  //registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
    );
  }
}

export function hasAuthToken(content: string, registry?: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));

  if (!registry) return lines.some((line) => line.includes('_authToken'));

  const authKey = `${toNpmrcRegistryKey(registry)}:_authToken`;
  return lines.some((line) => line.startsWith(authKey));
}

export function toNpmrcRegistryKey(registry: string) {
  const url = parseRegistryUrl(registry);
  const pathname = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;
  return `//${url.host}${pathname}`;
}

const parseRegistryUrl = (registry: string) => {
  try {
    return new URL(registry);
  } catch (error) {
    throw new Error(`[publish] invalid publishConfig.registry: ${registry}`, {
      cause: error,
    });
  }
};

const findMissingNpmrcEnvVars = (
  content: string,
  env: Record<string, string | undefined>,
) => {
  return getNpmrcAuthLines(content)
    .flatMap((line) => [...line.matchAll(/\$\{([^}]+)\}/g)])
    .map((match) => match[1])
    .filter((name) => name && !env[name]);
};

const getNpmrcAuthLines = (content: string) => {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith('#') &&
        !line.startsWith(';') &&
        line.includes('_authToken'),
    );
};

const createAvailableAuthEnv = (options: NpmrcAuthEnvOptions) => {
  if (!options.token) return process.env;
  return {
    ...process.env,
    NODE_AUTH_TOKEN: options.token,
    NPM_TOKEN: options.token,
  };
};
