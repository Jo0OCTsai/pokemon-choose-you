/// IPC 命令按业务域拆分：tasks / categories / settings / integrations / windows。
/// lib.rs 的 generate_handler 通过 `commands::` 前缀引用，此处统一 re-export。
pub mod categories;
pub mod integrations;
pub mod settings;
pub mod tasks;
pub mod windows;

pub use categories::*;
pub use integrations::*;
pub use settings::*;
pub use tasks::*;
pub use windows::*;
