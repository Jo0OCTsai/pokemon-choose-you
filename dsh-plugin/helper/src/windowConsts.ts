/** 窗体尺寸常量（electron-app.ts 与 ipc.ts 共用；单独成叶防循环） */

export const WINDOW_W = 300;
export const WINDOW_H = 330;
/** 快捷图鉴屏展开宽（UIUX §3.2/§7：300×330 ↔ 590×330） */
export const QUICK_W = 590;
/** ChatBox 展开高（FR-A8：300×330 ↔ 300×480——底缘不动向上长高，展开区给面板） */
export const CHAT_H = 480;
