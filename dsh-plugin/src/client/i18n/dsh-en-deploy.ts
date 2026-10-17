/**
 * dsh.deploy 键 · English（从 dsh-en.ts 拆出——棘轮 max-lines，等量迁移；
 * dsh-en.ts 经 spread 合并，消费面不变）。
 */
export default {
  deploy: {
    title: "Remote deployments",
    counts: "ready {ready} · not ready {pending} · disconnected {broken}",
    empty: "No remote deployments yet. Add a machine to send agents afar",
    add: "+ Add deployment",
    edit: "Edit",
    remove: "Remove",
    provision: "Set up",
    reconnect: "Reconnect & check",
    wizardRunning: "Wizard running",
    directTag: "Direct mode (digest unchecked)",
    lastError: "Last error: {summary}",
    editFallback: "Saved. Deployment reset to not-ready — re-run the wizard to re-verify",
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
      concurrent: "Wizard already running — wait, reopen to watch, or abort first",
      step: {
        "probe-ssh": "Passwordless SSH probe",
        "probe-node": "Remote Node check",
        upload: "Helper upload & install",
        verify: "Digest check",
      },
      state: {
        pending: "Waiting",
        probing: "Probing…",
        installing: "Installing…",
        verifying: "Verifying…",
        done: "Done",
        failed: "Failed",
        skipped: "Skipped (already done)",
      },
      fail: {
        "probe-ssh": "Passwordless SSH failed. Run ssh-copy-id first (or add your key to ssh-agent), then retry",
        "probe-node": "Remote Node check failed. Fix the path or install Node (≥18), then retry",
        upload: "Helper upload/install failed. Retry, or explicitly skip to direct mode (logged)",
        verify:
          "Remote helper digest mismatch — refusing to mark ready. Reinstall, or explicitly switch to direct mode below (logged)",
      },
      retry: "Retry this step",
      abort: "Abort (stays put, resumable)",
      skipInstallEntry: "Skip install, go direct…",
      mismatchEntry: "Switch to direct mode",
      logTitle: "Wizard output",
      logEmpty: "(waiting for output…)",
      closeHint: "Esc/✕ close = keep running in background (card badge reflects)",
    },
    degrade: {
      title: "Switch to direct mode",
      body: "Direct mode skips helper digest checks for this deployment — weaker guarantees. This choice is logged to diagnostics.",
      confirm: "Confirm",
    },
  },
} as const;
