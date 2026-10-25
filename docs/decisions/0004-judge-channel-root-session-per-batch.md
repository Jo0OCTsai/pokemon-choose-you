# ADR-0004：判定通道改 root 会话（一批一会话）

> 状态：已采纳　日期：2026-10-19
> 来源：2026-10-19 调研 + 用户裁决（只改判定不改派发；形态一批一会话）。上游事实 = dsh 0.2.1-rc.2 平台面调研（compatibility.md 矩阵 dsh-session 行）。

## 背景

AI 待办判定默认通道此前为无头 subagent（`ctx.subagents.startActivation` + 常驻隐藏父 agent）。事实链：dsh 会话头 `origin=subagent` 的会话**不进主会话列表**（web controller 单独路由到子智能体面；`dsh headless` 拒绝 adopt）——判定转录虽完整落盘（`~/.dsh/sessions/_no-cwd/<uuid>/`），但用户在会话列表看不到、无法回放。用户裁决：判定须可见可回放，且**一批一会话**（否决粘性单会话续写——上下文随批次累积推高 token 成本）；派发不动（dsh 无头派发续接缺口另记 debt）。

## 决策

### 1. 判定执行方 = 顶层 root agent 会话（执行配方同 dsh-headless）

每批判定：`agents.create`（root、无 origin 分类、`meta.cwd` 归组项目、模型组合显式取 `agentDefaultModel.currentSelection()`）→ `agent.followup` 投递判定 prompt（结构化构造 UserMessage，不 import dsh 包）→ `whenIdle` → 从 session 事件折叠末段 assistant 文本与 turn 终态 → `sessions.flush` → `dispose`（会话文件留档，进主会话列表、可回放；失败/超时也先 flush 留部分转录）。会话 id 保持 `pky-judge-` 前缀；prompt 首行 `【pk 待办判定】` 标记改善列表标题可读度。

### 2. 放弃 outputSchema 结构化强约束，换可见性

root 会话走普通 turn，无 subagent 通道的 outputSchema 结构化输出。补偿链：prompt 要求裸 JSON 返回 + 解析器容忍 ``` 围栏 + `parseSuggestions` 形状守卫 + orchestrator 提交期强校验（A21 校验失败修正重试不变）。垃圾输出 = 通道失败（与旧通道「结构缺失报错」同语义，不触发 A21）。禁工具仍靠 prompt 指令（与旧通道同机制同风险——旧 subagent 子级同样带工具装配）。

### 3. 配置值改名与旧值别名

`judgeExecutor` 值域 `["session","subagent","cli"]`、默认 `session`；旧存量值 `subagent` 保留为合法枚举（避免宿主已存配置校验失败），路由与 `session` 同（`!== "cli"` 即内置通道，无兼容分支代码）。UI 哨兵值 `dsh-subagent` → `dsh-session`；能力探测键 `dsh-subagent` → `dsh-session`（探测面 subagents → sessions）。插件 inject：`subagents` 退役、`sessions` 进场。

## 后果

- 判定批次在宿主会话列表可见、可 resume 回放；轮询频繁时列表条目增多（用户已知悉取舍）。
- RC 暴露面变化：`ctx.subagents`（startActivation/activation）退场，`ctx.agents` 运行时面（followup/whenIdle/session.eventAt）+ `ctx.sessions.flush` 进场——compatibility 矩阵已同步，dsh 升级时此面需复验。
- 已知局限延续（debt）：判定会话无插件工具装配（判重/分类/标签/相对时间缺上下文）——候选演进 = `agents.create` 的 setup 回调挂 todoContext/todoSuggestBatch。
