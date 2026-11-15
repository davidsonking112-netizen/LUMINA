# Forge

Forge is Davids’s personal agent workspace. This repository is a greenfield build in LUMINA. The older `FORGE-REAL` project is a separate local-only UI demo; it is not a production backend.

## Current slice

This is a local, single-device prototype. It demonstrates one end-to-end flow:

1. Enter a request and review the task plan.
2. Edit the exact task titles and save them.
3. Approve one local task-creation action. Approval expires after 10 minutes.
4. Run the approved action and see its result in Tasks and Activity.
5. Add, edit, and forget owner-authored Memory notes.

Plan edits invalidate earlier approvals. The server checks the current action hash and approval expiry immediately before execution. A plan is completed when every step is either run or declined; each step still shows its own outcome. Local task creation is idempotent, so retrying after a lost response does not create a duplicate. Activity details are looked up from saved plans and scrubbed from view after deletion, while generic approval/outcome entries remain. Database row deletion is not guaranteed secure erasure.

The API rejects mutation requests unless the Host and Origin are allowlisted, Fetch Metadata is same-origin, and the JSON request includes the non-simple `X-Forge-Request: 1` header. The browser test suite includes a hostile-origin HTML-form regression. This is defense in depth for the local prototype, not a substitute for authentication or deployment hardening.

Without a model configured, plan suggestions use a simple local parser. If all three `FORGE_LLM_*` values are set in `.env`, the original request text is sent over HTTPS to that OpenAI-compatible provider to draft task titles. HTTP is rejected unless a developer explicitly enables the loopback-only development exception. The model can only suggest local checklist items; it cannot invoke tools or perform external actions.

## Not connected yet

Email, calendars, messaging, web search, monitoring, schedules, event triggers, file import/transformation, voice and image input are not connected. Memory notes are editable and stored locally, but are not yet used to personalize plans. Do not store passwords, payment data, or sensitive secrets here.

The API and Vite development server bind to `127.0.0.1`. This build has no sign-in, cloud sync, encryption-at-rest, or production deployment configuration. Do not expose it to the public internet. A hosted release needs authentication, encrypted storage, backups/retention controls, deployment hardening, and the owner’s choice of first service provider before those features are added.

## Run locally

Requirements: Node.js 20+ and npm 10+.

```sh
npm install
cp .env.example .env
npm run dev
```

Open the local address printed by Vite. The local SQLite database is created at `data/forge.sqlite` and is excluded from Git. The `.env` file is also excluded.

Optional model settings in `.env`:

```env
FORGE_LLM_BASE_URL=https://your-openai-compatible-host/v1
FORGE_LLM_API_KEY=your-secret
FORGE_LLM_MODEL=your-model-id
```

Configure all three or leave all blank. When configured, request text is sent to that provider. HTTPS is required; never commit the `.env` file.

## Checks

```sh
npm test
npm run build
npm run lint
npm run test:e2e
```

The Playwright configuration starts a separate local app and isolated test database for browser tests.
