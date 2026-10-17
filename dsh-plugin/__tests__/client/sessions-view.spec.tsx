/**
 * 日志段 SessionsView（FR-C2/U27）：M9 分组胶囊四选（未知 kind 仅入「全部」）、
 * counts 汇总常显（不随翻页变化）+ 上下页 + 每页条数档、行内回放（本机/部署路由、
 * 已移除部署删除线 + 中性提示）、无回放句柄的行不渲染按钮、只读禁用（M7）。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { LogSegment } from "../../src/client/tasks/SessionsView";
import { makeDeployment, makeSessionRow } from "./fixtures";

afterEach(cleanup);

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function renderLogs(host: MockHost, readonly = false) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <LogSegment readonly={readonly} />
      </I18nProvider>
    </ClientProvider>,
  );
  return host;
}

/** 57 条派发会话（Gherkin 会话分页与回放路由口径）+ 收音机 3 + pk 2 + 未知 1 */
function rowsFixture() {
  const rows = [];
  for (let i = 1; i <= 57; i += 1) {
    rows.push(makeSessionRow({ id: i, kind: "dispatch_headless", sessionId: `sess-${i}` }));
  }
  rows.push(makeSessionRow({ id: 58, kind: "classify", sessionId: "sess-58" }));
  rows.push(makeSessionRow({ id: 59, kind: "capture", sessionId: "sess-59" }));
  rows.push(makeSessionRow({ id: 60, kind: "pk", sessionId: "sess-60" }));
  rows.push(makeSessionRow({ id: 61, kind: "legacy_kind", sessionId: "sess-61" }));
  return rows;
}

describe("分组胶囊四选（M9 归组）", () => {
  it("胶囊四选 + 全部含未知 kind；派发 57 条命中（Gherkin 口径）", async () => {
    const host = renderLogs(mockHost({ sessionRows: rowsFixture() }));
    await flush();
    expect(screen.getByText("共 61 条 · 第 1/4 页")).toBeTruthy();
    fireEvent.click(screen.getByText("派发"));
    await flush();
    expect(screen.getByText("共 57 条 · 第 1/3 页")).toBeTruthy();
    expect(host.calls.at(-1)?.params).toMatchObject({ group: "dispatch", limit: 20, offset: 0 });
  });

  it("收音机 = classify/capture；其他 = pk；未知 kind 仅入「全部」", async () => {
    renderLogs(mockHost({ sessionRows: rowsFixture() }));
    await flush();
    fireEvent.click(screen.getByText("收音机"));
    await flush();
    expect(screen.getByText("共 2 条 · 第 1/1 页")).toBeTruthy();
    fireEvent.click(screen.getByText("其他"));
    await flush();
    expect(screen.getByText("共 1 条 · 第 1/1 页")).toBeTruthy();
  });

  it("分组无命中 → 空态「该分组暂无会话」", async () => {
    renderLogs(mockHost({ sessionRows: [makeSessionRow({ id: 1, kind: "pk", sessionId: "s1" })] }));
    await flush();
    fireEvent.click(screen.getByText("收音机"));
    await flush();
    expect(screen.getByTestId("session-group-empty").textContent).toContain("该分组暂无会话");
  });

  it("全部为空 → 既有空态「还没有派出过 agent」", async () => {
    renderLogs(mockHost());
    await flush();
    expect(screen.getByText("还没有派出过 agent")).toBeTruthy();
  });
});

describe("分页与 counts 常显", () => {
  it("翻页 offset +20 且汇总不变；首页/末页禁用；条数档切换回第一页", async () => {
    const host = renderLogs(mockHost({ sessionRows: rowsFixture() }));
    await flush();
    fireEvent.click(screen.getByTestId("session-pager").querySelector("button:not([disabled])") as HTMLElement);
    await flush();
    expect(screen.getByText("共 61 条 · 第 2/4 页")).toBeTruthy();
    expect(
      host.calls.some((c) => c.command === "sessionsPage" && (c.params as { offset?: number }).offset === 20),
    ).toBe(true);
    // 条数 50：61 条 → 2 页、回第一页
    fireEvent.change(screen.getByLabelText("每页条数"), { target: { value: "50" } });
    await flush();
    expect(screen.getByText("共 61 条 · 第 1/2 页")).toBeTruthy();
  });
});

describe("执行世界徽章与回放路由", () => {
  it("本机行：徽章「本机」+ 回放 → 已在终端面板打开回放（本机）", async () => {
    const host = renderLogs(mockHost({ sessionRows: [makeSessionRow({ id: 1, sessionId: "s1" })] }));
    await flush();
    expect(screen.getByText("本机")).toBeTruthy();
    fireEvent.click(screen.getByTestId("session-replay"));
    await flush();
    expect(screen.getByTestId("session-note").textContent).toContain("已在终端面板打开回放（本机）");
    expect(host.calls.some((c) => c.command === "sessionReplay" && (c.params as { rowId: number }).rowId === 1)).toBe(
      true,
    );
  });

  it("远端行：徽章别名 + 回放经就绪部署路由（快照压过当前配置）", async () => {
    renderLogs(
      mockHost({
        sessionRows: [makeSessionRow({ id: 2, sessionId: "s2", remoteHost: "gpu-1" })],
        deployments: [makeDeployment({ id: "dep-1", alias: "gpu-1", status: "ready" })],
      }),
    );
    await flush();
    expect(screen.getByText("gpu-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("session-replay"));
    await flush();
    expect(screen.getByTestId("session-note").textContent).toContain("已在终端面板打开回放（部署 gpu-1）");
  });

  it("已移除部署：徽章删除线（data-gone）+ 回放中性提示", async () => {
    renderLogs(
      mockHost({
        sessionRows: [makeSessionRow({ id: 3, sessionId: "s3", remoteHost: "gpu-gone" })],
        deployments: [],
      }),
    );
    await flush();
    const badge = screen.getByText("gpu-gone");
    expect(badge.getAttribute("data-gone")).toBe("true");
    fireEvent.click(screen.getByTestId("session-replay"));
    await flush();
    expect(screen.getByTestId("session-note").textContent).toContain("该会话的远程部署已被移除，无法回放");
  });

  it("无回放句柄（session_id 与 tmux 皆无）的行不渲染回放按钮", async () => {
    renderLogs(mockHost({ sessionRows: [makeSessionRow({ id: 4, sessionId: null })] }));
    await flush();
    expect(screen.queryByTestId("session-replay")).toBeNull();
  });

  it("只读模式回放禁用（M7：远端唤起属写路径副作用）", async () => {
    renderLogs(mockHost({ sessionRows: [makeSessionRow({ id: 5, sessionId: "s5" })] }), true);
    await flush();
    expect((screen.getByTestId("session-replay") as HTMLButtonElement).disabled).toBe(true);
  });
});
