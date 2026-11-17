# LUMINA product audit

## Bottom line

LUMINA is currently a **well-structured local planning and approval prototype**, not yet a general-purpose personal AI agent. Its strongest implemented capability is a safe, dependency-aware workflow for turning a request into local tasks, showing the plan, requiring approval, executing one local action at a time, and recording an audit trail. The most important gap is that the product UI advertises a much broader agent platform than the server currently implements.

Compared with current agent products, LUMINA is ahead on explicit local safety contracts and explainable plan state, but far behind on connected tools, real file/document work, web research, background automation, persistent contextual memory, and computer/browser operation.

## What is genuinely implemented today

### Planning and execution

The planner accepts a request, splits it into up to eight clauses, classifies each clause, and creates a plan with step IDs, expected results, checkpoints, risk levels, tools, and dependencies. The current dependency model is a **linear chain**: each step depends on the immediately previous step. That is useful for sequencing, but it is not yet a general dependency graph that can run independent branches in parallel.

The local parser can identify intents such as email, calendar, files, publishing, records, research, and document transformation. However, this classification only changes the plan metadata. The server deliberately executes only `create_task`; every other action kind is rejected as “not connected in this prototype.” This is a good safety boundary, but it means the apparent breadth of the planner is not capability breadth yet.

The implemented execution contract is solid for the local prototype. It enforces trusted origin and host checks, JSON mutation requests, CSRF-style headers, exact action hashes, approval expiry, dependency order, idempotent task creation, and safe replay behavior. It records active, completed, and failed step states, including output and error text.

### Permissions and safety

The domain model defines `suggest`, `approve`, and `automatic` permission modes, and steps carry risk and approval metadata. The live API exposes only one capability: review every local task action. There is no working automatic mode, connector-specific scope, per-tool permission, spending limit, domain allowlist, or approval policy engine.

The safety posture is stronger than the feature breadth. LUMINA does not pretend to have sent email, changed a calendar, edited a file, or performed web research. That honesty is valuable and should remain central as more tools are added.

### Memory

Owner-added memories can be created, edited, searched in the UI, and deleted. The type model already anticipates useful categories such as preference, contact, routine, goal, document, decision, and context. But memory is not yet used by planning or response generation. The UI explicitly says that saved memories are not used to personalize the prototype, so this is currently a notes feature rather than agent memory.

### Files, research, automations, and connectors

The frontend has navigation for Files, Connected Apps, Automations, and related workspace areas. The server exposes placeholder routes, but the actual behavior is intentionally inactive:

- `/api/connectors` returns a small list of `coming_soon` connectors.
- `/api/automations` returns an empty list and toggling returns `501`.
- `/api/documents` returns an empty list.
- `/api/research` returns `501`.
- File access and voice input are disabled in the composer.

These are good product placeholders, but they should be visually labeled as roadmap features or progressively hidden until a real implementation exists. Otherwise users may interpret the navigation as a promise.

### Audit and data model

The plan and activity model is thoughtfully designed for a local prototype. Plans, approvals, tasks, memories, and audit events are persisted in SQLite. Destructive plan deletion removes request and task details while retaining generic activity entries. The export endpoint includes plans, tasks, memories, and activity.

The audit schema is still narrower than the type model. The TypeScript type anticipates `context`, `tool`, `filesAccessed`, and `requiresAttention`, but the SQLite table only stores event type, entity, timestamp, and privacy-safe summary. That means the current audit trail can say that something happened, but cannot yet reliably answer which tool, file, connector scope, or external record was involved.

## Comparison with current agent products

### Manus

Manus currently presents the most relevant benchmark for LUMINA’s intended direction. Its connector catalog documents 416 connectors, including built-in apps, MCP connectors, and API-key connections. Connectors can read data and take actions, can be recommended in a task, and require user approval before enabling. Manus also supports combining multiple connectors in one task and recommends scoping connections to the current need. [1]

Manus automation is a mature workflow layer rather than a placeholder. It supports schedules, event triggers, webhooks, test runs, approval-required confirmations, pausing, editing, failed-run inspection, and rerunning with context. It also exposes run history in Updates. [2]

Relative to Manus, LUMINA’s strongest differentiator is its explicit local execution contract and privacy-safe audit behavior. Its largest deficits are real connectors, browser/computer operation, project-level context, automation execution, run history, and recovery from real tool failures.

### ChatGPT Work and Projects

