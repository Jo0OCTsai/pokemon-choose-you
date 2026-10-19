/**
 * rpc 层契约：54 命令面 + taskDeleteUndo（UIUX 放生撤销入口）+ pageOpen 推送订阅；
 * 15 错误码与 host 单源一致；ok/fail 信封；mockHost 语义子集（状态机 demote /
 * 分诊 CAS / 配置校验 / agent 修订检测 / 只读守卫）。
 */
import { describe, expect, it } from "vitest";
import {
  createHostClient,
  ERROR_CODES,
  mockHost,
  ok,
  fail,
  PkyError,
  type HostClient,
  type PkyResult,
  type PageOpenEvent,
} from "../../src/client/rpc";
import { ERROR_CODES as HOST_ERROR_CODES } from "../../src/host/storage/errors";
import { makeMessage, makeTask } from "./fixtures";

/** HostClient 上的命令方法名全集（onPageOpen 为推送订阅面，单独断言） */
const COMMAND_METHODS = [
  "taskStart",
  "taskPause",
  "taskResume",
  "taskComplete",
  "taskCancel",
  "taskDelete",
  "taskDeleteUndo",
  "taskReschedule",
  "captureTodo",
  "reviewAccept",
  "reviewApplyUpdate",
  "reviewDismiss",
  "reviewRestore",
  "reviewBatch",
  "retryJudge",
  "forceCapture",
  "forceDismiss",
  "pollNow",
  "dispatchInteractive",
  "dispatchHeadless",
  "dispatchClose",
  "dispatchReset",
  "dispatchCancel",
  "dispatchRedo",
  "configRead",
  "configWrite",
  "routeUpsert",
  "larkAuth",
  "larkTest",
  "categoryUpsert",
  "categoryDelete",
  "tagUpsert",
  "tagDelete",
  "dimensionUpdate",
  "filterList",
  "filterUpsert",
  "agentUpsert",
  "agentDelete",
  "promptList",
  "promptGet",
  "promptOverride",
  "promptReset",
  "diagnosticsSnapshot",
  "supportReport",
  "logQuery",
  "petShow",
  "petHide",
  "petMove",
  "dbStatus",
  "pomoTryFive",
  "panelSnapshot",
  "taskDetail",
  "taskSearch",
  "todayTasks",
  "categoriesList",
] as const satisfies readonly (keyof HostClient)[];

