//! 待办派发 · M1 交互通道（docs/proposals/AGENT_DISPATCH_PROPOSAL.md §5.1/§5.2/§6）：
//! project 标签 meta 路由 → 确认后在新终端唤起 agent（本地 cd 直启 / 远程 ssh -tt + tmux
//! attach-or-create，注入走独立 BatchMode ssh），prompt 对不可信正文做定界隔离，
//! 每次派发先落一条 agent_sessions（§5.4，任务抽屉时间线可见）。
//! 子模块：meta 元数据 / route 路由与取数 / prompt 提示词 / cmdline 命令行组装 /
//! probe 预检 / state 状态机 / headless 无头通道 / exec 执行编排 / auto 自动派发循环。
mod auto;
mod cmdline;
mod exec;
mod headless;
mod meta;
mod probe;
mod prompt;
mod route;
mod state;
#[cfg(test)]
pub(crate) mod testsupport;

pub use auto::*;
pub(crate) use cmdline::*;
pub use exec::*;
pub use meta::*;
pub use route::*;
pub use state::*;
