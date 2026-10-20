# ADR-0005：dsh 插件日志落盘对齐桌面共享日志

> 状态：已采纳　日期：2026-10-20
> 来源：背包-诊断日志断流排查（桌面 app 停跑后共享日志文件无写者）+ 用户裁决（插件日志对齐桌面 app，含目录自建与轮转）。

## 背景

共享日志文件 `<appHome>/logs/pokemon-choose-you.log` 的写者原本只有两个：桌面 Tauri（tauri-plugin-log）与 pk CLI（且仅当桌面 app 注入 `PK_LOG_FILE` 时才写，dsh 侧拉起 pk 不注入）。插件自身日志按 A24 只进内存环（不落盘、随宿主进程存亡），其设计前提是「桌面口径实际有日志」。ADR-0003 双宿主后纯 dsh 宿主成为常态：桌面 app 不在时磁盘日志冻结（实测 18 号 19:37 后零写入）、环随宿主进程重启清零且安静运行近乎无日志——背包-诊断两条数据源一条恒空、一条冻结。附带发现两处分叉：TS `parseDiskLogLines` 尾空行并入末条（Rust `lines()` 不产尾空行）；环 RFC3339 与磁盘 UTC-无标记两轴混排排序在非 UTC 时区错位。

## 决策

### 1. 统一日志面双写：内存环 + FileLogSink 落盘

`deps.log` 与 `warnDegrade` 走同一回调：内存环保留（A24 语义，喂支持报告 200 条快照），同时经 `health/fileLogSink` 落盘共享日志文件——行格式 `[UTC日期][UTC时间][target][LEVEL] msg` 与桌面完全互认（`parseDiskLogLines` / `parse_log_line` 双端解析往返一致），target 加 `dsh/` 命名空间前缀（共享文件里可辨识来源、来源过滤器抓手）。Plugin 面新增 `log` 字段，适配层降级告警不再直写环。

### 2. 写入配方与失败语义

单行一次 O_APPEND（`appendFileSync`，与桌面/pk 写入交错安全——pk `cli_log` 同配方）；目录缺失自建（纯 dsh 场景无桌面代建）；写失败回传错误串不抛（日志不碍主流程），调用方记环内 `log-sink` warn 使支持报告可见，不重试不递归。落盘目录可注入（`PluginDeps.logDir`，`null` 关闭——测试隔离）。

### 3. 轮转 = 截断而非删档（与桌面 KeepOne 的关键差异）

阈值同桌面 512_000 字节，但超限时 `truncate(0)` 而非 KeepOne 的删档重建：桌面 fern 的 `LogLandfiller` 持句柄常开，外部删除路径会使其继续写往已 unlink 的 inode（日志真丢）；O_APPEND 语义下截断后双方写入都回到文件头，KeepOne 丢历史语义等价且不破坏任何一方句柄。插件为独占写者时由自身执行轮转，桌面在跑时双方各自的超限检查独立生效。

### 4. logQuery 改磁盘单源

查询面不再合并内存环（避免落盘后双源重复），只读共享日志最新文件：文件序即时间序（桌面 `list_log_entries` 同口径不排序，两轴排序错位随之消除）、minLevel 过滤、最新端 offset 分页；插件增量保留来源子串匹配与出口三层脱敏。`parseDiskLogLines` 尾空行分叉修复，对齐 Rust `lines()`。

## 后果

- 纯 dsh 宿主场景日志持续可见、跨宿主进程重启可回溯（512KB 轮转窗口内）；桌面 app 诊断页也能看到 `dsh/*` 条目。
- 环日志仍易失（支持报告快照语义不变）；轮转窗口内丢历史与桌面/pk 同命。
- 同日收口两项延伸（详见 docs/debt.md 已完成节）：dsh 侧拉起的 pk 注入 `PK_LOG_FILE`（路径单源 `paths.ts logFilePathFrom`，与 logshare.rs 同拼法）；TunnelSupervisor 状态迁移接统一日志面（target `dsh/tunnel`，按 episode 去重防退避循环刷爆轮转窗口）。
