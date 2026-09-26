# 飞书会话过滤偏好 实施计划

> 自包含计划。背景文档：`specs/feishu-chat-filter/`（requirements.md / architecture.md / uiux-design.md / uiux-prototype.html）。已过批量关卡（用户授权直接实施），在本会话编排 subagent 执行。
> 分支：`feat/feishu-chat-filter`（自 origin/main）。实施分支上同时提交 specs 文档与代码。

## 核心契约速览（实施时唯一事实源为 AD §4/§5，此处为防漂移摘要）

- **命令**（Tauri，同步，放 `commands/integrations.rs`）：
  - `get_feishu_chat_filter_overview() -> FeishuChatFilterOverview`：`{ chats: FeishuChatFilterView[], counts: {total, pulling, filtered, manual}, snapshotAt: Option<String> }`（camelCase 序列化；纯本地读）。
  - `set_feishu_chat_filter(chatId, preference: "follow"|"always_filter"|"always_pull") -> FeishuChatFilterView`（follow=DELETE 行；chatId 非空 ≤64；非法 → AppError::Invalid）。
- **行视图字段**：`chatId/chatName/chatType(group|p2p|bot)/muteOutcome(muted|unmuted|unknown)/preference(follow|always_filter|always_pull)/effective(pull|filter)/source(manual|follow|followDegraded)/updatedAt`。
- **决策纯函数**（feishu.rs）：`filter_decision(pref, outcome)`：AlwaysFilter→(Filter,Manual)；AlwaysPull→(Pull,Manual)；Follow+Muted→(Filter,Follow)；Follow+Unmuted→(Pull,Follow)；Follow+Unknown→(Pull,FollowDegraded)。
- **数据**：新表 `chat_filter_prefs(chat_id PK, preference CHECK in('always_filter','always_pull'), updated_at)`、`feishu_chats(chat_id PK, chat_name, chat_type, mute_outcome CHECK in('muted','unmuted','unknown'))`（无行级时间戳）；快照时间唯一载体 = settings 键 `feishu_snapshot_at`（快照事务内 UPSERT）。全部追加进 SCHEMA_V1 基线（user_version 保持 1，前提：应用未发布）。
- **事件**：`feishu-chat-filter-changed`（无 payload；触发：set 后 / 每轮快照事务提交后（emit 在 poll_once_inner，AppHandle 侧）/ import_json 成功后）。三处 fixture 同步：`events.rs` 的 all()+JSON 数组、`src/events.ts`、`src/__tests__/events.spec.ts`。
- **拉取决策点**（pull_new_messages）：chats + 免打扰查询（`muted_chat_ids`→`chat_mute_outcomes` 三值态，批次失败→Unknown、批次成功缺项→Unmuted）→ load_filter_prefs → 逐会话 filter_decision → write_chat_snapshot（单事务：DELETE 全表+INSERT+UPSERT 时间戳键，含被过滤会话与零会话轮）→ retain(effect==Pull) → 既有消息管线不动。
- **in-flight 守卫**（feishu.rs，AtomicBool）：poll_once 进入 CAS 抢占、占用中返回冲突错误、任何路径释放。
- **导出**：DUMP_TABLES 追加 `chat_filter_prefs`；导入对缺键容忍（空数组）；导入成功后广播新事件；`feishu_chats` 不导出。
- **前端**：`api.ts` 增 `getFeishuChatFilterOverview`/`setFeishuChatFilter`；`types.ts` 增三类型；新组件 `src/components/FeishuChatFilterManager.vue`（自取数、不建 Pinia store）挂 `SettingsTab.vue` 飞书卡下方；i18n 三语 `feishu.filter.*` 33 键（清单 = uiux-design.md §8）。UI 行为细节（三段选择器 roving tabindex、双信息行、空态×4、筛选 chips、陈旧阈值 max(5min, 2.5×interval)、即时生效、停用联动、选中档降 0 回退）以 uiux-design.md 为准，视觉基准 = uiux-prototype.html。

## 工具链与机械质量门槛

- 前端：`npm run lint`、`npm run format:check`、`npm run build`（vue-tsc）、`npm run test:unit`（vitest）。
- Rust：`cargo fmt --check`、`npm run clippy`（-D warnings）、`cd src-tauri && cargo test`。
- 提交：lefthook pre-commit（prettier/eslint --fix、cargo fmt）+ commitlint（conventional）。

## 并行组 1：后端（Rust，单 subagent 顺序执行）

依赖关系：B1→B3、B2→B3/B4、B1+B2→B4；同 crate 编译耦合，顺序执行。

