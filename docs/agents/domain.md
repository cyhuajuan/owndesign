# Domain Docs

How engineering skills should consume this repo's domain documentation when exploring codebase.

## Before exploring, read these

- `CONTEXT.md` at repo root, or
- `CONTEXT-MAP.md` at repo root if it exists; it points at one `CONTEXT.md` per context. Read each one relevant to topic.
- `docs/adr/`; read ADRs that touch area you're about to work in.

If any of these files don't exist, proceed silently. Don't flag absence and don't suggest creating them upfront.

## File structure

Single-context repo:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use glossary vocabulary

When output names domain concept, use term as defined in `CONTEXT.md`.

## Flag ADR conflicts

If output contradicts existing ADR, surface it explicitly rather than silently overriding.
