window.__ModuleLoader__.load({
  id: "dsh-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    ("use strict");
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if ((from && typeof from === "object") || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, {
              get: () => from[key],
              enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
            });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/dsh/clientEntry.tsx
    var clientEntry_exports = {};
    __export(clientEntry_exports, {
      apply: () => apply,
      inject: () => inject,
    });
    module.exports = __toCommonJS(clientEntry_exports);
    var import_react57 = require("react");

    // src/client/clientContext.tsx
    var import_react = require("react");
    var import_jsx_runtime = require("react/jsx-runtime");
    var ClientContext = (0, import_react.createContext)(null);
    function ClientProvider({ client, children }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClientContext.Provider, { value: client, children });
    }
    function useClient() {
      const client = (0, import_react.useContext)(ClientContext);
      if (client === null) {
        throw new Error("useClient \u5FC5\u987B\u5728 ClientProvider \u5185\u4F7F\u7528");
      }
      return client;
    }

    // src/client/i18n/index.tsx
    var import_react2 = require("react");

    // ../src/i18n/zh-Hans.ts
    var zh_Hans_default = {
      tabs: {
        today: "\u5192\u9669",
        todayDesc: "\u4ECA\u5929\u51FA\u53D1\u8981\u5B8C\u6210\u7684\u5192\u9669",
        inbox: "\u8349\u4E1B",
        inboxDesc: "\u8FD8\u6CA1\u51B3\u5B9A\u7684\u91CE\u751F\u5B9D\u53EF\u68A6\u5148\u5F85\u5728\u8FD9\u91CC",
        scheduled: "\u8DEF\u7EBF",
        scheduledDesc:
          "\u6309\u65E5\u671F\u89C4\u5212\u7684\u524D\u8FDB\u8DEF\u7EBF\uFF0C\u9010\u7AD9\u5B8C\u6210\u4EFB\u52A1",
        done: "\u56FE\u9274",
        doneDesc: "\u5DF2\u6355\u6349\u767B\u5F55\u7684\u6210\u5C31\u8BB0\u5F55",
        im: "\u6536\u97F3\u673A",
        imDesc: "\u6536\u542C\u98DE\u4E66\u4F20\u6765\u7684\u7535\u6CE2\uFF0C\u4ECE\u4E2D\u6355\u6349\u5F85\u529E",
        sessions: "\u65E5\u5FD7",
        sessionsDesc:
          "Agent \u4F19\u4F34\u7684\u6218\u6597\u5B9E\u5F55\uFF0C\u6BCF\u573A\u4F1A\u8BDD\u90FD\u53EF\u56DE\u653E",
        settings: "\u80CC\u5305",
        settingsDesc: "\u8BAD\u7EC3\u5BB6\u7684\u88C5\u5907\u4E0E\u56FE\u9274\u673A\u8C03\u6821",
      },
      dt: { none: "\u672A\u8BBE\u7F6E", clear: "\u6E05\u7A7A" },
      error: { prefix: "\u56FE\u9274\u673A\u9047\u5230\u4E86\u70B9\u72B6\u51B5\uFF1A" },
      ctx: {
        cut: "\u526A\u5207",
        copy: "\u590D\u5236",
        paste: "\u7C98\u8D34",
        selectAll: "\u5168\u9009",
        openDetail: "\u67E5\u770B\u8BE6\u60C5",
        copyTitle: "\u590D\u5236\u6807\u9898",
        copyLine: "\u590D\u5236\u672C\u884C",
        copied: "\u2714 \u5DF2\u590D\u5236",
      },
      spine: {
        tips: [
          "\u56FE\u9274\u673A\u5FE0\u544A\uFF1A\u8D2A\u591A\u56BC\u4E0D\u70C2\u3002",
          "\u4E00\u6B21\u6D3E\u51FA\u4E00\u53EA\u5B9D\u53EF\u68A6\uFF0C\u4E13\u6CE8\u773C\u524D\u7684\u4EFB\u52A1\u3002",
          "\u91CE\u751F\u5B9D\u53EF\u68A6\u4E0D\u4F1A\u81EA\u5DF1\u8D70\u8FDB\u7CBE\u7075\u7403\u3002",
          "\u8349\u4E1B\u91CC\u7684\uFF0C\u5148\u8BA9\u5B83\u518D\u5F85\u4E00\u4F1A\u513F\u3002",
          "\u9003\u8D70\u4E0D\u4E22\u4EBA\uFF0C\u56FE\u9274\u8BB0\u5F97\u4F60\u6765\u8FC7\u3002",
          "\u8DEF\u7EBF\u662F\u4E00\u7AD9\u4E00\u7AD9\u8D70\u5B8C\u7684\u3002",
          "\u4ECA\u5929\u7684\u98CE\uFF0C\u9002\u5408\u51FA\u53D1\u3002",
          "\u7D2F\u4E86\u5C31\u4F11\u606F\u2014\u2014\u5361\u6BD4\u517D\u4E5F\u662F\u8FD9\u4E48\u505A\u7684\u3002",
        ],
      },
      priority: { low: "\u4F4E", normal: "\u666E\u901A", high: "\u9AD8", urgent: "\u7D27\u6025" },
      status: {
        inbox: "\u8349\u4E1B",
        scheduled: "\u8DEF\u7EBF",
        active: "\u8FDB\u884C\u4E2D",
        paused: "\u6682\u505C",
        done: "\u5DF2\u5B8C\u6210",
        cancelled: "\u5DF2\u9003\u8D70",
      },
      dexFilter: {
        all: "\u5168\u90E8",
        done: "\u5DF2\u6355\u6349",
        cancelled: "\u5DF2\u9003\u8D70",
        empty: {
          all: "\u56FE\u9274\u8FD8\u7A7A\u7A7A\u7684\uFF0C\u53BB\u6355\u6349\u4E00\u53EA\u5B9D\u53EF\u68A6\u5427\uFF01",
          done: "\u8FD8\u6CA1\u6709\u5DF2\u6355\u6349\u7684\u8BB0\u5F55\u3002",
          cancelled: "\u8FD8\u6CA1\u6709\u9003\u8D70\u7684\u8BB0\u5F55\u3002",
        },
      },
      dexStats: {
        line: "\u{1F4D9} \u7D2F\u8BA1\u6355\u6349 {caught} \u53EA \xB7 \u9003\u8D70 {escaped} \u53EA",
        milestone: {
          m0: "\u56FE\u9274\u8FD8\u7A7A\u7740\u2014\u2014\u7B2C\u4E00\u53EA\u5B9D\u53EF\u68A6\u5728\u7B49\u4F60\u3002",
          m1: "\u7B2C\u4E00\u53EA\uFF01\u56FE\u9274\u5F00\u59CB\u8F6C\u52A8\u4E86\u3002",
          m10: "10 \u53EA\u767B\u5F55\uFF0C\u8BAD\u7EC3\u5BB6\u7684\u8282\u594F\u627E\u5230\u4E86\u3002",
          m50: "50 \u53EA\uFF01\u8D44\u6DF1\u8BAD\u7EC3\u5BB6\u7684\u6C14\u606F\u3002",
          m100: "100 \u53EA\uFF01\u4F20\u8BF4\u7EA7\u8BAD\u7EC3\u5BB6\u3002",
          m200: "{n} \u53EA\u2014\u2014\u56FE\u9274\u5FEB\u5199\u4E0D\u4E0B\u4E86\uFF01",
        },
      },
      log: {
        create: "\u521B\u5EFA",
        update: "\u4FEE\u6539",
        start: "\u51FA\u53D1",
        pause: "\u6682\u505C",
        demote: "\u88AB\u9876\u4E0B",
        delete: "\u653E\u751F\u5220\u9664",
        sync_pull: "\u8FDC\u7AEF\u62C9\u53D6",
        sync_push: "\u63A8\u9001\u8FDC\u7AEF",
        sync_close: "\u5173\u95ED\u8FDC\u7AEF",
        migrate: "\u6570\u636E\u8FC1\u79FB",
      },
      search: {
        placeholder:
          "\u{1F50D} \u641C\u7D22\u5F85\u529E\uFF08\u6807\u9898 / \u5907\u6CE8 / \u6807\u7B7E / \u8DDF\u8FDB\u8BB0\u5F55\uFF09",
        searching: "\u641C\u7D22\u4E2D\u2026",
        resultCount: "\u547D\u4E2D {n} \u6761",
        empty: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u5B9D\u53EF\u68A6\u3002",
      },
      im: {
        empty1: "\u6536\u97F3\u673A\u91CC\u5F88\u5B89\u9759\uFF0C\u6682\u65E0\u7535\u6CE2\u3002",
        empty2:
          "\u914D\u7F6E\u98DE\u4E66\u4E0E AI \u540E\uFF0C\u98DE\u4E66\u6D88\u606F\u4F1A\u50CF\u7535\u6CE2\u4E00\u6837\u4F20\u6765\uFF0CAI \u4F1A\u5E2E\u4F60\u6311\u51FA\u5F85\u529E\u4FE1\u53F7\u3002",
        found: "\u{1F4A1} \u53D1\u73B0\u5F85\u529E\u4FE1\u53F7\uFF1A",
        tagNew: "\u62DF\u65B0\u5EFA\u6807\u7B7E\uFF08\u63A5\u53D7\u5EFA\u8BAE\u65F6\u521B\u5EFA\uFF09\xB7 {dim}",
        catch: "\u25CE \u6355\u6349",
        release: "\u2715 \u9003\u8D70",
        search: "\u{1F50D} \u641C\u7D22\u7535\u6CE2\uFF08\u6D88\u606F / \u4F1A\u8BDD / \u53D1\u9001\u8005\uFF09",
        // 快速捕捉：一句话 → AI 判定属性
        capturePlaceholder:
          "\u7528\u4E00\u53E5\u8BDD\u8BB0\u5F55\u5F85\u529E\uFF0CAI \u81EA\u52A8\u5224\u5B9A\u5185\u5BB9 / \u5206\u7C7B / \u6807\u7B7E / \u622A\u6B62\u65F6\u95F4\u2026",
        captureSend: "\u26A1 \u53D1\u62A5",
        capturing: "AI \u5224\u5B9A\u4E2D\u2026",
        capturePending:
          "AI \u5DF2\u751F\u6210\u5EFA\u8BAE\uFF08\u5224\u91CD / \u53D8\u66F4\uFF09\uFF0C\u8BF7\u5728\u6536\u97F3\u673A\u786E\u8BA4",
        force: "\u26A1 \u5F3A\u5236\u6355\u6349",
        forcing: "AI \u5224\u91CD\u4E2D\u2026",
        forceDone: "\u2714 \u5DF2\u521B\u5EFA\u5F85\u529E",
        caughtTask: "\u5DF2\u6355\u6349\u4E3A\u5F85\u529E No.{id}",
        released: "\u5DF2\u9003\u8D70",
        // 已逃走详情条：亮出 AI 原判与人工原因，区分「AI 判无信号后被确认」与「人工否决 AI 信号」
        aiVerdict: "AI \u539F\u5224",
        dismissReasonLabel: "\u539F\u56E0",
        applyUpdate: "\u25CE \u5E94\u7528\u66F4\u65B0",
        updateFound: "\u{1F527} \u5EFA\u8BAE\u66F4\u65B0\u5F85\u529E No.{id}",
        updatedTask: "\u5DF2\u66F4\u65B0\u5F85\u529E No.{id}",
        followedTask: "\u5DF2\u5E76\u5165\u5F85\u529E No.{id} \u7684\u8DDF\u8FDB",
        selectAll: "\u5168\u9009\u5F85\u5904\u7406",
        batchCatch: "\u25CE \u6279\u91CF\u6355\u6349",
        batchRelease: "\u2715 \u6279\u91CF\u9003\u8D70",
        batchDone: "\u5DF2\u5904\u7406 {n} \u6761",
        batchPartial: "{ok} \u6761\u6210\u529F \xB7 {fail} \u6761\u5931\u8D25",
        escapeWhy: "\u4E3A\u4EC0\u4E48\u9003\u8D70\uFF1F\uFF08\u5E2E AI \u8D8A\u5224\u8D8A\u51C6\uFF09",
        escapeNoReason: "\u4E0D\u586B\u539F\u56E0",
        justEscape: "\u76F4\u63A5\u9003\u8D70",
        confidence: { high: "\u9AD8\u7F6E\u4FE1", medium: "\u4E2D\u7F6E\u4FE1", low: "\u4F4E\u7F6E\u4FE1" },
        escapeReasons: {
          duplicate: "\u5DF2\u6709\u7C7B\u4F3C\u5F85\u529E",
          not_task: "\u4E0D\u662F\u7ED9\u6211\u7684\u4EFB\u52A1",
          wrong_info: "\u5EFA\u8BAE\u5185\u5BB9\u4E0D\u5BF9",
          noise: "\u95F2\u804A/\u566A\u97F3",
          outdated: "\u5DF2\u8FC7\u671F",
          other: "\u5176\u4ED6",
        },
        type: {
          bot: "\u673A\u5668\u4EBA",
          p2p: "\u79C1\u804A",
          group: "\u7FA4\u804A",
          local: "\u624B\u52A8\u8F93\u5165",
        },
        status: {
          pending: "AI \u5F85\u5224\u5B9A",
          // 判定进行中（claim 协议，specs/dsh-plugin §7.1 条目 1）：与待判定同观感
          judging: "AI \u5F85\u5224\u5B9A",
          todo: "\u6709\u5F85\u529E\u4FE1\u53F7",
          update: "\u66F4\u65B0\u5EFA\u8BAE",
          none: "\u65E0\u5F85\u529E",
          followup: "\u5DF2\u5E76\u5165\u8DDF\u8FDB",
          error: "AI \u5224\u5B9A\u5931\u8D25",
        },
        // 两栏分诊视图
        viewMode: "\u5217\u8868\u5206\u7EC4\u65B9\u5F0F",
        viewTime: "\u23F1 \u6309\u72B6\u6001",
        viewChannel: "\u{1F4E1} \u6309\u9891\u9053",
        groupSignal: "\u25CE \u5F85\u529E\u4FE1\u53F7",
        groupNoise: "\u{1F507} \u65E0\u4FE1\u53F7",
        groupNoiseTitle:
          "AI \u5224\u5B9A\u4E3A\u65E0\u4FE1\u53F7\uFF08\u672A\u7ECF\u4EBA\u5DE5\u786E\u8BA4\uFF09\uFF1B\u4E00\u952E\u6E05\u7A7A = \u6574\u7EC4\u786E\u8BA4\u4E3A\u566A\u97F3",
        groupFailed: "\u26A0 AI \u5224\u5B9A\u5931\u8D25",
        groupCaught: "\u2714 \u5DF2\u6355\u6349",
        groupEscaped: "\u2715 \u5DF2\u9003\u8D70",
        collapse: "\u6536\u8D77",
        expand: "\u5C55\u5F00",
        clearNoise: "\u2715 \u4E00\u952E\u6E05\u7A7A",
        clearNoiseTitle:
          "\u628A\u65E0\u4FE1\u53F7\u6D88\u606F\u6574\u7EC4\u9003\u8D70\uFF08\u539F\u56E0\u8BB0\u4E3A\u566A\u97F3\uFF09",
        noiseCleared: "\u{1F507} \u5DF2\u6E05\u7A7A {n} \u6761\u65E0\u4FE1\u53F7",
        retryFailed: "\u4E00\u952E\u91CD\u5224",
        retryFailedTitle:
          "\u628A\u300CAI \u5224\u5B9A\u5931\u8D25\u300D\u7684\u6D88\u606F\u91CD\u65B0\u9001 AI \u5224\u5B9A",
        forceEscapeFailed: "\u2715 \u5F3A\u5236\u9003\u8D70",
        forceEscapeFailedTitle:
          "\u628A\u300CAI \u5224\u5B9A\u5931\u8D25\u300D\u7684\u6D88\u606F\u6574\u7EC4\u9003\u8D70\uFF08AI \u5EFA\u8BAE\u4E0D\u53EF\u4FE1\u65F6\uFF09",
        retrying: "\u91CD\u5224\u4E2D\u2026",
        retry: "\u91CD\u5224",
        retryDone: "\u5DF2\u91CD\u5224 {n} \u6761",
        retryPartial: "\u91CD\u5224\u5B8C\u6210\uFF1A{ok} \u6761\u6210\u529F \xB7 {fail} \u6761\u4ECD\u5931\u8D25",
        hiConf: "\u53EA\u9009\u9AD8\u7F6E\u4FE1",
        signalAllDone:
          "\u5F85\u529E\u4FE1\u53F7\u5168\u90E8\u5904\u7406\u5B8C\uFF0C\u8BAD\u7EC3\u5BB6\u6548\u7387\u60CA\u4EBA \u26A1",
        selectHint:
          "\u5728\u5DE6\u4FA7\u9009\u62E9\u4E00\u6761\u7535\u6CE2 \xB7 \u2191\u2193 \u79FB\u52A8 \xB7 C \u6355\u6349 \xB7 X \u9003\u8D70 \xB7 F \u5F3A\u5236",
        undo: "\u21A9 \u64A4\u9500",
        restore: "\u6062\u590D",
        chipUpdate: "\u66F4\u65B0",
        chipNoise: "\u65E0\u4FE1\u53F7",
        // 已逃走行内 chip：AI 判了信号但被人工否决，回看时一眼找到推翻点
        chipVetoed: "\u5DF2\u5426\u51B3",
        vetoedTitle: "AI \u5224\u5B9A\u6709\u5F85\u529E\u4FE1\u53F7\uFF0C\u4F60\u5426\u51B3\u4E86\u5B83",
        chanPending: "{n} \u5F85\u5904\u7406",
        chanTotal: "{n} \u6761",
        markMerged: "\u5E76\u5165 No.{id}",
      },
      edit: {
        title: "\u7F16\u8F91\u5F85\u529E",
        taskTitle: "\u6807\u9898",
        note: "\u5907\u6CE8",
        category: "\u5206\u7C7B",
        priority: "\u4F18\u5148\u7EA7",
        due: "\u622A\u6B62",
        remind: "\u63D0\u9192",
        tags: "\u6807\u7B7E",
        noTags:
          "\u8FD8\u6CA1\u6709\u6807\u7B7E\uFF0C\u53BB \u80CC\u5305 \u2192 \u5206\u7C7B\u4E0E\u6807\u7B7E \u91CC\u6DFB\u52A0",
        followUps: "\u8DDF\u8FDB\u8BB0\u5F55",
        noFollowUps: "\u6682\u65E0\u8DDF\u8FDB\u8BB0\u5F55",
        followUpPlaceholder: "\u8865\u5145\u8DDF\u8FDB\u8BB0\u5F55\u2026\uFF08\u56DE\u8F66\u6DFB\u52A0\uFF09",
        addFollowUp: "\u6DFB\u52A0",
        confirmDeleteNote: "\u786E\u8BA4\u5220\u9664\uFF1F",
        agentRuns: "\u{1F916} Agent \u6267\u884C",
        runDuration: "\u7528\u65F6 {v}",
        openTranscript: "\u5728\u7EC8\u7AEF\u56DE\u653E\u8BE5\u4F1A\u8BDD\u8F6C\u5F55",
        history: "\u{1F4DC} \u64CD\u4F5C\u5386\u53F2",
        noHistory: "\u6682\u65E0\u64CD\u4F5C\u8BB0\u5F55",
        titleRequired: "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A",
      },
      detail: {
        status: "\u72B6\u6001",
        source: "\u6765\u6E90",
        focus: "\u4E13\u6CE8",
        created: "\u521B\u5EFA",
        completed: "\u5B8C\u6210",
        escaped: "\u9003\u8D70",
        edit: "\u7F16\u8F91",
      },
      dispatch: {
        title: "\u26A1 Agent \u6D3E\u53D1",
        needTag:
          "\u5148\u7ED9\u5F85\u529E\u6302\u4E0A\u300C\u9879\u76EE\u300D\u7EF4\u5EA6\u6807\u7B7E\uFF0C\u624D\u80FD\u6309\u9879\u76EE\u8DEF\u7531\u6D3E\u53D1\uFF08\u80CC\u5305 \u2192 \u5206\u7C7B\u4E0E\u6807\u7B7E\uFF09\u3002",
        noAgent:
          "\u8FD8\u6CA1\u6709\u53EF\u7528\u7684 Agent\uFF1A\u53BB \u80CC\u5305 \u2192 Agent \u6DFB\u52A0\u5E76\u542F\u7528\u540E\uFF0C\u518D\u6765\u6D3E\u53D1\u3002",
        go: "\u6D3E\u53D1",
        working: "\u6D3E\u53D1\u4E2D\u2026",
        launched:
          "\u5DF2\u5728 {term} \u4E2D\u542F\u52A8\u300C{agent}\u300D\uFF0C\u4EFB\u52A1\u547D\u4EE4\u4F1A\u81EA\u52A8\u6CE8\u5165\uFF1B\u5B8C\u6210\u540E\u7528 pk \u5199\u56DE\u5F85\u529E\u72B6\u6001\u3002",
        dir: "\u6D3E\u53D1\u5DE5\u4F5C\u76EE\u5F55",
        dirDefault: "agent \u9ED8\u8BA4\u76EE\u5F55",
        // M2：双通道 + 状态机
        chInteractive: "\u{1F5A5} \u4EA4\u4E92\uFF08\u65B0\u7EC8\u7AEF\uFF09",
        chHeadless: "\u{1F916} \u65E0\u5934\uFF08\u81EA\u52A8\u56DE\u4F20\uFF09",
        headlessHint:
          "\u65E0\u5934\u6267\u884C\uFF1A\u8DD1\u5B8C\u6309\u9000\u51FA\u7801\u81EA\u52A8\u5224\u5B9A\u6210\u8D25\uFF08claude \u5E26\u4F1A\u8BDD\u7EED\u63A5\uFF09\uFF0C\u9002\u5408\u77ED\u4EFB\u52A1\uFF1B\u957F\u4EFB\u52A1\u5EFA\u8BAE\u4EA4\u4E92\u901A\u9053\u3002",
        headlessDone:
          "\u65E0\u5934\u6267\u884C\u5B8C\u6210\uFF08{agent}\uFF09\u2014\u2014\u53D8\u66F4\u6458\u8981\u89C1\u4E0B\u65B9\u6267\u884C\u8BB0\u5F55\u3002",
        headlessFailed:
          "\u65E0\u5934\u6267\u884C\u5931\u8D25\uFF08{agent}\uFF09\u2014\u2014\u539F\u56E0\u89C1\u4E0B\u65B9\u6267\u884C\u8BB0\u5F55\u3002",
        stQueued: "\u6392\u961F\u4E2D",
        stRunning: "\u6267\u884C\u4E2D",
        stDone: "\u5DF2\u56DE\u4F20",
        stFailed: "\u5931\u8D25",
        markDone: "\u6807\u8BB0\u5B8C\u6210",
        markFailed: "\u6807\u8BB0\u5931\u8D25",
        markReset: "\u91CD\u7F6E",
        marked: "\u5DF2\u66F4\u65B0\u6D3E\u53D1\u72B6\u6001",
        busyHint:
          "\u8BE5\u5F85\u529E\u6D3E\u53D1\u6267\u884C\u4E2D\uFF1A\u7B49 agent \u56DE\u4F20\uFF0C\u6216\u7528\u4E0A\u65B9\u6309\u94AE\u624B\u52A8\u6536\u53E3\u540E\u91CD\u6D3E",
        chipRunning: "Agent \u6267\u884C\u4E2D",
        chipQueued: "\u6392\u961F\u6D3E\u53D1",
      },
      dispatchCfg: {
        title: "\u26A1 \u5F85\u529E\u6D3E\u53D1",
        hint: "\u6309\u9879\u76EE\u6807\u7B7E\u628A\u5F85\u529E\u4EA4\u7ED9 agent \u5904\u7406\uFF0C\u624B\u52A8\u6D3E\u53D1\u5165\u53E3\u5728\u4EFB\u52A1\u8BE6\u60C5\u62BD\u5C49\u3002",
        auto: "\u81EA\u52A8\u6D3E\u53D1",
        autoDesc:
          "\u5230\u671F\u672A\u5F00\u59CB\u3001\u4E14\u9879\u76EE\u6807\u7B7E\u6307\u5B9A\u4E86 agent \u7684\u5F85\u529E\uFF0C\u81EA\u52A8\u6392\u961F\u6267\u884C",
        maxConcurrent: "\u6BCF\u673A\u5668\u5E76\u53D1\u4E0A\u9650",
        maxConcurrentDesc: "\u672C\u673A\u4E0E\u6BCF\u53F0 SSH \u4E3B\u673A\u5206\u522B\u751F\u6548",
        mcN: "{n} \u4E2A",
        worktree: "worktree \u9694\u79BB",
        worktreeDesc:
          "\u6D3E\u53D1\u5728\u72EC\u7ACB\u5DE5\u4F5C\u6811\u4E0E\u5206\u652F\u6267\u884C\uFF0C\u4E92\u4E0D\u8E29\u8E0F\uFF0C\u5B8C\u6210\u540E\u4EBA\u5DE5\u5408\u5E76",
        foot: "\u624B\u52A8\u6D3E\u53D1\u4E0D\u53D7\u8FD9\u4E9B\u5F00\u5173\u5F71\u54CD\u3002",
      },
      stabs: {
        focus: "\u4E13\u6CE8",
        taxonomy: "\u5206\u7C7B\u4E0E\u6807\u7B7E",
        pets: "\u684C\u5BA0",
        display: "\u663E\u793A",
        agents: "Agent",
        feishu: "\u98DE\u4E66",
        diag: "\u8BCA\u65AD",
        general: "\u901A\u7528",
      },
      focus: {
        title: "\u{1F345} \u4E13\u6CE8 \xB7 \u756A\u8304\u949F",
        enable: "\u542F\u7528\u756A\u8304\u949F",
        enableDesc: "\u4EFB\u52A1\u8FDB\u884C\u65F6\uFF0C\u684C\u5BA0\u81EA\u52A8\u5012\u8BA1\u65F6",
        duration: "\u756A\u8304\u65F6\u957F",
        minutes: "{n} \u5206\u949F",
        break: "\u77ED\u4F11\u606F",
        breakOff: "\u5173\u95ED\uFF08\u756A\u8304\u7ED3\u675F\u5C31\u505C\uFF09",
        notify: "\u756A\u8304\u7ED3\u675F\u53D1\u7CFB\u7EDF\u901A\u77E5",
        chime: "\u957F\u756A\u8304\u63D0\u793A\u97F3",
        chimeDesc: "\u226545 \u5206\u949F\u7684\u756A\u8304\u5728\u4E2D\u70B9\u4E0E\u5269 5 \u5206\u949F\u8F7B\u54CD",
        petTitle: "\u{1F43E} \u684C\u5BA0\u966A\u4F34",
        petInput: "\u8F93\u5165\u54CD\u5E94",
        petInputDesc:
          "\u7A7A\u95F2\u65F6\u968F\u4F60\u6572\u952E\u76D8\u7684\u8282\u594F\u505A\u5C0F\u56DE\u5E94\uFF08\u53EA\u611F\u77E5\u5FEB\u6162\uFF0C\u4E0D\u770B\u5185\u5BB9\uFF09",
        petInputWorking: "\u4E13\u6CE8\u65F6\u4E5F\u54CD\u5E94",
        petInputWorkingDesc: "\u4E13\u6CE8\u4E2D\u8E66\u8DF3\u8282\u594F\u8F7B\u968F\u6253\u5B57\u5FEB\u6162",
        petInputPerm:
          "macOS \u9700\u8981\u8F85\u52A9\u529F\u80FD\u6388\u6743\uFF1A\u70B9\u300C\u53BB\u6388\u6743\u300D\u76F4\u8FBE\u8BBE\u7F6E\u9762\u677F\uFF0C\u628A\u4E0B\u65B9\u8DEF\u5F84\u52A0\u5165\u5217\u8868\u5E76\u52FE\u9009\uFF1B\u56DE\u5230\u672C\u9875\u5373\u81EA\u52A8\u751F\u6548\u3002\u540C\u540D\u7684\u65E7\u6761\u76EE\u5148\u79FB\u9664\uFF08\u2212\uFF09\u518D\u91CD\u65B0\u6DFB\u52A0\u3002",
        petInputPermToast:
          "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002\u8F93\u5165\u54CD\u5E94\u8FD8\u5DEE\u8F85\u52A9\u529F\u80FD\u6388\u6743\u2014\u2014\u5230\u300C\u684C\u5BA0\u300D\u9875\u5F00\u5173\u4E0B\u65B9\u70B9\u300C\u53BB\u6388\u6743\u300D\u5B8C\u6210\u52FE\u9009",
        petInputGrant: "\u53BB\u6388\u6743",
        petInputExeCopy: "\u70B9\u51FB\u590D\u5236\u8DEF\u5F84",
        petInputGranted:
          "\u8F85\u52A9\u529F\u80FD\u5DF2\u6388\u6743\uFF0C\u8F93\u5165\u54CD\u5E94\u5F00\u59CB\u5DE5\u4F5C",
        petVoice: "\u684C\u5BA0\u8BED\u97F3",
        petVoiceDesc:
          "\u91CC\u7A0B\u7891\u3001\u6536\u5DE5\u3001\u751F\u65E5\u3001\u5BF9\u8BDD\u56DE\u7B54\u65F6\u7528\u7CFB\u7EDF\u8BED\u97F3\u8BF4\u4E00\u53E5",
        petMate: "\u966A\u8DD1\u7CBE\u7075",
        petMateDesc:
          "\u4E13\u6CE8\u6EE1 25 \u5206\u949F\u65F6\uFF0C\u56FE\u9274\u91CC\u7684\u4E00\u53EA\u5B9D\u53EF\u68A6\u6765\u65C1\u8FB9\u966A\u4F60\u5750\u4E00\u4F1A\u513F",
      },
      remind: {
        title: "\u{1F514} \u63D0\u9192\u4E0E\u901A\u77E5",
        enable: "\u4EFB\u52A1\u63D0\u9192\u901A\u77E5",
        enableDesc: "\u7CFB\u7EDF\u901A\u77E5\u4E0E\u684C\u5BA0\u6572\u95E8\u63D0\u9192\u4E00\u8D77\u5F00\u5173",
        ahead: "\u63D0\u524D\u63D0\u9192",
        onTime: "\u51C6\u65F6",
        aheadN: "\u63D0\u524D {n} \u5206\u949F",
        quiet: "\u52FF\u6270\u65F6\u6BB5",
        quietDesc:
          "\u65F6\u6BB5\u5185\u9759\u9ED8\u975E\u7D27\u6025\u63D0\u9192\uFF08\u7D27\u6025\u4EFB\u52A1\u4ECD\u6572\u95E8\uFF09\uFF1B\u652F\u6301\u8DE8\u96F6\u70B9\uFF0C\u5982 22:00\u201308:00",
        quietStart: "\u52FF\u6270\u5F00\u59CB",
        quietEnd: "\u52FF\u6270\u7ED3\u675F",
      },
      cats: {
        title: "\u{1F5C2} \u4EFB\u52A1\u5206\u7C7B \xB7 \u5B9D\u53EF\u68A6\u6362\u88C5",
        save: "\u4FDD\u5B58",
        release: "\u653E\u751F",
        new: "\uFF0B \u65B0\u5206\u7C7B",
        hint: "\u300C\u653E\u751F\u300D\u5206\u7C7B\u7684\u4EFB\u52A1\u81EA\u52A8\u5F52\u5230\u7B2C\u4E00\u4E2A\u542F\u7528\u7684\u5206\u7C7B\uFF1B\u505C\u7528\u7684\u5206\u7C7B\u4E0D\u8FDB\u65B0\u5EFA\u4E0E AI \u9009\u9879\uFF0C\u5DF2\u6709\u4EFB\u52A1\u4E0D\u53D7\u5F71\u54CD\uFF08\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u542F\u7528\uFF09\u3002\u63CF\u8FF0\u4F1A\u63D0\u793A\u7ED9 AI \u4F5C\u5206\u7C7B\u5224\u5B9A\u53C2\u8003\uFF0C\u5982\u300C\u6709\u4EA7\u51FA\u7269\u4E14\u9700\u4E13\u6CE8\u7684\u4EFB\u52A1\u300D\u3002",
        descPlaceholder: "\u63CF\u8FF0\uFF08\u4F9B AI \u5224\u5B9A\u53C2\u8003\uFF0C\u53EF\u7A7A\uFF09",
        toggle: "\u505C\u7528/\u542F\u7528",
        newName: "\u65B0\u5206\u7C7B",
        mainTitle: "\u{1F43E} \u4E3B\u5B9D\u53EF\u68A6",
        mainLabel: "\u4E3B\u5B9D\u53EF\u68A6",
        mainFollow: "\u8DDF\u968F\u7B2C\u4E00\u4E2A\u5206\u7C7B",
        mainDesc:
          "\u6CA1\u6709\u8FDB\u884C\u4E2D\u4EFB\u52A1\u65F6\uFF0C\u684C\u5BA0\u5C55\u793A\u5B83\uFF1B\u4E0D\u8BBE\u7F6E\u5219\u8DDF\u968F\u7B2C\u4E00\u4E2A\u5206\u7C7B",
        quotesTitle: "\u{1F399} \u5B9D\u53EF\u68A6\u53F0\u8BCD",
        quotesPh:
          "\u6BCF\u884C\u4E00\u53E5\uFF0C\u70B9\u51FB\u684C\u5BA0\u65F6\u968F\u673A\u5192\u51FA\u3002\u4F8B\u5982\uFF1A\n\u76AE\u5361\u76AE\u5361\uFF01\u4ECA\u5929\u4E5F\u62DC\u6258\u4E86\uFF01\n\u8BAD\u7EC3\u5BB6\uFF0C\u5148\u8BD5 5 \u5206\u949F\uFF1F",
        quotesCount: "\u5DF2\u5199 {n} \u53E5",
        quotesSave: "\u4FDD\u5B58\u53F0\u8BCD",
      },
      pk: {
        searchPh: "\u641C\u7D22\u5B9D\u53EF\u68A6\uFF1A\u540D / \u7F16\u53F7 / \u82F1\u6587\u540D",
        empty: "\u56FE\u9274\u673A\u6CA1\u67E5\u5230\u8FD9\u53EA\u5B9D\u53EF\u68A6",
        bundled: "\u5185\u7F6E",
        footHint:
          "\u540D\u5F55\u6765\u81EA Pok\xE9API\uFF081025 \u53EA\uFF09\xB7 \u652F\u6301\u540D\u79F0\u3001\u7F16\u53F7\u4E0E\u82F1\u6587\u540D\u641C\u7D22",
      },
      tags: {
        title: "\u{1F3F7} \u6807\u7B7E",
        save: "\u4FDD\u5B58",
        release: "\u5220\u9664",
        new: "\uFF0B \u65B0\u6807\u7B7E",
        hint: "\u6807\u7B7E\u6309\u7EF4\u5EA6\u5206\u7EC4\uFF0CAI \u751F\u6210\u5F85\u529E\u65F6\u6311\u9009\u5408\u9002\u7684\u6807\u7B7E\uFF1B\u6CA1\u6709\u8D34\u5207\u9009\u9879\u4E14\u6D88\u606F\u6709\u4F9D\u636E\u65F6\uFF0C\u4E5F\u4F1A\u63D0\u8BAE\u65B0\u6807\u7B7E\uFF08\u63A5\u53D7\u65F6\u624D\u521B\u5EFA\uFF09\u3002",
        namePh: "\u6807\u7B7E\u540D",
        descPh: "\u63CF\u8FF0\uFF08\u7ED9 AI \u548C\u81EA\u5DF1\u770B\u7684\u8BF4\u660E\uFF09",
        newName: "\u65B0\u6807\u7B7E",
        dimCount: "{used}/{max}",
        single: "\u5355\u9009",
        dimHint:
          "\u540C\u4E00\u7EF4\u5EA6\u5185\u540D\u79F0\u552F\u4E00\uFF1B\u6BCF\u6761\u5F85\u529E\u6700\u591A\u6302 3 \u4E2A\u6807\u7B7E\uFF08\u9879\u76EE\u7EF4\u5EA6\u81F3\u591A 1 \u4E2A\uFF09\u3002",
        dimTitle: "\u{1F5C2} \u6807\u7B7E\u7EF4\u5EA6",
        dimNamePh: "\u65B0\u7EF4\u5EA6\u540D\u79F0",
        dimNew: "\uFF0B \u65B0\u7EF4\u5EA6",
        maxTags: "\u6807\u7B7E\u6570\u4E0A\u9650",
        dimManageHint:
          "key \u4E0E\u5355\u9009/\u591A\u9009\u5EFA\u540E\u4E0D\u53EF\u6539\uFF1B\u505C\u7528\u540E\u4E0D\u518D\u8FDB\u5165\u65B0\u5EFA\u4E0E AI \u9009\u9879\u3002",
        metaAgentOff: "\u5DF2\u505C\u7528",
      },
      // ---- 项目派发卡片（project 标签 → agent / 工作目录 / 项目上下文） ----
      tagDispatch: {
        title: "\u9879\u76EE\u6D3E\u53D1",
        hint: "\u7ED9\u6302\u300C\u9879\u76EE\u300D\u6807\u7B7E\u7684\u5F85\u529E\u6307\u5B9A\u6D3E\u53D1 agent\uFF1B\u6539\u52A8\u5373\u65F6\u751F\u6548\u3002",
        agent: "\u6D3E\u53D1 Agent",
        agentNone: "\u4E0D\u6307\u5B9A\uFF08\u5168\u5C40\u9ED8\u8BA4\uFF09",
        workdir: "\u5DE5\u4F5C\u76EE\u5F55",
        workdirDesc: "\u7559\u7A7A\u7528 agent \u9ED8\u8BA4",
        workdirPh: "~/projects/my-repo",
        context: "\u9879\u76EE\u4E0A\u4E0B\u6587",
        contextPh: "\u6280\u672F\u6808\u3001\u6CE8\u610F\u4E8B\u9879\u2026",
        configured: "\u5DF2\u914D\u7F6E",
        unconfigured: "\u672A\u914D\u7F6E",
        empty:
          "\u8FD8\u6CA1\u6709\u300C\u9879\u76EE\u300D\u7EF4\u5EA6\u7684\u6807\u7B7E\u2014\u2014\u5230\u300C\u5206\u7C7B\u4E0E\u6807\u7B7E\u300D\u5206\u533A\u628A\u6807\u7B7E\u7684\u7EF4\u5EA6\u6539\u4E3A\u300C\u9879\u76EE\u300D\uFF0C\u5C31\u80FD\u5728\u8FD9\u91CC\u914D\u7F6E\u6D3E\u53D1\u3002",
        foot: "agent \u4E0E\u76EE\u5F55\u90FD\u7559\u7A7A\u65F6\u6309\u5168\u5C40\u9ED8\u8BA4\u6D3E\u53D1\u3002",
        chipHint:
          "\u5DF2\u914D\u7F6E\u6D3E\u53D1\uFF1A\u5728\u300CAgent\u300D\u5206\u533A\u7684\u300C\u9879\u76EE\u6D3E\u53D1\u300D\u5361\u7247\u7BA1\u7406",
        historyTip:
          "\u5728\u65B0\u7EC8\u7AEF\u6253\u5F00\u300C{name}\u300D\u7684\u5386\u53F2\u8BB0\u5F55\uFF08\u672A\u6307\u5B9A agent \u65F6\u4E3A\u5168\u5C40\u9ED8\u8BA4\uFF09",
        historyNone:
          "\u8FD8\u6CA1\u6709\u53EF\u7528\u7684 agent\u2014\u2014\u5148\u5728\u300CAgent\u300D\u5206\u533A\u914D\u7F6E\u5E76\u542F\u7528",
      },
      dim: {
        project: "\u9879\u76EE",
        context: "\u573A\u666F",
        person: "\u4EBA\u7269",
        topic: "\u4E3B\u9898",
      },
      display: {
        title: "\u{1F440} \u663E\u793A",
        date: "\u65E5\u671F\u683C\u5F0F",
        time: "\u65F6\u95F4\u5236\u5F0F",
        h24: "24 \u5C0F\u65F6\u5236\uFF0818:00\uFF09",
        h12: "12 \u5C0F\u65F6\u5236\uFF086:00 PM\uFF09",
        overdueMode: "\u903E\u671F\u4EFB\u52A1\u5C55\u793A",
        dueRelative: "\u76F8\u5BF9\u622A\u6B62\u65F6\u95F4",
        dueRelativeDesc:
          "\u663E\u793A\u4E3A\u300C3 \u5C0F\u65F6\u540E / \u660E\u5929 15:00 / \u5DF2\u903E\u671F 2 \u5929\u300D\uFF0C\u5E76\u6309\u4E34\u8FD1\u7A0B\u5EA6\u53D8\u8272",
        reduceMotion: "\u51CF\u5F31\u52A8\u6548",
        reduceMotionDesc:
          "\u505C\u7528\u95EA\u70C1\u4E0E\u8E66\u8DF3\u52A8\u753B\uFF1B\u7CFB\u7EDF\u5F00\u542F\u300C\u51CF\u5F31\u52A8\u6001\u6548\u679C\u300D\u65F6\u81EA\u52A8\u751F\u6548",
        preview: "\u9884\u89C8\uFF1A{v}",
        language: "\u8BED\u8A00",
      },
      sess: {
        filter_all: "\u5168\u90E8",
        filter_radio: "\u6536\u97F3\u673A",
        filter_dispatch: "\u6D3E\u53D1",
        filter_other: "\u5176\u4ED6",
        kind: {
          classify: "\u6536\u97F3\u673A\u5206\u7C7B",
          capture: "\u5FEB\u901F\u6355\u6349",
          dispatch_headless: "\u65E0\u5934\u6D3E\u53D1",
          dispatch_interactive: "\u4EA4\u4E92\u6D3E\u53D1",
          pk: "agent \u8865\u5F55",
          legacy: "\u65E9\u671F\u8BB0\u5F55",
        },
        open: "\u56DE\u653E",
        openTmux: "\u91CD\u8FDE\u8BE5 tmux \u6D3E\u53D1\u4F1A\u8BDD",
        reload: "\u5237\u65B0",
        loading: "\u52A0\u8F7D\u4E2D\u2026",
        empty: "\u8FD8\u6CA1\u6709\u4F1A\u8BDD\u8BB0\u5F55",
        dirUnset: "\uFF08\u672A\u8BB0\u5F55\u76EE\u5F55\uFF09",
        prev: "\u4E0A\u4E00\u9875",
        next: "\u4E0B\u4E00\u9875",
        pageOf: "\u7B2C {cur}/{max} \u9875",
      },
      ai: {
        title: "\u{1F916} AI Agent CLI",
        hint: "\u7528\u672C\u5730 AI agent \u547D\u4EE4\u884C\u5904\u7406\u6536\u97F3\u673A\u6D88\u606F\u5206\u7C7B\u4E0E\u5224\u91CD\uFF0C\u53EF\u914D\u7F6E\u591A\u4E2A\u3002",
        sshOn: "SSH \u8FDC\u7A0B\u6267\u884C",
        sshHostPh: "user{'@'}host",
        sshPort: "SSH \u7AEF\u53E3",
        sshKeyPh: "\u79C1\u94A5\u8DEF\u5F84\uFF08\u53EF\u9009\uFF0C\u5982 ~/.ssh/id_ed25519\uFF09",
        sshTunnel: "\u53CD\u5411\u96A7\u9053\u7AEF\u53E3",
        sshKeepAlive: "\u5E38\u9A7B\u96A7\u9053",
        sshKeepAliveDesc:
          "\u4FDD\u6301\u957F\u8FDE\u4F9B\u8FDC\u7A0B\u8C03\u7528 pk\uFF0C\u65AD\u7EBF\u81EA\u52A8\u91CD\u8FDE",
        tunnelOff: "\u672A\u8FD0\u884C",
        tunnelHealthy: "\u5DF2\u8FDE\u901A",
        tunnelConnecting: "\u5EFA\u7ACB\u4E2D\u2026",
        tunnelRetrying: "\u65AD\u7EBF\uFF0C\u91CD\u8FDE\u4E2D",
        tunnelUnknown: "\u72B6\u6001\u83B7\u53D6\u4E2D\u2026",
        setupRemote: "\u4E00\u952E\u914D\u7F6E\u8FDC\u7A0B pk",
        settingUp: "\u6B63\u5728\u914D\u7F6E\u8FDC\u7A0B pk\u2026\uFF08\u7EA6\u5341\u51E0\u79D2\uFF09",
        setupDone:
          "\u2705 \u8FDC\u7A0B pk \u5DF2\u5C31\u7EEA\uFF08pk {v}\uFF09\uFF0C\u53EF\u70B9\u300C\u6D4B\u8BD5\u300D\u8DD1\u5DE5\u5177\u63A2\u9488",
        setupFailed: "\u914D\u7F6E\u672A\u5B8C\u6210\uFF0C\u8BF7\u770B\u5931\u8D25\u6B65\u9AA4\u7684\u63D0\u793A",
        args: "\u9644\u52A0\u53C2\u6570",
        argsPh: "-p {'{prompt}'}",
        namePh: "Claude Code",
        cmdPh: "claude / opencode / pi / dsh",
        workdir: "\u5DE5\u4F5C\u76EE\u5F55",
        workdirPh: "\u7559\u7A7A = ~/.choose-you/workspace",
        historyArgs: "\u5386\u53F2\u53C2\u6570",
        skillDir: "\u6280\u80FD\u6839\u76EE\u5F55",
        skillDirPh:
          "\u5982 ~/.claude/skills\uFF1B\u6280\u80FD\u88C5\u8FDB <\u76EE\u5F55>/pokemon-choose-you\uFF0C\u652F\u6301 ~ \u524D\u7F00",
        timeout: "\u8D85\u65F6\uFF08\u79D2\uFF09",
        enabled: "\u542F\u7528",
        primary: "\u7528\u4E8E\u6536\u97F3\u673A\u5206\u7C7B",
        primaryNone: "\u4E0D\u6307\u5B9A",
        terminal: "\u7EC8\u7AEF\u504F\u597D",
        terminalDesc:
          "\u4EA4\u4E92\u6D3E\u53D1\u3001\u5386\u53F2\u8BB0\u5F55\u4E0E\u98DE\u4E66\u6388\u6743\u5524\u8D77\u7684\u7EC8\u7AEF\u5E94\u7528",
        termBuiltin: "\u7CFB\u7EDF\u5185\u7F6E",
        save: "\u4FDD\u5B58",
        test: "\u6D4B\u8BD5",
        history: "\u5386\u53F2\u8BB0\u5F55 \u2197",
        openingHistory: "\u6B63\u5728\u6253\u5F00\u7EC8\u7AEF\u2026",
        remove: "\u5220\u9664",
        add: "\uFF0B \u6DFB\u52A0 Agent",
        local: "\u672C\u673A",
        skill: "pk \u6280\u80FD",
        skillCheck: "\u68C0\u67E5",
        skillInstall: "\u5B89\u88C5/\u540C\u6B65",
        skillInstalling: "\u6B63\u5728\u540C\u6B65\u6280\u80FD\u2026",
        skillUnknown: "\u672A\u68C0\u67E5",
        skillNotInstalled: "\u672A\u5B89\u88C5",
        skillUpToDate: "\u5DF2\u88C5 v{v}\uFF08\u6700\u65B0\uFF09",
        skillOutdated: "\u5DF2\u88C5 v{v}\uFF0C\u5185\u7F6E v{b}\uFF0C\u53EF\u66F4\u65B0",
        skillInstalled: "\u2705 \u6280\u80FD\u5DF2\u5B89\u88C5 v{v}\uFF08{where}\uFF09",
        skillUpdated: "\u2705 \u6280\u80FD\u5DF2\u5347\u7EA7 v{prev} \u2192 v{v}\uFF08{where}\uFF09",
        cliHint:
          "\u5E94\u7528\u81EA\u5E26 pk \u547D\u4EE4\u884C\uFF08pk task list \u2026\uFF09\u4F9B AI agent \u4E0E\u7EC8\u7AEF\u76F4\u63A5\u8BFB\u5199\u5F85\u529E\uFF0C\u8BE6\u89C1\u7528\u6237\u6307\u5357\u3002",
      },
      // ---- AI 提示词卡（editable-prompts）：文案全表 = uiux-design.md §8 ----
      prompts: {
        title: "AI \u63D0\u793A\u8BCD",
        sub: "\u67E5\u770B\u4E0E\u81EA\u5B9A\u4E49\u5404 AI \u529F\u80FD\u7684\u7CFB\u7EDF\u63D0\u793A\u8BCD\uFF0C\u4FDD\u5B58\u540E\u4E0B\u4E00\u6B21 AI \u8C03\u7528\u5373\u751F\u6548\u3002",
        foot: "\u5185\u7F6E\u9ED8\u8BA4\u968F\u5E94\u7528\u5347\u7EA7\u6F14\u8FDB\uFF0C\u6062\u590D\u9ED8\u8BA4\u968F\u65F6\u53EF\u56DE\u3002\u81EA\u5B9A\u4E49\u5185\u5BB9\u4E0D\u4F1A\u51FA\u73B0\u5728\u8BCA\u65AD\u5BFC\u51FA\u4E0E\u65E5\u5FD7\u4E2D\u3002",
        feature: {
          im_classify: "IM \u5206\u7C7B",
          capture: "\u5FEB\u901F\u6355\u6349",
          pet_chat: "\u684C\u5BA0\u5BF9\u8BDD",
          tag_health: "\u6807\u7B7E\u6CBB\u7406",
          dispatch: "\u5F85\u529E\u6D3E\u53D1",
        },
        badgeDefault: "\u5185\u7F6E\u9ED8\u8BA4",
        badgeCustom: "\u81EA\u5B9A\u4E49",
        badgeWarn: "\u26A0 \u4E0D\u53EF\u7528",
        badgeReadonly: "\u53EA\u8BFB",
        badgeUnsaved: "\u672A\u4FDD\u5B58",
        tagDefault: "\u5F53\u524D\u751F\u6548",
        tagCustom: "\u5F53\u524D\u751F\u6548 \xB7 \u81EA\u5B9A\u4E49",
        loading: "\u8BFB\u53D6\u4E2D\u2026",
        loadFailed: "\u63D0\u793A\u8BCD\u8BFB\u53D6\u5931\u8D25\uFF1A{err}",
        retry: "\u91CD\u8BD5",
        edit: "\u7F16\u8F91",
        cancel: "\u53D6\u6D88",
        save: "\u4FDD\u5B58",
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        restore: "\u6062\u590D\u9ED8\u8BA4\u2026",
        confirmText:
          "\u5C06\u6E05\u9664\u81EA\u5B9A\u4E49\u5185\u5BB9\uFF0C\u6062\u590D\u4E3A\u5F53\u524D\u7248\u672C\u5185\u7F6E\u9ED8\u8BA4\u3002",
        confirmOk: "\u786E\u8BA4\u6062\u590D",
        confirmAria: "\u6062\u590D\u9ED8\u8BA4\u786E\u8BA4",
        compare: "\u5185\u7F6E\u9ED8\u8BA4\u5BF9\u7167 \u25BE",
        compareTitle: "\u5185\u7F6E\u9ED8\u8BA4\uFF08\u5F53\u524D\u7248\u672C\uFF09",
        editorWarn:
          "\u26A0 \u63D0\u793A\u8BCD\u5185\u5D4C\u5224\u5B9A\u534F\u8BAE\u4E0E\u51FA\u53E3\u95E8\u7981\uFF0C\u8BEF\u5220\u53EF\u80FD\u5BFC\u81F4\u5224\u5B9A\u5931\u8D25\u6216\u5EFA\u8BAE\u6C61\u67D3\u2014\u2014\u6539\u52A8\u540E\u82E5\u5224\u5B9A\u5F02\u5E38\uFF0C\u5148\u8BD5\u6062\u590D\u9ED8\u8BA4\u3002",
        phLabel: "\u5FC5\u8981\u5360\u4F4D\u7B26",
        phDesc: "\u70B9\u51FB\u63D2\u5165\u5230\u5149\u6807\u5904\uFF1B\u7F3A\u5931\u65F6\u65E0\u6CD5\u4FDD\u5B58",
        readonlyNote:
          "\u6B64\u9879\u627F\u8F7D\u4E0D\u53EF\u4FE1\u6D88\u606F\u7684\u9694\u79BB\u7ED3\u6784\uFF08\u6570\u636E\u5B9A\u754C\u4E0E\u58F0\u660E\uFF09\uFF0C\u4E3A\u5B89\u5168\u8BBE\u8BA1\u4E0D\u652F\u6301\u7F16\u8F91\u3002",
        warnLine:
          "\u26A0 \u81EA\u5B9A\u4E49\u8986\u76D6\u7F3A\u5C11\u5F53\u524D\u7248\u672C\u8981\u6C42\u7684\u5360\u4F4D\u7B26\uFF08{names}\uFF09\uFF0C\u5F53\u524D\u5DF2\u6309\u5185\u7F6E\u9ED8\u8BA4\u751F\u6548\uFF1B\u70B9\u300C\u7F16\u8F91\u300D\u8865\u9F50\u540E\u4FDD\u5B58\u5373\u53EF\u6062\u590D\u4F7F\u7528\u3002",
        warnOverlong:
          "\u26A0 \u81EA\u5B9A\u4E49\u8986\u76D6\u8D85\u8FC7\u957F\u5EA6\u4E0A\u9650\uFF08{n} / 20000 \u5B57\u7B26\uFF09\uFF0C\u5F53\u524D\u5DF2\u6309\u5185\u7F6E\u9ED8\u8BA4\u751F\u6548\uFF1B\u70B9\u300C\u7F16\u8F91\u300D\u5220\u51CF\u540E\u4FDD\u5B58\u5373\u53EF\u6062\u590D\u4F7F\u7528\u3002",
        vMissing:
          "\u7F3A\u5C11\u5FC5\u8981\u5360\u4F4D\u7B26\uFF1A{names}\u2014\u2014\u70B9\u51FB\u5360\u4F4D\u7B26\u63D2\u5165\u540E\u5373\u53EF\u4FDD\u5B58\u3002",
        vOverlong:
          "\u8D85\u8FC7\u957F\u5EA6\u4E0A\u9650\uFF08{n} / 20000 \u5B57\u7B26\uFF09\uFF0C\u8BF7\u5220\u51CF\u540E\u518D\u4FDD\u5B58\u3002",
        vUnknown:
          "\u542B\u5E94\u7528\u4E0D\u8BA4\u8BC6\u7684\u5360\u4F4D\u7B26\uFF1A{names}\uFF0C\u5C06\u6309\u5B57\u9762\u53D1\u7ED9 AI\u3002",
        vBlank:
          "\u5185\u5BB9\u4E3A\u7A7A\uFF1A\u4FDD\u5B58\u540E\u5C06\u6062\u590D\u4F7F\u7528\u5185\u7F6E\u9ED8\u8BA4\u3002",
        vSameDefault:
          "\u4E0E\u5185\u7F6E\u9ED8\u8BA4\u4E00\u81F4\uFF1A\u4FDD\u5B58\u540E\u89C6\u4E3A\u672A\u81EA\u5B9A\u4E49\u3002",
        savedHint:
          "\u2705 \u5DF2\u4FDD\u5B58\uFF0C\u4E0B\u4E00\u6B21\u300C{feature}\u300D\u8C03\u7528\u5373\u751F\u6548\u3002",
        restoredHint: "\u2705 \u5DF2\u6062\u590D\u5185\u7F6E\u9ED8\u8BA4\u3002",
        saveFailed: "\u274C \u4FDD\u5B58\u5931\u8D25\uFF1A{err}",
        copyAll: "\u590D\u5236\u5168\u6587",
        copied: "\u5DF2\u590D\u5236",
        editorAria: "\u7F16\u8F91{feature}\u63D0\u793A\u8BCD",
      },
      feishu: {
        enable: "\u542F\u7528\u540E\u53F0\u8F6E\u8BE2",
        interval: "\u8F6E\u8BE2\u95F4\u9694",
        hint: "\u5148\u5B89\u88C5 lark-cli\uFF08npm install -g {'@'}larksuite/cli\uFF09\uFF0C\u518D\u70B9\u300C\u6388\u6743\u767B\u5F55\u300D\u5728\u7EC8\u7AEF\u5B8C\u6210\u521D\u59CB\u5316\u4E0E\u6388\u6743\uFF1B\u51ED\u8BC1\u7531 lark-cli \u4FDD\u7BA1\uFF0C\u4E0D\u8FDB\u672C\u5E94\u7528\u6570\u636E\u5E93\u3002\u5224\u5B9A\u5168\u7A0B\u5047\u540D\u5316\uFF1A\u771F\u5B9E\u59D3\u540D\u4E0D\u53D1\u7ED9 AI\uFF0C\u4E00\u5F8B\u4EE5\u4EE3\u53F7\u51FA\u73B0\u3002",
        auth: "\u6388\u6743\u767B\u5F55",
        reauth: "\u91CD\u65B0\u6388\u6743",
        authing: "\u6B63\u5728\u7EC8\u7AEF\u542F\u52A8 lark-cli \u767B\u5F55\u2026",
        authorized: "\u5DF2\u6388\u6743\uFF1A{name}",
        unauthorized:
          "\u672A\u6388\u6743\uFF08\u9700\u7528\u6237\u8EAB\u4EFD\u624D\u80FD\u62C9\u53D6\u4F60\u7684\u79C1\u804A/\u7FA4\u6D88\u606F\uFF09",
        test: "\u6D4B\u8BD5\u98DE\u4E66\u8FDE\u63A5",
        pollNow: "\u7ACB\u5373\u62C9\u53D6\u4E00\u6B21",
        pollResult: "\u672C\u8F6E\u65B0\u589E {n} \u6761\u5EFA\u8BAE",
        myNames: "\u6211\u7684\u79F0\u547C",
        myNamesDesc:
          "\u547D\u4E2D\u8FD9\u4E9B\u79F0\u547C\u7684\u6D88\u606F\u4F1A\u6807\u6CE8\u300C\u7591\u4F3C\u6307\u6D3E\u7ED9\u4F60\u300D",
        myNamesPh: "\u5982\uFF1A\u4E54\u8001\u677F\uFF0C\u8001\u4E54",
        filter: {
          title: "\u4F1A\u8BDD\u8FC7\u6EE4",
          hint: "\u9010\u4F1A\u8BDD\u51B3\u5B9A\u54EA\u4E9B\u98DE\u4E66\u6D88\u606F\u53C2\u4E0E\u62C9\u53D6\uFF1B\u8DDF\u968F\u514D\u6253\u6270\u4E3A\u9ED8\u8BA4\uFF0C\u624B\u52A8\u8BBE\u7F6E\u540E\u4EE5\u672C\u5E94\u7528\u4E3A\u51C6\u3002\u79C1\u804A\u4E0D\u53C2\u4E0E\u8FC7\u6EE4\u7BA1\u7406\uFF0C\u56FA\u5B9A\u8DDF\u968F\u514D\u6253\u6270\u3002",
          summary:
            "\u5171 {total} \u4E2A\u4F1A\u8BDD\uFF1A{pulling} \u62C9\u53D6 \xB7 {filtered} \u8FC7\u6EE4 \xB7 \u624B\u52A8 {manual}",
          staleOk: "\u4EE5\u4E0A\u4E00\u8F6E\u62C9\u53D6\u4E3A\u51C6\uFF08{time}\uFF09",
          staleWarn:
            "\u26A0 \u8DDD\u4E0A\u4E00\u8F6E\u62C9\u53D6\u5DF2 {min} \u5206\u949F\uFF0C\u72B6\u6001\u53EF\u80FD\u4E0D\u662F\u6700\u65B0\u3002\u53EF\u5728\u300C\u8BCA\u65AD \xB7 \u96C6\u6210\u5065\u5EB7\u300D\u67E5\u770B\u8BE6\u60C5\u3002",
          searchPh: "\u641C\u7D22\u4F1A\u8BDD\u540D",
          searchLabel: "\u6309\u4F1A\u8BDD\u540D\u79F0\u641C\u7D22",
          chipsLabel: "\u6309\u751F\u6548\u72B6\u6001\u7B5B\u9009",
          prefChipsLabel: "\u6309\u504F\u597D\u8BBE\u7F6E\u7B5B\u9009",
          prefGroupLabel: "{name}\uFF1A\u8FC7\u6EE4\u504F\u597D",
          fAll: "\u5168\u90E8 {n}",
          fPull: "\u62C9\u53D6 {n}",
          fFiltered: "\u88AB\u8FC7\u6EE4 {n}",
          pAll: "\u5168\u90E8\u504F\u597D {n}",
          fFollow: "\u8DDF\u968F {n}",
          fManual: "\u624B\u52A8\u8BBE\u7F6E {n}",
          typeChipsLabel: "\u6309\u4F1A\u8BDD\u7C7B\u578B\u7B5B\u9009",
          matchCount: "\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\uFF1A{n} / {total} \u4E2A\u4F1A\u8BDD",
          tAll: "\u5168\u90E8\u7C7B\u578B {n}",
          tGroup: "\u7FA4\u804A {n}",
          tBot: "\u673A\u5668\u4EBA {n}",
          prefFollow: "\u8DDF\u968F",
          prefFollowTitle:
            "\u8DDF\u968F\u514D\u6253\u6270\uFF08\u9ED8\u8BA4\uFF09\uFF1A\u6309\u98DE\u4E66\u4FA7\u514D\u6253\u6270\u51B3\u5B9A",
          prefPull: "\u62C9\u53D6",
          prefPullTitle:
            "\u603B\u662F\u62C9\u53D6\uFF1A\u65E0\u8BBA\u98DE\u4E66\u662F\u5426\u514D\u6253\u6270\u90FD\u62C9\u53D6",
          prefFilter: "\u8FC7\u6EE4",
          prefFilterTitle:
            "\u603B\u662F\u8FC7\u6EE4\uFF1A\u6574\u4F1A\u8BDD\u8DF3\u8FC7\uFF0C\u4E00\u6761\u6D88\u606F\u90FD\u4E0D\u62C9",
          effPull: "\u{1F4E1} \u62C9\u53D6",
          effFilter: "\u{1F507} \u8FC7\u6EE4",
          srcManual: "\u624B\u52A8",
          srcFollow: "\u8DDF\u968F",
          srcDegraded: "\u964D\u7EA7",
          srcDegradedTitle:
            "\u514D\u6253\u6270\u67E5\u8BE2\u5931\u8D25\uFF0C\u672C\u8F6E\u964D\u7EA7\u4E3A\u4E0D\u8FC7\u6EE4\uFF1B\u4E0B\u4E00\u8F6E\u6062\u590D\u540E\u6309\u514D\u6253\u6270\u63A8\u5BFC",
          emptyDisabled:
            "\u542F\u7528\u98DE\u4E66\u540E\u53F0\u8F6E\u8BE2\u540E\uFF0C\u8FD9\u91CC\u4F1A\u5217\u51FA\u4F60\u7684\u5168\u90E8\u4F1A\u8BDD\u3002",
          emptyNoSnap:
            "\u8FD8\u6CA1\u6709\u62C9\u53D6\u5FEB\u7167\u3002\u7B49\u5F85\u4E0B\u4E00\u8F6E\u8F6E\u8BE2\uFF0C\u6216\u7ACB\u5373\u62C9\u53D6\u4E00\u6B21\u3002",
          emptySnapEmpty: "\u4E0A\u4E00\u8F6E\u62C9\u53D6\u672A\u53D1\u73B0\u4F1A\u8BDD\u3002",
          emptySearch: "\u6CA1\u6709\u5339\u914D\u300C{q}\u300D\u7684\u4F1A\u8BDD",
          emptyFiltered: "\u5F53\u524D\u7B5B\u9009\u7EC4\u5408\u4E0B\u6CA1\u6709\u4F1A\u8BDD",
          loading: "\u8BFB\u53D6\u4F1A\u8BDD\u5FEB\u7167\u2026",
          loadFail: "\u4F1A\u8BDD\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A{err}",
          retry: "\u91CD\u8BD5",
          writeFail: "\u274C \u8BBE\u7F6E\u672A\u751F\u6548\uFF0C\u8BF7\u91CD\u8BD5\uFF1A{err}",
          footImmediate:
            "\u6B64\u5904\u7684\u66F4\u6539\u7ACB\u5373\u751F\u6548\uFF08\u65E0\u9700\u70B9\u300C\u4FDD\u5B58\u8BBE\u7F6E\u300D\uFF09\uFF0C\u4E0B\u4E00\u8F6E\u62C9\u53D6\u8D77\u4F5C\u7528\u3002",
          footNoBackfill:
            "\u89E3\u9664\u8FC7\u6EE4\u53EA\u6536\u65B0\u6D88\u606F\uFF0C\u4E0D\u56DE\u8865\u5386\u53F2\uFF1B\u8BBE\u7F6E\u8FC7\u6EE4\u524D\u7684\u6D88\u606F\u4E0E\u5F85\u529E\u4FDD\u6301\u539F\u6837\u3002",
        },
      },
      diag: {
        healthTitle: "\u{1FA7A} \u96C6\u6210\u5065\u5EB7",
        healthHint:
          "\u98DE\u4E66 / AI \u4E24\u6761\u94FE\u8DEF\u7684\u8FD0\u884C\u72B6\u6001\uFF1B\u5931\u8D25\u81EA\u52A8\u9000\u907F\u91CD\u8BD5\uFF0C\u4E5F\u53EF\u624B\u52A8\u89E6\u53D1\u3002",
        provider: { feishu: "\u98DE\u4E66\u7535\u6CE2", ai: "AI Agent" },
        status: {
          off: "\u672A\u914D\u7F6E",
          paused: "\u5DF2\u6682\u505C",
          idle: "\u5F85\u8FD0\u884C",
          ok: "\u6B63\u5E38",
          degraded: "\u964D\u7EA7\u91CD\u8BD5\u4E2D",
          down: "\u6545\u969C",
        },
        lastSuccess: "\u4E0A\u6B21\u6210\u529F {v}",
        never: "\u5C1A\u672A\u8FD0\u884C",
        nextPoll: "\u4E0B\u6B21\u8F6E\u8BE2 {v}",
        pending: "\u5F85\u786E\u8BA4\u5EFA\u8BAE {n}",
        primaryAgent: "\u5206\u7C7B Agent\uFF1A{name}",
        pollNow: "\u7ACB\u5373\u62C9\u53D6",
        logTitle: "\u{1F4DC} \u8FD0\u884C\u65E5\u5FD7",
        logLevel: "\u7EA7\u522B",
        allLevels: "\u5168\u90E8",
        logSource: "\u6765\u6E90\u8FC7\u6EE4",
        refresh: "\u5237\u65B0",
        copyReport: "\u590D\u5236\u652F\u6301\u62A5\u544A",
        reportCopied:
          "\u2714 \u5DF2\u590D\u5236\u652F\u6301\u62A5\u544A\uFF08\u7248\u672C + \u5065\u5EB7\u5FEB\u7167 + \u6700\u8FD1\u65E5\u5FD7\uFF0C\u5DF2\u8131\u654F\uFF09",
        reportFailed: "\u274C \u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236",
        logEmpty:
          "\u6682\u65E0\u65E5\u5FD7\u3002\u5B8C\u6574\u65E5\u5FD7\u6587\u4EF6\u4F4D\u4E8E ~/.choose-you/logs/ \u4E0B\u3002",
      },
      general: {
        autostart: "\u5F00\u673A\u81EA\u52A8\u542F\u52A8",
        autostartDesc: "\u767B\u5F55\u540E\u684C\u5BA0\u81EA\u52A8\u51FA\u73B0",
        closeToTray: "\u5173\u95ED\u4E3B\u7A97\u53E3\u65F6\u6536\u5230\u6258\u76D8",
        closeToTrayDesc: "\u5E94\u7528\u7EE7\u7EED\u9A7B\u7559\uFF0C\u6258\u76D8\u83DC\u5355\u53EF\u9000\u51FA",
        shortcuts:
          "\u5168\u5C40\u5FEB\u6377\u952E\uFF1ACtrl+Shift+K \u5FEB\u901F\u6355\u6349\u5F85\u529E \xB7 Ctrl+Shift+D \u663E\u793A/\u9690\u85CF\u684C\u5BA0\uFF08macOS \u4E3A \u2318\u21E7K / \u2318\u21E7D\uFF09",
      },
      overdue: {
        collapse: "\u6536\u8D77",
        leaked: "\u6628\u5929\u6709 {n} \u53EA\u6E9C\u8D70\u4E86\uFF08\u70B9\u5F00\u770B\u770B\uFF09",
        fresh: "\u5168\u90E8\u5F52\u8349\u4E1B",
        freshing: "\u5F52\u4F4D\u4E2D\u2026",
        modeCollapse: "\u6298\u53E0\u4E3A\u4E00\u884C",
        modeAuto: "\u81EA\u52A8\u5F52\u8349\u4E1B\uFF08\u6BCF\u5929\u6E05\u4E00\u6B21\u903E\u671F\u65F6\u95F4\uFF09",
        modeShow: "\u539F\u6837\u663E\u793A",
      },
      rel: {
        overdueMin: "\u5DF2\u903E\u671F {n} \u5206\u949F",
        overdueHour: "\u5DF2\u903E\u671F {n} \u5C0F\u65F6",
        overdueDay: "\u5DF2\u903E\u671F {n} \u5929",
        inMin: "{n} \u5206\u949F\u540E",
        inHour: "{n} \u5C0F\u65F6\u540E",
        tomorrowAt: "\u660E\u5929 {v}",
        dayAfterAt: "\u540E\u5929 {v}",
        inDay: "{n} \u5929\u540E",
        sun: "\u5468\u65E5",
        mon: "\u5468\u4E00",
        tue: "\u5468\u4E8C",
        wed: "\u5468\u4E09",
        thu: "\u5468\u56DB",
        fri: "\u5468\u4E94",
        sat: "\u5468\u516D",
      },
      review: {
        title: "\u8BAD\u7EC3\u5BB6\u590D\u76D8",
        entry: "\u590D\u76D8",
        stepOverview: "\u603B\u89C8",
        stepRoute: "\u8DEF\u7EBF\u590D\u76D8",
        stepGrass: "\u8349\u4E1B\u5F52\u4F4D",
        stepTags: "\u6807\u7B7E\u4F53\u68C0",
        tagChecking:
          "\u{1FA7A} \u6807\u7B7E\u4F53\u68C0\u4E2D\u2026\uFF08AI \u6B63\u5728\u590D\u6838\u8BCD\u8868\uFF09",
        tagCheckFailed: "\u4F53\u68C0\u5931\u8D25\uFF0C\u53EF\u91CD\u8BD5\u6216\u8DF3\u8FC7\u672C\u6B65",
        tagRetry: "\u91CD\u8BD5",
        tagMerges: "\u8FD1\u4E49\u5408\u5E76\u5EFA\u8BAE",
        tagMerge: "\u5408\u5E76",
        tagIgnore: "\u5FFD\u7565",
        tagZombies: "\u50F5\u5C38\u6807\u7B7E\uFF0890 \u5929\u672A\u7528\u4E14\u975E\u624B\u5EFA\uFF09",
        tagRelease: "\u653E\u751F",
        tagKeep: "\u4FDD\u7559",
        tagNewDims: "\u65B0\u7EF4\u5EA6\u5EFA\u8BAE\uFF08AI \u53D1\u73B0\u7684\u6B63\u4EA4\u5206\u7C7B\u9762\uFF09",
        tagAdopt: "\u91C7\u7EB3",
        tagClean: "\u{1F3F7} \u8BCD\u8868\u5F88\u5065\u5EB7\uFF0C\u65E0\u9700\u6CBB\u7406",
        tagUnjudged:
          "\u672A\u914D\u7F6E AI \u6216\u5224\u5B9A\u5931\u8D25\uFF1A\u4EE5\u4E0A\u4E3A\u672C\u5730\u76F8\u4F3C\u5EA6\u9884\u7B5B\uFF0C\u5408\u5E76\u524D\u8BF7\u81EA\u884C\u786E\u8BA4\u3002",
        tagTip:
          "AI \u5DF2\u590D\u6838\uFF1B\u5408\u5E76/\u653E\u751F/\u91C7\u7EB3\u5373\u65F6\u751F\u6548\uFF0C\u5FFD\u7565\u53EA\u5F71\u54CD\u672C\u6B21\u590D\u76D8\u3002",
        stepDone: "\u6536\u5C3E",
        caughtWeek: "\u672C\u5468\u6355\u6349",
        focusWeek: "\u672C\u5468\u4E13\u6CE8(\u5206)",
        onRoute: "\u8DEF\u7EBF\u4E0A",
        inGrass: "\u8349\u4E1B\u91CC",
        overviewTip:
          "\u6309\u4E0B\u4E00\u6B65\u9010\u7AD9\u8FC7\u4E00\u904D\u8DEF\u7EBF\u4E0A\u7684\u4EFB\u52A1\uFF0C\u518D\u6279\u91CF\u6536\u62FE\u8349\u4E1B\u2014\u2014\u6BCF\u5468\u4E00\u6B21\uFF0C\u51E0\u5206\u949F\u5C31\u597D\u3002",
        keep: "\u4FDD\u7559",
        complete: "\u5B8C\u6210",
        toGrass: "\u5F52\u8349\u4E1B",
        escape: "\u9003\u8D70",
        routeTip:
          "\u770B\u7740\u4E0D\u5BF9\u7684\u5C31\u5730\u5904\u7406\uFF1A\u5B8C\u6210\u7684\u6253\u52FE\u3001\u4E0D\u505A\u7684\u653E\u751F\u3001\u8FD8\u6CA1\u60F3\u597D\u7684\u5F52\u8349\u4E1B\u3002",
        routeEmpty: "\u8DEF\u7EBF\u662F\u7A7A\u7684\uFF0C\u6CA1\u6709\u8981\u590D\u76D8\u7684\u4EFB\u52A1\u3002",
        overdue: "\u7B49\u6025\u4E86",
        skipRoute: "\u8DF3\u8FC7\u8DEF\u7EBF",
        next: "\u4E0B\u4E00\u6B65",
        selectAllGrass: "\u5168\u9009\u8349\u4E1B",
        releaseGrass: "\u6279\u91CF\u653E\u751F",
        grassEmpty: "\u8349\u4E1B\u5E72\u5E72\u51C0\u51C0\uFF0C\u6CA1\u6709\u8981\u5F52\u4F4D\u7684\u3002",
        released: "\u5DF2\u653E\u751F {n} \u53EA",
        finishLine: "\u672C\u5468\u5171\u6536\u670D {n} \u53EA\u5B9D\u53EF\u68A6\uFF01",
        finishTip:
          "\u590D\u76D8\u5B8C\u6210\u5DF2\u8BB0\u5F55\uFF1B\u4E0B\u5468\u540C\u4E00\u65F6\u95F4\u4F1A\u518D\u63D0\u9192\u4F60\u3002",
        finish: "\u7ED3\u675F\u590D\u76D8",
      },
      reviewDow: {
        1: "\u5468\u4E00",
        2: "\u5468\u4E8C",
        3: "\u5468\u4E09",
        4: "\u5468\u56DB",
        5: "\u5468\u4E94",
        6: "\u5468\u516D",
        7: "\u5468\u65E5",
      },
      reviewCfg: {
        title: "\u{1F9E2} \u6BCF\u5468\u590D\u76D8\u63D0\u9192",
        enable: "\u542F\u7528\u63D0\u9192",
        enableDesc:
          "\u5230\u8BBE\u5B9A\u661F\u671F\u53D1\u7CFB\u7EDF\u901A\u77E5\uFF0C\u590D\u76D8\u5165\u53E3\u5728\u56FE\u9274\u9875",
        dow: "\u63D0\u9192\u65E5",
      },
      backup: {
        title: "\u6570\u636E\u5907\u4EFD",
        enable: "\u6BCF\u65E5\u81EA\u52A8\u5907\u4EFD",
        enableDesc: "\u5FEB\u7167\u5B58\u4E8E ~/.choose-you/data/backups/\uFF0C\u6EDA\u52A8\u4FDD\u7559",
        keep: "\u4FDD\u7559\u4EFD\u6570",
        keepN: "{n} \u4EFD",
        now: "\u7ACB\u5373\u5907\u4EFD",
        working: "\u5907\u4EFD\u4E2D\u2026",
        done: "\u2714 \u5DF2\u5907\u4EFD {v}",
        hint: "\u300C\u6062\u590D\u300D\u4F1A\u7528\u6240\u9009\u5907\u4EFD\u8986\u76D6\u5F53\u524D\u5168\u90E8\u6570\u636E\uFF1B\u5BC6\u94A5\u5728\u7CFB\u7EDF\u94A5\u5319\u4E32\uFF0C\u4E0D\u53D7\u5F71\u54CD\u3002",
        restore: "\u6062\u590D",
        confirmRestore: "\u786E\u8BA4\u8986\u76D6\u6062\u590D\uFF1F",
        restoring: "\u6062\u590D\u4E2D\u2026",
        restored: "\u2714 \u5DF2\u4ECE\u5907\u4EFD\u6062\u590D\uFF0C\u6570\u636E\u5DF2\u5237\u65B0",
        empty:
          "\u8FD8\u6CA1\u6709\u5907\u4EFD\uFF0C\u70B9\u300C\u7ACB\u5373\u5907\u4EFD\u300D\u521B\u5EFA\u7B2C\u4E00\u4EFD",
      },
      export: {
        title: "\u6570\u636E\u5BFC\u51FA / \u5BFC\u5165",
        json: "\u5168\u91CF JSON",
        csv: "\u4EFB\u52A1 CSV",
        md: "\u4ECA\u65E5\u65E5\u62A5",
        openDir: "\u6253\u5F00\u5BFC\u51FA\u76EE\u5F55",
        hint: "\u5BFC\u51FA\u4EA7\u7269\u5728 ~/.choose-you/data/exports/ \u4E0B\uFF1BJSON \u53EF\u5728\u522B\u7684\u673A\u5668\u5BFC\u5165\uFF08\u6574\u4F53\u8986\u76D6\uFF09\uFF0CMarkdown \u65E5\u62A5\u53EF\u76F4\u63A5\u5E76\u5165\u77E5\u8BC6\u5E93\u3002",
        pick: "\u9009\u62E9 JSON \u6587\u4EF6\u2026",
        chosen: "\u5DF2\u9009 {v}",
        saveJson: "\u53E6\u5B58\u5168\u91CF JSON\u2026",
        saveCsv: "\u53E6\u5B58\u4EFB\u52A1 CSV\u2026",
        saveMd: "\u53E6\u5B58\u4ECA\u65E5\u65E5\u62A5\u2026",
        savedTo: "\u2714 \u5DF2\u5BFC\u51FA\u5230 {v}",
        notJson: "\u8BF7\u9009\u62E9 .json \u5BFC\u51FA\u6587\u4EF6",
        doImport: "\u5BFC\u5165",
        confirmImport: "\u786E\u8BA4\u8986\u76D6\u5BFC\u5165\uFF1F",
        importing: "\u5BFC\u5165\u4E2D\u2026",
        imported: "\u2714 \u5DF2\u5BFC\u5165 {n} \u884C\uFF08{v}\uFF09\uFF0C\u6570\u636E\u5DF2\u5237\u65B0",
        done: "\u2714 \u5DF2\u5BFC\u51FA {v}",
      },
      update: {
        title: "\u56FE\u9274\u673A\u56FA\u4EF6",
        current: "\u56FA\u4EF6\u7248\u672C v{v}",
        check: "\u68C0\u67E5\u66F4\u65B0",
        checking: "\u68C0\u67E5\u4E2D\u2026",
        upToDate: "\u56FA\u4EF6\u5DF2\u662F\u6700\u65B0 \u2714",
        found: "\u53D1\u73B0\u65B0\u56FA\u4EF6 v{v}",
        install: "\u4E0B\u8F7D\u5E76\u91CD\u542F\u5B89\u88C5",
        installing: "\u4E0B\u8F7D\u5B89\u88C5\u4E2D\u2026\uFF08\u5B8C\u6210\u540E\u81EA\u52A8\u91CD\u542F\uFF09",
        progress: "\u4E0B\u8F7D\u4E2D {pct}%",
        linuxHint:
          "Linux \u4E0B\u81EA\u52A8\u66F4\u65B0\u4EC5\u652F\u6301 AppImage \u5B89\u88C5\u65B9\u5F0F\uFF1Bdeb / rpm \u7528\u6237\u8BF7\u4E0B\u8F7D\u65B0\u5305\u8986\u76D6\u5B89\u88C5\u3002",
      },
      save: "\u4FDD\u5B58\u8BBE\u7F6E",
      save2: "\u4FDD\u5B58",
      cancel: "\u53D6\u6D88",
      saved: "\u5DF2\u4FDD\u5B58 \u2714",
      testing: "\u6D4B\u8BD5\u4E2D\u2026",
      catSaved: "\u5206\u7C7B\u5DF2\u66F4\u65B0 \u2714",
      tagSaved: "\u6807\u7B7E\u5DF2\u66F4\u65B0 \u2714",
      promptSchedule: "\u52A0\u5165\u8DEF\u7EBF\uFF1A\u9009\u62E9\u622A\u6B62/\u5F00\u59CB\u65F6\u95F4",
      entry: {
        due: "\u622A\u6B62 {v}",
        remind: "\u63D0\u9192 {v}",
        focus: "\u2605 \u4E13\u6CE8 {n} \u5206\u949F",
        from: "\u6765\u81EA{src}",
        feishu: "\u98DE\u4E66",
        capture: "\u5FEB\u901F\u6355\u6349",
        catching: "\u6355\u83B7\u4E2D",
        paused: "\u6682\u505C",
        caught: "\u2714 \u5DF2\u6355\u6349",
        undo: "\u21A9 \u64A4\u9500",
        start: "\u25B6 \u51FA\u53D1",
        pause: "\u23F8 \u6682\u505C",
        route: "\u52A0\u5165\u8DEF\u7EBF",
        edit: "\u7F16\u8F91",
        done: "\u5B8C\u6210",
        escape: "\u9003\u8D70\uFF08\u53D6\u6D88\uFF09",
        escaped: "\u5DF2\u9003\u8D70",
        release: "\u653E\u751F\uFF08\u5220\u9664\uFF09",
        empty:
          "\u8349\u4E1B\u7A7A\u7A7A\u7684\u2014\u2014\u53BB\u6536\u97F3\u673A\u542C\u542C\u7535\u6CE2\uFF0C\u6216\u81EA\u5DF1\u4E22\u4E00\u53EA\u7CBE\u7075\u7403\u8FDB\u6765\uFF01",
        emptyToday:
          "\u4ECA\u5929\u8FD8\u6CA1\u6709\u5192\u9669\u5B89\u6392\uFF0C\u53BB\u8349\u4E1B\u6216\u8DEF\u7EBF\u6311\u4E2A\u76EE\u6807\u51FA\u53D1\u5427\uFF01",
        emptyRoute:
          "\u8DEF\u7EBF\u56FE\u7A7A\u7A7A\u7684\uFF0C\u7ED9\u5F85\u529E\u8BBE\u4E2A\u622A\u6B62\u65F6\u95F4\uFF0C\u89C4\u5212\u4E0B\u4E00\u7AD9\u5427\uFF01",
      },
      pet: {
        welcome:
          "\u4ECA\u5929\u60F3\u6355\u6349\u54EA\u53EA\u5B9D\u53EF\u68A6\uFF1F\u60AC\u505C\u6253\u5F00\u5FEB\u6377\u56FE\u9274\u5C4F\u5427\uFF01",
        menuDex: "\u6253\u5F00\u56FE\u9274\u673A",
        menuQuick: "\u5FEB\u6377\u56FE\u9274\u5C4F",
        menuPause: "\u6682\u505C\u5F53\u524D\u4EFB\u52A1",
        menuHide: "\u9690\u85CF\u684C\u5BA0",
        menuSwitch: "\u5207\u6362\u6355\u6349\u76EE\u6807\u2026",
        menuResume: "\u7EE7\u7EED",
        menuDone: "\u5B8C\u6210\u6355\u6349",
        // ---- 桌宠情绪交互（PET_INTERACTION_DESIGN）：演出/物理/睡觉/问候 ----
        petted: "\u266A {p}\u88AB\u6478\u5F97\u772F\u8D77\u4E86\u773C~",
        beingCarried: "\uFF08\u88AB\u62CE\u8D77\u6765\u4E86\uFF01\u5C0F\u788E\u6B65\u7D27\u5F20\u4E2D\uFF09",
        dropped: "\u549A\uFF01\u5B89\u5168\u843D\u5730\uFF5E",
        throwing: "{p}\u84C4\u529B\u4E00\u63B7\u2026",
        catchOk: "\u2714 \u6355\u6349\u6210\u529F\uFF01\u300C{t}\u300D\u8BB0\u5165\u56FE\u9274\u5566",
        milestone: "\u2605 \u7D2F\u8BA1 {n} \u53EA\uFF01{p}\u63D0\u8BAE\u5F00\u4E00\u573A\u56FE\u9274\u5E86\u5178",
        allDone:
          "\u{1F389} \u4ECA\u65E5\u56FE\u9274\u5706\u6EE1\uFF01{p}\u8BF4\uFF1A\u6536\u5DE5\uFF0C\u597D\u597D\u4F11\u606F\uFF01",
        wakeUp: "\u545C\u54C7\u2014\u2014{p}\u63C9\u63C9\u773C\u775B\uFF1A\u4F60\u56DE\u6765\u5566\uFF01",
        asleepHint: "\uFF08\u7761\u7740\u4E86\uFF0C\u52A8\u4E00\u4E0B\u9F20\u6807\u6216\u70B9\u70B9\u5B83\uFF09",
        greetMorning:
          "\u65E9\u5B89\uFF01{p}\u7CBE\u795E\u6EE1\u6EE1\uFF0C\u4ECA\u5929\u4E5F\u4E00\u8D77\u51FA\u53D1\u5427",
        greetDay: "\u4E0B\u5348\u597D\uFF01{p}\u5728\u8349\u4E1B\u8FB9\u7B49\u4F60\u6311\u76EE\u6807",
        greetEvening:
          "\u665A\u4E0A\u597D\uFF01\u4ECA\u5929\u7684\u5192\u9669\u8FD8\u5269\u4E00\u70B9\uFF0C{p}\u966A\u4F60\u6536\u5C3E",
        greetNight: "\u591C\u6DF1\u4E86\uFF0C{p}\u8BF4\uFF1A\u518D\u4E13\u6CE8\u4E5F\u8981\u7761\u89C9\u54E6",
        idle: "\u4ECA\u5929\u7684\u5192\u9669\u8FD8\u6CA1\u5F00\u59CB\uFF0C\u60AC\u505C\u6253\u5F00\u5FEB\u6377\u56FE\u9274\u5C4F\u6311\u4E2A\u76EE\u6807\u5427",
        /** 设了主宝可梦时的待机气泡（说出它的名字） */
        idleNamed:
          "{p}\u5728\u7B49\u4F60\u51FA\u53D1\uFF01\u60AC\u505C\u6253\u5F00\u5FEB\u6377\u56FE\u9274\u5C4F\u6311\u4E2A\u76EE\u6807\u5427",
        working: "{p}\u6B63\u5728\u6355\u6349\uFF1A{t}",
        paused: "{p}\u6682\u505C\u4E2D\uFF0C\u4F11\u606F\u4E00\u4E0B~",
        remindUrgent: "\u203C {p}\u6025\u5F97\u76F4\u8DFA\u811A\uFF1A\u300C{t}\u300D\u5F88\u7D27\u6025\uFF01",
        reminderDo: "\u5B8C\u6210",
        reminderSnooze: "\u63A8\u8FDF 10 \u5206\u949F",
        reminderDone:
          "\u2714 \u300C{t}\u300D\u6355\u6349\u6210\u529F\uFF01{p}\u5E2E\u4F60\u8BB0\u8FDB\u56FE\u9274\u5566",
        reminderSnoozed: "\u597D\uFF5E10 \u5206\u949F\u540E\u518D\u63D0\u9192\u4F60",
        remindNormal: "\u{1F43E} {p}\u62C9\u62C9\u4F60\u7684\u8863\u89D2\uFF1A\u300C{t}\u300D\u522B\u5FD8\u4E86",
        pomoDone:
          "\u{1F345} \u756A\u8304\u5B8C\u6210\uFF01{p}\u95EE\uFF1A\u300C{t}\u300D\u6355\u6349\u5230\u4E86\u5417\uFF1F",
        trialStart: "\u5C31\u8BD5 5 \u5206\u949F\uFF0C\u4E0D\u6210\u4E5F\u6CA1\u5173\u7CFB\uFF01",
        trialDone:
          "\u{1F366} 5 \u5206\u949F\u6253\u5361\u5B8C\u6210\uFF01\u611F\u89C9\u5BF9\u4E86\u5C31 \u25B6 \u7EE7\u7EED\uFF0C\u4ECA\u5929\u5230\u6B64\u4E3A\u6B62\u4E5F\u5B8C\u5168 OK",
        pomoNotifTitle: "\u{1F345} \u756A\u8304\u5B8C\u6210\uFF01",
        pomoNotifBody: "\u300C{t}\u300D\u505A\u5230\u54EA\u4E86\uFF1F{p}\u966A\u4F60\u4F11\u606F\u4E00\u4E0B~",
        breakStart: "\u2615 \u4F11\u606F\u4E00\u4E0B\uFF0C\u5B9D\u53EF\u68A6\u5E2E\u4F60\u770B\u7740\u65F6\u95F4~",
        breakEnd: "\u4F11\u606F\u7ED3\u675F\uFF01\u70B9 \u25B6 \u5F00\u65B0\u4E00\u8F6E\u756A\u8304\uFF5E",
        quickPick: "\u9009\u4E00\u4E2A\u6355\u6349\u76EE\u6807\u5427\uFF01",
        quickEmpty:
          "\u56FE\u9274\u5C4F\u7A7A\u7A7A\u7684\uFF0C\u53BB\u56FE\u9274\u673A\u9047\u89C1\u4E00\u53EA\u91CE\u751F\u5B9D\u53EF\u68A6\u5427",
        quickStart: "\u25B6 \u51FA\u53D1",
        quickPause: "\u23F8 \u6682\u505C",
        quickClose: "\u2715 \u6536\u8D77",
        bubbleClose: "\u70B9\u51FB\u6536\u8D77\u53F0\u8BCD",
        switchTitle: "\u5207\u6362\u6355\u6349\u76EE\u6807\u2026",
        switchCancel: "\u53D6\u6D88",
        gotcha: "\u5C31\u51B3\u5B9A\u662F\u4F60\u4E86\uFF01{t}",
        // ---- 桌宠体验升级（PET_EXPERIENCE_PROPOSAL）：栖息 / 时刻台词 / 连胜 / 对话 / 陪跑 ----
        perched: "\u627E\u5230\u4E86\u8212\u670D\u7684\u4F4D\u7F6E\uFF0C\u5750\u4E0B\u5566\uFF5E",
        hourLine: "\u{1F43E} \u6574\u70B9\u62A5\u65F6\uFF1A\u8FD9\u4E2A\u5C0F\u65F6\u4E5F\u4E00\u8D77\u52A0\u6CB9",
        nightLine:
          "\u8FD9\u4E48\u665A\u4E86\u8FD8\u5728\u5192\u9669\u2026\u2026\u6536\u5DE5\u4E5F\u662F\u5F88\u5F3A\u7684\u9009\u62E9\u54E6",
        fridayLine:
          "\u{1F43E} \u8DEF\u7EBF\u4E0A\u7684\u5B9D\u53EF\u68A6\u90FD\u8BF4\uFF1A\u5468\u672B\u5FEB\u4E50\uFF01",
        birthdayLine: "\u4ECA\u5929\u662F\u7CBE\u7075\u8DDF\u7740\u8BAD\u7EC3\u5BB6\u7684\u7B2C {n} \u5929\uFF01",
        streakN:
          "\u{1F43E} \u8FDE\u80DC {n} \u5929\uFF01\u672C\u5468\u7684\u8349\u4E1B\u90FD\u88AB\u4F60\u8E0F\u5E73\u5566\uFF01",
        mateHint: "\u966A\u8DD1\u7684\u5BA2\u4EBA\uFF08\u70B9\u5B83\u5C31\u6325\u624B\u544A\u522B\uFF09",
        menuChat: "\u{1F4AC} \u548C\u7CBE\u7075\u804A\u804A",
        chatGreet:
          "\u{1F43E} \u5728\u7684\u5728\u7684\uFF01\u4EFB\u52A1\u548C\u56FE\u9274\u7684\u4E8B\u90FD\u53EF\u4EE5\u95EE\u6211\uFF08Esc \u6536\u8D77\uFF09",
        chatPh: "\u95EE\u5B83\u4EFB\u52A1 / \u56FE\u9274\u7684\u4E8B\u2026",
        chatSend: "\u53D1\u9001",
        chatClose: "\u6536\u8D77\u5BF9\u8BDD",
        chatFail:
          "\uFF08\u6B6A\u5934\uFF09\u8FD9\u4E2A\u95EE\u9898\u5361\u4F4F\u4E86\uFF0C\u7A0D\u540E\u518D\u95EE\u4E00\u6B21\u8BD5\u8BD5",
        chatQ1: "\u4ECA\u5929\u8FD8\u5269\u4EC0\u4E48\uFF1F",
        chatQ2: "\u8FD9\u5468\u6355\u6349\u4E86\u591A\u5C11\uFF1F",
        quotes: [
          "\u76AE\u5361\u76AE\u5361\uFF01\u8981\u4E13\u6CE8\u54E6\uFF01",
          "\u5C31\u51B3\u5B9A\u662F\u4F60\u4E86\uFF01",
          "\u76AE\u5361\u4E18\u4E5F\u5728\u7B49\u4F60\u641E\u5B9A\u5B83~",
          "\u6478\u9C7C\u4E00\u65F6\u723D\uFF0C\u6355\u6349\u5B8C\u6210\u66F4\u723D\uFF01",
          "\u51B2\u9E2D\uFF01\u8FD8\u5269\u4E00\u70B9\u70B9\uFF01",
          "\u76AE\u5361~ \u76AE\u5361~",
          "\u4ECA\u5929\u7684\u4F60\uFF0C\u4E5F\u662F\u4E86\u4E0D\u8D77\u7684\u8BAD\u7EC3\u5BB6\uFF01",
          "\u6536\u97F3\u673A\u91CC\u597D\u50CF\u6709\u65B0\u7535\u6CE2\u54E6~",
          "\u5148\u8BD5 5 \u5206\u949F\uFF0C\u8BF4\u4E0D\u5B9A\u5C31\u987A\u4E86\uFF01",
          "\u8349\u4E1B\u91CC\u90A3\u53EA\u5728\u7B49\u4F60\u7FFB\u724C\u5462\u3002",
          "\u6293\u5230\u4E86\u5C31\u767B\u8BB0\uFF0C\u56FE\u9274\u6700\u559C\u6B22\u65B0\u6761\u76EE\u5566\u3002",
          "\u54FC\u54FC\u54C8\u563F\uFF01\u8BAD\u7EC3\u5BB6\u52A0\u6CB9\uFF01",
        ],
        quotesNight: [
          "\u8FD9\u4E48\u665A\u8FD8\u5728\u5192\u9669\uFF0C\u5B9D\u53EF\u68A6\u966A\u4F60\uFF0C\u4F46\u8981\u65E9\u70B9\u4F11\u606F~",
          "\u6DF1\u591C\u7684\u8349\u4E1B\u5F88\u5B89\u9759\uFF0C\u660E\u65E9\u518D\u51FA\u53D1\u5427\u3002",
          "\u518D\u4E13\u6CE8\u4E5F\u8981\u7761\u89C9\uFF0C\u5361\u6BD4\u517D\u5148\u7761\u4E86\u3002",
        ],
      },
    };

    // ../src/i18n/zh-Hant.ts
    var zh_Hant_default = {
      tabs: {
        today: "\u5192\u96AA",
        todayDesc: "\u4ECA\u5929\u51FA\u767C\u8981\u5B8C\u6210\u7684\u5192\u96AA",
        inbox: "\u8349\u53E2",
        inboxDesc: "\u9084\u6C92\u6C7A\u5B9A\u7684\u91CE\u751F\u5BF6\u53EF\u5922\u5148\u5F85\u5728\u9019\u88E1",
        scheduled: "\u8DEF\u7DDA",
        scheduledDesc:
          "\u6309\u65E5\u671F\u898F\u5283\u7684\u524D\u9032\u8DEF\u7DDA\uFF0C\u9010\u7AD9\u5B8C\u6210\u4EFB\u52D9",
        done: "\u5716\u9451",
        doneDesc: "\u5DF2\u6355\u6349\u767B\u9304\u7684\u6210\u5C31\u8A18\u9304",
        im: "\u6536\u97F3\u6A5F",
        imDesc: "\u6536\u807D\u98DB\u66F8\u50B3\u4F86\u7684\u96FB\u6CE2\uFF0C\u5F9E\u4E2D\u6355\u6349\u5F85\u8FA6",
        sessions: "\u65E5\u8A8C",
        sessionsDesc:
          "Agent \u5925\u4F34\u7684\u6230\u9B25\u5BE6\u9304\uFF0C\u6BCF\u5834\u6703\u8A71\u90FD\u53EF\u56DE\u653E",
        settings: "\u80CC\u5305",
        settingsDesc: "\u8A13\u7DF4\u5BB6\u7684\u88DD\u5099\u8207\u5716\u9451\u6A5F\u8ABF\u6821",
      },
      dt: { none: "\u672A\u8A2D\u7F6E", clear: "\u6E05\u7A7A" },
      error: { prefix: "\u5716\u9451\u6A5F\u9047\u5230\u4E86\u9EDE\u72C0\u6CC1\uFF1A" },
      ctx: {
        cut: "\u526A\u4E0B",
        copy: "\u8907\u88FD",
        paste: "\u8CBC\u4E0A",
        selectAll: "\u5168\u9078",
        openDetail: "\u67E5\u770B\u8A73\u60C5",
        copyTitle: "\u8907\u88FD\u6A19\u984C",
        copyLine: "\u8907\u88FD\u672C\u884C",
        copied: "\u2714 \u5DF2\u8907\u88FD",
      },
      spine: {
        tips: [
          "\u5716\u9451\u6A5F\u5FE0\u544A\uFF1A\u8CAA\u591A\u56BC\u4E0D\u721B\u3002",
          "\u4E00\u6B21\u6D3E\u51FA\u4E00\u96BB\u5BF6\u53EF\u5922\uFF0C\u5C08\u6CE8\u773C\u524D\u7684\u4EFB\u52D9\u3002",
          "\u91CE\u751F\u5BF6\u53EF\u5922\u4E0D\u6703\u81EA\u5DF1\u8D70\u9032\u7CBE\u9748\u7403\u3002",
          "\u8349\u53E2\u88E1\u7684\uFF0C\u5148\u8B93\u7260\u518D\u5F85\u4E00\u6703\u5152\u3002",
          "\u9003\u8D70\u4E0D\u4E1F\u4EBA\uFF0C\u5716\u9451\u8A18\u5F97\u4F60\u4F86\u904E\u3002",
          "\u8DEF\u7DDA\u662F\u4E00\u7AD9\u4E00\u7AD9\u8D70\u5B8C\u7684\u3002",
          "\u4ECA\u5929\u7684\u98A8\uFF0C\u9069\u5408\u51FA\u767C\u3002",
          "\u7D2F\u4E86\u5C31\u4F11\u606F\u2014\u2014\u5361\u6BD4\u7378\u4E5F\u662F\u9019\u9EBC\u505A\u7684\u3002",
        ],
      },
      priority: { low: "\u4F4E", normal: "\u666E\u901A", high: "\u9AD8", urgent: "\u7DCA\u6025" },
      status: {
        inbox: "\u8349\u53E2",
        scheduled: "\u8DEF\u7DDA",
        active: "\u9032\u884C\u4E2D",
        paused: "\u66AB\u505C",
        done: "\u5DF2\u5B8C\u6210",
        cancelled: "\u5DF2\u9003\u8D70",
      },
      dexFilter: {
        all: "\u5168\u90E8",
        done: "\u5DF2\u6355\u6349",
        cancelled: "\u5DF2\u9003\u8D70",
        empty: {
          all: "\u5716\u9451\u9084\u7A7A\u7A7A\u7684\uFF0C\u53BB\u6355\u6349\u4E00\u96BB\u5BF6\u53EF\u5922\u5427\uFF01",
          done: "\u9084\u6C92\u6709\u5DF2\u6355\u6349\u7684\u8A18\u9304\u3002",
          cancelled: "\u9084\u6C92\u6709\u9003\u8D70\u7684\u8A18\u9304\u3002",
        },
      },
      dexStats: {
        line: "\u{1F4D9} \u7D2F\u8A08\u6355\u6349 {caught} \u96BB \xB7 \u9003\u8D70 {escaped} \u96BB",
        milestone: {
          m0: "\u5716\u9451\u9084\u7A7A\u8457\u2014\u2014\u7B2C\u4E00\u96BB\u5BF6\u53EF\u5922\u5728\u7B49\u4F60\u3002",
          m1: "\u7B2C\u4E00\u96BB\uFF01\u5716\u9451\u958B\u59CB\u8F49\u52D5\u4E86\u3002",
          m10: "10 \u96BB\u767B\u9304\uFF0C\u8A13\u7DF4\u5BB6\u7684\u7BC0\u594F\u627E\u5230\u4E86\u3002",
          m50: "50 \u96BB\uFF01\u8CC7\u6DF1\u8A13\u7DF4\u5BB6\u7684\u6C23\u606F\u3002",
          m100: "100 \u96BB\uFF01\u50B3\u8AAA\u7D1A\u8A13\u7DF4\u5BB6\u3002",
          m200: "{n} \u96BB\u2014\u2014\u5716\u9451\u5FEB\u5BEB\u4E0D\u4E0B\u4E86\uFF01",
        },
      },
      log: {
        create: "\u5EFA\u7ACB",
        update: "\u4FEE\u6539",
        start: "\u51FA\u767C",
        pause: "\u66AB\u505C",
        demote: "\u88AB\u9802\u4E0B",
        delete: "\u653E\u751F\u522A\u9664",
        sync_pull: "\u9060\u7AEF\u62C9\u53D6",
        sync_push: "\u63A8\u9001\u9060\u7AEF",
        sync_close: "\u95DC\u9589\u9060\u7AEF",
        migrate: "\u8CC7\u6599\u9077\u79FB",
      },
      search: {
        placeholder:
          "\u{1F50D} \u641C\u5C0B\u5F85\u8FA6\uFF08\u6A19\u984C / \u5099\u8A3B / \u6A19\u7C64 / \u8DDF\u9032\u8A18\u9304\uFF09",
        searching: "\u641C\u5C0B\u4E2D\u2026",
        resultCount: "\u547D\u4E2D {n} \u689D",
        empty: "\u6C92\u6709\u627E\u5230\u7B26\u5408\u7684\u5BF6\u53EF\u5922\u3002",
      },
      im: {
        empty1: "\u6536\u97F3\u6A5F\u88E1\u5F88\u5B89\u975C\uFF0C\u66AB\u7121\u96FB\u6CE2\u3002",
        empty2:
          "\u8A2D\u5B9A\u98DB\u66F8\u8207 AI \u5F8C\uFF0C\u98DB\u66F8\u8A0A\u606F\u6703\u50CF\u96FB\u6CE2\u4E00\u6A23\u50B3\u4F86\uFF0CAI \u6703\u5E6B\u4F60\u6311\u51FA\u5F85\u8FA6\u8A0A\u865F\u3002",
        found: "\u{1F4A1} \u767C\u73FE\u5F85\u8FA6\u8A0A\u865F\uFF1A",
        tagNew: "\u64EC\u65B0\u589E\u6A19\u7C64\uFF08\u63A5\u53D7\u5EFA\u8B70\u6642\u5EFA\u7ACB\uFF09\xB7 {dim}",
        catch: "\u25CE \u6355\u6349",
        release: "\u2715 \u9003\u8D70",
        search: "\u{1F50D} \u641C\u5C0B\u96FB\u6CE2\uFF08\u8A0A\u606F / \u6703\u8A71 / \u767C\u9001\u8005\uFF09",
        // 快速捕捉：一句話 → AI 判定屬性
        capturePlaceholder:
          "\u7528\u4E00\u53E5\u8A71\u8A18\u9304\u5F85\u8FA6\uFF0CAI \u81EA\u52D5\u5224\u5B9A\u5167\u5BB9 / \u5206\u985E / \u6A19\u7C64 / \u622A\u6B62\u6642\u9593\u2026",
        captureSend: "\u26A1 \u767C\u5831",
        capturing: "AI \u5224\u5B9A\u4E2D\u2026",
        capturePending:
          "AI \u5DF2\u751F\u6210\u5EFA\u8B70\uFF08\u5224\u91CD / \u8B8A\u66F4\uFF09\uFF0C\u8ACB\u5728\u6536\u97F3\u6A5F\u78BA\u8A8D",
        force: "\u26A1 \u5F37\u5236\u6355\u6349",
        forcing: "AI \u5224\u91CD\u4E2D\u2026",
        forceDone: "\u2714 \u5DF2\u5EFA\u7ACB\u5F85\u8FA6",
        caughtTask: "\u5DF2\u6355\u6349\u70BA\u5F85\u8FA6 No.{id}",
        released: "\u5DF2\u9003\u8D70",
        aiVerdict: "AI \u539F\u5224",
        dismissReasonLabel: "\u539F\u56E0",
        applyUpdate: "\u25CE \u61C9\u7528\u66F4\u65B0",
        updateFound: "\u{1F527} \u5EFA\u8B70\u66F4\u65B0\u5F85\u8FA6 No.{id}",
        updatedTask: "\u5DF2\u66F4\u65B0\u5F85\u8FA6 No.{id}",
        followedTask: "\u5DF2\u4F75\u5165\u5F85\u8FA6 No.{id} \u7684\u8DDF\u9032",
        selectAll: "\u5168\u9078\u5F85\u8655\u7406",
        batchCatch: "\u25CE \u6279\u91CF\u6355\u6349",
        batchRelease: "\u2715 \u6279\u91CF\u9003\u8D70",
        batchDone: "\u5DF2\u8655\u7406 {n} \u689D",
        batchPartial: "{ok} \u689D\u6210\u529F \xB7 {fail} \u689D\u5931\u6557",
        escapeWhy: "\u70BA\u4EC0\u9EBC\u9003\u8D70\uFF1F\uFF08\u5E6B AI \u8D8A\u5224\u8D8A\u6E96\uFF09",
        escapeNoReason: "\u4E0D\u586B\u539F\u56E0",
        justEscape: "\u76F4\u63A5\u9003\u8D70",
        confidence: { high: "\u9AD8\u7F6E\u4FE1", medium: "\u4E2D\u7F6E\u4FE1", low: "\u4F4E\u7F6E\u4FE1" },
        escapeReasons: {
          duplicate: "\u5DF2\u6709\u985E\u4F3C\u5F85\u8FA6",
          not_task: "\u4E0D\u662F\u7D66\u6211\u7684\u4EFB\u52D9",
          wrong_info: "\u5EFA\u8B70\u5167\u5BB9\u4E0D\u5C0D",
          noise: "\u9592\u804A/\u566A\u97F3",
          outdated: "\u5DF2\u904E\u671F",
          other: "\u5176\u4ED6",
        },
        type: {
          bot: "\u6A5F\u5668\u4EBA",
          p2p: "\u79C1\u804A",
          group: "\u7FA4\u804A",
          local: "\u624B\u52D5\u8F38\u5165",
        },
        status: {
          pending: "AI \u5F85\u5224\u5B9A",
          // 判定進行中（claim 協議，specs/dsh-plugin §7.1 條目 1）：與待判定同觀感
          judging: "AI \u5F85\u5224\u5B9A",
          todo: "\u6709\u5F85\u8FA6\u8A0A\u865F",
          update: "\u66F4\u65B0\u5EFA\u8B70",
          none: "\u7121\u5F85\u8FA6",
          followup: "\u5DF2\u4F75\u5165\u8DDF\u9032",
          error: "AI \u5224\u5B9A\u5931\u6557",
        },
        // 兩欄分診視圖
        viewMode: "\u5217\u8868\u5206\u7D44\u65B9\u5F0F",
        viewTime: "\u23F1 \u6309\u72C0\u614B",
        viewChannel: "\u{1F4E1} \u6309\u983B\u9053",
        groupSignal: "\u25CE \u5F85\u8FA6\u8A0A\u865F",
        groupNoise: "\u{1F507} \u7121\u8A0A\u865F",
        groupNoiseTitle:
          "AI \u5224\u5B9A\u70BA\u7121\u8A0A\u865F\uFF08\u672A\u7D93\u4EBA\u5DE5\u78BA\u8A8D\uFF09\uFF1B\u4E00\u9375\u6E05\u7A7A = \u6574\u7D44\u78BA\u8A8D\u70BA\u566A\u97F3",
        groupFailed: "\u26A0 AI \u5224\u5B9A\u5931\u6557",
        groupCaught: "\u2714 \u5DF2\u6355\u6349",
        groupEscaped: "\u2715 \u5DF2\u9003\u8D70",
        collapse: "\u6536\u8D77",
        expand: "\u5C55\u958B",
        clearNoise: "\u2715 \u4E00\u9375\u6E05\u7A7A",
        clearNoiseTitle:
          "\u628A\u7121\u8A0A\u865F\u8A0A\u606F\u6574\u7D44\u9003\u8D70\uFF08\u539F\u56E0\u8A18\u70BA\u566A\u97F3\uFF09",
        noiseCleared: "\u{1F507} \u5DF2\u6E05\u7A7A {n} \u689D\u7121\u8A0A\u865F",
        retryFailed: "\u4E00\u9375\u91CD\u5224",
        retryFailedTitle:
          "\u628A\u300CAI \u5224\u5B9A\u5931\u6557\u300D\u7684\u8A0A\u606F\u91CD\u65B0\u9001 AI \u5224\u5B9A",
        forceEscapeFailed: "\u2715 \u5F37\u5236\u9003\u8D70",
        forceEscapeFailedTitle:
          "\u628A\u300CAI \u5224\u5B9A\u5931\u6557\u300D\u7684\u8A0A\u606F\u6574\u7D44\u9003\u8D70\uFF08AI \u5EFA\u8B70\u4E0D\u53EF\u4FE1\u6642\uFF09",
        retrying: "\u91CD\u5224\u4E2D\u2026",
        retry: "\u91CD\u5224",
        retryDone: "\u5DF2\u91CD\u5224 {n} \u689D",
        retryPartial: "\u91CD\u5224\u5B8C\u6210\uFF1A{ok} \u689D\u6210\u529F \xB7 {fail} \u689D\u4ECD\u5931\u6557",
        hiConf: "\u53EA\u9078\u9AD8\u7F6E\u4FE1",
        signalAllDone:
          "\u5F85\u8FA6\u8A0A\u865F\u5168\u90E8\u8655\u7406\u5B8C\uFF0C\u8A13\u7DF4\u5BB6\u6548\u7387\u9A5A\u4EBA \u26A1",
        selectHint:
          "\u5728\u5DE6\u5074\u9078\u64C7\u4E00\u689D\u96FB\u6CE2 \xB7 \u2191\u2193 \u79FB\u52D5 \xB7 C \u6355\u6349 \xB7 X \u9003\u8D70 \xB7 F \u5F37\u5236",
        undo: "\u21A9 \u64A4\u92B7",
        restore: "\u6062\u5FA9",
        chipUpdate: "\u66F4\u65B0",
        chipNoise: "\u7121\u8A0A\u865F",
        chipVetoed: "\u5DF2\u5426\u6C7A",
        vetoedTitle: "AI \u5224\u5B9A\u6709\u5F85\u8FA6\u8A0A\u865F\uFF0C\u4F60\u5426\u6C7A\u4E86\u5B83",
        chanPending: "{n} \u5F85\u8655\u7406",
        chanTotal: "{n} \u689D",
        markMerged: "\u4F75\u5165 No.{id}",
      },
      edit: {
        title: "\u7DE8\u8F2F\u5F85\u8FA6",
        taskTitle: "\u6A19\u984C",
        note: "\u5099\u8A3B",
        category: "\u5206\u985E",
        priority: "\u512A\u5148\u7D1A",
        due: "\u622A\u6B62",
        remind: "\u63D0\u9192",
        tags: "\u6A19\u7C64",
        noTags:
          "\u9084\u6C92\u6709\u6A19\u7C64\uFF0C\u53BB \u80CC\u5305 \u2192 \u5206\u985E\u8207\u6A19\u7C64 \u88E1\u65B0\u589E",
        followUps: "\u8DDF\u9032\u8A18\u9304",
        noFollowUps: "\u66AB\u7121\u8DDF\u9032\u8A18\u9304",
        followUpPlaceholder: "\u88DC\u5145\u8DDF\u9032\u8A18\u9304\u2026\uFF08\u6309 Enter \u65B0\u589E\uFF09",
        addFollowUp: "\u65B0\u589E",
        confirmDeleteNote: "\u78BA\u8A8D\u522A\u9664\uFF1F",
        agentRuns: "\u{1F916} Agent \u57F7\u884C",
        runDuration: "\u7528\u6642 {v}",
        openTranscript: "\u5728\u7D42\u7AEF\u56DE\u653E\u8A72\u6703\u8A71\u7D00\u9304",
        history: "\u{1F4DC} \u64CD\u4F5C\u6B77\u53F2",
        noHistory: "\u66AB\u7121\u64CD\u4F5C\u8A18\u9304",
        titleRequired: "\u6A19\u984C\u4E0D\u80FD\u70BA\u7A7A",
      },
      detail: {
        status: "\u72C0\u614B",
        source: "\u4F86\u6E90",
        focus: "\u5C08\u6CE8",
        created: "\u5EFA\u7ACB",
        completed: "\u5B8C\u6210",
        escaped: "\u9003\u8D70",
        edit: "\u7DE8\u8F2F",
      },
      dispatch: {
        title: "\u26A1 Agent \u6D3E\u767C",
        needTag:
          "\u5148\u7D66\u5F85\u8FA6\u639B\u4E0A\u300C\u5C08\u6848\u300D\u7DAD\u5EA6\u6A19\u7C64\uFF0C\u624D\u80FD\u6309\u5C08\u6848\u8DEF\u7531\u6D3E\u767C\uFF08\u80CC\u5305 \u2192 \u5206\u985E\u8207\u6A19\u7C64\uFF09\u3002",
        noAgent:
          "\u9084\u6C92\u6709\u53EF\u7528\u7684 Agent\uFF1A\u53BB \u80CC\u5305 \u2192 Agent \u65B0\u589E\u4E26\u555F\u7528\u5F8C\uFF0C\u518D\u4F86\u6D3E\u767C\u3002",
        go: "\u6D3E\u767C",
        working: "\u6D3E\u767C\u4E2D\u2026",
        launched:
          "\u5DF2\u5728 {term} \u4E2D\u555F\u52D5\u300C{agent}\u300D\uFF0C\u4EFB\u52D9\u547D\u4EE4\u6703\u81EA\u52D5\u6CE8\u5165\uFF1B\u5B8C\u6210\u5F8C\u7528 pk \u5BEB\u56DE\u5F85\u8FA6\u72C0\u614B\u3002",
        dir: "\u6D3E\u767C\u5DE5\u4F5C\u76EE\u9304",
        dirDefault: "agent \u9810\u8A2D\u76EE\u9304",
        // M2：雙通道 + 狀態機
        chInteractive: "\u{1F5A5} \u4E92\u52D5\uFF08\u65B0\u7D42\u7AEF\u6A5F\uFF09",
        chHeadless: "\u{1F916} \u7121\u982D\uFF08\u81EA\u52D5\u56DE\u50B3\uFF09",
        headlessHint:
          "\u7121\u982D\u57F7\u884C\uFF1A\u8DD1\u5B8C\u6309\u9000\u51FA\u78BC\u81EA\u52D5\u5224\u5B9A\u6210\u6557\uFF08claude \u5E36\u6703\u8A71\u7E8C\u63A5\uFF09\uFF0C\u9069\u5408\u77ED\u4EFB\u52D9\uFF1B\u9577\u4EFB\u52D9\u5EFA\u8B70\u4E92\u52D5\u901A\u9053\u3002",
        headlessDone:
          "\u7121\u982D\u57F7\u884C\u5B8C\u6210\uFF08{agent}\uFF09\u2014\u2014\u8B8A\u66F4\u6458\u8981\u898B\u4E0B\u65B9\u57F7\u884C\u8A18\u9304\u3002",
        headlessFailed:
          "\u7121\u982D\u57F7\u884C\u5931\u6557\uFF08{agent}\uFF09\u2014\u2014\u539F\u56E0\u898B\u4E0B\u65B9\u57F7\u884C\u8A18\u9304\u3002",
        stQueued: "\u6392\u968A\u4E2D",
        stRunning: "\u57F7\u884C\u4E2D",
        stDone: "\u5DF2\u56DE\u50B3",
        stFailed: "\u5931\u6557",
        markDone: "\u6A19\u8A18\u5B8C\u6210",
        markFailed: "\u6A19\u8A18\u5931\u6557",
        markReset: "\u91CD\u7F6E",
        marked: "\u5DF2\u66F4\u65B0\u6D3E\u767C\u72C0\u614B",
        busyHint:
          "\u8A72\u5F85\u8FA6\u6D3E\u767C\u57F7\u884C\u4E2D\uFF1A\u7B49 agent \u56DE\u50B3\uFF0C\u6216\u7528\u4E0A\u65B9\u6309\u9215\u624B\u52D5\u6536\u53E3\u5F8C\u91CD\u6D3E",
        chipRunning: "Agent \u57F7\u884C\u4E2D",
        chipQueued: "\u6392\u968A\u6D3E\u767C",
      },
      dispatchCfg: {
        title: "\u26A1 \u5F85\u8FA6\u6D3E\u767C",
        hint: "\u6309\u5C08\u6848\u6A19\u7C64\u628A\u5F85\u8FA6\u4EA4\u7D66 agent \u8655\u7406\uFF0C\u624B\u52D5\u6D3E\u767C\u5165\u53E3\u5728\u4EFB\u52D9\u8A73\u60C5\u62BD\u5C5C\u3002",
        auto: "\u81EA\u52D5\u6D3E\u767C",
        autoDesc:
          "\u5230\u671F\u672A\u958B\u59CB\u3001\u4E14\u5C08\u6848\u6A19\u7C64\u6307\u5B9A\u4E86 agent \u7684\u5F85\u8FA6\uFF0C\u81EA\u52D5\u6392\u968A\u57F7\u884C",
        maxConcurrent: "\u6BCF\u6A5F\u5668\u4E26\u767C\u4E0A\u9650",
        maxConcurrentDesc: "\u672C\u6A5F\u8207\u6BCF\u53F0 SSH \u4E3B\u6A5F\u5206\u5225\u751F\u6548",
        mcN: "{n} \u500B",
        worktree: "worktree \u9694\u96E2",
        worktreeDesc:
          "\u6D3E\u767C\u5728\u7368\u7ACB\u5DE5\u4F5C\u6A39\u8207\u5206\u652F\u57F7\u884C\uFF0C\u4E92\u4E0D\u8E29\u8E0F\uFF0C\u5B8C\u6210\u5F8C\u4EBA\u5DE5\u5408\u4F75",
        foot: "\u624B\u52D5\u6D3E\u767C\u4E0D\u53D7\u9019\u4E9B\u958B\u95DC\u5F71\u97FF\u3002",
      },
      stabs: {
        focus: "\u5C08\u6CE8",
        taxonomy: "\u5206\u985E\u8207\u6A19\u7C64",
        pets: "\u684C\u5BF5",
        display: "\u986F\u793A",
        agents: "Agent",
        feishu: "\u98DB\u66F8",
        diag: "\u8A3A\u65B7",
        general: "\u4E00\u822C",
      },
      focus: {
        title: "\u{1F345} \u5C08\u6CE8 \xB7 \u756A\u8304\u9418",
        enable: "\u555F\u7528\u756A\u8304\u9418",
        enableDesc: "\u4EFB\u52D9\u9032\u884C\u6642\uFF0C\u684C\u5BF5\u81EA\u52D5\u5012\u6578",
        duration: "\u756A\u8304\u6642\u9577",
        minutes: "{n} \u5206\u9418",
        break: "\u77ED\u4F11\u606F",
        breakOff: "\u95DC\u9589\uFF08\u756A\u8304\u7D50\u675F\u5C31\u505C\uFF09",
        notify: "\u756A\u8304\u7D50\u675F\u767C\u7CFB\u7D71\u901A\u77E5",
        chime: "\u9577\u756A\u8304\u63D0\u793A\u97F3",
        chimeDesc: "\u226545 \u5206\u9418\u7684\u756A\u8304\u5728\u4E2D\u9EDE\u8207\u5269 5 \u5206\u9418\u8F15\u97FF",
        petTitle: "\u{1F43E} \u684C\u5BF5\u966A\u4F34",
        petInput: "\u8F38\u5165\u56DE\u61C9",
        petInputDesc:
          "\u7A7A\u9592\u6642\u96A8\u4F60\u6572\u9375\u76E4\u7684\u7BC0\u594F\u505A\u5C0F\u56DE\u61C9\uFF08\u53EA\u611F\u77E5\u5FEB\u6162\uFF0C\u4E0D\u770B\u5167\u5BB9\uFF09",
        petInputWorking: "\u5C08\u6CE8\u6642\u4E5F\u56DE\u61C9",
        petInputWorkingDesc: "\u5C08\u6CE8\u4E2D\u8E66\u8DF3\u7BC0\u594F\u8F15\u96A8\u6253\u5B57\u5FEB\u6162",
        petInputPerm:
          "macOS \u9700\u8981\u8F14\u52A9\u4F7F\u7528\u6388\u6B0A\uFF1A\u9EDE\u300C\u53BB\u6388\u6B0A\u300D\u76F4\u9054\u8A2D\u5B9A\u9762\u677F\uFF0C\u628A\u4E0B\u65B9\u8DEF\u5F91\u52A0\u5165\u5217\u8868\u4E26\u52FE\u9078\uFF1B\u56DE\u5230\u672C\u9801\u5373\u81EA\u52D5\u751F\u6548\u3002\u540C\u540D\u7684\u820A\u689D\u76EE\u5148\u79FB\u9664\uFF08\u2212\uFF09\u518D\u91CD\u65B0\u52A0\u5165\u3002",
        petInputPermToast:
          "\u8A2D\u5B9A\u5DF2\u5132\u5B58\u3002\u8F38\u5165\u56DE\u61C9\u9084\u5DEE\u8F14\u52A9\u4F7F\u7528\u6B0A\u9650\u2014\u2014\u5230\u300C\u684C\u5BF5\u300D\u9801\u958B\u95DC\u4E0B\u65B9\u9EDE\u300C\u53BB\u6388\u6B0A\u300D\u5B8C\u6210\u52FE\u9078",
        petInputGrant: "\u53BB\u6388\u6B0A",
        petInputExeCopy: "\u9EDE\u64CA\u8907\u88FD\u8DEF\u5F91",
        petInputGranted:
          "\u8F14\u52A9\u4F7F\u7528\u5DF2\u6388\u6B0A\uFF0C\u8F38\u5165\u56DE\u61C9\u958B\u59CB\u5DE5\u4F5C",
        petVoice: "\u684C\u5BF5\u8A9E\u97F3",
        petVoiceDesc:
          "\u91CC\u7A0B\u7891\u3001\u6536\u5DE5\u3001\u751F\u65E5\u3001\u5C0D\u8A71\u56DE\u7B54\u6642\u7528\u7CFB\u7D71\u8A9E\u97F3\u8AAA\u4E00\u53E5",
        petMate: "\u966A\u8DD1\u7CBE\u9748",
        petMateDesc:
          "\u5C08\u6CE8\u6EFF 25 \u5206\u9418\u6642\uFF0C\u5716\u9451\u88E1\u7684\u4E00\u96BB\u5BF6\u53EF\u5922\u4F86\u65C1\u908A\u966A\u4F60\u5750\u4E00\u6703\u5152",
      },
      remind: {
        title: "\u{1F514} \u63D0\u9192\u8207\u901A\u77E5",
        enable: "\u4EFB\u52D9\u63D0\u9192\u901A\u77E5",
        enableDesc: "\u7CFB\u7D71\u901A\u77E5\u8207\u684C\u5BF5\u6572\u9580\u63D0\u9192\u4E00\u8D77\u958B\u95DC",
        ahead: "\u63D0\u524D\u63D0\u9192",
        onTime: "\u6E96\u6642",
        aheadN: "\u63D0\u524D {n} \u5206\u9418",
        quiet: "\u52FF\u64FE\u6642\u6BB5",
        quietDesc:
          "\u6642\u6BB5\u5167\u975C\u9ED8\u975E\u7DCA\u6025\u63D0\u9192\uFF08\u7DCA\u6025\u4EFB\u52D9\u4ECD\u6572\u9580\uFF09\uFF1B\u652F\u63F4\u8DE8\u96F6\u9EDE\uFF0C\u5982 22:00\u201308:00",
        quietStart: "\u52FF\u64FE\u958B\u59CB",
        quietEnd: "\u52FF\u64FE\u7D50\u675F",
      },
      cats: {
        title: "\u{1F5C2} \u4EFB\u52D9\u5206\u985E \xB7 \u5BF6\u53EF\u5922\u63DB\u88DD",
        save: "\u5132\u5B58",
        release: "\u653E\u751F",
        new: "\uFF0B \u65B0\u5206\u985E",
        hint: "\u300C\u653E\u751F\u300D\u5206\u985E\u7684\u4EFB\u52D9\u81EA\u52D5\u6B78\u5230\u7B2C\u4E00\u500B\u555F\u7528\u7684\u5206\u985E\uFF1B\u505C\u7528\u7684\u5206\u985E\u4E0D\u9032\u65B0\u589E\u8207 AI \u9078\u9805\uFF0C\u65E2\u6709\u4EFB\u52D9\u4E0D\u53D7\u5F71\u97FF\uFF08\u81F3\u5C11\u4FDD\u7559\u4E00\u500B\u555F\u7528\uFF09\u3002\u63CF\u8FF0\u6703\u63D0\u793A\u7D66 AI \u4F5C\u5206\u985E\u5224\u5B9A\u53C3\u8003\uFF0C\u5982\u300C\u6709\u7522\u51FA\u7269\u4E14\u9700\u5C08\u6CE8\u7684\u4EFB\u52D9\u300D\u3002",
        descPlaceholder: "\u63CF\u8FF0\uFF08\u4F9B AI \u5224\u5B9A\u53C3\u8003\uFF0C\u53EF\u7A7A\uFF09",
        toggle: "\u505C\u7528/\u555F\u7528",
        newName: "\u65B0\u5206\u985E",
        mainTitle: "\u{1F43E} \u4E3B\u5BF6\u53EF\u5922",
        mainLabel: "\u4E3B\u5BF6\u53EF\u5922",
        mainFollow: "\u8DDF\u96A8\u7B2C\u4E00\u500B\u5206\u985E",
        mainDesc:
          "\u6C92\u6709\u9032\u884C\u4E2D\u4EFB\u52D9\u6642\uFF0C\u684C\u5BF5\u5C55\u793A\u7260\uFF1B\u4E0D\u8A2D\u5B9A\u5247\u8DDF\u96A8\u7B2C\u4E00\u500B\u5206\u985E",
        quotesTitle: "\u{1F399} \u5BF6\u53EF\u5922\u53F0\u8A5E",
        quotesPh:
          "\u6BCF\u884C\u4E00\u53E5\uFF0C\u9EDE\u64CA\u684C\u5BF5\u6642\u96A8\u6A5F\u5192\u51FA\u3002\u4F8B\u5982\uFF1A\n\u76AE\u5361\u76AE\u5361\uFF01\u4ECA\u5929\u4E5F\u62DC\u8A17\u4E86\uFF01\n\u8A13\u7DF4\u5BB6\uFF0C\u5148\u8A66 5 \u5206\u9418\uFF1F",
        quotesCount: "\u5DF2\u5BEB {n} \u53E5",
        quotesSave: "\u5132\u5B58\u53F0\u8A5E",
      },
      pk: {
        searchPh: "\u641C\u5C0B\u5BF6\u53EF\u5922\uFF1A\u540D\u7A31 / \u7DE8\u865F / \u82F1\u6587\u540D",
        empty: "\u5716\u9451\u6A5F\u6C92\u67E5\u5230\u9019\u96BB\u5BF6\u53EF\u5922",
        bundled: "\u5167\u5EFA",
        footHint:
          "\u540D\u9304\u4F86\u81EA Pok\xE9API\uFF081025 \u96BB\uFF09\xB7 \u652F\u63F4\u540D\u7A31\u3001\u7DE8\u865F\u8207\u82F1\u6587\u540D\u641C\u5C0B",
      },
      tags: {
        title: "\u{1F3F7} \u6A19\u7C64",
        save: "\u5132\u5B58",
        release: "\u522A\u9664",
        new: "\uFF0B \u65B0\u6A19\u7C64",
        hint: "\u6A19\u7C64\u6309\u7DAD\u5EA6\u5206\u7D44\uFF0CAI \u7522\u751F\u5F85\u8FA6\u6642\u6311\u9078\u5408\u9069\u7684\u6A19\u7C64\uFF1B\u6C92\u6709\u8CBC\u5207\u9078\u9805\u4E14\u8A0A\u606F\u6709\u4F9D\u64DA\u6642\uFF0C\u4E5F\u6703\u63D0\u8B70\u65B0\u6A19\u7C64\uFF08\u63A5\u53D7\u6642\u624D\u5EFA\u7ACB\uFF09\u3002",
        namePh: "\u6A19\u7C64\u540D",
        descPh: "\u63CF\u8FF0\uFF08\u7D66 AI \u548C\u81EA\u5DF1\u770B\u7684\u8AAA\u660E\uFF09",
        newName: "\u65B0\u6A19\u7C64",
        dimCount: "{used}/{max}",
        single: "\u55AE\u9078",
        dimHint:
          "\u540C\u4E00\u7DAD\u5EA6\u5167\u540D\u7A31\u552F\u4E00\uFF1B\u6BCF\u689D\u5F85\u8FA6\u6700\u591A\u639B 3 \u500B\u6A19\u7C64\uFF08\u5C08\u6848\u7DAD\u5EA6\u81F3\u591A 1 \u500B\uFF09\u3002",
        dimTitle: "\u{1F5C2} \u6A19\u7C64\u7DAD\u5EA6",
        dimNamePh: "\u65B0\u7DAD\u5EA6\u540D\u7A31",
        dimNew: "\uFF0B \u65B0\u7DAD\u5EA6",
        maxTags: "\u6A19\u7C64\u6578\u4E0A\u9650",
        dimManageHint:
          "key \u8207\u55AE\u9078/\u591A\u9078\u5EFA\u5F8C\u4E0D\u53EF\u6539\uFF1B\u505C\u7528\u5F8C\u4E0D\u518D\u9032\u5165\u65B0\u589E\u8207 AI \u9078\u9805\u3002",
        metaAgentOff: "\u5DF2\u505C\u7528",
      },
      // ---- 專案派發卡片（project 標籤 → agent / 工作目錄 / 專案上下文） ----
      tagDispatch: {
        title: "\u5C08\u6848\u6D3E\u767C",
        hint: "\u7D66\u639B\u300C\u5C08\u6848\u300D\u6A19\u7C64\u7684\u5F85\u8FA6\u6307\u5B9A\u6D3E\u767C agent\uFF1B\u6539\u52D5\u5373\u6642\u751F\u6548\u3002",
        agent: "\u6D3E\u767C Agent",
        agentNone: "\u4E0D\u6307\u5B9A\uFF08\u5168\u57DF\u9810\u8A2D\uFF09",
        workdir: "\u5DE5\u4F5C\u76EE\u9304",
        workdirDesc: "\u7559\u7A7A\u7528 agent \u9810\u8A2D",
        workdirPh: "~/projects/my-repo",
        context: "\u5C08\u6848\u4E0A\u4E0B\u6587",
        contextPh: "\u6280\u8853\u68E7\u3001\u6CE8\u610F\u4E8B\u9805\u2026",
        configured: "\u5DF2\u914D\u7F6E",
        unconfigured: "\u672A\u914D\u7F6E",
        empty:
          "\u9084\u6C92\u6709\u300C\u5C08\u6848\u300D\u7DAD\u5EA6\u7684\u6A19\u7C64\u2014\u2014\u5230\u300C\u5206\u985E\u8207\u6A19\u7C64\u300D\u5206\u5340\u628A\u6A19\u7C64\u7684\u7DAD\u5EA6\u6539\u70BA\u300C\u5C08\u6848\u300D\uFF0C\u5C31\u80FD\u5728\u9019\u88E1\u914D\u7F6E\u6D3E\u767C\u3002",
        foot: "agent \u8207\u76EE\u9304\u90FD\u7559\u7A7A\u6642\u6309\u5168\u57DF\u9810\u8A2D\u6D3E\u767C\u3002",
        chipHint:
          "\u5DF2\u914D\u7F6E\u6D3E\u767C\uFF1A\u5728\u300CAgent\u300D\u5206\u5340\u7684\u300C\u5C08\u6848\u6D3E\u767C\u300D\u5361\u7247\u7BA1\u7406",
        historyTip:
          "\u5728\u65B0\u7D42\u7AEF\u6A5F\u958B\u555F\u300C{name}\u300D\u7684\u6B77\u53F2\u8A18\u9304\uFF08\u672A\u6307\u5B9A agent \u6642\u70BA\u5168\u57DF\u9810\u8A2D\uFF09",
        historyNone:
          "\u9084\u6C92\u6709\u53EF\u7528\u7684 agent\u2014\u2014\u5148\u5728\u300CAgent\u300D\u5206\u5340\u8A2D\u5B9A\u4E26\u555F\u7528",
      },
      dim: {
        project: "\u5C08\u6848",
        context: "\u5834\u666F",
        person: "\u4EBA\u7269",
        topic: "\u4E3B\u984C",
      },
      display: {
        title: "\u{1F440} \u986F\u793A",
        date: "\u65E5\u671F\u683C\u5F0F",
        time: "\u6642\u9593\u5236\u5F0F",
        h24: "24 \u5C0F\u6642\u5236\uFF0818:00\uFF09",
        h12: "12 \u5C0F\u6642\u5236\uFF086:00 PM\uFF09",
        overdueMode: "\u903E\u671F\u4EFB\u52D9\u5C55\u793A",
        dueRelative: "\u76F8\u5C0D\u622A\u6B62\u6642\u9593",
        dueRelativeDesc:
          "\u986F\u793A\u70BA\u300C3 \u5C0F\u6642\u5F8C / \u660E\u5929 15:00 / \u5DF2\u903E\u671F 2 \u5929\u300D\uFF0C\u4E26\u6309\u81E8\u8FD1\u7A0B\u5EA6\u8B8A\u8272",
        reduceMotion: "\u6E1B\u5F31\u52D5\u6548",
        reduceMotionDesc:
          "\u505C\u7528\u9583\u720D\u8207\u8E66\u8DF3\u52D5\u756B\uFF1B\u7CFB\u7D71\u958B\u555F\u300C\u6E1B\u5C11\u52D5\u614B\u6548\u679C\u300D\u6642\u81EA\u52D5\u751F\u6548",
        preview: "\u9810\u89BD\uFF1A{v}",
        language: "\u8A9E\u8A00",
      },
      sess: {
        filter_all: "\u5168\u90E8",
        filter_radio: "\u6536\u97F3\u6A5F",
        filter_dispatch: "\u6D3E\u767C",
        filter_other: "\u5176\u4ED6",
        kind: {
          classify: "\u6536\u97F3\u6A5F\u5206\u985E",
          capture: "\u5FEB\u901F\u6355\u6349",
          dispatch_headless: "\u7121\u982D\u6D3E\u767C",
          dispatch_interactive: "\u4E92\u52D5\u6D3E\u767C",
          pk: "agent \u88DC\u9304",
          legacy: "\u65E9\u671F\u8A18\u9304",
        },
        open: "\u56DE\u653E",
        openTmux: "\u91CD\u9023\u8A72 tmux \u6D3E\u767C\u6703\u8A71",
        reload: "\u91CD\u65B0\u6574\u7406",
        loading: "\u8F09\u5165\u4E2D\u2026",
        empty: "\u9084\u6C92\u6709\u6703\u8A71\u8A18\u9304",
        dirUnset: "\uFF08\u672A\u8A18\u9304\u76EE\u9304\uFF09",
        prev: "\u4E0A\u4E00\u9801",
        next: "\u4E0B\u4E00\u9801",
        pageOf: "\u7B2C {cur}/{max} \u9801",
      },
      ai: {
        title: "\u{1F916} AI Agent CLI",
        hint: "\u7528\u672C\u6A5F AI agent \u547D\u4EE4\u5217\u8655\u7406\u6536\u97F3\u6A5F\u8A0A\u606F\u5206\u985E\u8207\u5224\u91CD\uFF0C\u53EF\u8A2D\u5B9A\u591A\u500B\u3002",
        sshOn: "SSH \u9060\u7AEF\u57F7\u884C",
        sshHostPh: "user{'@'}host",
        sshPort: "SSH \u9023\u63A5\u57E0",
        sshKeyPh: "\u79C1\u9470\u8DEF\u5F91\uFF08\u53EF\u9078\uFF0C\u5982 ~/.ssh/id_ed25519\uFF09",
        sshTunnel: "\u53CD\u5411\u96A7\u9053\u9023\u63A5\u57E0",
        sshKeepAlive: "\u5E38\u99D0\u96A7\u9053",
        sshKeepAliveDesc:
          "\u4FDD\u6301\u9577\u9023\u4F9B\u9060\u7AEF\u547C\u53EB pk\uFF0C\u65B7\u7DDA\u81EA\u52D5\u91CD\u9023",
        tunnelOff: "\u672A\u904B\u884C",
        tunnelHealthy: "\u5DF2\u9023\u901A",
        tunnelConnecting: "\u5EFA\u7ACB\u4E2D\u2026",
        tunnelRetrying: "\u65B7\u7DDA\uFF0C\u91CD\u9023\u4E2D",
        tunnelUnknown: "\u72C0\u614B\u53D6\u5F97\u4E2D\u2026",
        setupRemote: "\u4E00\u9375\u914D\u7F6E\u9060\u7AEF pk",
        settingUp: "\u6B63\u5728\u914D\u7F6E\u9060\u7AEF pk\u2026\uFF08\u7D04\u5341\u5E7E\u79D2\uFF09",
        setupDone:
          "\u2705 \u9060\u7AEF pk \u5DF2\u5C31\u7DD2\uFF08pk {v}\uFF09\uFF0C\u53EF\u9EDE\u300C\u6E2C\u8A66\u300D\u8DD1\u5DE5\u5177\u63A2\u91DD",
        setupFailed: "\u914D\u7F6E\u672A\u5B8C\u6210\uFF0C\u8ACB\u770B\u5931\u6557\u6B65\u9A5F\u7684\u63D0\u793A",
        args: "\u9644\u52A0\u53C3\u6578",
        argsPh: "-p {'{prompt}'}",
        namePh: "Claude Code",
        cmdPh: "claude / opencode / pi / dsh",
        workdir: "\u5DE5\u4F5C\u76EE\u9304",
        workdirPh: "\u7559\u7A7A = ~/.choose-you/workspace",
        historyArgs: "\u6B77\u53F2\u53C3\u6578",
        skillDir: "\u6280\u80FD\u6839\u76EE\u9304",
        skillDirPh:
          "\u5982 ~/.claude/skills\uFF1B\u6280\u80FD\u88DD\u9032 <\u76EE\u9304>/pokemon-choose-you\uFF0C\u652F\u63F4 ~ \u524D\u7DB4",
        timeout: "\u903E\u6642\uFF08\u79D2\uFF09",
        enabled: "\u555F\u7528",
        primary: "\u7528\u65BC\u6536\u97F3\u6A5F\u5206\u985E",
        primaryNone: "\u4E0D\u6307\u5B9A",
        terminal: "\u7D42\u7AEF\u504F\u597D",
        terminalDesc:
          "\u4E92\u52D5\u6D3E\u767C\u3001\u6B77\u53F2\u8A18\u9304\u8207\u98DB\u66F8\u6388\u6B0A\u559A\u8D77\u7684\u7D42\u7AEF\u61C9\u7528",
        termBuiltin: "\u7CFB\u7D71\u5167\u5EFA",
        save: "\u5132\u5B58",
        test: "\u6E2C\u8A66",
        history: "\u6B77\u53F2\u8A18\u9304 \u2197",
        openingHistory: "\u6B63\u5728\u958B\u555F\u7D42\u7AEF\u6A5F\u2026",
        remove: "\u522A\u9664",
        add: "\uFF0B \u65B0\u589E Agent",
        local: "\u672C\u6A5F",
        skill: "pk \u6280\u80FD",
        skillCheck: "\u6AA2\u67E5",
        skillInstall: "\u5B89\u88DD/\u540C\u6B65",
        skillInstalling: "\u6B63\u5728\u540C\u6B65\u6280\u80FD\u2026",
        skillUnknown: "\u672A\u6AA2\u67E5",
        skillNotInstalled: "\u672A\u5B89\u88DD",
        skillUpToDate: "\u5DF2\u88DD v{v}\uFF08\u6700\u65B0\uFF09",
        skillOutdated: "\u5DF2\u88DD v{v}\uFF0C\u5167\u5EFA v{b}\uFF0C\u53EF\u66F4\u65B0",
        skillInstalled: "\u2705 \u6280\u80FD\u5DF2\u5B89\u88DD v{v}\uFF08{where}\uFF09",
        skillUpdated: "\u2705 \u6280\u80FD\u5DF2\u5347\u7D1A v{prev} \u2192 v{v}\uFF08{where}\uFF09",
        cliHint:
          "\u61C9\u7528\u81EA\u5E36 pk \u547D\u4EE4\u5217\uFF08pk task list \u2026\uFF09\u4F9B AI agent \u8207\u7D42\u7AEF\u6A5F\u76F4\u63A5\u8B80\u5BEB\u5F85\u8FA6\uFF0C\u8A73\u898B\u4F7F\u7528\u6307\u5357\u3002",
      },
      // ---- AI 提示詞卡（editable-prompts）：文案全表 = uiux-design.md §8 ----
      prompts: {
        title: "AI \u63D0\u793A\u8A5E",
        sub: "\u6AA2\u8996\u8207\u81EA\u8A02\u5404 AI \u529F\u80FD\u7684\u7CFB\u7D71\u63D0\u793A\u8A5E\uFF0C\u5132\u5B58\u5F8C\u4E0B\u4E00\u6B21 AI \u547C\u53EB\u5373\u751F\u6548\u3002",
        foot: "\u5167\u5EFA\u9810\u8A2D\u96A8\u61C9\u7528\u5347\u7D1A\u6F14\u9032\uFF0C\u6062\u5FA9\u9810\u8A2D\u96A8\u6642\u53EF\u56DE\u3002\u81EA\u8A02\u5167\u5BB9\u4E0D\u6703\u51FA\u73FE\u5728\u8A3A\u65B7\u532F\u51FA\u8207\u65E5\u8A8C\u4E2D\u3002",
        feature: {
          im_classify: "IM \u5206\u985E",
          capture: "\u5FEB\u901F\u6355\u6349",
          pet_chat: "\u684C\u5BF5\u5C0D\u8A71",
          tag_health: "\u6A19\u7C64\u6CBB\u7406",
          dispatch: "\u5F85\u8FA6\u6D3E\u767C",
        },
        badgeDefault: "\u5167\u5EFA\u9810\u8A2D",
        badgeCustom: "\u81EA\u8A02",
        badgeWarn: "\u26A0 \u4E0D\u53EF\u7528",
        badgeReadonly: "\u552F\u8B80",
        badgeUnsaved: "\u672A\u5132\u5B58",
        tagDefault: "\u7576\u524D\u751F\u6548",
        tagCustom: "\u7576\u524D\u751F\u6548 \xB7 \u81EA\u8A02",
        loading: "\u8B80\u53D6\u4E2D\u2026",
        loadFailed: "\u63D0\u793A\u8A5E\u8B80\u53D6\u5931\u6557\uFF1A{err}",
        retry: "\u91CD\u8A66",
        edit: "\u7DE8\u8F2F",
        cancel: "\u53D6\u6D88",
        save: "\u5132\u5B58",
        saving: "\u5132\u5B58\u4E2D\u2026",
        restore: "\u6062\u5FA9\u9810\u8A2D\u2026",
        confirmText:
          "\u5C07\u6E05\u9664\u81EA\u8A02\u5167\u5BB9\uFF0C\u6062\u5FA9\u70BA\u7576\u524D\u7248\u672C\u5167\u5EFA\u9810\u8A2D\u3002",
        confirmOk: "\u78BA\u8A8D\u6062\u5FA9",
        confirmAria: "\u6062\u5FA9\u9810\u8A2D\u78BA\u8A8D",
        compare: "\u5167\u5EFA\u9810\u8A2D\u5C0D\u7167 \u25BE",
        compareTitle: "\u5167\u5EFA\u9810\u8A2D\uFF08\u7576\u524D\u7248\u672C\uFF09",
        editorWarn:
          "\u26A0 \u63D0\u793A\u8A5E\u5167\u5D4C\u5224\u5B9A\u5354\u8B70\u8207\u51FA\u53E3\u9580\u7981\uFF0C\u8AA4\u522A\u53EF\u80FD\u5C0E\u81F4\u5224\u5B9A\u5931\u6557\u6216\u5EFA\u8B70\u6C61\u67D3\u2014\u2014\u6539\u52D5\u5F8C\u82E5\u5224\u5B9A\u7570\u5E38\uFF0C\u5148\u8A66\u6062\u5FA9\u9810\u8A2D\u3002",
        phLabel: "\u5FC5\u8981\u4F54\u4F4D\u7B26",
        phDesc: "\u9EDE\u64CA\u63D2\u5165\u5230\u6E38\u6A19\u8655\uFF1B\u7F3A\u5931\u6642\u7121\u6CD5\u5132\u5B58",
        readonlyNote:
          "\u6B64\u9805\u627F\u8F09\u4E0D\u53EF\u4FE1\u8A0A\u606F\u7684\u9694\u96E2\u7D50\u69CB\uFF08\u8CC7\u6599\u5B9A\u754C\u8207\u5BA3\u544A\uFF09\uFF0C\u70BA\u5B89\u5168\u8A2D\u8A08\u4E0D\u652F\u63F4\u7DE8\u8F2F\u3002",
        warnLine:
          "\u26A0 \u81EA\u8A02\u8986\u84CB\u7F3A\u5C11\u7576\u524D\u7248\u672C\u8981\u6C42\u7684\u4F54\u4F4D\u7B26\uFF08{names}\uFF09\uFF0C\u7576\u524D\u5DF2\u6309\u5167\u5EFA\u9810\u8A2D\u751F\u6548\uFF1B\u9EDE\u300C\u7DE8\u8F2F\u300D\u88DC\u9F4A\u5F8C\u5132\u5B58\u5373\u53EF\u6062\u5FA9\u4F7F\u7528\u3002",
        warnOverlong:
          "\u26A0 \u81EA\u8A02\u8986\u84CB\u8D85\u904E\u9577\u5EA6\u4E0A\u9650\uFF08{n} / 20000 \u5B57\u5143\uFF09\uFF0C\u7576\u524D\u5DF2\u6309\u5167\u5EFA\u9810\u8A2D\u751F\u6548\uFF1B\u9EDE\u300C\u7DE8\u8F2F\u300D\u522A\u6E1B\u5F8C\u5132\u5B58\u5373\u53EF\u6062\u5FA9\u4F7F\u7528\u3002",
        vMissing:
          "\u7F3A\u5C11\u5FC5\u8981\u4F54\u4F4D\u7B26\uFF1A{names}\u2014\u2014\u9EDE\u64CA\u4F54\u4F4D\u7B26\u63D2\u5165\u5F8C\u5373\u53EF\u5132\u5B58\u3002",
        vOverlong:
          "\u8D85\u904E\u9577\u5EA6\u4E0A\u9650\uFF08{n} / 20000 \u5B57\u5143\uFF09\uFF0C\u8ACB\u522A\u6E1B\u5F8C\u518D\u5132\u5B58\u3002",
        vUnknown:
          "\u542B\u61C9\u7528\u4E0D\u8A8D\u8B58\u7684\u4F54\u4F4D\u7B26\uFF1A{names}\uFF0C\u5C07\u6309\u5B57\u9762\u767C\u7D66 AI\u3002",
        vBlank:
          "\u5167\u5BB9\u70BA\u7A7A\uFF1A\u5132\u5B58\u5F8C\u5C07\u6062\u5FA9\u4F7F\u7528\u5167\u5EFA\u9810\u8A2D\u3002",
        vSameDefault:
          "\u8207\u5167\u5EFA\u9810\u8A2D\u4E00\u81F4\uFF1A\u5132\u5B58\u5F8C\u8996\u70BA\u672A\u81EA\u8A02\u3002",
        savedHint:
          "\u2705 \u5DF2\u5132\u5B58\uFF0C\u4E0B\u4E00\u6B21\u300C{feature}\u300D\u547C\u53EB\u5373\u751F\u6548\u3002",
        restoredHint: "\u2705 \u5DF2\u6062\u5FA9\u5167\u5EFA\u9810\u8A2D\u3002",
        saveFailed: "\u274C \u5132\u5B58\u5931\u6557\uFF1A{err}",
        copyAll: "\u8907\u88FD\u5168\u6587",
        copied: "\u5DF2\u8907\u88FD",
        editorAria: "\u7DE8\u8F2F{feature}\u63D0\u793A\u8A5E",
      },
      feishu: {
        enable: "\u555F\u7528\u80CC\u666F\u8F2A\u8A62",
        interval: "\u8F2A\u8A62\u9593\u9694",
        hint: "\u5148\u5B89\u88DD lark-cli\uFF08npm install -g {'@'}larksuite/cli\uFF09\uFF0C\u518D\u9EDE\u300C\u6388\u6B0A\u767B\u5165\u300D\u5728\u7D42\u7AEF\u6A5F\u5B8C\u6210\u521D\u59CB\u5316\u8207\u6388\u6B0A\uFF1B\u6191\u8B49\u7531 lark-cli \u4FDD\u7BA1\uFF0C\u4E0D\u9032\u672C\u61C9\u7528\u8CC7\u6599\u5EAB\u3002\u5224\u5B9A\u5168\u7A0B\u5047\u540D\u5316\uFF1A\u771F\u5BE6\u59D3\u540D\u4E0D\u767C\u7D66 AI\uFF0C\u4E00\u5F8B\u4EE5\u4EE3\u865F\u51FA\u73FE\u3002",
        auth: "\u6388\u6B0A\u767B\u5165",
        reauth: "\u91CD\u65B0\u6388\u6B0A",
        authing: "\u6B63\u5728\u7D42\u7AEF\u555F\u52D5 lark-cli \u767B\u5165\u2026",
        authorized: "\u5DF2\u6388\u6B0A\uFF1A{name}",
        unauthorized:
          "\u672A\u6388\u6B0A\uFF08\u9700\u4F7F\u7528\u8005\u8EAB\u5206\u624D\u80FD\u62C9\u53D6\u4F60\u7684\u79C1\u804A/\u7FA4\u8A0A\u606F\uFF09",
        test: "\u6E2C\u8A66\u98DB\u66F8\u9023\u7DDA",
        pollNow: "\u7ACB\u5373\u62C9\u53D6\u4E00\u6B21",
        pollResult: "\u672C\u8F2A\u65B0\u589E {n} \u689D\u5EFA\u8B70",
        myNames: "\u6211\u7684\u7A31\u547C",
        myNamesDesc:
          "\u547D\u4E2D\u9019\u4E9B\u7A31\u547C\u7684\u8A0A\u606F\u6703\u6A19\u8A3B\u300C\u7591\u4F3C\u6307\u6D3E\u7D66\u4F60\u300D",
        myNamesPh: "\u5982\uFF1A\u55AC\u8001\u95C6\uFF0C\u8001\u55AC",
        filter: {
          title: "\u6703\u8A71\u904E\u6FFE",
          hint: "\u9010\u6703\u8A71\u6C7A\u5B9A\u54EA\u4E9B\u98DB\u66F8\u8A0A\u606F\u53C3\u8207\u62C9\u53D6\uFF1B\u8DDF\u96A8\u514D\u6253\u64FE\u70BA\u9810\u8A2D\uFF0C\u624B\u52D5\u8A2D\u5B9A\u5F8C\u4EE5\u672C\u61C9\u7528\u70BA\u6E96\u3002\u79C1\u804A\u4E0D\u53C3\u8207\u904E\u6FFE\u7BA1\u7406\uFF0C\u56FA\u5B9A\u8DDF\u96A8\u514D\u6253\u64FE\u3002",
          summary:
            "\u5171 {total} \u500B\u6703\u8A71\uFF1A{pulling} \u62C9\u53D6 \xB7 {filtered} \u904E\u6FFE \xB7 \u624B\u52D5 {manual}",
          staleOk: "\u4EE5\u4E0A\u4E00\u8F2A\u62C9\u53D6\u70BA\u6E96\uFF08{time}\uFF09",
          staleWarn:
            "\u26A0 \u8DDD\u4E0A\u4E00\u8F2A\u62C9\u53D6\u5DF2 {min} \u5206\u9418\uFF0C\u72C0\u614B\u53EF\u80FD\u4E0D\u662F\u6700\u65B0\u3002\u53EF\u5728\u300C\u8A3A\u65B7 \xB7 \u6574\u5408\u5065\u5EB7\u300D\u67E5\u770B\u8A73\u60C5\u3002",
          searchPh: "\u641C\u5C0B\u6703\u8A71\u540D\u7A31",
          searchLabel: "\u6309\u6703\u8A71\u540D\u7A31\u641C\u5C0B",
          chipsLabel: "\u6309\u751F\u6548\u72C0\u614B\u7BE9\u9078",
          prefChipsLabel: "\u6309\u504F\u597D\u8A2D\u5B9A\u7BE9\u9078",
          prefGroupLabel: "{name}\uFF1A\u904E\u6FFE\u504F\u597D",
          fAll: "\u5168\u90E8 {n}",
          fPull: "\u62C9\u53D6 {n}",
          fFiltered: "\u88AB\u904E\u6FFE {n}",
          pAll: "\u5168\u90E8\u504F\u597D {n}",
          fFollow: "\u8DDF\u96A8 {n}",
          fManual: "\u624B\u52D5\u8A2D\u5B9A {n}",
          typeChipsLabel: "\u6309\u6703\u8A71\u985E\u578B\u7BE9\u9078",
          matchCount: "\u7B26\u5408\u7BE9\u9078\u689D\u4EF6\uFF1A{n} / {total} \u500B\u6703\u8A71",
          tAll: "\u5168\u90E8\u985E\u578B {n}",
          tGroup: "\u7FA4\u804A {n}",
          tBot: "\u6A5F\u5668\u4EBA {n}",
          prefFollow: "\u8DDF\u96A8",
          prefFollowTitle:
            "\u8DDF\u96A8\u514D\u6253\u64FE\uFF08\u9810\u8A2D\uFF09\uFF1A\u6309\u98DB\u66F8\u5074\u514D\u6253\u64FE\u6C7A\u5B9A",
          prefPull: "\u62C9\u53D6",
          prefPullTitle:
            "\u7E3D\u662F\u62C9\u53D6\uFF1A\u7121\u8AD6\u98DB\u66F8\u662F\u5426\u514D\u6253\u64FE\u90FD\u62C9\u53D6",
          prefFilter: "\u904E\u6FFE",
          prefFilterTitle:
            "\u7E3D\u662F\u904E\u6FFE\uFF1A\u6574\u6703\u8A71\u8DF3\u904E\uFF0C\u4E00\u689D\u8A0A\u606F\u90FD\u4E0D\u62C9",
          effPull: "\u{1F4E1} \u62C9\u53D6",
          effFilter: "\u{1F507} \u904E\u6FFE",
          srcManual: "\u624B\u52D5",
          srcFollow: "\u8DDF\u96A8",
          srcDegraded: "\u964D\u7D1A",
          srcDegradedTitle:
            "\u514D\u6253\u64FE\u67E5\u8A62\u5931\u6557\uFF0C\u672C\u8F2A\u964D\u7D1A\u70BA\u4E0D\u904E\u6FFE\uFF1B\u4E0B\u4E00\u8F2A\u6062\u5FA9\u5F8C\u6309\u514D\u6253\u64FE\u63A8\u5C0E",
          emptyDisabled:
            "\u555F\u7528\u98DB\u66F8\u80CC\u666F\u8F2A\u8A62\u5F8C\uFF0C\u9019\u88E1\u6703\u5217\u51FA\u4F60\u7684\u5168\u90E8\u6703\u8A71\u3002",
          emptyNoSnap:
            "\u9084\u6C92\u6709\u62C9\u53D6\u5FEB\u7167\u3002\u7B49\u5F85\u4E0B\u4E00\u8F2A\u8F2A\u8A62\uFF0C\u6216\u7ACB\u5373\u62C9\u53D6\u4E00\u6B21\u3002",
          emptySnapEmpty: "\u4E0A\u4E00\u8F2A\u62C9\u53D6\u672A\u767C\u73FE\u6703\u8A71\u3002",
          emptySearch: "\u6C92\u6709\u7B26\u5408\u300C{q}\u300D\u7684\u6703\u8A71",
          emptyFiltered: "\u76EE\u524D\u7BE9\u9078\u7D44\u5408\u4E0B\u6C92\u6709\u6703\u8A71",
          loading: "\u8B80\u53D6\u6703\u8A71\u5FEB\u7167\u2026",
          loadFail: "\u6703\u8A71\u5217\u8868\u8B80\u53D6\u5931\u6557\uFF1A{err}",
          retry: "\u91CD\u8A66",
          writeFail: "\u274C \u8A2D\u5B9A\u672A\u751F\u6548\uFF0C\u8ACB\u91CD\u8A66\uFF1A{err}",
          footImmediate:
            "\u6B64\u8655\u7684\u66F4\u6539\u7ACB\u5373\u751F\u6548\uFF08\u7121\u9700\u9EDE\u300C\u5132\u5B58\u8A2D\u5B9A\u300D\uFF09\uFF0C\u4E0B\u4E00\u8F2A\u62C9\u53D6\u8D77\u4F5C\u7528\u3002",
          footNoBackfill:
            "\u89E3\u9664\u904E\u6FFE\u53EA\u6536\u65B0\u8A0A\u606F\uFF0C\u4E0D\u56DE\u88DC\u6B77\u53F2\uFF1B\u8A2D\u5B9A\u904E\u6FFE\u524D\u7684\u8A0A\u606F\u8207\u5F85\u8FA6\u4FDD\u6301\u539F\u6A23\u3002",
        },
      },
      diag: {
        healthTitle: "\u{1FA7A} \u6574\u5408\u5065\u5EB7",
        healthHint:
          "\u98DB\u66F8 / AI \u5169\u689D\u93C8\u8DEF\u7684\u904B\u884C\u72C0\u614B\uFF1B\u5931\u6557\u81EA\u52D5\u9000\u907F\u91CD\u8A66\uFF0C\u4E5F\u53EF\u624B\u52D5\u89F8\u767C\u3002",
        provider: { feishu: "\u98DB\u66F8\u96FB\u6CE2", ai: "AI Agent" },
        status: {
          off: "\u672A\u8A2D\u5B9A",
          paused: "\u5DF2\u66AB\u505C",
          idle: "\u5F85\u904B\u884C",
          ok: "\u6B63\u5E38",
          degraded: "\u964D\u7D1A\u91CD\u8A66\u4E2D",
          down: "\u6545\u969C",
        },
        lastSuccess: "\u4E0A\u6B21\u6210\u529F {v}",
        never: "\u5C1A\u672A\u904B\u884C",
        nextPoll: "\u4E0B\u6B21\u8F2A\u8A62 {v}",
        pending: "\u5F85\u78BA\u8A8D\u5EFA\u8B70 {n}",
        primaryAgent: "\u5206\u985E Agent\uFF1A{name}",
        pollNow: "\u7ACB\u5373\u62C9\u53D6",
        logTitle: "\u{1F4DC} \u904B\u884C\u65E5\u8A8C",
        logLevel: "\u7D1A\u5225",
        allLevels: "\u5168\u90E8",
        logSource: "\u4F86\u6E90\u904E\u6FFE",
        refresh: "\u91CD\u65B0\u6574\u7406",
        copyReport: "\u8907\u88FD\u652F\u63F4\u5831\u544A",
        reportCopied:
          "\u2714 \u5DF2\u8907\u88FD\u652F\u63F4\u5831\u544A\uFF08\u7248\u672C + \u5065\u5EB7\u5FEB\u7167 + \u6700\u8FD1\u65E5\u8A8C\uFF0C\u5DF2\u812B\u654F\uFF09",
        reportFailed: "\u274C \u8907\u88FD\u5931\u6557\uFF0C\u8ACB\u624B\u52D5\u8907\u88FD",
        logEmpty:
          "\u66AB\u7121\u65E5\u8A8C\u3002\u5B8C\u6574\u65E5\u8A8C\u6A94\u6848\u4F4D\u65BC ~/.choose-you/logs/ \u4E0B\u3002",
      },
      general: {
        autostart: "\u958B\u6A5F\u81EA\u52D5\u555F\u52D5",
        autostartDesc: "\u767B\u5165\u5F8C\u684C\u5BF5\u81EA\u52D5\u51FA\u73FE",
        closeToTray: "\u95DC\u9589\u4E3B\u8996\u7A97\u6642\u6536\u5230\u7CFB\u7D71\u5323",
        closeToTrayDesc: "\u61C9\u7528\u7E7C\u7E8C\u5E38\u99D0\uFF0C\u7CFB\u7D71\u5323\u9078\u55AE\u53EF\u7D50\u675F",
        shortcuts:
          "\u5168\u57DF\u5FEB\u6377\u9375\uFF1ACtrl+Shift+K \u5FEB\u901F\u6355\u6349\u5F85\u8FA6 \xB7 Ctrl+Shift+D \u986F\u793A/\u96B1\u85CF\u684C\u5BF5\uFF08macOS \u70BA \u2318\u21E7K / \u2318\u21E7D\uFF09",
      },
      overdue: {
        collapse: "\u6536\u8D77",
        leaked: "\u6628\u5929\u6709 {n} \u96BB\u6E9C\u8D70\u4E86\uFF08\u9EDE\u958B\u770B\u770B\uFF09",
        fresh: "\u5168\u90E8\u6B78\u8349\u53E2",
        freshing: "\u6B78\u4F4D\u4E2D\u2026",
        modeCollapse: "\u6298\u758A\u70BA\u4E00\u884C",
        modeAuto: "\u81EA\u52D5\u6B78\u8349\u53E2\uFF08\u6BCF\u5929\u6E05\u4E00\u6B21\u903E\u671F\u6642\u9593\uFF09",
        modeShow: "\u539F\u6A23\u986F\u793A",
      },
      rel: {
        overdueMin: "\u5DF2\u903E\u671F {n} \u5206\u9418",
        overdueHour: "\u5DF2\u903E\u671F {n} \u5C0F\u6642",
        overdueDay: "\u5DF2\u903E\u671F {n} \u5929",
        inMin: "{n} \u5206\u9418\u5F8C",
        inHour: "{n} \u5C0F\u6642\u5F8C",
        tomorrowAt: "\u660E\u5929 {v}",
        dayAfterAt: "\u5F8C\u5929 {v}",
        inDay: "{n} \u5929\u5F8C",
        sun: "\u9031\u65E5",
        mon: "\u9031\u4E00",
        tue: "\u9031\u4E8C",
        wed: "\u9031\u4E09",
        thu: "\u9031\u56DB",
        fri: "\u9031\u4E94",
        sat: "\u9031\u516D",
      },
      review: {
        title: "\u8A13\u7DF4\u5BB6\u8907\u76E4",
        entry: "\u8907\u76E4",
        stepOverview: "\u7E3D\u89BD",
        stepRoute: "\u8DEF\u7DDA\u8907\u76E4",
        stepGrass: "\u8349\u53E2\u6B78\u4F4D",
        stepTags: "\u6A19\u7C64\u9AD4\u6AA2",
        tagChecking:
          "\u{1FA7A} \u6A19\u7C64\u9AD4\u6AA2\u4E2D\u2026\uFF08AI \u6B63\u5728\u8907\u6838\u8A5E\u8868\uFF09",
        tagCheckFailed: "\u9AD4\u6AA2\u5931\u6557\uFF0C\u53EF\u91CD\u8A66\u6216\u8DF3\u904E\u672C\u6B65",
        tagRetry: "\u91CD\u8A66",
        tagMerges: "\u8FD1\u7FA9\u5408\u4F75\u5EFA\u8B70",
        tagMerge: "\u5408\u4F75",
        tagIgnore: "\u5FFD\u7565",
        tagZombies: "\u6BAD\u5C4D\u6A19\u7C64\uFF0890 \u5929\u672A\u7528\u4E14\u975E\u624B\u5EFA\uFF09",
        tagRelease: "\u653E\u751F",
        tagKeep: "\u4FDD\u7559",
        tagNewDims: "\u65B0\u7DAD\u5EA6\u5EFA\u8B70\uFF08AI \u767C\u73FE\u7684\u6B63\u4EA4\u5206\u985E\u9762\uFF09",
        tagAdopt: "\u63A1\u7D0D",
        tagClean: "\u{1F3F7} \u8A5E\u8868\u5F88\u5065\u5EB7\uFF0C\u7121\u9700\u6CBB\u7406",
        tagUnjudged:
          "\u672A\u914D\u7F6E AI \u6216\u5224\u5B9A\u5931\u6557\uFF1A\u4EE5\u4E0A\u70BA\u672C\u5730\u76F8\u4F3C\u5EA6\u9810\u7BE9\uFF0C\u5408\u4F75\u524D\u8ACB\u81EA\u884C\u78BA\u8A8D\u3002",
        tagTip:
          "AI \u5DF2\u8907\u6838\uFF1B\u5408\u4F75/\u653E\u751F/\u63A1\u7D0D\u5373\u6642\u751F\u6548\uFF0C\u5FFD\u7565\u53EA\u5F71\u97FF\u672C\u6B21\u590D\u76D8\u3002",
        stepDone: "\u6536\u5C3E",
        caughtWeek: "\u672C\u9031\u6355\u6349",
        focusWeek: "\u672C\u9031\u5C08\u6CE8(\u5206)",
        onRoute: "\u8DEF\u7DDA\u4E0A",
        inGrass: "\u8349\u53E2\u88E1",
        overviewTip:
          "\u6309\u4E0B\u4E00\u6B65\u9010\u7AD9\u904E\u4E00\u904D\u8DEF\u7DDA\u4E0A\u7684\u4EFB\u52D9\uFF0C\u518D\u6279\u6B21\u6536\u62FE\u8349\u53E2\u2014\u2014\u6BCF\u9031\u4E00\u6B21\uFF0C\u5E7E\u5206\u9418\u5C31\u597D\u3002",
        keep: "\u4FDD\u7559",
        complete: "\u5B8C\u6210",
        toGrass: "\u6B78\u8349\u53E2",
        escape: "\u9003\u8D70",
        routeTip:
          "\u770B\u8457\u4E0D\u5C0D\u7684\u5C31\u5730\u8655\u7406\uFF1A\u5B8C\u6210\u7684\u6253\u52FE\u3001\u4E0D\u505A\u7684\u653E\u751F\u3001\u9084\u6C92\u60F3\u597D\u7684\u6B78\u8349\u53E2\u3002",
        routeEmpty: "\u8DEF\u7DDA\u662F\u7A7A\u7684\uFF0C\u6C92\u6709\u8981\u8907\u76E4\u7684\u4EFB\u52D9\u3002",
        overdue: "\u7B49\u6025\u4E86",
        skipRoute: "\u8DF3\u904E\u8DEF\u7DDA",
        next: "\u4E0B\u4E00\u6B65",
        selectAllGrass: "\u5168\u9078\u8349\u53E2",
        releaseGrass: "\u6279\u6B21\u653E\u751F",
        grassEmpty: "\u8349\u53E2\u4E7E\u4E7E\u6DE8\u6DE8\uFF0C\u6C92\u6709\u8981\u6B78\u4F4D\u7684\u3002",
        released: "\u5DF2\u653E\u751F {n} \u96BB",
        finishLine: "\u672C\u9031\u5171\u6536\u670D {n} \u96BB\u5BF6\u53EF\u5922\uFF01",
        finishTip:
          "\u8907\u76E4\u5B8C\u6210\u5DF2\u8A18\u9304\uFF1B\u4E0B\u9031\u540C\u4E00\u6642\u9593\u6703\u518D\u63D0\u9192\u4F60\u3002",
        finish: "\u7D50\u675F\u8907\u76E4",
      },
      reviewDow: {
        1: "\u9031\u4E00",
        2: "\u9031\u4E8C",
        3: "\u9031\u4E09",
        4: "\u9031\u56DB",
        5: "\u9031\u4E94",
        6: "\u9031\u516D",
        7: "\u9031\u65E5",
      },
      reviewCfg: {
        title: "\u{1F9E2} \u6BCF\u9031\u8907\u76E4\u63D0\u9192",
        enable: "\u555F\u7528\u63D0\u9192",
        enableDesc:
          "\u5230\u8A2D\u5B9A\u661F\u671F\u767C\u7CFB\u7D71\u901A\u77E5\uFF0C\u8907\u76E4\u5165\u53E3\u5728\u5716\u9451\u9801",
        dow: "\u63D0\u9192\u65E5",
      },
      backup: {
        title: "\u8CC7\u6599\u5099\u4EFD",
        enable: "\u6BCF\u65E5\u81EA\u52D5\u5099\u4EFD",
        enableDesc: "\u5FEB\u7167\u5B58\u65BC ~/.choose-you/data/backups/\uFF0C\u6EFE\u52D5\u4FDD\u7559",
        keep: "\u4FDD\u7559\u4EFD\u6578",
        keepN: "{n} \u4EFD",
        now: "\u7ACB\u5373\u5099\u4EFD",
        working: "\u5099\u4EFD\u4E2D\u2026",
        done: "\u2714 \u5DF2\u5099\u4EFD {v}",
        hint: "\u300C\u6062\u5FA9\u300D\u6703\u7528\u6240\u9078\u5099\u4EFD\u8986\u84CB\u7576\u524D\u5168\u90E8\u8CC7\u6599\uFF1B\u5BC6\u9470\u5728\u7CFB\u7D71\u9470\u5319\u5708\uFF0C\u4E0D\u53D7\u5F71\u97FF\u3002",
        restore: "\u6062\u5FA9",
        confirmRestore: "\u78BA\u8A8D\u8986\u84CB\u6062\u5FA9\uFF1F",
        restoring: "\u6062\u5FA9\u4E2D\u2026",
        restored: "\u2714 \u5DF2\u5F9E\u5099\u4EFD\u6062\u5FA9\uFF0C\u8CC7\u6599\u5DF2\u5237\u65B0",
        empty:
          "\u9084\u6C92\u6709\u5099\u4EFD\uFF0C\u9EDE\u300C\u7ACB\u5373\u5099\u4EFD\u300D\u5EFA\u7ACB\u7B2C\u4E00\u4EFD",
      },
      export: {
        title: "\u8CC7\u6599\u532F\u51FA / \u532F\u5165",
        json: "\u5168\u91CF JSON",
        csv: "\u4EFB\u52D9 CSV",
        md: "\u4ECA\u65E5\u65E5\u5831",
        openDir: "\u958B\u555F\u532F\u51FA\u76EE\u9304",
        hint: "\u532F\u51FA\u7522\u7269\u5728 ~/.choose-you/data/exports/ \u4E0B\uFF1BJSON \u53EF\u5728\u5225\u7684\u6A5F\u5668\u532F\u5165\uFF08\u6574\u9AD4\u8986\u84CB\uFF09\uFF0CMarkdown \u65E5\u5831\u53EF\u76F4\u63A5\u4F75\u5165\u77E5\u8B58\u5EAB\u3002",
        pick: "\u9078\u64C7 JSON \u6A94\u6848\u2026",
        chosen: "\u5DF2\u9078 {v}",
        saveJson: "\u53E6\u5B58\u5168\u91CF JSON\u2026",
        saveCsv: "\u53E6\u5B58\u4EFB\u52D9 CSV\u2026",
        saveMd: "\u53E6\u5B58\u4ECA\u65E5\u65E5\u5831\u2026",
        savedTo: "\u2714 \u5DF2\u532F\u51FA\u5230 {v}",
        notJson: "\u8ACB\u9078\u64C7 .json \u532F\u51FA\u6A94\u6848",
        doImport: "\u532F\u5165",
        confirmImport: "\u78BA\u8A8D\u8986\u84CB\u532F\u5165\uFF1F",
        importing: "\u532F\u5165\u4E2D\u2026",
        imported: "\u2714 \u5DF2\u532F\u5165 {n} \u884C\uFF08{v}\uFF09\uFF0C\u8CC7\u6599\u5DF2\u5237\u65B0",
        done: "\u2714 \u5DF2\u532F\u51FA {v}",
      },
      update: {
        title: "\u5716\u9451\u6A5F\u97CC\u9AD4",
        current: "\u97CC\u9AD4\u7248\u672C v{v}",
        check: "\u6AA2\u67E5\u66F4\u65B0",
        checking: "\u6AA2\u67E5\u4E2D\u2026",
        upToDate: "\u97CC\u9AD4\u5DF2\u662F\u6700\u65B0 \u2714",
        found: "\u767C\u73FE\u65B0\u97CC\u9AD4 v{v}",
        install: "\u4E0B\u8F09\u4E26\u91CD\u555F\u5B89\u88DD",
        installing: "\u4E0B\u8F09\u5B89\u88DD\u4E2D\u2026\uFF08\u5B8C\u6210\u5F8C\u81EA\u52D5\u91CD\u555F\uFF09",
        progress: "\u4E0B\u8F09\u4E2D {pct}%",
        linuxHint:
          "Linux \u4E0B\u81EA\u52D5\u66F4\u65B0\u50C5\u652F\u63F4 AppImage \u5B89\u88DD\u65B9\u5F0F\uFF1Bdeb / rpm \u4F7F\u7528\u8005\u8ACB\u4E0B\u8F09\u65B0\u5305\u8986\u84CB\u5B89\u88DD\u3002",
      },
      save: "\u5132\u5B58\u8A2D\u5B9A",
      save2: "\u5132\u5B58",
      cancel: "\u53D6\u6D88",
      saved: "\u5DF2\u5132\u5B58 \u2714",
      testing: "\u6E2C\u8A66\u4E2D\u2026",
      catSaved: "\u5206\u985E\u5DF2\u66F4\u65B0 \u2714",
      tagSaved: "\u6A19\u7C64\u5DF2\u66F4\u65B0 \u2714",
      promptSchedule: "\u52A0\u5165\u8DEF\u7DDA\uFF1A\u9078\u64C7\u622A\u6B62/\u958B\u59CB\u6642\u9593",
      entry: {
        due: "\u622A\u6B62 {v}",
        remind: "\u63D0\u9192 {v}",
        focus: "\u2605 \u5C08\u6CE8 {n} \u5206\u9418",
        from: "\u4F86\u81EA{src}",
        feishu: "\u98DB\u66F8",
        capture: "\u5FEB\u901F\u6355\u6349",
        catching: "\u6355\u7372\u4E2D",
        paused: "\u66AB\u505C",
        caught: "\u2714 \u5DF2\u6355\u6349",
        undo: "\u21A9 \u5FA9\u539F",
        start: "\u25B6 \u51FA\u767C",
        pause: "\u23F8 \u66AB\u505C",
        route: "\u52A0\u5165\u8DEF\u7DDA",
        edit: "\u7DE8\u8F2F",
        done: "\u5B8C\u6210",
        escape: "\u9003\u8D70\uFF08\u53D6\u6D88\uFF09",
        escaped: "\u5DF2\u9003\u8D70",
        release: "\u653E\u751F\uFF08\u522A\u9664\uFF09",
        empty:
          "\u8349\u53E2\u7A7A\u7A7A\u7684\u2014\u2014\u53BB\u6536\u97F3\u6A5F\u807D\u807D\u96FB\u6CE2\uFF0C\u6216\u81EA\u5DF1\u4E1F\u4E00\u9846\u7CBE\u9748\u7403\u9032\u4F86\uFF01",
        emptyToday:
          "\u4ECA\u5929\u9084\u6C92\u6709\u5192\u96AA\u5B89\u6392\uFF0C\u53BB\u8349\u53E2\u6216\u8DEF\u7DDA\u6311\u500B\u76EE\u6A19\u51FA\u767C\u5427\uFF01",
        emptyRoute:
          "\u8DEF\u7DDA\u5716\u7A7A\u7A7A\u7684\uFF0C\u7D66\u5F85\u8FA6\u8A2D\u500B\u622A\u6B62\u6642\u9593\uFF0C\u898F\u5283\u4E0B\u4E00\u7AD9\u5427\uFF01",
      },
      pet: {
        welcome:
          "\u4ECA\u5929\u60F3\u6355\u6349\u54EA\u96BB\u5BF6\u53EF\u5922\uFF1F\u61F8\u505C\u6253\u958B\u5FEB\u6377\u5716\u9451\u5C4F\u5427\uFF01",
        menuDex: "\u958B\u555F\u5716\u9451\u6A5F",
        menuQuick: "\u5FEB\u6377\u5716\u9451\u5C4F",
        menuPause: "\u66AB\u505C\u76EE\u524D\u4EFB\u52D9",
        menuHide: "\u96B1\u85CF\u684C\u5BF5",
        menuSwitch: "\u5207\u63DB\u6355\u6349\u76EE\u6A19\u2026",
        menuResume: "\u7E7C\u7E8C",
        menuDone: "\u5B8C\u6210\u6355\u6349",
        // ---- 桌寵情緒互動（PET_INTERACTION_DESIGN）：演出/物理/睡覺/問候 ----
        petted: "\u266A {p}\u88AB\u6478\u5F97\u7787\u8D77\u4E86\u773C~",
        beingCarried: "\uFF08\u88AB\u62CE\u8D77\u4F86\u4E86\uFF01\u5C0F\u788E\u6B65\u7DCA\u5F35\u4E2D\uFF09",
        dropped: "\u549A\uFF01\u5B89\u5168\u843D\u5730\uFF5E",
        throwing: "{p}\u84C4\u529B\u4E00\u64F2\u2026",
        catchOk: "\u2714 \u6355\u6349\u6210\u529F\uFF01\u300C{t}\u300D\u8A18\u5165\u5716\u9451\u5566",
        milestone: "\u2605 \u7D2F\u8A08 {n} \u96BB\uFF01{p}\u63D0\u8B70\u958B\u4E00\u5834\u5716\u9451\u6176\u5178",
        allDone:
          "\u{1F389} \u4ECA\u65E5\u5716\u9451\u5713\u6EFF\uFF01{p}\u8AAA\uFF1A\u6536\u5DE5\uFF0C\u597D\u597D\u4F11\u606F\uFF01",
        wakeUp: "\u55DA\u54C7\u2014\u2014{p}\u63C9\u63C9\u773C\u775B\uFF1A\u4F60\u56DE\u4F86\u5566\uFF01",
        asleepHint: "\uFF08\u7761\u8457\u4E86\uFF0C\u52D5\u4E00\u4E0B\u6ED1\u9F20\u6216\u9EDE\u9EDE\u5B83\uFF09",
        greetMorning:
          "\u65E9\u5B89\uFF01{p}\u7CBE\u795E\u6EFF\u6EFF\uFF0C\u4ECA\u5929\u4E5F\u4E00\u8D77\u51FA\u767C\u5427",
        greetDay: "\u5348\u5B89\uFF01{p}\u5728\u8349\u53E2\u908A\u7B49\u4F60\u6311\u76EE\u6A19",
        greetEvening:
          "\u665A\u4E0A\u597D\uFF01\u4ECA\u5929\u7684\u5192\u96AA\u9084\u5269\u4E00\u9EDE\uFF0C{p}\u966A\u4F60\u6536\u5C3E",
        greetNight: "\u591C\u6DF1\u4E86\uFF0C{p}\u8AAA\uFF1A\u518D\u5C08\u6CE8\u4E5F\u8981\u7761\u89BA\u54E6",
        idle: "\u4ECA\u5929\u7684\u5192\u96AA\u9084\u6C92\u958B\u59CB\uFF0C\u61F8\u505C\u6253\u958B\u5FEB\u6377\u5716\u9451\u5C4F\u6311\u500B\u76EE\u6A19\u5427",
        /** 設了主寶可夢時的待機氣泡（說出牠的名字） */
        idleNamed:
          "{p}\u5728\u7B49\u4F60\u51FA\u767C\uFF01\u61F8\u505C\u6253\u958B\u5FEB\u6377\u5716\u9451\u5C4F\u6311\u500B\u76EE\u6A19\u5427",
        working: "{p}\u6B63\u5728\u6355\u6349\uFF1A{t}",
        paused: "{p}\u66AB\u505C\u4E2D\uFF0C\u4F11\u606F\u4E00\u4E0B~",
        remindUrgent: "\u203C {p}\u6025\u5F97\u76F4\u8DFA\u8173\uFF1A\u300C{t}\u300D\u5F88\u7DCA\u6025\uFF01",
        reminderDo: "\u5B8C\u6210",
        reminderSnooze: "\u5EF6\u5F8C 10 \u5206\u9418",
        reminderDone:
          "\u2714 \u300C{t}\u300D\u6355\u6349\u6210\u529F\uFF01{p}\u5E6B\u4F60\u8A18\u9032\u5716\u9451\u5566",
        reminderSnoozed: "\u597D\uFF5E10 \u5206\u9418\u5F8C\u518D\u63D0\u9192\u4F60",
        remindNormal: "\u{1F43E} {p}\u62C9\u62C9\u4F60\u7684\u8863\u89D2\uFF1A\u300C{t}\u300D\u5225\u5FD8\u4E86",
        pomoDone:
          "\u{1F345} \u756A\u8304\u5B8C\u6210\uFF01{p}\u554F\uFF1A\u300C{t}\u300D\u6355\u6349\u5230\u4E86\u55CE\uFF1F",
        trialStart: "\u5C31\u8A66 5 \u5206\u9418\uFF0C\u4E0D\u6210\u4E5F\u6C92\u95DC\u4FC2\uFF01",
        trialDone:
          "\u{1F366} 5 \u5206\u9418\u6253\u5361\u5B8C\u6210\uFF01\u611F\u89BA\u5C0D\u4E86\u5C31 \u25B6 \u7E7C\u7E8C\uFF0C\u4ECA\u5929\u5230\u6B64\u70BA\u6B62\u4E5F\u5B8C\u5168 OK",
        pomoNotifTitle: "\u{1F345} \u756A\u8304\u5B8C\u6210\uFF01",
        pomoNotifBody: "\u300C{t}\u300D\u505A\u5230\u54EA\u4E86\uFF1F{p}\u966A\u4F60\u4F11\u606F\u4E00\u4E0B~",
        breakStart: "\u2615 \u4F11\u606F\u4E00\u4E0B\uFF0C\u5BF6\u53EF\u5922\u5E6B\u4F60\u770B\u8457\u6642\u9593~",
        breakEnd: "\u4F11\u606F\u7D50\u675F\uFF01\u9EDE \u25B6 \u958B\u65B0\u4E00\u8F2A\u756A\u8304\uFF5E",
        quickPick: "\u9078\u4E00\u500B\u6355\u6349\u76EE\u6A19\u5427\uFF01",
        quickEmpty:
          "\u5716\u9451\u5C4F\u7A7A\u7A7A\u7684\uFF0C\u53BB\u5716\u9451\u6A5F\u9047\u898B\u4E00\u96BB\u91CE\u751F\u5BF6\u53EF\u5922\u5427",
        quickStart: "\u25B6 \u51FA\u767C",
        quickPause: "\u23F8 \u66AB\u505C",
        quickClose: "\u2715 \u6536\u8D77",
        bubbleClose: "\u9EDE\u64CA\u6536\u8D77\u53F0\u8A5E",
        switchTitle: "\u5207\u63DB\u6355\u6349\u76EE\u6A19\u2026",
        switchCancel: "\u53D6\u6D88",
        gotcha: "\u5C31\u6C7A\u5B9A\u662F\u4F60\u4E86\uFF01{t}",
        // ---- 桌寵體驗升級（PET_EXPERIENCE_PROPOSAL）：棲息 / 時刻台詞 / 連勝 / 對話 / 陪跑 ----
        perched: "\u627E\u5230\u4E86\u8212\u670D\u7684\u4F4D\u7F6E\uFF0C\u5750\u4E0B\u5566\uFF5E",
        hourLine: "\u{1F43E} \u6574\u9EDE\u5831\u6642\uFF1A\u9019\u500B\u5C0F\u6642\u4E5F\u4E00\u8D77\u52A0\u6CB9",
        nightLine:
          "\u9019\u9EBC\u665A\u9084\u5728\u5192\u96AA\u2026\u2026\u6536\u5DE5\u4E5F\u662F\u5F88\u5F37\u7684\u9078\u64C7\u54E6",
        fridayLine:
          "\u{1F43E} \u8DEF\u7DDA\u4E0A\u7684\u5BF6\u53EF\u5922\u90FD\u8AAA\uFF1A\u9031\u672B\u5FEB\u6A02\uFF01",
        birthdayLine: "\u4ECA\u5929\u662F\u7CBE\u9748\u8DDF\u8457\u8A13\u7DF4\u5BB6\u7684\u7B2C {n} \u5929\uFF01",
        streakN:
          "\u{1F43E} \u9023\u52DD {n} \u5929\uFF01\u672C\u9031\u7684\u8349\u53E2\u90FD\u88AB\u4F60\u8E0F\u5E73\u5566\uFF01",
        mateHint: "\u966A\u8DD1\u7684\u5BA2\u4EBA\uFF08\u9EDE\u7260\u5C31\u63EE\u624B\u544A\u5225\uFF09",
        menuChat: "\u{1F4AC} \u548C\u7CBE\u9748\u804A\u804A",
        chatGreet:
          "\u{1F43E} \u5728\u7684\u5728\u7684\uFF01\u4EFB\u52D9\u548C\u5716\u9451\u7684\u4E8B\u90FD\u53EF\u4EE5\u554F\u6211\uFF08Esc \u6536\u8D77\uFF09",
        chatPh: "\u554F\u7260\u4EFB\u52D9 / \u5716\u9451\u7684\u4E8B\u2026",
        chatSend: "\u9001\u51FA",
        chatClose: "\u6536\u8D77\u5C0D\u8A71",
        chatFail:
          "\uFF08\u6B6A\u982D\uFF09\u9019\u500B\u554F\u984C\u5361\u4F4F\u4E86\uFF0C\u7A0D\u5F8C\u518D\u554F\u4E00\u6B21\u8A66\u8A66",
        chatQ1: "\u4ECA\u5929\u9084\u5269\u4EC0\u9EBC\uFF1F",
        chatQ2: "\u9019\u9031\u6355\u6349\u4E86\u591A\u5C11\uFF1F",
        quotes: [
          "\u76AE\u5361\u76AE\u5361\uFF01\u8981\u5C08\u6CE8\u54E6\uFF01",
          "\u5C31\u6C7A\u5B9A\u662F\u4F60\u4E86\uFF01",
          "\u76AE\u5361\u4E18\u4E5F\u5728\u7B49\u4F60\u641E\u5B9A\u7260~",
          "\u6478\u9B5A\u4E00\u6642\u723D\uFF0C\u6355\u6349\u5B8C\u6210\u66F4\u723D\uFF01",
          "\u885D\u9D28\uFF01\u9084\u5269\u4E00\u9EDE\u9EDE\uFF01",
          "\u76AE\u5361~ \u76AE\u5361~",
          "\u4ECA\u5929\u7684\u4F60\uFF0C\u4E5F\u662F\u4E86\u4E0D\u8D77\u7684\u8A13\u7DF4\u5BB6\uFF01",
          "\u6536\u97F3\u6A5F\u88E1\u597D\u50CF\u6709\u65B0\u96FB\u6CE2\u54E6~",
          "\u5148\u8A66 5 \u5206\u9418\uFF0C\u8AAA\u4E0D\u5B9A\u5C31\u9806\u4E86\uFF01",
          "\u8349\u53E2\u88E1\u90A3\u96BB\u5728\u7B49\u4F60\u7FFB\u724C\u5462\u3002",
          "\u6293\u5230\u4E86\u5C31\u767B\u9304\uFF0C\u5716\u9451\u6700\u559C\u6B61\u65B0\u689D\u76EE\u5566\u3002",
          "\u54FC\u54FC\u54C8\u563F\uFF01\u8A13\u7DF4\u5BB6\u52A0\u6CB9\uFF01",
        ],
        quotesNight: [
          "\u9019\u9EBC\u665A\u9084\u5728\u5192\u96AA\uFF0C\u5BF6\u53EF\u5922\u966A\u4F60\uFF0C\u4F46\u8981\u65E9\u9EDE\u4F11\u606F~",
          "\u6DF1\u591C\u7684\u8349\u53E2\u5F88\u5B89\u975C\uFF0C\u660E\u65E9\u518D\u51FA\u767C\u5427\u3002",
          "\u518D\u5C08\u6CE8\u4E5F\u8981\u7761\u89BA\uFF0C\u5361\u6BD4\u7378\u5148\u7761\u4E86\u3002",
        ],
      },
    };

    // ../src/i18n/en.ts
    var en_default = {
      tabs: {
        today: "Adventure",
        todayDesc: "Quests to conquer today",
        inbox: "Grass",
        inboxDesc: "Undecided wild Pokemon wait here",
        scheduled: "Route",
        scheduledDesc: "Your date-planned route\u2014clear tasks stop by stop",
        done: "Dex",
        doneDesc: "Hall of caught achievements",
        im: "Radio",
        imDesc: "Tune in to Feishu waves and catch todos",
        sessions: "Log",
        sessionsDesc: "Your agent pals' battle records\u2014replay any session",
        settings: "Bag",
        settingsDesc: "Trainer gear & Dex tuning",
      },
      dt: { none: "Not set", clear: "Clear" },
      error: { prefix: "The Dex hit a snag: " },
      ctx: {
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        selectAll: "Select All",
        openDetail: "View details",
        copyTitle: "Copy title",
        copyLine: "Copy line",
        copied: "\u2714 Copied",
      },
      spine: {
        tips: [
          "Dex advice: don't bite off more than you can chew.",
          "Send out one Pokemon at a time\u2014focus on the task at hand.",
          "Wild Pokemon won't walk into a Pok\xE9 Ball by themselves.",
          "Let the ones in the grass wait a little longer.",
          "Escaping isn't shameful\u2014the Dex remembers you showed up.",
          "A route is finished stop by stop.",
          "Today's wind is good for setting out.",
          "Tired? Rest\u2014Snorlax does it too.",
        ],
      },
      priority: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" },
      status: {
        inbox: "Grass",
        scheduled: "Route",
        active: "Active",
        paused: "Paused",
        done: "Done",
        cancelled: "Escaped",
      },
      dexFilter: {
        all: "All",
        done: "Caught",
        cancelled: "Escaped",
        empty: {
          all: "The dex is empty\u2014go catch a Pokemon!",
          done: "No caught records yet.",
          cancelled: "No escaped records yet.",
        },
      },
      dexStats: {
        line: "\u{1F4D9} {caught} caught all-time \xB7 {escaped} escaped",
        milestone: {
          m0: "The dex is empty\u2014your first Pokemon awaits.",
          m1: "The first one! The dex has started turning.",
          m10: "10 logged\u2014you've found your trainer rhythm.",
          m50: "50! A veteran trainer's aura.",
          m100: "100! A legendary trainer.",
          m200: "{n}\u2014the dex can barely hold more!",
        },
      },
      log: {
        create: "Created",
        update: "Updated",
        start: "Set out",
        pause: "Paused",
        demote: "Replaced",
        delete: "Released (deleted)",
        sync_pull: "Pulled from remote",
        sync_push: "Pushed to remote",
        sync_close: "Closed remote",
        migrate: "Data migration",
      },
      search: {
        placeholder: "\u{1F50D} Search todos (title / note / tags / follow-ups)",
        searching: "Searching\u2026",
        resultCount: "{n} found",
        empty: "No matching Pokemon found.",
      },
      im: {
        empty1: "The radio is quiet, no waves yet.",
        empty2:
          "After setting up Feishu & AI, every message arrives like a radio wave\u2014AI picks out todo signals for you.",
        found: "\u{1F4A1} Todo signal found: ",
        tagNew: "New tag (created on accept) \xB7 {dim}",
        catch: "\u25CE Catch",
        release: "\u2715 Release",
        search: "\u{1F50D} Search waves (message / chat / sender)",
        // Quick capture: one sentence → AI fills in the attributes
        capturePlaceholder: "Type a todo in one sentence\u2014AI fills in title / category / tags / due\u2026",
        captureSend: "\u26A1 Transmit",
        capturing: "AI working\u2026",
        capturePending: "AI generated a suggestion (duplicate / update)\u2014confirm it in the radio",
        force: "\u26A1 Force catch",
        forcing: "AI deduping\u2026",
        forceDone: "\u2714 Todo created",
        caughtTask: "Caught as todo No.{id}",
        released: "Released",
        aiVerdict: "AI verdict",
        dismissReasonLabel: "Reason",
        applyUpdate: "\u25CE Apply update",
        updateFound: "\u{1F527} Suggested update for todo No.{id}",
        updatedTask: "Updated todo No.{id}",
        followedTask: "Merged into todo No.{id} as follow-up",
        selectAll: "Select all pending",
        batchCatch: "\u25CE Catch all",
        batchRelease: "\u2715 Release all",
        batchDone: "{n} processed",
        batchPartial: "{ok} done \xB7 {fail} failed",
        escapeWhy: "Why release? (helps the AI improve)",
        escapeNoReason: "No reason",
        justEscape: "Just release",
        confidence: { high: "High", medium: "Medium", low: "Low" },
        escapeReasons: {
          duplicate: "Already tracked",
          not_task: "Not for me",
          wrong_info: "Wrong details",
          noise: "Chatter/noise",
          outdated: "Outdated",
          other: "Other",
        },
        type: { bot: "Bot", p2p: "Direct", group: "Group", local: "Typed" },
        status: {
          pending: "AI pending",
          // judgment in flight (claim protocol, specs/dsh-plugin §7.1 item 1): same look as pending
          judging: "AI pending",
          todo: "Todo signal",
          update: "Update suggestion",
          none: "No todo",
          followup: "Merged as follow-up",
          error: "AI failed",
        },
        // Two-pane triage view
        viewMode: "List grouping",
        viewTime: "\u23F1 By status",
        viewChannel: "\u{1F4E1} By channel",
        groupSignal: "\u25CE Todo signals",
        groupNoise: "\u{1F507} No signal",
        groupNoiseTitle:
          "AI judged these as no signal (not yet human-confirmed); Clear all confirms the group as noise",
        groupFailed: "\u26A0 AI judging failed",
        groupCaught: "\u2714 Caught",
        groupEscaped: "\u2715 Released",
        collapse: "Collapse",
        expand: "Expand",
        clearNoise: "\u2715 Clear all",
        clearNoiseTitle: "Release all no-signal messages (reason: noise)",
        noiseCleared: "\u{1F507} Cleared {n} no-signal messages",
        retryFailed: "Retry all",
        retryFailedTitle: "Re-run AI judgment on failed messages",
        forceEscapeFailed: "\u2715 Force release",
        forceEscapeFailedTitle: "Release all failed messages as a group (AI suggestion untrustworthy)",
        retrying: "Retrying\u2026",
        retry: "Retry",
        retryDone: "Re-judged {n} messages",
        retryPartial: "Retry done: {ok} ok \xB7 {fail} still failing",
        hiConf: "High conf. only",
        signalAllDone: "All todo signals handled\u2014trainer speed! \u26A1",
        selectHint: "Pick a wave on the left \xB7 \u2191\u2193 move \xB7 C catch \xB7 X release \xB7 F force",
        undo: "\u21A9 Undo",
        restore: "Restore",
        chipUpdate: "Update",
        chipNoise: "No signal",
        chipVetoed: "Vetoed",
        vetoedTitle: "AI flagged a todo signal; you vetoed it",
        chanPending: "{n} pending",
        chanTotal: "{n} msgs",
        markMerged: "Merged No.{id}",
      },
      edit: {
        title: "Edit todo",
        taskTitle: "Title",
        note: "Note",
        category: "Category",
        priority: "Priority",
        due: "Due",
        remind: "Remind",
        tags: "Tags",
        noTags: "No tags yet\u2014add some in Bag \u2192 Categories & Tags",
        followUps: "Follow-ups",
        noFollowUps: "No follow-ups yet",
        followUpPlaceholder: "Add a follow-up\u2026 (Enter)",
        addFollowUp: "Add",
        confirmDeleteNote: "Delete?",
        agentRuns: "\u{1F916} Agent runs",
        runDuration: "{v}",
        openTranscript: "Replay this session transcript in a terminal",
        history: "\u{1F4DC} History",
        noHistory: "No activity yet",
        titleRequired: "Title cannot be empty",
      },
      detail: {
        status: "Status",
        source: "Source",
        focus: "Focus",
        created: "Created",
        completed: "Completed",
        escaped: "Escaped",
        edit: "Edit",
      },
      dispatch: {
        title: "\u26A1 Dispatch to Agent",
        needTag:
          "Add a Project-dimension tag first \u2014 dispatch routes by project tag (Bag \u2192 Categories & Tags).",
        noAgent: "No agent available yet: add and enable one in Bag \u2192 AI Agents first.",
        go: "Dispatch",
        working: "Dispatching\u2026",
        launched:
          'Started "{agent}" in {term}; the task command is injected automatically. Use pk to write back when done.',
        dir: "Dispatch working directory",
        dirDefault: "agent default directory",
        // M2: dual channel + state machine
        chInteractive: "\u{1F5A5} Interactive (terminal)",
        chHeadless: "\u{1F916} Headless (auto-report)",
        headlessHint:
          "Headless run: success/failure decided by exit code when it finishes (claude resumes its session); good for short tasks \u2014 prefer interactive for long ones.",
        headlessDone: "Headless run finished ({agent}) \u2014 summary in the runs list below.",
        headlessFailed: "Headless run failed ({agent}) \u2014 reason in the runs list below.",
        stQueued: "queued",
        stRunning: "running",
        stDone: "reported",
        stFailed: "failed",
        markDone: "Mark done",
        markFailed: "Mark failed",
        markReset: "Reset",
        marked: "Dispatch state updated",
        busyHint: "This todo is being dispatched: wait for the agent to report, or close it out with the buttons above",
        chipRunning: "agent running",
        chipQueued: "dispatch queued",
      },
      dispatchCfg: {
        title: "\u26A1 Todo dispatch",
        hint: "Route todos to agents by project tag; the manual entry lives in the task drawer.",
        auto: "Auto dispatch",
        autoDesc: "Due-but-unstarted todos whose project tag names an agent are queued and run automatically",
        maxConcurrent: "Per-machine concurrency",
        maxConcurrentDesc: "Applies to local and each SSH host separately",
        mcN: "{n}",
        worktree: "worktree isolation",
        worktreeDesc:
          "Dispatches run in isolated worktrees and branches so they never stomp each other; merge manually when done",
        foot: "Manual dispatch ignores these switches.",
      },
      stabs: {
        focus: "Focus",
        taxonomy: "Categories & Tags",
        pets: "Pet",
        display: "Display",
        agents: "AI Agents",
        feishu: "Feishu",
        diag: "Diagnostics",
        general: "General",
      },
      focus: {
        title: "\u{1F345} Focus \xB7 Pomodoro",
        enable: "Enable pomodoro",
        enableDesc: "The pet counts down while a task runs",
        duration: "Focus length",
        minutes: "{n} min",
        break: "Short break",
        breakOff: "Off (stop when pomodoro ends)",
        notify: "System notification when a pomodoro ends",
        chime: "Long-pomodoro chime",
        chimeDesc: "Soft chime at midpoint & 5-min-left of long pomodoros (45min+)",
        petTitle: "\u{1F43E} Pet Companionship",
        petInput: "Input response",
        petInputDesc: "Idle pet reacts softly to your typing pace (senses speed only, never content)",
        petInputWorking: "Respond while focusing",
        petInputWorkingDesc: "Hop rhythm follows typing pace while focusing",
        petInputPerm:
          'macOS needs Accessibility permission: click "Grant" to open the panel, add the binary at the path below to the list and enable it; returning to this page applies it immediately. Remove stale entries with the same name first.',
        petInputPermToast:
          'Settings saved. Input response still needs the Accessibility permission \u2014 use the "Grant" button under the toggle in the Pet tab',
        petInputGrant: "Grant",
        petInputExeCopy: "Click to copy path",
        petInputGranted: "Accessibility granted \u2014 input response is now active",
        petVoice: "Pet voice",
        petVoiceDesc: "Speaks one line for milestones, wrap-up, birthdays and chat replies (system TTS)",
        petMate: "Companion sprite",
        petMateDesc: "After 25 min of focus, a Pokemon from your Pokedex comes and sits beside you",
      },
      remind: {
        title: "\u{1F514} Reminders & Notifications",
        enable: "Task reminders",
        enableDesc: "System popups and pet knock follow this switch together",
        ahead: "Remind ahead",
        onTime: "On time",
        aheadN: "{n} min early",
        quiet: "Quiet hours",
        quietDesc:
          "Silence non-urgent reminders during the window (urgent still knocks); crosses midnight, e.g. 22:00\u201308:00",
        quietStart: "Quiet from",
        quietEnd: "Quiet until",
      },
      cats: {
        title: "\u{1F5C2} Categories \xB7 Pokemon Outfits",
        save: "Save",
        release: "Release",
        new: "+ New",
        hint: 'Released categories hand their tasks to the first enabled one; a deactivated category leaves new-tag and AI options while existing tasks stay (keep at least one enabled). Descriptions guide AI classification, e.g. "focused work with a deliverable".',
        descPlaceholder: "Description (guides AI classification, optional)",
        toggle: "Deactivate / enable",
        newName: "New category",
        mainTitle: "\u{1F43E} Main Pokemon",
        mainLabel: "Main Pokemon",
        mainFollow: "Follow the first category",
        mainDesc: "Shown by the desk buddy when no task runs; unset = follow the first category",
        quotesTitle: "\u{1F399} Pokemon Quotes",
        quotesPh:
          "One per line, shown at random when you pet the buddy. e.g.:\nPika pika! Counting on you today!\nTrainer, just 5 minutes?",
        quotesCount: "{n} lines",
        quotesSave: "Save quotes",
      },
      pk: {
        searchPh: "Search Pokemon: name / number",
        empty: "No such Pokemon in the Dex",
        bundled: "Built-in",
        footHint: "Catalog from PokeAPI (1025) \u2014 search by name, number or English name",
      },
      tags: {
        title: "\u{1F3F7} Tags",
        save: "Save",
        release: "Delete",
        new: "+ New tag",
        hint: "Tags live in dimensions; AI picks fitting tags when creating todos, and proposes new ones (created only on accept) when nothing fits.",
        namePh: "Tag name",
        descPh: "Description (for AI and yourself)",
        newName: "New tag",
        dimCount: "{used}/{max}",
        single: "single",
        dimHint: "Names are unique within a dimension; each todo carries at most 3 tags (project at most 1).",
        dimTitle: "\u{1F5C2} Tag dimensions",
        dimNamePh: "New dimension name",
        dimNew: "+ New dimension",
        maxTags: "Tag limit",
        dimManageHint:
          "Key and cardinality are fixed after creation; disabled dimensions leave new-tag and AI options.",
        metaAgentOff: "disabled",
      },
      // ---- Project dispatch card (project tag → agent / workdir / project context) ----
      tagDispatch: {
        title: "Project Dispatch",
        hint: 'Assign a dispatch agent for todos tagged "Project"; changes save instantly.',
        agent: "Dispatch agent",
        agentNone: "Unspecified (global default)",
        workdir: "Working directory",
        workdirDesc: "Empty = agent default",
        workdirPh: "~/projects/my-repo",
        context: "Project context",
        contextPh: "Stack, caveats\u2026",
        configured: "Configured",
        unconfigured: "Not configured",
        empty: `No project-dimension tags yet\u2014switch a tag's dimension to "Project" in Categories & Tags to configure dispatch here.`,
        foot: "Empty agent/dir falls back to the global default.",
        chipHint: 'Dispatch configured: manage it in the "Project Dispatch" card on the AI Agents tab',
        historyTip: 'Open "{name}" history in a new terminal (global default when no agent is set)',
        historyNone: "No agent available yet\u2014set one up and enable it on the AI Agents tab",
      },
      dim: {
        project: "Project",
        context: "Context",
        person: "Person",
        topic: "Topic",
      },
      display: {
        title: "\u{1F440} Display",
        date: "Date format",
        time: "Time format",
        h24: "24-hour (18:00)",
        h12: "12-hour (6:00 PM)",
        overdueMode: "Overdue display",
        dueRelative: "Relative due times",
        dueRelativeDesc: 'Shown as "in 3h / tomorrow 3:00 PM / 2d overdue", colored by urgency',
        reduceMotion: "Reduce motion",
        reduceMotionDesc: "Stops blink & hop animations; auto-on when the OS reduce-motion preference is set",
        preview: "Preview: {v}",
        language: "Language",
      },
      sess: {
        filter_all: "All",
        filter_radio: "Radio",
        filter_dispatch: "Dispatch",
        filter_other: "Other",
        kind: {
          classify: "Radio classify",
          capture: "Quick capture",
          dispatch_headless: "Headless dispatch",
          dispatch_interactive: "Interactive dispatch",
          pk: "Agent logged",
          legacy: "Legacy",
        },
        open: "Replay",
        openTmux: "Reconnect this tmux dispatch session",
        reload: "Reload",
        loading: "Loading\u2026",
        empty: "No sessions yet",
        dirUnset: "(directory not recorded)",
        prev: "Prev",
        next: "Next",
        pageOf: "Page {cur} of {max}",
      },
      ai: {
        title: "\u{1F916} AI Agent CLI",
        hint: "Classify and dedupe radio messages with local AI agent CLIs; one or more can be configured.",
        sshOn: "Run over SSH",
        sshHostPh: "user{'@'}host",
        sshPort: "SSH port",
        sshKeyPh: "Private key path (optional, e.g. ~/.ssh/id_ed25519)",
        sshTunnel: "Reverse tunnel port",
        sshKeepAlive: "Persistent tunnel",
        sshKeepAliveDesc: "Keeps the tunnel up for remote pk calls; auto-reconnects when dropped",
        tunnelOff: "Not running",
        tunnelHealthy: "Connected",
        tunnelConnecting: "Establishing\u2026",
        tunnelRetrying: "Dropped, reconnecting",
        tunnelUnknown: "Fetching status\u2026",
        setupRemote: "Set up remote pk (one click)",
        settingUp: "Setting up remote pk\u2026 (~15s)",
        setupDone: "\u2705 Remote pk ready (pk {v}) \u2014 \u201CTest\u201D runs the probe",
        setupFailed: "Setup did not finish \u2014 see the failed step's hint",
        args: "Extra args",
        argsPh: "-p {'{prompt}'}",
        namePh: "Claude Code",
        cmdPh: "claude / opencode / pi / dsh",
        workdir: "Working directory",
        workdirPh: "empty = ~/.choose-you/workspace",
        historyArgs: "History args",
        skillDir: "Skill root dir",
        skillDirPh: "e.g. ~/.claude/skills; installs to <dir>/pokemon-choose-you, ~ prefix supported",
        timeout: "Timeout (s)",
        enabled: "Enabled",
        primary: "Use for radio classification",
        primaryNone: "None",
        terminal: "Terminal",
        terminalDesc: "Terminal app for interactive dispatch, session history and Feishu authorization",
        termBuiltin: "System built-in",
        save: "Save",
        test: "Test",
        history: "History \u2197",
        openingHistory: "Opening terminal\u2026",
        remove: "Remove",
        add: "\uFF0B Add Agent",
        local: "Local",
        skill: "pk skill",
        skillCheck: "Check",
        skillInstall: "Install/Sync",
        skillInstalling: "Syncing skill\u2026",
        skillUnknown: "Not checked",
        skillNotInstalled: "Not installed",
        skillUpToDate: "Installed v{v} (latest)",
        skillOutdated: "Installed v{v}, bundled v{b}, upgradable",
        skillInstalled: "\u2705 Skill installed v{v} ({where})",
        skillUpdated: "\u2705 Skill upgraded v{prev} \u2192 v{v} ({where})",
        cliHint:
          "The app ships a pk CLI (pk task list \u2026) for AI agents and terminals to read and write tasks directly. See the user guide.",
      },
      // ---- AI prompts card (editable-prompts): full copy table = uiux-design.md §8 ----
      prompts: {
        title: "AI Prompts",
        sub: "View and customize the system prompts behind each AI feature. Saved prompts take effect on the next AI call.",
        foot: "Built-in defaults evolve with app updates; restore anytime. Custom text never appears in diagnostics export or logs.",
        feature: {
          im_classify: "IM Classifier",
          capture: "Quick Capture",
          pet_chat: "Pet Chat",
          tag_health: "Tag Triage",
          dispatch: "Todo Dispatch",
        },
        badgeDefault: "Default",
        badgeCustom: "Custom",
        badgeWarn: "\u26A0 Inactive",
        badgeReadonly: "Read-only",
        badgeUnsaved: "Unsaved",
        tagDefault: "In effect",
        tagCustom: "In effect \xB7 Custom",
        loading: "Loading\u2026",
        loadFailed: "Failed to load prompts: {err}",
        retry: "Retry",
        edit: "Edit",
        cancel: "Cancel",
        save: "Save",
        saving: "Saving\u2026",
        restore: "Restore Default\u2026",
        confirmText: "This clears your custom text and restores the built-in default.",
        confirmOk: "Confirm",
        confirmAria: "Restore default confirmation",
        compare: "Compare Default \u25BE",
        compareTitle: "Built-in Default (current version)",
        editorWarn:
          "\u26A0 This prompt embeds decision protocols and output gates. Removing them may break judgments \u2014 if behavior goes wrong, restore the default first.",
        phLabel: "Required placeholders",
        phDesc: "Click to insert at cursor; saving is blocked while any is missing",
        readonlyNote: "This prompt carries the untrusted-content isolation structure and is read-only by design.",
        warnLine:
          "\u26A0 Your custom prompt is missing placeholders required by this version ({names}); the built-in default is in effect. Edit and add them to re-enable it.",
        warnOverlong:
          "\u26A0 Your custom prompt is over the length limit ({n} / 20000 chars); the built-in default is in effect. Edit and trim it to re-enable it.",
        vMissing: "Missing required placeholders: {names} \u2014 click a placeholder chip to insert it, then save.",
        vOverlong: "Over the length limit ({n} / 20000 chars). Trim before saving.",
        vUnknown: "Unknown placeholders: {names} \u2014 they will be sent to the AI verbatim.",
        vBlank: "Empty content: saving restores the built-in default.",
        vSameDefault: "Identical to the built-in default: saving counts as not customized.",
        savedHint: "\u2705 Saved. Takes effect on the next {feature} call.",
        restoredHint: "\u2705 Restored to default.",
        saveFailed: "\u274C Save failed: {err}",
        copyAll: "Copy all",
        copied: "Copied",
        editorAria: "Edit {feature} prompt",
      },
      feishu: {
        enable: "Enable background polling",
        interval: "Poll interval",
        hint: `Install lark-cli first (npm install -g {'@'}larksuite/cli), then click "Authorize" to finish its setup and login in a terminal; credentials stay with lark-cli, never enter this app's database. Classification is pseudonymized: real names are never sent to the AI \u2014 everyone appears as a codename.`,
        auth: "Authorize login",
        reauth: "Re-authorize",
        authing: "Launching lark-cli login in a terminal\u2026",
        authorized: "Authorized: {name}",
        unauthorized: "Not authorized (user identity is required to read your direct/group chats)",
        test: "Test Feishu connection",
        pollNow: "Poll now",
        pollResult: "{n} new suggestions this round",
        myNames: "My nicknames",
        myNamesDesc: 'Messages mentioning these names get flagged as "possibly assigned to you"',
        myNamesPh: "e.g. Boss Qiao, Lao Qiao",
        filter: {
          title: "Chat filters",
          hint: "Choose which Feishu chats get pulled. Follow mute is the default; manual choices override it. Direct chats are not listed here and always follow mute.",
          summary: "{total} chats: {pulling} pulling \xB7 {filtered} filtered \xB7 {manual} manual",
          staleOk: "Based on the last pull ({time})",
          staleWarn:
            "\u26A0 Last pull was {min} min ago; status may be outdated. Check Diagnostics \xB7 Integration health.",
          searchPh: "Search chats",
          searchLabel: "Search chats by name",
          chipsLabel: "Filter by effective status",
          prefChipsLabel: "Filter by preference",
          prefGroupLabel: "{name}: chat filter preference",
          fAll: "All {n}",
          fPull: "Pulling {n}",
          fFiltered: "Filtered {n}",
          pAll: "Any preference {n}",
          fFollow: "Follow {n}",
          fManual: "Manual {n}",
          typeChipsLabel: "Filter by chat type",
          matchCount: "Matching chats: {n} / {total}",
          tAll: "All types {n}",
          tGroup: "Group {n}",
          tBot: "Bot {n}",
          prefFollow: "Follow",
          prefFollowTitle: "Follow Feishu mute (default)",
          prefPull: "Pull",
          prefPullTitle: "Always pull, regardless of Feishu mute",
          prefFilter: "Filter",
          prefFilterTitle: "Always filter: skip the whole chat",
          effPull: "\u{1F4E1} Pull",
          effFilter: "\u{1F507} Filter",
          srcManual: "manual",
          srcFollow: "follow",
          srcDegraded: "degraded",
          srcDegradedTitle: "Mute lookup failed this round; degraded to not filtered",
          emptyDisabled: "Enable Feishu background polling to list your chats here.",
          emptyNoSnap: "No pull snapshot yet. Wait for the next poll, or pull now.",
          emptySnapEmpty: "The last pull found no chats.",
          emptySearch: 'No chats match "{q}"',
          emptyFiltered: "No chats under the current filters",
          loading: "Loading chat snapshot\u2026",
          loadFail: "Failed to load chats: {err}",
          retry: "Retry",
          writeFail: "\u274C Change not applied, retry: {err}",
          footImmediate: "Changes here apply immediately (no Save needed) and take effect on the next pull.",
          footNoBackfill:
            "Unfiltering only receives new messages (no backfill); existing messages and todos are kept as-is.",
        },
      },
      diag: {
        healthTitle: "\u{1FA7A} Integration health",
        healthHint:
          "Runtime status of the Feishu / AI pipelines; failures back off and retry automatically, or trigger manually.",
        provider: { feishu: "Feishu radio", ai: "AI Agent" },
        status: {
          off: "Not configured",
          paused: "Paused",
          idle: "Waiting",
          ok: "OK",
          degraded: "Degraded (retrying)",
          down: "Down",
        },
        lastSuccess: "Last success {v}",
        never: "Not run yet",
        nextPoll: "Next poll {v}",
        pending: "{n} pending suggestions",
        primaryAgent: "Classify agent: {name}",
        pollNow: "Poll now",
        logTitle: "\u{1F4DC} Logs",
        logLevel: "Level",
        allLevels: "All",
        logSource: "Source filter",
        refresh: "Refresh",
        copyReport: "Copy support report",
        reportCopied: "\u2714 Support report copied (version + health snapshot + recent logs, redacted)",
        reportFailed: "\u274C Copy failed, please copy manually",
        logEmpty: "No logs yet. Full log files live under ~/.choose-you/logs/.",
      },
      general: {
        autostart: "Launch at login",
        autostartDesc: "The pet appears automatically",
        closeToTray: "Close window to tray",
        closeToTrayDesc: "App keeps running; quit from the tray menu",
        shortcuts:
          "Global shortcuts: Ctrl+Shift+K quick capture \xB7 Ctrl+Shift+D show/hide pet (\u2318\u21E7K / \u2318\u21E7D on macOS)",
      },
      overdue: {
        collapse: "Hide",
        leaked: "{n} slipped away yesterday (click to peek)",
        fresh: "Send all to grass",
        freshing: "Moving\u2026",
        modeCollapse: "Collapse to one line",
        modeAuto: "Auto-send to grass (clears overdue times daily)",
        modeShow: "Show as-is",
      },
      rel: {
        overdueMin: "{n} min overdue",
        overdueHour: "{n}h overdue",
        overdueDay: "{n}d overdue",
        inMin: "in {n} min",
        inHour: "in {n}h",
        tomorrowAt: "tomorrow {v}",
        dayAfterAt: "day after {v}",
        inDay: "in {n}d",
        sun: "Sun",
        mon: "Mon",
        tue: "Tue",
        wed: "Wed",
        thu: "Thu",
        fri: "Fri",
        sat: "Sat",
      },
      review: {
        title: "Trainer review",
        entry: "Review",
        stepOverview: "Overview",
        stepRoute: "Route review",
        stepGrass: "Grass cleanup",
        stepTags: "Tag checkup",
        tagChecking: "\u{1FA7A} Checking tags\u2026 (AI is reviewing the vocabulary)",
        tagCheckFailed: "Checkup failed \u2014 retry or skip this step",
        tagRetry: "Retry",
        tagMerges: "Similar-tag merges",
        tagMerge: "Merge",
        tagIgnore: "Ignore",
        tagZombies: "Zombie tags (unused 90 days, not hand-made)",
        tagRelease: "Release",
        tagKeep: "Keep",
        tagNewDims: "New dimension ideas (orthogonal facets AI noticed)",
        tagAdopt: "Adopt",
        tagClean: "\u{1F3F7} Vocabulary is healthy, nothing to groom",
        tagUnjudged:
          "No AI configured (or judge failed): these are local similarity candidates \u2014 verify before merging.",
        tagTip: "AI-reviewed; merge/release/adopt apply immediately, ignore skips for this review.",
        stepDone: "Wrap up",
        caughtWeek: "Caught this week",
        focusWeek: "Focus min this week",
        onRoute: "On route",
        inGrass: "In grass",
        overviewTip: "Next, walk the route stop by stop, then tidy the grass in one batch \u2014 a few minutes a week.",
        keep: "Keep",
        complete: "Done",
        toGrass: "To grass",
        escape: "Release",
        routeTip: "Deal with each on the spot: check off done ones, release dead ones, shelve unsure ones to grass.",
        routeEmpty: "Route is empty \u2014 nothing to review.",
        overdue: "kept waiting",
        skipRoute: "Skip route",
        next: "Next",
        selectAllGrass: "Select all",
        releaseGrass: "Release",
        grassEmpty: "Grass is clean, nothing to tidy.",
        released: "Released {n}",
        finishLine: "{n} Pokemon caught this week!",
        finishTip: "Review recorded; you'll be reminded again next week.",
        finish: "Finish",
      },
      reviewDow: { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" },
      reviewCfg: {
        title: "\u{1F9E2} Weekly review reminder",
        enable: "Enable reminder",
        enableDesc: "System notification on the chosen weekday; the review lives on the Dex tab",
        dow: "Remind on",
      },
      backup: {
        title: "Backups",
        enable: "Daily auto backup",
        enableDesc: "Snapshots in ~/.choose-you/data/backups/, rolling retention",
        keep: "Keep",
        keepN: "{n} copies",
        now: "Back up now",
        working: "Backing up\u2026",
        done: "\u2714 Saved {v}",
        hint: "Restore overwrites all current data with the chosen snapshot; secrets live in the OS keychain and are unaffected.",
        restore: "Restore",
        confirmRestore: "Overwrite & restore?",
        restoring: "Restoring\u2026",
        restored: "\u2714 Restored from backup, data refreshed",
        empty: 'No backups yet \u2014 click "Back up now" to create the first one',
      },
      export: {
        title: "Export / Import",
        json: "Full JSON",
        csv: "Tasks CSV",
        md: "Today's report",
        openDir: "Open exports folder",
        hint: "Exports land in ~/.choose-you/data/exports/; the JSON can be imported on another machine (full replace), and the Markdown report drops straight into a knowledge base.",
        pick: "Choose a JSON file\u2026",
        chosen: "Chose {v}",
        saveJson: "Save full JSON as\u2026",
        saveCsv: "Save tasks CSV as\u2026",
        saveMd: "Save today's report as\u2026",
        savedTo: "\u2714 Exported to {v}",
        notJson: "Please pick a .json export file",
        doImport: "Import",
        confirmImport: "Overwrite & import?",
        importing: "Importing\u2026",
        imported: "\u2714 Imported {n} rows ({v}), data refreshed",
        done: "\u2714 Exported {v}",
      },
      update: {
        title: "Dex firmware",
        current: "Firmware version v{v}",
        check: "Check for updates",
        checking: "Checking\u2026",
        upToDate: "Firmware is up to date \u2714",
        found: "New firmware v{v} available",
        install: "Download & restart to install",
        installing: "Downloading\u2026 (app restarts when done)",
        progress: "Downloading {pct}%",
        linuxHint:
          "On Linux, auto-update only works with AppImage installs; deb / rpm users should download the new package.",
      },
      save: "Save settings",
      save2: "Save",
      cancel: "Cancel",
      saved: "Saved \u2714",
      testing: "Testing\u2026",
      catSaved: "Category updated \u2714",
      tagSaved: "Tag updated \u2714",
      promptSchedule: "Add to route: pick due/start time",
      entry: {
        due: "Due {v}",
        remind: "Remind {v}",
        focus: "\u2605 Focus {n} min",
        from: "From {src}",
        feishu: "Feishu",
        capture: "Quick capture",
        catching: "Catching",
        paused: "Paused",
        caught: "\u2714 Caught",
        undo: "\u21A9 Undo",
        start: "\u25B6 Set out",
        pause: "\u23F8 Pause",
        route: "Add to route",
        edit: "Edit",
        done: "Done",
        escape: "Escape (cancel)",
        escaped: "Escaped",
        release: "Release (delete)",
        empty: "The grass is empty\u2014tune in to the Radio for waves, or toss in a Pok\xE9 Ball yourself!",
        emptyToday: "No adventures today\u2014pick a target from Grass or Route and set out!",
        emptyRoute: "Your route is empty\u2014set a due time to plan the next stop!",
      },
      pet: {
        welcome: "Which Pok\xE9mon will you catch today? Hover to open the Quick Dex!",
        menuDex: "Open Pok\xE9dex",
        menuQuick: "Quick Dex screen",
        menuPause: "Pause current task",
        menuHide: "Hide pet",
        menuSwitch: "Switch target\u2026",
        menuResume: "Resume",
        menuDone: "Complete",
        // ---- Pet emotional interactions (PET_INTERACTION_DESIGN): scenes / physics / sleep / greetings ----
        petted: "\u266A {p} squints happily~",
        beingCarried: "(Picked up! Nervous little steps)",
        dropped: "Thump! Landed safe~",
        throwing: "{p} winds up the throw\u2026",
        catchOk: '\u2714 Caught! "{t}" is logged in the dex',
        milestone: "\u2605 {n} total catches! {p} proposes a dex party",
        allDone: "\u{1F389} Today's dex is complete! {p} says: wrap up and rest!",
        wakeUp: "Whoa\u2014{p} rubs its eyes: you're back!",
        asleepHint: "(Fast asleep\u2014wiggle the mouse or give it a poke)",
        greetMorning: "Morning! {p} is fresh and ready to head out",
        greetDay: "Good afternoon! {p} waits by the tall grass",
        greetEvening: "Good evening! A bit of adventure left\u2014{p} is with you",
        greetNight: "It's late\u2014{p} says: focus, but sleep too",
        idle: "Today's adventure hasn't started\u2014hover to open the Quick Dex and pick a target",
        /** Idle bubble when a main Pokemon is set (speaks its name) */
        idleNamed: "{p} is waiting for you! Hover to open the Quick Dex and pick a target",
        working: "{p} is catching: {t}",
        paused: "{p} paused\u2014take a breather~",
        remindUrgent: "\u203C {p} is stomping anxiously: '{t}' is urgent!",
        reminderDo: "Done",
        reminderSnooze: "Snooze 10 min",
        reminderDone: '\u2714 Caught "{t}"! {p} logged it in the Dex',
        reminderSnoozed: "Okay \u2014 I'll knock again in 10 minutes",
        remindNormal: "\u{1F43E} {p} tugs at your sleeve: don't forget '{t}'",
        pomoDone: "\u{1F345} Pomodoro done! {p} asks: caught '{t}' yet?",
        trialStart: "Just 5 minutes \u2014 bailing out is totally fine!",
        trialDone:
          "\u{1F366} 5 minutes logged! Continue with \u25B6 if it feels right, or stop for today \u2014 both win",
        pomoNotifTitle: "\u{1F345} Pomodoro done!",
        pomoNotifBody: "How far did '{t}' get? {p} is resting with you~",
        breakStart: "\u2615 Take a break, the Pokemon keeps time~",
        breakEnd: "Break over! Press \u25B6 for another round~",
        quickPick: "Pick your next target!",
        quickEmpty: "Nothing here yet\u2014encounter a wild Pokemon in the Pokedex",
        quickStart: "\u25B6 Set out",
        quickPause: "\u23F8 Pause",
        quickClose: "\u2715 Close",
        bubbleClose: "Click to dismiss",
        switchTitle: "Switch target\u2026",
        switchCancel: "Cancel",
        gotcha: "I choose you! {t}",
        // ---- Pet experience upgrade (PET_EXPERIENCE_PROPOSAL): perch / time lines / streak / chat / companion ----
        perched: "Found a comfy spot\u2014time to sit~",
        hourLine: "\u{1F43E} On the hour: let's keep it up this hour too",
        nightLine: "Adventuring this late\u2026 wrapping up is a strong move too",
        fridayLine: "\u{1F43E} The Pokemon along your route say: happy weekend!",
        birthdayLine: "Today marks day {n} of your Pokemon traveling with you!",
        streakN: "\u{1F43E} {n}-day streak! You've trampled every patch of grass this week!",
        mateHint: "A visiting companion (tap to wave goodbye)",
        menuChat: "\u{1F4AC} Chat with your Pokemon",
        chatGreet: "\u{1F43E} I'm here! Ask me about tasks or the Pokedex (Esc to close)",
        chatPh: "Ask about tasks / Pokedex\u2026",
        chatSend: "Send",
        chatClose: "Close chat",
        chatFail: "(tilts head) That one got stuck\u2014try asking again in a moment",
        chatQ1: "What's left today?",
        chatQ2: "How many caught this week?",
        quotes: [
          "Pika pika! Stay focused!",
          "I choose you!",
          "Pikachu is waiting for you to nail it~",
          "Slacking feels good, catching feels better!",
          "Go go go! Almost there!",
          "Pika~ pika~",
          "You're a great trainer today too!",
          "Sounds like new waves on the radio~",
          "Just 5 minutes\u2014it might just click!",
          "One in the grass is waiting for you.",
          "Caught it? Log it\u2014the Dex loves new entries.",
          "Hoo-hah! Go, trainer, go!",
        ],
        quotesNight: [
          "Adventuring this late? I'm with you\u2014but rest soon~",
          "The grass is quiet at night; set out tomorrow morning.",
          "Even trainers need sleep\u2014Snorlax went first.",
        ],
      },
    };

    // src/client/i18n/dsh-zh-Hans-deploy.ts
    var dsh_zh_Hans_deploy_default = {
      deploy: {
        title: "\u8FDC\u7A0B\u90E8\u7F72",
        counts: "\u5C31\u7EEA {ready} \xB7 \u672A\u5C31\u7EEA {pending} \xB7 \u65AD\u5F00 {broken}",
        empty:
          "\u8FD8\u6CA1\u6709\u8FDC\u7A0B\u90E8\u7F72\u3002\u6DFB\u52A0\u4E00\u53F0\u8FDC\u7AEF\u673A\u5668\uFF0C\u628A agent \u6D3E\u53BB\u8FDC\u65B9",
        add: "\uFF0B \u6DFB\u52A0\u90E8\u7F72",
        edit: "\u7F16\u8F91",
        remove: "\u79FB\u9664",
        provision: "\u5F00\u901A",
        reconnect: "\u91CD\u8FDE\u5E76\u68C0\u67E5",
        wizardRunning: "\u5411\u5BFC\u6267\u884C\u4E2D",
        directTag: "\u76F4\u8FDE\u6A21\u5F0F\uFF08\u672A\u7ECF\u6458\u8981\u6821\u9A8C\uFF09",
        lastError: "\u6700\u8FD1\u9519\u8BEF\uFF1A{summary}",
        editFallback:
          "\u5DF2\u4FDD\u5B58\u3002\u90E8\u7F72\u5DF2\u56DE\u843D\u4E3A\u672A\u5C31\u7EEA\u2014\u2014\u8DEF\u5F84\u53D8\u66F4\u540E\u8BF7\u91CD\u8DD1\u5F00\u901A\u5411\u5BFC\u590D\u6838",
        sshMissing:
          "\u8FDC\u7A0B\u6D3E\u53D1\u9700\u8981 dsh-ssh \u5BB6\u65CF\uFF0C\u5F53\u524D\u672A\u88C5\u8F7D\uFF08\u88C5\u8F7D\u6307\u5F15\uFF1A{cmd}\uFF09",
        copyGuide: "\u590D\u5236\u88C5\u8F7D\u6307\u5F15",
        status: {
          ready: "\u5C31\u7EEA",
          readyDirect: "\u5C31\u7EEA\uFF08\u76F4\u8FDE\uFF09",
          notReady: "\u672A\u5C31\u7EEA",
          disconnected: "\u65AD\u5F00",
        },
        form: {
          addTitle: "\u6DFB\u52A0\u90E8\u7F72",
          editTitle: "\u7F16\u8F91\u90E8\u7F72",
          alias:
            "OpenSSH \u522B\u540D\uFF08\u51ED\u636E\u7531\u522B\u540D\u627F\u8F7D\uFF0C\u63D2\u4EF6\u4E0D\u5B58\u79C1\u94A5\uFF09",
          nodePath: "\u8FDC\u7AEF Node \u8DEF\u5F84",
          workdir: "\u9ED8\u8BA4\u8FDC\u7AEF\u5DE5\u4F5C\u76EE\u5F55",
          note: "\u5907\u6CE8",
          aliasRequired: "\u522B\u540D\u4E0D\u80FD\u4E3A\u7A7A",
          pathRequired: "Node \u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A",
        },
        removeTitle: "\u79FB\u9664\u90E8\u7F72",
        removeBody:
          "\u79FB\u9664\u300C{alias}\u300D\u5C06\u5173\u95ED\u8FDE\u63A5\uFF0C\u5E76\u5C3D\u529B\u89E6\u53D1\u8FDC\u7AEF helper \u81EA\u6E05\u7406\uFF08\u6E05\u7406\u5931\u8D25\u4E0D\u963B\u585E\uFF0C\u4EC5\u8BB0\u5F55\u5230\u8BCA\u65AD\u6BB5\uFF09\u3002\u672C\u673A\u8BB0\u5F55\u968F\u4E4B\u5220\u9664\u3002",
        removeConfirm: "\u786E\u8BA4\u79FB\u9664",
        wizard: {
          title: "\u5F00\u901A\u5411\u5BFC",
          concurrent:
            "\u5411\u5BFC\u6B63\u5728\u6267\u884C\u4E2D\u2014\u2014\u7B49\u5F85\u5B8C\u6210\u3001\u91CD\u5F00\u7EED\u770B\uFF0C\u6216\u5148\u4E2D\u6B62",
          step: {
            "probe-ssh": "\u514D\u5BC6\u8FDE\u63A5\u63A2\u6D4B",
            "probe-node": "\u8FDC\u7AEF Node \u63A2\u6D4B",
            upload: "helper \u4E0A\u4F20\u5B89\u88C5",
            verify: "\u6458\u8981\u6821\u9A8C",
          },
          state: {
            pending: "\u7B49\u5F85",
            probing: "\u63A2\u6D4B\u4E2D\u2026",
            installing: "\u5B89\u88C5\u4E2D\u2026",
            verifying: "\u6821\u9A8C\u4E2D\u2026",
            done: "\u5B8C\u6210",
            failed: "\u5931\u8D25",
            skipped: "\u8DF3\u8FC7\uFF08\u5DF2\u5B8C\u6210\uFF09",
          },
          fail: {
            "probe-ssh":
              "\u514D\u5BC6\u8FDE\u63A5\u672A\u901A\u8FC7\u3002\u5148\u5728\u672C\u673A\u8DD1 ssh-copy-id\uFF08\u6216\u628A\u516C\u94A5\u52A0\u5165 ssh-agent\uFF09\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u91CD\u8BD5",
            "probe-node":
              "\u8FDC\u7AEF Node \u63A2\u6D4B\u5931\u8D25\u3002\u4FEE\u6B63\u8DEF\u5F84\u6216\u5B89\u88C5\u53EF\u7528 Node\uFF08\u226518\uFF09\u540E\u91CD\u8BD5",
            upload:
              "helper \u4E0A\u4F20\u5B89\u88C5\u5931\u8D25\u3002\u53EF\u91CD\u8BD5\uFF1B\u6216\u7ECF\u300C\u8DF3\u8FC7\u5B89\u88C5\uFF0C\u8F6C\u76F4\u8FDE\u300D\u663E\u5F0F\u964D\u7EA7\uFF08\u7559\u75D5\uFF09",
            verify:
              "\u8FDC\u7AEF helper \u6458\u8981\u4E0E\u9884\u671F\u4E0D\u7B26\u2014\u2014\u62D2\u7EDD\u7F6E\u4E3A\u5C31\u7EEA\u3002\u53EF\u91CD\u65B0\u5B89\u88C5\uFF0C\u6216\u7ECF\u4E0B\u65B9\u5165\u53E3\u663E\u5F0F\u8F6C\u76F4\u8FDE\uFF08\u7559\u75D5\uFF09",
          },
          retry: "\u91CD\u8BD5\u6B64\u6B65",
          abort: "\u4E2D\u6B62\uFF08\u90E8\u7F72\u505C\u5F53\u524D\u6001\uFF0C\u53EF\u5E42\u7B49\u7EED\u8DD1\uFF09",
          skipInstallEntry: "\u8DF3\u8FC7\u5B89\u88C5\uFF0C\u8F6C\u76F4\u8FDE\u2026",
          mismatchEntry: "\u8F6C\u76F4\u8FDE",
          logTitle: "\u5411\u5BFC\u8F93\u51FA",
          logEmpty: "\uFF08\u7B49\u5F85\u6267\u884C\u8F93\u51FA\u2026\uFF09",
          closeHint:
            "Esc/\u2715 \u5173\u95ED = \u540E\u53F0\u7EE7\u7EED\uFF08\u5361\u9762\u300C\u5411\u5BFC\u6267\u884C\u4E2D\u300D\u5FBD\u7AE0\u53CD\u6620\uFF09",
        },
        degrade: {
          title: "\u8F6C\u4E3A\u76F4\u8FDE\u786E\u8BA4",
          body: "\u8F6C\u4E3A\u76F4\u8FDE\u540E\uFF0C\u8BE5\u90E8\u7F72\u7684\u6D3E\u53D1\u4E0D\u518D\u7ECF\u8FC7 helper \u6458\u8981\u6821\u9A8C\uFF0C\u5B89\u5168\u6027\u4E0B\u964D\u3002\u6B64\u9009\u62E9\u4F1A\u7559\u75D5\u5230\u8BCA\u65AD\u6BB5\u3002",
          confirm: "\u786E\u8BA4\u8F6C\u76F4\u8FDE",
        },
      },
    };

    // src/client/i18n/dsh-zh-Hans.ts
    var dsh_zh_Hans_default = {
      page: {
        title: "\u56FE\u9274\u673A",
        pending: "\u5F85\u5904\u7406 {n}",
      },
      empty: {
        tasks:
          "\u8349\u4E1B\u9759\u6084\u6084\u2014\u2014\u5728\u4F1A\u8BDD\u91CC\u8BF4\u4E00\u53E5\u3001\u7528 \u26A1\u53D1\u62A5",
        radio:
          "\u7535\u6CE2\u5B89\u9759\u3002\u6709\u65B0\u6D88\u606F\u4F1A\u4EE5\u8BA1\u6570\u63D0\u9192\uFF0C\u4E0D\u4F1A\u6253\u6270\u4F60",
        dispatch: "\u8FD8\u6CA1\u6709\u6D3E\u51FA\u8FC7 agent",
      },
      auth: {
        unauthorized:
          "\u6536\u97F3\u673A\u8FD8\u6CA1\u8C03\u9891\u2014\u2014\u6388\u6743\u98DE\u4E66\u540E\u5F00\u59CB\u63A5\u6536\u7535\u6CE2",
        expired: "\u98DE\u4E66\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8F6E\u8BE2\u5DF2\u6682\u505C",
      },
      schema: {
        tooNew:
          "\u56FE\u9274\u673A\u9047\u5230\u4E86\u70B9\u72B6\u51B5\uFF1A\u5F85\u529E\u5E93\u7248\u672C\u8F83\u65B0\uFF0C\u9700\u5347\u7EA7\u63D2\u4EF6\u540E\u624D\u80FD\u5199\u5165\u3002\u6D4F\u89C8\u4E0D\u53D7\u5F71\u54CD\u3002",
        readonly: "\u53EA\u8BFB\u6A21\u5F0F",
      },
      toast: {
        alreadyHandled: "\u8FD9\u6761\u5EFA\u8BAE\u5DF2\u5728\u53E6\u4E00\u5904\u5904\u7F6E\u8FC7\u4E86",
        caught: "\u5DF2\u6355\u6349\u300C{title}\u300D",
        caughtMatch: "\u4EA7\u751F\u4E86\u66F4\u65B0\u5EFA\u8BAE\uFF0C\u5F85\u4F60\u786E\u8BA4",
        released: "\u5DF2\u653E\u751F\u300C{title}\u300D",
        undo: "\u64A4\u9500 {sec}s",
        dispatchBusy:
          "\u8BE5\u4EFB\u52A1\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u6D3E\u53D1\uFF0C\u8BF7\u5148\u6536\u53E3\u6216\u91CD\u7F6E",
        savedHint: "\u5DF2\u4FDD\u5B58",
      },
      release: {
        confirmBody:
          "\u653E\u751F\u540E\u300C{title}\u300D\u5C06\u8FDE\u540C\u6807\u7B7E\u5173\u8054\u4E0E\u8DDF\u8FDB\u8BB0\u5F55\u4E00\u5E76\u5220\u9664\uFF0C\u64CD\u4F5C\u8BB0\u5F55\u7559\u6863\u3002\u6267\u884C\u540E 5 \u79D2\u5185\u53EF\u64A4\u9500\u3002",
        confirmOk: "\u786E\u8BA4\u653E\u751F",
      },
      batch: {
        selected: "\u5DF2\u9009 {n} \u6761",
        catchAll: "\u25CE \u5168\u90E8\u6355\u6349",
        releaseAll: "\u2715 \u5168\u90E8\u9003\u8D70\uFF08\u7EDF\u4E00\u539F\u56E0\u7801\uFF09",
        clear: "\u6E05\u9664",
      },
      failed: {
        retryAll: "\u4E00\u952E\u91CD\u5224",
        forceCapture: "\u5F3A\u5236\u6355\u6349",
        forceDismiss: "\u5F3A\u5236\u9003\u8D70",
      },
      overdue: {
        leaked: "\u6628\u5929\u6709 {n} \u53EA\u6E9C\u8D70\u4E86",
        expand: "\u5C55\u5F00",
      },
      radio: {
        stateWarn: "\u91CD\u8BD5\u4E2D",
        stateFail: "\u672A\u6388\u6743",
        failCount: "\u8FDE\u7EED\u5931\u8D25 {n}",
        kbdHint:
          "\u5FEB\u6377\u952E\uFF1AJ/K \u4E0A\u4E0B\u6761 \xB7 C \u6355\u6349 \xB7 X \u9003\u8D70 \xB7 U \u5E94\u7528\u66F4\u65B0 \xB7 R \u6062\u590D\uFF08\u9003\u8D70\u7559\u6863\u9879\uFF09 \xB7 T \u63A5\u53D7\u65B0\u6807\u7B7E\u63D0\u8BAE \xB7 Esc \u6536\u8D77",
        acceptTag: "\uFF0B \u63A5\u53D7\u65B0\u6807\u7B7E\u63D0\u8BAE",
        judging: "\u5224\u5B9A\u4E2D\u2026",
      },
      dispatch: {
        tooltipQueued: "\u6392\u961F\u4E2D\uFF0C\u7B49\u5F85\u6267\u884C",
        tooltipRunning: "agent \u6267\u884C\u4E2D",
        tooltipDone: "\u5DF2\u56DE\u4F20\uFF0C\u67E5\u770B\u65F6\u95F4\u7EBF",
        tooltipFailed: "\u6267\u884C\u5931\u8D25\uFF1A{reason}",
        badge: {
          queued: "\u6392\u961F\u4E2D",
          running: "\u6D3E\u53D1\u6267\u884C\u4E2D",
          done: "\u5DF2\u56DE\u4F20",
          failed: "\u5931\u8D25",
        },
        confirm:
          "\u5373\u5C06\u6D3E\u53D1\uFF1A{agent} \xB7 {scope} \xB7 {dir} \xB7 \u6765\u6E90\uFF1A{project}\u3002\u53EF\u4E34\u65F6\u6539\u9009\uFF0C\u4E0D\u56DE\u5199\u9879\u76EE\u8DEF\u7531\u3002\u4EA4\u4E92\u901A\u9053\u5C06\u5728\u7EC8\u7AEF\u9762\u677F\u542F\u52A8\uFF0C\u53EF\u968F\u65F6\u89C2\u5BDF\u63A5\u7BA1\u3002",
        scopeLocal: "\u672C\u673A",
        scopeRemote: "\u8FDC\u7A0B",
        sourceRoute: "\u9879\u76EE\u8DEF\u7531",
        sourceDefault: "\u5168\u5C40\u9ED8\u8BA4",
        redo: "\u91CD\u6D3E",
        cancelQueued: "\u53D6\u6D88\u6392\u961F",
        worldDeployment: "\u90E8\u7F72 {alias}",
        worldLine:
          "\u5373\u5C06\u6D3E\u53D1\uFF1A{agent} \xB7 {world} \xB7 {dir}\u3002\u8FDC\u7AEF\u6267\u884C\u65F6\u6A21\u578B\u4E0E\u4F1A\u8BDD\u7559\u672C\u673A\u3002",
        degradeDirect: "\u76F4\u8FDE\u6A21\u5F0F\uFF1A\u672A\u7ECF helper \u6458\u8981\u6821\u9A8C",
        degradeInteractive:
          "\u4EA4\u4E92\u901A\u9053\u964D\u7EA7\uFF1A\u5C06\u590D\u5236\u5B8C\u6574\u547D\u4EE4\u884C\uFF0C\u8BF7\u81EA\u884C\u5728\u7EC8\u7AEF\u8FD0\u884C",
        degradeNonPosix: "\u76EE\u6807\u975E POSIX\uFF1A\u4EC5\u652F\u6301\u65E0\u5934\u76F4\u8FDE\u6D3E\u53D1",
        occupancy:
          "\u8FDC\u7AEF\u4ECD\u6709\u8BE5\u4EFB\u52A1\u7684\u6D3B\u52A8\u8FDB\u7A0B\uFF08\u4F1A\u8BDD {id}\uFF09\u2014\u2014\u7EE7\u7EED\u6D3E\u53D1\u5C06\u5171\u7528\u540C\u4E00 worktree \u5E76\u884C\u8FD0\u884C\uFF0C\u5EFA\u8BAE\u5148\u6536\u53E3",
      },
      agents: {
        commandRequired:
          "agent \u547D\u4EE4\u4E0D\u80FD\u4E3A\u7A7A\uFF08\u586B\u53EF\u6267\u884C\u6587\u4EF6\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09",
        argsPh: "-p {prompt}",
        sshHostPh: "user@host",
        presetLabel: "Agent \u9884\u8BBE",
        presetCustom: "\u81EA\u5B9A\u4E49",
      },
      pet: {
        showNotReady:
          "\u684C\u5BA0\u672A\u5728 5 \u79D2\u5185\u5B8C\u6210\u542F\u52A8\u63E1\u624B\uFF0C\u53EF\u80FD\u4ECD\u5728\u542F\u52A8\u4E2D",
        clearMain: "\u6E05\u9664",
        showRow: "\u663E\u793A\u684C\u5BA0",
        show: "\u663E\u793A",
        hide: "\u9690\u85CF",
        stateLabel: "\u5F53\u524D\u72B6\u6001\uFF1A",
        stateShown: "\u663E\u793A\u4E2D",
        stateHidden: "\u5DF2\u9690\u85CF",
        stateUnknown: "\u672A\u77E5",
      },
      tag: {
        deleteConfirm:
          "\u5220\u9664\u6807\u7B7E\u300C{name}\u300D\uFF1F\u5176\u4E0E\u5F85\u529E\u7684\u5173\u8054\u5C06\u4E00\u5E76\u6E05\u7406\u3002",
      },
      task: {
        reschedule: "\u6539\u671F",
      },
      dt: {
        hour: "\u65F6",
        minute: "\u5206",
        period: "\u4E0A\u4E0B\u5348",
        prevMonth: "\u4E0A\u6708",
        nextMonth: "\u4E0B\u6708",
      },
      chip: {
        openPage: "\u6253\u5F00\u56FE\u9274\u673A\u9875\u9762",
        resting: "\u4F11\u606F\u4E2D",
      },
      settings: {
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        saved: "\u5DF2\u4FDD\u5B58",
        saveFailed:
          "\u4FDD\u5B58\u5931\u8D25\uFF1A{reason}\u2014\u2014\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8BD5",
        unsavedTitle: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
        leaveTitle: "\u80CC\u5305\u8FD8\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002",
        leaveSave: "\u4FDD\u5B58\u5E76\u79BB\u5F00",
        leaveDiscard: "\u653E\u5F03\u4FEE\u6539",
        leaveStay: "\u7559\u5728\u8FD9\u91CC",
        judgeSource:
          "\u5F53\u524D\uFF1A\u6D88\u8D39\u4E3B\u5E94\u7528\u7ED3\u679C\uFF08dsh \u4FA7\u4E0D\u81EA\u884C\u5224\u5B9A\uFF09",
        dbStatusTitle: "\u5F85\u529E\u5E93\u72B6\u6001",
        dbStatusQuery: "\u67E5\u8BE2\u5E93\u72B6\u6001",
        dbUserVersion: "\u5E93\u7248\u672C v{v} \xB7 {mode}",
        dbModeRw: "\u8BFB\u5199\u6B63\u5E38",
        dbModeRo: "\u53EA\u8BFB\uFF08\u9700\u5347\u7EA7\u63D2\u4EF6\uFF09",
        guideTitle: "\u4F7F\u7528\u6307\u5357",
        guideLink: "docs/USER_GUIDE.md \xB7 dsh \u5F62\u6001\u7AE0\u8282 \u2197",
        dualFormTitle: "\u53CC\u5F62\u6001\u5C0F\u8D34\u58EB",
        dualFormTip:
          "dsh \u4E0E\u4E3B\u5E94\u7528\u5171\u7528\u540C\u4E00\u4EFD\u5F85\u529E\u6570\u636E\u4E0E\u8BBE\u7F6E\u2014\u2014\u540C\u4E00\u5230\u671F\u4EFB\u52A1\u5168\u7CFB\u7EDF\u53EA\u53D1\u4E00\u6761\u901A\u77E5\uFF08\u53CC\u5F62\u6001\u81EA\u52A8\u8BA9\u4F4D\uFF09\uFF1B\u90D1\u91CD\u65F6\u523B\u7684\u6F14\u51FA\u4E0E\u8BED\u97F3\u53EA\u5728\u5B8C\u6210\u52A8\u4F5C\u7684\u90A3\u4E00\u4FA7\u53D1\u751F\uFF1B\u63D0\u793A\u8BCD\u4E24\u5904\u53EF\u7F16\u8F91\uFF0C\u540C\u65F6\u6539\u52A8\u4F1A\u63D0\u793A\u5E76\u5237\u65B0\u5230\u6700\u65B0\u3002",
      },
      badge: {
        mainApp: "\u4F5C\u7528\u4E8E\u4E3B\u5E94\u7528",
        notifications: "\u4F5C\u7528\u4E8E\u4E3B\u5E94\u7528\u89E6\u8FBE",
        pet: "\u4F5C\u7528\u4E8E\u4E3B\u5E94\u7528\u684C\u5BA0",
        dispatch: "\u4F5C\u7528\u4E8E\u4E3B\u5E94\u7528\u4EA4\u4E92\u6D3E\u53D1",
      },
      pokeSearch: {
        placeholder:
          "\u641C\u7D22\u5B9D\u53EF\u68A6\uFF081025 \u53EA \xB7 \u540D\u79F0 / \u7F16\u53F7 / \u82F1\u6587\u540D\uFF09",
        searching: "\u641C\u7D22\u4E2D\u2026",
        noResult:
          "\u6CA1\u6709\u627E\u5230\u8FD9\u53EA\u5B9D\u53EF\u68A6\uFF0C\u6362\u4E2A\u7F16\u53F7\u6216\u540D\u5B57\u8BD5\u8BD5",
        bundled: "\u5185\u7F6E",
      },
      category: {
        releaseConfirm:
          "\u653E\u751F\u5206\u7C7B\u300C{name}\u300D\u540E\uFF0C\u5176 {n} \u4E2A\u4EFB\u52A1\u5C06\u5F52\u5165\u7B2C\u4E00\u4E2A\u5206\u7C7B\u300C{first}\u300D\uFF0C\u6807\u7B7E\u7EF4\u5EA6\u4E0E\u6807\u7B7E\u4FDD\u7559\u3002",
      },
      filter: {
        p2pLocked: "\u79C1\u804A\u56FA\u5B9A\u8DDF\u968F\uFF0C\u4E0D\u53C2\u4E0E\u8FC7\u6EE4",
      },
      prompts: {
        conflictRefreshed:
          "\u63D0\u793A\u8BCD\u5DF2\u5728\u53E6\u4E00\u5F62\u6001\u66F4\u65B0\uFF0C\u5DF2\u4E3A\u4F60\u5237\u65B0\u4E3A\u6700\u65B0\u7248",
        forceOverwrite: "\u5DF2\u5728\u53E6\u4E00\u5904\u88AB\u4FEE\u6539\u2014\u2014\u786E\u8BA4\u8986\u76D6\uFF1F",
        forceOverwriteConfirm: "\u4ECD\u8981\u8986\u76D6",
      },
      common: {
        close: "\u5173\u95ED",
      },
      sess: {
        group: {
          all: "\u5168\u90E8",
          radio: "\u6536\u97F3\u673A",
          dispatch: "\u6D3E\u53D1",
          other: "\u5176\u4ED6",
        },
        worldLocal: "\u672C\u673A",
        worldDeployment: "\u90E8\u7F72 {alias}",
        counts: "\u5171 {n} \u6761 \xB7 \u7B2C {page}/{pages} \u9875",
        limitLabel: "\u6BCF\u9875\u6761\u6570",
        limitN: "{n} \u6761/\u9875",
        replay: "\u56DE\u653E",
        replayOpened: "\u5DF2\u5728\u7EC8\u7AEF\u9762\u677F\u6253\u5F00\u56DE\u653E\uFF08{world}\uFF09",
        replayGone:
          "\u8BE5\u4F1A\u8BDD\u7684\u8FDC\u7A0B\u90E8\u7F72\u5DF2\u88AB\u79FB\u9664\uFF0C\u65E0\u6CD5\u56DE\u653E",
        emptyGroup: "\u8BE5\u5206\u7EC4\u6682\u65E0\u4F1A\u8BDD",
      },
      ...dsh_zh_Hans_deploy_default,
      import: {
        entry: "\u5BFC\u5165 JSON",
        title: "\u5BFC\u5165 JSON",
        pickLabel: "\u9009\u62E9\u6587\u4EF6",
        pickHint:
          "\u9009\u62E9\u4E00\u4E2A\u5BFC\u51FA\u7684 JSON \u6587\u4EF6\u2014\u2014\u5BFC\u5165\u524D\u4F1A\u5148\u6821\u9A8C\uFF0C\u5E76\u81EA\u52A8\u5907\u4EFD\u5F53\u524D\u6570\u636E\u3002",
        validating: "\u6821\u9A8C\u4E2D\u2026",
        invalid:
          "\u6587\u4EF6\u7ED3\u6784\u6821\u9A8C\u672A\u901A\u8FC7\uFF1A{reasons}\u3002\u5E93\u5185\u5BB9\u672A\u6539\u52A8\uFF080 \u884C\u53D8\u66F4\uFF09\u3002",
        pickAnother: "\u6362\u4E00\u4E2A\u6587\u4EF6",
        confirmBody:
          "\u5BFC\u5165\u5C06\u6574\u4F53\u66FF\u6362\u5F53\u524D\u5F85\u529E\u6570\u636E\uFF08\u79D8\u94A5\u4E0E\u63D0\u793A\u8BCD\u8986\u76D6\u884C\u4FDD\u7559\uFF09\u3002\u5DF2\u81EA\u52A8\u5907\u4EFD\uFF1A{file}\u3002\u6267\u884C\u540E\u4E0D\u53EF\u64A4\u9500\uFF0C\u8BF7\u786E\u8BA4\u3002",
        counts: "\u6587\u4EF6\u5185\u5BB9\uFF1A{n} \u9879\u5F85\u529E",
        confirmOk: "\u786E\u8BA4\u5BFC\u5165",
        running: "\u6267\u884C\u4E2D\u2026",
        done: "\u5DF2\u5BFC\u5165 {n} \u9879 \xB7 \u5DF2\u81EA\u52A8\u5907\u4EFD\uFF1A{file}",
        backupFailed:
          "\u5BFC\u5165\u524D\u81EA\u52A8\u5907\u4EFD\u5931\u8D25\uFF1A{reason}\u3002\u5DF2\u4E2D\u6B62\u5BFC\u5165\uFF0C\u5E93\u5185\u5BB9\u672A\u6539\u52A8\u3002",
      },
      export: {
        dirOpen: "\u6253\u5F00\u5BFC\u51FA\u76EE\u5F55",
        dirOpenFailed:
          "\u6253\u5F00\u5BFC\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A{reason}\uFF08\u76EE\u5F55\u5DF2\u5C1D\u8BD5\u521B\u5EFA\uFF0C\u53EF\u624B\u52A8\u524D\u5F80 {path}\uFF09",
      },
      restore: {
        entry: "\u6062\u590D",
        fromFile: "\u4ECE\u6587\u4EF6\u6062\u590D\u2026",
        title: "\u6062\u590D\u5907\u4EFD",
        confirmBody:
          "\u6062\u590D\u300C{file}\u300D\u5C06\u6574\u4F53\u66FF\u6362\u5F53\u524D\u5E93\uFF0C\u6062\u590D\u524D\u5DF2\u81EA\u52A8\u5907\u4EFD\u5F53\u524D\u6570\u636E\u3002\u6062\u590D\u540E\u81EA\u52A8\u8865\u8DD1\u8FC1\u79FB\u4E0E\u9ED8\u8BA4\u5206\u7C7B\u8865\u79CD\u3002",
        confirmOk: "\u786E\u8BA4\u6062\u590D",
        running: "\u6267\u884C\u4E2D\u2026",
        rejected:
          "\u8BE5\u5907\u4EFD\u7248\u672C\u8D85\u51FA\u672C\u63D2\u4EF6\u517C\u5BB9\u7A97\u53E3\uFF0C\u9700\u5347\u7EA7\u63D2\u4EF6\u540E\u6062\u590D\u3002\u5F53\u524D\u5E93\u672A\u6539\u52A8\u3002",
        done: "\u5DF2\u6062\u590D \xB7 \u5DF2\u81EA\u52A8\u5907\u4EFD\u5F53\u524D\u6570\u636E\u3002\u5DF2\u81EA\u52A8\u8865\u8DD1\u8FC1\u79FB\u4E0E\u9ED8\u8BA4\u5206\u7C7B\u8865\u79CD",
        failed:
          "\u6062\u590D\u5931\u8D25\uFF1A{reason}\u3002\u5F53\u524D\u5E93\u4FDD\u6301\u6062\u590D\u524D\u72B6\u6001",
      },
      ax: {
        guide:
          "\u8F93\u5165\u54CD\u5E94\u9700\u8981\u300C\u8F85\u52A9\u529F\u80FD\u300D\u6388\u6743\uFF0C\u4E14\u53EA\u7EDF\u8BA1\u6309\u952E\u9891\u7387\u2014\u2014\u4E0D\u8BB0\u5F55\u952E\u503C\u3001\u952E\u540D\u3001\u7A97\u53E3\u6216\u5E94\u7528\u3002",
        revoked:
          "\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u6388\u6743\u3002\u6388\u6743\u6062\u590D\u524D\u8F93\u5165\u54CD\u5E94\u4FDD\u6301\u505C\u6B62",
        pathHint:
          "\u82E5\u5217\u8868\u4E2D\u627E\u4E0D\u5230\uFF0C\u628A\u6B64\u8DEF\u5F84\u62D6\u5165\u6216\u590D\u5236\u540E \u2318\u21E7G \u5B9A\u4F4D\uFF1A{path}\uFF08\u70B9\u51FB\u590D\u5236\uFF09",
        authorize: "\u53BB\u6388\u6743",
        copyPath: "\u70B9\u51FB\u590D\u5236\u8DEF\u5F84",
      },
      helper: {
        banner:
          "\u7CFB\u7EDF\u80FD\u529B\u9762\u964D\u7EA7\uFF1A\u684C\u5BA0\u4E0E\u7CFB\u7EDF\u901A\u77E5\u6682\u4E0D\u53EF\u7528\uFF08helper \u672A\u8FD0\u884C\uFF09\u3002\u6838\u5FC3\u5F85\u529E\u4E0D\u53D7\u5F71\u54CD",
        viewDiag: "\u67E5\u770B\u8BCA\u65AD",
      },
      diag: {
        capsTitle: "\u7CFB\u7EDF\u80FD\u529B\u9762",
        caps: {
          tray: "\u6258\u76D8",
          shortcut: "\u5168\u5C40\u5FEB\u6377\u952E",
          notify: "\u901A\u77E5",
          dialog: "\u6587\u4EF6\u5BF9\u8BDD\u6846",
          tts: "\u8BED\u97F3",
          input: "\u8F93\u5165\u8BA1\u6570",
          ok: "\u53EF\u7528",
          degraded: "\u964D\u7EA7",
          guide: "\u4F9D\u8D56 helper sidecar\u2014\u2014\u6062\u590D helper \u540E\u81EA\u52A8\u6062\u590D",
          absent:
            "helper \u672A\u8FD0\u884C\u2014\u2014\u5168\u90E8\u80FD\u529B\u964D\u7EA7\uFF1B\u53EF\u4ECE\u63D2\u4EF6\u5B89\u88C5\u76EE\u5F55\u91CD\u65B0\u542F\u52A8 helper",
          version: "helper \u8FD0\u884C\u65F6\uFF1A{v}",
        },
        shortcutFailed:
          "\u5168\u5C40\u5FEB\u6377\u952E\u6CE8\u518C\u5931\u8D25\uFF08\u53EF\u80FD\u88AB\u5360\u7528\uFF09\u2014\u2014\u9762\u677F\u805A\u7126\u65F6 \u2318\u21E7K \u4ECD\u53EF\u5FEB\u6355",
        sshOk: "dsh-ssh \u5BB6\u65CF\uFF1A\u5C31\u7EEA",
        sshMissing:
          "dsh-ssh \u5BB6\u65CF\uFF1A\u672A\u88C5\u8F7D\u2014\u2014\u8FDC\u7A0B\u6D3E\u53D1\u9700\u8981\u5B83\uFF08\u88C5\u8F7D\u6307\u5F15\uFF1A{cmd}\uFF09",
      },
      lark: {
        login: "\u6388\u6743\u767B\u5F55\uFF08\u5728\u7EC8\u7AEF\u9762\u677F\u5B8C\u6210 lark-cli \u767B\u5F55\uFF09",
        launched:
          "\u5DF2\u5728\u7EC8\u7AEF\u9762\u677F\u542F\u52A8\u767B\u5F55\uFF0C\u8BF7\u5230\u7EC8\u7AEF\u5B8C\u6210\u6388\u6743",
        launchFailed: "\u767B\u5F55\u542F\u52A8\u5931\u8D25\uFF1A{reason}",
      },
    };

    // src/client/i18n/dsh-zh-Hant-deploy.ts
    var dsh_zh_Hant_deploy_default = {
      deploy: {
        title: "\u9060\u7AEF\u90E8\u7F72",
        counts: "\u5C31\u7DD2 {ready} \xB7 \u672A\u5C31\u7DD2 {pending} \xB7 \u65B7\u7DDA {broken}",
        empty:
          "\u9084\u6C92\u6709\u9060\u7AEF\u90E8\u7F72\u3002\u65B0\u589E\u4E00\u53F0\u9060\u7AEF\u6A5F\u5668\uFF0C\u628A agent \u6D3E\u53BB\u9060\u65B9",
        add: "\uFF0B \u65B0\u589E\u90E8\u7F72",
        edit: "\u7DE8\u8F2F",
        remove: "\u79FB\u9664",
        provision: "\u958B\u901A",
        reconnect: "\u91CD\u9023\u4E26\u6AA2\u67E5",
        wizardRunning: "\u5411\u5C0E\u57F7\u884C\u4E2D",
        directTag: "\u76F4\u9023\u6A21\u5F0F\uFF08\u672A\u7D93\u6458\u8981\u6821\u9A57\uFF09",
        lastError: "\u6700\u8FD1\u932F\u8AA4\uFF1A{summary}",
        editFallback:
          "\u5DF2\u5132\u5B58\u3002\u90E8\u7F72\u5DF2\u56DE\u843D\u70BA\u672A\u5C31\u7DD2\u2014\u2014\u8DEF\u5F91\u8B8A\u66F4\u5F8C\u8ACB\u91CD\u8DD1\u958B\u901A\u5411\u5C0E\u8907\u6838",
        sshMissing:
          "\u9060\u7AEF\u6D3E\u767C\u9700\u8981 dsh-ssh \u5BB6\u65CF\uFF0C\u7576\u524D\u672A\u88DD\u8F09\uFF08\u88DD\u8F09\u6307\u5F15\uFF1A{cmd}\uFF09",
        copyGuide: "\u8907\u88FD\u88DD\u8F09\u6307\u5F15",
        status: {
          ready: "\u5C31\u7DD2",
          readyDirect: "\u5C31\u7DD2\uFF08\u76F4\u9023\uFF09",
          notReady: "\u672A\u5C31\u7DD2",
          disconnected: "\u65B7\u7DDA",
        },
        form: {
          addTitle: "\u65B0\u589E\u90E8\u7F72",
          editTitle: "\u7DE8\u8F2F\u90E8\u7F72",
          alias:
            "OpenSSH \u5225\u540D\uFF08\u6191\u8B49\u7531\u5225\u540D\u627F\u8F09\uFF0C\u63D2\u4EF6\u4E0D\u5B58\u79C1\u9470\uFF09",
          nodePath: "\u9060\u7AEF Node \u8DEF\u5F91",
          workdir: "\u9810\u8A2D\u9060\u7AEF\u5DE5\u4F5C\u76EE\u9304",
          note: "\u5099\u8A3B",
          aliasRequired: "\u5225\u540D\u4E0D\u80FD\u70BA\u7A7A",
          pathRequired: "Node \u8DEF\u5F91\u4E0D\u80FD\u70BA\u7A7A",
        },
        removeTitle: "\u79FB\u9664\u90E8\u7F72",
        removeBody:
          "\u79FB\u9664\u300C{alias}\u300D\u5C07\u95DC\u9589\u9023\u7DDA\uFF0C\u4E26\u76E1\u529B\u89F8\u767C\u9060\u7AEF helper \u81EA\u6E05\u7406\uFF08\u6E05\u7406\u5931\u6557\u4E0D\u963B\u585E\uFF0C\u50C5\u8A18\u9304\u5230\u8A3A\u65B7\u6BB5\uFF09\u3002\u672C\u6A5F\u8A18\u9304\u96A8\u4E4B\u522A\u9664\u3002",
        removeConfirm: "\u78BA\u8A8D\u79FB\u9664",
        wizard: {
          title: "\u958B\u901A\u5411\u5C0E",
          concurrent:
            "\u5411\u5C0E\u6B63\u5728\u57F7\u884C\u4E2D\u2014\u2014\u7B49\u5F85\u5B8C\u6210\u3001\u91CD\u958B\u7E8C\u770B\uFF0C\u6216\u5148\u4E2D\u6B62",
          step: {
            "probe-ssh": "\u514D\u5BC6\u9023\u7DDA\u63A2\u6E2C",
            "probe-node": "\u9060\u7AEF Node \u63A2\u6E2C",
            upload: "helper \u4E0A\u50B3\u5B89\u88DD",
            verify: "\u6458\u8981\u6821\u9A57",
          },
          state: {
            pending: "\u7B49\u5F85",
            probing: "\u63A2\u6E2C\u4E2D\u2026",
            installing: "\u5B89\u88DD\u4E2D\u2026",
            verifying: "\u6821\u9A57\u4E2D\u2026",
            done: "\u5B8C\u6210",
            failed: "\u5931\u6557",
            skipped: "\u8DF3\u904E\uFF08\u5DF2\u5B8C\u6210\uFF09",
          },
          fail: {
            "probe-ssh":
              "\u514D\u5BC6\u9023\u7DDA\u672A\u901A\u904E\u3002\u5148\u5728\u672C\u6A5F\u8DD1 ssh-copy-id\uFF08\u6216\u628A\u516C\u9470\u52A0\u5165 ssh-agent\uFF09\uFF0C\u518D\u56DE\u5230\u9019\u88E1\u91CD\u8A66",
            "probe-node":
              "\u9060\u7AEF Node \u63A2\u6E2C\u5931\u6557\u3002\u4FEE\u6B63\u8DEF\u5F91\u6216\u5B89\u88DD\u53EF\u7528 Node\uFF08\u226518\uFF09\u5F8C\u91CD\u8A66",
            upload:
              "helper \u4E0A\u50B3\u5B89\u88DD\u5931\u6557\u3002\u53EF\u91CD\u8A66\uFF1B\u6216\u7D93\u300C\u8DF3\u904E\u5B89\u88DD\uFF0C\u8F49\u76F4\u9023\u300D\u986F\u5F0F\u964D\u7D1A\uFF08\u7559\u75D5\uFF09",
            verify:
              "\u9060\u7AEF helper \u6458\u8981\u8207\u9810\u671F\u4E0D\u7B26\u2014\u2014\u62D2\u7D55\u7F6E\u70BA\u5C31\u7DD2\u3002\u53EF\u91CD\u65B0\u5B89\u88DD\uFF0C\u6216\u7D93\u4E0B\u65B9\u5165\u53E3\u986F\u5F0F\u8F49\u76F4\u9023\uFF08\u7559\u75D5\uFF09",
          },
          retry: "\u91CD\u8A66\u6B64\u6B65",
          abort: "\u4E2D\u6B62\uFF08\u90E8\u7F72\u505C\u7576\u524D\u614B\uFF0C\u53EF\u51AA\u7B49\u7E8C\u8DD1\uFF09",
          skipInstallEntry: "\u8DF3\u904E\u5B89\u88DD\uFF0C\u8F49\u76F4\u9023\u2026",
          mismatchEntry: "\u8F49\u76F4\u9023",
          logTitle: "\u5411\u5C0E\u8F38\u51FA",
          logEmpty: "\uFF08\u7B49\u5F85\u57F7\u884C\u8F38\u51FA\u2026\uFF09",
          closeHint:
            "Esc/\u2715 \u95DC\u9589 = \u5F8C\u53F0\u7E7C\u7E8C\uFF08\u5361\u9762\u300C\u5411\u5C0E\u57F7\u884C\u4E2D\u300D\u5FBD\u7AE0\u53CD\u6620\uFF09",
        },
        degrade: {
          title: "\u8F49\u70BA\u76F4\u9023\u78BA\u8A8D",
          body: "\u8F49\u70BA\u76F4\u9023\u5F8C\uFF0C\u8A72\u90E8\u7F72\u7684\u6D3E\u767C\u4E0D\u518D\u7D93\u904E helper \u6458\u8981\u6821\u9A57\uFF0C\u5B89\u5168\u6027\u4E0B\u964D\u3002\u6B64\u9078\u64C7\u6703\u7559\u75D5\u5230\u8A3A\u65B7\u6BB5\u3002",
          confirm: "\u78BA\u8A8D\u8F49\u76F4\u9023",
        },
      },
    };

    // src/client/i18n/dsh-zh-Hant.ts
    var dsh_zh_Hant_default = {
      page: {
        title: "\u5716\u9451\u6A5F",
        pending: "\u5F85\u8655\u7406 {n}",
      },
      empty: {
        tasks:
          "\u8349\u53E2\u975C\u6084\u6084\u2014\u2014\u5728\u6703\u8A71\u88E1\u8AAA\u4E00\u53E5\u3001\u7528 \u26A1\u767C\u5831",
        radio:
          "\u96FB\u6CE2\u5B89\u975C\u3002\u6709\u65B0\u8A0A\u606F\u6703\u4EE5\u8A08\u6578\u63D0\u9192\uFF0C\u4E0D\u6703\u6253\u64FE\u4F60",
        dispatch: "\u9084\u6C92\u6709\u6D3E\u51FA\u904E agent",
      },
      auth: {
        unauthorized:
          "\u6536\u97F3\u6A5F\u9084\u6C92\u8ABF\u983B\u2014\u2014\u6388\u6B0A\u98DB\u66F8\u5F8C\u958B\u59CB\u63A5\u6536\u96FB\u6CE2",
        expired: "\u98DB\u66F8\u6388\u6B0A\u5DF2\u5931\u6548\uFF0C\u8F2A\u8A62\u5DF2\u66AB\u505C",
      },
      schema: {
        tooNew:
          "\u5716\u9451\u6A5F\u9047\u5230\u4E86\u9EDE\u72C0\u6CC1\uFF1A\u5F85\u8FA6\u5EAB\u7248\u672C\u8F03\u65B0\uFF0C\u9700\u5347\u7D1A\u63D2\u4EF6\u5F8C\u624D\u80FD\u5BEB\u5165\u3002\u700F\u89BD\u4E0D\u53D7\u5F71\u97FF\u3002",
        readonly: "\u552F\u8B80\u6A21\u5F0F",
      },
      toast: {
        alreadyHandled: "\u9019\u689D\u5EFA\u8B70\u5DF2\u5728\u53E6\u4E00\u8655\u8655\u7F6E\u904E\u4E86",
        caught: "\u5DF2\u6355\u6349\u300C{title}\u300D",
        caughtMatch: "\u7522\u751F\u4E86\u66F4\u65B0\u5EFA\u8B70\uFF0C\u5F85\u4F60\u78BA\u8A8D",
        released: "\u5DF2\u653E\u751F\u300C{title}\u300D",
        undo: "\u64A4\u92B7 {sec}s",
        dispatchBusy:
          "\u8A72\u4EFB\u52D9\u5DF2\u6709\u9032\u884C\u4E2D\u7684\u6D3E\u767C\uFF0C\u8ACB\u5148\u6536\u53E3\u6216\u91CD\u7F6E",
        savedHint: "\u5DF2\u4FDD\u5B58",
      },
      release: {
        confirmBody:
          "\u653E\u751F\u5F8C\u300C{title}\u300D\u5C07\u9023\u540C\u6A19\u7C64\u95DC\u806F\u8207\u8DDF\u9032\u8A18\u9304\u4E00\u4F75\u522A\u9664\uFF0C\u64CD\u4F5C\u8A18\u9304\u5B58\u6A94\u3002\u57F7\u884C\u5F8C 5 \u79D2\u5167\u53EF\u64A4\u92B7\u3002",
        confirmOk: "\u78BA\u8A8D\u653E\u751F",
      },
      batch: {
        selected: "\u5DF2\u9078 {n} \u689D",
        catchAll: "\u25CE \u5168\u90E8\u6355\u6349",
        releaseAll: "\u2715 \u5168\u90E8\u9003\u8D70\uFF08\u7D71\u4E00\u539F\u56E0\u78BC\uFF09",
        clear: "\u6E05\u9664",
      },
      failed: {
        retryAll: "\u4E00\u9375\u91CD\u5224",
        forceCapture: "\u5F37\u5236\u6355\u6349",
        forceDismiss: "\u5F37\u5236\u9003\u8D70",
      },
      overdue: {
        leaked: "\u6628\u5929\u6709 {n} \u96BB\u6E9C\u8D70\u4E86",
        expand: "\u5C55\u958B",
      },
      radio: {
        stateWarn: "\u91CD\u8A66\u4E2D",
        stateFail: "\u672A\u6388\u6B0A",
        failCount: "\u9023\u7E8C\u5931\u6557 {n}",
        kbdHint:
          "J/K \u4E0A\u4E0B\u689D \xB7 C \u6355\u6349 \xB7 X \u9003\u8D70 \xB7 U \u61C9\u7528\u66F4\u65B0 \xB7 R \u6062\u5FA9\uFF08\u9003\u8D70\u7559\u6A94\u9805\uFF09 \xB7 T \u63A5\u53D7\u65B0\u6A19\u7C64\u63D0\u8B70 \xB7 Esc \u6536\u8D77\uFF08\u50C5\u63D2\u4EF6\u9801\u9762\u805A\u7126\u57DF\u5167\u751F\u6548\uFF0C\u4E0D\u8A3B\u518A\u5168\u57DF\u5FEB\u6377\u9375\uFF09",
        acceptTag: "\uFF0B \u63A5\u53D7\u65B0\u6A19\u7C64\u63D0\u8B70",
        judging: "\u5224\u5B9A\u4E2D\u2026",
      },
      dispatch: {
        tooltipQueued: "\u6392\u968A\u4E2D\uFF0C\u7B49\u5F85\u57F7\u884C",
        tooltipRunning: "agent \u57F7\u884C\u4E2D",
        tooltipDone: "\u5DF2\u56DE\u50B3\uFF0C\u67E5\u770B\u6642\u9593\u7DDA",
        tooltipFailed: "\u57F7\u884C\u5931\u6557\uFF1A{reason}",
        badge: {
          queued: "\u6392\u968A\u4E2D",
          running: "\u6D3E\u767C\u57F7\u884C\u4E2D",
          done: "\u5DF2\u56DE\u50B3",
          failed: "\u5931\u6557",
        },
        confirm:
          "\u5373\u5C07\u6D3E\u767C\uFF1A{agent} \xB7 {scope} \xB7 {dir} \xB7 \u4F86\u6E90\uFF1A{project}\u3002\u53EF\u81E8\u6642\u6539\u9078\uFF0C\u4E0D\u56DE\u5BEB\u5C08\u6848\u8DEF\u7531\u3002\u4E92\u52D5\u901A\u9053\u5C07\u5728\u7D42\u7AEF\u6A5F\u9762\u677F\u555F\u52D5\uFF0C\u53EF\u96A8\u6642\u89C0\u5BDF\u63A5\u7BA1\u3002",
        scopeLocal: "\u672C\u6A5F",
        scopeRemote: "\u9060\u7AEF",
        sourceRoute: "\u5C08\u6848\u8DEF\u7531",
        sourceDefault: "\u5168\u57DF\u9810\u8A2D",
        redo: "\u91CD\u6D3E",
        cancelQueued: "\u53D6\u6D88\u6392\u968A",
        worldDeployment: "\u90E8\u7F72 {alias}",
        worldLine:
          "\u5373\u5C07\u6D3E\u767C\uFF1A{agent} \xB7 {world} \xB7 {dir}\u3002\u9060\u7AEF\u57F7\u884C\u6642\u6A21\u578B\u8207\u6703\u8A71\u7559\u672C\u6A5F\u3002",
        degradeDirect: "\u76F4\u9023\u6A21\u5F0F\uFF1A\u672A\u7D93 helper \u6458\u8981\u6821\u9A57",
        degradeInteractive:
          "\u4E92\u52D5\u901A\u9053\u964D\u7D1A\uFF1A\u5C07\u8907\u88FD\u5B8C\u6574\u547D\u4EE4\u5217\uFF0C\u8ACB\u81EA\u884C\u5728\u7D42\u7AEF\u57F7\u884C",
        degradeNonPosix: "\u76EE\u6A19\u975E POSIX\uFF1A\u50C5\u652F\u63F4\u7121\u982D\u76F4\u9023\u6D3E\u767C",
        occupancy:
          "\u9060\u7AEF\u4ECD\u6709\u8A72\u4EFB\u52D9\u7684\u6D3B\u52D5\u7A0B\u5E8F\uFF08\u6703\u8A71 {id}\uFF09\u2014\u2014\u7E7C\u7E8C\u6D3E\u767C\u5C07\u5171\u7528\u540C\u4E00 worktree \u4E26\u884C\u57F7\u884C\uFF0C\u5EFA\u8B70\u5148\u6536\u53E3",
      },
      agents: {
        commandRequired:
          "agent \u547D\u4EE4\u4E0D\u80FD\u70BA\u7A7A\uFF08\u586B\u53EF\u57F7\u884C\u6A94\u540D\u6216\u7D55\u5C0D\u8DEF\u5F91\uFF09",
        argsPh: "-p {prompt}",
        sshHostPh: "user@host",
        presetLabel: "Agent \u9810\u8A2D",
        presetCustom: "\u81EA\u8A02",
      },
      pet: {
        showNotReady:
          "\u684C\u5BF5\u672A\u5728 5 \u79D2\u5167\u5B8C\u6210\u555F\u52D5\u63E1\u624B\uFF0C\u53EF\u80FD\u4ECD\u5728\u555F\u52D5\u4E2D",
        clearMain: "\u6E05\u9664",
        showRow: "\u986F\u793A\u684C\u5BF5",
        show: "\u986F\u793A",
        hide: "\u96B1\u85CF",
        stateLabel: "\u76EE\u524D\u72C0\u614B\uFF1A",
        stateShown: "\u986F\u793A\u4E2D",
        stateHidden: "\u5DF2\u96B1\u85CF",
        stateUnknown: "\u672A\u77E5",
      },
      tag: {
        deleteConfirm:
          "\u522A\u9664\u6A19\u7C64\u300C{name}\u300D\uFF1F\u5176\u8207\u5F85\u8FA6\u7684\u95DC\u806F\u5C07\u4E00\u4F75\u6E05\u7406\u3002",
      },
      task: {
        reschedule: "\u6539\u671F",
      },
      dt: {
        hour: "\u6642",
        minute: "\u5206",
        period: "\u4E0A\u4E0B\u5348",
        prevMonth: "\u4E0A\u6708",
        nextMonth: "\u4E0B\u6708",
      },
      chip: {
        openPage: "\u958B\u555F\u5716\u9451\u6A5F\u9801\u9762",
        resting: "\u4F11\u606F\u4E2D",
      },
      settings: {
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        saved: "\u5DF2\u4FDD\u5B58",
        saveFailed:
          "\u4FDD\u5B58\u5931\u6557\uFF1A{reason}\u2014\u2014\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8A66",
        unsavedTitle: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
        leaveTitle: "\u80CC\u5305\u9084\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002",
        leaveSave: "\u4FDD\u5B58\u4E26\u96E2\u958B",
        leaveDiscard: "\u653E\u68C4\u4FEE\u6539",
        leaveStay: "\u7559\u5728\u9019\u88E1",
        judgeSource:
          "\u7576\u524D\uFF1A\u6D88\u8CBB\u4E3B\u61C9\u7528\u7D50\u679C\uFF08dsh \u5074\u4E0D\u81EA\u884C\u5224\u5B9A\uFF09",
        dbStatusTitle: "\u5F85\u8FA6\u5EAB\u72C0\u614B",
        dbStatusQuery: "\u67E5\u8A62\u5EAB\u72C0\u614B",
        dbUserVersion: "\u5EAB\u7248\u672C v{v} \xB7 {mode}",
        dbModeRw: "\u8B80\u5BEB\u6B63\u5E38",
        dbModeRo: "\u552F\u8B80\uFF08\u9700\u5347\u7D1A\u63D2\u4EF6\uFF09",
        guideTitle: "\u4F7F\u7528\u6307\u5357",
        guideLink: "docs/USER_GUIDE.md \xB7 dsh \u5F62\u614B\u7AE0\u7BC0 \u2197",
        dualFormTitle: "\u96D9\u5F62\u614B\u5C0F\u8CBC\u58EB",
        dualFormTip:
          "dsh \u8207\u4E3B\u61C9\u7528\u5171\u7528\u540C\u4E00\u4EFD\u5F85\u8FA6\u8CC7\u6599\u8207\u8A2D\u5B9A\u2014\u2014\u540C\u4E00\u5230\u671F\u4EFB\u52D9\u5168\u7CFB\u7D71\u53EA\u767C\u4E00\u689D\u901A\u77E5\uFF08\u96D9\u5F62\u614B\u81EA\u52D5\u8B93\u4F4D\uFF09\uFF1B\u912D\u91CD\u6642\u523B\u7684\u6F14\u51FA\u8207\u8A9E\u97F3\u53EA\u5728\u5B8C\u6210\u52D5\u4F5C\u7684\u90A3\u4E00\u5074\u767C\u751F\uFF1B\u63D0\u793A\u8A5E\u5169\u8655\u53EF\u7DE8\u8F2F\uFF0C\u540C\u6642\u6539\u52D5\u6703\u63D0\u793A\u4E26\u5237\u65B0\u5230\u6700\u65B0\u3002",
      },
      badge: {
        mainApp: "\u4F5C\u7528\u65BC\u4E3B\u61C9\u7528",
        notifications: "\u4F5C\u7528\u65BC\u4E3B\u61C9\u7528\u89F8\u9054",
        pet: "\u4F5C\u7528\u65BC\u4E3B\u61C9\u7528\u684C\u5BF5",
        dispatch: "\u4F5C\u7528\u65BC\u4E3B\u61C9\u7528\u4E92\u52D5\u6D3E\u767C",
      },
      pokeSearch: {
        placeholder:
          "\u641C\u5C0B\u5BF6\u53EF\u5922\uFF081025 \u96BB \xB7 \u540D\u7A31 / \u7DE8\u865F / \u82F1\u6587\u540D\uFF09",
        searching: "\u641C\u5C0B\u4E2D\u2026",
        noResult:
          "\u6C92\u6709\u627E\u5230\u9019\u96BB\u5BF6\u53EF\u5922\uFF0C\u63DB\u500B\u7DE8\u865F\u6216\u540D\u5B57\u8A66\u8A66",
        bundled: "\u5167\u5EFA",
      },
      category: {
        releaseConfirm:
          "\u653E\u751F\u5206\u985E\u300C{name}\u300D\u5F8C\uFF0C\u5176 {n} \u500B\u4EFB\u52D9\u5C07\u6B78\u5165\u7B2C\u4E00\u500B\u5206\u985E\u300C{first}\u300D\uFF0C\u6A19\u7C64\u7DAD\u5EA6\u8207\u6A19\u7C64\u4FDD\u7559\u3002",
      },
      filter: {
        p2pLocked: "\u79C1\u804A\u56FA\u5B9A\u8DDF\u96A8\uFF0C\u4E0D\u53C3\u8207\u904E\u6FFE",
      },
      prompts: {
        conflictRefreshed:
          "\u63D0\u793A\u8A5E\u5DF2\u5728\u53E6\u4E00\u5F62\u614B\u66F4\u65B0\uFF0C\u5DF2\u70BA\u4F60\u5237\u65B0\u5230\u6700\u65B0\u7248",
        forceOverwrite: "\u5DF2\u5728\u53E6\u4E00\u8655\u88AB\u4FEE\u6539\u2014\u2014\u78BA\u8A8D\u8986\u84CB\uFF1F",
        forceOverwriteConfirm: "\u4ECD\u8981\u8986\u84CB",
      },
      common: {
        close: "\u95DC\u9589",
      },
      sess: {
        group: {
          all: "\u5168\u90E8",
          radio: "\u6536\u97F3\u6A5F",
          dispatch: "\u6D3E\u767C",
          other: "\u5176\u4ED6",
        },
        worldLocal: "\u672C\u6A5F",
        worldDeployment: "\u90E8\u7F72 {alias}",
        counts: "\u5171 {n} \u689D \xB7 \u7B2C {page}/{pages} \u9801",
        limitLabel: "\u6BCF\u9801\u689D\u6578",
        limitN: "{n} \u689D/\u9801",
        replay: "\u56DE\u653E",
        replayOpened: "\u5DF2\u5728\u7D42\u7AEF\u9762\u677F\u6253\u958B\u56DE\u653E\uFF08{world}\uFF09",
        replayGone:
          "\u8A72\u6703\u8A71\u7684\u9060\u7AEF\u90E8\u7F72\u5DF2\u88AB\u79FB\u9664\uFF0C\u7121\u6CD5\u56DE\u653E",
        emptyGroup: "\u8A72\u5206\u7D44\u66AB\u7121\u6703\u8A71",
      },
      ...dsh_zh_Hant_deploy_default,
      import: {
        entry: "\u532F\u5165 JSON",
        title: "\u532F\u5165 JSON",
        pickLabel: "\u9078\u64C7\u6A94\u6848",
        pickHint:
          "\u9078\u64C7\u4E00\u500B\u532F\u51FA\u7684 JSON \u6A94\u6848\u2014\u2014\u532F\u5165\u524D\u6703\u5148\u6821\u9A57\uFF0C\u4E26\u81EA\u52D5\u5099\u4EFD\u7576\u524D\u8CC7\u6599\u3002",
        validating: "\u6821\u9A57\u4E2D\u2026",
        invalid:
          "\u6A94\u6848\u7D50\u69CB\u6821\u9A57\u672A\u901A\u904E\uFF1A{reasons}\u3002\u5EAB\u5167\u5BB9\u672A\u66F4\u52D5\uFF080 \u884C\u8B8A\u66F4\uFF09\u3002",
        pickAnother: "\u63DB\u4E00\u500B\u6A94\u6848",
        confirmBody:
          "\u532F\u5165\u5C07\u6574\u9AD4\u66FF\u63DB\u7576\u524D\u5F85\u8FA6\u8CC7\u6599\uFF08\u5BC6\u9470\u8207\u63D0\u793A\u8A5E\u8986\u84CB\u884C\u4FDD\u7559\uFF09\u3002\u5DF2\u81EA\u52D5\u5099\u4EFD\uFF1A{file}\u3002\u57F7\u884C\u5F8C\u4E0D\u53EF\u64A4\u92B7\uFF0C\u8ACB\u78BA\u8A8D\u3002",
        counts: "\u6A94\u6848\u5167\u5BB9\uFF1A{n} \u9805\u5F85\u8FA6",
        confirmOk: "\u78BA\u8A8D\u532F\u5165",
        running: "\u57F7\u884C\u4E2D\u2026",
        done: "\u5DF2\u532F\u5165 {n} \u9805 \xB7 \u5DF2\u81EA\u52D5\u5099\u4EFD\uFF1A{file}",
        backupFailed:
          "\u532F\u5165\u524D\u81EA\u52D5\u5099\u4EFD\u5931\u6557\uFF1A{reason}\u3002\u5DF2\u4E2D\u6B62\u532F\u5165\uFF0C\u5EAB\u5167\u5BB9\u672A\u66F4\u52D5\u3002",
      },
      export: {
        dirOpen: "\u6253\u958B\u532F\u51FA\u76EE\u9304",
        dirOpenFailed:
          "\u6253\u958B\u532F\u51FA\u76EE\u9304\u5931\u6557\uFF1A{reason}\uFF08\u76EE\u9304\u5DF2\u5617\u8A66\u5EFA\u7ACB\uFF0C\u53EF\u624B\u52D5\u524D\u5F80 {path}\uFF09",
      },
      restore: {
        entry: "\u6062\u5FA9",
        fromFile: "\u5F9E\u6A94\u6848\u6062\u5FA9\u2026",
        title: "\u6062\u5FA9\u5099\u4EFD",
        confirmBody:
          "\u6062\u5FA9\u300C{file}\u300D\u5C07\u6574\u9AD4\u66FF\u63DB\u7576\u524D\u5EAB\uFF0C\u6062\u5FA9\u524D\u5DF2\u81EA\u52D5\u5099\u4EFD\u7576\u524D\u8CC7\u6599\u3002\u6062\u5FA9\u5F8C\u81EA\u52D5\u88DC\u8DD1\u9077\u79FB\u8207\u9810\u8A2D\u5206\u985E\u88DC\u7A2E\u3002",
        confirmOk: "\u78BA\u8A8D\u6062\u5FA9",
        running: "\u57F7\u884C\u4E2D\u2026",
        rejected:
          "\u8A72\u5099\u4EFD\u7248\u672C\u8D85\u51FA\u672C\u63D2\u4EF6\u76F8\u5BB9\u8996\u7A97\uFF0C\u9700\u5347\u7D1A\u63D2\u4EF6\u5F8C\u6062\u5FA9\u3002\u7576\u524D\u5EAB\u672A\u66F4\u52D5\u3002",
        done: "\u5DF2\u6062\u5FA9 \xB7 \u5DF2\u81EA\u52D5\u5099\u4EFD\u7576\u524D\u8CC7\u6599\u3002\u5DF2\u81EA\u52D5\u88DC\u8DD1\u9077\u79FB\u8207\u9810\u8A2D\u5206\u985E\u88DC\u7A2E",
        failed:
          "\u6062\u5FA9\u5931\u6557\uFF1A{reason}\u3002\u7576\u524D\u5EAB\u4FDD\u6301\u6062\u5FA9\u524D\u72C0\u614B",
      },
      ax: {
        guide:
          "\u8F38\u5165\u97FF\u61C9\u9700\u8981\u300C\u8F14\u52A9\u529F\u80FD\u300D\u6388\u6B0A\uFF0C\u4E14\u53EA\u7D71\u8A08\u6309\u9375\u983B\u7387\u2014\u2014\u4E0D\u8A18\u9304\u9375\u503C\u3001\u9375\u540D\u3001\u8996\u7A97\u6216\u61C9\u7528\u3002",
        revoked:
          "\u6388\u6B0A\u5DF2\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u6388\u6B0A\u3002\u6388\u6B0A\u6062\u5FA9\u524D\u8F38\u5165\u97FF\u61C9\u4FDD\u6301\u505C\u6B62",
        pathHint:
          "\u82E5\u5217\u8868\u4E2D\u627E\u4E0D\u5230\uFF0C\u628A\u6B64\u8DEF\u5F91\u62D6\u5165\u6216\u8907\u88FD\u5F8C \u2318\u21E7G \u5B9A\u4F4D\uFF1A{path}\uFF08\u9EDE\u64CA\u8907\u88FD\uFF09",
        authorize: "\u53BB\u6388\u6B0A",
        copyPath: "\u9EDE\u64CA\u8907\u88FD\u8DEF\u5F91",
      },
      helper: {
        banner:
          "\u7CFB\u7D71\u80FD\u529B\u9762\u964D\u7D1A\uFF1A\u684C\u5BF5\u8207\u7CFB\u7D71\u901A\u77E5\u66AB\u4E0D\u53EF\u7528\uFF08helper \u672A\u57F7\u884C\uFF09\u3002\u6838\u5FC3\u5F85\u8FA6\u4E0D\u53D7\u5F71\u97FF",
        viewDiag: "\u67E5\u770B\u8A3A\u65B7",
      },
      diag: {
        capsTitle: "\u7CFB\u7D71\u80FD\u529B\u9762",
        caps: {
          tray: "\u6258\u76E4",
          shortcut: "\u5168\u57DF\u5FEB\u6377\u9375",
          notify: "\u901A\u77E5",
          dialog: "\u6A94\u6848\u5C0D\u8A71\u6846",
          tts: "\u8A9E\u97F3",
          input: "\u8F38\u5165\u8A08\u6578",
          ok: "\u53EF\u7528",
          degraded: "\u964D\u7D1A",
          guide: "\u4F9D\u8CF4 helper sidecar\u2014\u2014\u6062\u5FA9 helper \u5F8C\u81EA\u52D5\u6062\u5FA9",
          absent:
            "helper \u672A\u57F7\u884C\u2014\u2014\u5168\u90E8\u80FD\u529B\u964D\u7D1A\uFF1B\u53EF\u5F9E\u63D2\u4EF6\u5B89\u88DD\u76EE\u9304\u91CD\u65B0\u555F\u52D5 helper",
          version: "helper \u57F7\u884C\u6642\uFF1A{v}",
        },
        shortcutFailed:
          "\u5168\u57DF\u5FEB\u6377\u9375\u8A3B\u518A\u5931\u6557\uFF08\u53EF\u80FD\u88AB\u4F54\u7528\uFF09\u2014\u2014\u9762\u677F\u805A\u7126\u6642 \u2318\u21E7K \u4ECD\u53EF\u5FEB\u6355",
        sshOk: "dsh-ssh \u5BB6\u65CF\uFF1A\u5C31\u7DD2",
        sshMissing:
          "dsh-ssh \u5BB6\u65CF\uFF1A\u672A\u88DD\u8F09\u2014\u2014\u9060\u7AEF\u6D3E\u767C\u9700\u8981\u5B83\uFF08\u88DD\u8F09\u6307\u5F15\uFF1A{cmd}\uFF09",
      },
      lark: {
        login: "\u6388\u6B0A\u767B\u5165\uFF08\u5728\u7D42\u7AEF\u9762\u677F\u5B8C\u6210 lark-cli \u767B\u5165\uFF09",
        launched:
          "\u5DF2\u5728\u7D42\u7AEF\u9762\u677F\u555F\u52D5\u767B\u5165\uFF0C\u8ACB\u5230\u7D42\u7AEF\u5B8C\u6210\u6388\u6B0A",
        launchFailed: "\u767B\u5165\u555F\u52D5\u5931\u6557\uFF1A{reason}",
      },
    };

    // src/client/i18n/dsh-en-deploy.ts
    var dsh_en_deploy_default = {
      deploy: {
        title: "Remote deployments",
        counts: "ready {ready} \xB7 not ready {pending} \xB7 disconnected {broken}",
        empty: "No remote deployments yet. Add a machine to send agents afar",
        add: "+ Add deployment",
        edit: "Edit",
        remove: "Remove",
        provision: "Set up",
        reconnect: "Reconnect & check",
        wizardRunning: "Wizard running",
        directTag: "Direct mode (digest unchecked)",
        lastError: "Last error: {summary}",
        editFallback: "Saved. Deployment reset to not-ready \u2014 re-run the wizard to re-verify",
        sshMissing: "Remote dispatch needs the dsh-ssh family, which isn't loaded (guide: {cmd})",
        copyGuide: "Copy guide",
        status: {
          ready: "Ready",
          readyDirect: "Ready (direct)",
          notReady: "Not ready",
          disconnected: "Disconnected",
        },
        form: {
          addTitle: "Add deployment",
          editTitle: "Edit deployment",
          alias: "OpenSSH alias (credentials stay with ssh; nothing stored here)",
          nodePath: "Remote Node path",
          workdir: "Default remote workdir",
          note: "Note",
          aliasRequired: "Alias required",
          pathRequired: "Node path required",
        },
        removeTitle: "Remove deployment",
        removeBody:
          'Removing "{alias}" closes the connection and best-effort cleans the remote helper (failures logged, never blocking). Local records are deleted.',
        removeConfirm: "Confirm remove",
        wizard: {
          title: "Setup wizard",
          concurrent: "Wizard already running \u2014 wait, reopen to watch, or abort first",
          step: {
            "probe-ssh": "Passwordless SSH probe",
            "probe-node": "Remote Node check",
            upload: "Helper upload & install",
            verify: "Digest check",
          },
          state: {
            pending: "Waiting",
            probing: "Probing\u2026",
            installing: "Installing\u2026",
            verifying: "Verifying\u2026",
            done: "Done",
            failed: "Failed",
            skipped: "Skipped (already done)",
          },
          fail: {
            "probe-ssh": "Passwordless SSH failed. Run ssh-copy-id first (or add your key to ssh-agent), then retry",
            "probe-node": "Remote Node check failed. Fix the path or install Node (\u226518), then retry",
            upload: "Helper upload/install failed. Retry, or explicitly skip to direct mode (logged)",
            verify:
              "Remote helper digest mismatch \u2014 refusing to mark ready. Reinstall, or explicitly switch to direct mode below (logged)",
          },
          retry: "Retry this step",
          abort: "Abort (stays put, resumable)",
          skipInstallEntry: "Skip install, go direct\u2026",
          mismatchEntry: "Switch to direct mode",
          logTitle: "Wizard output",
          logEmpty: "(waiting for output\u2026)",
          closeHint: "Esc/\u2715 close = keep running in background (card badge reflects)",
        },
        degrade: {
          title: "Switch to direct mode",
          body: "Direct mode skips helper digest checks for this deployment \u2014 weaker guarantees. This choice is logged to diagnostics.",
          confirm: "Confirm",
        },
      },
    };

    // src/client/i18n/dsh-en.ts
    var dsh_en_default = {
      page: {
        title: "Pok\xE9dex",
        pending: "{n} pending",
      },
      empty: {
        tasks: "The tall grass is quiet \u2014 say it in chat, send a wire",
        radio: "The airwaves are quiet. New messages show as a count \u2014 no interruptions.",
        dispatch: "No agents dispatched yet",
      },
      auth: {
        unauthorized: "The radio isn't tuned \u2014 authorize Feishu to start receiving",
        expired: "Feishu authorization expired; polling paused",
      },
      schema: {
        tooNew:
          "The Pok\xE9dex hit a snag: the todo database is newer than this plugin \u2014 upgrade to write. Browsing still works.",
        readonly: "Read-only mode",
      },
      toast: {
        alreadyHandled: "This suggestion was already handled on the other side",
        caught: 'Caught "{title}"',
        caughtMatch: "Match: update suggestion awaits your call",
        released: 'Released "{title}"',
        undo: "Undo {sec}s",
        dispatchBusy: "This task already has an active dispatch \u2014 close or reset it first",
        savedHint: "Saved",
      },
      release: {
        confirmBody:
          'Releasing "{title}" also removes its tag links and follow-ups; the action is kept in the audit log. Undo within 5 seconds.',
        confirmOk: "Confirm release",
      },
      batch: {
        selected: "{n} selected",
        catchAll: "Catch all",
        releaseAll: "Release all (one reason)",
        clear: "Clear",
      },
      failed: {
        retryAll: "Retry all",
        forceCapture: "Force catch",
        forceDismiss: "Force release",
      },
      overdue: {
        leaked: "{n} slipped away yesterday",
        expand: "Expand",
      },
      radio: {
        stateWarn: "Retrying",
        stateFail: "Unauthorized",
        failCount: "{n} consecutive failures",
        kbdHint:
          "J/K navigate \xB7 C catch \xB7 X release \xB7 U apply update \xB7 R restore \xB7 T accept tag \xB7 Esc close (active only inside the plugin page \u2014 no global shortcuts)",
        acceptTag: "\uFF0B Accept new tag",
        judging: "Judging\u2026",
      },
      dispatch: {
        tooltipQueued: "Queued, waiting to run",
        tooltipRunning: "Agent running",
        tooltipDone: "Reported \u2014 see timeline",
        tooltipFailed: "Failed: {reason}",
        badge: {
          queued: "Queued",
          running: "Dispatching",
          done: "Reported",
          failed: "Failed",
        },
        confirm:
          "Dispatching: {agent} \xB7 {scope} \xB7 {dir} \xB7 via {project}. Changes here won't overwrite the route. Interactive runs launch in the terminal panel \u2014 watch or take over anytime.",
        scopeLocal: "local",
        scopeRemote: "remote",
        sourceRoute: "project route",
        sourceDefault: "global default",
        redo: "Redispatch",
        cancelQueued: "Cancel queued",
        worldDeployment: "deployment {alias}",
        worldLine: "Dispatching: {agent} \xB7 {world} \xB7 {dir}. Models & sessions stay local on remote runs.",
        degradeDirect: "Direct mode: helper digest unchecked",
        degradeInteractive: "Interactive degraded: full command copied \u2014 run it in your own terminal",
        degradeNonPosix: "Non-POSIX target: headless direct dispatch only",
        occupancy:
          "This task still has a live process on the remote (session {id}) \u2014 continuing shares the same worktree; consider closing it first",
      },
      agents: {
        commandRequired: "Agent command must not be empty (executable name or absolute path)",
        argsPh: "-p {prompt}",
        sshHostPh: "user@host",
        presetLabel: "Agent preset",
        presetCustom: "Custom",
      },
      pet: {
        showNotReady: "The pet didn't finish its startup handshake within 5 seconds \u2014 it may still be starting",
        clearMain: "Clear",
        showRow: "Show pet",
        show: "Show",
        hide: "Hide",
        stateLabel: "Current state: ",
        stateShown: "Visible",
        stateHidden: "Hidden",
        stateUnknown: "Unknown",
      },
      tag: {
        deleteConfirm: 'Delete tag "{name}"? Its task links will be removed as well.',
      },
      task: {
        reschedule: "Reschedule",
      },
      dt: {
        hour: "Hour",
        minute: "Minute",
        period: "AM/PM",
        prevMonth: "Previous month",
        nextMonth: "Next month",
      },
      chip: {
        openPage: "Open the Pok\xE9dex page",
        resting: "Resting",
      },
      settings: {
        saving: "Saving\u2026",
        saved: "Saved",
        saveFailed: "Save failed: {reason} \u2014 draft kept, retryable",
        unsavedTitle: "Unsaved changes",
        leaveTitle: "Backpack has unsaved changes.",
        leaveSave: "Save & leave",
        leaveDiscard: "Discard",
        leaveStay: "Stay",
        judgeSource: "Currently consuming results from the main app (dsh doesn't judge on its own)",
        dbStatusTitle: "Todo database status",
        dbStatusQuery: "Query database status",
        dbUserVersion: "Schema v{v} \xB7 {mode}",
        dbModeRw: "read-write OK",
        dbModeRo: "read-only (plugin upgrade required)",
        guideTitle: "User guide",
        guideLink: "docs/USER_GUIDE.md \xB7 dsh chapter \u2197",
        dualFormTitle: "Two forms, one database",
        dualFormTip:
          "dsh and the main app share one database & settings \u2014 one notification per due task system-wide (the other form yields); ceremonies & voice only on the side where you completed; prompts editable on both, with refresh prompts on conflicts.",
      },
      badge: {
        mainApp: "Affects the main app",
        notifications: "Affects main-app notifications",
        pet: "Affects the main app's pet",
        dispatch: "Affects main-app interactive dispatch",
      },
      pokeSearch: {
        placeholder: "Search Pok\xE9mon (1025 \xB7 name / No. / English)",
        searching: "Searching\u2026",
        noResult: "No match \u2014 try another name or number",
        bundled: "Bundled",
      },
      category: {
        releaseConfirm:
          'Releasing category "{name}" moves its {n} tasks to the first category "{first}"; tag dimensions and tags are kept.',
      },
      filter: {
        p2pLocked: "DMs always follow (locked, read-only)",
      },
      prompts: {
        conflictRefreshed: "This prompt was updated on the other side \u2014 refreshed to the latest",
        forceOverwrite: "Modified elsewhere \u2014 overwrite?",
        forceOverwriteConfirm: "Overwrite anyway",
      },
      common: {
        close: "Close",
      },
      sess: {
        group: {
          all: "All",
          radio: "Radio",
          dispatch: "Dispatch",
          other: "Other",
        },
        worldLocal: "local",
        worldDeployment: "deployment {alias}",
        counts: "{n} total \xB7 page {page}/{pages}",
        limitLabel: "Per page",
        limitN: "{n} per page",
        replay: "Replay",
        replayOpened: "Replay opened in the terminal panel ({world})",
        replayGone: "That session's remote deployment was removed \u2014 can't replay",
        emptyGroup: "No sessions in this group",
      },
      ...dsh_en_deploy_default,
      import: {
        entry: "Import JSON",
        title: "Import JSON",
        pickLabel: "Pick a file",
        pickHint: "Pick an exported JSON file \u2014 it's validated first and your current data is auto-backed up.",
        validating: "Validating\u2026",
        invalid: "Validation failed: {reasons}. Database untouched (0 changes).",
        pickAnother: "Pick another file",
        confirmBody:
          "Import replaces all todo data (secrets & prompt overrides kept). Auto-backup created: {file}. This can't be undone \u2014 confirm to proceed.",
        counts: "File contains {n} todos",
        confirmOk: "Confirm import",
        running: "Working\u2026",
        done: "Imported {n} items \xB7 auto-backup: {file}",
        backupFailed: "Pre-import backup failed: {reason}. Import aborted; database untouched.",
      },
      export: {
        dirOpen: "Open exports folder",
        dirOpenFailed: "Couldn't open exports folder: {reason} (folder created; path: {path})",
      },
      restore: {
        entry: "Restore",
        fromFile: "Restore from file\u2026",
        title: "Restore backup",
        confirmBody:
          'Restoring "{file}" replaces the database; current data is auto-backed up first. Migrations & default categories re-run after.',
        confirmOk: "Confirm restore",
        running: "Working\u2026",
        rejected:
          "Backup version is beyond this plugin's compatibility window \u2014 upgrade first. Database untouched.",
        done: "Restored \xB7 current data auto-backed up. Migrations & default categories re-run",
        failed: "Restore failed: {reason}. Database unchanged",
      },
      ax: {
        guide:
          "Input response needs Accessibility permission, and only counts keystroke rhythm \u2014 never keys, windows, or apps.",
        revoked: "Permission revoked \u2014 re-authorize to resume. Counting stays off until then",
        pathHint: "If missing from the list, drag this in or copy & \u2318\u21E7G: {path} (click to copy)",
        authorize: "Authorize",
        copyPath: "Click to copy path",
      },
      helper: {
        banner: "System features degraded: pet & notifications unavailable (helper not running). Core todos unaffected",
        viewDiag: "Diagnostics",
      },
      diag: {
        capsTitle: "System features",
        caps: {
          tray: "Tray",
          shortcut: "Global shortcuts",
          notify: "Notifications",
          dialog: "File dialogs",
          tts: "Voice",
          input: "Input counting",
          ok: "available",
          degraded: "degraded",
          guide: "Depends on the helper sidecar \u2014 recovers when helper does",
          absent: "Helper not running \u2014 all features degraded; restart it from the plugin install directory",
          version: "helper runtime: {v}",
        },
        shortcutFailed:
          "Global shortcut registration failed (possibly taken) \u2014 \u2318\u21E7K still works while the panel is focused",
        sshOk: "dsh-ssh family: ready",
        sshMissing: "dsh-ssh family: not loaded \u2014 remote dispatch needs it (guide: {cmd})",
      },
      lark: {
        login: "Authorize (lark-cli login in the terminal panel)",
        launched: "Login launched in the terminal panel \u2014 finish it there",
        launchFailed: "Failed to launch login: {reason}",
      },
    };

    // src/client/i18n/index.tsx
    var import_jsx_runtime2 = require("react/jsx-runtime");
    var SUPPORTED_LOCALES = [
      { value: "zh-Hans", label: "\u7B80\u4F53\u4E2D\u6587" },
      { value: "zh-Hant", label: "\u7E41\u9AD4\u4E2D\u6587" },
      { value: "en", label: "English" },
    ];
    var MESSAGES = {
      "zh-Hans": { ...zh_Hans_default, dsh: dsh_zh_Hans_default },
      "zh-Hant": { ...zh_Hant_default, dsh: dsh_zh_Hant_default },
      en: { ...en_default, dsh: dsh_en_default },
    };
    function lookup(tree, key) {
      let node = tree;
      for (const part of key.split(".")) {
        if (node === null || typeof node !== "object") {
          return void 0;
        }
        node = node[part];
      }
      return node;
    }
    function interpolate(template, params) {
      if (params === void 0) {
        return template;
      }
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.hasOwn(params, name) ? String(params[name]) : match,
      );
    }
    function createT(locale) {
      const tree = MESSAGES[locale];
      return (key, params) => {
        const value = lookup(tree, key);
        if (typeof value === "string") {
          return interpolate(value, params);
        }
        return key;
      };
    }
    function flattenKeys(tree, prefix = "") {
      const keys = /* @__PURE__ */ new Set();
      for (const [key, value] of Object.entries(tree)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          for (const sub of flattenKeys(value, path)) {
            keys.add(sub);
          }
        } else {
          keys.add(path);
        }
      }
      return keys;
    }
    var I18nContext = (0, import_react2.createContext)({ locale: "zh-Hans", t: createT("zh-Hans") });
    function I18nProvider({ locale, children }) {
      const value = (0, import_react2.useMemo)(() => ({ locale, t: createT(locale) }), [locale]);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(I18nContext.Provider, { value, children });
    }
    function useI18n() {
      return (0, import_react2.useContext)(I18nContext);
    }
    function useT() {
      return useI18n().t;
    }

    // src/client/chip/chip.module.css
    var css =
      '/* conversation chip\uFF08\u5BBF\u4E3B header \u884C\u5185\u5355\u884C\uFF1B\u547D\u4E2D\u533A \u226532px\uFF1B\u5012\u8BA1\u65F6\u5B9A\u5BBD\u9632\u8DF3\u52A8\uFF09 */\n\n.b5gOHb_chip {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  max-width: 360px;\n  min-height: 32px;\n  padding: 2px 8px;\n  border-radius: 999px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 12px;\n  cursor: pointer;\n}\n.b5gOHb_chip:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n.b5gOHb_chip:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n.b5gOHb_chip[data-mode="paused"] {\n  filter: saturate(0.6);\n}\n.b5gOHb_chipTitle {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.b5gOHb_chipTime {\n  font-variant-numeric: tabular-nums;\n  /* \u5B9A\u5BBD\u6570\u5B57\u9632\u8DF3\u52A8\uFF08UIUX \xA77\uFF09 */\n  min-width: 5ch;\n  text-align: right;\n}\n.b5gOHb_chipButton {\n  min-width: 32px;\n  min-height: 32px;\n  border: none;\n  border-radius: 50%;\n  background: transparent;\n  cursor: pointer;\n  font-size: 13px;\n  line-height: 1;\n  color: inherit;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n.b5gOHb_chipButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n.b5gOHb_chipButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n}\n.b5gOHb_chipButton:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n';
    var tagId = "dsh-plugin/src/client/chip/chip.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    var chip_default = {
      chip: "b5gOHb_chip",
      chipTitle: "b5gOHb_chipTitle",
      chipTime: "b5gOHb_chipTime",
      chipButton: "b5gOHb_chipButton",
    };

    // src/client/chip/ConversationChip.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    function ConversationChip({
      task,
      mode,
      /** 计时秒数（dsh 形态 = 已专注时长快照：自 startedAt 起算、取最近一次刷新时的值
       *  ——番茄倒计时态在 helper 侧（D2），客户端无周期动作 invariant（NFR-6）下的诚实替代） */
      secondsLeft,
      /** 进行中任务分类的宝可梦名（运行态前缀） */
      pokemonName,
      /** 打开插件页面（宿主导航回调；可选目标分段锚点） */
      onOpenPage,
      targetSection,
      /** 就近控制后的数据回刷（宿主层注入——⏸/✔/▶ 立即反映，不等轮询窗） */
      onMutate,
      /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：chip ⏸/✔ 置灰） */
      readonly = false,
    }) {
      const t = useT();
      const client = useClient();
      if (task === null) {
        return null;
      }
      const act = (fn) => {
        void fn().finally(() => onMutate?.());
      };
      const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
      const ss = String(secondsLeft % 60).padStart(2, "0");
      const time = `${mm}:${ss}`;
      const label =
        mode === "resting"
          ? `\u2615 ${t("dsh.chip.resting")}`
          : mode === "paused"
            ? t("entry.paused")
            : `${pokemonName} ${t("entry.catching")}`;
      const open = () => onOpenPage?.(targetSection);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", {
        className: chip_default.chip,
        "data-mode": mode,
        "data-testid": "conversation-chip",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", {
            type: "button",
            className: chip_default.chipTitle,
            title: `${task.title} \xB7 ${t("dsh.chip.openPage")}`,
            onClick: open,
            "aria-label": `${task.title} \xB7 ${t("dsh.chip.openPage")}`,
            "data-testid": "chip-open",
            children: label,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: chip_default.chipTime, children: time }),
          mode === "paused"
            ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, {
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
                    label: t("pet.menuResume"),
                    glyph: "\u25B6",
                    disabled: readonly,
                    onClick: () => act(() => client.taskResume({ taskId: task.id })),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
                    label: t("pet.trialStart"),
                    glyph: "\u{1F366}",
                    disabled: readonly,
                    onClick: () => act(() => client.pomoTryFive({ taskId: task.id })),
                  }),
                ],
              })
            : mode === "resting"
              ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
                  label: t("pet.menuResume"),
                  glyph: "\u25B6",
                  onClick: () => act(() => client.taskResume({ taskId: task.id })),
                })
              : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, {
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
                      label: t("entry.pause"),
                      glyph: "\u23F8",
                      disabled: readonly,
                      onClick: () => act(() => client.taskPause({ taskId: task.id })),
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
                      label: t("pet.menuDone"),
                      glyph: "\u2714",
                      disabled: readonly,
                      onClick: () => act(() => client.taskComplete({ taskId: task.id })),
                    }),
                  ],
                }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconBtn, {
            label: t("dsh.chip.openPage"),
            glyph: "\u2197",
            onClick: open,
          }),
        ],
      });
    }
    function IconBtn({ label, glyph, onClick, disabled = false }) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", {
        type: "button",
        className: chip_default.chipButton,
        title: label,
        "aria-label": label,
        disabled,
        onClick,
        children: glyph,
      });
    }

    // src/client/rpcParity.ts
    function parityFacade(call) {
      return {
        streakInfo: () => call("streakInfo"),
        larkLoginStart: () => call("larkLoginStart"),
        sessionsPage: (p) => call("sessionsPage", p),
        sessionReplay: (p) => call("sessionReplay", p),
        deploymentList: () => call("deploymentList"),
        deploymentUpsert: (p) => call("deploymentUpsert", p),
        deploymentDelete: (p) => call("deploymentDelete", p),
        deploymentRecheck: (p) => call("deploymentRecheck", p),
        provisionRun: (p) => call("provisionRun", p),
        provisionStatus: (p) => call("provisionStatus", p),
        deploymentDegradeConfirm: (p) => call("deploymentDegradeConfirm", p),
        importValidate: (p) => call("importValidate", p),
        importRun: (p) => call("importRun", p),
        restoreRun: (p) => call("restoreRun", p),
        exportDirOpen: () => call("exportDirOpen"),
        macAuthorizationStatus: (p) => call("macAuthorizationStatus", p),
        macAuthPaneOpen: () => call("macAuthPaneOpen"),
      };
    }

    // src/host/domain/suggest-types.ts
    var ESCAPE_REASONS = [
      "duplicate",
      // 已有类似待办
      "not_task",
      // 不是给我的任务
      "wrong_info",
      // 建议内容不对（标题/时间/分类错了）
      "noise",
      // 闲聊/噪音
      "outdated",
      // 已过期
      "other",
      // 其他
    ];

    // src/client/rpcViews.ts
    var ESCAPE_REASON_CODES = ESCAPE_REASONS;
    var HELPER_CAP_ROWS = [
      { id: "tray", cap: "sys-tray" },
      { id: "shortcut", cap: "sys-shortcut" },
      { id: "notify", cap: "sys-notify" },
      { id: "dialog", cap: "sys-dialog" },
      { id: "tts", cap: "sys-tts" },
      { id: "input", cap: "input-count" },
    ];
    function isErrorCode(error, code) {
      return error !== null && error !== void 0 && error.code === code;
    }

    // src/client/rpcErrorCodes.ts
    var ERROR_CODES = [
      "JUDGE_TIMEOUT",
      "JUDGE_INVALID_RESULT",
      "LARK_FETCH_FAILED",
      "LARK_UNAUTHORIZED",
      "DISPATCH_TIMEOUT",
      "DISPATCH_LAUNCH_FAILED",
      "DB_SCHEMA_TOO_NEW",
      "DSH_VERSION_UNSUPPORTED",
      "SSH_AUTH_REQUIRED",
      "SUGGESTION_ALREADY_RESOLVED",
      "DISPATCH_ALREADY_ACTIVE",
      "CONFIG_VALIDATION_FAILED",
      "AGENT_COMMAND_INVALID",
      "PROMPT_VALIDATION_FAILED",
      "SETTING_MODIFIED_ELSEWHERE",
      "IMPORT_VALIDATION_FAILED",
      "BACKUP_FAILED",
      "HELPER_CAPABILITY_MISSING",
      "DEPLOYMENT_NOT_READY",
      "PROVISION_STEP_FAILED",
      "HELPER_HASH_MISMATCH",
    ];

    // src/client/model.ts
    function taskPresentation(task) {
      switch (task.status) {
        case "active":
          return "active";
        case "paused":
          return task.startedAt !== null ? "activePaused" : "normal";
        case "done":
          return "done";
        case "cancelled":
          return "escaped";
        default:
          return "normal";
      }
    }
    function dateOf(iso) {
      if (iso === null || iso.length < 10) {
        return null;
      }
      return iso.slice(0, 10);
    }
    function isOverdue(task, today) {
      if (task.status === "done" || task.status === "cancelled") {
        return false;
      }
      const due = dateOf(task.dueAt);
      return due !== null && due < today;
    }
    function adventureSnapshot(tasks, today) {
      const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
      const activeOrPaused = open.filter((t) => t.status === "active" || t.status === "paused");
      const dueToday = open.filter((t) => t.status !== "active" && t.status !== "paused" && dateOf(t.dueAt) === today);
      const doneToday = tasks.filter((t) => t.status === "done" && dateOf(t.completedAt) === today);
      return {
        todayTasks: [...activeOrPaused, ...dueToday],
        total: activeOrPaused.length + dueToday.length + doneToday.length,
        caught: doneToday.length,
        overdueTasks: open.filter((t) => isOverdue(t, today)),
      };
    }
    function routeGroups(tasks) {
      const groups = /* @__PURE__ */ new Map();
      for (const task of tasks) {
        if (task.status !== "scheduled") {
          continue;
        }
        const due = dateOf(task.dueAt) ?? "";
        const bucket = groups.get(due);
        if (bucket === void 0) {
          groups.set(due, [task]);
        } else {
          bucket.push(task);
        }
      }
      return [...groups.entries()]
        .filter(([date]) => date !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, list]) => ({ date, tasks: list }));
    }
    function grassTasks(tasks) {
      return tasks.filter((t) => t.status === "inbox");
    }
    function dexStats(tasks) {
      const caught = tasks.filter((t) => t.status === "done").length;
      const escaped = tasks.filter((t) => t.status === "cancelled").length;
      let milestone = "m0";
      if (caught >= 200) {
        milestone = "m200";
      } else if (caught >= 100) {
        milestone = "m100";
      } else if (caught >= 50) {
        milestone = "m50";
      } else if (caught >= 10) {
        milestone = "m10";
      } else if (caught >= 1) {
        milestone = "m1";
      }
      return { caught, escaped, milestone, milestoneParam: caught };
    }
    function dispatchTooltipKey(state) {
      switch (state) {
        case "queued":
          return "dsh.dispatch.tooltipQueued";
        case "running":
          return "dsh.dispatch.tooltipRunning";
        case "done":
          return "dsh.dispatch.tooltipDone";
        case "failed":
          return "dsh.dispatch.tooltipFailed";
        default:
          return null;
      }
    }
    function suggestionGroups(messages) {
      const groups = { pending: [], none: [], failed: [], caught: [], escaped: [] };
      for (const message of messages) {
        if (message.reviewStatus === "accepted") {
          groups.caught.push(message);
        } else if (message.reviewStatus === "dismissed") {
          groups.escaped.push(message);
        } else if (message.aiStatus === "error") {
          groups.failed.push(message);
        } else if (message.aiStatus === "judging" || message.aiStatus === "pending") {
          groups.pending.push(message);
        } else if (message.aiStatus === "todo" || message.aiStatus === "update") {
          groups.pending.push(message);
        } else {
          groups.none.push(message);
        }
      }
      return groups;
    }
    var SEGMENTS = ["adventure", "grass", "route", "dex", "radio", "logs", "settings"];
    var SEGMENT_LABEL_KEYS = {
      adventure: "tabs.today",
      grass: "tabs.inbox",
      route: "tabs.scheduled",
      dex: "tabs.done",
      radio: "tabs.im",
      logs: "tabs.sessions",
      settings: "tabs.settings",
    };
    function dirtySectionSet(draft, saved, keySets) {
      const dirty = /* @__PURE__ */ new Set();
      for (const [section, keys] of Object.entries(keySets)) {
        if (keys.some((key) => draft[key] !== saved[key])) {
          dirty.add(section);
        }
      }
      return dirty;
    }

    // src/client/rpc.ts
    function taskFacade(call) {
      return {
        taskStart: (p) => call("taskStart", p),
        taskPause: (p) => call("taskPause", p),
        taskResume: (p) => call("taskResume", p),
        taskComplete: (p) => call("taskComplete", p),
        taskCancel: (p) => call("taskCancel", p),
        taskDelete: (p) => call("taskDelete", p),
        taskDeleteUndo: (p) => call("taskDeleteUndo", p),
        taskReschedule: (p) => call("taskReschedule", p),
        taskUpdate: (p) => call("taskUpdate", p),
        taskNoteAdd: (p) => call("taskNoteAdd", p),
        taskNoteDelete: (p) => call("taskNoteDelete", p),
        taskHistory: (p) => call("taskHistory", p),
      };
    }
    function radioFacade(call) {
      return {
        captureTodo: (p) => call("captureTodo", p),
        reviewAccept: (p) => call("reviewAccept", p),
        reviewApplyUpdate: (p) => call("reviewApplyUpdate", p),
        reviewDismiss: (p) => call("reviewDismiss", p),
        reviewRestore: (p) => call("reviewRestore", p),
        reviewBatch: (p) => call("reviewBatch", p),
        retryJudge: (p) => call("retryJudge", p),
        forceCapture: (p) => call("forceCapture", p),
        forceDismiss: (p) => call("forceDismiss", p),
        pollNow: () => call("pollNow"),
      };
    }
    function dispatchFacade(call) {
      return {
        dispatchInteractive: (p) => call("dispatchInteractive", p),
        dispatchHeadless: (p) => call("dispatchHeadless", p),
        dispatchClose: (p) => call("dispatchClose", p),
        dispatchReset: (p) => call("dispatchReset", p),
        dispatchCancel: (p) => call("dispatchCancel", p),
        dispatchRedo: (p) => call("dispatchRedo", p),
        configRead: (p) => call("configRead", p),
        configWrite: (p) => call("configWrite", p),
        routeUpsert: (p) => call("routeUpsert", p),
        larkAuth: () => call("larkAuth"),
        larkTest: () => call("larkTest"),
      };
    }
    function backpackFacade(call) {
      return {
        categoryUpsert: (p) => call("categoryUpsert", p),
        categoryDelete: (p) => call("categoryDelete", p),
        tagUpsert: (p) => call("tagUpsert", p),
        tagDelete: (p) => call("tagDelete", p),
        dimensionUpdate: (p) => call("dimensionUpdate", p),
        filterList: () => call("filterList"),
        filterUpsert: (p) => call("filterUpsert", p),
        tagCheckup: () => call("tagCheckup"),
        tagMerge: (p) => call("tagMerge", p),
        tagMoveDimension: (p) => call("tagMoveDimension", p),
        agentUpsert: (p) => call("agentUpsert", p),
        agentDelete: (p) => call("agentDelete", p),
        agentTest: (p) => call("agentTest", p),
        pkSkillCheck: (p) => call("pkSkillCheck", p),
        pkSkillInstall: (p) => call("pkSkillInstall", p),
        promptList: () => call("promptList"),
        promptGet: (p) => call("promptGet", p),
        promptOverride: (p) => call("promptOverride", p),
        promptReset: (p) => call("promptReset", p),
      };
    }
    function miscFacade(call) {
      return {
        diagnosticsSnapshot: () => call("diagnosticsSnapshot"),
        supportReport: () => call("supportReport"),
        logQuery: (p) => call("logQuery", p),
        petShow: () => call("petShow"),
        petHide: () => call("petHide"),
        petStatus: () => call("petStatus"),
        petMove: (p) => call("petMove", p),
        dbStatus: () => call("dbStatus"),
        pomoTryFive: (p) => call("pomoTryFive", p),
        panelSnapshot: () => call("panelSnapshot"),
        taskDetail: (p) => call("taskDetail", p),
        taskSearch: (p) => call("taskSearch", p),
        todayTasks: () => call("todayTasks"),
        categoriesList: () => call("categoriesList"),
      };
    }
    function backupFacade(call) {
      return {
        backupRun: () => call("backupRun"),
        backupList: () => call("backupList"),
        exportRun: (p) => call("exportRun", p),
      };
    }
    function createHostClient(transport) {
      const call = (command, params) => transport.send(command, params);
      const pageOpenListeners = /* @__PURE__ */ new Set();
      transport.on("pageOpen", (event) => {
        for (const listener of pageOpenListeners) {
          listener(event);
        }
      });
      return {
        ...taskFacade(call),
        ...radioFacade(call),
        ...dispatchFacade(call),
        ...backpackFacade(call),
        ...miscFacade(call),
        ...backupFacade(call),
        ...parityFacade(call),
        onPageOpen(listener) {
          pageOpenListeners.add(listener);
          return () => {
            pageOpenListeners.delete(listener);
          };
        },
      };
    }

    // ../src/pokemon/catalog.json
    var catalog_default = {
      v: 1,
      entries: [
        [1, "bulbasaur", "\u5999\u86D9\u79CD\u5B50", "\u5999\u86D9\u7A2E\u5B50", "Bulbasaur"],
        [2, "ivysaur", "\u5999\u86D9\u8349", "\u5999\u86D9\u8349", "Ivysaur"],
        [3, "venusaur", "\u5999\u86D9\u82B1", "\u5999\u86D9\u82B1", "Venusaur"],
        [4, "charmander", "\u5C0F\u706B\u9F99", "\u5C0F\u706B\u9F8D", "Charmander"],
        [5, "charmeleon", "\u706B\u6050\u9F99", "\u706B\u6050\u9F8D", "Charmeleon"],
        [6, "charizard", "\u55B7\u706B\u9F99", "\u5674\u706B\u9F8D", "Charizard"],
        [7, "squirtle", "\u6770\u5C3C\u9F9F", "\u5091\u5C3C\u9F9C", "Squirtle"],
        [8, "wartortle", "\u5361\u54AA\u9F9F", "\u5361\u54AA\u9F9C", "Wartortle"],
        [9, "blastoise", "\u6C34\u7BAD\u9F9F", "\u6C34\u7BAD\u9F9C", "Blastoise"],
        [10, "caterpie", "\u7EFF\u6BDB\u866B", "\u7DA0\u6BDB\u87F2", "Caterpie"],
        [11, "metapod", "\u94C1\u7532\u86F9", "\u9435\u7532\u86F9", "Metapod"],
        [12, "butterfree", "\u5DF4\u5927\u8776", "\u5DF4\u5927\u8776", "Butterfree"],
        [13, "weedle", "\u72EC\u89D2\u866B", "\u7368\u89D2\u87F2", "Weedle"],
        [14, "kakuna", "\u94C1\u58F3\u86F9", "\u9435\u6BBC\u86F9", "Kakuna"],
        [15, "beedrill", "\u5927\u9488\u8702", "\u5927\u91DD\u8702", "Beedrill"],
        [16, "pidgey", "\u6CE2\u6CE2", "\u6CE2\u6CE2", "Pidgey"],
        [17, "pidgeotto", "\u6BD4\u6BD4\u9E1F", "\u6BD4\u6BD4\u9CE5", "Pidgeotto"],
        [18, "pidgeot", "\u5927\u6BD4\u9E1F", "\u5927\u6BD4\u9CE5", "Pidgeot"],
        [19, "rattata", "\u5C0F\u62C9\u8FBE", "\u5C0F\u62C9\u9054", "Rattata"],
        [20, "raticate", "\u62C9\u8FBE", "\u62C9\u9054", "Raticate"],
        [21, "spearow", "\u70C8\u96C0", "\u70C8\u96C0", "Spearow"],
        [22, "fearow", "\u5927\u5634\u96C0", "\u5927\u5634\u96C0", "Fearow"],
        [23, "ekans", "\u963F\u67CF\u86C7", "\u963F\u67CF\u86C7", "Ekans"],
        [24, "arbok", "\u963F\u67CF\u602A", "\u963F\u67CF\u602A", "Arbok"],
        [25, "pikachu", "\u76AE\u5361\u4E18", "\u76AE\u5361\u4E18", "Pikachu"],
        [26, "raichu", "\u96F7\u4E18", "\u96F7\u4E18", "Raichu"],
        [27, "sandshrew", "\u7A7F\u5C71\u9F20", "\u7A7F\u5C71\u9F20", "Sandshrew"],
        [28, "sandslash", "\u7A7F\u5C71\u738B", "\u7A7F\u5C71\u738B", "Sandslash"],
        [29, "nidoran-f", "\u5C3C\u591A\u5170", "\u5C3C\u591A\u862D", "Nidoran\u2640"],
        [30, "nidorina", "\u5C3C\u591A\u5A1C", "\u5C3C\u591A\u5A1C", "Nidorina"],
        [31, "nidoqueen", "\u5C3C\u591A\u540E", "\u5C3C\u591A\u540E", "Nidoqueen"],
        [32, "nidoran-m", "\u5C3C\u591A\u6717", "\u5C3C\u591A\u6717", "Nidoran\u2642"],
        [33, "nidorino", "\u5C3C\u591A\u529B\u8BFA", "\u5C3C\u591A\u529B\u8AFE", "Nidorino"],
        [34, "nidoking", "\u5C3C\u591A\u738B", "\u5C3C\u591A\u738B", "Nidoking"],
        [35, "clefairy", "\u76AE\u76AE", "\u76AE\u76AE", "Clefairy"],
        [36, "clefable", "\u76AE\u53EF\u897F", "\u76AE\u53EF\u897F", "Clefable"],
        [37, "vulpix", "\u516D\u5C3E", "\u516D\u5C3E", "Vulpix"],
        [38, "ninetales", "\u4E5D\u5C3E", "\u4E5D\u5C3E", "Ninetales"],
        [39, "jigglypuff", "\u80D6\u4E01", "\u80D6\u4E01", "Jigglypuff"],
        [40, "wigglytuff", "\u80D6\u53EF\u4E01", "\u80D6\u53EF\u4E01", "Wigglytuff"],
        [41, "zubat", "\u8D85\u97F3\u8760", "\u8D85\u97F3\u8760", "Zubat"],
        [42, "golbat", "\u5927\u5634\u8760", "\u5927\u5634\u8760", "Golbat"],
        [43, "oddish", "\u8D70\u8DEF\u8349", "\u8D70\u8DEF\u8349", "Oddish"],
        [44, "gloom", "\u81ED\u81ED\u82B1", "\u81ED\u81ED\u82B1", "Gloom"],
        [45, "vileplume", "\u9738\u738B\u82B1", "\u9738\u738B\u82B1", "Vileplume"],
        [46, "paras", "\u6D3E\u62C9\u65AF", "\u6D3E\u62C9\u65AF", "Paras"],
        [47, "parasect", "\u6D3E\u62C9\u65AF\u7279", "\u6D3E\u62C9\u65AF\u7279", "Parasect"],
        [48, "venonat", "\u6BDB\u7403", "\u6BDB\u7403", "Venonat"],
        [49, "venomoth", "\u6469\u9C81\u86FE", "\u6469\u9B6F\u86FE", "Venomoth"],
        [50, "diglett", "\u5730\u9F20", "\u5730\u9F20", "Diglett"],
        [51, "dugtrio", "\u4E09\u5730\u9F20", "\u4E09\u5730\u9F20", "Dugtrio"],
        [52, "meowth", "\u55B5\u55B5", "\u55B5\u55B5", "Meowth"],
        [53, "persian", "\u732B\u8001\u5927", "\u8C93\u8001\u5927", "Persian"],
        [54, "psyduck", "\u53EF\u8FBE\u9E2D", "\u53EF\u9054\u9D28", "Psyduck"],
        [55, "golduck", "\u54E5\u8FBE\u9E2D", "\u54E5\u9054\u9D28", "Golduck"],
        [56, "mankey", "\u7334\u602A", "\u7334\u602A", "Mankey"],
        [57, "primeape", "\u706B\u66B4\u7334", "\u706B\u7206\u7334", "Primeape"],
        [58, "growlithe", "\u5361\u8482\u72D7", "\u5361\u8482\u72D7", "Growlithe"],
        [59, "arcanine", "\u98CE\u901F\u72D7", "\u98A8\u901F\u72D7", "Arcanine"],
        [60, "poliwag", "\u868A\u9999\u874C\u86AA", "\u868A\u9999\u874C\u86AA", "Poliwag"],
        [61, "poliwhirl", "\u868A\u9999\u541B", "\u868A\u9999\u541B", "Poliwhirl"],
        [62, "poliwrath", "\u868A\u9999\u6CF3\u58EB", "\u868A\u9999\u6CF3\u58EB", "Poliwrath"],
        [63, "abra", "\u51EF\u897F", "\u51F1\u897F", "Abra"],
        [64, "kadabra", "\u52C7\u57FA\u62C9", "\u52C7\u57FA\u62C9", "Kadabra"],
        [65, "alakazam", "\u80E1\u5730", "\u80E1\u5730", "Alakazam"],
        [66, "machop", "\u8155\u529B", "\u8155\u529B", "Machop"],
        [67, "machoke", "\u8C6A\u529B", "\u8C6A\u529B", "Machoke"],
        [68, "machamp", "\u602A\u529B", "\u602A\u529B", "Machamp"],
        [69, "bellsprout", "\u5587\u53ED\u82BD", "\u5587\u53ED\u82BD", "Bellsprout"],
        [70, "weepinbell", "\u53E3\u5446\u82B1", "\u53E3\u5446\u82B1", "Weepinbell"],
        [71, "victreebel", "\u5927\u98DF\u82B1", "\u5927\u98DF\u82B1", "Victreebel"],
        [72, "tentacool", "\u739B\u7459\u6C34\u6BCD", "\u746A\u7459\u6C34\u6BCD", "Tentacool"],
        [73, "tentacruel", "\u6BD2\u523A\u6C34\u6BCD", "\u6BD2\u523A\u6C34\u6BCD", "Tentacruel"],
        [74, "geodude", "\u5C0F\u62F3\u77F3", "\u5C0F\u62F3\u77F3", "Geodude"],
        [75, "graveler", "\u9686\u9686\u77F3", "\u9686\u9686\u77F3", "Graveler"],
        [76, "golem", "\u9686\u9686\u5CA9", "\u9686\u9686\u5CA9", "Golem"],
        [77, "ponyta", "\u5C0F\u706B\u9A6C", "\u5C0F\u706B\u99AC", "Ponyta"],
        [78, "rapidash", "\u70C8\u7130\u9A6C", "\u70C8\u7130\u99AC", "Rapidash"],
        [79, "slowpoke", "\u5446\u5446\u517D", "\u5446\u5446\u7378", "Slowpoke"],
        [80, "slowbro", "\u5446\u58F3\u517D", "\u5446\u6BBC\u7378", "Slowbro"],
        [81, "magnemite", "\u5C0F\u78C1\u602A", "\u5C0F\u78C1\u602A", "Magnemite"],
        [82, "magneton", "\u4E09\u5408\u4E00\u78C1\u602A", "\u4E09\u5408\u4E00\u78C1\u602A", "Magneton"],
        [83, "farfetchd", "\u5927\u8471\u9E2D", "\u5927\u8525\u9D28", "Farfetch\u2019d"],
        [84, "doduo", "\u561F\u561F", "\u561F\u561F", "Doduo"],
        [85, "dodrio", "\u561F\u561F\u5229", "\u561F\u561F\u5229", "Dodrio"],
        [86, "seel", "\u5C0F\u6D77\u72EE", "\u5C0F\u6D77\u7345", "Seel"],
        [87, "dewgong", "\u767D\u6D77\u72EE", "\u767D\u6D77\u7345", "Dewgong"],
        [88, "grimer", "\u81ED\u6CE5", "\u81ED\u6CE5", "Grimer"],
        [89, "muk", "\u81ED\u81ED\u6CE5", "\u81ED\u81ED\u6CE5", "Muk"],
        [90, "shellder", "\u5927\u820C\u8D1D", "\u5927\u820C\u8C9D", "Shellder"],
        [91, "cloyster", "\u523A\u7532\u8D1D", "\u523A\u7532\u8C9D", "Cloyster"],
        [92, "gastly", "\u9B3C\u65AF", "\u9B3C\u65AF", "Gastly"],
        [93, "haunter", "\u9B3C\u65AF\u901A", "\u9B3C\u65AF\u901A", "Haunter"],
        [94, "gengar", "\u803F\u9B3C", "\u803F\u9B3C", "Gengar"],
        [95, "onix", "\u5927\u5CA9\u86C7", "\u5927\u5CA9\u86C7", "Onix"],
        [96, "drowzee", "\u50AC\u7720\u8C98", "\u50AC\u7720\u8C98", "Drowzee"],
        [97, "hypno", "\u5F15\u68A6\u8C98\u4EBA", "\u5F15\u5922\u8C98\u4EBA", "Hypno"],
        [98, "krabby", "\u5927\u94B3\u87F9", "\u5927\u9257\u87F9", "Krabby"],
        [99, "kingler", "\u5DE8\u94B3\u87F9", "\u5DE8\u9257\u87F9", "Kingler"],
        [100, "voltorb", "\u9739\u96F3\u7535\u7403", "\u9739\u9742\u96FB\u7403", "Voltorb"],
        [101, "electrode", "\u987D\u76AE\u96F7\u5F39", "\u9811\u76AE\u96F7\u5F48", "Electrode"],
        [102, "exeggcute", "\u86CB\u86CB", "\u86CB\u86CB", "Exeggcute"],
        [103, "exeggutor", "\u6930\u86CB\u6811", "\u6930\u86CB\u6A39", "Exeggutor"],
        [104, "cubone", "\u5361\u62C9\u5361\u62C9", "\u5361\u62C9\u5361\u62C9", "Cubone"],
        [105, "marowak", "\u560E\u5566\u560E\u5566", "\u560E\u5566\u560E\u5566", "Marowak"],
        [106, "hitmonlee", "\u98DE\u817F\u90CE", "\u98DB\u817F\u90CE", "Hitmonlee"],
        [107, "hitmonchan", "\u5FEB\u62F3\u90CE", "\u5FEB\u62F3\u90CE", "Hitmonchan"],
        [108, "lickitung", "\u5927\u820C\u5934", "\u5927\u820C\u982D", "Lickitung"],
        [109, "koffing", "\u74E6\u65AF\u5F39", "\u74E6\u65AF\u5F48", "Koffing"],
        [110, "weezing", "\u53CC\u5F39\u74E6\u65AF", "\u96D9\u5F48\u74E6\u65AF", "Weezing"],
        [111, "rhyhorn", "\u72EC\u89D2\u7280\u725B", "\u7368\u89D2\u7280\u725B", "Rhyhorn"],
        [112, "rhydon", "\u94BB\u89D2\u7280\u517D", "\u947D\u89D2\u7280\u7378", "Rhydon"],
        [113, "chansey", "\u5409\u5229\u86CB", "\u5409\u5229\u86CB", "Chansey"],
        [114, "tangela", "\u8513\u85E4\u602A", "\u8513\u85E4\u602A", "Tangela"],
        [115, "kangaskhan", "\u888B\u517D", "\u888B\u7378", "Kangaskhan"],
        [116, "horsea", "\u58A8\u6D77\u9A6C", "\u58A8\u6D77\u99AC", "Horsea"],
        [117, "seadra", "\u6D77\u523A\u9F99", "\u6D77\u523A\u9F8D", "Seadra"],
        [118, "goldeen", "\u89D2\u91D1\u9C7C", "\u89D2\u91D1\u9B5A", "Goldeen"],
        [119, "seaking", "\u91D1\u9C7C\u738B", "\u91D1\u9B5A\u738B", "Seaking"],
        [120, "staryu", "\u6D77\u661F\u661F", "\u6D77\u661F\u661F", "Staryu"],
        [121, "starmie", "\u5B9D\u77F3\u6D77\u661F", "\u5BF6\u77F3\u6D77\u661F", "Starmie"],
        [122, "mr-mime", "\u9B54\u5899\u4EBA\u5076", "\u9B54\u7246\u4EBA\u5076", "Mr. Mime"],
        [123, "scyther", "\u98DE\u5929\u87B3\u8782", "\u98DB\u5929\u87B3\u8782", "Scyther"],
        [124, "jynx", "\u8FF7\u5507\u59D0", "\u8FF7\u5507\u59D0", "Jynx"],
        [125, "electabuzz", "\u7535\u51FB\u517D", "\u96FB\u64CA\u7378", "Electabuzz"],
        [126, "magmar", "\u9E2D\u5634\u706B\u517D", "\u9D28\u5634\u706B\u7378", "Magmar"],
        [127, "pinsir", "\u51EF\u7F57\u65AF", "\u51F1\u7F85\u65AF", "Pinsir"],
        [128, "tauros", "\u80AF\u6CF0\u7F57", "\u80AF\u6CF0\u7F85", "Tauros"],
        [129, "magikarp", "\u9CA4\u9C7C\u738B", "\u9BC9\u9B5A\u738B", "Magikarp"],
        [130, "gyarados", "\u66B4\u9CA4\u9F99", "\u66B4\u9BC9\u9F8D", "Gyarados"],
        [131, "lapras", "\u62C9\u666E\u62C9\u65AF", "\u62C9\u666E\u62C9\u65AF", "Lapras"],
        [132, "ditto", "\u767E\u53D8\u602A", "\u767E\u8B8A\u602A", "Ditto"],
        [133, "eevee", "\u4F0A\u5E03", "\u4F0A\u5E03", "Eevee"],
        [134, "vaporeon", "\u6C34\u4F0A\u5E03", "\u6C34\u4F0A\u5E03", "Vaporeon"],
        [135, "jolteon", "\u96F7\u4F0A\u5E03", "\u96F7\u4F0A\u5E03", "Jolteon"],
        [136, "flareon", "\u706B\u4F0A\u5E03", "\u706B\u4F0A\u5E03", "Flareon"],
        [137, "porygon", "\u591A\u8FB9\u517D", "\u591A\u908A\u7378", "Porygon"],
        [138, "omanyte", "\u83CA\u77F3\u517D", "\u83CA\u77F3\u7378", "Omanyte"],
        [139, "omastar", "\u591A\u523A\u83CA\u77F3\u517D", "\u591A\u523A\u83CA\u77F3\u7378", "Omastar"],
        [140, "kabuto", "\u5316\u77F3\u76D4", "\u5316\u77F3\u76D4", "Kabuto"],
        [141, "kabutops", "\u9570\u5200\u76D4", "\u942E\u5200\u76D4", "Kabutops"],
        [142, "aerodactyl", "\u5316\u77F3\u7FFC\u9F99", "\u5316\u77F3\u7FFC\u9F8D", "Aerodactyl"],
        [143, "snorlax", "\u5361\u6BD4\u517D", "\u5361\u6BD4\u7378", "Snorlax"],
        [144, "articuno", "\u6025\u51BB\u9E1F", "\u6025\u51CD\u9CE5", "Articuno"],
        [145, "zapdos", "\u95EA\u7535\u9E1F", "\u9583\u96FB\u9CE5", "Zapdos"],
        [146, "moltres", "\u706B\u7130\u9E1F", "\u706B\u7130\u9CE5", "Moltres"],
        [147, "dratini", "\u8FF7\u4F60\u9F99", "\u8FF7\u4F60\u9F8D", "Dratini"],
        [148, "dragonair", "\u54C8\u514B\u9F99", "\u54C8\u514B\u9F8D", "Dragonair"],
        [149, "dragonite", "\u5FEB\u9F99", "\u5FEB\u9F8D", "Dragonite"],
        [150, "mewtwo", "\u8D85\u68A6", "\u8D85\u5922", "Mewtwo"],
        [151, "mew", "\u68A6\u5E7B", "\u5922\u5E7B", "Mew"],
        [152, "chikorita", "\u83CA\u8349\u53F6", "\u83CA\u8349\u8449", "Chikorita"],
        [153, "bayleef", "\u6708\u6842\u53F6", "\u6708\u6842\u8449", "Bayleef"],
        [154, "meganium", "\u5927\u7AFA\u8475", "\u5927\u7AFA\u8475", "Meganium"],
        [155, "cyndaquil", "\u706B\u7403\u9F20", "\u706B\u7403\u9F20", "Cyndaquil"],
        [156, "quilava", "\u706B\u5CA9\u9F20", "\u706B\u5CA9\u9F20", "Quilava"],
        [157, "typhlosion", "\u706B\u66B4\u517D", "\u706B\u7206\u7378", "Typhlosion"],
        [158, "totodile", "\u5C0F\u952F\u9CC4", "\u5C0F\u92F8\u9C77", "Totodile"],
        [159, "croconaw", "\u84DD\u9CC4", "\u85CD\u9C77", "Croconaw"],
        [160, "feraligatr", "\u5927\u529B\u9CC4", "\u5927\u529B\u9C77", "Feraligatr"],
        [161, "sentret", "\u5C3E\u7ACB", "\u5C3E\u7ACB", "Sentret"],
        [162, "furret", "\u5927\u5C3E\u7ACB", "\u5927\u5C3E\u7ACB", "Furret"],
        [163, "hoothoot", "\u5495\u5495", "\u5495\u5495", "Hoothoot"],
        [164, "noctowl", "\u732B\u5934\u591C\u9E70", "\u8C93\u982D\u591C\u9DF9", "Noctowl"],
        [165, "ledyba", "\u82AD\u74E2\u866B", "\u82AD\u74E2\u87F2", "Ledyba"],
        [166, "ledian", "\u5B89\u74E2\u866B", "\u5B89\u74E2\u87F2", "Ledian"],
        [167, "spinarak", "\u5706\u4E1D\u86DB", "\u5713\u7D72\u86DB", "Spinarak"],
        [168, "ariados", "\u963F\u5229\u591A\u65AF", "\u963F\u5229\u591A\u65AF", "Ariados"],
        [169, "crobat", "\u53C9\u5B57\u8760", "\u53C9\u5B57\u8760", "Crobat"],
        [170, "chinchou", "\u706F\u7B3C\u9C7C", "\u71C8\u7C60\u9B5A", "Chinchou"],
        [171, "lanturn", "\u7535\u706F\u602A", "\u96FB\u71C8\u602A", "Lanturn"],
        [172, "pichu", "\u76AE\u4E18", "\u76AE\u4E18", "Pichu"],
        [173, "cleffa", "\u76AE\u5B9D\u5B9D", "\u76AE\u5BF6\u5BF6", "Cleffa"],
        [174, "igglybuff", "\u5B9D\u5B9D\u4E01", "\u5BF6\u5BF6\u4E01", "Igglybuff"],
        [175, "togepi", "\u6CE2\u514B\u6BD4", "\u6CE2\u514B\u6BD4", "Togepi"],
        [176, "togetic", "\u6CE2\u514B\u57FA\u53E4", "\u6CE2\u514B\u57FA\u53E4", "Togetic"],
        [177, "natu", "\u5929\u7136\u96C0", "\u5929\u7136\u96C0", "Natu"],
        [178, "xatu", "\u5929\u7136\u9E1F", "\u5929\u7136\u9CE5", "Xatu"],
        [179, "mareep", "\u54A9\u5229\u7F8A", "\u54A9\u5229\u7F8A", "Mareep"],
        [180, "flaaffy", "\u8338\u8338\u7F8A", "\u8338\u8338\u7F8A", "Flaaffy"],
        [181, "ampharos", "\u7535\u9F99", "\u96FB\u9F8D", "Ampharos"],
        [182, "bellossom", "\u7F8E\u4E3D\u82B1", "\u7F8E\u9E97\u82B1", "Bellossom"],
        [183, "marill", "\u739B\u529B\u9732", "\u746A\u529B\u9732", "Marill"],
        [184, "azumarill", "\u739B\u529B\u9732\u4E3D", "\u746A\u529B\u9732\u9E97", "Azumarill"],
        [185, "sudowoodo", "\u6811\u624D\u602A", "\u6A39\u624D\u602A", "Sudowoodo"],
        [186, "politoed", "\u868A\u9999\u86D9\u7687", "\u868A\u9999\u86D9\u7687", "Politoed"],
        [187, "hoppip", "\u6BFD\u5B50\u8349", "\u6BFD\u5B50\u8349", "Hoppip"],
        [188, "skiploom", "\u6BFD\u5B50\u82B1", "\u6BFD\u5B50\u82B1", "Skiploom"],
        [189, "jumpluff", "\u6BFD\u5B50\u68C9", "\u6BFD\u5B50\u68C9", "Jumpluff"],
        [190, "aipom", "\u957F\u5C3E\u602A\u624B", "\u9577\u5C3E\u602A\u624B", "Aipom"],
        [191, "sunkern", "\u5411\u65E5\u79CD\u5B50", "\u5411\u65E5\u7A2E\u5B50", "Sunkern"],
        [192, "sunflora", "\u5411\u65E5\u82B1\u602A", "\u5411\u65E5\u82B1\u602A", "Sunflora"],
        [193, "yanma", "\u873B\u873B\u8713", "\u873B\u873B\u8713", "Yanma"],
        [194, "wooper", "\u4E4C\u6CE2", "\u70CF\u6CE2", "Wooper"],
        [195, "quagsire", "\u6CBC\u738B", "\u6CBC\u738B", "Quagsire"],
        [196, "espeon", "\u592A\u9633\u4F0A\u5E03", "\u592A\u967D\u4F0A\u5E03", "Espeon"],
        [197, "umbreon", "\u6708\u4EAE\u4F0A\u5E03", "\u6708\u4EAE\u4F0A\u5E03", "Umbreon"],
        [198, "murkrow", "\u9ED1\u6697\u9E26", "\u9ED1\u6697\u9D09", "Murkrow"],
        [199, "slowking", "\u5446\u5446\u738B", "\u5446\u5446\u738B", "Slowking"],
        [200, "misdreavus", "\u68A6\u5996", "\u5922\u5996", "Misdreavus"],
        [201, "unown", "\u672A\u77E5\u56FE\u817E", "\u672A\u77E5\u5716\u9A30", "Unown"],
        [202, "wobbuffet", "\u679C\u7136\u7FC1", "\u679C\u7136\u7FC1", "Wobbuffet"],
        [203, "girafarig", "\u9E92\u9E9F\u5947", "\u9E92\u9E9F\u5947", "Girafarig"],
        [204, "pineco", "\u699B\u679C\u7403", "\u699B\u679C\u7403", "Pineco"],
        [205, "forretress", "\u4F5B\u70C8\u6258\u65AF", "\u4F5B\u70C8\u6258\u65AF", "Forretress"],
        [206, "dunsparce", "\u571F\u9F99\u5F1F\u5F1F", "\u571F\u9F8D\u5F1F\u5F1F", "Dunsparce"],
        [207, "gligar", "\u5929\u874E", "\u5929\u880D", "Gligar"],
        [208, "steelix", "\u5927\u94A2\u86C7", "\u5927\u92FC\u86C7", "Steelix"],
        [209, "snubbull", "\u5E03\u9C81", "\u5E03\u9B6F", "Snubbull"],
        [210, "granbull", "\u5E03\u9C81\u7687", "\u5E03\u9B6F\u7687", "Granbull"],
        [211, "qwilfish", "\u5343\u9488\u9C7C", "\u5343\u91DD\u9B5A", "Qwilfish"],
        [212, "scizor", "\u5DE8\u94B3\u87B3\u8782", "\u5DE8\u9257\u87B3\u8782", "Scizor"],
        [213, "shuckle", "\u58F6\u58F6", "\u58FA\u58FA", "Shuckle"],
        [214, "heracross", "\u8D6B\u62C9\u514B\u7F57\u65AF", "\u8D6B\u62C9\u514B\u7F85\u65AF", "Heracross"],
        [215, "sneasel", "\u72C3\u62C9", "\u72C3\u62C9", "Sneasel"],
        [216, "teddiursa", "\u718A\u5B9D\u5B9D", "\u718A\u5BF6\u5BF6", "Teddiursa"],
        [217, "ursaring", "\u5708\u5708\u718A", "\u5708\u5708\u718A", "Ursaring"],
        [218, "slugma", "\u7194\u5CA9\u866B", "\u7194\u5CA9\u87F2", "Slugma"],
        [219, "magcargo", "\u7194\u5CA9\u8717\u725B", "\u7194\u5CA9\u8778\u725B", "Magcargo"],
        [220, "swinub", "\u5C0F\u5C71\u732A", "\u5C0F\u5C71\u8C6C", "Swinub"],
        [221, "piloswine", "\u957F\u6BDB\u732A", "\u9577\u6BDB\u8C6C", "Piloswine"],
        [222, "corsola", "\u592A\u9633\u73CA\u745A", "\u592A\u967D\u73CA\u745A", "Corsola"],
        [223, "remoraid", "\u94C1\u70AE\u9C7C", "\u9435\u70AE\u9B5A", "Remoraid"],
        [224, "octillery", "\u7AE0\u9C7C\u6876", "\u7AE0\u9B5A\u6876", "Octillery"],
        [225, "delibird", "\u4FE1\u4F7F\u9E1F", "\u4FE1\u4F7F\u9CE5", "Delibird"],
        [226, "mantine", "\u5DE8\u7FC5\u98DE\u9C7C", "\u5DE8\u7FC5\u98DB\u9B5A", "Mantine"],
        [227, "skarmory", "\u76D4\u7532\u9E1F", "\u76D4\u7532\u9CE5", "Skarmory"],
        [228, "houndour", "\u6234\u9C81\u6BD4", "\u6234\u9B6F\u6BD4", "Houndour"],
        [229, "houndoom", "\u9ED1\u9C81\u52A0", "\u9ED1\u9B6F\u52A0", "Houndoom"],
        [230, "kingdra", "\u523A\u9F99\u738B", "\u523A\u9F8D\u738B", "Kingdra"],
        [231, "phanpy", "\u5C0F\u5C0F\u8C61", "\u5C0F\u5C0F\u8C61", "Phanpy"],
        [232, "donphan", "\u987F\u7532", "\u9813\u7532", "Donphan"],
        [233, "porygon2", "\u591A\u8FB9\u517D\uFF12\u578B", "\u591A\u908A\u7378\u2161", "Porygon2"],
        [234, "stantler", "\u60CA\u89D2\u9E7F", "\u9A5A\u89D2\u9E7F", "Stantler"],
        [235, "smeargle", "\u56FE\u56FE\u72AC", "\u5716\u5716\u72AC", "Smeargle"],
        [236, "tyrogue", "\u65E0\u754F\u5C0F\u5B50", "\u7121\u754F\u5C0F\u5B50", "Tyrogue"],
        [237, "hitmontop", "\u6218\u821E\u90CE", "\u6230\u821E\u90CE", "Hitmontop"],
        [238, "smoochum", "\u8FF7\u5507\u5A03", "\u8FF7\u5507\u5A03", "Smoochum"],
        [239, "elekid", "\u7535\u51FB\u602A", "\u96FB\u64CA\u602A", "Elekid"],
        [240, "magby", "\u9E2D\u5634\u5B9D\u5B9D", "\u9D28\u5634\u5BF6\u5BF6", "Magby"],
        [241, "miltank", "\u5927\u5976\u7F50", "\u5927\u5976\u7F50", "Miltank"],
        [242, "blissey", "\u5E78\u798F\u86CB", "\u5E78\u798F\u86CB", "Blissey"],
        [243, "raikou", "\u96F7\u516C", "\u96F7\u516C", "Raikou"],
        [244, "entei", "\u708E\u5E1D", "\u708E\u5E1D", "Entei"],
        [245, "suicune", "\u6C34\u541B", "\u6C34\u541B", "Suicune"],
        [246, "larvitar", "\u5E7C\u57FA\u62C9\u65AF", "\u5E7C\u57FA\u62C9\u65AF", "Larvitar"],
        [247, "pupitar", "\u6C99\u57FA\u62C9\u65AF", "\u6C99\u57FA\u62C9\u65AF", "Pupitar"],
        [248, "tyranitar", "\u73ED\u57FA\u62C9\u65AF", "\u73ED\u57FA\u62C9\u65AF", "Tyranitar"],
        [249, "lugia", "\u6D1B\u5947\u4E9A", "\u6D1B\u5947\u4E9E", "Lugia"],
        [250, "ho-oh", "\u51E4\u738B", "\u9CF3\u738B", "Ho-Oh"],
        [251, "celebi", "\u65F6\u62C9\u6BD4", "\u6642\u62C9\u6BD4", "Celebi"],
        [252, "treecko", "\u6728\u5B88\u5BAB", "\u6728\u5B88\u5BAE", "Treecko"],
        [253, "grovyle", "\u68EE\u6797\u8725\u8734", "\u68EE\u6797\u8725\u8734", "Grovyle"],
        [254, "sceptile", "\u8725\u8734\u738B", "\u8725\u8734\u738B", "Sceptile"],
        [255, "torchic", "\u706B\u7A1A\u9E21", "\u706B\u7A1A\u96DE", "Torchic"],
        [256, "combusken", "\u529B\u58EE\u9E21", "\u529B\u58EF\u96DE", "Combusken"],
        [257, "blaziken", "\u706B\u7130\u9E21", "\u706B\u7130\u96DE", "Blaziken"],
        [258, "mudkip", "\u6C34\u8DC3\u9C7C", "\u6C34\u8E8D\u9B5A", "Mudkip"],
        [259, "marshtomp", "\u6CBC\u8DC3\u9C7C", "\u6CBC\u8E8D\u9B5A", "Marshtomp"],
        [260, "swampert", "\u5DE8\u6CBC\u602A", "\u5DE8\u6CBC\u602A", "Swampert"],
        [261, "poochyena", "\u571F\u72FC\u72AC", "\u571F\u72FC\u72AC", "Poochyena"],
        [262, "mightyena", "\u5927\u72FC\u72AC", "\u5927\u72FC\u72AC", "Mightyena"],
        [263, "zigzagoon", "\u86C7\u7EB9\u718A", "\u86C7\u7D0B\u718A", "Zigzagoon"],
        [264, "linoone", "\u76F4\u51B2\u718A", "\u76F4\u885D\u718A", "Linoone"],
        [265, "wurmple", "\u523A\u5C3E\u866B", "\u523A\u5C3E\u87F2", "Wurmple"],
        [266, "silcoon", "\u7532\u58F3\u8327", "\u7532\u6BBC\u7E6D", "Silcoon"],
        [267, "beautifly", "\u72E9\u730E\u51E4\u8776", "\u72E9\u7375\u9CF3\u8776", "Beautifly"],
        [268, "cascoon", "\u76FE\u7532\u8327", "\u76FE\u7532\u7E6D", "Cascoon"],
        [269, "dustox", "\u6BD2\u7C89\u86FE", "\u6BD2\u7C89\u86FE", "Dustox"],
        [270, "lotad", "\u83B2\u53F6\u7AE5\u5B50", "\u84EE\u8449\u7AE5\u5B50", "Lotad"],
        [271, "lombre", "\u83B2\u5E3D\u5C0F\u7AE5", "\u84EE\u5E3D\u5C0F\u7AE5", "Lombre"],
        [272, "ludicolo", "\u4E50\u5929\u6CB3\u7AE5", "\u6A02\u5929\u6CB3\u7AE5", "Ludicolo"],
        [273, "seedot", "\u6A61\u5B9E\u679C", "\u6A61\u5BE6\u679C", "Seedot"],
        [274, "nuzleaf", "\u957F\u9F3B\u53F6", "\u9577\u9F3B\u8449", "Nuzleaf"],
        [275, "shiftry", "\u72E1\u733E\u5929\u72D7", "\u72E1\u733E\u5929\u72D7", "Shiftry"],
        [276, "taillow", "\u50B2\u9AA8\u71D5", "\u50B2\u9AA8\u71D5", "Taillow"],
        [277, "swellow", "\u5927\u738B\u71D5", "\u5927\u738B\u71D5", "Swellow"],
        [278, "wingull", "\u957F\u7FC5\u9E25", "\u9577\u7FC5\u9DD7", "Wingull"],
        [279, "pelipper", "\u5927\u5634\u9E25", "\u5927\u5634\u9DD7", "Pelipper"],
        [280, "ralts", "\u62C9\u9C81\u62C9\u4E1D", "\u62C9\u9B6F\u62C9\u7D72", "Ralts"],
        [281, "kirlia", "\u5947\u9C81\u8389\u5B89", "\u5947\u9B6F\u8389\u5B89", "Kirlia"],
        [282, "gardevoir", "\u6C99\u5948\u6735", "\u6C99\u5948\u6735", "Gardevoir"],
        [283, "surskit", "\u6E9C\u6E9C\u7CD6\u7403", "\u6E9C\u6E9C\u7CD6\u7403", "Surskit"],
        [284, "masquerain", "\u96E8\u7FC5\u86FE", "\u96E8\u7FC5\u86FE", "Masquerain"],
        [285, "shroomish", "\u8611\u8611\u83C7", "\u8611\u8611\u83C7", "Shroomish"],
        [286, "breloom", "\u6597\u7B20\u83C7", "\u6597\u7B20\u83C7", "Breloom"],
        [287, "slakoth", "\u61D2\u4EBA\u736D", "\u61F6\u4EBA\u737A", "Slakoth"],
        [288, "vigoroth", "\u8FC7\u52A8\u733F", "\u904E\u52D5\u733F", "Vigoroth"],
        [289, "slaking", "\u8BF7\u5047\u738B", "\u8ACB\u5047\u738B", "Slaking"],
        [290, "nincada", "\u571F\u5C45\u5FCD\u58EB", "\u571F\u5C45\u5FCD\u58EB", "Nincada"],
        [291, "ninjask", "\u94C1\u9762\u5FCD\u8005", "\u9435\u9762\u5FCD\u8005", "Ninjask"],
        [292, "shedinja", "\u8131\u58F3\u5FCD\u8005", "\u812B\u6BBC\u5FCD\u8005", "Shedinja"],
        [293, "whismur", "\u5495\u599E\u599E", "\u5495\u599E\u599E", "Whismur"],
        [294, "loudred", "\u543C\u7206\u5F39", "\u543C\u7206\u5F48", "Loudred"],
        [295, "exploud", "\u7206\u97F3\u602A", "\u7206\u97F3\u602A", "Exploud"],
        [296, "makuhita", "\u5E55\u4E0B\u529B\u58EB", "\u5E55\u4E0B\u529B\u58EB", "Makuhita"],
        [297, "hariyama", "\u94C1\u638C\u529B\u58EB", "\u9435\u638C\u529B\u58EB", "Hariyama"],
        [298, "azurill", "\u9732\u529B\u4E3D", "\u9732\u529B\u9E97", "Azurill"],
        [299, "nosepass", "\u671D\u5317\u9F3B", "\u671D\u5317\u9F3B", "Nosepass"],
        [300, "skitty", "\u5411\u5C3E\u55B5", "\u5411\u5C3E\u55B5", "Skitty"],
        [301, "delcatty", "\u4F18\u96C5\u732B", "\u512A\u96C5\u8C93", "Delcatty"],
        [302, "sableye", "\u52FE\u9B42\u773C", "\u52FE\u9B42\u773C", "Sableye"],
        [303, "mawile", "\u5927\u5634\u5A03", "\u5927\u5634\u5A03", "Mawile"],
        [304, "aron", "\u53EF\u53EF\u591A\u62C9", "\u53EF\u53EF\u591A\u62C9", "Aron"],
        [305, "lairon", "\u53EF\u591A\u62C9", "\u53EF\u591A\u62C9", "Lairon"],
        [306, "aggron", "\u6CE2\u58EB\u53EF\u591A\u62C9", "\u6CE2\u58EB\u53EF\u591A\u62C9", "Aggron"],
        [307, "meditite", "\u739B\u6C99\u90A3", "\u746A\u6C99\u90A3", "Meditite"],
        [308, "medicham", "\u6070\u96F7\u59C6", "\u6070\u96F7\u59C6", "Medicham"],
        [309, "electrike", "\u843D\u96F7\u517D", "\u843D\u96F7\u7378", "Electrike"],
        [310, "manectric", "\u96F7\u7535\u517D", "\u96F7\u96FB\u7378", "Manectric"],
        [311, "plusle", "\u6B63\u7535\u62CD\u62CD", "\u6B63\u96FB\u62CD\u62CD", "Plusle"],
        [312, "minun", "\u8CA0\u7535\u62CD\u62CD", "\u8CA0\u96FB\u62CD\u62CD", "Minun"],
        [313, "volbeat", "\u7535\u8424\u866B", "\u96FB\u87A2\u87F2", "Volbeat"],
        [314, "illumise", "\u751C\u751C\u8424", "\u751C\u751C\u87A2", "Illumise"],
        [315, "roselia", "\u6BD2\u8537\u8587", "\u6BD2\u8594\u8587", "Roselia"],
        [316, "gulpin", "\u6EB6\u98DF\u517D", "\u6EB6\u98DF\u7378", "Gulpin"],
        [317, "swalot", "\u541E\u98DF\u517D", "\u541E\u98DF\u7378", "Swalot"],
        [318, "carvanha", "\u5229\u7259\u9C7C", "\u5229\u7259\u9B5A", "Carvanha"],
        [319, "sharpedo", "\u5DE8\u7259\u9CA8", "\u5DE8\u7259\u9BCA", "Sharpedo"],
        [320, "wailmer", "\u543C\u543C\u9CB8", "\u543C\u543C\u9BE8", "Wailmer"],
        [321, "wailord", "\u543C\u9CB8\u738B", "\u543C\u9BE8\u738B", "Wailord"],
        [322, "numel", "\u5446\u706B\u9A7C", "\u5446\u706B\u99DD", "Numel"],
        [323, "camerupt", "\u55B7\u706B\u9A7C", "\u5674\u706B\u99DD", "Camerupt"],
        [324, "torkoal", "\u7164\u70AD\u9F9F", "\u7164\u70AD\u9F9C", "Torkoal"],
        [325, "spoink", "\u8DF3\u8DF3\u732A", "\u8DF3\u8DF3\u8C6C", "Spoink"],
        [326, "grumpig", "\u5657\u5657\u732A", "\u5657\u5657\u8C6C", "Grumpig"],
        [327, "spinda", "\u6643\u6643\u6591", "\u6643\u6643\u6591", "Spinda"],
        [328, "trapinch", "\u5927\u989A\u8681", "\u5927\u984E\u87FB", "Trapinch"],
        [329, "vibrava", "\u8D85\u97F3\u6CE2\u5E7C\u866B", "\u8D85\u97F3\u6CE2\u5E7C\u87F2", "Vibrava"],
        [330, "flygon", "\u6C99\u6F20\u873B\u8713", "\u6C99\u6F20\u873B\u8713", "Flygon"],
        [331, "cacnea", "\u523A\u7403\u4ED9\u4EBA\u638C", "\u523A\u7403\u4ED9\u4EBA\u638C", "Cacnea"],
        [332, "cacturne", "\u68A6\u6B4C\u4ED9\u4EBA\u638C", "\u5922\u6B4C\u4ED9\u4EBA\u638C", "Cacturne"],
        [333, "swablu", "\u9752\u7EF5\u9E1F", "\u9752\u7DBF\u9CE5", "Swablu"],
        [334, "altaria", "\u4E03\u5915\u9752\u9E1F", "\u4E03\u5915\u9752\u9CE5", "Altaria"],
        [335, "zangoose", "\u732B\u9F2C\u65A9", "\u8C93\u9F2C\u65AC", "Zangoose"],
        [336, "seviper", "\u996D\u5319\u86C7", "\u98EF\u5319\u86C7", "Seviper"],
        [337, "lunatone", "\u6708\u77F3", "\u6708\u77F3", "Lunatone"],
        [338, "solrock", "\u592A\u9633\u5CA9", "\u592A\u967D\u5CA9", "Solrock"],
        [339, "barboach", "\u6CE5\u6CE5\u9CC5", "\u6CE5\u6CE5\u9C0D", "Barboach"],
        [340, "whiscash", "\u9CB6\u9C7C\u738B", "\u9BF0\u9B5A\u738B", "Whiscash"],
        [341, "corphish", "\u9F99\u867E\u5C0F\u5175", "\u9F8D\u8766\u5C0F\u5175", "Corphish"],
        [342, "crawdaunt", "\u94C1\u87AF\u9F99\u867E", "\u9435\u87AF\u9F8D\u8766", "Crawdaunt"],
        [343, "baltoy", "\u5929\u79E4\u5076", "\u5929\u79E4\u5076", "Baltoy"],
        [344, "claydol", "\u5FF5\u529B\u571F\u5076", "\u5FF5\u529B\u571F\u5076", "Claydol"],
        [345, "lileep", "\u89E6\u624B\u767E\u5408", "\u89F8\u624B\u767E\u5408", "Lileep"],
        [346, "cradily", "\u6447\u7BEE\u767E\u5408", "\u6416\u7C43\u767E\u5408", "Cradily"],
        [347, "anorith", "\u592A\u53E4\u7FBD\u866B", "\u592A\u53E4\u7FBD\u87F2", "Anorith"],
        [348, "armaldo", "\u592A\u53E4\u76D4\u7532", "\u592A\u53E4\u76D4\u7532", "Armaldo"],
        [349, "feebas", "\u4E11\u4E11\u9C7C", "\u919C\u919C\u9B5A", "Feebas"],
        [350, "milotic", "\u7F8E\u7EB3\u65AF", "\u7F8E\u7D0D\u65AF", "Milotic"],
        [351, "castform", "\u98D8\u6D6E\u6CE1\u6CE1", "\u98C4\u6D6E\u6CE1\u6CE1", "Castform"],
        [352, "kecleon", "\u53D8\u9690\u9F99", "\u8B8A\u96B1\u9F8D", "Kecleon"],
        [353, "shuppet", "\u6028\u5F71\u5A03\u5A03", "\u6028\u5F71\u5A03\u5A03", "Shuppet"],
        [354, "banette", "\u8BC5\u5492\u5A03\u5A03", "\u8A5B\u5492\u5A03\u5A03", "Banette"],
        [355, "duskull", "\u591C\u5DE1\u7075", "\u591C\u5DE1\u9748", "Duskull"],
        [356, "dusclops", "\u5F77\u5FA8\u591C\u7075", "\u5F77\u5FA8\u591C\u9748", "Dusclops"],
        [357, "tropius", "\u70ED\u5E26\u9F99", "\u71B1\u5E36\u9F8D", "Tropius"],
        [358, "chimecho", "\u98CE\u94C3\u94C3", "\u98A8\u9234\u9234", "Chimecho"],
        [359, "absol", "\u963F\u52C3\u68AD\u9C81", "\u963F\u52C3\u68AD\u9B6F", "Absol"],
        [360, "wynaut", "\u5C0F\u679C\u7136", "\u5C0F\u679C\u7136", "Wynaut"],
        [361, "snorunt", "\u96EA\u7AE5\u5B50", "\u96EA\u7AE5\u5B50", "Snorunt"],
        [362, "glalie", "\u51B0\u9B3C\u62A4", "\u51B0\u9B3C\u8B77", "Glalie"],
        [363, "spheal", "\u6D77\u8C79\u7403", "\u6D77\u8C79\u7403", "Spheal"],
        [364, "sealeo", "\u6D77\u9B54\u72EE", "\u6D77\u9B54\u7345", "Sealeo"],
        [365, "walrein", "\u5E1D\u7259\u6D77\u72EE", "\u5E1D\u7259\u6D77\u7345", "Walrein"],
        [366, "clamperl", "\u73CD\u73E0\u8D1D", "\u73CD\u73E0\u8C9D", "Clamperl"],
        [367, "huntail", "\u730E\u6591\u9C7C", "\u7375\u6591\u9B5A", "Huntail"],
        [368, "gorebyss", "\u6A31\u82B1\u9C7C", "\u6AFB\u82B1\u9B5A", "Gorebyss"],
        [369, "relicanth", "\u53E4\u7A7A\u68D8\u9C7C", "\u53E4\u7A7A\u68D8\u9B5A", "Relicanth"],
        [370, "luvdisc", "\u7231\u5FC3\u9C7C", "\u611B\u5FC3\u9B5A", "Luvdisc"],
        [371, "bagon", "\u5B9D\u8D1D\u9F99", "\u5BF6\u8C9D\u9F8D", "Bagon"],
        [372, "shelgon", "\u7532\u58F3\u9F99", "\u7532\u6BBC\u9F8D", "Shelgon"],
        [373, "salamence", "\u66B4\u98DE\u9F99", "\u66B4\u98DB\u9F8D", "Salamence"],
        [374, "beldum", "\u94C1\u54D1\u94C3", "\u9435\u555E\u9234", "Beldum"],
        [375, "metang", "\u91D1\u5C5E\u602A", "\u91D1\u5C6C\u602A", "Metang"],
        [376, "metagross", "\u5DE8\u91D1\u602A", "\u5DE8\u91D1\u602A", "Metagross"],
        [377, "regirock", "\u96F7\u5409\u6D1B\u514B", "\u96F7\u5409\u6D1B\u514B", "Regirock"],
        [378, "regice", "\u96F7\u5409\u827E\u65AF", "\u96F7\u5409\u827E\u65AF", "Regice"],
        [379, "registeel", "\u96F7\u5409\u65AF\u5947\u9C81", "\u96F7\u5409\u65AF\u5947\u9B6F", "Registeel"],
        [380, "latias", "\u62C9\u5E1D\u4E9A\u65AF", "\u62C9\u5E1D\u4E9E\u65AF", "Latias"],
        [381, "latios", "\u62C9\u5E1D\u6B27\u65AF", "\u62C9\u5E1D\u6B50\u65AF", "Latios"],
        [382, "kyogre", "\u76D6\u6B27\u5361", "\u84CB\u6B50\u5361", "Kyogre"],
        [383, "groudon", "\u56FA\u62C9\u591A", "\u56FA\u62C9\u591A", "Groudon"],
        [384, "rayquaza", "\u70C8\u7A7A\u5750", "\u70C8\u7A7A\u5750", "Rayquaza"],
        [385, "jirachi", "\u57FA\u62C9\u7948", "\u57FA\u62C9\u7948", "Jirachi"],
        [386, "deoxys", "\u4EE3\u6B27\u5947\u5E0C\u65AF", "\u4EE3\u6B50\u5947\u5E0C\u65AF", "Deoxys"],
        [387, "turtwig", "\u8349\u82D7\u9F9F", "\u8349\u82D7\u9F9C", "Turtwig"],
        [388, "grotle", "\u6811\u6797\u9F9F", "\u6A39\u6797\u9F9C", "Grotle"],
        [389, "torterra", "\u571F\u53F0\u9F9F", "\u571F\u53F0\u9F9C", "Torterra"],
        [390, "chimchar", "\u5C0F\u706B\u7130\u7334", "\u5C0F\u706B\u7130\u7334", "Chimchar"],
        [391, "monferno", "\u731B\u706B\u7334", "\u731B\u706B\u7334", "Monferno"],
        [392, "infernape", "\u70C8\u7130\u7334", "\u70C8\u7130\u7334", "Infernape"],
        [393, "piplup", "\u6CE2\u52A0\u66FC", "\u6CE2\u52A0\u66FC", "Piplup"],
        [394, "prinplup", "\u6CE2\u7687\u5B50", "\u6CE2\u7687\u5B50", "Prinplup"],
        [395, "empoleon", "\u5E1D\u738B\u62FF\u6CE2", "\u5E1D\u738B\u62FF\u6CE2", "Empoleon"],
        [396, "starly", "\u59C6\u514B\u513F", "\u59C6\u514B\u5152", "Starly"],
        [397, "staravia", "\u59C6\u514B\u9E1F", "\u59C6\u514B\u9CE5", "Staravia"],
        [398, "staraptor", "\u59C6\u514B\u9E70", "\u59C6\u514B\u9DF9", "Staraptor"],
        [399, "bidoof", "\u5927\u7259\u72F8", "\u5927\u7259\u72F8", "Bidoof"],
        [400, "bibarel", "\u5927\u5C3E\u72F8", "\u5927\u5C3E\u72F8", "Bibarel"],
        [401, "kricketot", "\u5706\u6CD5\u5E08", "\u5713\u6CD5\u5E2B", "Kricketot"],
        [402, "kricketune", "\u97F3\u7BB1\u87C0", "\u97F3\u7BB1\u87C0", "Kricketune"],
        [403, "shinx", "\u5C0F\u732B\u602A", "\u5C0F\u8C93\u602A", "Shinx"],
        [404, "luxio", "\u52D2\u514B\u732B", "\u52D2\u514B\u8C93", "Luxio"],
        [405, "luxray", "\u4F26\u7434\u732B", "\u502B\u7434\u8C93", "Luxray"],
        [406, "budew", "\u542B\u7F9E\u82DE", "\u542B\u7F9E\u82DE", "Budew"],
        [407, "roserade", "\u7F57\u4E1D\u96F7\u6735", "\u7F85\u7D72\u96F7\u6735", "Roserade"],
        [408, "cranidos", "\u5934\u76D6\u9F99", "\u982D\u84CB\u9F8D", "Cranidos"],
        [409, "rampardos", "\u6218\u69CC\u9F99", "\u6230\u69CC\u9F8D", "Rampardos"],
        [410, "shieldon", "\u76FE\u7532\u9F99", "\u76FE\u7532\u9F8D", "Shieldon"],
        [411, "bastiodon", "\u62A4\u57CE\u9F99", "\u8B77\u57CE\u9F8D", "Bastiodon"],
        [412, "burmy", "\u7ED3\u8349\u513F", "\u7D50\u8349\u5152", "Burmy"],
        [413, "wormadam", "\u7ED3\u8349\u8D35\u5987", "\u7D50\u8349\u8CB4\u5A66", "Wormadam"],
        [414, "mothim", "\u7EC5\u58EB\u86FE", "\u7D33\u58EB\u86FE", "Mothim"],
        [415, "combee", "\u4E09\u871C\u8702", "\u4E09\u871C\u8702", "Combee"],
        [416, "vespiquen", "\u8702\u5973\u738B", "\u8702\u5973\u738B", "Vespiquen"],
        [417, "pachirisu", "\u5E15\u5947\u5229\u5179", "\u5E15\u5947\u5229\u8332", "Pachirisu"],
        [418, "buizel", "\u6CF3\u5708\u9F2C", "\u6CF3\u5708\u9F2C", "Buizel"],
        [419, "floatzel", "\u6D6E\u6F5C\u9F2C", "\u6D6E\u6F5B\u9F2C", "Floatzel"],
        [420, "cherubi", "\u6A31\u82B1\u5B9D", "\u6AFB\u82B1\u5BF6", "Cherubi"],
        [421, "cherrim", "\u6A31\u82B1\u513F", "\u6AFB\u82B1\u5152", "Cherrim"],
        [422, "shellos", "\u65E0\u58F3\u6D77\u5154", "\u7121\u6BBC\u6D77\u5154", "Shellos"],
        [423, "gastrodon", "\u6D77\u5154\u517D", "\u6D77\u5154\u7378", "Gastrodon"],
        [424, "ambipom", "\u53CC\u5C3E\u602A\u624B", "\u96D9\u5C3E\u602A\u624B", "Ambipom"],
        [425, "drifloon", "\u98D8\u98D8\u7403", "\u98C4\u98C4\u7403", "Drifloon"],
        [426, "drifblim", "\u968F\u98CE\u7403", "\u96A8\u98A8\u7403", "Drifblim"],
        [427, "buneary", "\u5377\u5377\u8033", "\u6372\u6372\u8033", "Buneary"],
        [428, "lopunny", "\u957F\u8033\u5154", "\u9577\u8033\u5154", "Lopunny"],
        [429, "mismagius", "\u68A6\u5996\u9B54", "\u5922\u5996\u9B54", "Mismagius"],
        [430, "honchkrow", "\u4E4C\u9E26\u5934\u5934", "\u70CF\u9D09\u982D\u982D", "Honchkrow"],
        [431, "glameow", "\u9B45\u529B\u55B5", "\u9B45\u529B\u55B5", "Glameow"],
        [432, "purugly", "\u4E1C\u65BD\u55B5", "\u6771\u65BD\u55B5", "Purugly"],
        [433, "chingling", "\u94C3\u94DB\u54CD", "\u9234\u943A\u97FF", "Chingling"],
        [434, "stunky", "\u81ED\u9F2C\u5657", "\u81ED\u9F2C\u5657", "Stunky"],
        [435, "skuntank", "\u5766\u514B\u81ED\u9F2C", "\u5766\u514B\u81ED\u9F2C", "Skuntank"],
        [436, "bronzor", "\u94DC\u955C\u602A", "\u9285\u93E1\u602A", "Bronzor"],
        [437, "bronzong", "\u9752\u94DC\u949F", "\u9752\u9285\u9418", "Bronzong"],
        [438, "bonsly", "\u76C6\u624D\u602A", "\u76C6\u624D\u602A", "Bonsly"],
        [439, "mime-jr", "\u9B54\u5C3C\u5C3C", "\u9B54\u5C3C\u5C3C", "Mime Jr."],
        [440, "happiny", "\u5C0F\u798F\u86CB", "\u5C0F\u798F\u86CB", "Happiny"],
        [441, "chatot", "\u8052\u566A\u9E1F", "\u8052\u566A\u9CE5", "Chatot"],
        [442, "spiritomb", "\u82B1\u5CA9\u602A", "\u82B1\u5CA9\u602A", "Spiritomb"],
        [443, "gible", "\u5706\u9646\u9CA8", "\u5713\u9678\u9BCA", "Gible"],
        [444, "gabite", "\u5C16\u7259\u9646\u9CA8", "\u5C16\u7259\u9678\u9BCA", "Gabite"],
        [445, "garchomp", "\u70C8\u54AC\u9646\u9CA8", "\u70C8\u54AC\u9678\u9BCA", "Garchomp"],
        [446, "munchlax", "\u5C0F\u5361\u6BD4\u517D", "\u5C0F\u5361\u6BD4\u7378", "Munchlax"],
        [447, "riolu", "\u5229\u6B27\u8DEF", "\u5229\u6B50\u8DEF", "Riolu"],
        [448, "lucario", "\u8DEF\u5361\u5229\u6B27", "\u8DEF\u5361\u5229\u6B50", "Lucario"],
        [449, "hippopotas", "\u6C99\u6CB3\u9A6C", "\u6C99\u6CB3\u99AC", "Hippopotas"],
        [450, "hippowdon", "\u6CB3\u9A6C\u517D", "\u6CB3\u99AC\u7378", "Hippowdon"],
        [451, "skorupi", "\u94B3\u5C3E\u874E", "\u9257\u5C3E\u880D", "Skorupi"],
        [452, "drapion", "\u9F99\u738B\u874E", "\u9F8D\u738B\u880D", "Drapion"],
        [453, "croagunk", "\u4E0D\u826F\u86D9", "\u4E0D\u826F\u86D9", "Croagunk"],
        [454, "toxicroak", "\u6BD2\u9AB7\u86D9", "\u6BD2\u9AB7\u86D9", "Toxicroak"],
        [455, "carnivine", "\u5C16\u7259\u7B3C", "\u5C16\u7259\u7C60", "Carnivine"],
        [456, "finneon", "\u8367\u5149\u9C7C", "\u87A2\u5149\u9B5A", "Finneon"],
        [457, "lumineon", "\u9713\u8679\u9C7C", "\u9713\u8679\u9B5A", "Lumineon"],
        [458, "mantyke", "\u5C0F\u7403\u98DE\u9C7C", "\u5C0F\u7403\u98DB\u9B5A", "Mantyke"],
        [459, "snover", "\u96EA\u7B20\u602A", "\u96EA\u7B20\u602A", "Snover"],
        [460, "abomasnow", "\u66B4\u96EA\u738B", "\u66B4\u96EA\u738B", "Abomasnow"],
        [461, "weavile", "\u739B\u72C3\u62C9", "\u746A\u72C3\u62C9", "Weavile"],
        [462, "magnezone", "\u81EA\u7206\u78C1\u602A", "\u81EA\u7206\u78C1\u602A", "Magnezone"],
        [463, "lickilicky", "\u5927\u820C\u8214", "\u5927\u820C\u8214", "Lickilicky"],
        [464, "rhyperior", "\u8D85\u7532\u72C2\u7280", "\u8D85\u7532\u72C2\u7280", "Rhyperior"],
        [465, "tangrowth", "\u5DE8\u8513\u85E4", "\u5DE8\u8513\u85E4", "Tangrowth"],
        [466, "electivire", "\u7535\u51FB\u9B54\u517D", "\u96FB\u64CA\u9B54\u7378", "Electivire"],
        [467, "magmortar", "\u9E2D\u5634\u708E\u517D", "\u9D28\u5634\u708E\u7378", "Magmortar"],
        [468, "togekiss", "\u6CE2\u514B\u57FA\u65AF", "\u6CE2\u514B\u57FA\u65AF", "Togekiss"],
        [469, "yanmega", "\u8FDC\u53E4\u5DE8\u8713", "\u9060\u53E4\u5DE8\u8713", "Yanmega"],
        [470, "leafeon", "\u53F6\u4F0A\u5E03", "\u8449\u4F0A\u5E03", "Leafeon"],
        [471, "glaceon", "\u51B0\u4F0A\u5E03", "\u51B0\u4F0A\u5E03", "Glaceon"],
        [472, "gliscor", "\u5929\u874E\u738B", "\u5929\u880D\u738B", "Gliscor"],
        [473, "mamoswine", "\u8C61\u7259\u732A", "\u8C61\u7259\u8C6C", "Mamoswine"],
        [474, "porygon-z", "\u591A\u8FB9\u517D\u4E59\u578B", "\u591A\u908A\u7378\uFF3A", "Porygon-Z"],
        [475, "gallade", "\u827E\u8DEF\u96F7\u6735", "\u827E\u8DEF\u96F7\u6735", "Gallade"],
        [476, "probopass", "\u5927\u671D\u5317\u9F3B", "\u5927\u671D\u5317\u9F3B", "Probopass"],
        [477, "dusknoir", "\u9ED1\u591C\u9B54\u7075", "\u9ED1\u591C\u9B54\u9748", "Dusknoir"],
        [478, "froslass", "\u96EA\u5996\u5973", "\u96EA\u5996\u5973", "Froslass"],
        [479, "rotom", "\u6D1B\u6258\u59C6", "\u6D1B\u6258\u59C6", "Rotom"],
        [480, "uxie", "\u7531\u514B\u5E0C", "\u7531\u514B\u5E0C", "Uxie"],
        [481, "mesprit", "\u827E\u59C6\u5229\u591A", "\u827E\u59C6\u5229\u591A", "Mesprit"],
        [482, "azelf", "\u4E9A\u514B\u8BFA\u59C6", "\u4E9E\u514B\u8AFE\u59C6", "Azelf"],
        [483, "dialga", "\u5E1D\u7259\u5362\u5361", "\u5E1D\u7259\u76E7\u5361", "Dialga"],
        [484, "palkia", "\u5E15\u8DEF\u5947\u4E9A", "\u5E15\u8DEF\u5947\u4E9E", "Palkia"],
        [485, "heatran", "\u5E2D\u591A\u84DD\u6069", "\u5E2D\u591A\u85CD\u6069", "Heatran"],
        [486, "regigigas", "\u96F7\u5409\u5947\u5361\u65AF", "\u96F7\u5409\u5947\u5361\u65AF", "Regigigas"],
        [487, "giratina", "\u9A91\u62C9\u5E1D\u7EB3", "\u9A0E\u62C9\u5E1D\u7D0D", "Giratina"],
        [488, "cresselia", "\u514B\u96F7\u8272\u5229\u4E9A", "\u514B\u96F7\u8272\u5229\u4E9E", "Cresselia"],
        [489, "phione", "\u970F\u6B27\u7EB3", "\u970F\u6B50\u7D0D", "Phione"],
        [490, "manaphy", "\u739B\u7EB3\u970F", "\u746A\u7D0D\u970F", "Manaphy"],
        [491, "darkrai", "\u8FBE\u514B\u83B1\u4F0A", "\u9054\u514B\u840A\u4F0A", "Darkrai"],
        [492, "shaymin", "\u8C22\u7C73", "\u8B1D\u7C73", "Shaymin"],
        [493, "arceus", "\u963F\u5C14\u5B99\u65AF", "\u963F\u723E\u5B99\u65AF", "Arceus"],
        [494, "victini", "\u6BD4\u514B\u63D0\u5C3C", "\u6BD4\u514B\u63D0\u5C3C", "Victini"],
        [495, "snivy", "\u85E4\u85E4\u86C7", "\u85E4\u85E4\u86C7", "Snivy"],
        [496, "servine", "\u9752\u85E4\u86C7", "\u9752\u85E4\u86C7", "Servine"],
        [497, "serperior", "\u541B\u4E3B\u86C7", "\u541B\u4E3B\u86C7", "Serperior"],
        [498, "tepig", "\u6696\u6696\u732A", "\u6696\u6696\u8C6C", "Tepig"],
        [499, "pignite", "\u7092\u7092\u732A", "\u7092\u7092\u8C6C", "Pignite"],
        [500, "emboar", "\u708E\u6B66\u738B", "\u708E\u6B66\u738B", "Emboar"],
        [501, "oshawott", "\u6C34\u6C34\u736D", "\u6C34\u6C34\u737A", "Oshawott"],
        [502, "dewott", "\u53CC\u5203\u4E38", "\u96D9\u5203\u4E38", "Dewott"],
        [503, "samurott", "\u5927\u5251\u9B3C", "\u5927\u528D\u9B3C", "Samurott"],
        [504, "patrat", "\u63A2\u63A2\u9F20", "\u63A2\u63A2\u9F20", "Patrat"],
        [505, "watchog", "\u6B65\u54E8\u9F20", "\u6B65\u54E8\u9F20", "Watchog"],
        [506, "lillipup", "\u5C0F\u7EA6\u514B", "\u5C0F\u7D04\u514B", "Lillipup"],
        [507, "herdier", "\u54C8\u7EA6\u514B", "\u54C8\u7D04\u514B", "Herdier"],
        [508, "stoutland", "\u957F\u6BDB\u72D7", "\u9577\u6BDB\u72D7", "Stoutland"],
        [509, "purrloin", "\u6252\u624B\u732B", "\u6252\u624B\u8C93", "Purrloin"],
        [510, "liepard", "\u9177\u8C79", "\u9177\u8C79", "Liepard"],
        [511, "pansage", "\u82B1\u6930\u7334", "\u82B1\u6930\u7334", "Pansage"],
        [512, "simisage", "\u82B1\u6930\u733F", "\u82B1\u6930\u733F", "Simisage"],
        [513, "pansear", "\u7206\u9999\u7334", "\u7206\u9999\u7334", "Pansear"],
        [514, "simisear", "\u7206\u9999\u733F", "\u7206\u9999\u733F", "Simisear"],
        [515, "panpour", "\u51B7\u6C34\u7334", "\u51B7\u6C34\u7334", "Panpour"],
        [516, "simipour", "\u51B7\u6C34\u733F", "\u51B7\u6C34\u733F", "Simipour"],
        [517, "munna", "\u98DF\u68A6\u68A6", "\u98DF\u5922\u5922", "Munna"],
        [518, "musharna", "\u68A6\u68A6\u8680", "\u5922\u5922\u8755", "Musharna"],
        [519, "pidove", "\u8C46\u8C46\u9E3D", "\u8C46\u8C46\u9D3F", "Pidove"],
        [520, "tranquill", "\u5495\u5495\u9E3D", "\u5495\u5495\u9D3F", "Tranquill"],
        [521, "unfezant", "\u9AD8\u50B2\u96C9\u9E21", "\u9AD8\u50B2\u96C9\u96DE", "Unfezant"],
        [522, "blitzle", "\u6591\u6591\u9A6C", "\u6591\u6591\u99AC", "Blitzle"],
        [523, "zebstrika", "\u96F7\u7535\u6591\u9A6C", "\u96F7\u96FB\u6591\u99AC", "Zebstrika"],
        [524, "roggenrola", "\u77F3\u4E38\u5B50", "\u77F3\u4E38\u5B50", "Roggenrola"],
        [525, "boldore", "\u5730\u5E54\u5CA9", "\u5730\u5E54\u5CA9", "Boldore"],
        [526, "gigalith", "\u5E9E\u5CA9\u602A", "\u9F90\u5CA9\u602A", "Gigalith"],
        [527, "woobat", "\u6EDA\u6EDA\u8759\u8760", "\u6EFE\u6EFE\u8759\u8760", "Woobat"],
        [528, "swoobat", "\u5FC3\u8759\u8760", "\u5FC3\u8759\u8760", "Swoobat"],
        [529, "drilbur", "\u87BA\u9489\u5730\u9F20", "\u87BA\u91D8\u5730\u9F20", "Drilbur"],
        [530, "excadrill", "\u9F99\u5934\u5730\u9F20", "\u9F8D\u982D\u5730\u9F20", "Excadrill"],
        [531, "audino", "\u5DEE\u4E0D\u591A\u5A03\u5A03", "\u5DEE\u4E0D\u591A\u5A03\u5A03", "Audino"],
        [532, "timburr", "\u642C\u8FD0\u5C0F\u5320", "\u642C\u904B\u5C0F\u5320", "Timburr"],
        [533, "gurdurr", "\u94C1\u9AA8\u571F\u4EBA", "\u9435\u9AA8\u571F\u4EBA", "Gurdurr"],
        [534, "conkeldurr", "\u4FEE\u5EFA\u8001\u5320", "\u4FEE\u5EFA\u8001\u5320", "Conkeldurr"],
        [535, "tympole", "\u5706\u874C\u86AA", "\u5713\u874C\u86AA", "Tympole"],
        [536, "palpitoad", "\u84DD\u87FE\u870D", "\u85CD\u87FE\u870D", "Palpitoad"],
        [537, "seismitoad", "\u87FE\u870D\u738B", "\u87FE\u870D\u738B", "Seismitoad"],
        [538, "throh", "\u6295\u6454\u9B3C", "\u6295\u6454\u9B3C", "Throh"],
        [539, "sawk", "\u6253\u51FB\u9B3C", "\u6253\u64CA\u9B3C", "Sawk"],
        [540, "sewaddle", "\u866B\u5B9D\u5305", "\u87F2\u5BF6\u5305", "Sewaddle"],
        [541, "swadloon", "\u5B9D\u5305\u8327", "\u5BF6\u5305\u7E6D", "Swadloon"],
        [542, "leavanny", "\u4FDD\u59C6\u866B", "\u4FDD\u6BCD\u87F2", "Leavanny"],
        [543, "venipede", "\u767E\u8DB3\u8708\u86A3", "\u767E\u8DB3\u8708\u86A3", "Venipede"],
        [544, "whirlipede", "\u8F66\u8F6E\u7403", "\u8ECA\u8F2A\u6BEC", "Whirlipede"],
        [545, "scolipede", "\u8708\u86A3\u738B", "\u8708\u86A3\u738B", "Scolipede"],
        [546, "cottonee", "\u6728\u68C9\u7403", "\u6728\u68C9\u7403", "Cottonee"],
        [547, "whimsicott", "\u98CE\u5996\u7CBE", "\u98A8\u5996\u7CBE", "Whimsicott"],
        [548, "petilil", "\u767E\u5408\u6839\u5A03\u5A03", "\u767E\u5408\u6839\u5A03\u5A03", "Petilil"],
        [549, "lilligant", "\u88D9\u513F\u5C0F\u59D0", "\u88D9\u5152\u5C0F\u59D0", "Lilligant"],
        [550, "basculin", "\u91CE\u86EE\u9C88\u9C7C", "\u91CE\u883B\u9C78\u9B5A", "Basculin"],
        [551, "sandile", "\u9ED1\u773C\u9CC4", "\u9ED1\u773C\u9C77", "Sandile"],
        [552, "krokorok", "\u6DF7\u6DF7\u9CC4", "\u6DF7\u6DF7\u9C77", "Krokorok"],
        [553, "krookodile", "\u6D41\u6C13\u9CC4", "\u6D41\u6C13\u9C77", "Krookodile"],
        [554, "darumaka", "\u706B\u7EA2\u4E0D\u5012\u7FC1", "\u706B\u7D05\u4E0D\u5012\u7FC1", "Darumaka"],
        [555, "darmanitan", "\u8FBE\u6469\u72D2\u72D2", "\u9054\u6469\u72D2\u72D2", "Darmanitan"],
        [556, "maractus", "\u6C99\u94C3\u4ED9\u4EBA\u638C", "\u6C99\u9234\u4ED9\u4EBA\u638C", "Maractus"],
        [557, "dwebble", "\u77F3\u5C45\u87F9", "\u77F3\u5C45\u87F9", "Dwebble"],
        [558, "crustle", "\u5CA9\u6BBF\u5C45\u87F9", "\u5CA9\u6BBF\u5C45\u87F9", "Crustle"],
        [559, "scraggy", "\u6ED1\u6ED1\u5C0F\u5B50", "\u6ED1\u6ED1\u5C0F\u5B50", "Scraggy"],
        [560, "scrafty", "\u5934\u5DFE\u6DF7\u6DF7", "\u982D\u5DFE\u6DF7\u6DF7", "Scrafty"],
        [561, "sigilyph", "\u8C61\u5F81\u9E1F", "\u8C61\u5FB5\u9CE5", "Sigilyph"],
        [562, "yamask", "\u54ED\u54ED\u9762\u5177", "\u54ED\u54ED\u9762\u5177", "Yamask"],
        [563, "cofagrigus", "\u8FED\u5931\u68FA", "\u6B7B\u795E\u68FA", "Cofagrigus"],
        [564, "tirtouga", "\u539F\u76D6\u6D77\u9F9F", "\u539F\u84CB\u6D77\u9F9C", "Tirtouga"],
        [565, "carracosta", "\u808B\u9AA8\u6D77\u9F9F", "\u808B\u9AA8\u6D77\u9F9C", "Carracosta"],
        [566, "archen", "\u59CB\u7956\u5C0F\u9E1F", "\u59CB\u7956\u5C0F\u9CE5", "Archen"],
        [567, "archeops", "\u59CB\u7956\u5927\u9E1F", "\u59CB\u7956\u5927\u9CE5", "Archeops"],
        [568, "trubbish", "\u7834\u7834\u888B", "\u7834\u7834\u888B", "Trubbish"],
        [569, "garbodor", "\u7070\u5C18\u5C71", "\u7070\u5875\u5C71", "Garbodor"],
        [570, "zorua", "\u7D22\u7F57\u4E9A", "\u7D22\u7F85\u4E9E", "Zorua"],
        [571, "zoroark", "\u7D22\u7F57\u4E9A\u514B", "\u7D22\u7F85\u4E9E\u514B", "Zoroark"],
        [572, "minccino", "\u6CE1\u6CAB\u6817\u9F20", "\u6CE1\u6CAB\u6817\u9F20", "Minccino"],
        [573, "cinccino", "\u5947\u8BFA\u6817\u9F20", "\u5947\u8AFE\u6817\u9F20", "Cinccino"],
        [574, "gothita", "\u54E5\u5FB7\u5B9D\u5B9D", "\u54E5\u5FB7\u5BF6\u5BF6", "Gothita"],
        [575, "gothorita", "\u54E5\u5FB7\u5C0F\u7AE5", "\u54E5\u5FB7\u5C0F\u7AE5", "Gothorita"],
        [576, "gothitelle", "\u54E5\u5FB7\u5C0F\u59D0", "\u54E5\u5FB7\u5C0F\u59D0", "Gothitelle"],
        [577, "solosis", "\u5355\u5375\u7EC6\u80DE\u7403", "\u55AE\u5375\u7D30\u80DE\u7403", "Solosis"],
        [578, "duosion", "\u53CC\u5375\u7EC6\u80DE\u7403", "\u96D9\u5375\u7D30\u80DE\u7403", "Duosion"],
        [579, "reuniclus", "\u4EBA\u9020\u7EC6\u80DE\u5375", "\u4EBA\u9020\u7D30\u80DE\u5375", "Reuniclus"],
        [580, "ducklett", "\u9E2D\u5B9D\u5B9D", "\u9D28\u5BF6\u5BF6", "Ducklett"],
        [581, "swanna", "\u821E\u5929\u9E45", "\u821E\u5929\u9D5D", "Swanna"],
        [582, "vanillite", "\u8FF7\u4F60\u51B0", "\u8FF7\u4F60\u51B0", "Vanillite"],
        [583, "vanillish", "\u591A\u591A\u51B0", "\u591A\u591A\u51B0", "Vanillish"],
        [584, "vanilluxe", "\u53CC\u500D\u591A\u591A\u51B0", "\u96D9\u500D\u591A\u591A\u51B0", "Vanilluxe"],
        [585, "deerling", "\u56DB\u5B63\u9E7F", "\u56DB\u5B63\u9E7F", "Deerling"],
        [586, "sawsbuck", "\u840C\u82BD\u9E7F", "\u840C\u82BD\u9E7F", "Sawsbuck"],
        [587, "emolga", "\u7535\u98DE\u9F20", "\u96FB\u98DB\u9F20", "Emolga"],
        [588, "karrablast", "\u76D6\u76D6\u866B", "\u84CB\u84CB\u87F2", "Karrablast"],
        [589, "escavalier", "\u9A91\u58EB\u8717\u725B", "\u9A0E\u58EB\u8778\u725B", "Escavalier"],
        [590, "foongus", "\u54CE\u5440\u7403\u83C7", "\u54CE\u5440\u7403\u83C7", "Foongus"],
        [591, "amoonguss", "\u8D25\u9732\u7403\u83C7", "\u6557\u9732\u7403\u83C7", "Amoonguss"],
        [592, "frillish", "\u8F7B\u98D8\u98D8", "\u8F15\u98C4\u98C4", "Frillish"],
        [593, "jellicent", "\u80D6\u561F\u561F", "\u80D6\u561F\u561F", "Jellicent"],
        [594, "alomomola", "\u4FDD\u59C6\u66FC\u6CE2", "\u4FDD\u6BCD\u66FC\u6CE2", "Alomomola"],
        [595, "joltik", "\u7535\u7535\u866B", "\u96FB\u96FB\u87F2", "Joltik"],
        [596, "galvantula", "\u7535\u8718\u86DB", "\u96FB\u8718\u86DB", "Galvantula"],
        [597, "ferroseed", "\u79CD\u5B50\u94C1\u7403", "\u7A2E\u5B50\u9435\u7403", "Ferroseed"],
        [598, "ferrothorn", "\u575A\u679C\u54D1\u94C3", "\u5805\u679C\u555E\u9234", "Ferrothorn"],
        [599, "klink", "\u9F7F\u8F6E\u513F", "\u9F52\u8F2A\u5152", "Klink"],
        [600, "klang", "\u9F7F\u8F6E\u7EC4", "\u9F52\u8F2A\u7D44", "Klang"],
        [601, "klinklang", "\u9F7F\u8F6E\u602A", "\u9F52\u8F2A\u602A", "Klinklang"],
        [602, "tynamo", "\u9EBB\u9EBB\u5C0F\u9C7C", "\u9EBB\u9EBB\u5C0F\u9B5A", "Tynamo"],
        [603, "eelektrik", "\u9EBB\u9EBB\u9CD7", "\u9EBB\u9EBB\u9C3B", "Eelektrik"],
        [604, "eelektross", "\u9EBB\u9EBB\u9CD7\u9C7C\u738B", "\u9EBB\u9EBB\u9C3B\u9B5A\u738B", "Eelektross"],
        [605, "elgyem", "\u5C0F\u7070\u602A", "\u5C0F\u7070\u602A", "Elgyem"],
        [606, "beheeyem", "\u5927\u5B87\u602A", "\u5927\u5B87\u602A", "Beheeyem"],
        [607, "litwick", "\u70DB\u5149\u7075", "\u71ED\u5149\u9748", "Litwick"],
        [608, "lampent", "\u706F\u706B\u5E7D\u7075", "\u71C8\u706B\u5E7D\u9748", "Lampent"],
        [609, "chandelure", "\u6C34\u6676\u706F\u706B\u7075", "\u6C34\u6676\u71C8\u706B\u9748", "Chandelure"],
        [610, "axew", "\u7259\u7259", "\u7259\u7259", "Axew"],
        [611, "fraxure", "\u65A7\u7259\u9F99", "\u65A7\u7259\u9F8D", "Fraxure"],
        [612, "haxorus", "\u53CC\u65A7\u6218\u9F99", "\u96D9\u65A7\u6230\u9F8D", "Haxorus"],
        [613, "cubchoo", "\u55B7\u568F\u718A", "\u5674\u568F\u718A", "Cubchoo"],
        [614, "beartic", "\u51BB\u539F\u718A", "\u51CD\u539F\u718A", "Beartic"],
        [615, "cryogonal", "\u51E0\u4F55\u96EA\u82B1", "\u5E7E\u4F55\u96EA\u82B1", "Cryogonal"],
        [616, "shelmet", "\u5C0F\u5634\u8717", "\u5C0F\u5634\u8778", "Shelmet"],
        [617, "accelgor", "\u654F\u6377\u866B", "\u654F\u6377\u87F2", "Accelgor"],
        [618, "stunfisk", "\u6CE5\u5DF4\u9C7C", "\u6CE5\u5DF4\u9B5A", "Stunfisk"],
        [619, "mienfoo", "\u529F\u592B\u9F2C", "\u529F\u592B\u9F2C", "Mienfoo"],
        [620, "mienshao", "\u5E08\u7236\u9F2C", "\u5E2B\u7236\u9F2C", "Mienshao"],
        [621, "druddigon", "\u8D64\u9762\u9F99", "\u8D64\u9762\u9F8D", "Druddigon"],
        [622, "golett", "\u6CE5\u5076\u5C0F\u4EBA", "\u6CE5\u5076\u5C0F\u4EBA", "Golett"],
        [623, "golurk", "\u6CE5\u5076\u5DE8\u4EBA", "\u6CE5\u5076\u5DE8\u4EBA", "Golurk"],
        [624, "pawniard", "\u9A79\u5200\u5C0F\u5175", "\u99D2\u5200\u5C0F\u5175", "Pawniard"],
        [625, "bisharp", "\u5288\u65A9\u53F8\u4EE4", "\u5288\u65AC\u53F8\u4EE4", "Bisharp"],
        [626, "bouffalant", "\u7206\u70B8\u5934\u6C34\u725B", "\u7206\u70B8\u982D\u6C34\u725B", "Bouffalant"],
        [627, "rufflet", "\u6BDB\u5934\u5C0F\u9E70", "\u6BDB\u982D\u5C0F\u9DF9", "Rufflet"],
        [628, "braviary", "\u52C7\u58EB\u96C4\u9E70", "\u52C7\u58EB\u96C4\u9DF9", "Braviary"],
        [629, "vullaby", "\u79C3\u9E70\u4E2B\u5934", "\u79BF\u9DF9\u4E2B\u982D", "Vullaby"],
        [630, "mandibuzz", "\u79C3\u9E70\u5A1C", "\u79BF\u9DF9\u5A1C", "Mandibuzz"],
        [631, "heatmor", "\u7194\u8681\u517D", "\u7194\u87FB\u7378", "Heatmor"],
        [632, "durant", "\u94C1\u8681", "\u9435\u87FB", "Durant"],
        [633, "deino", "\u5355\u9996\u9F99", "\u55AE\u9996\u9F8D", "Deino"],
        [634, "zweilous", "\u53CC\u9996\u66B4\u9F99", "\u96D9\u9996\u66B4\u9F8D", "Zweilous"],
        [635, "hydreigon", "\u4E09\u9996\u6076\u9F99", "\u4E09\u9996\u60E1\u9F8D", "Hydreigon"],
        [636, "larvesta", "\u71C3\u70E7\u866B", "\u71C3\u71D2\u87F2", "Larvesta"],
        [637, "volcarona", "\u706B\u795E\u86FE", "\u706B\u795E\u86FE", "Volcarona"],
        [638, "cobalion", "\u52FE\u5E15\u8DEF\u7FC1", "\u52FE\u5E15\u8DEF\u7FC1", "Cobalion"],
        [639, "terrakion", "\u4EE3\u62C9\u57FA\u7FC1", "\u4EE3\u62C9\u57FA\u7FC1", "Terrakion"],
        [640, "virizion", "\u6BD5\u529B\u5409\u7FC1", "\u7562\u529B\u5409\u7FC1", "Virizion"],
        [641, "tornadus", "\u9F99\u5377\u4E91", "\u9F8D\u6372\u96F2", "Tornadus"],
        [642, "thundurus", "\u96F7\u7535\u4E91", "\u96F7\u96FB\u96F2", "Thundurus"],
        [643, "reshiram", "\u83B1\u5E0C\u62C9\u59C6", "\u840A\u5E0C\u62C9\u59C6", "Reshiram"],
        [644, "zekrom", "\u6377\u514B\u7F57\u59C6", "\u6377\u514B\u7F85\u59C6", "Zekrom"],
        [645, "landorus", "\u571F\u5730\u4E91", "\u571F\u5730\u96F2", "Landorus"],
        [646, "kyurem", "\u914B\u96F7\u59C6", "\u914B\u96F7\u59C6", "Kyurem"],
        [647, "keldeo", "\u51EF\u8DEF\u8FEA\u6B27", "\u51F1\u8DEF\u8FEA\u6B50", "Keldeo"],
        [648, "meloetta", "\u7F8E\u6D1B\u8036\u5854", "\u7F8E\u6D1B\u8036\u5854", "Meloetta"],
        [649, "genesect", "\u76D6\u8BFA\u8D5B\u514B\u7279", "\u84CB\u8AFE\u8CFD\u514B\u7279", "Genesect"],
        [650, "chespin", "\u54C8\u529B\u6817", "\u54C8\u529B\u6817", "Chespin"],
        [651, "quilladin", "\u80D6\u80D6\u54C8\u529B", "\u80D6\u80D6\u54C8\u529B", "Quilladin"],
        [652, "chesnaught", "\u5E03\u91CC\u5361\u9686", "\u5E03\u91CC\u5361\u9686", "Chesnaught"],
        [653, "fennekin", "\u706B\u72D0\u72F8", "\u706B\u72D0\u72F8", "Fennekin"],
        [654, "braixen", "\u957F\u5C3E\u706B\u72D0", "\u9577\u5C3E\u706B\u72D0", "Braixen"],
        [655, "delphox", "\u5996\u706B\u7EA2\u72D0", "\u5996\u706B\u7D05\u72D0", "Delphox"],
        [656, "froakie", "\u5471\u5471\u6CE1\u86D9", "\u5471\u5471\u6CE1\u86D9", "Froakie"],
        [657, "frogadier", "\u5471\u5934\u86D9", "\u5471\u982D\u86D9", "Frogadier"],
        [658, "greninja", "\u7532\u8D3A\u5FCD\u86D9", "\u7532\u8CC0\u5FCD\u86D9", "Greninja"],
        [659, "bunnelby", "\u6398\u6398\u5154", "\u6398\u6398\u5154", "Bunnelby"],
        [660, "diggersby", "\u6398\u5730\u5154", "\u6398\u5730\u5154", "Diggersby"],
        [661, "fletchling", "\u5C0F\u7BAD\u96C0", "\u5C0F\u7BAD\u96C0", "Fletchling"],
        [662, "fletchinder", "\u706B\u7BAD\u96C0", "\u706B\u7BAD\u96C0", "Fletchinder"],
        [663, "talonflame", "\u70C8\u7BAD\u9E70", "\u70C8\u7BAD\u9DF9", "Talonflame"],
        [664, "scatterbug", "\u7C89\u8776\u866B", "\u7C89\u8776\u87F2", "Scatterbug"],
        [665, "spewpa", "\u7C89\u8776\u86F9", "\u7C89\u8776\u86F9", "Spewpa"],
        [666, "vivillon", "\u5F69\u7C89\u8776", "\u5F69\u7C89\u8776", "Vivillon"],
        [667, "litleo", "\u5C0F\u72EE\u72EE", "\u5C0F\u7345\u7345", "Litleo"],
        [668, "pyroar", "\u706B\u708E\u72EE", "\u706B\u708E\u7345", "Pyroar"],
        [669, "flabebe", "\u82B1\u84D3\u84D3", "\u82B1\u84D3\u84D3", "Flab\xE9b\xE9"],
        [670, "floette", "\u82B1\u53F6\u8482", "\u82B1\u8449\u8482", "Floette"],
        [671, "florges", "\u82B1\u6D01\u592B\u4EBA", "\u82B1\u6F54\u592B\u4EBA", "Florges"],
        [672, "skiddo", "\u5750\u9A91\u5C0F\u7F8A", "\u5750\u9A0E\u5C0F\u7F8A", "Skiddo"],
        [673, "gogoat", "\u5750\u9A91\u5C71\u7F8A", "\u5750\u9A0E\u5C71\u7F8A", "Gogoat"],
        [674, "pancham", "\u987D\u76AE\u718A\u732B", "\u9811\u76AE\u718A\u8C93", "Pancham"],
        [675, "pangoro", "\u9738\u9053\u718A\u732B", "\u6D41\u6C13\u718A\u8C93", "Pangoro"],
        [676, "furfrou", "\u591A\u4E3D\u7C73\u4E9A", "\u591A\u9E97\u7C73\u4E9E", "Furfrou"],
        [677, "espurr", "\u5999\u55B5", "\u5999\u55B5", "Espurr"],
        [678, "meowstic", "\u8D85\u80FD\u5999\u55B5", "\u8D85\u80FD\u5999\u55B5", "Meowstic"],
        [679, "honedge", "\u72EC\u5251\u9798", "\u7368\u528D\u9798", "Honedge"],
        [680, "doublade", "\u53CC\u5251\u9798", "\u96D9\u528D\u9798", "Doublade"],
        [681, "aegislash", "\u575A\u76FE\u5251\u602A", "\u5805\u76FE\u528D\u602A", "Aegislash"],
        [682, "spritzee", "\u7C89\u9999\u9999", "\u7C89\u9999\u9999", "Spritzee"],
        [683, "aromatisse", "\u82B3\u9999\u7CBE", "\u82B3\u9999\u7CBE", "Aromatisse"],
        [684, "swirlix", "\u7EF5\u7EF5\u6CE1\u8299", "\u7DBF\u7DBF\u6CE1\u8299", "Swirlix"],
        [685, "slurpuff", "\u80D6\u751C\u59AE", "\u80D6\u751C\u59AE", "Slurpuff"],
        [686, "inkay", "\u597D\u5566\u9C7F", "\u597D\u5566\u9B77", "Inkay"],
        [687, "malamar", "\u4E4C\u8D3C\u738B", "\u70CF\u8CCA\u738B", "Malamar"],
        [688, "binacle", "\u9F9F\u811A\u811A", "\u9F9C\u8173\u8173", "Binacle"],
        [689, "barbaracle", "\u9F9F\u8DB3\u5DE8\u94E0", "\u9F9C\u8DB3\u5DE8\u93A7", "Barbaracle"],
        [690, "skrelp", "\u5783\u5783\u85FB", "\u5783\u5783\u85FB", "Skrelp"],
        [691, "dragalge", "\u6BD2\u85FB\u9F99", "\u6BD2\u85FB\u9F8D", "Dragalge"],
        [692, "clauncher", "\u94C1\u81C2\u67AA\u867E", "\u9435\u81C2\u69CD\u8766", "Clauncher"],
        [693, "clawitzer", "\u94A2\u70AE\u81C2\u867E", "\u92FC\u70AE\u81C2\u8766", "Clawitzer"],
        [694, "helioptile", "\u4F1E\u7535\u8725", "\u5098\u96FB\u8725", "Helioptile"],
        [695, "heliolisk", "\u5149\u7535\u4F1E\u8725", "\u5149\u96FB\u5098\u8725", "Heliolisk"],
        [696, "tyrunt", "\u5B9D\u5B9D\u66B4\u9F99", "\u5BF6\u5BF6\u66B4\u9F8D", "Tyrunt"],
        [697, "tyrantrum", "\u602A\u989A\u9F99", "\u602A\u984E\u9F8D", "Tyrantrum"],
        [698, "amaura", "\u51B0\u96EA\u9F99", "\u51B0\u96EA\u9F8D", "Amaura"],
        [699, "aurorus", "\u51B0\u96EA\u5DE8\u9F99", "\u51B0\u96EA\u5DE8\u9F8D", "Aurorus"],
        [700, "sylveon", "\u4ED9\u5B50\u4F0A\u5E03", "\u4ED9\u5B50\u4F0A\u5E03", "Sylveon"],
        [701, "hawlucha", "\u6454\u89D2\u9E70\u4EBA", "\u6454\u89D2\u9DF9\u4EBA", "Hawlucha"],
        [702, "dedenne", "\u549A\u549A\u9F20", "\u549A\u549A\u9F20", "Dedenne"],
        [703, "carbink", "\u5C0F\u788E\u94BB", "\u5C0F\u788E\u947D", "Carbink"],
        [704, "goomy", "\u9ECF\u9ECF\u5B9D", "\u9ECF\u9ECF\u5BF6", "Goomy"],
        [705, "sliggoo", "\u9ECF\u7F8E\u513F", "\u9ECF\u7F8E\u5152", "Sliggoo"],
        [706, "goodra", "\u9ECF\u7F8E\u9F99", "\u9ECF\u7F8E\u9F8D", "Goodra"],
        [707, "klefki", "\u94A5\u5708\u513F", "\u9470\u5708\u5152", "Klefki"],
        [708, "phantump", "\u5C0F\u6728\u7075", "\u5C0F\u6728\u9748", "Phantump"],
        [709, "trevenant", "\u673D\u6728\u5996", "\u673D\u6728\u5996", "Trevenant"],
        [710, "pumpkaboo", "\u5357\u74DC\u7CBE", "\u5357\u74DC\u7CBE", "Pumpkaboo"],
        [711, "gourgeist", "\u5357\u74DC\u602A\u4EBA", "\u5357\u74DC\u602A\u4EBA", "Gourgeist"],
        [712, "bergmite", "\u51B0\u5B9D", "\u51B0\u5BF6", "Bergmite"],
        [713, "avalugg", "\u51B0\u5CA9\u602A", "\u51B0\u5CA9\u602A", "Avalugg"],
        [714, "noibat", "\u55E1\u8760", "\u55E1\u8760", "Noibat"],
        [715, "noivern", "\u97F3\u6CE2\u9F99", "\u97F3\u6CE2\u9F8D", "Noivern"],
        [716, "xerneas", "\u54F2\u5C14\u5C3C\u4E9A\u65AF", "\u54F2\u723E\u5C3C\u4E9E\u65AF", "Xerneas"],
        [717, "yveltal", "\u4F0A\u88F4\u5C14\u5854\u5C14", "\u4F0A\u88F4\u723E\u5854\u723E", "Yveltal"],
        [718, "zygarde", "\u57FA\u683C\u5C14\u5FB7", "\u57FA\u683C\u723E\u5FB7", "Zygarde"],
        [719, "diancie", "\u8482\u5B89\u5E0C", "\u8482\u5B89\u5E0C", "Diancie"],
        [720, "hoopa", "\u80E1\u5E15", "\u80E1\u5E15", "Hoopa"],
        [721, "volcanion", "\u6CE2\u5C14\u51EF\u5C3C\u6069", "\u6CE2\u723E\u51F1\u5C3C\u6069", "Volcanion"],
        [722, "rowlet", "\u6728\u6728\u67AD", "\u6728\u6728\u689F", "Rowlet"],
        [723, "dartrix", "\u6295\u7FBD\u67AD", "\u6295\u7FBD\u689F", "Dartrix"],
        [724, "decidueye", "\u72D9\u5C04\u6811\u67AD", "\u72D9\u5C04\u6A39\u689F", "Decidueye"],
        [725, "litten", "\u706B\u6591\u55B5", "\u706B\u6591\u55B5", "Litten"],
        [726, "torracat", "\u708E\u70ED\u55B5", "\u708E\u71B1\u55B5", "Torracat"],
        [727, "incineroar", "\u70BD\u7130\u5486\u54EE\u864E", "\u71BE\u7130\u5486\u54EE\u864E", "Incineroar"],
        [728, "popplio", "\u7403\u7403\u6D77\u72EE", "\u7403\u7403\u6D77\u7345", "Popplio"],
        [729, "brionne", "\u82B1\u6F3E\u6D77\u72EE", "\u82B1\u6F3E\u6D77\u7345", "Brionne"],
        [730, "primarina", "\u897F\u72EE\u6D77\u58EC", "\u897F\u7345\u6D77\u58EC", "Primarina"],
        [731, "pikipek", "\u5C0F\u7B03\u513F", "\u5C0F\u7BE4\u5152", "Pikipek"],
        [732, "trumbeak", "\u5587\u53ED\u5544\u9E1F", "\u5587\u53ED\u5544\u9CE5", "Trumbeak"],
        [733, "toucannon", "\u94F3\u5634\u5927\u9E1F", "\u9283\u5634\u5927\u9CE5", "Toucannon"],
        [734, "yungoos", "\u732B\u9F2C\u5C11", "\u8C93\u9F2C\u5C11", "Yungoos"],
        [735, "gumshoos", "\u732B\u9F2C\u63A2\u957F", "\u8C93\u9F2C\u63A2\u9577", "Gumshoos"],
        [736, "grubbin", "\u5F3A\u989A\u9E21\u6BCD\u866B", "\u5F37\u984E\u96DE\u6BCD\u87F2", "Grubbin"],
        [737, "charjabug", "\u866B\u7535\u5B9D", "\u87F2\u96FB\u5BF6", "Charjabug"],
        [738, "vikavolt", "\u9539\u519C\u70AE\u866B", "\u936C\u8FB2\u70AE\u87F2", "Vikavolt"],
        [739, "crabrawler", "\u597D\u80DC\u87F9", "\u597D\u52DD\u87F9", "Crabrawler"],
        [740, "crabominable", "\u597D\u80DC\u6BDB\u87F9", "\u597D\u52DD\u6BDB\u87F9", "Crabominable"],
        [741, "oricorio", "\u82B1\u821E\u9E1F", "\u82B1\u821E\u9CE5", "Oricorio"],
        [742, "cutiefly", "\u840C\u867B", "\u840C\u867B", "Cutiefly"],
        [743, "ribombee", "\u8776\u7ED3\u840C\u867B", "\u8776\u7D50\u840C\u867B", "Ribombee"],
        [744, "rockruff", "\u5CA9\u72D7\u72D7", "\u5CA9\u72D7\u72D7", "Rockruff"],
        [745, "lycanroc", "\u9B03\u5CA9\u72FC\u4EBA", "\u9B03\u5CA9\u72FC\u4EBA", "Lycanroc"],
        [746, "wishiwashi", "\u5F31\u4E01\u9C7C", "\u5F31\u4E01\u9B5A", "Wishiwashi"],
        [747, "mareanie", "\u597D\u574F\u661F", "\u597D\u58DE\u661F", "Mareanie"],
        [748, "toxapex", "\u8D85\u574F\u661F", "\u8D85\u58DE\u661F", "Toxapex"],
        [749, "mudbray", "\u6CE5\u9A74\u4ED4", "\u6CE5\u9A62\u4ED4", "Mudbray"],
        [750, "mudsdale", "\u91CD\u6CE5\u633D\u9A6C", "\u91CD\u6CE5\u633D\u99AC", "Mudsdale"],
        [751, "dewpider", "\u6EF4\u86DB", "\u6EF4\u86DB", "Dewpider"],
        [752, "araquanid", "\u6EF4\u86DB\u9738", "\u6EF4\u86DB\u9738", "Araquanid"],
        [753, "fomantis", "\u4F2A\u87B3\u8349", "\u507D\u87B3\u8349", "Fomantis"],
        [754, "lurantis", "\u5170\u87B3\u82B1", "\u862D\u87B3\u82B1", "Lurantis"],
        [755, "morelull", "\u7761\u7761\u83C7", "\u7761\u7761\u83C7", "Morelull"],
        [756, "shiinotic", "\u706F\u7F69\u591C\u83C7", "\u71C8\u7F69\u591C\u83C7", "Shiinotic"],
        [757, "salandit", "\u591C\u76D7\u706B\u8725", "\u591C\u76DC\u706B\u8725", "Salandit"],
        [758, "salazzle", "\u7130\u540E\u8725", "\u7130\u540E\u8725", "Salazzle"],
        [759, "stufful", "\u7AE5\u5076\u718A", "\u7AE5\u5076\u718A", "Stufful"],
        [760, "bewear", "\u7A7F\u7740\u718A", "\u7A7F\u8457\u718A", "Bewear"],
        [761, "bounsweet", "\u751C\u7AF9\u7AF9", "\u751C\u7AF9\u7AF9", "Bounsweet"],
        [762, "steenee", "\u751C\u821E\u59AE", "\u751C\u821E\u59AE", "Steenee"],
        [763, "tsareena", "\u751C\u51B7\u7F8E\u540E", "\u751C\u51B7\u7F8E\u540E", "Tsareena"],
        [764, "comfey", "\u82B1\u7597\u73AF\u73AF", "\u82B1\u7642\u74B0\u74B0", "Comfey"],
        [765, "oranguru", "\u667A\u6325\u7329", "\u667A\u63EE\u7329", "Oranguru"],
        [766, "passimian", "\u6295\u63B7\u7334", "\u6295\u64F2\u7334", "Passimian"],
        [767, "wimpod", "\u80C6\u5C0F\u866B", "\u81BD\u5C0F\u87F2", "Wimpod"],
        [768, "golisopod", "\u5177\u7532\u6B66\u8005", "\u5177\u7532\u6B66\u8005", "Golisopod"],
        [769, "sandygast", "\u6C99\u4E18\u5A03", "\u6C99\u4E18\u5A03", "Sandygast"],
        [770, "palossand", "\u566C\u6C99\u5821\u7237", "\u566C\u6C99\u5821\u723A", "Palossand"],
        [771, "pyukumuku", "\u62F3\u6D77\u53C2", "\u62F3\u6D77\u53C3", "Pyukumuku"],
        [772, "type-null", "\u5C5E\u6027\uFF1A\u7A7A", "\u5C6C\u6027\uFF1A\u7A7A", "Type: Null"],
        [773, "silvally", "\u94F6\u4F34\u6218\u517D", "\u9280\u4F34\u6230\u7378", "Silvally"],
        [774, "minior", "\u5C0F\u9668\u661F", "\u5C0F\u9695\u661F", "Minior"],
        [775, "komala", "\u6811\u6795\u5C3E\u718A", "\u6A39\u6795\u5C3E\u718A", "Komala"],
        [776, "turtonator", "\u7206\u7130\u9F9F\u517D", "\u7206\u7130\u9F9C\u7378", "Turtonator"],
        [777, "togedemaru", "\u6258\u6208\u5FB7\u739B\u5C14", "\u6258\u6208\u5FB7\u746A\u723E", "Togedemaru"],
        [778, "mimikyu", "\u8C1C\u62DF\u4E18", "\u8B0E\u64EC\uFF31", "Mimikyu"],
        [779, "bruxish", "\u78E8\u7259\u5F69\u76AE\u9C7C", "\u78E8\u7259\u5F69\u76AE\u9B5A", "Bruxish"],
        [780, "drampa", "\u8001\u7FC1\u9F99", "\u8001\u7FC1\u9F8D", "Drampa"],
        [781, "dhelmise", "\u7834\u7834\u8235\u8F6E", "\u7834\u7834\u8235\u8F2A", "Dhelmise"],
        [782, "jangmo-o", "\u5FC3\u9CDE\u5B9D", "\u5FC3\u9C57\u5BF6", "Jangmo-o"],
        [783, "hakamo-o", "\u9CDE\u7532\u9F99", "\u9C57\u7532\u9F8D", "Hakamo-o"],
        [784, "kommo-o", "\u6756\u5C3E\u9CDE\u7532\u9F99", "\u6756\u5C3E\u9C57\u7532\u9F8D", "Kommo-o"],
        [785, "tapu-koko", "\u5361\u749E\u30FB\u9E23\u9E23", "\u5361\u749E\u30FB\u9CF4\u9CF4", "Tapu Koko"],
        [786, "tapu-lele", "\u5361\u749E\u30FB\u8776\u8776", "\u5361\u749E\u30FB\u8776\u8776", "Tapu Lele"],
        [787, "tapu-bulu", "\u5361\u749E\u30FB\u54DE\u54DE", "\u5361\u749E\u30FB\u54DE\u54DE", "Tapu Bulu"],
        [788, "tapu-fini", "\u5361\u749E\u30FB\u9CCD\u9CCD", "\u5361\u749E\u30FB\u9C2D\u9C2D", "Tapu Fini"],
        [789, "cosmog", "\u79D1\u65AF\u83AB\u53E4", "\u79D1\u65AF\u83AB\u53E4", "Cosmog"],
        [790, "cosmoem", "\u79D1\u65AF\u83AB\u59C6", "\u79D1\u65AF\u83AB\u59C6", "Cosmoem"],
        [791, "solgaleo", "\u7D22\u5C14\u8FE6\u96F7\u6B27", "\u7D22\u723E\u8FE6\u96F7\u6B50", "Solgaleo"],
        [792, "lunala", "\u9732\u5948\u96C5\u62C9", "\u9732\u5948\u96C5\u62C9", "Lunala"],
        [793, "nihilego", "\u865A\u543E\u4F0A\u5FB7", "\u865B\u543E\u4F0A\u5FB7", "Nihilego"],
        [794, "buzzwole", "\u7206\u808C\u868A", "\u7206\u808C\u868A", "Buzzwole"],
        [795, "pheromosa", "\u8D39\u6D1B\u7F8E\u8782", "\u8CBB\u6D1B\u7F8E\u8782", "Pheromosa"],
        [796, "xurkitree", "\u7535\u675F\u6728", "\u96FB\u675F\u6728", "Xurkitree"],
        [797, "celesteela", "\u94C1\u706B\u8F89\u591C", "\u9435\u706B\u8F1D\u591C", "Celesteela"],
        [798, "kartana", "\u7EB8\u5FA1\u5251", "\u7D19\u5FA1\u528D", "Kartana"],
        [799, "guzzlord", "\u6076\u98DF\u5927\u738B", "\u60E1\u98DF\u5927\u738B", "Guzzlord"],
        [800, "necrozma", "\u5948\u514B\u6D1B\u5179\u739B", "\u5948\u514B\u6D1B\u8332\u746A", "Necrozma"],
        [801, "magearna", "\u739B\u673A\u96C5\u5A1C", "\u746A\u6A5F\u96C5\u5A1C", "Magearna"],
        [802, "marshadow", "\u739B\u590F\u591A", "\u746A\u590F\u591A", "Marshadow"],
        [803, "poipole", "\u6BD2\u8D1D\u6BD4", "\u6BD2\u8C9D\u6BD4", "Poipole"],
        [804, "naganadel", "\u56DB\u989A\u9488\u9F99", "\u56DB\u984E\u91DD\u9F8D", "Naganadel"],
        [805, "stakataka", "\u5792\u78CA\u77F3", "\u58D8\u78CA\u77F3", "Stakataka"],
        [806, "blacephalon", "\u7830\u5934\u5C0F\u4E11", "\u7830\u982D\u5C0F\u4E11", "Blacephalon"],
        [807, "zeraora", "\u6377\u62C9\u5965\u62C9", "\u6377\u62C9\u5967\u62C9", "Zeraora"],
        [808, "meltan", "\u7F8E\u5F55\u5766", "\u7F8E\u9304\u5766", "Meltan"],
        [809, "melmetal", "\u7F8E\u5F55\u6885\u5854", "\u7F8E\u9304\u6885\u5854", "Melmetal"],
        [810, "grookey", "\u6572\u97F3\u7334", "\u6572\u97F3\u7334", "Grookey"],
        [811, "thwackey", "\u556A\u549A\u7334", "\u556A\u549A\u7334", "Thwackey"],
        [812, "rillaboom", "\u8F70\u64C2\u91D1\u521A\u7329", "\u8F5F\u64C2\u91D1\u525B\u7329", "Rillaboom"],
        [813, "scorbunny", "\u708E\u5154\u513F", "\u708E\u5154\u5152", "Scorbunny"],
        [814, "raboot", "\u817E\u8E74\u5C0F\u5C06", "\u9A30\u8E74\u5C0F\u5C07", "Raboot"],
        [815, "cinderace", "\u95EA\u7130\u738B\u724C", "\u9583\u7130\u738B\u724C", "Cinderace"],
        [816, "sobble", "\u6CEA\u773C\u8725", "\u6DDA\u773C\u8725", "Sobble"],
        [817, "drizzile", "\u53D8\u6DA9\u8725", "\u8B8A\u6F80\u8725", "Drizzile"],
        [818, "inteleon", "\u5343\u9762\u907F\u5F79", "\u5343\u9762\u907F\u5F79", "Inteleon"],
        [819, "skwovet", "\u8D2A\u5FC3\u6817\u9F20", "\u8CAA\u5FC3\u6817\u9F20", "Skwovet"],
        [820, "greedent", "\u85CF\u9971\u6817\u9F20", "\u85CF\u98FD\u6817\u9F20", "Greedent"],
        [821, "rookidee", "\u7A1A\u5C71\u96C0", "\u7A1A\u5C71\u96C0", "Rookidee"],
        [822, "corvisquire", "\u84DD\u9E26", "\u85CD\u9D09", "Corvisquire"],
        [823, "corviknight", "\u94A2\u94E0\u9E26", "\u92FC\u93A7\u9D09", "Corviknight"],
        [824, "blipbug", "\u7D22\u4FA6\u866B", "\u7D22\u5075\u87F2", "Blipbug"],
        [825, "dottler", "\u5929\u7F69\u866B", "\u5929\u7F69\u87F2", "Dottler"],
        [826, "orbeetle", "\u4EE5\u6B27\u8DEF\u666E", "\u4EE5\u6B50\u8DEF\u666E", "Orbeetle"],
        [827, "nickit", "\u72E1\u5C0F\u72D0", "\u5077\u5152\u72D0", "Nickit"],
        [828, "thievul", "\u733E\u5927\u72D0", "\u72D0\u5927\u76DC", "Thievul"],
        [829, "gossifleur", "\u5E7C\u68C9\u68C9", "\u5E7C\u68C9\u68C9", "Gossifleur"],
        [830, "eldegoss", "\u767D\u84EC\u84EC", "\u767D\u84EC\u84EC", "Eldegoss"],
        [831, "wooloo", "\u6BDB\u8FAB\u7F8A", "\u6BDB\u8FAE\u7F8A", "Wooloo"],
        [832, "dubwool", "\u6BDB\u6BDB\u89D2\u7F8A", "\u6BDB\u6BDB\u89D2\u7F8A", "Dubwool"],
        [833, "chewtle", "\u54AC\u54AC\u9F9F", "\u54AC\u54AC\u9F9C", "Chewtle"],
        [834, "drednaw", "\u66B4\u566C\u9F9F", "\u66B4\u566C\u9F9C", "Drednaw"],
        [835, "yamper", "\u6765\u7535\u6C6A", "\u4F86\u96FB\u6C6A", "Yamper"],
        [836, "boltund", "\u9010\u7535\u72AC", "\u9010\u96FB\u72AC", "Boltund"],
        [837, "rolycoly", "\u5C0F\u70AD\u4ED4", "\u5C0F\u70AD\u4ED4", "Rolycoly"],
        [838, "carkol", "\u5927\u70AD\u8F66", "\u5927\u70AD\u8ECA", "Carkol"],
        [839, "coalossal", "\u5DE8\u70AD\u5C71", "\u5DE8\u70AD\u5C71", "Coalossal"],
        [840, "applin", "\u5543\u679C\u866B", "\u5543\u679C\u87F2", "Applin"],
        [841, "flapple", "\u82F9\u88F9\u9F99", "\u860B\u88F9\u9F8D", "Flapple"],
        [842, "appletun", "\u4E30\u871C\u9F99", "\u8C50\u871C\u9F8D", "Appletun"],
        [843, "silicobra", "\u6C99\u5305\u86C7", "\u6C99\u5305\u86C7", "Silicobra"],
        [844, "sandaconda", "\u6C99\u87BA\u87D2", "\u6C99\u87BA\u87D2", "Sandaconda"],
        [845, "cramorant", "\u53E4\u6708\u9E1F", "\u53E4\u6708\u9CE5", "Cramorant"],
        [846, "arrokuda", "\u523A\u68AD\u9C7C", "\u523A\u68AD\u9B5A", "Arrokuda"],
        [847, "barraskewda", "\u623D\u6597\u5C16\u68AD", "\u623D\u6597\u5C16\u68AD", "Barraskewda"],
        [848, "toxel", "\u7535\u97F3\u5A74", "\u6BD2\u96FB\u5B30", "Toxel"],
        [849, "toxtricity", "\u98A4\u5F26\u877E\u8788", "\u986B\u5F26\u8811\u8788", "Toxtricity"],
        [850, "sizzlipede", "\u70E7\u706B\u86A3", "\u71D2\u706B\u86A3", "Sizzlipede"],
        [851, "centiskorch", "\u711A\u7130\u86A3", "\u711A\u7130\u86A3", "Centiskorch"],
        [852, "clobbopus", "\u62F3\u62F3\u86F8", "\u62F3\u62F3\u86F8", "Clobbopus"],
        [853, "grapploct", "\u516B\u722A\u6B66\u5E08", "\u516B\u722A\u6B66\u5E2B", "Grapploct"],
        [854, "sinistea", "\u6765\u60B2\u8336", "\u4F86\u60B2\u8336", "Sinistea"],
        [855, "polteageist", "\u6016\u601D\u58F6", "\u6016\u601D\u58FA", "Polteageist"],
        [856, "hatenna", "\u8FF7\u5E03\u8389\u59C6", "\u8FF7\u5E03\u8389\u59C6", "Hatenna"],
        [857, "hattrem", "\u63D0\u5E03\u8389\u59C6", "\u63D0\u5E03\u8389\u59C6", "Hattrem"],
        [858, "hatterene", "\u5E03\u8389\u59C6\u6E29", "\u5E03\u8389\u59C6\u6EAB", "Hatterene"],
        [859, "impidimp", "\u6363\u86CB\u5C0F\u5996", "\u6417\u86CB\u5C0F\u5996", "Impidimp"],
        [860, "morgrem", "\u8BC8\u552C\u9B54", "\u8A50\u552C\u9B54", "Morgrem"],
        [861, "grimmsnarl", "\u957F\u6BDB\u5DE8\u9B54", "\u9577\u6BDB\u5DE8\u9B54", "Grimmsnarl"],
        [862, "obstagoon", "\u5835\u62E6\u718A", "\u5835\u6514\u718A", "Obstagoon"],
        [863, "perrserker", "\u55B5\u5934\u76EE", "\u55B5\u982D\u76EE", "Perrserker"],
        [864, "cursola", "\u9B54\u7075\u73CA\u745A", "\u9B54\u9748\u73CA\u745A", "Cursola"],
        [865, "sirfetchd", "\u8471\u6E38\u5175", "\u8525\u904A\u5175", "Sirfetch\u2019d"],
        [866, "mr-rime", "\u8E0F\u51B0\u4EBA\u5076", "\u8E0F\u51B0\u4EBA\u5076", "Mr. Rime"],
        [867, "runerigus", "\u8FED\u5931\u677F", "\u6B7B\u795E\u677F", "Runerigus"],
        [868, "milcery", "\u5C0F\u4ED9\u5976", "\u5C0F\u4ED9\u5976", "Milcery"],
        [869, "alcremie", "\u971C\u5976\u4ED9", "\u971C\u5976\u4ED9", "Alcremie"],
        [870, "falinks", "\u5217\u9635\u5175", "\u5217\u9663\u5175", "Falinks"],
        [871, "pincurchin", "\u556A\u5693\u6D77\u80C6", "\u556A\u5693\u6D77\u81BD", "Pincurchin"],
        [872, "snom", "\u96EA\u541E\u866B", "\u96EA\u541E\u87F2", "Snom"],
        [873, "frosmoth", "\u96EA\u7ED2\u86FE", "\u96EA\u7D68\u86FE", "Frosmoth"],
        [874, "stonjourner", "\u5DE8\u77F3\u4E01", "\u5DE8\u77F3\u4E01", "Stonjourner"],
        [875, "eiscue", "\u51B0\u780C\u9E45", "\u51B0\u780C\u9D5D", "Eiscue"],
        [876, "indeedee", "\u7231\u7BA1\u4F8D", "\u611B\u7BA1\u4F8D", "Indeedee"],
        [877, "morpeko", "\u83AB\u9C81\u8D1D\u53EF", "\u83AB\u9B6F\u8C9D\u53EF", "Morpeko"],
        [878, "cufant", "\u94DC\u8C61", "\u9285\u8C61", "Cufant"],
        [879, "copperajah", "\u5927\u738B\u94DC\u8C61", "\u5927\u738B\u9285\u8C61", "Copperajah"],
        [880, "dracozolt", "\u96F7\u9E1F\u9F99", "\u96F7\u9CE5\u9F8D", "Dracozolt"],
        [881, "arctozolt", "\u96F7\u9E1F\u6D77\u517D", "\u96F7\u9CE5\u6D77\u7378", "Arctozolt"],
        [882, "dracovish", "\u9CC3\u9C7C\u9F99", "\u9C13\u9B5A\u9F8D", "Dracovish"],
        [883, "arctovish", "\u9CC3\u9C7C\u6D77\u517D", "\u9C13\u9B5A\u6D77\u7378", "Arctovish"],
        [884, "duraludon", "\u94DD\u94A2\u9F99", "\u92C1\u92FC\u9F8D", "Duraludon"],
        [885, "dreepy", "\u591A\u9F99\u6885\u897F\u4E9A", "\u591A\u9F8D\u6885\u897F\u4E9E", "Dreepy"],
        [886, "drakloak", "\u591A\u9F99\u5947", "\u591A\u9F8D\u5947", "Drakloak"],
        [887, "dragapult", "\u591A\u9F99\u5DF4\u9C81\u6258", "\u591A\u9F8D\u5DF4\u9B6F\u6258", "Dragapult"],
        [888, "zacian", "\u82CD\u54CD", "\u84BC\u97FF", "Zacian"],
        [889, "zamazenta", "\u85CF\u739B\u7136\u7279", "\u85CF\u746A\u7136\u7279", "Zamazenta"],
        [890, "eternatus", "\u65E0\u6781\u6C70\u90A3", "\u7121\u6975\u6C70\u90A3", "Eternatus"],
        [891, "kubfu", "\u718A\u5F92\u5F1F", "\u718A\u5F92\u5F1F", "Kubfu"],
        [892, "urshifu", "\u6B66\u9053\u718A\u5E08", "\u6B66\u9053\u718A\u5E2B", "Urshifu"],
        [893, "zarude", "\u8428\u622E\u5FB7", "\u85A9\u622E\u5FB7", "Zarude"],
        [894, "regieleki", "\u96F7\u5409\u827E\u52D2\u5947", "\u96F7\u5409\u827E\u52D2\u5947", "Regieleki"],
        [895, "regidrago", "\u96F7\u5409\u94CE\u62C9\u6208", "\u96F7\u5409\u9438\u62C9\u6208", "Regidrago"],
        [896, "glastrier", "\u96EA\u66B4\u9A6C", "\u96EA\u66B4\u99AC", "Glastrier"],
        [897, "spectrier", "\u7075\u5E7D\u9A6C", "\u9748\u5E7D\u99AC", "Spectrier"],
        [898, "calyrex", "\u857E\u51A0\u738B", "\u857E\u51A0\u738B", "Calyrex"],
        [899, "wyrdeer", "\u8BE1\u89D2\u9E7F", "\u8A6D\u89D2\u9E7F", "Wyrdeer"],
        [900, "kleavor", "\u5288\u65A7\u87B3\u8782", "\u5288\u65A7\u87B3\u8782", "Kleavor"],
        [901, "ursaluna", "\u6708\u6708\u718A", "\u6708\u6708\u718A", "Ursaluna"],
        [902, "basculegion", "\u5E7D\u5C3E\u7384\u9C7C", "\u5E7D\u5C3E\u7384\u9B5A", "Basculegion"],
        [903, "sneasler", "\u5927\u72C3\u62C9", "\u5927\u72C3\u62C9", "Sneasler"],
        [904, "overqwil", "\u4E07\u9488\u9C7C", "\u842C\u91DD\u9B5A", "Overqwil"],
        [905, "enamorus", "\u7737\u604B\u4E91", "\u7737\u6200\u96F2", "Enamorus"],
        [906, "sprigatito", "\u65B0\u53F6\u55B5", "\u65B0\u8449\u55B5", "Sprigatito"],
        [907, "floragato", "\u8482\u857E\u55B5", "\u8482\u857E\u55B5", "Floragato"],
        [908, "meowscarada", "\u9B54\u5E7B\u5047\u9762\u55B5", "\u9B54\u5E7B\u5047\u9762\u55B5", "Meowscarada"],
        [909, "fuecoco", "\u5446\u706B\u9CC4", "\u5446\u706B\u9C77", "Fuecoco"],
        [910, "crocalor", "\u7099\u70EB\u9CC4", "\u7099\u71D9\u9C77", "Crocalor"],
        [911, "skeledirge", "\u9AA8\u7EB9\u5DE8\u58F0\u9CC4", "\u9AA8\u7D0B\u5DE8\u8072\u9C77", "Skeledirge"],
        [912, "quaxly", "\u6DA6\u6C34\u9E2D", "\u6F64\u6C34\u9D28", "Quaxly"],
        [913, "quaxwell", "\u6D8C\u8DC3\u9E2D", "\u6E67\u8E8D\u9D28", "Quaxwell"],
        [914, "quaquaval", "\u72C2\u6B22\u6D6A\u821E\u9E2D", "\u72C2\u6B61\u6D6A\u821E\u9D28", "Quaquaval"],
        [915, "lechonk", "\u7231\u5403\u8C5A", "\u611B\u5403\u8C5A", "Lechonk"],
        [916, "oinkologne", "\u98D8\u9999\u8C5A", "\u98C4\u9999\u8C5A", "Oinkologne"],
        [917, "tarountula", "\u56E2\u73E0\u86DB", "\u5718\u73E0\u86DB", "Tarountula"],
        [918, "spidops", "\u64CD\u9677\u86DB", "\u64CD\u9677\u86DB", "Spidops"],
        [919, "nymble", "\u8C46\u87CB\u87C0", "\u8C46\u87CB\u87C0", "Nymble"],
        [920, "lokix", "\u70C8\u817F\u8757", "\u70C8\u817F\u8757", "Lokix"],
        [921, "pawmi", "\u5E03\u62E8", "\u5E03\u64A5", "Pawmi"],
        [922, "pawmo", "\u5E03\u571F\u62E8", "\u5E03\u571F\u64A5", "Pawmo"],
        [923, "pawmot", "\u5DF4\u5E03\u571F\u62E8", "\u5DF4\u5E03\u571F\u64A5", "Pawmot"],
        [924, "tandemaus", "\u4E00\u5BF9\u9F20", "\u4E00\u5C0D\u9F20", "Tandemaus"],
        [925, "maushold", "\u4E00\u5BB6\u9F20", "\u4E00\u5BB6\u9F20", "Maushold"],
        [926, "fidough", "\u72D7\u4ED4\u5305", "\u72D7\u4ED4\u5305", "Fidough"],
        [927, "dachsbun", "\u9EBB\u82B1\u72AC", "\u9EBB\u82B1\u72AC", "Dachsbun"],
        [928, "smoliv", "\u8FF7\u4F60\u8299", "\u8FF7\u4F60\u8299", "Smoliv"],
        [929, "dolliv", "\u5965\u5229\u7EBD", "\u5967\u5229\u7D10", "Dolliv"],
        [930, "arboliva", "\u5965\u5229\u74E6", "\u5967\u5229\u74E6", "Arboliva"],
        [931, "squawkabilly", "\u6012\u9E66\u54E5", "\u6012\u9E1A\u54E5", "Squawkabilly"],
        [932, "nacli", "\u76D0\u77F3\u5B9D", "\u9E7D\u77F3\u5BF6", "Nacli"],
        [933, "naclstack", "\u76D0\u77F3\u5792", "\u9E7D\u77F3\u58D8", "Naclstack"],
        [934, "garganacl", "\u76D0\u77F3\u5DE8\u7075", "\u9E7D\u77F3\u5DE8\u9748", "Garganacl"],
        [935, "charcadet", "\u70AD\u5C0F\u4F8D", "\u70AD\u5C0F\u4F8D", "Charcadet"],
        [936, "armarouge", "\u7EA2\u83B2\u94E0\u9A91", "\u7D05\u84EE\u93A7\u9A0E", "Armarouge"],
        [937, "ceruledge", "\u82CD\u708E\u5203\u9B3C", "\u84BC\u708E\u5203\u9B3C", "Ceruledge"],
        [938, "tadbulb", "\u5149\u86AA\u4ED4", "\u5149\u86AA\u4ED4", "Tadbulb"],
        [939, "bellibolt", "\u7535\u809A\u86D9", "\u96FB\u809A\u86D9", "Bellibolt"],
        [940, "wattrel", "\u7535\u6D77\u71D5", "\u96FB\u6D77\u71D5", "Wattrel"],
        [941, "kilowattrel", "\u5927\u7535\u6D77\u71D5", "\u5927\u96FB\u6D77\u71D5", "Kilowattrel"],
        [942, "maschiff", "\u5076\u53EB\u7352", "\u5076\u53EB\u7352", "Maschiff"],
        [943, "mabosstiff", "\u7352\u6559\u7236", "\u7352\u6559\u7236", "Mabosstiff"],
        [944, "shroodle", "\u6ECB\u6C41\u9F39", "\u6ECB\u6C41\u9F34", "Shroodle"],
        [945, "grafaiai", "\u6D82\u6807\u5BA2", "\u5857\u6A19\u5BA2", "Grafaiai"],
        [946, "bramblin", "\u7EB3\u566C\u8349", "\u7D0D\u566C\u8349", "Bramblin"],
        [947, "brambleghast", "\u6016\u7EB3\u566C\u8349", "\u6016\u7D0D\u566C\u8349", "Brambleghast"],
        [948, "toedscool", "\u539F\u91CE\u6C34\u6BCD", "\u539F\u91CE\u6C34\u6BCD", "Toedscool"],
        [949, "toedscruel", "\u9646\u5730\u6C34\u6BCD", "\u9678\u5730\u6C34\u6BCD", "Toedscruel"],
        [950, "klawf", "\u6BDB\u5D16\u87F9", "\u6BDB\u5D16\u87F9", "Klawf"],
        [951, "capsakid", "\u70ED\u8FA3\u5A03", "\u71B1\u8FA3\u5A03", "Capsakid"],
        [952, "scovillain", "\u72E0\u8FA3\u6912", "\u72E0\u8FA3\u6912", "Scovillain"],
        [953, "rellor", "\u866B\u6EDA\u6CE5", "\u87F2\u6EFE\u6CE5", "Rellor"],
        [954, "rabsca", "\u866B\u7532\u5723", "\u87F2\u7532\u8056", "Rabsca"],
        [955, "flittle", "\u98D8\u98D8\u96CF", "\u98C4\u98C4\u96DB", "Flittle"],
        [956, "espathra", "\u8D85\u80FD\u8273\u9E35", "\u8D85\u80FD\u8277\u9D15", "Espathra"],
        [957, "tinkatink", "\u5C0F\u953B\u5320", "\u5C0F\u935B\u5320", "Tinkatink"],
        [958, "tinkatuff", "\u5DE7\u953B\u5320", "\u5DE7\u935B\u5320", "Tinkatuff"],
        [959, "tinkaton", "\u5DE8\u953B\u5320", "\u5DE8\u935B\u5320", "Tinkaton"],
        [960, "wiglett", "\u6D77\u5730\u9F20", "\u6D77\u5730\u9F20", "Wiglett"],
        [961, "wugtrio", "\u4E09\u6D77\u5730\u9F20", "\u4E09\u6D77\u5730\u9F20", "Wugtrio"],
        [962, "bombirdier", "\u4E0B\u77F3\u9E1F", "\u4E0B\u77F3\u9CE5", "Bombirdier"],
        [963, "finizen", "\u6CE2\u666E\u6D77\u8C5A", "\u6CE2\u666E\u6D77\u8C5A", "Finizen"],
        [964, "palafin", "\u6D77\u8C5A\u4FA0", "\u6D77\u8C5A\u4FE0", "Palafin"],
        [965, "varoom", "\u5657\u9686\u9686", "\u5657\u9686\u9686", "Varoom"],
        [966, "revavroom", "\u666E\u9686\u9686\u59C6", "\u666E\u9686\u9686\u59C6", "Revavroom"],
        [967, "cyclizar", "\u6469\u6258\u8725", "\u6469\u6258\u8725", "Cyclizar"],
        [968, "orthworm", "\u62D6\u62D6\u8693", "\u62D6\u62D6\u8693", "Orthworm"],
        [969, "glimmet", "\u6676\u5149\u82BD", "\u6676\u5149\u82BD", "Glimmet"],
        [970, "glimmora", "\u6676\u5149\u82B1", "\u6676\u5149\u82B1", "Glimmora"],
        [971, "greavard", "\u5893\u4ED4\u72D7", "\u5893\u4ED4\u72D7", "Greavard"],
        [972, "houndstone", "\u5893\u626C\u72AC", "\u5893\u63DA\u72AC", "Houndstone"],
        [973, "flamigo", "\u7E8F\u7EA2\u9E64", "\u7E8F\u7D05\u9DB4", "Flamigo"],
        [974, "cetoddle", "\u8D70\u9CB8", "\u8D70\u9BE8", "Cetoddle"],
        [975, "cetitan", "\u6D69\u5927\u9CB8", "\u6D69\u5927\u9BE8", "Cetitan"],
        [976, "veluza", "\u8F7B\u8EAB\u9CD5", "\u8F15\u8EAB\u9C48", "Veluza"],
        [977, "dondozo", "\u5403\u543C\u9738", "\u5403\u543C\u9738", "Dondozo"],
        [978, "tatsugiri", "\u7C73\u7ACB\u9F99", "\u7C73\u7ACB\u9F8D", "Tatsugiri"],
        [979, "annihilape", "\u5F03\u4E16\u7334", "\u68C4\u4E16\u7334", "Annihilape"],
        [980, "clodsire", "\u571F\u738B", "\u571F\u738B", "Clodsire"],
        [981, "farigiraf", "\u5947\u9E92\u9E9F", "\u5947\u9E92\u9E9F", "Farigiraf"],
        [982, "dudunsparce", "\u571F\u9F99\u8282\u8282", "\u571F\u9F8D\u7BC0\u7BC0", "Dudunsparce"],
        [983, "kingambit", "\u4EC6\u5200\u5C06\u519B", "\u4EC6\u5200\u5C07\u8ECD", "Kingambit"],
        [984, "great-tusk", "\u96C4\u4F1F\u7259", "\u96C4\u5049\u7259", "Great Tusk"],
        [985, "scream-tail", "\u543C\u53EB\u5C3E", "\u543C\u53EB\u5C3E", "Scream Tail"],
        [986, "brute-bonnet", "\u731B\u6076\u83C7", "\u731B\u60E1\u83C7", "Brute Bonnet"],
        [987, "flutter-mane", "\u632F\u7FFC\u53D1", "\u632F\u7FFC\u9AEE", "Flutter Mane"],
        [988, "slither-wing", "\u722C\u5730\u7FC5", "\u722C\u5730\u7FC5", "Slither Wing"],
        [989, "sandy-shocks", "\u6C99\u94C1\u76AE", "\u6C99\u9435\u76AE", "Sandy Shocks"],
        [990, "iron-treads", "\u94C1\u8F4D\u8FF9", "\u9435\u8F4D\u8DE1", "Iron Treads"],
        [991, "iron-bundle", "\u94C1\u5305\u88B1", "\u9435\u5305\u88B1", "Iron Bundle"],
        [992, "iron-hands", "\u94C1\u81C2\u8180", "\u9435\u81C2\u8180", "Iron Hands"],
        [993, "iron-jugulis", "\u94C1\u8116\u9888", "\u9435\u8116\u9838", "Iron Jugulis"],
        [994, "iron-moth", "\u94C1\u6BD2\u86FE", "\u9435\u6BD2\u86FE", "Iron Moth"],
        [995, "iron-thorns", "\u94C1\u8346\u68D8", "\u9435\u834A\u68D8", "Iron Thorns"],
        [996, "frigibax", "\u51C9\u810A\u9F99", "\u6DBC\u810A\u9F8D", "Frigibax"],
        [997, "arctibax", "\u51BB\u810A\u9F99", "\u51CD\u810A\u9F8D", "Arctibax"],
        [998, "baxcalibur", "\u621F\u810A\u9F99", "\u621F\u810A\u9F8D", "Baxcalibur"],
        [999, "gimmighoul", "\u7D22\u8D22\u7075", "\u7D22\u8CA1\u9748", "Gimmighoul"],
        [1e3, "gholdengo", "\u8D5B\u5BCC\u8C6A", "\u8CFD\u5BCC\u8C6A", "Gholdengo"],
        [1001, "wo-chien", "\u53E4\u7B80\u8717", "\u53E4\u7C21\u8778", "Wo-Chien"],
        [1002, "chien-pao", "\u53E4\u5251\u8C79", "\u53E4\u528D\u8C79", "Chien-Pao"],
        [1003, "ting-lu", "\u53E4\u9F0E\u9E7F", "\u53E4\u9F0E\u9E7F", "Ting-Lu"],
        [1004, "chi-yu", "\u53E4\u7389\u9C7C", "\u53E4\u7389\u9B5A", "Chi-Yu"],
        [1005, "roaring-moon", "\u8F70\u9E23\u6708", "\u8F5F\u9CF4\u6708", "Roaring Moon"],
        [1006, "iron-valiant", "\u94C1\u6B66\u8005", "\u9435\u6B66\u8005", "Iron Valiant"],
        [1007, "koraidon", "\u6545\u52D2\u987F", "\u6545\u52D2\u9813", "Koraidon"],
        [1008, "miraidon", "\u5BC6\u52D2\u987F", "\u5BC6\u52D2\u9813", "Miraidon"],
        [1009, "walking-wake", "\u6CE2\u8361\u6C34", "\u6CE2\u76EA\u6C34", "Walking Wake"],
        [1010, "iron-leaves", "\u94C1\u6591\u53F6", "\u9435\u6591\u8449", "Iron Leaves"],
        [1011, "dipplin", "\u88F9\u871C\u866B", "\u88F9\u871C\u87F2", "Dipplin"],
        [1012, "poltchageist", "\u65AF\u9B54\u8336", "\u65AF\u9B54\u8336", "Poltchageist"],
        [1013, "sinistcha", "\u6765\u60B2\u7C97\u8336", "\u4F86\u60B2\u7C97\u8336", "Sinistcha"],
        [1014, "okidogi", "\u591F\u8D5E\u72D7", "\u5920\u8B9A\u72D7", "Okidogi"],
        [1015, "munkidori", "\u613F\u589E\u733F", "\u9858\u589E\u733F", "Munkidori"],
        [1016, "fezandipiti", "\u5409\u96C9\u9E21", "\u5409\u96C9\u96DE", "Fezandipiti"],
        [1017, "ogerpon", "\u5384\u8BE1\u692A", "\u5384\u9B3C\u692A", "Ogerpon"],
        [1018, "archaludon", "\u94DD\u94A2\u6865\u9F99", "\u92C1\u92FC\u6A4B\u9F8D", "Archaludon"],
        [1019, "hydrapple", "\u871C\u96C6\u5927\u86C7", "\u871C\u96C6\u5927\u86C7", "Hydrapple"],
        [1020, "gouging-fire", "\u7834\u7A7A\u7130", "\u7834\u7A7A\u7130", "Gouging Fire"],
        [1021, "raging-bolt", "\u731B\u96F7\u9F13", "\u731B\u96F7\u9F13", "Raging Bolt"],
        [1022, "iron-boulder", "\u94C1\u78D0\u5CA9", "\u9435\u78D0\u5CA9", "Iron Boulder"],
        [1023, "iron-crown", "\u94C1\u5934\u58F3", "\u9435\u982D\u6BBC", "Iron Crown"],
        [1024, "terapagos", "\u592A\u4E50\u5DF4\u6208\u65AF", "\u592A\u6A02\u5DF4\u6208\u65AF", "Terapagos"],
        [1025, "pecharunt", "\u6843\u6B79\u90CE", "\u6843\u6B79\u90CE", "Pecharunt"],
      ],
    };

    // src/client/dsh/panelData.ts
    var KEY_LANGUAGE = "language";
    var KEY_AGENTS = "ai_agents";
    var KEY_ROUTES = "dsh:dispatch_routes";
    var CATALOG = catalog_default.entries;
    function localToday() {
      const d = /* @__PURE__ */ new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    }
    function localeOf(config) {
      const raw = config[KEY_LANGUAGE];
      return SUPPORTED_LOCALES.some((l) => l.value === raw) ? raw : "zh-Hans";
    }
    function pokemonNameOf(key, locale) {
      const row = CATALOG.find((r) => r[1] === key);
      if (row === void 0) {
        return key;
      }
      return locale === "zh-Hant" ? row[3] : locale === "en" ? row[4] : row[2];
    }
    var localeCache = /* @__PURE__ */ new WeakMap();
    function loadLocale(client) {
      let cached = localeCache.get(client);
      if (cached === void 0) {
        cached = client
          .configRead({ keys: [KEY_LANGUAGE] })
          .then((r) => (r.ok ? localeOf(r.data.keyValues) : "zh-Hans"))
          .catch(() => "zh-Hans");
        localeCache.set(client, cached);
      }
      return cached;
    }
    function agentsOf(config) {
      let list = [];
      try {
        const parsed = JSON.parse(config[KEY_AGENTS] ?? "");
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        list = [];
      }
      return list.filter((a) => typeof a?.command === "string" && a.command.trim() !== "");
    }
    function routesOf(config) {
      let map = {};
      try {
        const parsed = JSON.parse(config[KEY_ROUTES] ?? "");
        map = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
      } catch {
        map = {};
      }
      return Object.entries(map).map(([tag, value]) => ({ tag, ...value }));
    }
    function healthLevel(status) {
      if (status === "down") {
        return "fail";
      }
      return status === "paused" || status === "degraded" ? "warn" : "ok";
    }
    function healthFromLinks(links) {
      const feishu = links.find((l) => l.provider === "feishu");
      if (feishu === void 0) {
        return { level: "ok", lastSuccessAt: null, nextPollAt: null, consecutiveFailures: 0, pendingCount: 0 };
      }
      const nextPollAt = feishu.nextPollAt === null ? null : new Date(feishu.nextPollAt).toISOString();
      return {
        level: healthLevel(feishu.level),
        lastSuccessAt: feishu.lastSuccessAt,
        nextPollAt,
        consecutiveFailures: feishu.consecutiveFailures,
        pendingCount: feishu.pendingCount,
      };
    }
    function authFromLinks(links) {
      const feishu = links.find((l) => l.provider === "feishu");
      return { authorized: feishu?.level !== "off", expired: false };
    }
    function matchesRow(row, query, lower) {
      const [id, key, hans, hant, en] = row;
      return (
        hans.includes(query) ||
        hant.includes(query) ||
        en.toLowerCase().includes(lower) ||
        key.toLowerCase().includes(lower) ||
        String(id) === lower
      );
    }
    function createPokemonName(locale) {
      return (key) => pokemonNameOf(key, locale);
    }
    function createPokemonSearch(locale) {
      const nameOf = (row) => (locale === "zh-Hant" ? row[3] : locale === "en" ? row[4] : row[2]);
      const bundled = ["pikachu", "psyduck", "bulbasaur", "chansey", "eevee", "snorlax"]
        .map((key) => CATALOG.find((row) => row[1] === key))
        .filter((row) => row !== void 0)
        .map((row) => ({ key: row[1], name: nameOf(row), number: row[0], english: row[4] }));
      return (query) => {
        const trimmed = query.trim();
        const lower = trimmed.toLowerCase();
        if (trimmed === "") {
          return Promise.resolve(bundled);
        }
        const hits = [];
        for (const row of CATALOG) {
          if (matchesRow(row, trimmed, lower)) {
            hits.push({ key: row[1], name: nameOf(row), number: row[0], english: row[4] });
            if (hits.length >= 30) {
              break;
            }
          }
        }
        return Promise.resolve(hits);
      };
    }
    function dataOf(result, fallback) {
      return result?.ok === true ? result.data : fallback;
    }
    function snapshotTasks(snapshot) {
      if (snapshot === null) {
        return [];
      }
      const segments = [
        ...snapshot.adventure.active,
        ...snapshot.adventure.dueToday,
        ...snapshot.adventure.overdue,
        ...snapshot.grass,
        ...snapshot.route,
        ...snapshot.dex.done,
        ...snapshot.dex.cancelled,
      ];
      const seen = /* @__PURE__ */ new Set();
      const merged = [];
      for (const task of segments) {
        if (!seen.has(task.id)) {
          seen.add(task.id);
          merged.push(task);
        }
      }
      return merged;
    }
    function snapshotMessages(snapshot) {
      if (snapshot === null) {
        return [];
      }
      return [
        ...snapshot.radio.pending,
        ...snapshot.radio.none,
        ...snapshot.radio.error,
        ...snapshot.radio.escaped,
        ...snapshot.radio.accepted,
      ];
    }
    function entityViews(snapshot, links) {
      return {
        tasks: snapshotTasks(snapshot),
        categories: snapshot?.categories ?? [],
        dimensions: snapshot?.dimensions ?? [],
        tags: snapshot?.tags ?? [],
        messages: snapshotMessages(snapshot),
        health: snapshot?.radio.health ?? healthFromLinks(links),
      };
    }
    async function fetchPanelData(client) {
      const [configR, dbR, diagR, filtersR, promptsR, snapR] = await Promise.all([
        client.configRead({}).catch(() => null),
        client.dbStatus().catch(() => null),
        client.diagnosticsSnapshot().catch(() => null),
        client.filterList().catch(() => null),
        client.promptList().catch(() => null),
        client.panelSnapshot().catch(() => null),
      ]);
      const config = dataOf(configR, { keyValues: {} }).keyValues;
      const links = dataOf(diagR, {
        links: [],
        helperCaps: null,
        shortcutRegistered: null,
        sshFamily: null,
      }).links;
      const snapshot = snapR?.ok === true ? snapR.data : null;
      const filters = dataOf(filtersR, { chats: [], counts: {}, lastPollAt: null });
      return {
        locale: localeOf(config),
        today: localToday(),
        ...entityViews(snapshot, links),
        auth: authFromLinks(links),
        followups: {},
        dispatches: {},
        sessions: snapshot?.logs ?? [],
        routes: routesOf(config),
        config,
        dbStatus: dataOf(dbR, null),
        agents: agentsOf(config),
        promptSpecs: dataOf(promptsR, { specs: [] }).specs,
        filters: filters.chats,
        filterLastPollAt: filters.lastPollAt ?? null,
        pokemonSearch: createPokemonSearch(localeOf(config)),
      };
    }

    // src/client/dsh/transport.ts
    var KNOWN_CODES = /* @__PURE__ */ new Set([...ERROR_CODES, "INVALID_ARGUMENT", "NOT_FOUND"]);
    function restoreError(error) {
      const known = KNOWN_CODES.has(error.code);
      const code = known ? error.code : "INVALID_ARGUMENT";
      const message = known ? error.message : `[${error.code}] ${error.message}`;
      if (typeof error.details.hint === "string" && error.details.hint !== "") {
        return { code, message, hint: error.details.hint };
      }
      return { code, message };
    }
    function normalizeDiagnostics(value) {
      if (value === null || typeof value !== "object" || !Array.isArray(value.links)) {
        return value;
      }
      const links = value.links.map((link) => {
        if (link === null || typeof link !== "object" || typeof link.level === "string") {
          return link;
        }
        const { status, ...rest } = link;
        return { ...rest, level: typeof status === "string" ? status : "off" };
      });
      return { ...value, links };
    }
    var REMOTE_CHANNEL = "/api";
    var REMOTE_ENDPOINT = "pky/call";
    function createDshRpcTransport(rpc) {
      const pageOpenListeners = /* @__PURE__ */ new Set();
      return {
        async send(command, params) {
          const args = params === void 0 ? { command } : { command, payload: params };
          const result = await rpc.call(REMOTE_CHANNEL, REMOTE_ENDPOINT, { args });
          if (!result.ok) {
            return { ok: false, error: restoreError(result.error) };
          }
          const envelope = result.value;
          if (envelope === null || typeof envelope !== "object" || typeof envelope.ok !== "boolean") {
            return {
              ok: false,
              error: {
                code: "INVALID_ARGUMENT",
                message: "Remote \u8FD4\u56DE\u503C\u4E0D\u662F\u4E1A\u52A1\u4FE1\u5C01",
              },
            };
          }
          if (!envelope.ok) {
            return { ok: false, error: envelope.error };
          }
          const data = command === "diagnosticsSnapshot" ? normalizeDiagnostics(envelope.data) : envelope.data;
          return { ok: true, data };
        },
        on(event, listener) {
          if (event !== "pageOpen") {
            return () => {};
          }
          pageOpenListeners.add(listener);
          return () => {
            pageOpenListeners.delete(listener);
          };
        },
        emitPageOpen(event) {
          for (const listener of pageOpenListeners) {
            listener(event);
          }
        },
      };
    }

    // src/client/dsh/sidebarPanel.tsx
    var import_react56 = require("react");

    // src/client/app/PluginDetailPage.tsx
    var import_react55 = require("react");

    // src/client/radio/RadioSegment.tsx
    var import_react12 = require("react");

    // src/client/ui/ui.module.css
    var css2 = `/**
 * \u5171\u4EAB UI \u539F\u8BED\u6837\u5F0F\uFF08CSS Modules \xB7 scoped\uFF09\uFF1A\u5BBF\u4E3B\u4E3B\u9898 token \`--dsw-alias-*\`\uFF08\u5B98\u65B9
 * practices \u53E3\u5F84\uFF1Atoken \u662F\u4E0E\u5BBF\u4E3B\u552F\u4E00\u5171\u4EAB\u7684\u6837\u5F0F\u4F9D\u8D56\uFF0C2026-10-13 \u5BF9\u9F50\uFF09\uFF0C\u5BBF\u4E3B\u672A\u6CE8\u5165\u65F6
 * \u56DE\u9000\u4E2D\u6027\u8272\uFF1B\u4E16\u754C\u89C2 scoped \u8272 \`--pcy-*\`
 * \u53EA\u6302\u5C0F\u56FE\u5F62\u5BB9\u5668\u3002\u547D\u4E2D\u533A \u226532px\uFF08a11y \u65AD\u8A00\u2463\uFF09\u3002\u96F6\u95EA\u70C1\uFF08\u65E0 animation \u58F0\u660E\uFF0CNFR-6\uFF09\u3002
 */

/* \u8868\u5355\u63A7\u4EF6\u7EDF\u4E00\u9AD8\u5EA6\u6863\uFF08border-box\uFF1B\u8F93\u5165/\u4E0B\u62C9/\u6309\u94AE\u7B49\u5355\u884C\u63A7\u4EF6\u5168\u8D70\u6B64\u6863\u2014\u2014\u540C\u6392\u7B49\u9AD8\uFF0C
 * dsw \u5BBF\u4E3B\u65E0\u5168\u5C40 box-sizing \u590D\u4F4D\uFF0C\u5404\u63A7\u4EF6\u663E\u5F0F\u58F0\u660E\uFF09\u3002\u6D88\u8D39\u65B9\u5E26\u56DE\u843D\u503C\u515C\u5E95\u3002 */
:root {
  --pcy-control-h: 32px;
}

/* \u4E16\u754C\u89C2 scoped \u8272\xB7\u6697\u8272\u914D\u5BF9\u503C\uFF08\u4EAE\u8272\u9ED8\u8BA4 = \u5404\u6D88\u8D39\u70B9 fallback\uFF0C\u503C\u540C\u6E90 DESIGN_SYSTEM\uFF1B
 * \u6697\u8272\u4E3A\u6D3E\u751F\u65B0\u8272\u2014\u2014\u684C\u9762 app \u65E0\u6697\u8272\u4E3B\u9898\u53EF\u540C\u6E90\uFF0C\u6309\u4FDD\u8272\u76F8 + \u5BF9\u6BD4 \u22654.5 \u6D3E\u751F\u3002
 * \u6302 prefers-color-scheme \u6700\u4F73\u52AA\u529B\uFF1A\u5BBF\u4E3B\u4E3B\u9898\u4E0E OS \u80CC\u79BB\u65F6\u53EA\u635F\u5931\u8272\u6E29\u548C\u8C10\u4E0D\u635F\u53EF\u8BFB\uFF0C
 * paper/lcd \u9762\u6587\u5B57\u8D70\u540C\u6CE1\u914D\u5BF9\u503C\uFF08paper-ink / lcd-*\uFF09\u5404\u81EA\u81EA\u6D3D\u3002specs/dsh-plugin-style \xA74\uFF09 */
@media (prefers-color-scheme: dark) {
  :root {
    --pcy-paper: #2a2b35;
    --pcy-paper-ink: #dfe3ea;
    --pcy-paper-dim: #23242c;
    --pcy-hover: #3f3a1c;
    --pcy-lcd: #2b3327;
    --pcy-lcd-text: #cddcb4;
    --pcy-lcd-dim: #93a887;
    --pcy-lcd-dark: #1e241c;
    --pcy-lcd-log-error: #e58585;
    --pcy-lcd-log-warn: #d4b05e;
  }
}

/* ---- \u90E8\u7F72\u72B6\u6001\u8BED\u4E49\u522B\u540D\uFF08specs/dsh-plugin-full-parity UIUX \xA76.1\uFF1A\u8BED\u4E49\u547D\u540D\u65B0\u589E\u3001\u503C\u96F6\u65B0\u589E\u2014\u2014
 * \u6620\u5C04\u8868\u4E0E --pcy-* \u8868\u540C\u6587\u4EF6\u7EF4\u62A4\uFF0C\u9632\u7B2C\u4E8C\u5957\u72B6\u6001\u8272\u6F02\u79FB\u3002\u5FBD\u7AE0\u6587\u5B57\u6052\u58A8\u8272\uFF0C\u4EC5\u72B6\u6001\u70B9\u53D6\u8272\uFF09 ---- */
:root {
  --pcy-deploy-ready: var(--pcy-ok, #2f7d3c);
  --pcy-deploy-ready-direct: var(--pcy-warn, #b58900);
  --pcy-deploy-notready: var(--pcy-warn, #b58900);
  --pcy-deploy-disconnected: var(--pcy-fail, #b3590f);
}

/* ---- LCD \u8F93\u51FA\u5C4F\u5171\u4EAB\u5BB9\u5668\uFF08T2 \u2461 \u7C7B\u76EE\u5355\u6E90\u2014\u2014\u5411\u5BFC\u8F93\u51FA\u5C4F\u4E0E\u8BCA\u65AD\u65E5\u5FD7\u5C4F\u4E24\u843D\u4F4D\uFF09 ---- */
.swqSyj_lcd {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);
  border-radius: 10px;
  background: var(--pcy-lcd, #c4cfa1);
  color: var(--pcy-lcd-text, #3a4a32);
  box-shadow: inset 2px 2px 0 var(--pcy-lcd-dark, #9caa86);
  padding: 10px 12px;
}
.swqSyj_lcd::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.05) 0 2px, transparent 2px 4px);
}

/* ---- Modal / \u786E\u8BA4\u5F39\u5C42 ---- */
.swqSyj_overlay {
  position: fixed;
  inset: 0;
  background: var(--dsw-alias-bg-mask-drop, rgba(0, 0, 0, 0.32));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.swqSyj_dialog {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  min-width: 320px;
  max-width: 520px;
  padding: 16px;
}
.swqSyj_dialogTitle {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
}
.swqSyj_dialogBody {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #57606a);
}
.swqSyj_dialogActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* ---- \u62BD\u5C49\uFF08\u4EFB\u52A1\u8BE6\u60C5\uFF09\u2014\u2014\u6837\u5F0F\u5728\u7EC4\u4EF6\u6D88\u8D39\u4FA7 tasks.swqSyj_module.swqSyj_css\uFF08drawer/drawerOverlay\uFF09\uFF0C\u6B64\u5904\u4E0D\u91CD\u590D ---- */

/* ---- \u6309\u94AE / \u63A7\u4EF6\uFF08\u547D\u4E2D\u533A \u226532px\uFF1Bborder-box + \u7EDF\u4E00\u9AD8\u5EA6\u6863\u2014\u2014\u540C\u6392\u8F93\u5165/\u4E0B\u62C9/\u6309\u94AE\u7B49\u9AD8\uFF09 ---- */
.swqSyj_button {
  box-sizing: border-box;
  min-height: var(--pcy-control-h, 32px);
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  cursor: pointer;
}
.swqSyj_button:hover {
  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);
}
.swqSyj_button:active {
  background: var(--dsw-alias-interactive-bg-active, #e4e7eb);
}
.swqSyj_button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);
  outline-offset: 1px;
}
.swqSyj_button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.swqSyj_buttonPrimary {

  background: var(--dsw-alias-state-business-primary, #316dca);
  border-color: var(--dsw-alias-state-business-primary, #316dca);
  color: #ffffff;
}
.swqSyj_buttonDanger {

  color: var(--pcy-danger, #b3590f);
}
/* \u9EC4\u6309\u94AE\u6863\uFF08specs/dsh-plugin-style \xA73.2 \u4E3B\u884C\u52A8\uFF09\uFF1A\u9EC4\u5E95\u56FA\u5B9A\u58A8\u5B57 + \u91CD\u58A8\u7EBF + 2px \u786C\u9634\u5F71 +
 * \u6309\u538B\u4F4D\u79FB 80ms\uFF08\u552F\u4E00\u65B0\u589E transition \u6863\uFF0Creduced-motion \u5F52\u96F6\uFF09\u3002\u4EC5\u4E3B\u884C\u52A8\u4F4D\u70B9\u4F7F\u7528\u3002 */
.swqSyj_buttonDex {

  background: var(--pcy-running, #ffcb05);
  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);
  color: #1a1b25;
  font-weight: 700;
  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);
  transition:
    transform 80ms,
    box-shadow 80ms;
}
/* \u76D6\u8FC7 .swqSyj_button:hover \u7684\u7070\u5E95\uFF08:not \u63D0\u9AD8\u7279\u5F02\u6027\u2014\u2014\u540C\u7279\u5F02\u6027\u6309\u5E8F\u8986\u76D6\u4F1A\u6F0F hover \u8DEF\u5F84\uFF09 */
.swqSyj_buttonDex:hover:not(:disabled) {
  background: var(--pcy-running, #ffcb05);
}
.swqSyj_buttonDex:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--dsw-alias-label-primary, #1f2328);
}
@media (prefers-reduced-motion: reduce) {
  .swqSyj_buttonDex {
    transition-duration: 0.01ms;
  }
}

.swqSyj_toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  width: 100%;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font-size: 13px;
}
.swqSyj_toggleLabel {
  flex: 1;
  text-align: left;
  font-size: 13px;
  min-width: 0;
}
/* \u5185\u8054\u7D27\u51D1\u5F62\u6001\uFF08\u5B9E\u4F53\u884C\u5185\uFF09\uFF1A\u4E0D\u5360\u6574\u884C\u5BBD\uFF0C\u7D27\u968F\u76F8\u90BB\u63A7\u4EF6 */
.swqSyj_toggle[data-compact="true"] {
  width: auto;
  flex: none;
  gap: 6px;
}
.swqSyj_toggle[data-compact="true"] .swqSyj_toggleLabel {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #57606a);
}
.swqSyj_toggleTrack {
  width: 34px;
  height: 18px;
  border-radius: 9px;
  background: var(--dsw-alias-border-l3, #c7cdd4);
  position: relative;
  transition: background 0.12s ease;
  flex: none;
}
.swqSyj_toggleThumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.12s ease;
}
.swqSyj_toggle[data-on="true"] .swqSyj_toggleTrack {
  background: var(--dsw-alias-state-business-primary, #316dca);
}
.swqSyj_toggle[data-on="true"] .swqSyj_toggleThumb {
  transform: translateX(16px);
}
.swqSyj_toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);
  outline-offset: 2px;
  border-radius: 6px;
}
.swqSyj_toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* \u4E0B\u62C9\uFF08appearance:none \u81EA\u7ED8\u7BAD\u5934\u2014\u2014\u539F\u751F\u7BAD\u5934\u8D34\u53F3\u7F18\u4E14\u4E0D\u968F padding \u6536\u8FDB\uFF0C
 * \u4E0E\u5DE6\u5185\u8FB9\u8DDD\u4E0D\u5BF9\u79F0\uFF1B\u80CC\u666F\u7BAD\u5934\u53F3\u7F29\u8FDB 10px \u4E0E\u6587\u5B57\u5DE6\u7F29\u8FDB 8px \u89C6\u89C9\u5BF9\u9F50\uFF0C\u4E2D\u6027\u7070\u660E\u6697\u4E24\u7528\uFF09 */
.swqSyj_select {
  appearance: none;
  box-sizing: border-box;
  height: var(--pcy-control-h, 32px);
  padding: 2px 26px 2px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238b949e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    no-repeat right 10px center;
  background-color: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
}
.swqSyj_select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);
  outline-offset: 1px;
}
.swqSyj_select:disabled {
  opacity: 0.45;
}
/* \u5E26 label \u7684\u8BBE\u7F6E\u884C\u4E0B\u62C9\uFF08\u5355\u72EC\u9760\u53F3\u6863\uFF09\uFF1A\u5B9A\u5BBD 250\uFF08\u80CC\u5305\u8BBE\u7F6E\u9875\u7EDF\u4E00\u53E3\u5F84\uFF09 */
.swqSyj_labelSelect {
  width: 250px;
}

.swqSyj_input {
  box-sizing: border-box;
  height: var(--pcy-control-h, 32px);
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
}
.swqSyj_input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);
  outline-offset: 1px;
}
.swqSyj_input:disabled {
  opacity: 0.45;
}

/* ---- \u65E5\u671F\u65F6\u95F4\u9009\u62E9\u5668\uFF08\u684C\u9762 DexDateTime \u540C\u6784\uFF09\uFF1A\u96F6\u952E\u5165\u5F39\u5C42\uFF08\u6708\u5386 + \u65F6/\u5206\u4E0B\u62C9\uFF09\uFF0C\u5206\u949F
 * \u7C92\u5EA6\u534A\u5C0F\u65F6\u3002\u9009\u4E2D\u65E5 = \u4E00\u7B49\u9009\u4E2D\uFF08\u9EC4\u5E95 --pcy-running + \u56FA\u5B9A\u58A8\u5B57\uFF0C\u9EC4\u56FA\u5B9A\u4E0D\u7FFB\u8F6C\u53CC\u4E3B\u9898\u5B89\u5168\uFF09\uFF1B
 * \u60AC\u505C/\u4ECA\u65E5 = \u5976\u6CB9\u9EC4 --pcy-hover \u9762 + alias \u6587\u5B57\uFF08\u4E8C\u7B49\u9009\u4E2D\u53E3\u5F84\uFF09\uFF1B\u5176\u4F59\u5168 alias \u968F\u4E3B\u9898 ---- */
.swqSyj_dtRoot {
  position: relative;
}
.swqSyj_dtBtn {

  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
}
.swqSyj_dtLabel {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swqSyj_dtBtn[data-none="true"] .swqSyj_dtLabel {
  color: var(--dsw-alias-label-secondary, #57606a);
}
.swqSyj_dtArrow {
  font-size: 10px;
}
.swqSyj_dtPop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 5;
  width: 264px;
  padding: 10px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.swqSyj_dtPop[data-above="true"] {
  top: auto;
  bottom: calc(100% + 4px);
}
.swqSyj_dtNav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.swqSyj_dtTitle {
  font-size: 13px;
  font-weight: 600;
}
.swqSyj_dtNavBtn {

  width: 26px;
  height: 26px;
  min-height: 26px;
  padding: 0;
  font-size: 10px;
}
.swqSyj_dtGrid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.swqSyj_dtWeek {
  padding: 2px 0;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  color: var(--dsw-alias-label-secondary, #57606a);
}
.swqSyj_dtDay {
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 12px;
  cursor: pointer;
}
.swqSyj_dtDay:hover {
  background: var(--pcy-hover, #fff3c4);
}
.swqSyj_dtDay:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);
  outline-offset: 1px;
}
.swqSyj_dtDay[data-today="true"] {
  border-color: var(--dsw-alias-border-l3, #c7cdd4);
}
.swqSyj_dtDay[data-selected="true"] {
  background: var(--pcy-running, #ffcb05);
  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);
  color: #1a1b25;
  font-weight: 700;
}
.swqSyj_dtBlank {
  pointer-events: none;
}
.swqSyj_dtTime {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
/* \u5185\u5D4C\u65F6/\u5206\u4E0B\u62C9\u6536\u7A84\uFF08\u5F39\u5C42 264px \u5BB9\u7EB3\uFF1A\u65F6 + \u5206 + \u6E05\u7A7A\uFF1B12h \u518D\u52A0\u4E0A\u5348/\u4E0B\u5348\u4F4D\uFF09 */
.swqSyj_dtSelect {

  width: 64px;
  padding: 2px 22px 2px 8px;
}
.swqSyj_dtSelectPeriod {

  width: 84px;
}
.swqSyj_dtColon {
  font-weight: 700;
}
.swqSyj_dtClear {

  margin-left: auto;
  min-height: 28px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--pcy-danger, #b3590f);
}

/* ---- \u72B6\u6001\u70B9\uFF08\u975E\u989C\u8272\u5197\u4F59\uFF1A\u65C1\u8FB9\u5FC5\u6709\u6587\u5B57\u72B6\u6001\uFF09 ---- */
.swqSyj_statusRow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.swqSyj_statusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  border: 1px solid rgba(0, 0, 0, 0.25);
}
.swqSyj_statusDot[data-level="ok"] {
  background: var(--pcy-ok, #2f7d3c);
}
.swqSyj_statusDot[data-level="warn"] {
  background: var(--pcy-warn, #b58900);
}
.swqSyj_statusDot[data-level="fail"] {
  background: var(--pcy-fail, #b3590f);
}

/* ---- \u4F5C\u7528\u57DF badge\uFF08\u4F5C\u7528\u4E8E\u4E3B\u5E94\u7528\xD7\uFF0CU20\uFF09 ---- */
.swqSyj_scopeBadge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);
  background: var(--dsw-alias-bg-layer-1, #f2f4f7);
  color: var(--dsw-alias-label-secondary, #57606a);
  font-size: 11px;
  white-space: nowrap;
}

/* ---- \u64A4\u9500 toast\uFF08\u53F3\u4E0B\u89D2\uFF0Crole=status\uFF0C\u4E0D\u62A2\u7126\u70B9\uFF09 ---- */
.swqSyj_undoToast {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 70;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #2d333b);
  color: #f4f6f8;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  font-size: 13px;
}
.swqSyj_undoToastButton {

  min-height: 32px;
}

/* ---- \u5361\u7247 / \u884C ---- */
.swqSyj_card {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);
  border-radius: 10px;
  padding: 12px 14px;
  /* \u5361\u5185\u884C\u8282\u594F\u7EDF\u4E00 10px\uFF08\u5BF9\u9F50\u4E3B\u5E94\u7528 .swqSyj_set-row margin-bottom\uFF1B\u6807\u9898/\u63D0\u793A\u884C\u4E0D\u518D\u81EA\u5E26 margin \u53E0\u52A0\uFF09 */
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.swqSyj_muted {
  color: var(--dsw-alias-label-secondary, #57606a);
  font-size: 12px;
}
.swqSyj_hint {
  color: var(--dsw-alias-label-secondary, #57606a);
  font-size: 12px;
}

/* ---- \u8BF4\u660E\u6587\u5B57\u60AC\u6D6E\u6C14\u6CE1\uFF08data-tip\uFF09\u2014\u2014\u4E0E\u4E3B\u5E94\u7528 dex.swqSyj_css \u540C\u4E00\u6A21\u5F0F\uFF1A\u9759\u6001\u8BF4\u660E\u4E00\u5F8B\u8FC1\u51FA
   \u5E38\u9A7B\u7248\u9762\uFF0C\u60AC\u6D6E\u5BF9\u5E94 label / \u5361\u6807\u9898\u65F6\u4EE5\u6C14\u6CE1\u5448\u73B0\u3002\u88F8\u5C5E\u6027\u9009\u62E9\u5668\u5373\u5168\u5C40\uFF08\u6784\u5EFA\u5668
   build.swqSyj_mjs \u53EA scoping .\u7C7B\u540D\u3001\u4E0D\u5904\u7406 :global() \u6307\u4EE4\u2014\u2014\u4EA7\u7269\u6309\u5B57\u9762\u900F\u4F20\uFF0C\u6D4F\u89C8\u5668\u76F4\u63A5\u751F\u6548\uFF09---- */
[data-tip] {
  position: relative;
  cursor: help;
}
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  left: 0;
  bottom: calc(100% + 7px);
  z-index: 95;
  box-sizing: border-box;
  width: max-content;
  max-width: 320px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-label-primary, #1f2328);
  border-radius: 6px;
  background: var(--dsw-alias-label-primary, #1f2328);
  color: var(--dsw-alias-bg-layer-1, #ffffff);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  text-align: left;
  white-space: pre-line;
  box-shadow: 2px 2px 0 rgba(31, 35, 40, 0.2);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.1s ease 0s,
    visibility 0s linear 0s;
}
[data-tip]::before {
  content: "";
  position: absolute;
  left: 14px;
  bottom: calc(100% + 4px);
  z-index: 94;
  width: 9px;
  height: 9px;
  background: var(--dsw-alias-label-primary, #1f2328);
  transform: rotate(45deg);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.1s ease 0s,
    visibility 0s linear 0s;
}
/* \u5C55\u793A\u5EF6\u8FDF \u2248 \u539F\u751F tooltip\uFF080.45s\uFF09\uFF0C\u79FB\u5F00\u5373\u9690\uFF1A\u8FC7\u6E21\u53C2\u6570\u53D6\u81EA\u76EE\u6807\u6001\uFF08hover \u6001\u5E26\u5EF6\u8FDF\uFF09 */
[data-tip]:hover::after,
[data-tip]:hover::before {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.12s ease 0.45s,
    visibility 0s linear 0.45s;
}
@media (prefers-reduced-motion: reduce) {
  [data-tip]::after,
  [data-tip]::before {
    transition-duration: 0.01ms;
  }
}
/* \u8BBE\u7F6E\u884C\u6807\u7B7E\u53F3\u4FA7\u5185\u8054\u9644\u52A0\u5185\u5BB9\uFF08\u5982\u65F6\u95F4\u5236\u5F0F\u9884\u89C8\uFF09 */
.swqSyj_labelExtra {
  margin-left: 8px;
}
.swqSyj_errorText {
  color: var(--pcy-danger, #b3590f);
  font-size: 12px;
}
.swqSyj_row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.swqSyj_rowLabel {
  flex: 1;
  font-size: 13px;
}
/* wide \u884C\uFF08\u5BF9\u9F50\u4E3B\u5E94\u7528 .swqSyj_set-row.swqSyj_wide\uFF09\uFF1A\u6807\u7B7E\u5217\u5B9A\u5BBD\uFF0C\u63A7\u4EF6\u5360\u6EE1\u6807\u7B7E\u53F3\u4FA7\u6574\u884C */
.swqSyj_row[data-wide="true"] {
  gap: 0;
}
.swqSyj_row[data-wide="true"] .swqSyj_rowLabel {
  flex: 0 0 128px;
  box-sizing: border-box;
  padding-right: 12px;
}
.swqSyj_row[data-wide="true"] > :not(.swqSyj_rowLabel) {
  flex: 1 1 auto;
  min-width: 0;
}
/* labelWidth \u5B9A\u5BBD\u884C\uFF08\u975E wide\uFF0C\u5BF9\u9F50\u4E3B\u5E94\u7528 SettingRow label-width\uFF09\uFF1A\u6807\u7B7E\u5217 border-box
 * \u5B9A\u5BBD\uFF08\u542B\u5185\u8FB9\u8DDD\u2014\u2014\u684C\u9762\u9996\u884C\u540D\u79F0 120 + \u95F4\u9699 8 = \u6807\u7B7E\u5217 128 \u540C\u8F74\uFF09\uFF0C\u63A7\u4EF6\u8D34\u884C\u53F3\u7F18 */
.swqSyj_row[data-right="true"] > :not(.swqSyj_rowLabel) {
  margin-left: auto;
}
.swqSyj_row[data-right="true"] .swqSyj_input {
  width: 200px;
}
.swqSyj_row[data-right="true"] .swqSyj_select {
  width: 250px;
}
.swqSyj_sectionTitle {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
}

/* ---- \u9AA8\u67B6 ---- */
.swqSyj_skeletonRow {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 4px;
}
.swqSyj_skeletonSprite {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--dsw-alias-border-l1, #e3e7ec);
  flex: none;
}
.swqSyj_skeletonLine {
  height: 10px;
  border-radius: 4px;
  background: var(--dsw-alias-border-l1, #e3e7ec);
}
`;
    var tagId2 = "dsh-plugin/src/client/ui/ui.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId2) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId2;
      tag.textContent = css2;
      document.head.appendChild(tag);
    }
    var ui_default = {
      lcd: "swqSyj_lcd",
      overlay: "swqSyj_overlay",
      dialog: "swqSyj_dialog",
      dialogTitle: "swqSyj_dialogTitle",
      dialogBody: "swqSyj_dialogBody",
      dialogActions: "swqSyj_dialogActions",
      module: "swqSyj_module",
      css: "swqSyj_css",
      button: "swqSyj_button",
      buttonPrimary: "swqSyj_buttonPrimary swqSyj_button",
      buttonDanger: "swqSyj_buttonDanger swqSyj_button",
      buttonDex: "swqSyj_buttonDex swqSyj_button",
      toggle: "swqSyj_toggle",
      toggleLabel: "swqSyj_toggleLabel",
      toggleTrack: "swqSyj_toggleTrack",
      toggleThumb: "swqSyj_toggleThumb",
      select: "swqSyj_select",
      labelSelect: "swqSyj_labelSelect",
      input: "swqSyj_input",
      dtRoot: "swqSyj_dtRoot",
      dtBtn: "swqSyj_dtBtn swqSyj_button",
      dtLabel: "swqSyj_dtLabel",
      dtArrow: "swqSyj_dtArrow",
      dtPop: "swqSyj_dtPop",
      dtNav: "swqSyj_dtNav",
      dtTitle: "swqSyj_dtTitle",
      dtNavBtn: "swqSyj_dtNavBtn swqSyj_button",
      dtGrid: "swqSyj_dtGrid",
      dtWeek: "swqSyj_dtWeek",
      dtDay: "swqSyj_dtDay",
      dtBlank: "swqSyj_dtBlank",
      dtTime: "swqSyj_dtTime",
      dtSelect: "swqSyj_dtSelect swqSyj_select",
      dtSelectPeriod: "swqSyj_dtSelectPeriod swqSyj_select",
      dtColon: "swqSyj_dtColon",
      dtClear: "swqSyj_dtClear swqSyj_button",
      statusRow: "swqSyj_statusRow",
      statusDot: "swqSyj_statusDot",
      scopeBadge: "swqSyj_scopeBadge",
      undoToast: "swqSyj_undoToast",
      undoToastButton: "swqSyj_undoToastButton swqSyj_button",
      card: "swqSyj_card",
      "set-row": "swqSyj_set-row",
      muted: "swqSyj_muted",
      hint: "swqSyj_hint",
      mjs: "swqSyj_mjs",
      labelExtra: "swqSyj_labelExtra",
      errorText: "swqSyj_errorText",
      row: "swqSyj_row",
      rowLabel: "swqSyj_rowLabel",
      wide: "swqSyj_wide",
      sectionTitle: "swqSyj_sectionTitle",
      skeletonRow: "swqSyj_skeletonRow",
      skeletonSprite: "swqSyj_skeletonSprite",
      skeletonLine: "swqSyj_skeletonLine",
    };

    // src/client/ui/controls.tsx
    var import_jsx_runtime4 = require("react/jsx-runtime");
    function Toggle({ checked, onChange, label, disabled = false, badge, compact = false, tip }) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", {
        type: "button",
        role: "switch",
        "aria-checked": checked,
        className: ui_default.toggle,
        "data-on": checked,
        "data-compact": compact ? "true" : void 0,
        disabled,
        onClick: () => onChange(!checked),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", {
            className: ui_default.toggleLabel,
            "data-tip": tip,
            children: [
              label,
              badge !== void 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
                  className: ui_default.scopeBadge,
                  children: badge,
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
            className: ui_default.toggleTrack,
            "aria-hidden": "true",
            children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: ui_default.toggleThumb }),
          }),
        ],
      });
    }
    function Select({
      value,
      onChange,
      options,
      label,
      disabled = false,
      ariaLabel,
      className,
      tip,
      badge,
      labelExtra,
    }) {
      const selectClass =
        className !== void 0
          ? `${ui_default.select} ${className}`
          : // 带 label 的设置行下拉（单独靠右档）：定宽 250
            label !== void 0
            ? `${ui_default.select} ${ui_default.labelSelect}`
            : ui_default.select;
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", {
        className: ui_default.row,
        children: [
          label !== void 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", {
              className: ui_default.rowLabel,
              "data-tip": tip,
              children: [
                label,
                badge !== void 0 &&
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
                    className: ui_default.scopeBadge,
                    children: badge,
                  }),
                labelExtra !== void 0 &&
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
                    className: ui_default.labelExtra,
                    children: labelExtra,
                  }),
              ],
            }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", {
            className: selectClass,
            value,
            disabled,
            "aria-label": ariaLabel,
            onChange: (event) => onChange(event.target.value),
            children: options.map((option) =>
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                "option",
                { value: option.value, children: option.label },
                option.value,
              ),
            ),
          }),
        ],
      });
    }
    function TextInput({ value, onChange, placeholder, disabled = false, ariaLabel, className }) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", {
        className: className !== void 0 ? `${ui_default.input} ${className}` : ui_default.input,
        value,
        placeholder,
        disabled,
        "aria-label": ariaLabel,
        onChange: (event) => onChange(event.target.value),
      });
    }
    function StatusDot({ level, text }) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", {
        className: ui_default.statusRow,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
            className: ui_default.statusDot,
            "data-level": level,
            "aria-hidden": "true",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: text }),
        ],
      });
    }
    function FormRow({ label, badge, desc, labelWidth, wide = false, children }) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", {
        className: ui_default.row,
        "data-wide": wide ? "true" : void 0,
        "data-right": labelWidth !== void 0 && !wide ? "true" : void 0,
        style: labelWidth !== void 0 ? { gap: 0 } : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", {
            className: ui_default.rowLabel,
            "data-tip": desc,
            style:
              labelWidth !== void 0
                ? { flex: `0 0 ${labelWidth}px`, paddingRight: 12, boxSizing: "border-box" }
                : void 0,
            children: [
              label,
              badge !== void 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", {
                  className: ui_default.scopeBadge,
                  children: badge,
                }),
            ],
          }),
          children,
        ],
      });
    }

    // src/client/radio/AuthBanner.tsx
    var import_react3 = require("react");

    // src/client/radio/radio.module.css
    var css3 =
      '/* \u6536\u97F3\u673A\u5206\u6BB5\uFF08\u684C\u9762 RadioTab \u53CC\u680F\u540C\u6784 + \u5EFA\u8BAE\u884C\u9009\u4E2D\u5236\uFF09\uFF1Ascoped\u3001\u96F6\u95EA\u70C1\u3001\u547D\u4E2D\u533A \u226532px */\n\n.Xv2gbE_radioSegment {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  /* \u586B\u5145\u5F62\u6001\uFF08segmentFill \u5B9A\u9AD8\uFF09\u4E0B\u672C\u6BB5\u6070\u5360\u6EE1\uFF1A\u5185\u90E8\u4F38\u7F29\u3001\u4E0D\u51FA\u9875\u9762\u6EDA\u52A8\u6761 */\n  height: 100%;\n  min-height: 0;\n}\n/* \u4E3B\u533A\u4E24\u680F\uFF08\u684C\u9762 .Xv2gbE_im-main \u540C\u6784\uFF1A\u5DE6\u5217\u8868 3 : \u53F3\u8BE6\u60C5 2\uFF0C\u7A84\u5C4F\u7EB5\u6392\uFF09\uFF1B\u586B\u5145\u5F62\u6001\u5360\u6EE1\u5269\u4F59\u9AD8 */\n.Xv2gbE_radioMain {\n  display: flex;\n  gap: 14px;\n  align-items: stretch;\n  flex: 1 1 auto;\n  min-height: 0;\n}\n/* \u7A7A\u6001\uFF08\u684C\u9762 .Xv2gbE_empty \u540C\u6B3E\u5C45\u4E2D\uFF09\uFF1A\u586B\u5145\u5F62\u6001\u4E0B\u6491\u6EE1\u5269\u4F59\u533A\uFF0C\u6536\u53D1\u62A5\u6761\u4ECD\u8D34\u5E95 */\n.Xv2gbE_radioEmpty {\n  flex: 1 1 auto;\n  padding: 40px 12px;\n  text-align: center;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n  line-height: 2;\n}\n@media (max-width: 760px) {\n  .Xv2gbE_radioMain {\n    flex-direction: column;\n  }\n}\n\n/* \u5DE6\u680F\uFF08\u684C\u9762 .Xv2gbE_im-left \u540C\u6784\uFF09\uFF1A\u5DE5\u5177\u884C + \u5217\u8868\u5BB9\u5668\uFF08\u5185\u90E8\u6EDA\u52A8\uFF09+ \u6279\u91CF\u6761 */\n.Xv2gbE_feedColumn {\n  flex: 3 1 0;\n  min-width: 300px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  min-height: 0;\n}\n/* \u5217\u8868\u5BB9\u5668\uFF08\u684C\u9762 .Xv2gbE_im-list-box \u540C\u6784\uFF1A\u63CF\u8FB9\u5BB9\u5668\u5185\u6EDA\uFF09\u3002\u5C55\u5F00\u5185\u5BB9\u5185\u6EDA\u5438\u6536\u2014\u2014\u4E0D\u6491\u9875\u9762\u9AD8\u5EA6\uFF1B\n * \u4E0A\u9650/\u4E0B\u9650\u7ECF segmentFill \u4E0B\u4F20\u53D8\u91CF\uFF08\u586B\u5145\u5F62\u6001\u653E\u5F00\u4E0A\u9650\u3001\u5141\u8BB8\u538B\u7F29\uFF1B\u7A84\u5C4F\u56DE\u843D\u5B9A\u503C\uFF09 */\n.Xv2gbE_listBox {\n  flex: 1;\n  min-height: var(--list-floor, 220px);\n  max-height: var(--list-cap, 560px);\n  overflow-y: auto;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  padding: 6px;\n}\n/* \u5F85\u529E\u4FE1\u53F7\u7EC4\u7A7A\u6001\uFF08\u684C\u9762 .Xv2gbE_pending-empty \u540C\u6784\uFF09\uFF1A0 \u6761\u65F6\u7EC4\u5185\u5C45\u4E2D\u663E\u793A\u300C\u5168\u90E8\u5904\u7406\u5B8C\u300D */\n.Xv2gbE_pendingEmpty {\n  padding: 18px 10px;\n  text-align: center;\n  font-size: 13px;\n  line-height: 2;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n\n/* \u53F3\u680F\u8BE6\u60C5\uFF08\u684C\u9762 .Xv2gbE_im-right \u540C\u6784\uFF09\uFF1A\u9762\u677F\u5E95 + \u5185\u5BB9\u4F38\u7F29 + \u64CD\u4F5C\u884C\u56FA\u5B9A\u5E95\u90E8 */\n.Xv2gbE_detailPanel {\n  flex: 2 1 0;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  min-height: var(--detail-floor, 220px);\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  padding: 12px 14px;\n}\n.Xv2gbE_detailEmpty {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n  line-height: 2;\n  text-align: center;\n}\n.Xv2gbE_detailBody {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n.Xv2gbE_detailMeta {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  font-weight: 700;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  flex-wrap: wrap;\n}\n/* \u72B6\u6001\u7AE0 = \u952E\u5E3D\u6863\uFF08specs/dsh-plugin-style T2#12\uFF1Abg-layer-1 \u5E95 + \u58A8\u7EBF + \u58A8\u8272\u5E95\u6CBF\uFF09 */\n.Xv2gbE_detailStatus {\n  margin-left: auto;\n  flex: none;\n  font-size: 11px;\n  font-weight: 800;\n  border: 1px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 4px;\n  padding: 1px 6px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  box-shadow: 0 2px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n/* LCD \u5C4F = \u7B7E\u540D\u4F4D\uFF08specs/dsh-plugin-style T2#12\uFF09\uFF1A\u8FB9\u6846/\u5185\u9634\u5F71/\u626B\u63CF\u7EBF\u6302\u4E0D\u6EDA\u52A8\u7684\u9759\u6846\u5C42\n * \uFF08abs ::after \u5728\u6EDA\u52A8\u5BB9\u5668\u91CC\u4F1A\u968F\u5185\u5BB9\u6EDA\u8D70\uFF09\uFF0C\u6B63\u6587\u6EDA\u52A8\u5728 .Xv2gbE_detailContent \u5185 */\n.Xv2gbE_detailScreen {\n  position: relative;\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-height: 110px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 8px;\n  box-shadow: inset 2px 2px 0 var(--pcy-lcd-dark, #9caa86);\n}\n.Xv2gbE_detailScreen::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.05) 0 2px, transparent 2px 4px);\n}\n.Xv2gbE_detailContent {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  padding: 12px;\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 1.8;\n  white-space: pre-wrap;\n  background: var(--pcy-lcd, #c4cfa1);\n  color: var(--pcy-lcd-text, #3a4a32);\n  overflow-wrap: break-word;\n}\n.Xv2gbE_noneLine {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  border: 1px dashed var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 8px;\n  padding: 8px 10px;\n}\n.Xv2gbE_doneBanner {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n  font-size: 12.5px;\n  font-weight: 700;\n  color: var(--pcy-ok-ink, #1d6b3c);\n  background: var(--pcy-ok-soft, #dff3e4);\n  border: 1px solid var(--pcy-ok, #2e9e5b);\n  border-radius: 8px;\n  padding: 8px 10px;\n}\n.Xv2gbE_bannerSub {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n/* kbd = \u952E\u5E3D\u6863\uFF08specs/dsh-plugin-style T2#12\uFF1Abg-layer-1 \u5E95 + \u58A8\u7EBF + 0 2px 0 \u58A8\u8272\u5E95\u6CBF\uFF09 */\n.Xv2gbE_kbdChip {\n  display: inline-block;\n  margin-left: 6px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 9.5px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  border: 1px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 4px;\n  padding: 0 5px;\n  line-height: 14px;\n  vertical-align: 1px;\n  box-shadow: 0 2px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n\n/* \u5355\u6761\u7535\u6CE2\u884C\uFF08\u684C\u9762 .Xv2gbE_rrow \u540C\u6784\uFF1A\u52FE\u9009 + \u4E24\u884C\u4E3B\u4F53 + \u884C\u5C3E\u6807\u8BB0\uFF1B\u70B9\u51FB\u9009\u4E2D\uFF09\n * specs/dsh-plugin-style T1#6 \u4E00\u7B49\u5F31\u9009\u4E2D\uFF1A\u5976\u6CB9\u9EC4\u5E95 + \u91CD\u58A8\u7EBF\uFF08\u4E0D\u7528 \u25B6 \u4E0E\u7EAF\u9EC4\u2014\u2014\n * \u884C\u5185 label-secondary \u8F85\u52A9\u6587\u5B57\u5BF9\u7EAF\u9EC4\u4EC5 4.2:1 \u4E0D\u8FBE\u6807\uFF09\uFF1B\u6052\u5B9A 1.5px \u8FB9\u6846\u900F\u660E\u5360\u4F4D\u9632\u6296\u52A8 */\n.Xv2gbE_messageRow {\n  display: flex;\n  gap: 8px;\n  align-items: flex-start;\n  padding: 7px 8px;\n  border-radius: 8px;\n  cursor: pointer;\n  border: 1.5px solid transparent;\n  font-size: 12px;\n}\n.Xv2gbE_messageRow:hover {\n  background: var(--pcy-hover, #fff3c4);\n}\n.Xv2gbE_messageRow[data-selected="true"] {\n  background: var(--pcy-hover, #fff3c4);\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n}\n.Xv2gbE_messageRow[data-dim="true"] {\n  opacity: 0.6;\n}\n.Xv2gbE_messageRow:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: -2px;\n}\n.Xv2gbE_rowCheck {\n  min-width: 32px;\n  min-height: 32px;\n  display: inline-flex;\n  align-items: flex-start;\n  flex: none;\n}\n.Xv2gbE_rowMain {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n.Xv2gbE_rowLine1 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-weight: 700;\n  min-width: 0;\n}\n.Xv2gbE_rowBadge {\n  flex: none;\n  font-size: 10.5px;\n  font-weight: 800;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  border: 1px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 4px;\n  padding: 0 4px;\n  max-width: 130px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.Xv2gbE_rowSender {\n  flex: none;\n  max-width: 96px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.Xv2gbE_rowTime {\n  margin-left: auto;\n  flex: none;\n  font-size: 10.5px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-weight: 500;\n  font-variant-numeric: tabular-nums;\n}\n.Xv2gbE_rowSnippet {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.Xv2gbE_rowMarkOk {\n  flex: none;\n  margin-top: 2px;\n  font-size: 11px;\n  font-weight: 800;\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n.Xv2gbE_rowMarkNo {\n  flex: none;\n  margin-top: 2px;\n  font-size: 11px;\n  font-weight: 800;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Xv2gbE_rowMarks {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  flex: none;\n  margin-top: 2px;\n}\n.Xv2gbE_vetoChip {\n  font-size: 10px;\n  font-weight: 800;\n  color: var(--pcy-warn-ink, #8a5e06);\n  border: 1px solid var(--pcy-warn-ink, #8a5e06);\n  border-radius: 4px;\n  padding: 0 4px;\n  white-space: nowrap;\n}\n/* \u7F6E\u4FE1\u8272\u70B9\uFF08\u684C\u9762 .Xv2gbE_conf \u540C\u6784\uFF1A\u5F62\u8272 + title \u6587\u5B57\u5197\u4F59\uFF09 */\n.Xv2gbE_confDot {\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  border: 1px solid rgba(26, 27, 37, 0.35);\n  flex: none;\n}\n.Xv2gbE_confDot[data-conf="high"] {\n  background: var(--pcy-ok, #2e9e5b);\n}\n.Xv2gbE_confDot[data-conf="medium"] {\n  background: var(--pcy-warn, #ffcb05);\n}\n.Xv2gbE_confDot[data-conf="low"] {\n  background: var(--dsw-alias-border-l3, #c7cdd4);\n}\n\n/* HealthStrip\uFF08\u539F\u578B health\uFF1A\u70B9 + \u6587\u5B57\u72B6\u6001 + tabular \u6570\u5B57 + \u26A1\u4E3B\u8272\u63CF\u8FB9\u94AE\u53F3\u7F6E\uFF09 */\n.Xv2gbE_healthStrip {\n  display: flex;\n  align-items: center;\n  gap: 8px 14px;\n  flex-wrap: wrap;\n  padding: 8px 12px;\n  border-radius: 10px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  font-size: 12px;\n}\n.Xv2gbE_healthItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-variant-numeric: tabular-nums;\n}\n/* \u26A1 \u7ACB\u5373\u62C9\u53D6 = \u4E3B\u884C\u52A8\u9EC4\u6309\u94AE\u6863\uFF08specs/dsh-plugin-style \xA75 \u4E3B\u884C\u52A8\u6E05\u5355\uFF1B\u5C31\u5730\u6362\u6321\u4FDD\u7559 margin-left:auto\uFF09 */\n.Xv2gbE_pollNow {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  margin-left: auto;\n  padding: 2px 12px;\n  border-radius: 8px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-size: 12px;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n  transition:\n    transform 80ms,\n    box-shadow 80ms;\n}\n.Xv2gbE_pollNow:hover:not(:disabled) {\n  background: var(--pcy-running, #ffcb05);\n}\n.Xv2gbE_pollNow:active:not(:disabled) {\n  transform: translate(1px, 1px);\n  box-shadow: 1px 1px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n.Xv2gbE_pollNow:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n.Xv2gbE_pollNow:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n@media (prefers-reduced-motion: reduce) {\n  .Xv2gbE_pollNow {\n    transition-duration: 0.01ms;\n  }\n}\n\n/* AuthBanner\uFF08\u8B66\u793A\u8F6F\u5E95\u4E3A\u56FA\u5B9A\u8272\u2014\u2014\u5BBF\u4E3B surface token \u4F1A\u76D6\u6389\u56DE\u843D\u8B66\u793A\u8272\uFF09 */\n.Xv2gbE_authBanner {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 10px 14px;\n  border-radius: 10px;\n  border: 1.5px solid var(--pcy-warn, #c98a06);\n  background: var(--pcy-warn-soft, #fff3cd);\n  color: var(--pcy-warn-ink, #8a5e06);\n  font-size: 13px;\n}\n\n/* SuggestionFeed\uFF08\u539F\u578B group-h\uFF1A\u5C0F\u53F7\u52A0\u7C97\u5F31\u5316\u8272 + \u8BA1\u6570 pill\uFF09 */\n.Xv2gbE_feedGroup {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n/* \u5DE5\u5177\u680F\uFF08\u684C\u9762 im-toolbar parity\uFF1A\u7535\u6CE2\u641C\u7D22 + \u23F1/\u{1F4E1} \u89C6\u56FE\u5207\u6362\uFF09 */\n.Xv2gbE_toolbar {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.Xv2gbE_searchInput {\n  flex: 1;\n  min-width: 160px;\n  box-sizing: border-box;\n  height: var(--pcy-control-h, 32px);\n  padding: 4px 10px;\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: inherit;\n  font-size: 12.5px;\n}\n.Xv2gbE_searchInput:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n/* \u23F1\u6309\u72B6\u6001 / \u{1F4E1}\u6309\u9891\u9053 \u4E92\u5207\uFF08aria-pressed \u6001\u9AD8\u4EAE\u5F53\u524D\u6A21\u5F0F\uFF1B\u4E8C\u7B49\u9009\u4E2D = \u5976\u6CB9\u9EC4\u5E95\uFF0C\n * \u6587\u5B57\u8D70 alias \u968F\u4E3B\u9898\u7FFB\u8F6C\u2014\u2014\u56FA\u5B9A\u58A8\u5B57\u5BF9\u6697\u6863 hover \u9EC4\u4EC5 1.5:1\uFF0Cspecs/dsh-plugin-style \xA73.2\uFF09 */\n.Xv2gbE_viewToggle {\n  display: inline-flex;\n  border: 1px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 8px;\n  overflow: hidden;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n}\n.Xv2gbE_viewToggle button {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 4px 10px;\n  border: none;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 12px;\n  font-weight: 700;\n  cursor: pointer;\n}\n.Xv2gbE_viewToggle button[aria-pressed="true"] {\n  background: var(--pcy-hover, #fff3c4);\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.Xv2gbE_viewToggle button:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: -2px;\n}\n/* \u6298\u53E0\u5206\u7EC4\uFF08\u684C\u9762 ImListGroup parity\uFF09\uFF1A\u7EC4\u5934 = \u6298\u53E0\u94AE\uFF08caret+\u6807\u9898+\u8BA1\u6570+\u72B6\u6001\u5B57\uFF09+ \u52A8\u4F5C\u533A */\n.Xv2gbE_feedGroupSection + .Xv2gbE_feedGroupSection {\n  margin-top: 6px;\n}\n.Xv2gbE_groupHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 8px;\n}\n.Xv2gbE_groupToggle {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex: 1;\n  min-width: 0;\n  padding: 4px 6px;\n  border: none;\n  border-radius: 6px;\n  background: none;\n  cursor: pointer;\n  user-select: none;\n  text-align: left;\n  font-size: 12px;\n  font-weight: 800;\n  letter-spacing: 0.4px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Xv2gbE_groupToggle:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n.Xv2gbE_groupToggle:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: -2px;\n}\n.Xv2gbE_groupCaret {\n  font-size: 10px;\n  width: 12px;\n  flex: none;\n}\n.Xv2gbE_groupTitleText {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.Xv2gbE_groupState {\n  margin-left: auto;\n  flex: none;\n  font-size: 11px;\n  font-weight: 700;\n  letter-spacing: 0;\n}\n/* \u7EC4\u5934\u52A8\u4F5C\u94AE\uFF08\u4E00\u952E\u6E05\u7A7A/\u4E00\u952E\u91CD\u5224\u2014\u2014\u53E0\u5728 ui.Xv2gbE_button \u4E0A\u6536\u5C0F\u5B57\u91CD\u8FB9\u8DDD\uFF09 */\n.Xv2gbE_headAction {\n  flex: none;\n  font-size: 11px;\n  font-weight: 700;\n  padding: 2px 8px;\n}\n.Xv2gbE_groupCount {\n  display: inline-block;\n  min-width: 18px;\n  text-align: center;\n  padding: 0 7px;\n  border-radius: 999px;\n  background: var(--dsw-alias-border-l1, #e3e7ec);\n  font-size: 10.5px;\n  font-weight: 700;\n  line-height: 18px;\n}\n/* \u9891\u9053\u7EC4\u5934\u300C{n} \u5F85\u5904\u7406\u300D\u70ED\u70B9\u6001\uFF1A\u7EC4\u5185\u6709\u5F85\u5904\u7406\u4FE1\u53F7\u65F6\u9AD8\u4EAE\uFF08\u684C\u9762 count-hot parity\uFF09 */\n.Xv2gbE_groupCount[data-hot="true"] {\n  background: var(--pcy-conf-mid-soft, #fff3d6);\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n/* \u64CD\u4F5C\u884C = \u9003\u8D70\u539F\u56E0\u6D6E\u5C42\u7684\u5B9A\u4F4D\u951A\uFF08\u684C\u9762 .Xv2gbE_im-actions position:relative \u540C\u6784\uFF09 */\n.Xv2gbE_actionBar {\n  position: relative;\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  align-items: center;\n}\n/* AI \u5EFA\u8BAE\u76D2\uFF08SuggestionAiBox\uFF1A\u6807\u9898/\u622A\u6B62/\u5206\u7C7B/\u7406\u7531 + \u65B0\u6807\u7B7E\u63D0\u8BAE\u884C\uFF09 */\n.Xv2gbE_aiBox {\n  border: 1.5px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 8px;\n  padding: 8px 10px;\n  font-size: 12.5px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.Xv2gbE_aiBoxTags {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  font-size: 12px;\n}\n.Xv2gbE_tagProposal {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 999px;\n  padding: 1px 8px;\n  font-size: 11px;\n}\n.Xv2gbE_tagProposalAccept {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  min-width: 32px;\n  padding: 0 8px;\n  border-radius: 999px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: none;\n  cursor: pointer;\n  font-size: 11px;\n}\n.Xv2gbE_tagProposalAccept[aria-pressed="true"] {\n  background: var(--dsw-alias-bg-layer-1, #e8f2ea);\n  border-color: var(--pcy-conf-high, #2f7d3c);\n}\n/* \u9003\u8D70\u539F\u56E0\u6D6E\u5C42\uFF08\u684C\u9762 EscapeReasonPop \u540C\u6784\uFF09\uFF1A\u8131\u79BB\u6587\u6863\u6D41\u5411\u4E0A\u5F39\u3001\u53F3\u5BF9\u9F50\u2014\u2014\u64CD\u4F5C\u884C\u8D34\u8BE6\u60C5\u5E95\u90E8\uFF0C\n * \u5728\u6D41\u5185\u5C55\u5F00\u4F1A\u538B\u7F29 flex:1 \u7684 LCD \u5C4F\u628A\u5185\u5BB9\u5F80\u4E0A\u9876\uFF1B\u5411\u4E0B\u5F39\u5219\u76D6\u4F4F\u53D1\u62A5\u6761\u3002\u6781\u77EE\u7A97\u53E3\u9650\u9AD8\u5185\u6EDA\u515C\u5E95 */\n.Xv2gbE_reasonMenu {\n  position: absolute;\n  bottom: calc(100% + 6px);\n  right: 0;\n  z-index: 60;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 6px;\n  min-width: 200px;\n  max-height: min(320px, 60vh);\n  overflow-y: auto;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n.Xv2gbE_reasonMenu button {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  border: none;\n  background: none;\n  text-align: left;\n  cursor: pointer;\n  border-radius: 6px;\n  font-size: 12px;\n  padding: 2px 10px;\n}\n.Xv2gbE_reasonMenu button:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n\n/* BatchBar\uFF08\u5DE6\u680F\u5E95\u90E8\u5E38\u9A7B\uFF0C\u684C\u9762 .Xv2gbE_batch-bar parity\uFF09\uFF1A\u7EB8\u8272\u6258\u76D8 + \u91CD\u58A8\u7EBF + 2px \u786C\u9634\u5F71\n * \uFF08specs/dsh-plugin-style T1#8\u300C\u6258\u76D8\u300D\u9690\u55BB\uFF1B\u6587\u5B57\u8D70\u7EB8\u9762\u914D\u5BF9\u58A8\u8272\uFF09 */\n.Xv2gbE_batchBar {\n  position: sticky;\n  bottom: 0;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  flex-wrap: wrap;\n  padding: 8px 12px;\n  border-radius: 10px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-paper, #f5f0dc);\n  color: var(--pcy-paper-ink, #1a1b25);\n  font-size: 13px;\n  font-weight: 700;\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n/* \u5168\u9009\u5F85\u5904\u7406\u52FE\u9009\u884C\uFF08label \u6574\u4F53\u4E3A\u547D\u4E2D\u533A\uFF0C\u226532px\uFF09 */\n.Xv2gbE_batchCheck {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  min-height: 32px;\n  font-size: 12px;\n  cursor: pointer;\n  user-select: none;\n}\n\n/* CaptureBar\uFF08\u901A\u680F\u57AB\u5E95\uFF1B\u539F\u578B capture\uFF1A\u9876\u90E8\u91CD\u58A8\u5206\u9694\u7EBF\u2014\u2014\u684C\u9762 3px navy \u7684\u5BBF\u4E3B\u964D\u6863\uFF09 */\n.Xv2gbE_captureBar {\n  display: flex;\n  gap: 8px;\n  margin-top: 12px;\n  padding-top: 12px;\n  border-top: 2px solid var(--dsw-alias-label-primary, #1f2328);\n}\n.Xv2gbE_captureInput {\n  flex: 1;\n  box-sizing: border-box;\n  height: var(--pcy-control-h, 32px);\n  padding: 4px 10px;\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: inherit;\n  font-size: 13px;\n}\n.Xv2gbE_captureInput:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n.Xv2gbE_judgingChip {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Xv2gbE_kbdHint {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n';
    var tagId3 = "dsh-plugin/src/client/radio/radio.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId3) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId3;
      tag.textContent = css3;
      document.head.appendChild(tag);
    }
    var radio_default = {
      radioSegment: "Xv2gbE_radioSegment",
      "im-main": "Xv2gbE_im-main",
      radioMain: "Xv2gbE_radioMain",
      empty: "Xv2gbE_empty",
      radioEmpty: "Xv2gbE_radioEmpty",
      "im-left": "Xv2gbE_im-left",
      feedColumn: "Xv2gbE_feedColumn",
      "im-list-box": "Xv2gbE_im-list-box",
      listBox: "Xv2gbE_listBox",
      "pending-empty": "Xv2gbE_pending-empty",
      pendingEmpty: "Xv2gbE_pendingEmpty",
      "im-right": "Xv2gbE_im-right",
      detailPanel: "Xv2gbE_detailPanel",
      detailEmpty: "Xv2gbE_detailEmpty",
      detailBody: "Xv2gbE_detailBody",
      detailMeta: "Xv2gbE_detailMeta",
      detailStatus: "Xv2gbE_detailStatus",
      detailContent: "Xv2gbE_detailContent",
      detailScreen: "Xv2gbE_detailScreen",
      noneLine: "Xv2gbE_noneLine",
      doneBanner: "Xv2gbE_doneBanner",
      bannerSub: "Xv2gbE_bannerSub",
      kbdChip: "Xv2gbE_kbdChip",
      rrow: "Xv2gbE_rrow",
      messageRow: "Xv2gbE_messageRow",
      rowCheck: "Xv2gbE_rowCheck",
      rowMain: "Xv2gbE_rowMain",
      rowLine1: "Xv2gbE_rowLine1",
      rowBadge: "Xv2gbE_rowBadge",
      rowSender: "Xv2gbE_rowSender",
      rowTime: "Xv2gbE_rowTime",
      rowSnippet: "Xv2gbE_rowSnippet",
      rowMarkOk: "Xv2gbE_rowMarkOk",
      rowMarkNo: "Xv2gbE_rowMarkNo",
      rowMarks: "Xv2gbE_rowMarks",
      vetoChip: "Xv2gbE_vetoChip",
      conf: "Xv2gbE_conf",
      confDot: "Xv2gbE_confDot",
      healthStrip: "Xv2gbE_healthStrip",
      healthItem: "Xv2gbE_healthItem",
      pollNow: "Xv2gbE_pollNow",
      authBanner: "Xv2gbE_authBanner",
      feedGroup: "Xv2gbE_feedGroup",
      toolbar: "Xv2gbE_toolbar",
      searchInput: "Xv2gbE_searchInput",
      viewToggle: "Xv2gbE_viewToggle",
      feedGroupSection: "Xv2gbE_feedGroupSection",
      groupHead: "Xv2gbE_groupHead",
      groupToggle: "Xv2gbE_groupToggle",
      groupCaret: "Xv2gbE_groupCaret",
      groupTitleText: "Xv2gbE_groupTitleText",
      groupState: "Xv2gbE_groupState",
      button: "Xv2gbE_button",
      headAction: "Xv2gbE_headAction",
      groupCount: "Xv2gbE_groupCount",
      "im-actions": "Xv2gbE_im-actions",
      actionBar: "Xv2gbE_actionBar",
      aiBox: "Xv2gbE_aiBox",
      aiBoxTags: "Xv2gbE_aiBoxTags",
      tagProposal: "Xv2gbE_tagProposal",
      tagProposalAccept: "Xv2gbE_tagProposalAccept",
      reasonMenu: "Xv2gbE_reasonMenu",
      "batch-bar": "Xv2gbE_batch-bar",
      batchBar: "Xv2gbE_batchBar",
      batchCheck: "Xv2gbE_batchCheck",
      captureBar: "Xv2gbE_captureBar",
      captureInput: "Xv2gbE_captureInput",
      judgingChip: "Xv2gbE_judgingChip",
      kbdHint: "Xv2gbE_kbdHint",
    };

    // src/client/radio/AuthBanner.tsx
    var import_jsx_runtime5 = require("react/jsx-runtime");
    function AuthBanner({ expired, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [dismissed, setDismissed] = (0, import_react3.useState)(false);
      const [busy, setBusy] = (0, import_react3.useState)(false);
      if (expired && dismissed) {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", {
        className: radio_default.authBanner,
        role: "status",
        "data-testid": "auth-banner",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": "true", children: "\u{1F4E1}" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", {
            className: "auth-text",
            children: expired ? t("dsh.auth.expired") : t("dsh.auth.unauthorized"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly || busy,
            onClick: async () => {
              setBusy(true);
              await client.larkAuth();
              setBusy(false);
              onChanged();
            },
            children: expired ? t("feishu.reauth") : t("feishu.auth"),
          }),
          expired &&
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", {
              type: "button",
              className: ui_default.button,
              "aria-label": t("im.collapse"),
              onClick: () => setDismissed(true),
              children: "\u2715",
            }),
        ],
      });
    }

    // src/client/radio/CaptureBar.tsx
    var import_react5 = require("react");

    // src/client/ui/Toast.tsx
    var import_react4 = require("react");
    var import_jsx_runtime6 = require("react/jsx-runtime");
    var UNDO_WINDOW_MS = 5e3;
    function useUndoToast() {
      const [toast, setToast] = (0, import_react4.useState)(null);
      const onExpireRef = (0, import_react4.useRef)(void 0);
      const show = (0, import_react4.useCallback)((message, opts) => {
        onExpireRef.current = opts?.onExpire;
        setToast({ message, extra: opts?.extra, onUndo: opts?.onUndo });
      }, []);
      const dismiss = (0, import_react4.useCallback)(() => {
        onExpireRef.current?.();
        onExpireRef.current = void 0;
        setToast(null);
      }, []);
      return { toast, show, dismiss };
    }
    function UndoToast({ toast, onClose }) {
      const t = useT();
      (0, import_react4.useEffect)(() => {
        const timer = setTimeout(onClose, UNDO_WINDOW_MS);
        return () => {
          clearTimeout(timer);
        };
      }, [toast, onClose]);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", {
        className: ui_default.undoToast,
        role: "status",
        "aria-live": "polite",
        "data-testid": "undo-toast",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", {
            children: [
              toast.message,
              toast.extra !== void 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", {
                  className: ui_default.muted,
                  children: [" \xB7 ", toast.extra],
                }),
            ],
          }),
          toast.onUndo !== void 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", {
              type: "button",
              className: ui_default.undoToastButton,
              onClick: () => {
                toast.onUndo?.();
                onClose();
              },
              children: t("dsh.toast.undo", { sec: 5 }),
            }),
        ],
      });
    }

    // src/client/radio/CaptureBar.tsx
    var import_jsx_runtime7 = require("react/jsx-runtime");
    function CaptureBar({ readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [text, setText] = (0, import_react5.useState)("");
      const [judging, setJudging] = (0, import_react5.useState)(false);
      const undo = useUndoToast();
      async function send() {
        const trimmed = text.trim();
        if (trimmed === "" || judging) {
          return;
        }
        setJudging(true);
        const result = await client.captureTodo({ text: trimmed });
        setJudging(false);
        setText("");
        if (result.ok) {
          const { outcome, taskId, title } = result.data;
          undo.show(t("dsh.toast.caught", { title: title ?? trimmed }), {
            extra: outcome === "updateSuggested" ? t("dsh.toast.caughtMatch") : void 0,
            onUndo: () => {
              if (taskId !== null) {
                void client.taskDelete({ taskId }).then(() => onChanged());
              }
            },
            onExpire: onChanged,
          });
        } else {
          onChanged();
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("form", {
            className: radio_default.captureBar,
            "data-testid": "capture-bar",
            onSubmit: (event) => {
              event.preventDefault();
              void send();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", {
                className: radio_default.captureInput,
                value: text,
                placeholder: t("im.capturePlaceholder"),
                disabled: readonly || judging,
                "aria-label": t("im.capturePlaceholder"),
                onChange: (event) => setText(event.target.value),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", {
                type: "submit",
                className: ui_default.buttonDex,
                disabled: readonly || judging || text.trim() === "",
                children: judging ? t("dsh.radio.judging") : t("im.captureSend"),
              }),
            ],
          }),
          undo.toast !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(UndoToast, { toast: undo.toast, onClose: undo.dismiss }),
        ],
      });
    }

    // src/client/radio/MessageDetail.tsx
    var import_react7 = require("react");

    // src/client/radio/SuggestionAiBox.tsx
    var import_jsx_runtime8 = require("react/jsx-runtime");
    function statusLabelKey(aiStatus) {
      if (aiStatus === "update" || aiStatus === "followup" || aiStatus === "none" || aiStatus === "error") {
        return `im.status.${aiStatus}`;
      }
      return "im.status.todo";
    }
    function AiSuggestionBox({ message, acceptedTags, readonly, onToggleTag }) {
      const t = useT();
      const newTags = message.suggestedTags.filter((tag) => tag.isNew === true);
      return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", {
        className: radio_default.aiBox,
        "data-testid": "ai-suggestion",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", {
            children: [
              t(statusLabelKey(message.aiStatus)),
              message.suggestedTitle !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("b", { children: [" ", message.suggestedTitle] }),
            ],
          }),
          message.suggestedDue !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", {
              children: [t("edit.due"), "\uFF1A", message.suggestedDue],
            }),
          message.suggestedCategory !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", {
              children: [t("edit.category"), "\uFF1A", message.suggestedCategory],
            }),
          message.reason !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", {
              className: ui_default.muted,
              children: message.reason,
            }),
          newTags.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(TagProposals, {
              newTags,
              acceptedTags,
              readonly,
              onToggleTag,
            }),
        ],
      });
    }
    function TagProposals({ newTags, acceptedTags, readonly, onToggleTag }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", {
        className: radio_default.aiBoxTags,
        children: newTags.map((tag) =>
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "span",
            {
              className: radio_default.tagProposal,
              children: [
                t("im.tagNew", { dim: tag.dimension ?? "topic" }),
                ": ",
                tag.name,
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", {
                  type: "button",
                  className: radio_default.tagProposalAccept,
                  "aria-pressed": acceptedTags.has(tag.name),
                  disabled: readonly,
                  title: t("dsh.radio.acceptTag"),
                  onClick: () => onToggleTag(tag.name),
                  children: "\uFF0B",
                }),
              ],
            },
            tag.name,
          ),
        ),
      });
    }

    // src/client/radio/MessageRow.tsx
    var import_jsx_runtime9 = require("react/jsx-runtime");
    function isSignal(message) {
      return message.aiStatus === "todo" || message.aiStatus === "update";
    }
    function isJudging(aiStatus) {
      return aiStatus === "judging" || aiStatus === "pending";
    }
    function MessageRow({ message, variant, selected, checked = false, onSelect, onToggleCheck }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", {
        role: "button",
        tabIndex: 0,
        className: radio_default.messageRow,
        "data-selected": selected || void 0,
        "data-dim": isArchivedRow(message, variant) || void 0,
        "data-testid": "radio-row",
        "data-message-id": message.messageId,
        onClick: () => onSelect(message.messageId),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(message.messageId);
          }
        },
        children: [
          checkboxVisible(message, variant) &&
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", {
              className: radio_default.rowCheck,
              onClick: (event) => event.stopPropagation(),
              children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", {
                type: "checkbox",
                checked,
                "aria-label": t("im.selectAll"),
                onChange: () => onToggleCheck?.(message.messageId),
              }),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(RowMain, { message, variant }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(RowMarks, { message, variant }),
        ],
      });
    }
    function isArchivedRow(message, variant) {
      return (
        variant === "caught" || variant === "escaped" || (variant === "channel" && message.reviewStatus !== "pending")
      );
    }
    function checkboxVisible(message, variant) {
      return (
        variant === "signal" || variant === "noise" || (variant === "channel" && message.reviewStatus === "pending")
      );
    }
    function RowMain({ message, variant }) {
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", {
        className: radio_default.rowMain,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(RowLine1, { message, variant }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {
            className: radio_default.rowSnippet,
            children: message.content.split("\n")[0] ?? "",
          }),
        ],
      });
    }
    function RowLine1({ message, variant }) {
      const t = useT();
      const conf = message.confidence ?? "low";
      const confDot = confidenceDotVisible(message, variant);
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", {
        className: radio_default.rowLine1,
        children: [
          rowBadges(message, variant, t).map((badge) =>
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "span",
              { className: radio_default.rowBadge, children: badge.text },
              badge.key,
            ),
          ),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {
            className: radio_default.rowSender,
            children: message.senderName,
          }),
          confDot &&
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {
              className: radio_default.confDot,
              "data-conf": conf,
              "aria-label": t(`im.confidence.${conf}`),
              title: t(`im.confidence.${conf}`),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {
            className: radio_default.rowTime,
            children: message.receivedAt.slice(0, 16).replace("T", " "),
          }),
        ],
      });
    }
    function rowBadges(message, variant, t) {
      const pending = message.reviewStatus === "pending";
      const badges = [];
      if (message.chatName !== "") {
        badges.push({ key: "chat", text: message.chatName });
      }
      if (message.aiStatus === "update" && (variant === "signal" || (variant === "channel" && pending))) {
        badges.push({ key: "update", text: `\u{1F527} ${t("im.chipUpdate")}` });
      }
      if (variant === "channel" && !isSignal(message) && pending) {
        badges.push({ key: "noise", text: `\u{1F507} ${t("im.chipNoise")}` });
      }
      return badges;
    }
    function confidenceDotVisible(message, variant) {
      const pending = message.reviewStatus === "pending";
      return variant === "signal" || (variant === "channel" && pending && isSignal(message));
    }
    function RowMarks({ message, variant }) {
      if (variant === "caught") {
        return message.taskId !== null
          ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(CaughtMark, { taskId: message.taskId })
          : null;
      }
      if (variant === "escaped") {
        return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(EscapedMarks, { message });
      }
      if (variant === "channel" && message.reviewStatus === "accepted") {
        return message.taskId !== null
          ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(CaughtMark, { taskId: message.taskId })
          : null;
      }
      if (variant === "channel" && message.reviewStatus === "dismissed") {
        return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(EscapedMarks, { message });
      }
      return null;
    }
    function CaughtMark({ taskId }) {
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", {
        className: radio_default.rowMarkOk,
        children: ["\u2714 No.", taskId],
      });
    }
    function EscapedMarks({ message }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", {
        className: radio_default.rowMarks,
        children: [
          isSignal(message) &&
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", {
              className: radio_default.vetoChip,
              title: t("im.vetoedTitle"),
              children: ["\u26A1 ", t("im.chipVetoed")],
            }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {
            className: radio_default.rowMarkNo,
            children: "\u2715",
          }),
        ],
      });
    }

    // src/client/radio/MessageActions.tsx
    var import_react6 = require("react");
    var import_jsx_runtime10 = require("react/jsx-runtime");
    function MessageActions({ message, readonly, run }) {
      const [escapeOpen, setEscapeOpen] = (0, import_react6.useState)(false);
      const base = { message, readonly, run };
      const toggleEscape = () => setEscapeOpen((v) => !v);
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", {
        className: radio_default.actionBar,
        children: [
          message.reviewStatus === "pending" &&
            !isJudging(message.aiStatus) &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(PendingActions, { ...base, escapeOpen, toggleEscape }),
          message.reviewStatus === "dismissed" &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(DismissedActions, { ...base }),
          message.reviewStatus === "accepted" &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ForceButton, { ...base, closeEscape: () => void 0 }),
          escapeOpen &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(EscapeMenu, {
              ...base,
              closeEscape: () => setEscapeOpen(false),
            }),
        ],
      });
    }
    function PendingActions({ message, readonly, run, escapeOpen, toggleEscape }) {
      const t = useT();
      const forceable = message.aiStatus === "none" || message.aiStatus === "todo" || message.aiStatus === "error";
      const escapable = message.aiStatus !== "none" && message.aiStatus !== "followup";
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, {
        children: [
          message.aiStatus === "update" &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ApplyButton, {
              message,
              readonly,
              run,
              closeEscape: () => void 0,
            }),
          message.aiStatus === "todo" &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CatchButton, {
              message,
              readonly,
              run,
              closeEscape: () => void 0,
            }),
          message.aiStatus === "error" &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(RetryButton, {
              message,
              readonly,
              run,
              closeEscape: () => void 0,
            }),
          escapable &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(DismissButton, {
                  message,
                  readonly,
                  run,
                  closeEscape: () => void 0,
                }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", {
                  type: "button",
                  className: ui_default.button,
                  "aria-label": t("im.escapeWhy"),
                  "aria-expanded": escapeOpen,
                  onClick: toggleEscape,
                  children: "\u25BE",
                }),
              ],
            }),
          forceable &&
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ForceButton, {
              message,
              readonly,
              run,
              closeEscape: () => void 0,
            }),
        ],
      });
    }
    function DismissedActions({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly,
            onClick: () => void run(() => client.reviewRestore({ messageId: message.messageId })),
            children: ["\u21A9 ", t("im.restore")],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ForceButton, {
            message,
            readonly,
            run,
            closeEscape: () => void 0,
          }),
        ],
      });
    }
    function EscapeMenu({ message, readonly, run, closeEscape }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", {
        className: radio_default.reasonMenu,
        role: "menu",
        "aria-label": t("im.escapeWhy"),
        children: ESCAPE_REASON_CODES.map((code) =>
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "button",
            {
              type: "button",
              role: "menuitem",
              disabled: readonly,
              onClick: () => {
                closeEscape?.();
                void run(() => client.reviewDismiss({ messageId: message.messageId, reasonCode: code }));
              },
              children: t(`im.escapeReasons.${code}`),
            },
            code,
          ),
        ),
      });
    }
    function ApplyButton({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
        type: "button",
        className: ui_default.buttonDex,
        disabled: readonly,
        onClick: () => void run(() => client.reviewApplyUpdate({ messageId: message.messageId })),
        children: [t("im.applyUpdate"), /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kbd, { children: "U" })],
      });
    }
    function CatchButton({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
        type: "button",
        className: ui_default.buttonDex,
        disabled: readonly,
        onClick: () => void run(() => client.reviewAccept({ messageId: message.messageId })),
        children: [t("im.catch"), /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kbd, { children: "C" })],
      });
    }
    function RetryButton({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
        type: "button",
        className: ui_default.button,
        disabled: readonly,
        onClick: () => void run(() => client.retryJudge({ messageIds: [message.messageId] })),
        children: ["\u267B ", t("im.retry")],
      });
    }
    function DismissButton({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
        type: "button",
        className: ui_default.button,
        disabled: readonly,
        onClick: () => void run(() => client.reviewDismiss({ messageId: message.messageId, reasonCode: "other" })),
        children: [t("im.release"), /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kbd, { children: "X" })],
      });
    }
    function ForceButton({ message, readonly, run }) {
      const t = useT();
      const client = useClient();
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", {
        type: "button",
        className: ui_default.button,
        disabled: readonly,
        onClick: () => void run(() => client.forceCapture({ messageId: message.messageId })),
        children: [t("im.force"), /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kbd, { children: "F" })],
      });
    }
    function Kbd({ children }) {
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: radio_default.kbdChip, children });
    }

    // src/client/radio/MessageDetail.tsx
    var import_jsx_runtime11 = require("react/jsx-runtime");
    function MessageDetail({ message, acceptedTags, onToggleTag, readonly, onChanged }) {
      const t = useT();
      const [conflict, setConflict] = (0, import_react7.useState)(null);
      const run = async (action) => {
        const result = await action();
        if (!result.ok && result.error?.code === "SUGGESTION_ALREADY_RESOLVED") {
          setConflict(t("dsh.toast.alreadyHandled"));
          return;
        }
        setConflict(null);
        onChanged();
      };
      if (message === null) {
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("section", {
          className: radio_default.detailPanel,
          "data-testid": "message-detail",
          children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", {
            className: radio_default.detailEmpty,
            children: t("im.selectHint"),
          }),
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("section", {
        className: radio_default.detailPanel,
        "data-testid": "message-detail",
        "data-message-id": message.messageId,
        children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", {
          className: radio_default.detailBody,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", {
              className: radio_default.detailMeta,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", {
                  children: [
                    message.chatName !== "" ? `${message.chatName} \xB7 ` : "",
                    message.senderName,
                    " \xB7 ",
                    message.receivedAt.slice(0, 16).replace("T", " "),
                  ],
                }),
                /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", {
                  className: radio_default.detailStatus,
                  children: t(statusLabelKey(message.aiStatus)),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", {
              className: radio_default.detailScreen,
              children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", {
                className: radio_default.detailContent,
                children: message.content,
              }),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(DetailSuggestion, {
              message,
              acceptedTags,
              readonly,
              onToggleTag,
            }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(DetailBanner, { message }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(MessageActions, { message, readonly, run }),
            conflict !== null &&
              /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", {
                role: "status",
                className: ui_default.muted,
                children: conflict,
              }),
          ],
        }),
      });
    }
    function DetailSuggestion({ message, acceptedTags, readonly, onToggleTag }) {
      const t = useT();
      if (message.reviewStatus !== "pending") {
        return null;
      }
      if (isJudging(message.aiStatus)) {
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", {
          className: radio_default.judgingChip,
          children: t("dsh.radio.judging"),
        });
      }
      if (isSignal(message)) {
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(AiSuggestionBox, {
          message,
          acceptedTags,
          readonly,
          onToggleTag,
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", {
        className: radio_default.noneLine,
        children: [
          "\u{1F507} ",
          t(statusLabelKey(message.aiStatus)),
          message.reason !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [" \xB7 ", message.reason] }),
        ],
      });
    }
    function DetailBanner({ message }) {
      const t = useT();
      if (message.reviewStatus === "accepted") {
        if (message.taskId === null) {
          return null;
        }
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", {
          className: radio_default.doneBanner,
          children: ["\u2714 ", t("im.caughtTask", { id: message.taskId })],
        });
      }
      if (message.reviewStatus !== "dismissed") {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", {
        className: radio_default.doneBanner,
        children: [
          "\u2715 ",
          t("im.released"),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", {
            className: radio_default.bannerSub,
            children: [t("im.aiVerdict"), "\uFF1A", t(statusLabelKey(message.aiStatus))],
          }),
          message.dismissReason !== "" &&
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", {
              className: radio_default.bannerSub,
              children: [t("im.dismissReasonLabel"), "\uFF1A", t(`im.escapeReasons.${message.dismissReason}`)],
            }),
        ],
      });
    }

    // src/client/radio/SuggestionFeed.tsx
    var import_react10 = require("react");

    // src/client/radio/FeedGroup.tsx
    var import_jsx_runtime12 = require("react/jsx-runtime");
    function FeedGroup({
      testId,
      chat,
      headTitle,
      title,
      count,
      hot = false,
      stateLabel,
      actions,
      collapsed,
      onToggle,
      children,
    }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", {
        className: radio_default.feedGroupSection,
        "data-testid": testId,
        "data-chat": chat,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", {
            className: radio_default.groupHead,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", {
                type: "button",
                className: radio_default.groupToggle,
                title: headTitle,
                "aria-expanded": !collapsed,
                onClick: onToggle,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", {
                    className: radio_default.groupCaret,
                    "aria-hidden": "true",
                    children: collapsed ? "\u25B8" : "\u25BE",
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", {
                    className: radio_default.groupTitleText,
                    children: title,
                  }),
                  count !== void 0 &&
                    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", {
                      className: radio_default.groupCount,
                      "data-hot": hot ? "true" : void 0,
                      children: count,
                    }),
                  /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", {
                    className: radio_default.groupState,
                    children: stateLabel ?? (collapsed ? t("im.expand") : t("im.collapse")),
                  }),
                ],
              }),
              actions,
            ],
          }),
          collapsed ? null : children,
        ],
      });
    }

    // src/client/radio/ArchivedGroups.tsx
    var import_jsx_runtime13 = require("react/jsx-runtime");
    function ArchivedGroups({ caught, escaped, selectedId, onSelect, collapsed, onToggleGroup }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, {
        children: [
          caught.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(FeedGroup, {
              testId: "caught-group",
              title: t("im.groupCaught"),
              count: caught.length,
              collapsed: collapsed.has("caught"),
              onToggle: () => onToggleGroup("caught"),
              children: caught.map((message) =>
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                  MessageRow,
                  {
                    message,
                    variant: "caught",
                    selected: selectedId === message.messageId,
                    onSelect,
                  },
                  message.messageId,
                ),
              ),
            }),
          escaped.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(FeedGroup, {
              testId: "escaped-group",
              title: t("im.groupEscaped"),
              count: escaped.length,
              collapsed: collapsed.has("escaped"),
              onToggle: () => onToggleGroup("escaped"),
              children: escaped.map((message) =>
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                  MessageRow,
                  {
                    message,
                    variant: "escaped",
                    selected: selectedId === message.messageId,
                    onSelect,
                  },
                  message.messageId,
                ),
              ),
            }),
        ],
      });
    }

    // src/client/radio/BatchBar.tsx
    var import_jsx_runtime14 = require("react/jsx-runtime");
    function BatchBar({
      selected,
      allChecked,
      readonly,
      batchBusy,
      batchReason,
      onToggleAll,
      onSelectHighConfidence,
      onRunBatch,
      onToggleReason,
      onClear,
    }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", {
        className: radio_default.batchBar,
        "data-testid": "batch-bar",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("label", {
            className: radio_default.batchCheck,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("input", {
                type: "checkbox",
                checked: allChecked,
                onChange: onToggleAll,
                "aria-label": t("im.selectAll"),
              }),
              t("im.selectAll"),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly,
            "data-testid": "hi-conf",
            onClick: onSelectHighConfidence,
            children: t("im.hiConf"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", {
            children: t("dsh.batch.selected", { n: selected.size }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", {
            type: "button",
            className: ui_default.buttonDex,
            disabled: readonly || batchBusy || selected.size === 0,
            onClick: () => void onRunBatch("accept"),
            children: t("dsh.batch.catchAll"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly || batchBusy || selected.size === 0,
            onClick: onToggleReason,
            children: t("dsh.batch.releaseAll"),
          }),
          selected.size > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", {
              type: "button",
              className: ui_default.button,
              onClick: onClear,
              children: t("dsh.batch.clear"),
            }),
          batchReason &&
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", {
              className: radio_default.reasonMenu,
              role: "menu",
              children: ESCAPE_REASON_CODES.map((code) =>
                /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    onClick: () => void onRunBatch("dismiss", code),
                    disabled: batchBusy,
                    children: t(`im.escapeReasons.${code}`),
                  },
                  code,
                ),
              ),
            }),
        ],
      });
    }

    // src/client/radio/ChannelFeed.tsx
    var import_react8 = require("react");
    var import_jsx_runtime15 = require("react/jsx-runtime");
    function groupByChannel(messages) {
      const map = /* @__PURE__ */ new Map();
      for (const message of messages) {
        const key = message.chatName !== "" ? message.chatName : "FEISHU";
        const bucket = map.get(key);
        if (bucket === void 0) {
          map.set(key, [message]);
        } else {
          bucket.push(message);
        }
      }
      const rank = (m) => (m.reviewStatus !== "pending" ? 2 : isSignal(m) ? 0 : 1);
      return [...map.entries()].map(([name, list]) => ({ name, list: [...list].sort((a, b) => rank(a) - rank(b)) }));
    }
    function ChannelFeed({ messages, selectedId, onSelect, collapsed, onToggleGroup }) {
      const t = useT();
      const groups = (0, import_react8.useMemo)(() => groupByChannel(messages), [messages]);
      return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", {
        "data-testid": "channel-feed",
        children: groups.map((group) => {
          const pendingSignals = group.list.filter((m) => m.reviewStatus === "pending" && isSignal(m)).length;
          const key = `ch:${group.name}`;
          return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            FeedGroup,
            {
              testId: "channel-group",
              chat: group.name,
              title: `\u{1F4E1} ${group.name}`,
              count: t("im.chanPending", { n: pendingSignals }),
              hot: pendingSignals > 0,
              stateLabel: t("im.chanTotal", { n: group.list.length }),
              collapsed: collapsed.has(key),
              onToggle: () => onToggleGroup(key),
              children: group.list.map((message) =>
                /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                  MessageRow,
                  {
                    message,
                    variant: "channel",
                    selected: selectedId === message.messageId,
                    onSelect,
                  },
                  message.messageId,
                ),
              ),
            },
            group.name,
          );
        }),
      });
    }

    // src/client/radio/FailedGroup.tsx
    var import_react9 = require("react");
    var import_jsx_runtime16 = require("react/jsx-runtime");
    function FailedGroup({ messages, selectedId, onSelect, collapsed, onToggle, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [busy, setBusy] = (0, import_react9.useState)(false);
      return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(FeedGroup, {
        testId: "failed-group",
        title: t("im.groupFailed"),
        count: messages.length,
        collapsed,
        onToggle,
        actions: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, {
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
              type: "button",
              className: `${ui_default.button} ${radio_default.headAction}`,
              disabled: readonly || busy,
              onClick: async () => {
                setBusy(true);
                await client.retryJudge({ messageIds: "all" });
                setBusy(false);
                onChanged();
              },
              children: t("dsh.failed.retryAll"),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
              type: "button",
              className: `${ui_default.button} ${radio_default.headAction}`,
              disabled: readonly || busy,
              onClick: async () => {
                setBusy(true);
                for (const message of messages) {
                  await client.forceDismiss({ messageId: message.messageId });
                }
                setBusy(false);
                onChanged();
              },
              children: t("dsh.failed.forceDismiss"),
            }),
          ],
        }),
        children: messages.map((message) =>
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
            MessageRow,
            {
              message,
              variant: "noise",
              selected: selectedId === message.messageId,
              onSelect,
            },
            message.messageId,
          ),
        ),
      });
    }

    // src/client/radio/SuggestionFeed.tsx
    var import_jsx_runtime17 = require("react/jsx-runtime");
    var DEFAULT_COLLAPSED = ["caught", "escaped"];
    function toggled(set, key) {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    }
    function filterMessages(messages, query) {
      const q = query.trim().toLowerCase();
      if (q === "") {
        return messages;
      }
      return messages.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.chatName.toLowerCase().includes(q) ||
          m.senderName.toLowerCase().includes(q),
      );
    }
    function SuggestionFeed({ messages, readonly, selectedId, onSelect, onChanged }) {
      const t = useT();
      const client = useClient();
      const [selected, setSelected] = (0, import_react10.useState)(/* @__PURE__ */ new Set());
      const [batchBusy, setBatchBusy] = (0, import_react10.useState)(false);
      const [batchReason, setBatchReason] = (0, import_react10.useState)(false);
      const [clearBusy, setClearBusy] = (0, import_react10.useState)(false);
      const [mode, setMode] = (0, import_react10.useState)("time");
      const [query, setQuery] = (0, import_react10.useState)("");
      const [collapsed, setCollapsed] = (0, import_react10.useState)(new Set(DEFAULT_COLLAPSED));
      const filtered = (0, import_react10.useMemo)(() => filterMessages(messages, query), [messages, query]);
      const groups = (0, import_react10.useMemo)(() => suggestionGroups(filtered), [filtered]);
      function toggleGroup(key) {
        setCollapsed((prev) => toggled(prev, key));
      }
      function toggleSelect(messageId) {
        setSelected((prev) => toggled(prev, messageId));
      }
      const pendingIds = (0, import_react10.useMemo)(() => groups.pending.map((m) => m.messageId), [groups.pending]);
      const allChecked = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
      function toggleAll() {
        setSelected(allChecked ? /* @__PURE__ */ new Set() : new Set(pendingIds));
      }
      function selectHighConfidence() {
        setSelected(new Set(groups.pending.filter((m) => m.confidence === "high").map((m) => m.messageId)));
      }
      async function runBatch(op, reasonCode) {
        setBatchBusy(true);
        await client.reviewBatch({ messageIds: [...selected], op, reasonCode });
        setBatchBusy(false);
        setSelected(/* @__PURE__ */ new Set());
        setBatchReason(false);
        onChanged();
      }
      async function clearNoise() {
        const messageIds = groups.none.map((m) => m.messageId);
        if (messageIds.length === 0 || clearBusy) {
          return;
        }
        setClearBusy(true);
        await client.reviewBatch({ messageIds, op: "dismiss", reasonCode: "noise" });
        setClearBusy(false);
        onChanged();
      }
      return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", {
        className: radio_default.feedColumn,
        "data-testid": "suggestion-feed",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", {
            className: radio_default.toolbar,
            "data-testid": "radio-toolbar",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("input", {
                className: radio_default.searchInput,
                value: query,
                placeholder: t("im.search"),
                "aria-label": t("im.search"),
                "data-testid": "radio-search",
                onChange: (event) => setQuery(event.target.value),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", {
                className: radio_default.viewToggle,
                role: "group",
                "aria-label": t("im.viewMode"),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("button", {
                    type: "button",
                    "aria-pressed": mode === "time",
                    onClick: () => setMode("time"),
                    children: t("im.viewTime"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("button", {
                    type: "button",
                    "aria-pressed": mode === "channel",
                    onClick: () => setMode("channel"),
                    children: t("im.viewChannel"),
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", {
            className: radio_default.listBox,
            children:
              mode === "channel"
                ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ChannelFeed, {
                    messages: filtered,
                    selectedId,
                    onSelect,
                    collapsed,
                    onToggleGroup: toggleGroup,
                  })
                : /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(import_jsx_runtime17.Fragment, {
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(FeedGroup, {
                        testId: "pending-group",
                        title: t("im.groupSignal"),
                        count: groups.pending.length,
                        hot: true,
                        collapsed: collapsed.has("pending"),
                        onToggle: () => toggleGroup("pending"),
                        children: [
                          groups.pending.length === 0 &&
                            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", {
                              className: radio_default.pendingEmpty,
                              "data-testid": "pending-empty",
                              children: t("im.signalAllDone"),
                            }),
                          groups.pending.map((message) =>
                            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
                              MessageRow,
                              {
                                message,
                                variant: "signal",
                                selected: selectedId === message.messageId,
                                checked: selected.has(message.messageId),
                                onSelect,
                                onToggleCheck: toggleSelect,
                              },
                              message.messageId,
                            ),
                          ),
                        ],
                      }),
                      groups.failed.length > 0 &&
                        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(FailedGroup, {
                          messages: groups.failed,
                          selectedId,
                          onSelect,
                          collapsed: collapsed.has("failed"),
                          onToggle: () => toggleGroup("failed"),
                          readonly,
                          onChanged,
                        }),
                      groups.none.length > 0 &&
                        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(FeedGroup, {
                          title: t("im.groupNoise"),
                          headTitle: t("im.groupNoiseTitle"),
                          count: groups.none.length,
                          collapsed: collapsed.has("none"),
                          onToggle: () => toggleGroup("none"),
                          actions: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("button", {
                            type: "button",
                            className: `${ui_default.button} ${radio_default.headAction}`,
                            title: t("im.clearNoiseTitle"),
                            disabled: readonly || clearBusy,
                            "data-testid": "clear-noise",
                            onClick: () => void clearNoise(),
                            children: t("im.clearNoise"),
                          }),
                          children: groups.none.map((message) =>
                            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
                              MessageRow,
                              {
                                message,
                                variant: "noise",
                                selected: selectedId === message.messageId,
                                checked: selected.has(message.messageId),
                                onSelect,
                                onToggleCheck: toggleSelect,
                              },
                              message.messageId,
                            ),
                          ),
                        }),
                      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ArchivedGroups, {
                        caught: groups.caught,
                        escaped: groups.escaped,
                        selectedId,
                        onSelect,
                        collapsed,
                        onToggleGroup: toggleGroup,
                      }),
                    ],
                  }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(BatchBar, {
            selected,
            allChecked,
            readonly,
            batchBusy,
            batchReason,
            onToggleAll: toggleAll,
            onSelectHighConfidence: selectHighConfidence,
            onRunBatch: runBatch,
            onToggleReason: () => setBatchReason((v) => !v),
            onClear: () => setSelected(/* @__PURE__ */ new Set()),
          }),
        ],
      });
    }

    // src/client/radio/useRadioKeyboard.ts
    var import_react11 = require("react");
    function moveSelection(pool, selectedId, forward) {
      if (pool.length === 0) {
        return null;
      }
      const index = pool.findIndex((m) => m.messageId === selectedId);
      if (index < 0) {
        return pool[0].messageId;
      }
      const next = forward ? Math.min(pool.length - 1, index + 1) : Math.max(0, index - 1);
      return pool[next].messageId;
    }
    function isEditableTarget(target) {
      return target instanceof HTMLElement && target.matches("input, textarea, select");
    }
    function isNavKey(key) {
      return key === "j" || key === "arrowdown" || key === "k" || key === "arrowup";
    }
    function runActionKey(client, message, key, onActioned) {
      if (message.reviewStatus !== "pending" || isJudging(message.aiStatus)) {
        return false;
      }
      return (
        catchAction(client, message, key, onActioned) ||
        escapeAction(client, message, key, onActioned) ||
        forceAction(client, message, key, onActioned)
      );
    }
    function catchAction(client, message, key, onActioned) {
      if (key !== "c" || !isSignal(message)) {
        return false;
      }
      void (
        message.aiStatus === "update"
          ? client.reviewApplyUpdate({ messageId: message.messageId })
          : client.reviewAccept({ messageId: message.messageId })
      ).then(onActioned);
      return true;
    }
    function escapeAction(client, message, key, onActioned) {
      if (key !== "x" || message.aiStatus === "none" || message.aiStatus === "followup") {
        return false;
      }
      void client.reviewDismiss({ messageId: message.messageId, reasonCode: "other" }).then(onActioned);
      return true;
    }
    function forceAction(client, message, key, onActioned) {
      const forceable = message.aiStatus === "none" || message.aiStatus === "todo" || message.aiStatus === "error";
      if (key !== "f" || !forceable) {
        return false;
      }
      void client.forceCapture({ messageId: message.messageId }).then(onActioned);
      return true;
    }
    function useRadioKeyboard(args) {
      const { client, pool, selectedId, selectedMessage, setSelectedId, onActioned } = args;
      return (0, import_react11.useCallback)(
        (event) => {
          if (isEditableTarget(event.target)) {
            return;
          }
          const key = event.key.toLowerCase();
          if (isNavKey(key)) {
            event.preventDefault();
            const next = moveSelection(pool, selectedId, key === "j" || key === "arrowdown");
            if (next !== null) {
              setSelectedId(next);
            }
            return;
          }
          if (selectedMessage !== null && runActionKey(client, selectedMessage, key, onActioned)) {
            event.preventDefault();
          }
        },
        [client, pool, selectedId, selectedMessage, setSelectedId, onActioned],
      );
    }

    // src/client/radio/RadioSegment.tsx
    var import_jsx_runtime18 = require("react/jsx-runtime");
    function timeOf(iso) {
      return iso === null ? "" : iso.slice(11, 16);
    }
    function HealthStrip({ health, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [busy, setBusy] = (0, import_react12.useState)(false);
      const stateText =
        health.level === "ok"
          ? t("diag.status.ok")
          : health.level === "warn"
            ? t("dsh.radio.stateWarn")
            : t("dsh.radio.stateFail");
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", {
        className: radio_default.healthStrip,
        "data-testid": "health-strip",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(StatusDot, { level: health.level, text: stateText }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", {
            className: radio_default.healthItem,
            children: t("diag.lastSuccess", { v: timeOf(health.lastSuccessAt) || t("diag.never") }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", {
            className: radio_default.healthItem,
            children: t("diag.nextPoll", { v: timeOf(health.nextPollAt) }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", {
            className: radio_default.healthItem,
            children: t("dsh.radio.failCount", { n: health.consecutiveFailures }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("button", {
            type: "button",
            className: radio_default.pollNow,
            disabled: readonly || busy,
            onClick: async () => {
              setBusy(true);
              await client.pollNow();
              setBusy(false);
              onChanged();
            },
            children: ["\u26A1 ", t("diag.pollNow")],
          }),
        ],
      });
    }
    function RadioSegment({ data, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const empty = data.messages.length === 0 && data.health.pendingCount === 0;
      const [selectedId, setSelectedId] = (0, import_react12.useState)(null);
      const [acceptedTags, setAcceptedTags] = (0, import_react12.useState)(/* @__PURE__ */ new Set());
      const groups = (0, import_react12.useMemo)(() => suggestionGroups(data.messages), [data.messages]);
      const pool = (0, import_react12.useMemo)(() => [...groups.pending, ...groups.failed, ...groups.none], [groups]);
      const selectedMessage = (0, import_react12.useMemo)(
        () => data.messages.find((m) => m.messageId === selectedId) ?? null,
        [data.messages, selectedId],
      );
      (0, import_react12.useEffect)(() => {
        if (selectedId !== null && data.messages.some((m) => m.messageId === selectedId)) {
          return;
        }
        setSelectedId(pool[0]?.messageId ?? null);
      }, [selectedId, data.messages, pool]);
      const onDetailAction = (0, import_react12.useCallback)(() => {
        const index = pool.findIndex((m) => m.messageId === selectedId);
        if (index >= 0) {
          const next = pool[index + 1] ?? pool[index - 1] ?? null;
          setSelectedId(next?.messageId ?? null);
        }
        onChanged();
      }, [pool, selectedId, onChanged]);
      function toggleTag(name) {
        setAcceptedTags((prev) => {
          const next = new Set(prev);
          if (next.has(name)) {
            next.delete(name);
          } else {
            next.add(name);
          }
          return next;
        });
      }
      const onKeyDown = useRadioKeyboard({
        client,
        pool,
        selectedId,
        selectedMessage,
        setSelectedId,
        onActioned: onDetailAction,
      });
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", {
        className: radio_default.radioSegment,
        "data-testid": "segment-radio",
        onKeyDown,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(HealthStrip, { health: data.health, readonly, onChanged }),
          !data.auth.authorized || data.auth.expired
            ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(AuthBanner, {
                expired: data.auth.expired && data.auth.authorized,
                readonly,
                onChanged,
              })
            : null,
          empty
            ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", {
                className: radio_default.radioEmpty,
                children: t("dsh.empty.radio"),
              })
            : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", {
                className: radio_default.radioMain,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(SuggestionFeed, {
                    messages: data.messages,
                    readonly,
                    selectedId,
                    onSelect: setSelectedId,
                    onChanged,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(MessageDetail, {
                    message: selectedMessage,
                    acceptedTags,
                    onToggleTag: toggleTag,
                    readonly,
                    onChanged: onDetailAction,
                  }),
                ],
              }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(CaptureBar, { readonly, onChanged }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", {
            className: radio_default.kbdHint,
            children: t("dsh.radio.kbdHint"),
          }),
        ],
      });
    }

    // src/client/settings/SettingsSegment.tsx
    var import_react37 = require("react");

    // src/client/settings/optionSets.ts
    var POMODORO_MINUTES = [15, 25, 45, 60];
    var BREAK_MINUTES = [0, 5, 10];
    var REMIND_AHEAD_MINUTES = [0, 5, 15, 30];
    var POLL_INTERVAL_SECS = [60, 120, 300, 900];
    var DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"];
    var TIME_FORMATS = ["24h", "12h"];
    function quietHourOptions() {
      return Array.from({ length: 24 }, (_, h) => {
        const hh = String(h).padStart(2, "0");
        return { value: `${hh}:00`, label: hh };
      });
    }
    function snapTo(value, allowed) {
      return allowed.reduce((best, cur) => {
        const dCur = Math.abs(cur - value);
        const dBest = Math.abs(best - value);
        return dCur < dBest || (dCur === dBest && cur > best) ? cur : best;
      }, allowed[0]);
    }
    var normNum = (raw, allowed, fallback) => {
      const n = Number(raw ?? "");
      if (raw === void 0 || raw === "" || !Number.isFinite(n)) {
        return String(fallback);
      }
      return String(allowed.includes(n) ? n : snapTo(n, allowed));
    };
    var normQuietHour = (raw, fallback) => {
      const m = /^(\d{1,2})(?::\d{2})?$/.exec((raw ?? "").trim());
      if (m !== null) {
        const h = Number(m[1]);
        if (h >= 0 && h <= 23) {
          return `${String(h).padStart(2, "0")}:00`;
        }
      }
      return fallback;
    };
    var normChoice = (raw, allowed, fallback) => (raw !== void 0 && allowed.includes(raw) ? raw : fallback);
    function normalizeSettingValues(kv) {
      const out = { ...kv };
      if (out["pomodoro_minutes"] !== void 0) {
        out["pomodoro_minutes"] = normNum(out["pomodoro_minutes"], POMODORO_MINUTES, 25);
      }
      if (out["break_minutes"] !== void 0) {
        out["break_minutes"] = normNum(out["break_minutes"], BREAK_MINUTES, 0);
      }
      if (out["remind_ahead_minutes"] !== void 0) {
        out["remind_ahead_minutes"] = normNum(out["remind_ahead_minutes"], REMIND_AHEAD_MINUTES, 0);
      }
      if (out["feishu_poll_interval"] !== void 0) {
        out["feishu_poll_interval"] = normNum(out["feishu_poll_interval"], POLL_INTERVAL_SECS, 120);
      }
      if (out["date_format"] !== void 0) {
        out["date_format"] = normChoice(out["date_format"], DATE_FORMATS, "YYYY-MM-DD");
      }
      if (out["time_format"] !== void 0) {
        out["time_format"] = normChoice(out["time_format"], TIME_FORMATS, "24h");
      }
      if (out["quiet_start"] !== void 0) {
        out["quiet_start"] = normQuietHour(out["quiet_start"], "22:00");
      }
      if (out["quiet_end"] !== void 0) {
        out["quiet_end"] = normQuietHour(out["quiet_end"], "08:00");
      }
      return out;
    }

    // src/client/settings/sectionKeys.ts
    var FOCUS_KEYS = [
      "pomodoro_enabled",
      "pomodoro_minutes",
      "break_minutes",
      "pomodoro_notify",
      "pomodoro_chime",
      "notifications_enabled",
      "remind_ahead_minutes",
      "quiet_hours_enabled",
      "quiet_start",
      "quiet_end",
    ];
    var PET_KEYS = [
      "main_pokemon",
      "pokemon_quotes",
      "pet_input_response",
      "pet_input_response_working",
      "pet_voice",
      "pet_mate",
      "reduce_motion",
    ];
    var DISPLAY_KEYS = ["language", "date_format", "time_format", "overdue_mode", "due_relative"];
    var AGENT_KEYS = [
      "ai_agent_id",
      "terminal_preference",
      "dispatch_auto_enabled",
      "dispatch_max_concurrent",
      "dispatch_worktree",
    ];
    var FEISHU_KEYS = ["feishu_enabled", "feishu_poll_interval", "feishu_my_names"];
    var GENERAL_KEYS = ["review_enabled", "review_dow", "backup_enabled", "backup_keep", "close_to_tray"];
    var SECTION_KEYS = ["focus", "taxonomy", "pets", "display", "agents", "feishu", "diag", "general"];
    var SECTION_LABEL_KEYS = {
      focus: "stabs.focus",
      taxonomy: "stabs.taxonomy",
      pets: "stabs.pets",
      display: "stabs.display",
      agents: "stabs.agents",
      feishu: "stabs.feishu",
      diag: "stabs.diag",
      general: "stabs.general",
    };
    var DRAFT_KEYS = [...FOCUS_KEYS, ...PET_KEYS, ...DISPLAY_KEYS, ...AGENT_KEYS, ...FEISHU_KEYS, ...GENERAL_KEYS];

    // src/client/settings/settings.module.css
    var css4 =
      '/* \u80CC\u5305\uFF08\u8BBE\u7F6E\u5206\u6BB5\uFF0CU21\uFF1A\u5206\u533A\u9009\u5355 + \u5206\u533A\u6574\u9875 + \u4FDD\u5B58\u5236\uFF09\uFF1Ascoped\u3001\u96F6\u95EA\u70C1\u3001\u547D\u4E2D\u533A \u226532px */\n\n._5hQxWq_settingsSegment {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  /* \u586B\u5145\u5F62\u6001\uFF08segmentFill \u5B9A\u9AD8\uFF09\u4E0B\u672C\u6BB5\u6070\u5360\u6EE1\uFF1A\u9009\u5355\u884C\u56FA\u5B9A\u3001\u4EC5\u5206\u533A\u9875\u5185\u5BB9\u5185\u6EDA */\n  height: 100%;\n  min-height: 0;\n}\n\n/* SectionNav\uFF1A\u516B\u5206\u533A\u6A2A\u5411\u9009\u5355\uFF08\u7A84\u5C4F\u6A2A\u5411\u6EDA\u52A8\uFF0C\u4E0D\u6298\u884C\uFF09\u2014\u2014\u539F\u578B secnav \u63CF\u8FB9\u80F6\u56CA\u53E3\u5F84 */\n._5hQxWq_sectionNav {\n  display: flex;\n  gap: 6px;\n  overflow-x: auto;\n  padding-bottom: 4px;\n}\n._5hQxWq_sectionNavButton {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 4px 14px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n  font-weight: 600;\n  cursor: pointer;\n  white-space: nowrap;\n  flex: none;\n}\n._5hQxWq_sectionNavButton:hover {\n  border-color: var(--dsw-alias-border-l3, #c7cdd4);\n  background: var(--pcy-hover, #fff3c4);\n}\n/* \u4E00\u7B49\u9009\u4E2D\uFF08specs/dsh-plugin-style \xA75#3\uFF0C\u4E0E\u4E03\u6BB5\u5BFC\u822A\u540C\u4E00\u8BED\u8A00\uFF09\uFF1A\u9EC4\u5E95\u56FA\u5B9A\u58A8\u5B57 + \u91CD\u58A8\u7EBF + \u5B57\u91CD\n * \uFF08\u9A8C\u6536\u88C1\u51B3\u53BB \u25B6 \u524D\u7F00\uFF09 */\n._5hQxWq_sectionNavButton[aria-pressed="true"] {\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-weight: 700;\n}\n._5hQxWq_sectionNavButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n\n/* \u5206\u533A\u9009\u5355\u884C\uFF08\u4FDD\u5B58\u63A7\u4EF6\u540C\u884C\u9760\u53F3\uFF0C\u65E0\u72EC\u7ACB\u4FDD\u5B58\u884C\u2014\u2014\u684C\u9762\u300C\u6807\u9898\u884C\u53F3\u4FA7\u4FDD\u5B58\u300D\u540C\u4F4D\uFF09\uFF1B\u56FA\u5B9A\u4E0D\u968F\u6EDA\u52A8 */\n._5hQxWq_settingsHeadRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  flex-wrap: wrap;\n  flex: none;\n}\n/* \u5206\u533A\u9875\u6EDA\u52A8\u5BB9\u5668\uFF08\u586B\u5145\u5F62\u6001\u4E0B\u552F\u4E00\u6EDA\u52A8\u4F4D\uFF1A\u5206\u533A\u9009\u5355\u884C\u5E38\u9A7B\uFF0C\u6EDA\u52A8\u53EA\u53D1\u751F\u5728\u5206\u533A\u9875\u5185\u5BB9\uFF1B\n * \u975E\u586B\u5145\u5F62\u6001\u2014\u2014\u7A84\u5C4F segmentFill \u9AD8\u5EA6\u56DE\u843D auto\u2014\u2014\u968F\u6587\u6863\u6D41\u81EA\u7136\u5C55\u5F00\u4E0D\u51FA\u5185\u6EDA\uFF09 */\n._5hQxWq_settingsBody {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n._5hQxWq_settingsHeadRow ._5hQxWq_sectionNav {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n/* \u4FDD\u5B58\u63A7\u4EF6\u7EC4\uFF1Adisplay:contents \u8BA9 hint/\u6309\u94AE/\u5931\u8D25\u884C\u76F4\u63A5\u5E76\u5165\u9009\u5355\u884C flex \u6392\u5E03 */\n._5hQxWq_saveControls {\n  display: contents;\n}\n/* \u5931\u8D25/\u9632\u5446\u884C\uFF1A\u72EC\u5360\u4E00\u884C\uFF08\u6362\u884C\u5230\u9009\u5355\u884C\u4E0B\u65B9\uFF0C\u4E0D\u6324\u538B\u9009\u5355\uFF09 */\n._5hQxWq_saveFailWrap {\n  flex-basis: 100%;\n}\n._5hQxWq_saveFailWrap ._5hQxWq_saveFailHint {\n  margin: 0;\n}\n/* \u4FDD\u5B58 = \u4E3B\u884C\u52A8\u9EC4\u6309\u94AE\u6863\uFF08specs/dsh-plugin-style \xA75 \u4E3B\u884C\u52A8\u6E05\u5355\uFF1B\u5C31\u5730\u6362\u6321\u4FDD\u7559 relative \u4F9B\u89D2\u6807\u5B9A\u4F4D\uFF09 */\n._5hQxWq_saveButton {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 4px 14px;\n  position: relative;\n  border-radius: 8px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-size: 13px;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n  transition:\n    transform 80ms,\n    box-shadow 80ms;\n}\n._5hQxWq_saveButton:active:not(:disabled) {\n  transform: translate(1px, 1px);\n  box-shadow: 1px 1px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n._5hQxWq_saveButton:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n@media (prefers-reduced-motion: reduce) {\n  ._5hQxWq_saveButton {\n    transition-duration: 0.01ms;\n  }\n}\n/* \u672A\u4FDD\u5B58\u9759\u6001\u89D2\u6807\uFF08\u4E0D\u95EA\u70C1\uFF09 */\n._5hQxWq_unsavedDot {\n  position: absolute;\n  top: -4px;\n  right: -4px;\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--pcy-warn, #b58900);\n  border: 1px solid var(--dsw-alias-bg-layer-1, #ffffff);\n}\n/* \u5206\u533A\u9009\u5355\u9879\u4E0A\u7684\u9759\u6001\u70B9\u63D0\u793A\uFF1B\u9009\u4E2D\u9EC4\u5E95\u4E0A\u6539\u58A8\u5E95\u767D\u5708\u4FDD\u5BF9\u6BD4\uFF08specs/dsh-plugin-style \xA75#3\uFF09 */\n._5hQxWq_unsavedDotInline {\n  display: inline-block;\n  width: 6px;\n  height: 6px;\n  margin-left: 6px;\n  border-radius: 50%;\n  background: var(--pcy-warn, #b58900);\n  vertical-align: middle;\n}\n._5hQxWq_sectionNavButton[aria-pressed="true"] ._5hQxWq_unsavedDotInline {\n  background: #1a1b25;\n  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75);\n}\n._5hQxWq_savedHint {\n  font-size: 11.5px;\n  font-weight: 700;\n  color: var(--pcy-ok-ink, #1d6b3c);\n  background: var(--pcy-ok-soft, #dff3e4);\n  border: 1px solid var(--pcy-ok, #2e9e5b);\n  border-radius: 6px;\n  padding: 2px 8px;\n}\n._5hQxWq_saveFailHint {\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n}\n\n/* \u5206\u533A\u6574\u9875\u5E03\u5C40\uFF08\u539F\u578B sectionpage\uFF1A\u5361\u7247\u5BB9\u5668\u627F\u8F7D\u6574\u9875\u8868\u5355\uFF1B920px \u4E0A\u9650 + \u6C34\u5E73\u5C45\u4E2D\u2014\u2014\n * \u684C\u9762 ._5hQxWq_set-card \u540C\u53E3\u5F84\uFF0C\u5BBD\u5BBF\u4E3B\u4E0B\u4E0D\u7559\u53F3\u4FA7\u6B7B\u533A\u3002box-sizing \u663E\u5F0F\u58F0\u660E\u2014\u2014\u5BBF\u4E3B\u65E0\u5168\u5C40\n * \u590D\u4F4D\uFF0Cwidth:100% + padding/border \u4E0D\u6536\u53E3\u4F1A\u53F3\u6EA2\u51FA\uFF09 */\n._5hQxWq_sectionPage {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  width: 100%;\n  max-width: 920px;\n  margin-inline: auto;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 12px;\n  padding: 14px 16px 16px;\n}\n._5hQxWq_cardTitle {\n  font-size: 14px;\n  font-weight: 700;\n  margin: 0;\n}\n._5hQxWq_cardHint {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin: 0;\n  line-height: 1.6;\n  /* \u8BF4\u660E\u6587\u6848\u7D27\u8D34\u4E0A\u4E00\u884C\u63A7\u4EF6\uFF08\u684C\u9762 SettingRow label+desc gap 2px \u540C\u53E3\u5F84\uFF1B\u5361 gap 10 \u2212 8\uFF09 */\n  margin-top: -8px;\n}\n/* \u5361\u6807\u9898\u4E0B\u7684\u533A\u5757\u526F\u6807\u9898\u4E0D\u6536\u7D27\u8FC7\u5934\uFF08\u684C\u9762 ._5hQxWq_set-sub \u5BF9 h3 \u7EA6 6px\uFF09 */\n._5hQxWq_cardTitle + ._5hQxWq_cardHint {\n  margin-top: -4px;\n}\n/* \u8FDE\u7EED\u8BF4\u660E\u884C\u4E4B\u95F4\u4FDD\u6301\u5E38\u89C4\u884C\u8DDD\uFF0C\u4E0D\u505A\u63A7\u4EF6\u8BF4\u660E\u7684\u8D34\u8EAB\u6536\u7D27 */\n._5hQxWq_cardHint + ._5hQxWq_cardHint {\n  margin-top: 0;\n}\n\n/* \u5206\u7C7B\u5361 / \u6807\u7B7E\u7EF4\u5EA6\u5361 / agent \u5361 */\n._5hQxWq_entityList {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n._5hQxWq_entityCard {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 10px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  flex-wrap: wrap;\n}\n/* \u5806\u53E0\u5F62\u6001\u5B9E\u4F53\u5361\uFF08\u5206\u7C7B\u5361/\u9879\u76EE\u6D3E\u53D1\u5361/agent \u7F16\u8F91\u5361\uFF09\uFF1A\u4E0A\u884C\u6807\u8BC6\u4E0E\u64CD\u4F5C\u3001\u4E0B\u884C\u901A\u680F\u5B57\u6BB5\u2014\u2014\n * \u684C\u9762 cat-row / dispatch-block \u540C\u6784\uFF08\u4E0A\u884C\u4E00\u884C\u6392\u9F50\u3001\u4E0B\u884C\u63CF\u8FF0/\u8868\u5355\u901A\u680F\u4E0D\u6362\u884C\u9519\u843D\uFF09 */\n._5hQxWq_entityCardStack {\n\n  flex-direction: column;\n  align-items: stretch;\n}\n/* \u5361\u5185\u5355\u884C\uFF08\u5B9E\u4F53\u884C\u7B2C\u4E00\u884C\uFF09\uFF1A\u63A7\u4EF6\u540C\u884C\u6392\u9F50\u3001\u4E0D\u6298\u884C\u2014\u2014\u684C\u9762 cat-line / agent-row \u540C\u6784 */\n._5hQxWq_entityLine {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n/* \u884C\u5185\u5B9A\u5BBD\u6863\uFF08\u5BF9\u9F50\u684C\u9762\uFF1A\u540D\u79F0 110 / agent \u540D 120 / \u7EF4\u5EA6 key 84 / \u7AEF\u53E3\xB7\u4E0A\u9650 64 / \u7EF4\u5EA6\u4E0B\u62C9 92 /\n * \u6211\u7684\u79F0\u547C\u7B49\u53F3\u6863\u8F93\u5165 250\u2014\u2014\u80CC\u5305\u8BBE\u7F6E\u9875\u7EDF\u4E00\u53E3\u5F84\uFF09 */\n._5hQxWq_w110 {\n  width: 110px;\n  flex: none;\n}\n._5hQxWq_w250 {\n  width: 250px;\n  flex: none;\n}\n._5hQxWq_w120 {\n  width: 120px;\n  flex: none;\n}\n._5hQxWq_w84 {\n  width: 84px;\n  flex: none;\n}\n._5hQxWq_w64 {\n  width: 64px;\n  flex: none;\n}\n._5hQxWq_w92 {\n  width: 92px;\n  flex: none;\n}\n/* \u884C\u5185\u4F38\u7F29\u6863\uFF1A\u5360\u6EE1\u540C\u884C\u5269\u4F59\u5BBD\uFF08\u547D\u4EE4/\u63CF\u8FF0\u8F93\u5165\uFF09\uFF0C\u8D85\u957F\u7701\u7565\u4E0D\u6491\u7206 */\n._5hQxWq_grow {\n  flex: 1;\n  min-width: 0;\n}\n/* \u6807\u8BC6\u884C\u6587\u672C\uFF08agent \u6298\u53E0\u6001\uFF1A\u540D\u79F0 + \u547D\u4EE4\u6458\u8981\uFF09 */\n._5hQxWq_entityName {\n  width: 120px;\n  flex: none;\n  font-size: 13px;\n  font-weight: 700;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n._5hQxWq_entitySub {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n}\n/* \u5361\u5E95\u52A8\u4F5C\u884C\uFF08\u4FDD\u5B58/\u53D6\u6D88\u7B49\u2014\u2014\u684C\u9762 ._5hQxWq_btn-row \u540C\u6784\uFF09 */\n._5hQxWq_cardActions {\n  display: flex;\n  gap: 10px;\n  margin-top: 10px;\n}\n/* \u505C\u7528\u4E2D\u7684\u5B9E\u4F53\u884C\u6574\u4F53\u964D\u900F\u660E\uFF08\u5206\u7C7B\u505C\u7528/agent \u505C\u7528\u540C\u89C2\u611F\uFF0C\u4E3B\u5E94\u7528 ._5hQxWq_off \u540C\u53E3\u5F84\uFF09 */\n._5hQxWq_entityCard[data-off="true"] {\n  opacity: 0.55;\n}\n/* \u7CBE\u7075\u56FE\u9274\u6846\uFF08specs/dsh-plugin-style T1#10\uFF1A\u7EB8\u5E95 + \u91CD\u58A8\u7EBF\u5C0F\u4EF6\u6846\uFF09 */\n._5hQxWq_entitySprite {\n  width: 32px;\n  height: 32px;\n  image-rendering: pixelated;\n  border-radius: 6px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-paper, #f5f0dc);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex: none;\n}\n._5hQxWq_entityMain {\n  flex: 1;\n  min-width: 160px;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  font-size: 13px;\n}\n._5hQxWq_entityNameInput {\n  box-sizing: border-box;\n  height: var(--pcy-control-h, 32px);\n  padding: 2px 8px;\n  border-radius: 6px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: inherit;\n  font-size: 13px;\n}\n._5hQxWq_entityDescInput {\n  box-sizing: border-box;\n  /* min-height \u6863\uFF08QuotesEditor \u53F0\u8BCD textarea \u4E5F\u6302\u6B64\u7C7B\u2014\u2014textarea \u4E0D\u53EF\u9489\u6B7B\u5355\u884C\u9AD8\uFF09 */\n  min-height: var(--pcy-control-h, 32px);\n  padding: 2px 8px;\n  border-radius: 6px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 12px;\n  width: 100%;\n}\n/* \u7EF4\u5EA6 key \u5217\uFF08\u5EFA\u540E\u53EA\u8BFB\uFF0C\u684C\u9762 dim-key \u540C\u6B3E\uFF1A\u5B9A\u5BBD 84 + \u7701\u7565\uFF09 */\n._5hQxWq_dimKey {\n  flex: none;\n  width: 84px;\n  font-size: 11px;\n  font-weight: 800;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n._5hQxWq_dimCount {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n\n/* \u6807\u7B7E\u7BA1\u7406\u5361\uFF1A\u7EF4\u5EA6\u5206\u7EC4\uFF08\u7EC4\u5934 = \u7EF4\u5EA6\u540D + \u914D\u989D + \u5355\u9009\u6807\u8BB0 + \u65B0\u589E\u5165\u53E3\uFF09 */\n._5hQxWq_tagDimGroup {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  margin-bottom: 12px;\n}\n._5hQxWq_tagDimGroup:last-of-type {\n  margin-bottom: 0;\n}\n._5hQxWq_tagDimHead {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: 32px;\n  font-size: 13px;\n}\n._5hQxWq_tagDimHead b {\n  flex: none;\n}\n/* \u26A1 \u5FBD\u6807\uFF1A\u5DF2\u914D\u7F6E\u9879\u76EE\u6D3E\u53D1\u7684\u6807\u7B7E\uFF08\u914D\u7F6E\u5165\u53E3\u5728 Agent \u5206\u533A\u7684\u300C\u9879\u76EE\u6D3E\u53D1\u300D\u5361\u7247\uFF09 */\n._5hQxWq_tagChip {\n  flex: none;\n  font-size: 13px;\n  cursor: help;\n}\n\n/* agent \u5361 SSH \u8FDC\u7A0B\u6267\u884C\u7EC4\uFF08host/\u7AEF\u53E3/\u79C1\u94A5/\u53CD\u5411\u96A7\u9053/\u5E38\u9A7B\u96A7\u9053\uFF09\uFF1B\u5DE6\u7F18\u7EBF\u6536\u7F16 2px l3\n * \uFF08specs/dsh-plugin-style \xA73.1\uFF1A3px \u6D45\u7070\u5DE6\u7F18\u7EBF\u975E\u58A8\u7EBF\u8BED\u8A00\uFF0C\u7EDF\u4E00\u964D\u6863\uFF09 */\n._5hQxWq_sshGroup {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 8px 10px;\n  border-left: 2px solid var(--dsw-alias-border-l3, #c7cdd4);\n}\n\n/* \u5B9D\u53EF\u68A6\u4E0B\u62C9\u9009\u62E9\u5668\uFF08\u684C\u9762 PokemonPicker \u540C\u6784\uFF09\uFF1A\u6309\u94AE \u2192 \u5185\u8054\u9762\u677F\uFF08\u641C\u7D22 + \u540D\u5F55\u5217\u8868\uFF09 */\n._5hQxWq_pkPicker {\n  position: relative;\n  flex: none;\n}\n._5hQxWq_pkButton {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-height: var(--pcy-control-h, 32px);\n  min-width: 150px;\n  padding: 3px 10px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 13px;\n  font-weight: 600;\n  font-family: inherit;\n  cursor: pointer;\n}\n._5hQxWq_pkButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n._5hQxWq_pkButton[data-open="true"] {\n  background: var(--dsw-alias-interactive-bg-active, #e4e7eb);\n}\n._5hQxWq_pkButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n._5hQxWq_pkThumb {\n  width: 24px;\n  height: 24px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex: none;\n}\n._5hQxWq_pkLabel {\n  flex: 1;\n  min-width: 0;\n  text-align: left;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n._5hQxWq_pkArrow {\n  flex: none;\n  font-size: 10px;\n}\n._5hQxWq_pkPanel {\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n  z-index: 60;\n  width: min(320px, 78vw);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 10px;\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);\n  padding: 8px;\n}\n._5hQxWq_pkSearch {\n  box-sizing: border-box;\n  width: 100%;\n  height: var(--pcy-control-h, 32px);\n  padding: 4px 9px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: inherit;\n  font-size: 13px;\n  font-family: inherit;\n  margin-bottom: 6px;\n}\n._5hQxWq_pkSearch:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n._5hQxWq_pkList {\n  list-style: none;\n  margin: 0;\n  padding: 2px;\n  max-height: 260px;\n  overflow-y: auto;\n}\n._5hQxWq_pkItem {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 13px;\n  padding: 4px 6px;\n  border-radius: 6px;\n  cursor: pointer;\n  white-space: nowrap;\n}\n._5hQxWq_pkItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n._5hQxWq_pkItem[data-sel="true"] {\n  background: var(--dsw-alias-interactive-bg-active, #e4e7eb);\n}\n._5hQxWq_pkCursor {\n  width: 10px;\n  flex: none;\n  font-size: 10px;\n  opacity: 0;\n}\n._5hQxWq_pkItem[data-sel="true"] ._5hQxWq_pkCursor {\n  opacity: 1;\n}\n._5hQxWq_pkName {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n._5hQxWq_pkId {\n  flex: none;\n  font-size: 9px;\n  opacity: 0.65;\n  font-variant-numeric: tabular-nums;\n}\n._5hQxWq_pkBundled {\n  flex: none;\n  font-size: 10.5px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 4px;\n  padding: 0 4px;\n  line-height: 14px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_pkNone {\n  font-size: 12.5px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  text-align: center;\n  padding: 14px 0;\n  cursor: default;\n}\n._5hQxWq_pkNone:hover {\n  background: none;\n}\n\n/* \u4F1A\u8BDD\u8FC7\u6EE4\u884C */\n._5hQxWq_filterRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: 32px;\n  font-size: 13px;\n}\n/* \u8FC7\u6EE4\u5DE5\u5177\u884C\uFF08\u684C\u9762 ._5hQxWq_cf-toolbar \u540C\u6784\uFF09\uFF1A\u641C\u7D22\u6846\u4F38\u7F29\u5360\u4E3B\u5BBD + \u4E09\u7EF4\u4E0B\u62C9\u5B9A\u5BBD\uFF0C\u63A7\u4EF6\u7EDF\u4E00 32px \u7B49\u9AD8 */\n._5hQxWq_filterToolbar input,\n._5hQxWq_filterToolbar select {\n  height: var(--pcy-control-h, 32px);\n  box-sizing: border-box;\n}\n._5hQxWq_filterSearch {\n  flex: 1 1 200px;\n  min-width: 0;\n}\n._5hQxWq_filterSelect {\n  width: 120px;\n  flex: none;\n}\n._5hQxWq_filterChatName {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n/* \u751F\u6548 chip\uFF08\u684C\u9762 ._5hQxWq_cf-eff \u540C\u6784\uFF1A\u6D45\u5E95\u6DF1\u5B57\uFF1B\u62C9\u53D6=ok / \u8FC7\u6EE4=\u4E2D\u6027\u5F31\u5316 / \u964D\u7EA7=warn\uFF09 */\n._5hQxWq_filterEff {\n  flex: none;\n  max-width: 40%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  font-weight: 600;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 999px;\n  padding: 2px 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_filterEffPull {\n  border-color: transparent;\n  background: var(--pcy-ok-soft, #dff3e4);\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n._5hQxWq_filterEffMute {\n  background: transparent;\n}\n._5hQxWq_filterEffDegraded {\n  border-color: var(--pcy-warn-ink, #8a5e06);\n  background: var(--pcy-warn-soft, #fff3cd);\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n._5hQxWq_triStateGroup {\n  display: inline-flex;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 999px;\n  overflow: hidden;\n}\n._5hQxWq_triStateButton {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 2px 12px;\n  border: none;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 12px;\n  cursor: pointer;\n}\n._5hQxWq_triStateButton[aria-pressed="true"] {\n  background: var(--dsw-alias-state-business-primary, #316dca);\n  color: #ffffff;\n}\n._5hQxWq_triStateButton:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n\n/* \u8BCA\u65AD \xB7 \u96C6\u6210\u5065\u5EB7\u884C\uFF08\u684C\u9762 HealthCard ._5hQxWq_health-row \u540C\u6784\uFF1A\u70B9 + \u540D\u79F0 + \u72B6\u6001\u7AE0 + \u5143\u4FE1\u606F\u4F38\u7F29 + \u52A8\u4F5C\u94AE\u53F3\u7F6E\uFF09 */\n._5hQxWq_healthItem {\n  margin-bottom: 10px;\n}\n._5hQxWq_healthItem:last-of-type {\n  margin-bottom: 0;\n}\n._5hQxWq_healthRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  flex-wrap: wrap;\n}\n._5hQxWq_healthDot {\n  flex: none;\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  border: 1px solid rgba(0, 0, 0, 0.25);\n  font-size: 0;\n  line-height: 0;\n}\n._5hQxWq_healthDot[data-level="ok"] {\n  background: var(--pcy-ok, #2e9e5b);\n}\n._5hQxWq_healthDot[data-level="warn"] {\n  background: var(--pcy-warn, #ffcb05);\n}\n._5hQxWq_healthDot[data-level="fail"] {\n  background: var(--pcy-fail, #ee1515);\n}\n._5hQxWq_healthName {\n  flex: none;\n  font-size: 13px;\n  font-weight: 800;\n}\n._5hQxWq_healthState {\n  flex: none;\n  font-size: 12px;\n  font-weight: 700;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 4px;\n  padding: 1px 8px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_healthState[data-level="fail"] {\n  background: var(--pcy-fail-soft, #fdeaea);\n  border-color: var(--pcy-fail, #ee1515);\n  color: var(--pcy-fail, #ee1515);\n}\n._5hQxWq_healthState[data-level="warn"] {\n  background: var(--pcy-conf-mid-soft, #fff3d6);\n  border-color: var(--pcy-warn-ink, #8a5e06);\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n._5hQxWq_healthMeta {\n  flex: 1;\n  min-width: 200px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_healthErr {\n  margin: 4px 0 0 20px;\n  font-size: 12px;\n  color: var(--pcy-fail, #ee1515);\n  overflow-wrap: break-word;\n}\n\n/* LogViewer\uFF08\u684C\u9762 LogViewer \u540C\u6784\uFF1A\u5143\u6570\u636E\u4E00\u884C\uFF08\u65F6\u95F4/\u7EA7\u522B/\u6765\u6E90\uFF09+ message \u72EC\u7ACB\u4E00\u884C\u5168\u5BBD\uFF09\n * specs/dsh-plugin-style T2#13\uFF1A\u65E5\u5FD7\u5C4F = LCD \u7B7E\u540D\u4F4D\uFF08\u5206\u9875\u5236\u4E0D\u6EDA\u52A8\uFF0C\u9759\u6846\u53EF\u76F4\u63A5\u627F\u8F7D\u626B\u63CF\u7EBF\uFF1B\n * \u65F6\u95F4\u6233\u8D70 --pcy-lcd-dim 4.7/5.1:1\u2014\u2014\u4E0D\u5F97\u7528\u5185\u9634\u5F71\u8272 --pcy-lcd-dark 1.2~1.5:1\uFF09 */\n/* LCD \u65E5\u5FD7\u5C4F\u5BB9\u5668 = ui/LcdScreen \u5355\u6E90\u7EC4\u4EF6\uFF08._5hQxWq_lcd\uFF0Cui._5hQxWq_module._5hQxWq_css\uFF09\u2014\u2014\u672C\u6587\u4EF6\u53EA\u4FDD\u7559\u5C4F\u5185\u884C\u6837\u5F0F */\n._5hQxWq_logRow {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  font-size: 12px;\n  padding: 2px 0;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n}\n._5hQxWq_logRow + ._5hQxWq_logRow {\n  margin-top: 4px;\n}\n._5hQxWq_logMeta {\n  display: flex;\n  gap: 10px;\n  align-items: baseline;\n  min-width: 0;\n}\n._5hQxWq_logTime {\n  color: var(--pcy-lcd-dim, #4a563f);\n  flex: none;\n}\n._5hQxWq_logTarget {\n  color: var(--pcy-lcd-dim, #4a563f);\n  flex: none;\n  word-break: break-all;\n}\n._5hQxWq_logMsg {\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n._5hQxWq_logLevel {\n  flex: none;\n  width: 44px;\n}\n._5hQxWq_logLevel[data-level="error"] {\n  color: var(--pcy-lcd-log-error, #d64545);\n  font-weight: 700;\n}\n._5hQxWq_logLevel[data-level="warn"] {\n  color: var(--pcy-lcd-log-warn, #b8860b);\n}\n._5hQxWq_logPager {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n}\n\n/* \u63D0\u793A\u8BCD\u7F16\u8F91\u5668 */\n._5hQxWq_promptPanel {\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 8px;\n  padding: 8px 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n/* \u9762\u677F\u5934\u884C\uFF08\u684C\u9762 ._5hQxWq_panel-head \u540C\u6784 + \u52A8\u4F5C\u94AE\u53F3\u7F6E\uFF09\uFF1A\u6298\u53E0\u94AE\u5360\u4E3B\u5BBD + \u7F16\u8F91/\u6062\u590D\u9ED8\u8BA4\u8D34\u53F3\u7F18 */\n._5hQxWq_promptHeadRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n._5hQxWq_promptHeadRow ._5hQxWq_promptHead {\n  flex: 1;\n  min-width: 0;\n}\n._5hQxWq_promptHeadActions {\n  display: flex;\n  gap: 6px;\n  flex: none;\n}\n/* \u9762\u677F\u5934\u6298\u53E0\u94AE\uFF08\u684C\u9762 ._5hQxWq_panel-head \u540C\u6784\uFF1Acaret + \u540D\u79F0 + \u5FBD\u7AE0\uFF0C\u6574\u884C\u547D\u4E2D\u533A\uFF09 */\n._5hQxWq_promptHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-height: 32px;\n  border: none;\n  background: none;\n  cursor: pointer;\n  text-align: left;\n  font-size: 13px;\n  color: inherit;\n  padding: 2px 4px;\n  border-radius: 6px;\n}\n._5hQxWq_promptHead:hover {\n  background: var(--dsw-alias-interactive-bg-hover, #f0f2f5);\n}\n._5hQxWq_promptCaret {\n  font-size: 10px;\n  width: 12px;\n  flex: none;\n}\n._5hQxWq_promptTextarea {\n  min-height: 120px;\n  padding: 8px;\n  border-radius: 6px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: inherit;\n  font-size: 12px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n}\n._5hQxWq_promptBadge {\n  font-size: 11px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 999px;\n  padding: 0 8px;\n  line-height: 18px;\n}\n._5hQxWq_promptBadge[data-source="custom"] {\n  border-color: var(--pcy-conf-high, #2f7d3c);\n  color: var(--pcy-conf-high, #2f7d3c);\n}\n._5hQxWq_promptBadge[data-source="default_warned"] {\n  border-color: var(--pcy-warn, #b58900);\n  color: var(--pcy-warn, #b58900);\n}\n\n/* \u9884\u89C8\u884C\uFF08\u663E\u793A\u5206\u533A\uFF09 */\n._5hQxWq_previewLine {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n}\n\n/* \u4F7F\u7528\u6307\u5357\u94FE\u63A5\uFF08GitHub \u6587\u6863 \xB7 \u65B0\u7A97\u53E3\u6253\u5F00\uFF1B\u6B21\u7EA7\u6587\u5B57\u8272 + \u4E0B\u5212\u7EBF\u53EF\u70B9\u6697\u793A\uFF09 */\n._5hQxWq_guideLink {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  text-decoration: underline;\n  text-underline-offset: 2px;\n}\n._5hQxWq_guideLink:hover {\n  color: var(--dsw-alias-state-business-primary, #316dca);\n}\n._5hQxWq_guideLink:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n  border-radius: 4px;\n}\n\n/* ---- full-parity \u589E\u91CF\uFF08U25 \u5BFC\u5165/\u6062\u590D + \u53CC\u5F62\u6001\u5C0F\u8D34\u58EB\uFF09 ---- */\n/* \u6587\u4EF6\u9009\u62E9\u627F\u63A5\u4EF6\uFF08\u89C6\u89C9\u9690\u85CF\u4F46\u53EF\u805A\u7126\u53EF\u70B9\u2014\u2014\u952E\u76D8\u53EF\u8FBE\uFF09 */\n._5hQxWq_hiddenFileInput {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  opacity: 0;\n  overflow: hidden;\n  clip: rect(0 0 0 0);\n}\n._5hQxWq_importPickButton {\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 4px 12px;\n  border-radius: 8px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-weight: 700;\n  font-size: 13px;\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n  cursor: pointer;\n}\n._5hQxWq_importPickButton:active {\n  transform: translate(1px, 1px);\n  box-shadow: 1px 1px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n._5hQxWq_importCounts {\n  margin: 4px 0 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_dualFormTip {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.8;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n\n/* ---- AX \u6388\u6743\u5F15\u5BFC\u5757\uFF08U26\uFF1A\u8F93\u5165\u54CD\u5E94\u5361\u7684\u6388\u6743\u95E8\u69DB\u4F34\u968F\u6001\uFF09 ---- */\n._5hQxWq_axPermHint {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 8px;\n  margin-top: 6px;\n  padding: 10px 12px;\n  border: 1.5px dashed var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 8px;\n  font-size: 12px;\n  line-height: 1.7;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_axPermHint p {\n  margin: 0;\n}\n._5hQxWq_axPermRevoked {\n  color: var(--pcy-danger, #b3590f);\n  font-weight: 700;\n}\n._5hQxWq_axPermPathRow {\n  align-self: stretch;\n}\n._5hQxWq_axPermPath {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  text-align: left;\n  background: none;\n  border: 1px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 4px;\n  padding: 4px 8px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  word-break: break-all;\n  cursor: copy;\n  min-height: 32px;\n}\n._5hQxWq_axPermPathHint {\n  font-size: 11px;\n}\n\n/* ---- helper \u80FD\u529B\u77E9\u9635 / \u5FEB\u6377\u952E\u884C / SSH \u5BB6\u65CF\u884C\uFF08U30\uFF09 ---- */\n._5hQxWq_capList {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n}\n._5hQxWq_capRow {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  padding: 5px 0;\n  font-size: 13px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  flex-wrap: wrap;\n}\n._5hQxWq_capDot {\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  flex: none;\n  align-self: center;\n}\n._5hQxWq_capDot[data-ok="true"] {\n  background: var(--pcy-ok, #2f7d3c);\n}\n._5hQxWq_capDot[data-ok="false"] {\n  background: transparent;\n  border-style: dashed;\n}\n._5hQxWq_capState {\n  margin-left: auto;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_capGuide {\n  flex-basis: 100%;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n._5hQxWq_capVersion {\n  margin: 8px 0 0;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n}\n._5hQxWq_shortcutLine {\n  margin: 0;\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n}\n._5hQxWq_sshLine {\n  margin: 4px 0 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n';
    var tagId4 = "dsh-plugin/src/client/settings/settings.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId4) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId4;
      tag.textContent = css4;
      document.head.appendChild(tag);
    }
    var settings_default = {
      settingsSegment: "_5hQxWq_settingsSegment",
      sectionNav: "_5hQxWq_sectionNav",
      sectionNavButton: "_5hQxWq_sectionNavButton",
      settingsHeadRow: "_5hQxWq_settingsHeadRow",
      settingsBody: "_5hQxWq_settingsBody",
      saveControls: "_5hQxWq_saveControls",
      saveFailWrap: "_5hQxWq_saveFailWrap",
      saveFailHint: "_5hQxWq_saveFailHint",
      saveButton: "_5hQxWq_saveButton",
      unsavedDot: "_5hQxWq_unsavedDot",
      unsavedDotInline: "_5hQxWq_unsavedDotInline",
      savedHint: "_5hQxWq_savedHint",
      "set-card": "_5hQxWq_set-card",
      sectionPage: "_5hQxWq_sectionPage",
      cardTitle: "_5hQxWq_cardTitle",
      cardHint: "_5hQxWq_cardHint",
      "set-sub": "_5hQxWq_set-sub",
      entityList: "_5hQxWq_entityList",
      entityCard: "_5hQxWq_entityCard",
      entityCardStack: "_5hQxWq_entityCardStack _5hQxWq_entityCard",
      entityLine: "_5hQxWq_entityLine",
      w110: "_5hQxWq_w110",
      w250: "_5hQxWq_w250",
      w120: "_5hQxWq_w120",
      w84: "_5hQxWq_w84",
      w64: "_5hQxWq_w64",
      w92: "_5hQxWq_w92",
      grow: "_5hQxWq_grow",
      entityName: "_5hQxWq_entityName",
      entitySub: "_5hQxWq_entitySub",
      "btn-row": "_5hQxWq_btn-row",
      cardActions: "_5hQxWq_cardActions",
      off: "_5hQxWq_off",
      entitySprite: "_5hQxWq_entitySprite",
      entityMain: "_5hQxWq_entityMain",
      entityNameInput: "_5hQxWq_entityNameInput",
      entityDescInput: "_5hQxWq_entityDescInput",
      dimKey: "_5hQxWq_dimKey",
      dimCount: "_5hQxWq_dimCount",
      tagDimGroup: "_5hQxWq_tagDimGroup",
      tagDimHead: "_5hQxWq_tagDimHead",
      tagChip: "_5hQxWq_tagChip",
      sshGroup: "_5hQxWq_sshGroup",
      pkPicker: "_5hQxWq_pkPicker",
      pkButton: "_5hQxWq_pkButton",
      pkThumb: "_5hQxWq_pkThumb",
      pkLabel: "_5hQxWq_pkLabel",
      pkArrow: "_5hQxWq_pkArrow",
      pkPanel: "_5hQxWq_pkPanel",
      pkSearch: "_5hQxWq_pkSearch",
      pkList: "_5hQxWq_pkList",
      pkItem: "_5hQxWq_pkItem",
      pkCursor: "_5hQxWq_pkCursor",
      pkName: "_5hQxWq_pkName",
      pkId: "_5hQxWq_pkId",
      pkBundled: "_5hQxWq_pkBundled",
      pkNone: "_5hQxWq_pkNone",
      filterRow: "_5hQxWq_filterRow",
      "cf-toolbar": "_5hQxWq_cf-toolbar",
      filterToolbar: "_5hQxWq_filterToolbar",
      filterSearch: "_5hQxWq_filterSearch",
      filterSelect: "_5hQxWq_filterSelect",
      filterChatName: "_5hQxWq_filterChatName",
      "cf-eff": "_5hQxWq_cf-eff",
      filterEff: "_5hQxWq_filterEff",
      filterEffPull: "_5hQxWq_filterEffPull",
      filterEffMute: "_5hQxWq_filterEffMute",
      filterEffDegraded: "_5hQxWq_filterEffDegraded",
      triStateGroup: "_5hQxWq_triStateGroup",
      triStateButton: "_5hQxWq_triStateButton",
      "health-row": "_5hQxWq_health-row",
      healthItem: "_5hQxWq_healthItem",
      healthRow: "_5hQxWq_healthRow",
      healthDot: "_5hQxWq_healthDot",
      healthName: "_5hQxWq_healthName",
      healthState: "_5hQxWq_healthState",
      healthMeta: "_5hQxWq_healthMeta",
      healthErr: "_5hQxWq_healthErr",
      lcd: "_5hQxWq_lcd",
      module: "_5hQxWq_module",
      css: "_5hQxWq_css",
      logRow: "_5hQxWq_logRow",
      logMeta: "_5hQxWq_logMeta",
      logTime: "_5hQxWq_logTime",
      logTarget: "_5hQxWq_logTarget",
      logMsg: "_5hQxWq_logMsg",
      logLevel: "_5hQxWq_logLevel",
      logPager: "_5hQxWq_logPager",
      promptPanel: "_5hQxWq_promptPanel",
      "panel-head": "_5hQxWq_panel-head",
      promptHeadRow: "_5hQxWq_promptHeadRow",
      promptHead: "_5hQxWq_promptHead",
      promptHeadActions: "_5hQxWq_promptHeadActions",
      promptCaret: "_5hQxWq_promptCaret",
      promptTextarea: "_5hQxWq_promptTextarea",
      promptBadge: "_5hQxWq_promptBadge",
      previewLine: "_5hQxWq_previewLine",
      guideLink: "_5hQxWq_guideLink",
      hiddenFileInput: "_5hQxWq_hiddenFileInput",
      importPickButton: "_5hQxWq_importPickButton",
      importCounts: "_5hQxWq_importCounts",
      dualFormTip: "_5hQxWq_dualFormTip",
      axPermHint: "_5hQxWq_axPermHint",
      axPermRevoked: "_5hQxWq_axPermRevoked",
      axPermPathRow: "_5hQxWq_axPermPathRow",
      axPermPath: "_5hQxWq_axPermPath",
      axPermPathHint: "_5hQxWq_axPermPathHint",
      capList: "_5hQxWq_capList",
      capRow: "_5hQxWq_capRow",
      capDot: "_5hQxWq_capDot",
      capState: "_5hQxWq_capState",
      capGuide: "_5hQxWq_capGuide",
      capVersion: "_5hQxWq_capVersion",
      shortcutLine: "_5hQxWq_shortcutLine",
      sshLine: "_5hQxWq_sshLine",
    };

    // src/client/settings/SectionNav.tsx
    var import_jsx_runtime19 = require("react/jsx-runtime");
    var SECTION_ICONS = {
      focus: "\u{1F345}",
      taxonomy: "\u{1F5C2}",
      pets: "\u{1F43E}",
      display: "\u{1F440}",
      agents: "\u{1F916}",
      feishu: "\u{1F4E1}",
      diag: "\u{1FA7A}",
      general: "\u2699\uFE0F",
    };
    function SectionNav({ active, onChange, dirtySections }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("nav", {
        className: settings_default.sectionNav,
        "aria-label": t("tabs.settings"),
        "data-testid": "section-nav",
        role: "tablist",
        children: SECTION_KEYS.map((section) =>
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
            "button",
            {
              type: "button",
              role: "tab",
              className: settings_default.sectionNavButton,
              "aria-pressed": active === section,
              "data-section": section,
              "data-dirty": dirtySections.has(section) ? "true" : void 0,
              onClick: () => onChange(section),
              children: [
                SECTION_ICONS[section],
                " ",
                t(SECTION_LABEL_KEYS[section]),
                dirtySections.has(section) &&
                  /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", {
                    className: settings_default.unsavedDotInline,
                    "aria-hidden": "true",
                  }),
              ],
            },
            section,
          ),
        ),
      });
    }

    // src/client/settings/SectionShell.tsx
    var import_react13 = require("react");
    var import_jsx_runtime20 = require("react/jsx-runtime");
    var SAVED_HINT_MS = 4e3;
    function useSectionSave() {
      const client = useClient();
      const [saving, setSaving] = (0, import_react13.useState)(false);
      const [hint, setHint] = (0, import_react13.useState)(null);
      const timer = (0, import_react13.useRef)(null);
      (0, import_react13.useEffect)(() => {
        if (hint?.kind === "saved") {
          timer.current = setTimeout(() => {
            setHint(null);
          }, SAVED_HINT_MS);
        }
        return () => {
          if (timer.current !== null) {
            clearTimeout(timer.current);
          }
        };
      }, [hint]);
      async function save(dirtyKeyValues, onSaved) {
        setSaving(true);
        const result = await client.configWrite({ keyValues: dirtyKeyValues });
        setSaving(false);
        if (result.ok) {
          onSaved();
          setHint({ kind: "saved" });
          return true;
        }
        setHint({ kind: "failed", reason: result.error.message });
        return false;
      }
      return { saving, hint, save };
    }
    function SectionShell({ children }) {
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("section", {
        className: settings_default.sectionPage,
        "data-testid": "section-page",
        children,
      });
    }
    function SaveControls({ keys, draft, saved, onSavedKeys, saveBlocked = false, blockedReason }) {
      const { saving, hint, save } = useSectionSave();
      const dirtyKeys = keys.filter((key) => draft[key] !== saved[key]);
      const dirty = dirtyKeys.length > 0;
      async function doSave() {
        if (saving || saveBlocked || dirtyKeys.length === 0) {
          return;
        }
        const dirtyKeyValues = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
        await save(dirtyKeyValues, () => {
          onSavedKeys(dirtyKeys, draft);
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", {
        className: settings_default.saveControls,
        "data-testid": "section-save-controls",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(SaveStateHint, { hint }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(SaveButton, { saving, dirty, onSave: () => void doSave() }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", {
            className: settings_default.saveFailWrap,
            children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(SaveFailHint, {
              hint,
              blockedReason: saveBlocked ? blockedReason : void 0,
            }),
          }),
        ],
      });
    }
    function SaveButton({ saving, dirty, onSave }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("button", {
        type: "button",
        className: settings_default.saveButton,
        title: dirty ? t("dsh.settings.unsavedTitle") : void 0,
        "data-dirty": dirty ? "true" : void 0,
        "data-testid": "section-save",
        onClick: onSave,
        children: [
          saving ? t("dsh.settings.saving") : t("save2"),
          dirty &&
            !saving &&
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", {
              className: settings_default.unsavedDot,
              "aria-hidden": "true",
              "data-testid": "unsaved-dot",
            }),
        ],
      });
    }
    function SaveStateHint({ hint }) {
      const t = useT();
      if (hint?.kind !== "saved") {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", {
        className: settings_default.savedHint,
        role: "status",
        children: t("dsh.settings.saved"),
      });
    }
    function SaveFailHint({ hint, blockedReason }) {
      const t = useT();
      if (blockedReason !== void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", {
          className: settings_default.saveFailHint,
          role: "alert",
          children: blockedReason,
        });
      }
      if (hint?.kind === "failed") {
        return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", {
          className: settings_default.saveFailHint,
          role: "status",
          children: t("dsh.settings.saveFailed", { reason: hint.reason }),
        });
      }
      return null;
    }

    // src/client/ui/Modal.tsx
    var import_react15 = require("react");

    // src/client/ui/useFocusTrap.ts
    var import_react14 = require("react");
    function focusableElements(root) {
      const nodes = root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return [...nodes].filter((n) => !n.hasAttribute("hidden") && n.getAttribute("aria-hidden") !== "true");
    }
    function useFocusTrap(containerRef, active, onEscape) {
      (0, import_react14.useEffect)(() => {
        if (!active) {
          return;
        }
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const container = containerRef.current;
        if (container !== null) {
          const focusables = focusableElements(container);
          (focusables[0] ?? container).focus();
        }
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onEscape();
            return;
          }
          const node = containerRef.current;
          if (event.key === "Tab" && node !== null) {
            const focusables = focusableElements(node);
            if (focusables.length === 0) {
              event.preventDefault();
              return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          previouslyFocused?.focus();
        };
      }, [containerRef, active, onEscape]);
    }

    // src/client/ui/Modal.tsx
    var import_jsx_runtime21 = require("react/jsx-runtime");
    function Modal({ title, children, actions, onClose, ariaLabel }) {
      const ref = (0, import_react15.useRef)(null);
      const close = onClose ?? (() => actions.find((a) => a.variant !== "primary")?.onChoose());
      useFocusTrap(ref, true, close);
      return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", {
        className: ui_default.overlay,
        "data-testid": "modal-overlay",
        children: /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", {
          ref,
          role: "dialog",
          "aria-modal": "true",
          "aria-label": ariaLabel ?? title,
          className: ui_default.dialog,
          tabIndex: -1,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("h3", { className: ui_default.dialogTitle, children: title }),
            children !== void 0 &&
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: ui_default.dialogBody, children }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", {
              className: ui_default.dialogActions,
              children: actions.map((action) =>
                /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                  "button",
                  {
                    type: "button",
                    className:
                      action.variant === "primary"
                        ? ui_default.buttonPrimary
                        : action.variant === "danger"
                          ? ui_default.buttonDanger
                          : ui_default.button,
                    onClick: action.onChoose,
                    disabled: action.disabled,
                    children: action.label,
                  },
                  action.label,
                ),
              ),
            }),
          ],
        }),
      });
    }
    function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, danger = false }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Modal, {
        title,
        actions: [
          { label: t("cancel"), onChoose: onCancel },
          { label: confirmLabel, onChoose: onConfirm, variant: danger ? "danger" : "primary" },
        ],
        onClose: onCancel,
        children: body,
      });
    }

    // src/client/settings/UnsavedLeaveDialog.tsx
    var import_jsx_runtime22 = require("react/jsx-runtime");
    function UnsavedLeaveDialog({ onSaveLeave, onDiscard, onStay, saveBusy = false }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Modal, {
        title: t("dsh.settings.leaveTitle"),
        actions: [
          { label: t("dsh.settings.leaveStay"), onChoose: onStay },
          { label: t("dsh.settings.leaveDiscard"), onChoose: onDiscard, variant: "danger" },
          {
            label: saveBusy ? t("dsh.settings.saving") : t("dsh.settings.leaveSave"),
            onChoose: onSaveLeave,
            variant: "primary",
            disabled: saveBusy,
          },
        ],
        onClose: onStay,
        ariaLabel: t("dsh.settings.leaveTitle"),
      });
    }

    // src/client/settings/sections/AgentSection.tsx
    var import_react24 = require("react");

    // src/client/settings/sections/AgentConfigCard.tsx
    var import_react18 = require("react");

    // src/client/settings/sections/AgentEditForm.tsx
    var import_react17 = require("react");

    // src/client/settings/sections/AgentSkillRow.tsx
    var import_react16 = require("react");
    var import_jsx_runtime23 = require("react/jsx-runtime");
    function skillText(t, skill) {
      if (skill === null) {
        return t("ai.skillUnknown");
      }
      if (!skill.installed) {
        return t("ai.skillNotInstalled");
      }
      return skill.installedVersion === skill.bundledVersion
        ? t("ai.skillUpToDate", { v: skill.installedVersion ?? "?" })
        : t("ai.skillOutdated", { v: skill.installedVersion ?? "?", b: skill.bundledVersion });
    }
    function AgentSkillRow({ agentId, command, dir, commandInvalid }) {
      const t = useT();
      const client = useClient();
      const [skill, setSkill] = (0, import_react16.useState)(null);
      const [skillBusy, setSkillBusy] = (0, import_react16.useState)(false);
      const [skillMsg, setSkillMsg] = (0, import_react16.useState)(null);
      const params = { agentId, command, dir };
      async function checkSkill() {
        setSkillBusy(true);
        setSkillMsg(null);
        const result = await client.pkSkillCheck(params);
        setSkillBusy(false);
        if (result.ok) {
          setSkill(result.data);
        } else {
          setSkillMsg(result.error.message);
        }
      }
      async function installSkill() {
        setSkillBusy(true);
        setSkillMsg(t("ai.skillInstalling"));
        const result = await client.pkSkillInstall(params);
        setSkillBusy(false);
        if (!result.ok) {
          setSkillMsg(result.error.message);
          return;
        }
        setSkillMsg(
          result.data.previousVersion !== null
            ? t("ai.skillUpdated", { v: result.data.version, prev: result.data.previousVersion, where: t("ai.local") })
            : t("ai.skillInstalled", { v: result.data.version, where: t("ai.local") }),
        );
        const fresh = await client.pkSkillCheck(params);
        if (fresh.ok) {
          setSkill(fresh.data);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(import_jsx_runtime23.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(FormRow, {
            label: t("ai.skill"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", {
              className: settings_default.entityLine,
              "data-testid": "agent-skill-line",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", {
                  className: `${settings_default.grow} ${ui_default.muted}`,
                  children: skillText(t, skill),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", {
                  type: "button",
                  className: ui_default.button,
                  disabled: skillBusy || commandInvalid,
                  onClick: () => void checkSkill(),
                  children: t("ai.skillCheck"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", {
                  type: "button",
                  className: ui_default.button,
                  disabled: skillBusy || commandInvalid,
                  onClick: () => void installSkill(),
                  children: t("ai.skillInstall"),
                }),
              ],
            }),
          }),
          skillMsg !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", {
              className: settings_default.cardHint,
              children: skillMsg,
            }),
        ],
      });
    }

    // src/client/settings/sections/AgentSshGroup.tsx
    var import_jsx_runtime24 = require("react/jsx-runtime");
    function AgentSshGroup({ form, setForm }) {
      const t = useT();
      function toggleRemote(on) {
        setForm({ ...form, remote: on ? { host: "", port: 22, keyPath: "", tunnel: null, persistent: false } : null });
      }
      function patchRemote(patch) {
        if (form.remote === void 0 || form.remote === null) {
          return;
        }
        setForm({ ...form, remote: { ...form.remote, ...patch } });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(import_jsx_runtime24.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Toggle, {
            label: t("ai.sshOn"),
            checked: form.remote != null,
            onChange: toggleRemote,
          }),
          form.remote != null &&
            /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", {
              className: settings_default.sshGroup,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", {
                  className: settings_default.entityLine,
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(TextInput, {
                      className: settings_default.grow,
                      ariaLabel: t("dsh.agents.sshHostPh"),
                      value: form.remote.host,
                      onChange: (host) => patchRemote({ host }),
                      placeholder: t("dsh.agents.sshHostPh"),
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(TextInput, {
                      className: settings_default.w84,
                      ariaLabel: t("ai.sshPort"),
                      value: String(form.remote.port),
                      onChange: (v) => patchRemote({ port: Number(v) || 0 }),
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(TextInput, {
                      className: settings_default.grow,
                      ariaLabel: t("ai.sshKeyPh"),
                      value: form.remote.keyPath ?? "",
                      onChange: (keyPath) => patchRemote({ keyPath }),
                      placeholder: t("ai.sshKeyPh"),
                    }),
                  ],
                }),
                /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(FormRow, {
                  label: t("ai.sshTunnel"),
                  labelWidth: 128,
                  children: /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(TextInput, {
                    ariaLabel: t("ai.sshTunnel"),
                    value:
                      form.remote.tunnel === null || form.remote.tunnel === void 0 ? "" : String(form.remote.tunnel),
                    onChange: (v) => patchRemote({ tunnel: v.trim() === "" ? null : Number(v) || null }),
                    placeholder: "10022",
                  }),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Toggle, {
                  label: t("ai.sshKeepAlive"),
                  tip: t("ai.sshKeepAliveDesc"),
                  checked: form.remote.persistent,
                  onChange: (persistent) => patchRemote({ persistent }),
                }),
              ],
            }),
        ],
      });
    }

    // src/client/settings/sections/AgentEditForm.tsx
    var import_jsx_runtime25 = require("react/jsx-runtime");
    function AgentEditForm({
      agentId,
      form,
      setForm,
      busy,
      error,
      conflict,
      commandInvalid,
      onSave,
      onForceSave,
      onCancel,
    }) {
      const t = useT();
      const client = useClient();
      const [testing, setTesting] = (0, import_react17.useState)(false);
      const [testMsg, setTestMsg] = (0, import_react17.useState)(null);
      async function runTest() {
        setTesting(true);
        setTestMsg(null);
        const result = await client.agentTest({ agentId });
        setTesting(false);
        setTestMsg(result.ok ? result.data.message : result.error.message);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", {
            className: settings_default.entityLine,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
                className: settings_default.w120,
                ariaLabel: t("ai.namePh"),
                value: form.name,
                onChange: (name) => setForm({ ...form, name }),
                placeholder: t("ai.namePh"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
                className: settings_default.grow,
                ariaLabel: t("ai.cmdPh"),
                value: form.command,
                onChange: (command) => setForm({ ...form, command }),
                placeholder: t("ai.cmdPh"),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(FormRow, {
            label: t("ai.args"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
              ariaLabel: t("ai.args"),
              value: form.args,
              onChange: (args) => setForm({ ...form, args }),
              placeholder: t("dsh.agents.argsPh"),
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(FormRow, {
            label: t("ai.workdir"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
              ariaLabel: t("ai.workdir"),
              value: form.workdir,
              onChange: (workdir) => setForm({ ...form, workdir }),
              placeholder: t("ai.workdirPh"),
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(FormRow, {
            label: t("ai.historyArgs"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
              ariaLabel: t("ai.historyArgs"),
              value: form.historyArgs,
              onChange: (historyArgs) => setForm({ ...form, historyArgs }),
              placeholder: "--resume",
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(FormRow, {
            label: t("ai.skillDir"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
              ariaLabel: t("ai.skillDir"),
              value: form.skillDir ?? "",
              onChange: (skillDir) => setForm({ ...form, skillDir }),
              placeholder: t("ai.skillDirPh"),
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(AgentSkillRow, {
            agentId,
            command: form.command,
            dir: form.skillDir ?? "",
            commandInvalid,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(FormRow, {
            label: t("ai.timeout"),
            labelWidth: 128,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(TextInput, {
              ariaLabel: t("ai.timeout"),
              value: String(form.timeoutSecs),
              onChange: (v) => setForm({ ...form, timeoutSecs: Number(v) || 0 }),
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(AgentSshGroup, { form, setForm }),
          commandInvalid &&
            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", {
              className: settings_default.saveFailHint,
              children: t("dsh.agents.commandRequired"),
            }),
          error !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", {
              className: settings_default.saveFailHint,
              children: error,
            }),
          conflict &&
            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", {
              type: "button",
              className: ui_default.button,
              disabled: busy,
              "data-testid": "agent-force-save",
              onClick: onForceSave,
              children: t("dsh.prompts.forceOverwriteConfirm"),
            }),
          testMsg !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", {
              className: settings_default.cardHint,
              "data-testid": "agent-test-msg",
              children: testMsg,
            }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", {
            className: settings_default.cardActions,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: busy || commandInvalid,
                onClick: onSave,
                children: t("ai.save"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: testing,
                onClick: () => void runTest(),
                children: testing ? t("testing") : t("ai.test"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", {
                type: "button",
                className: ui_default.button,
                onClick: onCancel,
                children: t("prompts.cancel"),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/AgentConfigCard.tsx
    var import_jsx_runtime26 = require("react/jsx-runtime");
    function AgentConfigCard({ agent, expectedIds, isNew, onSaved, onRemoveNew }) {
      const t = useT();
      const client = useClient();
      const [editing, setEditing] = (0, import_react18.useState)(agent.name === "");
      const [form, setForm] = (0, import_react18.useState)(agent);
      const [busy, setBusy] = (0, import_react18.useState)(false);
      const [error, setError] = (0, import_react18.useState)(null);
      const [conflict, setConflict] = (0, import_react18.useState)(false);
      const [confirmDelete, setConfirmDelete] = (0, import_react18.useState)(false);
      const [deleteConflict, setDeleteConflict] = (0, import_react18.useState)(false);
      const [deleteError, setDeleteError] = (0, import_react18.useState)(null);
      const commandInvalid = form.command.trim() === "";
      async function save(next = form, force = false) {
        setBusy(true);
        const result = await client.agentUpsert({
          agent: next,
          expectedAgentIds: force ? void 0 : expectedIds,
          force,
        });
        setBusy(false);
        if (result.ok) {
          onSaved(result.data.agents);
          setError(null);
          setConflict(false);
          setEditing(false);
        } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
          setConflict(true);
          setError(t("dsh.prompts.forceOverwrite"));
          setEditing(true);
        } else {
          setError(result.error.message);
          setEditing(true);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", {
        className: editing ? settings_default.entityCardStack : settings_default.entityCard,
        "data-testid": "agent-ui.card",
        "data-off": form.enabled ? void 0 : "true",
        children: [
          editing
            ? /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(AgentEditForm, {
                agentId: agent.id,
                form,
                setForm,
                busy,
                error,
                conflict,
                commandInvalid,
                onSave: () => void save(),
                onForceSave: () => void save(form, true),
                onCancel: () => (isNew ? onRemoveNew(agent.id) : setEditing(false)),
              })
            : /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)(import_jsx_runtime26.Fragment, {
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", {
                    className: settings_default.entityName,
                    children: agent.name,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("span", {
                    className: `${settings_default.entitySub} ${ui_default.muted}`,
                    children: [
                      agent.command,
                      agent.remote != null && agent.remote.host.trim() !== "" ? ` \xB7 SSH ${agent.remote.host}` : "",
                      " \xB7",
                      " ",
                      t("ai.skillDir"),
                      ": ",
                      agent.skillDir ?? "-",
                    ],
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Toggle, {
                    compact: true,
                    label: t("ai.enabled"),
                    checked: form.enabled,
                    onChange: (enabled) => {
                      setForm({ ...form, enabled });
                      if (!isNew && !busy) {
                        void save({ ...form, enabled });
                      }
                    },
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    onClick: () => setEditing(true),
                    children: t("prompts.edit"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    onClick: () => setConfirmDelete(true),
                    children: t("ai.remove"),
                  }),
                ],
              }),
          confirmDelete &&
            /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(ConfirmDialog, {
              title: t("ai.remove"),
              body: deleteError ?? `${agent.name} \xB7 ${agent.command}`,
              confirmLabel: deleteConflict ? t("dsh.prompts.forceOverwriteConfirm") : t("ai.remove"),
              danger: true,
              onCancel: () => {
                setConfirmDelete(false);
                setDeleteConflict(false);
                setDeleteError(null);
              },
              onConfirm: () => {
                if (isNew) {
                  setConfirmDelete(false);
                  onRemoveNew(agent.id);
                  return;
                }
                void client
                  .agentDelete({
                    id: agent.id,
                    expectedAgentIds: deleteConflict ? void 0 : expectedIds,
                    force: deleteConflict,
                  })
                  .then((result) => {
                    if (result.ok) {
                      setConfirmDelete(false);
                      setDeleteConflict(false);
                      setDeleteError(null);
                      onSaved(result.data.agents);
                    } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
                      setDeleteConflict(true);
                      setDeleteError(t("dsh.prompts.forceOverwrite"));
                    } else {
                      setDeleteError(result.error.message);
                    }
                  });
              },
            }),
        ],
      });
    }
    function RouteRow({ route, agents, onSaved }) {
      const t = useT();
      const client = useClient();
      const [workdir, setWorkdir] = (0, import_react18.useState)(route.workdir);
      const [agentId, setAgentId] = (0, import_react18.useState)(route.agentId);
      const [saving, setSaving] = (0, import_react18.useState)(false);
      const [hint, setHint] = (0, import_react18.useState)(null);
      const configured = route.agentId.trim() !== "" || route.workdir.trim() !== "";
      (0, import_react18.useEffect)(() => {
        if (hint !== "saved") {
          return;
        }
        const timer = setTimeout(() => setHint(null), SAVED_HINT_MS);
        return () => clearTimeout(timer);
      }, [hint]);
      async function save(next) {
        if (saving) {
          return;
        }
        setSaving(true);
        const result = await client.routeUpsert({ route: next });
        setSaving(false);
        if (result.ok) {
          setHint("saved");
          onSaved();
        } else {
          setHint({ failed: result.error.message });
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", {
        className: settings_default.entityCardStack,
        "data-testid": "route-row",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", {
            className: settings_default.entityLine,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("b", { children: route.tag }),
              /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", {
                className: `${settings_default.grow} ${ui_default.muted}`,
                children: configured
                  ? route.context !== ""
                    ? route.context
                    : t("tagDispatch.configured")
                  : t("tagDispatch.unconfigured"),
              }),
              hint === "saved" &&
                /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", {
                  className: settings_default.savedHint,
                  role: "status",
                  children: t("dsh.settings.saved"),
                }),
              typeof hint === "object" &&
                hint !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", {
                  className: settings_default.saveFailHint,
                  role: "alert",
                  children: t("dsh.settings.saveFailed", { reason: hint.failed }),
                }),
              /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: saving,
                onClick: () => void save({ ...route, agentId, workdir }),
                children: t("tags.save"),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(FormRow, {
            label: t("tagDispatch.agent"),
            labelWidth: 128,
            children: /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(Select, {
              ariaLabel: t("tagDispatch.agent"),
              value: agentId,
              options: [
                { value: "", label: t("tagDispatch.agentNone") },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ],
              onChange: (v) => {
                setAgentId(v);
                void save({ ...route, agentId: v, workdir });
              },
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(FormRow, {
            label: t("tagDispatch.workdir"),
            labelWidth: 128,
            wide: true,
            children: /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(TextInput, {
              ariaLabel: t("tagDispatch.workdir"),
              value: workdir,
              onChange: setWorkdir,
              placeholder: t("tagDispatch.workdirPh"),
            }),
          }),
        ],
      });
    }

    // src/client/settings/sections/PromptOverrideEditor.tsx
    var import_react19 = require("react");
    var import_jsx_runtime27 = require("react/jsx-runtime");
    function PromptOverrideEditor({ specs, onSpecChange }) {
      const t = useT();
      const client = useClient();
      const [openKey, setOpenKey] = (0, import_react19.useState)(null);
      const [editing, setEditing] = (0, import_react19.useState)(false);
      const [value, setValue] = (0, import_react19.useState)("");
      const [hint, setHint] = (0, import_react19.useState)(null);
      const [error, setError] = (0, import_react19.useState)(null);
      const [confirmReset, setConfirmReset] = (0, import_react19.useState)(false);
      const editableSpecs = specs.filter((s) => s.editable);
      const dispatchSpec = specs.find((s) => !s.editable);
      (0, import_react19.useEffect)(() => {
        if (hint === null) {
          return;
        }
        const timer = setTimeout(() => {
          setHint(null);
        }, 4e3);
        return () => {
          clearTimeout(timer);
        };
      }, [hint]);
      function refreshSpec(key, next) {
        onSpecChange(specs.map((s) => (s.storageKey === key ? next : s)));
      }
      async function save(spec) {
        const result = await client.promptOverride({
          key: spec.storageKey ?? "",
          value,
          expectedValue: spec.overrideText ?? void 0,
        });
        if (result.ok) {
          refreshSpec(spec.storageKey ?? "", result.data.spec);
          setEditing(false);
          setError(null);
          setHint(t("prompts.savedHint", { feature: t(`prompts.feature.${spec.id}`) }));
        } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
          const fresh = await client.promptGet({ key: spec.storageKey ?? "" });
          if (fresh.ok) {
            refreshSpec(spec.storageKey ?? "", fresh.data);
            setValue(fresh.data.overrideText ?? "");
          }
          setError(t("dsh.prompts.conflictRefreshed"));
        } else {
          setError(result.error.message);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", {
        className: ui_default.card,
        "data-testid": "prompt-override-editor",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("h4", {
            className: settings_default.cardTitle,
            "data-tip": t("prompts.sub"),
            children: t("prompts.title"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", {
            className: settings_default.entityList,
            children: [
              editableSpecs.map((spec) =>
                /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(
                  "div",
                  {
                    className: settings_default.promptPanel,
                    "data-testid": "prompt-panel",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", {
                        className: settings_default.promptHeadRow,
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("button", {
                            type: "button",
                            className: settings_default.promptHead,
                            "aria-expanded": openKey === spec.storageKey,
                            onClick: () => {
                              setOpenKey(openKey === spec.storageKey ? null : (spec.storageKey ?? null));
                              setEditing(false);
                              setError(null);
                            },
                            children: [
                              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", {
                                className: settings_default.promptCaret,
                                "aria-hidden": "true",
                                children: openKey === spec.storageKey ? "\u25BE" : "\u25B8",
                              }),
                              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("b", {
                                children: t(`prompts.feature.${spec.id}`),
                              }),
                              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", {
                                className: settings_default.promptBadge,
                                "data-source": spec.source,
                                children:
                                  spec.source === "custom"
                                    ? t("prompts.badgeCustom")
                                    : spec.source === "default_warned"
                                      ? t("prompts.badgeWarn")
                                      : t("prompts.badgeDefault"),
                              }),
                            ],
                          }),
                          openKey === spec.storageKey &&
                            !editing &&
                            /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("span", {
                              className: settings_default.promptHeadActions,
                              children: [
                                /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("button", {
                                  type: "button",
                                  className: ui_default.button,
                                  onClick: () => {
                                    setValue(spec.overrideText ?? spec.defaultText);
                                    setEditing(true);
                                  },
                                  children: t("prompts.edit"),
                                }),
                                /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("button", {
                                  type: "button",
                                  className: ui_default.button,
                                  onClick: () => setConfirmReset(true),
                                  children: t("prompts.restore"),
                                }),
                              ],
                            }),
                        ],
                      }),
                      openKey === spec.storageKey &&
                        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(import_jsx_runtime27.Fragment, {
                          children: [
                            editing
                              ? /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(import_jsx_runtime27.Fragment, {
                                  children: [
                                    /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("textarea", {
                                      className: settings_default.promptTextarea,
                                      value,
                                      onChange: (event) => setValue(event.target.value),
                                      "aria-label": t("prompts.editorAria", {
                                        feature: t(`prompts.feature.${spec.id}`),
                                      }),
                                    }),
                                    /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", {
                                      className: settings_default.filterRow,
                                      children: [
                                        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("button", {
                                          type: "button",
                                          className: ui_default.button,
                                          onClick: () => void save(spec),
                                          children: t("prompts.save"),
                                        }),
                                        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("button", {
                                          type: "button",
                                          className: ui_default.button,
                                          onClick: () => {
                                            setEditing(false);
                                            setValue(spec.overrideText ?? spec.defaultText);
                                          },
                                          children: t("prompts.cancel"),
                                        }),
                                      ],
                                    }),
                                  ],
                                })
                              : /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("pre", {
                                  className: settings_default.previewLine,
                                  style: { whiteSpace: "pre-wrap" },
                                  children: spec.text,
                                }),
                            error !== null &&
                              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", {
                                className: settings_default.saveFailHint,
                                children: error,
                              }),
                          ],
                        }),
                    ],
                  },
                  spec.id,
                ),
              ),
              dispatchSpec !== void 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", {
                  className: settings_default.promptPanel,
                  children: /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", {
                    className: settings_default.filterRow,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("b", {
                        "data-tip": t("prompts.readonlyNote"),
                        children: t("prompts.feature.dispatch"),
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", {
                        className: settings_default.promptBadge,
                        children: t("prompts.badgeReadonly"),
                      }),
                    ],
                  }),
                }),
            ],
          }),
          hint !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", {
              className: settings_default.savedHint,
              role: "status",
              children: hint,
            }),
          confirmReset &&
            openKey !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(ConfirmDialog, {
              title: t("prompts.restore"),
              body: t("prompts.confirmText"),
              confirmLabel: t("prompts.confirmOk"),
              danger: true,
              onCancel: () => setConfirmReset(false),
              onConfirm: () => {
                setConfirmReset(false);
                const key = openKey;
                void client
                  .promptReset({ key, expectedValue: specs.find((s) => s.storageKey === key)?.overrideText ?? void 0 })
                  .then((result) => {
                    if (result.ok) {
                      refreshSpec(key, result.data);
                      setEditing(false);
                      setHint(t("prompts.restoredHint"));
                    } else {
                      setError(result.error.message);
                    }
                  });
              },
            }),
        ],
      });
    }

    // src/client/settings/deploy/DeploymentCard.tsx
    var import_react23 = require("react");

    // src/client/settings/deploy/DeployFormModal.tsx
    var import_react20 = require("react");

    // src/client/settings/deploy/deploy.module.css
    var css5 =
      '/**\n * \u8FDC\u7A0B\u90E8\u7F72\u65CF\u6837\u5F0F\uFF08U23/U24 \xB7\u300C\u8FDC\u65B9\u7684\u56FE\u9274\u673A\u300D\u2014\u2014\u90E8\u7F72\u5361\u8BFB\u4F5C\u8FDC\u7AEF\u673A\u5668\u7684\u56FE\u9274\u6761\u76EE\uFF09\uFF1A\n * T1 \u58A8\u6863\u5B9E\u4F53\u5361 + \u7B49\u5BBD\u522B\u540D\u300C\u7F16\u53F7\u4F4D\u300D+ \u72B6\u6001\u5FBD\u7AE0\uFF08\u6587\u5B57\u6052\u58A8\u8272\u4EC5\u72B6\u6001\u70B9\u53D6\u8272\u2014\u2014L2 \u9489\u6B7B\uFF0C\n * --pcy-deploy-* \u8BED\u4E49\u522B\u540D\u6620\u5C04\u5728 ui.Ekxbf5_module.Ekxbf5_css \u4E0E pcy \u8868\u540C\u6587\u4EF6\uFF09+ \u5411\u5BFC\u6B65\u9AA4\u6761\uFF08T0 \u58F3 +\n * T1 \u58A8\uFF0C\u9EC4\u53EA\u6807\u5F53\u524D\u6B65\uFF09+ \u8868\u5355\u884C\u3002\u96F6 animation\uFF08NFR-6\uFF09\uFF1B\u52A8\u6548\u4EC5 buttonDex 80ms \u6309\u538B\u3002\n */\n\n/* ---- \u8868\u5355\uFF08DeployFormModal\uFF09 ---- */\n.Ekxbf5_formRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 8px;\n  font-size: 13px;\n}\n.Ekxbf5_formLabel {\n  flex: 0 0 128px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Ekxbf5_formError {\n  margin: 2px 0 8px;\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n}\n\n/* ---- \u5361\u9762 ---- */\n.Ekxbf5_counts {\n  margin: 0 0 6px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-variant-numeric: tabular-nums;\n}\n.Ekxbf5_empty {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 4px 0 8px;\n}\n.Ekxbf5_emptyText {\n  margin: 0;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  line-height: 1.7;\n}\n.Ekxbf5_sshGuide {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 10px 12px;\n  border: 1.5px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 8px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Ekxbf5_sshGuide p {\n  margin: 0;\n  line-height: 1.7;\n}\n\n/* ---- \u90E8\u7F72\u884C\uFF08entityCard \u540C\u6784 + \u7B49\u5BBD\u7F16\u53F7\u4F4D\uFF09 ---- */\n.Ekxbf5_rowList {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.Ekxbf5_row {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 8px 12px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 10px;\n  padding: 10px 12px;\n}\n.Ekxbf5_row:hover {\n  background: var(--pcy-hover, #fff3c4);\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n}\n.Ekxbf5_rowMain {\n  flex: 1 1 320px;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.Ekxbf5_rowHead {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n.Ekxbf5_alias {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  letter-spacing: 1px;\n  font-weight: 700;\n  font-size: 13px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n\n/* \u72B6\u6001\u5FBD\u7AE0\uFF1A\u6587\u5B57\u6052\u58A8\u8272/\u5BBF\u4E3B\u6587\u5B57\u8272\uFF0C\u4EC5\u72B6\u6001\u70B9\u7740\u8272\uFF08L2\u2014\u2014\u5F69\u8272\u4E0D\u627F\u62C5\u6587\u5B57\u5BF9\u6BD4\u5EA6\uFF09 */\n.Ekxbf5_badge {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  border: 1px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 999px;\n  padding: 2px 10px;\n}\n.Ekxbf5_badgeDot {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  border: 1px solid var(--dsw-alias-label-primary, #1f2328);\n}\n.Ekxbf5_badgeDot[data-tone="ready"] {\n  background: var(--pcy-deploy-ready, #2f7d3c);\n}\n.Ekxbf5_badgeDot[data-tone="readyDirect"] {\n  background: var(--pcy-deploy-ready-direct, #b58900);\n}\n.Ekxbf5_badgeDot[data-tone="notReady"] {\n  background: var(--pcy-deploy-notready, #b58900);\n}\n.Ekxbf5_badgeDot[data-tone="disconnected"] {\n  background: var(--pcy-deploy-disconnected, #b3590f);\n}\n/* \u5411\u5BFC\u6267\u884C\u4E2D = \u4E2D\u6027\u865A\u7EBF\u5FBD\u7AE0\uFF08\u65E0\u8272\u70B9\u2014\u2014\u975E\u72B6\u6001\u8BED\u4E49\uFF0C\u9759\u6001\u6362\u6001\uFF09 */\n.Ekxbf5_badge[data-tone="running"] {\n  border-style: dashed;\n}\n\n/* \u76F4\u8FDE\u6A21\u5F0F\u89D2\u6807\uFF08D31 \u7559\u75D5\u2014\u2014\u6709\u7559\u75D5\u624D\u663E\u793A\uFF09 */\n.Ekxbf5_directTag {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  border: 1px dashed var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 4px;\n  padding: 1px 6px;\n}\n\n/* \u8FDC\u7AEF\u4E09\u5143\u7EC4\uFF08\u8DEF\u5F84\u7B49\u5BBD\u622A\u65AD + title \u5168\u6587\uFF1B\u7A84\u5C4F\u6298\u884C\uFF09 */\n.Ekxbf5_triple {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px 14px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  min-width: 0;\n}\n.Ekxbf5_mono {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  max-width: 260px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.Ekxbf5_lastError {\n  margin: 0;\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n}\n.Ekxbf5_rowOps {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n.Ekxbf5_addRow {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding-top: 10px;\n}\n\n/* ---- \u5411\u5BFC ---- */\n.Ekxbf5_wizardRunning {\n  margin: 0 0 8px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Ekxbf5_steps {\n  list-style: none;\n  margin: 0 0 10px;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.Ekxbf5_stepItem {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  padding: 4px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n}\n.Ekxbf5_stepItem[data-state="pending"] {\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n/* \u6B65\u9AA4\u72B6\u6001\u70B9 + \u6807\u8BB0\uFF1A\u4EC5\u70B9/\u6807\u8BB0\u7740\u8272\uFF0C\u6587\u5B57\u6052\u58A8\uFF08\u590D\u8BC4 r2\u2014\u2014\u6697\u8272\u5BF9\u6BD4\u5EA6\uFF09 */\n.Ekxbf5_stepDot {\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  flex: none;\n}\n.Ekxbf5_stepDot[data-state="done"],\n.Ekxbf5_stepDot[data-state="skipped"] {\n  background: var(--pcy-ok, #2f7d3c);\n}\n.Ekxbf5_stepDot[data-state="failed"] {\n  background: var(--pcy-fail, #b3590f);\n}\n.Ekxbf5_stepDot[data-state="running"] {\n  background: var(--pcy-running, #ffcb05);\n}\n.Ekxbf5_stepName {\n  font-weight: 700;\n}\n.Ekxbf5_stepState {\n  margin-left: auto;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Ekxbf5_stepFailure {\n  margin: 0 0 10px;\n  padding: 8px 10px;\n  border: 1.5px solid var(--pcy-fail, #b3590f);\n  border-radius: 8px;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 6px;\n}\n.Ekxbf5_stepFailureText {\n  margin: 0;\n  font-size: 13px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  line-height: 1.7;\n}\n.Ekxbf5_stepFailureDetail {\n  margin: 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.Ekxbf5_degradeEntry {\n  background: none;\n  border: none;\n  padding: 0;\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n  text-decoration: underline;\n  cursor: pointer;\n  min-height: 32px;\n}\n.Ekxbf5_logEmpty {\n  font-size: 12px;\n  color: var(--pcy-lcd-dim, #4a563f);\n}\n.Ekxbf5_logLine {\n  display: flex;\n  gap: 10px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  padding: 1px 0;\n}\n.Ekxbf5_logLine[data-ok="false"] .Ekxbf5_logText {\n  color: var(--pcy-lcd-log-error, #d64545);\n  font-weight: 700;\n}\n.Ekxbf5_logStep {\n  flex: none;\n  color: var(--pcy-lcd-dim, #4a563f);\n}\n.Ekxbf5_logText {\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.Ekxbf5_wizardCloseHint {\n  margin: 8px 0 0;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n';
    var tagId5 = "dsh-plugin/src/client/settings/deploy/deploy.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId5) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId5;
      tag.textContent = css5;
      document.head.appendChild(tag);
    }
    var deploy_default = {
      module: "Ekxbf5_module",
      css: "Ekxbf5_css",
      formRow: "Ekxbf5_formRow",
      formLabel: "Ekxbf5_formLabel",
      formError: "Ekxbf5_formError",
      counts: "Ekxbf5_counts",
      empty: "Ekxbf5_empty",
      emptyText: "Ekxbf5_emptyText",
      sshGuide: "Ekxbf5_sshGuide",
      rowList: "Ekxbf5_rowList",
      row: "Ekxbf5_row",
      rowMain: "Ekxbf5_rowMain",
      rowHead: "Ekxbf5_rowHead",
      alias: "Ekxbf5_alias",
      badge: "Ekxbf5_badge",
      badgeDot: "Ekxbf5_badgeDot",
      directTag: "Ekxbf5_directTag",
      triple: "Ekxbf5_triple",
      mono: "Ekxbf5_mono",
      lastError: "Ekxbf5_lastError",
      rowOps: "Ekxbf5_rowOps",
      addRow: "Ekxbf5_addRow",
      wizardRunning: "Ekxbf5_wizardRunning",
      steps: "Ekxbf5_steps",
      stepItem: "Ekxbf5_stepItem",
      stepDot: "Ekxbf5_stepDot",
      stepName: "Ekxbf5_stepName",
      stepState: "Ekxbf5_stepState",
      stepFailure: "Ekxbf5_stepFailure",
      stepFailureText: "Ekxbf5_stepFailureText",
      stepFailureDetail: "Ekxbf5_stepFailureDetail",
      degradeEntry: "Ekxbf5_degradeEntry",
      logEmpty: "Ekxbf5_logEmpty",
      logLine: "Ekxbf5_logLine",
      logText: "Ekxbf5_logText",
      logStep: "Ekxbf5_logStep",
      wizardCloseHint: "Ekxbf5_wizardCloseHint",
    };

    // src/client/settings/deploy/DeployFormModal.tsx
    var import_jsx_runtime28 = require("react/jsx-runtime");
    function initialFields(entity) {
      return {
        alias: entity?.alias ?? "",
        nodePath: entity?.nodePath ?? "",
        workdir: entity?.workdir ?? "",
        note: entity?.note ?? "",
      };
    }
    function formTitleKey(entity) {
      return entity === void 0 ? "dsh.deploy.form.addTitle" : "dsh.deploy.form.editTitle";
    }
    function DeployFormModal({ entity, readonly, onClose, onSaved }) {
      const t = useT();
      const client = useClient();
      const editing = entity !== void 0;
      const initial = initialFields(entity);
      const [alias, setAlias] = (0, import_react20.useState)(initial.alias);
      const [nodePath, setNodePath] = (0, import_react20.useState)(initial.nodePath);
      const [workdir, setWorkdir] = (0, import_react20.useState)(initial.workdir);
      const [note, setNote] = (0, import_react20.useState)(initial.note);
      const [saving, setSaving] = (0, import_react20.useState)(false);
      const [aliasError, setAliasError] = (0, import_react20.useState)("");
      const [pathError, setPathError] = (0, import_react20.useState)("");
      const [serverError, setServerError] = (0, import_react20.useState)("");
      async function save() {
        setAliasError("");
        setPathError("");
        setServerError("");
        if (alias.trim() === "") {
          setAliasError(t("dsh.deploy.form.aliasRequired"));
          return;
        }
        if (!editing && nodePath.trim() === "") {
          setPathError(t("dsh.deploy.form.pathRequired"));
          return;
        }
        setSaving(true);
        const result = await client.deploymentUpsert({
          id: entity?.id,
          alias: alias.trim(),
          nodePath: nodePath.trim(),
          workdir: workdir.trim(),
          note,
        });
        setSaving(false);
        if (result.ok) {
          onSaved(result.data.deployment, !editing);
          onClose();
        } else {
          setServerError(result.error.message);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(Modal, {
        title: t(formTitleKey(entity)),
        ariaLabel: t(formTitleKey(entity)),
        actions: [
          { label: t("save2"), onChoose: () => void save(), variant: "primary", disabled: saving || readonly },
          { label: t("cancel"), onChoose: onClose },
        ],
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", {
          "data-testid": "deploy-form",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", {
              className: deploy_default.formRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", {
                  className: deploy_default.formLabel,
                  children: t("dsh.deploy.form.alias"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(TextInput, {
                  value: alias,
                  onChange: setAlias,
                  ariaLabel: t("dsh.deploy.form.alias"),
                }),
              ],
            }),
            aliasError !== "" &&
              /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("p", {
                className: deploy_default.formError,
                role: "alert",
                children: ["\u274C ", aliasError],
              }),
            /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", {
              className: deploy_default.formRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", {
                  className: deploy_default.formLabel,
                  children: t("dsh.deploy.form.nodePath"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(TextInput, {
                  value: nodePath,
                  onChange: setNodePath,
                  placeholder: "/usr/local/bin/node",
                  ariaLabel: t("dsh.deploy.form.nodePath"),
                }),
              ],
            }),
            pathError !== "" &&
              /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("p", {
                className: deploy_default.formError,
                role: "alert",
                children: ["\u274C ", pathError],
              }),
            /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", {
              className: deploy_default.formRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", {
                  className: deploy_default.formLabel,
                  children: t("dsh.deploy.form.workdir"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(TextInput, {
                  value: workdir,
                  onChange: setWorkdir,
                  placeholder: "/srv/work",
                  ariaLabel: t("dsh.deploy.form.workdir"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("label", {
              className: deploy_default.formRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", {
                  className: deploy_default.formLabel,
                  children: t("dsh.deploy.form.note"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(TextInput, {
                  value: note,
                  onChange: setNote,
                  ariaLabel: t("dsh.deploy.form.note"),
                }),
              ],
            }),
            serverError !== "" &&
              /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("p", {
                role: "alert",
                "data-testid": "deploy-form-error",
                children: ["\u274C ", serverError],
              }),
          ],
        }),
      });
    }

    // src/client/settings/deploy/DeploymentWizard.tsx
    var import_react21 = require("react");

    // src/client/ui/LcdScreen.tsx
    var import_jsx_runtime29 = require("react/jsx-runtime");
    function LcdScreen({ children, ariaLabel, testId }) {
      return /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("div", {
        className: ui_default.lcd,
        role: "log",
        "aria-label": ariaLabel,
        "data-testid": testId,
        children,
      });
    }

    // src/client/settings/deploy/DeploymentWizard.tsx
    var import_jsx_runtime30 = require("react/jsx-runtime");
    var STEP_ORDER = ["probe-ssh", "probe-node", "upload", "verify"];
    var STEP_NUMBERS = ["\u2460", "\u2461", "\u2462", "\u2463"];
    function runningLabelKey(step) {
      if (step === "upload") {
        return "dsh.deploy.wizard.state.installing";
      }
      if (step === "verify") {
        return "dsh.deploy.wizard.state.verifying";
      }
      return "dsh.deploy.wizard.state.probing";
    }
    function stepDisplayState(step, status, runningStep, preCompleted) {
      const view = status?.steps.find((s) => s.step === step);
      if (view === void 0 || view.status === "pending") {
        return "pending";
      }
      if (view.status === "failed") {
        return "failed";
      }
      if (runningStep === step) {
        return "running";
      }
      return preCompleted.has(step) ? "skipped" : "done";
    }
    function wizardActions(failedStep, t, onRetry, onAbort, readonly, running) {
      const actions = [];
      if (failedStep !== null) {
        actions.push({ label: t("dsh.deploy.wizard.retry"), onChoose: onRetry, disabled: readonly });
      }
      actions.push({ label: t("dsh.deploy.wizard.abort"), onChoose: onAbort, disabled: readonly || !running });
      return actions;
    }
    function verifyStepFailed(status) {
      return status !== null && status.steps.find((s) => s.step === "verify")?.status === "failed";
    }
    function failureDetail(status, failedStep) {
      return status?.steps.find((s) => s.step === failedStep)?.message ?? null;
    }
    function WizardFailure({ status, failedStep, neverInstalled, onDegradeAsk }) {
      const t = useT();
      const mismatch = verifyStepFailed(status);
      const detail = failureDetail(status, failedStep);
      return /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", {
        className: deploy_default.stepFailure,
        role: "alert",
        "data-testid": "wizard-failure",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", {
            className: deploy_default.stepFailureText,
            children: t(`dsh.deploy.wizard.fail.${failedStep}`),
          }),
          detail !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", {
              className: deploy_default.stepFailureDetail,
              children: detail,
            }),
          failedStep === "upload" &&
            neverInstalled &&
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("button", {
              type: "button",
              className: deploy_default.degradeEntry,
              onClick: () => onDegradeAsk("skipInstall"),
              children: t("dsh.deploy.wizard.skipInstallEntry"),
            }),
          failedStep === "verify" &&
            mismatch &&
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("button", {
              type: "button",
              className: deploy_default.degradeEntry,
              onClick: () => onDegradeAsk("mismatch"),
              children: t("dsh.deploy.wizard.mismatchEntry"),
            }),
        ],
      });
    }
    function DeploymentWizard({
      entity,
      status,
      running,
      runningStep,
      log,
      preCompleted,
      readonly,
      onRetry,
      onAbort,
      onClose,
      onChanged,
    }) {
      const t = useT();
      const client = useClient();
      const [degradeAsk, setDegradeAsk] = (0, import_react21.useState)(null);
      const [degradeBusy, setDegradeBusy] = (0, import_react21.useState)(false);
      const failedStep = status?.failedStep ?? null;
      const neverInstalled = entity.helperPath.trim() === "";
      const actions = wizardActions(failedStep, t, onRetry, onAbort, readonly, running);
      async function confirmDegrade() {
        if (degradeAsk === null) {
          return;
        }
        setDegradeBusy(true);
        const result = await client.deploymentDegradeConfirm({ id: entity.id, acknowledgedRisk: true });
        setDegradeBusy(false);
        if (result.ok) {
          setDegradeAsk(null);
          onChanged();
          onClose();
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(Modal, {
        title: `${t("dsh.deploy.wizard.title")} \xB7 ${entity.alias}`,
        ariaLabel: t("dsh.deploy.wizard.title"),
        actions,
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", {
          "data-testid": "deploy-wizard",
          children: [
            running &&
              /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", {
                className: deploy_default.wizardRunning,
                role: "status",
                children: t("dsh.deploy.wizard.concurrent"),
              }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("ol", {
              className: deploy_default.steps,
              "data-testid": "wizard-steps",
              children: STEP_ORDER.map((step, index) => {
                const state = stepDisplayState(step, status, runningStep, preCompleted);
                return /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)(
                  "li",
                  {
                    className: deploy_default.stepItem,
                    "data-state": state,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", {
                        className: deploy_default.stepDot,
                        "data-state": state,
                        "aria-hidden": "true",
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("span", {
                        className: deploy_default.stepName,
                        children: [STEP_NUMBERS[index], " ", t(`dsh.deploy.wizard.step.${step}`)],
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", {
                        className: deploy_default.stepState,
                        children:
                          state === "running" ? t(runningLabelKey(step)) : t(`dsh.deploy.wizard.state.${state}`),
                      }),
                    ],
                  },
                  step,
                );
              }),
            }),
            failedStep !== null &&
              !running &&
              /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(WizardFailure, {
                status,
                failedStep,
                neverInstalled,
                onDegradeAsk: setDegradeAsk,
              }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(LcdScreen, {
              ariaLabel: t("dsh.deploy.wizard.logTitle"),
              testId: "wizard-log",
              children:
                log.length === 0
                  ? /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", {
                      className: deploy_default.logEmpty,
                      children: t("dsh.deploy.wizard.logEmpty"),
                    })
                  : log.map((line, index) =>
                      /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)(
                        "div",
                        {
                          className: deploy_default.logLine,
                          "data-ok": line.ok === null ? void 0 : String(line.ok),
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", {
                              className: deploy_default.logStep,
                              children: line.step === "info" ? "\xB7\xB7\xB7" : line.step,
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", {
                              className: deploy_default.logText,
                              children: line.text,
                            }),
                          ],
                        },
                        index,
                      ),
                    ),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("p", {
              className: deploy_default.wizardCloseHint,
              children: t("dsh.deploy.wizard.closeHint"),
            }),
            degradeAsk !== null &&
              /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(Modal, {
                title: t("dsh.deploy.degrade.title"),
                ariaLabel: t("dsh.deploy.degrade.title"),
                actions: [
                  { label: t("cancel"), onChoose: () => setDegradeAsk(null) },
                  {
                    label: t("dsh.deploy.degrade.confirm"),
                    onChoose: () => void confirmDegrade(),
                    variant: "danger",
                    disabled: degradeBusy || readonly,
                  },
                ],
                onClose: () => setDegradeAsk(null),
                children: t("dsh.deploy.degrade.body"),
              }),
          ],
        }),
      });
    }

    // src/client/settings/deploy/deploymentWizardRun.ts
    var import_react22 = require("react");
    function stopWizardRun(setWizard, id) {
      setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, running: false, runningStep: null } : prev));
    }
    async function recordWizardFailure(client, setWizard, id, next, result) {
      const text =
        result.error.hint !== void 0 ? `${result.error.message} \u2014 ${result.error.hint}` : result.error.message;
      setWizard((prev) => {
        if (prev === null || prev.id !== id) {
          return prev;
        }
        return {
          ...prev,
          running: false,
          runningStep: null,
          log: [...prev.log, { step: next, ok: false, text }],
        };
      });
      const failStatus = await client.provisionStatus({ id });
      if (failStatus.ok) {
        setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, status: failStatus.data.status } : prev));
      }
    }
    function recordWizardSuccess(setWizard, onChanged, id, next, status) {
      const executed = status.steps.find((s) => s.step === next);
      setWizard((prev) => {
        if (prev === null || prev.id !== id) {
          return prev;
        }
        return {
          ...prev,
          status,
          log: [...prev.log, { step: next, ok: true, text: executed?.message ?? "" }],
        };
      });
      if (status.done) {
        stopWizardRun(setWizard, id);
        onChanged();
      }
    }
    async function openWizardRun(client, setWizard, id) {
      const statusR = await client.provisionStatus({ id });
      const preStatus = statusR.ok ? statusR.data.status : null;
      const preCompleted = new Set((preStatus?.steps ?? []).filter((s) => s.status === "ok").map((s) => s.step));
      setWizard((prev) =>
        prev !== null && prev.id === id
          ? { ...prev, open: true, running: true, runningStep: null, status: preStatus ?? prev.status, preCompleted }
          : { id, open: true, running: true, runningStep: null, status: preStatus, log: [], preCompleted },
      );
      return preStatus;
    }
    function useWizardRunner(deps) {
      const { client, reload, onChanged } = deps;
      const abortRef = (0, import_react22.useRef)(false);
      const [wizard, setWizard] = (0, import_react22.useState)(null);
      const runWizard = (0, import_react22.useCallback)(
        async (id) => {
          abortRef.current = false;
          let status = await openWizardRun(client, setWizard, id);
          for (;;) {
            if (abortRef.current) {
              stopWizardRun(setWizard, id);
              return;
            }
            const next = status?.steps.find((s) => s.status !== "ok")?.step ?? null;
            if (next === null) {
              stopWizardRun(setWizard, id);
              return;
            }
            setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, runningStep: next } : prev));
            const result = await client.provisionRun({ id });
            reload();
            if (!result.ok) {
              await recordWizardFailure(client, setWizard, id, next, result);
              return;
            }
            status = result.data.status;
            recordWizardSuccess(setWizard, onChanged, id, next, status);
            if (status.done) {
              return;
            }
          }
        },
        [client, reload, onChanged, setWizard],
      );
      return { wizard, runWizard, abortRef, setWizard };
    }

    // src/client/settings/deploy/deploymentRow.tsx
    var import_jsx_runtime31 = require("react/jsx-runtime");
    function badgeOf(entity) {
      if (entity.status === "ready") {
        return entity.degraded
          ? { tone: "readyDirect", key: "dsh.deploy.status.readyDirect" }
          : { tone: "ready", key: "dsh.deploy.status.ready" };
      }
      if (entity.status === "disconnected") {
        return { tone: "disconnected", key: "dsh.deploy.status.disconnected" };
      }
      return { tone: "notReady", key: "dsh.deploy.status.notReady" };
    }
    function DeploymentRowItem({ entity, wizardRunning, readonly, onReconnect, onProvision, onEdit, onRemove }) {
      const t = useT();
      const badge = badgeOf(entity);
      return /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("li", {
        className: deploy_default.row,
        "data-testid": "deploy-row",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", {
            className: deploy_default.rowMain,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", {
                className: deploy_default.rowHead,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                    className: deploy_default.alias,
                    title: entity.alias,
                    children: entity.alias,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("span", {
                    className: deploy_default.badge,
                    "data-tone": badge.tone,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                        className: deploy_default.badgeDot,
                        "data-tone": badge.tone,
                        "aria-hidden": "true",
                      }),
                      t(badge.key),
                    ],
                  }),
                  wizardRunning &&
                    /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                      className: deploy_default.badge,
                      "data-tone": "running",
                      "data-testid": "deploy-wizard-running",
                      children: t("dsh.deploy.wizardRunning"),
                    }),
                  entity.degraded &&
                    /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                      className: deploy_default.directTag,
                      children: t("dsh.deploy.directTag"),
                    }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", {
                className: deploy_default.triple,
                title: `${entity.nodePath}
${entity.workdir}${
                  entity.note !== ""
                    ? `
${entity.note}`
                    : ""
                }`,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                    className: deploy_default.mono,
                    children: entity.nodePath,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", {
                    className: deploy_default.mono,
                    children: entity.workdir,
                  }),
                  entity.note !== "" &&
                    /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { children: entity.note }),
                ],
              }),
              entity.lastError !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("p", {
                  className: deploy_default.lastError,
                  children: t("dsh.deploy.lastError", { summary: entity.lastError }),
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", {
            className: deploy_default.rowOps,
            children: [
              entity.status === "disconnected"
                ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    "data-testid": "deploy-reconnect",
                    disabled: readonly,
                    onClick: onReconnect,
                    children: t("dsh.deploy.reconnect"),
                  })
                : entity.status !== "ready" &&
                  /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    "data-testid": "deploy-provision",
                    disabled: readonly,
                    onClick: onProvision,
                    children: t("dsh.deploy.provision"),
                  }),
              /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: readonly,
                onClick: onEdit,
                children: t("dsh.deploy.edit"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: readonly,
                onClick: onRemove,
                children: t("dsh.deploy.remove"),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/deploy/DeploymentCard.tsx
    var import_jsx_runtime32 = require("react/jsx-runtime");
    function isSshMissing(sshFamily) {
      return sshFamily !== null && !sshFamily.ok;
    }
    function sshGuideCmd(detail) {
      return detail ?? "";
    }
    function hasLoaded(list) {
      return list !== null;
    }
    function wizardEntityOf(wizard, list) {
      return wizard !== null ? deploymentsOf(list).find((d) => d.id === wizard.id) : void 0;
    }
    function isEmptyList(list) {
      return list !== null && list.deployments.length === 0;
    }
    function deploymentsOf(list) {
      return list?.deployments ?? [];
    }
    function wizardModalOpen(wizard, entity) {
      return wizard !== null && wizard.open && entity !== void 0;
    }
    function DeploymentCard({ onChanged }) {
      const t = useT();
      const client = useClient();
      const [list, setList] = (0, import_react23.useState)(null);
      const [sshFamily, setSshFamily] = (0, import_react23.useState)(null);
      const [readonly, setReadonly] = (0, import_react23.useState)(false);
      const [form, setForm] = (0, import_react23.useState)(null);
      const [removeTarget, setRemoveTarget] = (0, import_react23.useState)(null);
      const [removeBusy, setRemoveBusy] = (0, import_react23.useState)(false);
      const [saveHint, setSaveHint] = (0, import_react23.useState)("");
      const reload = (0, import_react23.useCallback)(() => {
        void client.deploymentList().then((result) => {
          if (result.ok) {
            setList(result.data);
          }
        });
      }, [client]);
      const { wizard, runWizard, abortRef, setWizard } = useWizardRunner({ client, reload, onChanged });
      (0, import_react23.useEffect)(() => {
        reload();
        void client.dbStatus().then((result) => {
          if (result.ok) {
            setReadonly(result.data.mode === "ro");
          }
        });
        void client.diagnosticsSnapshot().then((result) => {
          if (result.ok) {
            setSshFamily(result.data.sshFamily ?? null);
          }
        });
      }, [reload, client]);
      const wizardEntity = wizardEntityOf(wizard, list);
      return /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", {
        className: ui_default.card,
        "data-testid": "deploy-card",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("h4", {
            className: settings_default.cardTitle,
            "data-testid": "deploy-card-title",
            children: t("dsh.deploy.title"),
          }),
          hasLoaded(list) &&
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", {
              className: deploy_default.counts,
              children: t("dsh.deploy.counts", {
                ready: list.counts.ready,
                pending: list.counts.pending,
                broken: list.counts.broken,
              }),
            }),
          isSshMissing(sshFamily)
            ? // SSH 家族缺失：整卡指引态（添加入口并入指引态——无死入口）
              /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", {
                className: deploy_default.sshGuide,
                "data-testid": "deploy-ssh-guide",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", {
                    children: t("dsh.deploy.sshMissing", { cmd: sshGuideCmd(sshFamily.detail) }),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    onClick: () => {
                      void navigator.clipboard?.writeText(sshGuideCmd(sshFamily.detail)).catch(() => void 0);
                    },
                    children: t("dsh.deploy.copyGuide"),
                  }),
                ],
              })
            : isEmptyList(list)
              ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", {
                  className: deploy_default.empty,
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("p", {
                      className: deploy_default.emptyText,
                      children: t("dsh.deploy.empty"),
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", {
                      type: "button",
                      className: ui_default.buttonDex,
                      "data-testid": "deploy-add",
                      disabled: readonly,
                      onClick: () => setForm({}),
                      children: t("dsh.deploy.add"),
                    }),
                  ],
                })
              : /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)(import_jsx_runtime32.Fragment, {
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("ul", {
                      className: deploy_default.rowList,
                      children: deploymentsOf(list).map((entity) =>
                        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
                          DeploymentRowItem,
                          {
                            entity,
                            wizardRunning: wizard !== null && wizard.id === entity.id && wizard.running,
                            readonly,
                            onReconnect: () => {
                              void client.deploymentRecheck({ id: entity.id }).then(() => reload());
                            },
                            onProvision: () => void runWizard(entity.id),
                            onEdit: () => setForm({ entity }),
                            onRemove: () => setRemoveTarget(entity),
                          },
                          entity.id,
                        ),
                      ),
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", {
                      className: deploy_default.addRow,
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("button", {
                          type: "button",
                          className: ui_default.button,
                          "data-testid": "deploy-add",
                          disabled: readonly,
                          onClick: () => setForm({}),
                          children: t("dsh.deploy.add"),
                        }),
                        saveHint !== "" &&
                          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", {
                            className: ui_default.muted,
                            role: "status",
                            "data-testid": "deploy-save-hint",
                            children: saveHint,
                          }),
                      ],
                    }),
                  ],
                }),
          form !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(DeployFormModal, {
              entity: form.entity,
              readonly,
              onClose: () => setForm(null),
              onSaved: (deployment, created) => {
                reload();
                onChanged();
                if (created) {
                  void runWizard(deployment.id);
                } else {
                  setSaveHint(t("dsh.deploy.editFallback"));
                }
              },
            }),
          removeTarget !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(Modal, {
              title: t("dsh.deploy.removeTitle"),
              ariaLabel: t("dsh.deploy.removeTitle"),
              actions: [
                { label: t("cancel"), onChoose: () => setRemoveTarget(null) },
                {
                  label: t("dsh.deploy.removeConfirm"),
                  onChoose: () => {
                    setRemoveBusy(true);
                    void client.deploymentDelete({ id: removeTarget.id }).then((result) => {
                      setRemoveBusy(false);
                      if (result.ok) {
                        setRemoveTarget(null);
                        reload();
                        onChanged();
                      }
                    });
                  },
                  variant: "danger",
                  disabled: removeBusy || readonly,
                },
              ],
              onClose: () => setRemoveTarget(null),
              children: t("dsh.deploy.removeBody", { alias: removeTarget.alias }),
            }),
          wizardModalOpen(wizard, wizardEntity) &&
            wizardEntity !== void 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(DeploymentWizard, {
              entity: wizardEntity,
              status: wizard.status,
              running: wizard.running,
              runningStep: wizard.runningStep,
              log: wizard.log,
              preCompleted: wizard.preCompleted,
              readonly,
              onRetry: () => void runWizard(wizard.id),
              onAbort: () => {
                abortRef.current = true;
              },
              onClose: () => setWizard((prev) => (prev !== null ? { ...prev, open: false } : prev)),
              onChanged: () => {
                reload();
                onChanged();
              },
            }),
        ],
      });
    }

    // src/client/settings/sections/AgentSection.tsx
    var import_jsx_runtime33 = require("react/jsx-runtime");
    var AGENT_PRESETS = {
      claude: {
        name: "Claude Code",
        command: "claude",
        args: "-p {prompt} --allowedTools Bash(pk:*) --output-format json",
        historyArgs: "--resume",
      },
      opencode: { name: "OpenCode", command: "opencode", args: "run {prompt}", historyArgs: "" },
      pi: { name: "pi", command: "pi", args: "-p {prompt}", historyArgs: "-r" },
      dsh: { name: "DeepSeek Harness", command: "dsh", args: "--profile headless", historyArgs: "" },
      custom: { name: "", command: "", args: "{prompt}", historyArgs: "" },
    };
    var PRESET_OPTIONS = (t) => [
      { value: "claude", label: "Claude Code" },
      { value: "opencode", label: "OpenCode" },
      { value: "pi", label: "pi" },
      { value: "dsh", label: "DeepSeek Harness" },
      { value: "custom", label: t("dsh.agents.presetCustom") },
    ];
    function AgentSection({ agents, routes, tags, promptSpecs, onChanged, ...props }) {
      const { draft, onField } = props;
      const t = useT();
      const client = useClient();
      const [agentPreset, setAgentPreset] = (0, import_react24.useState)("claude");
      const [specs, setSpecs] = (0, import_react24.useState)(promptSpecs);
      (0, import_react24.useEffect)(() => {
        if (specs.length === 0) {
          void client.promptList().then((r) => {
            if (r.ok) {
              setSpecs(r.data.specs);
            }
          });
        }
      }, [specs.length, client]);
      const [panel, setPanel] = (0, import_react24.useState)(() => ({
        list: agents,
        persistedIds: agents.map((a) => a.id),
      }));
      (0, import_react24.useEffect)(() => {
        const idSet = new Set(agents.map((a) => a.id));
        setPanel((prev) => ({
          persistedIds: agents.map((a) => a.id),
          // 面板重拉：持久卡整列跟进服务端；未保存幽灵卡保留（无关刷新不丢草稿）
          list: [...agents, ...prev.list.filter((a) => !idSet.has(a.id) && !prev.persistedIds.includes(a.id))],
        }));
      }, [agents]);
      function handleSaved(next) {
        const idSet = new Set(next.map((a) => a.id));
        setPanel((prev) => ({
          persistedIds: next.map((a) => a.id),
          list: [...next, ...prev.list.filter((a) => !idSet.has(a.id) && !prev.persistedIds.includes(a.id))],
        }));
        onChanged();
      }
      function removeLocal(id) {
        setPanel((prev) => ({ ...prev, list: prev.list.filter((a) => a.id !== id) }));
      }
      const persistedIdSet = new Set(panel.persistedIds);
      const agentList = panel.list;
      const agentOptions = [
        { value: "", label: t("ai.primaryNone") },
        ...agentList.map((a) => ({ value: a.id, label: a.name })),
      ];
      const routeRows = (0, import_react24.useMemo)(() => {
        const byTag = new Map(routes.map((route) => [route.tag, route]));
        return tags
          .filter((tag) => tag.dimension === "project")
          .map((tag) => byTag.get(tag.name) ?? { tag: tag.name, agentId: "", workdir: "", context: "" });
      }, [routes, tags]);
      function dedupeName(base) {
        if (base === "" || !agentList.some((a) => a.name === base)) {
          return base;
        }
        let n = 2;
        while (agentList.some((a) => a.name === `${base} ${n}`)) {
          n++;
        }
        return `${base} ${n}`;
      }
      function addAgent(presetKey) {
        const preset = AGENT_PRESETS[presetKey] ?? AGENT_PRESETS.custom;
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `agent-${Date.now().toString(36)}`;
        setPanel((prev) => ({
          ...prev,
          list: [
            ...prev.list,
            {
              id,
              name: dedupeName(preset.name),
              command: preset.command,
              args: preset.args,
              historyArgs: preset.historyArgs,
              workdir: "",
              timeoutSecs: 120,
              enabled: true,
            },
          ],
        }));
      }
      return /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)(SectionShell, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": t("ai.hint"),
                children: t("ai.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", {
                className: settings_default.entityList,
                children: agentList.map((agent) =>
                  /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
                    AgentConfigCard,
                    {
                      agent,
                      expectedIds: panel.persistedIds,
                      isNew: !persistedIdSet.has(agent.id),
                      onSaved: handleSaved,
                      onRemoveNew: removeLocal,
                    },
                    agent.id,
                  ),
                ),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", {
                className: settings_default.filterRow,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Select, {
                    ariaLabel: t("dsh.agents.presetLabel"),
                    value: agentPreset,
                    options: PRESET_OPTIONS(t),
                    onChange: setAgentPreset,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    onClick: () => addAgent(agentPreset),
                    children: t("ai.add"),
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": t("dispatchCfg.hint"),
                children: t("dispatchCfg.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Select, {
                label: t("ai.primary"),
                tip: t("dsh.settings.judgeSource"),
                value: draft["ai_agent_id"],
                options: agentOptions,
                onChange: (v) => onField("ai_agent_id", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Select, {
                label: t("ai.terminal"),
                tip: t("ai.terminalDesc"),
                badge: t("dsh.badge.dispatch"),
                value: draft["terminal_preference"],
                options: [
                  { value: "default", label: t("ai.termBuiltin") },
                  { value: "iterm2", label: "iTerm2" },
                  { value: "ghostty", label: "Ghostty" },
                  { value: "windows-terminal", label: "Windows Terminal" },
                ],
                onChange: (v) => onField("terminal_preference", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Toggle, {
                label: t("dispatchCfg.auto"),
                tip: t("dispatchCfg.autoDesc"),
                checked: draft["dispatch_auto_enabled"] === "true",
                onChange: (v) => onField("dispatch_auto_enabled", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Select, {
                label: t("dispatchCfg.maxConcurrent"),
                tip: t("dispatchCfg.maxConcurrentDesc"),
                value: draft["dispatch_max_concurrent"],
                options: [1, 2, 3, 4].map((n) => ({ value: String(n), label: t("dispatchCfg.mcN", { n }) })),
                onChange: (v) => onField("dispatch_max_concurrent", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(Toggle, {
                label: t("dispatchCfg.worktree"),
                tip: t("dispatchCfg.worktreeDesc"),
                checked: draft["dispatch_worktree"] === "true",
                onChange: (v) => onField("dispatch_worktree", String(v)),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": `${t("tagDispatch.hint")}
${t("tagDispatch.foot")}`,
                children: t("tagDispatch.title"),
              }),
              routeRows.length === 0
                ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", {
                    className: ui_default.muted,
                    children: t("tagDispatch.empty"),
                  })
                : routeRows.map((route) =>
                    /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
                      RouteRow,
                      { route, agents: agentList, onSaved: onChanged },
                      route.tag,
                    ),
                  ),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(DeploymentCard, { onChanged }),
          /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(PromptOverrideEditor, { specs, onSpecChange: setSpecs }),
        ],
      });
    }

    // src/client/settings/sections/CategoryTagSection.tsx
    var import_react28 = require("react");

    // src/client/settings/sections/PokemonPicker.tsx
    var import_react26 = require("react");

    // src/client/ui/Sprite.tsx
    var import_react25 = require("react");
    var import_jsx_runtime34 = require("react/jsx-runtime");
    var CATALOG2 = catalog_default.entries;
    var ID_BY_KEY = new Map(CATALOG2.map(([id, key]) => [key, id]));
    var SPRITE_CDN = "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
    var SPRITE_FASTLY = "https://fastly.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
    var SPRITE_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
    var ANIMATED_MAX_ID = 649;
    function spriteKeyOf(raw) {
      const trimmed = raw.trim();
      const base = trimmed.startsWith("pokemon/") ? trimmed.slice("pokemon/".length) : trimmed;
      return base.replace(/\.(gif|png)$/, "");
    }
    function spriteCandidates(raw) {
      const id = ID_BY_KEY.get(spriteKeyOf(raw));
      if (id === void 0) {
        return [];
      }
      const hosts = [SPRITE_CDN, SPRITE_FASTLY, SPRITE_RAW];
      const pngs = hosts.map((h) => `${h}/${id}.png`);
      return id <= ANIMATED_MAX_ID
        ? [...hosts.map((h) => `${h}/versions/generation-v/black-white/animated/${id}.gif`), ...pngs]
        : pngs;
    }
    function Sprite({ spriteKey, size = 24, alt = "" }) {
      const candidates = (0, import_react25.useMemo)(() => spriteCandidates(spriteKey), [spriteKey]);
      const [fallback, setFallback] = (0, import_react25.useState)({ key: spriteKey, idx: 0 });
      const idx = fallback.key === spriteKey ? fallback.idx : 0;
      if (candidates.length === 0 || idx >= candidates.length) {
        return /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", {
          "aria-hidden": "true",
          style: { fontSize: size * 0.6, lineHeight: `${size}px` },
          children: "\uFF1F",
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("img", {
        src: candidates[idx],
        alt,
        width: size,
        height: size,
        style: { imageRendering: "pixelated" },
        onError: () => setFallback({ key: spriteKey, idx: idx + 1 }),
      });
    }

    // src/client/settings/sections/PokemonPicker.tsx
    var import_jsx_runtime35 = require("react/jsx-runtime");
    var BUNDLED_KEYS = ["pikachu", "psyduck", "bulbasaur", "chansey", "eevee", "snorlax"];
    function PokemonPicker({ value, onPick, search, nameOf, allowEmptyLabel, ariaLabel }) {
      const t = useT();
      const [open, setOpen] = (0, import_react26.useState)(false);
      const [query, setQuery] = (0, import_react26.useState)("");
      const [results, setResults] = (0, import_react26.useState)([]);
      const [searching, setSearching] = (0, import_react26.useState)(false);
      const rootRef = (0, import_react26.useRef)(null);
      const searchRef = (0, import_react26.useRef)(null);
      (0, import_react26.useEffect)(() => {
        if (!open) {
          return;
        }
        setQuery("");
        const raf = requestAnimationFrame(() => searchRef.current?.focus());
        return () => cancelAnimationFrame(raf);
      }, [open]);
      (0, import_react26.useEffect)(() => {
        if (!open || search === void 0) {
          return;
        }
        let alive = true;
        setSearching(true);
        void search(query)
          .then((list) => {
            if (alive) {
              setResults(list);
            }
          })
          .finally(() => {
            if (alive) {
              setSearching(false);
            }
          });
        return () => {
          alive = false;
        };
      }, [open, query, search]);
      (0, import_react26.useEffect)(() => {
        if (!open) {
          return;
        }
        function onDocClick(event) {
          if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
            setOpen(false);
          }
        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
      }, [open]);
      const selectedLabel = (0, import_react26.useMemo)(() => {
        if (value === "") {
          return allowEmptyLabel ?? "";
        }
        return nameOf(value) || value;
      }, [value, allowEmptyLabel, nameOf]);
      function pick(key) {
        onPick(key);
        setOpen(false);
      }
      function onSearchKeydown(event) {
        if (event.key === "Enter") {
          event.preventDefault();
          const first = results[0];
          if (first !== void 0) {
            pick(first.key);
          }
        } else if (event.key === "Escape") {
          setOpen(false);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", {
        ref: rootRef,
        className: settings_default.pkPicker,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("button", {
            type: "button",
            className: settings_default.pkButton,
            "data-open": open ? "true" : void 0,
            "aria-label": ariaLabel,
            "aria-expanded": open,
            onClick: () => setOpen((v) => !v),
            children: [
              value !== "" &&
                /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                  className: settings_default.pkThumb,
                  children: /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(Sprite, {
                    spriteKey: value,
                    size: 24,
                    alt: selectedLabel,
                  }),
                }),
              /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                className: settings_default.pkLabel,
                children: selectedLabel,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                className: settings_default.pkArrow,
                "aria-hidden": "true",
                children: "\u25BC",
              }),
            ],
          }),
          open &&
            /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", {
              className: settings_default.pkPanel,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("input", {
                  ref: searchRef,
                  className: settings_default.pkSearch,
                  type: "text",
                  value: query,
                  placeholder: t("dsh.pokeSearch.placeholder"),
                  "aria-label": t("dsh.pokeSearch.placeholder"),
                  onChange: (event) => setQuery(event.target.value),
                  onKeyDown: onSearchKeydown,
                }),
                /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("ul", {
                  className: settings_default.pkList,
                  children: [
                    allowEmptyLabel !== void 0 &&
                      /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("li", {
                        className: settings_default.pkItem,
                        "data-sel": value === "" ? "true" : void 0,
                        onClick: () => pick(""),
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                            className: settings_default.pkCursor,
                            "aria-hidden": "true",
                            children: "\u25B6",
                          }),
                          allowEmptyLabel,
                        ],
                      }),
                    results.map((candidate) =>
                      /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)(
                        "li",
                        {
                          className: settings_default.pkItem,
                          "data-sel": candidate.key === value ? "true" : void 0,
                          onClick: () => pick(candidate.key),
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                              className: settings_default.pkCursor,
                              "aria-hidden": "true",
                              children: "\u25B6",
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                              className: settings_default.pkThumb,
                              children: /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(Sprite, {
                                spriteKey: candidate.key,
                                size: 24,
                                alt: candidate.name,
                              }),
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                              className: settings_default.pkName,
                              children: candidate.name,
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("span", {
                              className: settings_default.pkId,
                              children: ["#", candidate.number],
                            }),
                            BUNDLED_KEYS.includes(candidate.key) &&
                              /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", {
                                className: settings_default.pkBundled,
                                children: t("dsh.pokeSearch.bundled"),
                              }),
                          ],
                        },
                        candidate.key,
                      ),
                    ),
                    !searching &&
                      results.length === 0 &&
                      /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("li", {
                        className: settings_default.pkNone,
                        children: t("dsh.pokeSearch.noResult"),
                      }),
                  ],
                }),
              ],
            }),
        ],
      });
    }

    // src/client/settings/sections/TagsManagerCard.tsx
    var import_react27 = require("react");
    var import_jsx_runtime36 = require("react/jsx-runtime");
    function TagsManagerCard({ dimensions, tags, routes, onChanged }) {
      const t = useT();
      const client = useClient();
      const dispatchedNames = (0, import_react27.useMemo)(
        () => new Set(routes.filter((r) => r.agentId !== "" || r.workdir !== "").map((r) => r.tag)),
        [routes],
      );
      const enabledDimOptions = (0, import_react27.useMemo)(
        () => dimensions.filter((d) => d.enabled).map((d) => ({ value: d.key, label: d.name })),
        [dimensions],
      );
      async function addTag(dimKey) {
        await client.tagUpsert({ name: t("tags.newName"), dimension: dimKey, description: "" });
        onChanged();
      }
      return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", {
        className: ui_default.card,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("h4", {
            className: settings_default.cardTitle,
            "data-tip": `${t("tags.hint")}
${t("tags.dimHint")}`,
            children: t("tags.title"),
          }),
          dimensions.map((dimension) => {
            const rows = tags.filter((tag) => tag.dimension === dimension.key);
            return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(
              "div",
              {
                className: settings_default.tagDimGroup,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", {
                    className: settings_default.tagDimHead,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("b", { children: dimension.name }),
                      /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", {
                        className: settings_default.dimCount,
                        children: [
                          t("tags.dimCount", { used: rows.length, max: dimension.maxTags }),
                          dimension.cardinality === "single" ? ` \xB7 ${t("tags.single")}` : "",
                        ],
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("button", {
                        type: "button",
                        className: ui_default.button,
                        disabled: rows.length >= dimension.maxTags,
                        onClick: () => void addTag(dimension.key),
                        children: t("tags.new"),
                      }),
                    ],
                  }),
                  rows.map((tag) =>
                    /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
                      TagRow,
                      {
                        tag,
                        dispatched: dispatchedNames.has(tag.name),
                        dimOptions: enabledDimOptions,
                        onChanged,
                      },
                      tag.id,
                    ),
                  ),
                ],
              },
              dimension.key,
            );
          }),
        ],
      });
    }
    function TagRow({ tag, dispatched, dimOptions, onChanged }) {
      const t = useT();
      const client = useClient();
      const [name, setName] = (0, import_react27.useState)(tag.name);
      const [description, setDescription] = (0, import_react27.useState)(tag.description);
      const [dimension, setDimension] = (0, import_react27.useState)(tag.dimension);
      const [confirmDelete, setConfirmDelete] = (0, import_react27.useState)(false);
      async function save() {
        await client.tagUpsert({ id: tag.id, name: name.trim(), dimension, description });
        onChanged();
      }
      return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", {
        className: settings_default.entityCard,
        "data-testid": "tag-row",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(TextInput, {
            className: settings_default.w110,
            ariaLabel: t("tags.namePh"),
            value: name,
            onChange: setName,
            placeholder: t("tags.namePh"),
          }),
          dispatched &&
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", {
              className: settings_default.tagChip,
              title: t("tagDispatch.chipHint"),
              children: "\u26A1",
            }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(TextInput, {
            className: settings_default.grow,
            ariaLabel: t("tags.descPh"),
            value: description,
            onChange: setDescription,
            placeholder: t("tags.descPh"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(Select, {
            className: settings_default.w92,
            ariaLabel: t("tags.dimTitle"),
            value: dimension,
            options: dimOptions,
            onChange: setDimension,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("button", {
            type: "button",
            className: ui_default.button,
            onClick: () => void save(),
            children: t("tags.save"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("button", {
            type: "button",
            className: ui_default.button,
            onClick: () => setConfirmDelete(true),
            children: t("tags.release"),
          }),
          confirmDelete &&
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(ConfirmDialog, {
              title: t("tags.release"),
              body: t("dsh.tag.deleteConfirm", { name: tag.name }),
              confirmLabel: t("tags.release"),
              danger: true,
              onCancel: () => setConfirmDelete(false),
              onConfirm: () => {
                void client.tagDelete({ id: tag.id }).then(() => {
                  setConfirmDelete(false);
                  onChanged();
                });
              },
            }),
        ],
      });
    }

    // src/client/settings/sections/CategoryTagSection.tsx
    var import_jsx_runtime37 = require("react/jsx-runtime");
    function CategoryTagSection({ categories, dimensions, tags, routes = [], pokemonSearch, nameOf, onChanged }) {
      const t = useT();
      const client = useClient();
      const { locale } = useI18n();
      const [releaseTarget, setReleaseTarget] = (0, import_react28.useState)(null);
      const [newCategory, setNewCategory] = (0, import_react28.useState)("");
      const [toggleError, setToggleError] = (0, import_react28.useState)(null);
      async function saveCategory(category, patch) {
        await client.categoryUpsert({ id: category.id, ...patch });
        onChanged();
      }
      async function toggleCategory(category, enabled) {
        const result = await client.categoryUpsert({ id: category.id, enabled });
        if (result.ok) {
          setToggleError(null);
          onChanged();
        } else {
          setToggleError({ id: category.id, message: result.error.message });
        }
      }
      const pokemonName = nameOf ?? createPokemonName(locale);
      const search = pokemonSearch ?? createPokemonSearch(locale);
      return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("section", {
        className: settings_default.sectionPage,
        "data-testid": "section-page",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": t("cats.hint"),
                children: t("cats.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", {
                className: settings_default.entityList,
                children: categories.map((category) =>
                  /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)(
                    "div",
                    {
                      className: settings_default.entityCardStack,
                      "data-testid": "category-ui.card",
                      "data-off": category.enabled ? void 0 : "true",
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", {
                          className: settings_default.entityLine,
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TextInput, {
                              className: settings_default.w110,
                              ariaLabel: t("tags.namePh"),
                              value: category.name,
                              onChange: (name) => void saveCategory(category, { name }),
                              placeholder: t("tags.namePh"),
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Toggle, {
                              compact: true,
                              label: t("cats.toggle"),
                              checked: category.enabled,
                              onChange: (enabled) => void toggleCategory(category, enabled),
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(PokemonPicker, {
                              value: category.sprite,
                              onPick: (key) => {
                                void client
                                  .categoryUpsert({ id: category.id, pokemon: pokemonName(key), sprite: key })
                                  .then(onChanged);
                              },
                              search,
                              nameOf: pokemonName,
                              ariaLabel: `${category.name} \xB7 ${t("dsh.pokeSearch.placeholder")}`,
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("button", {
                              type: "button",
                              className: ui_default.button,
                              onClick: () => setReleaseTarget(category),
                              children: t("cats.release"),
                            }),
                          ],
                        }),
                        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TextInput, {
                          ariaLabel: t("cats.descPlaceholder"),
                          value: category.description,
                          onChange: (description) => void saveCategory(category, { description }),
                          placeholder: t("cats.descPlaceholder"),
                        }),
                        toggleError?.id === category.id &&
                          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", {
                            className: settings_default.saveFailHint,
                            role: "alert",
                            children: toggleError.message,
                          }),
                      ],
                    },
                    category.id,
                  ),
                ),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", {
                className: settings_default.filterRow,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TextInput, {
                    ariaLabel: t("cats.newName"),
                    value: newCategory,
                    onChange: setNewCategory,
                    placeholder: t("cats.newName"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    disabled: newCategory.trim() === "",
                    onClick: async () => {
                      await client.categoryUpsert({ name: newCategory.trim() });
                      setNewCategory("");
                      onChanged();
                    },
                    children: t("cats.new"),
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TagsManagerCard, { dimensions, tags, routes, onChanged }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": `${t("tags.dimManageHint")}
${t("tags.dimHint")}`,
                children: t("tags.dimTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", {
                className: settings_default.entityList,
                children: dimensions.map((dimension) =>
                  /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(DimensionCard, { dimension, onChanged }, dimension.key),
                ),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("p", {
                className: ui_default.muted,
                children: [tags.length, " ", t("tags.title")],
              }),
            ],
          }),
          releaseTarget !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(ConfirmDialog, {
              title: t("cats.release"),
              body: t("dsh.category.releaseConfirm", {
                name: releaseTarget.name,
                n: categories.length,
                first: categories.find((c) => c.id !== releaseTarget.id)?.name ?? "",
              }),
              confirmLabel: t("dsh.release.confirmOk"),
              danger: true,
              onCancel: () => setReleaseTarget(null),
              onConfirm: () => {
                void client.categoryDelete({ id: releaseTarget.id }).then(() => {
                  setReleaseTarget(null);
                  onChanged();
                });
              },
            }),
        ],
      });
    }
    function DimensionCard({ dimension, onChanged }) {
      const t = useT();
      const client = useClient();
      const [name, setName] = (0, import_react28.useState)(dimension.name);
      const [maxTags, setMaxTags] = (0, import_react28.useState)(String(dimension.maxTags));
      return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", {
        className: settings_default.entityCard,
        "data-testid": "dimension-ui.card",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", {
            className: settings_default.dimKey,
            title: dimension.key,
            children: dimension.key,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TextInput, {
            className: settings_default.w110,
            ariaLabel: t("tags.dimNamePh"),
            value: name,
            onChange: setName,
            placeholder: t("tags.dimNamePh"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(TextInput, {
            className: settings_default.w64,
            ariaLabel: t("tags.maxTags"),
            value: maxTags,
            onChange: setMaxTags,
            placeholder: t("tags.maxTags"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(Toggle, {
            compact: true,
            label: t("cats.toggle"),
            checked: dimension.enabled,
            onChange: (enabled) => {
              void client.dimensionUpdate({ key: dimension.key, name, enabled });
              onChanged();
            },
          }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("button", {
            type: "button",
            className: ui_default.button,
            onClick: async () => {
              await client.dimensionUpdate({ key: dimension.key, name, maxTags: Number(maxTags) });
              onChanged();
            },
            children: t("tags.save"),
          }),
        ],
      });
    }

    // src/client/settings/sections/DiagnosticsSection.tsx
    var import_react29 = require("react");
    var import_jsx_runtime38 = require("react/jsx-runtime");
    function aggregateLevel(level) {
      if (level === "ok" || level === "idle") {
        return "ok";
      }
      if (level === "degraded" || level === "paused") {
        return "warn";
      }
      return "fail";
    }
    function levelTextKey(level) {
      return `diag.status.${level}`;
    }
    function reportButtonKey(state) {
      if (state === "working") {
        return "dsh.pokeSearch.searching";
      }
      return state === "copied" ? "diag.reportCopied" : "diag.copyReport";
    }
    function shortcutFailed(snapshot) {
      return snapshot?.shortcutRegistered === false;
    }
    function SshFamilyLine({ snapshot }) {
      const t = useT();
      const family = snapshot?.sshFamily;
      if (family == null) {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
        className: settings_default.sshLine,
        "data-testid": "ssh-family-line",
        children: family.ok ? t("dsh.diag.sshOk") : t("dsh.diag.sshMissing", { cmd: family.detail ?? "" }),
      });
    }
    function DiagnosticsSection() {
      const t = useT();
      const client = useClient();
      const [snapshot, setSnapshot] = (0, import_react29.useState)(null);
      const [reportState, setReportState] = (0, import_react29.useState)("idle");
      function reload() {
        void client.diagnosticsSnapshot().then((result) => {
          if (result.ok) {
            setSnapshot(result.data);
          }
        });
      }
      (0, import_react29.useEffect)(reload, [client]);
      async function copyReport() {
        setReportState("working");
        const result = await client.supportReport();
        if (result.ok) {
          await navigator.clipboard?.writeText(result.data.text).catch(() => void 0);
          setReportState("copied");
        } else {
          setReportState("idle");
        }
      }
      const links = snapshot?.links ?? [];
      return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("section", {
        className: settings_default.sectionPage,
        "data-testid": "section-page",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": t("diag.healthHint"),
                children: t("diag.healthTitle"),
              }),
              links.map((link) =>
                /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
                  "div",
                  {
                    className: settings_default.healthItem,
                    "data-testid": "diag-link",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
                        className: settings_default.healthRow,
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                            className: settings_default.healthDot,
                            "data-level": aggregateLevel(link.level),
                            "aria-hidden": "true",
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                            className: settings_default.healthName,
                            children: t(`diag.provider.${link.provider}`),
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                            className: settings_default.healthState,
                            "data-level": aggregateLevel(link.level),
                            children: t(levelTextKey(link.level)),
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("span", {
                            className: settings_default.healthMeta,
                            children: [
                              link.lastSuccessAt !== null
                                ? t("diag.lastSuccess", { v: link.lastSuccessAt })
                                : t("diag.never"),
                              link.nextPollAt !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(import_jsx_runtime38.Fragment, {
                                  children: [" \xB7 ", t("diag.nextPoll", { v: link.nextPollAt })],
                                }),
                              link.provider === "feishu" &&
                                /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(import_jsx_runtime38.Fragment, {
                                  children: [" \xB7 ", t("diag.pending", { n: link.pendingCount })],
                                }),
                              link.primaryAgent !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(import_jsx_runtime38.Fragment, {
                                  children: [" \xB7 ", t("diag.primaryAgent", { name: link.primaryAgent })],
                                }),
                              " \xB7 ",
                              t("dsh.radio.failCount", { n: link.consecutiveFailures }),
                            ],
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("button", {
                            type: "button",
                            className: ui_default.button,
                            onClick: async () => {
                              if (link.provider === "feishu") {
                                await client.pollNow();
                              } else {
                                await client.retryJudge({ messageIds: "all" });
                              }
                              reload();
                            },
                            children: t("diag.pollNow"),
                          }),
                        ],
                      }),
                      link.lastError !== null &&
                        /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
                          className: settings_default.healthErr,
                          children: link.lastError,
                        }),
                    ],
                  },
                  link.provider,
                ),
              ),
              links.length === 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
                  className: ui_default.muted,
                  children: t("diag.never"),
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: reportState === "working",
                onClick: () => void copyReport(),
                children: t(reportButtonKey(reportState)),
              }),
              reportState === "copied" &&
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                  className: settings_default.savedHint,
                  role: "status",
                  children: "\u2714",
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(HelperCapabilityMatrix, { snapshot }),
          shortcutFailed(snapshot) &&
            /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
              className: settings_default.shortcutLine,
              "data-testid": "shortcut-line",
              children: t("dsh.diag.shortcutFailed"),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(SshFamilyLine, { snapshot }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(LogViewer, {}),
        ],
      });
    }
    function HelperCapabilityMatrix({ snapshot }) {
      const t = useT();
      const caps = snapshot?.helperCaps ?? null;
      return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
        className: ui_default.card,
        "data-testid": "helper-caps",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("h4", {
            className: settings_default.cardTitle,
            children: t("dsh.diag.capsTitle"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("ul", {
            className: settings_default.capList,
            children: HELPER_CAP_ROWS.map((row) => {
              const ok2 = caps !== null && caps[row.cap] === true;
              return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
                "li",
                {
                  className: settings_default.capRow,
                  "data-ok": ok2,
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                      className: settings_default.capDot,
                      "data-ok": ok2,
                      "aria-hidden": "true",
                    }),
                    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { children: t(`dsh.diag.caps.${row.id}`) }),
                    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                      className: settings_default.capState,
                      children: t(ok2 ? "dsh.diag.caps.ok" : "dsh.diag.caps.degraded"),
                    }),
                    !ok2 &&
                      /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                        className: settings_default.capGuide,
                        children: t("dsh.diag.caps.guide"),
                      }),
                  ],
                },
                row.id,
              );
            }),
          }),
          caps === null
            ? /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
                className: settings_default.capVersion,
                children: t("dsh.diag.caps.absent"),
              })
            : snapshot?.helperVersion != null &&
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
                className: settings_default.capVersion,
                children: t("dsh.diag.caps.version", { v: snapshot.helperVersion ?? "" }),
              }),
        ],
      });
    }
    function LogViewer() {
      const t = useT();
      const client = useClient();
      const [entries, setEntries] = (0, import_react29.useState)([]);
      const [total, setTotal] = (0, import_react29.useState)(0);
      const [offset, setOffset] = (0, import_react29.useState)(0);
      const [minLevel, setMinLevel] = (0, import_react29.useState)("");
      const [target, setTarget] = (0, import_react29.useState)("");
      const pageSize = 50;
      function load(nextOffset) {
        void client
          .logQuery({
            minLevel: minLevel === "" ? void 0 : minLevel,
            target: target === "" ? void 0 : target,
            offset: nextOffset,
            limit: pageSize,
          })
          .then((result) => {
            if (result.ok) {
              setEntries(result.data.entries);
              setTotal(result.data.total);
            }
          });
      }
      (0, import_react29.useEffect)(() => {
        load(0);
      }, [minLevel, target, client]);
      const pageMax = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.floor(offset / pageSize) + 1;
      return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
        className: ui_default.card,
        "data-testid": "log-viewer",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("h4", {
            className: settings_default.cardTitle,
            children: t("diag.logTitle"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
            className: settings_default.filterRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("select", {
                className: ui_default.select,
                "aria-label": t("diag.logLevel"),
                value: minLevel,
                onChange: (event) => setMinLevel(event.target.value),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("option", { value: "", children: t("diag.allLevels") }),
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("option", { value: "info", children: "info+" }),
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("option", { value: "warn", children: "warn+" }),
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("option", { value: "error", children: "error" }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("input", {
                className: `${ui_default.input} ${settings_default.grow}`,
                "aria-label": t("diag.logSource"),
                placeholder: t("diag.logSource"),
                value: target,
                onChange: (event) => setTarget(event.target.value),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("button", {
                type: "button",
                className: ui_default.button,
                onClick: () => load(offset),
                children: t("diag.refresh"),
              }),
            ],
          }),
          entries.length === 0
            ? /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", {
                className: ui_default.muted,
                children: t("diag.logEmpty"),
              })
            : /* LCD 日志屏（T2 ② 类目——LcdScreen 单源组件，与向导输出屏同件两落位） */
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(LcdScreen, {
                ariaLabel: t("diag.logTitle"),
                testId: "log-screen",
                children: entries.map((entry, index) =>
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
                    "div",
                    {
                      className: settings_default.logRow,
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
                          className: settings_default.logMeta,
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                              className: settings_default.logTime,
                              children: entry.time,
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                              className: settings_default.logLevel,
                              "data-level": entry.level,
                              children: entry.level,
                            }),
                            /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                              className: settings_default.logTarget,
                              children: entry.target,
                            }),
                          ],
                        }),
                        /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("div", {
                          className: settings_default.logMsg,
                          children: entry.message,
                        }),
                      ],
                    },
                    `${entry.time}-${index}`,
                  ),
                ),
              }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", {
            className: settings_default.logPager,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: page <= 1,
                onClick: () => setOffset(Math.max(0, offset - pageSize)),
                children: t("sess.prev"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", {
                children: t("sess.pageOf", { cur: page, max: pageMax }),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: page >= pageMax,
                onClick: () => setOffset(offset + pageSize),
                children: t("sess.next"),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/DisplaySection.tsx
    var import_jsx_runtime39 = require("react/jsx-runtime");
    var DATE_FORMAT_LABELS = {
      "YYYY-MM-DD": "2026-10-11",
      "MM/DD/YYYY": "10/11/2026",
      "DD/MM/YYYY": "11/10/2026",
    };
    function previewDateTime(draft) {
      const fmt = DATE_FORMATS.includes(draft["date_format"]) ? draft["date_format"] : "YYYY-MM-DD";
      const time = draft["time_format"] === "12h" ? "4:24 PM" : "16:24";
      return `${DATE_FORMAT_LABELS[fmt]} ${time}`;
    }
    function DisplaySection({ onLocalePreview, ...props }) {
      const { draft, onField } = props;
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(SectionShell, {
        children: /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("div", {
          className: ui_default.card,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("h4", {
              className: settings_default.cardTitle,
              children: t("display.title"),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(Select, {
              label: t("display.language"),
              value: draft["language"],
              options: [
                { value: "zh-Hans", label: "\u7B80\u4F53\u4E2D\u6587" },
                { value: "zh-Hant", label: "\u7E41\u9AD4\u4E2D\u6587" },
                { value: "en", label: "English" },
              ],
              onChange: (v) => {
                onField("language", v);
                onLocalePreview?.(v);
              },
            }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(Select, {
              label: t("display.date"),
              value: draft["date_format"],
              options: DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] })),
              onChange: (v) => onField("date_format", v),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(Select, {
              label: t("display.time"),
              value: draft["time_format"],
              options: [
                { value: "24h", label: t("display.h24") },
                { value: "12h", label: t("display.h12") },
              ],
              onChange: (v) => onField("time_format", v),
              labelExtra: /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("span", {
                className: settings_default.previewLine,
                "data-testid": "display-preview",
                children: t("display.preview", { v: previewDateTime(draft) }),
              }),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(Select, {
              label: t("display.overdueMode"),
              value: draft["overdue_mode"],
              options: [
                { value: "collapse", label: t("overdue.modeCollapse") },
                { value: "auto_grass", label: t("overdue.modeAuto") },
                { value: "show", label: t("overdue.modeShow") },
              ],
              onChange: (v) => onField("overdue_mode", v),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(Toggle, {
              label: t("display.dueRelative"),
              tip: t("display.dueRelativeDesc"),
              checked: draft["due_relative"] === "true",
              onChange: (v) => onField("due_relative", String(v)),
            }),
          ],
        }),
      });
    }

    // src/client/settings/sections/FeishuSection.tsx
    var import_react31 = require("react");

    // src/client/settings/sections/FeishuConnCard.tsx
    var import_react30 = require("react");
    var import_jsx_runtime40 = require("react/jsx-runtime");
    function FeishuConnCard({ draft, onField }) {
      const t = useT();
      const client = useClient();
      const [authBusy, setAuthBusy] = (0, import_react30.useState)(false);
      const [authLaunched, setAuthLaunched] = (0, import_react30.useState)(false);
      const [authError, setAuthError] = (0, import_react30.useState)(null);
      const [testState, setTestState] = (0, import_react30.useState)({
        busy: false,
        identity: null,
        failed: false,
      });
      return /* @__PURE__ */ (0, import_jsx_runtime40.jsxs)("div", {
        className: ui_default.card,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("h4", {
            className: settings_default.cardTitle,
            "data-tip": t("feishu.hint"),
            children: t("stabs.feishu"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(Toggle, {
            label: t("feishu.enable"),
            checked: draft["feishu_enabled"] === "true",
            onChange: (v) => onField("feishu_enabled", String(v)),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(Select, {
            label: t("feishu.interval"),
            value: draft["feishu_poll_interval"],
            options: POLL_INTERVAL_SECS.map((secs) => ({
              value: String(secs),
              label: t("focus.minutes", { n: secs / 60 }),
            })),
            onChange: (v) => onField("feishu_poll_interval", v),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime40.jsxs)("div", {
            className: settings_default.filterRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                style: { flex: 1 },
                "data-tip": t("feishu.myNamesDesc"),
                children: t("feishu.myNames"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(TextInput, {
                className: settings_default.w250,
                ariaLabel: t("feishu.myNames"),
                value: draft["feishu_my_names"],
                onChange: (v) => onField("feishu_my_names", v),
                placeholder: t("feishu.myNamesPh"),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime40.jsxs)("div", {
            className: settings_default.filterRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("button", {
                type: "button",
                className: ui_default.button,
                "data-testid": "lark-login-btn",
                disabled: authBusy,
                onClick: async () => {
                  setAuthBusy(true);
                  setAuthLaunched(false);
                  setAuthError(null);
                  const result = await client.larkLoginStart();
                  if (result.ok && result.data.ok) {
                    setAuthLaunched(true);
                  } else {
                    setAuthError(result.ok ? result.data.note : result.error.message);
                  }
                  setAuthBusy(false);
                },
                children: t("dsh.lark.login"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: testState.busy,
                onClick: async () => {
                  setTestState({ busy: true, identity: null, failed: false });
                  const result = await client.larkTest();
                  setTestState(
                    result.ok
                      ? { busy: false, identity: result.data.identity, failed: false }
                      : { busy: false, identity: null, failed: true },
                  );
                },
                children: t("feishu.test"),
              }),
              authBusy &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  className: ui_default.muted,
                  children: t("testing"),
                }),
              authLaunched &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  "data-testid": "lark-launched",
                  children: t("dsh.lark.launched"),
                }),
              authError !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  className: settings_default.saveFailHint,
                  "data-testid": "lark-launch-failed",
                  children: t("dsh.lark.launchFailed", { reason: authError }),
                }),
              testState.busy &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  className: ui_default.muted,
                  children: t("testing"),
                }),
              testState.identity !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  children: t("feishu.authorized", { name: testState.identity }),
                }),
              testState.failed &&
                /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", {
                  className: settings_default.saveFailHint,
                  children: t("feishu.unauthorized"),
                }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/FeishuSection.tsx
    var import_jsx_runtime41 = require("react/jsx-runtime");
    function matchesEffState(chat, eff) {
      return eff === "all" || chat.effective === eff;
    }
    function matchesPrefState(state, pref) {
      if (pref === "follow") {
        return state === "follow";
      }
      if (pref === "manual") {
        return state !== "follow";
      }
      return true;
    }
    function chatMatchesFilters(chat, q, eff, pref, type) {
      if (q !== "" && !chat.chatName.toLowerCase().includes(q)) {
        return false;
      }
      if (!matchesEffState(chat, eff) || !matchesPrefState(chat.state, pref)) {
        return false;
      }
      return type === "all" || chat.chatType === type;
    }
    function snapshotAgeMin(enabled, lastPoll) {
      const pollMs = Date.parse(lastPoll ?? "");
      if (enabled !== "true" || !Number.isFinite(pollMs)) {
        return null;
      }
      return Math.round((Date.now() - pollMs) / 6e4);
    }
    function staleThresholdMin(interval) {
      return Math.max(5, (2.5 * (Number(interval) || POLL_INTERVAL_SECS[1])) / 60);
    }
    function FeishuSection({ filters, lastPollAt, ...props }) {
      const { draft, onField } = props;
      const t = useT();
      const client = useClient();
      const [chatList, setChatList] = (0, import_react31.useState)(filters);
      const [query, setQuery] = (0, import_react31.useState)("");
      const [effFilter, setEffFilter] = (0, import_react31.useState)("all");
      const [prefFilter, setPrefFilter] = (0, import_react31.useState)("all");
      const [typeFilter, setTypeFilter] = (0, import_react31.useState)("all");
      const counts = {
        total: chatList.length,
        pulling: chatList.filter((c) => c.effective === "pull").length,
        filtered: chatList.filter((c) => c.effective === "filter").length,
        manual: chatList.filter((c) => c.state !== "follow").length,
      };
      const visibleChats = chatList.filter((chat) =>
        chatMatchesFilters(chat, query.trim().toLowerCase(), effFilter, prefFilter, typeFilter),
      );
      function effChip(chat) {
        const srcKey =
          chat.source === "manual"
            ? "feishu.filter.srcManual"
            : chat.source === "follow"
              ? "feishu.filter.srcFollow"
              : "feishu.filter.srcDegraded";
        const base = t(chat.effective === "pull" ? "feishu.filter.effPull" : "feishu.filter.effFilter");
        const src = t(srcKey);
        const title =
          chat.source === "followDegraded"
            ? t("feishu.filter.srcDegradedTitle")
            : chat.source === "manual"
              ? t(chat.state === "always_pull" ? "feishu.filter.prefPullTitle" : "feishu.filter.prefFilterTitle")
              : t("feishu.filter.prefFollowTitle");
        return {
          text: chat.source === "followDegraded" ? `${base} \xB7 ${src} \u26A0` : `${base} \xB7 ${src}`,
          title,
          tone: chat.source === "followDegraded" ? "degraded" : chat.effective === "pull" ? "pull" : "mute",
        };
      }
      async function setFilter(chatId, state) {
        const prev = chatList.find((c) => c.chatId === chatId);
        setChatList((list) => list.map((c) => (c.chatId === chatId ? { ...c, state } : c)));
        const result = await client.filterUpsert({ chatId, state });
        if (result.ok) {
          setChatList((list) => list.map((c) => (c.chatId === chatId ? result.data : c)));
          return;
        }
        const fresh = await client.filterList();
        if (fresh.ok) {
          setChatList(fresh.data.chats);
        } else if (prev !== void 0) {
          setChatList((list) => list.map((c) => (c.chatId === chatId ? prev : c)));
        }
      }
      const [polling, setPolling] = (0, import_react31.useState)(false);
      const [lastPoll, setLastPoll] = (0, import_react31.useState)(lastPollAt ?? null);
      const ageMin = snapshotAgeMin(draft["feishu_enabled"], lastPoll);
      const stale = ageMin !== null && ageMin > staleThresholdMin(draft["feishu_poll_interval"]);
      async function pollNowAndRefresh() {
        setPolling(true);
        await client.pollNow();
        const fresh = await client.filterList();
        if (fresh.ok) {
          setChatList(fresh.data.chats);
          setLastPoll(fresh.data.lastPollAt);
        }
        setPolling(false);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(SectionShell, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(FeishuConnCard, { draft, onField }),
          /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", {
                className: settings_default.cardTitle,
                "data-tip": `${t("feishu.filter.hint")}
${t("feishu.filter.footImmediate")}`,
                children: t("feishu.filter.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", {
                className: settings_default.cardHint,
                "data-testid": "filter-summary",
                children: t("feishu.filter.summary", {
                  total: counts.total,
                  pulling: counts.pulling,
                  filtered: counts.filtered,
                  manual: counts.manual,
                }),
              }),
              ageMin !== null &&
                (stale
                  ? /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", {
                      className: settings_default.filterRow,
                      "data-testid": "filter-stale",
                      role: "alert",
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {
                          style: { flex: 1 },
                          children: t("feishu.filter.staleWarn", { min: ageMin }),
                        }),
                        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("button", {
                          type: "button",
                          className: ui_default.button,
                          disabled: polling,
                          onClick: () => void pollNowAndRefresh(),
                          children: t("feishu.pollNow"),
                        }),
                      ],
                    })
                  : /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", {
                      className: settings_default.cardHint,
                      "data-testid": "filter-snaptime",
                      children: t("feishu.filter.staleOk", { time: (lastPoll ?? "").slice(0, 16).replace("T", " ") }),
                    })),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", {
                className: `${settings_default.filterRow} ${settings_default.filterToolbar}`,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(TextInput, {
                    ariaLabel: t("feishu.filter.searchLabel"),
                    value: query,
                    onChange: setQuery,
                    placeholder: t("feishu.filter.searchPh"),
                    className: settings_default.filterSearch,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(Select, {
                    ariaLabel: t("feishu.filter.chipsLabel"),
                    value: effFilter,
                    className: settings_default.filterSelect,
                    options: [
                      { value: "all", label: t("feishu.filter.fAll", { n: counts.total }) },
                      { value: "pull", label: t("feishu.filter.fPull", { n: counts.pulling }) },
                      { value: "filter", label: t("feishu.filter.fFiltered", { n: counts.filtered }) },
                    ],
                    onChange: (v) => setEffFilter(v),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(Select, {
                    ariaLabel: t("feishu.filter.prefChipsLabel"),
                    value: prefFilter,
                    className: settings_default.filterSelect,
                    options: [
                      { value: "all", label: t("feishu.filter.pAll", { n: counts.total }) },
                      { value: "follow", label: t("feishu.filter.fFollow", { n: counts.total - counts.manual }) },
                      { value: "manual", label: t("feishu.filter.fManual", { n: counts.manual }) },
                    ],
                    onChange: (v) => setPrefFilter(v),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(Select, {
                    ariaLabel: t("feishu.filter.typeChipsLabel"),
                    value: typeFilter,
                    className: settings_default.filterSelect,
                    options: [
                      {
                        value: "all",
                        label: t("feishu.filter.tAll", { n: counts.total }),
                      },
                      {
                        value: "group",
                        label: t("feishu.filter.tGroup", { n: chatList.filter((c) => c.chatType === "group").length }),
                      },
                      {
                        value: "bot",
                        label: t("feishu.filter.tBot", { n: chatList.filter((c) => c.chatType === "bot").length }),
                      },
                    ],
                    onChange: (v) => setTypeFilter(v),
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", {
                className: settings_default.entityList,
                children: visibleChats.map((chat) => {
                  const chip = effChip(chat);
                  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
                    "div",
                    {
                      className: settings_default.filterRow,
                      "data-testid": "filter-row",
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {
                          className: settings_default.filterChatName,
                          children: chat.chatName,
                        }),
                        chat.chatType === "p2p"
                          ? /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("span", {
                              className: ui_default.muted,
                              title: t("dsh.filter.p2pLocked"),
                              children: [t("feishu.filter.prefFollow"), " \xB7 ", t("dsh.filter.p2pLocked")],
                            })
                          : /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(import_jsx_runtime41.Fragment, {
                              children: [
                                /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {
                                  className: `${settings_default.filterEff} ${chip.tone === "pull" ? settings_default.filterEffPull : chip.tone === "mute" ? settings_default.filterEffMute : settings_default.filterEffDegraded}`,
                                  title: chip.title,
                                  "data-testid": "filter-eff",
                                  children: chip.text,
                                }),
                                /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {
                                  className: settings_default.triStateGroup,
                                  role: "group",
                                  "aria-label": `${chat.chatName}\uFF1A${t("feishu.filter.prefGroupLabel", { name: "" })}`,
                                  children: [
                                    ["follow", t("feishu.filter.prefFollow")],
                                    ["always_pull", t("feishu.filter.prefPull")],
                                    ["always_filter", t("feishu.filter.prefFilter")],
                                  ].map(([state, label]) =>
                                    /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
                                      "button",
                                      {
                                        type: "button",
                                        className: settings_default.triStateButton,
                                        "aria-pressed": chat.state === state,
                                        onClick: () => void setFilter(chat.chatId, state),
                                        children: label,
                                      },
                                      state,
                                    ),
                                  ),
                                }),
                              ],
                            }),
                      ],
                    },
                    chat.chatId,
                  );
                }),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/FocusSection.tsx
    var import_jsx_runtime42 = require("react/jsx-runtime");
    function FocusSection(props) {
      const { draft, onField } = props;
      const t = useT();
      const pomoMinutes = POMODORO_MINUTES.map((n) => ({ value: String(n), label: t("focus.minutes", { n }) }));
      const breaks = BREAK_MINUTES.map((n) => ({
        value: String(n),
        label: n === 0 ? t("focus.breakOff") : t("focus.minutes", { n }),
      }));
      const ahead = REMIND_AHEAD_MINUTES.map((n) => ({
        value: String(n),
        label: n === 0 ? t("remind.onTime") : t("remind.aheadN", { n }),
      }));
      const quietHours = quietHourOptions();
      return /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)(SectionShell, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("focus.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Toggle, {
                label: t("focus.enable"),
                checked: draft["pomodoro_enabled"] === "true",
                onChange: (v) => onField("pomodoro_enabled", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Select, {
                label: t("focus.duration"),
                value: draft["pomodoro_minutes"],
                options: pomoMinutes,
                onChange: (v) => onField("pomodoro_minutes", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Select, {
                label: t("focus.break"),
                value: draft["break_minutes"],
                options: breaks,
                onChange: (v) => onField("break_minutes", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Toggle, {
                label: t("focus.notify"),
                checked: draft["pomodoro_notify"] === "true",
                onChange: (v) => onField("pomodoro_notify", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Toggle, {
                label: t("focus.chime"),
                checked: draft["pomodoro_chime"] === "true",
                onChange: (v) => onField("pomodoro_chime", String(v)),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("remind.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Toggle, {
                label: t("remind.enable"),
                checked: draft["notifications_enabled"] === "true",
                onChange: (v) => onField("notifications_enabled", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Select, {
                label: t("remind.ahead"),
                value: draft["remind_ahead_minutes"],
                options: ahead,
                onChange: (v) => onField("remind_ahead_minutes", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Toggle, {
                label: t("remind.quiet"),
                tip: t("remind.quietDesc"),
                checked: draft["quiet_hours_enabled"] === "true",
                onChange: (v) => onField("quiet_hours_enabled", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Select, {
                label: t("remind.quietStart"),
                value: draft["quiet_start"],
                options: quietHours,
                onChange: (v) => onField("quiet_start", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(Select, {
                label: t("remind.quietEnd"),
                value: draft["quiet_end"],
                options: quietHours,
                onChange: (v) => onField("quiet_end", v),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/GeneralSection.tsx
    var import_react35 = require("react");

    // src/client/settings/sections/BackupCard.tsx
    var import_react33 = require("react");

    // src/client/settings/sections/ImportRestoreModals.tsx
    var import_react32 = require("react");
    var import_jsx_runtime43 = require("react/jsx-runtime");
    function pathOfFile(file) {
      return file.path ?? file.name;
    }
    function importPhaseActions(phase, t, readonly, onClose, runImport, openPicker) {
      const actions = [];
      if (phase === "pick") {
        actions.push({ label: t("dsh.import.pickLabel"), onChoose: openPicker, variant: "primary" });
        actions.push({ label: t("cancel"), onChoose: onClose });
      } else if (phase === "validating") {
        actions.push({ label: t("dsh.import.validating"), onChoose: () => void 0, disabled: true });
      } else if (phase === "invalid") {
        actions.push({
          label: t("dsh.import.pickAnother"),
          onChoose: openPicker,
          variant: "primary",
        });
        actions.push({ label: t("cancel"), onChoose: onClose });
      } else if (phase === "confirm") {
        actions.push({ label: t("dsh.import.confirmOk"), onChoose: runImport, variant: "primary", disabled: readonly });
        actions.push({ label: t("cancel"), onChoose: onClose });
      } else if (phase === "running") {
        actions.push({ label: t("dsh.import.running"), onChoose: () => void 0, disabled: true });
      } else if (phase === "done") {
        actions.push({ label: t("dsh.common.close"), onChoose: onClose, variant: "primary" });
      } else {
        actions.push({ label: t("cancel"), onChoose: onClose });
      }
      return actions;
    }
    function countOf(n) {
      return n ?? 0;
    }
    function ImportPhaseBody({ phase, path, summary, reasons, doneText, backupFailReason, onPick }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(import_jsx_runtime43.Fragment, {
        children: [
          phase === "pick" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(import_jsx_runtime43.Fragment, {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", { children: t("dsh.import.pickHint") }),
                /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("button", {
                  type: "button",
                  className: settings_default.importPickButton,
                  onClick: onPick,
                  children: t("dsh.import.pickLabel"),
                }),
              ],
            }),
          phase === "validating" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
              role: "status",
              children: t("dsh.import.validating"),
            }),
          phase === "invalid" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("div", {
              role: "alert",
              children: /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                children: t("dsh.import.invalid", { reasons: reasons.join("\uFF1B") }),
              }),
            }),
          phase === "confirm" &&
            summary !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(import_jsx_runtime43.Fragment, {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                  children: t("dsh.import.confirmBody", { file: summary.backupFile ?? path }),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                  className: settings_default.importCounts,
                  children: t("dsh.import.counts", { n: countOf(summary.counts.tasks) }),
                }),
              ],
            }),
          phase === "running" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", { role: "status", children: t("dsh.import.running") }),
          phase === "done" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
              role: "status",
              "data-testid": "import-done",
              children: doneText,
            }),
          phase === "backupFailed" &&
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
              role: "alert",
              "data-testid": "import-backup-failed",
              children: t("dsh.import.backupFailed", { reason: backupFailReason }),
            }),
        ],
      });
    }
    function ImportConfirmModal({ readonly, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const fileInput = (0, import_react32.useRef)(null);
      const [phase, setPhase] = (0, import_react32.useState)("pick");
      const [path, setPath] = (0, import_react32.useState)("");
      const [summary, setSummary] = (0, import_react32.useState)(null);
      const [reasons, setReasons] = (0, import_react32.useState)([]);
      const [doneText, setDoneText] = (0, import_react32.useState)("");
      const [backupFailReason, setBackupFailReason] = (0, import_react32.useState)("");
      function pickFile(file) {
        if (file === void 0) {
          return;
        }
        const nextPath = pathOfFile(file);
        setPath(nextPath);
        setPhase("validating");
        setReasons([]);
        void client.importValidate({ path: nextPath }).then((result) => {
          if (result.ok) {
            setSummary(result.data.summary);
            setPhase("confirm");
          } else {
            setReasons(result.error.message.split("\uFF1B"));
            setPhase("invalid");
          }
        });
      }
      function runImport() {
        setPhase("running");
        void client.importRun({ path, confirmed: true }).then((result) => {
          if (result.ok) {
            setDoneText(t("dsh.import.done", { n: result.data.result.applied, file: result.data.result.backupId }));
            setPhase("done");
            onChanged();
          } else if (result.error.code === "BACKUP_FAILED") {
            setBackupFailReason(result.error.message);
            setPhase("backupFailed");
          } else {
            setReasons([result.error.message]);
            setPhase("invalid");
          }
        });
      }
      const openPicker = () => fileInput.current?.click();
      const actions = importPhaseActions(phase, t, readonly, onClose, runImport, openPicker);
      return /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(Modal, {
        title: t("dsh.import.title"),
        ariaLabel: t("dsh.import.title"),
        actions,
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", {
          "data-testid": "import-modal",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("input", {
              ref: fileInput,
              type: "file",
              accept: ".json,application/json",
              className: settings_default.hiddenFileInput,
              "aria-label": t("dsh.import.pickLabel"),
              "data-testid": "import-file-input",
              onChange: (event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = "";
              },
            }),
            /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(ImportPhaseBody, {
              phase,
              path,
              summary,
              reasons,
              doneText,
              backupFailReason,
              onPick: openPicker,
            }),
          ],
        }),
      });
    }
    function RestoreConfirmModal({ source, fileName, readonly, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const [phase, setPhase] = (0, import_react32.useState)("confirm");
      const [failReason, setFailReason] = (0, import_react32.useState)("");
      function runRestore() {
        setPhase("running");
        void client.restoreRun({ source, confirmed: true }).then((result) => {
          if (result.ok) {
            setPhase("done");
            onChanged();
          } else if (result.error.code === "DB_SCHEMA_TOO_NEW") {
            setFailReason(result.error.message);
            setPhase("rejected");
          } else {
            setFailReason(result.error.message);
            setPhase("failed");
          }
        });
      }
      const actions = [];
      if (phase === "confirm") {
        actions.push({
          label: t("dsh.restore.confirmOk"),
          onChoose: runRestore,
          variant: "primary",
          disabled: readonly,
        });
        actions.push({ label: t("cancel"), onChoose: onClose });
      } else if (phase === "running") {
        actions.push({ label: t("dsh.restore.running"), onChoose: () => void 0, disabled: true });
      } else if (phase === "rejected") {
        actions.push({ label: t("dsh.restore.confirmOk"), onChoose: () => void 0, disabled: true });
        actions.push({ label: t("cancel"), onChoose: onClose });
      } else if (phase === "done") {
        actions.push({ label: t("dsh.common.close"), onChoose: onClose, variant: "primary" });
      } else {
        actions.push({ label: t("cancel"), onChoose: onClose });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(Modal, {
        title: t("dsh.restore.title"),
        ariaLabel: t("dsh.restore.title"),
        actions,
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", {
          "data-testid": "restore-modal",
          children: [
            phase === "confirm" &&
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                children: t("dsh.restore.confirmBody", { file: fileName }),
              }),
            phase === "running" &&
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                role: "status",
                children: t("dsh.restore.running"),
              }),
            phase === "rejected" &&
              /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", {
                role: "alert",
                "data-testid": "restore-rejected",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", { children: t("dsh.restore.rejected") }),
                  /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                    className: settings_default.importCounts,
                    children: failReason,
                  }),
                ],
              }),
            phase === "done" &&
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                role: "status",
                "data-testid": "restore-done",
                children: t("dsh.restore.done", { file: fileName }),
              }),
            phase === "failed" &&
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("p", {
                role: "alert",
                "data-testid": "restore-failed",
                children: t("dsh.restore.failed", { reason: failReason }),
              }),
          ],
        }),
      });
    }

    // src/client/settings/sections/BackupCard.tsx
    var import_jsx_runtime44 = require("react/jsx-runtime");
    function fmtSize(bytes) {
      if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    function BackupList({ backups, onRestore }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)(import_jsx_runtime44.Fragment, {
        children: [
          backups !== null &&
            backups.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("ul", {
              className: settings_default.entityList,
              "data-testid": "backup-list",
              children: backups.map((b) =>
                /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)(
                  "li",
                  {
                    className: settings_default.entityCard,
                    "data-testid": "backup-row",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { children: b.file }),
                      /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("span", {
                        className: ui_default.muted,
                        children: [new Date(b.createdAt).toLocaleString(), " \xB7 ", fmtSize(b.size)],
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("button", {
                        type: "button",
                        className: ui_default.button,
                        "data-testid": "backup-restore",
                        onClick: () => onRestore(b),
                        children: t("dsh.restore.entry"),
                      }),
                    ],
                  },
                  b.file,
                ),
              ),
            }),
          backups !== null &&
            backups.length === 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("p", {
              className: settings_default.cardHint,
              children: t("backup.empty"),
            }),
        ],
      });
    }
    function BackupCard({ draft, onField, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [backups, setBackups] = (0, import_react33.useState)(null);
      const [backingUp, setBackingUp] = (0, import_react33.useState)(false);
      const [backupMsg, setBackupMsg] = (0, import_react33.useState)("");
      const [restoreSource, setRestoreSource] = (0, import_react33.useState)(null);
      const fileInput = (0, import_react33.useRef)(null);
      (0, import_react33.useEffect)(() => {
        void (async () => {
          const list = await client.backupList();
          if (list.ok) {
            setBackups(list.data.backups);
          }
        })();
      }, [client]);
      async function backupNow() {
        if (backingUp || readonly) {
          return;
        }
        setBackingUp(true);
        setBackupMsg("");
        const result = await client.backupRun();
        setBackingUp(false);
        if (result.ok) {
          setBackupMsg(t("backup.done", { v: result.data.file }));
          setBackups(result.data.files);
        } else {
          setBackupMsg(`\u274C ${result.error.message}`);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("div", {
        className: ui_default.card,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("h4", {
            className: settings_default.cardTitle,
            children: t("backup.title"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(Toggle, {
            label: t("backup.enable"),
            tip: t("backup.enableDesc"),
            checked: draft["backup_enabled"] === "true",
            onChange: (v) => onField("backup_enabled", String(v)),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("div", {
            className: settings_default.filterRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { children: t("backup.keep") }),
              /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(Select, {
                ariaLabel: t("backup.keep"),
                value: draft["backup_keep"],
                options: [3, 7, 14, 30].map((n) => ({ value: String(n), label: t("backup.keepN", { n }) })),
                onChange: (v) => onField("backup_keep", v),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: backingUp || readonly,
                "data-testid": "backup-now",
                onClick: () => void backupNow(),
                children: backingUp ? t("backup.working") : t("backup.now"),
              }),
              backupMsg !== "" &&
                /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", {
                  className: ui_default.muted,
                  "data-testid": "backup-msg",
                  children: backupMsg,
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(BackupList, {
            backups,
            onRestore: (b) => setRestoreSource({ backupId: b.file, file: b.file }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("input", {
            ref: fileInput,
            type: "file",
            accept: ".db",
            className: settings_default.hiddenFileInput,
            "aria-label": t("dsh.restore.fromFile"),
            "data-testid": "restore-file-input",
            onChange: (event) => {
              const file = event.target.files?.[0];
              if (file !== void 0) {
                setRestoreSource({ path: file.path ?? file.name, file: file.name });
              }
              event.target.value = "";
            },
          }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("div", {
            className: settings_default.filterRow,
            children: /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("button", {
              type: "button",
              className: ui_default.button,
              "data-testid": "restore-from-file",
              disabled: readonly,
              onClick: () => fileInput.current?.click(),
              children: t("dsh.restore.fromFile"),
            }),
          }),
          restoreSource !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(RestoreConfirmModal, {
              source: restoreSource,
              fileName: restoreSource.file,
              readonly: false,
              onClose: () => setRestoreSource(null),
              onChanged: () => {
                onChanged();
                void client.backupList().then((list) => {
                  if (list.ok) {
                    setBackups(list.data.backups);
                  }
                });
              },
            }),
        ],
      });
    }

    // src/client/settings/sections/ExportCard.tsx
    var import_react34 = require("react");
    var import_jsx_runtime45 = require("react/jsx-runtime");
    function ExportCard({ readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [exporting, setExporting] = (0, import_react34.useState)(false);
      const [exportMsg, setExportMsg] = (0, import_react34.useState)("");
      const [importOpen, setImportOpen] = (0, import_react34.useState)(false);
      async function runExport(kind) {
        if (exporting || readonly) {
          return;
        }
        setExporting(true);
        setExportMsg("");
        const result = await client.exportRun({ kind });
        setExporting(false);
        if (result.ok) {
          setExportMsg(t("export.savedTo", { v: result.data.path }));
        } else {
          setExportMsg(`\u274C ${result.error.message}`);
        }
      }
      async function openExportDir() {
        setExportMsg("");
        const result = await client.exportDirOpen();
        if (!result.ok) {
          setExportMsg(t("dsh.export.dirOpenFailed", { reason: result.error.message, path: result.error.hint ?? "" }));
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", {
        className: ui_default.card,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("h4", {
            className: settings_default.cardTitle,
            "data-tip": t("export.hint"),
            children: t("export.title"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", {
            className: settings_default.filterRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: exporting || readonly,
                "data-testid": "export-json",
                onClick: () => void runExport("json"),
                children: t("export.json"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: exporting || readonly,
                "data-testid": "export-csv",
                onClick: () => void runExport("csv"),
                children: t("export.csv"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: exporting || readonly,
                "data-testid": "export-report",
                onClick: () => void runExport("report"),
                children: t("export.md"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("button", {
                type: "button",
                className: ui_default.button,
                "data-testid": "import-json",
                disabled: readonly,
                onClick: () => setImportOpen(true),
                children: t("dsh.import.entry"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("button", {
                type: "button",
                className: ui_default.button,
                "data-testid": "export-dir-open",
                onClick: () => void openExportDir(),
                children: t("dsh.export.dirOpen"),
              }),
              exportMsg !== "" &&
                /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", {
                  className: ui_default.muted,
                  "data-testid": "export-msg",
                  role: exportMsg.startsWith("\u274C") ? "alert" : void 0,
                  children: exportMsg,
                }),
            ],
          }),
          importOpen &&
            /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(ImportConfirmModal, {
              readonly,
              onClose: () => setImportOpen(false),
              onChanged,
            }),
        ],
      });
    }

    // src/client/settings/sections/GeneralSection.tsx
    var import_jsx_runtime46 = require("react/jsx-runtime");
    var USER_GUIDE_URL =
      "https://github.com/Jo0OCTsai/pokemon-choose-you/blob/main/docs/USER_GUIDE.md#dsh-%E6%8F%92%E4%BB%B6%E5%BD%A2%E6%80%81%E7%AC%AC%E4%BA%8C%E5%BD%A2%E6%80%81";
    function GeneralSection(props) {
      const { draft, onField, onChanged } = props;
      const notifyChanged = onChanged ?? (() => void 0);
      const t = useT();
      const client = useClient();
      const [dbStatus, setDbStatus] = (0, import_react35.useState)(null);
      const readonly = dbStatus?.mode === "ro";
      (0, import_react35.useEffect)(() => {
        void (async () => {
          const status = await client.dbStatus();
          if (status.ok) {
            setDbStatus(status.data);
          }
        })();
      }, [client]);
      return /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)(SectionShell, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("reviewCfg.title"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(Toggle, {
                label: t("reviewCfg.enable"),
                tip: t("reviewCfg.enableDesc"),
                checked: draft["review_enabled"] === "true",
                onChange: (v) => onField("review_enabled", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(Select, {
                label: t("reviewCfg.dow"),
                value: draft["review_dow"],
                options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: t(`reviewDow.${n}`) })),
                onChange: (v) => onField("review_dow", v),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(BackupCard, {
            draft,
            onField,
            readonly,
            onChanged: notifyChanged,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(ExportCard, { readonly, onChanged: notifyChanged }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("div", {
            className: ui_default.card,
            children: /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(Toggle, {
              label: t("general.closeToTray"),
              tip: t("general.closeToTrayDesc"),
              checked: draft["close_to_tray"] === "true",
              onChange: (v) => onField("close_to_tray", String(v)),
              badge: t("dsh.badge.mainApp"),
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("dsh.settings.dualFormTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("p", {
                className: settings_default.dualFormTip,
                children: t("dsh.settings.dualFormTip"),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("dsh.settings.dbStatusTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("div", {
                className: settings_default.filterRow,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    onClick: async () => {
                      const result = await client.dbStatus();
                      if (result.ok) {
                        setDbStatus(result.data);
                      }
                    },
                    children: t("dsh.settings.dbStatusQuery"),
                  }),
                  dbStatus !== null &&
                    /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("span", {
                      className: ui_default.muted,
                      children: t("dsh.settings.dbUserVersion", {
                        v: dbStatus.userVersion,
                        mode: dbStatus.mode === "ro" ? t("dsh.settings.dbModeRo") : t("dsh.settings.dbModeRw"),
                      }),
                    }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("dsh.settings.guideTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime46.jsx)("a", {
                className: settings_default.guideLink,
                href: USER_GUIDE_URL,
                target: "_blank",
                rel: "noopener noreferrer",
                "data-testid": "guide-link",
                children: t("dsh.settings.guideLink"),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/sections/PetSection.tsx
    var import_react36 = require("react");

    // src/client/settings/sections/AxPermHint.tsx
    var import_jsx_runtime47 = require("react/jsx-runtime");
    function isMacPlatform() {
      if (typeof navigator === "undefined") {
        return false;
      }
      const platform = navigator.platform ?? "";
      return platform.toLowerCase().includes("mac") || /Macintosh/.test(navigator.userAgent ?? "");
    }
    function AxPermHint({ granted, revoked, helperPath, onAuthorize }) {
      const t = useT();
      if (granted) {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime47.jsxs)("div", {
        className: settings_default.axPermHint,
        "data-testid": "ax-perm-hint",
        children: [
          revoked &&
            /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("p", {
              className: settings_default.axPermRevoked,
              role: "alert",
              "data-testid": "ax-perm-revoked",
              children: t("dsh.ax.revoked"),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("p", { children: t("dsh.ax.guide") }),
          /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("p", {
            className: settings_default.axPermPathRow,
            children: /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("button", {
              type: "button",
              className: settings_default.axPermPath,
              title: t("dsh.ax.copyPath"),
              onClick: () => {
                void navigator.clipboard?.writeText(helperPath).catch(() => void 0);
              },
              children: helperPath,
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("p", {
            className: settings_default.axPermPathHint,
            children: t("dsh.ax.pathHint", { path: helperPath }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("button", {
            type: "button",
            className: ui_default.buttonDex,
            onClick: onAuthorize,
            children: t("dsh.ax.authorize"),
          }),
        ],
      });
    }

    // src/client/settings/sections/PetSection.tsx
    var import_jsx_runtime48 = require("react/jsx-runtime");
    function usePokemonCatalog(locale) {
      return (0, import_react36.useMemo)(
        () => ({ pokemonName: createPokemonName(locale), pokemonSearch: createPokemonSearch(locale) }),
        [locale],
      );
    }
    function parseQuotes(raw) {
      try {
        const map = JSON.parse(raw || "{}");
        return typeof map === "object" && map !== null ? map : {};
      } catch {
        return {};
      }
    }
    var DEFAULT_QUOTE_POKEMON = "pikachu";
    function PetSection({ data, ...props }) {
      const { draft, onField } = props;
      const t = useT();
      const client = useClient();
      const { locale } = useI18n();
      const { pokemonName, pokemonSearch: localPokemonSearch } = usePokemonCatalog(locale);
      const pokemonSearch = data.pokemonSearch ?? localPokemonSearch;
      const [quotePokemon, setQuotePokemon] = (0, import_react36.useState)(
        draft["main_pokemon"] || DEFAULT_QUOTE_POKEMON,
      );
      const [showWarn, setShowWarn] = (0, import_react36.useState)(null);
      const [petRunning, setPetRunning] = (0, import_react36.useState)(null);
      const refreshPetStatus = (0, import_react36.useCallback)(() => {
        void client.petStatus().then((r) => {
          if (r.ok) {
            setPetRunning(r.data.running);
          }
        });
      }, [client]);
      (0, import_react36.useEffect)(() => {
        refreshPetStatus();
      }, [refreshPetStatus]);
      const mainKey = draft["main_pokemon"];
      const quotesMap = parseQuotes(draft["pokemon_quotes"]);
      const quoteText = quotesMap[quotePokemon] ?? "";
      const mac = isMacPlatform();
      const inputResponseOn = draft["pet_input_response"] === "true";
      const [axGranted, setAxGranted] = (0, import_react36.useState)(null);
      const [helperPath, setHelperPath] = (0, import_react36.useState)("");
      const refreshAx = (0, import_react36.useCallback)(() => {
        if (!mac) {
          return;
        }
        void client.macAuthorizationStatus({ kind: "accessibility" }).then((result) => {
          if (result.ok) {
            setAxGranted(result.data.granted);
            setHelperPath(result.data.helperPath);
          }
        });
      }, [client, mac]);
      (0, import_react36.useEffect)(() => {
        refreshAx();
        window.addEventListener("focus", refreshAx);
        return () => {
          window.removeEventListener("focus", refreshAx);
        };
      }, [refreshAx]);
      function writeQuotes(key, text) {
        const map = { ...parseQuotes(draft["pokemon_quotes"]) };
        const trimmed = text.trim();
        if (trimmed !== "") {
          map[key] = trimmed;
        } else {
          delete map[key];
        }
        onField("pokemon_quotes", JSON.stringify(map));
      }
      async function showPet() {
        const result = await client.petShow();
        const ready = result.ok ? result.data.ready : void 0;
        setShowWarn(ready === false ? t("dsh.pet.showNotReady") : null);
        refreshPetStatus();
      }
      return /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)(SectionShell, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("cats.mainTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
                className: settings_default.filterRow,
                "data-testid": "main-pokemon-row",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("span", {
                    style: { flex: 1 },
                    "data-tip": t("cats.mainDesc"),
                    children: [
                      t("cats.mainLabel"),
                      "\uFF1A",
                      mainKey === "" ? t("cats.mainFollow") : pokemonName(mainKey),
                    ],
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(PokemonPicker, {
                    value: mainKey,
                    onPick: (key) => onField("main_pokemon", key),
                    search: pokemonSearch,
                    nameOf: pokemonName,
                    allowEmptyLabel: t("cats.mainFollow"),
                    ariaLabel: t("cats.mainLabel"),
                  }),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("h4", {
                className: settings_default.cardTitle,
                children: t("cats.quotesTitle"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
                className: settings_default.filterRow,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(PokemonPicker, {
                    value: quotePokemon,
                    onPick: setQuotePokemon,
                    search: pokemonSearch,
                    nameOf: pokemonName,
                    ariaLabel: t("cats.quotesTitle"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("span", {
                    className: settings_default.dimCount,
                    children: t("cats.quotesCount", {
                      n: quoteText.split("\n").filter((l) => l.trim() !== "").length,
                    }),
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("textarea", {
                className: settings_default.entityDescInput,
                rows: 4,
                "aria-label": t("cats.quotesTitle"),
                value: quoteText,
                placeholder: t("cats.quotesPh"),
                onChange: (event) => writeQuotes(quotePokemon, event.target.value),
              }),
            ],
          }),
          mac &&
            /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
              className: ui_default.card,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("h4", {
                  className: settings_default.cardTitle,
                  children: t("focus.petTitle"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(Toggle, {
                  label: t("focus.petInput"),
                  tip: t("focus.petInputDesc"),
                  checked: inputResponseOn,
                  onChange: (v) => onField("pet_input_response", String(v)),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(Toggle, {
                  label: t("focus.petInputWorking"),
                  tip: t("focus.petInputWorkingDesc"),
                  checked: draft["pet_input_response_working"] === "true",
                  onChange: (v) => onField("pet_input_response_working", String(v)),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(AxPermHint, {
                  granted: axGranted === true,
                  revoked: inputResponseOn && axGranted === false,
                  helperPath,
                  onAuthorize: () => {
                    void client.macAuthPaneOpen().then(refreshAx);
                  },
                }),
              ],
            }),
          /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(Toggle, {
                label: t("focus.petVoice"),
                tip: t("focus.petVoiceDesc"),
                checked: draft["pet_voice"] === "true",
                onChange: (v) => onField("pet_voice", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(Toggle, {
                label: t("focus.petMate"),
                tip: t("focus.petMateDesc"),
                checked: draft["pet_mate"] === "true",
                onChange: (v) => onField("pet_mate", String(v)),
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
            className: ui_default.card,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(Toggle, {
                label: t("display.reduceMotion"),
                tip: t("display.reduceMotionDesc"),
                checked: draft["reduce_motion"] === "true",
                onChange: (v) => onField("reduce_motion", String(v)),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", {
                className: settings_default.filterRow,
                "data-testid": "pet-show-row",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("span", {
                    style: { flex: 1 },
                    children: t("dsh.pet.showRow"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("span", {
                    "data-testid": "pet-show-state",
                    children: [
                      t("dsh.pet.stateLabel"),
                      t(
                        petRunning === null
                          ? "dsh.pet.stateUnknown"
                          : petRunning
                            ? "dsh.pet.stateShown"
                            : "dsh.pet.stateHidden",
                      ),
                    ],
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    "aria-label": t("dsh.pet.showRow"),
                    onClick: () => void showPet(),
                    children: t("dsh.pet.show"),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("button", {
                    type: "button",
                    className: ui_default.button,
                    "aria-label": t("pet.menuHide"),
                    onClick: () => {
                      setShowWarn(null);
                      void client.petHide().then(refreshPetStatus);
                    },
                    children: t("dsh.pet.hide"),
                  }),
                ],
              }),
              showWarn !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("p", {
                  className: settings_default.saveFailHint,
                  role: "alert",
                  "data-testid": "pet-show-warn",
                  children: showWarn,
                }),
            ],
          }),
        ],
      });
    }

    // src/client/settings/SettingsSegment.tsx
    var import_jsx_runtime49 = require("react/jsx-runtime");
    var SECTION_KEY_SETS = {
      focus: FOCUS_KEYS,
      taxonomy: [],
      pets: PET_KEYS,
      display: DISPLAY_KEYS,
      agents: AGENT_KEYS,
      feishu: FEISHU_KEYS,
      diag: [],
      general: GENERAL_KEYS,
    };
    function sectionSaveBlocker(section, draft, t) {
      const quietClash =
        section === "focus" &&
        draft["quiet_hours_enabled"] === "true" &&
        draft["quiet_start"] !== "" &&
        draft["quiet_start"] === draft["quiet_end"];
      if (!quietClash) {
        return {};
      }
      return { saveBlocked: true, blockedReason: t("dsh.settings.saveFailed", { reason: t("remind.quiet") }) };
    }
    function SettingsSegment({
      data,
      onChanged,
      leaveRequest,
      onLeaveResolved,
      onUnsavedChange,
      onLocalePreview,
      initialSection = "focus",
    }) {
      const t = useT();
      const [section, setSection] = (0, import_react37.useState)(initialSection);
      const initialConfig = (0, import_react37.useMemo)(() => {
        const normalized = {};
        for (const key of DRAFT_KEYS) {
          normalized[key] = data.config[key] ?? "";
        }
        return normalizeSettingValues(normalized);
      }, [data.config]);
      const [draft, setDraft] = (0, import_react37.useState)(initialConfig);
      const [saved, setSaved] = (0, import_react37.useState)(initialConfig);
      const bodyRef = (0, import_react37.useRef)(null);
      (0, import_react37.useEffect)(() => {
        bodyRef.current?.scrollTo({ top: 0 });
      }, [section]);
      const onField = (0, import_react37.useCallback)((key, value) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
      }, []);
      const onSavedKeys = (0, import_react37.useCallback)((keys, values) => {
        setSaved((prev) => {
          const next = { ...prev };
          for (const key of keys) {
            next[key] = values[key];
          }
          return next;
        });
      }, []);
      const dirtyKeys = (0, import_react37.useMemo)(
        () => DRAFT_KEYS.filter((key) => draft[key] !== saved[key]),
        [draft, saved],
      );
      const anyDirty = dirtyKeys.length > 0;
      const dirtySections = (0, import_react37.useMemo)(
        () => dirtySectionSet(draft, saved, SECTION_KEY_SETS),
        [draft, saved],
      );
      (0, import_react37.useEffect)(() => {
        onUnsavedChange(anyDirty);
      }, [anyDirty, onUnsavedChange]);
      const sectionProps = { draft, saved, onField, onSavedKeys };
      const taxonomy = { dimensions: data.dimensions ?? [], tags: data.tags ?? [] };
      const agents = data.agents ?? [];
      const promptSpecs = data.promptSpecs ?? [];
      const filters = data.filters ?? [];
      function renderSection(key) {
        switch (key) {
          case "focus":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(FocusSection, { ...sectionProps });
          case "taxonomy":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(CategoryTagSection, {
              categories: data.categories,
              dimensions: taxonomy.dimensions,
              tags: taxonomy.tags,
              routes: data.routes,
              pokemonSearch: data.pokemonSearch,
              onChanged,
            });
          case "pets":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(PetSection, { ...sectionProps, data });
          case "display":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(DisplaySection, { ...sectionProps, onLocalePreview });
          case "agents":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(AgentSection, {
              ...sectionProps,
              agents,
              routes: data.routes,
              tags: taxonomy.tags,
              promptSpecs,
              onChanged,
            });
          case "feishu":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(FeishuSection, {
              ...sectionProps,
              filters,
              lastPollAt: data.filterLastPollAt ?? null,
            });
          case "diag":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(DiagnosticsSection, {});
          case "general":
            return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(GeneralSection, { ...sectionProps, onChanged });
          default:
            return null;
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)("div", {
        className: settings_default.settingsSegment,
        "data-testid": "segment-settings",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)("div", {
            className: settings_default.settingsHeadRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(SectionNav, {
                active: section,
                onChange: setSection,
                dirtySections,
              }),
              SECTION_KEY_SETS[section].length > 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(SaveControls, {
                  keys: SECTION_KEY_SETS[section],
                  draft,
                  saved,
                  onSavedKeys,
                  ...sectionSaveBlocker(section, draft, t),
                }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", {
            ref: bodyRef,
            className: settings_default.settingsBody,
            children: SECTION_KEYS.map((key) =>
              /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(
                "div",
                { hidden: section !== key, "data-section-wrap": key, children: renderSection(key) },
                key,
              ),
            ),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(LeaveGuardDialog, {
            leaveRequest,
            anyDirty,
            draft,
            dirtyKeys,
            onSavedKeys,
            onChanged,
            onLeaveResolved,
            onDiscard: () => setDraft(saved),
          }),
        ],
      });
    }
    function LeaveGuardDialog({
      leaveRequest,
      anyDirty,
      draft,
      dirtyKeys,
      onSavedKeys,
      onChanged,
      onLeaveResolved,
      onDiscard,
    }) {
      const client = useClient();
      if (leaveRequest === null || !anyDirty) {
        return null;
      }
      async function saveAndLeave() {
        if (dirtyKeys.length === 0) {
          onLeaveResolved(true);
          return;
        }
        const keyValues = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
        const result = await client.configWrite({ keyValues });
        if (result.ok) {
          onSavedKeys([...dirtyKeys], draft);
          onChanged();
          onLeaveResolved(true);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(UnsavedLeaveDialog, {
        onSaveLeave: () => void saveAndLeave(),
        onDiscard: () => {
          onDiscard();
          onLeaveResolved(true);
        },
        onStay: () => {
          onLeaveResolved(false);
        },
      });
    }

    // src/client/tasks/TaskDetailDrawer.tsx
    var import_react44 = require("react");

    // src/client/tasks/DispatchOps.tsx
    var import_react38 = require("react");

    // src/client/tasks/tasks.module.css
    var css6 =
      '/* \u4EFB\u52A1\u5206\u6BB5\u6837\u5F0F\uFF08scoped\uFF09\uFF1A\u7CBE\u7075\u6761\u76EE\u5361\u4E3A\u9762\u677F signature\uFF08\u5BBF\u4E3B\u5217\u8868\u884C\u5BB9\u5668 + pixelated \u7CBE\u7075\uFF09 */\n\n.rvpBRw_segmentWrap {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n/* \u5192\u9669\u6BB5\u65E5\u671F\u4E0E CAUGHT \u8FDB\u5EA6\u6761\u6837\u5F0F\u5DF2\u968F\u9875\u5934\u79FB\u5165 app.rvpBRw_module.rvpBRw_css\uFF08PageHeader\uFF0C\u684C\u9762 today \u9875\u5934\u540C\u4F4D\uFF09 */\n\n/* OverdueFold */\n.rvpBRw_overdueFold {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 10px;\n  border-radius: 8px;\n  border: 1px dashed var(--dsw-alias-border-l3, #c7cdd4);\n  background: var(--dsw-alias-bg-layer-1, #f8f9fb);\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n}\n.rvpBRw_overdueList {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 4px 0 0 12px;\n}\n\n/* \u7CBE\u7075\u6761\u76EE\u5361\uFF08\u9762\u677F signature\uFF0C\u539F\u578B tcard\uFF1A\u5BBF\u4E3B\u5BB9\u5668 + pixelated \u7CBE\u7075 + No.rvpBRw_xxx + \u5C5E\u6027\u5FBD\u7AE0\uFF09\n   box-sizing \u663E\u5F0F\u58F0\u660E\u2014\u2014dsw \u5BBF\u4E3B\u65E0\u5168\u5C40\u590D\u4F4D\uFF0Cwidth:100% + padding/border \u4E0D\u6536\u53E3\u4F1A\u53F3\u6EA2\u51FA */\n.rvpBRw_taskCard {\n  position: relative;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 12px;\n  border-radius: 12px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  cursor: pointer;\n  text-align: left;\n  width: 100%;\n  min-height: 44px;\n  font-size: 13px;\n  color: inherit;\n}\n/* \u60AC\u505C = \u684C\u9762\u552F\u4E00\u60AC\u505C\u9EC4\uFF08specs/dsh-plugin-style T1#5\uFF09+ \u91CD\u58A8\u7EBF */\n.rvpBRw_taskCard:hover {\n  background: var(--pcy-hover, #fff3c4);\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_taskCard:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n/* \u4E94\u5448\u73B0\uFF08\u5F62\u4E0E\u8272\u627F\u8F7D\u72B6\u6001\uFF0C\u4E0D\u95EA\u70C1\uFF09 */\n.rvpBRw_taskCard[data-presentation="active"] {\n  border: 2px solid var(--pcy-running, #ffcb05);\n}\n/* \u8FDB\u884C\u4E2D\xB7\u6682\u505C\u53D8\u4F53\uFF1A\u7070\u63CF\u8FB9\uFF1B\u5361\u9762\u5185\u5BB9\u4E0D\u6DE1\u5316\u4E0D\u964D\u9971\u548C\uFF08\u684C\u9762\u6682\u505C\u5361 = \u666E\u901A\u5361 + \u5B9E\u8272 tag-paused\uFF0C\n * \u900F\u660E\u53E0\u52A0\u4F1A\u8BA9\u72B6\u6001\u6807\u8BB0\u770B\u8D77\u6765\u300C\u534A\u900F\u660E\u300D\u2014\u2014\u4E0E\u6355\u83B7\u4E2D\u4FDD\u6301\u540C\u7B49\u5B9E\u8272\u5448\u73B0\uFF09 */\n.rvpBRw_taskCard[data-presentation="activePaused"] {\n  border: 2px solid var(--dsw-alias-border-l3, #c7cdd4);\n}\n/* \u5DF2\u6355\u6349 = LCD \u5316\uFF08specs/dsh-plugin-style T2#14\uFF1A\u5B8C\u6210 = \u6293\u5230\u56FE\u9274\uFF0C\u5361\u9762\u53D8\u5C4F\uFF1B\n * \u8F85\u52A9\u884C\u8D70 lcd-text \u5B9E\u8272\u4E0D\u7528\u900F\u660E\u5EA6\u2014\u2014\u900F\u660E\u53E0\u52A0\u4F1A\u8DCC\u7834 4.5:1\uFF09 */\n.rvpBRw_taskCard[data-presentation="done"] {\n  background: var(--pcy-lcd, #c4cfa1);\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  box-shadow: inset 2px 2px 0 var(--pcy-lcd-dark, #9caa86);\n}\n.rvpBRw_taskCard[data-presentation="done"]:hover {\n  background: var(--pcy-lcd, #c4cfa1);\n}\n.rvpBRw_taskCard[data-presentation="done"] .rvpBRw_taskTitle {\n  text-decoration: line-through;\n  color: var(--pcy-lcd-text, #3a4a32);\n}\n.rvpBRw_taskCard[data-presentation="done"] .rvpBRw_taskNo,\n.rvpBRw_taskCard[data-presentation="done"] .rvpBRw_taskMeta,\n.rvpBRw_taskCard[data-presentation="done"] .rvpBRw_catchMark {\n  color: var(--pcy-lcd-text, #3a4a32);\n}\n/* LCD/\u9003\u8D70\u5361\u4E0A\u7CBE\u7075\u53EA\u7559\u7070\u5EA6\u526A\u5F71\uFF08\u88F8\u56FE\u65E0\u6846\uFF0C\u65E0\u9700\u6846\u9000\u573A\u8986\u76D6\uFF09 */\n.rvpBRw_taskCard[data-presentation="done"] .rvpBRw_taskSprite,\n.rvpBRw_taskCard[data-presentation="escaped"] .rvpBRw_taskSprite {\n  filter: grayscale(1);\n  opacity: 0.55;\n}\n/* \u5DF2\u9003\u8D70 = \u684C\u9762\u9003\u9038\u6001\u540C\u6E90\u7EB8\u7070\uFF08specs/dsh-plugin-style \xA74 --pcy-paper-dim\uFF09\uFF1B\n * \u6574\u5361 opacity 0.6 \u4E3A\u65E2\u6709\u8C41\u514D\uFF08\u4E2D\u6027\u5448\u73B0\u3001\u4E0D\u50AC\u6E05\u96F6\uFF0C\u22484.0:1 \u8BB0\u5165 docs/debt.rvpBRw_md\uFF09 */\n.rvpBRw_taskCard[data-presentation="escaped"] {\n  background: var(--pcy-paper-dim, #f3efe6);\n  opacity: 0.6;\n}\n.rvpBRw_taskCard[data-presentation="escaped"]:hover {\n  background: var(--pcy-paper-dim, #f3efe6);\n}\n/* \u8FDB\u884C\u4E2D\u60AC\u6D6E\u6807\u7B7E\uFF08\u5361\u9876\u9A91\u7F1D pill\uFF0C\u539F\u578B running-tag\uFF1B\u6682\u505C\u53D8\u4F53\u7070\uFF09\u3002\n   \u6587\u5B57/\u63CF\u8FB9\u7528\u56FA\u5B9A\u58A8\u8272\uFF08DESIGN_SYSTEM --dex-navy\uFF09\u2014\u2014alias label \u5728\u6697\u4E3B\u9898\u7FFB\u8F6C\u4E3A\u6D45\u8272\uFF0C\n   \u9EC4\u5E95\u6D45\u5B57\u5BF9\u6BD4\u5EA6\u4E0D\u8DB3\uFF08U7 scoped \u56FA\u5B9A\u8272\u53E3\u5F84\uFF09 */\n.rvpBRw_runningTag {\n  position: absolute;\n  top: -9px;\n  left: 12px;\n  font-size: 10px;\n  font-weight: 700;\n  line-height: 1.4;\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  border: 1px solid #1a1b25;\n  border-radius: 999px;\n  padding: 0 8px;\n}\n/* \u6682\u505C\u53D8\u4F53\uFF1A\u684C\u9762 .rvpBRw_tag-paused \u540C\u6E90\uFF08warn-soft \u5B9E\u8272\u5E95 + warn-ink \u5B57\uFF09\uFF0C\u58A8\u7EBF\u63CF\u8FB9\u6CBF\u7528\u57FA\u7C7B\u2014\u2014\n * \u4E0E\u6355\u83B7\u4E2D\u540C\u4E3A\u5B9E\u8272 pill\uFF0C\u4EC5\u914D\u8272\u4E0E \u23F8 \u5B57\u5F62\u533A\u5206 */\n.rvpBRw_taskCard[data-presentation="activePaused"] .rvpBRw_runningTag {\n  background: var(--pcy-warn-soft, #fff3cd);\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n/* \u7B49\u5BBD\u56FE\u9274\u7F16\u53F7\uFF08U6\uFF1A\u9762\u677F\u4E0D\u52A0\u8F7D\u50CF\u7D20\u5B57\u4F53\uFF0C\u7B49\u5BBD\u5B57\u4F53\u627F\u8F7D\u7F16\u53F7\uFF1B\u5B57\u8DDD = \u4E1D\u5370\u611F\uFF09 */\n.rvpBRw_taskNo {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 10px;\n  letter-spacing: 1px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  flex: none;\n}\n/* \u7CBE\u7075\u56FE\uFF08specs/dsh-plugin-style T1#10 \u56DE\u6D41\uFF1A\u4EFB\u52A1\u5361\u7CBE\u7075\u88F8\u56FE\uFF0C\u65E0\u6846\u65E0\u5E95\uFF1B\u5360\u4F4D\u70B9\u4ECD\u9700\u5C3A\u5BF8\u951A\u5B9A\uFF09 */\n.rvpBRw_taskSprite {\n  width: 30px;\n  height: 30px;\n  image-rendering: pixelated;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 16px;\n  flex: none;\n}\n.rvpBRw_taskMain {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n.rvpBRw_taskTitle {\n  font-weight: 700;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.rvpBRw_taskMeta {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  flex-wrap: wrap;\n}\n/* \u5C5E\u6027\u5FBD\u7AE0\uFF08DESIGN_SYSTEM \u5206\u7C7B\u8272\u56FA\u5B9A\u5E95 + navy \u5B57\uFF1B\u6697\u4E3B\u9898 1px \u63CF\u8FB9\u515C\u5E95\u5BF9\u6BD4\u2014\u2014U7\uFF09 */\n.rvpBRw_typeBadge {\n  font-size: 10px;\n  font-weight: 700;\n  color: #1a1b25;\n  border-radius: 4px;\n  padding: 0 7px;\n  line-height: 16px;\n  border: 1px solid rgba(26, 27, 37, 0.35);\n  background: var(--pcy-type-neutral, var(--dsw-alias-border-l1, #e3e7ec));\n  flex: none;\n}\n.rvpBRw_typeBadge[data-type="work"] {\n  background: var(--pcy-type-work, #f8d030);\n}\n.rvpBRw_typeBadge[data-type="study"] {\n  background: var(--pcy-type-study, #6890f0);\n}\n.rvpBRw_typeBadge[data-type="life"] {\n  background: var(--pcy-type-life, #78c850);\n}\n.rvpBRw_typeBadge[data-type="health"] {\n  background: var(--pcy-type-health, #a8a878);\n}\n.rvpBRw_typeBadge[data-type="interest"] {\n  background: var(--pcy-type-interest, #ee99ac);\n}\n/* \u4F18\u5148\u7EA7\u56DB\u70B9\uFF08\u7D27\u6025\u6863\u653E\u5927\u70B9 + \u53CC\u63CF\u8FB9\uFF0C\u4E0D\u95EA\u70C1\uFF09 */\n.rvpBRw_prioDot {\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  flex: none;\n  border: 1px solid rgba(26, 27, 37, 0.35);\n}\n.rvpBRw_prioDot[data-prio="urgent"] {\n  width: 12px;\n  height: 12px;\n  box-shadow:\n    0 0 0 2px var(--dsw-alias-bg-layer-1, #fff),\n    0 0 0 3.5px var(--pcy-danger, #ee1515);\n  background: var(--pcy-danger, #ee1515);\n}\n.rvpBRw_prioDot[data-prio="high"] {\n  background: var(--pcy-prio-high, #f08030);\n}\n.rvpBRw_prioDot[data-prio="normal"] {\n  background: var(--pcy-type-life, #78c850);\n}\n.rvpBRw_prioDot[data-prio="low"] {\n  background: var(--pcy-type-health, #a8a878);\n}\n/* \u6D3E\u53D1\u5FBD\u6807\u4E94\u6001\uFF08\u5F62 + \u6587\u5B57\u6807\u7B7E + \u8F6F\u5E95\uFF0C\u975E\u989C\u8272\u5197\u4F59\uFF09\uFF1B\u56FA\u5B9A\u8F6F\u5E95\u52A0 1px \u58A8\u63CF\u8FB9\u515C\u5E95\u6697\u4E3B\u9898\u5C0F\u56FE\u5F62\u5BF9\u6BD4\uFF08U7\uFF09 */\n.rvpBRw_dispatchBadge {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  font-size: 10px;\n  font-weight: 700;\n  border-radius: 4px;\n  padding: 0 6px;\n  line-height: 16px;\n  flex: none;\n  border: 1px solid rgba(26, 27, 37, 0.2);\n}\n.rvpBRw_dispatchGlyph {\n  font-size: 10px;\n}\n.rvpBRw_dispatchBadge[data-state="queued"] {\n  background: var(--pcy-conf-mid-soft, #fff3d6);\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n.rvpBRw_dispatchBadge[data-state="running"] {\n  background: var(--pcy-ok-soft, #dff3e4);\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n.rvpBRw_dispatchBadge[data-state="done"] {\n  background: var(--pcy-conf-low-soft, #eceada);\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_dispatchBadge[data-state="failed"] {\n  background: var(--pcy-fail-soft, #fde8e8);\n  color: var(--pcy-fail-ink, #991b1b);\n}\n.rvpBRw_quickOps {\n  display: flex;\n  gap: 4px;\n  flex: none;\n  align-items: center;\n}\n/* \u2715 \u653E\u751F\u94AE\uFF08\u684C\u9762 .rvpBRw_btn.rvpBRw_del\uFF1Adanger \u5B57\u8272\uFF09 */\n.rvpBRw_opRelease {\n  color: var(--pcy-danger, #b3590f);\n}\n/* \u5DF2\u6355\u6349/\u5DF2\u9003\u8D70\u72B6\u6001\u6807\uFF08\u684C\u9762 .rvpBRw_catch-mark / .rvpBRw_escape-mark \u540C\u6784\uFF09 */\n.rvpBRw_catchMark {\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_escapeMark {\n  color: var(--pcy-warn-ink, #8a5e06);\n}\n/* \u6807\u7B7E chips\uFF08\u684C\u9762 .rvpBRw_tag-list / .rvpBRw_tag-chip \u540C\u6784\uFF1A\u9879\u76EE\u7EF4\u5EA6\u9EC4\u5E95\u4E3B\u4F4D\uFF09 */\n.rvpBRw_tagList {\n  display: inline-flex;\n  gap: 4px;\n  flex-wrap: wrap;\n}\n.rvpBRw_metaTagChip {\n  font-style: normal;\n  font-size: 10.5px;\n  font-weight: 700;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  background: var(--dsw-alias-bg-layer-1, #f2f4f7);\n  border: 1px solid rgba(26, 27, 37, 0.2);\n  border-radius: 999px;\n  padding: 0 7px;\n  line-height: 17px;\n}\n.rvpBRw_metaTagChip[data-project="true"] {\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n}\n\n/* DexView */\n.rvpBRw_dexStatsLine {\n  font-size: 13px;\n}\n.rvpBRw_dexMilestone {\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_dexFilters {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n/* \u56FE\u9274\u8FC7\u6EE4\u80F6\u56CA\uFF08specs/dsh-plugin-style T1#4\uFF0C\u4E00\u7B49\u9009\u4E2D\u8BED\u8A00\uFF09\uFF1A\u6052\u5B9A 1.5px \u8FB9\u6846\u2014\u2014\n * \u672C\u7C7B\u65E0 border-box\uFF0C\u9009\u4E2D 1px\u21921.5px \u53D8\u5BBD\u4F1A\u6296\u52A8\uFF0C\u672A\u9009\u4E2D\u7528\u900F\u660E\u5360\u4F4D */\n.rvpBRw_filterButton {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  min-height: 32px;\n  padding: 2px 12px;\n  border-radius: 999px;\n  border: 1.5px solid var(--dsw-alias-border-l1, #e3e7ec);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 12px;\n  font-weight: 600;\n  cursor: pointer;\n}\n.rvpBRw_filterButton:hover {\n  border-color: var(--dsw-alias-border-l3, #c7cdd4);\n  background: var(--pcy-hover, #fff3c4);\n}\n.rvpBRw_filterButton[aria-pressed="true"] {\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-weight: 700;\n}\n\n/* \u641C\u7D22\u680F\uFF08\u5BF9\u7167\u4E3B\u5E94\u7528 TaskTab \u641C\u7D22\uFF1A\u8F93\u5165 + \u547D\u4E2D\u8BA1\u6570\uFF1B\u5E95\u8DDD 12px \u4E0E\u684C\u9762 .rvpBRw_search-bar \u540C\u503C\u2014\u2014\n * \u641C\u7D22\u680F\u4E0E\u5206\u6BB5\u5185\u5BB9\u662F\u5757\u7EA7\u5144\u5F1F\uFF0C\u65E0\u7236\u7EA7 gap \u627F\u63A5\uFF09 */\n.rvpBRw_searchBar {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 12px;\n}\n.rvpBRw_searchInput {\n  flex: 1;\n  min-width: 0;\n  min-height: 32px;\n  padding: 4px 10px;\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 13px;\n}\n.rvpBRw_searchInput:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n.rvpBRw_searchHint {\n  flex: none;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n\n/* \u5168\u5B57\u6BB5\u7F16\u8F91\u5F39\u7A97\u8868\u5355\uFF08label \u5217 + \u63A7\u4EF6\u5217\uFF1B\u6807\u7B7E chips \u6309\u7EF4\u5EA6\u5206\u7EC4\uFF09 */\n.rvpBRw_editForm {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n.rvpBRw_editRow {\n  display: grid;\n  grid-template-columns: 56px minmax(0, 1fr);\n  align-items: center;\n  gap: 10px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_editRowLabel {\n  font-weight: 700;\n}\n.rvpBRw_editTextarea {\n  min-height: 32px;\n  padding: 4px 8px;\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 13px;\n  resize: vertical;\n  width: 100%;\n  box-sizing: border-box;\n}\n.rvpBRw_tagPick {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px 10px;\n  align-items: center;\n}\n.rvpBRw_tagDim {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n}\n.rvpBRw_dimName {\n  font-size: 11px;\n  font-weight: 700;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin-right: 2px;\n}\n.rvpBRw_tagChip {\n  min-height: 24px;\n  padding: 2px 10px;\n  border-radius: 999px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 12px;\n  font-weight: 600;\n  cursor: pointer;\n}\n.rvpBRw_tagChip:hover {\n  border-color: var(--dsw-alias-border-l3, #c7cdd4);\n}\n.rvpBRw_tagChip:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n/* \u9009\u4E2D\u6001\uFF1A\u9879\u76EE\u7EF4\u5EA6\u4E3B\u4F4D\u9AD8\u4EAE\u9EC4\uFF0C\u5176\u4F59\u7EF4\u5EA6\u6D45\u7EFF\u533A\u5206 */\n.rvpBRw_tagChip[data-on="true"] {\n  background: var(--pcy-running, #ffcb05);\n  border-color: rgba(26, 27, 37, 0.35);\n}\n.rvpBRw_tagChip[data-project="false"][data-on="true"] {\n  background: var(--pcy-ok-soft, #dff3e4);\n}\n.rvpBRw_tagCount {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin-left: auto;\n}\n.rvpBRw_editError {\n  margin: 0;\n  font-size: 12.5px;\n  font-weight: 700;\n  color: var(--pcy-danger, #b3590f);\n}\n\n/* EmptyState */\n.rvpBRw_emptyState {\n  padding: 28px 16px;\n  text-align: center;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n  line-height: 1.8;\n}\n\n/* \u8DEF\u7EBF\u5206\u7EC4\uFF08\u539F\u578B group-h\uFF1A\u5C0F\u53F7\u52A0\u7C97\u5F31\u5316\u8272 + \u5B57\u8DDD\uFF09 */\n.rvpBRw_routeGroupDate {\n  font-size: 12px;\n  font-weight: 800;\n  letter-spacing: 0.4px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin: 10px 0 6px;\n}\n\n/* \u65E5\u5FD7\u6BB5 ledger \u884C\u5361\uFF08\u539F\u578B ledger\uFF1Aagent \u52A0\u7C97 + exit \u8272\u5B57 + \u65F6\u95F4\u53F3\u5BF9\u9F50\u7B49\u5BBD\uFF09 */\n.rvpBRw_ledger {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 4px 12px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 10px;\n  padding: 9px 12px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_ledgerAgent {\n  font-weight: 700;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 12.5px;\n}\n.rvpBRw_ledgerExit {\n  font-weight: 700;\n}\n.rvpBRw_ledgerExit[data-ok="true"] {\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n.rvpBRw_ledgerExit[data-ok="false"] {\n  color: var(--pcy-fail-ink, #991b1b);\n}\n.rvpBRw_ledgerTime {\n  margin-left: auto;\n  font-variant-numeric: tabular-nums;\n}\n\n/* \u6267\u884C\u4E16\u754C\u5FBD\u7AE0\uFF08FR-C2\uFF1A\u672C\u673A/\u90E8\u7F72\u522B\u540D\uFF1B\u7B49\u5BBD\u4E1D\u5370\u4F4D\u2014\u2014\u5FEB\u7167\u6307\u5411\u5DF2\u79FB\u9664\u90E8\u7F72 = \u5220\u9664\u7EBF\u4E2D\u6027\u5448\u73B0\uFF09 */\n.rvpBRw_worldBadge {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  letter-spacing: 1px;\n  font-size: 11px;\n  border: 1px solid var(--dsw-alias-border-l3, #c7cdd4);\n  border-radius: 4px;\n  padding: 1px 6px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_worldBadge[data-gone="true"] {\n  text-decoration: line-through;\n}\n\n/* \u4F1A\u8BDD\u5206\u9875\u5668\uFF08counts \u5E38\u663E + \u4E0A\u4E0B\u9875 + \u6BCF\u9875\u6761\u6570\u6863\uFF1B\u547D\u4E2D\u533A \u226532px\uFF09 */\n.rvpBRw_sessPager {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding-top: 10px;\n  flex-wrap: wrap;\n}\n.rvpBRw_sessCounts {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-variant-numeric: tabular-nums;\n  margin-right: auto;\n}\n.rvpBRw_sessNote {\n  margin: 8px 0 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n\n/* \u8BE6\u60C5\u62BD\u5C49\uFF08\u53F3\u4FA7\u6ED1\u5165\u8986\u76D6\u5C42\uFF0C\u539F\u578B drawer/drawer-mask\uFF1Afixed \u6574\u89C6\u53E3 mask + \u53F3\u7F18\u9762\u677F\uFF1B\n   fixed \u76F8\u5BF9\u5BBF\u4E3B\u89C6\u53E3\u2014\u2014\u9762\u677F\u8F7D\u4F53\uFF08detail section / \u4E3B\u9762\u677F\uFF09\u6EDA\u52A8\u5BB9\u5668\u5404\u5F02\uFF0C\u89C6\u53E3\u7EA7\u6700\u7A33\u5065\uFF09 */\n.rvpBRw_drawerOverlay {\n  position: fixed;\n  inset: 0;\n  z-index: 60;\n  background: rgba(15, 18, 30, 0.42);\n}\n.rvpBRw_drawer {\n  position: fixed;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 61;\n  width: min(94vw, 800px);\n  display: flex;\n  flex-direction: column;\n  background: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, #ffffff));\n  border-left: 2px solid var(--dsw-alias-label-primary, #1f2328);\n  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);\n}\n.rvpBRw_drawerHeader {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 14px 16px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n}\n.rvpBRw_drawerTitle {\n  font-size: 15px;\n  font-weight: 700;\n  margin: 0;\n  flex: 1;\n}\n.rvpBRw_drawerClose {\n  flex: none;\n}\n.rvpBRw_drawerBody {\n  flex: 1;\n  overflow-y: auto;\n  padding: 14px 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n.rvpBRw_drawerSectionTitle {\n  font-size: 13px;\n  font-weight: 700;\n  margin: 0 0 6px;\n}\n/* \u5C5E\u6027\u603B\u89C8\uFF08\u684C\u9762 .rvpBRw_d-summary \u540C\u6784\uFF1A\u4E24\u5217 kv + \u9762\u677F\u5E95\uFF1B\u5361\u5185\u53F3\u4E0A\u89D2\u300C\u7F16\u8F91\u300D\u5165\u53E3\u6D6E\u5C42\uFF09 */\n.rvpBRw_summarySection {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-1, #f8f9fb);\n}\n/* \u7F16\u8F91\u94AE\u6D6E\u5C42\uFF08\u7EDD\u5BF9\u5B9A\u4F4D\u4E0D\u5360\u5E03\u5C40\u884C\u2014\u2014kv \u6805\u683C\u4F4D\u7F6E\u4E0E\u9996\u884C\u9AD8\u5EA6\u4E0D\u53D7\u5F71\u54CD\uFF09 */\n.rvpBRw_summaryEdit {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 1;\n}\n.rvpBRw_summaryGrid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 6px 14px;\n  font-size: 12.5px;\n}\n.rvpBRw_summaryKv {\n  display: flex;\n  align-items: baseline;\n  gap: 6px;\n  min-width: 0;\n}\n.rvpBRw_summaryKey {\n  flex: none;\n  font-weight: 700;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_summaryVal {\n  min-width: 0;\n  overflow-wrap: break-word;\n}\n.rvpBRw_summaryValMono {\n\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-variant-numeric: tabular-nums;\n}\n.rvpBRw_summaryTags {\n  display: inline-flex;\n  gap: 4px;\n  flex-wrap: wrap;\n}\n.rvpBRw_followupItem {\n  padding: 4px 0 4px 12px;\n  border-left: 2px solid var(--dsw-alias-border-l1, #e3e7ec);\n  font-size: 13px;\n}\n.rvpBRw_followupContent {\n  min-width: 0;\n  overflow-wrap: break-word;\n}\n.rvpBRw_followupMeta {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_followupSrc {\n  font-size: 10px;\n  font-weight: 700;\n  color: #1a1b25;\n  background: var(--pcy-running, #ffcb05);\n  border: 1px solid rgba(26, 27, 37, 0.35);\n  border-radius: 4px;\n  padding: 0 5px;\n  line-height: 15px;\n}\n.rvpBRw_followupEmpty {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n/* \u4E24\u6BB5\u5F0F\u5220\u9664\uFF08\u2715 \u2192 \u786E\u8BA4\u5220\u9664\uFF1F4 \u79D2\u590D\u4F4D\uFF09 */\n.rvpBRw_followupDelete {\n  margin-left: auto;\n  border: none;\n  background: none;\n  padding: 0 4px;\n  min-height: 24px;\n  font-size: 12px;\n  color: var(--pcy-danger, #b3590f);\n  cursor: pointer;\n}\n.rvpBRw_followupDelete[data-confirming="true"] {\n  background: var(--pcy-danger, #b3590f);\n  color: #ffffff;\n  border-radius: 4px;\n  padding: 0 8px;\n  font-weight: 700;\n}\n.rvpBRw_followupDelete:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n.rvpBRw_followupInput {\n  flex: 1;\n  min-width: 0;\n  min-height: 32px;\n  padding: 4px 8px;\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  font-size: 13px;\n}\n.rvpBRw_followupInput:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n.rvpBRw_followupComposer {\n  display: flex;\n  gap: 6px;\n}\n\n/* \u64CD\u4F5C\u5386\u53F2\u6BB5\uFF08\u5BF9\u7167\u684C\u9762 log \u884C\uFF1Aorigin + \u65F6\u95F4 + \u52A8\u4F5C/\u5B57\u6BB5\u65E7\u2192\u65B0\uFF09 */\n.rvpBRw_historyRow {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 4px 0 4px 12px;\n  border-left: 2px solid var(--dsw-alias-border-l1, #e3e7ec);\n  font-size: 12.5px;\n}\n.rvpBRw_historyMeta {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_historyOrigin {\n  font-weight: 700;\n}\n.rvpBRw_historyText {\n  min-width: 0;\n  overflow-wrap: break-word;\n}\n.rvpBRw_timelineItem {\n  display: flex;\n  gap: 10px;\n  padding: 6px 0;\n  font-size: 12px;\n}\n.rvpBRw_timelineDot {\n  width: 8px;\n  height: 8px;\n  margin-top: 4px;\n  border-radius: 50%;\n  background: var(--dsw-alias-border-l3, #c7cdd4);\n  flex: none;\n}\n.rvpBRw_timelineMain {\n  flex: 1;\n}\n.rvpBRw_opsRow {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  align-items: center;\n}\n/* \u6D3E\u53D1\u884C\uFF08\u684C\u9762 dsp-row \u540C\u6784\uFF09\uFF1A\u901A\u9053/agent \u4E0B\u62C9\u5B9A\u5BBD\u3001agent \u5FBD\u7AE0\u3001\u76EE\u5F55\u7701\u7565\u3001\u51FA\u53D1\u4E3B\u94AE */\n.rvpBRw_dspChannel {\n  width: 150px;\n  flex: none;\n}\n.rvpBRw_dspAgent {\n  width: 150px;\n  flex: none;\n}\n.rvpBRw_dspAgentBadge {\n  flex: none;\n  font-size: 11px;\n  font-weight: 700;\n  border: 1px solid rgba(26, 27, 37, 0.2);\n  border-radius: 4px;\n  padding: 1px 7px;\n  line-height: 18px;\n  background: var(--dsw-alias-border-l1, #e3e7ec);\n  color: inherit;\n}\n.rvpBRw_dspAgentBadge[data-ssh="true"] {\n  background: var(--pcy-ok-soft, #dff3e4);\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n.rvpBRw_dspDir {\n  flex: 1;\n  min-width: 120px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n/* \u624B\u52A8\u6536\u53E3 mini \u6863\uFF08\u684C\u9762 dsp-mark .rvpBRw_btn mini \u540C\u6784\uFF09 */\n.rvpBRw_markMini {\n  min-height: 28px;\n  padding: 2px 10px;\n  font-size: 12px;\n}\n.rvpBRw_markReset {\n  color: var(--pcy-danger, #b3590f);\n}\n.rvpBRw_drawerHint {\n  margin: 0;\n  font-size: 11.5px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_drawerErr {\n  margin: 0;\n  font-size: 12.5px;\n  font-weight: 700;\n  color: var(--pcy-fail-ink, #991b1b);\n}\n\n/* \u6BCF\u5468\u590D\u76D8\u5411\u5BFC\uFF08\u5BF9\u7167\u684C\u9762 ReviewWizard.rvpBRw_vue\uFF1A\u6B65\u9AA4\u6761 + \u603B\u89C8\u7EDF\u8BA1\u5361 + \u6761\u5F62 + \u4EFB\u52A1\u7AD9\u5361 + \u8349\u4E1B\u6E05\u5355 + \u4F53\u68C0\u884C\u5361\uFF09 */\n.rvpBRw_reviewBody {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-height: 200px;\n}\n.rvpBRw_reviewSteps {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  font-size: 11px;\n  font-weight: 700;\n}\n.rvpBRw_reviewStepDot {\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 999px;\n  padding: 2px 8px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n}\n.rvpBRw_reviewStepDot[data-on="true"] {\n  background: var(--pcy-running, #ffcb05);\n  border-color: rgba(26, 27, 37, 0.35);\n  color: #1a1b25;\n}\n.rvpBRw_reviewStepDot[data-past="true"] {\n  background: var(--pcy-ok-soft, #dff3e4);\n  border-color: var(--pcy-ok-ink, #1d6b3c);\n  color: var(--pcy-ok-ink, #1d6b3c);\n}\n.rvpBRw_reviewStats {\n  display: flex;\n  gap: 8px;\n}\n.rvpBRw_reviewStat {\n  flex: 1;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1, #f8f9fb);\n  text-align: center;\n  padding: 8px 4px;\n}\n.rvpBRw_reviewStatNum {\n  font-size: 22px;\n  font-weight: 800;\n  font-variant-numeric: tabular-nums;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewStatLbl {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_reviewBars {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.rvpBRw_reviewBarRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n}\n.rvpBRw_reviewBarName {\n  width: 44px;\n  flex: none;\n  font-weight: 700;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewBarTrack {\n  flex: 1;\n  height: 12px;\n  border: 1.5px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 4px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  overflow: hidden;\n  display: block;\n}\n.rvpBRw_reviewBarFill {\n  display: block;\n  height: 100%;\n  background: var(--pcy-running, #ffcb05);\n}\n.rvpBRw_reviewBarN {\n  flex: none;\n  font-weight: 800;\n  font-variant-numeric: tabular-nums;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewTip {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin: 0;\n}\n.rvpBRw_reviewStation {\n  border: 1.5px solid var(--dsw-alias-border-l2, #d0d7de);\n  border-radius: 8px;\n  padding: 10px 12px;\n  background: var(--dsw-alias-bg-layer-1, #f8f9fb);\n}\n.rvpBRw_reviewStNo {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 10px;\n  letter-spacing: 1px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_reviewStTitle {\n  font-size: 15px;\n  font-weight: 800;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  margin: 4px 0;\n}\n.rvpBRw_reviewStMeta {\n  display: flex;\n  gap: 10px;\n  flex-wrap: wrap;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_reviewStMeta [data-overdue="true"] {\n  color: var(--pcy-fail-ink, #991b1b);\n  font-weight: 800;\n}\n.rvpBRw_reviewStNote {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin: 6px 0 0;\n}\n.rvpBRw_reviewBtnRow {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n/* ghost/mini/del\uFF1A\u684C\u9762 ghost \u6B21\u8981\u6309\u94AE\u4E0E\u884C\u5185 mini \u6863\uFF08danger \u5B57\u8272\uFF09 */\n.rvpBRw_reviewGhost {\n  background: var(--dsw-alias-bg-layer-1, #f8f9fb);\n}\n.rvpBRw_reviewMini {\n  min-height: 26px;\n  padding: 2px 8px;\n  font-size: 12px;\n}\n.rvpBRw_reviewDel {\n  color: var(--pcy-danger, #b3590f);\n}\n.rvpBRw_reviewEmpty {\n  color: var(--dsw-alias-label-secondary, #57606a);\n  text-align: center;\n  padding: 32px 0;\n  font-size: 13px;\n  margin: 0;\n}\n.rvpBRw_reviewGrassHead {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.rvpBRw_reviewBatchCheck {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  cursor: pointer;\n}\n.rvpBRw_reviewGrassList {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  max-height: 220px;\n  overflow-y: auto;\n}\n.rvpBRw_reviewGrassItem {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 13px;\n}\n.rvpBRw_reviewGrassTitle {\n  font-weight: 700;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewGrassCat {\n  margin-left: auto;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_reviewTgTitle {\n  margin: 0 0 6px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewTgRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 12.5px;\n  margin-bottom: 6px;\n}\n.rvpBRw_reviewTgMain {\n  font-weight: 700;\n  color: var(--dsw-alias-label-primary, #1f2328);\n}\n.rvpBRw_reviewTgDim {\n  font-style: normal;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  margin-left: 4px;\n}\n.rvpBRw_reviewTgReason {\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #57606a);\n  flex: 1;\n  min-width: 120px;\n}\n.rvpBRw_reviewFin {\n  text-align: center;\n  padding: 16px 0;\n}\n.rvpBRw_reviewFinEmoji {\n  font-size: 36px;\n}\n.rvpBRw_reviewFinLine {\n  font-size: 14px;\n  font-weight: 800;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  margin: 0;\n}\n\n/* \u56FE\u9274\u7B5B\u9009\u884C\u7684\u590D\u76D8\u5165\u53E3\uFF08\u684C\u9762 .rvpBRw_filter-btn.rvpBRw_review-btn\uFF1A\u53F3\u8D34\u8FB9 + \u4E00\u7B49\u9009\u4E2D\u8BED\u8A00\u5408\u6D41\uFF0C\n * \u9A8C\u6536\u88C1\u51B3\u53BB \u25B6 \u524D\u7F00\uFF09 */\n.rvpBRw_reviewEntry {\n  margin-left: auto;\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-weight: 700;\n}\n.rvpBRw_reviewEntry:hover {\n  border-color: var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n}\n.rvpBRw_reviewEntry:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n\n/* \u6D3E\u53D1\u6267\u884C\u4E16\u754C\u884C + \u964D\u7EA7\u660E\u793A\uFF08\xA78 \u6D3E\u53D1\u786E\u8BA4\u9762\uFF1B\u8B66\u793A\u884C\u8D70 danger \u8272\u975E\u95EA\u70C1\uFF09 */\n.rvpBRw_worldNotes {\n  margin: 6px 0 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n.rvpBRw_worldNotes p {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.7;\n}\n.rvpBRw_worldLine {\n  color: var(--dsw-alias-label-secondary, #57606a);\n}\n.rvpBRw_worldWarn {\n  color: var(--pcy-danger, #b3590f);\n}\n';
    var tagId6 = "dsh-plugin/src/client/tasks/tasks.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId6) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId6;
      tag.textContent = css6;
      document.head.appendChild(tag);
    }
    var tasks_default = {
      segmentWrap: "rvpBRw_segmentWrap",
      module: "rvpBRw_module",
      css: "rvpBRw_css",
      overdueFold: "rvpBRw_overdueFold",
      overdueList: "rvpBRw_overdueList",
      xxx: "rvpBRw_xxx",
      taskCard: "rvpBRw_taskCard",
      taskTitle: "rvpBRw_taskTitle",
      taskNo: "rvpBRw_taskNo",
      taskMeta: "rvpBRw_taskMeta",
      catchMark: "rvpBRw_catchMark",
      taskSprite: "rvpBRw_taskSprite",
      md: "rvpBRw_md",
      runningTag: "rvpBRw_runningTag",
      "tag-paused": "rvpBRw_tag-paused",
      taskMain: "rvpBRw_taskMain",
      typeBadge: "rvpBRw_typeBadge",
      prioDot: "rvpBRw_prioDot",
      dispatchBadge: "rvpBRw_dispatchBadge",
      dispatchGlyph: "rvpBRw_dispatchGlyph",
      quickOps: "rvpBRw_quickOps",
      btn: "rvpBRw_btn",
      del: "rvpBRw_del",
      opRelease: "rvpBRw_opRelease",
      "catch-mark": "rvpBRw_catch-mark",
      "escape-mark": "rvpBRw_escape-mark",
      escapeMark: "rvpBRw_escapeMark",
      "tag-list": "rvpBRw_tag-list",
      "tag-chip": "rvpBRw_tag-chip",
      tagList: "rvpBRw_tagList",
      metaTagChip: "rvpBRw_metaTagChip",
      dexStatsLine: "rvpBRw_dexStatsLine",
      dexMilestone: "rvpBRw_dexMilestone",
      dexFilters: "rvpBRw_dexFilters",
      filterButton: "rvpBRw_filterButton",
      "search-bar": "rvpBRw_search-bar",
      searchBar: "rvpBRw_searchBar",
      searchInput: "rvpBRw_searchInput",
      searchHint: "rvpBRw_searchHint",
      editForm: "rvpBRw_editForm",
      editRow: "rvpBRw_editRow",
      editRowLabel: "rvpBRw_editRowLabel",
      editTextarea: "rvpBRw_editTextarea",
      tagPick: "rvpBRw_tagPick",
      tagDim: "rvpBRw_tagDim",
      dimName: "rvpBRw_dimName",
      tagChip: "rvpBRw_tagChip",
      tagCount: "rvpBRw_tagCount",
      editError: "rvpBRw_editError",
      emptyState: "rvpBRw_emptyState",
      routeGroupDate: "rvpBRw_routeGroupDate",
      ledger: "rvpBRw_ledger",
      ledgerAgent: "rvpBRw_ledgerAgent",
      ledgerExit: "rvpBRw_ledgerExit",
      ledgerTime: "rvpBRw_ledgerTime",
      worldBadge: "rvpBRw_worldBadge",
      sessPager: "rvpBRw_sessPager",
      sessCounts: "rvpBRw_sessCounts",
      sessNote: "rvpBRw_sessNote",
      drawerOverlay: "rvpBRw_drawerOverlay",
      drawer: "rvpBRw_drawer",
      drawerHeader: "rvpBRw_drawerHeader",
      drawerTitle: "rvpBRw_drawerTitle",
      drawerClose: "rvpBRw_drawerClose",
      drawerBody: "rvpBRw_drawerBody",
      drawerSectionTitle: "rvpBRw_drawerSectionTitle",
      "d-summary": "rvpBRw_d-summary",
      summarySection: "rvpBRw_summarySection",
      summaryEdit: "rvpBRw_summaryEdit",
      summaryGrid: "rvpBRw_summaryGrid",
      summaryKv: "rvpBRw_summaryKv",
      summaryKey: "rvpBRw_summaryKey",
      summaryVal: "rvpBRw_summaryVal",
      summaryValMono: "rvpBRw_summaryValMono rvpBRw_summaryVal",
      summaryTags: "rvpBRw_summaryTags",
      followupItem: "rvpBRw_followupItem",
      followupContent: "rvpBRw_followupContent",
      followupMeta: "rvpBRw_followupMeta",
      followupSrc: "rvpBRw_followupSrc",
      followupEmpty: "rvpBRw_followupEmpty",
      followupDelete: "rvpBRw_followupDelete",
      followupInput: "rvpBRw_followupInput",
      followupComposer: "rvpBRw_followupComposer",
      historyRow: "rvpBRw_historyRow",
      historyMeta: "rvpBRw_historyMeta",
      historyOrigin: "rvpBRw_historyOrigin",
      historyText: "rvpBRw_historyText",
      timelineItem: "rvpBRw_timelineItem",
      timelineDot: "rvpBRw_timelineDot",
      timelineMain: "rvpBRw_timelineMain",
      opsRow: "rvpBRw_opsRow",
      dspChannel: "rvpBRw_dspChannel",
      dspAgent: "rvpBRw_dspAgent",
      dspAgentBadge: "rvpBRw_dspAgentBadge",
      dspDir: "rvpBRw_dspDir",
      markMini: "rvpBRw_markMini",
      markReset: "rvpBRw_markReset",
      drawerHint: "rvpBRw_drawerHint",
      drawerErr: "rvpBRw_drawerErr",
      vue: "rvpBRw_vue",
      reviewBody: "rvpBRw_reviewBody",
      reviewSteps: "rvpBRw_reviewSteps",
      reviewStepDot: "rvpBRw_reviewStepDot",
      reviewStats: "rvpBRw_reviewStats",
      reviewStat: "rvpBRw_reviewStat",
      reviewStatNum: "rvpBRw_reviewStatNum",
      reviewStatLbl: "rvpBRw_reviewStatLbl",
      reviewBars: "rvpBRw_reviewBars",
      reviewBarRow: "rvpBRw_reviewBarRow",
      reviewBarName: "rvpBRw_reviewBarName",
      reviewBarTrack: "rvpBRw_reviewBarTrack",
      reviewBarFill: "rvpBRw_reviewBarFill",
      reviewBarN: "rvpBRw_reviewBarN",
      reviewTip: "rvpBRw_reviewTip",
      reviewStation: "rvpBRw_reviewStation",
      reviewStNo: "rvpBRw_reviewStNo",
      reviewStTitle: "rvpBRw_reviewStTitle",
      reviewStMeta: "rvpBRw_reviewStMeta",
      reviewStNote: "rvpBRw_reviewStNote",
      reviewBtnRow: "rvpBRw_reviewBtnRow",
      reviewGhost: "rvpBRw_reviewGhost",
      reviewMini: "rvpBRw_reviewMini",
      reviewDel: "rvpBRw_reviewDel",
      reviewEmpty: "rvpBRw_reviewEmpty",
      reviewGrassHead: "rvpBRw_reviewGrassHead",
      reviewBatchCheck: "rvpBRw_reviewBatchCheck",
      reviewGrassList: "rvpBRw_reviewGrassList",
      reviewGrassItem: "rvpBRw_reviewGrassItem",
      reviewGrassTitle: "rvpBRw_reviewGrassTitle",
      reviewGrassCat: "rvpBRw_reviewGrassCat",
      reviewTgTitle: "rvpBRw_reviewTgTitle",
      reviewTgRow: "rvpBRw_reviewTgRow",
      reviewTgMain: "rvpBRw_reviewTgMain",
      reviewTgDim: "rvpBRw_reviewTgDim",
      reviewTgReason: "rvpBRw_reviewTgReason",
      reviewFin: "rvpBRw_reviewFin",
      reviewFinEmoji: "rvpBRw_reviewFinEmoji",
      reviewFinLine: "rvpBRw_reviewFinLine",
      "filter-btn": "rvpBRw_filter-btn",
      "review-btn": "rvpBRw_review-btn",
      reviewEntry: "rvpBRw_reviewEntry",
      worldNotes: "rvpBRw_worldNotes",
      worldLine: "rvpBRw_worldLine",
      worldWarn: "rvpBRw_worldWarn",
    };

    // src/client/tasks/DispatchRow.tsx
    var import_jsx_runtime50 = require("react/jsx-runtime");
    function StateBadge({ state }) {
      const t = useT();
      if (state === null) {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("span", {
        className: tasks_default.dispatchBadge,
        "data-state": state,
        children: t(`dsh.dispatch.badge.${state}`),
      });
    }
    function MarkRow({ state, readonly, busy, onMark }) {
      const t = useT();
      if (state !== "queued" && state !== "running") {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", {
        className: tasks_default.opsRow,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(MarkButton, {
            label: t("dispatch.markDone"),
            state: "done",
            ...{ readonly, busy, onMark },
          }),
          /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(MarkButton, {
            label: t("dispatch.markFailed"),
            state: "failed",
            ...{ readonly, busy, onMark },
          }),
          /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(MarkButton, {
            label: t("dispatch.markReset"),
            state: "reset",
            danger: true,
            ...{ readonly, busy, onMark },
          }),
        ],
      });
    }
    function MarkButton({ label, state, danger = false, readonly, busy, onMark }) {
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("button", {
        type: "button",
        className: `${ui_default.button} ${tasks_default.markMini} ${danger ? tasks_default.markReset : ""}`,
        disabled: readonly || busy,
        onClick: () => onMark(state),
        children: label,
      });
    }
    function DispatchBody(props) {
      const t = useT();
      const { task, route, agents, channel, agentId, busy, dispatchState, readonly, onChannel, onAgent, onDispatch } =
        props;
      if (!hasProjectTag(task)) {
        return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("p", {
          className: tasks_default.drawerHint,
          children: t("dispatch.needTag"),
        });
      }
      if (agents.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("p", {
          className: tasks_default.drawerHint,
          children: t("dispatch.noAgent"),
        });
      }
      const chosen = resolveChosen(agents, agentId, route);
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)(import_jsx_runtime50.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", {
            className: tasks_default.opsRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(Select, {
                ariaLabel: t("dispatch.title"),
                value: channel,
                className: tasks_default.dspChannel,
                options: [
                  { value: "interactive", label: t("dispatch.chInteractive") },
                  { value: "headless", label: t("dispatch.chHeadless") },
                ],
                onChange: (v) => onChannel(v === "headless" ? "headless" : "interactive"),
              }),
              agents.length > 1 &&
                /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(AgentSelect, { agents, route, agentId, onAgent }),
              chosen !== void 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(AgentBadge, {
                  name: chosen.name,
                  host: chosen.remote?.host ?? null,
                }),
              /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("span", {
                className: tasks_default.dspDir,
                title: t("dispatch.dir"),
                children: ["\u{1F4C2} ", workdirText(route, t)],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(GoButton, {
                ...{ readonly, busy, dispatchState, onDispatch },
              }),
            ],
          }),
          channel === "headless" &&
            /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("p", {
              className: tasks_default.drawerHint,
              children: t("dispatch.headlessHint"),
            }),
        ],
      });
    }
    function AgentSelect({ agents, route, agentId, onAgent }) {
      const t = useT();
      const value = agentId === "" ? (route?.agentId ?? agents[0]?.id ?? "") : agentId;
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(Select, {
        ariaLabel: t("tags.metaAgentOff"),
        value,
        className: tasks_default.dspAgent,
        options: agents.map((a) => ({ value: a.id, label: a.remote?.host ? `${a.name} \xB7 SSH` : a.name })),
        onChange: onAgent,
      });
    }
    function GoButton({ readonly, busy, dispatchState, onDispatch }) {
      const t = useT();
      const blocked = dispatchState === "running" || dispatchState === "queued";
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("button", {
        type: "button",
        className: ui_default.buttonDex,
        disabled: readonly || busy || blocked,
        title: dispatchState === "running" ? t("dsh.dispatch.tooltipRunning") : void 0,
        onClick: onDispatch,
        children: busy ? t("dispatch.working") : `\u26A1 ${t("dispatch.go")}`,
      });
    }
    function AgentBadge({ name, host }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("span", {
        className: tasks_default.dspAgentBadge,
        "data-ssh": host !== null ? "true" : void 0,
        children: [name, " \xB7 ", host !== null ? `SSH ${host}` : t("ai.local")],
      });
    }
    function resolveChosen(agents, agentId, route) {
      return agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === route?.agentId);
    }
    function workdirText(route, t) {
      if (route?.workdir !== void 0 && route.workdir !== "") {
        return route.workdir;
      }
      return t("dispatch.dirDefault");
    }
    function hasProjectTag(task) {
      return task.tags.some((tag) => tag.dimension === "project");
    }
    function DispatchWorldNotes({ info, agentName, workdir }) {
      const t = useT();
      if (info.world === null) {
        return null;
      }
      const worldText =
        info.world.kind === "local"
          ? t("dsh.dispatch.scopeLocal")
          : t("dsh.dispatch.worldDeployment", { alias: info.world.alias });
      return /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", {
        className: tasks_default.worldNotes,
        "data-testid": "dispatch-world-notes",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("p", {
            className: tasks_default.worldLine,
            children: t("dsh.dispatch.worldLine", { agent: agentName, world: worldText, dir: workdir }),
          }),
          info.world.kind === "deployment" &&
            info.world.degraded &&
            /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("p", {
              className: tasks_default.worldWarn,
              children: ["\u26A0 ", t("dsh.dispatch.degradeDirect")],
            }),
          info.interactiveDegraded &&
            /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("p", {
              className: tasks_default.worldWarn,
              children: ["\u26A0 ", t("dsh.dispatch.degradeInteractive")],
            }),
          info.nonPosix &&
            /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("p", {
              className: tasks_default.worldWarn,
              children: ["\u26A0 ", t("dsh.dispatch.degradeNonPosix")],
            }),
          info.occupancySessionId !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("p", {
              className: tasks_default.worldWarn,
              children: t("dsh.dispatch.occupancy", { id: info.occupancySessionId }),
            }),
        ],
      });
    }

    // src/client/tasks/DispatchOps.tsx
    var import_jsx_runtime51 = require("react/jsx-runtime");
    function DispatchOps({ task, data, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [channel, setChannel] = (0, import_react38.useState)("interactive");
      const [busy, setBusy] = (0, import_react38.useState)(false);
      const [conflict, setConflict] = (0, import_react38.useState)(null);
      const [message, setMessage] = (0, import_react38.useState)(null);
      const [dispatchState, setDispatchState] = (0, import_react38.useState)(task.dispatchState);
      const route = data.routes.find((r) => task.tags.some((tag) => tag.name === r.tag));
      const [agentId, setAgentId] = (0, import_react38.useState)(route?.agentId ?? "");
      const agents = (data.agents ?? []).filter((a) => a.enabled);
      const [deployments, setDeployments] = (0, import_react38.useState)(null);
      (0, import_react38.useEffect)(() => {
        void client.deploymentList().then((result) => {
          if (result.ok) {
            setDeployments(result.data);
          }
        });
      }, [client]);
      const worldInfo = (0, import_react38.useMemo)(() => {
        const none = {
          world: null,
          occupancySessionId: null,
          interactiveDegraded: false,
          nonPosix: false,
        };
        const alias = route?.deployment ?? "";
        if (alias === "") {
          return none;
        }
        const dep = deployments?.deployments.find((d) => d.alias === alias);
        if (dep === void 0) {
          return none;
        }
        return {
          world: { kind: "deployment", alias, degraded: dep.degraded && dep.status === "ready" },
          occupancySessionId: null,
          interactiveDegraded: false,
          nonPosix: false,
        };
      }, [route, deployments]);
      const chosen = resolveChosen(agents, agentId, route);
      async function dispatch() {
        setBusy(true);
        setConflict(null);
        setMessage(null);
        const override = agentId !== "" && agentId !== route?.agentId ? { routeOverride: { agentId } } : {};
        const result =
          channel === "interactive"
            ? await client.dispatchInteractive({ taskId: task.id, ...override })
            : await client.dispatchHeadless({ taskId: task.id, ...override });
        setBusy(false);
        if (!result.ok) {
          if (result.error.code === "DISPATCH_ALREADY_ACTIVE") {
            setConflict(t("dsh.toast.dispatchBusy"));
          } else {
            setMessage(`\u274C ${result.error.message}`);
          }
          return;
        }
        setDispatchState(result.data.state);
        onChanged();
      }
      async function mark(state) {
        setBusy(true);
        const result =
          state === "reset"
            ? await client.dispatchReset({ taskId: task.id })
            : await client.dispatchClose({ taskId: task.id, result: state });
        setBusy(false);
        if (result.ok) {
          setDispatchState(result.data.state);
          onChanged();
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", {
        "data-testid": "dispatch-ops",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("h4", {
            className: tasks_default.drawerSectionTitle,
            children: [
              t("dispatch.title"),
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(StateBadge, { state: dispatchState }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(MarkRow, {
            state: dispatchState,
            readonly,
            busy,
            onMark: (state) => void mark(state),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(DispatchBody, {
            task,
            route,
            agents,
            channel,
            agentId,
            busy,
            dispatchState,
            readonly,
            onChannel: setChannel,
            onAgent: setAgentId,
            onDispatch: () => void dispatch(),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(DispatchWorldNotes, {
            info: worldInfo,
            agentName: chosen?.name ?? route?.agentId ?? "",
            workdir: workdirText(route, t),
          }),
          conflict !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("div", {
              role: "status",
              className: ui_default.muted,
              children: conflict,
            }),
          message !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("p", {
              className: tasks_default.drawerErr,
              children: message,
            }),
        ],
      });
    }

    // src/client/tasks/DispatchTimeline.tsx
    var import_react39 = require("react");
    var import_jsx_runtime52 = require("react/jsx-runtime");
    function DispatchTimeline({ data, taskId }) {
      const t = useT();
      const [filter, setFilter] = (0, import_react39.useState)("all");
      const sessions = (0, import_react39.useMemo)(
        () => data.sessions.filter((s) => s.taskId === taskId && (filter === "all" || s.kind === filter)),
        [data.sessions, taskId, filter],
      );
      const kinds = ["all", "classify", "capture", "dispatch_headless", "dispatch_interactive"];
      return /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", {
        "data-testid": "dispatch-timeline",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("h4", {
            className: tasks_default.drawerSectionTitle,
            children: t("edit.agentRuns"),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", {
            className: tasks_default.dexFilters,
            role: "group",
            "aria-label": t("sess.filter_all"),
            children: kinds.map((kind) =>
              /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
                "button",
                {
                  type: "button",
                  className: tasks_default.filterButton,
                  "aria-pressed": filter === kind,
                  onClick: () => setFilter(kind),
                  children: kind === "all" ? t("sess.filter_all") : t(`sess.kind.${kind}`),
                },
                kind,
              ),
            ),
          }),
          sessions.length === 0
            ? /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", {
                className: ui_default.muted,
                children: t("dsh.empty.dispatch"),
              })
            : sessions.map((session) =>
                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)(
                  "div",
                  {
                    className: tasks_default.timelineItem,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", {
                        className: tasks_default.timelineDot,
                        "aria-hidden": "true",
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                        className: tasks_default.timelineMain,
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", {
                            children: [
                              t(`sess.kind.${session.kind}`),
                              " \xB7 ",
                              session.agentId,
                              session.sessionId !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                                  className: ui_default.muted,
                                  children: [" \xB7 ", session.sessionId],
                                }),
                            ],
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", {
                            className: ui_default.muted,
                            children: [
                              session.durationMs !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                                  children: [Math.round(session.durationMs / 1e3), "s "],
                                }),
                              session.costUsd !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                                  children: ["$", session.costUsd.toFixed(3), " "],
                                }),
                              session.exitCode !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                                  children: ["exit ", session.exitCode],
                                }),
                              session.summary !== null &&
                                /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("span", {
                                  children: [" \xB7 ", session.summary],
                                }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  },
                  session.id,
                ),
              ),
        ],
      });
    }

    // src/client/tasks/FollowupStream.tsx
    var import_react40 = require("react");
    var import_jsx_runtime53 = require("react/jsx-runtime");
    var DELETE_CONFIRM_MS = 4e3;
    function FollowupStream({ data, taskId, onRefresh, readonly }) {
      const t = useT();
      const client = useClient();
      const notes = data.followups[taskId] ?? [];
      const [draft, setDraft] = (0, import_react40.useState)("");
      const [busy, setBusy] = (0, import_react40.useState)(false);
      const [confirmId, setConfirmId] = (0, import_react40.useState)(null);
      const confirmTimer = (0, import_react40.useRef)(null);
      (0, import_react40.useEffect)(
        () => () => {
          if (confirmTimer.current !== null) {
            clearTimeout(confirmTimer.current);
          }
        },
        [],
      );
      function addNote() {
        const content = draft.trim();
        if (content === "" || busy) {
          return;
        }
        setBusy(true);
        void client.taskNoteAdd({ taskId, content }).then((result) => {
          setBusy(false);
          if (result.ok) {
            setDraft("");
            onRefresh();
          }
        });
      }
      function removeNote(id) {
        if (confirmId !== id) {
          setConfirmId(id);
          if (confirmTimer.current !== null) {
            clearTimeout(confirmTimer.current);
          }
          confirmTimer.current = setTimeout(() => setConfirmId(null), DELETE_CONFIRM_MS);
          return;
        }
        if (confirmTimer.current !== null) {
          clearTimeout(confirmTimer.current);
        }
        setConfirmId(null);
        void client.taskNoteDelete({ id }).then((result) => {
          if (result.ok) {
            onRefresh();
          }
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", {
        "data-testid": "followup-stream",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("h4", {
            className: tasks_default.drawerSectionTitle,
            children: t("edit.followUps"),
          }),
          notes.length === 0
            ? /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", {
                className: tasks_default.followupEmpty,
                children: t("edit.noFollowUps"),
              })
            : notes.map((note) =>
                /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)(
                  "div",
                  {
                    className: tasks_default.followupItem,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", {
                        className: tasks_default.followupContent,
                        children: note.content,
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", {
                        className: tasks_default.followupMeta,
                        children: [
                          note.source === "ai" &&
                            /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", {
                              className: tasks_default.followupSrc,
                              children: "AI",
                            }),
                          /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("span", {
                            children: [note.source, " \xB7 ", note.createdAt.slice(0, 16).replace("T", " ")],
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("button", {
                            type: "button",
                            className: tasks_default.followupDelete,
                            "data-confirming": confirmId === note.id,
                            disabled: readonly,
                            "aria-label":
                              confirmId === note.id ? t("edit.confirmDeleteNote") : `\u2715 ${note.content}`,
                            onClick: () => removeNote(note.id),
                            children: confirmId === note.id ? t("edit.confirmDeleteNote") : "\u2715",
                          }),
                        ],
                      }),
                    ],
                  },
                  note.id,
                ),
              ),
          /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("form", {
            className: tasks_default.followupComposer,
            onSubmit: (event) => {
              event.preventDefault();
              addNote();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("input", {
                className: tasks_default.followupInput,
                value: draft,
                placeholder: t("edit.followUpPlaceholder"),
                "aria-label": t("edit.followUpPlaceholder"),
                disabled: readonly || busy,
                onChange: (event) => setDraft(event.target.value),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("button", {
                type: "submit",
                className: ui_default.button,
                disabled: readonly || busy || draft.trim() === "",
                children: t("edit.addFollowUp"),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/tasks/TaskEditModal.tsx
    var import_react43 = require("react");

    // src/client/ui/DateTimePicker.tsx
    var import_react42 = require("react");

    // src/client/ui/dateTime.ts
    var VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
    var pad2 = (n) => String(n).padStart(2, "0");
    function parseDateTimeValue(value) {
      const m = VALUE_RE.exec(value);
      if (m === null) {
        return null;
      }
      const parts = {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: Number(m[4]),
        minute: Number(m[5]),
      };
      if (
        parts.month < 1 ||
        parts.month > 12 ||
        parts.day < 1 ||
        parts.day > 31 ||
        parts.hour > 23 ||
        parts.minute > 59
      ) {
        return null;
      }
      return parts;
    }
    function formatValue(parts) {
      return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
    }
    function dateKey(year, month, day) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    function snapMinute(minute) {
      return minute < 30 ? 0 : 30;
    }
    function isPastEvening(now) {
      return now.getHours() > 18 || (now.getHours() === 18 && now.getMinutes() > 0);
    }
    function defaultOpenValue(now = /* @__PURE__ */ new Date()) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (isPastEvening(now) ? 1 : 0));
      return `${dateKey(day.getFullYear(), day.getMonth() + 1, day.getDate())}T18:00`;
    }
    function draftPartsOf(value, now = /* @__PURE__ */ new Date()) {
      return (
        parseDateTimeValue(value) ??
        parseDateTimeValue(defaultOpenValue(now)) ?? {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          day: now.getDate(),
          hour: 18,
          minute: 0,
        }
      );
    }
    function intlLocaleOf(locale) {
      return { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", en: "en-US" }[locale] ?? "zh-CN";
    }
    function fmtDisplayDate(value, format) {
      const p = parseDateTimeValue(value);
      if (p === null) {
        return "";
      }
      switch (format) {
        case "MM/DD/YYYY":
          return `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
        case "DD/MM/YYYY":
          return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
        default:
          return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
      }
    }
    function dayPeriodOf(intlLocale) {
      const fmt = new Intl.DateTimeFormat(intlLocale, { hour: "numeric", minute: "2-digit", hourCycle: "h12" });
      const parts = (date) => fmt.formatToParts(date);
      const period = (list) => (list.find((x) => x.type === "dayPeriod")?.value ?? "").trim();
      const indexOfType = (list, type) => list.findIndex((x) => x.type === type);
      const morning = parts(new Date(2026, 0, 1, 10, 30));
      const afternoon = parts(new Date(2026, 0, 1, 14, 30));
      return {
        am: period(morning),
        pm: period(afternoon),
        first: indexOfType(morning, "dayPeriod") < indexOfType(morning, "hour"),
      };
    }
    function fmtDisplayTime(value, format, intlLocale) {
      const p = parseDateTimeValue(value);
      if (p === null) {
        return "";
      }
      if (format === "24h") {
        return `${pad2(p.hour)}:${pad2(p.minute)}`;
      }
      const { am, pm, first } = dayPeriodOf(intlLocale);
      const clock = `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${pad2(p.minute)}`;
      return first ? `${p.hour < 12 ? am : pm}${clock}` : `${clock} ${p.hour < 12 ? am : pm}`;
    }
    function fmtDisplayDateTime(value, format, timeFormat, intlLocale) {
      return `${fmtDisplayDate(value, format)} ${fmtDisplayTime(value, timeFormat, intlLocale)}`;
    }
    function shiftedMonth(year, month0, delta) {
      const total = year * 12 + month0 + delta;
      return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
    }
    function monthTitle(intlLocale, year, month0) {
      return new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long" }).format(new Date(year, month0, 1));
    }
    function weekdayHeaders(intlLocale) {
      const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" });
      return [...Array(7)].map((_, i) => fmt.format(new Date(2026, 8, 7 + i)));
    }
    function calendarCells(year, month0) {
      const days = new Date(year, month0 + 1, 0).getDate();
      const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
      return [...new Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
    }

    // src/client/ui/displayPrefs.tsx
    var import_react41 = require("react");
    var import_jsx_runtime54 = require("react/jsx-runtime");
    function displayPrefsOf(config) {
      const rawDate = config["date_format"] ?? "";
      return {
        dateFormat: DATE_FORMATS.includes(rawDate) ? rawDate : "YYYY-MM-DD",
        timeFormat: config["time_format"] === "12h" ? "12h" : "24h",
      };
    }
    var DEFAULT_PREFS = { dateFormat: "YYYY-MM-DD", timeFormat: "24h" };
    var DisplayPrefsContext = (0, import_react41.createContext)(DEFAULT_PREFS);
    function DisplayPrefsProvider({ dateFormat, timeFormat, children }) {
      const value = (0, import_react41.useMemo)(() => ({ dateFormat, timeFormat }), [dateFormat, timeFormat]);
      return /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(DisplayPrefsContext.Provider, { value, children });
    }
    function useDisplayPrefs() {
      return (0, import_react41.useContext)(DisplayPrefsContext);
    }

    // src/client/ui/DateTimePickerParts.tsx
    var import_jsx_runtime55 = require("react/jsx-runtime");
    function fieldLabel(ariaLabel, fallback) {
      return ariaLabel === void 0 ? fallback : `${ariaLabel} ${fallback}`;
    }
    function MonthGrid({
      intlLocale,
      viewYear,
      viewMonth,
      selKey,
      todayKey,
      prevLabel,
      nextLabel,
      onShift,
      onPickDay,
    }) {
      return /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)(import_jsx_runtime55.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", {
            className: ui_default.dtNav,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("button", {
                type: "button",
                className: ui_default.dtNavBtn,
                "aria-label": prevLabel,
                onClick: () => onShift(-1),
                children: "\u25C0",
              }),
              /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", {
                className: ui_default.dtTitle,
                children: monthTitle(intlLocale, viewYear, viewMonth),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("button", {
                type: "button",
                className: ui_default.dtNavBtn,
                "aria-label": nextLabel,
                onClick: () => onShift(1),
                children: "\u25B6",
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", {
            className: ui_default.dtGrid,
            children: [
              weekdayHeaders(intlLocale).map((w, i) =>
                /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(
                  "span",
                  { className: ui_default.dtWeek, children: w },
                  `w${i}`,
                ),
              ),
              calendarCells(viewYear, viewMonth).map((day, i) => {
                const key = dateKey(viewYear, viewMonth + 1, day);
                return day === 0
                  ? /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: ui_default.dtBlank }, `b${i}`)
                  : /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(
                      "button",
                      {
                        type: "button",
                        className: ui_default.dtDay,
                        "data-selected": key === selKey,
                        "data-today": key === todayKey,
                        "aria-pressed": key === selKey,
                        onClick: () => onPickDay(day),
                        children: day,
                      },
                      day,
                    );
              }),
            ],
          }),
        ],
      });
    }
    function TimeRow({ draft, is12, intlLocale, nameHour, nameMinute, namePeriod, clearLabel, onPickTime, onClear }) {
      const minute = snapMinute(draft.minute);
      const hour12 = draft.hour % 12 === 0 ? 12 : draft.hour % 12;
      const isPm = draft.hour >= 12;
      const period = dayPeriodOf(intlLocale);
      const hourOptions = (
        is12
          ? [...Array(12)].map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))
          : [...Array(24)].map((_, h) => ({ value: String(h).padStart(2, "0"), label: String(h).padStart(2, "0") }))
      ).map((option) =>
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(
          "option",
          { value: option.value, children: option.label },
          option.value,
        ),
      );
      const periodSelect = /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("select", {
        className: ui_default.dtSelectPeriod,
        value: isPm ? "pm" : "am",
        "aria-label": namePeriod,
        onChange: (event) => onPickTime((event.target.value === "pm" ? 12 : 0) + (hour12 % 12), minute),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("option", { value: "am", children: period.am }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("option", { value: "pm", children: period.pm }),
        ],
      });
      return /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", {
        className: ui_default.dtTime,
        children: [
          is12 && period.first && periodSelect,
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("select", {
            className: ui_default.dtSelect,
            value: is12 ? String(hour12) : String(draft.hour).padStart(2, "0"),
            "aria-label": nameHour,
            onChange: (event) =>
              onPickTime(
                is12 ? (isPm ? 12 : 0) + (Number(event.target.value) % 12) : Number(event.target.value),
                minute,
              ),
            children: hourOptions,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", {
            className: ui_default.dtColon,
            "aria-hidden": "true",
            children: ":",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("select", {
            className: ui_default.dtSelect,
            value: String(minute).padStart(2, "0"),
            "aria-label": nameMinute,
            onChange: (event) => onPickTime(draft.hour, Number(event.target.value)),
            children: ["00", "30"].map((v) =>
              /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("option", { value: v, children: v }, v),
            ),
          }),
          is12 && !period.first && periodSelect,
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("button", {
            type: "button",
            className: ui_default.dtClear,
            onClick: onClear,
            children: clearLabel,
          }),
        ],
      });
    }

    // src/client/ui/DateTimePicker.tsx
    var import_jsx_runtime56 = require("react/jsx-runtime");
    function DateTimePicker({ value, onChange, ariaLabel, disabled = false }) {
      const t = useT();
      const { locale } = useI18n();
      const { dateFormat, timeFormat } = useDisplayPrefs();
      const intlLocale = intlLocaleOf(locale);
      const [open, setOpen] = (0, import_react42.useState)(false);
      const [above, setAbove] = (0, import_react42.useState)(false);
      const [viewYear, setViewYear] = (0, import_react42.useState)(1970);
      const [viewMonth, setViewMonth] = (0, import_react42.useState)(0);
      const rootRef = (0, import_react42.useRef)(null);
      const triggerRef = (0, import_react42.useRef)(null);
      const popRef = (0, import_react42.useRef)(null);
      (0, import_react42.useEffect)(() => {
        if (!open) {
          return;
        }
        const onDocMouseDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) {
            setOpen(false);
          }
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
      }, [open]);
      (0, import_react42.useLayoutEffect)(() => {
        if (!open) {
          return;
        }
        const trigger = triggerRef.current;
        const pop = popRef.current;
        if (trigger === null || pop === null) {
          return;
        }
        setAbove(window.innerHeight - trigger.getBoundingClientRect().bottom < pop.offsetHeight + 8);
      }, [open]);
      function openPopup() {
        const base = value !== "" && parseDateTimeValue(value) !== null ? value : formatValue(draftPartsOf(value));
        if (base !== value) {
          onChange(base);
        }
        const parts = draftPartsOf(base);
        setViewYear(parts.year);
        setViewMonth(parts.month - 1);
        setAbove(false);
        setOpen(true);
      }
      function pickDay(day) {
        const draft2 = draftPartsOf(value);
        onChange(
          formatValue({
            year: viewYear,
            month: viewMonth + 1,
            day,
            hour: draft2.hour,
            minute: snapMinute(draft2.minute),
          }),
        );
      }
      function pickTime(hour, minute) {
        const draft2 = draftPartsOf(value);
        onChange(formatValue({ year: draft2.year, month: draft2.month, day: draft2.day, hour, minute }));
      }
      const draft = draftPartsOf(value);
      return /* @__PURE__ */ (0, import_jsx_runtime56.jsxs)("div", {
        ref: rootRef,
        className: ui_default.dtRoot,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime56.jsxs)("button", {
            ref: triggerRef,
            type: "button",
            className: ui_default.dtBtn,
            "data-open": open,
            "data-none": value === "",
            "aria-label": ariaLabel,
            "aria-expanded": open,
            disabled,
            onClick: () => (open ? setOpen(false) : openPopup()),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime56.jsxs)("span", {
                className: ui_default.dtLabel,
                children: [
                  "\u{1F550} ",
                  value === "" ? t("dt.none") : fmtDisplayDateTime(value, dateFormat, timeFormat, intlLocale),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime56.jsx)("span", {
                className: ui_default.dtArrow,
                "aria-hidden": "true",
                children: "\u25BC",
              }),
            ],
          }),
          open &&
            /* @__PURE__ */ (0, import_jsx_runtime56.jsxs)("div", {
              ref: popRef,
              className: ui_default.dtPop,
              "data-above": above,
              role: "group",
              "data-testid": "dt-pop",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime56.jsx)(MonthGrid, {
                  intlLocale,
                  viewYear,
                  viewMonth,
                  selKey: dateKey(draft.year, draft.month, draft.day),
                  todayKey: dateKey(
                    /* @__PURE__ */ new Date().getFullYear(),
                    /* @__PURE__ */ new Date().getMonth() + 1,
                    /* @__PURE__ */ new Date().getDate(),
                  ),
                  prevLabel: t("dsh.dt.prevMonth"),
                  nextLabel: t("dsh.dt.nextMonth"),
                  onShift: (delta) => {
                    const next = shiftedMonth(viewYear, viewMonth, delta);
                    setViewYear(next.year);
                    setViewMonth(next.month0);
                  },
                  onPickDay: pickDay,
                }),
                /* @__PURE__ */ (0, import_jsx_runtime56.jsx)(TimeRow, {
                  draft,
                  is12: timeFormat === "12h",
                  intlLocale,
                  nameHour: fieldLabel(ariaLabel, t("dsh.dt.hour")),
                  nameMinute: fieldLabel(ariaLabel, t("dsh.dt.minute")),
                  namePeriod: fieldLabel(ariaLabel, t("dsh.dt.period")),
                  clearLabel: t("dt.clear"),
                  onPickTime: pickTime,
                  onClear: () => {
                    onChange("");
                    setOpen(false);
                  },
                }),
              ],
            }),
        ],
      });
    }

    // src/client/tasks/tagPicker.tsx
    var import_jsx_runtime57 = require("react/jsx-runtime");
    var MAX_TAGS = 3;
    function buildTagGroups(data) {
      const groups = /* @__PURE__ */ new Map();
      for (const dim of data.dimensions ?? []) {
        if (dim.enabled) {
          groups.set(dim.key, []);
        }
      }
      for (const tag of data.tags ?? []) {
        const bucket = groups.get(tag.dimension);
        if (bucket !== void 0) {
          bucket.push(tag);
        }
      }
      return [...groups.entries()].map(([key, tags]) => {
        const dim = (data.dimensions ?? []).find((d) => d.key === key);
        return { key, name: dim?.name ?? key, single: dim?.cardinality === "single", tags };
      });
    }
    function initialTagIds(task, tags) {
      const ids = [];
      for (const ref of task.tags) {
        const hit =
          tags.find((x) => x.name === ref.name && x.dimension === ref.dimension) ??
          tags.find((x) => x.name === ref.name);
        if (hit !== void 0 && !ids.includes(hit.id)) {
          ids.push(hit.id);
        }
      }
      return ids;
    }
    function TagPicker({ groups, selectedIds, onToggle, noTagsLabel }) {
      return /* @__PURE__ */ (0, import_jsx_runtime57.jsxs)("div", {
        className: tasks_default.tagPick,
        children: [
          groups.length === 0
            ? /* @__PURE__ */ (0, import_jsx_runtime57.jsx)("span", {
                className: tasks_default.tagCount,
                children: noTagsLabel,
              })
            : groups.map((group) =>
                /* @__PURE__ */ (0, import_jsx_runtime57.jsxs)(
                  "div",
                  {
                    className: tasks_default.tagDim,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime57.jsx)("span", {
                        className: tasks_default.dimName,
                        children: group.name,
                      }),
                      group.tags.length === 0
                        ? /* @__PURE__ */ (0, import_jsx_runtime57.jsx)("span", {
                            className: tasks_default.dimName,
                            children: "\u2014",
                          })
                        : group.tags.map((tag) => {
                            const selected = selectedIds.includes(tag.id);
                            return /* @__PURE__ */ (0, import_jsx_runtime57.jsx)(
                              "button",
                              {
                                type: "button",
                                className: tasks_default.tagChip,
                                "data-on": selected,
                                "data-project": group.key === "project",
                                "aria-pressed": selected,
                                title: tag.description !== "" ? tag.description : group.name,
                                disabled: !selected && selectedIds.length >= MAX_TAGS && !group.single,
                                onClick: () => onToggle(tag, group.single),
                                children: tag.name,
                              },
                              tag.id,
                            );
                          }),
                    ],
                  },
                  group.key,
                ),
              ),
          /* @__PURE__ */ (0, import_jsx_runtime57.jsxs)("span", {
            className: tasks_default.tagCount,
            children: [selectedIds.length, "/", MAX_TAGS],
          }),
        ],
      });
    }

    // src/client/tasks/taskEditHelpers.ts
    function toLocalInput(iso) {
      return iso === null ? "" : iso.slice(0, 16);
    }
    function modalTitle(task, t) {
      return `\u270E No.${String(task.id).padStart(3, "0")} ${t("edit.title")}`;
    }
    function modalAriaLabel(_task, t) {
      return t("edit.title");
    }
    function initialCategoryId(task, data) {
      const fallback = data.categories.find((c) => c.enabled)?.id ?? data.categories[0]?.id;
      return task.categoryId ?? fallback ?? 0;
    }
    function initialTexts(task) {
      return { title: task.title, note: task.note ?? "" };
    }
    function initialTimes(task) {
      return { dueAt: toLocalInput(task.dueAt ?? null), remindAt: toLocalInput(task.remindAt ?? null) };
    }
    function initialFormValues(task, data) {
      return {
        ...initialTexts(task),
        categoryId: initialCategoryId(task, data),
        priority: task.priority,
        ...initialTimes(task),
      };
    }

    // src/client/tasks/TaskEditModal.tsx
    var import_jsx_runtime58 = require("react/jsx-runtime");
    var PRIORITIES = ["low", "normal", "high", "urgent"];
    async function submitTaskUpdate(client, task, form) {
      const result = await client.taskUpdate({
        id: task.id,
        title: form.title,
        note: form.note,
        categoryId: form.categoryId,
        priority: form.priority,
        dueAt: form.dueAt === "" ? null : form.dueAt,
        remindAt: form.remindAt === "" ? null : form.remindAt,
        tagIds: form.tagIds,
      });
      return result.ok ? "" : result.error.message;
    }
    function toggleTagId(tag, single, sameDimIds, setSelected) {
      setSelected((prev) => {
        if (prev.includes(tag.id)) {
          return prev.filter((id) => id !== tag.id);
        }
        let next = prev;
        if (single) {
          const sameDim = sameDimIds.get(tag.dimension) ?? /* @__PURE__ */ new Set();
          next = next.filter((id) => !sameDim.has(id));
        }
        if (next.length >= MAX_TAGS) {
          return next;
        }
        return [...next, tag.id];
      });
    }
    function TaskEditModal({ task, data, readonly = false, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const initial = initialFormValues(task, data);
      const [title, setTitle] = (0, import_react43.useState)(initial.title);
      const [note, setNote] = (0, import_react43.useState)(initial.note);
      const [categoryId, setCategoryId] = (0, import_react43.useState)(initial.categoryId);
      const [priority, setPriority] = (0, import_react43.useState)(initial.priority);
      const [dueAt, setDueAt] = (0, import_react43.useState)(initial.dueAt);
      const [remindAt, setRemindAt] = (0, import_react43.useState)(initial.remindAt);
      const [selectedTagIds, setSelectedTagIds] = (0, import_react43.useState)(() =>
        initialTagIds(task, data.tags ?? []),
      );
      const [saving, setSaving] = (0, import_react43.useState)(false);
      const [error, setError] = (0, import_react43.useState)("");
      const categoryOptions = (0, import_react43.useMemo)(
        () =>
          data.categories
            .filter((c) => c.enabled || c?.id === task?.categoryId)
            .map((c) => ({ value: String(c.id), label: c.name })),
        [data.categories, task?.categoryId],
      );
      const tagGroups = (0, import_react43.useMemo)(() => buildTagGroups(data), [data]);
      const sameDimIds = (0, import_react43.useMemo)(() => {
        const byDim = /* @__PURE__ */ new Map();
        for (const tag of data.tags ?? []) {
          const set = byDim.get(tag.dimension) ?? /* @__PURE__ */ new Set();
          set.add(tag.id);
          byDim.set(tag.dimension, set);
        }
        return byDim;
      }, [data.tags]);
      function toggleTag(tag, single) {
        toggleTagId(tag, single, sameDimIds, setSelectedTagIds);
      }
      async function save() {
        const trimmedTitle = title.trim();
        if (trimmedTitle === "") {
          setError(t("edit.titleRequired"));
          return;
        }
        setSaving(true);
        setError("");
        const form = {
          title: trimmedTitle,
          note,
          categoryId,
          priority,
          dueAt,
          remindAt,
          tagIds: selectedTagIds,
        };
        const failure = await submitTaskUpdate(client, task, form);
        setSaving(false);
        if (failure === "") {
          onChanged();
          onClose();
        } else {
          setError(failure);
        }
      }
      return /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(Modal, {
        title: modalTitle(task, t),
        ariaLabel: modalAriaLabel(task, t),
        actions: [
          {
            label: t("save2"),
            onChoose: () => void save(),
            variant: "primary",
            disabled: saving || readonly,
          },
          { label: t("cancel"), onChoose: onClose },
        ],
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
          className: tasks_default.editForm,
          "data-testid": "task-edit-form",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("label", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.taskTitle"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(TextInput, {
                  value: title,
                  onChange: setTitle,
                  ariaLabel: t("edit.taskTitle"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("label", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.note"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("textarea", {
                  className: tasks_default.editTextarea,
                  rows: 2,
                  value: note,
                  "aria-label": t("edit.note"),
                  onChange: (event) => setNote(event.target.value),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.category"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(Select, {
                  value: String(categoryId),
                  onChange: (value) => setCategoryId(Number(value)),
                  options: categoryOptions,
                  ariaLabel: t("edit.category"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.priority"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(Select, {
                  value: priority,
                  onChange: setPriority,
                  options: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) })),
                  ariaLabel: t("edit.priority"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.due"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(DateTimePicker, {
                  value: dueAt,
                  onChange: setDueAt,
                  ariaLabel: t("edit.due"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.remind"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(DateTimePicker, {
                  value: remindAt,
                  onChange: setRemindAt,
                  ariaLabel: t("edit.remind"),
                }),
              ],
            }),
            /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("div", {
              className: tasks_default.editRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", {
                  className: tasks_default.editRowLabel,
                  children: t("edit.tags"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(TagPicker, {
                  groups: tagGroups,
                  selectedIds: selectedTagIds,
                  onToggle: toggleTag,
                  noTagsLabel: t("edit.noTags"),
                }),
              ],
            }),
            error !== "" &&
              /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)("p", {
                className: tasks_default.editError,
                role: "alert",
                children: ["\u274C ", error],
              }),
          ],
        }),
      });
    }

    // src/client/tasks/TaskDetailDrawer.tsx
    var import_jsx_runtime59 = require("react/jsx-runtime");
    function TaskDetailDrawer({ task, data, categories, onClose, onChanged }) {
      const client = useClient();
      const readonly = data.dbStatus?.mode === "ro";
      const ref = useFocusTrapTarget(onClose);
      const category = categories.find((c) => c.id === task.categoryId);
      const [detail, reloadDetail] = useTaskDetail(client, task.id);
      const logs = useTaskHistory(client, task.id);
      const [editing, setEditing] = (0, import_react44.useState)(false);
      const overlay = (0, import_react44.useMemo)(
        () => (detail === null ? data : overlayDetail(data, task.id, detail)),
        [data, detail, task.id],
      );
      return /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)(import_jsx_runtime59.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("div", {
            className: tasks_default.drawerOverlay,
            onClick: onClose,
            "aria-hidden": "true",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("aside", {
            ref,
            role: "dialog",
            "aria-modal": "true",
            "aria-label": task.title,
            className: tasks_default.drawer,
            "data-testid": "task-drawer",
            tabIndex: -1,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("header", {
                className: tasks_default.drawerHeader,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("h3", {
                    className: tasks_default.drawerTitle,
                    children: ["No.", task.id, " ", task.title],
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("button", {
                    type: "button",
                    className: `${ui_default.button} ${tasks_default.drawerClose}`,
                    onClick: onClose,
                    children: "\u2715",
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
                className: tasks_default.drawerBody,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(SummaryGrid, {
                    task,
                    categoryName: category?.name ?? "-",
                    readonly,
                    onEdit: () => setEditing(true),
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(FollowupStream, {
                    data: overlay,
                    taskId: task.id,
                    onRefresh: reloadDetail,
                    readonly,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(DispatchOps, { task, data, readonly, onChanged }),
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(DispatchTimeline, { data: overlay, taskId: task.id }),
                  /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(HistorySection, { logs }),
                  editing &&
                    /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(TaskEditModal, {
                      task,
                      data,
                      onClose: () => setEditing(false),
                      onChanged,
                    }),
                ],
              }),
            ],
          }),
        ],
      });
    }
    function SummaryGrid({ task, categoryName, readonly, onEdit }) {
      const t = useT();
      const fmt = (iso) => (iso === null ? "\u2014" : iso.slice(0, 16).replace("T", " "));
      const sourceText =
        task.source === "feishu" ? t("entry.feishu") : task.source === "capture" ? t("entry.capture") : task.source;
      return /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
        className: tasks_default.summarySection,
        "data-testid": "task-summary",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("button", {
            type: "button",
            className: `${ui_default.button} ${tasks_default.summaryEdit}`,
            disabled: readonly,
            onClick: onEdit,
            children: ["\u270E ", t("detail.edit")],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
            className: tasks_default.summaryGrid,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, { k: t("edit.category"), v: categoryName }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: t("edit.priority"),
                v: t(`priority.${task.priority}`),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: t("detail.status"),
                v: t(`status.${task.status}`),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, { k: t("edit.due"), v: fmt(task.dueAt) }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, { k: t("edit.remind"), v: fmt(task.remindAt) }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: t("edit.tags"),
                v:
                  task.tags.length === 0
                    ? "\u2014"
                    : /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("span", {
                        className: tasks_default.summaryTags,
                        children: task.tags.map((ref) =>
                          /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)(
                            "i",
                            {
                              className: tasks_default.metaTagChip,
                              "data-project": ref.dimension === "project",
                              children: [ref.dimension === "project" ? "\u26F3 " : "# ", ref.name],
                            },
                            `${ref.dimension}:${ref.name}`,
                          ),
                        ),
                      }),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, { k: t("detail.source"), v: sourceText }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: t("detail.focus"),
                v: `${Math.round(task.focusSeconds / 60)} min`,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: t("detail.created"),
                v: fmt(task.createdAt),
                mono: true,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime59.jsx)(Kv, {
                k: task.status === "cancelled" ? t("detail.escaped") : t("detail.completed"),
                v: fmt(task.completedAt ?? task.cancelledAt),
                mono: true,
              }),
            ],
          }),
        ],
      });
    }
    function Kv({ k, v, mono = false }) {
      return /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
        className: tasks_default.summaryKv,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("span", { className: tasks_default.summaryKey, children: k }),
          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("span", {
            className: mono ? tasks_default.summaryValMono : tasks_default.summaryVal,
            children: v,
          }),
        ],
      });
    }
    function HistorySection({ logs }) {
      const t = useT();
      const { locale } = useI18n();
      const keys = (0, import_react44.useMemo)(() => flattenKeys(MESSAGES[locale]), [locale]);
      const tx = (key, fallback) => (keys.has(key) ? t(key) : fallback);
      const valueText = (field, value) => {
        if (value === null || value === "") {
          return "\u2014";
        }
        return field === "status" ? tx(`status.${value}`, value) : value;
      };
      return /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
        "data-testid": "task-history",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("h4", {
            className: tasks_default.drawerSectionTitle,
            children: t("edit.history"),
          }),
          logs.length === 0
            ? /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("div", {
                className: tasks_default.followupEmpty,
                children: t("edit.noHistory"),
              })
            : logs.map((log) =>
                /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)(
                  "div",
                  {
                    className: tasks_default.historyRow,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
                        className: tasks_default.historyMeta,
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("span", {
                            className: tasks_default.historyOrigin,
                            children: log.origin,
                          }),
                          /* @__PURE__ */ (0, import_jsx_runtime59.jsx)("span", {
                            children: log.createdAt.slice(0, 16).replace("T", " "),
                          }),
                        ],
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime59.jsxs)("div", {
                        className: tasks_default.historyText,
                        children: [
                          tx(`log.${log.action}`, log.action),
                          log.field !== "" &&
                            ` \xB7 ${log.field}: ${valueText(log.field, log.oldValue)} \u2192 ${valueText(log.field, log.newValue)}`,
                        ],
                      }),
                    ],
                  },
                  log.id,
                ),
              ),
        ],
      });
    }
    function useTaskDetail(client, taskId) {
      const [detail, setDetail] = (0, import_react44.useState)(null);
      const [nonce, setNonce] = (0, import_react44.useState)(0);
      (0, import_react44.useEffect)(() => {
        setDetail(null);
        let alive = true;
        void client.taskDetail({ taskId }).then((result) => {
          if (alive && result.ok) {
            setDetail(result.data);
          }
        });
        return () => {
          alive = false;
        };
      }, [client, taskId, nonce]);
      return [detail, () => setNonce((n) => n + 1)];
    }
    function useTaskHistory(client, taskId) {
      const [logs, setLogs] = (0, import_react44.useState)([]);
      (0, import_react44.useEffect)(() => {
        let alive = true;
        void client.taskHistory({ taskId }).then((result) => {
          if (alive && result.ok) {
            setLogs(result.data.logs);
          }
        });
        return () => {
          alive = false;
        };
      }, [client, taskId]);
      return logs;
    }
    function overlayDetail(data, taskId, detail) {
      const seen = /* @__PURE__ */ new Set();
      const sessions = [];
      for (const session of [...detail.timeline, ...data.sessions]) {
        if (!seen.has(session.id)) {
          seen.add(session.id);
          sessions.push(session);
        }
      }
      return {
        ...data,
        followups: { ...data.followups, [taskId]: detail.followups },
        sessions,
      };
    }
    function useFocusTrapTarget(onClose) {
      const [ref, setRef] = (0, import_react44.useState)(null);
      useFocusTrap({ current: ref }, true, onClose);
      return setRef;
    }

    // src/client/tasks/views.tsx
    var import_react50 = require("react");

    // src/client/tasks/TaskQuickOps.tsx
    var import_react45 = require("react");

    // src/client/tasks/TaskReleaseModal.tsx
    var import_jsx_runtime60 = require("react/jsx-runtime");
    function TaskReleaseModal({ task, open, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const undo = useUndoToast();
      if (!open) {
        return undo.toast !== null
          ? /* @__PURE__ */ (0, import_jsx_runtime60.jsx)(UndoToast, { toast: undo.toast, onClose: undo.dismiss })
          : null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime60.jsxs)(import_jsx_runtime60.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime60.jsx)(ConfirmDialog, {
            title: t("entry.release"),
            body: t("dsh.release.confirmBody", { title: task.title }),
            confirmLabel: t("dsh.release.confirmOk"),
            danger: true,
            onCancel: onClose,
            onConfirm: () => {
              onClose();
              void (async () => {
                const result = await client.taskDelete({ taskId: task.id });
                if (result.ok) {
                  undo.show(t("dsh.toast.released", { title: task.title }), {
                    onUndo: () => {
                      void client.taskDeleteUndo({ taskId: task.id }).then(() => onChanged());
                    },
                    onExpire: onChanged,
                  });
                } else {
                  onChanged();
                }
              })();
            },
          }),
          undo.toast !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime60.jsx)(UndoToast, { toast: undo.toast, onClose: undo.dismiss }),
        ],
      });
    }

    // src/client/tasks/TaskQuickOps.tsx
    var import_jsx_runtime61 = require("react/jsx-runtime");
    function TaskQuickOps({ task, readonly, allowSchedule = false, onChanged, onEdit }) {
      const t = useT();
      const client = useClient();
      const [releaseOpen, setReleaseOpen] = (0, import_react45.useState)(false);
      const [scheduling, setScheduling] = (0, import_react45.useState)(false);
      const editable = task.status !== "done" && task.status !== "cancelled";
      const op = (event, run) => {
        event.stopPropagation();
        void run().then(() => onChanged());
      };
      if (!editable) {
        const done = task.status === "done";
        return /* @__PURE__ */ (0, import_jsx_runtime61.jsxs)("span", {
          className: tasks_default.quickOps,
          onClick: (event) => event.stopPropagation(),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("span", {
              className: `${tasks_default.catchMark} ${done ? "" : tasks_default.escapeMark}`,
              "aria-live": "polite",
              children: done ? t("entry.caught") : t("entry.escaped"),
            }),
            /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
              type: "button",
              className: ui_default.button,
              disabled: readonly,
              title: t("entry.undo"),
              onClick: (event) => op(event, () => client.taskUpdate({ id: task.id, status: "scheduled" })),
              children: t("entry.undo"),
            }),
          ],
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime61.jsxs)("span", {
        className: tasks_default.quickOps,
        onClick: (event) => event.stopPropagation(),
        children: [
          task.status === "active"
            ? /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: readonly,
                onClick: (event) => op(event, () => client.taskPause({ taskId: task.id })),
                children: t("entry.pause"),
              })
            : /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: readonly,
                onClick: (event) => op(event, () => client.taskStart({ taskId: task.id })),
                children: t("entry.start"),
              }),
          allowSchedule &&
            /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
              type: "button",
              className: ui_default.button,
              disabled: readonly,
              title: t("entry.route"),
              onClick: () => setScheduling(true),
              children: "\u{1F4C5}",
            }),
          onEdit !== void 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
              type: "button",
              className: ui_default.button,
              disabled: readonly,
              title: t("entry.edit"),
              onClick: () => onEdit(task),
              children: "\u270E",
            }),
          /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly,
            title: t("entry.done"),
            onClick: (event) => op(event, () => client.taskComplete({ taskId: task.id })),
            children: "\u2714",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
            type: "button",
            className: ui_default.button,
            disabled: readonly,
            title: t("entry.escape"),
            onClick: (event) => op(event, () => client.taskCancel({ taskId: task.id, reasonCode: "other" })),
            children: "\u{1F6AA}",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime61.jsx)("button", {
            type: "button",
            className: `${ui_default.button} ${tasks_default.opRelease}`,
            disabled: readonly,
            title: t("entry.release"),
            onClick: () => setReleaseOpen(true),
            children: "\u2715",
          }),
          scheduling &&
            /* @__PURE__ */ (0, import_jsx_runtime61.jsx)(ScheduleModal, {
              task,
              readonly,
              onClose: () => setScheduling(false),
              onChanged: () => {
                setScheduling(false);
                onChanged();
              },
            }),
          /* @__PURE__ */ (0, import_jsx_runtime61.jsx)(TaskReleaseModal, {
            task,
            open: releaseOpen,
            onClose: () => setReleaseOpen(false),
            onChanged,
          }),
        ],
      });
    }
    function ScheduleModal({ task, readonly, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const [due, setDue] = (0, import_react45.useState)(task.dueAt === null ? "" : task.dueAt.slice(0, 16));
      return /* @__PURE__ */ (0, import_jsx_runtime61.jsx)(Modal, {
        title: `\u{1F4C5} ${t("dsh.task.reschedule")}`,
        ariaLabel: t("dsh.task.reschedule"),
        actions: [
          {
            label: t("save2"),
            variant: "primary",
            disabled: readonly,
            onChoose: () => {
              void client.taskReschedule({ taskId: task.id, due }).then(() => onChanged());
            },
          },
          { label: t("cancel"), onChoose: onClose },
        ],
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime61.jsx)(DateTimePicker, {
          value: due,
          onChange: setDue,
          ariaLabel: t("edit.due"),
        }),
      });
    }

    // src/client/tasks/TaskCard.tsx
    var import_jsx_runtime62 = require("react/jsx-runtime");
    var CATEGORY_TYPE_KEYS = { 1: "work", 2: "study", 3: "life", 4: "health", 5: "interest" };
    function TaskCard({ task, category, readonly, allowSchedule = false, onOpen, onChanged, onEdit }) {
      const t = useT();
      const presentation = taskPresentation(task);
      return /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)("div", {
        role: "button",
        tabIndex: 0,
        className: tasks_default.taskCard,
        "data-presentation": presentation,
        "data-task-id": task.id,
        onClick: () => onOpen(),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        },
        children: [
          (presentation === "active" || presentation === "activePaused") &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
              className: tasks_default.runningTag,
              children: presentation === "active" ? `\u266A ${t("entry.catching")}` : `\u23F8 ${t("entry.paused")}`,
            }),
          /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)("span", {
            className: tasks_default.taskNo,
            "aria-hidden": "true",
            children: ["No.", task.id],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime62.jsx)(TaskSprite, { category }),
          /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)("span", {
            className: tasks_default.taskMain,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
                className: tasks_default.taskTitle,
                children: task.title,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime62.jsx)(TaskMeta, { task, category }),
            ],
          }),
          !readonly &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)(TaskQuickOps, {
              task,
              readonly,
              allowSchedule,
              onChanged,
              onEdit,
            }),
        ],
      });
    }
    function TaskSprite({ category }) {
      return /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
        className: tasks_default.taskSprite,
        "aria-label": category?.pokemon ?? "",
        children:
          category !== void 0 && category.sprite !== ""
            ? /* @__PURE__ */ (0, import_jsx_runtime62.jsx)(Sprite, {
                spriteKey: category.sprite,
                alt: category.pokemon,
              })
            : "\u2022",
      });
    }
    function TaskMeta({ task, category }) {
      const t = useT();
      const focusMinutes = Math.floor(task.focusSeconds / 60);
      const dispatchState = task.dispatchState;
      const tooltipKey = dispatchTooltipKey(dispatchState);
      return /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)("span", {
        className: tasks_default.taskMeta,
        children: [
          category !== void 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
              className: tasks_default.typeBadge,
              "data-type": categoryTypeKey(category.id),
              children: category.name,
            }),
          /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
            className: tasks_default.prioDot,
            "data-prio": task.priority,
            "aria-label": t(`priority.${task.priority}`),
          }),
          task.dueAt !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
              children: t("entry.due", { v: task.dueAt.slice(0, 16).replace("T", " ") }),
            }),
          focusMinutes > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", { children: t("entry.focus", { n: focusMinutes }) }),
          task.source !== "local" &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
              children: t(`entry.${task.source === "feishu" ? "feishu" : "capture"}`),
            }),
          task.tags.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
              className: tasks_default.tagList,
              children: task.tags.map((ref) =>
                /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)(
                  "i",
                  {
                    className: tasks_default.metaTagChip,
                    "data-project": ref.dimension === "project",
                    children: [ref.dimension === "project" ? "\u26F3 " : "# ", ref.name],
                  },
                  `${ref.dimension}:${ref.name}`,
                ),
              ),
            }),
          dispatchState !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime62.jsxs)("span", {
              className: tasks_default.dispatchBadge,
              "data-state": dispatchState,
              title: tooltipKey !== null ? t(tooltipKey, { reason: "" }) : void 0,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime62.jsx)("span", {
                  className: tasks_default.dispatchGlyph,
                  children: DISPATCH_GLYPHS[dispatchState],
                }),
                t(`dsh.dispatch.badge.${dispatchState}`),
              ],
            }),
        ],
      });
    }
    var DISPATCH_GLYPHS = { queued: "\u23F3", running: "\u25C9", done: "\u2713", failed: "\u25B2" };
    function categoryTypeKey(categoryId) {
      return CATEGORY_TYPE_KEYS[categoryId];
    }

    // src/client/tasks/TaskList.tsx
    var import_jsx_runtime63 = require("react/jsx-runtime");
    function TaskList({ tasks, categories, readonly, allowSchedule = false, onOpen, onChanged, onEdit }) {
      return /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("div", {
        className: tasks_default.segmentWrap,
        role: "list",
        children: tasks.map((task) =>
          /* @__PURE__ */ (0, import_jsx_runtime63.jsx)(
            TaskCard,
            {
              task,
              category: categories.find((c) => c.id === task.categoryId),
              readonly,
              allowSchedule,
              onOpen: () => onOpen(task.id),
              onChanged,
              onEdit: onEdit !== void 0 ? () => onEdit(task) : void 0,
            },
            task.id,
          ),
        ),
      });
    }
    function EmptyState({ kind }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("div", {
        className: tasks_default.emptyState,
        children: t(`dsh.empty.${kind}`),
      });
    }
    function SkeletonRows({ rows = 3 }) {
      return /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("div", {
        "data-testid": "skeleton-rows",
        "aria-hidden": "true",
        children: Array.from({ length: rows }, (_, index) =>
          /* @__PURE__ */ (0, import_jsx_runtime63.jsxs)(
            "div",
            {
              className: ui_default.skeletonRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("span", { className: ui_default.skeletonSprite }),
                /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("span", {
                  className: ui_default.skeletonLine,
                  style: { width: "60%" },
                }),
                /* @__PURE__ */ (0, import_jsx_runtime63.jsx)("span", {
                  className: ui_default.skeletonLine,
                  style: { width: "20%" },
                }),
              ],
            },
            index,
          ),
        ),
      });
    }

    // src/client/tasks/OverdueFold.tsx
    var import_react46 = require("react");
    var import_jsx_runtime64 = require("react/jsx-runtime");
    function OverdueFold({ tasks, readonly, onChanged }) {
      const t = useT();
      const client = useClient();
      const [expanded, setExpanded] = (0, import_react46.useState)(false);
      const [busy, setBusy] = (0, import_react46.useState)(false);
      if (tasks.length === 0) {
        return null;
      }
      async function sendAllToGrass() {
        setBusy(true);
        for (const task of tasks) {
          await client.taskReschedule({ taskId: task.id, due: "" });
        }
        setBusy(false);
        onChanged();
      }
      return /* @__PURE__ */ (0, import_jsx_runtime64.jsxs)("div", {
        "data-testid": "overdue-fold",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime64.jsxs)("div", {
            className: tasks_default.overdueFold,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime64.jsx)("span", {
                children: t("dsh.overdue.leaked", { n: tasks.length }),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime64.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: readonly || busy,
                onClick: () => void sendAllToGrass(),
                children: t("overdue.fresh"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime64.jsx)("button", {
                type: "button",
                className: ui_default.button,
                "aria-expanded": expanded,
                onClick: () => setExpanded((v) => !v),
                children: expanded ? t("im.collapse") : t("dsh.overdue.expand"),
              }),
            ],
          }),
          expanded &&
            /* @__PURE__ */ (0, import_jsx_runtime64.jsx)("div", {
              className: tasks_default.overdueList,
              children: tasks.map((task) =>
                /* @__PURE__ */ (0, import_jsx_runtime64.jsxs)(
                  "span",
                  { className: ui_default.muted, children: ["No.", task.id, " ", task.title] },
                  task.id,
                ),
              ),
            }),
        ],
      });
    }

    // src/client/tasks/ReviewWizard.tsx
    var import_react48 = require("react");

    // src/client/tasks/ReviewWizardSteps.tsx
    var import_jsx_runtime65 = require("react/jsx-runtime");
    function fmtLocal(iso) {
      return iso.slice(0, 16).replace("T", " ");
    }
    function isOverdueToday(task) {
      return task.dueAt !== null && task.dueAt.slice(0, 10) <= /* @__PURE__ */ new Date().toISOString().slice(0, 10);
    }
    function StepsBar({ step, labels }) {
      return /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
        className: tasks_default.reviewSteps,
        children: labels.map((label, i) =>
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(
            "span",
            {
              className: tasks_default.reviewStepDot,
              "data-on": i === step,
              "data-past": i < step,
              children: [i < step ? "\u2714" : i + 1, " ", label],
            },
            label,
          ),
        ),
      });
    }
    function OverviewStep({ caught, focusMin, routeCount, grassCount, byCategory, total }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(import_jsx_runtime65.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
            className: tasks_default.reviewStats,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStat,
                "data-testid": "review-stat-caught",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatNum,
                    children: caught,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatLbl,
                    children: t("review.caughtWeek"),
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStat,
                "data-testid": "review-stat-focus",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatNum,
                    children: focusMin,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatLbl,
                    children: t("review.focusWeek"),
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStat,
                "data-testid": "review-stat-route",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatNum,
                    children: routeCount,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatLbl,
                    children: t("review.onRoute"),
                  }),
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStat,
                "data-testid": "review-stat-grass",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatNum,
                    children: grassCount,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                    className: tasks_default.reviewStatLbl,
                    children: t("review.inGrass"),
                  }),
                ],
              }),
            ],
          }),
          byCategory.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
              className: tasks_default.reviewBars,
              children: byCategory.map(([name, n]) =>
                /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(
                  "div",
                  {
                    className: tasks_default.reviewBarRow,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                        className: tasks_default.reviewBarName,
                        children: name,
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                        className: tasks_default.reviewBarTrack,
                        role: "presentation",
                        children: /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                          className: tasks_default.reviewBarFill,
                          style: { width: `${Math.min(100, (n / total) * 100)}%` },
                        }),
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                        className: tasks_default.reviewBarN,
                        children: n,
                      }),
                    ],
                  },
                  name,
                ),
              ),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
            className: tasks_default.reviewTip,
            children: t("review.overviewTip"),
          }),
        ],
      });
    }
    function RouteStep({ task, index, total, busy, categoryName, onAction }) {
      const t = useT();
      if (task === null) {
        return /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
          className: tasks_default.reviewEmpty,
          children: t("review.routeEmpty"),
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(import_jsx_runtime65.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
            className: tasks_default.reviewStation,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStNo,
                children: ["No.", String(task.id).padStart(3, "0")],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
                className: tasks_default.reviewStTitle,
                children: task.title,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
                className: tasks_default.reviewStMeta,
                children: [
                  task.dueAt !== null &&
                    /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("span", {
                      "data-overdue": isOverdueToday(task),
                      children: [
                        "\u{1F552} ",
                        fmtLocal(task.dueAt),
                        isOverdueToday(task) ? ` \xB7 ${t("review.overdue")}` : "",
                      ],
                    }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", { children: categoryName }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", { children: t(`priority.${task.priority}`) }),
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", { children: t(`status.${task.status}`) }),
                ],
              }),
              task.note
                ? /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
                    className: tasks_default.reviewStNote,
                    children: task.note,
                  })
                : null,
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
            className: tasks_default.reviewBtnRow,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: busy,
                onClick: () => onAction("keep"),
                children: t("review.keep"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("button", {
                type: "button",
                className: ui_default.button,
                disabled: busy,
                onClick: () => onAction("done"),
                children: ["\u2714 ", t("review.complete")],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("button", {
                type: "button",
                className: `${ui_default.button} ${tasks_default.reviewGhost}`,
                disabled: busy,
                onClick: () => onAction("toGrass"),
                children: t("review.toGrass"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("button", {
                type: "button",
                className: `${ui_default.button} ${tasks_default.reviewGhost}`,
                disabled: busy,
                onClick: () => onAction("escape"),
                children: ["\u{1F6AA} ", t("review.escape")],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("p", {
            className: tasks_default.reviewTip,
            children: [index + 1, " / ", total, " \xB7 ", t("review.routeTip")],
          }),
        ],
      });
    }
    function GrassStep({
      tasks,
      selected,
      allSelected,
      releasedCount,
      busy,
      onToggleAll,
      onToggleOne,
      onRelease,
      categoryNameOf,
    }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(import_jsx_runtime65.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
            className: tasks_default.reviewGrassHead,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("label", {
                className: tasks_default.reviewBatchCheck,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("input", {
                    type: "checkbox",
                    checked: allSelected,
                    onChange: onToggleAll,
                  }),
                  t("review.selectAllGrass"),
                  "\uFF08",
                  tasks.length,
                  "\uFF09",
                ],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("button", {
                type: "button",
                className: `${ui_default.button} ${tasks_default.reviewGhost}`,
                disabled: selected.size === 0 || busy,
                onClick: onRelease,
                children: [
                  "\u{1F33F} ",
                  t("review.releaseGrass"),
                  selected.size > 0 ? `\uFF08${selected.size}\uFF09` : "",
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("ul", {
            className: tasks_default.reviewGrassList,
            children: [
              tasks.length === 0 &&
                /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("li", {
                  className: tasks_default.reviewEmpty,
                  children: t("review.grassEmpty"),
                }),
              tasks.map((g) =>
                /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)(
                  "li",
                  {
                    className: tasks_default.reviewGrassItem,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("input", {
                        type: "checkbox",
                        checked: selected.has(g.id),
                        onChange: () => onToggleOne(g.id),
                        "aria-label": g.title,
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                        className: tasks_default.reviewGrassTitle,
                        children: g.title,
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("span", {
                        className: tasks_default.reviewGrassCat,
                        children: categoryNameOf(g.categoryId),
                      }),
                    ],
                  },
                  g.id,
                ),
              ),
            ],
          }),
          releasedCount > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
              className: tasks_default.reviewTip,
              children: t("review.released", { n: releasedCount }),
            }),
        ],
      });
    }
    function FinishStep({ n }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime65.jsxs)("div", {
        className: tasks_default.reviewFin,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("div", {
            className: tasks_default.reviewFinEmoji,
            children: "\u{1F389}",
          }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
            className: tasks_default.reviewFinLine,
            children: t("review.finishLine", { n }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime65.jsx)("p", {
            className: tasks_default.reviewTip,
            children: t("review.finishTip"),
          }),
        ],
      });
    }

    // src/client/tasks/ReviewWizardTags.tsx
    var import_jsx_runtime66 = require("react/jsx-runtime");
    function dimNameOf(dimensions, key) {
      return dimensions.find((d) => d.key === key)?.name ?? key;
    }
    function originLabel(t, origin) {
      const key = `review.tagOrigin.${origin}`;
      const label = t(key);
      return label === key ? origin : label;
    }
    function TagsStep(props) {
      const t = useT();
      if (props.checking) {
        return /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("p", {
          className: tasks_default.reviewEmpty,
          children: t("review.tagChecking"),
        });
      }
      if (props.error !== "") {
        return /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("p", {
          className: tasks_default.reviewEmpty,
          children: [
            t("review.tagCheckFailed"),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("button", {
              type: "button",
              className: `${ui_default.button} ${tasks_default.reviewMini}`,
              onClick: props.onRetry,
              children: t("review.tagRetry"),
            }),
          ],
        });
      }
      return props.checkup !== null ? /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(TagGroups, { ...props }) : null;
    }
    function TagGroups(props) {
      const t = useT();
      const checkup = props.checkup;
      const empty = checkup.merges.length === 0 && checkup.zombies.length === 0 && checkup.newDimensions.length === 0;
      return /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)(import_jsx_runtime66.Fragment, {
        children: [
          checkup.merges.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("section", {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("h4", {
                  className: tasks_default.reviewTgTitle,
                  children: t("review.tagMerges"),
                }),
                checkup.merges.map((m) =>
                  /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(
                    MergeRowView,
                    {
                      row: m,
                      dimensions: props.dimensions,
                      busy: props.tagBusy,
                      onMerge: props.onMerge,
                      onIgnore: props.onIgnoreMerge,
                    },
                    m.fromId,
                  ),
                ),
              ],
            }),
          checkup.zombies.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("section", {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("h4", {
                  className: tasks_default.reviewTgTitle,
                  children: t("review.tagZombies"),
                }),
                checkup.zombies.map((z) =>
                  /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(
                    ZombieRowView,
                    {
                      row: z,
                      dimensions: props.dimensions,
                      busy: props.tagBusy,
                      onRelease: props.onReleaseZombie,
                      onKeep: props.onKeepZombie,
                    },
                    z.id,
                  ),
                ),
              ],
            }),
          checkup.newDimensions.length > 0 &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("section", {
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("h4", {
                  className: tasks_default.reviewTgTitle,
                  children: t("review.tagNewDims"),
                }),
                checkup.newDimensions.map((d) =>
                  /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(
                    DimRowView,
                    {
                      row: d,
                      busy: props.tagBusy,
                      onAdopt: props.onAdopt,
                      onIgnore: props.onIgnoreDimension,
                    },
                    d.name,
                  ),
                ),
              ],
            }),
          empty &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("p", {
              className: tasks_default.reviewEmpty,
              children: t("review.tagClean"),
            }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("p", {
            className: tasks_default.reviewTip,
            children: checkup.judged ? t("review.tagTip") : t("review.tagUnjudged"),
          }),
        ],
      });
    }
    function MergeRowView({ row, dimensions, busy, onMerge, onIgnore }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("div", {
        className: tasks_default.reviewTgRow,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("span", {
            className: tasks_default.reviewTgMain,
            children: [
              "\u300C",
              row.fromName,
              "\u300D\u2192\u300C",
              row.intoName,
              "\u300D",
              /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("i", {
                className: tasks_default.reviewTgDim,
                children: [dimNameOf(dimensions, row.dimension), " \xB7 ", Math.round(row.similarity * 100), "%"],
              }),
            ],
          }),
          row.reason !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("span", {
              className: tasks_default.reviewTgReason,
              children: ["\u{1F4A1} ", row.reason],
            }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagMerge"),
            disabled: busy,
            onClick: () => onMerge(row),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagIgnore"),
            disabled: busy,
            del: true,
            onClick: () => onIgnore(row),
          }),
        ],
      });
    }
    function ZombieRowView({ row, dimensions, busy, onRelease, onKeep }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("div", {
        className: tasks_default.reviewTgRow,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("span", {
            className: tasks_default.reviewTgMain,
            children: [
              "# ",
              row.name,
              /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("i", {
                className: tasks_default.reviewTgDim,
                children: [
                  dimNameOf(dimensions, row.dimension),
                  " \xB7 ",
                  originLabel(t, row.origin),
                  " \xB7 ",
                  fmtLocal(row.createdAt),
                ],
              }),
            ],
          }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagRelease"),
            disabled: busy,
            del: true,
            onClick: () => onRelease(row),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagKeep"),
            disabled: busy,
            onClick: () => onKeep(row),
          }),
        ],
      });
    }
    function DimRowView({ row, busy, onAdopt, onIgnore }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("div", {
        className: tasks_default.reviewTgRow,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("span", {
            className: tasks_default.reviewTgMain,
            children: [row.name, "\uFF1A", row.tags.join("\u3001")],
          }),
          row.reason !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime66.jsxs)("span", {
              className: tasks_default.reviewTgReason,
              children: ["\u{1F4A1} ", row.reason],
            }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagAdopt"),
            disabled: busy,
            onClick: () => onAdopt(row),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime66.jsx)(MiniButton, {
            label: t("review.tagIgnore"),
            disabled: busy,
            del: true,
            onClick: () => onIgnore(row),
          }),
        ],
      });
    }
    function MiniButton({ label, disabled, del = false, onClick }) {
      return /* @__PURE__ */ (0, import_jsx_runtime66.jsx)("button", {
        type: "button",
        className: del
          ? `${ui_default.button} ${tasks_default.reviewMini} ${tasks_default.reviewDel}`
          : `${ui_default.button} ${tasks_default.reviewMini}`,
        disabled,
        onClick,
        children: label,
      });
    }

    // src/client/tasks/useReviewTagCheckup.ts
    var import_react47 = require("react");
    function useCheckupFetch(client) {
      const [checking, setChecking] = (0, import_react47.useState)(false);
      const [error, setError] = (0, import_react47.useState)("");
      const fetchReport = (0, import_react47.useCallback)(
        async (apply2) => {
          setChecking(true);
          setError("");
          try {
            const result = await client.tagCheckup();
            if (result.ok) {
              apply2(result.data);
            } else {
              setError(result.error.message);
            }
          } catch (err) {
            setError(String(err));
          } finally {
            setChecking(false);
          }
        },
        [client],
      );
      return { checking, error, fetch: fetchReport };
    }
    function useReviewTagCheckup(active, tags, onChanged) {
      const client = useClient();
      const [checkup, setCheckup] = (0, import_react47.useState)(null);
      const [tagBusy, setTagBusy] = (0, import_react47.useState)(false);
      const { checking, error, fetch } = useCheckupFetch(client);
      (0, import_react47.useEffect)(() => {
        if (active && checkup === null) {
          void fetch(setCheckup);
        }
      }, [active, checkup, fetch]);
      async function doTagAction(fn) {
        if (tagBusy) return;
        setTagBusy(true);
        try {
          if (await fn()) {
            onChanged();
          }
        } finally {
          setTagBusy(false);
        }
      }
      const drop = (section, row) =>
        setCheckup((prev) => (prev === null ? prev : { ...prev, [section]: prev[section].filter((x) => x !== row) }));
      return {
        checkup,
        checking,
        error,
        tagBusy,
        runCheckup: () => void fetch(setCheckup),
        mergeTagRow: (m) => void doTagAction(() => mergeRowOn(client, m, drop)),
        ignoreMerge: (m) => drop("merges", m),
        releaseZombie: (z) => void doTagAction(() => releaseZombieOn(client, z, drop)),
        keepZombie: (z) => drop("zombies", z),
        adoptDimension: (d) => void doTagAction(() => adoptDimensionOn(client, d, tags, drop)),
        ignoreDimension: (d) => drop("newDimensions", d),
      };
    }
    async function mergeRowOn(client, m, drop) {
      const result = await client.tagMerge({ fromId: m.fromId, intoId: m.intoId });
      if (!result.ok) return false;
      drop("merges", m);
      return true;
    }
    async function releaseZombieOn(client, z, drop) {
      const result = await client.tagDelete({ id: z.id });
      if (!result.ok) return false;
      drop("zombies", z);
      return true;
    }
    async function adoptDimensionOn(client, d, tags, drop) {
      const ids = d.tags.map((name) => tags.find((x) => x.name === name)?.id).filter((v) => v != null);
      if (ids.length === 0) {
        drop("newDimensions", d);
        return true;
      }
      const slug = d.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const key = slug || `dim-${Date.now().toString(36)}`;
      const result = await client.tagMoveDimension({ tagIds: ids, key, name: d.name });
      if (!result.ok) return false;
      drop("newDimensions", d);
      return true;
    }

    // src/client/tasks/ReviewWizard.tsx
    var import_jsx_runtime67 = require("react/jsx-runtime");
    var STEPS = 5;
    var WEEK_MS = 7 * 864e5;
    function parseCompletedAt(iso) {
      return Date.parse(iso.length === 16 ? `${iso}:00` : iso);
    }
    function footerActions(step, hasCurrent, busy, t, onNext, onFinish, onClose) {
      if (step < STEPS - 1) {
        return [
          {
            label: step === 1 && hasCurrent ? t("review.skipRoute") : t("review.next"),
            onChoose: onNext,
            variant: "primary",
            disabled: busy,
          },
          { label: t("cancel"), onChoose: onClose },
        ];
      }
      return [
        { label: t("review.finish"), onChoose: onFinish, variant: "primary" },
        { label: t("cancel"), onChoose: onClose },
      ];
    }
    function ReviewWizard({ data, onClose, onChanged }) {
      const t = useT();
      const client = useClient();
      const [step, setStep] = (0, import_react48.useState)(0);
      const [busy, setBusy] = (0, import_react48.useState)(false);
      const openTasks = (0, import_react48.useMemo)(
        () => data.tasks.filter((t0) => t0.status !== "done" && t0.status !== "cancelled"),
        [data.tasks],
      );
      const weekDone = (0, import_react48.useMemo)(
        () =>
          data.tasks.filter((t0) => {
            if (t0.status !== "done" || t0.completedAt === null) return false;
            const ms = parseCompletedAt(t0.completedAt);
            return Number.isFinite(ms) && Date.now() - ms < WEEK_MS;
          }),
        [data.tasks],
      );
      const weekFocusMin = Math.round(weekDone.reduce((sum, task) => sum + task.focusSeconds, 0) / 60);
      const byCategory = (0, import_react48.useMemo)(() => {
        const map = /* @__PURE__ */ new Map();
        for (const task of weekDone) {
          const name = data.categories.find((c) => c.id === task.categoryId)?.name ?? "?";
          map.set(name, (map.get(name) ?? 0) + 1);
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
      }, [weekDone, data.categories]);
      const routeTasks = (0, import_react48.useMemo)(
        () => openTasks.filter((t0) => t0.status === "scheduled" || t0.status === "active" || t0.status === "paused"),
        [openTasks],
      );
      const [routeIdx, setRouteIdx] = (0, import_react48.useState)(0);
      const [routeDoneCount, setRouteDoneCount] = (0, import_react48.useState)(0);
      const current = routeTasks[routeIdx] ?? null;
      (0, import_react48.useEffect)(() => {
        if (routeTasks.length > 0 && routeIdx >= routeTasks.length) {
          setRouteIdx(routeTasks.length - 1);
        }
      }, [routeTasks.length, routeIdx]);
      async function routeAction(action) {
        const task = current;
        if (task === null || busy) return;
        if (action === "keep") {
          setRouteIdx((i) => i + 1);
          return;
        }
        setBusy(true);
        try {
          if (action === "done") {
            const result = await client.taskUpdate({ id: task.id, status: "done" });
            if (!result.ok) return;
            setRouteDoneCount((n) => n + 1);
          } else if (action === "toGrass") {
            const result = await client.taskUpdate({ id: task.id, dueAt: null });
            if (!result.ok) return;
          } else {
            const result = await client.taskUpdate({ id: task.id, status: "cancelled" });
            if (!result.ok) return;
          }
          onChanged();
        } finally {
          setBusy(false);
        }
      }
      const grassTasks2 = (0, import_react48.useMemo)(
        () => openTasks.filter((t0) => t0.status === "inbox"),
        [openTasks],
      );
      const [grassSelected, setGrassSelected] = (0, import_react48.useState)(/* @__PURE__ */ new Set());
      const grassAllSelected = grassTasks2.length > 0 && grassTasks2.every((t0) => grassSelected.has(t0.id));
      const [releasedCount, setReleasedCount] = (0, import_react48.useState)(0);
      function toggleGrassAll() {
        setGrassSelected(grassAllSelected ? /* @__PURE__ */ new Set() : new Set(grassTasks2.map((t0) => t0.id)));
      }
      function toggleGrassOne(id) {
        setGrassSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      }
      async function releaseGrass() {
        if (busy || grassSelected.size === 0) return;
        setBusy(true);
        try {
          for (const id of [...grassSelected]) {
            const result = await client.taskDelete({ taskId: id });
            if (!result.ok) break;
            setReleasedCount((n) => n + 1);
          }
          setGrassSelected(/* @__PURE__ */ new Set());
          onChanged();
        } finally {
          setBusy(false);
        }
      }
      const tags = useReviewTagCheckup(step === 3, data.tags ?? [], onChanged);
      async function finish() {
        const today = /* @__PURE__ */ new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
          today.getDate(),
        ).padStart(2, "0")}`;
        await client.configWrite({ keyValues: { review_last_done: date } }).catch(() => {});
        onChanged();
        onClose();
      }
      function goNext() {
        setStep((s) => Math.min(s + 1, STEPS - 1));
      }
      const categoryNameOf = (id) => data.categories.find((c) => c.id === id)?.name;
      const stepLabels = [
        t("review.stepOverview"),
        t("review.stepRoute"),
        t("review.stepGrass"),
        t("review.stepTags"),
        t("review.stepDone"),
      ];
      const bodies = [
        /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(
          OverviewStep,
          {
            caught: weekDone.length,
            focusMin: weekFocusMin,
            routeCount: routeTasks.length,
            grassCount: grassTasks2.length,
            byCategory,
            total: weekDone.length || 1,
          },
          0,
        ),
        /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(
          RouteStep,
          {
            task: current,
            index: routeIdx,
            total: routeTasks.length,
            busy,
            categoryName: current === null ? void 0 : categoryNameOf(current.categoryId),
            onAction: (action) => void routeAction(action),
          },
          1,
        ),
        /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(
          GrassStep,
          {
            tasks: grassTasks2,
            selected: grassSelected,
            allSelected: grassAllSelected,
            releasedCount,
            busy,
            onToggleAll: toggleGrassAll,
            onToggleOne: toggleGrassOne,
            onRelease: () => void releaseGrass(),
            categoryNameOf,
          },
          2,
        ),
        /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(
          TagsStep,
          {
            checking: tags.checking,
            error: tags.error,
            checkup: tags.checkup,
            tagBusy: tags.tagBusy,
            dimensions: data.dimensions ?? [],
            onRetry: tags.runCheckup,
            onMerge: tags.mergeTagRow,
            onIgnoreMerge: tags.ignoreMerge,
            onReleaseZombie: tags.releaseZombie,
            onKeepZombie: tags.keepZombie,
            onAdopt: tags.adoptDimension,
            onIgnoreDimension: tags.ignoreDimension,
          },
          3,
        ),
        /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(FinishStep, { n: weekDone.length + routeDoneCount }, 4),
      ];
      return /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(Modal, {
        title: `\u{1F9E2} ${t("review.title")}`,
        ariaLabel: t("review.title"),
        actions: footerActions(step, current !== null, busy, t, goNext, () => void finish(), onClose),
        onClose,
        children: /* @__PURE__ */ (0, import_jsx_runtime67.jsxs)("div", {
          className: tasks_default.reviewBody,
          "data-testid": "review-wizard",
          "data-step": step,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime67.jsx)(StepsBar, { step, labels: stepLabels }),
            bodies[step],
          ],
        }),
      });
    }

    // src/client/tasks/TaskSearchBar.tsx
    var import_react49 = require("react");
    var import_jsx_runtime68 = require("react/jsx-runtime");
    var SEARCH_DEBOUNCE_MS = 300;
    function TaskSearchShell({ data, readonly, onOpen, onChanged, onEdit, children }) {
      const t = useT();
      const client = useClient();
      const [query, setQuery] = (0, import_react49.useState)("");
      const [results, setResults] = (0, import_react49.useState)(null);
      const [searching, setSearching] = (0, import_react49.useState)(false);
      const seqRef = (0, import_react49.useRef)(0);
      const trimmed = query.trim();
      const searchMode = trimmed !== "";
      (0, import_react49.useEffect)(() => {
        if (trimmed === "") {
          seqRef.current += 1;
          setResults(null);
          setSearching(false);
          return;
        }
        setSearching(true);
        const seq = ++seqRef.current;
        const timer = setTimeout(() => {
          void client.taskSearch({ query: trimmed }).then((result) => {
            if (seq !== seqRef.current) {
              return;
            }
            setResults(result.ok ? result.data.tasks : []);
            setSearching(false);
          });
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
      }, [trimmed, client]);
      return /* @__PURE__ */ (0, import_jsx_runtime68.jsxs)(import_jsx_runtime68.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime68.jsxs)("div", {
            className: tasks_default.searchBar,
            "data-testid": "task-search",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime68.jsx)("input", {
                className: tasks_default.searchInput,
                value: query,
                placeholder: t("search.placeholder"),
                "aria-label": t("search.placeholder"),
                onChange: (event) => setQuery(event.target.value),
              }),
              searchMode &&
                /* @__PURE__ */ (0, import_jsx_runtime68.jsx)("span", {
                  className: tasks_default.searchHint,
                  children: searching ? t("search.searching") : t("search.resultCount", { n: results?.length ?? 0 }),
                }),
            ],
          }),
          searchMode
            ? results === null
              ? null
              : results.length === 0
                ? /* @__PURE__ */ (0, import_jsx_runtime68.jsx)("div", {
                    className: tasks_default.emptyState,
                    children: t("search.empty"),
                  })
                : /* @__PURE__ */ (0, import_jsx_runtime68.jsx)(TaskList, {
                    tasks: results,
                    categories: data.categories,
                    readonly,
                    onOpen,
                    onChanged,
                    onEdit,
                  })
            : children,
        ],
      });
    }

    // src/client/tasks/views.tsx
    var import_jsx_runtime69 = require("react/jsx-runtime");
    function useTaskEditor(data, readonly, onChanged) {
      const [editing, setEditing] = (0, import_react50.useState)(null);
      return {
        openEdit: setEditing,
        modal:
          editing !== null
            ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskEditModal, {
                task: editing,
                data,
                readonly,
                onClose: () => setEditing(null),
                onChanged,
              })
            : null,
      };
    }
    function AdventureView({ data, readonly, onOpen, onChanged }) {
      const editor = useTaskEditor(data, readonly, onChanged);
      const snapshot = (0, import_react50.useMemo)(
        () => adventureSnapshot(data.tasks, data.today),
        [data.tasks, data.today],
      );
      return /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(import_jsx_runtime69.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskSearchShell, {
            data,
            readonly,
            onOpen,
            onChanged,
            onEdit: editor.openEdit,
            children: /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("section", {
              className: tasks_default.segmentWrap,
              "data-testid": "segment-adventure",
              children:
                data.loading === true
                  ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(SkeletonRows, {})
                  : /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(import_jsx_runtime69.Fragment, {
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(OverdueFold, {
                          tasks: snapshot.overdueTasks,
                          readonly,
                          onChanged,
                        }),
                        snapshot.todayTasks.length === 0 && snapshot.overdueTasks.length === 0
                          ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(EmptyState, { kind: "tasks" })
                          : /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskList, {
                              tasks: snapshot.todayTasks,
                              categories: data.categories,
                              readonly,
                              onOpen,
                              onChanged,
                              onEdit: editor.openEdit,
                            }),
                      ],
                    }),
            }),
          }),
          editor.modal,
        ],
      });
    }
    function RouteView({ data, readonly, onOpen, onChanged }) {
      const editor = useTaskEditor(data, readonly, onChanged);
      const groups = (0, import_react50.useMemo)(() => routeGroups(data.tasks), [data.tasks]);
      const categories = data.categories;
      let body;
      if (data.loading === true) {
        body = /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(SkeletonRows, { rows: 4 });
      } else if (groups.length === 0) {
        body = /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(EmptyState, { kind: "tasks" });
      } else {
        body = /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("section", {
          className: tasks_default.segmentWrap,
          "data-testid": "segment-route",
          children: groups.map((group) =>
            /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(
              "div",
              {
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("h4", {
                    className: tasks_default.routeGroupDate,
                    children: group.date,
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskList, {
                    tasks: group.tasks,
                    categories,
                    readonly,
                    onOpen,
                    onChanged,
                    onEdit: editor.openEdit,
                  }),
                ],
              },
              group.date,
            ),
          ),
        });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(import_jsx_runtime69.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskSearchShell, {
            data,
            readonly,
            onOpen,
            onChanged,
            onEdit: editor.openEdit,
            children: body,
          }),
          editor.modal,
        ],
      });
    }
    function GrassView({ data, readonly, onOpen, onChanged }) {
      const editor = useTaskEditor(data, readonly, onChanged);
      const tasks = (0, import_react50.useMemo)(() => grassTasks(data.tasks), [data.tasks]);
      return /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(import_jsx_runtime69.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskSearchShell, {
            data,
            readonly,
            onOpen,
            onChanged,
            onEdit: editor.openEdit,
            children: /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("section", {
              "data-testid": "segment-grass",
              className: tasks_default.segmentWrap,
              children:
                data.loading === true
                  ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(SkeletonRows, {})
                  : tasks.length === 0
                    ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(EmptyState, { kind: "tasks" })
                    : /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskList, {
                        tasks,
                        categories: data.categories,
                        readonly,
                        allowSchedule: true,
                        onOpen,
                        onChanged,
                        onEdit: editor.openEdit,
                      }),
            }),
          }),
          editor.modal,
        ],
      });
    }
    function DexView({ data, readonly, onOpen, onChanged }) {
      const t = useT();
      const editor = useTaskEditor(data, readonly, onChanged);
      const [filter, setFilter] = (0, import_react50.useState)("all");
      const [reviewOpen, setReviewOpen] = (0, import_react50.useState)(false);
      const stats = (0, import_react50.useMemo)(() => dexStats(data.tasks), [data.tasks]);
      const archived = data.tasks.filter((t0) => t0.status === "done" || t0.status === "cancelled");
      const shown = archived.filter((task) => filter === "all" || task.status === filter);
      return /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)(import_jsx_runtime69.Fragment, {
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskSearchShell, {
            data,
            readonly,
            onOpen,
            onChanged,
            onEdit: editor.openEdit,
            children: /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)("section", {
              className: tasks_default.segmentWrap,
              "data-testid": "segment-dex",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("div", {
                  className: tasks_default.dexStatsLine,
                  children: t("dexStats.line", { caught: stats.caught, escaped: stats.escaped }),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime69.jsx)("div", {
                  className: tasks_default.dexMilestone,
                  children: t(`dexStats.milestone.${stats.milestone}`, { n: stats.milestoneParam }),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)("div", {
                  className: tasks_default.dexFilters,
                  role: "group",
                  "aria-label": t("dexFilter.all"),
                  children: [
                    ["all", "done", "cancelled"].map((key) =>
                      /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(
                        "button",
                        {
                          type: "button",
                          className: tasks_default.filterButton,
                          "aria-pressed": filter === key,
                          onClick: () => setFilter(key),
                          children: t(`dexFilter.${key}`),
                        },
                        key,
                      ),
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime69.jsxs)("button", {
                      type: "button",
                      className: `${tasks_default.filterButton} ${tasks_default.reviewEntry}`,
                      disabled: readonly,
                      onClick: () => setReviewOpen(true),
                      children: ["\u{1F9E2} ", t("review.entry")],
                    }),
                  ],
                }),
                shown.length === 0
                  ? /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(EmptyState, { kind: "tasks" })
                  : /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(TaskList, {
                      tasks: shown,
                      categories: data.categories,
                      readonly,
                      onOpen,
                      onChanged,
                      onEdit: editor.openEdit,
                    }),
              ],
            }),
          }),
          editor.modal,
          reviewOpen &&
            /* @__PURE__ */ (0, import_jsx_runtime69.jsx)(ReviewWizard, {
              data,
              onClose: () => setReviewOpen(false),
              onChanged,
            }),
        ],
      });
    }

    // src/client/tasks/SessionsView.tsx
    var import_react51 = require("react");
    var import_jsx_runtime70 = require("react/jsx-runtime");
    var GROUPS = ["all", "radio", "dispatch", "other"];
    var LIMIT_OPTIONS = [20, 50, 100];
    function replayable(row) {
      return row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
    }
    function deploymentGone(alias, list) {
      if (alias === "" || list === null) {
        return false;
      }
      return !list.deployments.some((d) => d.alias === alias);
    }
    function kindLabel(t, kind) {
      const key = `sess.kind.${kind}`;
      const label = t(key);
      return label === key ? kind : label;
    }
    function LogSegment({ readonly }) {
      const t = useT();
      const client = useClient();
      const [group, setGroup] = (0, import_react51.useState)("all");
      const [limit, setLimit] = (0, import_react51.useState)(20);
      const [offset, setOffset] = (0, import_react51.useState)(0);
      const [page, setPage] = (0, import_react51.useState)(null);
      const [loading, setLoading] = (0, import_react51.useState)(true);
      const [deployments, setDeployments] = (0, import_react51.useState)(null);
      const [note, setNote] = (0, import_react51.useState)(null);
      (0, import_react51.useEffect)(() => {
        void client.deploymentList().then((result) => {
          if (result.ok) {
            setDeployments(result.data);
          }
        });
      }, [client]);
      (0, import_react51.useEffect)(() => {
        let alive = true;
        setLoading(true);
        void client
          .sessionsPage({ group, limit, offset })
          .then((result) => {
            if (!alive) {
              return;
            }
            if (result.ok) {
              setPage({ rows: result.data.rows, total: result.data.total });
            } else {
              setPage((prev) => prev ?? { rows: [], total: 0 });
            }
          })
          .finally(() => {
            if (alive) {
              setLoading(false);
            }
          });
        return () => {
          alive = false;
        };
      }, [client, group, limit, offset]);
      const rows = page?.rows ?? [];
      const total = page?.total ?? 0;
      const pages = Math.max(1, Math.ceil(total / limit));
      const current = Math.min(pages, Math.floor(offset / limit) + 1);
      async function replay(row) {
        setNote(null);
        const result = await client.sessionReplay({ rowId: row.id });
        if (result.ok) {
          const world = result.data.routed.world;
          setNote(
            world === "local"
              ? t("dsh.sess.replayOpened", { world: t("dsh.sess.worldLocal") })
              : t("dsh.sess.replayOpened", {
                  world: t("dsh.sess.worldDeployment", { alias: world.deploymentAlias }),
                }),
          );
          return;
        }
        if (isErrorCode(result.error, "DEPLOYMENT_NOT_READY")) {
          setNote(t("dsh.sess.replayGone"));
          return;
        }
        setNote(`\u274C ${result.error.message}`);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)("section", {
        className: tasks_default.segmentWrap,
        "data-testid": "segment-logs",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("div", {
            className: tasks_default.dexFilters,
            role: "group",
            "aria-label": t("sess.filter_all"),
            children: GROUPS.map((key) =>
              /* @__PURE__ */ (0, import_jsx_runtime70.jsx)(
                "button",
                {
                  type: "button",
                  className: tasks_default.filterButton,
                  "aria-pressed": group === key,
                  onClick: () => {
                    setGroup(key);
                    setOffset(0);
                  },
                  children: t(`dsh.sess.group.${key}`),
                },
                key,
              ),
            ),
          }),
          total === 0 && !loading
            ? group === "all"
              ? /* @__PURE__ */ (0, import_jsx_runtime70.jsx)(EmptyState, { kind: "dispatch" })
              : /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("p", {
                  className: tasks_default.emptyState,
                  "data-testid": "session-group-empty",
                  children: t("dsh.sess.emptyGroup"),
                })
            : rows.map((session) => {
                const gone = deploymentGone(session.remoteHost.trim(), deployments);
                return /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)(
                  "div",
                  {
                    className: tasks_default.ledger,
                    "data-testid": "session-row",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", {
                        className: tasks_default.ledgerAgent,
                        children: session.agentName || session.agentId,
                      }),
                      /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", { children: kindLabel(t, session.kind) }),
                      session.remoteHost.trim() === ""
                        ? /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", {
                            className: tasks_default.worldBadge,
                            children: t("dsh.sess.worldLocal"),
                          })
                        : /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", {
                            className: tasks_default.worldBadge,
                            "data-gone": gone ? "true" : void 0,
                            title: session.remoteHost,
                            children: session.remoteHost,
                          }),
                      session.durationMs !== null &&
                        /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)("span", {
                          children: [Math.round(session.durationMs / 1e3), "s"],
                        }),
                      session.costUsd !== null &&
                        /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)("span", {
                          children: ["$", session.costUsd.toFixed(3)],
                        }),
                      session.exitCode !== null &&
                        /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)("span", {
                          className: tasks_default.ledgerExit,
                          "data-ok": session.exitCode === 0,
                          children: ["exit ", session.exitCode],
                        }),
                      session.sessionId !== null &&
                        /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", {
                          className: ui_default.muted,
                          children: session.sessionId,
                        }),
                      replayable(session) &&
                        /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("button", {
                          type: "button",
                          className: ui_default.button,
                          "data-testid": "session-replay",
                          disabled: readonly,
                          onClick: () => void replay(session),
                          children: t("dsh.sess.replay"),
                        }),
                    ],
                  },
                  session.id,
                );
              }),
          /* @__PURE__ */ (0, import_jsx_runtime70.jsxs)("div", {
            className: tasks_default.sessPager,
            "data-testid": "session-pager",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("span", {
                className: tasks_default.sessCounts,
                children: t("dsh.sess.counts", { n: total, page: current, pages }),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: current <= 1,
                onClick: () => setOffset(Math.max(0, offset - limit)),
                children: t("sess.prev"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("button", {
                type: "button",
                className: ui_default.button,
                disabled: current >= pages,
                onClick: () => setOffset(offset + limit),
                children: t("sess.next"),
              }),
              /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("select", {
                className: ui_default.select,
                "aria-label": t("dsh.sess.limitLabel"),
                value: String(limit),
                onChange: (event) => {
                  setLimit(Number(event.target.value));
                  setOffset(0);
                },
                children: LIMIT_OPTIONS.map((n) =>
                  /* @__PURE__ */ (0, import_jsx_runtime70.jsx)(
                    "option",
                    { value: String(n), children: t("dsh.sess.limitN", { n }) },
                    n,
                  ),
                ),
              }),
            ],
          }),
          note !== null &&
            /* @__PURE__ */ (0, import_jsx_runtime70.jsx)("p", {
              className: tasks_default.sessNote,
              role: "status",
              "data-testid": "session-note",
              children: note,
            }),
        ],
      });
    }

    // src/client/app/HelperBanner.tsx
    var import_react52 = require("react");

    // src/client/app/app.module.css
    var css7 =
      '/* \u63D2\u4EF6\u9875\u9762\u58F3\u6837\u5F0F\uFF08scoped\uFF1B\u5BBF\u4E3B\u4E3B\u9898 token --dsw-alias-*\uFF0C\u7F3A\u7701\u56DE\u9000\u4E2D\u6027\u8272\uFF1B\u96F6\u95EA\u70C1\uFF09 */\n\n.UKnskb_page {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  background: var(--dsw-alias-bg-base, transparent);\n  font-size: 14px;\n}\n\n/* PageHeader\uFF08\u684C\u9762 dex-main-head \u540C\u6784\uFF1A\u6807\u9898\u5757\u5DE6 + CAUGHT \u8FDB\u5EA6\u53F3\uFF0C\u4E03\u6BB5\u5E38\u663E\uFF09\n * specs/dsh-plugin-style T1#1\uFF1A\u7EB8\u8272\u5934\u6761 + 2px \u91CD\u58A8\u7EBF\u5E95\u7F18\uFF1B\u9762\u5185\u6587\u5B57\u8D70\u7EB8\u9762\u914D\u5BF9\u58A8\u8272\n * \uFF08--pcy-paper-ink \u4E0E --pcy-paper \u540C\u6CE1\u7FFB\u8F6C\uFF0C\u5BBF\u4E3B/OS \u4E3B\u9898\u80CC\u79BB\u4E5F\u4E0D\u635F\u53EF\u8BFB\uFF09 */\n.UKnskb_pageHeader {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  background: var(--pcy-paper, #f5f0dc);\n  border-bottom: 2px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 10px 10px 0 0;\n  padding: 8px 12px 6px;\n}\n.UKnskb_pageHeadMain {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n/* \u6807\u9898\u884C\uFF08title + \u88C5\u9970\u82F1\u6587 + \u5F85\u5904\u7406\u5FBD\u7AE0\u540C\u884C\uFF1BCAUGHT \u6302\u5916\u5C42\u53F3\u7AEF\uFF09 */\n.UKnskb_pageTitleRow {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 0;\n}\n/* \u65E5\u671F\uFF08\u7B49\u5BBD\u5C0F\u5B57 + \u4E1D\u5370\u5B57\u8DDD\uFF09\uFF1A\u9875\u5934\u53F3\u7AEF\u4E0E CAUGHT \u540C\u6392\u3001\u5C45\u5176\u524D\uFF08\u7528\u6237\u88C1\u51B3 2026-10-16\uFF1A\n * \u4E0D\u518D\u684C\u9762 today \u9875\u300C\u6807\u9898\u4E0B\u65B9\u72EC\u7ACB\u884C\u300D\u540C\u4F4D\uFF09 */\n.UKnskb_pageDate {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: 1px;\n  color: var(--pcy-paper-ink, #1a1b25);\n  opacity: 0.65;\n}\n/* CAUGHT \u8BA1\u6570 + \u63CF\u8FB9\u8FDB\u5EA6\u6761\uFF08\u684C\u9762 catch-progress \u540C\u6784\uFF1A\u8BA1\u6570\u5DE6\u3001\u8FDB\u5EA6\u6761\u53F3\u540C\u884C\uFF09 */\n.UKnskb_pageCaught {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex: none;\n}\n.UKnskb_caughtLabel {\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n  color: var(--pcy-paper-ink, #1a1b25);\n  font-weight: 600;\n}\n.UKnskb_caughtBar {\n  width: 110px;\n  height: 10px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  overflow: hidden;\n}\n.UKnskb_caughtFill {\n  display: block;\n  height: 100%;\n  background: var(--pcy-ok, #2e9e5b);\n}\n.UKnskb_pageTitle {\n  font-size: 18px;\n  font-weight: 700;\n  margin: 0;\n  color: var(--pcy-paper-ink, #1a1b25);\n}\n/* POK\xE9-DEX \u88C5\u9970\u82F1\u6587\uFF08\xA78\uFF1A\u4E0D\u5165 i18n\uFF1B\u7B49\u5BBD\u5C0F\u5B57 + \u5B57\u8DDD\uFF0C\u539F\u578B pagehead \u540C\u6B3E\uFF1B\n * \u975E\u4FE1\u606F\u88C5\u9970\u6587\u5B57\uFF0C\u4E0D\u8BBE\u5BF9\u6BD4\u5EA6\u8981\u6C42\uFF09 */\n.UKnskb_pageTitleDeco {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 10px;\n  letter-spacing: 1.5px;\n  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #57606a));\n  margin-left: -6px;\n  transform: translateY(3px);\n}\n.UKnskb_pendingBadge {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 20px;\n  height: 20px;\n  padding: 0 6px;\n  border-radius: 999px;\n  /* \u884C\u52A8\u7EA2\u5E95\u767D\u5B57\uFF08DESIGN_SYSTEM --danger #E00F0F\uFF0C\u767D\u5B57 5.0:1\u2014\u2014#ee1515 \u4EC5 4.4 \u4E0D\u8FBE\u6807\uFF09+ 1px \u58A8\u7EBF\uFF1B\n   * \u8BA1\u6570\u9759\u6001\u65E0\u52A8\u753B NFR-6 */\n  background: var(--pcy-badge-red, #e00f0f);\n  color: #ffffff;\n  font-size: 12px;\n  font-weight: 700;\n  line-height: 20px;\n  border: 1px solid #1a1b25;\n}\n\n/* SchemaBanner\uFF08\u6301\u4E45\u6A2A\u5E45\uFF0C\u53EA\u8BFB\u6A21\u5F0F\uFF1B\u8B66\u793A\u8F6F\u5E95\u4E3A\u56FA\u5B9A\u8272\uFF0C\u7406\u7531\u540C AuthBanner\uFF09 */\n.UKnskb_schemaBanner {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 14px;\n  border-radius: 10px;\n  border: 1.5px solid var(--pcy-warn, #c98a06);\n  background: var(--pcy-warn-soft, #fff3cd);\n  color: var(--pcy-warn-ink, #8a5e06);\n  font-size: 13px;\n}\n.UKnskb_schemaReadonlyTag {\n  margin-left: auto;\n  flex: none;\n  padding: 1px 10px;\n  border-radius: 6px;\n  border: 1.5px solid var(--pcy-warn-ink, #8a5e06);\n  font-size: 11px;\n  font-weight: 700;\n  white-space: nowrap;\n}\n\n/* SegmentNav\uFF08\u4E03\u6BB5\u80F6\u56CA\u9009\u5355\uFF1B\u8BA1\u6570\u9759\u6001\uFF09\u2014\u2014\u539F\u578B segnav \u53E3\u5F84\uFF1A\u63CF\u8FB9\u80F6\u56CA\u3001active \u4E3B\u8272\u586B\u5145 */\n.UKnskb_segmentNav {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  padding-bottom: 2px;\n}\n.UKnskb_segmentButton {\n  box-sizing: border-box;\n  min-height: 32px;\n  padding: 4px 14px;\n  border: 1px solid var(--dsw-alias-border-l1, #e3e7ec);\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-layer-1, #ffffff);\n  color: var(--dsw-alias-label-secondary, #57606a);\n  font-size: 13px;\n  font-weight: 600;\n  cursor: pointer;\n  white-space: nowrap;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n}\n.UKnskb_segmentButton:hover {\n  border-color: var(--dsw-alias-border-l3, #c7cdd4);\n  background: var(--pcy-hover, #fff3c4);\n}\n.UKnskb_segmentButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary, #316dca);\n  outline-offset: 1px;\n}\n/* \u4E00\u7B49\u9009\u4E2D\uFF08specs/dsh-plugin-style \xA73.2\uFF09\uFF1A\u9EC4\u5E95\u56FA\u5B9A\u58A8\u5B57 + \u91CD\u58A8\u7EBF + \u5B57\u91CD\uFF08\u9A8C\u6536\u88C1\u51B3\u53BB \u25B6 \u524D\u7F00\uFF1B\n * \u975E\u989C\u8272\u5197\u4F59\u7531 aria-current + \u5B57\u91CD + \u58A8\u7EBF\u627F\u62C5\uFF1B\u9EC4\u56FA\u5B9A\u4E0D\u7FFB\u8F6C\uFF0C\u53CC\u4E3B\u9898\u5B89\u5168 11.2:1\uFF09 */\n.UKnskb_segmentButton[aria-current="page"] {\n  color: #1a1b25;\n  background: var(--pcy-running, #ffcb05);\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  font-weight: 700;\n}\n.UKnskb_segmentButton[aria-current="page"] .UKnskb_segmentCount {\n  background: rgba(26, 27, 37, 0.12);\n  border-color: transparent;\n}\n.UKnskb_segmentCount {\n  display: inline-block;\n  min-width: 20px;\n  text-align: center;\n  padding: 0 6px;\n  border-radius: 999px;\n  background: var(--dsw-alias-bg-layer-1, #eaeef2);\n  border: 1px solid var(--dsw-alias-border-l2, #d0d7de);\n  font-size: 11px;\n  line-height: 18px;\n  /* \u9759\u6001\u8BA1\u6570\uFF1A\u65E0\u95EA\u70C1\u3001\u65E0\u5F39\u8DF3\u52A8\u753B\uFF08U14 \u26A0 \u4E3A\u9759\u6001\u524D\u7F00\u5B57\u7B26\uFF09 */\n}\n\n.UKnskb_segmentBody {\n  min-height: 200px;\n}\n/* \u6536\u97F3\u673A/\u80CC\u5305\u6BB5\u586B\u5145\u7A97\u53E3\u5269\u4F59\u9AD8\u5EA6\uFF08--pcy-remaining \u7531 PluginDetailPage \u6309\u6BB5\u4F53\u9876\u7F18\u5B9E\u6D4B\u5199\u5165\uFF09\uFF1A\n * \u6574\u9875\u4E0D\u51FA\u6EDA\u52A8\u6761\u2014\u2014\u6BB5\u5185\u6EDA\u52A8\u4F4D\u5404\u81EA\u6CBB\u5185\u6EDA\uFF08\u6536\u97F3\u673A = \u5217\u8868/\u8BE6\u60C5\uFF1B\u80CC\u5305 = \u5206\u533A\u9875\u5185\u5BB9\uFF09\uFF0C\n * \u9875\u5934/\u9009\u5355\u5E38\u9A7B\u53EF\u89C6\u3002\n * \u6536\u97F3\u673A\u5217\u8868/\u8BE6\u60C5\u4F38\u7F29\u53E3\u5F84\u7ECF\u81EA\u5B9A\u4E49\u5C5E\u6027\u4E0B\u4F20\uFF08radio.UKnskb_module.UKnskb_css \u6D88\u8D39\uFF1A--list-cap/--list-floor/--detail-floor\uFF09 */\n.UKnskb_segmentFill {\n  height: var(--pcy-remaining, auto);\n  min-height: 260px;\n  --list-cap: none;\n  --list-floor: 0px;\n  --detail-floor: 0px;\n}\n@media (max-width: 760px) {\n  /* \u7A84\u5C4F\u7EB5\u6392\u56DE\u843D\u9875\u9762\u6EDA\u52A8\uFF08\u53CC\u9762\u677F\u4E0A\u4E0B\u5806\u53E0\u585E\u5B9A\u9AD8\u4F1A\u4E92\u76F8\u6324\u538B\uFF09 */\n  .UKnskb_segmentFill {\n    height: auto;\n    --list-cap: 560px;\n    --list-floor: 220px;\n    --detail-floor: 160px;\n  }\n}\n\n/* HelperBanner\uFF08U30\uFF1A\u7CFB\u7EDF\u80FD\u529B\u9762\u964D\u7EA7\u9759\u6001\u6A2A\u5E45\u2014\u2014\u7EB8\u8272\u70B9\u7F00\u5E95 + \u58A8\u7EBF\uFF0C\u6279\u91CF\u6258\u76D8\u540C\u8BCD\u6C47\uFF1Bschema \u62D2\u7EDD\u4F18\u5148\u5728\u4E0A\u4E0D\u53E0\u62A2\uFF09 */\n.UKnskb_helperBanner {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 14px;\n  border-radius: 10px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-paper, #f5f0dc);\n  color: var(--pcy-paper-ink, #1a1b25);\n  font-size: 13px;\n}\n.UKnskb_helperBannerLink {\n  margin-left: auto;\n  flex: none;\n  box-sizing: border-box;\n  min-height: var(--pcy-control-h, 32px);\n  padding: 4px 12px;\n  border-radius: 8px;\n  border: 1.5px solid var(--dsw-alias-label-primary, #1f2328);\n  background: var(--pcy-running, #ffcb05);\n  color: #1a1b25;\n  font-size: 12px;\n  font-weight: 700;\n  box-shadow: 2px 2px 0 var(--dsw-alias-label-primary, #1f2328);\n  cursor: pointer;\n}\n.UKnskb_helperBannerLink:active {\n  transform: translate(1px, 1px);\n  box-shadow: 1px 1px 0 var(--dsw-alias-label-primary, #1f2328);\n}\n@media (prefers-reduced-motion: reduce) {\n  .UKnskb_helperBannerLink,\n  .UKnskb_helperBannerLink:active {\n    transition-duration: 0.01ms;\n  }\n}\n';
    var tagId7 = "dsh-plugin/src/client/app/app.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId7) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId7;
      tag.textContent = css7;
      document.head.appendChild(tag);
    }
    var app_default = {
      page: "UKnskb_page",
      pageHeader: "UKnskb_pageHeader",
      pageHeadMain: "UKnskb_pageHeadMain",
      pageTitleRow: "UKnskb_pageTitleRow",
      pageDate: "UKnskb_pageDate",
      pageCaught: "UKnskb_pageCaught",
      caughtLabel: "UKnskb_caughtLabel",
      caughtBar: "UKnskb_caughtBar",
      caughtFill: "UKnskb_caughtFill",
      pageTitle: "UKnskb_pageTitle",
      pageTitleDeco: "UKnskb_pageTitleDeco",
      pendingBadge: "UKnskb_pendingBadge",
      schemaBanner: "UKnskb_schemaBanner",
      schemaReadonlyTag: "UKnskb_schemaReadonlyTag",
      segmentNav: "UKnskb_segmentNav",
      segmentButton: "UKnskb_segmentButton",
      segmentCount: "UKnskb_segmentCount",
      segmentBody: "UKnskb_segmentBody",
      module: "UKnskb_module",
      css: "UKnskb_css",
      segmentFill: "UKnskb_segmentFill",
      helperBanner: "UKnskb_helperBanner",
      helperBannerLink: "UKnskb_helperBannerLink",
    };

    // src/client/app/HelperBanner.tsx
    var import_jsx_runtime71 = require("react/jsx-runtime");
    function HelperBanner({ onOpenDiagnostics }) {
      const t = useT();
      const client = useClient();
      const [degraded, setDegraded] = (0, import_react52.useState)(false);
      (0, import_react52.useEffect)(() => {
        void client.diagnosticsSnapshot().then((result) => {
          if (result.ok) {
            setDegraded(result.data.helperCaps === null);
          }
        });
      }, [client]);
      if (!degraded) {
        return null;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime71.jsxs)("div", {
        className: app_default.helperBanner,
        role: "status",
        "data-testid": "helper-banner",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime71.jsx)("span", { "aria-hidden": "true", children: "\u{1F43E}" }),
          /* @__PURE__ */ (0, import_jsx_runtime71.jsx)("span", { children: t("dsh.helper.banner") }),
          /* @__PURE__ */ (0, import_jsx_runtime71.jsx)("button", {
            type: "button",
            className: app_default.helperBannerLink,
            onClick: onOpenDiagnostics,
            children: t("dsh.helper.viewDiag"),
          }),
        ],
      });
    }

    // src/client/app/PageHeader.tsx
    var import_react53 = require("react");
    var import_jsx_runtime72 = require("react/jsx-runtime");
    function PageHeader({ pendingCount, data }) {
      const t = useT();
      const adventure = (0, import_react53.useMemo)(
        () => adventureSnapshot(data.tasks, data.today),
        [data.tasks, data.today],
      );
      const percent = adventure.total === 0 ? 0 : Math.round((adventure.caught / adventure.total) * 100);
      return /* @__PURE__ */ (0, import_jsx_runtime72.jsxs)("header", {
        className: app_default.pageHeader,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("div", {
            className: app_default.pageHeadMain,
            children: /* @__PURE__ */ (0, import_jsx_runtime72.jsxs)("div", {
              className: app_default.pageTitleRow,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("h2", {
                  className: app_default.pageTitle,
                  children: t("dsh.page.title"),
                }),
                /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("span", {
                  className: app_default.pageTitleDeco,
                  "aria-hidden": "true",
                  children: "POK\xE9-DEX",
                }),
                pendingCount > 0 &&
                  /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("span", {
                    className: app_default.pendingBadge,
                    "data-testid": "pending-count",
                    title: t("dsh.page.pending", { n: pendingCount }),
                    "aria-label": t("dsh.page.pending", { n: pendingCount }),
                    children: pendingCount,
                  }),
              ],
            }),
          }),
          /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("span", {
            className: app_default.pageDate,
            children: data.today,
          }),
          /* @__PURE__ */ (0, import_jsx_runtime72.jsxs)("span", {
            className: app_default.pageCaught,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime72.jsxs)("span", {
                className: app_default.caughtLabel,
                children: ["CAUGHT ", adventure.caught, "/", adventure.total],
              }),
              /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("span", {
                className: app_default.caughtBar,
                role: "progressbar",
                "aria-valuemin": 0,
                "aria-valuemax": adventure.total,
                "aria-valuenow": adventure.caught,
                children: /* @__PURE__ */ (0, import_jsx_runtime72.jsx)("span", {
                  className: app_default.caughtFill,
                  style: { width: `${percent}%` },
                }),
              }),
            ],
          }),
        ],
      });
    }

    // src/client/app/SchemaBanner.tsx
    var import_jsx_runtime73 = require("react/jsx-runtime");
    function SchemaBanner() {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime73.jsxs)("div", {
        className: app_default.schemaBanner,
        role: "status",
        "data-testid": "schema-banner",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime73.jsx)("span", { "aria-hidden": "true", children: "\u26A0" }),
          /* @__PURE__ */ (0, import_jsx_runtime73.jsx)("span", { children: t("dsh.schema.tooNew") }),
          /* @__PURE__ */ (0, import_jsx_runtime73.jsx)("span", {
            className: app_default.schemaReadonlyTag,
            children: t("dsh.schema.readonly"),
          }),
        ],
      });
    }

    // src/client/app/SegmentNav.tsx
    var import_jsx_runtime74 = require("react/jsx-runtime");
    function SegmentNav({ active, onChange, radioPending, radioFailures }) {
      const t = useT();
      return /* @__PURE__ */ (0, import_jsx_runtime74.jsx)("nav", {
        className: app_default.segmentNav,
        "aria-label": t("dsh.page.title"),
        "data-testid": "segment-nav",
        children: SEGMENTS.map((segment) => {
          const isRadio = segment === "radio";
          const showCount = isRadio && radioPending > 0;
          const warn = isRadio && radioFailures >= 3;
          return /* @__PURE__ */ (0, import_jsx_runtime74.jsxs)(
            "button",
            {
              type: "button",
              className: app_default.segmentButton,
              "aria-current": active === segment ? "page" : void 0,
              "data-segment": segment,
              "data-warn": warn ? "true" : void 0,
              onClick: () => onChange(segment),
              children: [
                t(SEGMENT_LABEL_KEYS[segment]),
                showCount &&
                  /* @__PURE__ */ (0, import_jsx_runtime74.jsxs)("span", {
                    className: app_default.segmentCount,
                    children: [warn ? "\u26A0" : "", radioPending],
                  }),
              ],
            },
            segment,
          );
        }),
      });
    }

    // src/client/app/useFillRemainingHeight.ts
    var import_react54 = require("react");
    function useFillRemainingHeight(ref, active) {
      (0, import_react54.useEffect)(() => {
        const el = ref.current;
        if (!active || el === null) {
          return;
        }
        const update = () => {
          const top = Math.max(0, Math.round(el.getBoundingClientRect().top));
          const scroller = scrollParentOf(el);
          let bottom;
          if (scroller === null) {
            bottom = document.documentElement.clientHeight;
          } else {
            const rect = scroller.getBoundingClientRect();
            const cs = window.getComputedStyle(scroller);
            const pad = Number.parseFloat(cs.paddingBottom) || 0;
            const border = Number.parseFloat(cs.borderBottomWidth) || 0;
            bottom = rect.bottom - border - pad;
          }
          el.style.setProperty("--pcy-remaining", `${Math.max(0, Math.round(bottom - top))}px`);
        };
        update();
        window.addEventListener("resize", update);
        return () => {
          window.removeEventListener("resize", update);
          el.style.removeProperty("--pcy-remaining");
        };
      }, [active, ref]);
    }
    function scrollParentOf(el) {
      let node = el.parentElement;
      while (node !== null) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    // src/client/app/PluginDetailPage.tsx
    var import_jsx_runtime75 = require("react/jsx-runtime");
    function PluginDetailPage({ client, data, initialSegment = "adventure", onChanged }) {
      return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(ClientProvider, {
        client,
        children: /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(PluginDetailPageInner, {
          data,
          initialSegment,
          onChanged,
        }),
      });
    }
    function PluginDetailPageInner({ data, initialSegment, onChanged }) {
      const client = useClient();
      const [segment, setSegment] = (0, import_react55.useState)(initialSegment);
      const [openTaskId, setOpenTaskId] = (0, import_react55.useState)(null);
      const [pendingLeave, setPendingLeave] = (0, import_react55.useState)(null);
      const settingsDirtyRef = (0, import_react55.useRef)(false);
      const [settingsSection, setSettingsSection] = (0, import_react55.useState)("focus");
      const [localeOverride, setLocaleOverride] = (0, import_react55.useState)(null);
      const segmentBodyRef = (0, import_react55.useRef)(null);
      const fillBody = segment === "radio" || segment === "settings";
      useFillRemainingHeight(segmentBodyRef, fillBody);
      const refresh = (0, import_react55.useCallback)(() => {
        onChanged?.();
      }, [onChanged]);
      const prevSegment = (0, import_react55.useRef)(segment);
      (0, import_react55.useEffect)(() => {
        if (prevSegment.current !== segment) {
          prevSegment.current = segment;
          refresh();
        }
      }, [segment, refresh]);
      const requestSegment = useLeaveGuard(segment, settingsDirtyRef, setPendingLeave, setSegment);
      usePageOpenAnchor(client, requestSegment);
      const readonly = data.dbStatus?.mode === "ro";
      const pendingCount = countActionablePending(data.messages);
      const openTask = findTask(data.tasks, openTaskId);
      return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(I18nProvider, {
        locale: localeOverride ?? data.locale,
        children: /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(DisplayPrefsProvider, {
          ...displayPrefsOf(data.config),
          children: /* @__PURE__ */ (0, import_jsx_runtime75.jsxs)("div", {
            className: app_default.page,
            children: [
              readonly && /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(SchemaBanner, {}),
              /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(HelperBanner, {
                onOpenDiagnostics: () => {
                  setSettingsSection("diag");
                  requestSegment("settings");
                },
              }),
              /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(PageHeader, { pendingCount, data }),
              /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(SegmentNav, {
                active: segment,
                onChange: requestSegment,
                radioPending: data.health.pendingCount,
                radioFailures: data.health.consecutiveFailures,
              }),
              /* @__PURE__ */ (0, import_jsx_runtime75.jsx)("div", {
                ref: segmentBodyRef,
                className: fillBody ? `${app_default.segmentBody} ${app_default.segmentFill}` : app_default.segmentBody,
                children: /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(SegmentBody, {
                  segment,
                  data,
                  readonly,
                  onOpen: setOpenTaskId,
                  onChanged: refresh,
                  pendingLeave,
                  onLeaveResolved: (proceed) =>
                    resolveLeave(proceed, pendingLeave, settingsDirtyRef, setPendingLeave, setSegment),
                  onUnsavedChange: (dirty) => {
                    settingsDirtyRef.current = dirty;
                  },
                  onLocalePreview: setLocaleOverride,
                  settingsSection,
                }),
              }),
              openTask !== null &&
                /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(TaskDetailDrawer, {
                  task: openTask,
                  data,
                  categories: data.categories,
                  onClose: () => setOpenTaskId(null),
                  onChanged: refresh,
                }),
            ],
          }),
        }),
      });
    }
    function SegmentBody({
      segment,
      data,
      readonly,
      onOpen,
      onChanged,
      pendingLeave,
      onLeaveResolved,
      onUnsavedChange,
      onLocalePreview,
      settingsSection,
    }) {
      const segmentProps = { data, readonly, onOpen, onChanged };
      switch (segment) {
        case "adventure":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(AdventureView, { ...segmentProps });
        case "grass":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(GrassView, { ...segmentProps });
        case "route":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(RouteView, { ...segmentProps });
        case "dex":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(DexView, { ...segmentProps });
        case "radio":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(RadioSegment, { data, readonly, onChanged });
        case "logs":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(LogSegment, { readonly });
        case "settings":
          return /* @__PURE__ */ (0, import_jsx_runtime75.jsx)(SettingsSegment, {
            data,
            onChanged,
            leaveRequest: pendingLeave,
            onLeaveResolved,
            onUnsavedChange,
            onLocalePreview,
            initialSection: settingsSection,
          });
      }
    }
    function usePageOpenAnchor(client, requestSegment) {
      const requestRef = (0, import_react55.useRef)(requestSegment);
      requestRef.current = requestSegment;
      (0, import_react55.useEffect)(() => {
        return client.onPageOpen((event) => {
          requestRef.current(event.section === "settings" ? "settings" : "adventure");
        });
      }, [client]);
    }
    function useLeaveGuard(segment, dirtyRef, setPendingLeave, setSegment) {
      return (0, import_react55.useCallback)(
        (next) => {
          if (segment === "settings" && next !== "settings" && dirtyRef.current) {
            setPendingLeave(next);
            return;
          }
          setSegment(next);
        },
        [segment, dirtyRef, setPendingLeave, setSegment],
      );
    }
    function resolveLeave(proceed, pendingLeave, dirtyRef, setPendingLeave, setSegment) {
      const target = pendingLeave;
      setPendingLeave(null);
      if (proceed && target !== null) {
        dirtyRef.current = false;
        setSegment(target);
      }
    }
    function countActionablePending(messages) {
      const groups = suggestionGroups(messages);
      return groups.pending.filter((m) => m.aiStatus !== "judging" && m.aiStatus !== "pending").length;
    }
    function findTask(tasks, id) {
      if (id === null) {
        return null;
      }
      return tasks.find((t) => t.id === id) ?? null;
    }

    // src/client/dsh/mainPanel.module.css
    var css8 =
      '/*\n * \u4E3B\u533A\u5168\u5C40\u9762\u677F\u58F3\uFF08\u5165\u53E3\u578B\u9875\u9762\u7EA6\u5B9A\uFF09\uFF1Adarwin \u684C\u9762\u9876\u90E8\u907F\u8BA9\u7EA2\u7EFF\u706F\u5E26\uFF08ui-layout \u53D1\u5E03\n * --dsh-frame-top-clearance\uFF0CmacOS 48px\uFF1B\u666E\u901A web \u65E0\u8BE5\u53D8\u91CF\u56DE\u843D 0\uFF09\uFF0C\u6574\u9875\u81EA\u6EDA\u52A8\n * \uFF08main \u5217 overflow:hidden\uFF0C\u6EDA\u52A8\u7531\u9762\u677F\u81EA\u7406\u2014\u2014\u4E0E conversation \u540C\u53E3\u5F84\uFF09\u3002\n */\n\n.aEF3Jb_shell {\n  flex: 1 1 auto;\n  height: 100%;\n  min-height: 0;\n  overflow-y: auto;\n  box-sizing: border-box;\n  /* \u9876\u8DDD\u6536\u7A84\uFF08\u7528\u6237\u88C1\u51B3 2026-10-17\uFF1A\u6807\u9898\u4E0A\u8FB9\u8DDD\u7F29\u5C0F\uFF09\uFF1B\u5E95\u8DDD 16\u2014\u2014\u586B\u5145\u6BB5\u5B9A\u9AD8\u6B62\u4E8E\u5185\u5BB9\u76D2\n   * \u5E95\u7F18\uFF0C\u8FC7\u5927\u5E95\u8DDD\u4F1A\u5728\u9875\u811A\u7559\u6B7B\u7A7A */\n  padding: 10px 24px 16px;\n}\n\nhtml[data-platform="darwin"] .aEF3Jb_shell {\n  padding-top: calc(10px + var(--dsh-frame-top-clearance, 0px));\n}\n';
    var tagId8 = "dsh-plugin/src/client/dsh/mainPanel.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId8) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin";
      tag.dataset.pluginCss = tagId8;
      tag.textContent = css8;
      document.head.appendChild(tag);
    }
    var mainPanel_default = { shell: "aEF3Jb_shell" };

    // src/client/dsh/sidebarPanel.tsx
    var import_jsx_runtime76 = require("react/jsx-runtime");
    var PANEL_ID = "pokemon-choose-you";
    var PANEL_ORDER = 20;
    var PANEL_TITLES = {
      "zh-Hans": dsh_zh_Hans_default.page.title,
      "zh-Hant": dsh_zh_Hant_default.page.title,
      en: dsh_en_default.page.title,
    };
    function hostLocaleTag(locale) {
      try {
        const tag = locale?.getSnapshot?.().locale;
        return typeof tag === "string" ? tag : null;
      } catch {
        return null;
      }
    }
    function localeForTag(tag) {
      if (tag === null || !tag.toLowerCase().startsWith("zh")) {
        return "en";
      }
      const lower = tag.toLowerCase();
      return /tw|hk|mo|hant/.test(lower) ? "zh-Hant" : "zh-Hans";
    }
    function createPanelLabel(locale) {
      return () => PANEL_TITLES[localeForTag(hostLocaleTag(locale))];
    }
    function PanelIcon({ size = 20 }) {
      return /* @__PURE__ */ (0, import_jsx_runtime76.jsxs)("svg", {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        "aria-hidden": "true",
        focusable: "false",
        "data-testid": "pky-sidebar-icon",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("circle", { cx: "12", cy: "12", r: "9" }),
          /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("path", { d: "M3.5 12h5" }),
          /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("path", { d: "M15.5 12h5" }),
          /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
        ],
      });
    }
    function createPanelOpener(layout) {
      return () => {
        layout?.selectPanel(PANEL_ID);
      };
    }
    function createPanelRoot(host) {
      function PanelRoot() {
        const [data, setData] = (0, import_react56.useState)(null);
        const refresh = (0, import_react56.useCallback)(() => {
          void fetchPanelData(host).then(setData);
        }, []);
        (0, import_react56.useEffect)(() => {
          refresh();
        }, [refresh]);
        if (data === null) {
          return /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("div", { "data-testid": "pky-panel-loading" });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("div", {
          "data-pky-panel": "",
          style: { minHeight: 0 },
          children: /* @__PURE__ */ (0, import_jsx_runtime76.jsx)(PluginDetailPage, {
            client: host,
            data,
            onChanged: refresh,
          }),
        });
      }
      return PanelRoot;
    }
    function createMainPanel(host) {
      const PanelRoot = createPanelRoot(host);
      return function MainPanel() {
        return /* @__PURE__ */ (0, import_jsx_runtime76.jsx)("div", {
          className: mainPanel_default.shell,
          children: /* @__PURE__ */ (0, import_jsx_runtime76.jsx)(PanelRoot, {}),
        });
      };
    }

    // src/client/dsh/clientEntry.tsx
    var import_jsx_runtime77 = require("react/jsx-runtime");
    var PKG_NAME = "dsh-plugin";
    var PANEL_SLOT = "plugins.detail.section";
    var CHIP_SLOT = "conversation.session.header.actions";
    var PANEL_LIST_SLOT = "sidebar.panellist";
    var MAIN_SLOT = "main";
    var inject = ["slots", "locale", "connection", "layout"];
    function subjectIsSelf(subject) {
      const scoped = subject;
      return scoped?.pkg?.name === PKG_NAME;
    }
    function createPanelSection(host) {
      const PanelRoot = createPanelRoot(host);
      return function PanelSection(props) {
        if (!subjectIsSelf(props.subject)) {
          return null;
        }
        return /* @__PURE__ */ (0, import_jsx_runtime77.jsx)(PanelRoot, {});
      };
    }
    function useChipTask(host, locale) {
      const [state, setState] = (0, import_react57.useState)({
        task: null,
        pokemon: "",
        readonly: false,
      });
      const refresh = (0, import_react57.useCallback)(() => {
        void Promise.all([host.panelSnapshot(), host.dbStatus()]).then(([snap, db]) => {
          if (!snap.ok) {
            return;
          }
          const task2 = snap.data.currentTask ?? null;
          const category = task2 === null ? void 0 : snap.data.categories.find((c) => c.id === task2.categoryId);
          setState({
            task: task2,
            pokemon: category?.pokemon ?? "",
            readonly: db.ok && db.data.mode === "ro",
          });
        });
      }, [host]);
      (0, import_react57.useEffect)(() => {
        refresh();
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            refresh();
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        return () => {
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", onVisible);
        };
      }, [refresh]);
      const task = state.task;
      const mode = task !== null && task.status === "paused" ? "paused" : "running";
      const startedMs = task?.startedAt === null || task?.startedAt === void 0 ? NaN : Date.parse(task.startedAt);
      const secondsLeft = Number.isFinite(startedMs) ? Math.max(0, Math.floor((Date.now() - startedMs) / 1e3)) : 0;
      return {
        task,
        mode,
        secondsLeft,
        pokemonName: pokemonNameOf(state.pokemon, locale),
        readonly: state.readonly,
        refresh,
      };
    }
    function createChipEntry(host, openPage) {
      function ChipRoot() {
        const [locale, setLocale] = (0, import_react57.useState)("zh-Hans");
        (0, import_react57.useEffect)(() => {
          void loadLocale(host).then(setLocale);
        }, []);
        const chip = useChipTask(host, locale);
        return /* @__PURE__ */ (0, import_jsx_runtime77.jsx)(I18nProvider, {
          locale,
          children: /* @__PURE__ */ (0, import_jsx_runtime77.jsx)(ClientProvider, {
            client: host,
            children: /* @__PURE__ */ (0, import_jsx_runtime77.jsx)(ConversationChip, {
              task: chip.task,
              mode: chip.mode,
              secondsLeft: chip.secondsLeft,
              pokemonName: chip.pokemonName,
              readonly: chip.readonly,
              onMutate: chip.refresh,
              onOpenPage: openPage,
            }),
          }),
        });
      }
      return function ChipEntry() {
        return /* @__PURE__ */ (0, import_jsx_runtime77.jsx)(ChipRoot, {});
      };
    }
    function apply(ctx) {
      const host = createHostClient(createDshRpcTransport(ctx.connection.rpc));
      ctx.slots.inject(PANEL_SLOT, () =>
        ctx.slots.register({ name: PANEL_SLOT, id: `${PKG_NAME}#panel` }, createPanelSection(host)),
      );
      ctx.slots.inject(CHIP_SLOT, () =>
        ctx.slots.register(
          { name: CHIP_SLOT, id: `${PKG_NAME}#chip` },
          createChipEntry(host, createPanelOpener(ctx.layout)),
        ),
      );
      ctx.slots.inject(PANEL_LIST_SLOT, () =>
        ctx.slots.register(
          { name: PANEL_LIST_SLOT, id: PANEL_ID, order: PANEL_ORDER, label: createPanelLabel(ctx.locale) },
          PanelIcon,
        ),
      );
      ctx.slots.inject(MAIN_SLOT, () => ctx.slots.register({ name: MAIN_SLOT, key: PANEL_ID }, createMainPanel(host)));
    }
    return module.exports;
  },
});
