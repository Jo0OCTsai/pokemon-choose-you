# anonymize/ —— 假名化与还原（AD §3.1）

`AnonRules` 等价实现——同表 `feishu_users.alias` 懒分配/碰撞探测/长名优先/还原，与 Rust 行为逐
fixtures 对齐（含「群名不脱敏」现行设计，D17/A12；别名断言参数化 A18）（并行组 1 任务 2，TDD）。
