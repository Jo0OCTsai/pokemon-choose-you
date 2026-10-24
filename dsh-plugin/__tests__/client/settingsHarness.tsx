/**
 * 设置区测试公共件：SettingsSegment 渲染壳 + 分区导航/取页便捷件 + 标签夹具
 * （settings-parity.spec 消费；对照 reviewWizardHarness / drawerHarness 手法）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { SettingsSegment } from "../../src/client/settings/SettingsSegment";
import type { SectionKey } from "../../src/client/settings/sectionKeys";
import { makeData } from "./fixtures";
import type { PanelData } from "../../src/client/model";
import type { Tag } from "../../src/host/domain/vocabulary-tags";

/** 渲染背包分段（保存制/离开确认回调全替身） */
export function renderSettings(
  data: PanelData = makeData(),
  host: MockHost = mockHost(),
  overrides: Partial<React.ComponentProps<typeof SettingsSegment>> = {},
) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale={data.locale}>
        <SettingsSegment
          data={data}
          onChanged={vi.fn()}
          leaveRequest={null}
          onLeaveResolved={vi.fn()}
          onUnsavedChange={vi.fn()}
          {...overrides}
        />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host };
}

/** 经 SectionNav 点选分区 */
export function gotoSection(name: string): void {
  const nav = screen.getByTestId("section-nav");
  fireEvent.click(within(nav).getByText(new RegExp(name)));
}

/** 分区整页容器 */
export function getPage(key: SectionKey): HTMLElement {
  return document.querySelector(`div[data-section-wrap="${key}"]`) as HTMLElement;
}

/** 标签夹具（维度/标签由用例各自注入） */
export function makeTag(overrides: Partial<Tag> & { id: number }): Tag {
  return {
    name: `标签${overrides.id}`,
    description: "",
    dimension: "topic",
    origin: "manual",
    createdAt: "2026-10-11T09:00:00+08:00",
    usage: 0,
    ...overrides,
  };
}
