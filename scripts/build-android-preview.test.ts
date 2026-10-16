// @effect-diagnostics nodeBuiltinImport:off - Executes the Bash entry point with a controlled toolchain fixture.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";

it("finds repository tools and forwards quoted arguments from another working directory", async () => {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-android-entry-"));
  const repo = NodeURL.fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
  try {
    await NodeFSP.writeFile(
      NodePath.join(temporary, "node"),
      '#!/bin/sh\nprintf "%s\\n" "$PATH" "$@"\n',
      { mode: 0o755 },
    );
    const result = NodeChildProcess.spawnSync(
      "/bin/bash",
      [
        NodePath.join(repo, "scripts/build-android-preview.sh"),
        "--output-dir",
        "a folder",
        "--check",
      ],
      { cwd: temporary, env: { PATH: `${temporary}:/usr/bin:/bin` }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const [path, ...args] = result.stdout.trim().split("\n");
    assert.equal(path, `${repo}/node_modules/.bin:${temporary}:/usr/bin:/bin`);
    assert.deepEqual(args, [
      NodePath.join(repo, "scripts/build-android-preview.ts"),
      "--output-dir",
      "a folder",
      "--check",
    ]);
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
});
