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
};

type BuildContext = {
  packageRoot: string;
  tsconfig: string;
  pkg: PackageJsonLike;
  dependencyNames: Array<string>;
  packageExternal: Array<string>;
  peerExternal: Array<string>;
  globalName: string;
  banner: string;
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
  const names = new Set(context.dependencyNames);

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

const createBuildContext = (
  packageRoot: string,
  options: PackageBuildOptions,
): BuildContext => {
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
    packageRoot,
    tsconfig: options.tsconfig
      ? path.resolve(packageRoot, options.tsconfig)
      : findWorkspaceTsconfig(packageRoot),
    pkg,
    dependencyNames: Object.keys(pkg.dependencies ?? {}),
    packageExternal: getPackageExternal(pkg, options),
    peerExternal: getPeerExternal(pkg, options),
    globalName: getGlobalName(pkg),
    banner,
  };
};

const createCommonConfig = (
  context: BuildContext,
  deps: NonNullable<UserConfig['deps']>,
) => {
  return {
    cwd: context.packageRoot,
    clean: false,
    sourcemap: false,
    tsconfig: context.tsconfig,
    target: 'es2018',
    platform: 'browser',
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
  const outputConfigs: Array<{ format: TsdownFormat; extname: string }> = [];

  for (const format of formats) {
    const extnames = formatMap[format];
    for (const extname of Array.isArray(extnames) ? extnames : [extnames]) {
      outputConfigs.push({ format, extname });
    }
  }

  return outputConfigs.map(({ format, extname }) => {
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
      entry: ['src/index.ts'],
      format,
      globalName: context.globalName,
      outDir: 'dist',
      dts: false,
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
  format: Extract<TsdownFormat, 'cjs' | 'esm'>,
  outDir: string,
) => {
  return {
    ...commonConfig,
    entry: [
      'src/**/*.ts',
      'src/**/*.tsx',
      '!src/**/*.d.ts',
      '!src/**/__tests__/**',
      '!src/**/*.spec.ts',
      '!src/**/*.spec.tsx',
    ],
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
  return [
    createModuleConfig(commonConfig, 'esm', 'dist/es'),
    createModuleConfig(commonConfig, 'cjs', 'dist/lib'),
  ] satisfies Array<UserConfig>;
};

export function defineKernelPackageConfigFromOptions(
  packageRoot = process.cwd(),
  config: AukletConfig = {},
): Array<UserConfig> {
  const buildOptions = config.build ?? {};
  const normalizedConfig = normalizeAukletConfig(config);
  const formats = buildOptions.formats ?? ['cjs', 'esm', 'iife'];
  const context = createBuildContext(packageRoot, buildOptions);
  const bundleConfigs = createBundleConfigs(context, formats);
  const moduleConfigs = normalizedConfig.modules
    ? createModuleConfigs(context)
    : [];

  return [...bundleConfigs, ...moduleConfigs] satisfies Array<UserConfig>;
}

export async function defineKernelPackageConfigFromFile(
  packageRoot = process.cwd(),
): Promise<Array<UserConfig>> {
  const config = await loadAukletConfig(packageRoot, { cacheBust: true });
  return defineKernelPackageConfigFromOptions(packageRoot, config);
}

export default defineKernelPackageConfigFromFile(process.cwd()).then((config) =>
  defineConfig(config),
);
