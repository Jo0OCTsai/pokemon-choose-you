import { describe, expect, it } from "vitest";
import { ALL_EVENT_NAMES, EVENTS } from "../events";

/**
 * 与 src-tauri/src/events.rs 的契约测试对齐：两侧事件名集合必须一致。
 * Rust 侧断言 JSON 数组（固定顺序），此处断言排序后的集合——任何一侧增删/改名事件，
 * 两个测试会同时失败，提醒同步修改。
 */
const RUST_SIDE_FIXTURE = [
  "tasks-changed",
  "categories-changed",
  "settings-changed",
  "chat-messages-changed",
  "tags-changed",
  "task-reminder",
  "quick-capture",
  "show-settings",
  "update-available",
  "update-progress",
  "integration-health-changed",
];

describe("前后端事件契约", () => {
  it("事件名全集与 Rust events.rs 一致", () => {
    expect([...ALL_EVENT_NAMES].sort()).toEqual([...RUST_SIDE_FIXTURE].sort());
  });

  it("事件名为 kebab-case 常量", () => {
    for (const name of Object.values(EVENTS)) {
      expect(name).not.toMatch(/_/);
      expect(name).toMatch(/^[a-z-]+$/);
    }
  });
});
