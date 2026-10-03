# Cloud community skills implementation plan
> **For Codex:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Publish Markdown instructions to a shared cloud catalog and invoke immutable versions from Orca native chat with `&`, without installing skill files.
**Architecture:** A dedicated Vercel Hobby API reads and writes Neon PostgreSQL. Desktop main-process IPC owns HTTPS requests and session credentials; the composer searches metadata, pins IDs/versions, and resolves selected bodies before sending through existing structured/PTY transports.
**Tech Stack:** Existing Electron/React/Zod, Node.js serverless functions, official Neon HTTP driver, PostgreSQL.

## Accepted design

- Public metadata search is bounded and debounced. Only explicitly invoked versions load Markdown bodies. Names are author-qualified; identity is a UUID and immutable integer version with SHA-256 digest.
- Published instructions are untrusted user-selected content, retain existing tool permissions, and are never executed during retrieval. The first release supports Markdown instructions only; supporting scripts/files are unsupported and declared dependencies are rejected.
- Publishers use catalog-specific username/password accounts. Passwords are salted with scrypt; opaque expiring sessions are hashed in the DB. Tokens stay in main-process memory, avoiding new persistent credential storage and Linux keyring dependencies. Public reading needs no account.
- A task pins the same version for coordinator/worker context. Selected content is transient in app memory; existing conversation journals may retain model input. There is no installed skill directory or offline fallback.
- Failure to resolve an explicit skill blocks submission, preserves the draft, and presents retry/error state. Limits cover body bytes, metadata, per-user publishing, login attempts, IP traffic, and search results. No private prompts or credentials are logged.
- Paid services, upgrades, and payment enrollment are out of scope. Confirm Vercel account plan before production deployment. A DATABASE_URL alone cannot verify the Neon account plan; user created its free project.

## Task 1: service contract and persistence

Create `src/shared/community-skills.ts` and `community-service/schema.sql`. Define users, sessions, skills, immutable versions, reports, and bounded rate-limit counters. Add database constraints, immutable-version trigger, ownership protection, atomic version allocation, and separate service namespace. Test metadata/body validation, digest mismatch, malformed references, and immutable version updates. Verify Neon connectivity without printing settings.

## Task 2: API and cloud deployment

Create `community-service/package.json`, lockfile, `api/index.mjs`, and narrowly named server modules plus Node tests. Routes cover register/login/logout, paginated metadata search, version read, publish/update, hide and report. Parameterize queries; rate-limit authentication and reads; sanitize errors. Run `npm test` and `npm audit --omit=dev`; apply schema; deploy to a Hobby project with DATABASE_URL as a server-only sensitive environment variable. Verify registration, authorization, publish/search/read/version stability/logout against the real API using task-owned fixture data, then hide fixtures.

## Task 3: desktop bridge

Create main-process community client/IPC and preload bridge. Extend `SkillsApi` with optional `community` for older/web clients. Validate request and response schemas; fixed HTTPS origin, timeout, response-size cap, digest verification, no redirects carrying credentials. Register via `registerSkillsHandlers`; test sender authorization, untrusted inputs, transient sessions, timeout, digest mismatch, and unavailable API behavior.

## Task 4: native chat invocation

Extend the existing composer picker to recognize standalone `&` tokens and render an above-input list matching the slash picker. Add a metadata-only discovery hook and versioned references. Preserve arrow/Enter/Tab/Escape and IME behavior. Resolve bodies at send time, show failures without clearing drafts, prevent duplicate concurrent sends, and support structured and PTY transports including SSH/WSL targets. Ensure pinned references can be included in delegated instructions without relying on local paths. Test invocation, deleted/hidden versions, stale search, supported-provider gating, preserved drafts, and context isolation.

## Task 5: sharing UI

Add a public catalog/publish dialog accessible from Skills. Provide searchable listings, safe Markdown preview, author/version/provider metadata, login/register/logout, Markdown file import, new immutable version, author-owned hide, and reports. Reuse design tokens and existing primitives. Test public browse, authentication, ownership visibility, malformed Markdown and bounded upload handling.

## Task 6: verification and release

Run focused tests, all affected typechecks, changed-code quality gate, backend live smoke, hidden Electron rendered UI checks, and credential scan. Update release workflow to cover service and new desktop tests. Publish only after production API and app checks pass; verify four native release assets and release manifest. Apply changes to personal customization source and its existing update pipeline, keeping the maintainer publisher baseline consistent. Record evidence and remaining limitations in the deployment guide. Close only this task's test processes/agents.
