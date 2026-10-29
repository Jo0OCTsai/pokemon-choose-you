/**
 * doctor 环境自检（对齐 bin/pk/doctor.rs）：数据库存在性与 schema 版本、完整性、
 * 并发配置、context 读链路、技能安装版本；--ssh 时额外测远程 pk 可达性。
 * TS 增补 runtime 检查项（node 可用性——TS 形态 pk 的运行前提，不影响既有项语义）。
 * 有 fail 时退出码 1；warn 不影响退出码。库缺失/损坏本身是诊断对象——不走常规
 * open_db（那会直接失败），逐项检查并汇报。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Conn } from "../host/storage/db";
import { MAX_SCHEMA } from "../host/storage/migrate";
import { bundledSkillVersion, localSkillStatus, skillDirFor } from "../host/domain/skills";
import { sshBin } from "./ssh";
import { defaultDbPath } from "./cli";
import { pkVersion } from "./help";
import { runContext } from "./context";

interface DoctorCheck {
  name: string;
  status: string;
  detail: string;
  fix: string | null;
}

const check = (name: string, status: string, detail: string, fix: string | null = null): DoctorCheck => ({
  name,
  status,
  detail,
  fix,
});

export function doctorReport(
  dbOverride: string | undefined,
  sshTarget: string | undefined,
): {
  report: { checks: DoctorCheck[]; summary: { ok: number; warn: number; fail: number } };
  code: number;
} {
  const checks: DoctorCheck[] = [check("version", "ok", `pk ${pkVersion()}`)];

  const path = dbOverride ?? defaultDbPath();
  if (!existsSync(path)) {
    checks.push(
      check("database", "fail", `数据库不存在：${path}`, "先启动一次应用（或 pk init-db / 用 PK_DB 指定路径）"),
    );
  } else {
    checks.push(check("database", "ok", path));
    try {
      const conn = new DatabaseSync(path) as Conn;
      // 只设 busy_timeout 不动 journal_mode：并发检查要读库的真实持久状态
      conn.exec("PRAGMA busy_timeout=5000;");
      checks.push(...schemaChecks(conn));
      checks.push(integrityCheck(conn));
      checks.push(concurrencyCheck(conn));
      checks.push(contextCheck(conn));
      conn.close?.();
    } catch (e) {
      checks.push(
        check(
          "database",
          "fail",
          `打开失败：${e instanceof Error ? e.message : String(e)}`,
          "检查文件权限与所在磁盘状态",
        ),
      );
    }
  }
  checks.push(runtimeCheck());
  checks.push(...skillDoctorChecks());
  if (sshTarget !== undefined && sshTarget !== "") {
    checks.push(remoteDoctorCheck(sshTarget));
  }

  const count = (st: string) => checks.filter((c) => c.status === st).length;
  const fail = count("fail");
  return {
    report: { checks, summary: { ok: count("ok"), warn: count("warn"), fail } },
    code: fail > 0 ? 1 : 0,
  };
}

/** schema 版本与关键表：库比程序新（pk 需随应用升级）/ 库落后（应用未完成迁移）/ 缺表 */
function schemaChecks(conn: Conn): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const row = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  const version = row.user_version;
  const expected = MAX_SCHEMA;
  if (version === expected) {
    out.push(check("schema", "ok", `schema v${version}，与当前 pk 一致`));
  } else if (version > expected) {
    out.push(
      check(
        "schema",
        "fail",
        `数据库 schema v${version} 比本 pk（v${expected}）新`,
        "pk 随应用分发：升级应用后其自带的 pk 会自动接管",
      ),
    );
  } else {
    out.push(
      check(
        "schema",
        "fail",
        `数据库 schema v${version} 落后于 pk（v${expected}），应用未完成迁移`,
        "启动一次应用完成迁移（pk 自身不执行迁移）",
      ),
    );
  }
  const tables = [
    "tasks",
    "categories",
    "tags",
    "task_tags",
    "task_notes",
    "task_logs",
    "chat_messages",
    "chat_feedback",
    "agent_sessions",
    "settings",
    "sync_state",
    "feishu_users",
  ];
  const present = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_%'").all() as Array<{
    name: string;
  }>;
  const missing = tables.filter((t) => !present.some((p) => p.name === t));
  if (missing.length === 0) {
    out.push(check("tables", "ok", `${tables.length} 张表齐全`));
  } else {
    out.push(check("tables", "fail", `缺少表：${missing.join("、")}`, "schema 与 pk 版本不匹配，升级应用后重试"));
  }
  return out;
}

