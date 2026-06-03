---
name: owndesign-versioning
description: Manage OwnDesign's four-track version system using the repository scripts. Use when Codex needs to bump, set, sync, check, list, release, or explain versions for platform (root/core/renderer/server), web, CLI, or desktop/Tauri packages.
---

# OwnDesign Versioning

## Overview

Use the repo's TypeScript version script as the source of truth for all version work. Do not edit version fields by hand unless fixing the script itself.

## Version Tracks

`versions.json` owns four tracks:

- `platform`: root package + `@owndesign/core` + `@owndesign/renderer` + `@owndesign/server`
- `web`: `@owndesign/web`
- `cli`: `owndesign`
- `desktop`: `@owndesign/desktop` + Tauri config + Cargo package version

## Commands

Run from repo root:

```bash
pnpm version:list
pnpm version:check
pnpm version:sync
pnpm version:bump <platform|web|cli|desktop> <patch|minor|major>
pnpm version:set <platform|web|cli|desktop> <x.y.z>
```

Use `version:bump` for normal releases. Use `version:set` only for exact target versions. Use `version:sync` when `versions.json` is correct but tracked version fields drift.

## Release Workflow

For any track:

1. Run the requested bump or set command.
2. Run `pnpm version:check`.
3. Run relevant validation:
   - platform: `pnpm build` or at least `pnpm lint && pnpm typecheck && pnpm test`
   - web: `pnpm --filter @owndesign/web build`
   - cli: `pnpm --filter owndesign build`, then `node packages/cli/dist/index.js --version`
   - desktop: `pnpm --filter @owndesign/desktop build`
4. Commit the version files before tagging:
   - `git status --short`
   - `git add versions.json <changed version target files>`
   - `git commit -m "chore(release): <track> vX.Y.Z"`
5. Use tag names:
   - `platform-vX.Y.Z`
   - `web-vX.Y.Z`
   - `cli-vX.Y.Z`
   - `desktop-vX.Y.Z`

Create the release tag only after validation passes:

```bash
git tag <track>-vX.Y.Z
git tag --list "<track>-vX.Y.Z"
```

Use the bumped version from `versions.json`. Do not create a tag if build/check failed. Always tag the release commit, not an uncommitted working tree.

## Guardrails

- Keep `versions.json` as the only source of truth.
- Do not manually edit package versions for routine bumps.
- Keep SemVer as `x.y.z`; prerelease/build metadata is unsupported.
- Cargo version sync must only affect `[package] version`, not dependency versions.
- If `version:check` fails, prefer `pnpm version:sync` when `versions.json` is correct.
