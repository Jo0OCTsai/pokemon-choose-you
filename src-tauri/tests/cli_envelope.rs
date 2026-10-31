//! CLI 信封契约 oracle：锁定 pk 命令面的 stdout / stderr / 退出码信封（双实现
//! 一致性的 Rust 基线）。场景 = contracts/scenarios/cli_envelope/*.json（命令自举
//! 数据，无预置种子），期望 = contracts/fixtures/cli_envelope/（UPDATE_FIXTURES=1
//! 再生，禁手改）。TS 侧（dsh-plugin）以同款 spawn + 归一化回放比对——任一实现
//! 信封漂移即红。
//!
//! 归一化（双侧同构，见 normalize）：`<tsN>` ISO 时间戳按 invocation 内出现序编号、
//! `<pk-version>` 工具自身版本（help --json 顶层 version 与裸 version 输出）、
//! `<home>` 家目录前缀——非确定字段的全部来源。skill show 不入组（全文与内嵌同源
//! 另有断言）；doctor / remote setup / __ssh_entry 依赖真实环境与副作用，不入组
//! （由各自单测锁结构）。

use serde_json::{json, Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

struct Invocation {
    argv: Vec<String>,
    stdin: Option<String>,
    env: Vec<(String, String)>,
}

/// 场景可选种子：suggest 族（update/none/follow-up/batch）要求消息已存在于
/// chat_messages（应用侧写入，pk 命令面无自举路径）——最小列集 INSERT，其余列走
/// schema 缺省。id/createdAt 显式给值，输出确定。
struct ChatSeed {
    id: i64,
    message_id: String,
    content: String,
    created_at: String,
}

struct Scenario {
    name: String,
    chat_seeds: Vec<ChatSeed>,
    invocations: Vec<Invocation>,
}

fn scenarios_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/scenarios/cli_envelope")
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/cli_envelope")
}

fn update_fixtures() -> bool {
    std::env::var("UPDATE_FIXTURES").ok().as_deref() == Some("1")
}

/// 场景目录清单（文件名排序，双侧遍历序一致的锚点之一）
fn scenario_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(scenarios_dir())
        .expect("scenarios/cli_envelope 目录存在")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "信封场景目录为空");
    files
}

fn load_scenario(path: &Path) -> Scenario {
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap())
        .unwrap_or_else(|e| panic!("{} 解析失败: {e}", path.display()));
    let name = path.file_stem().unwrap().to_string_lossy().into_owned();
    assert_eq!(
        raw["name"].as_str(),
        Some(name.as_str()),
        "name 字段与文件名一致: {name}"
    );
    let chat_seeds = raw["setup"]["chatMessages"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| ChatSeed {
                    id: m["id"].as_i64().expect("chatMessages.id"),
                    message_id: m["messageId"]
                        .as_str()
                        .expect("chatMessages.messageId")
                        .to_string(),
                    content: m["content"]
                        .as_str()
                        .expect("chatMessages.content")
                        .to_string(),
                    created_at: m["createdAt"]
                        .as_str()
                        .expect("chatMessages.createdAt")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let invocations = raw["invocations"]
        .as_array()
        .unwrap_or_else(|| panic!("{} 缺 invocations", path.display()))
        .iter()
        .map(|inv| Invocation {
            argv: inv["argv"]
                .as_array()
                .expect("argv 数组")
                .iter()
                .map(|v| v.as_str().expect("argv 项为字符串").to_string())
                .collect(),
            stdin: inv["stdin"].as_str().map(str::to_string),
            env: inv["env"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| (k.clone(), v.as_str().expect("env 值为字符串").to_string()))
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect();
    Scenario {
        name,
        chat_seeds,
        invocations,
    }
}

/// 单次调用：cwd 限定在场景工作目录（相对 --dir 类参数的落点），PK_DB 指向场景库，
/// 剥离宿主注入的 PK_* 环境后按场景 env 重注入
fn spawn_pk(pk: &str, workdir: &Path, inv: &Invocation) -> Output {
    let mut cmd = Command::new(pk);
    cmd.args(&inv.argv)
        .current_dir(workdir)
        .env("PK_DB", workdir.join("env.db"))
        .env_remove("PK_LOG_FILE")
        .env_remove("PK_SSH_BIN")
        .env_remove("PK_DISPATCH_TASK");
    for (k, v) in &inv.env {
        cmd.env(k, v);
    }
    let child = cmd
        .stdin(if inv.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn pk");
    let mut child = child;
    if let Some(payload) = &inv.stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.as_bytes())
            .expect("写 stdin");
    }
    child.wait_with_output().expect("等 pk 退出")
}

fn is_iso_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
        && b[10] == b'T'
}

fn is_pk_version(s: &str) -> bool {
    // 三段数字开头即可（兼容 prerelease 后缀，与 TS 回放侧同款判定）
    let mut parts = s.splitn(3, '.');
    let all_digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    match (parts.next(), parts.next(), parts.next()) {
        (Some(a), Some(b), Some(c)) => all_digits(a) && all_digits(b) && all_digits(c),
        _ => false,
    }
}

fn normalize_str(s: &str, home: &str, workdir: &str, ts: &mut usize) -> String {
    if is_iso_timestamp(s) {
        *ts += 1;
        return format!("<ts{ts}>");
    }
    s.replace(workdir, "<cwd>").replace(home, "<home>")
}

fn normalize(v: &Value, home: &str, workdir: &str, ts: &mut usize) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, val) in map {
                if k == "version" && val.as_str().is_some_and(is_pk_version) {
                    out.insert(k.clone(), Value::String("<pk-version>".into()));
                } else {
                    out.insert(k.clone(), normalize(val, home, workdir, ts));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|x| normalize(x, home, workdir, ts))
                .collect(),
        ),
        Value::String(s) => Value::String(normalize_str(s, home, workdir, ts)),
        other => other.clone(),
    }
}

