import fs from 'node:fs';
import path from 'node:path';
import { parseModuleId } from 'conditional-export';
import {
  hasLessImportOption,
  parseLessSourceImports,
  resolveLocalStyleImport,
  type LessSourceImport,
} from '#auklet/css/core/lessImportGraph';
import {
  assertExternalLessSupportsSpecifier,
  collectExternalLessPackageJsonCandidates,
  ExternalLessResolutionError,
  isExternalPackageSpecifier,
  isRejectedPackageImportsLessSpecifier,
  resolveExternalLessImport,
  type ExternalLessResolution,
} from '#auklet/css/core/resolvers/externalLess';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { isInsideRoot, normalizeFileKey } from '#auklet/utils';

const ALLOWED_EXTERNAL_OPTION_SETS = [
  ['reference'],
  ['optional', 'reference'],
  ['multiple', 'reference'],
] as const;

export type ExternalLessGraphEdge = {
  import: LessSourceImport;
  importedFile: string;
  packageRoot: string;
  external: boolean;
};

export type ExternalLessGraphNode = {
  file: string;
  packageName: string;
  packageRoot: string;
  source: string;
  imports: Array<ExternalLessGraphEdge>;
};

export type ExternalLessDependencyGraph = {
  entryFile: string | null;
  nodes: ReadonlyMap<string, ExternalLessGraphNode>;
  packageJsonFiles: ReadonlySet<string>;
  absentDependencyFiles: ReadonlySet<string>;
  packageNames: ReadonlySet<string>;
  resolveImport: (specifier: string, importerFile: string) => string | null;
};

const parseImportOptions = (options: string | null) =>
  options
    ? Array.from(
        new Set(
          options
            .split(',')
            .map((option) => option.trim().toLowerCase())
            .filter(Boolean),
        ),
      ).sort()
    : [];

export const validateExternalLessImportOptions = (
  parsed: LessSourceImport,
  importerFile: string,
) => {
  const options = parseImportOptions(parsed.options);
  if (!options.includes('reference')) {
    throw new Error(
      `[css] external Less imports must use (reference): ${parsed.specifier} from ${importerFile}`,
    );
  }
  if (
    options.includes('inline') ||
    options.includes('css') ||
    options.includes('less')
  ) {
    throw new Error(
      `[css] external Less reference imports must not use inline, css, or less options: ${parsed.specifier} from ${importerFile}`,
    );
  }
  const allowed = ALLOWED_EXTERNAL_OPTION_SETS.some(
    (candidate) =>
      candidate.length === options.length &&
      candidate.every((option) => options.includes(option)),
  );
  if (allowed) return;
  throw new Error(
    `[css] external Less imports only support (reference), (optional, reference), or (multiple, reference): ${parsed.specifier} from ${importerFile}`,
  );
};

const isOptionalImport = (parsed: LessSourceImport) =>
  hasLessImportOption(parsed.options, 'optional');

const resolveExternalImport = (
  parsed: LessSourceImport,
  importerFile: string,
  importerPackageRoot: string,
) => {
  validateExternalLessImportOptions(parsed, importerFile);
  try {
    return resolveExternalLessImport(parsed.specifier, importerPackageRoot);
  } catch (error) {
    if (
      isOptionalImport(parsed) &&
      error instanceof ExternalLessResolutionError &&
      (error.code === 'package-not-found' ||
        error.code === 'subpath-not-exported')
    ) {
      return null;
    }
    throw error;
  }
};

const resolveRelativeProviderImport = (
  parsed: LessSourceImport,
  importerFile: string,
  packageRoot: string,
) => {
  const imported = resolveLocalStyleImport(
    parsed.specifier,
    path.dirname(importerFile),
  );
  if (!imported) {
    if (isOptionalImport(parsed)) return null;
    throw new Error(
      `[css] external Less relative import not found: ${parsed.specifier} from ${importerFile}`,
    );
  }
  const realImported = fs.realpathSync.native(imported);
  if (
    path.extname(realImported).toLowerCase() !== '.less' ||
    !isInsideRoot(realImported, packageRoot)
  ) {
    throw new Error(
      `[css] external Less relative imports must stay inside the provider package and target .less files: ${parsed.specifier} from ${importerFile}`,
    );
  }
  return realImported;
};

const toResolutionKey = (importerFile: string, specifier: string) =>
  `${normalizeFileKey(path.dirname(importerFile))}\0${specifier}`;

export function resolveExternalLessImportAcrossGraphs(
  graphs: Array<Pick<ExternalLessDependencyGraph, 'resolveImport'>>,
  specifier: string,
  importerFile: string,
) {
  for (const graph of graphs) {
    const resolved = graph.resolveImport(specifier, importerFile);
    if (resolved) return resolved;
  }
  return null;
}

