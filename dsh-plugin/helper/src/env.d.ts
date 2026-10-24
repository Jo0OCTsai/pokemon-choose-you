/** CSS / 字体包模块声明（renderer 入口 import；esbuild 打包实体，tsc 只需形状） */
declare module "*.css";
declare module "@fontsource/press-start-2p";
declare module "@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css";

/**
 * uiohook-napi 最小结构面（sys/inputCount.ts 唯一原生依赖挂点；包经 dsh-plugin 根
 * dependencies 分发、运行时向上寻址解析——本声明只覆盖消费面）。**handler 一律零参**：
 * 类型面即 NFR-13 只计数红线（键值/键名字段不进本模块的类型宇宙，eslint 规则再加
 * 机械锁——见 eslint.config.ts no-restricted-syntax）。
 */
declare module "uiohook-napi" {
  export const uiohook: {
    on(event: "key" | "keyup" | "mousedown" | "mouseup" | "mousemove" | "wheel", handler: () => void): unknown;
    off(event: "key" | "keyup" | "mousedown" | "mouseup" | "mousemove" | "wheel", handler: () => void): unknown;
    start(): unknown;
    stop(): unknown;
  };
}

/** preload 注入的桥面（contextBridge） */
interface PetBridgeApi {
  onUiEvent: (cb: (ev: unknown) => void) => () => void;
  setHit: (active: boolean) => Promise<void>;
  dragBy: (dx: number, dy: number) => Promise<void>;
  reportPos: () => Promise<boolean>;
  quickSize: (open: boolean) => Promise<void>;
  /** ChatBox 展开调高 330 ↔ 480（宽度不动——快捷屏 590 宽优先级在前者之上不叠加） */
  chatSize: (open: boolean) => Promise<void>;
  /** 请求即时坐栖复评（返回当前坐栖态；FR-B1） */
  checkPerch: () => Promise<boolean>;
  cmd: (op: string, fields?: Record<string, unknown>) => Promise<boolean>;
  complete: () => Promise<void>;
  interact: (kind: string) => Promise<void>;
  pomo: (action: "focus" | "trial" | "break", durationMin?: number) => Promise<void>;
  snapshot: () => Promise<unknown>;
  sprite: (key: string) => Promise<unknown>;
  spriteName: (key: string, lang: string) => Promise<string>;
}

interface Window {
  petBridge: PetBridgeApi;
}
