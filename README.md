# Forge

Forge is Davids’s personal agent workspace. This repository is a greenfield build in LUMINA. The older `FORGE-REAL` project is a separate local-only UI demo; it is not a production backend.

## Current slice

This is a local, single-device clickable prototype. Its working screens and flows are:

- Home dashboard with sample quick starts that prefill a local task plan, plus recent local tasks and activity.
- New Task flow: enter a request, review a plan, edit exact task titles, approve or decline each local task-creation action, then run an approved step. The active task title, status, and history/new-task actions stay in the header.
- Task history with Plans, Tasks, and Activity tabs; saved plans and tasks can be searched and managed.
- Memory where the owner can add, edit, and forget owner-authored notes.
- Settings with privacy information, JSON export, and local data clearing.
- Desktop sidebar collapse/expand, narrow-screen navigation drawer, task-details drawer, Escape-to-close behavior, and a Ctrl/⌘+K new-task shortcut.

The prototype also has clickable Inbox, Projects, Automations, Connected Apps, and Files screens. They clearly say what is not active and do not simulate access to external services. Attachment and voice buttons are visible but disabled. Quick-start prompts only prefill local plans; they do not run automatically. Responses arrive as a single completed draft; streaming is not implemented. The loading indicator is only a wait state, not live progress from a running agent. Mobile drawers move focus inside, keep Tab navigation contained, hide inactive background controls, and return focus to their trigger when closed.

Plan edits invalidate earlier approvals. The server checks the current action hash and approval expiry immediately before execution. Approval expires after 10 minutes. A plan is completed when every step is either run or declined; each step still shows its own outcome. Local task creation is idempotent, so retrying after a lost response does not create a duplicate. Activity details are looked up from saved plans and scrubbed from view after deletion, while generic approval/outcome entries remain. Database row deletion is not guaranteed secure erasure.

The API rejects mutation requests unless the Host and Origin are allowlisted, Fetch Metadata is same-origin, and the JSON request includes the non-simple `X-Forge-Request: 1` header. The browser test suite includes a hostile-origin HTML-form regression. This is defense in depth for the local prototype, not a substitute for authentication or deployment hardening.

Without a model configured, plan suggestions use a simple local parser. If all three `FORGE_LLM_*` values are set in `.env`, the original request text is sent over HTTPS to that OpenAI-compatible provider to draft task titles. HTTP is rejected unless a developer explicitly enables the loopback-only development exception. The model can only suggest local checklist items; it cannot invoke tools or perform external actions.

## Not connected yet

Email, calendars, messaging, web search, monitoring, schedules, event triggers, file import/transformation, voice and image input are not connected. Their API states stay inactive and unsupported workflow calls return an unavailable response. Memory notes are editable and stored locally, but are not yet used to personalize plans. Do not store passwords, payment data, or sensitive secrets here.

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

The Playwright configuration starts a separate local app and isolated test database for browser tests. Browser coverage includes the approved-task flow, export and deletion history, hostile-origin form rejection, dashboard accessibility, responsive layout, workspace navigation, desktop sidebar collapse, and mobile drawers.
