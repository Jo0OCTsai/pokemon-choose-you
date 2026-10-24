/** 窗体尺寸常量（electron-app.ts 与 ipc.ts 共用；单独成叶防循环） */

export const WINDOW_W = 300;
export const WINDOW_H = 330;
/** 快捷图鉴屏展开宽（UIUX §3.2/§7：300×330 ↔ 590×330） */
export const QUICK_W = 590;
/** ChatBox 原位展开高（FR-A8：300×330 ↔ 300×480——透明窗多余高度不可见，桌面同法） */
export const CHAT_H = 480;
