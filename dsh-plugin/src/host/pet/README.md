# pet/ —— 桌宠 helper 生命周期（AD §3.1）

Electron helper 进程监督（崩溃 10 秒内自拉起）、stdio JSON 行桥（§4.3 协议）、任务状态事件流
（本形态写后直推 + 跨形态 ≤2 秒侦听）、位置持久化（`dsh:pet_pos`）；素材双缺/首装离线降级路径
（§3.3 A20）（并行组 2）。

## 系统能力扩展面（full-parity AD §4.3 / 任务 2.3·2.6）

- `bridge.ts`：`BridgeClient.sys` 子面挂载 + sys 上行分发（seq 四消息入通道、sys 事件派可选处理器）；
- `sysChannel.ts`：sys 发送面（**hello 门控** + 能力位缺位不发 + sys-config 分节过滤）与 seq 两段
  语义编排（`sysRequests.ts` 状态机：ack 10s 回执级判能力 → `HELPER_CAPABILITY_MISSING`；result
  完成级不设短超时 + ≥5min 兜底；`dialog-cancel` 取消通道，迟到结果丢弃）；
- `ttsText.ts`：TTS 文本预处理（桌面 voice.rs 同构：剥 emoji/符号截 120 码点）；
- `sysEvents.ts`：tray-action / shortcut-fired → pageOpen·显隐链；input-activity 仅内存状态面
  （NFR-13 不落库不外发）；`macAuth.ts`：macAuthorizationStatus 查询 domain 面（命令装配归 2.9）；
- `solemn.ts`：郑重时刻判定（A30——里程碑优先/连胜演出，`StreakProvider` 接口占位待 domain/streak
  接线）+ `tts-speak` 仅本形态；`electronGet.ts`：Electron 运行时按需获取（A32，校验常量内嵌 +
  镜像只换 URL + 原子落位 `~/.dsh/electron/dist/`）。

## 接线缺口注记（任务 2.4/2.5 helper 侧实施发现 · 2026-10-17）

helper sys/ 模块族与桌宠行为已实装；以下数据面在现行桥协议（§4.3，单源 helper/src/bridge/
protocol.ts）中**无承载通道**，机制在 helper 侧全量在位、默认降级运转——需协议/装配侧
（任务 2.3/2.6/2.7 owner）裁决补面：

| # | 缺口 | helper 侧现状 | 建议通道 |
|---|------|--------------|----------|
| 1 | **FR-B3 演出变体数据**（里程碑 before/after 图鉴计数、连胜快照）：`solemn.ts` 已在 host 完成判定但只发 `tts-speak`（受 pet_voice 默认关闸门，不能承载视觉变体） | `runtime` 的 `solemn()` 注入点默认恒 plain（单球演出）；里程碑/双球三摇机制与纯函数全量在位（state/catchScene.ts，TDD 全绿） | `task-state` 追加可选 `caught?: { milestone?: number, streakDays?: number }`（完成动作路径内随写后直推下发，向后兼容）或新增下行消息 |
| 2 | **pet_mate / agentConfigured 共享键**（FR-B4 陪跑默认关、FR-A8 聊聊条件入口） | mate 触发闸门常量关门（MATE_ENABLED=false）待接线；ChatBox 菜单项缺省呈现（host 未配 agent 时经失败回退气泡优雅降级——与 Gherkin「未配置不出现」有偏差，标待确认） | `sys-config` 追加可选分节 `pet?: { mate: boolean, agentConfigured: boolean }`（validators-sys 分节守卫增量，host 侧 SECTION_CAPS 同步） |
| 3 | **桌宠可见性回传**（托盘「显示/隐藏」label 翻转） | runtime 乐观跟踪（hide cmd / tray-toggle / shortcut 翻转）；host 侧 supervisor.show/hide 未经桥回传时 label 可能漂移 | `sys-config.tray` 追加可选 `petVisible?: boolean`，supervisor 生命周期处重发 |

补面原则：全部为**可选字段的向后兼容增量**（旧 helper 分节守卫丢弃未知字段不崩——
NFR-14 既有立场），不需协议版本位。
