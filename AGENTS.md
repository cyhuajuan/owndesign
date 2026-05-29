## Project Overview

OwnDesign is a monorepo for an AI-powered web design tool. Users describe UI ideas in natural language; an AI agent generates and iterates on HTML prototypes displayed in a live preview. It ships as a browser SPA, a Tauri v2 desktop app, and an npm CLI package.

## Commands

```bash
pnpm install                 # Install all workspace dependencies
pnpm dev                     # Run web app + server in parallel (web:3710, server:3711)
pnpm desktop:dev             # Run desktop app (builds server first, launches Tauri)
pnpm desktop:build           # Build desktop app for production
pnpm build                   # Build all workspaces sequentially
pnpm lint                    # Lint all workspaces
pnpm typecheck               # Type-check all workspaces
pnpm test                    # Run all tests
pnpm test:watch              # Run tests in watch mode (parallel)
```

Run a single workspace's tests: `pnpm --filter @owndesign/core test`

## Architecture

### Monorepo Structure

```
apps/web        → @owndesign/web      Browser SPA (Vite, port 3710, proxies /api → 3711)
apps/desktop    → @owndesign/desktop   Tauri v2 desktop app (Rust backend, frameless window)
packages/core   → @owndesign/core      Business logic, AI agent, workspace storage
packages/server → @owndesign/server    Hono HTTP server (port 3711), REST API + SSE
packages/renderer → @owndesign/renderer React UI library (consumed by both apps)
packages/cli    → owndesign            Published npm CLI package (bundles server + web)
packages/config → @owndesign/config    Shared tsconfig, eslint, vitest setup
```

### Dependency Graph

```
web ──→ renderer ──→ core
desktop ──→ renderer ──→ core    (also depends on @tauri-apps/api)
server ──→ core
cli ──→ (bundles server + web at build time)
```

`core` has zero workspace dependencies. `renderer` is the sole UI package consumed by both app shells.

### Key Flows

**AI Chat Flow:** User prompt → `POST /api/chat` → `DesignPageAgent` (Vercel AI SDK `ToolLoopAgent`) → workspace tools (read/write/edit/glob/grep/createHtml) + `FrontendCommandBus` (SSE to frontend) → streaming response back. Agent limited to 50 steps (`stepCountIs(50)`).

**Preview Flow:** Agent writes HTML to workspace → calls `callFrontendCapability` tool → `FrontendCommandBus` pushes SSE event → `FrontendCapabilityBridge` in renderer refreshes/switches the preview iframe.

**Workspace Storage:** `~/.owndesign/projects/<id>/` contains `project.json`, `workspace/` dir (generated files), `conversations/<id>.json`. Settings at `~/.owndesign/settings.json`.

### AI Agent (packages/core/src/agent/)

- `design-page-agent.ts`: Creates `ToolLoopAgent` with prompt composed from 6 sections (core, page targeting, tool workflow, frontend capabilities, resource policy, runtime context)
- `tools/core.ts`: Registry `createWorkspaceToolRegistry()` converts tool definitions to AI SDK `ToolSet`
- `tools/cdn-guard.ts`: Validates that HTML only uses configured CDN resources
- `prompts/agents/design-page.md`: Agent instructions — UI prototypes only, no real backend logic

### Desktop App (apps/desktop/)

Tauri v2 with a Rust backend that manages the Node.js server lifecycle:
1. On launch, resolves Node.js >= 22 (downloads if missing)
2. Spawns `resources/server/index.js` as child process
3. Polls `GET /api/workspace` to confirm server ready
4. Kills process on window close

Frameless window with custom React title bar (`shellSlots` in `DesktopBootstrap`). No CSP — needed for iframe previews.

### Ports

- 3710: Web app dev server
- 3711: API server (dev and production)
- 3712: Desktop app dev server (Vite)

### Shared Config (packages/config/)

- `tsconfig.base.json`: ES2022, Bundler resolution, react-jsx, strict
- `eslint.config.mjs`: Flat config with typescript-eslint, react-hooks, react-refresh
- `vitest.setup.ts`: testing-library/jest-dom, ResizeObserver mock

### Test Environments

- `packages/core`: `node` environment
- `packages/renderer`, `apps/web`, `apps/desktop`: `jsdom` environment
