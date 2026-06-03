## Project Overview

OwnDesign is a web design tool powered by AI agents. Users describe what they want, and an AI agent (DeepSeek or OpenAI-compatible or Anthropic) generates/edits HTML pages with live preview.

## Monorepo Structure

pnpm workspace monorepo. All packages use ESM (`"type": "module"`), TypeScript strict mode, and Vitest for testing.

**Packages (shared libraries):**
- `packages/core` (`@owndesign/core`) — Headless domain model: AI agent with tools, workspace file store, project/conversation/settings services, preview server manager, real-time command bus. No UI deps.
- `packages/renderer` (`@owndesign/renderer`) — Full React UI layer shared by web and desktop. Routes, components, i18n, API client. Depends on `@owndesign/core`.
- `packages/server` (`@owndesign/server`) — Hono HTTP API server. Depends on `@owndesign/core`. Bundled with esbuild into a single ESM file.
- `packages/config` — Shared `tsconfig.base.json` and `vitest.setup.ts`.

**Apps (deployment targets):**
- `apps/web` (`@owndesign/web`) — Vite SPA. Thin shell mounting `OwnDesignApp` from renderer. Dev proxy `/api` → `127.0.0.1:3711`.
- `apps/desktop` (`@owndesign/desktop`) — Tauri v2 desktop app. Rust backend manages Node.js runtime and server lifecycle. Vite dev on port 3712.
- `packages/cli` (`owndesign`) — Distributable Node.js CLI. Bundles server+web into single ESM, spawns server as child process. `node >= 22`.

**Dependency graph:**
```
core ← renderer ← web
                   ← desktop
core ← server ← cli (bundles web+server dist)
```

**Path aliases** (configured in tsconfig and vite configs):
- `@/*` → `./src/*` (within each package)
- `@owndesign/core/*` → `../core/src/*` (in renderer and server)
- `@owndesign/renderer` → `../../packages/renderer/src/app.tsx` (in web/desktop vite configs)
- `@owndesign/renderer/*` → `../../packages/renderer/src/*` (in web/desktop vite configs)

## Commands

```bash
pnpm install            # Install all workspace dependencies
pnpm dev                # Start server (3711) + web (3710) concurrently
pnpm desktop:dev        # Start desktop app with Tauri
pnpm build              # Build core, renderer, server, web (parallel) → desktop → cli (sequential)
pnpm lint               # oxlint .  (NOT eslint)
pnpm typecheck          # Run tsc in all 6 packages concurrently
pnpm test               # Run vitest run in all 6 packages concurrently
pnpm test:watch         # Run vitest watch in all 6 packages concurrently

# Single package:
pnpm --filter @owndesign/core test
pnpm --filter @owndesign/renderer test
pnpm --filter @owndesign/server test
```

Version management uses `scripts/version.ts`:
```bash
pnpm version:check      # Verify all versions match versions.json
pnpm version:bump       # Bump a track (platform|web|cli|desktop) by patch|minor|major
pnpm version:sync       # Write versions.json to all target files
```

Versions are tracked in `versions.json` with 4 independent tracks: `platform` (core, renderer, server, root), `web`, `cli`, `desktop`.

## Architecture Notes

- **AI integration**: Uses Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, `@ai-sdk/deepseek`). The core agent (`src/agent/design-page-agent.ts`) orchestrates LLM calls with file-editing tools.
- **UI framework**: React 19, react-router 7, Tailwind CSS 4, shadcn/ui (Base UI Nova variant), motion (framer-motion v12), lucide-react icons.
- **Streaming**: Chat UI streams AI responses via AI SDK; `streamdown` renders streaming markdown with CJK/code/math/mermaid support.
- **i18n**: Chinese and English (`src/features/i18n/`).
- **Desktop Rust side**: Auto-downloads Node.js 22 if missing, spawns server binary, health-checks port 3711.
- **Server build**: `tsc` for type checking, then esbuild bundles into single `dist/index.js`. Prompt template files are copied to dist alongside it.
- **Vite alias resolution**: The renderer is not consumed as a built package — web and desktop vite configs alias `@owndesign/renderer` directly to source for HMR during dev.