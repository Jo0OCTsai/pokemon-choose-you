/**
 * 部署卡 · 开通向导（拉式步进）用例（从 deploy-card.spec.tsx 拆出——棘轮
 * max-lines，等量迁移；渲染/引导夹具同构复制）。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { DeploymentCard } from "../../src/client/settings/deploy/DeploymentCard";
import { makeDeployment } from "./fixtures";

afterEach(cleanup);

async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function renderCard(host: MockHost) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <DeploymentCard onChanged={() => undefined} />
      </I18nProvider>
    </ClientProvider>,
  );
  return host;
}

/** 部署列表初始加载等待（返回 host 供断言） */
async function boot(host: MockHost): Promise<MockHost> {
  renderCard(host);
  await flush();
  return host;
}

describe("开通向导（拉式步进）", () => {
  it("全流程自动推进：四步 ok → 向导收束、部署就绪（provisionRun ×4）", async () => {
    const host = await boot(mockHost({ deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })] }));
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    const runs = host.calls.filter((c) => c.command === "provisionRun");
    expect(runs.length).toBe(4);
    expect(screen.getByText("就绪")).toBeTruthy();
    expect(screen.queryByTestId("deploy-wizard")).toBeTruthy();
    // 四步全 ✓ 呈现
    const steps = screen.getAllByTestId("wizard-steps")[0].querySelectorAll('li[data-state="done"]');
    expect(steps.length).toBe(4);
  });

  it("失败即停与步级重试（Gherkin 向导失败即停）：②失败 ▲、③④等待、重试后从②继续", async () => {
    const host = mockHost({
      deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
      provisionFail: { step: "probe-node", kind: "step", message: "node: command not found" },
    });
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    const steps = screen.getAllByTestId("wizard-steps")[0];
    const states = [...steps.querySelectorAll("li")].map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["done", "failed", "pending", "pending"]);
    // 失败报告（②Node 指引）+ 重试按钮，部署停未就绪
    expect(screen.getByTestId("wizard-failure").textContent).toContain("Node");
    expect(screen.getByText("重试此步")).toBeTruthy();
    expect(screen.getByText("未就绪")).toBeTruthy();
    // 清除失败编排 → 重试：①②跳过（已完成）不对——①已完成、②重跑
    host.state.provisionFail = null;
    fireEvent.click(screen.getByText("重试此步"));
    await flush(16);
    expect(screen.getByText("就绪")).toBeTruthy();
  });

  it("幂等重跑跳过已完成（Gherkin）：上轮③失败，重发起 → ①②「跳过（已完成）」直接从③继续", async () => {
    const host = mockHost({
      deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
      provisionFail: { step: "upload", kind: "step", message: "scp 超时" },
    });
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    host.state.provisionFail = null;
    fireEvent.click(screen.getByText("重试此步"));
    await flush(4);
    const steps = screen.getAllByTestId("wizard-steps")[0];
    const states = [...steps.querySelectorAll("li")].map((li) => li.getAttribute("data-state"));
    expect(states.slice(0, 2)).toEqual(["skipped", "skipped"]);
    await flush(16);
    expect(screen.getByText("就绪")).toBeTruthy();
  });

  it("步①免密失败 → SSH_AUTH_REQUIRED 指引文案（ssh-copy-id）", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
        provisionFail: { step: "probe-ssh", kind: "auth", message: "Permission denied" },
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    expect(screen.getByTestId("wizard-failure").textContent).toContain("ssh-copy-id");
  });

  it("D31 第二分支（摘要不符）：④失败给「转直连」入口 → 确认后转就绪（直连）+ 角标留痕", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
        provisionFail: { step: "verify", kind: "hash", message: "sha256 不符" },
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    expect(screen.getByTestId("wizard-failure").textContent).toContain("组件验证未通过");
    fireEvent.click(screen.getByText("改用直连"));
    expect(screen.getByText("改用直连模式")).toBeTruthy();
    expect(screen.getByText(/不再校验远端组件/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认改用直连"));
    await flush();
    expect(screen.getByText("就绪（直连）")).toBeTruthy();
    expect(screen.getByText("直连模式")).toBeTruthy();
  });

  it("D31 第一分支（helper 从未安装）：③失败给「跳过安装，转直连…」入口", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
        provisionFail: { step: "upload", kind: "step", message: "上传超时" },
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush(16);
    fireEvent.click(screen.getByText("跳过安装，改用直连…"));
    fireEvent.click(screen.getByText("确认改用直连"));
    await flush();
    expect(screen.getByText("就绪（直连）")).toBeTruthy();
  });

  it("Esc/✕ = 后台继续（M8）：关闭后卡面「向导执行中」徽章反映、重开续看；[中止] 显式停", async () => {
    const host = mockHost({ deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })] });
    // 首步挂起（可控闸门）：关闭弹层后循环应继续
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = host.provisionRun.bind(host);
    let gated = false;
    host.provisionRun = async (params) => {
      if (!gated) {
        gated = true;
        await gate;
      }
      return original(params);
    };
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-provision"));
    await flush();
    // 首步挂起中：并发重入中性提示 + 执行中徽章
    expect(screen.getByText(/正在执行中/)).toBeTruthy();
    expect(screen.getByTestId("deploy-wizard-running")).toBeTruthy();
    // Esc 关闭 = 后台继续（非中止）
    fireEvent.keyDown(document, { key: "Escape" });
    await flush();
    expect(screen.queryByTestId("deploy-wizard")).toBeNull();
    expect(screen.getByTestId("deploy-wizard-running")).toBeTruthy();
    release();
    await flush(16);
    expect(host.calls.filter((c) => c.command === "provisionRun").length).toBe(4);
    expect(screen.queryByTestId("deploy-wizard-running")).toBeNull();
    expect(screen.getByText("就绪")).toBeTruthy();
  });
});

describe("移除与只读", () => {
  it("移除确认：尽力自清理说明 + 确认后列表移除", async () => {
    const host = await boot(mockHost({ deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })] }));
    fireEvent.click(screen.getByText("移除"));
    expect(screen.getByText(/删除本机的部署记录/)).toBeTruthy();
    expect(screen.getByText(/清理远端已安装的组件/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认移除"));
    await flush();
    expect(host.calls.some((c) => c.command === "deploymentDelete" && (c.params as { id: string }).id === "d1")).toBe(
      true,
    );
    expect(screen.getByText(/还没有远程部署/)).toBeTruthy();
  });

  it("断开态「重连并检查」→ deploymentRecheck", async () => {
    const host = await boot(
      mockHost({ deployments: [makeDeployment({ id: "d1", alias: "gpu-1", status: "disconnected" })] }),
    );
    fireEvent.click(screen.getByTestId("deploy-reconnect"));
    await flush();
    expect(host.calls.some((c) => c.command === "deploymentRecheck")).toBe(true);
  });

  it("只读模式：添加/开通/编辑/移除全置灰（列表浏览允许）", async () => {
    await boot(
      mockHost({
        dbStatus: { userVersion: 2, pluginWindow: { min: 1, max: 1 }, mode: "readonly" },
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1" })],
      }),
    );
    expect((screen.getByTestId("deploy-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("deploy-provision") as HTMLButtonElement).disabled).toBe(true);
    const row = screen.getByTestId("deploy-row");
    const buttons = within(row).getAllByRole("button");
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
