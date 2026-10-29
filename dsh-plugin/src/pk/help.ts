/**
 * help 子命令（对齐 bin/pk/main.rs 的 HELP / COMMAND_INDEX / help_schema）：
 * HELP 给人读、COMMAND_INDEX 给 agent 编程化发现，两处文案与 Rust 实现人工互镜。
 */

export const HELP = `pk — 就决定是你了命令行（供 AI agent 与终端使用）

用法:
  pk <命令> [参数]...

命令:
  task list [open|done|today|all]    任务列表（默认 open：未完成待办；--limit N|all 默认 50，超出截断并提示用 search）
  task get <id>                      任务详情（含跟进记录）
  task search <关键词>                搜索标题/备注/跟进记录/标签
  task create --title <t> [--note <n>] [--category <分类名>] [--priority low|normal|high|urgent]
                [--due <YYYY-MM-DDTHH:MM>] [--scheduled] [--tags <a,b>] [--dry-run]
                （--dry-run 只校验并回显将创建的内容，不落库）
  task update <id> [--title <t>] [--note <n>] [--category <分类名>] [--priority <p>]
                [--due <时间>] [--remind <时间>] [--status <状态>] [--tags <a,b>] [--dry-run]
                （--due/--remind 传空串 "" 表示清空；--dry-run 只校验并回显变更，不落库）
  task done <id>                     完成任务
  task start <id>                    开始任务（全局唯一进行中）
  task pause                         暂停当前进行中的任务
  task current                       查看当前进行中的任务
  task delete <id> [--dry-run]       删除任务（--dry-run 只确认存在性，不删除）
  note add <task-id> <内容...> [--source manual|ai]
  note list <task-id>
  log <task-id>                      任务操作历史
  session log [--task <id>] --agent <id> [--session <sid>] [--command <c>] [--exit-code <n>]
                [--status ok|error] [--duration-ms <n>] [--cost <美元>] [--in-tokens <n>] [--out-tokens <n>]
                                      记录一次 agent 会话（成本/时长/退出码，可关联任务）
  session list [--task <id>]         会话列表（--task 查该任务的时间线）
  dispatch start|done|fail --task <id> [--note <一句话>]
                                      回传待办派发状态（done/fail 从 running 迁移；start 领取开工、幂等）；
                                      --task 缺省读应用派发注入的 PK_DISPATCH_TASK 环境变量，
                                      两者皆空时静默跳过（普通会话的 Stop hook 不产生噪音）
  suggest todo|update|follow-up|none --message <消息id> [--task <待办id>] [--title <t>] [--note <n>]
                [--category <分类名>] [--priority low|normal|high|urgent] [--due <YYYY-MM-DDTHH:MM>]
                [--tags <a,b>] [--reason <一句话>] [--confidence high|medium|low] [--agent <agent-id>]
                                      提交一条 AI 判定建议（todo/update 写建议列待用户确认；follow-up 直接挂跟进）
  suggest batch [--agent <agent-id>]
                                      批量提交建议：stdin 传 {"results":[...]}（与应用文本协议同构），整批校验失败则全部不落库
  skill install <claude-code|opencode|pi|dsh> [--dir <技能根目录>]
                                      一键安装 pk 使用技能到 agent 的技能目录（--dir 为技能根目录，技能落 <根>/pokemon-choose-you）
  skill show                         打印技能内容（Markdown 原文，可重定向给任意 agent）
  remote shim --host <本机地址> [--port <n>] [--key <私钥>] [--write <路径>]
                                      生成远程主机上的 pk 透传脚本（agent 在远程、数据在本机时，命令经 ssh 回本机执行）
  remote setup --host <OpenSSH 别名> [--tunnel-port <n>] [--pk-path <路径>] [--key-dir <目录>] [--timeout-secs <n>]
                                      开通 pk 通道（部署驱动完整序列：密钥/公钥/私钥/指纹/shim/PATH/端到端验证，
                                      幂等可重跑，JSON 报告输出；ADR-0003）
  category list                      分类列表
  tag list                           标签列表（含维度 dimensions 与标签归属维度）
  tag create <名字> [--dimension <维度key>] [--description <描述>]
                                      新建标签（缺省 topic 维度；维度 key 见 tag list）
  context                            AI 处理上下文（当前时间/未完成待办/分类/标签与维度）
  doctor [--ssh <user@host>]         环境自检：数据库/schema/完整性/技能安装（每项带修复建议）；
                                      --ssh 加测远程 pk 可达性（agent 在远程时排查 shim 部署）
  init-db                            初始化 PK_DB 指定的空库（应用主库通常无需执行）
  help [--json]                      本帮助；--json 输出机器可读的命令目录（供 agent 编程化发现）

示例:
  pk task list open
  pk task get 3
  pk task create --title "交周报" --due "2026-09-13T18:00" --tags 重要,需汇报
  pk task update 3 --priority high --due ""
  pk note add 3 对方确认周五交付 --source ai
  pk session log --task 3 --agent claude-code --session abc123 --cost 0.12 --duration-ms 61000
  pk session list --task 3
  pk dispatch done --task 3 --note 修复完成并补了回归用例   # 被派发处理待办后回传状态
  pk suggest todo --message om_1 --title 交周报 --due 2026-09-13T18:00 --reason 对方明确要求
  echo '{"results":[{"messageId":"om_1","action":"todo","title":"交周报"}]}' | pk suggest batch --agent claude-code
  pk skill install claude-code

输出: JSON（stdout）。错误: {"error": "..."}（stderr），退出码 1（业务）/ 2（用法）。
环境变量: PK_DB 覆盖数据库路径（默认 ~/.choose-you/data/pokemon-choose-you.db，CHOOSE_YOU_HOME 可重定位归一化根）。`;

