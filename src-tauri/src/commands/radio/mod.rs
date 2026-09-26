//! 收音机（AI 判定消息域）：store 消息存取、suggest 判定落库原语、review 分诊 IPC、
//! context 上下文渲染（feishu 轮询消费）、judge 判定管线、capture 手动捕捉。
//! mod.rs 只声明子模块并平铺 re-export——维持 commands::radio::X 与 commands::X 命名空间。
mod capture;
mod context;
mod judge;
mod review;
mod store;
mod suggest;
#[cfg(test)]
pub(crate) mod testsupport;

pub use capture::*;
pub(crate) use context::*;
pub use judge::*;
pub use review::*;
pub use store::*;
pub use suggest::*;
