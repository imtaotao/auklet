# 测试规范

本文档用于指导后续功能开发时如何补充测试。当前测试已经按“项目级 e2e + 模块/API 单测 + 共享 fixture”的结构重整，新增测试时优先沿用这里的分层、命名和断言方式。

## 测试目标

- 项目级 e2e 覆盖真实项目形态下的产物结构和 style 依赖链。
- 模块/API 单测覆盖单个模块的稳定行为和边界条件。
- 测试数据通过虚拟项目 fixture 构建，不直接写系统临时目录。
- 真实构建产物和 Vite/dev 映射表统一 normalize 成 `StyleStructure` 后断言。
- 测试 helper 使用 `style` 语义命名，给后续 Less 等样式语言扩展预留空间。

## 目录结构

```text
src/__tests__/
  e2e/
    moduleStyleProject.spec.ts
  fixtures/
    virtualProject.ts
    styleProjectTemplate.ts
    styleStructure.ts
  css/
    styleProcessor.spec.ts
    workspaceStyleResolver.spec.ts
    moduleStyleImportCollector.spec.ts
    moduleGraph.spec.ts
    builder.spec.ts
    watcher.spec.ts
    path.spec.ts
  build/
    runTsdown.spec.ts
    tsdownConfig.spec.ts
  configLoader.spec.ts
  index.spec.ts
```

- `e2e/`：项目级测试，使用真实虚拟项目结构，直接调用核心 API，不执行 CLI。
- `fixtures/`：共享测试基础设施，包括虚拟项目、项目模板和结构 normalize helper。
- `css/`：CSS/style 相关模块单测。
- `build/`：tsdown/build 配置相关单测。
- 根目录 spec：跨模块但很轻量的 API、配置加载 smoke/boundary 测试。

## 如何选择测试层级

新增功能时先判断要验证的是“完整用户场景”还是“某个模块规则”。

写项目级 e2e 的情况：

- 会影响最终产物文件结构。
- 会影响多个模块协作后的 style 依赖链。
- 会同时影响真实构建产物和 Vite/dev 映射表语义。
- 需要证明单组件 style、整体 style、主题 style、external style 没有漏。

写模块/API 单测的情况：

- 只影响某个类、函数或模块的稳定行为。
- 需要覆盖边界条件，例如路径 normalize、空样式、缺失文件、循环 import、legacy path rewrite。
- 失败时应该能直接定位到某个模块，而不是完整项目流程。

不要把完整项目场景塞进模块单测。已经由 e2e 覆盖的大场景，模块单测只保留该模块自己的分支和边界。

## 项目级 E2E

当前主 e2e 文件是 `src/__tests__/e2e/moduleStyleProject.spec.ts`。它使用 `createStyleProject()` 构建一个虚拟真实项目，然后调用核心 API：

```ts
const aukletConfig = await loadAukletConfig(fixture.packageRoot, {
  cacheBust: true,
});

await new ModuleStyleBuilder({
  packageRoot: fixture.packageRoot,
  aukletConfig,
}).build();
```

e2e 重点断言：

- `fixture.outputFiles()` 是否包含完整产物结构。
- 包级 `index.css` 是否包含关键样式内容。
- `style/index.css`、`style/external.css`、主题入口、组件 style 入口的 `@import` 顺序和路径是否正确。
- `ModuleStyleGraph` 生成的 Vite/dev 虚拟入口是否具备同样语义结构。
- `buildStructure` 和 `graphStructure` 的 components/themes 语义 key 是否一致。

新增 e2e 场景时优先复用现有主场景，只有当场景会让主测试变得难读时才新建 test。不要为每个小分支都建 e2e。

## 模块/API 单测职责

