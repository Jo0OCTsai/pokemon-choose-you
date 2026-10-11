# storage/ —— 连接与迁移（AD §3.1「db/」）

`node:sqlite` 连接生命周期（`CHOOSE_YOU_HOME` 归一化根解析，与主应用 `db.rs` 同规则）、
`PRAGMA journal_mode=WAL; busy_timeout=5000`、guarded 迁移（§5.3，封顶 minSchema A19）、
`BEGIN IMMEDIATE` 写事务助手——全插件唯一握连接的模块（并行组 1 任务 3，A1 实测见
`docs/compatibility.md`）。
