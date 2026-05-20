import fs from 'node:fs';
import path from 'node:path';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue };

export type VirtualProject = {
  root: string;
  resolve: (...segments: Array<string>) => string;
  writeFile: (relativePath: string, content: string) => string;
  writeFiles: (files: Record<string, string>) => void;
  writeJson: (relativePath: string, value: JsonValue) => string;
  writePackageJson: (value: Record<string, JsonValue>) => string;
  writeAukletConfig: (content: string) => string;
  readFile: (relativePath: string) => string;
  listFiles: (relativePath: string) => Array<string>;
  exists: (relativePath: string) => boolean;
  cleanup: () => void;
};

const virtualProjectsRoot = path.join(__dirname, '..', '.tmp');

export function createVirtualProject(prefix = 'auklet-project-') {
  fs.mkdirSync(virtualProjectsRoot, { recursive: true });

  const root = fs.mkdtempSync(path.join(virtualProjectsRoot, prefix));

  const resolve = (...segments: Array<string>) => {
    return path.join(root, ...segments);
  };

  const writeFile = (relativePath: string, content: string) => {
    const file = resolve(relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  const writeFiles = (files: Record<string, string>) => {
    for (const [relativePath, content] of Object.entries(files)) {
      writeFile(relativePath, content);
    }
  };

  const writeJson = (relativePath: string, value: JsonValue) => {
    return writeFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  };

  const writePackageJson = (value: Record<string, JsonValue>) => {
    return writeJson('package.json', value);
  };

  const writeAukletConfig = (content: string) => {
    return writeFile('auklet.config.ts', content);
  };

  const readFile = (relativePath: string) => {
    return fs.readFileSync(resolve(relativePath), 'utf8');
  };

  const listFiles = (relativePath: string) => {
    const targetRoot = resolve(relativePath);
    const files: Array<string> = [];
    if (!fs.existsSync(targetRoot)) return files;

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        files.push(path.relative(targetRoot, file).split(path.sep).join('/'));
      }
    };

    walk(targetRoot);
    return files.sort();
  };

  const exists = (relativePath: string) => {
    return fs.existsSync(resolve(relativePath));
  };

  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return {
    root,
    resolve,
    writeFile,
    writeFiles,
    writeJson,
    writePackageJson,
    writeAukletConfig,
    readFile,
    listFiles,
    exists,
    cleanup,
  } satisfies VirtualProject;
}
