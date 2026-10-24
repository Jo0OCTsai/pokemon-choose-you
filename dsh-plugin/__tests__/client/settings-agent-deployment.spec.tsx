/**
 * agent 绑定部署（执行世界单源，2026-10-19 裁决）用户路径回归：下拉 alias 随表单落库、
 * 清空回落本机、部署被外部删除 → 存在性校验拒绝且不误报冲突。
 * 自 settings-agents-cas.spec 拆出（文件行数棘轮受限，等量迁移）。
 */
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockHost } from "../../src/client/rpc";
import { makeAgent, makeData, makeDeployment } from "./fixtures";
import { getPage, gotoSection, renderSettings } from "./settingsHarness";

afterEach(cleanup);
vi.useFakeTimers();

describe("agent 绑定部署（执行世界单源，2026-10-19 裁决）", () => {
  it("编辑态绑定部署：选中 alias 随表单落库；清空回落本机（null）", async () => {
    const a1 = makeAgent({ id: "a1" });
    const host = mockHost({ agents: [a1] });
    host.state.deployments.push(makeDeployment({ id: "dep-1", alias: "dev-box" }));
    const data = makeData();
    data.agents = [a1];
    renderSettings(data, host);
    gotoSection("Agent");
    const page = getPage("agents");
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    // 编辑态挂载拉部署选项（异步）——先 flush 再操作下拉
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.change(within(page).getByLabelText("绑定部署"), { target: { value: "dev-box" } });
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const first = host.calls.find((c) => c.command === "agentUpsert");
    expect(first?.params).toMatchObject({ agent: { id: "a1", deployment: "dev-box" } });
    expect(host.state.agents.find((a) => a.id === "a1")?.deployment).toBe("dev-box");
    // 清空回落本机
    fireEvent.click(within(card).getByText("编辑"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.change(within(page).getByLabelText("绑定部署"), { target: { value: "" } });
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.state.agents.find((a) => a.id === "a1")?.deployment ?? null).toBeNull();
  });

  it("绑定部署不存在：保存被拒显示真实错误（不误报冲突）", async () => {
    const a1 = makeAgent({ id: "a1" });
    const host = mockHost({ agents: [a1] });
    host.state.deployments.push(makeDeployment({ id: "dep-1", alias: "dev-box" }));
    const data = makeData();
    data.agents = [a1];
    renderSettings(data, host);
    gotoSection("Agent");
    const page = getPage("agents");
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("编辑"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // 选中后面板外删除部署（另一形态改库）→ 保存撞存在性校验
    host.state.deployments = [];
    fireEvent.change(within(page).getByLabelText("绑定部署"), { target: { value: "dev-box" } });
    fireEvent.click(within(card).getByText("保存"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(within(page).getByText(/部署「dev-box」不存在/)).toBeTruthy();
    expect(within(page).queryByText(/确认覆盖/)).toBeNull();
    expect(host.state.agents.find((a) => a.id === "a1")?.deployment ?? null).toBeNull();
  });
});
