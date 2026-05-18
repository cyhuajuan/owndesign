# AGENTS.md

## Common Commands

```bash
pnpm dev          # Start dev server on port 3710
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Run all tests (vitest)
pnpm test:watch   # Watch mode
pnpm vitest src/lib/workspace-store.test.ts  # Run a single test file
```

## Architecture

HJDesign is a Next.js 16 (React 19) design workbench where users chat with an AI agent to generate HTML UI prototypes. Generated HTML is previewed live in an iframe backed by per-project Fastify servers.

**Data flow**: User sends message in chat → `StreamingConversationPanel` calls `/api/chat` (AI SDK's `useChat` hook) → API route creates a `ToolLoopAgent` with project workspace tools (glob, grep, read, write, edit, patch, delete, createHtml) → agent manipulates HTML files on disk → `ProjectPreviewFrame` detects changes via custom DOM events and refreshes the iframe.

**Persistence**: All data lives on disk under `~/.hjdesign/`:
- `projects/<id>/project.json` — project metadata
- `projects/<id>/conversations/<id>.json` — conversation messages
- `projects/<id>/workspace/` — AI-editable HTML files served by the preview server
- `settings.json` — app settings, model configurations, resource libraries (font/icon CDNs)

**Key services** (`src/lib/`):
- [hjdesign.ts](src/lib/hjdesign.ts) — factory functions wiring services together
- [workspace-store.ts](src/lib/workspace-store.ts) — filesystem persistence for projects, conversations, and workspace files. Handles path traversal safety, symlink blocks, glob/grep/search on workspace content
- [preview-server-manager.ts](src/lib/preview-server-manager.ts) — singleton managing per-project Fastify instances on random ports. Uses lease-based lifecycle (90s TTL, 30s cleanup interval), stored on `globalThis.__hjdesignPreviewServerManager`
- [design-page-agent.ts](src/lib/design-page-agent.ts) — builds the AI SDK `ToolLoopAgent` with model configuration, resource policies, and project workspace tools. Loads instructions from [design-page.agent.md](src/lib/agents/design-page.agent.md)
- [settings-service.ts](src/lib/settings-service.ts) — model configurations (DeepSeek or OpenAI-compatible), resource libraries (font/icon CDNs), interface language. Settings path: `~/.hjdesign/settings.json`
- [conversation-service.ts](src/lib/conversation-service.ts) — conversation CRUD with auto-titling from first user message
- [project-service.ts](src/lib/project-service.ts) — project CRUD, always creates an initial conversation on project creation

**API routes**:
- `/api/chat` — POST: streams AI agent response via `createAgentUIStreamResponse`, saves messages on finish
- `/api/projects/[projectId]/preview-session` — POST (acquire session) / DELETE (release session)
- `/api/projects/[projectId]/preview-session/heartbeat` — POST: renews lease every 30s from client
- `/api/settings` — GET/PUT: settings with API key sanitization (public settings never expose keys; updates merge keys from stored config when incoming key field is empty)

**Frontend component tree**:
- [page.tsx](src/app/page.tsx) — server component; server actions handle all mutations (create/rename/delete project/conversation), then `revalidatePath("/")`. Passes data down to client components
- [chat-shell.tsx](src/components/chat-shell.tsx) — layout shell: sidebar (conversation panel) + preview panel. Manages conversation pane collapse state in localStorage
- [streaming-conversation-panel.tsx](src/components/streaming-conversation-panel.tsx) — client component using `@ai-sdk/react`'s `useChat` with `DefaultChatTransport`. Loads settings from `/api/settings`, lets user select model and DeepSeek thinking mode. Emits `hjdesign:project-output-updated` custom events when mutation tools produce output
- [project-preview-frame.tsx](src/components/project-preview-frame.tsx) — manages preview server session (acquire, heartbeat, release). Listens for `hjdesign:project-output-updated` and `hjdesign:preview-refresh` events to refresh the iframe. Supports selecting which HTML file to preview via URL search param

**Agent tools** (`src/lib/agent-tools/`): `createHtml` (generates initial HTML with proper resource setup), `delete`, `edit`, `glob`, `grep`, `patch` (batch operations), `read`, `write`. Tools have CDN guard validation — `write`, `edit`, and `patch` reject HTML containing external CDN tags not in the configured resource settings.

**UI components**: shadcn/ui primitives in `src/components/ui/`, AI SDK elements in `src/components/ai-elements/` (registered in `components.json` via `@ai-elements` registry). The app uses an always-dark theme with purple accent (`--primary: #6c5ce7`).

## Key Patterns

- `@/` path alias resolves to `src/`
- Factory functions (`createWorkspaceStore`, `createProjectService`, `createConversationService`) create fresh instances per request in server context
- `PreviewServerManager` is a global singleton (stored on `globalThis`) to survive Next.js hot reload
- Project deletion uses OS trash/recycle bin (PowerShell on Windows, `trash` package on other platforms)
- All workspace path operations reject symlinks and validate paths don't escape workspace root
