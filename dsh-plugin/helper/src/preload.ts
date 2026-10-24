/**
 * preload（contextIsolation + sandbox 白名单面）：渲染层 ↔ 主进程 IPC 的唯一通道。
 * 构建产物为 CJS（dist/preload.cjs）——sandbox 预载脚本只暴露 require('electron') 的
 * contextBridge/ipcRenderer 子集。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("petBridge", {
  /** UiEvent 订阅（task/lang/pomo-config/sprites/pet-state/bubble） */
  onUiEvent: (cb: (ev: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, ev: unknown) => cb(ev);
    ipcRenderer.on("ui-event", listener);
    return () => ipcRenderer.removeListener("ui-event", listener);
  },
  /** 命中区翻转：active=true 关穿透（可点），false 开穿透（forward 保留 mousemove） */
  setHit: (active: boolean) => ipcRenderer.invoke("pet:hit", active),
  /** 拖动增量（主进程 setPosition；>4px 阈值在渲染层判定） */
  dragBy: (dx: number, dy: number) => ipcRenderer.invoke("pet:dragBy", dx, dy),
  /** 拖动结束：上报窗口位置（cmd.pet-interact + pos，宿主侧持久化） */
  reportPos: () => ipcRenderer.invoke("pet:reportPos"),
  /** 快捷图鉴屏 300 ↔ 590 宽翻转 */
  quickSize: (open: boolean) => ipcRenderer.invoke("pet:quickSize", open),
  /** ChatBox 原位展开调高 330 ↔ 480（宽度不动） */
  chatSize: (open: boolean) => ipcRenderer.invoke("pet:chatSize", open),
  /** 请求即时坐栖复评（返回当前坐栖态；FR-B1） */
  checkPerch: () => ipcRenderer.invoke("pet:checkPerch"),
  /** 上行 cmd（op 枚举校验在主进程 runtime.sendCmd） */
  cmd: (op: string, fields?: Record<string, unknown>) => ipcRenderer.invoke("pet:cmd", op, fields),
  /** 本端完成（done cmd + focus-settle 结账 + celebrating） */
  complete: () => ipcRenderer.invoke("pet:complete"),
  /** 本地 TTS（生日台词等——主进程 sys 路由，tts.enabled 门控） */
  speak: (text: string) => ipcRenderer.invoke("pet:speak", text),
  /** 交互事件回流（pet-start/drag-end/celebrate-end/interact…白名单在主进程） */
  interact: (kind: string) => ipcRenderer.invoke("pet:interact", kind),
  /** 番茄本地控制（focus/trial/break） */
  pomo: (action: "focus" | "trial" | "break", durationMin?: number) =>
    ipcRenderer.invoke("pet:pomo", action, durationMin),
  /** 每秒快照（petState/lang/activeTask/pomo 进度/reducedMotion） */
  snapshot: () => ipcRenderer.invoke("pet:snapshot"),
  /** 素材候选链解析（含 A20 双缺回退与单次缺失事件） */
  sprite: (key: string) => ipcRenderer.invoke("pet:sprite", key),
  /** 宝可梦名（当前语言；台词插值 {p}） */
  spriteName: (key: string, lang: string) => ipcRenderer.invoke("pet:spriteName", key, lang),
});