describe("rpc 命令契约", () => {
  it("HostClient 暴露 49 Phase A 命令 + 5 实体读 + UIUX 放生撤销（taskDeleteUndo）", () => {
    // 54 = AD §4.1.1 表逐行 49 + 实体读域 5；+1 = UIUX 触发入口表 host:taskDeleteUndo
    expect(COMMAND_METHODS.length).toBe(55);
    expect(COMMAND_METHODS.filter((m) => m !== "taskDeleteUndo").length).toBe(54);
    const client: HostClient = mockHost();
    for (const method of COMMAND_METHODS) {
      expect(typeof client[method]).toBe("function");
    }
    expect(typeof client.onPageOpen).toBe("function");
  });

  it("createHostClient 经 transport 转发命令并回传信封", async () => {
    const seen: Array<{ command: string; params: unknown }> = [];
    const client = createHostClient({
      send: async <T>(command: string, params?: unknown): Promise<PkyResult<T>> => {
        seen.push({ command, params });
        if (command === "taskStart") {
          return ok(makeTask({ id: 7, status: "active" }) as unknown as T);
        }
        return fail(new PkyError("DB_SCHEMA_TOO_NEW", "待办库版本较新"));
      },
      on: () => () => undefined,
    });
    const good = await client.taskStart({ taskId: 7 });
    expect(good.ok).toBe(true);
    expect(good.ok && good.data.status).toBe("active");
    const bad = await client.taskPause({ taskId: 7 });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.code).toBe("DB_SCHEMA_TOO_NEW");
    expect(seen).toEqual([
      { command: "taskStart", params: { taskId: 7 } },
      { command: "taskPause", params: { taskId: 7 } },
    ]);
  });

  it("pageOpen 推送：transport 事件通道 → client.onPageOpen 订阅/退订", () => {
    const listeners = new Set<(event: PageOpenEvent) => void>();
    const client = createHostClient({
      send: async <T>(): Promise<PkyResult<T>> => ok({} as T),
      on: (_event, listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    const events: PageOpenEvent[] = [];
    const dispose = client.onPageOpen((event) => {
      events.push(event);
    });
    for (const listener of listeners) {
      listener({ section: "settings" });
    }
    dispose();
    for (const listener of listeners) {
      listener({ section: "panel" });
    }
    expect(events).toEqual([{ section: "settings" }]);
  });

  it("23 错误码枚举与 host/storage/errors 单源逐字一致（15 既有 + full-parity 6 + ADR-0003 部署实体 2）", () => {
    expect([...ERROR_CODES]).toEqual([...HOST_ERROR_CODES]);
    expect(ERROR_CODES.length).toBe(23);
  });
});

describe("mockHost 语义子集", () => {
  it("taskStart demote 全局唯一进行中并记录调用", async () => {
    const host = mockHost({ tasks: [makeTask({ id: 1, status: "active" }), makeTask({ id: 2, status: "scheduled" })] });
    const result = await host.taskStart({ taskId: 2 });
    expect(result.ok && result.data.status).toBe("active");
    expect(host.state.tasks.find((t) => t.id === 1)?.status).toBe("scheduled");
    expect(host.calls[0]).toEqual({ command: "taskStart", params: { taskId: 2 } });
  });

  it("分诊 CAS：已处置建议返回 SUGGESTION_ALREADY_RESOLVED", async () => {
    const host = mockHost({ messages: [makeMessage({ messageId: "m1", reviewStatus: "accepted" })] });
    const result = await host.reviewAccept({ messageId: "m1" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("SUGGESTION_ALREADY_RESOLVED");
  });

  it("reviewDismiss 校验 6 枚举原因码", async () => {
    const host = mockHost({ messages: [makeMessage({ messageId: "m1" })] });
    const bad = await host.reviewDismiss({ messageId: "m1", reasonCode: "nope" as never });
    expect(bad.ok).toBe(false);
    const good = await host.reviewDismiss({ messageId: "m1", reasonCode: "noise" });
    expect(good.ok).toBe(true);
    expect(host.state.messages[0].dismissReason).toBe("noise");
  });

  it("configWrite：勿扰起=止 → CONFIG_VALIDATION_FAILED（U20 校验兜底）", async () => {
    const host = mockHost();
    const bad = await host.configWrite({ keyValues: { quiet_start: "22:00", quiet_end: "22:00" } });
    expect(!bad.ok && bad.error.code).toBe("CONFIG_VALIDATION_FAILED");
    const good = await host.configWrite({ keyValues: { quiet_start: "22:00", quiet_end: "08:00" } });
    expect(good.ok).toBe(true);
  });

  it("agentUpsert：空命令 AGENT_COMMAND_INVALID；修订基线失配 SETTING_MODIFIED_ELSEWHERE，force 覆盖", async () => {
    const host = mockHost();
    const agent = {
      id: "a1",
      name: "claude",
      command: "claude",
      args: "",
      historyArgs: "",
      workdir: "",
      timeoutSecs: 600,
      enabled: true,
    };
    expect(!((await host.agentUpsert({ agent: { ...agent, command: " " } })) as { ok: boolean }).ok).toBe(true);
    await host.agentUpsert({ agent, expectedAgentIds: [] });
    const conflict = await host.agentUpsert({ agent: { ...agent, name: "x" }, expectedAgentIds: [] });
    expect(!conflict.ok && conflict.error.code).toBe("SETTING_MODIFIED_ELSEWHERE");
    const forced = await host.agentUpsert({ agent: { ...agent, name: "x" }, expectedAgentIds: [], force: true });
    expect(forced.ok && forced.data.agents[0].name).toBe("x");
  });

  it("只读模式（DB_SCHEMA_TOO_NEW）：写命令统一拒绝、浏览不受影响", async () => {
    const host = mockHost({
      tasks: [makeTask({ id: 1 })],
      dbStatus: { userVersion: 9, pluginWindow: { min: 1, max: 2 }, mode: "ro" },
    });
    const blocked = await host.taskStart({ taskId: 1 });
    expect(!blocked.ok && blocked.error.code).toBe("DB_SCHEMA_TOO_NEW");
    const read = await host.dbStatus();
    expect(read.ok && read.data.mode).toBe("ro");
  });

  it("放生撤销窗口：taskDelete 落墓碑、taskDeleteUndo 恢复", async () => {
    const host = mockHost({ tasks: [makeTask({ id: 3, title: "重要" })] });
    await host.taskDelete({ taskId: 3 });
    expect(host.state.tasks).toHaveLength(0);
    const undo = await host.taskDeleteUndo({ taskId: 3 });
    expect(undo.ok && undo.data.title).toBe("重要");
  });

  it("pollNow 未授权 → LARK_UNAUTHORIZED", async () => {
    const host = mockHost({ larkAuthorized: false });
    const result = await host.pollNow();
    expect(!result.ok && result.error.code).toBe("LARK_UNAUTHORIZED");
  });
});