- `StyleProcessor`：style import 展开、内容合并、重复处理、循环 import、支持的 style 扩展名。
- `WorkspaceStyleResolver`：相对路径、包路径、package exports、node_modules fallback、output format rewrite、external style specifier。
- `ModuleStyleImportCollector` / `styleImports`：从 `.tsx` 源码 import 和 named re-export 推导 style import，包括 package entry、deep import、namespace import、same-package import、local re-export binding、type-only skip、`.ts` 文件 skip，以及不支持 `export * from '...'` 的报错。collector 测试只保留集成语义，resolver 的细分边界放到 `css/resolvers/*.spec.ts`。
- `css/core/resolvers`：分别测试相对路径、`package.json#imports` 和 `tsconfig.compilerOptions.paths`。重点覆盖只返回当前 `sourceRoot` 内的候选路径、`package.json#imports` 的 `source` 条件、外部/未知 specifier、`tsconfig extends`、精确 alias 和更具体 pattern 优先。
- `ModuleStyleGraph`：Vite/dev 虚拟入口、图结构、递归 workspace 依赖、第三方 CSS dependency 的 `/@fs` dev 解析、主题顺序、source graph 判断、watch roots、模块依赖顺序。
- `ModuleStyleBuilder`：构建器自己的分支和产物边界，例如 legacy output-format rewrite、无 CSS 模块、空 style 入口、默认 cwd。
- `ModuleStyleWatcher`：watch roots、debounce、logger、builder 调用参数。
- `configLoader`：配置模块形态、TypeScript 配置加载、缺失配置、临时文件清理。
- `cleanOutput`：`auk build` 清理目录边界，包括默认 `dist` 和自定义 `output`。
- `tsdownConfig`：build 选项映射、package 元数据、banner、externals、配置加载。
- `index.spec.ts`：根公开 API smoke test，不扩展成行为测试。

## Fixture 使用

### `createVirtualProject`

通用虚拟项目基础层，所有需要文件系统临时项目的测试都优先使用它。

```ts
let project: VirtualProject;

beforeEach(() => {
  project = createVirtualProject('auklet-feature-');
});

afterEach(() => {
  project.cleanup();
});
```

能力包括：

- `project.root`
- `project.resolve(...)`
- `project.writeFile(...)`
- `project.writeFiles(...)`
- `project.writeJson(...)`
- `project.writePackageJson(...)`
- `project.writeAukletConfig(...)`
- `project.readFile(...)`
- `project.listFiles(...)`
- `project.exists(...)`
- `project.cleanup()`

临时文件会创建在 `src/__tests__/.tmp/` 下，并由 `.gitignore` 忽略。正常测试结束后，具体项目目录应被 `cleanup()` 删除。

不要在单个 spec 里重新封装纯转发的 `writeFile/readFile/exists` helper。直接用 `project.writeFile(...)`、`project.readFile(...)`。只有当 helper 表达业务语义时才保留，例如 `writeSourceFile(...)`、`expectCollectedStyles(...)`。

### `createStyleProject`

高层 style 项目模板，用于项目级 e2e。它内置当前包、内部组件、主题、外部 UI 依赖和外部主题依赖。

默认测试数据：

- 虚拟项目包：`@fixture/app`
- 内部组件：`Card -> Button`
- 外部 UI 依赖：`@scope/ui`
- 外部主题依赖：`@scope/theme`
- 主题：`light`、`dark`
- 源码目录：`source`
- 产物目录：`output`

如果只是补充特殊文件或边界条件，用模板暴露的 escape hatch：

```ts
fixture.writeStyle('source/components/Card/extra.css', '.extra {}');
const files = fixture.outputFiles();
```

新增模板 API 时优先使用 `style` 语义命名，不要把对外 API 写死成 `css` 语义。

## StyleStructure

`src/__tests__/fixtures/styleStructure.ts` 负责把真实构建产物和 Vite/dev 图结构转成同一种语义结构：

```ts
type StyleStructure = {
  packageEntry: StyleEntry | null;
  entries: Record<string, StyleEntry>;
  themes: Record<string, StyleEntry>;
  components: Record<string, ComponentStyleStructure>;
};
```

使用规则：

- 真实构建产物用 `normalizeBuildStyleStructure(packageRoot, outputDir)`。
- Vite/dev 图结构用 `normalizeGraphStyleStructure(graph, packageName, packageRoot, stylePaths)`。
- 断言优先看 `entries[id].imports`、`entries[id].content`、`components`、`themes`。
- Vite 虚拟 id 在 `StyleStructure` 中只保留语义 id，不把 `\0auklet-css:` 这类内部前缀放进项目级断言。
- dev 图中的第三方 CSS dependency 需要断言为 Vite `/@fs/...` import，workspace style dependency 仍应保持虚拟递归语义。
- 所有路径相关断言使用 posix `/` 语义，不把绝对临时目录写进快照。

## 断言风格

保持测试整齐、直接、少噪音。

