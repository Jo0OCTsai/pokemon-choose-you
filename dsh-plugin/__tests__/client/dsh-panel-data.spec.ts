/**
 * fetchPanelData 组装（Phase B 适配层数据面）：读命令 → PanelData——locale 取共享
 * language 键、健康/授权派生自 diagnostics feishu 链路（epoch → RFC3339）、agents/
 * routes 从共享设置 JSON 解析、filters/promptSpecs/dbStatus 直装、换装搜索本地名录。
 * 实体清单（tasks/messages/…）读命令缺失 → 空集降级口径一并断言。
 */
import { describe, expect, it } from "vitest";
import { agentsOf, createPokemonSearch, fetchPanelData, localeOf, routesOf } from "../../src/client/dsh/panelData";
import { mockHost } from "../../src/client/rpc";
import type { DiagnosticsLink } from "../../src/client/rpcTypes";

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
    // nextPollAt 用宿主承载形态（epoch 毫秒）——client 契约声明为串，适配层归一
    const host = mockHost({
      diagnostics: [
        feishuLink("degraded", {
          nextPollAt: 1760145600000 as unknown as string,
          pendingCount: 5,
          consecutiveFailures: 2,
        }),
      ],
    });
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

  it("链路缺勤 = 健康绿灯空态；feishu off = 未授权横幅位", async () => {
    const empty = await fetchPanelData(mockHost());
    expect(empty.health).toEqual({
      level: "ok",
      lastSuccessAt: null,
      nextPollAt: null,
      consecutiveFailures: 0,
      pendingCount: 0,
    });
    expect(empty.auth).toEqual({ authorized: true, expired: false });
    const off = await fetchPanelData(mockHost({ diagnostics: [feishuLink("off")] }));
    expect(off.auth).toEqual({ authorized: false, expired: false });
  });

  it("agents/routes 从共享设置 JSON 解析；实体清单空集降级（读命令缺失口径）", async () => {
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
