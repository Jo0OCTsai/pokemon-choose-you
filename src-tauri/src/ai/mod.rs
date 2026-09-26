//! AI agent 无头调用：配置（config）、命令行组装与 shell 引用规则（invocation）、
//! 判定提示词（prompts）、协议类型（types）、进程执行与会话收集（runner）。
//! mod.rs 只声明子模块并平铺 re-export——对 crate 内与 pk CLI 维持 `ai::X`
//! 单一命名空间（消费方：radio / dispatch / skills / tunnel / integrations /
//! pet / diagnostics / feishu / pk CLI）。
mod config;
mod invocation;
mod prompts;
mod runner;
mod types;

pub use config::*;
pub use invocation::*;
pub use prompts::*;
pub use runner::*;
pub use types::*;
