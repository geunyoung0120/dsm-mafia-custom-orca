# Community skill service

This independent service supports public, on-demand Markdown skills for Orca Custom.
It uses Vercel Hobby and Neon PostgreSQL. Desktop apps know only the HTTPS API origin;
database credentials and the rate-limit secret exist solely in server environment settings.

## Run and deploy

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev
node scripts/migrate.mjs /absolute/path/to/private/service.env
vercel link --project dsm-mafia-skills
vercel env add DATABASE_URL production --sensitive
vercel env add RATE_LIMIT_SECRET production --sensitive
vercel deploy --prod
```

The Git-connected Vercel project must use `community-service` as its Root Directory and
Node.js 24. GitHub Actions separately checks this service before native app release builds.
Stay on Hobby; do not enroll payment details or upgrade when quotas are exhausted.
Free limits may change; the service rejects publishing near its conservative 400 MiB DB guard.

Explicit database regression (creates only hidden test fixtures):

```sh
npm run test:database -- /absolute/path/to/private/service.env
```

## API

- `GET /health`: service identity.
- `GET /skills?query=...&offset=0`: at most 20 metadata results, with `hasMore`; no Markdown bodies.
- `GET /skills/:uuid/versions/:integer`: exact immutable version; hidden skills return 404.
- `POST /auth/register`, `/auth/login`: catalog username/password; returns an opaque seven-day session.
- `POST /auth/logout`: revoke the presented bearer session.
- `POST /skills`: publish or add a version; owner is derived from the session, never request fields.
- `POST /skills/:uuid/hide`: owner-only soft hiding; does not erase published history.
- `POST /skills/:uuid/report`: signed-in reports, one current report per reporter/skill.

The first release supports standalone Markdown instructions only. Declared companion-file
dependencies are rejected. Publishing does not execute scripts, commands, or skill instructions.
Catalog handles are self-registered identities, not verified GitHub identities. Password recovery
is not available in this initial release; retain your catalog password securely.

Passwords use salted scrypt; only session hashes are stored in PostgreSQL. Desktop sessions remain
in main-process memory and expire on app restart. No SQL, secrets, private prompts, skill bodies,
or provider credentials are logged. Requests, UTF-8 bodies, results, version counts and publisher
storage are bounded; SQL is parameterized. Atomic database functions lock global and author budgets: 100 skills, 250 total versions, 10 MiB per author; 20,000 global versions and a conservative 400 MiB guard. Reports also reserve storage atomically (100 per author, 10,000 globally). Sessions retain the newest 20 logins so app restarts cannot permanently exhaust login slots. Public users cannot access tables directly.

## Moderation and retention

The operator reviews `community.reports` in the private Neon SQL editor. To hide an abusive skill,
update only its `community.skills.visible` field to false using its exact UUID. Do not mutate or
delete `community.versions`: an immutable-version trigger prevents ordinary UPDATE/DELETE.
Reports do not automatically hide content, so reports cannot be used to censor other authors.

Hidden versions cannot be loaded for new invocations. Content already delivered to a running
task remains its pinned snapshot. Existing agent chat journals may store that content even though
no local skill files are installed. Changing or hiding a cloud skill does not erase those journals.
