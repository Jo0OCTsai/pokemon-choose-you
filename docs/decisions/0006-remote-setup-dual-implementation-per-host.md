# ADR-0006：remote setup 按宿主双实现（Rust 桌面 / TS dsh-plugin）

> 状态：已采纳　日期：2026-10-30
> 取代：ADR-0003 §3 的「开通序列 Rust 单源」结论（0003 其余部分——部署实体单源、隧道让位锁、双宿主闭环——继续有效，本 ADR 不动）。
> 来源：openspec 变更 `ts-pk-and-agent-plugins`（2026-10-29 盘问 12 问裁决）。

## 背景

ADR-0003 §3 把 remote setup（九步幂等开通 + shim 生成 + `__ssh_entry` forced-command 入口）下沉为 pk 子命令并否决了「dsh 侧 TS 重实现」（估 ~400 行永久双维护），理由是保 Rust 单源：dsh-plugin 此前 vendor 一个 2.8MB 的 Rust pk 二进制，构建链被 cargo 交叉编译绑死。

两个后续事实改变了权衡：

1. **`__ssh_entry` 必须随宿主形态走**：authorized_keys 的 forced-command 指向「本机落位的 pk」。纯 dsh 场景落位的是插件分发的 pk——若它是 TS 形态而入口只有 Rust 实现，整条远程回连链直接断。「remote 家族不入 TS」不是可选项。
2. **双实现同构已是既有实践**：隧道与让位锁（`tunnelSupervisor.ts` ↔ `tunnel.rs`）本就是按宿主双实现 + 协议锁定，remote setup 并非开「永久双维护」先例。

同时 dsh-plugin 的形态目标演进为「单次构建即分发全部能力」——vendor Rust 二进制与该目标直接矛盾（每平台多一份 2.8MB 产物、构建链依赖 cargo）。

## 决策

**remote 开通家族（setup / shim / `__ssh_entry`）按宿主双实现**：桌面链路继续 Rust（sidecar `binaries/pk` + `setup_deployment_pk`，零改动）；dsh-plugin 分发链路全 TS（`dsh-plugin/src/pk/`，esbuild 单文件 bundle `dist/pk.mjs` 落位 `~/.choose-you/bin/pk`，Windows 落 `pk.cmd` 包装），vendor Rust 二进制移除。

**漂移由机器检出，不靠约定**：contracts 新增 CLI 信封契约组（`cli_envelope/`）——Rust oracle（`src-tauri/tests/cli_envelope.rs` spawn 真二进制）生成 fixtures，TS 侧（`dsh-plugin/__tests__/pk-cli-envelope.spec.ts` spawn bundle）回放逐字段比对；归一化占位符双侧同构（`<tsN>` 时间戳序号 / `<pk-version>` 工具版本 / `<home>`/`<cwd>` 路径）。任一实现命令信封漂移即测试红。域语义另由既有契约组（scenarios/fixtures）双侧回放锁定。

**双宿主 authorized_keys 共存语义不变**：四形态收口（整条一致 skip / 裸公钥原位升级 / 自家旧路径原位搬移 / 陌生形态不动）双实现同款——先后开通 last-writer-wins，与 ADR-0003 时代行为一致。

## 后果

- dsh-plugin 构建解绑 cargo（`prepare-pk-cli.mjs` 只服务桌面 sidecar）；分发产物从二进制变 node 脚本，运行前提 = PATH 可见 node ≥ 22（与 dsh 宿主自身一致，不新增要求）。
- pk bundle 硬约束零 dsh 平台面依赖（esbuild metafile 依赖图 guard 机器检）。
- 信封契约组不含 `doctor` / `remote setup` / `__ssh_entry`（真实环境依赖或副作用），由各自单测锁结构（假 ssh/keyscan/keygen 注入跑九步全链）。
- ADR-0003 §3 的单源表述由本 ADR 取代；0003 的 pk 通道双宿主闭环结论不受影响。
