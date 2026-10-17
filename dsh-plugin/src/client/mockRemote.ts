/**
 * mockHost 命令组 · 会话分页与回放（FR-C2）：sessionsPage（M9 归组 classify/capture→radio、
 * dispatch_*→dispatch、pk→other、未知仅入 all）与 sessionReplay（快照压过当前配置——
 * remoteHost 空 = 本机，非空 = 按部署别名解析，已删/未就绪 → DEPLOYMENT_NOT_READY）。
 *
 * 远程域命令组拆件（棘轮 max-lines，等量迁移）：共用件 = mockDeploy.ts、部署 CRUD =
 * mockDeployments.ts、开通向导 = mockProvision.ts；本文件为统一再出口（消费面不变）。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { SessionGroup, SessionRow } from "./rpcTypes";
import type { MockContext } from "./mockHost";
import { notFound, paramError, pendingCode } from "./mockDeploy";

/** M9 归组判定（未知 kind 仅入 all，不进三组） */
function kindOfGroup(kind: string, group: "radio" | "dispatch" | "other"): boolean {
  if (group === "radio") {
    return kind === "classify" || kind === "capture";
  }
  if (group === "dispatch") {
    return kind === "dispatch_headless" || kind === "dispatch_interactive";
  }
  return kind === "pk";
}

/** 数值钳制（sessionsPage limit 1–100 / offset ≥0） */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 会话分页与回放（FR-C2） */
export function sessionCommands(ctx: MockContext): Pick<HostClient, "sessionsPage" | "sessionReplay"> {
  return {
    async sessionsPage(params) {
      ctx.record("sessionsPage", params);
      const group = (params?.group ?? "all") as SessionGroup;
      const limit = clampInt(params?.limit, 20, 1, 100);
      const offset = clampInt(params?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const rows = ctx.state.sessionRows;
      const counts = {
        all: rows.length,
        radio: rows.filter((r) => kindOfGroup(r.kind, "radio")).length,
        dispatch: rows.filter((r) => kindOfGroup(r.kind, "dispatch")).length,
        other: rows.filter((r) => kindOfGroup(r.kind, "other")).length,
      };
      const matched =
        group === "all" ? rows : rows.filter((r) => kindOfGroup(r.kind, group as "radio" | "dispatch" | "other"));
      const total = matched.length;
      const page = [...matched].sort((a, b) => b.id - a.id).slice(offset, offset + limit);
      return ctx.ok({ rows: page, counts, total });
    },
    async sessionReplay(params) {
      ctx.record("sessionReplay", params);
      const row: SessionRow | undefined = ctx.state.sessionRows.find((r) => r.id === params.rowId);
      if (row === undefined) {
        return notFound(`会话记录 No.${params.rowId} 不存在`);
      }
      const replayable = row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
      if (!replayable) {
        return paramError("该会话无回放句柄（session_id 与 tmux 会话名皆无）");
      }
      // 快照压过当前配置：remoteHost 空 = 本机；非空 = 按部署别名解析
      if (row.remoteHost.trim() === "") {
        return ctx.ok({ routed: { world: "local", note: "tmux attach 优先 → --resume 会话 id → 选择器兜底" } });
      }
      const dep = ctx.state.deployments.find((d) => d.alias === row.remoteHost.trim());
      if (dep === undefined || dep.status !== "ready") {
        return {
          ok: false,
          error: new PkyError(
            pendingCode("DEPLOYMENT_NOT_READY"),
            `会话的执行部署「${row.remoteHost.trim()}」${dep === undefined ? "已被移除" : "未就绪"}，无法回放`,
            "可在本机打开该会话所属 agent 的历史选择器回放，或重新开通该部署后再试",
          ).toShape(),
        };
      }
      return ctx.ok({ routed: { world: { deploymentAlias: dep.alias }, note: "远端回放已唤起" } });
    },
  };
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export { pendingCode } from "./mockDeploy";
export { deploymentCommands } from "./mockDeployments";
export { provisionCommands, type MockProvisionFailKind } from "./mockProvision";
