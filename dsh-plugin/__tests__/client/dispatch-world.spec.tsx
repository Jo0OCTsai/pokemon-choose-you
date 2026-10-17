/**
 * 派发确认面执行世界行 + 降级三枚举明示 + 占用探测条件行（U31/U32 · §8 派发确认文案）：
 * DispatchOps 经路由 deployment 别名解析执行世界（部署列表拉取）——远端世界出世界行 +
 * 就绪（直连）部署带 ⚠ 直连警示；交互降级/非 POSIX/占用行为条件行组件（host 派发期回填
 * 数据面，client 以纯呈现件承接）；本机/无路由不渲染（降噪）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { DispatchOps } from "../../src/client/tasks/DispatchOps";
import { DispatchWorldNotes, type DispatchWorldInfo } from "../../src/client/tasks/DispatchRow";
import { makeData, makeDeployment, makeTask } from "./fixtures";

afterEach(cleanup);

/** 带项目标签的任务（派发前提） */
function taskWithProject() {
  const task = makeTask({ id: 7 });
  task.tags = [{ name: "pkm", dimension: "project" }];
  return task;
}

function renderOps(deployments: ReturnType<typeof makeDeployment>[], routeDeployment?: string) {
  const host = mockHost({ deployments });
  const data = makeData({
    tasks: [taskWithProject()],
    routes:
      routeDeployment !== undefined
        ? [{ tag: "pkm", agentId: "a1", workdir: "", context: "", deployment: routeDeployment }]
        : [],
    agents: [
      {
        id: "a1",
        name: "Claude Code",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ],
  });
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <DispatchOps task={data.tasks[0]} data={data} readonly={false} onChanged={() => undefined} />
      </I18nProvider>
    </ClientProvider>,
  );
  return host;
}

describe("DispatchOps 执行世界行（路由 deployment 解析）", () => {
  it("无路由/本机路由：不渲染世界行（降噪——§8 世界行属远端明示面）", () => {
    renderOps([]);
    expect(screen.queryByTestId("dispatch-world-notes")).toBeNull();
  });

  it("远端路由：世界行明示「部署 {别名} · 目录」+ 模型留本机说明", async () => {
    renderOps([makeDeployment({ id: "d1", alias: "gpu-1", status: "ready" })], "gpu-1");
    await act0();
    const notes = screen.getByTestId("dispatch-world-notes");
    expect(notes.textContent).toContain("即将派发：Claude Code · 部署 gpu-1");
    expect(notes.textContent).toContain("远端执行时模型与会话留本机");
    // 就绪（非直连）部署无 ⚠ 行
    expect(notes.textContent).not.toContain("直连模式");
  });

  it("就绪（直连）部署：⚠ 直连模式警示行（H1①——可派发但明示未经摘要校验）", async () => {
    renderOps([makeDeployment({ id: "d1", alias: "gpu-1", status: "ready", degraded: true })], "gpu-1");
    await act0();
    const notes = screen.getByTestId("dispatch-world-notes");
    expect(notes.textContent).toContain("⚠ 直连模式：未经 helper 摘要校验");
  });
});

describe("降级三枚举与占用探测条件行（纯呈现件 · host 数据面回填时点亮）", () => {
  function renderNotes(info: DispatchWorldInfo) {
    render(
      <I18nProvider locale="zh-Hans">
        <DispatchWorldNotes info={info} agentName="Claude Code" workdir="/srv" />
      </I18nProvider>,
    );
  }

  it("交互通道降级：复制完整命令行明示", () => {
    renderNotes({
      world: { kind: "deployment", alias: "gpu-1", degraded: false },
      occupancySessionId: null,
      interactiveDegraded: true,
      nonPosix: false,
    });
    expect(screen.getByText(/交互通道降级：将复制完整命令行/)).toBeTruthy();
  });

  it("非 POSIX 端点：仅支持无头直连派发", () => {
    renderNotes({
      world: { kind: "deployment", alias: "win-1", degraded: false },
      occupancySessionId: null,
      interactiveDegraded: false,
      nonPosix: true,
    });
    expect(screen.getByText(/目标非 POSIX：仅支持无头直连派发/)).toBeTruthy();
  });

  it("占用探测条件行：同任务活动进程 + 会话 id + 建议先收口", () => {
    renderNotes({
      world: { kind: "deployment", alias: "gpu-1", degraded: false },
      occupancySessionId: "sess-live-9",
      interactiveDegraded: false,
      nonPosix: false,
    });
    const line = screen.getByText(/远端仍有该任务的活动进程/);
    expect(line.textContent).toContain("sess-live-9");
    expect(line.textContent).toContain("建议先收口");
  });

  it("world = null → 整组不渲染", () => {
    renderNotes({ world: null, occupancySessionId: null, interactiveDegraded: false, nonPosix: false });
    expect(screen.queryByTestId("dispatch-world-notes")).toBeNull();
  });
});

/** 单轮微任务冲刷（deploymentList 拉取落地） */
async function act0(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
