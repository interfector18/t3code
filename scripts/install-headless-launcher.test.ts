// @effect-diagnostics nodeBuiltinImport:off - Real shell/exec installation regression tests.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeAssert from "node:assert/strict";

import { installHeadlessLauncher, renderHeadlessLauncher } from "./install-headless-launcher.ts";

async function fixture(run: (home: string, runtime: string) => Promise<void>) {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-launcher-"));
  const managed = NodePath.join(home, ".local/opt/t3code/managed");
  const runtime = NodePath.join(managed, "runtime with spaces", "squashfs-root");
  try {
    await NodeFSP.mkdir(NodePath.join(home, ".local/bin"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(runtime, "resources/resource-monitor"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(managed, "runtime.py"),
      `print(${JSON.stringify(runtime)})\n`,
    );
    await NodeFSP.writeFile(
      NodePath.join(runtime, "t3code"),
      '#!/bin/sh\nprintf "%s\\n" "$T3CODE_RESOURCE_MONITOR_PATH" "$ELECTRON_RUN_AS_NODE" "$@"\n',
      { mode: 0o755 },
    );
    await NodeFSP.writeFile(
      NodePath.join(runtime, "resources/resource-monitor/t3-resource-monitor"),
      "#!/bin/sh\nexit 0\n",
      { mode: 0o755 },
    );
    await run(home, runtime);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
}

it("exports the selected runtime's collector through exec after extraction, regeneration, update and rollback", async () => {
  await fixture(async (home, extracted) => {
    const launcher = NodePath.join(home, ".local/bin/t3");
    for (const selection of ["shared", "override"] as const) {
      await NodeFSP.writeFile(launcher, renderHeadlessLauncher(selection));
      for (const runtime of [extracted, `${extracted}-updated`, extracted]) {
        if (runtime !== extracted) await NodeFSP.cp(extracted, runtime, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(home, ".local/opt/t3code/managed/runtime.py"),
          `print(${JSON.stringify(runtime)})\n`,
        );
        await installHeadlessLauncher(home);
        const result = NodeChildProcess.spawnSync(
          "sh",
          [launcher, "start", "--base-dir", "/untouched data"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              HOME: home,
              T3CODE_RESOURCE_MONITOR_PATH: "/stale/collector",
              T3CODE_SERVER_RUNTIME: selection === "override" ? runtime : "/ignored/override",
            },
          },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.stdout.trim().split("\n"), [
          `${runtime}/resources/resource-monitor/t3-resource-monitor`,
          "1",
          `${runtime}/resources/app.asar/apps/server/dist/bin.mjs`,
          "start",
          "--base-dir",
          "/untouched data",
        ]);
      }
    }
  });
});

it("refuses to exec a server with a missing or non-executable collector", async () => {
  await fixture(async (home, runtime) => {
    const launcher = NodePath.join(home, ".local/bin/t3");
    await NodeFSP.writeFile(launcher, renderHeadlessLauncher("shared"));
    const collector = `${runtime}/resources/resource-monitor/t3-resource-monitor`;
    for (const remove of [false, true]) {
      if (remove) await NodeFSP.unlink(collector);
      else await NodeFSP.chmod(collector, 0o644);
      const result = NodeChildProcess.spawnSync("sh", [launcher, "start"], {
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.include(result.stderr, "Resource monitor is missing or not executable");
      assert.equal(result.stdout, "");
    }
  });
});

it("upgrades old launchers without changing runtime selection and detects stale regenerated launchers", async () => {
  await fixture(async (home) => {
    const launcher = NodePath.join(home, ".local/bin/t3");
    for (const selection of ["shared", "override"] as const) {
      const runtimeLine =
        selection === "shared"
          ? 'runtime="$(python3 "$managed/runtime.py")"'
          : 'runtime="${T3CODE_SERVER_RUNTIME:-$(python3 "$managed/runtime.py")}"';
      const legacy = [
        "#!/bin/sh",
        "set -eu",
        'managed="$HOME/.local/opt/t3code/managed"',
        runtimeLine,
        "export ELECTRON_RUN_AS_NODE=1",
        'exec "$runtime/t3code" "$runtime/resources/app.asar/apps/server/dist/bin.mjs" "$@"',
        "",
      ].join("\n");
      await NodeFSP.writeFile(launcher, legacy);
      await NodeAssert.rejects(installHeadlessLauncher(home, true), /needs regeneration/);
      const installed = await installHeadlessLauncher(home);
      assert.equal(installed.selection, selection);
      assert.isTrue(installed.changed);
      assert.equal(
        await NodeFSP.readFile(NodePath.join(installed.backupDirectory!, "t3"), "utf8"),
        legacy,
      );
      assert.isFalse((await installHeadlessLauncher(home, true)).changed);
      assert.isFalse((await installHeadlessLauncher(home)).changed);
    }
    await NodeFSP.writeFile(launcher, "#!/bin/sh\necho custom\n");
    await NodeAssert.rejects(installHeadlessLauncher(home), /Unrecognized launcher/);
    assert.equal(await NodeFSP.readFile(launcher, "utf8"), "#!/bin/sh\necho custom\n");
  });
});
