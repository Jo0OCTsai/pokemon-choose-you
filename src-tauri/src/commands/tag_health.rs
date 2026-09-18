//! 标签体检（复盘向导「标签体检」步骤的后端）：
//! 本地相似度预筛近义合并候选 + 僵尸标签识别；配置了 agent 时走 LLM judge
//! 复核候选、并建议新维度。所有建议只呈报，动作（合并/放生/迁维度）由用户在向导里逐条执行。

use crate::ai::{self, AgentConfig};
use crate::commands::tags::list_tags_conn;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::Tag;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

/// 近义候选门槛：归一化编辑距离 1 - dist/max_len
const SIMILARITY_THRESHOLD: f64 = 0.7;
/// 预筛候选对上限（送 LLM 的 prompt 体积保护）
const MAX_CANDIDATE_PAIRS: usize = 20;
/// 僵尸标签：创建超过 N 天、从未挂上任务、且非用户手建（AI/捕捉/agent 建的才可能是造词失误）
const ZOMBIE_MIN_AGE_DAYS: i64 = 90;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCandidate {
    pub from_id: i64,
    pub from_name: String,
    pub into_id: i64,
    pub into_name: String,
    /// 归属维度 key
    pub dimension: String,
    /// 本地预筛相似度 0~1
    pub similarity: f64,
    /// LLM 是否已复核（false = 未配置 agent 或判定失败，仅相似度预筛）
    pub judged: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZombieTag {
    pub id: i64,
    pub name: String,
    pub dimension: String,
    pub origin: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDimensionSuggestion {
    pub name: String,
    /// 建议归入该维度的既有标签名
    pub tags: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCheckupReport {
    pub merges: Vec<MergeCandidate>,
    pub zombies: Vec<ZombieTag>,
    pub new_dimensions: Vec<NewDimensionSuggestion>,
    /// LLM 是否参与了本次判定
    pub judged: bool,
}

/// 体检：词表快照 + agent 配置在锁内取，LLM 判定在锁外跑（run_agent 是 await）
#[tauri::command]
pub async fn tag_checkup(db: State<'_, Db>) -> AppResult<TagCheckupReport> {
    let (tags, agent) = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        (list_tags_conn(&conn)?, ai::primary_agent(&get))
    };
    let mut report = local_report(&tags);
    if let Some(agent) = agent {
        match judge_with_agent(&agent, &tags, &mut report).await {
            Ok(()) => report.judged = true,
            Err(e) => log::warn!("tag_health: LLM 判定失败，按本地预筛结果展示: {e}"),
        }
    }
    Ok(report)
}

/// 本地体检：僵尸标签 + 相似度候选（不判真伪，交给用户或 LLM）
fn local_report(tags: &[Tag]) -> TagCheckupReport {
    let now = chrono::Utc::now();
    let zombies = tags
        .iter()
        .filter(|t| {
            t.usage == 0
                && matches!(t.origin.as_str(), "ai" | "nl" | "agent")
                && t.created_at
                    .parse::<chrono::DateTime<chrono::Utc>>()
                    .map(|at| now.signed_duration_since(at).num_days() > ZOMBIE_MIN_AGE_DAYS)
                    .unwrap_or(false)
        })
        .map(|t| ZombieTag {
            id: t.id,
            name: t.name.clone(),
            dimension: t.dimension.clone(),
            origin: t.origin.clone(),
            created_at: t.created_at.clone(),
        })
        .collect();

    let mut merges = vec![];
    'pair: for i in 0..tags.len() {
        for j in (i + 1)..tags.len() {
            let (a, b) = (&tags[i], &tags[j]);
            if a.dimension != b.dimension {
                continue;
            }
            let sim = pair_similarity(&a.name, &b.name);
            if sim < SIMILARITY_THRESHOLD {
                continue;
            }
            // 保留使用多的一侧（次多/零使用的并入）；同使用次数保留 id 靠前的
            let (from, into) = if (b.usage, a.id) > (a.usage, b.id) {
                (a, b)
            } else {
                (b, a)
            };
            merges.push(MergeCandidate {
                from_id: from.id,
                from_name: from.name.clone(),
                into_id: into.id,
                into_name: into.name.clone(),
                dimension: a.dimension.clone(),
                similarity: sim,
                judged: false,
                reason: None,
            });
            if merges.len() >= MAX_CANDIDATE_PAIRS {
                break 'pair;
            }
        }
    }

    TagCheckupReport {
        merges,
        zombies,
        new_dimensions: vec![],
        judged: false,
    }
}

/// 归一化相似度：1 - 编辑距离 / 较长串字符数；互为包含（短侧 >= 2 字）直接视为高度相似。
/// 中文安全（按字符比较），本地词表量级下两两 DP 足够
fn pair_similarity(a: &str, b: &str) -> f64 {
    let x: Vec<char> = a.chars().collect();
    let y: Vec<char> = b.chars().collect();
    let (short, long) = if x.len() <= y.len() { (&x, &y) } else { (&y, &x) };
    if long.is_empty() {
        return 0.0;
    }
    if x == y {
        return 1.0;
    }
    if short.len() >= 2 && long.windows(short.len()).any(|w| w == short.as_slice()) {
        return 0.9;
    }
    let mut prev: Vec<u32> = (0..=short.len() as u32).collect();
    let mut cur = vec![0u32; short.len() + 1];
    for li in 1..=long.len() {
        cur[0] = li as u32;
        for si in 1..=short.len() {
            let cost = if long[li - 1] == short[si - 1] { 0 } else { 1 };
            cur[si] = (prev[si] + 1).min(cur[si - 1] + 1).min(prev[si - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    1.0 - prev[short.len()] as f64 / long.len() as f64
}

// ---- LLM judge（走既有 agent 通道） ----

#[derive(Default, Deserialize)]
struct JudgeVerdict {
    #[serde(default)]
    merges: Vec<JudgeMerge>,
    #[serde(default, rename = "newDimensions")]
    new_dimensions: Vec<JudgeNewDim>,
}

#[derive(Default, Deserialize)]
struct JudgeMerge {
    #[serde(default)]
    from: String,
    #[serde(default)]
    into: String,
    #[serde(default)]
    merge: bool,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct JudgeNewDim {
    #[serde(default)]
    name: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// LLM 复核：确认/否决本地候选并补充理由，另可建议新维度。
/// 判定失败不致命——调用方保留本地预筛结果（judged=false）
async fn judge_with_agent(agent: &AgentConfig, tags: &[Tag], report: &mut TagCheckupReport) -> AppResult<()> {
    let mut prompt = String::from(
        "你是待办应用的标签词表治理助手。下面是当前标签词表（按维度分组，含使用次数）与一组「近义合并候选对」（本地字符串相似度预筛，可能有误报）。请复核并只输出一个 JSON 对象（不要解释、不要 Markdown）。\n任务：\n1. merges：逐对判断是否真的同义/重复——只有表达同一含义才 merge=true，给出 into（应保留的规范名，优先使用次数多的）与不超过 20 字的理由；字面相似但含义不同的判 false。\n2. newDimensions：如果发现 >=3 个标签语义上同属一个现有维度之外的新分类面（如「精力」「渠道」），建议最多 2 个新维度（name 用 2~4 字中文，tags 列出应归入的既有标签名）；没有就给空数组。\n输出格式：{\"merges\":[{\"from\":\"名\",\"into\":\"名\",\"merge\":true,\"reason\":\"...\"}],\"newDimensions\":[{\"name\":\"名\",\"tags\":[\"名\"],\"reason\":\"...\"}]}\n\n词表：\n",
    );
    let mut dim = String::new();
    for t in tags {
        if t.dimension != dim {
            dim = t.dimension.clone();
            prompt.push_str(&format!("- 维度 {dim}："));
        } else {
            prompt.push('、');
        }
        prompt.push_str(&format!("{}（{} 次）", t.name, t.usage));
    }
    if !report.merges.is_empty() {
        prompt.push_str("\n\n候选对：\n");
        for (i, m) in report.merges.iter().enumerate() {
            prompt.push_str(&format!(
                "{}. 「{}」vs「{}」（相似度 {:.2}，维度 {}）\n",
                i + 1,
                m.from_name,
                m.into_name,
                m.similarity,
                m.dimension
            ));
        }
    }

    let out = ai::run_agent(agent, &prompt).await?;
    let verdict = parse_verdict(&out)?;
    let find = |name: &str, dimension: &str| {
        tags.iter()
            .find(|t| t.name == name && t.dimension == dimension)
    };

    // 只保留 LLM 确认的候选，且 from/into 必须都能在词表里找到（防幻觉）；
    // LLM 给的 into 为空或找不到时沿用预筛方向
    let mut confirmed = vec![];
    for v in &verdict.merges {
        if !v.merge {
            continue;
        }
        let Some(m) = report
            .merges
            .iter()
            .find(|m| same_pair(&v.from, &v.into, m))
        else {
            continue;
        };
        let mut kept = m.clone();
        kept.judged = true;
        kept.reason = v.reason.clone().or(kept.reason);
        if let Some(into) = find(&v.into, &m.dimension) {
            let from = find(&v.from, &m.dimension).unwrap();
            kept.from_id = from.id;
            kept.from_name = from.name.clone();
            kept.into_id = into.id;
            kept.into_name = into.name.clone();
        }
        confirmed.push(kept);
    }
    report.merges = confirmed;

    report.new_dimensions = verdict
        .new_dimensions
        .into_iter()
        .filter(|d| {
            let name = d.name.trim();
            name.len() >= 2 && d.tags.len() >= 2
        })
        .take(2)
        .map(|d| NewDimensionSuggestion {
            name: d.name.trim().to_string(),
            // 只保留词表里真实存在的标签名（防幻觉）
            tags: d
                .tags
                .into_iter()
                .filter(|n| tags.iter().any(|t| &t.name == n))
                .collect(),
            reason: d.reason,
        })
        .filter(|d| d.tags.len() >= 2)
        .collect();
    Ok(())
}

/// 判定的 from/into 与候选对是否指同一对标签（方向不敏感）
fn same_pair(a: &str, b: &str, m: &MergeCandidate) -> bool {
    (a == m.from_name && b == m.into_name) || (a == m.into_name && b == m.from_name)
}

/// 解析 agent 输出：剥 ```json 围栏、截首尾花括号（与 ai.rs 的宽容解析同思路）
fn parse_verdict(out: &str) -> AppResult<JudgeVerdict> {
    let s = out
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let slice = match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if a < b => &s[a..=b],
        _ => "",
    };
    serde_json::from_str(slice)
        .map_err(|e| AppError::External(format!("标签体检判定输出不是合法 JSON: {e}")))
}

// ---- 治理动作（向导里逐条触发） ----

/// 合并标签：from 上的任务关联全部改挂 into，随后删除 from。
/// 用户确认过的方向，不必再走确认门
#[tauri::command]
pub fn merge_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    from_id: i64,
    into_id: i64,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        merge_tag_conn(&conn, from_id, into_id)?;
    }
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

/// conn 版合并（测试与命令层共用）
pub fn merge_tag_conn(conn: &Connection, from_id: i64, into_id: i64) -> AppResult<()> {
    if from_id == into_id {
        return Err(AppError::Invalid("不能合并到自身".into()));
    }
    for id in [from_id, into_id] {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM tags WHERE id=?1", params![id], |r| {
            r.get(0)
        })?;
        if n == 0 {
            return Err(AppError::NotFound(format!("标签 {id} 不存在")));
        }
    }
    conn.execute(
        "INSERT OR IGNORE INTO task_tags (task_id, tag_id)
         SELECT task_id, ?2 FROM task_tags WHERE tag_id = ?1",
        params![from_id, into_id],
    )?;
    conn.execute("DELETE FROM task_tags WHERE tag_id=?1", params![from_id])?;
    conn.execute("DELETE FROM tags WHERE id=?1", params![from_id])?;
    Ok(())
}

/// 采纳新维度建议：建维度并把既有标签迁过去（维度已存在则复用，幂等支持重试）；
/// 配额不足时报错，已迁移的不回滚
#[tauri::command]
pub fn move_tags_to_dimension<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    tag_ids: Vec<i64>,
    key: String,
    name: String,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        move_tags_to_dimension_conn(&conn, &tag_ids, &key, &name)?;
    }
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

/// conn 版迁移（测试与命令层共用）
pub fn move_tags_to_dimension_conn(
    conn: &Connection,
    tag_ids: &[i64],
    key: &str,
    name: &str,
) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() || tag_ids.is_empty() {
        return Err(AppError::Invalid("维度名与标签列表不能为空".into()));
    }
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM tag_dimensions WHERE key=?1", params![key], |r| {
            r.get(0)
        })
        .ok();
    let dim_id = match exists {
        Some(id) => id,
        None => {
            let key = key.trim().to_lowercase();
            if key.is_empty()
                || !key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(AppError::Invalid(
                    "维度 key 只能包含小写字母、数字、-、_".into(),
                ));
            }
            let sort: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort), 0) + 1 FROM tag_dimensions",
                [],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO tag_dimensions (key, name, cardinality, max_tags, sort) VALUES (?1, ?2, 'multi', 30, ?3)",
                params![key, name, sort],
            )?;
            conn.last_insert_rowid()
        }
    };
    // 配额：目标维度剩余名额须覆盖「尚未在该维度的标签」数
    let placeholders = tag_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let incoming: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM tags WHERE id IN ({placeholders}) AND dimension_id != ?"),
        rusqlite::params_from_iter(tag_ids.iter().chain(std::iter::once(&dim_id))),
        |r| r.get(0),
    )?;
    if crate::commands::tags::dimension_remaining(conn, dim_id)? < incoming {
        return Err(AppError::Invalid(
            "目标维度剩余名额不足，先清理或调高上限".into(),
        ));
    }
    conn.execute(
        &format!("UPDATE tags SET dimension_id=? WHERE id IN ({placeholders})"),
        rusqlite::params_from_iter(std::iter::once(&dim_id).chain(tag_ids.iter())),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;

    /// 直插标签（含 usage 控制：usage 由 task_tags 计数而来，测试里直接挂任务）
    fn seed(conn: &Connection, name: &str, dimension_id: i64, origin: &str, age_days: i64, attach: bool) -> i64 {
        let created = (chrono::Utc::now() - chrono::Duration::days(age_days)).to_rfc3339();
        conn.execute(
            "INSERT INTO tags (name, dimension_id, origin, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![name, dimension_id, origin, created],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        if attach {
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('t', 'inbox', 'x')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (last_insert_rowid(), ?1)",
                params![id],
            )
            .unwrap();
        }
        id
    }

    #[test]
    fn similarity_handles_containment_and_edit_distance() {
        assert!(pair_similarity("周报", "工作周报") >= 0.89, "包含关系高分");
        assert!(pair_similarity("周报", "周报") == 1.0);
        assert!(pair_similarity("ab", "ab") == 1.0);
        assert!(pair_similarity("重要", "紧急") < SIMILARITY_THRESHOLD, "不同义词不进候选");
        assert!(pair_similarity("", "") == 0.0);
        // 中英文混合按字符比较
        assert!(pair_similarity("PokemonApp", "PokemonAPP") >= SIMILARITY_THRESHOLD);
    }

    #[test]
    fn local_report_finds_zombies_and_candidates() {
        let conn = test_conn();
        seed(&conn, "周报", 4, "manual", 200, true); // 手建且在用：不是僵尸
        seed(&conn, "幻觉标签", 4, "ai", 100, false); // AI 建、90+ 天没挂上：僵尸
        seed(&conn, "新鲜词", 4, "ai", 3, false); // 太新：观察期未过
        seed(&conn, "老词", 4, "agent", 200, false); // agent 建、从未用：僵尸
        seed(&conn, "工作周报", 4, "manual", 10, true);
        let tags = list_tags_conn(&conn).unwrap();
        let report = local_report(&tags);
        let zombie_names: Vec<&str> = report.zombies.iter().map(|z| z.name.as_str()).collect();
        assert_eq!(zombie_names, vec!["幻觉标签", "老词"]);
        // 「周报」(1 次) 与「工作周报」(1 次) 同维度相似 → 候选；同使用次数保留 id 靠前的
        assert_eq!(report.merges.len(), 1);
        assert_eq!(report.merges[0].from_name, "工作周报");
        assert_eq!(report.merges[0].into_name, "周报");
        assert!(!report.merges[0].judged);
        assert!(report.new_dimensions.is_empty());
    }

    /// 维度隔离：同名不同维度、跨维度相似都不进候选
    #[test]
    fn candidates_stay_within_dimension() {
        let conn = test_conn();
        seed(&conn, "周报", 4, "manual", 1, false);
        seed(&conn, "工作周报", 1, "manual", 1, false); // 项目维度
        let tags = list_tags_conn(&conn).unwrap();
        assert!(local_report(&tags).merges.is_empty());
    }

    #[test]
    fn parse_verdict_strips_fences_and_chatter() {
        let raw = "分析如下：\n```json\n{\"merges\":[{\"from\":\"a\",\"into\":\"b\",\"merge\":true,\"reason\":\"同义\"}],\"newDimensions\":[]}\n```\n完毕";
        let v = parse_verdict(raw).unwrap();
        assert_eq!(v.merges.len(), 1);
        assert!(v.merges[0].merge);
        assert_eq!(v.merges[0].into, "b");
        assert!(parse_verdict("我觉得不用合并").is_err());
    }

    /// 序列化契约：与前端 types.ts 的 TagCheckupReport 逐字段一致
    #[test]
    fn checkup_report_json_contract() {
        let r = TagCheckupReport {
            merges: vec![MergeCandidate {
                from_id: 1,
                from_name: "a".into(),
                into_id: 2,
                into_name: "b".into(),
                dimension: "topic".into(),
                similarity: 0.9,
                judged: true,
                reason: Some("同义".into()),
            }],
            zombies: vec![ZombieTag {
                id: 3,
                name: "z".into(),
                dimension: "topic".into(),
                origin: "ai".into(),
                created_at: "x".into(),
            }],
            new_dimensions: vec![NewDimensionSuggestion {
                name: "精力".into(),
                tags: vec!["a".into()],
                reason: None,
            }],
            judged: true,
        };
        let v = serde_json::to_value(&r).unwrap();
        let mut keys: Vec<String> = v.as_object().unwrap().keys().map(String::clone).collect();
        keys.sort();
        assert_eq!(keys, vec!["judged", "merges", "newDimensions", "zombies"]);
        let m = &v["merges"][0];
        let mut mk: Vec<String> = m.as_object().unwrap().keys().map(String::clone).collect();
        mk.sort();
        assert_eq!(
            mk,
            vec![
                "dimension", "fromId", "fromName", "intoId", "intoName", "judged", "reason",
                "similarity",
            ]
        );
        let z = &v["zombies"][0];
        let mut zk: Vec<String> = z.as_object().unwrap().keys().map(String::clone).collect();
        zk.sort();
        assert_eq!(zk, vec!["createdAt", "dimension", "id", "name", "origin"]);
        let d = &v["newDimensions"][0];
        let mut dk: Vec<String> = d.as_object().unwrap().keys().map(String::clone).collect();
        dk.sort();
        assert_eq!(dk, vec!["name", "reason", "tags"]);
    }

    #[test]
    fn merge_tag_moves_links_and_deletes_source() {
        let conn = test_conn();
        let keep = seed(&conn, "规范名", 4, "manual", 1, true);
        let gone = seed(&conn, "重复名", 4, "ai", 1, true);
        // gone 再挂一个任务（两条任务都该并到 keep）
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('t2', 'inbox', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES (last_insert_rowid(), ?1)",
            params![gone],
        )
        .unwrap();
        merge_tag_conn(&conn, gone, keep).unwrap();
        let linked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.id = ?1",
                params![keep],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            linked, 3,
            "保留标签原有 1 处 + 被并标签的 2 处全部归位"
        );
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags WHERE id=?1", params![gone], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "被合并标签删除");
        assert!(merge_tag_conn(&conn, gone, gone).is_err(), "不能合并到自身");
        assert!(merge_tag_conn(&conn, 999, keep).is_err(), "不存在报 NotFound");
    }

    #[test]
    fn move_tags_creates_dimension_with_quota_check() {
        let conn = test_conn();
        let a = seed(&conn, "深度工作", 4, "manual", 1, false);
        let b = seed(&conn, "碎片处理", 4, "manual", 1, false);
        move_tags_to_dimension_conn(&conn, &[a, b], "energy", "精力").unwrap();
        let (dim, cnt): (String, i64) = conn
            .query_row(
                "SELECT d.key, (SELECT COUNT(*) FROM tags WHERE dimension_id = d.id) FROM tag_dimensions d WHERE d.key='energy'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((dim.as_str(), cnt), ("energy", 2));
        // 幂等重试：维度已存在，标签已在其中
        move_tags_to_dimension_conn(&conn, &[a], "energy", "精力").unwrap();
        // 非法 key 拒绝
        assert!(move_tags_to_dimension_conn(&conn, &[a], "非法!", "x").is_err());
        // 配额：context 维度上限 10，先塞满再迁一个 → 报错
        for i in 0..10 {
            seed(&conn, &format!("场景{i}"), 2, "manual", 1, false);
        }
        let extra = seed(&conn, "挤不进", 4, "manual", 1, false);
        assert!(move_tags_to_dimension_conn(&conn, &[extra], "context", "场景").is_err());
    }
}
