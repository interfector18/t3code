#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This host-side installer manages an isolated git worktree and desktop files directly.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{40}$/iu;
const SHORT_COMMIT_HASH_LENGTH = 12;
const APP_IMAGE_NAME = "T3-Code.AppImage";
const PRODUCTION_ICON_RELATIVE_PATH = "assets/prod/black-universal-1024.png";

export interface LocalDesktopCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalDesktopCommandOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly streamOutput?: boolean | undefined;
}

export type LocalDesktopCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  options: LocalDesktopCommandOptions,
) => Promise<LocalDesktopCommandResult>;

export interface LocalDesktopInstallPaths {
  readonly shortCommitHash: string;
  readonly installRoot: string;
  readonly snapshotsDirectory: string;
  readonly snapshotDirectory: string;
  readonly snapshotAppImage: string;
  readonly currentLink: string;
  readonly launcherPath: string;
  readonly desktopEntryPath: string;
  readonly iconPath: string;
}

export function resolveLocalDesktopInstallPaths(input: {
  readonly homeDirectory: string;
  readonly commitHash: string;
  readonly dataHome?: string | undefined;
}): LocalDesktopInstallPaths {
  const commitHash = input.commitHash.trim().toLowerCase();
  if (!COMMIT_HASH_PATTERN.test(commitHash)) {
    throw new Error(`Invalid git commit hash: ${input.commitHash}`);
  }

  const shortCommitHash = commitHash.slice(0, SHORT_COMMIT_HASH_LENGTH);
  const installRoot = NodePath.join(input.homeDirectory, ".local/opt/t3code");
  const snapshotsDirectory = NodePath.join(installRoot, "snapshots");
  const snapshotDirectory = NodePath.join(snapshotsDirectory, shortCommitHash);
  const dataHome = input.dataHome ?? NodePath.join(input.homeDirectory, ".local/share");

  return {
    shortCommitHash,
    installRoot,
    snapshotsDirectory,
    snapshotDirectory,
    snapshotAppImage: NodePath.join(snapshotDirectory, APP_IMAGE_NAME),
    currentLink: NodePath.join(installRoot, "current"),
    launcherPath: NodePath.join(input.homeDirectory, ".local/bin/t3code"),
    desktopEntryPath: NodePath.join(dataHome, "applications/t3code-local.desktop"),
    iconPath: NodePath.join(dataHome, "icons/hicolor/1024x1024/apps/t3code-local.png"),
  };
}

function quoteDesktopEntryValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderLocalDesktopEntry(input: {
  readonly launcherPath: string;
  readonly iconPath: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=T3 Code (Local)",
    "Comment=Local versioned snapshot of T3 Code",
    `Exec=${quoteDesktopEntryValue(input.launcherPath)} %U`,
    `Icon=${quoteDesktopEntryValue(input.iconPath)}`,
    "Terminal=false",
    "Categories=Development;Utility;",
    "StartupWMClass=t3code",
    "MimeType=x-scheme-handler/t3code;",
    "",
  ].join("\n");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await NodeFSP.lstat(filePath);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw cause;
  }
}

async function assertReplaceableSymlink(filePath: string): Promise<void> {
  if (!(await pathExists(filePath))) {
    return;
  }
  const stat = await NodeFSP.lstat(filePath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-symlink path: ${filePath}`);
  }
}

async function replaceSymlink(target: string, linkPath: string): Promise<void> {
  await assertReplaceableSymlink(linkPath);
  const temporaryLink = `${linkPath}.next-${process.pid}`;
  await NodeFSP.rm(temporaryLink, { force: true });
  await NodeFSP.symlink(target, temporaryLink);
  await NodeFSP.rename(temporaryLink, linkPath);
}

async function replaceFile(
  sourcePath: string,
  destinationPath: string,
  mode?: number,
): Promise<void> {
  const temporaryPath = `${destinationPath}.next-${process.pid}`;
  await NodeFSP.copyFile(sourcePath, temporaryPath);
  if (mode !== undefined) {
    await NodeFSP.chmod(temporaryPath, mode);
  }
  await NodeFSP.rename(temporaryPath, destinationPath);
}

async function installSnapshotFiles(input: {
  readonly appImagePath: string;
  readonly iconSourcePath: string;
  readonly paths: LocalDesktopInstallPaths;
}): Promise<void> {
  const { paths } = input;
  await Promise.all([
    NodeFSP.mkdir(paths.snapshotDirectory, { recursive: true }),
    NodeFSP.mkdir(NodePath.dirname(paths.launcherPath), { recursive: true }),
    NodeFSP.mkdir(NodePath.dirname(paths.desktopEntryPath), { recursive: true }),
    NodeFSP.mkdir(NodePath.dirname(paths.iconPath), { recursive: true }),
  ]);

  await replaceFile(input.appImagePath, paths.snapshotAppImage, 0o755);
  await replaceFile(input.iconSourcePath, paths.iconPath, 0o644);

  const desktopEntry = renderLocalDesktopEntry({
    launcherPath: paths.launcherPath,
    iconPath: paths.iconPath,
  });
  const temporaryDesktopEntry = `${paths.desktopEntryPath}.next-${process.pid}`;
  await NodeFSP.writeFile(temporaryDesktopEntry, desktopEntry, { mode: 0o644 });
  await NodeFSP.rename(temporaryDesktopEntry, paths.desktopEntryPath);

  await replaceSymlink(NodePath.join("snapshots", paths.shortCommitHash), paths.currentLink);
  await replaceSymlink(
    NodePath.join(paths.installRoot, `current/${APP_IMAGE_NAME}`),
    paths.launcherPath,
  );
}

const defaultCommandRunner: LocalDesktopCommandRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      stdout += value;
      if (options.streamOutput) {
        process.stdout.write(value);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      stderr += value;
      if (options.streamOutput) {
        process.stderr.write(value);
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim();
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${exitCode}${detail ? `\n${detail}` : ""}`,
        ),
      );
    });
  });

