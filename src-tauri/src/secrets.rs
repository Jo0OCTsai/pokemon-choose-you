//! 秘钥存取：优先 OS 钥匙串（macOS Keychain / Windows Credential Manager /
//! Linux Secret Service），无钥匙串环境（无 D-Bus 的 WSL / 无头服务器）回落 settings 表。
//!
//! - 读：钥匙串命中优先，未命中回落 settings 表（兼容迁移前的存量数据）
//! - 写：钥匙串可用则写入并清掉 settings 行（数据只留一份、留原地）；
//!   不可用则回落 settings 表，功能不受影响
//! - `PK_SECRETS_IN_DB=1` 强制走 settings 表（无 Secret Service 的环境可显式指定，
//!   也让测试与运行行为确定）
use crate::error::AppResult;
use rusqlite::{params, Connection};
use std::sync::OnceLock;

/// 钥匙串里的服务名（同一服务下按 key 区分条目）
const SERVICE: &str = "pokemon-choose-you";

/// 走秘钥链路的设置键（其余设置仍存 settings 表）
pub const SECRET_KEYS: &[&str] = &["todoist_token"];

/// 已下线的 builtin 飞书引擎遗留键：settings 行 + 钥匙串条目都清掉。
/// 秘钥类三个走 secret_delete（两边都清，无残留不算失败），其余普通行 SQL 删除。
pub fn purge_legacy_feishu_keys(conn: &Connection) {
    const LEGACY_SECRET_KEYS: &[&str] = &[
        "feishu_app_secret",
        "feishu_user_token",
        "feishu_refresh_token",
    ];
    const LEGACY_SETTINGS_KEYS: &[&str] = &[
        "feishu_engine",
        "feishu_app_id",
        "feishu_token_expires_at",
        "feishu_user_open_id",
        "feishu_user_name",
    ];
    let mut purged = 0;
    for key in LEGACY_SECRET_KEYS {
        if secret_delete(conn, key).is_err() {
            log::warn!("secrets: 清理遗留秘钥 {key} 失败");
        }
    }
    for key in LEGACY_SETTINGS_KEYS {
        if let Ok(n) = conn.execute("DELETE FROM settings WHERE key=?1", params![key]) {
            purged += n;
        }
    }
    if purged > 0 {
        log::info!("secrets: 已清理 builtin 飞书引擎遗留设置 {purged} 项");
    }
}

pub fn is_secret_key(key: &str) -> bool {
    SECRET_KEYS.contains(&key)
}

/// list_all_settings 对已保存秘钥返回的占位值（前端展示「已保存」、原样保存时跳过）
pub const STORED_SENTINEL: &str = "__STORED__";

/// 钥匙串可用性：启动后探测一次（写删一条探测凭证），失败按不可用处理。
/// 探测而非试探性写入，避免「半可用」状态反复打日志。
/// 测试进程恒为不可用：单测不应触碰真实系统钥匙串（macOS 会弹授权框），
/// 回落路径的读写/迁移行为已覆盖核心逻辑。
fn keyring_available() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        if cfg!(test) {
            return false;
        }
        if std::env::var_os("PK_SECRETS_IN_DB").is_some_and(|v| v != "0") {
            log::info!("secrets: PK_SECRETS_IN_DB 已设置，秘钥走 settings 表");
            return false;
        }
        let probe = format!("probe-{}", std::process::id());
        let ok = (|| -> bool {
            let entry = match keyring::Entry::new(SERVICE, &probe) {
                Ok(e) => e,
                Err(_) => return false,
            };
            entry.set_password("probe").is_ok()
                && matches!(entry.get_password().as_deref(), Ok("probe"))
                && entry.delete_credential().is_ok()
        })();
        log::info!(
            "secrets: OS 钥匙串{}可用，秘钥将{}",
            if ok { "" } else { "不" },
            if ok {
                "存入钥匙串"
            } else {
                "留在 settings 表（回落）"
            }
        );
        ok
    })
}

/// 读秘钥：钥匙串优先，回落 settings 表。
/// 只有秘钥键才查钥匙串——settings_getter 把所有设置键都路由到这里，飞书轮询等
/// 高频调用方每个键都跑一趟 Keychain IPC，既慢又把 keyring_core 的 debug 日志刷满。
pub fn secret_get(conn: &Connection, key: &str) -> Option<String> {
    if is_secret_key(key) && keyring_available() {
        if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
            match entry.get_password() {
                Ok(v) if !v.is_empty() => return Some(v),
                Ok(_) => return None,              // 空串视为未存
                Err(keyring::Error::NoEntry) => {} // 钥匙串没有 → 回落存量数据
                Err(e) => log::warn!("secrets: 读钥匙串 {key} 失败，回落 settings 表: {e}"),
            }
        }
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1 AND value != ''",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// 写秘钥：空值视为删除。钥匙串可用时写入并清掉 settings 行（避免明文残留）
pub fn secret_set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    if value.is_empty() {
        return secret_delete(conn, key);
    }
    if keyring_available() {
        if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
            match entry.set_password(value) {
                Ok(()) => {
                    // 迁移完成：明文不再留在库里
                    let _ = conn.execute("DELETE FROM settings WHERE key=?1", params![key]);
                    return Ok(());
                }
                Err(e) => log::warn!("secrets: 写钥匙串 {key} 失败，回落 settings 表: {e}"),
            }
        }
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )?;
    Ok(())
}

