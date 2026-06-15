---
name: owndesign-versioning
description: Manage OwnDesign's release script. Use when Codex needs to release or explain versions for platform (root/core/renderer/server), web, CLI, or desktop/Tauri packages.
---

# OwnDesign Versioning

## Overview

Use the repo's TypeScript release script as the source of truth for all version work. Do not edit version fields by hand unless fixing the script itself.

## Version Tracks

`versions.json` owns four tracks:

- `platform`: root package + `@owndesign/core` + `@owndesign/renderer` + `@owndesign/server`
- `web`: `@owndesign/web`
- `cli`: `owndesign`
- `desktop`: `@owndesign/desktop` + Tauri config + Cargo package version

## Commands

Run from repo root:

```bash
pnpm version:release <platform|web|cli|desktop> <patch|minor|major>
```

This is the only public version command. It bumps versions, syncs target files, commits, tags, and pushes.

Linked release rules:

- `platform` releases also bump `web`, `cli`, and `desktop`.
- `web` releases also bump `cli`.
- `cli` releases only bump `cli`.
- `desktop` releases only bump `desktop`.
- Linked tracks use the same bump kind as the requested track.

## Default Behavior

When a user asks to bump, update, or release a version track with this skill, use `pnpm version:release`. This applies even when the user says only "patch", "minor", "major", "bump", or "update" and does not explicitly say "release".

There is no dry-run or local-only public command.

## Release Workflow

For any track, run:

```bash
pnpm version:release <track> <patch|minor|major>
```

The script requires a clean working tree, checks tag conflicts, bumps linked tracks, syncs files, performs internal version checks, builds/verifies the CLI when `cli` is included, creates one release commit, tags every updated track, and pushes the branch + tags.

## Guardrails

- Keep `versions.json` as the only source of truth.
- Do not manually edit package versions for routine releases.
- Keep SemVer as `x.y.z`; prerelease/build metadata is unsupported.
- Cargo version sync must only affect `[package] version`, not dependency versions.
- Do not recreate old version commands; update the release script when version behavior changes.
