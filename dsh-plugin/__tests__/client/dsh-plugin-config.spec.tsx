/**
 * pluginConfig 消费链（背包分区行，用户裁决 2026-10-18：插件私有配置背包为唯一编辑面）：
 * - createPluginConfig 的 receiver 绑定回归（真机踩坑：ConfigFormController 是 class，
 *   React 裸函数调用回调，解绑即 this 丢失渲染崩——fake scope 必须用 class 形态才测得出）
 * - JudgeRunnerRow 平铺选择器：cli 态显示 ai_agent_id、选内置通道只写 judgeExecutor、
 *   选 agent 双写（judgeExecutor=cli + configWrite ai_agent_id + 草稿/基线回调）、
 *   unavailable 降级提示、无 provider 行不渲染
 * - PetAutoStartRow：开关即时写 petAutoStart
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPluginConfig,
  PluginConfigProvider,
  type ConfigFormSnapshot,
  type ConfigFormsFace,
} from "../../src/client/dsh/pluginConfig";
import { JUDGE_BUILTIN_VALUE, JudgeRunnerRow, PetAutoStartRow } from "../../src/client/settings/PluginConfigRows";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";

/** class 形态 fake scope——方法体依赖 this（复刻真实 ConfigFormController 的解绑坑） */
class FakeScope {
  private snap: ConfigFormSnapshot;
  private readonly listeners = new Set<() => void>();
  readonly sets: Array<{ field: string; value: unknown }> = [];

  constructor(initial: Partial<ConfigFormSnapshot> & { value?: Record<string, unknown> } = {}) {
    this.snap = { status: "ready", writable: true, ...initial };
  }

  getSnapshot(): ConfigFormSnapshot {
    return this.snap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(field: string, value: unknown): Promise<boolean> {
    this.sets.push({ field, value });
    this.snap = { ...this.snap, value: { ...this.snap.value, [field]: value } };
    this.listeners.forEach((listener) => listener());
    return Promise.resolve(true);
  }
}

function fakeForms(scope: FakeScope): ConfigFormsFace {
  return { get: () => scope };
}

/** 行组件渲染壳（I18n + Client + PluginConfig provider；controller 缺省 = 无 provider） */
function renderRow(ui: React.JSX.Element, host: MockHost, controller: ReturnType<typeof createPluginConfig> | null) {
  return render(
    <I18nProvider locale="zh-Hans">
      <ClientProvider client={host}>
        <PluginConfigProvider controller={controller}>{ui}</PluginConfigProvider>
      </ClientProvider>
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe("pluginConfig · receiver 绑定（真机解绑坑回归）", () => {
  it("controller 方法可裸函数调用（无 receiver）且快照回流驱动重渲染", async () => {
    const scope = new FakeScope({ value: { judgeExecutor: "cli", petAutoStart: true } });
    const controller = createPluginConfig(fakeForms(scope));
    // 裸函数解构调用——useSyncExternalStore 的实际调用形态（class 方法丢 this 即此处崩）
    const { getSnapshot } = controller;
    expect(getSnapshot().value?.judgeExecutor).toBe("cli");
    await controller.set("judgeExecutor", "subagent");
    expect(getSnapshot().value?.judgeExecutor).toBe("subagent");
  });
});

describe("JudgeRunnerRow · AI 判定方式平铺选择器", () => {
  const AGENT_OPTIONS = [
    { value: "", label: "不指定" },
    { value: "agent-1", label: "Claude Code" },
  ];

  it("cli 态显示 ai_agent_id 当前值；选 agent 双写（judgeExecutor=cli + configWrite）并回调草稿同步", async () => {
    const scope = new FakeScope({ value: { judgeExecutor: "cli" } });
    const controller = createPluginConfig(fakeForms(scope));
    const host = mockHost();
    const picked: string[] = [];
    renderRow(
      <JudgeRunnerRow agentOptions={AGENT_OPTIONS} agentId="" onAgentPicked={(v) => picked.push(v)} />,
      host,
      controller,
    );
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "agent-1" } });
    await waitFor(() => {
      expect(scope.sets).toContainEqual({ field: "judgeExecutor", value: "cli" });
    });
    expect(host.calls).toContainEqual({
      command: "configWrite",
      params: { keyValues: { ai_agent_id: "agent-1" } },
    });
    await waitFor(() => {
      expect(picked).toEqual(["agent-1"]);
    });
  });

  it("选内置通道只写 judgeExecutor=subagent（ai_agent_id 不动），显示切到哨兵值", async () => {
    const scope = new FakeScope({ value: { judgeExecutor: "cli" } });
    const controller = createPluginConfig(fakeForms(scope));
    const host = mockHost();
    renderRow(
      <JudgeRunnerRow agentOptions={AGENT_OPTIONS} agentId="agent-1" onAgentPicked={() => undefined} />,
      host,
      controller,
    );
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: JUDGE_BUILTIN_VALUE } });
    await waitFor(() => {
      expect(scope.sets).toEqual([{ field: "judgeExecutor", value: "subagent" }]);
    });
    expect(host.calls.filter((c) => c.command === "configWrite")).toEqual([]);
    // 快照回流后受控值跟随哨兵
    await waitFor(() => {
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(JUDGE_BUILTIN_VALUE);
    });
  });

  it("namespace 未被宿主服务（unavailable）→ 一句提示不渲染控件", async () => {
    const scope = new FakeScope({ status: "unavailable" });
    const controller = createPluginConfig(fakeForms(scope));
    renderRow(
      <JudgeRunnerRow agentOptions={AGENT_OPTIONS} agentId="" onAgentPicked={() => undefined} />,
      mockHost(),
      controller,
    );
    expect(await screen.findByTestId("plugin-config-unavailable")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("无 provider（分区组件单测形态）→ 行不渲染", () => {
    renderRow(
      <JudgeRunnerRow agentOptions={AGENT_OPTIONS} agentId="" onAgentPicked={() => undefined} />,
      mockHost(),
      null,
    );
    expect(screen.queryByTestId("plugin-config-unavailable")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("PetAutoStartRow · 启动时自动显示桌宠", () => {
  it("开关即时写 petAutoStart 并随快照回流", async () => {
    const scope = new FakeScope({ value: { petAutoStart: true } });
    const controller = createPluginConfig(fakeForms(scope));
    renderRow(<PetAutoStartRow />, mockHost(), controller);
    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(scope.sets).toEqual([{ field: "petAutoStart", value: false }]);
    });
    await waitFor(() => {
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });
  });
});