/// 删秘钥：两边都清（钥匙串失败不阻断）
pub fn secret_delete(conn: &Connection, key: &str) -> AppResult<()> {
    if keyring_available() {
        if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
            if let Err(e) = entry.delete_credential() {
                if !matches!(e, keyring::Error::NoEntry) {
                    log::warn!("secrets: 删钥匙串 {key} 失败: {e}");
                }
            }
        }
    }
    conn.execute("DELETE FROM settings WHERE key=?1", params![key])?;
    Ok(())
}

/// 启动迁移：把 settings 表里的存量秘钥搬进钥匙串（不可用则原样保留，回落逻辑兜底）。
/// 返回迁移条数。
pub fn migrate_settings_secrets(conn: &Connection) -> usize {
    if !keyring_available() {
        return 0;
    }
    let mut moved = 0;
    for key in SECRET_KEYS {
        let legacy: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1 AND value != ''",
                params![key],
                |r| r.get(0),
            )
            .ok();
        if let Some(v) = legacy {
            match keyring::Entry::new(SERVICE, key).and_then(|e| e.set_password(&v)) {
                Ok(()) => {
                    let _ = conn.execute("DELETE FROM settings WHERE key=?1", params![key]);
                    moved += 1;
                    log::info!("secrets: {key} 已迁入 OS 钥匙串");
                }
                Err(e) => log::warn!("secrets: 迁移 {key} 失败（保留在 settings 表）: {e}"),
            }
        }
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;

    fn setting(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }

    /// 回落路径（测试进程恒无钥匙串）：写进 settings 表、读回一致、空值删除两边都清
    #[test]
    fn secret_roundtrip_via_settings_fallback() {
        let conn = test_conn();
        secret_set(&conn, "todoist_token", "tok-1").unwrap();
        assert_eq!(secret_get(&conn, "todoist_token").as_deref(), Some("tok-1"));
        assert_eq!(setting(&conn, "todoist_token").as_deref(), Some("tok-1"));

        // 覆写生效
        secret_set(&conn, "todoist_token", "tok-2").unwrap();
        assert_eq!(secret_get(&conn, "todoist_token").as_deref(), Some("tok-2"));

        // 空值视为删除
        secret_set(&conn, "todoist_token", "").unwrap();
        assert_eq!(secret_get(&conn, "todoist_token"), None);
        assert_eq!(setting(&conn, "todoist_token"), None);

        // 显式删除同效
        secret_set(&conn, "todoist_token", "x").unwrap();
        secret_delete(&conn, "todoist_token").unwrap();
        assert_eq!(secret_get(&conn, "todoist_token"), None);
    }

    /// 无钥匙串环境：迁移保持 no-op，存量明文原样保留（回落逻辑继续可读）
    #[test]
    fn migrate_is_noop_without_keyring() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('todoist_token', 'legacy-plain')",
            [],
        )
        .unwrap();
        assert_eq!(migrate_settings_secrets(&conn), 0);
        assert_eq!(
            secret_get(&conn, "todoist_token").as_deref(),
            Some("legacy-plain")
        );
        // 空值/缺行的库迁移同样安全
        secret_set(&conn, "todoist_token", "").unwrap();
        assert_eq!(migrate_settings_secrets(&conn), 0);
    }

    #[test]
    fn is_secret_key_matches_known_keys() {
        assert!(is_secret_key("todoist_token"));
        assert!(!is_secret_key("feishu_user_token"));
        assert!(!is_secret_key("feishu_app_secret"));
        assert!(!is_secret_key("language"));
        assert!(!is_secret_key("ai_agents"));
    }

    /// builtin 飞书引擎下线后的遗留清理：settings 行与秘钥回落数据都删干净，幂等
    #[test]
    fn purge_legacy_feishu_keys_removes_all_traces() {
        let conn = test_conn();
        for (k, v) in [
            ("feishu_engine", "builtin"),
            ("feishu_app_id", "cli_x"),
            ("feishu_app_secret", "s"),
            ("feishu_user_token", "t"),
            ("feishu_refresh_token", "r"),
            ("feishu_token_expires_at", "99"),
            ("feishu_user_open_id", "ou"),
            ("feishu_user_name", "我"),
            ("todoist_token", "keep"),
        ] {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )
            .unwrap();
        }
        purge_legacy_feishu_keys(&conn);
        for key in [
            "feishu_engine",
            "feishu_app_id",
            "feishu_app_secret",
            "feishu_user_token",
            "feishu_refresh_token",
            "feishu_token_expires_at",
            "feishu_user_open_id",
            "feishu_user_name",
        ] {
            assert_eq!(setting(&conn, key), None, "{key} 应被清理");
        }
        assert_eq!(
            secret_get(&conn, "todoist_token").as_deref(),
            Some("keep"),
            "无关秘键不受影响"
        );
        // 幂等：重复清理无副作用
        purge_legacy_feishu_keys(&conn);
        assert_eq!(setting(&conn, "feishu_app_id"), None);
    }
}
