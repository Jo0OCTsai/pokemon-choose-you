/// IPC 命令按业务域拆分：tasks / tags / categories / radio / settings / integrations / diagnostics / windows。
/// lib.rs 的 generate_handler 通过 `commands::` 前缀引用，此处统一 re-export。
pub mod categories;
pub mod diagnostics;
pub mod integrations;
pub mod radio;
pub mod settings;
pub mod tags;
pub mod tasks;
pub mod windows;

pub use categories::*;
pub use diagnostics::*;
pub use integrations::*;
pub use radio::*;
pub use settings::*;
pub use tags::*;
pub use tasks::*;
pub use windows::*;
