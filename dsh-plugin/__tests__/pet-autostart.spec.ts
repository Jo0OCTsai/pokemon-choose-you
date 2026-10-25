/**
 * pet/supervisor「随 dsh 启动」开关（A2 Config 双轨）：host 侧读写接口，默认开；
 * 内存实现仅骨架——插件 Config schema 装配层替换为平台持久化实现。
 */
import { describe, expect, it } from "vitest";
import { memoryPetAutoStartStore } from "../src/host/pet/supervisor";

describe("随 dsh 启动开关（A2：host 侧读写接口）", () => {
  it("默认开；读写可覆盖（内存实现，Config schema 装配层替换持久化）", () => {
    const store = memoryPetAutoStartStore();
    expect(store.get()).toBe(true); // 随 dsh 启动默认开
    store.set(false);
    expect(store.get()).toBe(false);
    store.set(true);
    expect(store.get()).toBe(true);
    expect(memoryPetAutoStartStore(false).get()).toBe(false);
  });
});
