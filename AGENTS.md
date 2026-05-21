# AGENTS.md

## Project Overview

HJDesign is an AI-powered web design workbench. Users create projects with conversations, send design prompts to an AI agent, and preview generated HTML pages in an iframe. The UI is in Chinese (zh-CN).

## Commands

- `pnpm dev` — dev server on port 3710
- `pnpm build` — production build
- `pnpm lint` — ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest run
- `pnpm test:watch` — Vitest watch

Run a single test: `pnpm vitest run src/lib/workspace-store.test.ts`

## Architecture

### Data Layer — `~/.hjdesign/`

File-based persistence. Each project gets `projects/<id>/` with `project.json`, a `workspace/` directory for generated HTML/CSS files, and a `conversations/` directory. Settings live in `settings.json`.

- **`WorkspaceStore`** (`src/lib/workspace-store.ts`) — low-level CRUD for projects, conversations, and workspace file I/O (read, write, edit, patch, delete, glob, grep). All paths are relative and symlink-safe.
- **`ProjectService`** (`src/lib/project-service.ts`) — project creation/rename/deletion, spawns a default conversation on create.
- **`ConversationService`** (`src/lib/conversation-service.ts`) — conversation lifecycle, auto-titling from first user message, delegates to `DesignPageAgent`.
- **`SettingsService`** (`src/lib/settings-service.ts`) — model configurations (DeepSeek or OpenAI-compatible), font/icon resource libraries, cached reads with mtime invalidation.

### AI Agent — Design Page Agent

- **`src/lib/design-page-agent.ts`** — builds a `ToolLoopAgent` (AI SDK v6) with assembled prompt sections and registered workspace tools.
- **`src/lib/agents/design-page.agent.md`** — the agent system prompt (role, design loop, visual quality bar, do-not rules).
- Agent prompt is assembled from sections: `design_agent_core`, `page_target_protocol`, `tool_workflow`, `frontend_capabilities`, `resource_policy`, `runtime_context`.
- Model selection: DeepSeek (with thinking modes disabled/high/max) or OpenAI-compatible, resolved from settings.

### Workspace Tools — `src/lib/agent-tools/`

Tool registry pattern. Each tool has a `name`, `description`, `inputSchema` (JSON Schema), `execute`, and `parallelSafe` flag. Tools are:

| Tool | Purpose |
|---|---|
| `createHtml` | Scaffold new `.html` files from template with font/icon CDN |
| `read` | Read workspace files or list directories |
| `write` | Write/overwrite workspace files (CDN-guarded for HTML) |
| `edit` | Find-and-replace in workspace files (CDN-guarded for HTML) |
| `patch` | Coordinated multi-change patches (CDN-guarded for HTML) |
| `delete` | Remove workspace files |
| `glob` | Pattern-match workspace files |
| `grep` | Regex search workspace files |
| `callFrontendCapability` | Trigger `preview.refresh` or `preview.switchHtml` |

**CDN guard** (`src/lib/agent-tools/cdn-guard.ts`) — HTML files can only use CDN URLs explicitly configured in settings. All write/edit/patch operations on `.html` files are validated against the approved list.

### Preview — Fastify Ephemeral Servers

**`PreviewServerManager`** (`src/lib/preview-server-manager.ts`) — spawns a Fastify server per project on an ephemeral port. Lease-based lifecycle with heartbeat renewal; idle preview servers shut down after TTL.

### Real-Time — Frontend Capabilities via SSE

**`FrontendCommandBus`** (`src/lib/frontend-command-bus.ts`) — singleton SSE bus. The browser registers a connection per tab; the server pushes `preview.refresh` / `preview.switchHtml` commands as SSE events. Keepalive every 15s.

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | AI agent streaming response (`createAgentUIStreamResponse`) |
| `/api/settings` | GET/PUT | Read/update app settings |
| `/api/projects/[projectId]/download` | GET | Download project workspace as ZIP |
| `/api/projects/[projectId]/preview-session` | GET/DELETE | Start/stop preview server session |
| `/api/projects/[projectId]/preview-session/heartbeat` | POST | Renew preview lease |
| `/api/projects/[projectId]/frontend-capabilities/stream` | GET | SSE stream for frontend commands |

### Frontend

- `src/app/page.tsx` — server component, loads project/conversation state via search params. All mutations are server actions that call `revalidatePath("/")`.
- `ChatShell` — main layout with sidebar (control bar), conversation panel, and preview iframe.
- `StreamingConversationPanel` — uses AI SDK's `useChat` for real-time streaming.
- `ProjectPreviewFrame` — iframe loading the Fastify preview server URL, receives frontend commands via `FrontendCapabilityBridge`.
- `src/components/ai-elements/` — **ESLint-ignored** (third-party generated UI components from AI SDK).

### Path Alias

`@/*` maps to `./src/*` (TypeScript and Vitest both configured).

## Testing

- Vitest + jsdom environment + `@testing-library/react`
- Setup file (`vitest.setup.ts`) mocks `next/navigation` and `ResizeObserver`
- Test files colocated with source: `*.test.ts` / `*.test.tsx`

## Key Constraints

- Only `html` output type currently supported (`ProjectOutputType = "html"`)
- Agent max 50 steps (`stepCountIs(50)`)
- Workspace file size limit: 1MB; read limit: 2000 lines or 50KB per read
- Windows recycle bin support via PowerShell for project/conversation deletion
- Global singletons (PreviewServerManager, FrontendCommandBus) cached on `globalThis` to survive HMR