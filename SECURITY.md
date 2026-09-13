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

- **安装包未做 OS 代码签名**（macOS 不购买开发者账号；Windows SignPath 免费签名申请中）：
  - macOS 首次打开需 Gatekeeper「右键 → 打开 / 仍要打开」；
  - Windows SmartScreen 提示时走「更多信息 → 仍要运行」。
  - 从 GitHub Releases 官方渠道下载的包可由下方方式校验完整性。
- **自动更新走 minisign 独立签名**（与 OS 代码签名相互独立）：更新包由发布流水线签名，公钥内置于应用（`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`），安装前强制校验，无法被替换为未签名的安装包。
- **本地数据**：任务/设置明文存储于本机 SQLite；AI / Todoist 凭证同样本地存储（优先系统钥匙串），仅用于直连对应服务，不上传到任何第三方。飞书凭证由官方 lark-cli 自己保管，不进本应用。使用自建 AI 接口时请注意数据会流经你所配置的服务商。
