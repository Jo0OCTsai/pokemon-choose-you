# Changelog

所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
本文件由 release-please 自动维护——合并 release PR 时更新，请勿手工编辑已发布段落。

## [Unreleased]

### Added

- **常驻应用标配**：系统托盘（打开图鉴机 / 显示隐藏桌宠 / 设置 / 检查更新 / 退出）、单实例保护、窗口位置记忆、全局快捷键（`Ctrl/Cmd+Shift+K` 快速捕捉待办、`Ctrl/Cmd+Shift+D` 显示/隐藏桌宠）、自动更新（minisign 签名，托盘与设置页入口）。
- **工程链**：ESLint（flat）+ Prettier + lefthook + commitlint + release-please + Renovate；CI 增加 clippy/fmt/lint 关卡。
- **架构补强**：命令统一 `AppError`（kind/retryable，前端 api.ts 分层捕获）；SQLite 启用 `PRAGMA user_version` 迁移；事件名前后端契约测试；wiremock 覆盖 AI/飞书/Todoist 的 HTTP 分支。
- **目录重构**：前端拆出 `components/ views/ stores(Pinia)/composables/`；后端 `commands/` 按域拆分。
- **安全合规**：LICENSE（代码 MIT + 素材非商用声明）、CSP、capabilities 按窗口最小权限、`.zcode/` 出库。

### Fixed

- Todoist 同步两个生产缺陷：`ON CONFLICT(external_id)` 未匹配部分唯一索引导致拉取必然失败；关闭远端任务的 SQL 误用 `sync_state.value` 列名（实际为 `cursor`）。
- 远端关闭任务时非 2xx 响应不再计入成功计数。

## 0.1.0 — 2026-09

首个可用版本：桌宠 + 图鉴机两窗口、任务 CRUD 与专注模式、番茄钟、分级提醒、飞书 AI 收音机、Todoist 双向同步、三语界面、跨平台打包。
