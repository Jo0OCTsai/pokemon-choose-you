# 方案与调研（Proposals）

功能设计方案与调研文档的归档目录，回答「为什么这么设计」——现状分析、调研结论、方案与实施状态。
与面向使用者的 [USER_GUIDE](../USER_GUIDE.md)、面向开发的 [DEVELOPMENT](../DEVELOPMENT.md) 区分。

| 文档 | 主题 | 状态 |
|---|---|---|
| [FEISHU_MESSAGE_ANALYSIS.md](FEISHU_MESSAGE_ANALYSIS.md) | 飞书消息分析策略（收音机） | 已落地，策略持续 review |
| [TAG_SYSTEM_PROPOSAL.md](TAG_SYSTEM_PROPOSAL.md) | 标签体系维度化 + AI 自动治理 | P1–P5 已落地（P5 的保存视图与 projects 表平移为可选项未做） |
| [MEMORY_KNOWLEDGE_PROPOSAL.md](MEMORY_KNOWLEDGE_PROPOSAL.md) | 分层记忆 + 本地知识检索 | 方案（未实施） |
| [AGENT_DISPATCH_PROPOSAL.md](AGENT_DISPATCH_PROPOSAL.md) | 待办驱动的 Agent 调度 | M1–M3 已全部落地 |
| [PET_EXPERIENCE_PROPOSAL.md](PET_EXPERIENCE_PROPOSAL.md) | 桌宠体验升级（输入响应/对话/时间与空间感知） | M1–M3 已落地（EdgeTTS 云引擎档未做） |

约定：新提案放本目录，命名 `TOPIC_PROPOSAL.md`（分析类用 `_ANALYSIS.md`）；实施状态写在文首引言，随落地更新；互引与 README.md 中的引用使用 `docs/proposals/` 前缀路径。
