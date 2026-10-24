/**
 * 项目派发行保存反馈（回归——真机踩坑：库已写入但 UI 沉默、状态行不刷新，用户侧即「无法保存」）：
 * - 保存成功 →「已保存」hint（role=status）+ onChanged 触发（面板重拉路由 → 状态行/⚡ chip 跟新）
 * - 保存失败 → 行内「保存失败：…」（role=alert），草稿保留可重试
 * - 下拉选中即存（桌面 TagDispatchCard 同构）同走反馈链
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockHost } from "../../src/client/rpc";
import { makeData } from "./fixtures";
import { getPage, gotoSection, makeTag, renderSettings } from "./settingsHarness";
import type { AgentConfig } from "../../src/host/domain/settings";

afterEach(cleanup);
vi.useFakeTimers();

const AGENT: AgentConfig = {
  id: "ag-1",
  name: "容器CC",
  command: "claude",
  args: "",
  historyArgs: "",
  workdir: "",
  timeoutSecs: 120,
  enabled: true,
};

/** 项目标签 + agent 夹具（路由行渲染前置） */
function routeData() {
  const data = makeData();
  data.agents = [AGENT];
  data.tags = [makeTag({ id: 1, name: "pcy", dimension: "project" })];
  data.routes = [{ tag: "pcy", agentId: "", workdir: "", context: "" }];
  return data;
}

function routeRow(): HTMLElement {
  return within(getPage("agents")).getByTestId("route-row");
}

describe("项目派发行保存反馈", () => {
  it("保存成功：「已保存」hint + onChanged 刷新 + routeUpsert 带合并值", async () => {
    const onChanged = vi.fn();
    const host = mockHost();
    renderSettings(routeData(), host, { onChanged });
    gotoSection("Agent");
    const row = routeRow();
    // 状态行：未配置
    expect(row.textContent).toContain("未配置");
    fireEvent.change(within(row).getByLabelText("工作目录"), { target: { value: "~/repos/pcy" } });
    fireEvent.click(within(row).getByText("保存"));
    await vi.runAllTimersAsync();
    // 保存 promise 的 setState 在 act 外排队——act 内冲一把微任务再取 hint（settings-parity 同手法）
    await act(async () => {});
    const upsert = host.calls.find((c) => c.command === "routeUpsert");
    expect(upsert?.params).toEqual({
      route: { tag: "pcy", agentId: "", workdir: "~/repos/pcy", context: "" },
    });
    expect(screen.getByText("已保存").getAttribute("role")).toBe("status");
    expect(onChanged).toHaveBeenCalled();
    // 4s 自隐
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
    });
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("保存失败：行内「保存失败：…」（role=alert），输入保留可重试", async () => {
    const host = mockHost();
    host.routeUpsert = async () => ({
      ok: false as const,
      error: { code: "INVALID_ARGUMENT", message: "项目标签名不能为空" },
    });
    renderSettings(routeData(), host);
    gotoSection("Agent");
    const row = routeRow();
    fireEvent.change(within(row).getByLabelText("工作目录"), { target: { value: "~/repos/pcy" } });
    fireEvent.click(within(row).getByText("保存"));
    await vi.runAllTimersAsync();
    await act(async () => {});
    const alert = within(row).getByRole("alert");
    expect(alert.textContent).toContain("保存失败");
    expect(alert.textContent).toContain("项目标签名不能为空");
    // 草稿保留
    expect((within(row).getByLabelText("工作目录") as HTMLInputElement).value).toBe("~/repos/pcy");
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("下拉选中即存：同走保存反馈链（桌面「选中即存」同构）", async () => {
    const onChanged = vi.fn();
    const host = mockHost();
    renderSettings(routeData(), host, { onChanged });
    gotoSection("Agent");
    const row = routeRow();
    fireEvent.change(within(row).getByLabelText("派发 Agent"), { target: { value: "ag-1" } });
    await vi.runAllTimersAsync();
    await act(async () => {});
    const upsert = host.calls.find((c) => c.command === "routeUpsert");
    expect(upsert?.params).toEqual({
      route: { tag: "pcy", agentId: "ag-1", workdir: "", context: "" },
    });
    expect(screen.getByText("已保存")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("已配置路由回显：状态行「已配置」+ agent 下拉回当前值", () => {
    const data = routeData();
    data.routes = [{ tag: "pcy", agentId: "ag-1", workdir: "~/repos/pcy", context: "" }];
    renderSettings(data);
    gotoSection("Agent");
    const row = routeRow();
    expect(row.textContent).toContain("已配置");
    expect((within(row).getByLabelText("派发 Agent") as HTMLSelectElement).value).toBe("ag-1");
    expect((within(row).getByLabelText("工作目录") as HTMLInputElement).value).toBe("~/repos/pcy");
  });
});
