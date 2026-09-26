/**
 * 桌宠瞬态台词效果截图（开发工具，不入测试链路）：
 * 起 vite 后用 Playwright 打开 pet.html，注入 Tauri API mock（任务/设置/事件），
 * 按场景截图验证：瞬态气泡、悬停 ☰ 钮、快捷屏、状态播报、提醒钉住。
 * 用法：node scripts/shot-pet.mjs （需先 pnpm exec vite --port 5199 --strictPort）
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5199/pet.html";
const OUT = "/tmp/pet-shots";
mkdirSync(OUT, { recursive: true });

/** 注入到页面的 mock（addInitScript 序列化，需自包含） */
function tauriMock() {
  const fixture = { current: null, tasks: [] };
  window.__fixture = fixture;
  window.__setCurrent = (t) => (fixture.current = t);
  // 静音问候与时刻台词（截图窗口内不乱入搭话）
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  localStorage.setItem("pet.greetedOn", now.toISOString().slice(0, 10));
  localStorage.setItem("pet.metOn", String(Date.now() - 30 * 86_400_000));
  for (const k of ["night", "friday", "birthday"]) localStorage.setItem(`pet.line.${k}.${day}`, "1");
  localStorage.setItem(`pet.line.hour.${day}.${now.getHours()}`, "1");

  const cbs = new Map();
  let cbSeq = 1;
  const evMap = new Map();
  let evSeq = 1;
  window.__emitEvent = (name, payload) => {
    for (const [lid, e] of evMap) if (e.name === name) cbs.get(e.hid)?.({ event: name, id: lid, payload });
  };
  const categories = [
    { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu", enabled: true },
    { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck", enabled: true },
  ];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "pet" }, currentWebview: { label: "pet" } },
    transformCallback(cb) {
      const id = cbSeq++;
      cbs.set(id, cb);
      return id;
    },
    async invoke(cmd, args = {}) {
      if (cmd === "plugin:event|listen") {
        const lid = evSeq++;
        evMap.set(lid, { name: args.event, hid: args.handler });
        return lid;
      }
      if (cmd === "plugin:event|unlisten") {
        evMap.delete(args.id);
        return null;
      }
      switch (cmd) {
        case "list_categories":
          return categories;
        case "get_current_task":
          return fixture.current;
        case "list_tasks":
          return fixture.tasks;
        case "list_all_settings":
          return {};
        case "get_setting":
          return null;
        case "add_focus_seconds":
          return null;
        case "task_streak":
          return { days: 0, todayCount: 0 };
        case "dex_stats":
          return { caught: 0, escaped: 0, sprites: [] };
        case "pet_input_set_enabled":
          return "ok";
        case "pet_input_permission":
          return true;
      }
      if (cmd.startsWith("plugin:window|")) {
        const op = cmd.split("|")[1];
        if (op === "outer_position") return { x: 100, y: 100 };
        if (op === "outer_size") return { width: 300, height: 330 };
        if (op === "scale_factor") return 1;
        if (op === "current_monitor")
          return {
            scaleFactor: 2,
            position: { x: 0, y: 0 },
            size: { width: 1512, height: 982 },
            workArea: { position: { x: 0, y: 0 }, size: { width: 1512, height: 944 } },
          };
        return null;
      }
      return null;
    },
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 300, height: 330 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript(tauriMock);
await page.goto(BASE, { waitUntil: "networkidle" });
// 桌面感背景（仅截图 harness，不动应用样式）
await page.addStyleTag({
  content: "html{background:linear-gradient(165deg,#b8dcff 0%,#e6f2ff 42%,#fdf3dd 100%)!important}",
});
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

// 1. 启动：欢迎气泡（瞬态）
await page.evaluate(() => {
  window.__fixture.tasks = [
    { id: 1, title: "写周报", categoryId: 1, status: "active" },
    { id: 2, title: "整理收件箱", categoryId: 1, status: "scheduled" },
    { id: 3, title: "读《图鉴收集指南》第三章", categoryId: 2, status: "scheduled" },
  ].map((t) => ({
    ...t,
    note: null,
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-01",
    completedAt: null,
    focusSeconds: 0,
    tags: [],
  }));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(700);
await shot("01-welcome-bubble");

// 2. 气泡到时淡出：只剩精灵（无常驻状态文字）
await page.waitForTimeout(7_000);
await shot("02-idle-sprite-only");

// 3. 单击精灵：随机搭话（不再是快捷屏）
await page.click(".sprite-hit");
await page.waitForTimeout(450);
await shot("03-single-click-quote");
await page.waitForTimeout(6_500);

// 4. 悬停精灵：☰ 唤出钮浮现
await page.hover(".sprite-hit");
await page.waitForTimeout(350);
await shot("04-hover-fab");

// 5. 点 ☰ 展开快捷图鉴屏（真实应用窗口会撑高到 590，这里等比扩 viewport 模拟）
await page.setViewportSize({ width: 300, height: 590 });
await page.click(".quick-fab");
await page.waitForTimeout(700);
await shot("05-quick-dex");

// 6. 收起快捷屏；开始任务 → 状态切换播报 + 番茄药丸
await page.locator(".quick-dex .ops button", { hasText: "收起" }).click();
await page.setViewportSize({ width: 300, height: 330 });
await page.evaluate(() => {
  window.__setCurrent({
    id: 3,
    title: "读《图鉴收集指南》第三章",
    categoryId: 2,
    status: "active",
  });
  window.__emitEvent("tasks-changed", null);
});
await page.waitForTimeout(900);
await shot("06-working-announce");

// 7. 播报淡出后：药丸承载状态，安静专注
await page.waitForTimeout(8_000);
await shot("07-working-quiet");

// 8. 提醒钉住：气泡 + 就近完成/推迟按钮（不自动倒计时）
await page.evaluate(() => {
  window.__emitEvent("task-reminder", { id: 2, title: "交报告", urgent: true, pokemon: "可达鸭" });
});
await page.waitForTimeout(600);
await shot("08-reminder-pinned");

await browser.close();
console.log("shots saved to", OUT);
