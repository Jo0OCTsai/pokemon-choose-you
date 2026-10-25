/**
 * AX 授权引导（U26/FR-A9/D32）：非 macOS 输入响应整卡隐藏（非置灰）；macOS 下
 * 未授权指引块（说明 + helper 路径点击复制 + [去授权]）、失效态（开关开启但授权缺失）、
 * 已授权整块消失；macAuthorizationStatus 查询与 [去授权] 命令消费。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { SettingsSegment } from "../../src/client/settings/SettingsSegment";
import { makeData } from "./fixtures";

afterEach(cleanup);

async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** 平台覆写（isMacPlatform 读 navigator.platform——D32 整面隐藏判定） */
function setMac(mac: boolean): void {
  Object.defineProperty(window.navigator, "platform", { value: mac ? "MacIntel" : "Linux x86_64", configurable: true });
}

function renderPets(host: MockHost) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <SettingsSegment
          data={makeData()}
          onChanged={() => undefined}
          leaveRequest={null}
          onLeaveResolved={() => undefined}
          onUnsavedChange={() => undefined}
          initialSection="pets"
        />
      </I18nProvider>
    </ClientProvider>,
  );
}

async function bootPets(host: MockHost): Promise<MockHost> {
  renderPets(host);
  await flush();
  return host;
}

describe("AX 授权引导（U26/D32）", () => {
  it("非 macOS：输入响应整卡不渲染（非置灰——开关与指引块都不出现）", async () => {
    setMac(false);
    await bootPets(mockHost());
    expect(screen.queryByText("输入响应")).toBeNull();
    expect(screen.queryByTestId("ax-perm-hint")).toBeNull();
    // 语音/陪跑不受 AX 门槛（仍在）
    expect(screen.getByText("桌宠语音")).toBeTruthy();
  });

  it("macOS 未授权：指引块（只计数说明 + helper 路径 + [去授权]）+ macAuthorizationStatus 查询", async () => {
    setMac(true);
    const host = await bootPets(
      mockHost({
        macAuth: { granted: false, helperPath: "/mock/.dsh/electron/dist/pky-helper.app/Contents/MacOS/pky-helper" },
      }),
    );
    expect(screen.getByTestId("ax-perm-hint")).toBeTruthy();
    expect(screen.getByText(/只统计按键频率——不记录键值、键名、窗口或应用/)).toBeTruthy();
    expect(screen.getAllByText(/pky-helper\.app\/Contents\/MacOS\/pky-helper/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "去授权" })).toBeTruthy();
    expect(host.calls.some((c) => c.command === "macAuthorizationStatus")).toBe(true);
  });

  it("[去授权] → macAuthPaneOpen 直达系统设置辅助功能面板", async () => {
    setMac(true);
    const host = await bootPets(mockHost({ macAuth: { granted: false, helperPath: "/mock/helper" } }));
    fireEvent.click(screen.getByRole("button", { name: "去授权" }));
    await flush();
    expect(host.calls.some((c) => c.command === "macAuthPaneOpen")).toBe(true);
  });

  it("失效态：开关开启但授权缺失 → 「授权已失效，需重新授权」前置提示", async () => {
    setMac(true);
    const data = makeData();
    data.config = { ...data.config, pet_input_response: "true" };
    render(
      <ClientProvider client={mockHost({ macAuth: { granted: false, helperPath: "/mock/helper" } })}>
        <I18nProvider locale="zh-Hans">
          <SettingsSegment
            data={data}
            onChanged={() => undefined}
            leaveRequest={null}
            onLeaveResolved={() => undefined}
            onUnsavedChange={() => undefined}
            initialSection="pets"
          />
        </I18nProvider>
      </ClientProvider>,
    );
    await flush();
    expect(screen.getByTestId("ax-perm-revoked").textContent).toContain("授权已失效，需重新授权");
  });

  it("已授权：指引块整块消失（授权是开关的伴随态）", async () => {
    setMac(true);
    await bootPets(mockHost({ macAuth: { granted: true, helperPath: "/mock/helper" } }));
    expect(screen.queryByTestId("ax-perm-hint")).toBeNull();
    expect(screen.getByText("输入响应")).toBeTruthy();
  });
});
