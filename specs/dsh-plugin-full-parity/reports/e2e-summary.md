# E2E 测试总结（e2e-summary）

> 数据源 = `reports/raw/playwright-report/`（Playwright HTML 报告，机器产物）；
> 截图 = `reports/screenshots/e2e-*.png`（harness 走查）+ `rm-*.png`（真机冒烟）。

## 结论：全绿（4/4）

| 面 | 用例 | 结果 |
|---|---|---|
| harness（真实 dist/client.js 产物） | 4 | ✓ 面板装载/日志段过滤分页/背包·Agent 部署卡（就绪徽章）/诊断段能力矩阵与 ssh 家族行（「新建任务」用例已移除——2026-10-17 用户裁决，FR-C1 回流，e2e-02/03 截图同删） |
| 真机（dsh pky-test profile + 真实 host/DB/ssh/electron） | 8+ 段走查 | 见 acceptance-report「真机冒烟」节（全链证据） |

## harness 机制（可重跑）

- 构建：`cd dsh-plugin && node e2e/build-harness.mjs`（esbuild：React vendor + mockHost 伪 rpc + **dist/client.js 拷贝** + 渲染 boot → `e2e/harness/`）。
- 运行：`pnpm exec playwright test --config dsh-plugin/e2e/playwright.config.ts`（报告自动落 `specs/dsh-plugin-full-parity/reports/raw/playwright-report/`）。
- 断言对象 = **构建产物形态**（非源码重打）：经 `window.__ModuleLoader__` shim（dsh 宿主装载面等价物）装载，HostClient 走真实 transport（`pky/call` 双信封）→ mockHost 分发——传输层归一（diagnostics normalizeDiagnostics）等平台胶水在覆盖面内。

## harness 抓到的集成问题（修复后转绿）

1. dist IIFE 的 factory 以**返回值**递出 exports（shim 需取返回值，非 module.exports）。
2. 传输层 `args` 包裹结构（`{args:{command,payload}}`）——伪 rpc 必须剥层（早期伪面直接透传导致全命令 INVALID_ARGUMENT、面板全默认兜底——该类错误正是 harness 的存在价值）。
3. react-dom 的 `createRoot` 在 `react-dom/client`（vendor 注入面补齐）。

## 真机面的 E2E 归属

真机走查（dsh web → 插件面板 → 真实 RPC → 真实 SQLite/ssh/Electron）以叙事 + 截图归 `acceptance-report.md`（e2e-acceptance 技能口径：Playwright 驱动真浏览器、机器截图、叙事解读），不重复计入本表。
