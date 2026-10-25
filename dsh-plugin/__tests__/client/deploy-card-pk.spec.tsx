/**
 * pk 通道开通（ADR-0003 · 从 deploy-card.spec.tsx 拆出——棘轮 max-lines，等量迁移）：
 * 就绪行入口（未就绪/断开无）→ deploymentSetupPk 命令与报告 Modal 分步呈现；
 * 失败报告（pkSetupFail 编排）与 RPC 失败信封 alert；只读禁用。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

async function boot(host: MockHost): Promise<MockHost> {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <DeploymentCard onChanged={() => undefined} />
      </I18nProvider>
    </ClientProvider>,
  );
  await flush();
  return host;
}

describe("pk 通道开通（ADR-0003）", () => {
  const readyRow = () => [makeDeployment({ id: "d1", alias: "gpu-1", status: "ready" })];

  it("就绪行呈现「开通 pk 通道」钮（未就绪/断开行无）；点击 → 命令带 id + 报告 Modal 成功步骤", async () => {
    const host = await boot(
      mockHost({
        deployments: [
          ...readyRow(),
          makeDeployment({ id: "d2", alias: "gpu-2", status: "not_ready" }),
          makeDeployment({ id: "d3", alias: "gpu-3", status: "disconnected" }),
        ],
      }),
    );
    expect(screen.getAllByTestId("deploy-setup-pk").length).toBe(1);
    fireEvent.click(screen.getByTestId("deploy-setup-pk"));
    await flush();
    expect(host.calls.find((c) => c.command === "deploymentSetupPk")?.params).toMatchObject({ id: "d1" });
    const report = screen.getByTestId("deploy-pk-report");
    expect(report.textContent).toContain("开通成功");
    expect(report.textContent).toContain("pk remote setup");
  });

  it("失败报告（pkSetupFail 编排）→ Modal 呈现失败步骤详情（分步指引不炸信封）", async () => {
    await boot(
      mockHost({
        deployments: readyRow(),
        pkSetupFail: { detail: "远端 shim 安装失败" },
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-setup-pk"));
    await flush();
    const report = screen.getByTestId("deploy-pk-report");
    expect(report.textContent).toContain("开通失败");
    expect(report.textContent).toContain("远端 shim 安装失败");
  });

  it("RPC 失败 → Modal alert 呈现错误信封", async () => {
    const host = mockHost({ deployments: readyRow() });
    host.deploymentSetupPk = async () => ({
      ok: false as const,
      error: { code: "HELPER_CAPABILITY_MISSING" as const, message: "本机 pk 不可用" },
    });
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-setup-pk"));
    await flush();
    expect(screen.getByTestId("deploy-pk-report-error").textContent).toContain("本机 pk 不可用");
  });

  it("只读模式：开通钮置灰", async () => {
    await boot(
      mockHost({
        deployments: readyRow(),
        dbStatus: { userVersion: 2, pluginWindow: { min: 1, max: 1 }, mode: "readonly" },
      }),
    );
    expect((screen.getByTestId("deploy-setup-pk") as HTMLButtonElement).disabled).toBe(true);
  });
});
