# E2E 测试总结 — dsh-plugin（dsh 插件形态）

> 原始数据：`raw/playwright-report/`（Playwright HTML 报告，chromium + firefox 全量）、
> `raw/junit-*.xml`（分层替身集成测试并入 dsh-plugin junit）——机器产出，勿手改。
> 服务 commit：HEAD `777bde2`（feat/dsh-plugin）。
> 结论：✅ 可交付——**chromium+firefox 82/82 全绿**；本机 WebKit 运行时段错误为环境问题（见 §3，非回归）。

## 1. E2E 形态（AD §7.3 / A10）

本特性 E2E = **分层替身**四层，真实 dsh 宿主内冒烟为手动验收项（A10，见 acceptance-report §4）：

| 层 | 形态 | 结果 |
|---|---|---|
| ① 客户端组件 | React Testing Library + happy-dom（111 用例） | ✅ 并入 `junit-dsh-plugin.xml` |
| ② 宿主半边集成 | 伪 ctx（fake timer/lark/执行器）驱动 `createPlugin` 真实装配 + 真实临时 SQLite（6 链路） | ✅ 并入 `junit-dsh-plugin.xml`（integration.spec） |
| ③ helper 桥协议 | fake host / fake helper 子进程走**真 stdio JSON 行**（含 headless 集成：spawn 真入口、宿主死亡 10s SLA 自杀） | ✅ `junit-dsh-helper.xml`（64 用例） |
| ④ 主应用 Playwright | FR-X4 回归（插件同库写入口径下主应用行为一致；本特性主应用界面零改动） | ✅ `raw/playwright-report/`（82/82） |

## 2. 主应用 Playwright 回归（FR-X4）

- 全量 `pnpm test:e2e --project=chromium --project=firefox`：**82 passed / 0 failed / 2 skipped**（25.1s）。
- 覆盖面与 main 基线一致：任务面板流转、收音机分诊、设置八分区（含标签与项目派发 8 条）、专注/桌宠、诊断等——证明本分支主应用侧改动（schema 002 迁移、判定 claim、分诊 CAS、槽表、变更侦听、busy_timeout）对单形态用户行为无可感变化（AD §7.1 口径：新守卫单形态下恒真；条目 7 能力新增、条目 9 行为修正均不触发 E2E 断言变化）。

## 3. 本机 WebKit 环境问题（非回归，如实记录）

- 全量首跑（chromium+firefox+webkit）：82 passed + **8 failed（全部 webkit `settings-tags.spec.ts`）** + 4 skipped。
- 失败根因：WebKit 浏览器二进制 **launch 即 `Segmentation fault: 11`**（`browserContext.newPage: browser has been closed`，无任何页面交互发生）；`playwright install webkit` 重装后复跑仍段错误——本机 macOS 25.0 (arm64) 与 webkit-2359 的环境不兼容。
- 反证：同 spec chromium **8/8 全过**（2.7s），firefox 全量绿——应用逻辑无回归；CI（Linux runner）将作最终裁决。
- 处置：记录为环境债务（不在本分支修——与 dsh 形态无关；重装 Playwright webkit 或升级 macOS 兼容包后自愈）。

## 4. dsh 形态特有的链路级 E2E（②层细节，integration.spec.ts 六链路）

1. 冷启动：`createPlugin` → guarded 迁移至 v2 + 种子（含 `ai_agent_presets_v2` 标记位）。
2. 快捕闭环：CaptureBar 语义（captureTodo）→ fake subagent 判定 → 分诊建任务（source=capture）。
3. 桌宠联动：出发任务 → **fake helper 子进程（真 stdio）收到 task-state**（activeTask+badge）。
4. 自动派发：扫描 → 无头执行（fake 执行器）→ 回传收口 done + 槽释放 + agent_sessions 落账。
5. 配置双形态：configWrite → 共享库读回（键值面等效）。
6. 通道与防呆：pageOpen 订阅推送；未注入 spawner 时桌宠装配显式报错（不静默半工作，NFR-3）。
