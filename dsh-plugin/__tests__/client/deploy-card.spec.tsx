/**
 * 远程部署族（U23/U24/U31/M8）：DeploymentCard 列表与四呈现徽章 + 直连角标 + 最近错误 +
 * 计数；DeployFormModal 新增/编辑（行内校验 + 编辑回落提示 + 新增自动进向导）；
 * DeploymentWizard 四步条 × 四态（自动推进 / 失败即停 / 幂等重跑跳过已完成 / D31 两分支
 * 降级确认 → 就绪（直连）+ 留痕角标）；Esc/✕ 后台继续（卡面「向导执行中」徽章）与
 * [中止] 显式停止；移除确认（尽力自清理说明）；断开重连；SSH 家族缺失整卡指引态；
 * 只读禁用清单（M7）。
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

describe("部署卡列表与徽章", () => {
  it("空态：远方的图鉴机引导 + 主行动「＋ 添加部署」", async () => {
    await boot(mockHost());
    expect(screen.getByText(/还没有远程部署。添加一台远端机器/)).toBeTruthy();
    expect(screen.getByTestId("deploy-add")).toBeTruthy();
  });

  it("四呈现徽章 + 直连角标 + 最近错误行 + 计数", async () => {
    await boot(
      mockHost({
        deployments: [
          makeDeployment({ id: "d1", alias: "gpu-1", status: "ready" }),
          makeDeployment({
            id: "d2",
            alias: "gpu-2",
            status: "ready",
            degraded: true,
          }),
          makeDeployment({ id: "d3", alias: "gpu-3", status: "not_ready", lastError: "免密连接未通过" }),
          makeDeployment({ id: "d4", alias: "gpu-4", status: "disconnected" }),
        ],
      }),
    );
    expect(screen.getByText("就绪 2 · 未就绪 1 · 断开 1")).toBeTruthy();
    expect(screen.getByText("就绪（直连）")).toBeTruthy();
    expect(screen.getByText("未就绪")).toBeTruthy();
    expect(screen.getByText("断开")).toBeTruthy();
    expect(screen.getByText("直连模式（未经摘要校验）")).toBeTruthy();
    expect(screen.getByText(/最近错误：免密连接未通过/)).toBeTruthy();
    // 断开态给「重连并检查」；就绪行不给开通钮（开通钮只属未就绪行 gpu-3）
    expect(screen.getByTestId("deploy-reconnect")).toBeTruthy();
    const notReadyRow = screen.getAllByTestId("deploy-row")[2];
    expect(within(notReadyRow).getByTestId("deploy-provision")).toBeTruthy();
    expect(screen.getAllByTestId("deploy-provision").length).toBe(1);
  });

  it("SSH 家族缺失 → 整卡指引态（无死入口：不渲染添加钮与行操作）", async () => {
    await boot(mockHost({ sshFamily: { ok: false, detail: "dsh plugin add @deepseek-ai/dsh-ssh" } }));
    const guide = screen.getByTestId("deploy-ssh-guide");
    expect(guide.textContent).toContain("dsh-ssh");
    expect(guide.textContent).toContain("dsh plugin add @deepseek-ai/dsh-ssh");
    expect(screen.queryByTestId("deploy-add")).toBeNull();
    expect(screen.getByText("复制装载指引")).toBeTruthy();
  });
});

describe("DeployFormModal 新增/编辑", () => {
  it("新增：别名/路径行内校验（保存禁用语义 = 行内拒绝）→ 成功后自动进向导", async () => {
    const host = await boot(mockHost());
    fireEvent.click(screen.getByTestId("deploy-add"));
    fireEvent.click(screen.getByText("保存"));
    expect(screen.getByText(/别名不能为空/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/OpenSSH 别名/), { target: { value: "gpu-9" } });
    fireEvent.click(screen.getByText("保存"));
    expect(screen.getByText(/Node 路径不能为空/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/远端 Node 路径/), { target: { value: "/usr/bin/node" } });
    fireEvent.change(screen.getByLabelText(/默认远端工作目录/), { target: { value: "/srv/gpu" } });
    fireEvent.click(screen.getByText("保存"));
    await flush();
    const upsert = host.calls.find((c) => c.command === "deploymentUpsert");
    expect(upsert?.params).toMatchObject({ alias: "gpu-9", nodePath: "/usr/bin/node", workdir: "/srv/gpu" });
    // 新增保存后自动进向导（草稿 → 探测中）
    expect(host.calls.some((c) => c.command === "provisionRun")).toBe(true);
    expect(screen.getByTestId("deploy-wizard")).toBeTruthy();
  });

  it("编辑：预填 + 保存后回落未就绪提示（§8 部署编辑回落）", async () => {
    await boot(
      mockHost({ deployments: [makeDeployment({ id: "d1", alias: "gpu-1", status: "ready", note: "训练机" })] }),
    );
    fireEvent.click(screen.getByText("编辑"));
    expect((screen.getByLabelText(/OpenSSH 别名/) as HTMLInputElement).value).toBe("gpu-1");
    expect((screen.getByLabelText(/备注/) as HTMLInputElement).value).toBe("训练机");
    fireEvent.change(screen.getByLabelText(/备注/), { target: { value: "训练机 2 号位" } });
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(screen.getByTestId("deploy-save-hint").textContent).toContain("已回落为未就绪");
    expect(screen.getByText("未就绪")).toBeTruthy();
  });

  it("`~` 前缀与重复别名由 host 校验回显（路径不变式）", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1", nodePath: "/usr/bin/node" })],
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-add"));
    fireEvent.change(screen.getByLabelText(/OpenSSH 别名/), { target: { value: "gpu-1" } });
    fireEvent.change(screen.getByLabelText(/远端 Node 路径/), { target: { value: "~/bin/node" } });
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(screen.getByTestId("deploy-form-error").textContent).toContain("~");
  });
});
