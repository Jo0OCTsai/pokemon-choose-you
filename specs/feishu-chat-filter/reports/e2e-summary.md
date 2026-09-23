# E2E 测试总结（e2e-summary）

> 数据源：`reports/raw/playwright-chromium.log`（2026-09-24 合并态最终跑，chromium 工程）。

## 总览

- **chromium：26 通过 / 0 失败**（全套件，含本特性新增 5 个）。
- 浏览器工程 firefox / webkit 由 CI 矩阵覆盖（本地门槛为 chromium，与项目 CI 前一致）。
- 全部经 `e2e/tauri-mock.ts` 注入 IPC mock（无真实飞书网络调用）；mock 的 `get_feishu_chat_filter_overview` / `set_feishu_chat_filter` 合并规则**镜像 Rust `filter_decision`**，set 后广播事件，与后端语义一致。

## 本特性新增（e2e/feishu-chat-filter.spec.ts，5 个）

| 用例 | 验证点 | 截图 |
|---|---|---|
| 飞书卡下方渲染会话过滤卡 | 位置（飞书配置卡正下方）、手动置顶排序、摘要计数「共 3 个会话：2 拉取 · 1 过滤 · 手动 1」、新鲜时间戳、降级行 warn chip + sr-only 说明 + `aria-describedby` 键盘可达 | `screenshots/01-card-overview.png` |
| 三段切换：乐观 + 落库 | radiogroup aria-label、roving tabindex（仅选中段 Tab 停点）、点击「拉取」乐观切换 + mock set 返回合并视图校正 chip/计数、经 mock invoke 读回落库断言、ArrowLeft 即选即写（与点击同路径） | `screenshots/02-after-toggle.png` |
| 筛选 chips 与搜索本地过滤 | 「被过滤」档过滤（aria-pressed）、摘要保持全量统计、搜索叠加命中 0 行空态文案、清空恢复 | `screenshots/03-filtered-chip.png` |
| 陈旧横幅 | 快照拨回 30 分钟（默认 2 分钟档阈值 5 分钟）→ ⚠ warn 横幅「距上一轮拉取已…」 | `screenshots/04-stale-banner.png` |
| 任何宽度不出现横向滚动 | 480px 窄窗行内折行、`scrollWidth ≤ clientWidth`（html 与卡片双作用域）、名称 ellipsis | `screenshots/05-narrow-480.png` |

## 既有套件回归

- `main-panel.spec.ts` / `settings-tags.spec.ts` 等全量 21 个既有用例全绿——设置页新增卡片未破坏既有布局与交互。

## 已知边界

- E2E 的 IPC mock 与 Rust 实现是**镜像关系**（合并规则双写）：漂移由 Rust 侧 mock_app 命令测试 + 前端事件契约测试在单元层锁定，E2E 锁定的是交互行为与视觉结果。
