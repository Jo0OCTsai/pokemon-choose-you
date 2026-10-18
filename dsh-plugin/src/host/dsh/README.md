# dsh/ —— 平台胶水层（host 半边真实适配，Phase A）

> 业务核心零 dsh 依赖（AGENTS.md 铁律）的例外边界：本目录是**唯一**允许 import dsh/Cordis
> 平台面的 host 侧目录。RC 期 dsh 破坏性变更被限制在这一薄层内消化。

## 模块挂点

- `hostEntry.ts` —— 插件入口（loader 消费 `name`/`inject`/`Config`/`apply`）：
  能力探测（node:sqlite 硬拒绝）→ `createPlugin` 真实装配（ctx.interval 映射 timer、
  helper/electron 探测桌宠、judgeExecutor 配置分流——volatile 活读闭包：cli 分支复用
  assembly 导出的 `defaultJudgeExecutor` 单源，subagent 分支走 `subagentExecutor.ts`
  的 dsh 内置通道（A7 默认），背包改值经 Loader 热应用后下一次判定即生效，无需重启
  宿主；inject 声明 agents/subagents/agentDefaultModel——内置通道消费面，dsh-base
  恒在场、缺席插件不装）→ 22 工具经 defineTool 注册 →
  host 命令挂 `PkyRemoteService`（Typert Remote 数据面，见下）。
- `subagentExecutor.ts` —— **dsh 内置判定通道**（A7 无头 subagent，原
  `subagentExecutorPlaceholder` 的真实接面）：`ctx.subagents.startActivation`
  （provider=spawn 进程内全新子级 / delivery=caller 调用方等待 / outputSchema 结构化
  输出——child 直接返回建议数组）+ `ctx.agents.create` 常驻 root 父 agent（首次判定
  懒建、origin=subagent 分类不进主会话列表、模型组合取 `agentDefaultModel
  .currentSelection()`）。selfLanding=false——orchestrator 走 domain/suggest 提交期
  校验落库（A21 修正重试同路径）；超时 120s（对齐 CLI agent 缺省）经 AbortSignal +
  dispose 归还；stopReason 非 completed / 结构缺失判失败；会话账本 sessionId=childId
  （捕捉路径也已接线透传）。服务面经结构化收窄（SubagentsFace/AgentsFace/
  AgentDefaultModelFace——零 dsh 包 import，业务核心无感知）。真机闭环：pky-link
  web 宿主快捕判定 4.5s 落库 todo。已知局限（debt）：结构化路径无 pk context
  （判重/分类/标签/相对时间缺上下文，模型 reason 自陈）。
- `toolSchema.ts` —— 22 工具参数类型表 + `toDslParameters` 映射器（我们 ParamDecl →
  dsh defineTool 的 JSON DSL 判别联合）；完整性测试锁表键集 == 注册表参数摘要。
- `sshScope.ts` —— **唯一 dsh-ssh 家族触碰点**（任务 2.1）：per-deployment isolate
  装配 + 家族动态装载 + 连接生命周期托管；实现 remote/sshScope.ts 的平台中立
  `SshScope` 接口（spawn/spawnTerminal/shell/writeFile/disconnect）。装配模式三要点
  （spike 实测修正 A/B，依据 `specs/dsh-plugin-full-parity/spike-dsh-ssh.md`，探针参考
  实现 = 同目录 `spike/pky-spike/index.js`）：
  1. **双 label**——cordis 服务注册槽以 label 单一编址，ssh 与 subprocess 各拿一个
     Symbol（`pky-dep-<id>-ssh` / `pky-dep-<id>-sub`）；同名 label 链式 isolate 会撞
     槽位（装载即抛 "service subprocess has been registered"）。按部署 id 缓存 label
     对，重连复用同 label（join 语义）。
  2. **consumer 子插件取服务**——消费方必须声明 inject 才能读注入服务；向目标 scope
     装 `inject:["ssh","subprocess"]` 的 consumer，其 apply 回调即两服务可用时机
     （`loadConsumer`）。
  3. **fiber 必须 await**——`ctx.plugin()` 返回 Fiber（PromiseLike），装载期错误只有
     await 才能捕获；卸载原语 = `fiber.dispose()`（装载逆序）。
  家族以远端 helper 为传输基底——scopeFor 按 helper 落定状态路由（acceptance §4 已知项
  1 修复）：helperPath/helperHash 均落定 → 家族链 isolate scope（存活复用/漂移重建）；
  任一未落定（provision 前置步①–④）→ `directScope.ts` 直连 ssh 传输兜底（本机 ssh
  二进制 + BatchMode/ConnectTimeout，选项复用 sshCheck.sshConnectArgs；无长连、
  spawnTerminal/writeFile 不支持；verify 过后 helperPath/Hash 落库自然切家族链）。
- `probeDsh.ts` —— capability 探测实装（任务 2.2，AD §4.8）：dsh 平台面 8 键
  （`DSH_CAPABILITY_KEYS` = CAPABILITY_KEYS 的 dsh 子集）装配期真实探测——dsh-ssh =
  家族双包动态 import + 导出面形状（class + 静态 Config/inject）；terminal/subagent/
  worktrees/timer = ctx 表面；storage/slots 缺失按前序自持口径标 ok。结果进
  diagnosticsSnapshot 的 `capabilities` 段（响应扩展归任务 2.9），`sshFamily` 字段 =
  `capabilities["dsh-ssh"]` 的呈现投影（`sshFamilyOf`，不另立第二条探测路径）。
- `remoteService.ts` —— host→客户端数据面（Typert Remote，2026-10-13 迁移）：
  `PkyRemoteService extends TypertRemoteService`（`super(ctx, "pky")`——服务名即 wire
  命名空间），单方法 `@Remote("call")` 转发 `plugin.commands`（69 命令不拆分），业务
  信封（PROTOCOL §2）作 Remote 返回值原样透传——api-gateway 在共享 `/api` 通道按端点
  `pky/call` 经 SRC 模式解析（源码参数名 = wire 字段；**本包构建不 minify 是 SRC 解析
  的硬依赖**），gateway 经 `ctx.get("pky")` 直取服务——无消费方 inject、无晚供问题。
  原自定义通道（connection.rpc.handle "/pky"）在 rc.2 对第三方不可用（影子 ctx 读
  owner.webServer 撞严格制——证据链见 debt.md 历史条目），rpcDispatch.ts/rpcChannel.ts
  已删除。

## 验证口径

- 单测：`__tests__/dsh-tool-schema.spec.ts`（纯逻辑件）+ `__tests__/dsh-probe.spec.ts`
  （fake ctx 表面全枚举 + 本机闭包真实动态 import）；Remote 链路真机验证走
  pky-test profile（`dsh --profile pky-test --no-open --port <p>` 后浏览器开面板看真数据）。
- hostEntry/sshScope 接线面不进覆盖率门禁（vite.config.ts exclude `src/host/dsh/**`
  ——GUI/平台胶水同口径）；sshScope 的 isolate 装配真机验证归 spike（已过，
  `specs/dsh-plugin-full-parity/spike-dsh-ssh.md`）+ 4.5 profile 冒烟（装配接线归任务
  2.9）；新建测试 profile，勿动 web/desktop。
- client 半边（Phase B 已落型）：`src/client/dsh/`（module-loader bundle + slots 注册 + RPC transport，
  见该目录 README）；本层 rpcDispatch 的信封转换由其 transport.ts 逆向还原。
