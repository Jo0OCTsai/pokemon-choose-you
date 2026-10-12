/**
 * dsh 客户端半边入口（Phase B 真实适配层）：浏览器端 vendored cordis Loader 经
 * window.__ModuleLoader__.load 挂载本模块（dist/client.js，IIFE-CJS），消费具名导出
 * inject/apply——与宿主半边 hostEntry 同形（平台胶水；业务在 src/client/** 视图与
 * src/host/** 核心）。
 *
 * apply 职责：ctx.connection.rpc → DshRpcTransport → createHostClient，注册两个 slot：
 * ① plugins.detail.section（list/root）：owner props 携 subject——指向本包
 *   （pkg.name === "dsh-plugin"）才渲染 PluginDetailPage（七段面板），其余渲染 null
 *   （契约：他包 detail 页零占位）；
 * ② conversation.session.header.actions（list/session）：ConversationChip 四态挂载
 *   （无进行中任务零占位）。选 actions 而非 conversation.header：后者是 single 容器位
 *   （dsh 自身的会话头壳占据，第三方注册即同 cell 冲突），actions 是标题邻接控制 list
 *   位——多插件共存互不挤占。
 *
 * chip 点击主体的 pageOpen 语义（经宿主导航打开插件页面）：host 推送通道尚未接 dsh
 * 导航/事件面——onOpenPage 不传（就地 noop），真实导航接面后续落型；⏸/✔ 就近控制
 * 走 rpc 真实可用。slots.inject 自带 ctx.effect 纤维回收（返回幂等 disposer），apply
 * 内直接调用即得卸载清理（dsh cordis-client-runner 样例同形）。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PluginDetailPage } from "../app/PluginDetailPage";
import { ConversationChip, type ChipMode } from "../chip/ConversationChip";
import { ClientProvider } from "../clientContext";
import { I18nProvider, type Locale } from "../i18n";
import type { PanelData } from "../model";
import { createHostClient, type HostClient, type PageSection } from "../rpc";
import type { Task } from "../../host/domain/tasks";
import { fetchPanelData, loadLocale } from "./panelData";
import { createDshRpcTransport, type DshConnectionRpc } from "./transport";

/** 本包名（bundle 定位面；subject.pkg.name 与之比对） */
const PKG_NAME = "dsh-plugin";

/** 面板 section 槽（plugin-manager 契约：kind list / scope root / owner { subject }） */
const PANEL_SLOT = "plugins.detail.section";
/** 会话头 chip 槽（conversation 契约：kind list / scope session，标题邻接控制位） */
const CHIP_SLOT = "conversation.session.header.actions";

/** slot 注册 options（list 槽形态：id 必填；对齐 dsh-client-ui-slots 的 KindOptions） */
interface SlotRegisterOptions {
  name: string;
  id: string;
  order?: number;
}

/** slot 组件（框架 props 透传——owner/标准件按槽契约合成，本层只消费已知键） */
type SlotComponent = (props: Record<string, unknown>) => ReactNode;

/** dsh client 侧 ctx（结构化收窄：本入口消费的三个服务面） */
export interface DshClientContext {
  slots: {
    inject(key: string, contribute: () => Iterable<() => void> | (() => void)): () => void;
    register(options: SlotRegisterOptions, component: SlotComponent): () => void;
  };
  /** 语言自持（共享设置 language 键经 rpc 读）；注入位保留供后续宿主语言同步接面 */
  locale: unknown;
  connection: { rpc: DshConnectionRpc };
}

/** 必需服务（client 侧 ctx 属性名；web 组合三者齐备） */
export const inject = ["slots", "locale", "connection"];

/** plugins.detail.section 的 subject（plugin-manager 契约三态，本层只读 pkg.name） */
type PluginsSubject = { kind?: string; pkg?: { name?: unknown }; id?: unknown };

/** subject 是否指向本包（bundle/row 两形态都带 pkg；item 形态无 pkg → false） */
function subjectIsSelf(subject: unknown): boolean {
  const scoped = subject as PluginsSubject | undefined;
  return scoped?.pkg?.name === PKG_NAME;
}

/** 面板 section 工厂：subject 自判 + 数据快照拉取/刷新 + 高度自适应容器（自然流，宿主页自滚动） */
function createPanelSection(host: HostClient): SlotComponent {
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
        <PluginDetailPage client={host} data={data} onChanged={refresh} />
      </div>
    );
  }
  return function PanelSection(props): ReactNode {
    if (!subjectIsSelf(props.subject)) {
      return null;
    }
    return <PanelRoot />;
  };
}

/**
 * chip 数据源（进行中任务/番茄倒计时/分类精灵名）：host 侧读命令与推送通道均未落型
 * ——v1 恒「无进行中」（NFR-6 零占位，chip 不渲染）；数据接面（活跃任务读命令或
 * 状态推送）落型后此处点亮，⏸/✔/🍦 就近控制即经 rpc 真实生效。
 */
function useChipTask(): { task: Task | null; mode: ChipMode; secondsLeft: number; pokemonName: string } {
  return { task: null, mode: "running", secondsLeft: 0, pokemonName: "" };
}

/** 会话头 chip 工厂：语言经共享设置初始化（切换走背包显示分区保存后刷新拉新值） */
function createChipEntry(host: HostClient): SlotComponent {
  function ChipRoot(): React.JSX.Element | null {
    const [locale, setLocale] = useState<Locale>("zh-Hans");
    useEffect(() => {
      void loadLocale(host).then(setLocale);
    }, []);
    const chip = useChipTask();
    // pageOpen 导航降级：host 推送通道未接 dsh 导航——onOpenPage 缺省即点击 noop（真实接面后续落型）
    const openPage: ((section?: PageSection) => void) | undefined = undefined;
    return (
      <I18nProvider locale={locale}>
        <ClientProvider client={host}>
          <ConversationChip
            task={chip.task}
            mode={chip.mode}
            secondsLeft={chip.secondsLeft}
            pokemonName={chip.pokemonName}
            onOpenPage={openPage}
          />
        </ClientProvider>
      </I18nProvider>
    );
  }
  return function ChipEntry(): ReactNode {
    return <ChipRoot />;
  };
}

/** 客户端 apply：transport → HostClient → 双 slot 注册（fiber 卸载经 slots.inject 自带回收） */
export function apply(ctx: DshClientContext): void {
  const host = createHostClient(createDshRpcTransport(ctx.connection.rpc));
  ctx.slots.inject(PANEL_SLOT, () =>
    ctx.slots.register({ name: PANEL_SLOT, id: `${PKG_NAME}#panel` }, createPanelSection(host)),
  );
  ctx.slots.inject(CHIP_SLOT, () =>
    ctx.slots.register({ name: CHIP_SLOT, id: `${PKG_NAME}#chip` }, createChipEntry(host)),
  );
}