- 同一个文件内容只读一次，赋值给变量后再做多个断言。
- 同构输出使用循环或表驱动，例如 `for (const format of ['es', 'lib'])`。
- 单行源码字符串直接写成普通字符串，不用多行模板字符串。
- 多行源码只在确实需要表达多行 import、配置对象或样式结构时使用模板字符串。
- 通用 helper 放在文件顶部，不放在 `describe` 底部。
- 纯转发 helper 不要写；有业务语义的 helper 可以写。
- 断言 helper 命名应表达测试意图，例如 `expectEntryImports`、`expectCollectedStyles`、`expectWatchFile`。
- 大段 expected 数据放在文件顶部常量里，让 test 主体保持 arrange、act、assert 清晰。
- 不使用大快照覆盖所有生成内容。结构用文件列表和 imports 断言，内容只断言关键 CSS。

推荐写法：

```ts
const styleEntry = fixture.readFile('output/es/style/index.css');

expect(styleEntry).toBe(
  '@import "./themes/light.css";\n' + '@import "./module.css";\n',
);
```

同构 format：

```ts
for (const format of ['es', 'lib']) {
  const rendererStyle = fixture.readFile(
    `output/${format}/components/Renderer/style/index.css`,
  );

  expect(rendererStyle).toBe(expectedRendererStyle);
}
```

单行源码：

```ts
writeSourceFile(
  project,
  'routes/App.tsx',
  "import { Button } from '@scope/ui';",
);
```

## Import 解析

测试侧解析生成 CSS 的 `@import` 时使用 PostCSS，不使用正则扫描整段 CSS。

当前 helper：

```ts
const collectStyleImports = (code: string) => {
  const imports: Array<string> = [];
  const root = postcss.parse(code);

  root.walkAtRules('import', (rule) => {
    const match = rule.params.match(/^["']([^"']+)["']/);
    if (match) imports.push(match[1]);
  });

  return imports;
};
```

原因：

- 项目本身已经依赖 PostCSS。
- PostCSS 比正则更适合处理生成 CSS。
- 后续 Less 支持落地后，测试侧结构更容易扩展。

## 新增功能测试清单

实现或修改功能后，按下面顺序补测试：

1. 判断是否影响最终产物结构或跨模块依赖链。影响则先补 e2e。
2. 判断是否影响某个模块的边界行为。影响则在对应模块 spec 里补单测。
3. 如果需要临时文件，使用 `createVirtualProject` 或 `createStyleProject`。
4. 如果断言真实产物或 Vite/dev 映射表，优先转成 `StyleStructure` 再断言。
5. 如果新增样式语言、入口类型或依赖类型，检查 helper 命名是否仍是 `style` 语义。
6. 避免重复读同一个文件，避免把相同断言复制到多个 format。
7. 跑 `pnpm run test`、`pnpm run typecheck`、`pnpm run build`、`pnpm run format`。

## 后续非目标和扩展点

当前测试架构仍然不覆盖：

- CLI 完整行为。
- 真实 Vite dev server。
- 发布包 tarball。

CLI 后续如果补测试，单独建测试文件，只做命令入口层 smoke test，例如：

- `auk --help` 输出 usage。
- `auk build-css` 能触发构建流程。
- unknown command 返回失败退出码。

其他样式语言后续如果通过 hook 接入：

- 不要新增长期 pending/skipped 测试。
- 先明确它只负责把源样式转换成 CSS，还是也要参与 auklet 的依赖图。
- 再扩展 fixture、`StyleStructure` 和真实产物断言。

## 当前状态

第一轮重构已经完成：

- 已新增通用虚拟项目基础层 `fixtures/virtualProject.ts`。
- 已新增高层 style 项目模板 `fixtures/styleProjectTemplate.ts`。
- 已新增 `StyleStructure` normalize/helper `fixtures/styleStructure.ts`。
- 已新增项目级 e2e `e2e/moduleStyleProject.spec.ts`。
- 已将 `ModuleStyleBuilder` 中完整项目大场景迁到 e2e。
- 已让 CSS 相关单测保留模块边界职责，不再承载完整项目场景。
- 已删除旧的 CSS 专用 `cssTestFixture.ts`。
- 已将 `configLoader`、`tsdownConfig` 等非 CSS 临时项目测试也迁到通用 fixture。
