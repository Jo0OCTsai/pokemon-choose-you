/**
 * dsh.* incremental keys · English (uiux-design.md §8 EN column, aligned with
 * main-app dictionary terminology).
 */
import deployKeys from "./dsh-en-deploy";

export default {
  page: {
    title: "Pokédex",
    pending: "{n} pending",
  },
  empty: {
    tasks: "The tall grass is quiet — say it in chat, send a wire",
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
    dispatchBusy: "This task already has a dispatch in progress — let it finish or reset it first",
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
      "J/K navigate · C catch · X release · U apply update · R restore · T accept tag · Esc close (active only inside the plugin page — no global shortcuts)",
    acceptTag: "＋ Accept new tag",
    judging: "Judging…",
  },
  dispatch: {
    handoffCopied: "Dispatch command copied — paste it into a terminal; the agent writes results back when done",
    handoffWeb:
      "Web carrier: a terminal window can't pop up on the host machine's screen — copy the command below into a local terminal, or use the DeepSeek desktop app for one-click launch",
    handoffManual: "Copy failed — copy the command below and run it in a terminal",
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
      "Dispatching: {agent} · {scope} · {dir} · via {project}. Changes here won't affect your defaults. The run opens in the terminal — check on it anytime.",
    scopeLocal: "local",
    scopeRemote: "remote",
    sourceRoute: "project route",
    sourceDefault: "global default",
    redo: "Redispatch",
    cancelQueued: "Cancel queued",
    worldDeployment: "deployment {alias}",
    worldLine: "Dispatching: {agent} · {world} · {dir}.",
    degradeDirect: "Direct mode: remote component not verified on dispatch",
    degradeInteractive: "Couldn't open a terminal window — command copied, paste it into your terminal",
    degradeNonPosix: "This remote machine can't run interactive terminal sessions; the task will run in the background",
    occupancy:
      "This task is still running on the remote — dispatching again runs two copies side by side; consider waiting for it to finish",
  },
  agents: {
    commandRequired: "Command must not be empty (a program name, e.g. claude)",
    argsPh: "-p {prompt}",
    sshHostPh: "user@host",
    presetLabel: "Agent preset",
    presetCustom: "Custom",
    deployment: "Deployment",
    deploymentNone: "Local",
  },
  pet: {
    showNotReady: "The pet didn't finish its startup handshake within 5 seconds — it may still be starting",
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
    dbStatusTitle: "Todo database status",
    dbStatusQuery: "Query database status",
    dbUserVersion: "Schema v{v} · {mode}",
    dbModeRw: "read-write OK",
    dbModeRo: "read-only (plugin upgrade required)",
    guideTitle: "User guide",
    guideLink: "docs/USER_GUIDE.md · dsh chapter ↗",
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
    worldSsh: "remote {target}",
    counts: "{n} total · page {page}/{pages}",
    limitLabel: "Per page",
    limitN: "{n} per page",
    replay: "Replay",
    replayOpened: "Replay opened in the terminal panel ({world})",
    replayCopied: "Replay command copied — paste it into a terminal ({world})",
    replayManual: "Copy failed — copy the command below and run it in a terminal ({world})",
    replayDir: "Working directory: {dir}",
    replayGone: "That session's remote deployment was removed — can't replay",
    emptyGroup: "No sessions in this group",
  },
  ...deployKeys,
  import: {
    entry: "Import JSON",
    title: "Import JSON",
    pickLabel: "Pick a file",
    pickHint: "Pick an exported JSON file — it's validated first and your current data is auto-backed up.",
    validating: "Validating…",
    invalid: "Validation failed: {reasons}. Database untouched (0 changes).",
    pickAnother: "Pick another file",
    confirmBody:
      "Import replaces all todo data (secrets & prompt overrides kept). Auto-backup created: {file}. This can't be undone — confirm to proceed.",
    counts: "File contains {n} todos",
    confirmOk: "Confirm import",
    running: "Working…",
    done: "Imported {n} items · auto-backup: {file}",
    backupFailed: "Pre-import backup failed: {reason}. Import aborted; database untouched.",
  },
  export: {
    dirOpen: "Open exports folder",
    dirOpenFailed: "Couldn't open exports folder: {reason} (folder created; path: {path})",
  },
  restore: {
    entry: "Restore",
    fromFile: "Restore from file…",
    title: "Restore backup",
    confirmBody:
      'Restoring "{file}" replaces the database; current data is auto-backed up first. Migrations & default categories re-run after.',
    confirmOk: "Confirm restore",
    running: "Working…",
    rejected: "Backup version is beyond this plugin's compatibility window — upgrade first. Database untouched.",
    done: "Restored · current data auto-backed up. Migrations & default categories re-run",
    failed: "Restore failed: {reason}. Database unchanged",
  },
  ax: {
    guide:
      "Input response needs Accessibility permission, and only counts keystroke rhythm — never keys, windows, or apps.",
    revoked: "Permission revoked — re-authorize to resume. Counting stays off until then",
    pathHint: "If missing from the list, drag this in or copy & ⌘⇧G: {path} (click to copy)",
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
      guide: "Provided by the pet helper — available again once helper is running",
      ssh: "Remote dispatch (dsh-ssh)",
      absent: "Helper not running — all features degraded; restart it from the plugin install directory",
      version: "helper runtime: {v}",
    },
    shortcutFailed: "Global shortcut registration failed (possibly taken) — ⌘⇧K still works while the panel is focused",
    sshMissing: "dsh-ssh family: not loaded — remote dispatch needs it (guide: {cmd})",
  },
  lark: {
    login: "Authorize",
    launched: "Login launched in the terminal panel — finish it there",
    launchFailed: "Failed to launch login: {reason}",
  },
  config: {
    judgeExecutor: "AI judgment mode",
    judgeExecutorDesc:
      "Who runs AI judgment on incoming messages (todo suggestions): the built-in channel runs on the host's own session agent (default, uses the host-configured model; each batch is one session, replayable in the host session list); None = the first enabled agent. Changes apply immediately (no save needed)",
    judgeSubagent: "Built-in dsh channel (default)",
    petAutoStart: "Show the pet automatically on startup",
    petAutoStartTip: "Summon the pet when DeepSeek Harness starts; turn off and show it from Backpack · Pet",
    unavailable:
      "Host settings service unavailable — plugin config cannot be edited in this composition (edit the profile's cordis.patch.yml instead)",
    writeFailed: "Save failed — try again",
  },
} as const;
