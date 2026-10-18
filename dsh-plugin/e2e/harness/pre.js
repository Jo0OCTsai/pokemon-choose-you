"use strict";
(() => {
  // src/host/storage/errors.ts
  var PkyError = class extends Error {
    code;
    hint;
    constructor(code, message, hint) {
      super(message);
      this.name = "PkyError";
      this.code = code;
      this.hint = hint;
    }
    toShape() {
      return this.hint === void 0 ? { code: this.code, message: this.message } : { code: this.code, message: this.message, hint: this.hint };
    }
  };

  // src/client/mockTaskNotes.ts
  function taskNoteCommands(ctx) {
    return {
      async taskNoteAdd(params) {
        ctx.record("taskNoteAdd", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        const content = params.content.trim();
        if (content === "") {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u8DDF\u8FDB\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A").toShape() };
        }
        const list = ctx.state.followups[params.taskId] ??= [];
        const note = {
          id: list.reduce((max, n) => Math.max(max, n.id), 0) + 1,
          taskId: params.taskId,
          content,
          source: "manual",
          createdAt: "2026-10-14T08:00:00+00:00"
        };
        list.push(note);
        return ctx.ok(note);
      },
      async taskNoteDelete(params) {
        ctx.record("taskNoteDelete", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        for (const key of Object.keys(ctx.state.followups)) {
          const id = Number(key);
          ctx.state.followups[id] = ctx.state.followups[id].filter((n) => n.id !== params.id);
        }
        return ctx.ok({ ok: true });
      },
      async taskHistory(params) {
        ctx.record("taskHistory", params);
        return ctx.ok({ logs: ctx.state.taskLogs[params.taskId] ?? [] });
      }
    };
  }

  // src/client/mockTasks.ts
  function taskSwitchCommands(ctx) {
    return {
      async taskStart(params) {
        ctx.record("taskStart", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        for (const other of ctx.state.tasks) {
          if (other.id !== task.id && (other.status === "active" || other.status === "paused")) {
            other.status = "scheduled";
          }
        }
        task.status = "active";
        return { ok: true, data: task };
      },
      async taskPause(params) {
        ctx.record("taskPause", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const target = params?.taskId !== void 0 ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status === "active");
        if (target === void 0) {
          return { ok: true, data: null };
        }
        target.status = "paused";
        return { ok: true, data: target };
      },
      async taskResume(params) {
        ctx.record("taskResume", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const target = params?.taskId !== void 0 ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status === "paused");
        if (target === void 0) {
          return { ok: true, data: null };
        }
        target.status = "active";
        return { ok: true, data: target };
      }
    };
  }
  function taskCloseCommands(ctx) {
    return {
      async taskComplete(params) {
        ctx.record("taskComplete", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const target = params?.taskId !== void 0 ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status !== "done");
        if (target === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", "\u6CA1\u6709\u53EF\u5B8C\u6210\u7684\u4EFB\u52A1").toShape() };
        }
        target.status = "done";
        target.completedAt = "2026-10-11T09:00:00+08:00";
        return { ok: true, data: target };
      },
      async taskCancel(params) {
        ctx.record("taskCancel", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        task.status = "cancelled";
        task.cancelledAt = "2026-10-11T09:00:00+08:00";
        return { ok: true, data: task };
      }
    };
  }
  function releaseCommands(ctx) {
    return {
      async taskDelete(params) {
        ctx.record("taskDelete", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const tombstone = ctx.findTask(params.taskId);
        ctx.state.tasks = ctx.state.tasks.filter((t) => t.id !== params.taskId);
        if (tombstone !== void 0) {
          ctx.state.deleted.push(tombstone);
        }
        return { ok: true, data: { taskId: params.taskId } };
      },
      async taskDeleteUndo(params) {
        ctx.record("taskDeleteUndo", params);
        const tombstone = ctx.state.deleted.find((t) => t.id === params.taskId);
        if (tombstone === void 0) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u64A4\u9500\u7A97\u53E3\u5DF2\u8FC7\u6216\u4EFB\u52A1\u672A\u88AB\u653E\u751F").toShape() };
        }
        ctx.state.deleted = ctx.state.deleted.filter((t) => t.id !== params.taskId);
        ctx.state.tasks.push(tombstone);
        return { ok: true, data: tombstone };
      },
      async taskReschedule(params) {
        ctx.record("taskReschedule", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        task.dueAt = params.due === void 0 ? task.dueAt : params.due === "" ? null : params.due;
        if (task.dueAt === null && task.startedAt === null) {
          task.status = "inbox";
        } else if (task.dueAt !== null && task.status === "inbox") {
          task.status = "scheduled";
        }
        return { ok: true, data: task };
      }
    };
  }
  function taskEditCommands(ctx) {
    return { ...taskUpdateCommands(ctx), ...taskNoteCommands(ctx) };
  }
  function taskUpdateCommands(ctx) {
    return {
      async taskUpdate(params) {
        ctx.record("taskUpdate", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.id);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.id} \u4E0D\u5B58\u5728`).toShape() };
        }
        if (params.title !== void 0) task.title = params.title;
        if (params.note !== void 0) task.note = params.note;
        if (params.categoryId !== void 0) task.categoryId = params.categoryId;
        if (params.priority !== void 0) task.priority = params.priority;
        if (params.dueAt !== void 0) task.dueAt = params.dueAt;
        if (params.remindAt !== void 0) task.remindAt = params.remindAt;
        if (params.status !== void 0) task.status = params.status;
        return ctx.ok(task);
      }
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
    "other"
    // 其他
  ];

  // src/client/rpcViews.ts
  var ESCAPE_REASON_CODES = ESCAPE_REASONS;

  // src/client/mockReview.ts
  function pushCaptureMessage(ctx, messageId, text, task) {
    const message = {
      messageId,
      content: text,
      chatName: "",
      senderName: "",
      receivedAt: "2026-10-11T09:00:00+08:00",
      aiStatus: "todo",
      reviewStatus: "accepted",
      suggestedTitle: text,
      suggestedNote: null,
      suggestedCategory: null,
      suggestedDue: null,
      suggestedPriority: null,
      suggestedTags: [],
      confidence: "high",
      reason: null,
      dismissReason: "",
      taskId: task.id,
      updateTaskId: null
    };
    ctx.state.messages.push(message);
  }
  function captureCommands(ctx) {
    return {
      async captureTodo(params) {
        ctx.record("captureTodo", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const duplicate = ctx.state.messages.find(
          (m) => m.aiStatus === "update" && m.reviewStatus === "pending" && params.text.includes(m.content.slice(0, 4))
        );
        if (duplicate !== void 0) {
          return {
            ok: true,
            data: {
              messageId: duplicate.messageId,
              outcome: "updateSuggested",
              taskId: null,
              title: duplicate.suggestedTitle
            }
          };
        }
        const messageId = `mock-cap-${ctx.calls.length}`;
        const task = {
          id: ctx.nextTaskId(),
          title: params.text,
          note: null,
          categoryId: ctx.state.categories[0]?.id ?? 1,
          status: "inbox",
          priority: "normal",
          dueAt: null,
          remindAt: null,
          reminded: false,
          source: "capture",
          externalId: null,
          createdAt: "2026-10-11T09:00:00+08:00",
          completedAt: null,
          startedAt: null,
          cancelledAt: null,
          focusSeconds: 0,
          tags: [],
          dispatchState: null,
          dispatchedSession: null
        };
        ctx.state.tasks.push(task);
        pushCaptureMessage(ctx, messageId, params.text, task);
        return { ok: true, data: { messageId, outcome: "caught", taskId: task.id, title: task.title } };
      }
    };
  }
  function acceptCommands(ctx) {
    return {
      async reviewAccept(params) {
        ctx.record("reviewAccept", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const conflict = ctx.guardPending(params.messageId);
        if (conflict !== null) {
          return { ok: false, error: conflict.toShape() };
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        message.reviewStatus = "accepted";
        const task = taskFromMessage(ctx, message);
        message.taskId = task.id;
        return { ok: true, data: { taskId: task.id, messageId: message.messageId } };
      },
      async reviewApplyUpdate(params) {
        ctx.record("reviewApplyUpdate", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const conflict = ctx.guardPending(params.messageId);
        if (conflict !== null) {
          return { ok: false, error: conflict.toShape() };
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        message.reviewStatus = "accepted";
        return { ok: true, data: { taskId: message.updateTaskId, messageId: message.messageId } };
      }
    };
  }
  function dismissCommands(ctx) {
    return {
      async reviewDismiss(params) {
        ctx.record("reviewDismiss", params);
        const conflict = await dismissGuard(ctx, params.messageId, params.reasonCode);
        if (conflict !== null) {
          return conflict;
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        message.reviewStatus = "dismissed";
        message.dismissReason = params.reasonCode;
        return { ok: true, data: { messageId: message.messageId } };
      },
      async reviewRestore(params) {
        ctx.record("reviewRestore", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        if (message.reviewStatus !== "dismissed") {
          return { ok: false, error: new PkyError("SUGGESTION_ALREADY_RESOLVED", "\u8BE5\u5EFA\u8BAE\u5DF2\u5728\u53E6\u4E00\u5904\u5904\u7F6E").toShape() };
        }
        message.reviewStatus = "pending";
        message.dismissReason = "";
        return { ok: true, data: { messageId: message.messageId } };
      },
      async reviewBatch(params) {
        ctx.record("reviewBatch", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const results = params.messageIds.map(
          (messageId) => reviewBatchOne(ctx, messageId, params.op, params.reasonCode)
        );
        return { ok: true, data: { results } };
      }
    };
  }
  function taskFromMessage(ctx, message) {
    const task = {
      id: ctx.nextTaskId(),
      title: message.suggestedTitle ?? message.content,
      note: null,
      categoryId: ctx.state.categories[0]?.id ?? 1,
      status: "inbox",
      priority: "normal",
      dueAt: null,
      remindAt: null,
      reminded: false,
      source: "feishu",
      externalId: null,
      createdAt: "2026-10-11T09:00:00+08:00",
      completedAt: null,
      startedAt: null,
      cancelledAt: null,
      focusSeconds: 0,
      tags: [],
      dispatchState: null,
      dispatchedSession: null
    };
    ctx.state.tasks.push(task);
    return task;
  }
  async function dismissGuard(ctx, messageId, reasonCode) {
    const blocked = ctx.guardWritable();
    if (blocked !== null) {
      return { ok: false, error: blocked.toShape() };
    }
    const conflict = ctx.guardPending(messageId);
    if (conflict !== null) {
      return { ok: false, error: conflict.toShape() };
    }
    if (!ESCAPE_REASON_CODES.includes(reasonCode)) {
      return { ok: false, error: new PkyError("INVALID_ARGUMENT", `\u672A\u77E5\u9003\u8D70\u539F\u56E0\u7801\uFF1A${reasonCode}`).toShape() };
    }
    return null;
  }
  function reviewBatchOne(ctx, messageId, op, reasonCode) {
    const message = ctx.findMessage(messageId);
    const resolved = message === void 0 || message.reviewStatus !== "pending";
    if (!resolved && message !== void 0) {
      if (op === "accept") {
        message.reviewStatus = "accepted";
      } else {
        message.reviewStatus = "dismissed";
        message.dismissReason = reasonCode ?? "other";
      }
    }
    return { messageId, ok: !resolved, error: resolved ? "SUGGESTION_ALREADY_RESOLVED" : null };
  }
  function retryCommands(ctx) {
    return {
      async retryJudge(params) {
        ctx.record("retryJudge", params);
        const targets = params.messageIds === "all" ? ctx.state.messages.filter((m) => m.aiStatus === "error") : ctx.state.messages.filter((m) => params.messageIds.includes(m.messageId));
        for (const message of targets) {
          message.aiStatus = "judging";
        }
        return { ok: true, data: { accepted: targets.length } };
      },
      async forceCapture(params) {
        ctx.record("forceCapture", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        message.aiStatus = "todo";
        message.reviewStatus = "accepted";
        return { ok: true, data: { taskId: message.taskId, messageId: message.messageId } };
      },
      async forceDismiss(params) {
        ctx.record("forceDismiss", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const message = ctx.findMessage(params.messageId);
        if (message === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u6D88\u606F ${params.messageId} \u4E0D\u5B58\u5728`).toShape() };
        }
        message.aiStatus = "none";
        message.reviewStatus = "dismissed";
        message.dismissReason = params.reasonCode ?? "other";
        return { ok: true, data: { messageId: message.messageId } };
      }
    };
  }

  // src/client/mockDispatch.ts
  function view(taskId, state, startedAt, endedAt, ctx) {
    return { taskId, state, agentId: ctx.state.agents[0]?.id ?? null, startedAt, endedAt };
  }
  function guardActive(ctx, taskId, writable) {
    if (writable) {
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
    }
    const task = ctx.findTask(taskId);
    if (task === void 0) {
      return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${taskId} \u4E0D\u5B58\u5728`).toShape() };
    }
    if (task.dispatchState === "running" || task.dispatchState === "queued") {
      return {
        ok: false,
        error: new PkyError("DISPATCH_ALREADY_ACTIVE", "\u8BE5\u4EFB\u52A1\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u6D3E\u53D1\uFF0C\u8BF7\u5148\u6536\u53E3\u6216\u91CD\u7F6E").toShape()
      };
    }
    return null;
  }
  function dispatchCommands(ctx) {
    return {
      async dispatchInteractive(params) {
        ctx.record("dispatchInteractive", params);
        const guard = guardActive(ctx, params.taskId, true);
        if (guard !== null) {
          return guard;
        }
        const task = ctx.findTask(params.taskId);
        task.dispatchState = "running";
        return {
          ok: true,
          data: {
            ...view(params.taskId, "running", "2026-10-11T09:00:00+08:00", null, ctx),
            handedOff: true,
            line: "claude '\u5904\u7406\u8FD9\u6761\u5F85\u529E\uFF08mock \u6D3E\u53D1\u547D\u4EE4\u884C\uFF09'",
            note: "dsh \u5BBF\u4E3B\u6682\u65E0\u63D2\u4EF6\u53EF\u9A71\u52A8\u7684\u7EC8\u7AEF\u9762\u677F\u2014\u2014\u8BF7\u590D\u5236\u5B8C\u6574\u547D\u4EE4\u884C\u5230\u7EC8\u7AEF\u624B\u52A8\u6267\u884C",
            ...ctx.state.dispatchHandoff.reason === void 0 ? {} : { handoffReason: ctx.state.dispatchHandoff.reason }
          }
        };
      },
      async dispatchHeadless(params) {
        ctx.record("dispatchHeadless", params);
        const guard = guardActive(ctx, params.taskId, true);
        if (guard !== null) {
          return guard;
        }
        const task = ctx.findTask(params.taskId);
        task.dispatchState = "queued";
        return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
      }
    };
  }
  function dispatchControlCommands(ctx) {
    return {
      async dispatchClose(params) {
        ctx.record("dispatchClose", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        task.dispatchState = params.result;
        return { ok: true, data: view(params.taskId, params.result, null, "2026-10-11T09:30:00+08:00", ctx) };
      },
      async dispatchReset(params) {
        ctx.record("dispatchReset", params);
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        task.dispatchState = null;
        return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
      },
      async dispatchCancel(params) {
        ctx.record("dispatchCancel", params);
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        if (task.dispatchState !== "queued") {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u53EA\u6709\u6392\u961F\u4E2D\u7684\u6D3E\u53D1\u53EF\u4EE5\u53D6\u6D88").toShape() };
        }
        task.dispatchState = null;
        return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
      },
      async dispatchRedo(params) {
        ctx.record("dispatchRedo", params);
        const guard = guardActive(ctx, params.taskId, true);
        if (guard !== null) {
          return guard;
        }
        const task = ctx.findTask(params.taskId);
        task.dispatchState = "running";
        return { ok: true, data: view(params.taskId, "running", "2026-10-11T10:00:00+08:00", null, ctx) };
      }
    };
  }

  // src/host/domain/vocabulary-filters.ts
  function prefForChatType(chatType, pref) {
    return chatType === "p2p" ? "follow" : pref;
  }
  function filterDecision(pref, outcome, chatType) {
    const normalized = prefForChatType(chatType, pref);
    if (normalized === "always_filter") {
      return { effect: "filter", source: "manual" };
    }
    if (normalized === "always_pull") {
      return { effect: "pull", source: "manual" };
    }
    if (outcome === "muted") {
      return { effect: "filter", source: "follow" };
    }
    return { effect: "pull", source: outcome === "unknown" ? "followDegraded" : "follow" };
  }

  // src/client/mockPanels.ts
  function deriveAgentsKey(ctx, keys, keyValues) {
    if ((keys === void 0 || keys.includes("ai_agents")) && keyValues.ai_agents === void 0) {
      keyValues.ai_agents = JSON.stringify(ctx.state.agents);
    }
  }
  async function mockLarkLoginStart(ctx) {
    ctx.record("larkLoginStart");
    return { ok: true, data: { ok: true, note: "lark-cli auth login --domain im --recommend" } };
  }
  function settingsCommands(ctx) {
    return {
      async configRead(params) {
        ctx.record("configRead", params);
        const keys = params?.keys;
        const keyValues = {};
        for (const [key, value] of Object.entries(ctx.state.settings)) {
          if (keys === void 0 || keys.includes(key)) {
            keyValues[key] = value;
          }
        }
        deriveAgentsKey(ctx, keys, keyValues);
        return { ok: true, data: { keyValues } };
      },
      async configWrite(params) {
        ctx.record("configWrite", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const invalid = validateConfig(params.keyValues);
        if (invalid !== null) {
          return { ok: false, error: invalid.toShape() };
        }
        Object.assign(ctx.state.settings, params.keyValues);
        return { ok: true, data: { ok: true } };
      },
      async routeUpsert(params) {
        ctx.record("routeUpsert", params);
        return { ok: true, data: params.route };
      },
      async larkAuth() {
        ctx.record("larkAuth");
        ctx.state.larkAuthorized = true;
        return { ok: true, data: { launched: true } };
      },
      async larkTest() {
        ctx.record("larkTest");
        if (!ctx.state.larkAuthorized) {
          return { ok: false, error: new PkyError("LARK_UNAUTHORIZED", "\u98DE\u4E66\u672A\u6388\u6743").toShape() };
        }
        return { ok: true, data: { identity: "\u8BAD\u7EC3\u5BB6", chatCount: 12 } };
      },
      larkLoginStart: () => mockLarkLoginStart(ctx)
    };
  }
  function validateConfig(keyValues) {
    for (const [key, value] of Object.entries(keyValues)) {
      if ((key === "quiet_start" || key === "quiet_end") && !/^\d{2}:\d{2}$/.test(value)) {
        return new PkyError("CONFIG_VALIDATION_FAILED", `\u300C${key}\u300D\u5FC5\u987B\u4E3A HH:MM \u683C\u5F0F`);
      }
    }
    if (keyValues["quiet_start"] !== void 0 && keyValues["quiet_start"] === keyValues["quiet_end"]) {
      return new PkyError("CONFIG_VALIDATION_FAILED", "\u52FF\u6270\u8D77\u6B62\u4E0D\u80FD\u76F8\u540C");
    }
    return null;
  }
  function assertAgentRevision(ctx, expectedAgentIds, force) {
    if (force || expectedAgentIds === void 0) {
      return null;
    }
    const currentIds = ctx.state.agents.map((a) => a.id).sort().join("\n");
    if (currentIds !== [...expectedAgentIds].sort().join("\n")) {
      return new PkyError("SETTING_MODIFIED_ELSEWHERE", "agent \u5217\u8868\u5DF2\u5728\u53E6\u4E00\u5904\u88AB\u4FEE\u6539", "\u786E\u8BA4\u8986\u76D6\u8BF7\u5E26 force \u91CD\u53D1\u6574\u503C");
    }
    return null;
  }
  function pick(incoming, current) {
    return incoming ?? current;
  }
  function upsertCategory(ctx, params) {
    if (params.id === void 0) {
      const category = withDefaults(params, { name: "", pokemon: "", sprite: "", description: "", enabled: true });
      category.id = ctx.state.categories.reduce((max, c) => Math.max(max, c.id), 0) + 1;
      ctx.state.categories.push(category);
      return category;
    }
    const existing = ctx.state.categories.find((c) => c.id === params.id);
    Object.assign(existing, withDefaults(params, existing));
    return existing;
  }
  function withDefaults(params, base) {
    return {
      id: params.id ?? 0,
      name: pick(params.name, base.name),
      pokemon: pick(params.pokemon, base.pokemon),
      sprite: pick(params.sprite, base.sprite),
      enabled: pick(params.enabled, base.enabled),
      description: pick(params.description, base.description)
    };
  }
  function categoryCommands(ctx) {
    return {
      async categoryUpsert(params) {
        ctx.record("categoryUpsert", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        return { ok: true, data: upsertCategory(ctx, params) };
      },
      async categoryDelete(params) {
        ctx.record("categoryDelete", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        if (ctx.state.categories.length <= 1) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u5206\u7C7B").toShape() };
        }
        const index = ctx.state.categories.findIndex((c) => c.id === params.id);
        if (index < 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u5206\u7C7B ${params.id} \u4E0D\u5B58\u5728`).toShape() };
        }
        ctx.state.categories.splice(index, 1);
        const fallback = ctx.state.categories[0];
        const movedTaskCount = ctx.state.tasks.filter((t) => t.categoryId === params.id).length;
        for (const task of ctx.state.tasks) {
          if (task.categoryId === params.id) {
            task.categoryId = fallback.id;
          }
        }
        return { ok: true, data: { id: params.id, movedTaskCount } };
      }
    };
  }
  function vocabularyCommands(ctx) {
    return {
      async tagUpsert(params) {
        ctx.record("tagUpsert", params);
        const tag = {
          id: params.id ?? 1,
          name: params.name,
          description: params.description ?? "",
          dimension: params.dimension,
          origin: "manual",
          createdAt: "2026-10-11T09:00:00+08:00",
          usage: 0
        };
        return { ok: true, data: tag };
      },
      async tagDelete(params) {
        ctx.record("tagDelete", params);
        ctx.state.tags = ctx.state.tags.filter((t) => t.id !== params.id);
        return { ok: true, data: { id: params.id } };
      },
      async dimensionUpdate(params) {
        ctx.record("dimensionUpdate", params);
        const dimension = {
          id: 1,
          key: params.key,
          name: params.name,
          cardinality: "multi",
          maxTags: params.maxTags ?? 12,
          sort: 1,
          enabled: params.enabled ?? true
        };
        return { ok: true, data: dimension };
      }
    };
  }
  function filterCommands(ctx) {
    return {
      async filterList() {
        ctx.record("filterList");
        const counts = { follow: 0, always_filter: 0, always_pull: 0 };
        for (const chat of ctx.state.filters) {
          counts[chat.state] += 1;
        }
        return { ok: true, data: { chats: ctx.state.filters, counts, lastPollAt: ctx.state.health.lastSuccessAt } };
      },
      async filterUpsert(params) {
        ctx.record("filterUpsert", params);
        const existing = ctx.state.filters.find((c) => c.chatId === params.chatId);
        if (existing !== void 0) {
          existing.state = params.state;
          const decision2 = filterDecision(params.state, "unmuted", existing.chatType);
          existing.effective = decision2.effect;
          existing.source = decision2.source;
          return { ok: true, data: existing };
        }
        const decision = filterDecision(params.state, "unmuted", "group");
        const item = {
          chatId: params.chatId,
          chatName: params.chatId,
          chatType: "group",
          state: params.state,
          effective: decision.effect,
          source: decision.source,
          updatedAt: "2026-10-11T09:00:00+08:00"
        };
        ctx.state.filters.push(item);
        return { ok: true, data: item };
      }
    };
  }
  function agentCommands(ctx) {
    return {
      async agentUpsert(params) {
        ctx.record("agentUpsert", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        if (params.agent.command.trim() === "") {
          return { ok: false, error: new PkyError("AGENT_COMMAND_INVALID", "agent \u547D\u4EE4\u4E0D\u80FD\u4E3A\u7A7A").toShape() };
        }
        const conflict = assertAgentRevision(ctx, params.expectedAgentIds, params.force);
        if (conflict !== null) {
          return { ok: false, error: conflict.toShape() };
        }
        const index = ctx.state.agents.findIndex((a) => a.id === params.agent.id);
        if (index >= 0) {
          ctx.state.agents[index] = params.agent;
        } else {
          ctx.state.agents.push(params.agent);
        }
        return { ok: true, data: { agents: [...ctx.state.agents] } };
      },
      async agentDelete(params) {
        ctx.record("agentDelete", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const conflict = assertAgentRevision(ctx, params.expectedAgentIds, params.force);
        if (conflict !== null) {
          return { ok: false, error: conflict.toShape() };
        }
        ctx.state.agents = ctx.state.agents.filter((a) => a.id !== params.id);
        return { ok: true, data: { agents: [...ctx.state.agents] } };
      }
    };
  }

  // src/client/mockAgentTools.ts
  function agentToolsCommands(ctx) {
    return {
      async agentTest(params) {
        ctx.record("agentTest", params);
        return ctx.ok({ connected: true, message: "Agent \u8C03\u7528\u6210\u529F\uFF0Cpk \u5DE5\u5177\u94FE\u5DF2\u8FDE\u901A\uFF08context \u6B63\u5E38\u8FD4\u56DE\uFF09" });
      },
      async pkSkillCheck(params) {
        ctx.record("pkSkillCheck", params);
        const skill = ctx.state.pkSkill ??= { installedVersion: null, checked: false };
        skill.checked = true;
        return ctx.ok({
          kind: "claude-code",
          dir: "/tmp/mock/.claude/skills/pokemon-choose-you",
          installed: skill.installedVersion !== null,
          installedVersion: skill.installedVersion,
          bundledVersion: "9"
        });
      },
      async pkSkillInstall(params) {
        ctx.record("pkSkillInstall", params);
        const skill = ctx.state.pkSkill ??= { installedVersion: null, checked: false };
        const previous = skill.installedVersion;
        skill.installedVersion = "9";
        return ctx.ok({
          kind: "claude-code",
          dir: "/tmp/mock/.claude/skills/pokemon-choose-you",
          previousVersion: previous,
          version: "9",
          path: "/tmp/mock/.claude/skills/pokemon-choose-you/SKILL.md"
        });
      }
    };
  }

  // src/client/mockTagHealth.ts
  function tagHealthCommands(ctx) {
    return { ...checkupCommand(ctx), ...mergeCommand(ctx), ...dimensionCommand(ctx) };
  }
  function checkupCommand(ctx) {
    return {
      async tagCheckup() {
        ctx.record("tagCheckup");
        return { ok: true, data: ctx.state.tagCheckup };
      }
    };
  }
  function mergeCommand(ctx) {
    return {
      async tagMerge(params) {
        ctx.record("tagMerge", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const from = ctx.state.tags.find((t) => t.id === params.fromId);
        const into = ctx.state.tags.find((t) => t.id === params.intoId);
        if (from === void 0 || into === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", "\u6807\u7B7E\u4E0D\u5B58\u5728").toShape() };
        }
        if (from.id === into.id) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u4E0D\u80FD\u5408\u5E76\u5230\u81EA\u8EAB").toShape() };
        }
        reassignTaskTags(ctx, from, into);
        ctx.state.tags = ctx.state.tags.filter((t) => t.id !== from.id);
        recomputeUsage(ctx);
        return { ok: true, data: { ok: true } };
      }
    };
  }
  function reassignTaskTags(ctx, from, into) {
    for (const task of ctx.state.tasks) {
      if (task.tags.some((r) => r.name === from.name && r.dimension === from.dimension)) {
        const rest = task.tags.filter((r) => !(r.name === from.name && r.dimension === from.dimension));
        if (!rest.some((r) => r.name === into.name && r.dimension === into.dimension)) {
          rest.push({ name: into.name, dimension: into.dimension });
        }
        task.tags = rest;
      }
    }
  }
  function dimensionCommand(ctx) {
    return {
      async tagMoveDimension(params) {
        ctx.record("tagMoveDimension", params);
        const blocked = ctx.guardWritable();
        if (blocked !== null) {
          return { ok: false, error: blocked.toShape() };
        }
        const name = params.name.trim();
        if (name === "" || params.tagIds.length === 0) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u7EF4\u5EA6\u540D\u4E0E\u6807\u7B7E\u5217\u8868\u4E0D\u80FD\u4E3A\u7A7A").toShape() };
        }
        const found = ctx.state.dimensions.find((d) => d.key === params.key);
        const dim = found ?? createDimension(ctx, params.key, name);
        if (dim === null) {
          return {
            ok: false,
            error: new PkyError("INVALID_ARGUMENT", "\u7EF4\u5EA6 key \u53EA\u80FD\u5305\u542B\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u3001-\u3001_").toShape()
          };
        }
        const moving = ctx.state.tags.filter((t) => params.tagIds.includes(t.id) && t.dimension !== dim.key);
        const used = ctx.state.tags.filter((t) => t.dimension === dim.key).length;
        if (dim.maxTags - used < moving.length) {
          return {
            ok: false,
            error: new PkyError("INVALID_ARGUMENT", "\u76EE\u6807\u7EF4\u5EA6\u5269\u4F59\u540D\u989D\u4E0D\u8DB3\uFF0C\u5148\u6E05\u7406\u6216\u8C03\u9AD8\u4E0A\u9650").toShape()
          };
        }
        for (const tag of moving) {
          tag.dimension = dim.key;
        }
        return { ok: true, data: { ok: true } };
      }
    };
  }
  function createDimension(ctx, rawKey, name) {
    const key = rawKey.trim().toLowerCase();
    if (key === "" || !/^[a-z0-9_-]+$/.test(key)) {
      return null;
    }
    const dim = {
      id: ctx.state.dimensions.reduce((max, d) => Math.max(max, d.id), 0) + 1,
      key,
      name,
      cardinality: "multi",
      maxTags: 30,
      sort: ctx.state.dimensions.reduce((max, d) => Math.max(max, d.sort), 0) + 1,
      enabled: true
    };
    ctx.state.dimensions.push(dim);
    return dim;
  }
  function recomputeUsage(ctx) {
    for (const tag of ctx.state.tags) {
      tag.usage = ctx.state.tasks.filter(
        (task) => task.tags.some((r) => r.name === tag.name && r.dimension === tag.dimension)
      ).length;
    }
  }

  // src/client/mockPrompts.ts
  function findPromptSpec(ctx, key) {
    return ctx.state.promptSpecs.find((s) => s.storageKey === key);
  }
  function promptCommands(ctx) {
    return {
      async promptList() {
        ctx.record("promptList");
        return { ok: true, data: { specs: ctx.state.promptSpecs } };
      },
      async promptGet(params) {
        ctx.record("promptGet", params);
        const spec = findPromptSpec(ctx, params.key);
        if (spec === void 0) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u8BE5\u63D0\u793A\u8BCD\u4E0D\u652F\u6301\u7F16\u8F91").toShape() };
        }
        return { ok: true, data: spec };
      },
      async promptOverride(params) {
        ctx.record("promptOverride", params);
        return applyPromptOverride(ctx, params);
      },
      async promptReset(params) {
        ctx.record("promptReset", params);
        const spec = findPromptSpec(ctx, params.key);
        if (spec === void 0) {
          return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u8BE5\u63D0\u793A\u8BCD\u4E0D\u652F\u6301\u7F16\u8F91").toShape() };
        }
        spec.overrideText = null;
        spec.source = "default";
        spec.text = spec.defaultText;
        return { ok: true, data: spec };
      }
    };
  }
  async function applyPromptOverride(ctx, params) {
    const spec = findPromptSpec(ctx, params.key);
    if (spec === void 0) {
      return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u8BE5\u63D0\u793A\u8BCD\u4E0D\u652F\u6301\u7F16\u8F91").toShape() };
    }
    const revision = promptRevisionError(spec, params);
    if (revision !== null) {
      return { ok: false, error: revision.toShape() };
    }
    const invalid = promptValidationError(spec, params.value);
    if (invalid !== null) {
      return { ok: false, error: invalid.toShape() };
    }
    spec.overrideText = params.value.trim() === "" ? null : params.value;
    spec.source = spec.overrideText === null ? "default" : "custom";
    spec.text = spec.overrideText ?? spec.defaultText;
    return { ok: true, data: { spec, unknownPlaceholders: [] } };
  }
  function promptRevisionError(spec, params) {
    if (params.force || params.expectedValue === void 0) {
      return null;
    }
    const current = spec.overrideText ?? "";
    if (current !== (params.expectedValue ?? "")) {
      return new PkyError("SETTING_MODIFIED_ELSEWHERE", "\u63D0\u793A\u8BCD\u8986\u76D6\u5DF2\u5728\u53E6\u4E00\u5904\u88AB\u4FEE\u6539", "\u786E\u8BA4\u8986\u76D6\u8BF7\u5E26 force \u91CD\u53D1\u6574\u503C");
    }
    return null;
  }
  function promptValidationError(spec, value) {
    if (Array.from(value).length > 2e4) {
      return new PkyError("PROMPT_VALIDATION_FAILED", "\u63D0\u793A\u8BCD\u957F\u5EA6\u8D85\u8FC7\u4E0A\u9650\uFF08\u6700\u591A 20000 \u5B57\u7B26\uFF09");
    }
    const missing = spec.requiredPlaceholders.filter((p) => !value.includes(p));
    if (value.trim() !== "" && missing.length > 0) {
      return new PkyError("PROMPT_VALIDATION_FAILED", `\u7F3A\u5C11\u5FC5\u8981\u5360\u4F4D\u7B26\uFF1A${missing.join("\u3001")}`);
    }
    return null;
  }

  // src/client/mockMisc.ts
  function diagCommands(ctx) {
    return {
      async diagnosticsSnapshot() {
        ctx.record("diagnosticsSnapshot");
        const data = {
          links: ctx.state.diagnostics,
          helperCaps: ctx.state.helperCaps,
          shortcutRegistered: ctx.state.shortcutRegistered,
          sshFamily: ctx.state.sshFamily,
          helperVersion: ctx.state.helperVersion
        };
        return { ok: true, data };
      },
      async supportReport() {
        ctx.record("supportReport");
        return { ok: true, data: { text: "pokemon-choose-you dsh plugin support report (redacted)" } };
      }
    };
  }
  function logCommands(ctx) {
    const ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
    return {
      async logQuery(params) {
        ctx.record("logQuery", params);
        let entries = [...ctx.state.logEntries];
        if (params?.minLevel !== void 0) {
          entries = entries.filter((e) => ORDER[e.level] >= ORDER[params.minLevel]);
        }
        if (params?.target !== void 0 && params.target !== "") {
          entries = entries.filter((e) => e.target === params.target);
        }
        const total = entries.length;
        const offset = params?.offset ?? 0;
        const limit = params?.limit ?? 500;
        return { ok: true, data: { entries: entries.slice(offset, offset + limit), total } };
      }
    };
  }
  function mockPollNow(ctx) {
    ctx.record("pollNow");
    if (!ctx.state.larkAuthorized) {
      return { ok: false, error: new PkyError("LARK_UNAUTHORIZED", "\u98DE\u4E66\u672A\u6388\u6743\uFF0C\u8F6E\u8BE2\u5DF2\u6682\u505C").toShape() };
    }
    return { ok: true, data: ctx.state.health };
  }
  function mockPetRunning(ctx, command, running) {
    ctx.record(command);
    ctx.state.petRunning = running;
    return { ok: true, data: { ok: true } };
  }
  function mockMacAuthorizationStatus(ctx, params) {
    ctx.record("macAuthorizationStatus", params);
    if (params?.kind !== "accessibility") {
      return { ok: false, error: new PkyError("INVALID_ARGUMENT", `\u672A\u77E5\u6388\u6743\u7C7B\u578B ${String(params?.kind)}`).toShape() };
    }
    return { ok: true, data: { ...ctx.state.macAuth } };
  }
  function miscCommands(ctx) {
    return {
      async pollNow() {
        return await mockPollNow(ctx);
      },
      async petShow() {
        return mockPetRunning(ctx, "petShow", true);
      },
      async petHide() {
        return mockPetRunning(ctx, "petHide", false);
      },
      async petStatus() {
        ctx.record("petStatus");
        return { ok: true, data: { running: ctx.state.petRunning } };
      },
      async petMove(params) {
        ctx.record("petMove", params);
        return { ok: true, data: { ok: true } };
      },
      async dbStatus() {
        ctx.record("dbStatus");
        return { ok: true, data: ctx.state.dbStatus };
      },
      async pomoTryFive(params) {
        ctx.record("pomoTryFive", params);
        return { ok: true, data: { ok: true } };
      },
      async macAuthorizationStatus(params) {
        return await mockMacAuthorizationStatus(ctx, params);
      },
      async macAuthPaneOpen() {
        ctx.record("macAuthPaneOpen");
        return { ok: true, data: { ok: true } };
      }
    };
  }

  // src/client/model.ts
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
      overdueTasks: open.filter((t) => isOverdue(t, today))
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
    return [...groups.entries()].filter(([date]) => date !== "").sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, tasks: list }));
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

  // src/client/mockRead.ts
  var MOCK_NOW = "2026-10-11T09:00:00+08:00";
  function mockToday() {
    const d = /* @__PURE__ */ new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  function dueOrActive(today, task) {
    if (task.status === "active" || task.status === "paused") {
      return true;
    }
    return task.dueAt !== null && task.dueAt.slice(0, 10) <= today;
  }
  function dispatchableOf(task) {
    if (task.status === "done" || task.status === "cancelled") {
      return false;
    }
    return task.dispatchState === null || task.dispatchState === "done" || task.dispatchState === "failed";
  }
  function mockPanelSnapshot(ctx) {
    const today = mockToday();
    const tasks = ctx.state.tasks;
    const snapshot = adventureSnapshot(tasks, today);
    const groups = suggestionGroups(ctx.state.messages);
    const stats = dexStats(tasks);
    return {
      now: MOCK_NOW,
      adventure: {
        active: tasks.filter((t) => t.status === "active" || t.status === "paused"),
        dueToday: snapshot.todayTasks.filter((t) => t.status !== "active" && t.status !== "paused"),
        overdue: snapshot.overdueTasks
      },
      grass: grassTasks(tasks),
      route: routeGroups(tasks).flatMap((group) => group.tasks),
      dex: {
        done: tasks.filter((t) => t.status === "done"),
        cancelled: tasks.filter((t) => t.status === "cancelled"),
        stats: { caught: stats.caught, escaped: stats.escaped }
      },
      radio: {
        pending: groups.pending,
        none: groups.none,
        error: groups.failed,
        escaped: groups.escaped,
        accepted: groups.caught,
        health: ctx.state.health
      },
      logs: ctx.state.sessions,
      currentTask: tasks.find((t) => t.status === "active") ?? null,
      categories: ctx.state.categories,
      dimensions: ctx.state.dimensions,
      tags: ctx.state.tags
    };
  }
  function mockTaskDetail(ctx, task) {
    return {
      task,
      followups: ctx.state.followups[task.id] ?? [],
      dispatch: {
        state: task.dispatchState,
        dispatchedSession: task.dispatchedSession,
        dispatchable: dispatchableOf(task)
      },
      timeline: ctx.state.sessions.filter((s) => s.taskId === task.id)
    };
  }
  async function mockStreakInfo(ctx) {
    ctx.record("streakInfo");
    const today = mockToday();
    const doneDays = new Set(
      ctx.state.tasks.filter((t) => t.status === "done" && t.completedAt !== null).map((t) => t.completedAt.slice(0, 10))
    );
    let days = 0;
    let grace = 1;
    const cursor = /* @__PURE__ */ new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 400; i += 1) {
      const day = cursor.toISOString().slice(0, 10);
      if (doneDays.has(day)) {
        days += 1;
      } else if (grace > 0) {
        grace -= 1;
      } else {
        break;
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const todayCount = ctx.state.tasks.filter((t) => t.status === "done" && t.completedAt?.slice(0, 10) === today).length;
    const next = [10, 50, 100, 200, 500, 1e3].find((m) => m > days);
    return { ok: true, data: next === void 0 ? { days, todayCount } : { days, todayCount, nextMilestone: next } };
  }
  function readCommands(ctx) {
    return {
      async panelSnapshot() {
        ctx.record("panelSnapshot");
        return { ok: true, data: mockPanelSnapshot(ctx) };
      },
      async taskDetail(params) {
        ctx.record("taskDetail", params);
        const task = ctx.findTask(params.taskId);
        if (task === void 0) {
          return { ok: false, error: new PkyError("NOT_FOUND", `\u4EFB\u52A1 ${params.taskId} \u4E0D\u5B58\u5728`).toShape() };
        }
        return { ok: true, data: mockTaskDetail(ctx, task) };
      },
      async taskSearch(params) {
        ctx.record("taskSearch", params);
        return { ok: true, data: { tasks: searchMockTasks(ctx, params.query) } };
      },
      async todayTasks() {
        ctx.record("todayTasks");
        const today = mockToday();
        return { ok: true, data: { tasks: ctx.state.tasks.filter((t) => dueOrActive(today, t)) } };
      },
      async categoriesList() {
        ctx.record("categoriesList");
        return { ok: true, data: { categories: ctx.state.categories } };
      },
      streakInfo: () => mockStreakInfo(ctx)
    };
  }
  function searchMockTasks(ctx, query) {
    const q = query.trim();
    if (q === "") {
      return [];
    }
    return ctx.state.tasks.filter((task) => {
      const followups = ctx.state.followups[task.id] ?? [];
      return task.title.includes(q) || (task.note ?? "").includes(q) || task.tags.some((tag) => tag.name.includes(q)) || followups.some((note) => note.content.includes(q));
    });
  }

  // src/client/mockDeploy.ts
  function pendingCode(code) {
    return code;
  }
  function paramError2(message, hint) {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", message, hint).toShape() };
  }
  function notFound(message) {
    return { ok: false, error: new PkyError("NOT_FOUND", message).toShape() };
  }
  function findDeployment(ctx, id) {
    return ctx.state.deployments.find((d) => d.id === id);
  }
  function writeBlocked(ctx) {
    const blocked = ctx.guardWritable();
    return blocked !== null ? { ok: false, error: blocked.toShape() } : null;
  }

  // src/client/mockDeployments.ts
  function validatePathField(label, value) {
    if (value.startsWith("~")) {
      return paramError2(`${label}\u9700\u4E3A\u5C55\u5F00\u540E\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u4E0D\u652F\u6301 ~ \u524D\u7F00\uFF09`);
    }
    return value;
  }
  function validateNodePath(params) {
    const nodePath = params.nodePath?.trim() ?? "";
    if (params.id === void 0 && nodePath === "") {
      return paramError2("Node \u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
    }
    return validatePathField("Node \u8DEF\u5F84", nodePath);
  }
  function validateUpsertParams(ctx, params) {
    const alias = params.alias.trim();
    if (alias === "") {
      return paramError2("\u522B\u540D\u4E0D\u80FD\u4E3A\u7A7A");
    }
    const nodeChecked = validateNodePath(params);
    if (typeof nodeChecked !== "string") {
      return nodeChecked;
    }
    const workdir = validatePathField("\u5DE5\u4F5C\u76EE\u5F55", params.workdir?.trim() ?? "");
    if (typeof workdir !== "string") {
      return workdir;
    }
    if (ctx.state.deployments.some((d) => d.alias === alias && d.id !== params.id)) {
      return paramError2(`\u522B\u540D\u300C${alias}\u300D\u5DF2\u5B58\u5728`);
    }
    return { alias, nodePath: nodeChecked, workdir };
  }
  function upsertCreate(ctx, params, fields) {
    const entity = {
      id: `dep-${ctx.state.deployments.length + 1}`,
      alias: fields.alias,
      nodePath: fields.nodePath,
      helperPath: "",
      helperHash: null,
      workdir: fields.workdir,
      note: params.note ?? "",
      status: "not_ready",
      lastError: null,
      provision: null,
      degraded: false
    };
    ctx.state.deployments.push(entity);
    return ctx.ok({ deployment: entity });
  }
  function upsertEdit(ctx, params, fields) {
    const entity = findDeployment(ctx, params.id ?? "");
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    entity.alias = fields.alias;
    if (fields.nodePath !== "") {
      entity.nodePath = fields.nodePath;
    }
    if (fields.workdir !== "") {
      entity.workdir = fields.workdir;
    }
    if (params.note !== void 0) {
      entity.note = params.note;
    }
    entity.status = "not_ready";
    entity.helperHash = null;
    return ctx.ok({ deployment: entity });
  }
  function mockDeploymentList(ctx) {
    ctx.record("deploymentList");
    const ds = ctx.state.deployments;
    const counts = {
      ready: ds.filter((d) => d.status === "ready").length,
      pending: ds.filter((d) => d.status !== "ready" && d.status !== "disconnected").length,
      broken: ds.filter((d) => d.status === "disconnected").length
    };
    return ctx.ok({ deployments: ds, counts });
  }
  function mockSshAliasList(ctx) {
    ctx.record("sshAliasList");
    return ctx.ok({ aliases: [...ctx.state.sshAliases] });
  }
  function mockDeploymentUpsert(ctx, params) {
    ctx.record("deploymentUpsert", params);
    const blocked = writeBlocked(ctx);
    if (blocked !== null) {
      return blocked;
    }
    const fields = validateUpsertParams(ctx, params);
    if ("ok" in fields) {
      return fields;
    }
    return params.id === void 0 ? upsertCreate(ctx, params, fields) : upsertEdit(ctx, params, fields);
  }
  function mockDeploymentDelete(ctx, params) {
    ctx.record("deploymentDelete", params);
    const blocked = writeBlocked(ctx);
    if (blocked !== null) {
      return blocked;
    }
    const entity = findDeployment(ctx, params.id);
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    ctx.state.deployments = ctx.state.deployments.filter((d) => d.id !== params.id);
    const attempted = entity.status === "ready" || entity.status === "disconnected";
    return ctx.ok({
      id: params.id,
      cleanup: attempted ? entity.status === "disconnected" ? { attempted: true, ok: false, detail: "\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u8FDC\u7AEF\u81EA\u6E05\u7406\u8DF3\u8FC7\uFF08\u4EC5\u8BB0\u5F55\u5230\u8BCA\u65AD\u6BB5\uFF09" } : { attempted: true, ok: true } : { attempted: false, ok: true }
    });
  }
  function mockDeploymentRecheck(ctx, params) {
    ctx.record("deploymentRecheck", params);
    const blocked = writeBlocked(ctx);
    if (blocked !== null) {
      return blocked;
    }
    const entity = findDeployment(ctx, params.id);
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    if (entity.status === "disconnected") {
      if (ctx.state.recheckRecovers) {
        entity.status = "ready";
        entity.lastError = null;
      } else {
        entity.lastError = "\u8FDE\u63A5\u4E0D\u53EF\u7528\uFF08\u514D\u5BC6\u767B\u5F55\u672A\u914D\u7F6E\u6216\u5DF2\u65AD\u5F00\uFF09";
      }
    }
    return ctx.ok({ deployment: entity });
  }
  function deploymentCommands(ctx) {
    return {
      async deploymentList() {
        return await mockDeploymentList(ctx);
      },
      async sshAliasList() {
        return await mockSshAliasList(ctx);
      },
      async deploymentUpsert(params) {
        return await mockDeploymentUpsert(ctx, params);
      },
      async deploymentDelete(params) {
        return await mockDeploymentDelete(ctx, params);
      },
      async deploymentRecheck(params) {
        return await mockDeploymentRecheck(ctx, params);
      }
    };
  }

  // src/client/mockProvision.ts
  var MOCK_NOW2 = "2026-10-17T09:00:00+08:00";
  var PROVISION_STEPS = ["probe-ssh", "probe-node", "upload", "verify"];
  var STEP_OK_DETAIL = {
    "probe-ssh": "SSH \u8FDE\u63A5\u6210\u529F \xB7 \u8FDC\u7AEF\u4E3B\u76EE\u5F55 /home/trainer",
    "probe-node": "v20.11.0",
    upload: "\u8FDC\u7AEF\u7EC4\u4EF6\u5B89\u88C5\u5B8C\u6210",
    verify: "\u8FDC\u7AEF\u7EC4\u4EF6\u9A8C\u8BC1\u901A\u8FC7"
  };
  function initialProvision() {
    const steps = {};
    for (const step of PROVISION_STEPS) {
      steps[step] = { status: "pending", at: "" };
    }
    return { steps, homeDir: null };
  }
  function provisionView(entity) {
    const steps = PROVISION_STEPS.map((step) => {
      const result = entity.provision?.steps[step];
      return { step, status: result?.status ?? "pending", message: result?.message ?? null };
    });
    const failed = steps.find((s) => s.status === "failed");
    return {
      steps,
      failedStep: failed?.step ?? null,
      retryable: failed !== void 0,
      done: steps.every((s) => s.status === "ok")
    };
  }
  function failProvisionStep(entity, provision, next, fail2) {
    const message = fail2.message ?? `\u6B65\u9AA4 ${next} \u6267\u884C\u5931\u8D25`;
    const tag = fail2.kind === "auth" ? "SSH_AUTH_REQUIRED" : fail2.kind === "hash" ? "HELPER_HASH_MISMATCH" : "PROVISION_STEP_FAILED";
    provision.steps[next] = { status: "failed", tag, message, at: MOCK_NOW2 };
    entity.status = "not_ready";
    entity.lastError = message;
    if (fail2.kind === "auth") {
      return {
        ok: false,
        error: new PkyError("SSH_AUTH_REQUIRED", message, "\u5148\u5728\u672C\u673A\u6267\u884C ssh-copy-id \u914D\u597D\u514D\u5BC6\u767B\u5F55\uFF0C\u518D\u91CD\u8BD5").toShape()
      };
    }
    if (fail2.kind === "hash") {
      return {
        ok: false,
        error: new PkyError(
          pendingCode("HELPER_HASH_MISMATCH"),
          message,
          "\u8FDC\u7AEF\u7EC4\u4EF6\u9A8C\u8BC1\u672A\u901A\u8FC7\u2014\u2014\u53EF\u91CD\u65B0\u5B89\u88C5\uFF0C\u6216\u6539\u7528\u76F4\u8FDE\u6A21\u5F0F"
        ).toShape()
      };
    }
    return {
      ok: false,
      error: new PkyError(pendingCode("PROVISION_STEP_FAILED"), message, `\u5931\u8D25\u6B65\u9AA4\uFF1A${next}`).toShape()
    };
  }
  function mockProvisionRun(ctx, params) {
    const blocked = writeBlocked(ctx);
    if (blocked !== null) {
      return blocked;
    }
    const entity = findDeployment(ctx, params.id);
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    const provision = entity.provision ??= initialProvision();
    let next = PROVISION_STEPS.find((step) => provision.steps[step].status !== "ok");
    if (next === void 0) {
      if (params.restart !== true) {
        return ctx.ok({ status: provisionView(entity) });
      }
      for (const step of PROVISION_STEPS) {
        provision.steps[step] = { status: "pending", at: "" };
      }
      provision.homeDir = null;
      entity.helperHash = null;
      entity.degraded = false;
      entity.status = "not_ready";
      entity.lastError = null;
      next = "probe-ssh";
    }
    const fail2 = ctx.state.provisionFail;
    if (fail2 !== null && fail2.step === next) {
      return failProvisionStep(entity, provision, next, fail2);
    }
    provision.steps[next] = { status: "ok", message: STEP_OK_DETAIL[next], at: MOCK_NOW2 };
    if (PROVISION_STEPS.every((step) => provision.steps[step].status === "ok")) {
      entity.status = "ready";
      entity.degraded = false;
      entity.helperPath = "/home/trainer/.dsh-helper/pky-helper-1.0.0.js";
      entity.helperHash = "mock-sha256-abcdef";
      entity.lastError = null;
    }
    return ctx.ok({ status: provisionView(entity) });
  }
  function mockProvisionStatus(ctx, params) {
    ctx.record("provisionStatus", params);
    const entity = findDeployment(ctx, params.id);
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    return ctx.ok({ status: provisionView(entity) });
  }
  function mockDegradeConfirm(ctx, params) {
    ctx.record("deploymentDegradeConfirm", params);
    const blocked = writeBlocked(ctx);
    if (blocked !== null) {
      return blocked;
    }
    const entity = findDeployment(ctx, params.id);
    if (entity === void 0) {
      return notFound(`\u90E8\u7F72 ${params.id} \u4E0D\u5B58\u5728`);
    }
    if (params.acknowledgedRisk !== true) {
      return paramError2("\u8F6C\u76F4\u8FDE\u9700\u663E\u5F0F\u786E\u8BA4\u98CE\u9669\uFF08acknowledgedRisk: true\uFF09");
    }
    entity.degraded = true;
    entity.status = "ready";
    entity.lastError = null;
    return ctx.ok({ deployment: entity });
  }
  function provisionCommands(ctx) {
    return {
      async provisionRun(params) {
        ctx.record("provisionRun", params);
        return await mockProvisionRun(ctx, params);
      },
      async provisionStatus(params) {
        return await mockProvisionStatus(ctx, params);
      },
      async deploymentDegradeConfirm(params) {
        return await mockDegradeConfirm(ctx, params);
      }
    };
  }

  // src/client/mockRemote.ts
  function kindOfGroup(kind, group) {
    if (group === "radio") {
      return kind === "classify" || kind === "capture";
    }
    if (group === "dispatch") {
      return kind === "dispatch_headless" || kind === "dispatch_interactive";
    }
    return kind === "pk";
  }
  function clampInt(value, fallback, min, max) {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(max, Math.max(min, n));
  }
  function sessionsPageOf(ctx) {
    return async (params) => {
      ctx.record("sessionsPage", params);
      const group = params?.group ?? "all";
      const limit = clampInt(params?.limit, 20, 1, 100);
      const offset = clampInt(params?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const rows = ctx.state.sessionRows;
      const counts = {
        all: rows.length,
        radio: rows.filter((r) => kindOfGroup(r.kind, "radio")).length,
        dispatch: rows.filter((r) => kindOfGroup(r.kind, "dispatch")).length,
        other: rows.filter((r) => kindOfGroup(r.kind, "other")).length
      };
      const matched = group === "all" ? rows : rows.filter((r) => kindOfGroup(r.kind, group));
      const total = matched.length;
      const page = [...matched].sort((a, b) => b.id - a.id).slice(offset, offset + limit);
      return ctx.ok({ rows: page, counts, total });
    };
  }
  function mockReplayLine(row) {
    if (row.tmuxSession.trim() !== "") {
      return `tmux attach-session -t ${row.tmuxSession.trim()}`;
    }
    return `${row.command ?? "claude"} --resume ${row.sessionId}`;
  }
  function sessionReplayOf(ctx) {
    return async (params) => {
      ctx.record("sessionReplay", params);
      const row = ctx.state.sessionRows.find((r) => r.id === params.rowId);
      if (row === void 0) {
        return notFound(`\u4F1A\u8BDD\u8BB0\u5F55 No.${params.rowId} \u4E0D\u5B58\u5728`);
      }
      const replayable = row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
      if (!replayable) {
        return paramError2("\u8BE5\u4F1A\u8BDD\u65E0\u56DE\u653E\u53E5\u67C4\uFF08session_id \u4E0E tmux \u4F1A\u8BDD\u540D\u7686\u65E0\uFF09");
      }
      if (row.remoteHost.trim() === "") {
        return ctx.ok({
          routed: {
            world: "local",
            line: mockReplayLine(row),
            workdir: row.workdir,
            opened: false,
            note: "\u5BBF\u4E3B\u65E0\u7B2C\u4E09\u65B9\u7EC8\u7AEF\u9762\u677F\u2014\u2014\u547D\u4EE4\u884C\u56DE\u4F20\u5BA2\u6237\u7AEF\u590D\u5236\u6267\u884C"
          }
        });
      }
      return remoteReplayOutcome(ctx, row);
    };
  }
  async function remoteReplayOutcome(ctx, row) {
    const target = row.remoteHost.trim();
    const dep = ctx.state.deployments.find((d) => d.alias === target);
    if (dep === void 0 && (row.remotePort > 0 || row.remoteKey.trim() !== "")) {
      return ctx.ok({
        routed: {
          world: { sshTarget: target },
          note: `ssh \u522B\u540D\u56DE\u653E\uFF08\u5FEB\u7167 ${target}:${row.remotePort}\uFF09\u2014\u2014desktop \u8F7D\u4F53\u5F39\u5916\u90E8\u7EC8\u7AEF`
        }
      });
    }
    if (dep === void 0 || dep.status !== "ready") {
      return {
        ok: false,
        error: new PkyError(
          pendingCode("DEPLOYMENT_NOT_READY"),
          `\u4F1A\u8BDD\u7684\u6267\u884C\u90E8\u7F72\u300C${target}\u300D${dep === void 0 ? "\u5DF2\u88AB\u79FB\u9664" : "\u672A\u5C31\u7EEA"}\uFF0C\u65E0\u6CD5\u56DE\u653E`,
          "\u53EF\u5728\u672C\u673A\u6253\u5F00\u8BE5\u4F1A\u8BDD\u6240\u5C5E agent \u7684\u5386\u53F2\u9009\u62E9\u5668\u56DE\u653E\uFF0C\u6216\u91CD\u65B0\u5F00\u901A\u8BE5\u90E8\u7F72\u540E\u518D\u8BD5"
        ).toShape()
      };
    }
    return ctx.ok({ routed: { world: { deploymentAlias: dep.alias }, note: "\u8FDC\u7AEF\u56DE\u653E\u5DF2\u5524\u8D77" } });
  }
  function sessionCommands(ctx) {
    return {
      sessionsPage: sessionsPageOf(ctx),
      sessionReplay: sessionReplayOf(ctx)
    };
  }

  // src/client/mockBackup.ts
  var MOCK_BACKUP_FILE = "pokemon-choose-you-20261011-080000.db";
  var MOCK_EXPORT_PATHS = {
    json: "/mock/.choose-you/data/exports/pokemon-choose-you-full-20261011-080000.json",
    csv: "/mock/.choose-you/data/exports/pokemon-choose-you-tasks-20261011-080000.csv",
    report: "/mock/.choose-you/data/exports/pokemon-choose-you-daily-2026-10-11.md"
  };
  function mockBackupRun(ctx) {
    ctx.record("backupRun");
    const entry = { file: MOCK_BACKUP_FILE, size: 4096, createdAt: "2026-10-11T08:00:00+08:00" };
    ctx.state.backups = [entry, ...ctx.state.backups.filter((b) => b.file !== entry.file)];
    return { ok: true, data: { file: entry.file, files: ctx.state.backups } };
  }
  function mockBackupList(ctx) {
    ctx.record("backupList");
    return { ok: true, data: { backups: ctx.state.backups } };
  }
  function mockExportRun(ctx, params) {
    ctx.record("exportRun", params);
    const kind = params?.kind;
    if (kind !== "json" && kind !== "csv" && kind !== "report") {
      return {
        ok: false,
        error: new PkyError(
          "INVALID_ARGUMENT",
          `\u672A\u77E5\u5BFC\u51FA\u7C7B\u578B ${String(kind)}`,
          "kind \u987B\u4E3A json / csv / report"
        ).toShape()
      };
    }
    return { ok: true, data: { path: MOCK_EXPORT_PATHS[kind] } };
  }
  function mockImportValidate(ctx, params) {
    ctx.record("importValidate", params);
    const fixture = ctx.state.importFiles.find((f) => f.path === params?.path);
    if (fixture === void 0) {
      return {
        ok: false,
        error: new PkyError("IMPORT_VALIDATION_FAILED", "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB").toShape()
      };
    }
    if (fixture.reasons !== void 0 && fixture.reasons.length > 0) {
      return {
        ok: false,
        error: new PkyError("IMPORT_VALIDATION_FAILED", fixture.reasons.join("\uFF1B")).toShape()
      };
    }
    const summary = fixture.summary ?? {
      app: "pokemon-choose-you",
      schemaVersion: 1,
      counts: { tasks: 12, categories: 2, tags: 5 },
      compatible: true,
      backupFile: ctx.state.importResult.backupId
    };
    return { ok: true, data: { summary } };
  }
  function mockImportRun(ctx, params) {
    ctx.record("importRun", params);
    const blocked = ctx.guardWritable();
    if (blocked !== null) {
      return { ok: false, error: blocked.toShape() };
    }
    if (params?.confirmed !== true) {
      return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u5BFC\u5165\u987B\u663E\u5F0F\u786E\u8BA4\uFF08confirmed: true\uFF09").toShape() };
    }
    const fixture = ctx.state.importFiles.find((f) => f.path === params.path);
    if (fixture === void 0 || fixture.reasons !== void 0 && fixture.reasons.length > 0) {
      return { ok: false, error: new PkyError("IMPORT_VALIDATION_FAILED", "\u6587\u4EF6\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C0 \u884C\u53D8\u66F4").toShape() };
    }
    if (fixture.backupFail === true) {
      return {
        ok: false,
        error: new PkyError("BACKUP_FAILED", "\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u81EA\u52A8\u5907\u4EFD\u5931\u8D25").toShape()
      };
    }
    return { ok: true, data: { result: { ...ctx.state.importResult } } };
  }
  function mockRestoreRun(ctx, params) {
    ctx.record("restoreRun", params);
    const blocked = ctx.guardWritable();
    if (blocked !== null) {
      return { ok: false, error: blocked.toShape() };
    }
    if (params?.confirmed !== true) {
      return { ok: false, error: new PkyError("INVALID_ARGUMENT", "\u6062\u590D\u987B\u663E\u5F0F\u786E\u8BA4\uFF08confirmed: true\uFF09").toShape() };
    }
    const outcome = ctx.state.restoreOutcome;
    if (outcome !== null && !outcome.ok) {
      return { ok: false, error: new PkyError(outcome.code, outcome.message).toShape() };
    }
    const result = outcome !== null ? outcome.result : { backupId: "pokemon-choose-you-20261017-090000.db", migratedTo: 1, seeded: 2 };
    return { ok: true, data: { result } };
  }
  function mockExportDirOpen(ctx) {
    ctx.record("exportDirOpen");
    const dir = ctx.state.exportDir;
    if (dir.error !== void 0) {
      return {
        ok: false,
        error: new PkyError(pendingCode("HELPER_CAPABILITY_MISSING"), dir.error, dir.path).toShape()
      };
    }
    return { ok: true, data: { ok: true, path: dir.path } };
  }
  function backupCommands(ctx) {
    return {
      async backupRun() {
        return await mockBackupRun(ctx);
      },
      async backupList() {
        return await mockBackupList(ctx);
      },
      async exportRun(params) {
        return await mockExportRun(ctx, params);
      },
      async importValidate(params) {
        return await mockImportValidate(ctx, params);
      },
      async importRun(params) {
        return await mockImportRun(ctx, params);
      },
      async restoreRun(params) {
        return await mockRestoreRun(ctx, params);
      },
      async exportDirOpen() {
        return await mockExportDirOpen(ctx);
      }
    };
  }

  // src/client/mockHost.ts
  function delay(value) {
    return Promise.resolve(value);
  }
  function defaultHealth() {
    return {
      level: "ok",
      lastSuccessAt: "2026-10-11T08:00:00+08:00",
      nextPollAt: "2026-10-11T08:02:00+08:00",
      consecutiveFailures: 0,
      pendingCount: 0
    };
  }
  function defaultHelperCaps() {
    return {
      "sys-tray": true,
      "sys-shortcut": true,
      "sys-notify": true,
      "sys-tts": true,
      "sys-dialog": true,
      "sys-open": true,
      "input-count": true,
      "mac-auth": true
    };
  }
  function defaultState() {
    return {
      tasks: [],
      categories: [],
      messages: [],
      settings: {},
      agents: [],
      health: defaultHealth(),
      dbStatus: { userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "rw" },
      larkAuthorized: true,
      filters: [],
      logEntries: [],
      diagnostics: [],
      promptSpecs: [],
      deleted: [],
      sessions: [],
      followups: {},
      taskLogs: {},
      backups: [],
      tags: [],
      dimensions: [],
      tagCheckup: { merges: [], zombies: [], newDimensions: [], judged: false },
      pkSkill: { installedVersion: null, checked: false },
      petRunning: true,
      deployments: [],
      sshAliases: [],
      provisionFail: null,
      recheckRecovers: false,
      sessionRows: [],
      dispatchHandoff: {},
      importFiles: [],
      importResult: { backupId: "pokemon-choose-you-20261017-090000.db", applied: 12 },
      restoreOutcome: null,
      exportDir: { path: "/mock/.choose-you/data/exports" },
      macAuth: {
        granted: false,
        helperPath: "/mock/.dsh/electron/dist/pky-helper.app/Contents/MacOS/pky-helper"
      },
      helperCaps: defaultHelperCaps(),
      shortcutRegistered: true,
      sshFamily: { ok: true },
      helperVersion: null
    };
  }
  function createContext(initial) {
    const state = { ...defaultState(), ...initial };
    const calls = [];
    return {
      state,
      calls,
      record(command, params) {
        calls.push({ command, params: params ?? {} });
      },
      findTask(id) {
        return state.tasks.find((t) => t.id === id);
      },
      findMessage(messageId) {
        return state.messages.find((m) => m.messageId === messageId);
      },
      guardWritable() {
        return state.dbStatus.mode === "ro" ? new PkyError("DB_SCHEMA_TOO_NEW", "\u5F85\u529E\u5E93\u7248\u672C\u8F83\u65B0\uFF0C\u9700\u5347\u7EA7\u63D2\u4EF6\u540E\u624D\u80FD\u5199\u5165") : null;
      },
      guardPending(messageId) {
        const message = state.messages.find((m) => m.messageId === messageId);
        if (message === void 0) {
          return new PkyError("INVALID_ARGUMENT", `\u6D88\u606F ${messageId} \u4E0D\u5B58\u5728`);
        }
        return message.reviewStatus === "pending" ? null : new PkyError("SUGGESTION_ALREADY_RESOLVED", "\u8BE5\u5EFA\u8BAE\u5DF2\u5728\u53E6\u4E00\u5904\u5904\u7F6E");
      },
      nextTaskId() {
        return state.tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      },
      ok(data) {
        return delay({ ok: true, data });
      }
    };
  }
  function mockHost(initial = {}) {
    const ctx = createContext(initial);
    const pageOpenListeners = /* @__PURE__ */ new Set();
    const host = {
      ...taskSwitchCommands(ctx),
      ...taskCloseCommands(ctx),
      ...releaseCommands(ctx),
      ...taskEditCommands(ctx),
      ...captureCommands(ctx),
      ...acceptCommands(ctx),
      ...dismissCommands(ctx),
      ...retryCommands(ctx),
      ...dispatchCommands(ctx),
      ...dispatchControlCommands(ctx),
      ...settingsCommands(ctx),
      ...categoryCommands(ctx),
      ...vocabularyCommands(ctx),
      ...tagHealthCommands(ctx),
      ...agentCommands(ctx),
      ...agentToolsCommands(ctx),
      ...filterCommands(ctx),
      ...promptCommands(ctx),
      ...diagCommands(ctx),
      ...logCommands(ctx),
      ...miscCommands(ctx),
      ...readCommands(ctx),
      ...backupCommands(ctx),
      ...deploymentCommands(ctx),
      ...provisionCommands(ctx),
      ...sessionCommands(ctx),
      onPageOpen(listener) {
        pageOpenListeners.add(listener);
        return () => {
          pageOpenListeners.delete(listener);
        };
      }
    };
    host.state = ctx.state;
    host.calls = ctx.calls;
    host.emitPageOpen = (event) => {
      for (const listener of pageOpenListeners) {
        listener(event);
      }
    };
    return host;
  }

  // __tests__/client/fixtures.ts
  function makeCategory(overrides) {
    return {
      name: `\u5206\u7C7B${overrides.id}`,
      pokemon: "pikachu",
      sprite: "pokemon/pikachu.gif",
      enabled: true,
      description: "",
      ...overrides
    };
  }
  function makeData(overrides = {}) {
    return {
      locale: "zh-Hans",
      today: "2026-10-11",
      tasks: [],
      categories: [makeCategory({ id: 1, name: "\u5DE5\u4F5C" }), makeCategory({ id: 2, name: "\u751F\u6D3B", pokemon: "eevee" })],
      messages: [],
      health: {
        level: "ok",
        lastSuccessAt: "2026-10-11T08:00:00+08:00",
        nextPollAt: "2026-10-11T08:02:00+08:00",
        consecutiveFailures: 0,
        pendingCount: 0
      },
      auth: { authorized: true, expired: false },
      followups: {},
      dispatches: {},
      sessions: [],
      routes: [],
      config: {
        language: "zh-Hans",
        pomodoro_enabled: "true",
        pomodoro_minutes: "25",
        break_minutes: "5",
        pomodoro_notify: "true",
        pomodoro_chime: "true",
        notifications_enabled: "true",
        remind_ahead_minutes: "0",
        quiet_hours_enabled: "true",
        quiet_start: "22:00",
        quiet_end: "08:00",
        reduce_motion: "false",
        overdue_mode: "collapse",
        date_format: "YYYY-MM-DD",
        time_format: "24h",
        due_relative: "true",
        close_to_tray: "true",
        backup_enabled: "true",
        backup_keep: "7",
        review_enabled: "true",
        review_dow: "1",
        main_pokemon: "",
        pokemon_quotes: "{}",
        pet_input_response: "false",
        pet_input_response_working: "false",
        pet_voice: "false",
        pet_mate: "false",
        feishu_poll_interval: "120",
        feishu_my_names: "",
        ai_agent_id: "",
        terminal_preference: "default",
        dispatch_auto_enabled: "false",
        dispatch_max_concurrent: "2",
        dispatch_worktree: "true",
        feishu_enabled: "false"
      },
      dbStatus: { userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "rw" },
      ...overrides
    };
  }

  // e2e/src/pre-entry.ts
  var pky = {
    mock: mockHost(),
    rpc: void 0,
    ctx: void 0,
    clientExports: null,
    registry: {}
  };
  window.__pky = pky;
  function seedMockState() {
    const data = makeData();
    Object.assign(pky.mock.state, {
      tasks: data.tasks,
      categories: data.categories,
      settings: { ...data.config }
    });
    pky.mock.state.deployments = [
      {
        id: "dep-1",
        alias: "gpu-1",
        nodePath: "/usr/local/bin/node",
        helperPath: "/home/dev/.dsh-helper/pky-0.1.0/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js",
        helperHash: "9d7c7403056a",
        workdir: "/srv/work",
        note: "\u8BAD\u7EC3\u673A",
        status: "ready",
        lastError: null,
        provision: { "probe-ssh": "done", "probe-node": "done", upload: "done", verify: "done" },
        degraded: false
      }
    ];
    pky.mock.state.sshAliases = ["gpu-1", "pky-remote"];
    pky.mock.state.helperCaps = {
      "sys-tray": true,
      "sys-shortcut": true,
      "sys-notify": true,
      "sys-tts": true,
      "sys-dialog": true,
      "sys-open": true,
      "input-count": false,
      "mac-auth": true
    };
    pky.mock.state.sshFamily = { ok: true, detail: null };
    pky.mock.state.shortcutRegistered = true;
    seedSessionRows();
  }
  function sessionRow(id, over) {
    return {
      id,
      taskId: null,
      agentId: "agent-1",
      agentName: "Claude Code",
      sessionId: null,
      command: "claude",
      exitCode: 0,
      status: "ok",
      durationMs: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      kind: "dispatch_headless",
      workdir: "",
      tmuxSession: "",
      remoteHost: "",
      remotePort: 0,
      remoteKey: "",
      createdAt: "2026-10-17T08:00:00+08:00",
      ...over
    };
  }
  function seedSessionRows() {
    pky.mock.state.sessionRows = [
      sessionRow(1, { sessionId: "sess-e2e-1", workdir: "/srv/work", durationMs: 61e3, costUsd: 0.012 }),
      sessionRow(2, { kind: "dispatch_interactive", sessionId: null, tmuxSession: "pky-e2e", durationMs: 12e4 }),
      sessionRow(3, { sessionId: "sess-e2e-3", workdir: "/srv/work", remoteHost: "gpu-1", remotePort: 22 })
    ];
  }
  function installRpc() {
    pky.rpc = {
      async call(_channel, endpoint, payload) {
        if (endpoint !== "pky/call") {
          return {
            ok: false,
            error: { code: "INVALID_ARGUMENT", message: `harness \u53EA\u63A5 pky/call\uFF08got ${endpoint}\uFF09`, details: {} }
          };
        }
        const { args } = payload ?? {};
        const command = args?.command;
        const table = pky.mock;
        const fn = command === void 0 ? void 0 : table[command];
        if (typeof fn !== "function") {
          return {
            ok: false,
            error: { code: "INVALID_ARGUMENT", message: `mock \u65E0\u547D\u4EE4 ${String(command)}`, details: {} }
          };
        }
        return { ok: true, value: await fn.call(pky.mock, args?.payload) };
      }
    };
  }
  function installModuleLoader() {
    const React = window.React;
    function jsxOf(type, props, key) {
      return React.createElement(type, key === void 0 ? props : { ...props, key });
    }
    const jsxRuntime = { jsx: jsxOf, jsxs: jsxOf, Fragment: React.Fragment };
    const requireOf = (name) => {
      if (name === "react") return React;
      if (name === "react-dom") return window.ReactDOM;
      if (name === "react/jsx-runtime") return jsxRuntime;
      throw new Error(`harness require \u9762\u5916: ${name}`);
    };
    window.__ModuleLoader__ = {
      load(mod) {
        const returned = mod.factory(requireOf);
        pky.clientExports = returned ?? {};
      }
    };
  }
  function installCtx() {
    pky.ctx = {
      slots: {
        inject(_key, contribute) {
          contribute();
          return () => void 0;
        },
        register(options, component) {
          pky.registry[options.key ?? options.id ?? options.name ?? "unknown"] = component;
          return () => void 0;
        }
      },
      locale: { tag: "zh-Hans" },
      connection: { rpc: pky.rpc },
      layout: { selectPanel: () => void 0 },
      // configForms 假件（clientEntry 装配期即消费 get()）：unavailable 固定快照——
      // 背包配置分区行不渲染（E2E 无该面用例；真值面经 mock rpc settings 键）。
      // getSnapshot 必须返回缓存引用（useSyncExternalStore 契约——新对象会渲染死循环）
      configForms: {
        get: () => ({
          subscribe: () => () => void 0,
          getSnapshot: () => CONFIG_FORMS_UNAVAILABLE,
          set: async () => false
        })
      }
    };
  }
  var CONFIG_FORMS_UNAVAILABLE = { status: "unavailable", writable: false };
  seedMockState();
  installRpc();
  installModuleLoader();
  installCtx();
})();
