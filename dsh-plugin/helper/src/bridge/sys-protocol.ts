/**
 * 桥协议系统能力扩展（AD §4.3 全表；specs/dsh-plugin-full-parity）——类型与枚举单源，
 * 经 protocol.ts `export *` 并入公共导入面（host 侧 pet/ 与 helper 校验器同源消费）。
 *
 * 方向约定：下行（插件 → helper）8 条 sys 消息；上行（helper → 插件）9 条
 * （cmd 的 `pet-chat` op 扩展在 protocol.ts 的 CMD_OPS）。
 *
 * 双向兼容语义（NFR-14 / A28）：
 * - hello 门控：host 未收到 hello 前禁发任何 sys 消息（能力位快照到达才放行）；
 * - seq 两段语义：dialog-request / mac-auth-query → 秒级 ack（回执级，10s 超时判能力
 *   缺席）→ result（完成级，不设短超时，≥5min 长超时兜底；host 取消走 dialog-cancel）；
 * - 崩溃数 = 0：未知消息丢弃 + 计错不崩（两侧校验器同步，validators-sys.ts）。
 *
 * 文本渲染红线（AD §4.3）：桥文本字段（通知标题/正文、chat-reply、tts-speak）在
 * helper 渲染层一律 textContent 赋值，禁 innerHTML / insertAdjacentHTML——host 组装
 * 文案亦不视为可信（纵深防御；渲染层实现在 sys/ 任务，此处为协议侧声明）。
 */

