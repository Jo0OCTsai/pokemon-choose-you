import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useActionToast, type ActionToast } from "../composables/useActionToast";

describe("useActionToast 动作反馈条", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("run 成功路径：忙位置位期间文案为提示语，fn 返回值进状态条，完成后忙位恢复", async () => {
    const toast = useActionToast();
    const seen: Array<[boolean, string]> = [];
    const p = toast.run("测试中", async () => {
      seen.push([toast.busy.value, toast.msg.value]);
      return "连接正常";
    });
    expect(toast.busy.value).toBe(true); // fn 执行期间忙位保持
    await p;
    expect(seen).toEqual([[true, "测试中"]]);
    expect(toast.msg.value).toBe("连接正常");
    expect(toast.busy.value).toBe(false);
  });

  it("run 失败路径：错误带 ❌ 前缀进状态条，忙位恢复", async () => {
    const toast = useActionToast();
    await toast.run("测试中", async () => {
      throw new Error("boom");
    });
    expect(toast.msg.value).toBe(`❌ 图鉴机遇到了点状况：boom`);
    expect(toast.busy.value).toBe(false);
  });

  it("run 空提示语不动文案；fn 返回 void 时成功路径也不动文案", async () => {
    const toast = useActionToast();
    toast.msg.value = "旧消息";
    await toast.run("", async () => {
      /* 无提示文案的动作（如技能检查） */
    });
    expect(toast.msg.value).toBe("旧消息");
    expect(toast.busy.value).toBe(false);
  });

  it("flash 默认 2000ms 后清除，自定义时长生效", () => {
    const toast = useActionToast();
    toast.flash("已保存");
    expect(toast.msg.value).toBe("已保存");
    vi.advanceTimersByTime(1999);
    expect(toast.msg.value).toBe("已保存");
    vi.advanceTimersByTime(1);
    expect(toast.msg.value).toBe("");

    toast.flash("稍后再清", 6000);
    vi.advanceTimersByTime(5999);
    expect(toast.msg.value).toBe("稍后再清");
    vi.advanceTimersByTime(1);
    expect(toast.msg.value).toBe("");
  });

  it("flash 重复调用重置清除定时器：后设置的文案存活完整时长", () => {
    const toast = useActionToast();
    toast.flash("第一条");
    vi.advanceTimersByTime(1500);
    toast.flash("第二条");
    vi.advanceTimersByTime(1000); // 距第一条已 2500ms，但其定时器已被重置
    expect(toast.msg.value).toBe("第二条");
    vi.advanceTimersByTime(1000);
    expect(toast.msg.value).toBe("");
  });

  it("组件卸载后清理清除定时器（无泄漏）", () => {
    let toast: ActionToast | undefined;
    const Host = defineComponent({
      setup() {
        toast = useActionToast();
        return () => h("div");
      },
    });
    const w = mount(Host);
    toast!.flash("保存成功");
    w.unmount();
    vi.advanceTimersByTime(10_000);
    expect(toast!.msg.value).toBe("保存成功"); // 定时器已随卸载销毁，文案不再被清除
  });

  it("传入外部 msg 时与其他实例共享同一条状态条，忙位各自独立", async () => {
    const page = useActionToast();
    const skill = useActionToast({ msg: page.msg });
    skill.msg.value = "技能已更新";
    expect(page.msg.value).toBe("技能已更新"); // 同一条状态条

    const skillP = skill.run("", async () => undefined);
    expect(skill.busy.value).toBe(true);
    expect(page.busy.value).toBe(false); // 忙位不共享：技能检查不锁页面级按钮
    await skillP;
  });
});
