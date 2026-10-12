/**
 * fetchPanelData 组装（Phase B 适配层数据面）：读命令 → PanelData——locale 取共享
 * language 键、健康/授权派生自 diagnostics feishu 链路（epoch → RFC3339）、agents/
 * routes 从共享设置 JSON 解析、filters/promptSpecs/dbStatus 直装、换装搜索本地名录。
 * 实体清单（tasks/categories/messages/sessions）从 panelSnapshot 灌入（mockHost
 * readCommands 家族 = 形状参照）；快照失败 → 空集降级口径一并断言。
 */
import { describe, expect, it } from "vitest";
import { agentsOf, createPokemonSearch, fetchPanelData, localeOf, routesOf } from "../../src/client/dsh/panelData";
import { mockHost, type PkyErrorShape } from "../../src/client/rpc";
import type { DiagnosticsLink } from "../../src/client/rpcTypes";
import { makeCategory, makeMessage, makeTask } from "./fixtures";

/** 模拟旧 host（无 panelSnapshot 命令）的信封失败——健康回落 diagnostics 派生 */
const noSnapshot = async (): Promise<{ ok: false; error: PkyErrorShape }> => ({
  ok: false,
  error: { code: "INVALID_ARGUMENT", message: "未知 host 命令 panelSnapshot" },
});

function feishuLink(level: DiagnosticsLink["level"], over: Partial<DiagnosticsLink> = {}): DiagnosticsLink {
  return {
    provider: "feishu",
    level,
    lastSuccessAt: "2026-10-11T08:00:00+08:00",
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    nextPollAt: null,
    pendingCount: 0,
    primaryAgent: "",
    ...over,
  };
}

