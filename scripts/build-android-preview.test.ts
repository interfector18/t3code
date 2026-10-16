// @effect-diagnostics nodeBuiltinImport:off - Executes the Bash entry point with a controlled toolchain fixture.
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";

import { publishAndroidPreview } from "./build-android-preview.ts";

it("publishes through a delivery symlink without replacing the link or staging on its filesystem", async () => {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-android-output-"));
  const repo = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  const linkParent = await NodeFSP.mkdtemp(NodePath.join(repo, ".t3-android-output-"));
  try {
    const output = NodePath.join(temporary, "phone", "Sync Folder", "Apps", "t3");
    const link = NodePath.join(linkParent, "Android-T3");
    const apk = NodePath.join(temporary, "build.apk");
    const manifest = { file: "T3-Code-Preview.apk", versionCode: 42 };
    await NodeFSP.mkdir(output, { recursive: true });
    await NodeFSP.symlink(output, link);
    await NodeFSP.writeFile(apk, "signed preview fixture");
    await NodeFSP.writeFile(NodePath.join(output, manifest.file), "previous preview");
    await publishAndroidPreview(apk, link, manifest);
    assert.isTrue((await NodeFSP.lstat(link)).isSymbolicLink());
    assert.equal(
      await NodeFSP.readFile(NodePath.join(output, manifest.file), "utf8"),
      "signed preview fixture",
    );
    assert.deepEqual(
      JSON.parse(await NodeFSP.readFile(NodePath.join(link, "latest.json"), "utf8")),
      manifest,
    );
    assert.deepEqual((await NodeFSP.readdir(NodePath.dirname(output))).sort(), ["t3"]);
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
    await NodeFSP.rm(linkParent, { recursive: true, force: true });
  }
});

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
