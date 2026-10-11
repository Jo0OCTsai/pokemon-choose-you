/** CSS / 字体包模块声明（renderer 入口 import；esbuild 打包实体，tsc 只需形状） */
declare module "*.css";
declare module "@fontsource/press-start-2p";
declare module "@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css";

/** preload 注入的桥面（contextBridge） */
interface PetBridgeApi {
  onUiEvent: (cb: (ev: unknown) => void) => () => void;
  setHit: (active: boolean) => Promise<void>;
  dragBy: (dx: number, dy: number) => Promise<void>;
  reportPos: () => Promise<boolean>;
  quickSize: (open: boolean) => Promise<void>;
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