function integrityCheck(conn: Conn): DoctorCheck {
  const rows = conn.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const texts = rows.map((r) => String(Object.values(r)[0]));
  if (texts.every((r) => r === "ok")) {
    return check("integrity", "ok", "quick_check 通过");
  }
  return check("integrity", "fail", texts.join("; ").slice(0, 200), "先关闭应用再复查；确认损坏可从设置 → 备份恢复");
}

function concurrencyCheck(conn: Conn): DoctorCheck {
  const row = conn.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
  const mode = String(Object.values(row)[0]);
  if (mode === "wal") {
    return check("concurrency", "ok", "WAL 已启用，可与运行中的应用并发读写");
  }
  return check(
    "concurrency",
    "warn",
    `journal_mode=${mode}，与应用并发读写可能报 BUSY`,
    "启动一次应用或运行任一 pk 读写命令即自动切为 WAL",
  );
}

function contextCheck(conn: Conn): DoctorCheck {
  try {
    const ctx = runContext(conn) as { categories?: unknown[]; tags?: unknown[]; openTasks?: unknown[] };
    return check(
      "context",
      "ok",
      `读链路正常：分类 ${ctx.categories?.length ?? 0} · 标签 ${ctx.tags?.length ?? 0} · 未完成待办 ${ctx.openTasks?.length ?? 0}`,
    );
  } catch (e) {
    return check(
      "context",
      "fail",
      `读取上下文失败：${e instanceof Error ? e.message : String(e)}`,
      "结合上面 schema/integrity 检查结果定位",
    );
  }
}

/** TS 增补项：node 运行时可用性（TS 形态 pk 的运行前提；Rust 版无此项） */
function runtimeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isInteger(major) && major >= 22) {
    return check("runtime", "ok", `node v${process.versions.node}`);
  }
  return check(
    "runtime",
    "warn",
    `node v${process.versions.node} 低于 22（node:sqlite 不可用，数据面命令将失败）`,
    "升级 node 至 22 及以上",
  );
}

/** 技能安装状态：未安装提示可选安装（warn），旧版本提示更新 */
function skillDoctorChecks(): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const bundled = bundledSkillVersion();
  for (const agent of ["claude-code", "opencode", "pi", "dsh"] as const) {
    const dir = skillDirFor(agent);
    const { installed, installedVersion } = localSkillStatus(dir);
    if (!installed) {
      out.push(check("skill", "warn", `${agent}：未安装（交互/无头场景建议安装）`, `pk skill install ${agent}`));
    } else if (installedVersion === bundled) {
      out.push(check("skill", "ok", `${agent}：v${installedVersion}（${dir}/SKILL.md）`));
    } else if (installedVersion !== null) {
      out.push(
        check("skill", "warn", `${agent}：技能 v${installedVersion} 旧于内置 v${bundled}`, `pk skill install ${agent}`),
      );
    } else {
      out.push(check("skill", "warn", `${agent}：已安装但版本不可读`, `pk skill install ${agent}`));
    }
  }
  return out;
}

/** 远程 pk 可达性：BatchMode ssh 到目标跑 `pk --version`（端到端验证 shim 整条链） */
function remoteDoctorCheck(host: string): DoctorCheck {
  const out = spawnSync(sshBin(), ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "pk --version"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const version = (out.stdout ?? "").trim();
  if (out.status === 0 && version !== "") {
    return check("remote", "ok", `${host}：pk ${version}`);
  }
  const err = (out.stderr ?? "").trim() || `退出码 ${out.status ?? -1}`;
  return check(
    "remote",
    "fail",
    `${host}：远程 pk 不可达：${err}`,
    "确认 ssh 免密登录与远程 PATH 中的 shim（pk remote setup）",
  );
}
