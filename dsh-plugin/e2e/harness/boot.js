"use strict";
(() => {
  // e2e/src/boot-entry.ts
  var pky = window.__pky;
  function fail(message) {
    const el = document.createElement("pre");
    el.id = "harness-error";
    el.textContent = message;
    document.body.appendChild(el);
  }
  try {
    if (pky.clientExports === null || typeof pky.clientExports.apply !== "function") {
      throw new Error("client bundle \u672A\u6355\u83B7\uFF08__ModuleLoader__.load \u672A\u88AB\u8C03\u7528\u6216\u5BFC\u51FA\u9762\u7F3A\u5931\uFF09");
    }
    pky.clientExports.apply(pky.ctx);
    const panel = pky.registry["pokemon-choose-you"];
    if (typeof panel !== "function") {
      throw new Error(`main \u69FD\u7EC4\u4EF6\u672A\u6CE8\u518C\uFF08registry keys: ${Object.keys(pky.registry).join(", ")}\uFF09`);
    }
    const rootEl = document.getElementById("root");
    if (rootEl === null) {
      throw new Error("#root \u4E0D\u5728");
    }
    window.ReactDOM.createRoot(rootEl).render(panel({}));
  } catch (error) {
    fail(String(error instanceof Error ? error.stack : error));
  }
})();
