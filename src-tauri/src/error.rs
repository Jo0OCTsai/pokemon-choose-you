use serde::ser::SerializeStruct;

/// 全部 IPC 命令的统一错误类型。
/// 序列化为 `{ kind, message, retryable }`，前端 api.ts 据此分层处理：
/// retryable（网络类）可提示重试，其余视为输入/配置/数据问题。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("未找到: {0}")]
    NotFound(String),
    #[error("输入无效: {0}")]
    Invalid(String),
    #[error("网络错误: {0}")]
    Network(String),
    #[error("外部服务错误: {0}")]
    External(String),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Network(_) => "network",
            AppError::External(_) => "external",
            AppError::Io(_) => "io",
        }
    }

    fn retryable(&self) -> bool {
        matches!(self, AppError::Network(_))
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.serialize_field("retryable", &self.retryable())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端 api.ts 依赖此 JSON 结构（kind/message/retryable），字段增删需同步前端
    #[test]
    fn serializes_kind_message_retryable() {
        let v = serde_json::to_value(AppError::Invalid("标题不能为空".into())).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "kind": "invalid", "message": "输入无效: 标题不能为空", "retryable": false })
        );
        let v = serde_json::to_value(AppError::Network("连接超时".into())).unwrap();
        assert_eq!(
            v["retryable"],
            serde_json::json!(true),
            "网络错误标记可重试"
        );
    }

    #[test]
    fn rusqlite_error_converts_via_from() {
        fn fall() -> AppResult<()> {
            Err(rusqlite::Error::QueryReturnedNoRows)?;
            Ok(())
        }
        let e = fall().unwrap_err();
        assert_eq!(serde_json::to_value(&e).unwrap()["kind"], "db");
    }
}
