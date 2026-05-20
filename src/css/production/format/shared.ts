import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';
import { toPosixPath } from '#auklet/utils';

export const emptyModuleEntryComment =
  '/* Empty style entry kept so automated tooling can resolve this module CSS path. */\n';

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
