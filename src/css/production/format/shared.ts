import fs from 'node:fs';
import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';
import { toPosixPath } from '#auklet/utils';

export const emptyStyleFileComment =
  '/* Empty style file kept so automated tooling can resolve this CSS path. */\n';

export type FormatWriterOptions = {
  config: ModuleStyleBuildConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
};

export type ThemeStyleOutput = {
  themeName: string;
  file: string;
};

export function toRelativeImportSpecifier(fromDir: string, file: string) {
  const relative = toPosixPath(path.relative(fromDir, file));
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function writeStyleFile(file: string, code: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code.trim() ? code : emptyStyleFileComment);
}
