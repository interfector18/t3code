// @effect-diagnostics nodeBuiltinImport:off - Real host installation and shell execution fixtures.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeAssert from "node:assert/strict";

import { installManagedLinuxFiles } from "./install-managed-linux.ts";

async function fixture(run: (home: string) => Promise<void>) {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-managed-"));
  try {
    await run(home);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
}

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