export const createExternalLessDependencyGraph = (request: {
  import: LessSourceImport;
  importerFile: string;
  importerPackageRoot: string;
}) => {
  const nodes = new Map<string, ExternalLessGraphNode>();
  const packageJsonFiles = new Set<string>();
  const absentDependencyFiles = new Set<string>();
  const packageNames = new Set<string>();
  const resolutions = new Map<string, string | null>();
  const visiting = new Set<string>();
  const stack: Array<string> = [];

  const recordOptionalMiss = (
    specifier: string,
    importerPackageRoot: string,
  ) => {
    const packageName = (() => {
      try {
        return parseModuleId(specifier).name;
      } catch {
        return null;
      }
    })();

    if (!packageName) return;
    packageNames.add(packageName);
    for (const candidate of collectExternalLessPackageJsonCandidates(
      importerPackageRoot,
      packageName,
    )) {
      if (fs.existsSync(candidate)) {
        packageJsonFiles.add(candidate);
      } else {
        absentDependencyFiles.add(candidate);
      }
    }
  };

  const visit = (resolution: ExternalLessResolution) => {
    const file = path.resolve(resolution.file);
    if (isCssModuleFile(file)) {
      throw new Error(
        `[css] external Less providers must not expose CSS Modules files: ${file}`,
      );
    }
    const key = normalizeFileKey(file);
    if (nodes.has(key)) return;
    if (visiting.has(key)) {
      const cycleStart = stack.indexOf(file);
      const cycle =
        cycleStart >= 0 ? [...stack.slice(cycleStart), file] : [file, file];
      throw new Error(
        `[css] circular external Less import detected: ${cycle.join(' -> ')}`,
      );
    }

    visiting.add(key);
    stack.push(file);
    packageNames.add(resolution.packageName);
    packageJsonFiles.add(resolution.packageJsonFile);
    const source = fs.readFileSync(file, 'utf8');
    const imports = parseLessSourceImports(source).flatMap((parsed) => {
      if (parsed.specifier.startsWith('#')) {
        assertExternalLessSupportsSpecifier(parsed.specifier);
      }
      if (isExternalPackageSpecifier(parsed.specifier)) {
        const importedResolution = resolveExternalImport(
          parsed,
          file,
          resolution.packageRoot,
        );
        resolutions.set(
          toResolutionKey(file, parsed.specifier),
          importedResolution?.file ?? null,
        );
        if (!importedResolution) {
          if (isOptionalImport(parsed)) {
            recordOptionalMiss(parsed.specifier, resolution.packageRoot);
          }
          return [];
        }
        visit(importedResolution);
        return [
          {
            import: parsed,
            importedFile: importedResolution.file,
            packageRoot: importedResolution.packageRoot,
            external: true,
          },
        ];
      }

      const importedFile = resolveRelativeProviderImport(
        parsed,
        file,
        resolution.packageRoot,
      );
      if (!importedFile) return [];
      const importedResolution = {
        file: importedFile,
        packageName: resolution.packageName,
        packageRoot: resolution.packageRoot,
        packageJsonFile: resolution.packageJsonFile,
      };
      visit(importedResolution);
      return [
        {
          import: parsed,
          importedFile,
          packageRoot: resolution.packageRoot,
          external: false,
        },
      ];
    });
    stack.pop();
    visiting.delete(key);
    nodes.set(key, {
      file,
      packageName: resolution.packageName,
      packageRoot: resolution.packageRoot,
      source,
      imports,
    });
  };

  const entryResolution = resolveExternalImport(
    request.import,
    request.importerFile,
    request.importerPackageRoot,
  );
  resolutions.set(
    toResolutionKey(request.importerFile, request.import.specifier),
    entryResolution?.file ?? null,
  );
  if (entryResolution) {
    visit(entryResolution);
  } else if (isOptionalImport(request.import)) {
    recordOptionalMiss(request.import.specifier, request.importerPackageRoot);
  }

  return {
    entryFile: entryResolution?.file ?? null,
    nodes,
    packageJsonFiles,
    absentDependencyFiles,
    packageNames,
    resolveImport(specifier: string, importerFile: string) {
      return resolutions.get(toResolutionKey(importerFile, specifier)) ?? null;
    },
  } satisfies ExternalLessDependencyGraph;
};

export const createLessExternalImportPlan = (request: {
  entryFile: string;
  packageRoot: string;
  source: string;
  sourceRoot?: string;
}) => {
  const graphs: Array<ExternalLessDependencyGraph> = [];
  const visited = new Set<string>();

  const visitLocal = (file: string, source?: string) => {
    const normalized = path.resolve(file);
    const key = normalizeFileKey(normalized);
    if (visited.has(key)) return;
    visited.add(key);
    const code = source ?? fs.readFileSync(normalized, 'utf8');
    for (const parsed of parseLessSourceImports(code)) {
      if (
        isRejectedPackageImportsLessSpecifier(parsed.specifier, parsed.options)
      ) {
        assertExternalLessSupportsSpecifier(parsed.specifier);
      }
      if (isExternalPackageSpecifier(parsed.specifier)) {
        graphs.push(
          createExternalLessDependencyGraph({
            import: parsed,
            importerFile: normalized,
            importerPackageRoot: request.packageRoot,
          }),
        );
        continue;
      }
      const imported = resolveLocalStyleImport(
        parsed.specifier,
        path.dirname(normalized),
      );
      if (!imported || path.extname(imported).toLowerCase() !== '.less') {
        continue;
      }
      const realImported = fs.realpathSync.native(imported);
      if (
        request.sourceRoot &&
        !isInsideRoot(realImported, request.sourceRoot)
      ) {
        continue;
      }
      visitLocal(realImported);
    }
  };

  visitLocal(request.entryFile, request.source);
  return {
    dependencyFiles: Array.from(
      new Set(
        graphs.flatMap((graph) => [
          ...graph.packageJsonFiles,
          ...Array.from(graph.nodes.values(), (node) => node.file),
        ]),
      ),
    ),
    packageJsonFiles: Array.from(
      new Set(graphs.flatMap((graph) => Array.from(graph.packageJsonFiles))),
    ),
    absentDependencyFiles: Array.from(
      new Set(
        graphs.flatMap((graph) => Array.from(graph.absentDependencyFiles)),
      ),
    ),
    packageNames: Array.from(
      new Set(graphs.flatMap((graph) => Array.from(graph.packageNames))),
    ),
    hasExternalPackageImports: graphs.length > 0,
    resolveImport(specifier: string, importerFile: string) {
      return resolveExternalLessImportAcrossGraphs(
        graphs,
        specifier,
        importerFile,
      );
    },
  };
};
