# dsh/ —— 平台胶水层（client 半边真实适配，Phase B）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是 client 侧唯一允许触碰
> dsh 平台形态（module-loader bundle / slots 契约 / connection rpc 通道）的目录。
> RC 期 dsh 破坏性变更被限制在这一薄层内消化；React 视图本体在 `src/client/**`。

## 模块挂点

- `clientEntry.tsx` —— 客户端入口（浏览器 Loader 经 `window.__ModuleLoader__.load` 挂载
  dist/client.js，消费 `inject`/`apply`）：`ctx.connection.rpc` → transport →
  `createHostClient` → 双 slot 注册——`plugins.detail.section`（list/root，subject 指向
  本包 `pkg.name === "dsh-plugin"` 才渲染 PluginDetailPage，他包 null 零占位）与
  `conversation.session.header.actions`（list/session，ConversationChip；选 actions 而非
  single 容器位 `conversation.header`——多插件共存不冲突）。chip 点击的 pageOpen 导航
  降级 noop（host 推送通道未接 dsh 导航，接面后落型）；`slots.inject` 自带纤维回收。
- `transport.ts` —— DshRpcTransport：命令 → `/api` + `pky/<command>`（前缀与 host 侧
  rpcDispatch 单源），ConnectionRpcResult → PROTOCOL §2 信封逆向还原（value→data /
  details.hint→hint / 未知码折叠 INVALID_ARGUMENT 原码并入 message）；
  diagnosticsSnapshot 视图模型归一（host `status` → client 契约 `level`）；pageOpen
  本地监听面（host 推送接面预留）。
- `panelData.ts` —— 读命令 → PanelData 组装：configRead/dbStatus/diagnosticsSnapshot/
  filterList/promptList 并行逐项兜底；locale 取共享 `language` 键；健康/授权派生自
  diagnostics feishu 链路（epoch 毫秒 → RFC3339——client timeOf 对 number 取 slice 会
  崩）；agents/routes 从 `ai_agents` / `dsh:dispatch_routes` 设置键 JSON 解析；换装搜索
  内置主应用 catalog.json（`@app-pokemon` alias）。**实体清单（tasks/messages/sessions/
  dispatches/followups/categories）读命令不在 50 命令面——空集降级，补齐后此处点亮**
  （docs/debt.md）。

## 构建与验证口径

- 构建：build.mjs client 段——esbuild cjs + banner/footer 包成 module-loader IIFE 形态
  （抄 dsh 官方 client 包开头），external 仅 react/react-dom/react/jsx-runtime（宿主
  module table 种子），CSS modules 经自研插件内联注入（`<style data-plugin-css>` 幂等），
  @app-i18n/@app-pokemon 经 tsconfig paths 解析后整体 bundle。
- 单测：`__tests__/client/dsh-transport.spec.ts`（信封还原/归一/监听面）、
  `__tests__/client/dsh-panel-data.spec.ts`（组装/派生件）、
  `__tests__/client/dsh-client-entry.spec.tsx`（slot 注册/subject 自判/chip 零占位——
  fake slots + mockHost 信封正向转换）。
- client 代码不进覆盖率门禁（vite.config include 只扫 src/host），进 lint/棘轮。
- 真实加载走 pky-test profile 冒烟（`dsh web --profile pky-test` 后台起服 curl bundle）。
