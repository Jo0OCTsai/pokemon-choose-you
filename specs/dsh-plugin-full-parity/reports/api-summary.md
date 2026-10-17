# 接口测试总结（api-summary）

> 数据源 = `reports/raw/junit-*.xml`（机器产物，本文件只做导航与结论）。重跑口径见各节。

## 结论：全绿，可交付

| 套件 | junit | 用例 | 失败 | 重跑命令 |
|---|---|---|---|---|
| dsh-plugin（host+client 全量 vitest，含契约回放 59 场景） | `raw/junit-dsh-plugin.xml` | **1263**（+2 skipped = 无 ssh 别名环境的真链门控用例） | 0 | `pnpm --filter dsh-plugin test` |
| dsh-plugin-helper（桥协议 + sys 模块 + 行为纯函数） | `raw/junit-dsh-helper.xml` | 183 | 0 | `pnpm --filter dsh-plugin-helper test` |
| src-tauri（桌面 P1–P4 + 契约 oracle） | `raw/junit-src-tauri.xml` | **394** | 0 | `cd src-tauri && cargo test` |

## 契约面（FR-X3）

- 契约回放套件扩至 **59 场景**（原 43 + reminder 8 + streak 6）：Rust oracle（桌面 scheduler.rs / streak_conn 纯函数抽取，只抽取不改行为）生成 fixtures，TS 侧逐字段回放全绿——桌面提醒语义 100% 对齐由夹具锁定（NFR-10）。
- 新增 op（PROTOCOL §5 只追加）：`reminder_tick` / `reminder_claim` / `streak_eval`；streak_eval 用显式入参（doneDays/today/todayCount）防夹具跨时区漂移。
- 错误码 15 → **21**（PROTOCOL §2 只追加 6 枚：DEPLOYMENT_NOT_READY / PROVISION_STEP_FAILED / HELPER_HASH_MISMATCH / HELPER_CAPABILITY_MISSING / IMPORT_VALIDATION_FAILED / BACKUP_FAILED）；命令面 69 → **86**（AD §4.1 表 16 条 + macAuthPaneOpen 联调对齐 1 条；原 87——**taskCreate 已于 2026-10-17 移除**，用户裁决「完全不需要」，FR-C1 回流），`HOST_COMMAND_NAMES` 单源断言绿。

## 关键覆盖点（失败注入类用例均有）

- CAS 仲裁：双连接 reminded 抢占让位（契约 `reminder/dedup-cas-single-delivery` 双连接场景）+ 桌面侧双线程竞态回归测试（P2，先红后绿）。
- 导入/恢复危险流：结构校验整体拒绝（0 行变更）、前置备份失败中止、超窗拒绝、白名单拒路径分隔符（backup-import/restore 24 用例）。
- 远程域：摘要不符拒绝就绪（degraded 恒 false）、幂等重跑零重发、引号全量引用静态断言（NFR-11④）、凭据零存储键集白名单断言。
- 桥协议：双版本兼容矩阵（旧 hello 全门控、未知消息丢弃计错、seq ack 10s 超时降级 / result 长超时 / cancel 迟到丢弃、sys-unsupported 每类型节流）。
- 装配层：reminder loop 全链（fake timer：到期→送达→去重→勿扰→降级→补看面）、backupLoop 跨天/条件写键/自愈。

## 说明

- 桌面前端（vitest 294 用例）未动，不在本次产物面；供应链四件套见验收报告。
- junit 生成时点：2026-10-17 终态（provision 直连传输修复落地后重跑覆盖）。
