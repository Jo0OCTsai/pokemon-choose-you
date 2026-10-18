/**
 * dispatchRemote 系列共享受测装配（从 dispatchRemote.spec.ts 拆出——棘轮 max-lines，
 * 等量迁移）：db/scope/platform 每用例重建（beforeEach/afterEach 内建）+ 种子件与
 * 查询辅助；消费面 = dispatchRemote*.spec.ts 四件。执行世界单源（2026-10-19 裁决）：
 * 远端前提由默认 agent 绑定（deployment=ALIAS）承载，路由表不再携带 deployment。
 */
import { afterEach, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sshCheck } from "../../src/host/dispatch/sshCheck";
import { systemSshProbe } from "../../src/host/dispatch/sshCheck";
import type { RemoteDispatchPlatform } from "../../src/host/remote/sshExecutor";
import { DEPLOYMENTS_KEY, deploymentUpsert, listDeployments } from "../../src/host/remote/deployments";
import { createTestDb, seedTask, type TestDb } from "../helpers";
import { DEFAULT_HELPER_CONTENT, FakeSshScope, sha256Of } from "./fakeSshScope";

export const TARGET = "u@dev-box:22";
export const ALIAS = "dev-box";
export const WORKDIR = "/srv/app";
export const HELPER_PATH = "/home/dev/.dsh-helper/pky-0.1.0/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js";
export const ENVELOPE = JSON.stringify({ session_id: "sess-remote-1", is_error: false, total_cost_usd: 0.02 });

/** 每用例重建的受测装配（db + fake scope + platform；familyAvailable 可写开关） */
export interface DispatchRemoteFx {
  readonly db: TestDb;
  readonly scope: FakeSshScope;
  readonly platform: RemoteDispatchPlatform;
  familyAvailable: boolean;
  seedAgent(id: string, args: string, opts?: { timeoutSecs?: number; command?: string }): void;
  seedReadyDeployment(opts?: { degraded?: boolean; status?: string }): string;
  seedDeploymentTask(title: string, opts?: { workdir?: string; worktree?: boolean }): number;
  fakeSshScript(body: string): string;
  directPlatform(bin: string): RemoteDispatchPlatform;
  state(taskId: number): unknown;
  slotCount(): number;
  lastSession(taskId: number): Record<string, unknown>;
}

/** 受测装配的可变引用面（beforeEach 重建） */
interface FxRefs {
  db: TestDb;
  scope: FakeSshScope;
  familyAvailable: boolean;
  platform: RemoteDispatchPlatform;
}

/** agent 种子（ai_agents 全量覆写——单 agent 形态；deployment 缺省绑定测试部署 =
 *  远端执行世界，显式 null = 本机形态——执行世界单源：agent 绑定承载） */
function seedAgentInto(
  db: TestDb,
  id: string,
  args: string,
  opts: { timeoutSecs?: number; command?: string; deployment?: string | null } = {},
): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id,
        name: id,
        command: opts.command ?? "claude",
        args,
        historyArgs: "",
        workdir: "",
        timeoutSecs: opts.timeoutSecs ?? 120,
        enabled: true,
        deployment: opts.deployment ?? ALIAS,
      },
    ]),
  );
}

