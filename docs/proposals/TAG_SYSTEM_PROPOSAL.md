# 标签体系优化方案 —— 维度化 + AI 自动治理

> 目标：① 标签增加「维度」属性（项目/场景/人物等），让「这条待办属于哪个项目」成为一等信息；
> ② 把标签的维护成本从用户转移到 AI——AI 负责判断命中既有标签、提议新标签、归置维度，用户只做确认。
> 调研时间：2026-09-19。
>
> **实施状态**：P1–P3 已落地（维度模型与种子、AI 维度化打标与 isNew 提议、接受即建标签、
> 收音机/编辑弹窗/设置页/任务卡 UI、pk tag create、nlCapture #新名字新建、i18n、技能文档）。
> P4 标签体检（复盘向导的近义合并/僵尸归档/新维度建议）与 P5 反馈 few-shot 未实施。

## 一、现状与问题

数据模型（`db.rs` SCHEMA_V1）：

- `tags(id, name UNIQUE, description, created_at)` + `task_tags(task_id, tag_id)` 多对多，纯平面结构，无维度概念。
- `Task.tags` 是名称数组（`Vec<String>`），IPC 契约由 `models.rs` 测试与 `types.ts` 逐字段锁定。

标签的四个入口及其断点：

| 入口 | 现状 | 断点 |
|---|---|---|
| 设置 → 标签页 | 手动逐条增删改（name + description） | 全部维护负担在用户；无使用统计、无合并/归档，词表只会腐化 |
| 收音机 AI 分类 | prompt 提供「可用标签（名称：描述）」，AI 从**封闭集**选 0~3 个，无合适返回 `[]` | AI 判断「该打但词表没有」时信息直接丢失，用户事后手工补 |
| 收音机接受路径 | `radio.rs resolve_tag_ids` 只认已有名，**未知名静默丢弃** | AI 偶发输出词表外的名字时无提示无落库 |
| `pk` CLI / 自然语言捕捉 | 未知标签报错（CLI）/ 留在标题不猜（`#名字` 只认已有） | agent 与用户都无法自助扩词表 |

「项目」信息目前没有归宿：混进标签名（无结构）、或错用 category（category 语义是「生活领域」：工作/学习/生活/健康/兴趣，与项目正交）。

## 二、社区调研结论

详细纪要见调研链接（文末）。对本方案有直接影响的共识：

1. **三层分离模型**（Todoist / Things / TickTick 一致）：单归属容器（项目）+ 多选横切标签 + 可保存的过滤视图。不要用标签模拟层级，不要无上限放任标签。
2. **分面分类（facet）优于嵌套**（Obsidian 社区、Tana、Notion Select/Multi-select）：维度正交、维度内取值互斥、按维度分组管理。Notion 的「字段 = 维度、字段值 = 标签」正是本方案采用的形态。
3. **项目是否必须独立字段**：GTD/PARA/Johnny Decimal 一致把项目当一等实体。**取舍**：维度本质就是「用户自定义字段」，把 `project` 做成 `cardinality=single` 的内置维度，语义等价于一等字段，且人物/场景等维度复用同一套机制（Tana supertag 模式）。若未来需要项目容器语义（项目页、进度），project 维度的标签可平移导入独立 `projects` 表，不锁死路线。
4. **AI 打标：封闭词表 + 受控开放**（KNIME、LLM4Tag arXiv 2025）：混合式是主流——先从现有词表选，新标签走「建议 → 用户确认 → 入词表」的审批门。完全自动无治理会翻车（Mem.ai 口碑分化：快但失控）。
5. **审批即确认流**（Dewey 模式）：本产品收音机本来就有「AI 建议 → 用户 accept/dismiss」流，**新标签建议搭建议卡走即可，确认成本为零**，无需另建审批队列 UI。
6. **治理四操作**：add / merge / rename / archive；每任务标签 1~3 个；定期审计合并近义（字符串相似度预筛 + LLM judge）。
7. **IM 元数据是强信号**：群名/会话名/发送者常直接含项目名。收音机 prompt 已携带 `chat_label`，只需在规则里点明「归属项目时优先参考来源会话名」。

## 三、设计原则

1. **维度封闭，标签开放但有闸门**：维度是 schema 级结构（内置 4 个，用户可在设置增删）；AI 不直接建维度，只能在治理审计时「建议」新维度。标签可由 AI 提议新增，但必须带维度、过确认门、受上限约束。
2. **用户只确认，不维护**：AI 判断命中/新增；用户在既有确认流里顺带完成审批；治理建议（合并/归档）在复盘向导集中呈现。
3. **防碎片化优先于覆盖率**：宁缺毋滥，词表小而准（「少标签 + 好视图」替代「多标签」）。

## 四、数据模型

### 4.1 新表与变更（改 SCHEMA_V1 基线；应用未发布，无前滚迁移负担，本地调试库 ALTER 对齐）

