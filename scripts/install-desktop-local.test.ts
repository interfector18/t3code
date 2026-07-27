// @effect-diagnostics nodeBuiltinImport:off - Tests exercise real local filesystem installation behavior.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  installLocalDesktopSnapshot,
  renderLocalDesktopEntry,
  resolveLocalDesktopInstallPaths,
  type LocalDesktopCommandRunner,
} from "./install-desktop-local.ts";

const commitHash = "0123456789abcdef0123456789abcdef01234567";

async function makeTempDirectory(prefix: string): Promise<string> {
  return NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
}

it("resolves versioned snapshot and XDG integration paths", () => {
  const paths = resolveLocalDesktopInstallPaths({
    homeDirectory: "/home/tester",
    commitHash,
    dataHome: "/data",
  });

  assert.deepStrictEqual(paths, {
    shortCommitHash: "0123456789ab",
    installRoot: "/home/tester/.local/opt/t3code",
    snapshotsDirectory: "/home/tester/.local/opt/t3code/snapshots",
    snapshotDirectory: "/home/tester/.local/opt/t3code/snapshots/0123456789ab",
    snapshotAppImage: "/home/tester/.local/opt/t3code/snapshots/0123456789ab/T3-Code.AppImage",
    currentLink: "/home/tester/.local/opt/t3code/current",
    launcherPath: "/home/tester/.local/bin/t3code",
    desktopEntryPath: "/data/applications/t3code-local.desktop",
    iconPath: "/data/icons/hicolor/1024x1024/apps/t3code-local.png",
  });
});

it("renders a desktop entry pointing at the stable launcher", () => {
  const desktopEntry = renderLocalDesktopEntry({
    launcherPath: "/home/test user/.local/bin/t3code",
    iconPath: "/home/test user/.local/share/icons/t3code-local.png",
  });

  assert.equal(
    desktopEntry,
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=T3 Code (Local)",
      "Comment=Local versioned snapshot of T3 Code",
      'Exec="/home/test user/.local/bin/t3code" %U',
      'Icon="/home/test user/.local/share/icons/t3code-local.png"',
      "Terminal=false",
      "Categories=Development;Utility;",
      "StartupWMClass=t3code",
      "MimeType=x-scheme-handler/t3code;",
      "",
    ].join("\n"),
  );
});

it("builds from a detached worktree and atomically activates the installed snapshot", async () => {
  const root = await makeTempDirectory("t3code-local-install-test-");
  const repoRoot = NodePath.join(root, "repo");
  const homeDirectory = NodePath.join(root, "home");
  const tempRoot = NodePath.join(root, "temp");
  const sourceIcon = NodePath.join(repoRoot, "assets/prod/black-universal-1024.png");
  await NodeFSP.mkdir(NodePath.dirname(sourceIcon), { recursive: true });
  await NodeFSP.writeFile(sourceIcon, "icon");
  await NodeFSP.mkdir(tempRoot, { recursive: true });

  const calls: Array<{
    command: string;
    args: ReadonlyArray<string>;
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }> = [];

  const runner: LocalDesktopCommandRunner = async (command, args, options) => {
    calls.push({
      command,
      args,
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    if (command === "git" && args[0] === "rev-parse") {
      return { stdout: `${commitHash}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return { stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "worktree" && args[1] === "add") {
      const worktreeDirectory = args[3]!;
      await NodeFSP.mkdir(NodePath.join(worktreeDirectory, "assets/prod"), { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(worktreeDirectory, "assets/prod/black-universal-1024.png"),
        "icon",
      );
      return { stdout: "", stderr: "" };
    }
    if (command === "node" && args[0] === "scripts/build-desktop-artifact.ts") {
      const outputDirectory = args[args.indexOf("--output-dir") + 1]!;
      await NodeFSP.mkdir(outputDirectory, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(outputDirectory, "T3-Code-0.0.28-x86_64.AppImage"),
        "appimage",
      );
      return { stdout: "", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  try {
    const result = await installLocalDesktopSnapshot({
      repoRoot,
      homeDirectory,
      dataHome: NodePath.join(homeDirectory, ".local/share"),
      tempRoot,
      runner,
    });

    assert.equal(result.commitHash, commitHash);
    assert.equal(await NodeFSP.readFile(result.paths.snapshotAppImage, "utf8"), "appimage");
    assert.equal((await NodeFSP.stat(result.paths.snapshotAppImage)).mode & 0o777, 0o755);
    assert.equal(await NodeFSP.readlink(result.paths.currentLink), "snapshots/0123456789ab");
    assert.equal(
      await NodeFSP.readlink(result.paths.launcherPath),
      NodePath.join(result.paths.installRoot, "current/T3-Code.AppImage"),
    );
    assert.equal(await NodeFSP.readFile(result.paths.iconPath, "utf8"), "icon");
    assert.match(
      await NodeFSP.readFile(result.paths.desktopEntryPath, "utf8"),
      /Name=T3 Code \(Local\)/,
    );

    assert.deepStrictEqual(
      calls.map(({ command, args }) => [command, ...args.slice(0, 2)]),
      [
        ["git", "status", "--porcelain"],
        ["git", "rev-parse", "HEAD"],
        ["git", "worktree", "add"],
        ["vp", "install", "--frozen-lockfile"],
        ["node", "scripts/build-desktop-artifact.ts", "--platform"],
        ["git", "worktree", "remove"],
      ],
    );

    const buildCall = calls.find(
      ({ command, args }) => command === "node" && args[0] === "scripts/build-desktop-artifact.ts",
    );
    assert.equal(buildCall?.env?.GITHUB_REPOSITORY, undefined);
    assert.equal(buildCall?.env?.T3CODE_DESKTOP_UPDATE_REPOSITORY, undefined);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("refuses to snapshot a dirty checkout before creating a worktree", async () => {
  const runner: LocalDesktopCommandRunner = async (command, args) => {
    if (command === "git" && args[0] === "status") {
      return { stdout: " M apps/web/src/App.tsx\n", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  let error: unknown;
  try {
    await installLocalDesktopSnapshot({
      repoRoot: "/repo",
      homeDirectory: "/home/tester",
      runner,
    });
  } catch (cause) {
    error = cause;
  }
  assert.instanceOf(error, Error);
  assert.match(error.message, /working tree must be clean/i);
});
