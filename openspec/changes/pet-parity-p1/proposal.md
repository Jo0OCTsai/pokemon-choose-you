# Proposal

## Why

桌宠对齐批 P0（change 已实施，commit 65917fe）收口了 helper 侧接线断点与参数对齐，但调研确认的三块缺口仍在：① 共享键 `main_pokemon` / `pokemon_quotes` 无下行面（helper 空闲精灵不跟随主宝可梦、不消费自定义台词）；② 提醒只走系统通知，桌宠本体零联动（社区评估轴与桌面 parity 双重缺口）；③ 窗口行为面（置顶/缩放/透明度/位置找回）与首启体验落后于社区最佳实践。此外 P0 验收时发现：host 设置写入只触发 `notifyLocalWrite`（仅推 task-state），`sys-config` 从不重推——已接线的 mate/agentConfigured 改设置要等 helper 重启才生效，本批全部新下行面也会被同样卡住，必须一并修复。

## What Changes

- **修复设置写后配置面失活**：host 写路径回调 `onWrites` 追加 `pushSysConfig`（设置变更即重推 sys-config，无需 helper 重启）。
- **main_pokemon / pokemon_quotes 下行接线**：`sys-config.pet` 增 `mainPokemon`；新增下行消息 `quotes`（按精灵惰性下发：主宝可梦 + 当前任务精灵的自定义台词，相关集变化时重发）；helper 空闲精灵选择链对齐桌面（任务精灵 → mainPokemon → pikachu），单击/撸宠台词优先自定义台词，深夜档（22–6 点）回退全局安睡池（桌面 quotesNight 同构）。
- **提醒到达桌宠**：新增下行消息 `pet-event { kind: "reminder", … }`（host reminder loop 已组装 `PetReminderEvent` 但从未下发，接线即可）；helper 播敲门/催促气泡（urgent 抖动、钉住不倒计时、60s 兜底）+ 就近动作条「✔ 完成 / ⇨ 推迟 10 分钟」；新增 cmd op `snooze {taskId, minutes}`（host 写 `remind_at` + 重置 `reminded`）；petState 补 urgent 底态（解除 U10 降级）。
- **窗口行为配置**：共享键 `pet_always_on_top`（默认开）/ `pet_scale`（1 / 1.25 / 1.5 / 2）/ `pet_opacity`（100 / 80 / 60），经 `sys-config.pet` 下行；helper 应用置顶开关（含看门狗条件化）、窗口三档尺寸（330/480/590）与 590 宽快捷屏等比缩放、CSS `--pet-scale` 联动内部元素与 `.hit` 命中区、精灵透明度；客户端设置面新增三组控件。
- **位置找回**：helper 建窗时校验恢复位落在任一显示器 bounds 内，否则回落主屏右下默认位；客户端设置面「重置位置」动作（rpc `petResetPos` → host 清 `dsh:pet_pos` + 下发复位事件）。
- **光标跟随视线**：渲染层 mousemove（穿透 forward 仍可达）按光标相对精灵中心的方位触发方向化 `look-left/right` 微动作（节流冷却），Bongo Cat 式「宠物对你有反应」。
- **首启进度透出**：`ensureElectronDist` 的下载/校验/解压阶段进度经 rpc `petSetupProgress` 查询面透出到客户端设置面「显示桌宠」行（替代静态降级文案）。

不改：桥协议既有字段语义（全部为可选增量）、桌面 app 侧行为（对齐方向单向 helper → 桌面基准）、B4 TTS 触发面扩展（生日/allDone TTS 归 P2 顺带，不在本 change 范围）。

## Capabilities

### New Capabilities

- `dsh-pet-config-feed`: dsh 桌宠的宿主→helper 配置下行面——共享键投影（主宝可梦、自定义台词、置顶/缩放/透明度）、写后即推、惰性 quotes、位置校验与重置、Electron 首启进度透出。
- `dsh-pet-reminder-loop`: 任务提醒到达 dsh 桌宠本体的联动面——pet-event 下行、urgent 底态、钉住气泡与就近动作条（完成/推迟）。

### Modified Capabilities

（无——`dsh-plugin` 既有能力面无主 specs 归档，本 change 为其桌宠域首批规格化能力。）
