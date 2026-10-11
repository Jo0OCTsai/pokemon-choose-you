/**
 * 场景执行器：openScenarioDb → 逐 op 执行（步后快照）→ 终态 → 归一化（先时间戳后
 * 别名）——Rust oracle execute_scenario 的逐段镜像。产出的 fixture 形态与
 * contracts/fixtures/*.json 比对（generatedBy 元信息不参与比对）。
 */
import { openScenarioDb, snapshot, type OpCtx, type OpResult, type Scenario } from "./harness";
import { finalState, normalizeAliases, normalizeTimestamps } from "./normalize";
import { AUDIT_WRITING_OPS, opTable } from "./ops";

export interface ExecutedScenario {
  scenario: string;
  steps: Array<{ ok: boolean; error: string | null; value: unknown; snapshot: unknown }>;
  final: unknown;
}

/** 执行一个场景（op 失败不中断——错误 tag 进 steps，与 oracle run_op 语义一致；
 * args.conn 只作连接路由，不进域原语参数） */
export function executeScenario(sc: Scenario): ExecutedScenario {
  const db = openScenarioDb(sc.kind, sc.name, sc.setup);
  const ops = opTable();
  const ctx: OpCtx = {
    conn: (idx) => {
      const conn = db.conns[idx];
      if (conn === undefined) {
        throw new Error("conn-index-out-of-range");
      }
      return conn;
    },
  };
  const steps: ExecutedScenario["steps"] = [];
  let writeOps = 0;
  try {
    for (const step of sc.steps) {
      const { conn: _route, ...args } = step.args ?? {};
      void _route;
      const op = ops[step.op];
      const result: OpResult = op === undefined ? { ok: false, error: `unknown-op:${step.op}` } : op(ctx, args);
      if (result.ok && AUDIT_WRITING_OPS.has(step.op)) {
        writeOps += 1;
      }
      const snap = sc.expect === "invariants" ? null : snapshot(db.conns[0]);
      steps.push({
        ok: result.ok,
        error: result.ok ? null : result.error,
        value: result.ok ? result.value : null,
        snapshot: snap,
      });
    }
    const aliasConn = db.conns[0];
    const fixture = normalizeTimestamps({
      scenario: sc.name,
      steps,
      final: finalState(ctx, sc.expect, writeOps),
    } as never);
    return normalizeAliases(aliasConn, fixture) as unknown as ExecutedScenario;
  } finally {
    db.cleanup();
  }
}
