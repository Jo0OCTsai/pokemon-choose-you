# pokemon-choose-you-helper —— 桌宠 Electron helper 子包

> specs/dsh-plugin AD §3.3（并行组 2）。sidecar Electron helper：透明置顶局部小窗（300×330，
> **禁止全屏透明画布**——Windows DWM 视频合成黑屏坑位）+ stdio JSON 行桥 + 宿主存亡绑定。
> **不依赖 dsh 运行时**——由插件宿主半边 `pet/`（并行组 1 后续任务）spawn。

## 版权声明（NFR-9）

本 helper 分发的精灵素材来自 **PokeAPI/sprites**
（https://github.com/PokeAPI/sprites ，PokeAPI 项目对宝可梦图形素材不主张版权，版权归
Nintendo / Creatures Inc. / GAME FREAK inc.；PokeAPI 素材库依其仓库声明分发）：

- 内置精灵（断网可用）：复用主应用 `public/pokemon/` 分发口径（pikachu / psyduck /
  bulbasaur / chansey / eevee / snorlax 共 6 只，构建期由 `build.mjs` 拷贝进 `dist/renderer/pokemon/`）；
- 非内置精灵：按候选链从 PokeAPI sprites CDN 加载（`sprites` 桥消息的 `cdnBase` 指定入口）；
- 双缺（非内置且 CDN 不可达）回退主宝可梦占位 + 单次「素材缺失」气泡（AD §3.3 A20）；
- 全量图鉴 key→id 映射：构建期拷贝主应用 `src/pokemon/catalog.json`
  （由 `scripts/gen-pokemon-catalog.mjs` 从 PokeAPI 生成）。

再分发口径：v1 仅本地路径/file 安装（自用）；npm 公开发布另行裁决（AD A9）。

## 运行形态

| 形态                      | 入口                                  | 说明                                                                        |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Electron 窗体（开发机）   | `pnpm --filter pokemon-choose-you-helper dev` | 本地 devDep electron 跑真窗体；参数 `--host-pid=<pid>` `--pos=<x>,<y>`      |
| headless（CI/无显示环境） | `HELPER_HEADLESS=1 node src/main.ts`  | 跳过一切 BrowserWindow/Electron 创建，只跑桥/状态机（Node 24 原生执行 .ts） |
| 生产（插件宿主 spawn）    | `dist/main.js`                        | Electron 运行时由插件侧探测下载 `~/.dsh/electron/`（本包不打包运行时）      |

## 桥协议（stdio JSON 行，每行一个 JSON 对象）

- 下行（插件 → helper）基础五种：`task-state`（可选 `caught?: { milestone?, streakDays? }` 捕获演出
  变体——完成路径郑重判定命中时随行下发，缺省 = plain 变体）/ `pomodoro-config` / `lang` / `sprites` / `heartbeat`；
- 上行（helper → 插件）基础五种：`cmd`（10 op 枚举，含 `pet-chat`）/ `focus-settle`（D16 整分钟
  入账，宿主按 localSessionId 幂等——PROTOCOL §7）/ `pomo-state`（番茄相位快照：相位迁移与每次
  hello 后发送，宿主只留最新帧经 `petStatus.pomodoro` 给 conversation chip 倒计时/短休息态——D2
  本地计时态的唯一出口，不落库）/ `hello`（版本+能力位）/ `crash-diag`（环形缓冲诊断）；
- 容错：未知 type/op、缺字段、坏 JSON → 丢弃 + 计错 + 进诊断，**不崩**；半行缓冲、超长行护栏；
- 宿主存亡：stdin 管道守卫 + 心跳静默 >15s（可配）判死 + `--host-pid` 轮询双保险 → 10s 内退出。

### 系统能力扩展（specs/dsh-plugin-full-parity AD §4.3，单源 `src/bridge/protocol.ts` + `sys-protocol.ts`）

