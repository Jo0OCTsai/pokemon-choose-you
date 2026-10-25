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

## 接线缺口注记（任务 2.4/2.5 helper 侧实施发现 · 2026-10-17；2026-10-20 桌宠对齐批更新）

helper sys/ 模块族与桌宠行为已实装；下表为历史缺口与当前状态（pet-parity 批已收口 1/2/3）：

| # | 缺口 | 状态（2026-10-20） |
|---|------|------------------|
| 1 | **FR-B3 演出变体数据**（里程碑/连胜） | ✅ 已接线：`task-state.caught`（含 `allDone` 收工清空）随 done 收官单推下发；helper `onTaskState` 完成迁移统一消费（变体演出 + 台词优先级 allDone > milestone > streak > 收尾） |
| 2 | **pet_mate / agentConfigured 共享键** | ✅ 已接线：`sys-config.pet` 分节下发，helper `observeSysConfig` 投影 `pet-config`（mate 闸门开门、ChatBox 菜单条件项如实增减） |
| 3 | **桌宠可见性回传** | ✅ 已接线：`sys-config.tray.petVisible` + supervisor running 投影 |
| 4 | **main_pokemon / pokemon_quotes 无下行面** | ✅ 已接线（P1 D2）：`sys-config.pet.mainPokemon` + 独立 `quotes` 消息惰性下发（相关集 = 主宝可梦 + 进行中精灵，变化才发）；helper 空闲精灵链与台词优先级对齐桌面（自定义 > 深夜池 > 默认池） |
| 5 | **mate 候选池无图鉴统计下行面** | ✅ 已接线（P2）：`sys-config.pet.dexCaught`（done 任务去重分类精灵集）下发；helper 候选池 = 图鉴已捕捉（空集回退内置六只），排除当前精灵与主宝可梦 |

补面原则：全部为**可选字段的向后兼容增量**（旧 helper 分节守卫丢弃未知字段不崩——
NFR-14 既有立场），不需协议版本位。
