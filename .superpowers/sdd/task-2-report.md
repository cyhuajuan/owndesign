# Task 2 Report: Freeze DESIGN.md Into Agent Instructions

## Status

Completed.

## Scope

Per task ownership, code changes were limited to:

- `packages/core/src/agent/design-page-agent.ts`
- `packages/core/src/agent/design-page-agent.test.ts`

Additionally, this report file was written as explicitly requested:

- `.superpowers/sdd/task-2-report.md`

No server, renderer, workspace store, or project service files were modified.

## Requirements Implemented

Implemented the prompt-builder changes from the task brief:

- Bumped `DESIGN_PAGE_AGENT_PROMPT_VERSION` from `6` to `7`.
- Updated `buildDesignPageAgentInstructions(resources?, designDocument?)`.
- Updated `buildDesignPageConversationInstructions(resources?, designDocument?)`.
- Added `buildProjectDesignDocumentPrompt(designDocument)`.
- Appended a `<project_design_document>` prompt section when a design document is provided.
- Omitted the section when the design document is `undefined` or exactly `''`.

## TDD Record

### Red

Added the brief-specified tests first in `packages/core/src/agent/design-page-agent.test.ts`:

- `freezes project DESIGN.md into conversation instructions when provided`
- `omits project DESIGN.md section when document is undefined`
- `increments the prompt version for project DESIGN.md behavior`

Ran:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
```

Observed expected failures:

- prompt version still `6`
- missing `<project_design_document>` section

### Green

Implemented the prompt-builder changes in `packages/core/src/agent/design-page-agent.ts`.

Re-ran:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
```

Result: all tests passed.

## Verification

Focused tests:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
```

Result: `15 passed`

Core typecheck:

```bash
pnpm --filter @owndesign/core typecheck
```

Result: passed

## Self-Review

Reviewed the diff after implementation and removed one unnecessary change I had briefly introduced outside the task’s required behavior.

Current diff is tightly scoped to:

- prompt version bump
- new prompt-section builder
- signature changes required by the brief
- tests covering present/absent design document behavior

## Notes / Concerns

- Persisted `designDocument` content is not trimmed or normalized by these changes.
- The prompt helper preserves the exact provided content inside the fenced markdown block.
- The current server call site still passes only `resources` into `buildDesignPageConversationInstructions(...)`. That wiring was out of scope for this task and was not modified per the ownership constraints. This task prepares the core prompt builder API and behavior for the provided design document input.

## Commit

Created commit:

```text
feat: freeze project design doc in prompt
```

## Review Fix Addendum

Addressed the reviewer finding about empty design-document strings:

- `buildProjectDesignDocumentPrompt` now treats only `null` and `undefined` as absent.
- `buildDesignPageConversationInstructions(undefined, '')` now includes `<project_design_document>` and `## Project DESIGN.md`.
- Whitespace-only strings are preserved inside the fenced markdown block without normalization.

Verification:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
pnpm --filter @owndesign/core typecheck
```

Results:

- targeted test suite passed
- core typecheck passed

## Review Fix Addendum 2

Addressed the prompt-safety finding for embedded markdown fences in `designDocument`:

- Replaced the raw fenced embedding in `buildProjectDesignDocumentPrompt(...)` with JSON string encoding.
- Kept `null` and `undefined` as the only absent values; empty strings still render the project design section.
- Added a regression test with embedded triple backticks and injected-looking text to confirm the prompt preserves content without a raw fenced wrapper around the document.
- Bumped `DESIGN_PAGE_AGENT_PROMPT_VERSION` to `8` to reflect the prompt-structure change.

Verification:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
pnpm --filter @owndesign/core typecheck
```

Results:

- targeted test suite passed
- core typecheck passed

## Review Fix Addendum 3

Hardened prompt-safe embedding of `DESIGN.md` content against embedded triple backticks:

- Kept the JSON string literal strategy in `buildProjectDesignDocumentPrompt(...)`.
- Escaped literal backticks inside the serialized JSON string as `\u0060` so user content cannot emit a raw markdown fence terminator in the rendered prompt.
- Preserved document semantics exactly when interpreted as JSON string content; no trimming, rewriting, summarizing, or normalization was added.
- Kept `null` and `undefined` as the only absent values; empty strings still render the section.
- Added a regression test with embedded triple backticks and injected-looking section text, and asserted the prompt does not contain any raw ````` substring.
- Bumped `DESIGN_PAGE_AGENT_PROMPT_VERSION` to `9` for the prompt-format change.

Verification:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
pnpm --filter @owndesign/core typecheck
```

Results:

- targeted test suite passed: `17 passed`
- core typecheck passed
