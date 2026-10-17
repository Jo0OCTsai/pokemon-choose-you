# spike-dsh-ssh 结论备忘（D23 · AD §9 · 2026-10-17）

> 判据（AD §9「通过」）：三验证点断言全部成立 + 可重跑脚本在真实 dsh profile 跑通。
> **结论：PASS（17/17 断言）** —— 方案 2a 主路径成立，不切 2b；验证点③无需构建面修复。
> 代码基线 7986072；dsh 0.2.0-rc.2；@deepseek-ai/dsh-ssh / dsh-subprocess-ssh 0.1.6-alpha.1；
> 远端目标 = 本机 sshd（别名 `pky-spike-a` / `pky-spike-b`，HostName localhost）。

## 0. 可重跑产物

| 产物 | 路径 | 说明 |
|---|---|---|
| 一键脚本 | `spike/run-spike.sh` | 远端准备（npm 装 dsh-ssh 闭包 + workspace + ssh 别名）→ pky-spike 探针装入 pky-test profile → `dsh --profile pky-test` 启动执行 → 汇总裁决 |
| 探针插件 | `spike/pky-spike/`（package.json + cordis.patch.yml + index.js） | env 门控（`PKY_SPIKE=1` 才动作，否则 inert 常驻）；装载即跑 ①②③ 全断言，写 `logs/report.json` 后退进程 |
| 最小复现 | `spike/min-repro.mjs` | 裸 cordis `new Context()` + isolate + 双 label 装载（调试用，非判据） |
| 机器报告 | `spike/logs/report.json` + `spike/logs/dsh-boot.log` | 断言逐条 + ssh 进程记账 + dsh 启动日志 |

最近一次执行：`"verdict": "PASS", "passed": 17, "failed": 0`（连接建立 277–578ms——NFR-15 P95≤10s 大量余量）。

## 1. 验证点① 多实例 isolate 装配 —— 成立（含一处模式修正）

断言全过：双 label 作用域各自 `ctx.ssh` ready（远端 helper 直跑 + 摘要校验通过——附带验证项「lib/helper.js 远端可跑」随之证明）；两连接实例独立；执行世界隔离（各自 workspace 的 `/bin/pwd` 各归各）；**同 scope 并发两路 spawn 成立**（dsh-ssh 自协议单连接的部署级复用——NFR-15 P95 断言依据落定）；单侧 dispose 后另一侧仍可用、被 dispose 侧通道真关闭；宿主级 ssh 进程记账干净（baseline 0 → 双装载 2 → 单 dispose 1 → 全卸载 0，无残留孤儿）。

**⚠ 修正 A（写法层，AD §3.1/§4.7「isolate("ssh",label).isolate("subprocess",label) 同名链式」作废）**：
cordis 4.0.4 的服务注册槽以 label **单一编址**（`provide()` → `store[ctx[symbols.isolate][name]]`）。
同一 label 传给两个名字会让 ssh 与 subprocess 注册撞进同一槽位，装载即抛
`service "subprocess" has been registered at <SshConnection>`。正确模式 = **每服务名单独 label**：

```js
const sshLabel = Symbol(`pky-dep-${dep}-ssh`);
const subLabel = Symbol(`pky-dep-${dep}-sub`);
const sshScope = ctx.isolate("ssh", sshLabel);
const subScope = sshScope.isolate("subprocess", subLabel);
```

同 label 的「join 语义」仍可用在**重连复用**上：同部署 id 缓存 label 对（Map<id,{sshLabel,subLabel}>）即可。任务 2.1 sshScope.ts 按此实现。

**⚠ 修正 B（消费面写法）**：cordis 要求消费方**声明 inject 才能读注入服务**（`cannot get property "ssh" without inject`）——2.1 的装配不可直接 `scope.ssh` 取服务；可靠模式 = 向目标 scope 装一个 `inject:["ssh","subprocess"]` 的 consumer 子插件，其 `apply(c)` 即两服务可用时机（探针 `loadConsumer()` 实现可参考）。另外 `ctx.plugin()` 返回 **Fiber（PromiseLike）**，须 await 才能捕获装载期错误；卸载原语 = `fiber.dispose()`（`ctx.dispose` 同样是注入属性）。

## 2. 验证点② terminal backend 作用域 —— 成立

双作用域各开真 PTY 并存（pid 独立）、双向写读命中各自标记、**无跨作用域串扰**（A 终端不见 B 的输入，反之亦然）；同作用域第二终端独立路由（同部署多面板形态）；新终端注册后旧终端仍可用（注册无相互覆盖）；三终端全部收口。「面板路由」在本机 dsh web 面板语境下 = SshSubprocessRuntime 私有 `terminals` 集合按 handle 隔离——运行层无命名冲突即无面板错路由面（面板侧按 handle id 消费）。

## 3. 验证点③ 构建产物解析锚点 —— 成立（AD 最重载假设证实）

**dsh 宿主进程内实测**（探针 vp3-anchor）：

