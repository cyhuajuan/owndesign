import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type VersionTrack = 'platform' | 'web' | 'cli' | 'desktop';
type BumpKind = 'patch' | 'minor' | 'major';
type Versions = Record<VersionTrack, string>;

type JsonTarget = {
  kind: 'json';
  track: VersionTrack;
  relativePath: string;
  filePath: string;
  label: string;
};

type CargoTarget = {
  kind: 'cargo';
  track: VersionTrack;
  relativePath: string;
  filePath: string;
  label: string;
};

type VersionTarget = JsonTarget | CargoTarget;

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

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

  if (command === 'release') {
    await releaseVersion(args);
    return;
  }

  printUsage();
  process.exit(command ? 1 : 0);
}

function jsonTarget(track: VersionTrack, relativePath: string, label: string): JsonTarget {
  return {
    kind: 'json',
    track,
    relativePath,
    filePath: path.join(repoRoot, relativePath),
    label,
  };
}

function cargoTarget(track: VersionTrack, relativePath: string, label: string): CargoTarget {
  return {
    kind: 'cargo',
    track,
    relativePath,
    filePath: path.join(repoRoot, relativePath),
    label,
  };
}

async function releaseVersion(args: string[]) {
  const [trackArg, kindArg] = args;
  const primaryTrack = parseTrack(trackArg);
  const bumpKind = parseBumpKind(kindArg);
  const releaseTracks = getReleaseTracks(primaryTrack);

  await assertCleanWorkingTree();

  const versions = await readVersions();
  const nextVersions = { ...versions };

  for (const track of releaseTracks) {
    nextVersions[track] = bumpSemver(nextVersions[track], bumpKind);
  }

  const tags = releaseTracks.map((track) => `${track}-v${nextVersions[track]}`);
  await assertTagsAvailable(tags);

  await writeVersions(nextVersions);
  await syncTargetVersions(nextVersions, releaseTracks);
  await assertVersionsSynced(nextVersions);

  if (releaseTracks.includes('cli')) {
    await validateCliVersion(nextVersions.cli);
  }

  const filesToStage = getReleaseFiles(releaseTracks);
  await runCommand('git', ['add', '--', ...filesToStage]);
  await runCommand('git', [
    'commit',
    '-m',
    `chore(release): ${primaryTrack} v${nextVersions[primaryTrack]}`,
  ]);

  for (const tag of tags) {
    await runCommand('git', ['tag', tag]);
  }

  await runCommand('git', ['push', 'origin', 'HEAD']);
  await runCommand('git', ['push', 'origin', ...tags]);

  console.log(`Released ${primaryTrack} v${nextVersions[primaryTrack]}.`);
  console.log(`Tags: ${tags.join(', ')}`);
}

function getReleaseTracks(track: VersionTrack): VersionTrack[] {
  if (track === 'platform') {
    return ['platform', 'web', 'cli', 'desktop'];
  }

  if (track === 'web') {
    return ['web', 'cli'];
  }

  return [track];
}

async function assertCleanWorkingTree() {
  const result = await runCommand('git', ['status', '--porcelain'], { capture: true });

  if (result.stdout.trim()) {
    throw new Error(`Working tree must be clean before release:\n${result.stdout.trim()}`);
  }
}

async function assertTagsAvailable(tags: string[]) {
  for (const tag of tags) {
    const local = await runCommand('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      allowFailure: true,
      capture: true,
    });

    if (local.code === 0) {
      throw new Error(`Tag already exists locally: ${tag}`);
    }

    const remote = await runCommand('git', ['ls-remote', '--exit-code', '--tags', 'origin', tag], {
      allowFailure: true,
      capture: true,
    });

    if (remote.code === 0) {
      throw new Error(`Tag already exists on origin: ${tag}`);
    }
  }
}

async function validateCliVersion(expectedVersion: string) {
  await runCommand(getPnpmCommand(), ['--filter', 'owndesign', 'build']);

  const result = await runCommand(process.execPath, ['packages/cli/dist/index.js', '--version'], {
    capture: true,
  });
  const actualVersion = result.stdout.trim();

  if (actualVersion !== expectedVersion) {
    throw new Error(`CLI version mismatch: expected ${expectedVersion}, found ${actualVersion}`);
  }
}

async function syncTargetVersions(versions: Versions, releaseTracks: VersionTrack[]) {
  for (const target of getTargetsForTracks(releaseTracks)) {
    await writeTargetVersion(target, versions[target.track]);
  }
}

async function assertVersionsSynced(versions: Versions) {
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
    throw new Error(`Version check failed:\n${mismatches.map((item) => `- ${item}`).join('\n')}`);
  }
}

function getTargetsForTracks(releaseTracks: VersionTrack[]) {
  const releaseTrackSet = new Set(releaseTracks);
  return targets.filter((target) => releaseTrackSet.has(target.track));
}

function getReleaseFiles(releaseTracks: VersionTrack[]) {
  return [
    'versions.json',
    ...getTargetsForTracks(releaseTracks).map((target) => target.relativePath),
  ];
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

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; capture?: boolean } = {},
) {
  return new Promise<CommandResult>((resolve, reject) => {
    const commandParts = getSpawnCommand(command, args);
    const child = spawn(commandParts.command, commandParts.args, {
      cwd: repoRoot,
      shell: false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      const result = {
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      };

      if (result.code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `${commandParts.command} ${commandParts.args.join(' ')} failed with exit code ${
              result.code
            }${
              result.stderr.trim() ? `:\n${result.stderr.trim()}` : ''
            }`,
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}

function getSpawnCommand(command: string, args: string[]) {
  if (process.platform === 'win32' && command.endsWith('.cmd')) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    };
  }

  return { command, args };
}

function printUsage() {
  console.log(`Usage:
  pnpm version:release <platform|web|cli|desktop> <patch|minor|major>`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Version release failed.');
  process.exit(1);
});
