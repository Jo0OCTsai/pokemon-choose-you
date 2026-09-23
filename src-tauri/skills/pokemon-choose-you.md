---
name: pokemon-choose-you
description: 就决定是你了（pokemon-choose-you）待办管理技能——用 pk 命令读写本地待办库：建任务/查任务/完成任务/记跟进/提交 AI 判定建议/记录会话成本/回传派发状态。当用户提到待办、任务清单、周报、deadline、打卡或「帮我记一下」时使用。
version: "4"
---

# 就决定是你了 · pk 命令技能

桌宠待办应用「就决定是你了」的本地命令行。所有命令输出 UTF-8 JSON（stdout），错误输出 `{"error": "..."}` 到 stderr（退出码 1=业务 / 2=用法）。

## 使用约定

- 动手前先 `pk context` 拿当前时间、未完成待办、可用分类与标签——**建任务/提交建议的分类标签必须从这里选**，不要发明不存在的名字
- **人名一律是代号**：消息正文与 `pk context` 输出里的真实姓名已替换成稳定代号（如 `成员_a1b2`，同代号=同人，「我」=用户本人）。生成 title/note/reason 沿用代号原样回写，落库时会自动还原成真名；不要猜测或还原真实姓名
- 任务状态机：草丛(inbox) → 路线(scheduled) → 进行中(active) ⇄ 暂停(paused) → 完成(done) / 逃走(cancelled)；全局唯一进行中
- 完成或代办后顺手记一条跟进（`pk note add`），保留「谁说的、什么时候确认的」
- 收到「判定一批消息」的任务时，正确出口是 `pk suggest`（写建议待用户确认），不要绕过它直接 `pk task create`
- 收到「处理这条待办（No.X）」的**派发任务**时：在指定工作目录内完成，结束时回传派发状态（见下）

## 命令速查

```bash
pk context                                   # 当前时间 + 未完成待办 + 分类 + 标签（先看这个）
pk task list [open|done|today|all]           # 任务列表（默认 open）
pk task get <id>                             # 任务详情（含跟进记录）
pk task search <关键词>                        # 搜索标题/备注/跟进记录/标签
pk task create --title "交周报" --category 工作 --due "2026-09-13T18:00" --tags 重要
pk task update <id> --priority high --due ""  # --due "" 表示清空截止时间
pk task done <id>                            # 完成任务
pk task start <id> / pk task pause           # 开始（全局唯一进行中）/ 暂停
pk task current                              # 当前进行中的任务
pk note add <task-id> 对方确认周五交付 --source ai
pk suggest todo --message <消息id> --title 交周报 --due 2026-09-13T18:00 --reason 对方明确要求
pk task create --title 交周报 --dry-run      # 只校验回显不落库（task update/delete 同）
pk doctor                                    # 环境自检（命令报错看不懂时先跑它，按 fix 修复）
pk session log --task <id> --agent claude-code --session <会话id> --cost 0.12 --duration-ms 61000
pk session list --task <id>                  # 该任务的 agent 执行时间线（时长/成本/退出码）
pk dispatch done --task <id> --note 一句话摘要  # 派发任务完成回传（无法完成用 dispatch fail）
```

完整参数表与批处理协议按需再读（渐进披露，不必一开始就加载）：

- [references/commands.md](references/commands.md)：全部子命令的完整参数与错误语义
- [references/suggest-workflow.md](references/suggest-workflow.md)：无头分类批处理工作流（`pk suggest batch`）

## 给 agent 的建议流程
1. 用户说「记个待办」→ `pk context` → `pk task create`（分类标签从 context 里选）
2. 用户说「我做完 X 了」→ `pk task search X` 找到 id → `pk task done <id>`
3. 代办执行类任务：开始前 `pk task start`，结束后 `pk task done` + `pk note add` 记结果；有会话成本就 `pk session log` 记录（用户在意花销）
4. 收到「判定一批消息」的无头任务 → 按 [references/suggest-workflow.md](references/suggest-workflow.md) 走 `pk suggest batch` 一次提交
5. 收到「处理这条待办（No.X）」的派发任务 → 在当前工作目录（git 仓库）内完成后：`pk dispatch done --task X --note 变更摘要`；无法完成时 `pk dispatch fail --task X --note 原因`。任务本身确实做完再顺手 `pk task done X`（派发状态与任务状态是两回事，别混）

## 可选：Stop hook 自动回传派发状态

应用无头派发时会向 agent 子进程注入 `PK_DISPATCH_TASK=<任务id>`。给 claude 配置 Stop hook 可在会话结束时自动回传（普通会话无该变量，pk 会静默跳过、不产生噪音）：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "pk dispatch done --note \"agent 会话结束\"" }
        ]
      }
    ]
  }
}
```

（`--task` 缺省读 `PK_DISPATCH_TASK`；交互会话里 agent 主动调用 `pk dispatch done` 更精确——能带上下文摘要。）

## 注意

- 数据库与应用共享（WAL 并发安全）；找不到库时先让用户启动一次应用，或用 `PK_DB` 环境变量指定路径
- 时间格式 `YYYY-MM-DDTHH:MM`（本地时区）；空串表示清空
- 命令报错自带可操作提示（未知分类/标签、目标待办不存在、消息已确认等），按提示修正后重试；仍不明就跑 `pk doctor` 按 `fix` 修复
- `task list` 默认最多回 50 条（响应里 `truncated: true` 会提示），要看更多用 `task search` 收窄或 `--limit all`
