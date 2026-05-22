import fs from 'node:fs';
import path from 'node:path';

const toPosixPath = (value: string) => {
  return value.split(path.sep).join('/');
};

export function getBundleEntry(packageRoot: string) {
  const tsEntry = 'src/index.ts';
  const tsxEntry = 'src/index.tsx';

  if (fs.existsSync(path.join(packageRoot, tsEntry))) {
    return { index: tsEntry };
  }
  if (fs.existsSync(path.join(packageRoot, tsxEntry))) {
    return { index: tsxEntry };
  }
  return { index: tsEntry };
}

export function getModuleEntries(packageRoot: string) {
  const sourceRoot = path.join(packageRoot, 'src');
  const entries: Record<string, string> = {};

  if (!fs.existsSync(sourceRoot)) {
    return getBundleEntry(packageRoot);
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
    : getBundleEntry(packageRoot);
}