```sql
CREATE TABLE IF NOT EXISTS tag_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,              -- project / context / person / topic
    name TEXT NOT NULL,                    -- 项目 / 场景 / 人物 / 主题
    cardinality TEXT NOT NULL DEFAULT 'multi',  -- single（任务上至多 1 个）/ multi
    max_tags INTEGER NOT NULL DEFAULT 20,  -- 该维度标签数上限，防碎片
    sort INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
);

-- tags 增列：
--   dimension_id INTEGER NOT NULL REFERENCES tag_dimensions(id)
--   origin TEXT NOT NULL DEFAULT 'manual'   -- manual / ai / nl / agent（追溯谁建的）
-- 唯一约束从 name 改为 UNIQUE(dimension_id, name)——同名可存在于不同维度
```

`Task.tags` 从 `Vec<String>` 升级为 `Vec<TagRef>`（`{name, dimension}`）：展示需要按维度分组、project 要单选渲染。契约测试（`models.rs` ↔ `types.ts`）同步改，这是防漂移的既有护栏。搜索逻辑不变（仍按名字 LIKE 匹配）。

### 4.2 内置维度（seed，均可在设置停用）

| key | 名称 | cardinality | 上限 | 承载内容 |
|---|---|---|---|---|
| `project` | 项目 | single | 20 | 待办属于哪个项目（用户点名的核心维度） |
| `context` | 场景 | multi | 10 | 执行约束：外出/电脑前/碎片时间（现代 GTD 共识，少而稳定） |
| `person` | 人物 | multi | 30 | 相关人：等待谁、要找谁 |
| `topic` | 主题 | multi | 30 | 兜底通用维度，存量无维度标签归这里 |

category（宝可梦领域）保持独立不动——它与项目正交（「工作」领域下有多个项目）。

### 4.3 不做 pending 标签状态

新标签的审批由收音机确认流天然承担：accept 即创建（active，origin=ai），dismiss 即不建。省一张队列表、一套队列 UI。上限与治理审计兜底碎片化。

## 五、AI 打标机制（核心改动）

### 5.1 分类上下文与 prompt（`ai.rs`）

`ClassifyContext.tags` 从 `Vec<(String, String)>` 改为带维度与配额：

```rust
pub struct TagCtx {
    pub dimension: String,   // 维度 key
    pub name: String,
    pub description: String,
}
// 另带各维度剩余可新建名额：max_tags - 该维度现有标签数
```

prompt 中「可用标签」按维度分组渲染，规则改写为：

```
可用标签（按维度分组，格式 维度[单选/多选/已满]）：
- 项目（单选）：PokemonApp：应用开发 / 周报：…（还可新建 17 个）
- 场景（多选，已满）：外出 / 电脑前 / 碎片时间
…
- tags 规则：项目维度至多 1 个；每条待办标签总数 ≤3。
- 新标签：仅当某维度确实没有贴切选项、且消息里有明确依据（出现的项目名/人名/群名）
  时才可提议：isNew=true 并归入该维度；模糊语境一律复用现有标签或留空。
  标注「已满」的维度禁止新建。
- 归属项目时优先参考消息来源（群聊名常含项目名）。
```

### 5.2 建议结构（`AiSuggestion.tags`）

```rust
pub struct ProposedTag {
    pub name: String,
    pub dimension: String,  // 归属维度 key
    pub is_new: bool,       // 词表外，需创建
}
```

`chat_messages.suggested_tags` 存储 JSON 同步升级（老数据 `["重要"]` 读取时归 `topic` 维度兼容）。

### 5.3 落库路径

- **收音机 accept**（`radio.rs`）：已知名走现行 `resolve`；`is_new` → 校验维度未满、`INSERT INTO tags`（origin=ai）再挂。静默丢弃逻辑删除——未知且未标 `is_new` 的名字记 warn 日志（AI 违反协议的观测点）。
- **update 建议**：tags 全量替换语义不变，替换数组里同样允许 `is_new`。
- **`pk` CLI**：`pk tag list` 输出带维度与剩余名额；新增 `pk tag create <name> --dimension <key> [--description <d>]`；`pk task create --tags` 未知名仍报错，但报错文案指向 `pk tag create`（agent 可两步自助，显式优于隐式）。`pk context` 的 tags 部分带维度，agent 判重上下文同步升级。
- **nlCapture**：`#名字` 匹配范围不变（跨维度按名匹配）；`#新名字` 预览高亮「将新建标签」，保存时创建（origin=nl，缺省 topic 维度）。不引入 `#维度/名字` 语法（一期不做，保持输入简单）。

## 六、交互改动（最小集）

