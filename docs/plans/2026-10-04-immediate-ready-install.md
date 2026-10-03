# Immediate ready installation implementation plan

> **For Codex:** Apply executing-plans and verification-before-completion.
> **Goal:** Start the existing verified installer when Orca exits, without a 60-second installation timer.
> **Architecture:** Keep the fixed app path, signature/inventory gates, pause controls, locks, rollback, notifications, and GitHub-check schedule. A separate pending-only watcher waits for native process-exit events (kqueue on macOS, pidfd on Linux, process handles on Windows), releases no GUI or terminal daemon, and acquires the existing installer lock only after the GUI exits. Reopening during staging still aborts the swap and waits for the next exit.
> **Tech stack:** Python 3.13 standard library and the distribution's existing psutil dependency.

1. Add failing tests for native exit wake-up, cancellation, already-exited processes, daemon filtering, no installation while running, and the personal LaunchAgent without StartInterval.
2. Implement a shared process-exit module, private pending watcher, and public pending watcher; activate immediately after preparation and on updater recovery. Preserve hourly personal/GitHub checks.
3. Run both Python suites and real subprocess exit tests. Verify private/public module parity and signatures; sync runtime code under its updater lock and replace only the install-ready LaunchAgent.
4. Publish the distribution change after verification; confirm all OS CI builds and the public release. Do not quit or replace the user's running Orca.
