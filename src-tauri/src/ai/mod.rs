//! AI agent 无头调用：配置（config）、命令行组装与 shell 引用规则（invocation）、
//! 判定提示词（prompts）、提示词覆盖目录与解析（prompt_overrides）、协议类型
//! （types）、进程执行与会话收集（runner）。
//! mod.rs 只声明子模块并平铺 re-export——对 crate 内与 pk CLI 维持 `ai::X`
//! 单一命名空间（消费方：radio / dispatch / skills / tunnel / integrations /
//! pet / diagnostics / feishu / pk CLI）。
mod config;
mod invocation;
mod prompt_overrides;
mod prompts;
mod runner;
mod types;

pub use config::*;
pub use invocation::*;
pub use prompts::*;
// prompt_overrides 全部条目为 crate 内消费（调用点解析 + 设置面命令 + 导出过滤），
// 按实际可见性 re-export
pub(crate) use prompt_overrides::*;
pub use runner::*;
pub use types::*;