describe("fetchPanelData", () => {
  it("读面直装：config/dbStatus/filters/promptSpecs + today/locale", async () => {
    const host = mockHost({
      settings: { language: "zh-Hant" },
      filters: [{ chatId: "oc_1", chatName: "产品群", chatType: "group", state: "follow", updatedAt: null }],
      promptSpecs: [
        {
          id: "im_classify",
          storageKey: "ai_prompt_im_classify",
          editable: true,
          defaultText: "d",
          requiredPlaceholders: [],
          lengthLimit: 20000,
          overrideText: null,
          text: "d",
          source: "default",
          missingPlaceholders: [],
          overlong: false,
        },
      ],
    });
    const data = await fetchPanelData(host);
    expect(data.locale).toBe("zh-Hant");
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.config.language).toBe("zh-Hant");
    expect(data.dbStatus).toEqual({ userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "rw" });
    expect(data.filters).toHaveLength(1);
    expect(data.promptSpecs).toHaveLength(1);
  });

  it("健康/授权派生：feishu 链路 level/nextPollAt(epoch)/pendingCount；off → 未授权", async () => {
    // nextPollAt 用宿主承载形态（epoch 毫秒）——client 契约声明为串，适配层归一。
    // 快照缺勤（旧 host）→ 健康回落 diagnostics 派生路径。
    const host = mockHost({
      diagnostics: [
        feishuLink("degraded", {
          nextPollAt: 1760145600000 as unknown as string,
          pendingCount: 5,
          consecutiveFailures: 2,
        }),
      ],
    });
    host.panelSnapshot = noSnapshot;
    const data = await fetchPanelData(host);
    expect(data.health).toEqual({
      level: "warn",
      lastSuccessAt: "2026-10-11T08:00:00+08:00",
      nextPollAt: new Date(1760145600000).toISOString(),
      consecutiveFailures: 2,
      pendingCount: 5,
    });
    expect(data.auth).toEqual({ authorized: true, expired: false });
  });

  it("快照缺勤时链路缺勤 = 健康绿灯空态；feishu off = 未授权横幅位", async () => {
    const host = mockHost();
    host.panelSnapshot = noSnapshot;
    const empty = await fetchPanelData(host);
    expect(empty.health).toEqual({
      level: "ok",
      lastSuccessAt: null,
      nextPollAt: null,
      consecutiveFailures: 0,
      pendingCount: 0,
    });
    expect(empty.auth).toEqual({ authorized: true, expired: false });
    const off = mockHost({ diagnostics: [feishuLink("off")] });
    off.panelSnapshot = noSnapshot;
    const offData = await fetchPanelData(off);
    expect(offData.auth).toEqual({ authorized: false, expired: false });
  });

  it("agents/routes 从共享设置 JSON 解析；空 mock 态实体清单空集", async () => {
    const host = mockHost({
      settings: {
        ai_agents: JSON.stringify([
          {
            id: "a1",
            name: "A",
            command: "agent-a",
            args: "",
            historyArgs: "",
            workdir: "",
            timeoutSecs: 600,
            enabled: true,
          },
          {
            id: "bad",
            name: "B",
            command: "  ",
            args: "",
            historyArgs: "",
            workdir: "",
            timeoutSecs: 600,
            enabled: false,
          },
        ]),
        "dsh:dispatch_routes": JSON.stringify({ proj: { agentId: "a1", workdir: "/w", context: "" } }),
      },
    });
    const data = await fetchPanelData(host);
    expect(data.agents ?? []).toHaveLength(1);
    expect(data.agents?.[0]?.id).toBe("a1");
    expect(data.routes).toEqual([{ tag: "proj", agentId: "a1", workdir: "/w", context: "" }]);
    expect(data.tasks).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.messages).toEqual([]);
    expect(data.followups).toEqual({});
    expect(data.dispatches).toEqual({});
    expect(data.sessions).toEqual([]);
  });

  it("实体清单从 panelSnapshot 灌入：任务四段合并去重 + 消息五分组合成 + 账本/分类/健康", async () => {
    const host = mockHost({
      tasks: [
        makeTask({ id: 1, status: "active" }),
        makeTask({ id: 2, status: "inbox" }),
        makeTask({ id: 3, status: "done", completedAt: "2026-10-11T09:00:00+08:00" }),
      ],
      categories: [makeCategory({ id: 1, name: "工作" })],
      messages: [
        makeMessage({ messageId: "m1", aiStatus: "todo", reviewStatus: "pending" }),
        makeMessage({ messageId: "m2", aiStatus: "none", reviewStatus: "pending" }),
        makeMessage({ messageId: "m3", aiStatus: "todo", reviewStatus: "accepted" }),
      ],
      sessions: [
        {
          id: 7,
          taskId: 1,
          agentId: "ag-1",
          sessionId: "s-7",
          kind: "dispatch_headless",
          durationMs: 1000,
          costUsd: 0.01,
          exitCode: 0,
          createdAt: "2026-10-11T09:00:00+08:00",
          summary: null,
        },
      ],
      health: {
        level: "warn",
        lastSuccessAt: "2026-10-11T08:00:00+08:00",
        nextPollAt: "2026-10-11T08:02:00+08:00",
        consecutiveFailures: 1,
        pendingCount: 1,
      },
    });
    const data = await fetchPanelData(host);
    expect(data.tasks.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    expect(data.categories.map((c) => c.name)).toEqual(["工作"]);
    expect(data.messages.map((m) => m.messageId).sort()).toEqual(["m1", "m2", "m3"]);
    expect(data.sessions).toHaveLength(1);
    expect(data.health).toEqual(host.state.health);
  });

  it("panelSnapshot 失败/旧 host 无命令 → 空集降级 + 健康回落 diagnostics 派生", async () => {
    const host = mockHost({
      tasks: [makeTask({ id: 1 })],
      diagnostics: [feishuLink("degraded", { pendingCount: 3 })],
    });
    host.panelSnapshot = noSnapshot;
    const data = await fetchPanelData(host);
    expect(data.tasks).toEqual([]);
    expect(data.messages).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(data.health).toEqual({
      level: "warn",
      lastSuccessAt: "2026-10-11T08:00:00+08:00",
      nextPollAt: null,
      consecutiveFailures: 0,
      pendingCount: 3,
    });
  });

  it("单项读命令失败不拖垮整页（信封 fail / 抛错都回落缺省）", async () => {
    const host = mockHost();
    host.dbStatus = async () => ({ ok: false, error: { code: "DB_SCHEMA_TOO_NEW", message: "x" } });
    host.filterList = () => Promise.reject(new Error("transport"));
    const data = await fetchPanelData(host);
    expect(data.dbStatus).toBeNull();
    expect(data.filters).toEqual([]);
    expect(data.config).toEqual({});
  });
});

describe("panelData 派生件", () => {
  it("localeOf：合法值直取，非法/缺省回落 zh-Hans", () => {
    expect(localeOf({ language: "en" })).toBe("en");
    expect(localeOf({ language: "fr" })).toBe("zh-Hans");
    expect(localeOf({})).toBe("zh-Hans");
  });

  it("agentsOf/routesOf：坏 JSON / 非数组形态回落空集", () => {
    expect(agentsOf({ ai_agents: "{bad" })).toEqual([]);
    expect(agentsOf({ ai_agents: "[1,2]" })).toEqual([]);
    expect(routesOf({ "dsh:dispatch_routes": "[]" })).toEqual([]);
    expect(routesOf({ "dsh:dispatch_routes": '"x"' })).toEqual([]);
  });

  it("换装搜索：中文名/英文名/key/编号命中，locale 决定显示名，空查询空集", async () => {
    const zh = createPokemonSearch("zh-Hans");
    expect(await zh("")).toEqual([]);
    const byHans = await zh("皮卡");
    expect(byHans[0]).toMatchObject({ key: "pikachu", number: 25, english: "Pikachu", name: "皮卡丘" });
    const byEn = await zh("bulba");
    expect(byEn[0]?.key).toBe("bulbasaur");
    const byId = await zh("25");
    expect(byId.map((c) => c.key)).toContain("pikachu");
    const hant = await createPokemonSearch("zh-Hant")("妙蛙");
    expect(hant[0]?.name).toBe("妙蛙種子");
  });
});
