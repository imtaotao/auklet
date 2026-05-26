import fs from 'node:fs';
import path from 'node:path';

const toPosixPath = (value: string) => {
  return value.split(path.sep).join('/');
};

export function getBundleEntry(packageRoot: string, source = 'src') {
  const tsEntry = path.join(source, 'index.ts');
  const tsxEntry = path.join(source, 'index.tsx');

  if (fs.existsSync(path.join(packageRoot, tsEntry))) {
    return { index: toPosixPath(tsEntry) };
  }
  if (fs.existsSync(path.join(packageRoot, tsxEntry))) {
    return { index: toPosixPath(tsxEntry) };
  }
  return { index: toPosixPath(tsEntry) };
}

export function getModuleEntries(packageRoot: string, source = 'src') {
  const sourceRoot = path.join(packageRoot, source);
  const entries: Record<string, string> = {};

  if (!fs.existsSync(sourceRoot)) {
    return getBundleEntry(packageRoot, source);
  }

  const collect = (dir: string) => {
    const dirEntries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dirEntry of dirEntries) {
      const file = path.join(dir, dirEntry.name);

      if (dirEntry.isDirectory()) {
        if (dirEntry.name !== '__tests__') collect(file);
        continue;
      }

      if (!/\.(ts|tsx)$/.test(dirEntry.name)) continue;
      if (/\.d\.ts$/.test(dirEntry.name)) continue;
      if (/\.(spec|test)\.(ts|tsx)$/.test(dirEntry.name)) continue;

      const sourceRelative = toPosixPath(path.relative(packageRoot, file));
      const entryName = toPosixPath(path.relative(sourceRoot, file)).replace(
        /\.(ts|tsx)$/,
        '',
      );

      entries[entryName] ??= sourceRelative;
    }
  };

  collect(sourceRoot);

  return Object.keys(entries).length > 0
    ? entries
    : getBundleEntry(packageRoot, source);
}
