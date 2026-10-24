# radio/ —— 收音机轮询链路（AD §3.1）

timer 载体轮询（D14 分支 A）、共享水位读取与 CAS 推进、指数退避（2 分钟默认、×2 上限 8 倍，
与主应用同口径 D8）、lark-cli 子进程调用面（凭证由 lark-cli 自管，不进插件）、消息入库
（`INSERT OR IGNORE` + `message_id` UNIQUE 去重）（并行组 4）。
