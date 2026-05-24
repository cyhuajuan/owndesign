## Project Overview

OwnDesign is an AI-powered design prototyping tool. Users describe what they want, and an AI agent creates and iterates on HTML pages displayed in a live preview. The UI is primarily in Chinese.

## Commands

```bash
pnpm dev          # Start both server (3711) and web (3710) in parallel
pnpm build        # Build all packages
pnpm lint         # Lint all packages
pnpm typecheck    # Type-check all packages
pnpm test         # Run all tests
pnpm test:watch   # Run tests in watch mode (all packages)
```

Run a single package's tests: `pnpm --filter @owndesign/core test`
Run a single test file: `pnpm --filter @owndesign/core exec vitest run src/agent/design-page-agent.test.ts`

## Architecture

pnpm monorepo with three packages and one app:

- **`packages/core`** (`@owndesign/core`) — Domain logic, no UI. AI agent, workspace storage, project/conversation services, preview server management, settings.
- **`packages/renderer`** (`@owndesign/renderer`) — React UI. Chat panel, workspace shell, preview frame, settings, onboarding.
- **`packages/server`** (`@owndesign/server`) — Hono HTTP server. REST API + SSE for chat streaming and frontend commands.
- **`apps/web`** (`@owndesign/web`) — Vite app entry point. Mounts `<OwnDesignApp>` from renderer.

### Data flow

`WorkspaceStore` (filesystem JSON at `~/.owndesign/`) → Hono REST API → fetch client (`renderer/src/api/client.ts`) → React components. Chat uses SSE via `ai` SDK's `createAgentUIStreamResponse` → `useChat` hook on the frontend.

### Path aliases

Configured in both `apps/web/vite.config.ts` and `apps/web/tsconfig.json`:

- `@owndesign/renderer` → `packages/renderer/src/app.tsx`
- `@owndesign/renderer/*` → `packages/renderer/src/*`
- `@owndesign/core/*` → `packages/core/src/*`
- `@` → `packages/renderer/src`

### Key domain concepts

- **Project** — Container for a design task. Has workspace directory with HTML files. Output type is always `"html"`.
- **Conversation** — Chat thread within a project. Messages streamed via AI SDK agent.
- **DesignPageAgent** — The AI agent (`core/src/agent/design-page-agent.ts`). Uses `ToolLoopAgent` from `ai` SDK v6 with 10 workspace tools (read, write, edit, patch, glob, grep, delete, create-html, call-frontend-capability, cdn-guard).
- **PreviewServerManager** — Dynamic Fastify servers per project/client with TTL-based lease (90s default) and heartbeat renewal.
- **FrontendCommandBus** — SSE-based command delivery from server to frontend for preview refresh/switch commands.
- **CDN guard** — HTML files can only reference CDN URLs configured in settings. Unapproved references rejected at tool level.

### API routes (server/src/app.ts)

All routes prefixed `/api/`. Key endpoints:
- `GET /workspace` — Full workspace state
- `POST /chat` — AI chat (SSE stream)
- `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id` — Project CRUD
- `POST /projects/:id/conversations`, etc. — Conversation CRUD
- `GET/PUT /settings` — Settings CRUD
- `POST /initial-setup` — First-run setup
- `POST /projects/:id/preview-session` — Acquire preview server
- `DELETE /projects/:id/preview-session` — Release preview server
- `POST /projects/:id/preview-session/heartbeat` — Keep preview alive
- `GET /projects/:id/frontend-capabilities/stream` — SSE for frontend commands
- `GET /projects/:id/download` — Download HTML or ZIP

### Component architecture (renderer)

- `ai-elements/` — Custom AI chat components (message, conversation, prompt-input, code-block, reasoning, tool, confirmation)
- `ui/` — ~25 base UI components built on `@base-ui/react` (shadcn-style)
- `features/conversation/` — Chat panel with streaming, model selection, context usage
- `features/workspace/` — Main layout (sidebar + preview pane)
- `features/preview/` — iframe preview with session management and capability bridge
- `features/onboarding/` — Initial setup wizard
- `features/settings/` — Settings dialog (model config, resources, general)

## Tech Stack

- **Runtime**: Node.js, TypeScript 6, ESM (`"type": "module"`)
- **Frontend**: React 19, React Router v7, Tailwind CSS v4, Vite 8
- **Backend**: Hono v4 (server), Fastify (preview servers)
- **AI**: Vercel AI SDK v6 (agent, streaming, `useChat`), DeepSeek + OpenAI-compatible providers
- **Testing**: Vitest 4, Testing Library (React + jest-dom + user-event)
- **Monorepo**: pnpm workspaces, shared config in `packages/config/`

## Conventions

- All packages use `"type": "module"` and ESM imports
- Core package exports via `"./*": "./src/*"` pattern — import as `@owndesign/core/agent/design-page-agent`
- Renderer exports: `"."` → `app.tsx`, `"./*"` → `src/*`
- Server runs on port 3711, web dev server on port 3710
- `OWNDESIGN_SERVER_PORT` and `OWNDESIGN_SERVER_HOST` env vars for server config
- `VITE_OWNDESIGN_API_BASE_URL` env var for web app API base URL (default: `http://127.0.0.1:3711`)
- Settings stored at `~/.owndesign/settings.json`
- Project data at `~/.owndesign/projects/<id>/`

## Skills

The `.agents/skills/` directory contains two skill definitions:
- **ai-elements** — Component library reference for AI chat UI components
- **ai-sdk** — AI SDK v6 patterns and `ToolLoopAgent` usage

Consult these when modifying agent behavior or chat UI components.