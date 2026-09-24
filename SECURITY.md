# 安全策略

## 上报漏洞

请通过 **GitHub Security Advisories** 私密上报：仓库页 Security → Report a vulnerability。
请勿在公开 issue / 讨论中张贴漏洞细节。

- 收到报告后 72 小时内确认，7 天内给出初步评估。
- 修复发布后会在 Release notes 中致谢（除非你希望匿名）。

## 支持范围

- 只修复**最新发布版本**中的漏洞，不维护旧版本补丁。
- 0.x 阶段数据格式（SQLite schema）不承诺稳定，升级前请备份 `pokemon-choose-you.db`（P2 将提供应用内导出）。

## 已知边界（非漏洞，但与信任模型相关）

- **安装包未做 Apple/微软官方代码签名**（macOS 不购买开发者账号；Windows SignPath 免费签名申请中）：
  - macOS 包带**固定的自签代码签名证书**（非 Apple 签发、未公证）：仅提供跨版本稳定的代码身份——辅助功能等系统授权不会因升级失效；不通过 Gatekeeper 信任链，首次打开仍需「右键 → 打开 / 仍要打开」；
  - Windows SmartScreen 提示时走「更多信息 → 仍要运行」。
  - 从 GitHub Releases 官方渠道下载的包可由下方方式校验完整性。
- **自动更新走 minisign 独立签名**（与 OS 代码签名相互独立）：更新包由发布流水线签名，公钥内置于应用（`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`），安装前强制校验，无法被替换为未签名的安装包。
- **本地数据**：任务/设置明文存储于本机 SQLite，不上传到任何第三方。飞书凭证由官方 lark-cli 自己保管，不进本应用；AI 走本地 agent CLI 子进程，不持有服务凭证（此前 Todoist 集成的 API Token 已随功能下线一并清理）。使用自建 AI 接口时请注意数据会流经你所配置的服务商。
- **同用户进程即同信任域（本地优先的既定设计）**：`pk` CLI 与应用共享同一数据库、不做调用方鉴权——本机同用户的任意进程都能经 `pk` 读写待办、经设置里的 agent 配置执行程序；攻击者若已能以你的用户身份跑代码，本应用不额外设防。配置（含 agent 的 SSH 主机/密钥路径）随数据库明文存储。
- **远程 pk 通道（反向隧道）**：一键配置写入本机 `authorized_keys` 的是 `restrict,command=` 受限条目——远程私钥（`~/.ssh/pk_shim`）即使失陷，也只能经 pk 的 `__ssh_entry` 校验入口执行本机 pk（语法级白名单：`[env] PK_LOG_FILE/PK_DISPATCH_TASK <本机 pk> 参数…`），拿不到 shell；旧版本写入的裸公钥条目重跑一键配置会自动升级。残余面：`PK_LOG_FILE` 允许远端向本机应用日志追加单行（换行已压平，仅限日志投毒）；远程 `~/.ssh/pk-shim-*` ControlMaster socket 同用户可读（标准 ssh 行为）。
- **假名化的残余边界**：假名化是本地词表替换（通讯录缓存 + 我的称呼 + 群名映射），不是模式识别——不在词表里的姓名、单字称呼不替换；消息里的 URL、文件名、时间戳原样送出；`pk context` 输出的分类名/标签描述、标签治理（体检）送出的标签名为用户自拟原文。以上内容都会到达你自配的 AI agent，介意请从源头避免写入。
