/// IPC 命令按业务域拆分：tasks / tags / tag_health / categories / radio / settings / integrations / skills / dispatch / diagnostics / windows / backup / tunnel。
/// lib.rs 的 generate_handler 通过 `commands::` 前缀引用，此处统一 re-export。
pub mod backup;
pub mod categories;
pub mod diagnostics;
pub mod dispatch;
pub mod export;
pub mod integrations;
pub mod pet;
pub mod radio;
pub mod remote_pk;
pub mod sessions;
pub mod settings;
pub mod skills;
pub mod tag_health;
pub mod tags;
pub mod tasks;
pub mod tunnel;
pub mod windows;

pub use backup::*;
pub use categories::*;
pub use diagnostics::*;
pub use dispatch::*;
pub use export::*;
pub use integrations::*;
pub use pet::*;
pub use radio::*;
pub use remote_pk::*;
pub use sessions::*;
pub use settings::*;
pub use skills::*;
pub use tag_health::*;
pub use tags::*;
pub use tasks::*;
pub use tunnel::*;
pub use windows::*;
