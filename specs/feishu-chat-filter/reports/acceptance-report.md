# 用户场景验收报告（acceptance-report）

> 特性：飞书会话过滤偏好（免打扰降级为默认值，逐会话三态接管）。
> 版本基线：分支 `feat/feishu-chat-filter`（自 origin/main 5b2695b），2026-09-24 合并态验证。
> 验证方式：Playwright E2E（chromium，mock IPC）+ Rust/前端单元与集成测试全绿；截图见 `screenshots/`。

## 场景一：发现重要会话被免打扰「误杀」，手动拯救

**叙事**：用户在飞书给「重要项目群」设了免打扰（不想被通知打扰），但发现本应用的收音机里再也没有这个群的消息——因为旧版本免打扰会话整会话跳过。现在：打开 设置 → 集成 → 「会话过滤」卡片，在列表里找到该群，把三段选择器从「跟随」点为「拉取」。chip 立即变为「📡 拉取 · 手动」，摘要计数的手动数 +1，无需点「保存设置」（脚注明示立即生效）。下一轮拉取起该群消息恢复进入判重与 AI 判定管线；此后飞书侧再怎么改这个群的免打扰都不影响。

**证据**：
- E2E「三段切换」用例：乐观切换 → set 返回合并视图校正 → mock invoke 读回落库（`preference: always_pull, effective: pull, source: manual`）——[02-after-toggle.png](screenshots/02-after-toggle.png)
- Rust 集成测试 `pull_new_messages_applies_filter_prefs_and_snapshot`：免打扰 + always_pull 会话消息被拉取。
- SDD Gherkin「免打扰会话被设为总是拉取」/「单聊同样可设」→ 测试映射 ✅

## 场景二：屏蔽飞书侧没设免打扰的噪音群

**叙事**：某灌水群在飞书没设免打扰，但用户不想让它进收音机。会话过滤卡里设为「过滤」→ 下一轮起整会话跳过一条不拉；已入库的旧消息与待办保持原样（不追溯，自然衰减）。

**证据**：Rust 集成测试（未免打扰 + always_filter 整会话跳过）+ 组件测试；SDD Gherkin「未免打扰会话被设为总是过滤」/「总是过滤不追溯已生成待办」→ ✅

## 场景三：看清「哪些会话收得到、为什么」

**叙事**：打开卡片即见全部会话（含被过滤的）、每行双信息——三段选择器（我设置的）与生效 chip（下一轮实际会发生什么 + 依据：手动/跟随/降级）。摘要行常驻「以上一轮拉取为准（时间）」；点「被过滤」筛选 chip 只看收不到的会话；搜索框按名称过滤。免打扰查询失败的会话显示「📡 拉取 · 降级 ⚠」并带完整说明（title 鼠标通道 + sr-only/aria-describedby 键盘通道）。

**证据**：
- [01-card-overview.png](screenshots/01-card-overview.png)（全景含降级行）、[03-filtered-chip.png](screenshots/03-filtered-chip.png)（筛选）
- E2E 渲染用例：手动置顶排序、计数、降级标注三条断言。
- SDD Gherkin「查看所有会话的生效过滤状态」→ ✅

## 场景四：交还决策权 / 跟随飞书变化

**叙事**：手动设置过的会话，点回「跟随」即清除手动偏好，回到按飞书免打扰实时推导（飞书侧改动下一轮生效）；退群的会话从列表消失但偏好沉睡，重新入群后原偏好继续生效。

**证据**：`set_feishu_chat_filter_three_states_and_validation`（follow=删行）；`pull_new_messages_applies_filter_prefs_and_snapshot`（孤儿沉睡→复活三轮断言）；E2E 键盘 ArrowLeft 即选即写回 follow。SDD Gherkin「重置手动覆盖」「跟随态随飞书侧设置变化」「退群后会话隐藏、偏好沉睡后可复活」→ ✅

## 场景五：异常可预期

**叙事**：某轮免打扰查询部分批次失败——失败批的跟随态会话降级为不过滤（消息不丢，界面标「降级」），成功批照常按免打扰过滤；手动覆盖不受查询失败影响；拉取不中断。快照过旧（超过 max(5 分钟, 2.5×轮询间隔)）时摘要升级为 ⚠ 横幅并提供「立即拉取一次」。后台轮询与手动「立即拉取」并发由后端 in-flight 守卫兜底（第二轮直接返回「上一轮仍在进行」）。

**证据**：
- [04-stale-banner.png](screenshots/04-stale-banner.png)；Rust `pull_new_messages_applies_filter_prefs_and_snapshot`（按请求体选择性失败模拟分批部分失败）+ `poll_once_in_flight_guard_rejects_reentry_and_releases`。
- SDD Gherkin「免打扰查询部分批次失败时的逐会话降级」「手动覆盖不受查询失败影响」→ ✅

## 空态与边界

- 未启用轮询：引导文案指向上方启用开关（打开卡片零飞书 API 调用）。
- 已启用但从未成功拉取：`snapshotAt=null` → 「还没有拉取快照」+ 立即拉取按钮。
- 零会话账号：`snapshotAt≠null ∧ chats=[]` → 「上一轮拉取未发现会话」（与上一条数据面可区分，Rust 命令测试断言）。
- 480px 窄窗：行内折行、无横向滚动、命中区 ≥38px——[05-narrow-480.png](screenshots/05-narrow-480.png)。
- 隐私不回退：偏好/快照仅本地 SQLite，AI 路径（AiMessage 组装）不读不含（Rust 代码评审 + 测试覆盖面确认）；假名化既有链路未动。

## 验证矩阵（SDD Gherkin → 证据）

| SDD 场景组 | 证据层 |
|---|---|
| 三态 × 免打扰全组合（含手动抗查询失败） | Rust `filter_decision` 表驱动 + 假 lark-cli 集成 |
| 分批部分失败逐会话降级 | 假 lark-cli 按请求体选择性失败 |
| 孤儿沉睡/复活、不回补、不追溯 | Rust 集成测试（快照生命周期）+ set 命令测试 |
| 空态×4、降级标示、陈旧横幅、筛选/搜索/排序 | 组件测试 13 个 + E2E 5 个 |
| 键盘可达（roving tabindex）、aria 语义、三语键位 | 组件测试 + E2E 断言 + i18n 键位对齐测试 |
| 导出导入恢复偏好、旧备份兼容 | Rust export 测试 3 个 |

## 结论

用户验收场景全部有自动化证据覆盖，合并态门槛全绿（cargo 306 / vitest 176 / playwright chromium 26 / fmt / clippy / eslint / prettier / vue-tsc build）。剩余两个就地决策（会话名进 prompt 现状不收紧、「总是过滤」残留旧消息不清理）已按用户授权按文档决策生效。