async function findAppImage(outputDirectory: string): Promise<string> {
  const entries = await NodeFSP.readdir(outputDirectory);
  const appImages = entries.filter((entry) => entry.endsWith(".AppImage"));
  if (appImages.length !== 1) {
    throw new Error(
      `Expected exactly one AppImage in ${outputDirectory}, found ${appImages.length}.`,
    );
  }
  return NodePath.join(outputDirectory, appImages[0]!);
}

function localBuildEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.GITHUB_REPOSITORY;
  delete environment.T3CODE_DESKTOP_UPDATE_REPOSITORY;
  delete environment.T3CODE_DESKTOP_MOCK_UPDATES;
  delete environment.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT;
  return environment;
}

export async function installLocalDesktopSnapshot(input: {
  readonly repoRoot: string;
  readonly homeDirectory: string;
  readonly dataHome?: string | undefined;
  readonly tempRoot?: string | undefined;
  readonly runner?: LocalDesktopCommandRunner | undefined;
}): Promise<{
  readonly commitHash: string;
  readonly paths: LocalDesktopInstallPaths;
}> {
  const runner = input.runner ?? defaultCommandRunner;
  const gitStatus = await runner("git", ["status", "--porcelain"], {
    cwd: input.repoRoot,
  });
  if (gitStatus.stdout.trim().length > 0) {
    throw new Error("The working tree must be clean before creating a local desktop snapshot.");
  }

  const revision = await runner("git", ["rev-parse", "HEAD"], {
    cwd: input.repoRoot,
  });
  const commitHash = revision.stdout.trim().toLowerCase();
  const paths = resolveLocalDesktopInstallPaths({
    homeDirectory: input.homeDirectory,
    commitHash,
    dataHome: input.dataHome,
  });

  const temporaryDirectory = await NodeFSP.mkdtemp(
    NodePath.join(input.tempRoot ?? NodeOS.tmpdir(), "t3code-local-install-"),
  );
  const worktreeDirectory = NodePath.join(temporaryDirectory, "worktree");
  const artifactDirectory = NodePath.join(temporaryDirectory, "artifacts");
  let worktreeAdded = false;

  try {
    await runner("git", ["worktree", "add", "--detach", worktreeDirectory, commitHash], {
      cwd: input.repoRoot,
      streamOutput: true,
    });
    worktreeAdded = true;

    await runner("vp", ["install", "--frozen-lockfile"], {
      cwd: worktreeDirectory,
      streamOutput: true,
    });
    await runner(
      "node",
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "linux",
        "--target",
        "AppImage",
        "--arch",
        "x64",
        "--output-dir",
        artifactDirectory,
        "--verbose",
      ],
      {
        cwd: worktreeDirectory,
        env: localBuildEnvironment(),
        streamOutput: true,
      },
    );

    const appImagePath = await findAppImage(artifactDirectory);
    await installSnapshotFiles({
      appImagePath,
      iconSourcePath: NodePath.join(worktreeDirectory, PRODUCTION_ICON_RELATIVE_PATH),
      paths,
    });
  } finally {
    try {
      if (worktreeAdded) {
        await runner("git", ["worktree", "remove", "--force", worktreeDirectory], {
          cwd: input.repoRoot,
          streamOutput: true,
        });
      }
    } finally {
      await NodeFSP.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  return { commitHash, paths };
}

async function main(): Promise<void> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer validates its host before entering the workflow.
  if (NodeOS.platform() !== "linux" || NodeOS.arch() !== "x64") {
    throw new Error("Local desktop snapshot installation currently supports Linux x64 only.");
  }

  const repoRoot = NodePath.resolve(import.meta.dirname, "..");
  const result = await installLocalDesktopSnapshot({
    repoRoot,
    homeDirectory: NodeOS.homedir(),
    dataHome: process.env.XDG_DATA_HOME,
  });

  console.log(`Installed T3 Code snapshot ${result.paths.shortCommitHash}.`);
  console.log(`Launcher: ${result.paths.launcherPath}`);
  console.log(`Snapshot: ${result.paths.snapshotAppImage}`);
}

if (import.meta.main) {
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