/** 装配受测面（beforeEach 重建 / afterEach 收口）；调用方 spec 顶层调用一次 */
export function setupDispatchRemoteFx(): DispatchRemoteFx {
  const refs: FxRefs = {} as never;

  beforeEach(() => {
    refs.db = createTestDb();
    refs.scope = new FakeSshScope();
    refs.familyAvailable = true;
    refs.platform = {
      scopeFor: async () => refs.scope,
      readHelperArtifact: () => ({ sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
      sshFamilyAvailable: () => refs.familyAvailable,
    };
    seedAgentInto(refs.db, "claude", "-p {prompt}");
  });
  afterEach(() => {
    refs.db.close();
  });

  return {
    get db(): TestDb {
      return refs.db;
    },
    get scope(): FakeSshScope {
      return refs.scope;
    },
    get platform(): RemoteDispatchPlatform {
      return refs.platform;
    },
    get familyAvailable(): boolean {
      return refs.familyAvailable;
    },
    set familyAvailable(value: boolean) {
      refs.familyAvailable = value;
    },
    seedAgent: (id, args, opts) => seedAgentInto(refs.db, id, args, opts),
    seedReadyDeployment: (opts) => seedReadyDeploymentInto(refs, opts),
    seedDeploymentTask: (title, opts) => seedDeploymentTaskInto(refs, title, opts),
    fakeSshScript: (body) => fakeSshScriptAt(refs.db.dir, body),
    directPlatform: (bin) => ({
      ...refs.platform,
      sshCheck: (target) => sshCheck(target, { probe: systemSshProbe(bin) }),
    }),
    state: (taskId) => stateOf(refs.db, taskId),
    slotCount: () => slotCountOf(refs.db),
    lastSession: (taskId) => lastSessionOf(refs.db, taskId),
  };
}

/** 建就绪部署实体（helper 落 fake 远端文件系统，摘要自洽）+ 指向它的项目路由 */
function seedReadyDeploymentInto(
  refs: { db: TestDb; scope: FakeSshScope },
  opts: { degraded?: boolean; status?: string } = {},
): string {
  refs.scope.files.set(HELPER_PATH, DEFAULT_HELPER_CONTENT);
  const { deployment } = deploymentUpsert(refs.db.conn, {
    alias: ALIAS,
    nodePath: "/usr/local/bin/node",
    workdir: WORKDIR,
  });
  const map = listDeployments(refs.db.conn);
  map[deployment.id] = {
    ...map[deployment.id],
    status: (opts.status ?? "ready") as (typeof map)[string]["status"],
    helperPath: HELPER_PATH,
    helperHash: sha256Of(DEFAULT_HELPER_CONTENT),
    ...(opts.degraded === undefined ? {} : { degraded: opts.degraded }),
  };
  refs.db.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DEPLOYMENTS_KEY, JSON.stringify(map));
  return deployment.id;
}

/** 建挂项目路由的任务（tag meta 携带 agentId/workdir；路由只带 agent/目录策略——
 *  执行世界由 beforeEach 默认 agent 绑定承载，路由层不再有 deployment） */
function seedDeploymentTaskInto(
  refs: { db: TestDb },
  title: string,
  opts: { workdir?: string; worktree?: boolean } = {},
): number {
  const taskId = seedTask(refs.db.conn, title, { status: "scheduled" });
  const tagId = Number(
    (
      refs.db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(
          title,
          JSON.stringify({ agentId: "claude", ...(opts.workdir === undefined ? {} : { workdir: opts.workdir }) }),
        ) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  refs.db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  refs.db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)").run(
    JSON.stringify({
      [title]: {
        agentId: "claude",
        ...(opts.workdir === undefined ? {} : { workdir: opts.workdir }),
        ...(opts.worktree === undefined ? {} : { worktree: opts.worktree }),
      },
    }),
  );
  return taskId;
}

/** 直连降级链 fake ssh 脚本落盘（可执行） */
function fakeSshScriptAt(dir: string, body: string): string {
  const path = join(dir, "fake-ssh-direct.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

/** 任务派发状态读取 */
function stateOf(db: TestDb, taskId: number): unknown {
  return (db.conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as { dispatch_state: unknown })
    .dispatch_state;
}

/** 派发槽数 */
function slotCountOf(db: TestDb): number {
  return Number((db.conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots").get() as { n: number }).n);
}

/** 最近一条会话账本行 */
function lastSessionOf(db: TestDb, taskId: number): Record<string, unknown> {
  return db.conn.prepare("SELECT * FROM agent_sessions WHERE task_id=? ORDER BY id DESC LIMIT 1").get(taskId) as Record<
    string,
    unknown
  >;
}
