import fs from 'node:fs';
import path from 'node:path';

export const bundleFiles = ['index.cjs', 'index.d.ts', 'index.js', 'index.mjs'];

export function readDist(packageDir: string, file: string) {
  return fs.readFileSync(path.join(process.cwd(), packageDir, 'dist', file), {
    encoding: 'utf8',
  });
}

export function listDistFiles(packageDir: string) {
  const files: Array<string> = [];
  const distRoot = path.join(process.cwd(), packageDir, 'dist');

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      files.push(path.relative(distRoot, file).split(path.sep).join('/'));
    }
  };

  walk(distRoot);
  return files.sort();
}

export function lines(...values: Array<string>) {
  return `${values.join('\n')}\n`;
}
