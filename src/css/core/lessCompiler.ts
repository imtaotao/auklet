import fs from 'node:fs';
import path from 'node:path';
import less from 'less';
import { isExternalPackageSpecifier } from '#auklet/css/core/resolvers/externalLess';

export type LessCompileOptions = {
  resolveExternalImport?: (
    specifier: string,
    importerFile: string,
  ) =>
    | string
    | {
        file: string;
        dependencyFiles?: Array<string>;
      }
    | null;
};

class ExternalLessFileManager extends less.FileManager {
  readonly dependencyFiles = new Set<string>();

  constructor(
    private readonly resolveImport: NonNullable<
      LessCompileOptions['resolveExternalImport']
    >,
  ) {
    super();
  }

  supports(filename: string) {
    return isExternalPackageSpecifier(filename);
  }

  async loadFile(filename: string, currentDirectory: string) {
    const importerFile = path.join(currentDirectory, '__auklet_import__.less');
    const resolution = this.resolveImport(filename, importerFile);
    if (!resolution) {
      throw new Error(
        `external Less import could not be resolved: ${filename}`,
      );
    }
    const resolved =
      typeof resolution === 'string' ? resolution : resolution.file;
    if (typeof resolution !== 'string') {
      for (const file of resolution.dependencyFiles ?? []) {
        this.dependencyFiles.add(path.resolve(file));
      }
    }
    return {
      contents: fs.readFileSync(resolved, 'utf8'),
      filename: resolved,
    };
  }
}

export async function compileLess(
  file: string,
  code: string,
  options: LessCompileOptions = {},
) {
  try {
    const externalFileManager = options.resolveExternalImport
      ? new ExternalLessFileManager(options.resolveExternalImport)
      : null;
    const plugins = options.resolveExternalImport
      ? [
          {
            install(
              _less: typeof less,
              pluginManager: {
                addFileManager(fileManager: ExternalLessFileManager): void;
              },
            ) {
              pluginManager.addFileManager(externalFileManager!);
            },
          },
        ]
      : [];
    const result = await less.render(code, {
      filename: file,
      paths: [path.dirname(file)],
      plugins,
    });
    return {
      css: result.css,
      imports: Array.from(
        new Set([
          ...(result.imports ?? []).map((imported) => path.resolve(imported)),
          ...(externalFileManager?.dependencyFiles ?? []),
        ]),
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[css] failed to compile Less file ${file}: ${message}`);
  }
}

export type LessCompileResult = Awaited<ReturnType<typeof compileLess>>;
