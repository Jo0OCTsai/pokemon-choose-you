/**
 * Agent 列表 CAS 用户路径回归（SETTING_MODIFIED_ELSEWHERE，A24）：
 * - 新增乐观卡不得污染 expectedAgentIds 基线（回归：乐观新 id 计入基线 → 首存必然
 *   冲突，且污染全列表基线 → 编辑/删除全部死锁在「已在另一处被修改」）
 * - 真冲突（面板加载后另一形态改了列表）出「仍要覆盖」确认钮 → force 重发成功
 * - 删除错误分流：冲突 → 对话框停留转确认覆盖；其他错误显示真实信息（不误报冲突）
 * - 幽灵卡（未落库）取消/移除纯本地，不发服务端命令
 * - 折叠卡启用开关即时落库（持久卡；幽灵卡只记本地）；写成功请求面板重拉（onChanged）
 * - 绑定部署（执行世界单源，2026-10-19 裁决）→ settings-agent-deployment.spec（文件行数棘轮拆出）
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockHost } from "../../src/client/rpc";
import { makeAgent, makeData } from "./fixtures";
import { getPage, gotoSection, renderSettings } from "./settingsHarness";

afterEach(cleanup);
vi.useFakeTimers();

describe("agent CAS：新增首存基线", () => {
  it("新增 agent：乐观新 id 不计入 expectedAgentIds，首存成功", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const upsert = host.calls.find((c) => c.command === "agentUpsert");
    // 基线 = 面板加载时的持久 id 集（空），不含乐观新 id
    expect(upsert?.params).toMatchObject({ expectedAgentIds: [] });
    // 成功：收起编辑态回折叠卡、无冲突提示、服务端已落库
    expect(within(page).queryByText(/确认覆盖/)).toBeNull();
    const cards = within(page).getAllByTestId("agent-ui.card");
    expect(cards.length).toBe(1);
    expect(within(cards[0]).getByText("编辑")).toBeTruthy();
    expect(host.state.agents.length).toBe(1);
  });

  it("多张幽灵卡并存：先存其一，其余幽灵卡与草稿保留", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    expect(within(page).getAllByTestId("agent-ui.card").length).toBe(2);
    // 存第一张（同名预设去重后名不同，按卡序取首卡编辑）
    const first = within(page).getAllByTestId("agent-ui.card")[0];
    fireEvent.click(within(first).getByText("编辑"));
    fireEvent.click(within(first).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // 服务端只落一张；另一张幽灵卡仍在列表（草稿不因兄弟卡保存而丢失）
    expect(host.state.agents.length).toBe(1);
    expect(within(page).getAllByTestId("agent-ui.card").length).toBe(2);
  });
});

describe("agent CAS：编辑冲突确认覆盖", () => {
  it("面板加载后列表被外部修改：冲突提示 + 「仍要覆盖」→ force 重发成功", async () => {
    const a1 = makeAgent({ id: "a1", name: "Claude Code" });
    const data = makeData();
    data.agents = [a1];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    // 模拟主应用（另一形态）在面板加载后新增 agent → 基线失配
    host.state.agents.push(makeAgent({ id: "ext", name: "外部新增" }));
    const page = getPage("agents");
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    fireEvent.change(within(page).getByLabelText("附加参数"), { target: { value: "--changed" } });
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // 冲突：提示文案 + 确认覆盖按钮（不再是无钮死胡同）
    expect(within(page).getByText(/确认覆盖/)).toBeTruthy();
    fireEvent.click(within(page).getByText("仍要覆盖"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const calls = host.calls.filter((c) => c.command === "agentUpsert");
    expect(calls[1]?.params).toMatchObject({ force: true, agent: { id: "a1", args: "--changed" } });
    // 覆盖成功：提示消失、收起编辑态、服务端已改值（外部新增的 ext 卡同步可见）
    expect(within(page).queryByText(/确认覆盖/)).toBeNull();
    const cards = within(page).getAllByTestId("agent-ui.card");
    expect(cards.length).toBe(2);
    expect(cards.every((c) => !c.textContent?.includes("保存"))).toBe(true);
    expect(host.state.agents.find((a) => a.id === "a1")?.args).toBe("--changed");
  });
});

describe("agent CAS：删除错误分流", () => {
  it("删除冲突：对话框停留提示确认覆盖，确认后 force 删除成功", async () => {
    const a1 = makeAgent({ id: "a1", name: "Claude Code" });
    const data = makeData();
    data.agents = [a1];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    host.state.agents.push(makeAgent({ id: "ext", name: "外部新增" }));
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("删除"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // 冲突：对话框不关，正文转冲突提示，确认钮转「仍要覆盖」
    const conflictDialog = screen.getByRole("dialog");
    expect(within(conflictDialog).getByText(/确认覆盖/)).toBeTruthy();
    fireEvent.click(within(conflictDialog).getByRole("button", { name: "仍要覆盖" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const calls = host.calls.filter((c) => c.command === "agentDelete");
    expect(calls[1]?.params).toMatchObject({ force: true, id: "a1" });
    expect(host.state.agents.map((a) => a.id)).toEqual(["ext"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("删除非冲突失败：显示真实错误信息，不误报「确认覆盖」", async () => {
    const a1 = makeAgent({ id: "a1", name: "Claude Code" });
    const data = makeData();
    data.agents = [a1];
    const host = mockHost();
    renderSettings(data, host);
    gotoSection("Agent");
    // 只读库守卫 → DB_SCHEMA_TOO_NEW（非冲突类错误）
    host.state.dbStatus.mode = "ro";
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("删除"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const errorDialog = screen.getByRole("dialog");
    expect(within(errorDialog).getByText(/需升级插件后才能写入/)).toBeTruthy();
    expect(within(errorDialog).queryByText(/确认覆盖/)).toBeNull();
  });
});

describe("agent CAS：折叠卡启用开关即时落库", () => {
  it("持久卡开关 → agentUpsert 即时带基线；服务端已改值 + 请求面板重拉（onChanged）", async () => {
    const a1 = makeAgent({ id: "a1", enabled: true });
    const data = makeData();
    data.agents = [a1];
    const host = mockHost({ agents: [a1] }); // 服务端态与面板夹具同源（干净保存路径）
    const onChanged = vi.fn();
    renderSettings(data, host, { onChanged });
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByRole("switch", { name: "启用" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const upsert = host.calls.find((c) => c.command === "agentUpsert");
    expect(upsert?.params).toMatchObject({ agent: { id: "a1", enabled: false }, expectedAgentIds: ["a1"] });
    expect(host.state.agents[0]?.enabled).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });

  it("幽灵卡开关只记本地（不替用户落半成品）；显式保存时随表单落库", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    fireEvent.click(within(page).getByRole("switch", { name: "启用" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.calls.filter((c) => c.command === "agentUpsert")).toEqual([]);
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.state.agents[0]?.enabled).toBe(false);
  });

  it("开关撞冲突：展开编辑态出「仍要覆盖」→ force 落库", async () => {
    const a1 = makeAgent({ id: "a1", enabled: true });
    const data = makeData();
    data.agents = [a1];
    const host = mockHost({ agents: [a1] });
    renderSettings(data, host);
    gotoSection("Agent");
    host.state.agents.push(makeAgent({ id: "ext" }));
    const page = getPage("agents");
    fireEvent.click(within(page).getByRole("switch", { name: "启用" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // 折叠态开关无处呈错 → 展开编辑态给冲突出口
    expect(within(page).getByText(/确认覆盖/)).toBeTruthy();
    fireEvent.click(within(page).getByText("仍要覆盖"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.state.agents.find((a) => a.id === "a1")?.enabled).toBe(false);
  });
});

describe("agent CAS：幽灵卡本地移除", () => {
  it("编辑中取消：幽灵卡从列表移除，不发任何命令", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    fireEvent.click(within(page).getByText("编辑"));
    fireEvent.click(within(page).getByText("取消"));
    expect(within(page).queryByTestId("agent-ui.card")).toBeNull();
    expect(host.calls.filter((c) => c.command.startsWith("agent"))).toEqual([]);
  });

  it("折叠态移除：确认后纯本地移除（未落库不发 agentDelete）", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    fireEvent.click(within(page).getByText("删除"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(within(page).queryByTestId("agent-ui.card")).toBeNull();
    expect(host.calls.filter((c) => c.command === "agentDelete")).toEqual([]);
  });
});
