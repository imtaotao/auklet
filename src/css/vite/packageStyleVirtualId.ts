import path from 'node:path';
import type { ModuleGraphLookup } from '#auklet/css/vite/hmr/propagate';

export const PACKAGE_STYLE_VIRTUAL_PREFIX = '\0auklet-package-style:';

export function toPackageStyleVirtualId(file: string) {
  return `${PACKAGE_STYLE_VIRTUAL_PREFIX}${path.resolve(file)}`;
}

export function fromPackageStyleVirtualId(id: string) {
  if (!id.startsWith(PACKAGE_STYLE_VIRTUAL_PREFIX)) return null;
  return path.resolve(id.slice(PACKAGE_STYLE_VIRTUAL_PREFIX.length));
}

// JS `import 'pkg/file.css'` loads as this virtual CSS module. Include it in
// hotUpdate when the source file changes (package-style tracker only covers
// auklet-css:* package graph entries, not these direct file virtuals).
export function collectDirectPackageStyleHotUpdateModules(options: {
  file: string;
  moduleGraph: ModuleGraphLookup;
}) {
  const module = options.moduleGraph.getModuleById(
    toPackageStyleVirtualId(options.file),
  );
  return module ? [module] : [];
}
