# contracts/ 契约单一源约定

> TS（`dsh-plugin/`）与 Rust（主应用）双实现共享协议的唯一共同消费目录（specs/dsh-plugin AD §3.0/§4.4）。
> 铁律（FR-X3）：文字描述与主应用代码行为冲突时，以 `fixtures/` 锁定的代码行为为准。

## 不变量与红线

- **迁移 SQL 只追加**：`schema/` 按序号执行，正式发布后 `001_v1.sql` 基线冻结、不得修改已发布条目；schema 变更一律追加新编号文件，并同步两侧执行清单（Rust `src-tauri/src/db.rs` MIGRATIONS + TS storage guarded 迁移）。
- **场景/夹具由 Rust oracle 生成**：`scenarios/` 是输入（可手写/新增）、`fixtures/` 是 `src-tauri/src/contracts/` 契约测试执行的期望输出。重生成 = `UPDATE_FIXTURES=1 cargo test`（两步动作纪律：无环境变量时仅比对，Rust 行为漂移必须显式重生成——契约变更必须是有意决策）。
- **fixtures 不得手改**：字节比对单源是 oracle 的 serde_json pretty 输出；`.prettierignore` 已豁免 `contracts/fixtures` 与 `contracts/scenarios`——手工格式重排会让比对误红，不要解除豁免。
- **错误码 15 枚举单源 = `PROTOCOL.md` §2**：改码/增删码 = 双实现契约变更（TS `dsh-plugin` 错误面 + host 命令文档/UIUX 契约面同步），不是文案修改。
- **完备性机检双侧各自断言**：Rust 契约模块与 TS 回放套件各自断言「执行场景数 == `scenarios/` 目录文件数」——新增场景文件未挂进任一侧执行清单即 CI 红（M3a）。
- **场景格式 normative**：`kind`/`name`/`setup`/`steps`/`expect` 字段集与 op 枚举见 `PROTOCOL.md` §5；改 op 枚举 = 双侧 harness 同步变更。
- **schema 同源断言**：Rust `include_str!` 与 TS 打包消费同一文件，CI 字节相等断言防单边复制路径漂移。
- **CLI 信封契约组（`cli_envelope/`）锁 pk 命令面双实现一致性**：场景 = 命令自举数据（`invocations` 数组，可选 `setup.chatMessages` 种子——suggest 族要求消息预置）；oracle = `src-tauri/tests/cli_envelope.rs` spawn 真二进制捕获 stdout/stderr/退出码；归一化占位符双侧同构：`<tsN>`（ISO 时间戳按 invocation 内序号）、`<pk-version>`（工具版本，semver 三段）、`<home>`/`<cwd>`（家目录/场景工作目录）。TS 侧（dsh-plugin pk）spawn bundle 回放、字段树比对。`doctor`/`remote setup`/`__ssh_entry` 依赖真实环境或副作用，不入组（单测锁结构）；`skill show` 全文与 `agent-plugins/` 内嵌同源断言重复，不入组。

## 命令速查

- 重生成夹具：`UPDATE_FIXTURES=1 cargo test`（在 `src-tauri/`；含 `--test cli_envelope` 信封组）
- TS 回放：`pnpm --filter dsh-plugin test`（契约套件随 vitest 全量跑）