| 位置 | 改动 |
|---|---|
| 收音机建议卡（RadioTab） | 标签 chip 按维度着色/前缀（项目=蓝、场景=绿…）；新标签 chip 加「+」角标，tooltip「拟新建·项目」 |
| 任务编辑弹窗（TaskEditModal）/ AddTaskForm | 标签选择器按维度分组；project 渲染为可搜索单选下拉，内嵌「+ 新建项目」 |
| 任务卡/详情抽屉 | project 维度标签作为主位信息展示（标题下方），其余维度标签折叠为 chip 行 |
| 设置 → 标签页 | 按维度分组管理；显示使用次数与最近使用；新增合并（并入目标标签后删除）与归档操作；维度本身的增删/改名/上限 |
| 复盘向导（ReviewWizard） | 新增「标签体检」步骤（见下） |
| 筛选 | 列表筛选器支持按维度筛选；「项目视图」= project 维度筛选（后续可固化为保存视图） |

文案沿用既有「标签」一词与训练家视角，不新造世界观词；维度展示名直接用「项目/场景/人物/主题」。

## 七、防碎片化治理

1. **上限硬闸**：每维度 `max_tags`（默认 20），创建时超限拒绝；prompt 内实时告知剩余名额，满维度禁新建。
2. **标签体检**（复盘向导，低频）：① 近义合并——本地字符串相似度（编辑距离/前缀包含）预筛候选对，走现有 agent 通道 LLM judge，产出「合并建议列表」供一键执行；② 僵尸归档——90 天未使用且 origin=ai 的标签建议归档；③ 新维度建议——AI 发现一批标签语义同属一个未覆盖的维度时，建议增设（用户确认后生效）。
3. **origin 追溯**：manual/ai/nl/agent，治理界面可按来源审计 AI 造词质量。
4. **每任务 ≤3 标签、project 单选**：prompt 规则 + 落库校验双层约束。

后续可选：用户移除 AI 标签的记录聚合后注入 prompt 作为负反馈 few-shot（「用户曾两次移除标签 X」），注意防错误反馈固化，二期再评估。

## 八、分期落地

| 期 | 内容 | 涉及 |
|---|---|---|
| P1 数据模型 | `tag_dimensions` 表 + seed；`tags` 加 `dimension_id/origin`，UNIQUE 改造；`Task.tags` → `TagRef[]`，契约测试与 `types.ts` 同步；本地调试库 ALTER | db.rs / models.rs / types.ts |
| P2 AI 打标 | `TagCtx`/`ProposedTag`、prompt 按维度分组 + 新标签规则、radio accept 创建路径、`suggested_tags` 兼容读取 | ai.rs / radio.rs |
| P3 UI 与 CLI | 建议卡维度 chip、编辑弹窗分组选择器、设置页维度化治理、`pk tag create`、nlCapture 新建 | 前端各组件 / pk.rs / nlCapture.ts |
| P4 治理 | 复盘向导「标签体检」：相似度预筛 + LLM judge 合并建议、僵尸归档、新维度建议 | ReviewWizard / 新增 commands |
| P5（可选） | 反馈 few-shot、项目视图固化为保存视图、project 平移为独立 projects 表（如需容器语义） | — |

## 九、风险与取舍

- **项目做成标签维度而非独立字段**：换来一套机制覆盖多维度（人物/场景复用）与更小的改动面；代价是暂时没有项目容器语义（项目页、进度、Things 式标签级联）。缓解：cardinality=single 保证语义等价，P5 预留平移路径。
- **AI 开放造词的碎片化风险**：三层兜底——确认门（收音机 accept）、维度上限（prompt 实时告知 + 落库校验）、定期体检（合并/归档）。Mem.ai 的教训正是缺治理的全自动。
- **`UNIQUE(dimension_id, name)` 波及按名解析**：`resolve_tag_ids`、前端 `nameToId`、nlCapture 匹配都按名全局查，需改为带维度或歧义时优先 topic/project。改动点集中且有测试护航。
- **`suggested_tags` 老数据**：JSON 数组无维度，读取时归 topic 兼容，不迁移。

## 附：调研来源

- Todoist labels/filters：<https://www.todoist.com/help/todoist/features/introduction-to-labels-dSo2eE>、<https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH>
- Things 3 标签级联：<https://culturedcode.com/things/support/articles/2803581>
- Notion 全局标签/分型：<https://matthiasfrank.de/blog/global-tags-in-notion-the-best-way-to-organise-your-tags/>
- Tana supertag：<https://tana.inc>
- Dewey 审阅后批量应用：<https://chromewebstore.google.com/detail/dewey/occohfgiljdagdmklhpplgmcnliljmgi>
- Mem.ai 评测（全自动打标口碑分化）：<https://www.saner.ai/blog/mem-ai-reviews>
- LLM 打标封闭词表 vs 开放（LLM4Tag）：<https://arxiv.org/abs/2504.04412>
- 词表治理操作集：<https://factorfirm.com/2023/07/01/a-taxonomy-of-taxonomy-governance/>
- AI 反馈闭环设计：<https://pair.withgoogle.com/guidebook/chapters/feedback-and-controls/design-ai-feedback-loops/>
- GTD context 演变：<https://forum.gettingthingsdone.com/t/replacement-for-contexts-in-2022-are-energy-time-and-or-priority-the-new-contexts/16824>
