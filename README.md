# 🐾 宝可梦来敲门 (Pokemon Knock)

[![CI](https://github.com/Jo0OCTsai/pokemon-knock/actions/workflows/ci.yml/badge.svg)](https://github.com/Jo0OCTsai/pokemon-knock/actions/workflows/ci.yml)
[![Release](https://github.com/Jo0OCTsai/pokemon-knock/actions/workflows/release.yml/badge.svg)](https://github.com/Jo0OCTsai/pokemon-knock/actions/workflows/release.yml)

一只宝可梦桌宠，陪你捕捉每一天的待办。跨平台（macOS / Windows / Linux），本地优先，轻量常驻。

## 世界观

任务 = 野生宝可梦。每天从「冒险」出发，派出你的宝可梦去捕捉它们，沿「路线」逐站清任务，捕捉成功登录「图鉴」，飞书传来的待办线索则在「收音机」里等你收听。

- **冒险**——今天要完成的任务（进行中 + 今日到期）
- **草丛**——还没决定的野生宝可梦先待在这里
- **路线**——按日期规划的前进路线，逐站完成任务
- **图鉴**——已捕捉登录的成就记录
- **收音机**——从飞书电波里挑出新的待办

## 功能

### 桌宠（常驻桌面）
- 透明置顶小窗口，按任务分类轮换宝可梦（皮卡丘/可达鸭/妙蛙种子/吉利蛋/伊布/卡比兽，可换装），按住拖动、双击打开图鉴机
- **初代战斗布局**：精灵在上、对话框在下，右下角 ▼ 闪烁
- **专注模式**：全局唯一"进行中"任务常驻显示；⏸暂停 / ▶继续 / ✔完成 / ⇄切换 一键操作
- **番茄钟**：时长（15/25/45/60 分钟）、短休息（自动进入 ☕ 倒计时）、完成系统通知，全部可配置
- **点击精灵展开快捷图鉴屏**：LCD 屏今日列表，选中即「出发」，全程不用打开主窗口
- 撸宠反馈：点击有蹦跳动画和随机台词，开始任务喊「就决定是你了！」

### 图鉴机（主面板）
- 图鉴条目卡：条目编号、属性徽章（分类）、优先级圆点（紧急闪烁）、专注时长累计、今日捕捉进度条
- 分级提醒：普通 = 气泡 + 系统通知；紧急 = 桌宠抖动敲门。提醒调度在 Rust 后台，关掉面板不漏提醒
- 收音机：飞书消息 → AI 识别新待办/现有待办变更/跟进记录 → 逐条「◎ 捕捉 · 应用更新 / ✕ 逃走」，不强迫决策
- 设置中心：专注 / 分类（宝可梦换装）/ 标签 / 显示 / 集成 / 通用 六个分区
- 多语言：简体中文 / 繁體中文 / English，两窗口即时切换
- 日期时间格式、新任务默认值、开机自启（LaunchAgent / 注册表）

### 集成
- **AI Agent CLI**：收音机消息分类由本地 AI agent 命令行工具无头完成（Claude Code / OpenCode / Kiro CLI…），可配置多个、随时切换；调用历史由 agent 工具自带，设置页提供快捷入口
- **pk 命令行**：随应用分发的 `pk` CLI，供 AI agent 与终端直接读写待办（`pk task list` / `pk task get` / `pk context`…，全 JSON 输出）
- **飞书**：企业自建应用免公网回调，用户 OAuth 授权后以个人身份增量轮询私聊/群聊（无需拉机器人进会话），富文本渲染、按聊天语境过滤并附带同会话上下文送 AI
- **Todoist**：双向同步——远端拉取、本地非草丛任务推送、本地完成关闭远端任务

### 性能与稳定性
- Tauri 2 + Rust：常驻仅桌宠窗口，网络/同步在 tokio 后台任务，UI 卡死不影响提醒
- 本地优先：SQLite（WAL）存储，断网完全可用，外部服务失败自动重试
- 日志滚动记录于 `~/.local/share/com.joeca.pokemonknock/logs/`

## 开发

```bash
# Linux (WSL2) 首次需要系统依赖：
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

npm install
npm run tauri dev     # 开发调试
npm run tauri build   # 打包 (macOS: dmg / Windows: NSIS / Linux: deb·rpm·AppImage)
```

首次运行还需要中文字体（WSLg）：`~/.local/share/fonts` 放入 Noto Sans CJK 即可。

## 测试

```bash
npm run test:unit     # 前端单元测试（Vitest + Vue Test Utils，src/__tests__/）
npm run test:rust     # Rust 单元测试 + 前后端 JSON 契约测试（cargo test，含 SQLite 内存库）
npm run test:e2e      # 端到端 + 浏览器兼容性（Playwright，chromium / firefox / webkit 三引擎）
npm run test          # 单元 + Rust
```

- **单元测试**：前端覆盖设置存储/日期格式化、图鉴风组件、主面板与桌宠的状态机；Rust 侧用 Tauri mock 运行时 + 内存 SQLite 驱动真实命令函数（任务 CRUD、专注模式唯一 active、分类管理、提醒调度、AI/飞书/Todoist 纯逻辑）。
- **E2E**：Playwright 对 Vite dev server 跑两窗口核心流程，通过注入 `window.__TAURI_INTERNALS__` 模拟 Tauri IPC（`e2e/tauri-mock.ts`），不依赖打包后的桌面应用。
- **兼容性测试**：三语语言包键位/插值占位符对齐、精灵素材完整性、Rust serde ↔ TS 接口的 IPC 契约（字段增删会直接挂测试）、同一套 E2E 跑三大浏览器引擎。
- Linux 本地跑 webkit 引擎需先安装系统库：`sudo npx playwright install-deps webkit`；CI（`.github/workflows/ci.yml`）在 push/PR 时自动跑全部测试。

## 文档

- **[操作说明](docs/USER_GUIDE.md)**——安装、快速上手、飞书/AI/Todoist 对接教程、常见问题
- **[设计系统](design/DESIGN_SYSTEM.md)**——图鉴复古风的设计规范（色彩/字体/组件/动效）
- **[设计稿](design/mockup.html)**——高保真交互稿（本地打开）

## 目录结构

```
src/                    前端（Vue 3 + TS）
  App.vue               图鉴机主面板
  PetApp.vue            桌宠窗口（气泡/番茄钟/状态机/快捷图鉴屏）
  DexSelect.vue         图鉴风自绘下拉
  DexToggle.vue         图鉴风开关（ON/OFF 或自定义文案）
  DexDateTime.vue       图鉴风日期时间选择器
  settings.ts           共享设置存储 + 日期时间格式化
  i18n/                 三语语言包（zh-Hans / zh-Hant / en）
  __tests__/            前端单元测试 + i18n/素材兼容性测试（Vitest）
e2e/                    端到端测试（Playwright + Tauri IPC mock）
src-tauri/src/
  db.rs                 SQLite 初始化 + 版本迁移 + 默认分类
  commands/             任务 CRUD / 专注模式 / 分类管理 / 集成命令（conn 层供 pk CLI 复用）
  bin/pk.rs             pk 命令行：供 AI agent 与终端读写待办（JSON 输出）
  scheduler.rs          提醒调度（提前量、通知开关、多语言通知）
  feishu.rs             飞书用户授权（OAuth）+ 用户身份增量轮询 + 富文本渲染
  ai.rs                 AI agent CLI 无头调用（多 Agent 配置 / 超时 / 输出解析）
  todoist.rs            Todoist 双向同步
                        （各文件内 #[cfg(test)] 为 Rust 单元测试与契约测试）
public/pokemon/         宝可梦素材 (PokeAPI sprites)
```

## 发布

推 `v*` 标签触发 GitHub Actions：macOS 出 Intel + Apple Silicon 双架构 dmg，Windows 出 NSIS 安装包，Linux 出 deb / rpm / AppImage，自动建草稿 Release。

> **Linux 已知限制（实验性支持）**：桌宠的透明置顶窗口在 X11 下正常；Wayland 下置顶不可靠。NVIDIA 显卡若出现白屏/黑块，启动前设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1`。

## 版权说明

宝可梦形象版权归 Nintendo / Game Freak / Creatures，本项目及素材（[PokeAPI](https://github.com/PokeAPI/sprites)）仅供个人学习使用，请勿商用。
