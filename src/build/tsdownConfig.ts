import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type UserConfig } from 'tsdown/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { normalizeAukletConfig } from '#auklet/config';
import type {
  AukletConfig,
  PackageBuildFormat,
  PackageBuildOptions,
} from '#auklet/types';

export type TsdownFormat = PackageBuildFormat;

type PackageJsonLike = {
  name?: string;
  version?: string;
  author?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type BuildContext = {
  packageRoot: string;
  tsconfig: string;
  output: string;
  pkg: PackageJsonLike;
  runtimeDependencyNames: Array<string>;
  packageExternal: Array<string>;
  peerExternal: Array<string>;
  banner: string;
  globalName: string;
  target: NonNullable<PackageBuildOptions['target']>;
  platform: NonNullable<PackageBuildOptions['platform']>;
};

const formatMap = {
  cjs: '.cjs',
  iife: '.global.js',
  esm: ['.js', '.mjs'],
};

const getExternal = (names: Array<string>) => {
  const external = new Set<string>();

  for (const name of names) {
    external.add(name);
    external.add(`${name}/*`);
  }
  return [...external];
};

const getPackageExternal = (
  pkg: PackageJsonLike,
  options: PackageBuildOptions,
) => {
  return getExternal([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...(options.externals ?? []),
  ]);
};

const getPeerExternal = (
  pkg: PackageJsonLike,
  options: PackageBuildOptions,
) => {
  return [
    ...new Set([
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...(options.externals ?? []),
    ]),
  ];
};

const getDependencyGlobalName = (name: string) => {
  return name
    .replace(/^@/, '')
    .split(/[/-]/g)
    .filter(Boolean)
    .map((label) => label[0].toUpperCase() + label.slice(1))
    .join('');
};

const getIifeGlobals = (context: BuildContext) => {
  return Object.fromEntries(
    context.peerExternal.map((name) => [name, getDependencyGlobalName(name)]),
  );
};

const getIifeAlwaysBundle = (context: BuildContext) => {
  const names = new Set(context.runtimeDependencyNames);

  if (context.peerExternal.includes('react')) {
    names.add('react/jsx-runtime');
    names.add('react/jsx-dev-runtime');
  }
  return [...names];
};

const getGlobalName = (pkg: PackageJsonLike) => {
  return (pkg?.name ?? '')
    .replace(/@/g, '')
    .split(/[/-]/g)
    .map((label) => label[0].toUpperCase() + label.slice(1))
    .join('');
};

const findWorkspaceTsconfig = (packageRoot: string) => {
  let current = packageRoot;

  while (true) {
    const tsconfig = path.join(current, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) return tsconfig;

    const parent = path.dirname(current);
    if (parent === current) return path.join(packageRoot, 'tsconfig.json');
    current = parent;
  }
};

const getBundleEntry = (packageRoot: string) => {
  const tsEntry = 'src/index.ts';
  const tsxEntry = 'src/index.tsx';

  if (fs.existsSync(path.join(packageRoot, tsEntry))) {
    return { index: tsEntry };
  }
  if (fs.existsSync(path.join(packageRoot, tsxEntry))) {
    return { index: tsxEntry };
  }
  return { index: tsEntry };
};

const toPosixPath = (value: string) => {
  return value.split(path.sep).join('/');
};

const getModuleEntries = (packageRoot: string) => {
  const sourceRoot = path.join(packageRoot, 'src');
  const entries: Record<string, string> = {};

  if (!fs.existsSync(sourceRoot)) {
    return getBundleEntry(packageRoot);
  }

  const collect = (dir: string) => {
    const dirEntries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dirEntry of dirEntries) {
      const file = path.join(dir, dirEntry.name);

      if (dirEntry.isDirectory()) {
        if (dirEntry.name !== '__tests__') collect(file);
        continue;
      }

      if (!/\.(ts|tsx)$/.test(dirEntry.name)) continue;
      if (/\.d\.ts$/.test(dirEntry.name)) continue;
      if (/\.(spec|test)\.(ts|tsx)$/.test(dirEntry.name)) continue;

      const sourceRelative = toPosixPath(path.relative(packageRoot, file));
      const entryName = toPosixPath(path.relative(sourceRoot, file)).replace(
        /\.(ts|tsx)$/,
        '',
      );

      entries[entryName] ??= sourceRelative;
    }
  };

  collect(sourceRoot);

  return Object.keys(entries).length > 0
    ? entries
    : getBundleEntry(packageRoot);
};

