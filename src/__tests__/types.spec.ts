import { describe, expect, it } from "vitest";
import { spriteUrl, spriteFallback } from "../types";

describe("spriteUrl", () => {
  it("优先返回动图路径", () => {
    expect(spriteUrl("pikachu")).toBe("/pokemon/pikachu.gif");
  });
});

describe("spriteFallback", () => {
  it("加载失败时回退静态图并清除 onerror 防止死循环", () => {
    const img = document.createElement("img");
    img.dataset.sprite = "chansey";
    img.onerror = null;
    spriteFallback({ target: img } as unknown as Event);
    expect(img.getAttribute("src")).toBe("/pokemon/chansey.png");
    expect(img.onerror).toBeNull();
  });
});
