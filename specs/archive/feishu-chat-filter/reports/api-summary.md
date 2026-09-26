# 接口测试总结（api-summary）

> 数据源：`reports/raw/cargo-test.log`（2026-09-24 合并态最终跑）与 `reports/raw/vitest.log`。本文只做解读，不引入新数据。

## 总览

| 套件 | 结果 |
|------|------|
| Rust `cargo test`（lib + pk CLI） | **306 通过 / 0 失败**（lib 282 + pk 24） |
| 前端 `vitest` | **176 通过 / 0 失败**（20 个测试文件） |
| 机械质量 | cargo fmt --check 干净；clippy `-D warnings` 零警告；eslint / prettier 全过 |

本特性新增接口/契约层测试 17 个（Rust 侧 14 + 前端事件契约同步覆盖），全部绿。

## 新增契约面验证（Tauri command）

| 测试（cargo-test.log） | 验证点 |
|---|---|
| `commands::integrations::feishu_chat_filter_overview_merges_and_counts` | `get_feishu_chat_filter_overview` 返回 camelCase 视图、三态解析、`effective/source` 派生（含 followDegraded）、counts 汇总 |
| `commands::integrations::feishu_chat_filter_overview_empty_states_distinguishable` | 两种空态数据面可区分：无 `feishu_snapshot_at` 键 → `snapshotAt=null`；有键空表 → `snapshotAt≠null` |
| `commands::integrations::set_feishu_chat_filter_three_states_and_validation` | follow=删行 / 覆盖态=UPSERT / 返回该行合并视图 / chatId 空串与超长、preference 非法 → `AppError::Invalid` / 沉睡行视图（名称/类型/updatedAt 空串） |
| `commands::integrations::set_feishu_chat_filter_broadcasts_once` | MockRuntime 捕获：set 成功后恰广播一次 `feishu-chat-filter-changed` |

## 拉取管线（假 lark-cli 集成）

| 测试 | 验证点 |
|---|---|
| `feishu::filter_decision_covers_pref_x_outcome_matrix` | 决策纯函数 3 preference × 3 outcome 全组合（AD §3.1 优先级表） |
| `feishu::filter_enum_str_values_match_contract` | 枚举序列化字面值与 AD §4 契约一致（followDegraded 驼峰等） |
| `feishu::pull_new_messages_applies_filter_prefs_and_snapshot` | 全链路：手动偏好优先于免打扰、失败批降级（unknown）不过滤、快照含被过滤会话与零会话轮推进时间戳键、批次成功缺项归 unmuted、孤儿沉睡→复活 |
| `feishu::pull_new_messages_applies_chat_type_rules`（既有） | `muted_chat_ids`→`chat_mute_outcomes` 重构后**行为不变回归**，原断言全绿 |
| `feishu::write_chat_snapshot_replaces_table_and_advances_timestamp` | 快照单事务整表替换 + `feishu_snapshot_at` UPSERT |
| `feishu::poll_once_in_flight_guard_rejects_reentry_and_releases` | 并发重入被拒（冲突错误、子进程调用不翻倍）、错误路径释放后可再执行 |

## 持久化与导入导出

| 测试 | 验证点 |
|---|---|
| `db::baseline_creates_chat_filter_tables_with_checks` | SCHEMA_V1 基线建出 `chat_filter_prefs` / `feishu_chats`，CHECK 拒绝非法枚举值 |
| `commands::export::chat_filter_prefs_roundtrip_and_feishu_chats_excluded` | 偏好表导出导入往返；`feishu_chats` 派生缓存不导出 |
| `commands::export::import_tolerates_legacy_backup_without_filter_prefs` | 旧格式备份（缺新表键）可导入为空（向后兼容） |
| `commands::export::import_json_broadcasts_filter_changed` | 导入成功后广播 `feishu-chat-filter-changed` |

## 前端契约对齐

- `src/__tests__/events.spec.ts`：`feishu-chat-filter-changed` 与 Rust `events.rs` 硬编码 JSON 数组三处一致（两侧契约测试锁定，漏一侧即红）。
- `FeishuChatFilterManager.spec.ts` 13 个组件测试覆盖 api 调用面（加载/三态写入/回滚），见 e2e-summary 的组件层与 E2E 层验证。

## 备注

- 轮询侧 emit（`poll_once_inner`，每轮快照提交后无条件广播）依赖完整轮次与 AI 配置，按 AD §8 注记由时序约定与代码评审覆盖，未单测驱动。
- SCHEMA_V1 基线追加对 `user_version=1` 的存量本地调试库不生效——开发者本地库需手动执行两条 CREATE（幂等）；测试全部走内存库不受影响。