The current OpenAI documentation says the older ChatGPT agent mode is no longer available and points users to ChatGPT Work for longer multi-step tasks and finished deliverables. Work is positioned around research, analysis, documents, spreadsheets, presentations, reports, sites, voice, connected apps, and cloud or local execution depending on the surface and permissions. [3]

ChatGPT Projects keep related chats, files, instructions, and context together. Users can add PDFs, spreadsheets, documents, images, links from connected apps, and saved responses; project context can be reused for recurring work. [4]

Relative to ChatGPT Work and Projects, LUMINA has a clearer visible approval lifecycle for its local action, but it lacks the actual work surfaces users expect from a modern agent: file ingestion, generated documents, spreadsheet transformation, voice, web search, connected apps, project context, cross-device continuity, and finished deliverables.

### Claude computer-use ecosystem

Anthropic’s computer-use tool demonstrates a different agent model. Claude can receive screenshots and issue computer actions such as clicks, typing, scrolling, and zooming; the host application runs those actions and returns results in an agent loop. Anthropic emphasizes isolation, domain restrictions, human confirmation for consequential actions, and defenses against prompt injection. [5]

LUMINA currently has no browser, desktop, screenshot, or computer-use loop. Its permission and audit concepts are a useful foundation for adding one later, but adding computer use would require a separate execution sandbox, tool-call protocol, visible action log, takeover flow for credentials, domain controls, and stronger prompt-injection handling.

## Product strengths to preserve

1. **Honest capability boundaries.** Unsupported actions are rejected instead of being simulated as successful.
2. **Exact approval semantics.** The approval binds to an action hash, expires, and is invalidated by edits.
3. **Dependency enforcement at the API boundary.** Later steps cannot bypass the UI and run early.
4. **Idempotent local execution.** Retries do not create duplicate local tasks.
5. **Privacy-aware deletion.** User content can be removed while generic activity remains.
6. **Accessible, responsive shell.** The current browser suite covers desktop navigation, mobile drawers, keyboard behavior, CSRF, and serious accessibility violations.

## Highest-value gaps, in order

### 1. Make one real tool end-to-end

Do not implement all connectors at once. Add one narrow, useful integration such as Google Drive read-only search or Gmail draft creation. It should include OAuth or connector setup, scopes, tool invocation, preview, approval, execution, result capture, failure recovery, and audit details. A real vertical slice will create more product value than additional placeholder screens.

### 2. Add a real artifact/result model

A plan currently ends in a local task. A real agent needs outputs such as a document, report, source list, draft email, spreadsheet, or file. Add an `Artifact` entity with type, title, storage reference, source references, preview, version, and user actions such as open, download, save, revise, or share.

### 3. Turn memory into controlled retrieval

Keep owner-added memory, but add categories, importance, provenance, last-used timestamps, and per-project scope. The planner should retrieve only relevant memory, show which memories influenced a plan, and allow “do not use memory for this task.” Never silently mix personal and business context.

### 4. Implement automation only after tool execution exists

Once one connector works, add scheduled and event-triggered runs with test-run preview, approval policy, pause/resume, run history, retry, failure explanation, and notification. This is the area where Manus currently has the clearest product lead. [2]

### 5. Replace the linear planner with a real DAG

Keep the current step contract, but allow multiple dependencies, independent branches, join checkpoints, and explicit postconditions. The executor should run ready low-risk branches in parallel while preserving approval gates for consequential actions.

### 6. Add research with citations and provenance

A research feature should retrieve sources, show citations beside claims, distinguish facts from assumptions, record access time, expose confidence, and let the user inspect source excerpts. The current `ResearchSource` type is a reasonable starting point, but `/api/research` must become a real pipeline rather than a `501` response.

## Recommended product positioning now

The accurate positioning is: **“A private, safety-first personal task planner with an approval-controlled local execution core.”** It is not yet accurate to position LUMINA as a full Manus or ChatGPT Work competitor.

The best next milestone is not another visual refresh. It is one complete connected workflow—preferably “find a file, analyze it, produce an artifact, and ask before sharing”—implemented with the same excellent approval and audit discipline already present in the local task flow.

## References

[1]: https://manus.im/docs/integrations/connectors "Manus Connectors documentation"
[2]: https://manus.im/features/automations "Manus AI workflow automation"
[3]: https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex "ChatGPT Work and Codex"
[4]: https://help.openai.com/en/articles/10169521-projects-in-chatgpt "Projects in ChatGPT"
[5]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool "Claude computer use tool"
