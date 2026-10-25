# Tasks

## 1. 修复与协议扩展（host + helper 桥面）

- [x] 1.1 onWrites 追加 pushSysConfig（loopSection.ts / assembly.ts 两处装配点）
- [x] 1.2 协议扩展：`sys-config.pet` 增 `mainPokemon / alwaysOnTop / scale / opacity`（sys-protocol + validators-sys 分节守卫）；新下行 `quotes { map }` 与 `pet-event { kind: reminder | reset-pos, … }`（protocol + validators 两端同源）；cmd op 增 `snooze`
- [x] 1.3 单测：新字段校验放行/作废矩阵 + 旧消息兼容（未知字段丢弃）

## 2. A4 配置下行接线（host）

- [x] 2.1 stateFeed：sys-config.pet 组装补 mainPokemon / alwaysOnTop / scale / opacity（读共享键，值域钳制）；quotes 相关集计算与变化重发（pushTaskState / republishAll 挂点）
- [x] 2.2 单测：pet-statefeed 扩展（值域钳制、惰性集变化才发）

## 3. A4 helper 消费

- [x] 3.1 runtime：`quotes` / `pet-event` 消息处理 + UiEvent（quotes / reminder / reset-pos）+ 快照镜像透出
- [x] 3.2 渲染层：空闲精灵选择链（任务精灵 → mainPokemon → pikachu）；单击/撸宠台词优先自定义 quotes、深夜档（22–6）回退全局安睡池（台词表补 quotesNight 三语）
- [x] 3.3 单测：精灵选择链 + 台词优先级纯逻辑

## 4. B1/B2 提醒到达桌宠

- [x] 4.1 host：reminder/deliver.ts pet 通道接桥（pet-event 下发）；cmdHandler 增 snooze（写 remind_at + 重置 reminded）
- [x] 4.2 helper：petState urgent 底态（抖动类）；DialogBox 钉住模式 + 60s 兜底 + 新提醒替换；动作条 UI（✔ 完成 → cmd done；⇨ 推迟 10 分钟 → cmd snooze）
- [x] 4.3 单测：snooze 写路径、deliver pet 通道、urgent 状态机；渲染层钉住/动作条交互

## 5. C2/C3 窗口行为配置

- [x] 5.1 helper 主进程：scale 感知的窗口三档尺寸（quickSize/chatSize/建窗）与 590 宽等比；置顶开关应用 + 看门狗条件化；opacity 下发
- [x] 5.2 渲染层：`--pet-scale` 根变量 + pet.css 绝对像素清扫（stage/气泡/菜单/快捷屏）；`.hit` 几何联动验证；精灵/气泡 opacity
- [x] 5.3 client 设置面：三组控件（置顶开关 / 缩放档 1-1.25-1.5-2 / 透明度 100-80-60，写共享键）；值域单源 optionSets
- [x] 5.4 单测：值域钳制 + 窗口尺寸换算纯函数

## 6. C4/C5/C6 视线跟随 / 位置找回 / 首启进度

- [x] 6.1 C4 光标跟随：wireHitToggle mousemove 方位 → look-left/right 方向化微动作（节流冷却 2.6s，演出/拖拽让路）
- [x] 6.2 C5 位置校验（placeWindow bounds 校验回落默认）+ rpc petResetPos（host 清 dsh:pet_pos + pet-event reset-pos → helper setPosition 默认位）+ 设置面按钮
- [x] 6.3 C6 electronGet 阶段/进度状态 + rpc petSetupProgress + 设置面行内进度（petStatus 行复用）
- [x] 6.4 单测：位置校验纯函数、进度状态机、rpc 面

## 7. 验收与收尾

- [x] 7.1 e2e-acceptance：两个能力各 Scenario ≥1 用例（helper 契约测试 + 渲染层 happy-dom 交互），raw 报告落 `openspec/changes/pet-parity-p1/reports/`
- [x] 7.2 lint-gate 三服务 + 质量棘轮 + 三包测试全绿
- [x] 7.3 文档同步：host/pet/README 缺口 4/5 收口；dsh-plugin/AGENTS.md 若有协议面描述则更新

## 8. P2 补充（2026-10-24 追加实施）

- [x] 8.1 TTS 触发面对齐桌面四类：helper 侧 prepareTtsText 归一 + runtime.speak（sys 路由内 tts.enabled 门控）；allDone 收工语音（完成仪式随行）、对话回答语音（chat-reply ok）、生日语音（渲染层台词时刻经 pet:speak IPC）
- [x] 8.2 mate 图鉴候选池：sys-config.pet.dexCaught（done 任务去重分类精灵）下发；helper 池 = 图鉴已捕捉（空集回退内置六只），排除当前精灵与主宝可梦
