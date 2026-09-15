import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const petWindowMock = {
  setIgnoreCursorEvents: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  setSize: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
  // 窗口位于屏幕 (100, 200)，光标在 (150, 250) → 窗口内 CSS 坐标 (50, 50)
  outerPosition: vi.fn(async () => ({ x: 100, y: 200 })),
  scaleFactor: vi.fn(async () => 1),
};
const cursorAt = vi.fn(async () => ({ x: 150, y: 250 }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => petWindowMock,
  cursorPosition: () => cursorAt(),
}));

import { usePetClickThrough } from "../composables/usePetClickThrough";

/** 伪造命中结果：null = 空白（穿透），元素 = 实体内容（接收事件） */
function mockHit(el: Element | null) {
  return vi.spyOn(document, "elementFromPoint").mockImplementation(() => el);
}

function move(x: number, y: number, buttons = 0) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons }));
}

describe("usePetClickThrough 桌宠透明区点击穿透", () => {
  let dispose: (() => void) | null = null;
  // 命中检测只认 .pet-stage / .ctx-menu 内的元素：搭一个同构的 DOM 片段
  const stage = document.createElement("div");
  stage.className = "pet-stage";
  const solid = document.createElement("div");
  stage.appendChild(solid);
  const ctxMenu = document.createElement("ul");
  ctxMenu.className = "ctx-menu";
  const wrapper = document.createElement("div"); // #app 等舞台外包装层

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.append(stage, ctxMenu, wrapper);
  });
  afterEach(() => {
    dispose?.();
    dispose = null;
    stage.remove();
    ctxMenu.remove();
    wrapper.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("光标在空白处开启穿透，轮询发现回到实体内容后恢复", async () => {
    const hit = mockHit(null); // 初始：光标下无实体（elementFromPoint 落到 body）
    dispose = usePetClickThrough();

    move(10, 300); // 窗口底部空白
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);

    // 穿透中：轮询发现光标 (50,50) 落在实体元素上 → 恢复接收
    hit.mockReturnValue(solid);
    await vi.advanceTimersByTimeAsync(120);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  });

  it("回归：舞台外包装层（#app 等）不算实体内容，不阻断穿透", async () => {
    mockHit(wrapper); // 命中落在 .pet-stage 之外的容器上
    dispose = usePetClickThrough();

    move(10, 300);
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);
  });

  it("Teleport 到 body 的右键菜单算实体内容", async () => {
    mockHit(null);
    dispose = usePetClickThrough();

    move(10, 300);
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);

    // 菜单展开盖住光标位置 → 恢复接收，菜单可点击
    vi.spyOn(document, "elementFromPoint").mockReturnValue(ctxMenu);
    await vi.advanceTimersByTimeAsync(120);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  });

  it("光标在实体内容上不穿透", async () => {
    mockHit(solid);
    dispose = usePetClickThrough();

    move(50, 50);
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).not.toHaveBeenCalled();
  });

  it("按住鼠标（拖拽窗口期）不开启穿透", async () => {
    mockHit(null);
    dispose = usePetClickThrough();

    move(50, 50, 1); // buttons=1：左键按住
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).not.toHaveBeenCalled();
  });

  it("卸载时恢复接收事件并停轮询", async () => {
    mockHit(null);
    const stop = usePetClickThrough();

    move(10, 300);
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);

    stop();
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
    petWindowMock.setIgnoreCursorEvents.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    expect(petWindowMock.setIgnoreCursorEvents).not.toHaveBeenCalled();
  });

  it("轮询换算坐标基于窗口位置与缩放（高分屏 factor=2）", async () => {
    mockHit(null);
    petWindowMock.scaleFactor.mockResolvedValue(2);
    // 窗口 (100,200)、factor 2：窗口内 CSS (50,50) 对应屏幕物理 (200, 300)
    cursorAt.mockResolvedValue({ x: 200, y: 300 });
    dispose = usePetClickThrough();

    move(10, 300);
    await vi.advanceTimersByTimeAsync(0);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);

    // 光标移到窗口内 CSS (100,60) 处是实体内容（mock 命中任何点都返回实体）
    vi.spyOn(document, "elementFromPoint").mockImplementation((x, y) => (x === 100 && y === 60 ? solid : null));
    cursorAt.mockResolvedValue({ x: 300, y: 320 }); // (300-100)/2=100, (320-200)/2=60
    await vi.advanceTimersByTimeAsync(120);
    expect(petWindowMock.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  });
});
