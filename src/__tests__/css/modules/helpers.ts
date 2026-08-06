import fs from 'node:fs';
import path from 'node:path';
import {
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';

export type PluginLoadResult = string | { code: string; moduleType?: string };

export const readPluginLoadCode = (
  result: PluginLoadResult | null | undefined,
) => {
  if (!result) return '';
  return typeof result === 'string' ? result : result.code;
};

export const readPluginLoadModuleType = (
  result: PluginLoadResult | null | undefined,
) => {
  if (!result || typeof result === 'string') return null;
  return result.moduleType ?? null;
};

export const parseCssModuleLocalsLoad = (source: PluginLoadResult) => {
  const code = readPluginLoadCode(source);
  const exportLine = code
    .split('\n')
    .find((line) => line.startsWith('export default '));

  if (!exportLine) {
    throw new Error('unexpected vite CSS Modules locals output');
  }

  return {
    locals: JSON.parse(
      exportLine.slice('export default '.length).replace(/;$/, ''),
    ) as Record<string, string>,
  };
};

export const parseCssModuleStyleLoad = (source: PluginLoadResult) => {
  const code = readPluginLoadCode(source);

  return {
    css: code,
    hasHotAccept: false,
    hasDocumentInjection: false,
    hasCssEscapeLookup: false,
  };
};

export const loadCssModuleDevPair = async (
  plugin: {
    load?: (
      this: { addWatchFile?: (file: string) => void },
      id: string,
    ) => Promise<PluginLoadResult | null | undefined>;
  },
  loadContext: { addWatchFile?: (file: string) => void },
  file: string,
) => {
  const resolved = path.resolve(file);
  const load = plugin.load?.bind(loadContext);
  const localsCode = await load?.(toCssModuleVirtualId(resolved));
  const styleCode = await load?.(toCssModuleStyleVirtualId(resolved));

  return { localsCode, styleCode, resolved };
};

export const parseViteCssModuleLoad = (source: PluginLoadResult) => {
  const code = readPluginLoadCode(source);
  if (code.includes('const __auklet_css_modules_css = ')) {
    return {
      ...parseCssModuleStyleLoad(source),
      locals: parseCssModuleLocalsLoad(source).locals,
    };
  }

  return {
    ...parseCssModuleLocalsLoad(source),
    css: null as string | null,
  };
};

export const parseCssModuleDevModule = (
  localsSource: PluginLoadResult,
  styleSource: PluginLoadResult,
) => ({
  ...parseCssModuleLocalsLoad(localsSource),
  ...parseCssModuleStyleLoad(styleSource),
});

export const readCssModuleProductionMarkers = (code: string) => ({
  hasHotAccept: code.includes('import.meta.hot'),
  hasDocumentInjection: code.includes('data-auklet-css-modules'),
  hasDevRuntimePrefix: code.includes('__auklet_css_modules_'),
  hasDocumentHeadInjection: code.includes('document.head'),
});

const parseObjectLiteralLocals = (literal: string) => {
  const normalized = literal.replace(/([\w-]+)\s*:/g, '"$1":');
  return JSON.parse(normalized) as Record<string, string>;
};

const readObjectLiteralLocalsFromCode = (code: string) => {
  const patterns = [
    /export\s+default\s+(\{[\s\S]*?\})\s*;/,
    /exports\.default\s*=\s*(\{[\s\S]*?\})\s*;/,
    /(?:var|const|let)\s+\w+\s*=\s*(\{[\s\S]*?\})\s*;/,
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (!match) continue;
    try {
      return parseObjectLiteralLocals(match[1]);
    } catch {
      continue;
    }
  }

  return null;
};

export const parseModuleLocalsFromChunk = (code: string) => {
  const exportDefaultLine = code
    .split('\n')
    .find((line) => line.startsWith('export default '));

  if (exportDefaultLine) {
    return JSON.parse(
      exportDefaultLine.slice('export default '.length).replace(/;$/, ''),
    ) as Record<string, string>;
  }

  const inlineLocals = readObjectLiteralLocalsFromCode(code);
  if (inlineLocals) {
    return inlineLocals;
  }

  const cjsLine = code
    .split('\n')
    .find(
      (line) =>
        line.startsWith('exports.default = ') ||
        line.startsWith('module.exports = '),
    );

  if (cjsLine) {
    const json = cjsLine
      .replace(/^exports\.default = /, '')
      .replace(/^module\.exports = /, '')
      .replace(/;$/, '');
    return JSON.parse(json) as Record<string, string>;
  }

  const varAssignment = code.match(/=\s*(\{[^;\n]+\})\s*;/);
  if (varAssignment) {
    return parseObjectLiteralLocals(varAssignment[1]);
  }

  throw new Error('unexpected CSS Modules virtual chunk output');
};

export const readOutputFiles = (dir: string, prefix = '') => {
  if (!fs.existsSync(dir))
    return [] as Array<{ relative: string; full: string }>;
  const files: Array<{ relative: string; full: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readOutputFiles(full, relative));
      continue;
    }
    files.push({ relative, full });
  }
  return files;
};

export const findCssModuleJsOutput = (
  outputs: Array<{ relative: string; full: string }>,
  moduleBaseName: string,
) => {
  const escaped = moduleBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|/)${escaped}\\.(js|cjs|mjs)$`);
  return outputs.find((file) => pattern.test(file.relative));
};

export const findOutputEndingWith = (
  outputs: Array<{ relative: string; full: string }>,
  suffix: string,
) => outputs.find((file) => file.relative.endsWith(suffix));

export const parseCssSideEffect = (code: string) => {
  const importMatch = code.match(/import\s+("([^"]+)"|'([^']+)')\s*;/);
  if (importMatch) {
    return importMatch[2] ?? importMatch[3] ?? null;
  }

  const requireMatch = code.match(/require\(("([^"]+)"|'([^']+)')\)/);
  return requireMatch?.[2] ?? requireMatch?.[3] ?? null;
};

export const readFileFromOutputs = (
  outputs: Array<{ relative: string; full: string }>,
  suffix: string,
) => {
  const file = findOutputEndingWith(outputs, suffix);
  if (!file) {
    throw new Error(`missing output ending with ${suffix}`);
  }
  return fs.readFileSync(file.full, 'utf8');
};
