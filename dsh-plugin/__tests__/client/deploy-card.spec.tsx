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
    expect(screen.getByText("直连模式")).toBeTruthy();
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
    expect(screen.getByText("复制安装方法")).toBeTruthy();
  });
});

describe("常驻隧道状态徽章（ADR-0003 双宿主呈现，对齐桌面 tunnelText）", () => {
  it("persistent 部署显状态文案 + title 详情；非常驻显「隧道未运行」；未配置不显", async () => {
    await boot(
      mockHost({
        deployments: [
          makeDeployment({ id: "d1", alias: "gpu-1", status: "ready", pkTunnel: { port: 10022, persistent: true } }),
          makeDeployment({ id: "d2", alias: "gpu-2", status: "ready", pkTunnel: { port: 10023, persistent: true } }),
          makeDeployment({ id: "d3", alias: "gpu-3", status: "ready", pkTunnel: { port: 10024, persistent: false } }),
          makeDeployment({ id: "d4", alias: "gpu-4", status: "ready" }),
        ],
        tunnelStates: {
          d1: { state: "healthy", detail: "gpu-1 ⇄ 127.0.0.1:10022 已连通（keepalive 自愈中）" },
          d2: { state: "yielded", detail: "另一宿主（PID 42）正在维持本部署隧道，让位待命中" },
        },
      }),
    );
    const badges = screen.getAllByTestId("deploy-tunnel");
    expect(badges.map((b) => b.textContent)).toEqual(["隧道已连通", "隧道让位待命"]);
    expect(badges[0]!.title).toContain("10022");
    expect(badges[1]!.dataset["tone"]).toBe("tunnel-yielded");
    expect(screen.getByTestId("deploy-tunnel-off").textContent).toBe("隧道未运行");
    const rows = screen.getAllByTestId("deploy-row");
    expect(within(rows[3]!).queryByTestId("deploy-tunnel")).toBeNull();
    expect(within(rows[3]!).queryByTestId("deploy-tunnel-off")).toBeNull();
  });

  it("隧道面未装配（tunnel=null）→ persistent 部署按未运行呈现，无 title", async () => {
    await boot(
      mockHost({
        deployments: [
          makeDeployment({ id: "d1", alias: "gpu-1", status: "ready", pkTunnel: { port: 10022, persistent: true } }),
        ],
      }),
    );
    const badge = screen.getByTestId("deploy-tunnel");
    expect(badge.textContent).toBe("隧道未运行");
    expect(badge.dataset["tone"]).toBe("tunnel-off");
    expect(badge.title).toBe("");
  });
});

describe("DeployFormModal 新增/编辑", () => {
  it("新增：别名/路径行内校验（保存禁用语义 = 行内拒绝）→ 成功后自动进向导", async () => {
    const host = await boot(mockHost({ sshAliases: ["gpu-1", "gpu-9"] }));
    fireEvent.click(screen.getByTestId("deploy-add"));
    await flush();
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

  it("别名下拉：选项来自 sshAliasList（~/.ssh/config）；占位项在首位", async () => {
    await boot(mockHost({ sshAliases: ["gpu-1", "pky-remote"] }));
    fireEvent.click(screen.getByTestId("deploy-add"));
    await flush();
    const select = screen.getByLabelText(/OpenSSH 别名/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "gpu-1", "pky-remote"]);
    expect(select.options[0]!.textContent).toContain("选择 OpenSSH 别名");
  });

  it("别名下拉空态：config 无可用别名 → 提示项（缺席不是错误态——不报错只提示）", async () => {
    await boot(mockHost({ sshAliases: [] }));
    fireEvent.click(screen.getByTestId("deploy-add"));
    await flush();
    const empty = screen.getByLabelText(/OpenSSH 别名/) as HTMLSelectElement;
    expect(Array.from(empty.options).map((o) => o.value)).toEqual([""]);
    expect(empty.options[0]!.textContent).toContain("~/.ssh/config");
  });

  it("编辑：预填 + 保存后回落未就绪提示（§8 部署编辑回落；当前别名不在 config 列表时保留可选）", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1", status: "ready", note: "训练机" })],
        sshAliases: [],
      }),
    );
    fireEvent.click(screen.getByText("编辑"));
    await flush();
    expect((screen.getByLabelText(/OpenSSH 别名/) as HTMLSelectElement).value).toBe("gpu-1");
    expect((screen.getByLabelText(/备注/) as HTMLInputElement).value).toBe("训练机");
    fireEvent.change(screen.getByLabelText(/备注/), { target: { value: "训练机 2 号位" } });
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(screen.getByTestId("deploy-save-hint").textContent).toContain("请重新开通");
    expect(screen.getByText("未就绪")).toBeTruthy();
  });

  it("`~` 前缀与重复别名由 host 校验回显（路径不变式）", async () => {
    await boot(
      mockHost({
        deployments: [makeDeployment({ id: "d1", alias: "gpu-1", nodePath: "/usr/bin/node" })],
        sshAliases: ["gpu-1"],
      }),
    );
    fireEvent.click(screen.getByTestId("deploy-add"));
    await flush();
    fireEvent.change(screen.getByLabelText(/OpenSSH 别名/), { target: { value: "gpu-1" } });
    fireEvent.change(screen.getByLabelText(/远端 Node 路径/), { target: { value: "~/bin/node" } });
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(screen.getByTestId("deploy-form-error").textContent).toContain("~");
  });
});

