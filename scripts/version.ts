import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type VersionTrack = 'platform' | 'web' | 'cli' | 'desktop';
type BumpKind = 'patch' | 'minor' | 'major';
type Versions = Record<VersionTrack, string>;

type JsonTarget = {
  kind: 'json';
  track: VersionTrack;
  filePath: string;
  label: string;
};

type CargoTarget = {
  kind: 'cargo';
  track: VersionTrack;
  filePath: string;
  label: string;
};

type VersionTarget = JsonTarget | CargoTarget;

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const versionsPath = path.join(repoRoot, 'versions.json');
const tracks = ['platform', 'web', 'cli', 'desktop'] as const;
const bumpKinds = ['patch', 'minor', 'major'] as const;
const semverPattern = /^\d+\.\d+\.\d+$/;

const targets: VersionTarget[] = [
  jsonTarget('platform', 'package.json', 'root package.json'),
  jsonTarget('platform', 'packages/core/package.json', '@owndesign/core'),
  jsonTarget('platform', 'packages/renderer/package.json', '@owndesign/renderer'),
  jsonTarget('platform', 'packages/server/package.json', '@owndesign/server'),
  jsonTarget('web', 'apps/web/package.json', '@owndesign/web'),
  jsonTarget('cli', 'packages/cli/package.json', 'owndesign'),
  jsonTarget('desktop', 'apps/desktop/package.json', '@owndesign/desktop'),
  jsonTarget('desktop', 'apps/desktop/src-tauri/tauri.conf.json', 'desktop tauri.conf.json'),
  cargoTarget('desktop', 'apps/desktop/src-tauri/Cargo.toml', 'desktop Cargo.toml'),
];

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'list') {
    await listVersions();
    return;
  }

  if (command === 'check') {
    await checkVersions();
    return;
  }

  if (command === 'sync') {
    await syncVersions();
    return;
  }

  if (command === 'bump') {
    await bumpVersion(args);
    return;
  }

  if (command === 'set') {
    await setVersion(args);
    return;
  }

  printUsage();
  process.exit(command ? 1 : 0);
}

function jsonTarget(track: VersionTrack, relativePath: string, label: string): JsonTarget {
  return {
    kind: 'json',
    track,
    filePath: path.join(repoRoot, relativePath),
    label,
  };
}

function cargoTarget(track: VersionTrack, relativePath: string, label: string): CargoTarget {
  return {
    kind: 'cargo',
    track,
    filePath: path.join(repoRoot, relativePath),
    label,
  };
}

async function listVersions() {
  const versions = await readVersions();

  for (const track of tracks) {
    console.log(`${track}: ${versions[track]}`);
  }
}

async function checkVersions() {
  const versions = await readVersions();
  const mismatches: string[] = [];

  for (const target of targets) {
    const expected = versions[target.track];
    const actual = await readTargetVersion(target);

    if (actual !== expected) {
      mismatches.push(
        `${target.track} ${target.label}: expected ${expected}, found ${actual ?? 'missing'}`,
      );
    }
  }

  if (mismatches.length > 0) {
    console.error('Version check failed:');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exit(1);
  }

  console.log('Version check passed.');
}

async function syncVersions() {
  const versions = await readVersions();

  for (const target of targets) {
    await writeTargetVersion(target, versions[target.track]);
  }

  console.log('Versions synced.');
}

async function bumpVersion(args: string[]) {
  const [trackArg, kindArg] = args;
  const track = parseTrack(trackArg);
  const kind = parseBumpKind(kindArg);
  const versions = await readVersions();

  versions[track] = bumpSemver(versions[track], kind);
  await writeVersions(versions);
  await syncVersions();
  console.log(`${track}: ${versions[track]}`);
}

async function setVersion(args: string[]) {
  const [trackArg, version] = args;
  const track = parseTrack(trackArg);

  assertSemver(version, 'version');

  const versions = await readVersions();
  versions[track] = version;
  await writeVersions(versions);
  await syncVersions();
  console.log(`${track}: ${version}`);
}

async function readVersions(): Promise<Versions> {
  const raw = await readFile(versionsPath, 'utf8');
  const data = JSON.parse(raw) as Partial<Versions>;
  const versions = {} as Versions;

  for (const track of tracks) {
    const version = data[track];
    assertSemver(version, track);
    versions[track] = version;
  }

  return versions;
}

async function writeVersions(versions: Versions) {
  await writeJson(versionsPath, versions);
}

async function readTargetVersion(target: VersionTarget) {
  if (target.kind === 'json') {
    const data = JSON.parse(await readFile(target.filePath, 'utf8')) as { version?: string };
    return data.version;
  }

  const content = await readFile(target.filePath, 'utf8');
  const match = getCargoPackageVersionMatch(content);
  return match?.[1];
}

async function writeTargetVersion(target: VersionTarget, version: string) {
  if (target.kind === 'json') {
    const data = JSON.parse(await readFile(target.filePath, 'utf8')) as { version?: string };
    data.version = version;
    await writeJson(target.filePath, data);
    return;
  }

  const content = await readFile(target.filePath, 'utf8');
  const match = getCargoPackageVersionMatch(content);

  if (!match) {
    throw new Error(`Missing [package] version in ${target.filePath}`);
  }

  const nextContent = content.replace(match[0], match[0].replace(match[1], version));
  await writeFile(target.filePath, nextContent, 'utf8');
}

function getCargoPackageVersionMatch(content: string) {
  const packageSection = content.match(/(^\[package\][\s\S]*?)(?=^\[|(?![\s\S]))/m);
  return packageSection?.[1].match(/^version\s*=\s*"([^"]+)"/m);
}

async function writeJson(filePath: string, data: unknown) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseTrack(value: string | undefined): VersionTrack {
  if (tracks.includes(value as VersionTrack)) {
    return value as VersionTrack;
  }

  throw new Error(`Invalid track: ${value ?? 'missing'}. Expected ${tracks.join(', ')}.`);
}

function parseBumpKind(value: string | undefined): BumpKind {
  if (bumpKinds.includes(value as BumpKind)) {
    return value as BumpKind;
  }

  throw new Error(`Invalid bump kind: ${value ?? 'missing'}. Expected ${bumpKinds.join(', ')}.`);
}

function bumpSemver(version: string, kind: BumpKind) {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];

  if (kind === 'major') {
    return `${major + 1}.0.0`;
  }

  if (kind === 'minor') {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function assertSemver(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !semverPattern.test(value)) {
    throw new Error(`${label} must be x.y.z semver.`);
  }
}

function printUsage() {
  console.log(`Usage:
  pnpm version:list
  pnpm version:check
  pnpm version:sync
  pnpm version:bump <platform|web|cli|desktop> <patch|minor|major>
  pnpm version:set <platform|web|cli|desktop> <x.y.z>`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Version command failed.');
  process.exit(1);
});
