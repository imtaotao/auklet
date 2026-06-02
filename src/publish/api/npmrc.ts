import fs from 'node:fs';
import path from 'node:path';

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