describe("断开重连反馈闭环 + 重装入口", () => {
  // 工厂而非常量：mock 会原位改实体状态（复核恢复置 ready），常量会被用例间污染
  const disconnected = () => [makeDeployment({ id: "d1", alias: "gpu-1", status: "disconnected" })];

  it("busy 态：复核进行中按钮换「检查中…」并禁用；完成后复原", async () => {
    const host = mockHost({ deployments: disconnected() });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = host.deploymentRecheck.bind(host);
    host.deploymentRecheck = async (params) => {
      await gate;
      return original(params);
    };
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-reconnect"));
    await flush(2);
    const busyButton = screen.getByTestId("deploy-reconnect") as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.textContent).toBe("检查中…");
    release();
    await flush();
    const restButton = screen.getByTestId("deploy-reconnect") as HTMLButtonElement;
    expect(restButton.disabled).toBe(false);
    expect(restButton.textContent).toBe("重连并检查");
  });

  it("复核仍断开 → 行内 status 行「复核完成：仍未连通」+ lastError 更新（零静默）", async () => {
    await boot(mockHost({ deployments: disconnected() }));
    fireEvent.click(screen.getByTestId("deploy-reconnect"));
    await flush();
    expect(screen.getByTestId("deploy-recheck-note").textContent).toContain("仍未连通");
    expect(screen.getByText(/连接不可用/)).toBeTruthy();
    expect(screen.getByText("断开")).toBeTruthy();
  });

  it("复核恢复 → 徽章翻「就绪」，无附加行；重连钮消失", async () => {
    await boot(mockHost({ deployments: disconnected(), recheckRecovers: true }));
    fireEvent.click(screen.getByTestId("deploy-reconnect"));
    await flush();
    expect(screen.getByText("就绪")).toBeTruthy();
    expect(screen.queryByTestId("deploy-recheck-note")).toBeNull();
    expect(screen.queryByTestId("deploy-reconnect")).toBeNull();
  });

  it("RPC 失败 → 行内 alert 呈现错误信封（不再静默吞掉）", async () => {
    const host = mockHost({ deployments: disconnected() });
    host.deploymentRecheck = async () => ({
      ok: false as const,
      error: { code: "HELPER_CAPABILITY_MISSING" as const, message: "远程部署平台面未装配" },
    });
    await boot(host);
    fireEvent.click(screen.getByTestId("deploy-reconnect"));
    await flush();
    expect(screen.getByTestId("deploy-recheck-error").textContent).toContain("平台面未装配");
    expect(screen.getByText("断开")).toBeTruthy();
  });

  it("断开行常驻「重装远端组件」链接（就绪/未就绪行无）；点击 → restart 向导重跑至就绪", async () => {
    const host = await boot(
      mockHost({
        deployments: [
          ...disconnected(),
          makeDeployment({ id: "d2", alias: "gpu-2", status: "ready" }),
          makeDeployment({ id: "d3", alias: "gpu-3", status: "not_ready" }),
        ],
      }),
    );
    expect(screen.getAllByTestId("deploy-reinstall").length).toBe(1); // 仅断开行
    fireEvent.click(screen.getByTestId("deploy-reinstall"));
    await flush(16);
    const restartCall = host.calls.find((c) => c.command === "provisionRun");
    expect(restartCall?.params).toMatchObject({ id: "d1", restart: true });
    expect(screen.getByTestId("deploy-wizard")).toBeTruthy();
    expect(screen.getByText("就绪 2 · 未就绪 1 · 断开 0")).toBeTruthy(); // d1 重装完成恢复 → 断开清零
  });

  it("只读模式：重连钮与重装链接均置灰", async () => {
    await boot(
      mockHost({
        deployments: disconnected(),
        dbStatus: { userVersion: 2, pluginWindow: { min: 1, max: 1 }, mode: "ro" },
      }),
    );
    expect((screen.getByTestId("deploy-reconnect") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("deploy-reinstall") as HTMLButtonElement).disabled).toBe(true);
  });
});
