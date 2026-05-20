export type StyleDependencyGroup = {
  // 包级样式入口依赖，会被合并进包级 dist/index.css。
  entry?: string | Array<string>;
  // 主题样式依赖，key 是当前包主题名，value 是依赖包对应主题入口。
  themes?: Record<string, string>;
  // 模块样式自动引用规则，用于从 import 推导对应样式入口。
  components?: string | Array<string>;
  // 兼容旧配置：请使用 entry。
  global?: string | Array<string>;
  // 兼容旧配置：请使用 components。
  component?: string | Array<string>;
};

export type CssDependencyGroup = StyleDependencyGroup;

export type StyleOptions = {
  // 当前包主题样式入口，key 是主题名，value 是相对于当前包根目录的样式文件路径。
  themes?: Record<string, string>;
  // 外部包样式依赖配置，key 是包名前缀，value 是该包的样式依赖规则。
  dependencies?: Record<string, StyleDependencyGroup>;
};

export interface CssOptions {
  // 源码目录，相对于当前包根目录。
  source?: string;
  // 构建产物目录，相对于当前包根目录。
  output?: string;
  // 样式构建配置。
  styles?: StyleOptions;
  // 兼容旧配置：请使用 styles.dependencies。
  cssDependencies?: Record<string, CssDependencyGroup>;
  // 兼容旧配置：请使用 styles.themes。
  themes?: Record<string, string>;
  // 兼容旧配置：请使用 source。
  sourceDir?: string;
  // 兼容旧配置：请使用 output。
  outputDir?: string;
}

export type NormalizedStyleDependencyGroup = {
  // 全局 CSS 依赖，会被合并进包级 dist/index.css。
  entry?: string | Array<string>;
  // 主题 CSS 依赖，key 是当前包主题名，value 是依赖包对应主题入口。
  themes?: Record<string, string>;
  // 模块 CSS 自动引用规则，用于从 import 推导对应样式入口。
  components?: string | Array<string>;
};

export interface NormalizedAukletConfig {
  source: string;
  output: string;
  modules: boolean;
  styles: {
    themes: Record<string, string>;
    dependencies: Record<string, NormalizedStyleDependencyGroup>;
  };
  build?: PackageBuildOptions;
}

export type PackageBuildFormat = 'cjs' | 'esm' | 'iife';

export type PackageBuildOptions = {
  // 包级 bundle 产物格式，例如 cjs、esm、iife。
  formats?: Array<PackageBuildFormat>;
  // 自定义 bundle banner；未传入时根据 package.json 自动生成。
  banner?: string;
  // 额外标记为外部依赖的包名；会和 package.json dependencies、peerDependencies 一起传给 tsdown。
  externals?: Array<string>;
  // 兼容旧配置：请使用顶层 modules。
  modules?: boolean;
  // TypeScript 配置文件路径，相对于当前包根目录；默认向上查找 tsconfig.json。
  tsconfig?: string;
};

export interface AukletConfig extends CssOptions {
  // 是否生成 dist/es 和 dist/lib 下的模块产物；CSS 组件级产物也依赖该行为。
  modules?: boolean;
  // JavaScript/TypeScript 构建配置。
  build?: PackageBuildOptions;
}

export type AukletLogger = {
  log?: (...args: Array<unknown>) => void;
  info?: (...args: Array<unknown>) => void;
  error?: (...args: Array<unknown>) => void;
};

export type LoadAukletConfigOptions = {
  // 配置文件名，默认 auklet.config.ts。
  configFile?: string;
  // 是否绕开 ESM import cache。
  cacheBust?: boolean;
};

export interface ModuleCssBuildContext {
  // 当前执行 CSS 构建的包根目录，默认使用 process.cwd()。
  packageRoot?: string;
  // 已加载的 auklet 配置；未传入时核心 API 使用空配置。
  aukletConfig?: AukletConfig;
  // 可选日志输出；核心 API 默认静默，CLI 会传入 console。
  logger?: AukletLogger;
  // 命令行传入的源码目录，会覆盖包内 auklet.config.ts 的配置。
  sourceDir?: string;
  // 命令行传入的产物目录，会覆盖包内 auklet.config.ts 的配置。
  outputDir?: string;
}

export interface ResolvedModuleCssBuildContext {
  // 当前执行 CSS 构建的包根目录。
  packageRoot: string;
  // 已解析后的源码目录，使用绝对路径。
  sourceDir: string;
  // 已解析后的产物目录，使用绝对路径。
  outputDir: string;
}

export type ModuleCssBuildOptions = {
  aukletConfig?: AukletConfig;
  logger?: AukletLogger;
};

export interface ModuleCssBuildOutputConfig {
  // 需要同步生成 CSS 产物的模块格式目录，例如 es、lib。
  outputFormats: Array<string>;
  // 组件级 CSS 入口目录名，例如 style/index.css 里的 style。
  styleDir: string;
  // CSS 入口文件名，例如 style/index.css 和 dist/index.css。
  indexCssFile: string;
  // 外部 CSS 入口文件名，例如 style/external.css。
  externalCssFile: string;
  // 当前包 CSS 入口文件名，例如 style/module.css。
  moduleCssFile: string;
}

export interface ModuleCssBuildConfig {
  // CSS 产物结构配置。
  output: ModuleCssBuildOutputConfig;
  // 支持处理的样式文件后缀。
  styleExtensions: Array<string>;
}
