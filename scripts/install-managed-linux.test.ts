// @effect-diagnostics nodeBuiltinImport:off - Real host installation and shell execution fixtures.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeAssert from "node:assert/strict";

import { installManagedLinuxFiles } from "./install-managed-linux.ts";
import { installHeadlessLauncher } from "./install-headless-launcher.ts";

async function fixture(run: (home: string) => Promise<void>) {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-managed-"));
  try {
    await run(home);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
}

it.each(["boot-service", "desktop-only"])(
  "%s cleanup removes obsolete builds while retaining active artifacts and database backups",
  async (mode) => {
    await fixture(async (home) => {
      const managed = `${home}/.local/opt/t3code/managed`;
      await NodeFSP.mkdir(managed, { recursive: true });
      await NodeFSP.writeFile(`${managed}/server-mode`, mode);
      await installManagedLinuxFiles(home);
      const image = "#!/bin/sh\nprintf app-opened\n";
      const digest = NodeCrypto.createHash("sha256").update(image).digest("hex");
      await NodeFSP.writeFile(`${managed}/T3-Code.AppImage`, image, { mode: 0o755 });
      const paths = {
        current: `${managed}/runtime/${digest}`,
        running: `${home}/.local/opt/t3code/snapshots/111111111111`,
        obsolete: `${home}/.local/opt/t3code/snapshots/222222222222`,
        backup: `${managed}/installation-backup-old`,
        databaseBackup: `${managed}/server-migration-backup-old`,
        obsoleteNative: `${home}/.t3/runtime/versions/1.0.0`,
        selectedNative: `${home}/.t3/runtime/versions/2.0.0`,
      };
      for (const path of Object.values(paths)) await NodeFSP.mkdir(path, { recursive: true });
      await NodeFSP.writeFile(`${paths.databaseBackup}/statev2.sqlite`, "database backup");
      await NodeFSP.writeFile(
        `${home}/.t3/runtime/service-state.json`,
        JSON.stringify({ activeVersion: "2.0.0" }),
      );
      for (const [path, version] of [
        [paths.obsoleteNative, "1.0.0"],
        [paths.selectedNative, "2.0.0"],
      ]) {
        await NodeFSP.writeFile(`${path}/.install-complete`, version!);
        await NodeFSP.utimes(`${path}/.install-complete`, 1, 1);
      }
      const bin = `${home}/bin`;
      await NodeFSP.mkdir(bin);
      await NodeFSP.writeFile(`${bin}/systemctl`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const result = NodeChildProcess.spawnSync("sh", [`${home}/.local/bin/t3code`], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
          APPIMAGE: `${paths.running}/T3-Code.AppImage`,
        },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "app-opened");
      for (const path of [
        paths.current,
        paths.running,
        paths.databaseBackup,
        paths.selectedNative,
      ]) {
        assert.isTrue((await NodeFSP.stat(path)).isDirectory(), path);
      }
      for (const path of [paths.obsolete, paths.backup, paths.obsoleteNative]) {
        await NodeAssert.rejects(NodeFSP.stat(path), { code: "ENOENT" });
      }
      await NodeAssert.rejects(
        NodeFSP.stat(`${home}/.config/systemd/user/t3code-build-cleanup.timer`),
        { code: "ENOENT" },
      );
      await NodeAssert.rejects(
        NodeFSP.stat(`${home}/.config/systemd/user/t3code-build-cleanup.service`),
        { code: "ENOENT" },
      );
      assert.isFalse((await installManagedLinuxFiles(home, true)).changed);
    });
  },
);

it.each(["shared", "boot-service", "desktop-only"])(
  "%s desktop shortcuts suppress AppImageLauncher through exec after regeneration",
  async (mode) => {
    await fixture(async (home) => {
      const managed = `${home}/.local/opt/t3code/managed`;
      await NodeFSP.mkdir(managed, { recursive: true });
      await NodeFSP.writeFile(`${managed}/server-mode`, mode);
      await installManagedLinuxFiles(home);
      if (mode === "desktop-only") {
        await NodeAssert.rejects(NodeFSP.stat(`${home}/.local/bin/t3`), { code: "ENOENT" });
        await NodeAssert.rejects(NodeFSP.stat(`${home}/.config/systemd/user/t3code.service`), {
          code: "ENOENT",
        });
      }
      const bin = `${home}/test-bin`;
      await NodeFSP.mkdir(bin);
      await NodeFSP.writeFile(`${bin}/systemctl`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await NodeFSP.writeFile(
        `${managed}/T3-Code.AppImage`,
        '#!/bin/sh\ntest "$APPIMAGELAUNCHER_DISABLE" = 1 || exit 42\nprintf "%s\\n" "$@"\n',
        { mode: 0o755 },
      );
      for (const file of ["t3code-local.desktop", "com.t3tools.T3Code.desktop"]) {
        await installManagedLinuxFiles(home);
        const entry = await NodeFSP.readFile(`${home}/.local/share/applications/${file}`, "utf8");
        const command = entry.split("\n").find((line) => line.startsWith("Exec="));
        assert.isDefined(command);
        const result = NodeChildProcess.spawnSync(
          "sh",
          ["-c", `${command!.slice(5).replace("%U", '"$@"')}`, "shortcut", "t3code://test/path"],
          {
            env: {
              ...process.env,
              HOME: home,
              PATH: `${bin}:${process.env.PATH}`,
              APPIMAGELAUNCHER_DISABLE: "",
            },
            encoding: "utf8",
          },
        );
        assert.equal(result.status, 0, `${file}: ${result.stderr}`);
        assert.equal(result.stdout.trim(), "t3code://test/path");
      }
    });
  },
);

it("retains explicit generated-file modes when installed under a private umask", async () => {
  await fixture(async (home) => {
    const module = new URL("./install-managed-linux.ts", import.meta.url).href;
    const program = `const {installManagedLinuxFiles} = await import(${JSON.stringify(module)}); process.umask(0o077); await installManagedLinuxFiles(${JSON.stringify(home)});`;
    const child = NodeChildProcess.spawnSync(
      process.execPath,
      ["--input-type=module", "-e", program],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.isFalse((await installManagedLinuxFiles(home, true)).changed);
    assert.equal((await NodeFSP.stat(`${home}/.local/bin/t3`)).mode & 0o777, 0o755);
  });
});

it("backs up the old snapshot launcher without following its link and is idempotent", async () => {
  await fixture(async (home) => {
    const image = `${home}/snapshot.AppImage`,
      launcher = `${home}/.local/bin/t3code`;
    await NodeFSP.writeFile(image, "untouched snapshot");
    await NodeFSP.mkdir(NodePath.dirname(launcher), { recursive: true });
    await NodeFSP.symlink(image, launcher);
    const result = await installManagedLinuxFiles(home);
    assert.isTrue(result.changed);
    assert.equal(await NodeFSP.readlink(`${result.backupDirectory}/.local/bin/t3code`), image);
    assert.equal(await NodeFSP.readFile(image, "utf8"), "untouched snapshot");
    assert.isTrue((await NodeFSP.lstat(launcher)).isFile());
    assert.isFalse((await installManagedLinuxFiles(home)).changed);
    assert.isFalse((await installManagedLinuxFiles(home, true)).changed);
    const headless = `${home}/.local/bin/t3`;
    await NodeFSP.writeFile(headless, "#!/bin/sh\nexit 0\n");
    await NodeAssert.rejects(installManagedLinuxFiles(home, true), /Managed installation differs/);
  });
});

it("fresh launches follow the managed image across updates and rollback, ignoring stale overrides", async () => {
  await fixture(async (home) => {
    await installManagedLinuxFiles(home);
    const managed = `${home}/.local/opt/t3code/managed`;
    for (const [image, staleOverride] of [
      ["release-one", true],
      ["release-two", false],
      ["release-one", false],
    ] as const) {
      await NodeFSP.writeFile(`${managed}/T3-Code.AppImage`, image);
      const digest = NodeCrypto.createHash("sha256").update(image).digest("hex");
      const runtime = `${managed}/runtime/${digest}/squashfs-root`;
      await NodeFSP.mkdir(`${runtime}/resources/resource-monitor`, { recursive: true });
      await NodeFSP.writeFile(
        `${runtime}/resources/resource-monitor/t3-resource-monitor`,
        "#!/bin/sh\nexit 0\n",
        { mode: 0o755 },
      );
      await NodeFSP.writeFile(
        `${runtime}/t3code`,
        '#!/bin/sh\nprintf "%s\\n" "$T3CODE_RESOURCE_MONITOR_PATH" "$ELECTRON_RUN_AS_NODE" "$@"\n',
        { mode: 0o755 },
      );
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
      delete env.T3CODE_SERVER_RUNTIME;
      if (staleOverride) env.T3CODE_SERVER_RUNTIME = "/old/transient/runtime";
      const result = NodeChildProcess.spawnSync(
        "sh",
        [`${home}/.local/bin/t3`, "start", "--base-dir", `${home}/.t3`],
        { env, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split("\n"), [
        `${runtime}/resources/resource-monitor/t3-resource-monitor`,
        "1",
        `${runtime}/resources/app.asar/apps/server/dist/bin.mjs`,
        "start",
        "--base-dir",
        `${home}/.t3`,
      ]);
    }
  });
});

it("retains boot-service ownership and selects the collector across updates, regeneration and rollback", async () => {
  await fixture(async (home) => {
    const managed = `${home}/.local/opt/t3code/managed`;
    await NodeFSP.mkdir(managed, { recursive: true });
    await NodeFSP.writeFile(`${managed}/server-mode`, "boot-service\n");
    await installManagedLinuxFiles(home);
    const unit = `${home}/.config/systemd/user/t3code.service`;
    await NodeFSP.mkdir(NodePath.dirname(unit), { recursive: true });
    await NodeFSP.writeFile(unit, "upstream-owned boot service");
    const refresh = NodeChildProcess.spawnSync("sh", [`${managed}/refresh-runtime`], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    assert.equal(refresh.status, 0, refresh.stderr);
    const dropin = `${home}/.config/systemd/user/t3code.service.d/90-managed-server.conf`;
    const configured = await NodeFSP.readFile(dropin, "utf8");
    assert.include(configured, "Environment=T3CODE_PORT=3773\n");
    assert.include(configured, "Environment=T3CODE_NO_BROWSER=true\n");
    await NodeFSP.rm(dropin);
    await installManagedLinuxFiles(home);
    assert.equal(await NodeFSP.readFile(dropin, "utf8"), configured);
    for (const version of ["1.0.0", "1.1.0", "1.0.0"]) {
      const root = `${home}/.t3/runtime`;
      const runtime = `${root}/versions/${version}`;
      // oxlint-disable-next-line t3code/no-global-process-runtime -- Shell fixture runs on this host outside an Effect runtime.
      const collector = `${runtime}/resource-monitor/${NodeOS.platform()}-${NodeOS.arch()}/t3-resource-monitor`;
      await NodeFSP.mkdir(NodePath.dirname(collector), { recursive: true });
      await NodeFSP.writeFile(collector, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await NodeFSP.writeFile(`${runtime}/.install-complete`, `${version}\n`);
      await NodeFSP.writeFile(
        `${root}/service-state.json`,
        JSON.stringify({ activeVersion: version }),
      );
      await NodeFSP.writeFile(
        `${runtime}/t3`,
        '#!/bin/sh\nprintf "%s\\n" "$T3CODE_RESOURCE_MONITOR_PATH" "$@"\n',
        { mode: 0o755 },
      );
      await installManagedLinuxFiles(home);
      await installHeadlessLauncher(home, true);
      assert.equal(await NodeFSP.readFile(unit, "utf8"), "upstream-owned boot service");
      const run = () =>
        NodeChildProcess.spawnSync("sh", [`${home}/.local/bin/t3`, "--version"], {
          env: {
            ...process.env,
            HOME: home,
            T3CODE_HOME: `${home}/.t3`,
            T3CODE_RESOURCE_MONITOR_PATH: "/stale/collector",
          },
          encoding: "utf8",
        });
      assert.equal(run().status, 0);
      assert.deepEqual(run().stdout.trim().split("\n"), [collector, "--version"]);
      await NodeFSP.chmod(collector, 0o644);
      assert.notEqual(run().status, 0);
      await NodeFSP.chmod(collector, 0o755);
    }
    assert.isFalse((await installManagedLinuxFiles(home, true)).changed);
  });
});
