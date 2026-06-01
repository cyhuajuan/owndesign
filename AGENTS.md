## Project Overview

OwnDesign is a web design tool powered by AI agents. Users describe what they want, and an AI agent (DeepSeek or OpenAI-compatible) generates/edits HTML pages with live preview. Monorepo managed with pnpm workspaces.

## Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm dev                  # Start server + web dev servers concurrently
pnpm desktop:dev          # Start desktop (Tauri) dev
pnpm build                # Build all in order: core → renderer → server → web → desktop → cli
pnpm lint                 # Lint all packages
pnpm typecheck            # Type-check all packages
pnpm test                 # Run all tests
pnpm test:watch           # Watch-mode tests for all packages
```

Run commands for a single package:
```bash
pnpm --filter @owndesign/core test
pnpm --filter @owndesign/renderer test:watch
pnpm --filter @owndesign/server typecheck
```

## Architecture

```
packages/core        → Domain logic: workspace storage, AI agent, settings, conversations
packages/renderer    → Shared React app (OwnDesignApp) - chat UI + preview
packages/server      → Hono HTTP API on port 3711
packages/cli         → Distributable binary bundling server + web
apps/web             → Vite SPA (port 3710, proxies /api → :3711)
apps/desktop         → Tauri v2 shell wrapping renderer
```

**Dependency graph**: web/desktop → renderer → core. server → core. cli bundles server + web dist.

**Data flow**: User prompt → `POST /api/chat` → AI agent (Vercel AI SDK ToolLoopAgent) → tool calls (read/write/edit HTML) → SSE stream back to client. Preview served via per-project Hono servers on random ports.

## Key Conventions

- **Package names**: `@owndesign/core`, `@owndesign/renderer`, `@owndesign/server`, `@owndesign/web`, `@owndesign/desktop`, `owndesign` (cli)
- **Subpath imports**: core uses `@owndesign/core/*` → `./src/*` (e.g. `@owndesign/core/workspace-store`). Renderer and apps use `@` → `./src`.
- **Build order matters**: core must build before renderer, renderer before server/web, web before desktop, desktop before cli.
- **No tsconfig project references** — dependencies resolved via Vite path aliases.
- **TypeScript**: strict mode, ES2022 target, ESNext modules.
- **UI**: Tailwind CSS v4, @base-ui/react (headless primitives), lucide-react icons.
- **Tests**: Vitest with jsdom (renderer/web/desktop) or node (core/server) environments. Shared setup in `packages/config/vitest.setup.ts`.
- **AI agent prompts**: Markdown files in `packages/core/src/prompts/agents/` (`design-page.md`, `turn-prompt-rewriter.md`). Agent tools defined in `packages/core/src/agent/tools/`.

## API Routes (Server)

All under `packages/server/src/routes/`:
- `POST /api/chat` — stream AI responses (SSE)
- `GET /api/workspace` — workspace state
- `CRUD /api/projects`, `/api/projects/:id/conversations`
- `GET/PUT /api/settings`
- `POST /api/initial-setup`
- `GET /api/projects/:id/frontend-capabilities/stream` — SSE for preview refresh commands
- `POST /api/projects/:id/preview-session`, `GET /api/projects/:id/download`

## Core Domain Models (packages/core/src)

- `WorkspaceStore` — disk-persisted JSON at `~/.owndesign/projects/{id}/`
- `ProjectRecord` — `{ id, name, description?, outputType }`
- `ConversationRecord` — `{ id, projectId, title, messages, agentInstructions? }`
- `AppSettings` — `{ defaultModelId, modelConfigurations, resources }`
- `ModelConfiguration` — `{ id, provider, model, baseUrl, apiKey, contextSizeK }`
- `FrontendCommandBus` — pub/sub for real-time preview commands via SSE