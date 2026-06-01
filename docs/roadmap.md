# 能力路线图

这份文档记录 auklet 在真实项目中还值得补强的能力。它是待办清单，不是承诺。实现其中任意一项之前，先检查 `docs/invariants.md`，并补充或更新聚焦测试。

## 优先级 1：Inspect 与预览能力

目标：让 auklet 在修改文件或发布包之前，能解释自己将要做什么。

- 已有第一步：`auk inspect publish` 用于检查 publish plan、本地 package 文件引用、registry 认证和版本占用。
- 后续扩展 `auk inspect`，用于查看 normalized build config、CSS config、workspace packages。
- 展示最终的 `source`、`output`、`modules`、build options、entries、选中的 package roots。
- 发布预览继续保持只读，并展示 package name、当前版本、目标版本、tag、registry、access、dry-run mode、git mode、选中的 targets。
- inspect 输出必须只读，适合在 CI 中安全执行。

## 优先级 2：Package 验证能力

目标：在 publish 之前发现包结构问题。

- 已有第一步：`auk inspect pack` 用于检查 `package.json` entry fields、exports、type files、JS outputs、CSS entries、声明的 files 是否存在。
- `auk inspect publish` 会复用 package 验证，并在本地文件缺失时停止后续 registry 检查。
- 后续可以增加 `auk verify` 类能力。
- 后续可选地读取 `npm pack --dry-run` 输出，并总结 tarball 内容。
- 尽量保持检查结果确定，不依赖 registry 状态。

## 优先级 3：CSS 调试能力

目标：解释为什么某个 style entry 被生成或没有被生成。

- 增加 CSS debug/explain 模式，展示 matched source imports、auto import rules、resolved style files、skipped files。
- 让不支持的场景更可操作，尤其是 `.ts` 文件、`export *`、找不到 style candidate。
- 考虑输出 CSS manifest，方便测试和用户检查。
- 保持 CSS 不变量：production 和 Vite/dev 的 entry semantics 共享 `src/css/core/style/entries.ts`。

## 优先级 4：Publish 安全性

目标：降低发布事故概率，同时避免流程变得不透明。

- 在真实 publish 前增加简洁的 tarball 或 manifest summary。
- 考虑为真实 publish 增加交互确认；CI 下只能通过显式参数跳过。
- 改进用户侧恢复指引：npm auth 失败、partial publish、版本已存在、dirty tree、tag 冲突。
- 保持 publish flags CLI-only，保持真实包发布串行。

## 优先级 5：Workspace 可观测性

目标：让 monorepo 行为更容易检查和调试。

- 在 inspect 输出中展示 workspace packages 和 dependency order。
- 在 publish 或 owner 操作前解释 filter 结果。
- 清晰暴露 root/private package 的选择规则。
- workspace discovery 必须继续统一走 `src/workspace/*`。

## 优先级 6：Watch 与 Dev 稳定性

目标：让长期运行的开发流程更可预测。

- 已有第一步：CSS watch 初次构建失败后仍保持监听，watcher 错误会触发恢复构建；关闭后不会继续响应文件事件或创建新的 watcher。
- 继续改进长期 watch 场景的错误恢复和资源清理。
- 配置变化时触发符合预期的 reload 或 rebuild。
- 当 virtual CSS invalidation 不符合用户预期时，提供更清楚的 HMR 诊断。
- 保持 dev 行为和 production output semantics 对齐。

## 暂不计划

- 为所有 CLI flags 增加通用环境变量配置。
- publish 后自动 git push。
- 在 auklet core 中实现完整 CSS bundling、URL rebasing、预处理器、CSS Modules transform 或 PostCSS plugin 替代能力。
