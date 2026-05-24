# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OwnDesign is an AI-powered UI design tool. Users describe a UI in natural language, and an AI agent generates previewable HTML pages displayed in an iframe preview pane. The app supports multi-page HTML projects, configurable font/icon CDNs, and streaming AI responses.

## Commands

```bash
# Install dependencies
pnpm install

# Dev (runs both server and web in parallel)
pnpm dev

# Build all packages
pnpm build

# Lint all packages
pnpm lint

# Typecheck all packages
pnpm typecheck

# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @owndesign/core test
pnpm --filter @owndesign/renderer test
pnpm --filter @owndesign/server test -- --passWithNoTests

# Run a single test file
pnpm --filter @owndesign/core vitest run src/server/workspace-store/store.test.ts
pnpm --filter @owndesign/renderer vitest run src/features/preview/components/frontend-capability-bridge.test.tsx

# Watch tests
pnpm test:watch
```

Dev server runs web at `http://127.0.0.1:3710` (proxies `/api` to server at `http://127.0.0.1:3711`). Override server URL with `OWNDESIGN_SERVER_URL` env var.

## Architecture

pnpm workspace monorepo with four packages:

- **`packages/core`** (`@owndesign/core`) — Backend business logic: AI agent, workspace store, settings, conversation/project services, preview server management. No HTTP framework dependency; used by the server package.
- **`packages/renderer`** (`@owndesign/renderer`) — React frontend: chat UI, workspace shell, settings panels, preview iframe bridge. Uses react-router, AI SDK React hooks, shadcn/ui components (base-nova style), Tailwind CSS.
- **`packages/server`** (`@owndesign/server`) — Hono HTTP API layer. Thin routing that delegates to core services. Serves the chat streaming endpoint, REST APIs, SSE frontend-capability stream, and project download.
- **`packages/config`** — Shared TypeScript, ESLint, and Vitest config (no package.json; referenced by relative path).
- **`apps/web`** (`@owndesign/web`) — Vite dev entrypoint that imports the renderer and proxies API requests to the server.

### Data Flow

1. Frontend (`renderer`) sends chat messages to `POST /api/chat`
2. Server creates an AI agent via `createDesignPageAgent` (core) using the Vercel AI SDK `ToolLoopAgent`
3. Agent has workspace tools (read, write, edit, patch, delete, glob, grep, createHtml, callFrontendCapability) that operate on project files in `~/.owndesign/projects/<id>/workspace/`
4. Streaming response flows back via `createAgentUIStreamResponse`
5. CDN guard (`cdn-guard.ts`) validates HTML output against configured resource settings to prevent external CDN injection
6. Frontend capability bridge receives SSE commands (`preview.refresh`, `preview.switchHtml`) to control the preview iframe

### Key Paths

- Agent prompt: `packages/core/src/server/agent/design-page.agent.md`
- Workspace store (file operations): `packages/core/src/server/workspace-store/store.ts`
- Frontend command bus (SSE): `packages/core/src/server/realtime/frontend-command-bus.ts`
- Server routes: `packages/server/src/app.ts`
- React app entry: `packages/renderer/src/app.tsx`

### Path Aliases

- `@/` → `packages/renderer/src/` (in renderer and web)
- `@owndesign/core/*` → `packages/core/src/*` (in renderer and server)
- `@owndesign/renderer` → `packages/renderer/src/app.tsx` (in web only, via Vite alias)

### Settings

Settings stored at `~/.owndesign/settings.json`. Model configurations support `deepseek` and `openai-compatible` providers. DeepSeek has a thinking mode (`disabled`/`high`/`max`). Default resources: Google Fonts (Inter + Noto Sans SC) and Lucide Icons.

### Preview Server

Each project + client tab gets a dedicated Fastify static file server on a random port (127.0.0.1). Lease-based with TTL and cleanup. The `PreviewServerManager` is a singleton on `globalThis`.

### ESLint Ignore

`src/components/ai-elements/` is excluded from ESLint (generated/shadcn AI elements).

## Testing

- Vitest across all packages
- `packages/config/vitest.setup.ts` provides jsdom setup, ResizeObserver mock, cleanup
- Renderer tests use `jsdom` environment; core/server tests use `node` environment
- Web app tests are passWithNoTests (no test files yet)