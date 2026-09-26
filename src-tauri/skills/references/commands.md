# pk 命令完整参考

约定：所有命令输出 UTF-8 JSON（stdout）；错误输出 `{"error":"..."}` 到 stderr，退出码 1=业务错误（数据不存在/校验失败）、2=用法错误。环境变量 `PK_DB` 可覆盖数据库路径（默认 `~/.choose-you/data/pokemon-choose-you.db`，`CHOOSE_YOU_HOME` 可重定位归一化根）。

## 任务（task）

| 命令 | 参数 | 说明 |
|---|---|---|
| `pk task list [open\|done\|today\|all]` | `--limit N\|all`（默认 50） | 任务列表；`total`/`truncated` 标记是否截断，截断时用 `task search` 收窄 |
| `pk task get <id>` | | 任务详情（含跟进记录） |
| `pk task search <关键词>` | | 搜标题/备注/跟进/标签 |
| `pk task create` | `--title <t>`（必填）`--note <n>` `--category <分类名>` `--priority low\|normal\|high\|urgent` `--due <YYYY-MM-DD\|YYYY-MM-DDTHH:MM>` `--tags <a,b>` `--dry-run` | 建任务；带 --due 自动进路线（scheduled）；`--dry-run` 只校验回显不落库 |
| `pk task update <id>` | `--title` `--note` `--category` `--priority` `--due`（空串清空）`--remind` `--status <状态>` `--tags <a,b>` `--dry-run` | 只改传入的字段；`--dry-run` 只校验回显将变更的字段 |
| `pk task done <id>` | | 完成任务（写完成时间） |
| `pk task start <id>` / `pk task pause` | | 开始（全局唯一进行中，原进行中顶回 scheduled）/ 暂停 |
| `pk task current` | | 当前进行中的任务 |
| `pk task delete <id>` | `--dry-run` | 删除任务；`--dry-run` 只确认存在性 |

## 跟进与历史

| 命令 | 说明 |
|---|---|
| `pk note add <task-id> <内容...> [--source manual\|ai]` | 给待办记一条跟进 |
| `pk note list <task-id>` | 待办的跟进列表 |
| `pk log <task-id>` | 待办的操作历史（task_logs） |

## AI 判定建议（suggest）

提交「消息 → 待办」的判定结果。todo/update 写入消息的建议列**等用户在应用里确认**；follow-up 直接挂跟进记录（自动应用）；none 只记判定状态。

| 命令 | 参数 | 说明 |
|---|---|---|
| `pk suggest todo` | `--message <消息id>`（必填）`--title <t>`（必填）`--note` `--category` `--priority` `--due` `--tags <a,b>` `--reason <一句话>` `--confidence high\|medium\|low` `--agent <agent-id>` | 判定为新待办 |
| `pk suggest update` | `--message` `--task <待办id>`（必填）+ 同上属性旗标（只传要变的字段） | 判定为现有待办的变更 |
| `pk suggest follow-up` | `--message` `--task <待办id>`（必填）`--reason` `--confidence` | 判定为现有待办的跟进 |
| `pk suggest none` | `--message` `--reason` | 判定为无需行动 |
| `pk suggest batch` | `--agent <agent-id>`；建议列表经 **stdin** 传入 | 批量提交，见 suggest-workflow.md |

校验规则（不合法整条拒绝，修完重试）：

- 消息 id 必须来自待判定消息列表；已人工确认过的消息不能再提交
- 待办 id 必须来自 `pk context` 的 openTasks
- 分类必须已存在（`pk category list`）；标签按维度管理：词表内标签（`pk tag list` 的 tags，含 dimension）直接用名字，词表外新标签在 batch 协议里用对象形式 `{"name":"...","dimension":"project","isNew":true}`（维度取 `pk context` 的 dimensions.key，remaining<=0 的维度禁止新建）
- priority ∈ low/normal/high/urgent；confidence ∈ high/medium/low
- 重复提交同一消息为覆盖写（幂等）；同批重复 messageId 拒绝

## 会话遥测（session）

| 命令 | 说明 |
|---|---|
| `pk session log [--task <id>] --agent <id> [--session <sid>] [--command <c>] [--exit-code <n>] [--status ok\|error] [--duration-ms <n>] [--cost <美元>] [--in-tokens <n>] [--out-tokens <n>]` | 记录一次 agent 会话（成本/时长/退出码，可关联任务） |
| `pk session list [--task <id>]` | 会话列表；--task 查该任务的执行时间线 |

## 派发状态回传（dispatch）

被应用「派发」处理待办（prompt 形如「处理这条待办（No.X）」）时，结束时回传派发状态。派发状态机：未派发 → running（应用派发时领取）→ done / failed；`done`/`fail` 只允许从 running 迁移，其他状态会返回可操作错误。

| 命令 | 说明 |
|---|---|
| `pk dispatch done --task <id> [--note <一句话摘要>]` | 回传处理完成（摘要进任务操作历史） |
| `pk dispatch fail --task <id> [--note <原因>]` | 回传无法完成 |
| `pk dispatch start --task <id>` | 领取开工（NULL/queued → running；已 running 幂等成功） |

- `--task` 缺省读环境变量 `PK_DISPATCH_TASK`（应用无头派发时注入子进程）；两者皆空时**静默跳过**（返回 `{"skipped": ...}`，退出码 0）——挂了 Stop hook 的普通会话结束不会报错刷屏
- 远程 agent 经 shim 回本机执行，行为一致；交互会话（tmux）里主动调用比 Stop hook 更精确（能带上下文摘要）
- 派发状态 ≠ 任务状态：待办本身做完另用 `pk task done <id>`，两回事别混

## 基础数据（category / tag / context）

| 命令 | 说明 |
|---|---|
| `pk category list` | 分类列表 |
| `pk tag list` | 标签列表：`tags`（含 dimension/origin/usage）+ `dimensions`（维度 key/单多选/上限） |
| `pk tag create <名字> [--dimension <维度key>] [--description <描述>]` | 新建标签（缺省 topic 维度；agent 自助扩词表用） |
| `pk context` | 当前时间 + 未完成待办（id+标题）+ 启用分类 + 标签（含 dimension）+ 维度（含 remaining 剩余可新建名额）；判定与建任务的判重上下文 |

## 技能与远程部署（skill / remote / init-db）

| 命令 | 说明 |
|---|---|
| `pk skill install <claude-code\|opencode\|pi> [--dir <目录>]` | 把 pk 使用技能（SKILL.md + references/）装进 agent 的技能目录；跨版本重装提示更新 |
| `pk skill show` | 打印技能全部内容（其他 agent 自行粘贴用） |
| `pk remote shim --host <本机地址> [--port <n>] [--key <私钥>] [--write <路径>]` | 生成远程透传脚本（默认打 stdout 可重定向；经 ssh 反向隧道回连本机执行 pk，数据留在本机） |
| `pk init-db` | 初始化 `PK_DB` 指定的空库（应用主库通常无需执行） |

## 诊断与发现（doctor / help）

| 命令 | 说明 |
|---|---|
| `pk doctor [--ssh <user@host>]` | 环境自检：数据库/schema 版本/完整性/并发配置/context 读链路/技能安装版本，每项带 `fix` 修复建议；有 fail 退出码 1。**命令报错又看不懂时先跑它**。`--ssh` 加测远程 pk 可达性（排查 shim 部署，端到端验证 ssh 免密 → shim 在 PATH → 回连本机） |
| `pk help --json` | 机器可读命令目录（全部命令 + 退出码/环境变量契约），编程化发现命令面用 |
