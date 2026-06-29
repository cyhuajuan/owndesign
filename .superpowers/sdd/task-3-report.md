# Task 3 Report: Wire Server API and First-Chat Freezing

## Scope

- Modified `packages/server/src/app.ts`
- Modified `packages/server/src/app.test.ts`
- Left renderer and core untouched

## What changed

### Server request parsing

- Added `asDesignDocument(value)` in `packages/server/src/app.ts`
- `POST /api/projects` now forwards `designDocument` with the required tri-state behavior:
  - string: passed through exactly as received
  - `null`: passed through as `null`
  - omitted / other values: omitted as `undefined`
- `PATCH /api/projects/:projectId` now forwards `designDocument` with the same tri-state behavior

This preserves the existing `ProjectService` contract:

- omitted preserves existing value
- string replaces exactly
- `null` removes

No trimming or normalization is applied to `designDocument`.

### First-chat instruction freezing

- Updated the existing `if (!conversation.agentInstructions)` block in `/api/chat`
- First chat now freezes the current project setting by calling:

`buildDesignPageConversationInstructions(agentContext.resources, project.designDocument)`

- Existing frozen conversations are still left untouched on later chats, even if the project design document changes afterward

## Test-first workflow

### Red

Added failing tests in `packages/server/src/app.test.ts` for:

1. creating a project with a design document
2. updating a project design document through settings
3. freezing the design document into `conversation.agentInstructions` on first chat
4. keeping frozen instructions stable after later project design document edits

Initial run:

`pnpm --filter @owndesign/server test -- src/app.test.ts`

Result: 4 expected failures matching the missing server wiring.

### Green

Implemented the minimal server changes in `packages/server/src/app.ts` to satisfy those tests.

### Verification

Ran:

- `pnpm --filter @owndesign/server test -- src/app.test.ts`
- `pnpm --filter @owndesign/server typecheck`

Both passed.

## Self-review

- Confirmed `designDocument` strings are preserved exactly with no trim/normalize path
- Confirmed PATCH omission still resolves to `undefined`, preserving existing value
- Confirmed project create treats `null`/omitted as absent by forwarding `null` or `undefined` unchanged to the existing service contract
- Confirmed prompt freezing only happens inside the existing `if (!conversation.agentInstructions)` block
- Confirmed tests use `DESIGN_PAGE_AGENT_PROMPT_VERSION` dynamically, not a stale hardcoded value
- Confirmed only the two owned files were modified

## Risks / concerns

- The task brief’s sample expectation for a `<project_design_document>` marker depends on the current core prompt shape. The server behavior now correctly forwards `project.designDocument`; the test asserts the currently rendered prompt includes that section. If core prompt formatting changes later, that assertion may need to evolve while preserving the same server behavior.

## Outcome

Task 3 is implemented and verified for the owned server surface.

## Review-finding follow-up

- Added API-level PATCH coverage in `packages/server/src/app.test.ts` for the missing tri-state cases:
  - omitted `designDocument` preserves the existing value
  - `designDocument: null` clears the existing value
  - whitespace-only strings are preserved exactly
- No runtime code changed for this follow-up; the tests confirmed the current server behavior already matches the task requirement.

### Verification

- `pnpm --filter @owndesign/server test -- src/app.test.ts`
- `pnpm --filter @owndesign/server typecheck`

Both passed on fresh runs.
