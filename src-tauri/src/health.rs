use std::collections::HashMap;
use std::sync::Mutex;

/// 集成健康状态：三条外部链路（feishu / ai / todoist）的运行时记录。
/// 内存态（重启后重新积累），每次成功/失败变化广播事件供诊断页刷新。
#[derive(Default)]
pub struct HealthState(pub Mutex<HashMap<String, ProviderHealth>>);

pub const FEISHU: &str = "feishu";
pub const AI: &str = "ai";
pub const TODOIST: &str = "todoist";

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<String>,
    pub consecutive_failures: u32,
    /// 下次预计运行时间（epoch 毫秒），目前只有飞书轮询循环维护
    pub next_run_at: Option<i64>,
}

/// 状态归并：off 未配置 / paused 已配置未启用 / idle 已启用尚未运行 /
/// ok 正常 / degraded 降级（1-2 次连续失败，退避重试中）/ down 故障（≥3 次）
pub fn level(configured: bool, enabled: bool, ran: bool, failures: u32) -> &'static str {
    if !configured {
        return "off";
    }
    if !enabled {
        return "paused";
    }
    match failures {
        0 if !ran => "idle",
        0 => "ok",
        1..=2 => "degraded",
        _ => "down",
    }
}

impl HealthState {
    fn mutate<R>(&self, provider: &str, f: impl FnOnce(&mut ProviderHealth) -> R) -> R {
        let mut map = self.0.lock().unwrap();
        f(map.entry(provider.to_string()).or_default())
    }

    pub fn record_success<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, provider: &str) {
        self.mutate(provider, |h| {
            h.last_success_at = Some(crate::db::now());
            h.consecutive_failures = 0;
        });
        broadcast_health(app);
    }

    /// 失败记录截断到 300 字符，避免长错误刷爆事件载荷
    pub fn record_failure<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        provider: &str,
        error: &str,
    ) {
        let brief: String = error.chars().take(300).collect();
        self.mutate(provider, |h| {
            h.last_error = Some(brief);
            h.last_error_at = Some(crate::db::now());
            h.consecutive_failures += 1;
        });
        broadcast_health(app);
    }

    /// 轮询循环入睡前登记下次预计运行时间（不广播，避免事件刷屏；
    /// 诊断页按本地时钟对照该时间显示倒计时）
    pub fn set_next_run(&self, provider: &str, at_ms: i64) {
        self.mutate(provider, |h| h.next_run_at = Some(at_ms));
    }

    pub fn snapshot(&self, provider: &str) -> ProviderHealth {
        self.0
            .lock()
            .unwrap()
            .get(provider)
            .cloned()
            .unwrap_or_default()
    }
}

fn broadcast_health<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Emitter;
    let _ = app.emit(crate::events::INTEGRATION_HEALTH_CHANGED, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_classifies_provider_state() {
        assert_eq!(level(false, false, false, 0), "off");
        assert_eq!(level(true, false, false, 0), "paused");
        assert_eq!(level(true, true, false, 0), "idle");
        assert_eq!(level(true, true, true, 0), "ok");
        assert_eq!(level(true, true, true, 1), "degraded");
        assert_eq!(level(true, true, true, 2), "degraded");
        assert_eq!(level(true, true, true, 3), "down");
    }

    #[test]
    fn failures_accumulate_then_reset_on_success() {
        let state = HealthState::default();
        let app = tauri::test::mock_app();
        let handle = app.handle();
        for i in 0..3 {
            state.record_failure(handle, FEISHU, &format!("第{i}次失败"));
        }
        let h = state.snapshot(FEISHU);
        assert_eq!(h.consecutive_failures, 3);
        assert!(h.last_error.as_deref().unwrap().contains("第2次失败"));
        assert!(h.last_error_at.is_some() && h.last_success_at.is_none());

        state.record_success(handle, FEISHU);
        let h = state.snapshot(FEISHU);
        assert_eq!(h.consecutive_failures, 0, "成功后清零");
        assert!(h.last_success_at.is_some());
        assert_eq!(
            h.last_error.as_deref(),
            Some("第2次失败"),
            "历史错误保留供回看"
        );
    }

    #[test]
    fn record_failure_truncates_long_errors() {
        let state = HealthState::default();
        let app = tauri::test::mock_app();
        let long = "痛".repeat(1000);
        state.record_failure(app.handle(), AI, &long);
        assert_eq!(state.snapshot(AI).last_error.unwrap().chars().count(), 300);
    }

    #[test]
    fn set_next_run_updates_without_event_assert() {
        let state = HealthState::default();
        state.set_next_run(FEISHU, 1_789_000_000_000);
        assert_eq!(state.snapshot(FEISHU).next_run_at, Some(1_789_000_000_000));
        // 未记录过的 provider 快照安全退化为默认值
        assert_eq!(state.snapshot(TODOIST), ProviderHealth::default());
    }
}
