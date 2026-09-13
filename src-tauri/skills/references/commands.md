# pk 命令完整参考

约定：所有命令输出 UTF-8 JSON（stdout）；错误输出 `{"error":"..."}` 到 stderr，退出码 1=业务错误（数据不存在/校验失败）、2=用法错误。环境变量 `PK_DB` 可覆盖数据库路径（默认为应用数据目录 pokemon-knock.db）。

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
- 分类/标签必须已存在（`pk category list` / `pk tag list` / `pk context`）
- priority ∈ low/normal/high/urgent；confidence ∈ high/medium/low
- 重复提交同一消息为覆盖写（幂等）；同批重复 messageId 拒绝

## 会话遥测（session）

| 命令 | 说明 |
|---|---|
| `pk session log [--task <id>] --agent <id> [--session <sid>] [--command <c>] [--exit-code <n>] [--status ok\|error] [--duration-ms <n>] [--cost <美元>] [--in-tokens <n>] [--out-tokens <n>]` | 记录一次 agent 会话（成本/时长/退出码，可关联任务） |
| `pk session list [--task <id>]` | 会话列表；--task 查该任务的执行时间线 |

## 基础数据（category / tag / context）

| 命令 | 说明 |
|---|---|
| `pk category list` / `pk tag list` | 分类/标签列表 |
| `pk context` | 当前时间 + 未完成待办（id+标题）+ 启用分类 + 标签；判定与建任务的判重上下文 |

## 诊断与发现（doctor / help）

| 命令 | 说明 |
|---|---|
| `pk doctor [--ssh <user@host>]` | 环境自检：数据库/schema 版本/完整性/并发配置/context 读链路/技能安装版本，每项带 `fix` 修复建议；有 fail 退出码 1。**命令报错又看不懂时先跑它**。`--ssh` 加测远程 pk 可达性（排查 shim 部署，端到端验证 ssh 免密 → shim 在 PATH → 回连本机） |
| `pk help --json` | 机器可读命令目录（全部命令 + 退出码/环境变量契约），编程化发现命令面用 |
