# dsh-plugin-helper —— 桌宠 Electron helper 子包

> specs/dsh-plugin AD §3.3（并行组 2）。sidecar Electron helper：透明置顶局部小窗（300×330，
> **禁止全屏透明画布**——Windows DWM 视频合成黑屏坑位）+ stdio JSON 行桥 + 宿主存亡绑定。
> **不依赖 dsh 运行时**——由插件宿主半边 `pet/`（并行组 1 后续任务）spawn。

## 版权声明（NFR-9）

本 helper 分发的精灵素材来自 **PokeAPI/sprites**
（https://github.com/PokeAPI/sprites ，PokeAPI 项目对宝可梦图形素材不主张版权，版权归
Nintendo / Creatures Inc. / GAME FREAK inc.；PokeAPI 素材库依其仓库声明分发）：

- 内置精灵（断网可用）：复用主应用 `public/pokemon/` 分发口径（pikachu / psyduck /
  bulbasaur / chansey / eevee / snorlax 共 6 只，构建期由 `build.mjs` 拷贝进 `dist/renderer/pokemon/`）；
- 非内置精灵：按候选链从 PokeAPI sprites CDN 加载（`sprites` 桥消息的 `cdnBase` 指定入口）；
- 双缺（非内置且 CDN 不可达）回退主宝可梦占位 + 单次「素材缺失」气泡（AD §3.3 A20）；
- 全量图鉴 key→id 映射：构建期拷贝主应用 `src/pokemon/catalog.json`
  （由 `scripts/gen-pokemon-catalog.mjs` 从 PokeAPI 生成）。

再分发口径：v1 仅本地路径/file 安装（自用）；npm 公开发布另行裁决（AD A9）。

## 运行形态

| 形态                      | 入口                                  | 说明                                                                        |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Electron 窗体（开发机）   | `pnpm --filter dsh-plugin-helper dev` | 本地 devDep electron 跑真窗体；参数 `--host-pid=<pid>` `--pos=<x>,<y>`      |
| headless（CI/无显示环境） | `HELPER_HEADLESS=1 node src/main.ts`  | 跳过一切 BrowserWindow/Electron 创建，只跑桥/状态机（Node 24 原生执行 .ts） |
| 生产（插件宿主 spawn）    | `dist/main.js`                        | Electron 运行时由插件侧探测下载 `~/.dsh/electron/`（本包不打包运行时）      |

## 桥协议（stdio JSON 行，每行一个 JSON 对象）

- 下行（插件 → helper）：`task-state` / `pomodoro-config` / `lang` / `sprites` / `heartbeat`；
- 上行（helper → 插件）：`cmd`（9 op 枚举）/ `focus-settle`（D16 整分钟入账，宿主按
  localSessionId 幂等——PROTOCOL §7）/ `hello`（版本+能力位）/ `crash-diag`（环形缓冲诊断）；
- 容错：未知 type/op、缺字段、坏 JSON → 丢弃 + 计错 + 进诊断，**不崩**；半行缓冲、超长行护栏；
- 宿主存亡：stdin 管道守卫 + 心跳静默 >15s（可配）判死 + `--host-pid` 轮询双保险 → 10s 内退出。

消息形状与校验规则的单一源：`src/bridge/protocol.ts`（组 1 host 侧 `pet/` 对接消费）。

## 工程纪律

- 独立 vitest 配置（`vitest.config.ts`）：**不并入 dsh-plugin 的 coverage 口径**——GUI 胶水
  不进 business core 门禁，bridge 契约（真 stdio fake host）与状态机纯逻辑测试跑通即可；
- Electron 窗体不进 CI（headless 跳过；CI 安装期 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`）；
- 渲染层 vanilla TS + CSS（不引 React——dsh-pet 先例）；视觉 token 源 =
  `docs/design/DESIGN_SYSTEM.md`（与主应用 `src/dex.css` 同一设计源，UIUX §6.1）。

## 目录

```
src/
  bridge/     协议（protocol.ts 消息全集+校验 / lineCodec.ts 行编解码 / bridge.ts 通道+存亡 / heartbeat.ts / diag.ts）
  state/      纯逻辑（petState.ts 状态机 / bubbleTiming.ts 气泡时序 / pomodoro.ts 本地番茄 / focusSettle.ts D16 结账）
  sprites.ts  素材链（内置 → CDN → 双缺回退 + 单次缺失提示）
  runtime.ts  运行时装配（零 Electron 依赖）
  main.ts     入口（headless 分流 / --host-pid / --pos）
  electron-app.ts + preload.ts   Electron 胶水（窗体/穿透翻转/置顶看门狗/IPC）
  renderer/   渲染层（renderer.ts / lines.ts 三语最小台词 / pet.css / index.html）
__tests__/    vitest（bridge.contract 真 stdio / 纯逻辑 / headless 集成）
build.mjs     esbuild 构建产物（dist/）
```