**hello.caps 8 能力位**：`sys-tray` / `sys-shortcut` / `sys-notify` / `sys-tts` / `sys-dialog` /
`sys-open` / `input-count` / `mac-auth`——helper 实装对应 `sys/` 模块才声明该位；host 缓存
hello 按位降级（缺位不发对应消息 → 页内降级通道）。**hello 发送门控（A28/NFR-14）：host 未收到
hello 前禁发任何 sys 消息**（能力位快照到达才放行——关闭「能力位缺失但消息已发」竞态窗口）。

| 方向 | 消息 | 数据结构 |
|------|------|----------|
| 插件 → helper | `sys-config` | `{ tray?: { tooltip, petVisible? }, shortcuts?: { capture, togglePet }, inputResponse?: { enabled, focusHopCoupleMax? }, tts?: { enabled }, pet?: { mate?, agentConfigured? } }`（启停面；三语不在此——文案 host 组装。**可选扩展（向后兼容）**：`tray.petVisible` = host supervisor 显隐回传（托盘 label 同步）；`pet` 分节无能力位（仅 hello 门控）——`mate` = `pet_mate` 陪跑闸门投影、`agentConfigured` = 已配置 agent 布尔（ChatBox 菜单条件项）） |
| 插件 → helper | `sys-notify` | `{ kind: reminder\|pomo-done\|pomo-chime\|overdue\|review, title, body }`（三语文案 host 组装；通知点击无动作） |
| 插件 → helper | `tts-speak` | `{ text }`（文本已按桌面口径剥 emoji 截 120 字符；仅郑重时刻、默认静音由 `sys-config.tts.enabled` 控制；失败 helper 静默） |
| 插件 → helper | `dialog-request` | `{ mode: "open-file", filters?: { name, extensions[] }[], seq }`（收到即秒级回 `dialog-ack {seq}`——seq 两段第一段） |
| 插件 → helper | `dialog-cancel` | `{ seq }`（host 侧取消：helper 关闭对应对话框并丢弃该 seq 迟到结果） |
| 插件 → helper | `open-path` | `{ path }`（打开导出目录等；不存在 host 先建再下发） |
| 插件 → helper | `mac-auth-query` | `{ kind: "accessibility", seq }`（同型两段：秒级回 `mac-auth-ack {seq}`） |
| 插件 → helper | `chat-reply` | `{ text, ok }`（AI 聊聊回答：截前 2 句；失败 `ok:false` 气泡回退） |
| helper → 插件 | `tray-action` | `{ action: open\|pet-toggle\|settings\|quit }`（quit = helper 连同桌宠与托盘退出，宿主不受影响） |
| helper → 插件 | `shortcut-fired` | `{ id: capture\|togglePet }`（注册失败时 helper 不发——降级提示经诊断面） |
| helper → 插件 | `notify-clicked` | `{ kind }`（观测留痕；无动作语义） |
| helper → 插件 | `dialog-ack` | `{ seq }`（**回执级**：host 以 10s ack 超时判能力在位，超时按 `HELPER_CAPABILITY_MISSING` 降级——不与用户交互时长耦合） |
| helper → 插件 | `dialog-result` | `{ seq, canceled, paths?: string[] }`（**完成级**：不设短超时（≥5min 长超时兜底）；host 取消走 `dialog-cancel`） |
| helper → 插件 | `mac-auth-ack` | `{ seq }`（mac-auth 同型回执级 ack） |
| helper → 插件 | `mac-auth-result` | `{ seq, kind, granted }`（完成级；**seq=0 保留给主动上报**——授权中途撤销 → helper 停止计数并主动上报 `granted:false`） |
| helper → 插件 | `input-activity` | `{ cps }`（≥1s 节流回传；**仅计数**——键值/键名/窗口标题/应用名 0 出 helper 计数模块，NFR-13） |
| helper → 插件 | `cmd`（op 扩展） | 增 `pet-chat`（text = 问题 ≤200 字符，host → 主 agent 执行方；历史内存 3 条 helper 侧自持） |
| helper → 插件 | `sys-unsupported` | `{ unsupported }`（载荷字段名 `unsupported`——AD 表记 `{ type }` 与信封 type 撞名，就地改名；helper 认识类型但能力位与实现失配的兜底上报，每类型节流一次 + 计错进诊断；旧 helper 无此消息面） |

