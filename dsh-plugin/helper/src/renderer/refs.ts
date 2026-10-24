/** DOM 元素引用面（index.html 静态骨架；模块顶层一次取齐，缺元素 = 模板被改坏，尽早炸） */
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const refs = {
  // SpriteStage
  stage: $("#stage"),
  sprite: $<HTMLImageElement>("#sprite"),
  ring: $("#ring"),
  ringFg: $("#ring-fg"),
  quickFab: $("#quick-fab"),
  zzz: $("#zzz"),
  // DialogBox
  dialog: $("#dialog"),
  dialogInner: $(".dialog-inner"),
  dialogText: $("#dialog-text"),
  dialogNext: $("#dialog-next"),
  // PomoPill
  pill: $("#pomo-pill"),
  pillText: $("#pomo-text"),
  pillPause: $("#pill-pause"),
  pillResume: $("#pill-resume"),
  pillTrial: $("#pill-trial"),
  pillDone: $("#pill-done"),
  // QuickDexScreen
  quickDex: $("#quick-dex"),
  quickList: $("#quick-list"),
  quickEmpty: $("#quick-empty"),
  quickClose: $("#quick-close"),
  // ContextMenu / CaptureShow（streak 双球：第二球）
  ctxMenu: $("#ctx-menu"),
  captureBall: $("#capture-ball"),
  captureBall2: $("#capture-ball-2"),
  captureStars: $("#capture-stars"),
  // ChatBox（FR-A8：原位 ≤4 行）
  chatBox: $("#chat-box"),
  chatLog: $("#chat-log"),
  chatInput: $<HTMLInputElement>("#chat-input"),
  chatSend: $("#chat-send"),
  chatClose: $("#chat-close"),
  chatChips: Array.from(document.querySelectorAll<HTMLButtonElement>("#chat-chips button")),
  // 陪跑精灵（FR-B4）
  mate: $("#mate"),
  mateImg: $<HTMLImageElement>("#mate-img"),
  mateTitle: $("#mate-title"),
};
