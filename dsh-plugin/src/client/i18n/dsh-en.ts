/**
 * dsh.* incremental keys · English (uiux-design.md §8 EN column, aligned with
 * main-app dictionary terminology).
 */
export default {
  page: {
    title: "Pokédex",
    pending: "{n} pending",
  },
  empty: {
    tasks: "The tall grass is quiet — say it in chat, or ⚡ send a wire, and your first wild Pokémon appears",
    radio: "The airwaves are quiet. New messages show as a count — no interruptions.",
    dispatch: "No agents dispatched yet",
  },
  auth: {
    unauthorized: "The radio isn't tuned — authorize Feishu to start receiving",
    expired: "Feishu authorization expired; polling paused",
  },
  schema: {
    tooNew:
      "The Pokédex hit a snag: the todo database is newer than this plugin — upgrade to write. Browsing still works.",
    readonly: "Read-only mode",
  },
  toast: {
    alreadyHandled: "This suggestion was already handled on the other side",
    caught: 'Caught "{title}"',
    caughtMatch: "Match: update suggestion awaits your call",
    released: 'Released "{title}"',
    undo: "Undo {sec}s",
    dispatchBusy: "This task already has an active dispatch — close or reset it first",
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
    group: "AI judging failed · {n}",
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
      "J/K navigate · C catch · X release · U apply update · R restore · T accept tag · Esc close (active only inside the plugin page — no global shortcuts)",
    acceptTag: "＋ Accept new tag",
    judging: "Judging…",
  },
  dispatch: {
    tooltipQueued: "Queued, waiting to run",
    tooltipRunning: "Agent running",
    tooltipDone: "Reported — see timeline",
    tooltipFailed: "Failed: {reason}",
    badge: {
      queued: "Queued",
      running: "Dispatching",
      done: "Reported",
      failed: "Failed",
    },
    confirm:
      "Dispatching: {agent} · {scope} · {dir} · via {project}. Changes here won't overwrite the route. Interactive runs launch in the terminal panel — watch or take over anytime.",
    scopeLocal: "local",
    scopeRemote: "remote",
    sourceRoute: "project route",
    sourceDefault: "global default",
    redo: "Redispatch",
    cancelQueued: "Cancel queued",
  },
  agents: {
    commandRequired: "Agent command must not be empty (executable name or absolute path)",
    argsPh: "-p {prompt}",
    sshHostPh: "user@host",
    presetLabel: "Agent preset",
    presetCustom: "Custom",
  },
  pet: {
    showNotReady: "The pet didn't finish its startup handshake within 5 seconds — it may still be starting",
    clearMain: "Clear",
  },
  tag: {
    deleteConfirm: 'Delete tag "{name}"? Its task links will be removed as well.',
  },
  task: {
    reschedule: "Reschedule",
  },
  chip: {
    openPage: "Open the Pokédex page",
    resting: "Resting",
  },
  settings: {
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Save failed: {reason} — draft kept, retryable",
    unsavedTitle: "Unsaved changes",
    leaveTitle: "Backpack has unsaved changes.",
    leaveSave: "Save & leave",
    leaveDiscard: "Discard",
    leaveStay: "Stay",
    judgeSource: "Currently consuming results from the main app (dsh doesn't judge on its own)",
    dbStatusTitle: "Todo database status",
    dbStatusQuery: "Query database status",
    dbUserVersion: "Schema v{v} · {mode}",
    dbModeRw: "read-write OK",
    dbModeRo: "read-only (plugin upgrade required)",
    guideTitle: "User guide",
    guideLink: "docs/USER_GUIDE.md · dsh chapter ↗",
  },
  badge: {
    mainApp: "Affects the main app",
    notifications: "Affects main-app notifications",
    pet: "Affects the main app's pet",
    dispatch: "Affects main-app interactive dispatch",
  },
  pokeSearch: {
    placeholder: "Search Pokémon (1025 · name / No. / English)",
    searching: "Searching…",
    noResult: "No match — try another name or number",
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
    conflictRefreshed: "This prompt was updated on the other side — refreshed to the latest",
    forceOverwrite: "Modified elsewhere — overwrite?",
  },
} as const;
