// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's FileSystem has no statfs.
import * as NodeFSP from "node:fs/promises";

import { GitCommandError, type WorktreeRootStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "./config.ts";
import { DiskSpaceCheckError } from "./persistence/DatabaseMaintenance.ts";
import {
  isFilesystemRoot,
  pickWorktreeRoot,
  resolveWorktreesDirectory,
} from "./worktreesDirectory.ts";

export interface InspectedWorktreeRoot extends WorktreeRootStatus {
  readonly ready: boolean;
  /** Real path when the root exists. */
  readonly directory: string | null;
  readonly device: number | null;
}

export interface WorktreeRoots {
  readonly describe: (
    roots: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<InspectedWorktreeRoot>>;
  /** Holds the chosen root's load for the scope, so concurrent creations spread out. */
  readonly reserve: (
    roots: ReadonlyArray<string>,
    cwd: string,
  ) => Effect.Effect<string, GitCommandError, Scope.Scope>;
}

/** `activeWorktreePaths` lists the worktrees of threads with a run in flight. */
export const makeWorktreeRoots = Effect.fnUntraced(function* (
  activeWorktreePaths: Effect.Effect<ReadonlyArray<string>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const reservations = new Map<number, number>();
  const gate = yield* Semaphore.make(1);

  const deviceOf = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => Number(info.dev)),
      Effect.orElseSucceed(() => null),
    );

  const activeThreadsByDevice = Effect.gen(function* () {
    const paths = yield* activeWorktreePaths;
    const devices = yield* Effect.forEach(paths, deviceOf, {
      concurrency: 8,
    });
    const counts = new Map<number, number>();
    for (const device of devices) {
      if (device !== null) counts.set(device, (counts.get(device) ?? 0) + 1);
    }
    return counts;
  });

  const inspect = Effect.fnUntraced(function* (resolved: string | null) {
    if (resolved === null) return { state: "invalid" as const, directory: null, device: null };
    // Only the default root is ours to create; a missing custom one may be an unmounted drive.
    if (resolved === config.worktreesDir)
      yield* fileSystem.makeDirectory(resolved, { recursive: true }).pipe(Effect.ignore);
    const directory = yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => null));
    if (directory === null) return { state: "missing" as const, directory: null, device: null };
    if (isFilesystemRoot(directory, path))
      return { state: "invalid" as const, directory: null, device: null };
    const info = yield* fileSystem.stat(directory).pipe(Effect.orElseSucceed(() => null));
    if (info === null || info.type !== "Directory")
      return { state: "invalid" as const, directory: null, device: null };
    const writable = yield* fileSystem.access(directory, { writable: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    return {
      state: writable ? ("ready" as const) : ("not-writable" as const),
      directory,
      device: Number(info.dev),
    };
  });

  const freeBytes = (directory: string) =>
    Effect.tryPromise({
      try: () => NodeFSP.statfs(directory),
      catch: (cause) => new DiskSpaceCheckError({ path: directory, cause }),
    }).pipe(
      Effect.map((stats) => Number(stats.bavail) * Number(stats.bsize)),
      Effect.orElseSucceed(() => null),
    );

  const describe: WorktreeRoots["describe"] = Effect.fn("WorktreeRoots.describe")(
    function* (roots) {
      const home = yield* HostProcess.HomeDirectory;
      const configured = roots.length === 0 ? [""] : roots;
      const active = yield* activeThreadsByDevice;
      return yield* Effect.forEach(
        configured,
        Effect.fnUntraced(function* (root) {
          const inspected = yield* inspect(
            resolveWorktreesDirectory(root, config.worktreesDir, path, home),
          );
          const free = inspected.directory === null ? null : yield* freeBytes(inspected.directory);
          const device = inspected.device;
          return {
            root: root === "" ? config.worktreesDir : root,
            state: inspected.state,
            freeBytes: free,
            activeThreads:
              device === null ? 0 : (active.get(device) ?? 0) + (reservations.get(device) ?? 0),
            ready: inspected.state === "ready" && free !== null,
            directory: inspected.directory,
            device,
          } satisfies InspectedWorktreeRoot;
        }),
        { concurrency: "unbounded" },
      );
    },
  );

  const reserve: WorktreeRoots["reserve"] = (roots, cwd) =>
    Effect.acquireRelease(
      gate.withPermits(1)(
        Effect.gen(function* () {
          const inspected = yield* describe(roots);
          const chosen = pickWorktreeRoot(
            inspected.map((root) => ({ ...root, freeBytes: root.freeBytes ?? 0 })),
          );
          if (chosen === null || chosen.directory === null || chosen.device === null) {
            return yield* new GitCommandError({
              operation: "WorktreeRoots.reserve",
              command: "git worktree add",
              cwd,
              detail: `No worktree location is usable: ${inspected
                .map((root) => `${root.root} (${root.state})`)
                .join(", ")}. Change it in Settings → Worktrees.`,
            });
          }
          reservations.set(chosen.device, (reservations.get(chosen.device) ?? 0) + 1);
          return { directory: chosen.directory, device: chosen.device };
        }),
      ),
      ({ device }) =>
        Effect.sync(() => {
          const remaining = (reservations.get(device) ?? 1) - 1;
          if (remaining > 0) reservations.set(device, remaining);
          else reservations.delete(device);
        }),
    ).pipe(Effect.map(({ directory }) => directory));

  return { describe, reserve } satisfies WorktreeRoots;
});
