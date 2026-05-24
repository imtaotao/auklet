import fs from 'node:fs';
import path from 'node:path';

const workspaceFile = 'pnpm-workspace.yaml';

export function findWorkspaceRoot(startDir: string) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, workspaceFile))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
