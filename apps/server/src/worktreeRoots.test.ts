import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "./config.ts";
import { makeWorktreeRoots } from "./worktreeRoots.ts";
import { pickWorktreeRoot } from "./worktreesDirectory.ts";

const candidate = (root: string, freeBytes: number, activeThreads: number, ready = true) => ({
  root,
  ready,
  freeBytes,
  activeThreads,
});

describe("pickWorktreeRoot", () => {
  it("weighs free space by active threads and keeps list order on ties", () => {
    assert.equal(
      pickWorktreeRoot([candidate("busy", 1000, 3), candidate("idle", 500, 0)])?.root,
      "idle",
    );
    assert.equal(
      pickWorktreeRoot([candidate("first", 1000, 1), candidate("second", 500, 0)])?.root,
      "first",
    );
    assert.equal(
      pickWorktreeRoot([candidate("gone", 10_000, 0, false), candidate("ok", 1, 5)])?.root,
      "ok",
    );
    assert.isNull(pickWorktreeRoot([candidate("gone", 10_000, 0, false)]));
  });
});

describe("makeWorktreeRoots", () => {
  const setup = (activeWorktreePaths: ReadonlyArray<string> = []) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-worktree-roots-" });
      const roots = yield* makeWorktreeRoots(Effect.succeed(activeWorktreePaths)).pipe(
        Effect.provide(ServerConfig.layerTest(base, base)),
      );
      return { fs, path, base, roots };
    });

  it.effect("reports missing, relative and ready roots without creating any", () =>
    Effect.gen(function* () {
      const { fs, path, base, roots } = yield* setup();
      const ready = path.join(base, "ready");
      const unmounted = path.join(base, "unmounted", "worktrees");
      yield* fs.makeDirectory(ready);
      const described = yield* roots.describe([unmounted, "relative/worktrees", "/", ready]);
      assert.deepEqual(
        described.map((root) => root.state),
        ["missing", "invalid", "invalid", "ready"],
      );
      assert.isAbove(described[3]!.freeBytes ?? 0, 0);
      assert.isFalse(yield* fs.exists(unmounted));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("counts in-flight threads and held reservations on the root's drive", () =>
    Effect.gen(function* () {
      const { fs, path, base, roots } = yield* setup();
      const root = path.join(base, "root");
      yield* fs.makeDirectory(root);
      const held = yield* setup([base]).pipe(Effect.map((loaded) => loaded.roots));
      assert.equal((yield* held.describe([root]))[0]!.activeThreads, 1);

      yield* Effect.scoped(
        Effect.gen(function* () {
          assert.equal(yield* roots.reserve([root], base), yield* fs.realPath(root));
          assert.equal((yield* roots.describe([root]))[0]!.activeThreads, 1);
        }),
      );
      assert.equal((yield* roots.describe([root]))[0]!.activeThreads, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails instead of falling back when no root is usable", () =>
    Effect.gen(function* () {
      const { path, base, roots } = yield* setup();
      const missing = path.join(base, "missing");
      const error = yield* Effect.scoped(roots.reserve([missing], base)).pipe(Effect.flip);
      assert.include(error.detail, `${missing} (missing)`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