/// 输出信封归一：可解析 JSON → 字段树递归归一；纯文本 → 整串 semver 视为版本、
/// home 前缀替换（时间戳归一仅发生在 JSON 值内，纯文本命令无时间戳输出）
fn normalize_output(raw: &[u8], home: &str, workdir: &str) -> Value {
    let text = String::from_utf8_lossy(raw).trim_end().to_string();
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => normalize(&v, home, workdir, &mut 0),
        Err(_) => {
            if is_pk_version(&text) {
                Value::String("<pk-version>".into())
            } else {
                Value::String(text.replace(workdir, "<cwd>").replace(home, "<home>"))
            }
        }
    }
}

fn scenario_fixture(pk: &str, sc: &Scenario, home: &str) -> Value {
    let workdir =
        std::env::temp_dir().join(format!("pk-cli-env-{}-{}", sc.name, std::process::id()));
    let _ = std::fs::remove_dir_all(&workdir);
    std::fs::create_dir_all(&workdir).unwrap();
    // 归一化替换源用 realpath：macOS 的 current_dir 返回 /private 前缀真路径，
    // 与 temp_dir 逻辑路径不同串——不消解则 <cwd> 替换残留平台差异进夹具
    let workdir_str = std::fs::canonicalize(&workdir)
        .unwrap_or_else(|_| workdir.clone())
        .to_string_lossy()
        .into_owned();
    // 预备：独立库引导（open_db 对缺失库报错，init-db 是官方引导路径）
    let prep = Invocation {
        argv: vec!["init-db".into()],
        stdin: None,
        env: vec![],
    };
    let prep_out = spawn_pk(pk, &workdir, &prep);
    assert!(
        prep_out.status.success(),
        "init-db 预备失败: {}",
        String::from_utf8_lossy(&prep_out.stderr)
    );
    if !sc.chat_seeds.is_empty() {
        let conn = rusqlite::Connection::open(workdir.join("env.db")).unwrap();
        for seed in &sc.chat_seeds {
            conn.execute(
                "INSERT INTO chat_messages (id, message_id, content, created_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![seed.id, seed.message_id, seed.content, seed.created_at],
            )
            .unwrap_or_else(|e| panic!("{}: 种子插入失败: {e}", sc.name));
        }
    }
    let results: Vec<Value> = sc
        .invocations
        .iter()
        .map(|inv| {
            let out = spawn_pk(pk, &workdir, inv);
            json!({
                "exitCode": out.status.code(),
                "stdout": normalize_output(&out.stdout, home, &workdir_str),
                "stderr": normalize_output(&out.stderr, home, &workdir_str),
            })
        })
        .collect();
    let _ = std::fs::remove_dir_all(&workdir);
    json!({ "kind": "cli_envelope", "name": sc.name, "results": results })
}

#[test]
fn cli_envelope_oracle() {
    let pk = env!("CARGO_BIN_EXE_pk");
    let home = dirs::home_dir()
        .expect("home")
        .to_string_lossy()
        .into_owned();
    let files = scenario_files();
    // 完备性：fixtures 与 scenarios 一一对应（多余/遗漏的夹具即红）
    let fixture_count = std::fs::read_dir(fixtures_dir())
        .expect("fixtures/cli_envelope 目录存在")
        .filter(|e| {
            e.as_ref()
                .is_ok_and(|e| e.path().extension().is_some_and(|x| x == "json"))
        })
        .count();
    assert_eq!(
        fixture_count,
        files.len(),
        "信封场景与夹具数量不一致（先 UPDATE_FIXTURES=1 生成/清理孤儿夹具）"
    );
    for path in files {
        let sc = load_scenario(&path);
        let fixture = scenario_fixture(pk, &sc, &home);
        let fixture_path = fixtures_dir().join(format!("{}.json", sc.name));
        if update_fixtures() {
            let pretty = format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap());
            std::fs::write(&fixture_path, pretty).unwrap();
        } else {
            let existing: Value =
                serde_json::from_str(&std::fs::read_to_string(&fixture_path).unwrap_or_else(
                    |_| panic!("{}: 夹具缺失（先 UPDATE_FIXTURES=1 生成）", sc.name),
                ))
                .unwrap();
            assert_eq!(
                existing, fixture,
                "{}: 信封漂移（行为变更须显式 UPDATE_FIXTURES=1 重生成）",
                sc.name
            );
        }
    }
}
