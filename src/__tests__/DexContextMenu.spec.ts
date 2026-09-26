import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import sfcSource from "../components/DexContextMenu.vue?raw";
import DexContextMenu from "../components/DexContextMenu.vue";
import { closeContextMenu, ctxMenu, openContextMenu, type ContextMenuItem } from "../contextMenu";

/** pet.html 为透明区点击穿透把 html/body/#app 全设 pointer-events:none；菜单 Teleport 到 body，
 *  必须在自身样式里恢复 auto——否则收不到点击，且 elementFromPoint 会跳过它，
 *  usePetClickThrough 把菜单当空白让穿透常开（右键菜单点不了的回归，2026-09 修复）。
 *  unit 环境不加载 SFC 样式，该契约只能在源码层锁定。 */
describe("DexContextMenu 桌宠右键菜单", () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  function open(items: ContextMenuItem[], x = 30, y = 40) {
    openContextMenu(new MouseEvent("contextmenu", { clientX: x, clientY: y }), items);
  }

  afterEach(() => {
    closeContextMenu();
    wrapper?.unmount();
    wrapper = null;
  });

  it("回归：.ctx-menu 自身恢复 pointer-events（body:none 下可点击、可被命中检测识别）", () => {
    expect(sfcSource).toMatch(/\.ctx-menu\s*\{[^}]*pointer-events:\s*auto/m);
  });

  it("打开后 Teleport 到 body 并按光标坐标落位", async () => {
    wrapper = mount(DexContextMenu);
    open([{ key: "dex", label: "图鉴" }]);
    await nextTick();
    const menu = document.body.querySelector("ul.ctx-menu") as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.style.left).toBe("30px");
    expect(menu!.style.top).toBe("40px");
    expect(menu!.querySelectorAll("li[role='menuitem']").length).toBe(1);
  });

  it("点击菜单项：先收起菜单再执行 action", async () => {
    const action = vi.fn();
    wrapper = mount(DexContextMenu);
    open([
      { key: "pause", label: "暂停" },
      { key: "hide", label: "隐藏", action },
    ]);
    await nextTick();
    (document.body.querySelectorAll("li[role='menuitem']")[1] as HTMLElement).click();
    expect(ctxMenu.open).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("禁用项不收起也不执行", async () => {
    const action = vi.fn();
    wrapper = mount(DexContextMenu);
    open([{ key: "chat", label: "对话", disabled: true, action }]);
    await nextTick();
    (document.body.querySelector("li[role='menuitem']") as HTMLElement).click();
    expect(ctxMenu.open).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("菜单外 mousedown 立即收起（捕获阶段判外点）", async () => {
    wrapper = mount(DexContextMenu);
    open([{ key: "dex", label: "图鉴" }]);
    await nextTick();
    document.dispatchEvent(new MouseEvent("mousedown"));
    expect(ctxMenu.open).toBe(false);
  });

  it("Esc 收起菜单", async () => {
    wrapper = mount(DexContextMenu);
    open([{ key: "dex", label: "图鉴" }]);
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ctxMenu.open).toBe(false);
  });
});