- **Task B1（TDD）**：`db.rs` SCHEMA_V1 追加两表（SQL 见 AD §5.2）；先写基线测试（仿 `baseline_creates_chat_messages_with_suggested_note`：建表断言 + CHECK 拒绝非法 preference/mute_outcome）再改基线。
- **Task B2（TDD）**：`feishu.rs` 四枚举 + `filter_decision` 纯函数；先写 3×3 表驱动测试（断言值 = 上表速览）。`muted_chat_ids` → `chat_mute_outcomes`（HashMap<String, MuteOutcome>；归类规则见速览），保持既有行为回归（现有测试断言不回退）。
- **Task B3（TDD）**：`load_filter_prefs` / `write_chat_snapshot`（单事务 DELETE+INSERT+UPSERT `feishu_snapshot_at`）；`pull_new_messages` 决策点接入（retain 前落快照）；扩展假 lark-cli 集成测试覆盖 AD §8 测试 2 的 ①-⑧（含分批部分失败按请求体选择性失败、孤儿沉睡复活、零会话轮推进时间戳键）。emit 落点上提 `poll_once_inner`（快照事务提交后、错误轮不 emit）。
- **Task B4（TDD）**：`commands/integrations.rs` 两命令 + 三个结构体（serde camelCase，仿 FeishuOauthStatus）；`lib.rs` generate_handler! 注册。mock_app 测试（AD §8 测试 3：视图/counts/两空态区分/set 三态/校验/沉睡行视图/MockRuntime 广播断言）。
- **Task B5**：`events.rs` 新事件常量 + all() fixture + 硬编码 JSON 数组（Rust 侧契约测试）。〔`src/events.ts` 与 `src/__tests__/events.spec.ts` 归前端并行组 F1 同步——避免两 subagent 编辑同一文件；三处一致性由集成期 cargo test（Rust 契约测试）+ vitest（键位对齐）双侧锁定〕
- **Task B6（TDD）**：`export.rs` DUMP_TABLES 追加 + 导入缺键容忍 + 导入后广播；测试（旧格式文件缺 chat_filter_prefs 键可导入为空、导入后事件发出）。
- **Task B7（TDD）**：in-flight 守卫（AtomicBool 模块级；poll_once CAS 抢占/全路径释放）；测试（并发二次进入返回冲突且子进程调用不翻倍、错误路径释放）。
- **收尾**：`cargo fmt` + `npm run clippy` + `cargo test` 全绿；导出测试产物 junit（`cargo test` 不产 junit，用文本日志归档 `reports/raw/`）。

## 并行组 2：前端（Vue，单 subagent 顺序执行）

契约以 AD §4 为准（上面速览），UI 规格以 uiux-design.md + uiux-prototype.html 为准。

- **Task F1（契约对齐）**：`src/types.ts` 增 `FeishuChatFilterOverview`/`FeishuChatFilterView`/`FilterCounts`（枚举字面量类型）；`src/api.ts` 增两 wrapper（沿用 call() 错误归一）；`src/events.ts` 增 `feishu-chat-filter-changed` 常量 + `src/__tests__/events.spec.ts` fixture 同步（与后端 events.rs 三处对齐，值 = `feishu-chat-filter-changed`）。
- **Task F2**：i18n 三语 `feishu.filter.*` 33 键（uiux-design.md §8 清单逐键照抄，三文件键结构一致——键位对齐测试自动覆盖）。
- **Task F3**：新组件 `src/components/FeishuChatFilterManager.vue`：挂载/事件(`feishu-chat-filter-changed` + `settings-changed` 的 feishu_enabled)驱动的总览加载；搜索+筛选 chips（0 计数禁用、选中档降 0 回退全部）+ 排序（手动置顶→类型→名称）；行 = 徽章+名称+生效 chip+三段选择器（roving tabindex 键盘处方 §6.2、乐观写入+失败回滚+toast）；空态×4、loading、读取失败；陈旧横幅（阈值 max(5min, 2.5×feishu_poll_interval)，读 settings store）；停用联动显隐规则（§4.2）；脚注×2。样式沿用 dex.css token（照原型 `uiux-prototype.html`），Dex 组件质感，aria 语义齐全（radiogroup/aria-describedby 降级通道/role=status toast/aria-pressed chips）。
- **Task F4（TDD）**：挂载到 `SettingsTab.vue` 飞书卡下方（integrations stab）；Vitest 组件测试（mock api：加载/三态写入乐观与回滚/筛选与搜索/空态区分/陈旧横幅阈值推导/事件刷新保留筛选态/settings-changed 停用联动）。
- **Task F5**：E2E（`e2e/tauri-mock.ts` 增 `get_feishu_chat_filter_overview` mock + chatFilter fixture；`main-panel.spec.ts` 或新 spec：设置·集成 stab 打开卡片→列表渲染→三段切换→筛选；无横向滚动冒烟）。截图供验收报告。
- **收尾**：`npm run lint` + `npm run format:check` + `npm run build` + `npm run test:unit` 全绿；`npx playwright test --project=chromium` 通过。

## 集成与验收（主会话）

1. 全量门槛：`npm test`（vitest + cargo test）+ lint/format/build/clippy 全绿。
2. 报告产出 `specs/feishu-chat-filter/reports/`：`raw/`（测试日志与 playwright-report）、`api-summary.md`（读 raw 解读）、`e2e-summary.md`、`acceptance-report.md`（用户场景叙事 + 截图到 `reports/raw/screenshots/`）。
3. 文档同步：`docs/USER_GUIDE.md` 免打扰引导改写指向会话过滤卡、`docs/ROADMAP.md`、`docs/proposals/FEISHU_MESSAGE_ANALYSIS.md` §9.2/§9.3 落地标注。
4. 提交：conventional commit（feat: …），lefthook 兜底；不 push，等用户验收。

## 风险与回退

- SCHEMA_V1 基线追加对「本地已有调试库」不生效（user_version=1 skip）——测试走内存库无影响；开发者本地库需手动执行两条 CREATE（幂等），在 PR 描述注明。
- `chat_mute_outcomes` 重构动了拉取既有路径——B2/B3 必须保持现有 `pull_new_messages_applies_chat_type_rules` 断言全绿（行为不变回归）。
- 前后端并行靠 AD §4 契约速览对齐；集成期如发现漂移，以 AD 文档为准修前端。
