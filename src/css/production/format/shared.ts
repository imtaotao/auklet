import fs from 'node:fs';
import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
export { toRelativeImportSpecifier } from '#auklet/css/core/style/specifier';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

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

export function writeStyleFile(file: string, code: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code.trim() ? code : emptyStyleFileComment);
}
