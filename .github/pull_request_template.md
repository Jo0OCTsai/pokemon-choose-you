## 改动说明

<!-- 做了什么、为什么这么做；关联 issue 用 Fixes #123 -->

## 自查清单

- [ ] `npm run lint` 与 `npm run format:check` 通过
- [ ] `npm run test:unit` 通过（涉及 IPC 载荷/事件名/TS 接口时同步更新契约测试）
- [ ] `npm run test:rust` 通过（涉及 ai/feishu/todoist HTTP 分支时补 wiremock 集成测试）
- [ ] 涉及数据库结构：在 `db.rs` 的 `MIGRATIONS` **追加**新迁移条目
- [ ] 涉及新事件：`src-tauri/src/events.rs` 与 `src/events.ts` 两侧同步
- [ ] 涉及 UI：截图/录屏附上
