# 开发指南

面向开发者的环境搭建、常用命令、测试与发布流程。安装与日常使用见 [操作说明](USER_GUIDE.md)；提交规范与贡献流程见 [贡献指南](../CONTRIBUTING.md)；跨平台已知坑位见 [平台注意事项](PLATFORM_NOTES.md)。

技术栈 Tauri 2 + Vue 3 + Rust：常驻仅桌宠窗口，网络/同步跑在 tokio 后台任务，UI 卡死不影响提醒；数据为 SQLite（WAL）本地存储，日志滚动记录于 `~/.local/share/com.joeca.pokemonchooseyou/logs/`。

## 环境搭建

```bash
# Linux (WSL2) 首次需要系统依赖：
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

npm install
npm run tauri dev     # 开发调试
npm run tauri build   # 打包 (macOS: dmg / Windows: NSIS / Linux: deb·rpm·AppImage)
```

首次运行还需要中文字体（WSLg）：`~/.local/share/fonts` 放入 Noto Sans CJK 即可；NVIDIA 显卡白屏/黑块等平台坑位见 [平台注意事项](PLATFORM_NOTES.md)。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 仅前端（浏览器里无 Tauri IPC，需 E2E mock） |
| `npm run tauri dev` | 完整桌面应用开发调试 |
| `npm run lint` / `npm run lint:fix` | ESLint（Vue + TS flat config） |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test:unit` | Vitest 单元测试（`src/__tests__/`） |
| `npm run test:rust` | cargo test（单元 + serde↔TS 契约 + wiremock HTTP 集成） |
| `npm run test:e2e` | Playwright 三引擎（chromium / firefox / webkit） |
| `npm run clippy` | cargo clippy `-D warnings` |
| `npm run test` | 单元 + Rust 全套 |

## 测试

- **单元测试**：前端覆盖设置存储/日期格式化、图鉴风组件、主面板与桌宠的状态机；Rust 侧用 Tauri mock 运行时 + 内存 SQLite 驱动真实命令函数（任务 CRUD、专注模式唯一 active、分类管理、提醒调度、AI/飞书/Todoist 纯逻辑）。
- **E2E**：Playwright 对 Vite dev server 跑两窗口核心流程，通过注入 `window.__TAURI_INTERNALS__` 模拟 Tauri IPC（`e2e/tauri-mock.ts`），不依赖打包后的桌面应用。
- **兼容性测试**：三语语言包键位/插值占位符对齐、精灵素材完整性、Rust serde ↔ TS 接口的 IPC 契约（字段增删会直接挂测试）、同一套 E2E 跑三大浏览器引擎。
- Linux 本地跑 webkit 引擎需先安装系统库：`sudo npx playwright install-deps webkit`；CI（`.github/workflows/ci.yml`）在 push/PR 时自动跑全部测试。

## 目录结构

```
src/                    前端（Vue 3 + TS + Pinia）
  App.vue               图鉴机主面板
  PetApp.vue            桌宠窗口（气泡/番茄钟/状态机/快捷图鉴屏）
  components/           图鉴风自绘组件（DexSelect / DexToggle / DexDateTime / TaskCard…）
  views/                主面板分页（TaskTab / RadioTab / SettingsTab）
  stores/               Pinia 状态（settings / tasks / categories / tags）
  composables/          usePomodoro（番茄钟状态机）/ usePetDrag（手动拖拽）
  api.ts                IPC 封装 + 错误分层
  events.ts             前后端事件名契约（与 src-tauri/src/events.rs 成对）
  i18n/                 三语语言包（zh-Hans / zh-Hant / en）
  __tests__/            前端单元测试 + i18n/素材兼容性测试（Vitest）
e2e/                    端到端测试（Playwright + Tauri IPC mock）
src-tauri/src/
  db.rs                 SQLite 初始化 + 版本迁移 + 默认分类
  commands/             IPC 命令按域拆分：tasks / categories / tags / settings /
                        integrations / radio / diagnostics / windows（conn 层供 pk CLI 复用）
  bin/pk.rs             pk 命令行：供 AI agent 与终端读写待办（JSON 输出）
  scheduler.rs          提醒调度（提前量、通知开关、多语言通知）
  feishu.rs             飞书用户授权（OAuth）+ 用户身份增量轮询 + 富文本渲染
  ai.rs                 AI agent CLI 无头调用（多 Agent 配置 / 超时 / 输出解析）
  todoist.rs            Todoist 双向同步
  health.rs             集成链路健康状态（诊断中心）
                        （各文件内 #[cfg(test)] 为 Rust 单元测试与契约测试）
public/pokemon/         宝可梦素材 (PokeAPI sprites)
```

## 发布

1. 合并到 `main` 后 [release-please](https://github.com/googleapis/release-please) 自动开/更新 release PR（版本号同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）。
2. 合并 release PR → 推 `v*` 标签 → 触发 `release.yml`：tauri-action 出 macOS（Intel + Apple Silicon 双架构 dmg）/ Windows（NSIS）/ Linux（deb / rpm / AppImage）安装包，自动建草稿 Release，并产出 `latest.json`（自动更新清单）。

### 自动更新签名（维护者）

自动更新走 minisign 签名，**签名不可关闭**：

```bash
npx tauri signer generate -w ~/.tauri/pokemon-choose-you.key   # 私钥务必保存在仓库外
```

- 公钥已内联在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 仓库 Secrets 需配置：`TAURI_SIGNING_PRIVATE_KEY`（私钥内容）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（生成时设置的密码，空密码则设为空串）。
- 更新端点指向 GitHub Release 的 `latest.json`；换仓库/迁移时记得同步修改 `plugins.updater.endpoints`。

> **Linux 已知限制（实验性支持）**：桌宠的透明置顶窗口在 X11 下正常；Wayland 下置顶不可靠。NVIDIA 显卡若出现白屏/黑块，启动前设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1`。详见 [平台注意事项](PLATFORM_NOTES.md)。
