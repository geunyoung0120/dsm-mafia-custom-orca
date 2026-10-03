# Verified upstream publication automation

Goal: after the maintainer's Python updater installs a verified official-derived custom app, publish its source delta to this repository and track the native release.

Architecture: the personal updater writes a durable, deduplicated queue entry after installation. A separate scheduled publisher operates in an isolated clone; it applies the delta between the previous and new verified source trees with Git's three-way merge. It preserves distribution and workflow files from the public branch, verifies locally, then performs a normal fast-forward push. Existing CI builds all four platforms and publishes only after all pass. Journal state separates source push from release publication. The publisher never changes an installed app or the maintainer's editing checkout.

Alternatives: copying the personal checkout wholesale would erase distribution-specific changes; rebuilding the entire distribution overlay each time is less direct than merging the verified source delta. Use the delta approach. Expect one maintainer, infrequent upstream releases, minute-level queue checks, and existing GitHub build costs.

Implementation:
1. Add real-Git regression tests for a verified-tree delta preserving distribution changes, conflict handling, and reserved release/workflow paths.
2. Implement snapshot construction from upstream commit plus hash-checked feature patch; exclude working-copy/untracked files.
3. Add bounded agent repair with protected tests/configuration, local app/updater validation, and no push from the repair process.
4. Implement durable publish/release states, retry after interrupted push, strict repository identity, and no force push.
5. Add an idempotent installation-success queue hook to the personal updater; install a separate launchd publisher schedule.
6. Validate with isolated real Git fixtures, current-source no-change integration, publisher installation/status checks, and GitHub CI.

Failure behavior: local installation remains independent. Unresolved source conflicts or failed checks block publication; network failures retry with backoff. An agent can repair production source only; it cannot change tests, distribution scripts, workflows or credentials. Failed CI does not advance the verified-source baseline. No human confirmation is added to the already-authorized successful path.