**双向兼容语义（NFR-14，崩溃数 = 0）**：

- 新 host + 旧 helper：能力位缺位不发（发送门控）；若仍收到未声明能力的消息 → helper 丢弃 +
  计错 + `sys-unsupported` 上报 → host 记诊断 + 面板提示升级 helper；
- 旧 host + 新 helper：host 侧 `validateUpstream` 丢弃未知上行 + `invalidMessages` 计数进诊断
  （安全忽略并留日志）；
- seq 两段语义（回执 ≠ 交互完成）：`dialog-ack` / `mac-auth-ack` 回执级 10s 超时判能力在位；
  `dialog-result` / `mac-auth-result` 完成级不设短超时——杜绝「用户在系统对话框停留 >10s 被
  误降级 + 迟到 result 与降级提示双流竞争」。

**文本渲染红线**：桥文本字段（通知标题/正文、`chat-reply`、`tts-speak` 文本）在 helper 渲染层
一律 `textContent` 赋值，禁 `innerHTML` / `insertAdjacentHTML`（host 组装文案亦不视为可信——
纵深防御；`sys/` 模块族与渲染层实现在 full-parity 任务 2.4/2.5）。

消息形状与校验规则的单一源：`src/bridge/protocol.ts`（含 `sys-protocol.ts` 并入；组 1 host 侧
`pet/` 对接消费）。

## 工程纪律

- 独立 vitest 配置（`vitest.config.ts`）：**不并入 dsh-plugin 的 coverage 口径**——GUI 胶水
  不进 business core 门禁，bridge 契约（真 stdio fake host）与状态机纯逻辑测试跑通即可；