/** help --json 的数据源：命令目录（与 HELP 文本各司其职——前者给 agent 编程化发现，后者给人读） */
const COMMAND_INDEX: Array<[string, string]> = [
  ["task list", "任务列表（open|done|today|all；--limit N|all 默认 50，超出截断并提示用 search）"],
  ["task get <id>", "任务详情（含跟进记录）"],
  ["task search <关键词>", "搜标题/备注/跟进/标签"],
  ["task create", "建任务（--title 必填；--dry-run 只校验回显不落库）"],
  ["task update <id>", '更新字段（--due "" 清空；--dry-run 只校验回显）'],
  ["task done <id>", "完成任务"],
  ["task start <id>", "开始任务（全局唯一进行中）"],
  ["task pause", "暂停当前进行中任务"],
  ["task current", "当前进行中任务"],
  ["task delete <id>", "删除任务（--dry-run 只确认存在性）"],
  ["note add <task-id> <内容...>", "记跟进（--source manual|ai）"],
  ["note list <task-id>", "跟进列表"],
  ["log <task-id>", "任务操作历史"],
  ["suggest todo|update|follow-up|none", "提交单条 AI 判定建议（--message 必填；写建议列待用户确认）"],
  ["suggest batch", '批量提交建议（stdin 传 {"results":[...]}，整批校验一损俱损）'],
  ["session log", "记录 agent 会话（--agent 必填；成本/时长/退出码）"],
  ["session list", "会话列表（--task 查任务时间线）"],
  [
    "dispatch done",
    "回传派发状态（done/fail 从 running 迁移，--note 带摘要；start 领取开工；--task 缺省读 PK_DISPATCH_TASK）",
  ],
  ["skill install <agent>", "安装技能（claude-code|opencode|pi|dsh，或 --dir 指定技能根目录）"],
  ["skill show", "打印技能全文"],
  ["remote shim", "生成远程 pk 透传脚本（--host 必填）"],
  ["category list", "分类列表"],
  ["tag list", "标签列表（含维度）"],
  ["tag create", "新建标签（--dimension 指定维度，缺省 topic）"],
  ["context", "当前时间 + 未完成待办 + 分类 + 标签与维度（判定与建任务的判重上下文）"],
  ["doctor", "环境自检（数据库/schema/技能安装，每项带修复建议；--ssh <host> 加测远程 pk）"],
  ["init-db", "初始化 PK_DB 指定的空库"],
  ["help --json", "机器可读命令目录（本命令）"],
];

export function helpSchema(): unknown {
  return {
    name: "pk",
    version: pkVersion(),
    description: "就决定是你了待办库命令行（供 AI agent 与终端使用）",
    output: 'stdout 恒为 JSON；错误输出 {"error":...} 到 stderr',
    exitCodes: { 0: "成功", 1: "业务错误", 2: "用法错误" },
    env: { PK_DB: "覆盖数据库路径（默认为应用数据目录 pokemon-choose-you.db）" },
    commands: COMMAND_INDEX.map(([command, summary]) => ({ command, summary })),
  };
}

/** 构建期注入的版本号（esbuild/vitest define：__PK_CLI_VERSION__ ← dsh-plugin 包版本） */
declare const __PK_CLI_VERSION__: string | undefined;

export function pkVersion(): string {
  return typeof __PK_CLI_VERSION__ !== "undefined" ? __PK_CLI_VERSION__ : "0.0.0-dev";
}
