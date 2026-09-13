# 贡献指南

感谢有意向「就决定是你了」贡献！这是一个 Tauri 2 + Vue 3 + Rust 的桌宠待办应用。

## 快速开始

```bash
git clone https://github.com/Jo0OCTsai/pokemon-choose-you.git
cd pokemon-choose-you
```

环境搭建（系统依赖、中文字体、lefthook hooks）、常用命令（lint / format / 测试 / clippy）与目录结构见 [开发指南](docs/DEVELOPMENT.md)。

## 提交规范

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)（commitlint 强制校验）：`feat: 新增随机捕捉掉落`、`fix(db): 修复游标列名` 等。
- pre-commit 钩子（lefthook）会自动对暂存文件跑 Prettier/ESLint/cargo fmt。
- PR 请保持聚焦：一个 PR 解决一件事，并附上测试。

## 架构速览

```
src/                    前端（Vue 3 + TS + Pinia）
  components/           图鉴风自绘组件（DexSelect / TaskCard / AddTaskForm…）
  views/                App.vue 拆出的页（TaskTab / RadioTab / SettingsTab）
  stores/               Pinia：settings / tasks / categories
  composables/          usePomodoro（番茄钟状态机）/ usePetDrag（手动拖拽）
  events.ts             前后端事件名契约（与 src-tauri/src/events.rs 成对）
  api.ts                IPC 封装 + ApiError 错误分层
src-tauri/src/
  commands/             IPC 命令按域拆分：tasks / categories / settings / integrations / windows
  error.rs              AppError（thiserror + serde，前端按 kind/retryable 分层）
  events.rs             事件名集中定义 + 契约测试
  db.rs                 SQLite + PRAGMA user_version 迁移（改表加新迁移条目，勿改旧条目）
  tray.rs / shortcuts.rs 托盘菜单 / 全局快捷键
  ai.rs / feishu.rs / todoist.rs / scheduler.rs
```

几条不成文约定：

- **契约靠测试锁死**：Rust serde ↔ TS 接口（`models.rs`/`types.ts`）、事件名（`events.rs`/`events.ts`）、i18n 三语键位，各有一对测试防漂移，改动时两侧同步。
- **schema 变更走迁移**：在 `db.rs` 的 `MIGRATIONS` 追加新条目（只追加不修改），`user_version` 会自动前滚。
- **HTTP 分支必须 wiremock 覆盖**：ai/feishu/todoist 的 reqwest 路径用 mock 服务器写集成测试（此前缺覆盖导致 Todoist 同步两个 bug 长期未被发现）。
- **写数据的命令必须广播对应事件**：主面板与桌宠靠 `events.rs` 里的变更事件保持两窗口一致，忘了广播就是"另一窗口不刷新"的 bug。

## 版权红线 ⚠️

宝可梦形象版权归 Nintendo / Game Freak / Creatures，项目现有素材来自 PokeAPI（CC BY-NC-SA，**非商用**）。
**不要提交任何新的官方宝可梦素材**（图鉴图、动画帧、音频、游戏文本原文等）。需要新精灵时使用 PokeAPI sprites 已有资源，或引导用户自行放置素材文件。

## 发布流程

开发版草稿发布流（手动版本号 + 草稿自动构建 + publish 转正）、多平台构建与自动更新签名（维护者）见 [开发指南 · 发布](docs/DEVELOPMENT.md#发布)。

## 平台注意事项

Linux（WebKitGTK/NVIDIA/Wayland）、macOS（Accessory 模式）等已知坑位汇总在 [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md)，动窗口/托盘/快捷键相关代码前建议先读一遍。