const createBuildContext = (
  packageRoot: string,
  options: PackageBuildOptions,
  output: string,
) => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as PackageJsonLike;

  const banner =
    options.banner ??
    '/*!\n' +
      ` * ${pkg.name}.js v${pkg.version}\n` +
      (pkg.author
        ? ` * (c) 2026-${new Date().getFullYear()} ${pkg.author}\n`
        : '') +
      ' */';

  return {
    pkg,
    banner,
    packageRoot,
    output,
    runtimeDependencyNames: Object.keys(pkg.dependencies ?? {}),
    packageExternal: getPackageExternal(pkg, options),
    peerExternal: getPeerExternal(pkg, options),
    globalName: getGlobalName(pkg),
    platform: options.platform!,
    target: options.target!,
    tsconfig: options.tsconfig
      ? path.resolve(packageRoot, options.tsconfig)
      : findWorkspaceTsconfig(packageRoot),
  } satisfies BuildContext;
};

const createCommonConfig = (
  context: BuildContext,
  deps: NonNullable<UserConfig['deps']>,
) => {
  return {
    cwd: context.packageRoot,
    root: context.packageRoot,
    clean: false,
    sourcemap: false,
    tsconfig: context.tsconfig,
    target: context.target,
    platform: context.platform,
    deps,
    define: {
      __TEST__: 'false',
      __VERSION__: JSON.stringify(context.pkg.version),
      __DEV__:
        '(typeof process !== "undefined" ? (process.env?.NODE_ENV !== "production") : false)',
    },
  } satisfies UserConfig;
};

const createBundleConfigs = (
  context: BuildContext,
  formats: Array<TsdownFormat>,
) => {
  const outputConfigs: Array<{
    format: TsdownFormat;
    extname: string;
    dts: boolean;
  }> = [];
  let hasDtsConfig = false;

  for (const format of formats) {
    const extnames = formatMap[format];
    for (const extname of Array.isArray(extnames) ? extnames : [extnames]) {
      const emitDts: boolean = !hasDtsConfig;

      outputConfigs.push({ format, extname, dts: emitDts });
      hasDtsConfig ||= emitDts;
    }
  }

  return outputConfigs.map(({ format, extname, dts }) => {
    const deps: NonNullable<UserConfig['deps']> =
      format === 'iife'
        ? {
            neverBundle: context.peerExternal,
            alwaysBundle: getIifeAlwaysBundle(context),
            onlyBundle: false,
          }
        : {
            neverBundle: context.packageExternal,
          };

    return {
      ...createCommonConfig(context, deps),
      entry: getBundleEntry(context.packageRoot),
      format,
      globalName: context.globalName,
      outDir: context.output,
      dts,
      treeshake: true,
      banner: context.banner,
      outExtensions: () => ({
        js: extname,
      }),
      outputOptions: {
        entryFileNames: `[name]${extname}`,
        chunkFileNames: `[name]-[hash]${extname}`,
        globals: format === 'iife' ? getIifeGlobals(context) : {},
      },
    };
  }) satisfies Array<UserConfig>;
};

const createModuleConfig = (
  commonConfig: ReturnType<typeof createCommonConfig>,
  entry: Record<string, string>,
  format: Extract<TsdownFormat, 'cjs' | 'esm'>,
  outDir: string,
) => {
  return {
    ...commonConfig,
    entry,
    format,
    outDir,
    dts: true,
    unbundle: true,
    outExtensions: () => ({
      js: '.js',
      dts: '.d.ts',
    }),
  } satisfies UserConfig;
};

const createModuleConfigs = (context: BuildContext) => {
  const commonConfig = createCommonConfig(context, {
    neverBundle: context.packageExternal,
  });
  const entry = getModuleEntries(context.packageRoot);

  return [
    createModuleConfig(
      commonConfig,
      entry,
      'esm',
      path.join(context.output, 'es'),
    ),
    createModuleConfig(
      commonConfig,
      entry,
      'cjs',
      path.join(context.output, 'lib'),
    ),
  ] satisfies Array<UserConfig>;
};

export function defineKernelPackageConfigFromOptions(
  packageRoot = process.cwd(),
  config: AukletConfig = {},
) {
  const normalizedConfig = normalizeAukletConfig(config);
  const buildOptions = normalizedConfig.build;
  const formats = buildOptions.formats;
  const context = createBuildContext(
    packageRoot,
    buildOptions,
    normalizedConfig.output,
  );
  const bundleConfigs = createBundleConfigs(context, formats);
  const moduleConfigs = normalizedConfig.modules
    ? createModuleConfigs(context)
    : [];

  return [...bundleConfigs, ...moduleConfigs] satisfies Array<UserConfig>;
}

export async function defineKernelPackageConfigFromFile(
  packageRoot = process.cwd(),
) {
  const config = await loadAukletConfig(packageRoot, { cacheBust: true });
  return defineKernelPackageConfigFromOptions(packageRoot, config);
}

export default defineKernelPackageConfigFromFile(process.cwd()).then((config) =>
  defineConfig(config),
);
