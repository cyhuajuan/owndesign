# AGENTS.md

This file provides guidance to Any Agent when working with code in this repository.

## What this is

OwnDesign is a local-first AI agent for UI/page design. The user describes a page in chat; an LLM agent generates and edits a single `index.html` per project, with live preview. The model provider is bring-your-own (DeepSeek, Anthropic, or any OpenAI-compatible endpoint) — nothing is bound to a hosted service. The whole thing ships as an `npx owndesign` CLI that boots a local server + web UI.

User-facing data (projects, conversations, settings, checkpoints) lives under `~/.owndesign/` (see `WorkspaceStore`, `store.ts:172`), **not** in the repo.

## Monorepo layout

pnpm workspace (`pnpm@11.3.0`, Node `>=22`). Packages depend on each other via `workspace:*` and import each other's **source `.ts` directly** (e.g. `@owndesign/core/agent/design-page-agent`), not built output — exports map to `./src/*`.

- `packages/core` (`@owndesign/core`) — all domain logic: the design-page agent, agent tools, workspace store, conversation/project/settings services, preview server manager, prompts. **Most real work happens here.**
- `packages/server` (`@owndesign/server`) — Hono HTTP app (`app.ts`) exposing `/api/*`, plus the standalone Node entry (`index.ts`). Thin: wires core services to routes.
- `packages/renderer` (`@owndesign/renderer`) — React 19 UI library (the actual app screens, feature folders under `src/features/*`, shadcn-style primitives under `src/components/ui`). Consumed by both web and desktop.
- `apps/web` (`@owndesign/web`) — Vite shell that mounts `@owndesign/renderer` for the browser. Dev server on `127.0.0.1:3710`.
- `apps/desktop` (`@owndesign/desktop`) — Tauri 2 wrapper that bundles the built server and renderer.
- `packages/cli` (`owndesign`) — the published npm package. esbuild-bundles the server into `dist/`, copies `apps/web/dist` → `dist/web` and `packages/server/dist` → `dist/server`, then spawns the server with `OWNDESIGN_WEB_ROOT` pointed at the bundled static files.
- `packages/config` — shared `tsconfig.base.json` (each package extends it). No runtime code.

## Commands

All run from the repo root. The repo uses **oxlint** + **oxfmt** (not eslint/prettier) and **vitest**.

```bash
pnpm install
pnpm dev              # server (port 3711) + web (port 3710) concurrently — main dev loop
pnpm desktop:dev      # Tauri desktop app
pnpm build            # build all packages, desktop, and the CLI
pnpm lint             # oxlint .
pnpm format           # oxfmt . --write   (format:check to verify only)
pnpm typecheck        # tsc -p across every package
pnpm test             # vitest run across every package
pnpm test:watch
```

Run one package's checks/tests with a filter, e.g.:

```bash
pnpm --filter @owndesign/core test
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts   # single file
pnpm --filter @owndesign/core typecheck
```

Tests are colocated as `*.test.ts(x)` next to source. Server/web/desktop/cli use `--passWithNoTests`; core and renderer hold the real suites.

### Versioning / release

Versions are tracked in `versions.json` across four tracks (`platform`, `web`, `cli`, `desktop`) and fanned out to every package.json + Tauri config/Cargo.toml by the release command:

```bash
pnpm version:release <platform|web|cli|desktop> <patch|minor|major>
```

Do not hand-edit package versions. The release command bumps versions, syncs target files, creates a release commit, tags every updated track, and pushes the branch + tags. `platform` releases also bump `web`, `cli`, and `desktop`; `web` releases also bump `cli`. Linked tracks use the same bump kind as the requested track.

## The design-page agent (core concept)

`packages/core/src/agent/design-page-agent.ts` is the heart of the product. It builds a Vercel AI SDK `ToolLoopAgent` (max 50 steps) whose system prompt is assembled from sections (`buildDesignPageConversationInstructions`): a markdown core prompt loaded from `src/prompts/agents/design-page.md`, a "single HTML target protocol", a tool-workflow guide, frontend-capability info, and a resource policy derived from user settings.

Key invariants baked into the prompt and worth preserving when editing:
- Each project has exactly **one previewable file: `index.html`**. The agent must not create other HTML pages; multi-page requests become internal views inside `index.html`.
- Provider selection happens in `buildLanguageModel` (deepseek / anthropic / openai-compatible). Thinking/effort options are mapped per-provider in `buildProviderOptions`.
- The agent edits files only through the **workspace tools** in `src/agent/tools/` (`read`, `glob`, `grep`, `edit`, `write`, `createHtml`, `copyFile`, `delete`, `preview-refresh`), registered via `createProjectWorkspaceTools` (which wraps `createWorkspaceToolRegistry`). These are sandboxed to the project workspace (`tool-paths.ts`). External font/icon/script CDNs are not hard-blocked by a guard module; instead the resource policy injected into the system prompt (derived from user settings in `settings-service.ts`) tells the agent which CDNs are approved.
- The assembled system prompt is **frozen onto the conversation** on first message (`conversation.agentInstructions` + `agentPromptVersion`, set in `server/src/app.ts`). Changing prompt code does not retroactively affect existing conversations. Bump `DESIGN_PAGE_AGENT_PROMPT_VERSION` when the prompt structure changes meaningfully.

## Request / streaming flow

1. UI (`renderer`) calls `POST /api/chat` (`server/src/app.ts`) with project/conversation IDs and the user message.
2. The server creates a **checkpoint** (snapshot for restore), loads stored messages, builds the agent context, and starts a run via `ChatRunManager` (`server/src/chat-run-manager.ts`).
3. `ChatRunManager` enforces **one active run per project** (returns 409 otherwise), streams the AI SDK UI-message stream, and lets clients reconnect mid-run via `/runs/active/stream` (resumable by chunk index) and `/runs/active/snapshot`.
4. Finished messages are persisted through `ConversationService` into the workspace store.
5. Live preview is served by `PreviewServerManager` (`core/src/preview/preview-server-manager.ts`), which spins up a per-project Hono static server on an ephemeral port; clients keep it alive with heartbeat/session endpoints, and the agent can push refreshes through the frontend command bus (SSE at `/frontend-capabilities/stream`).

## Conventions

- ESM everywhere (`"type": "module"`), TypeScript strict, `moduleResolution: Bundler`. Import sibling source via the package's path alias (`@owndesign/core/...`, `@/...`).
- User-visible/error strings are bilingual (zh-CN / en-US); some server error text is Chinese. UI text goes through the i18n layer in `renderer/src/features/i18n`.
- Prompt edits live in markdown under `core/src/prompts/agents/`; the loader (`prompts/index.ts`) reads them at runtime, so they must be copied into build output (handled by the server/cli build scripts).
- `packages/renderer/src/components/ai-elements/**` is generated/vendored and excluded from lint — don't hand-tune it for lint rules.

## Git commits

- Use Conventional Commits. Keep messages concise. For non-trivial changes, include a body describing what changed and why.
