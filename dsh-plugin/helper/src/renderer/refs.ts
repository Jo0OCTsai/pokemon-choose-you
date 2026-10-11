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
  // ContextMenu / CaptureShow
  ctxMenu: $("#ctx-menu"),
  captureBall: $("#capture-ball"),
  captureStars: $("#capture-stars"),
};
