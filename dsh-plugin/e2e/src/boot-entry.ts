/**
 * harness boot：dist/client.js 装载完成后——apply(伪 ctx) 注册四槽 → 渲染 main 面板
 * （key = "pokemon-choose-you"，sidebarPanel.PANEL_ID）到 #root。加载失败把错误写进
 * #harness-error 供测试断言（不静默白屏）。
 */
const pky = window.__pky;

function fail(message: string): void {
  const el = document.createElement("pre");
  el.id = "harness-error";
  el.textContent = message;
  document.body.appendChild(el);
}

try {
  if (pky.clientExports === null || typeof pky.clientExports.apply !== "function") {
    throw new Error("client bundle 未捕获（__ModuleLoader__.load 未被调用或导出面缺失）");
  }
  pky.clientExports.apply(pky.ctx);
  const panel = pky.registry["pokemon-choose-you"];
  if (typeof panel !== "function") {
    throw new Error(`main 槽组件未注册（registry keys: ${Object.keys(pky.registry).join(", ")}）`);
  }
  const rootEl = document.getElementById("root");
  if (rootEl === null) {
    throw new Error("#root 不在");
  }
  window.ReactDOM.createRoot(rootEl).render(panel({}));
} catch (error) {
  fail(String(error instanceof Error ? error.stack : error));
}