/** sys-notify / notify-clicked 的通知种类（AD §4.3 sys-notify 行） */
export const NOTIFY_KINDS = ["reminder", "pomo-done", "pomo-chime", "overdue", "review"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/**
 * hello.caps 系统能力位集（8 位，AD §4.3 / A28）：host 按位降级（缺位不发对应消息 →
 * 页内降级通道）。helper 实装对应 sys/ 模块后才声明该位（能力位与实现不得失配）。
 */
export const SYS_CAPS = [
  "sys-tray",
  "sys-shortcut",
  "sys-notify",
  "sys-tts",
  "sys-dialog",
  "sys-open",
  "input-count",
  "mac-auth",
] as const;
export type SysCap = (typeof SYS_CAPS)[number];

/** 文件对话框过滤条目（dialog-request.filters[]） */
export interface DialogFileFilter {
  name: string;
  extensions: string[];
}

// ---- 下行（插件 → helper）8 条 ----

/** 系统能力启停面（tray/shortcuts/inputResponse/tts/pet；三语文案不在此——host 组装） */
export interface SysConfigMsg {
  type: "sys-config";
  /** 托盘（tooltip + 桌宠可见性回传——label 同步；petVisible 可选向后兼容） */
  tray?: { tooltip: string; petVisible?: boolean };
  shortcuts?: { capture: string; togglePet: string };
  inputResponse?: { enabled: boolean; focusHopCoupleMax?: number };
  tts?: { enabled: boolean };
  /** 桌宠基础面（无能力位——仅 hello 门控）：陪跑/聊聊条件 + 精灵与窗口配置（P1 D2/D5） */
  pet?: {
    mate?: boolean;
    agentConfigured?: boolean;
    /** 主宝可梦 key（空闲精灵选择链；缺省 = 兜底 pikachu） */
    mainPokemon?: string;
    /** 置顶开关（默认 true；false = 取消 alwaysOnTop 且看门狗停跑） */
    alwaysOnTop?: boolean;
    /** 缩放档（值域 1 / 1.25 / 1.5 / 2；窗口尺寸与渲染几何等比联动） */
    scale?: number;
    /** 精灵/气泡透明度档（值域 100 / 80 / 60） */
    opacity?: number;
  };
}

/** 系统通知（三语文案 host 组装——与桌面 notification_text 同源；点击无动作） */
export interface SysNotifyMsg {
  type: "sys-notify";
  kind: NotifyKind;
  title: string;
  body: string;
}

/** TTS 播报（仅郑重时刻；默认静音由 sys-config.tts.enabled 控制；失败 helper 静默） */
export interface TtsSpeakMsg {
  type: "tts-speak";
  text: string;
}

/** 文件对话框请求（seq 两段语义第一段：helper 秒级回 dialog-ack） */
export interface DialogRequestMsg {
  type: "dialog-request";
  mode: "open-file";
  filters?: DialogFileFilter[];
  seq: number;
}

/** host 侧取消通道：helper 关闭对应系统对话框并丢弃该 seq 的迟到结果 */
export interface DialogCancelMsg {
  type: "dialog-cancel";
  seq: number;
}

/** 打开目录/文件（导出目录定位；不存在 host 先建再下发） */
export interface OpenPathMsg {
  type: "open-path";
  path: string;
}

/** macOS 授权查询（accessibility；同型两段语义：秒级 mac-auth-ack → mac-auth-result） */
export interface MacAuthQueryMsg {
  type: "mac-auth-query";
  kind: "accessibility";
  seq: number;
}

/** AI 聊聊回答（截前 2 句；失败 ok:false 气泡回退） */
export interface ChatReplyMsg {
  type: "chat-reply";
  text: string;
  ok: boolean;
}

// ---- 上行（helper → 插件）9 条 ----

export const TRAY_ACTIONS = ["open", "pet-toggle", "settings", "quit"] as const;

/** 托盘菜单动作（quit = helper 连同桌宠与托盘退出，宿主不受影响） */
export interface TrayActionMsg {
  type: "tray-action";
  action: (typeof TRAY_ACTIONS)[number];
}

export const SHORTCUT_IDS = ["capture", "togglePet"] as const;

/** 全局快捷键触发（注册失败时 helper 不发——降级提示经诊断面） */
export interface ShortcutFiredMsg {
  type: "shortcut-fired";
  id: (typeof SHORTCUT_IDS)[number];
}

/** 通知点击观测留痕（无动作语义） */
export interface NotifyClickedMsg {
  type: "notify-clicked";
  kind: NotifyKind;
}

/** dialog-request 的秒级回执（回执级：host 10s ack 超时判能力在位） */
export interface DialogAckMsg {
  type: "dialog-ack";
  seq: number;
}

/** 对话框完成级结果（不设短超时；canceled=true 无 paths） */
export interface DialogResultMsg {
  type: "dialog-result";
  seq: number;
  canceled: boolean;
  paths?: string[];
}

/** mac-auth-query 的秒级回执（回执级，同 dialog-ack） */
export interface MacAuthAckMsg {
  type: "mac-auth-ack";
  seq: number;
}

/** 授权状态结果（完成级）。**seq = 0 保留给无对应请求的主动上报**（授权中途撤销 →
 * helper 停止计数并主动上报 granted:false；host 侧 seq 从 1 起，0 不参与请求配对）。 */
export interface MacAuthResultMsg {
  type: "mac-auth-result";
  seq: number;
  kind: "accessibility";
  granted: boolean;
}

/** 输入活动强度（≥1s 节流回传；仅计数——键值/键名/窗口标题/应用名 0 出 helper，NFR-13） */
export interface InputActivityMsg {
  type: "input-activity";
  cps: number;
}

/**
 * 能力位与实现失配的兜底上报（未来版本错位）：helper 认识消息类型但实现在位面缺失时
 * 发给 host 记诊断 + 面板提示升级 helper。载荷字段名 `unsupported`（AD §4.3 表记
 * `{ type }` 与信封 type 字段撞名，就地改此名）。每类型节流一次 + 计错进诊断；
 * **旧 helper 不认识本消息本身**——对旧 helper 发未知消息只能被其「丢弃 + 计错」。
 */
export interface SysUnsupportedMsg {
  type: "sys-unsupported";
  unsupported: string;
}
