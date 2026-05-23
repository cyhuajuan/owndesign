## Project Overview

OwnDesign is a Chinese-language AI-powered design tool. Users converse with an AI agent (powered by DeepSeek or OpenAI-compatible models) to generate and iterate on HTML page designs, previewed live in an iframe. The UI defaults to `zh-CN`.

## Commands

```bash
pnpm dev          # Start dev server on port 3710
pnpm build        # Production build
pnpm lint         # ESLint (flat config, eslint.config.mjs)
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest (jsdom, single run)
pnpm test:watch   # Vitest in watch mode
```

Single test: `pnpm vitest run src/path/to/file.test.ts`

## Architecture

### Two-Layer Structure

- **Feature layer** (`src/features/`): Client-facing React components organized by domain — `conversation`, `onboarding`, `preview`, `projects`, `settings`, `workspace`. Components here are "use client" and compose the UI shell.
- **Server layer** (`src/server/`): Pure backend logic — no React. Services are instantiated per-request via factory functions in `src/server/owndesign.ts`.

### Data Persistence

- `WorkspaceStore` (`src/server/workspace-store/`): File-system store rooted at `~/.owndesign/`. Projects live at `~/.owndesign/projects/{id}/`, conversations at `{id}/conversations/{id}.json`. Workspace files (the AI generates HTML here) are at `{id}/workspace/`.
- `SettingsService` (`src/server/settings/settings-service.ts`): Reads/writes `~/.owndesign/settings.json` with an mtime-based cache. Holds model provider configs (DeepSeek, OpenAI-compatible) and font/icon CDN resource libraries.
- Preview servers (`src/server/preview/preview-server-manager.ts`): Each project gets a Fastify static file server on a random port. Lease-based lifecycle with 90s TTL and keepalive.

### AI Agent Flow

1. User sends message via `StreamingConversationPanel` (uses Vercel AI SDK `useChat`)
2. `POST /api/chat` creates a `ToolLoopAgent` from `src/server/agent/design-page-agent.ts`
3. Agent system prompt assembled from `design-page.agent.md` + runtime sections (page target protocol, resource policy, frontend capabilities)
4. Agent tools (`src/server/agent/tools/`) operate on WorkspaceStore: `read`, `edit`, `write`, `patch`, `createHtml`, `delete`, `glob`, `grep`, `callFrontendCapability`
5. `callFrontendCapability` sends SSE commands to the preview iframe via `FrontendCommandBus` (server-push, `POST /api/projects/{id}/frontend-capabilities/stream`)
6. On finish, messages saved via `ConversationService.saveUIMessageStream`

### Agent Tool CDN Guard

`cdn-guard.ts` validates that HTML written through `write`, `edit`, and `patch` tools only uses CDN URLs configured in settings. This is enforced at the tool level, not at the agent prompt level.

### Frontend Capability Bridge

`src/features/preview/components/frontend-capability-bridge.tsx` — client component that opens an SSE connection per project to receive preview commands (`preview.refresh`, `preview.switchHtml`). Dispatches custom DOM events.

### Key Types

- `ProjectRecord`, `ConversationRecord`, `WorkspaceEntry` etc. — defined in `src/server/workspace-store/store.ts`
- `ProjectOutputType` is currently `"html"` only
- `DesignPageAgent` interface in `src/server/agent/design-page-agent.ts` — `AiSdkDesignPageAgent` is the production implementation; `MockReplyEngine` in `src/lib/mock-reply-engine.ts` exists for testing

### Component Libraries

- **shadcn/ui** (base-nova style) — components in `src/components/ui/`
- **AI Elements** — components in `src/components/ai-elements/` (conversation, message, prompt-input, etc.), sourced from `@ai-elements` registry. These are excluded from ESLint (see `eslint.config.mjs`).

### Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vitest.config.ts`).

### Test Setup

`vitest.setup.ts` mocks `next/navigation` and polyfills `ResizeObserver`, `getAnimations`, `scrollIntoView`. Uses `@testing-library/react` and `@testing-library/jest-dom/vitest`.

## Important Conventions

- The project uses pnpm (not npm/yarn). `pnpm-workspace.yaml` exists but is minimal.
- Language is TypeScript with strict mode. React 19, Next.js 16 (App Router).
- All server state is file-based — no database. The `~/.owndesign/` directory is the data root.
- The agent's system prompt is the single source of behavioral truth. Modifications to how the agent decides what to do belong in `design-page.agent.md` or the prompt builder functions in `design-page-agent.ts`.
- Frontend custom events use the `owndesign:` prefix (e.g., `owndesign:preview-refresh`, `owndesign:preview-href-updated`).
- Global singletons for `PreviewServerManager` and `FrontendCommandBus` are stored on `globalThis` to survive HMR in development.