- Electron 窗体不进 CI（headless 跳过；CI 安装期 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`）；
- 渲染层 vanilla TS + CSS（不引 React——dsh-pet 先例）；视觉 token 源 =
  `docs/design/DESIGN_SYSTEM.md`（与主应用 `src/dex.css` 同一设计源，UIUX §6.1）。

## 系统能力模块族 sys/（full-parity 任务 2.4 · AD §3.4「每能力一文件、独立启停」）

| 模块 | 能力 | headless 形态 |
|------|------|--------------|
| `tray.ts` | Tray 常驻（tooltip host 组装下发；左键打开图鉴机 / 右键四项菜单三语 / 退出一次确认）→ `tray-action` | 记录器（click/pickQuit 可编程） |
| `shortcuts.ts` | globalShortcut ⌘⇧K/⌘⇧D（sys-config 下发加速键）→ `shortcut-fired`；注册失败不发 | 记录器（failNext 可编程） |
| `notify.ts` | Notification 送达（sys-notify 五 kind）→ `notify-clicked` 观测 | 记录器（clickLast） |
| `tts.ts` | speechSynthesis（默认静音由 sys-config.tts.enabled 控制；失败静默 D26） | 记录器 |
| `dialogs.ts` | dialog-request → 秒级 dialog-ack → dialog-result；dialog-cancel 丢弃迟到结果 | 记录器（nextResult 可编程，默认 canceled 即时收口） |
| `openPath.ts` | shell.openPath | 记录器 |
| `macAuth.ts` | AX 授权查询（含直达面板动作 30s 节流）+ 撤销检测（AX 通知 best-effort + 60s 轮询）→ seq 0 主动上报 | 记录器（granted/revoke/grant 可编程） |
| `inputCount.ts` | **唯一原生依赖挂点**：uiohook-napi dynamic import（ABI 失配降级不崩 A31）；开启条件 = enabled 且 AX granted 且 darwin（非 macOS 永不启动 D32）；**只计数红线**（回调零参——键值/键名 0 读取）；cps 滑动窗口 → input-activity ≥1s 节流 | 记录器（platform/granted 注入 + feed/tick） |

装配：`index.ts` 组合根（SysRouter 接口 + HeadlessSys/DeferredSys/createElectronSys）——
electron 形态 hello 先行、DeferredSys 排队重放（app ready 后挂真模块）；input-count 位
在 uiohook 探测成功后才声明（能力位与实现不得失配），迟到加入触发 hello 重发校正 host
快照。**机械红线（进 CI）**：eslint no-restricted-syntax 锁 sys/** 的 rawcode/keycode
标识符 + renderer/** 的 innerHTML/insertAdjacentHTML（`eslintRedlines.spec.ts` 自证）。

## 桌宠行为组（full-parity 任务 2.5 · 桌面 composables 语义移植）

- **坐栖**（state/perch.ts + electron 侧 ipc `pet:reportPos`/`pet:checkPerch`）：窗口底边距
  工作区底 ≤72 逻辑像素 → 姿态幅度减半 + 落座台词（首次判定即说；拎起即离）；
- **时刻台词**（state/timeLines.ts）：生日 > 深夜 > 周五晚 > 整点优先级，普通类每天一次/
  整点类每小时一次（内存去重）；睡觉/urgent/对话/演出/拖拽/快捷屏禁播；生日带陪伴天数
  （metOn = 渲染层 localStorage，桌面 pet.metOn 同族键位）；
- **演出**（state/catchScene.ts + renderer/capture.ts）：plain 单球 / streak 双球三摇 /
  milestone 双排星星（优先互不叠加）；点击跳过；reducedMotion 即时结算（celebrate-end
  照常收口）。里程碑/连胜判定数据面待 host 接线（见 pet/README 接线缺口注记）；
- **陪跑**（state/mate.ts + renderer/mate.ts）：专注满 25 分钟一位（排除当前与主宝可梦，
  空回退伊布）；一次专注会话一位一次；默认关（pet_mate 无下行面——接线缺口注记）；
- **打盹/时段问候**（state/greetings.ts + sprite.ts asleep 面）：无任务 + 5min 无交互入睡
  （任意交互揉眼醒来带台词）；早/午/晚/深夜问候每日各一次（localStorage 去重）；
- **AI 聊聊**（state/chatLog.ts + renderer/chatbox.ts）：右键「💬 对话」原位 ≤4 行、
  问题 ≤200 字、经 cmd.pet-chat 上行 → chat-reply 下发、失败回退气泡、历史内存 3 条；
  展开调高 330↔480 + 窗体临时可聚焦（focusable 纪律的例外窗口）；
- **输入响应**（state/inputCps.ts + renderer/inputResponse.ts）：<2/2–5/≥5 三档微抖回头、
  停顿 >3s 哈欠、working hop 耦合 ≤+10%、演出中跳过、reducedMotion 不启动。

## 目录

```
src/
  bridge/     协议（protocol.ts 消息全集+校验 / sys-protocol.ts 系统能力扩展单源 / validators*.ts / lineCodec.ts / bridge.ts 通道+存亡 / heartbeat.ts / diag.ts）
  sys/        系统能力模块族八件（上表；index.ts 组合根 + context.ts / labels.ts 三语托盘文案）
  state/      纯逻辑（petState / bubbleTiming / pomodoro / focusSettle + full-parity：perch / timeLines / catchScene / mate / greetings / inputCps / chatLog）
  sprites.ts  素材链（内置 → CDN → 双缺回退 + 单次缺失提示）
  runtime/    运行时装配（index.ts 类型面 / impl.ts 实现 + sys 路由 / lines.ts 台词；零静态 Electron 依赖）
  main.ts     入口（headless 分流 / --host-pid / --pos / DeferredSys）
  electron-app.ts + preload.ts + ipc.ts   Electron 胶水（窗体/穿透翻转/置顶看门狗/坐栖判定/IPC）
  renderer/   渲染层（renderer.ts 装配 / capture.ts 演出变体 / chatbox.ts / mate.ts / inputResponse.ts / lines.ts 三语台词 / pet.css / index.html）
__tests__/    vitest（bridge.contract 真 stdio / 纯逻辑 / sys 模块与路由 / headless 集成 / eslint 红线自证）
build.mjs     esbuild 构建产物（dist/；external: electron + uiohook-napi——原生依赖经插件包 node_modules 运行时解析）
```
