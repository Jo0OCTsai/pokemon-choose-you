/**
 * 侧边栏一级入口 + 主区全局面板（平台面：`sidebar.panellist` list 槽 + `main` keyed 槽）。
 * 0.2.0-rc.2 客户端把 main 区开放为 keyed 全局面板（`conversation` 为保留 key），侧边栏
 * 以 `sidebar.panellist` 提供一级入口（同一 id 寻址 main key；order 内置插件 0 / 自动化
 * 任务 10，本面板 20 排其后）——入口不再只经 插件列表 → detail page（U16 当时的「main 区
 * 仅两页」平台事实已被此机制取代）。行壳（选中态/无障碍标签/点击选中）归侧边栏，图标
 * 组件只渲染装饰性精灵球字形；主面板 = 入口型页面：darwin 顶部以
 * --dsh-frame-top-clearance 避让红绿灯带（ui-layout 约定）、整页自滚动，复用
 * PluginDetailPage（与 detail section 同一组件双载体）。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PluginDetailPage } from "../app/PluginDetailPage";
import type { Locale } from "../i18n";
import dshEn from "../i18n/dsh-en";
import dshZhHans from "../i18n/dsh-zh-Hans";
import dshZhHant from "../i18n/dsh-zh-Hant";
import type { PanelData } from "../model";
import { fetchPanelData } from "./panelData";
import { PluginConfigProvider, type PluginConfigController } from "./pluginConfig";
import type { HostClient, PageSection } from "../rpc";
import styles from "./mainPanel.module.css";

/** 面板 id（sidebar.panellist 的 id 与 main keyed 槽的 key 同源寻址） */
export const PANEL_ID = "pokemon-choose-you";
/** 侧边栏排序（内置：插件 0 / 自动化任务 10；本面板排其后） */
export const PANEL_ORDER = 20;

/** 三语面板标题（侧边栏一级入口标签；与页面 PageHeader 同源 dsh.page.title） */
const PANEL_TITLES: Record<Locale, string> = {
  "zh-Hans": dshZhHans.page.title,
  "zh-Hant": dshZhHant.page.title,
  en: dshEn.page.title,
};

/** dsh 宿主 locale 服务面（收窄读取；形态不符或抛错回落 null → en） */
interface LocaleFace {
  getSnapshot?: () => { locale?: unknown };
}

function hostLocaleTag(locale: unknown): string | null {
  try {
    const tag = (locale as LocaleFace | null)?.getSnapshot?.().locale;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}

/** 宿主语言标签 → 本插件三语（zh 细分繁简，其余回落 en——与宿主字典回退链一致） */
export function localeForTag(tag: string | null): Locale {
  if (tag === null || !tag.toLowerCase().startsWith("zh")) {
    return "en";
  }
  const lower = tag.toLowerCase();
  return /tw|hk|mo|hant/.test(lower) ? "zh-Hant" : "zh-Hans";
}

/** 侧边栏标签（locale-aware thunk：宿主 locale 变化时侧边栏重求值） */
export function createPanelLabel(locale: unknown): () => string {
  return () => PANEL_TITLES[localeForTag(hostLocaleTag(locale))];
}

/** 侧边栏入口图标（装饰性占用者：无障碍导航标签归侧边栏行壳，此处只画精灵球字形） */
export function PanelIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
      data-testid="pky-sidebar-icon"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h5" />
      <path d="M15.5 12h5" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** ctx.layout 面（收窄：chip 点击直达所需的面板选中） */
export interface PanelLayoutFace {
  selectPanel(id: string | null): void;
}

/** 面板打开器（chip 点击 → 客户端闭环选中本面板；layout 缺席 noop 不阻塞就近控制） */
export function createPanelOpener(layout: PanelLayoutFace | undefined): (section?: PageSection) => void {
  return () => {
    layout?.selectPanel(PANEL_ID);
  };
}

/** 数据快照根（主区面板的拉取/刷新壳——plugins.detail.section 摘除后图鉴机 UI 唯一载体；
 *  pluginConfig = 插件私有配置控制器（背包分区行消费——Context 注入，null = 行不渲染）） */
export function createPanelRoot(
  host: HostClient,
  config: PluginConfigController | null = null,
): () => React.JSX.Element {
  function PanelRoot(): React.JSX.Element {
    const [data, setData] = useState<PanelData | null>(null);
    const refresh = useCallback((): void => {
      void fetchPanelData(host).then(setData);
    }, []);
    useEffect(() => {
      refresh();
    }, [refresh]);
    if (data === null) {
      return <div data-testid="pky-panel-loading" />;
    }
    return (
      <div data-pky-panel="" style={{ minHeight: 0 }}>
        <PluginConfigProvider controller={config}>
          <PluginDetailPage client={host} data={data} onChanged={refresh} />
        </PluginConfigProvider>
      </div>
    );
  }
  return PanelRoot;
}

/** 主区全局面板（main keyed 槽组件：darwin 顶部避让 + 整页自滚动） */
export function createMainPanel(
  host: HostClient,
  config: PluginConfigController | null = null,
): (props: Record<string, unknown>) => ReactNode {
  const PanelRoot = createPanelRoot(host, config);
  return function MainPanel(): ReactNode {
    return (
      <div className={styles.shell}>
        <PanelRoot />
      </div>
    );
  };
}
