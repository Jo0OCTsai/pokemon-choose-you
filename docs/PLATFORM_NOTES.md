# 平台注意事项（坑位速查）

跨平台桌宠应用的现实约束集中在这里，改动窗口/托盘/快捷键/更新器相关代码前请先确认本页内容仍然成立。

## Linux

- **NVIDIA + WebKitGTK 白屏/黑块**：启动前设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1`（环境变量或桌面启动器里注入）。
- **Wayland 下 always-on-top 不可靠**：这是 Wayland 协议层面不允许客户端自行置顶，非 Tauri bug；X11 下正常。发行说明里标注"实验性支持"。
- **主窗口"销毁重建"路径**：WSLg/Wayland 上最小化状态在应用侧失真、客户端无法自行激活窗口，`open_main_window` 在 Linux 统一走销毁重建（见 `commands/windows.rs`）。依赖"主窗口存在"的功能（快捷键快速捕捉等）要用挂起标记让新窗口挂载后补领，不能只靠 emit 事件。
- **手动拖拽**：`data-tauri-drag-region` 在 WebKitGTK 下不可靠，桌宠用手动 `startDragging`（`usePetDrag`），移动超过 4px 阈值才算拖拽，避免吞掉点击。
- **托盘**：需要 `libayatana-appindicator`（CI 与文档的系统依赖清单里已包含）。

## macOS

- **透明窗口**：必须同时 `app.macOSPrivateApi = true`（tauri.conf.json）与 Cargo feature `macos-private-api`，缺一不可。
- **不占 Dock 图标**：应用以 `ActivationPolicy::Accessory` 运行（桌宠型应用惯例），入口收敛到托盘与全局快捷键；主窗口从托盘菜单 / 双击桌宠 / ⌘⇧K 唤起。
- **自动更新**：dmg 目标的 updater 走 zip 产物，release 流水线由 tauri-action 处理；签名密钥见 CONTRIBUTING。

## Windows

- **IPC 走 `http://ipc.localhost`**：CSP 的 `connect-src` 已放行 `ipc: http://ipc.localhost`，收紧 CSP 时不要删掉。
- **NSIS 安装包**：`tauri build` 产出；更新器会下载新 NSIS 包并静默安装后重启。

## 通用

- **CSP**：非 null。图片允许 `asset:`/`data:`，样式允许 `'unsafe-inline'`（Vue 运行时注入）与 Google Fonts（Press Start 2P 像素字体，离线时回退系统字体），`connect-src` 放行 IPC 与 dev-server HMR（`ws://localhost:1420`）。
- **窗口状态记忆**：window-state 插件只记 **位置** 不记尺寸——桌宠快捷屏展开时会把透明窗口临时调高，记忆尺寸会把透明空区带到下次启动挡住点击。
- **单实例**：tauri-plugin-single-instance 必须最先注册；二次启动唤起已有实例主窗口后退出，避免两只桌宠与 SQLite 争抢。
- **E2E 的浏览器矩阵**：Playwright 注入 `window.__TAURI_INTERNALS__` 模拟 IPC（`e2e/tauri-mock.ts`）。注意 mock 的读取命令必须返回**深拷贝**（真实 IPC 每次返回反序列化新对象；返回同引用会让子组件 props 更新被 Vue 跳过）。
