# Orca Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Orca
orchestration reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Orca orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the orca-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real Orca runtime
state; never substitute a non-Orca subagent tool.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`ORCA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`ORCA skills get orchestration --full` and read the named bundled reference before acting.

<!-- shared: no-guessing -->

## Required coordinator cleanup before the final answer

For supervised orchestration, closing task-owned worker windows is part of finishing
this user's work. Do it without asking for another confirmation.

- Record this run's ID and every created worker's Dispatch ID and terminal handle.
- Collect and validate every worker result, including nested workers, and finish any
  immediate follow-up work before cleanup. Idle alone is not completion.
- Before your final answer, release each settled worker with
  `ORCA orchestration worker-release --dispatch <dispatch_id> --json`.
  Do not retain a worker merely to keep its output visible; the final report carries
  the result. Retain only on an explicit user request or actual user takeover.
- Inspect every receipt. `retained`, `release_pending`, and `release_unknown` do not
  mean the window was closed. Follow the version-matched recovery guide; do not
  bypass its ownership checks with `terminal close`.
- Enumerate `ORCA orchestration worker-list --run <run_id> --json`, including all
  pages, and verify your recorded worker handles against `ORCA terminal list --json`.
  Do not rely only on the reclaimable count or on a hidden status-panel row.
- End only after all task-owned settled worker windows are gone, or explicitly
  report the exact cleanup blocker and remaining workers. Preserve the hub window,
  unrelated terminals, active workers, and windows taken over by the user.

This policy applies to coordinators, including nested coordinators. A dispatched
worker must report `worker_done` and let its coordinator release it; it must not
close its own terminal before its report is delivered. Use the executable resolved
for this session for every command (`ORCA` is only a placeholder).
