/// 前后端事件契约：所有跨窗口广播与后端 → 前端通知的事件名集中定义。
/// 前端镜像在 src/events.ts，两侧集合由各自的契约测试锁定，防止悄悄漂移。
pub const TASKS_CHANGED: &str = "tasks-changed";
pub const CATEGORIES_CHANGED: &str = "categories-changed";
pub const SETTINGS_CHANGED: &str = "settings-changed";
/// 收音机电波（chat_messages 表）有新消息或状态变化
pub const CHAT_MESSAGES_CHANGED: &str = "chat-messages-changed";
/// 标签配置变化（设置页维护，两窗口跟随）
pub const TAGS_CHANGED: &str = "tags-changed";
/// 提醒到期（scheduler → 桌宠窗口敲门动画），payload: { id, title, urgent }
pub const TASK_REMINDER: &str = "task-reminder";
/// 全局快捷键"快速捕捉待办"（后端 → 主窗口），前端聚焦新增输入框
pub const QUICK_CAPTURE: &str = "quick-capture";
/// 托盘"设置"菜单（后端 → 主窗口），前端切到设置页
pub const SHOW_SETTINGS: &str = "show-settings";
/// 自动更新检查发现新版本（后端 → 两窗口）
pub const UPDATE_AVAILABLE: &str = "update-available";
/// 更新包下载进度（后端 → 主窗口），payload: { downloaded, total }（字节）
pub const UPDATE_PROGRESS: &str = "update-progress";
/// 集成健康状态变化（飞书/AI/Todoist 链路的成功/失败记录），诊断页跟随刷新
pub const INTEGRATION_HEALTH_CHANGED: &str = "integration-health-changed";

/// 事件名全集（契约测试与前端 fixture 对齐用）
#[cfg(test)]
pub fn all() -> &'static [&'static str] {
    &[
        TASKS_CHANGED,
        CATEGORIES_CHANGED,
        SETTINGS_CHANGED,
        CHAT_MESSAGES_CHANGED,
        TAGS_CHANGED,
        TASK_REMINDER,
        QUICK_CAPTURE,
        SHOW_SETTINGS,
        UPDATE_AVAILABLE,
        UPDATE_PROGRESS,
        INTEGRATION_HEALTH_CHANGED,
    ]
}

/// 数据变更广播：主面板与桌宠是两个独立窗口，靠这些事件保持状态一致
/// （emitting 放在写库成功之后，前端收到事件后各自重新拉取）
pub fn broadcast<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    use tauri::Emitter;
    let _ = app.emit(event, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与 src/__tests__/events.spec.ts 的 fixture 逐一对齐；改名/增删事件两侧同时改
    #[test]
    fn event_names_match_frontend_contract() {
        assert_eq!(
            serde_json::to_string(all()).unwrap(),
            r#"["tasks-changed","categories-changed","settings-changed","chat-messages-changed","tags-changed","task-reminder","quick-capture","show-settings","update-available","update-progress","integration-health-changed"]"#,
            "事件名集合必须与前端 src/events.ts 一致"
        );
        // 事件名统一 kebab-case，防止大小写风格混用
        for name in all() {
            assert!(!name.contains('_'), "事件名应为 kebab-case: {name}");
        }
    }
}
