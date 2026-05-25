import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import type { PublishTarget } from '#auklet/publish/types';

const supportedExtensions = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.css',
  '.json',
  '.yaml',
  '.yml',
]);

export async function formatPublishOutputs(
  targets: Array<PublishTarget>,
  enabled: boolean,
) {
  if (!enabled) return;
  for (const target of targets) {
    const files = collectPublishFiles(target);
    for (const file of files) {
      await formatFile(file);
    }
  }
}

const collectPublishFiles = (target: PublishTarget) => {
  const patterns = target.packageJson.files ?? [];
  const includes = patterns.filter((item) => !item.startsWith('!'));
  const excludes = patterns
    .filter((item) => item.startsWith('!'))
    .map((item) => item.slice(1));

  const files = new Set<string>();
  for (const include of includes) {
    const absolutePath = path.resolve(target.packageRoot, include);
    if (!fs.existsSync(absolutePath)) continue;
    for (const file of walkFiles(absolutePath)) {
      if (isExcluded(target.packageRoot, file, excludes)) continue;
      if (!isSupportedStyleFile(file)) continue;
      files.add(file);
    }
  }
  return [...files].sort();
};

const walkFiles = (absolutePath: string): Array<string> => {
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];
  if (!stat.isDirectory()) return [];

  const files: Array<string> = [];
  for (const entry of fs.readdirSync(absolutePath)) {
    files.push(...walkFiles(path.join(absolutePath, entry)));
  }
  return files;
};

const isExcluded = (
  packageRoot: string,
  file: string,
  excludes: Array<string>,
) => {
  const relativePath = path
    .relative(packageRoot, file)
    .split(path.sep)
    .join('/');
  return excludes.some((exclude) => {
    const normalized = exclude.replace(/\\/g, '/').replace(/\/$/, '');
    return (
      relativePath === normalized || relativePath.startsWith(`${normalized}/`)
    );
  });
};

const isSupportedStyleFile = (file: string) => {
  if (file.endsWith('.d.ts')) return true;
  return supportedExtensions.has(path.extname(file));
};

const formatFile = async (file: string) => {
  const source = fs.readFileSync(file, 'utf8');
  let formatted: string;
  try {
    formatted = await prettier.format(source, { filepath: file });
  } catch {
    return;
  }
  if (formatted !== source) {
    fs.writeFileSync(file, formatted);
  }
};
