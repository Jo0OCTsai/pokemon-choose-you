/**
 * 面板真链分段往返回归（PanelRoot → fetchPanelData → PluginDetailPage）：
 * 回归场景——设置段新增 agent 保存后切走再切回，分段体卸载重挂从 data 重建，旧快照
 * 里没有已存 agent → 「新增的消失了；再存一个，两次的都回来」。修法双保险：
 * ① 分段切换即重拉快照（重挂进场必须是服务端真值）；② agent 写成功走 onChanged
 * 契约刷新快照。mock 侧 configRead 从 state.agents 派生 ai_agents 键（真库单源）。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelRoot } from "../../src/client/dsh/sidebarPanel";
import { mockHost } from "../../src/client/rpc";
import { getPage, gotoSection } from "./settingsHarness";

afterEach(cleanup);
vi.useFakeTimers();

/** 渲染真链面板根（自带 fetchPanelData 初拉）并冲完挂载期异步 */
async function renderPanel(host = mockHost()) {
  const PanelRoot = createPanelRoot(host);
  render(<PanelRoot />);
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  return { host };
}

describe("面板分段往返", () => {
  it("切段触发快照重拉（configRead 计数递增；切分段不触发不重拉）", async () => {
    const { host } = await renderPanel();
    const reads = () => host.calls.filter((c) => c.command === "configRead").length;
    const initial = reads();
    expect(initial).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("背包"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(reads()).toBeGreaterThan(initial);
  });

  it("新增 agent 保存后切冒险再切回：已存 agent 卡仍在（分段重挂读到新快照）", async () => {
    const { host } = await renderPanel();
    // 进设置段 → Agent 分区 → 新增 + 保存
    fireEvent.click(screen.getByText("背包"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    gotoSection("Agent");
    let page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.state.agents.length).toBe(1);
    // 切到冒险（设置段卸载）再切回（重挂）——重挂必须读到含已存 agent 的快照
    fireEvent.click(screen.getByText("冒险"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.click(screen.getByText("背包"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    gotoSection("Agent");
    page = getPage("agents");
    const cards = within(page).getAllByTestId("agent-ui.card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("claude");
  });
});
