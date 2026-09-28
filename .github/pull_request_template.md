## 改动说明

<!-- 做了什么、为什么这么做；关联 issue 用 Fixes #123 -->

## 自查清单

- [ ] `pnpm lint` 与 `pnpm format:check` 通过
- [ ] `pnpm test:unit` 通过（涉及 IPC 载荷/事件名/TS 接口时同步更新契约测试）
- [ ] `pnpm test:rust` 通过（涉及 ai agent 调用或 feishu 拉取时补假 CLI 脚本测试）
- [ ] 覆盖率不回退：`pnpm test:coverage` 与 `pnpm test:rust:coverage` 通过（新增代码有测试覆盖；CI 与质量棘轮双重守门）
- [ ] 涉及数据库结构：在 `db.rs` 的 `MIGRATIONS` **追加**新迁移条目
- [ ] 涉及新事件：`src-tauri/src/events.rs` 与 `src/events.ts` 两侧同步
- [ ] 涉及 UI：截图/录屏附上