- `import.meta.resolve("@deepseek-ai/dsh-ssh")` → `file:///Users/jotsai/.dsh/profiles/pky-test/node_modules/@deepseek-ai/dsh-ssh/lib/index.js` —— **锚定 profile 内插件包闭包**（file: 安装拷贝），非全局 dsh 安装；dsh-subprocess-ssh 同。
- peer（`@deepseek-ai/cordis` 等）由 dsh 宿主的 install anchor 供给（裸 node 进程从 profile 位置解析 peer 会失败——**插件代码只准在 dsh 宿主内跑动态 import**，这与既有 hostEntry 约束一致，无新增面）。
- `import("uiohook-napi")` 同进程**实载成功**（profile node_modules，N-API 稳定 ABI——同一 .node 于 Node/Electron 通用，Electron 真机面归 4.5 冒烟）。远端 node-pty 同理：npm 装闭包时 install scripts 被跳过，包内 prebuilds 直接可用（darwin-arm64 实测 spawnTerminal 成功）。

## 4. ⚠ 修正 C（provisioning 上传步骤语义变更，AD §4.5 步③）

**`lib/helper.js` 不是自包含单文件**：分包产物，相对导入 3 个兄弟 chunk（`protocol-*.js` / `schemas-*.js` / `stream-security-*.js`）+ 外部依赖（`@deepseek-ai/cordis` / `dsh-fs` / `dsh-fs-sandbox` / `dsh-sandbox-local` / `dsh-sandbox-policy` / `dsh-session-projection` / `dsh-subprocess` / `dsh-subprocess-local` / `zod`）。**单文件上传远端必失败**（`ERR_MODULE_NOT_FOUND: …/protocol-*.js`，实测）。dsh-ssh README 官方口径即「在远端安装已构建 helper 及其匹配的运行依赖」，无自动 provisioning。

provision 步③「upload」修订为「**runtime 闭包安装**」：

- 主路径：远端 `npm install --prefix <home>/.dsh-helper/pky-<插件版本> @deepseek-ai/dsh-ssh@0.1.6-alpha.1`（经 SshScope.shell，引号全量引用；平台 optionalDeps/prebuild 由 npm 选择——远端 node-pty prebuild 在场即免编译）。远端 npm 不可达 = 该步失败（PROVISION_STEP_FAILED，与断网同语义）。
- `helperPath` = `<安装目录>/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js`；**helperHash = sha256(helper.js 入口文件本身)**（dsh-ssh 连接侧只校验入口文件——实测与本地制品 hash 一致通过）。多版本隔离 = 安装目录名带插件版本段（顶替不互踩，AD 原 helperPath 版本段意图平移到目录级）。
- 版本漂移防护维持 1.8 实现口径：权威 hash = 运行时读本机插件闭包内 `lib/helper.js` 计算。
- （离线远端的全量树上传通道 = 未来增强，记 docs/debt.md；v1 明示「远端需可达 npm registry」为就绪前提之一，诊断 hint 说明。）

任务 1.8 的 provision.ts 已按「writeFile 单文件」实现上传步——组 2 接线时（2.1/2.8）按本节修订为 npm 安装命令实现（步骤状态机/错误映射/幂等语义不变）。

## 5. 其余实测事实（2.1 实现输入）

- dsh-ssh `Config`：`{ host, node, helper, helperHash, workspace, requestTimeoutMs?, maxFrameBytes?, maxPending?, leaseMs? }`（缺省 30s/64MiB/128/30s——按缺省即可）；无 `bootstrapPath/bootstrapHash` 时基础 fs/subprocess/terminal 全可用（spike 未配 PTC，spawn/spawnTerminal 均过）。
- 连接建立（含远端 helper 拉起 + 摘要校验）：277–578ms（本机回环；真实远端含 RTT，P95 预算内）。
- dsh-ssh spawn 语义：`subprocess.spawn(spec)` 返回**同步 handle**（`done` 异步收口），collect 模式读用 `collected.stdout.readFrom(0)`；PTY 输出经 `handle.output`（Readable），写经 `handle.write()`——`SshScope` 接口（1.8 终版）与该面一一对应，签名无需回改。
- sshd 侧要求：ControlMaster + Unix socket 转发（macOS 默认 sshd 即可）；严格 host-key（别名需先进 known_hosts——spike 以 HostName localhost 复用既有条目）。
- 探针插件已留在 pky-test profile（inert 常驻，无 env 不动作）；`~/.ssh/config` 的 pky-spike-a/b 别名与远端 `~/.dsh-helper/spike-runtime/` 为 spike 资产，保留供重跑。

## 6. 裁决

| 验证点 | 结果 | 后续动作 |
|---|---|---|
| ① isolate 多实例 | **成立**（双 label 修正后） | 组 2 照常（2.1 按修正 A/B 实现）；不切 2b |
| ② terminal 作用域 | **成立** | 交互派发链（2.8）按 spawnTerminal 面接 |
| ③ 解析锚点 | **成立**（profile 闭包锚定 + anchor 供 peer） | 无构建面修复；uiohook 随 4.1 分发、4.5 真机复验 |
| 附带：helper 单文件假设 | **不成立** → 修正 C | provision 步③改「npm 闭包安装」（组 2 落实，语义变化记录于上） |
