// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import {
  collectForkReleaseChanges,
  formatForkReleaseNotes,
  parseForkReleaseSummary,
} from "./generate-fork-release-notes.ts";

it("compares rebased releases without replaying retained patches, and separates updated and removed patches", () => {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-notes-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  env.GIT_CONFIG_GLOBAL = NodeOS.devNull;
  env.GIT_CONFIG_NOSYSTEM = "1";
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "core.hooksPath=" + NodeOS.devNull, "-c", "commit.gpgsign=false", ...args],
      { cwd, env, encoding: "utf8" },
    ).trim();
  const commit = (file: string, contents: string, title: string) => {
    NodeFS.writeFileSync(NodePath.join(cwd, file), contents);
    git("add", file);
    git("commit", "-m", title);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "--initial-branch=upstream");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release@example.invalid");
    commit("base", "base", "chore: initial tree");
    git("switch", "-c", "fork");
    const retained = commit("retained", "same", "feat: retained sessions");
    commit("removed", "old", "fix: obsolete patch");
    const previous = commit("updated", "old", "fix: adapted patch");
    git("switch", "upstream");
    const upstream = commit("upstream", "new", "perf(server): faster recovery (#123)");
    git("switch", "-c", "next");
    git("cherry-pick", retained);
    commit("updated", "new", "fix: adapted patch");
    commit("feature", "new", "feat(web): hide working threads");
    const ref = commit("workflow", "new", "ci(release): generate accurate notes");
    const changes = collectForkReleaseChanges({
      cwd,
      ref,
      previousRef: previous,
      upstreamRef: upstream,
    });
    expect(changes.upstream.map((c) => c.subject)).toEqual([
      "perf(server): faster recovery (#123)",
    ]);
    expect(changes.fork.map((c) => [c.subject, c.updated])).toEqual([
      ["ci(release): generate accurate notes", false],
      ["feat(web): hide working threads", false],
      ["fix: adapted patch", true],
    ]);
    expect(changes.removedFork.map((c) => c.subject)).toEqual(["fix: obsolete patch"]);
    const notes = formatForkReleaseNotes(changes, {
      version: "1.0.0-nightly.20261103.1",
      repository: "owner/fork",
      upstreamRepository: "owner/upstream",
      previousRef: "vprevious",
      ref,
      summary: ["**Performance:** Large workspaces recover with less database work."],
    });
    expect(notes.split("<details>")[0]).toContain(
      "Large workspaces recover with less database work.",
    );
    expect(notes.split("<details>")[0]).not.toContain("feat(web):");
    const reviewed = {
      previousRelease: "vprevious",
      upstreamBase: changes.upstreamBase,
      highlights: ["**Performance:** Large workspaces recover with less database work."],
    };
    expect(parseForkReleaseSummary(reviewed, "vprevious", changes.upstreamBase)).toEqual(
      reviewed.highlights,
    );
    expect(() => parseForkReleaseSummary(reviewed, "vnewer", changes.upstreamBase)).toThrow(
      "baseline",
    );
    expect(() => parseForkReleaseSummary(reviewed, "vprevious", previous)).toThrow("baseline");
    expect(() =>
      parseForkReleaseSummary({ ...reviewed, highlights: [] }, "vprevious", changes.upstreamBase),
    ).toThrow("highlights");
    expect(() =>
      parseForkReleaseSummary(
        { ...reviewed, highlights: [" "] },
        "vprevious",
        changes.upstreamBase,
      ),
    ).toThrow("highlights");
    expect(() => parseForkReleaseSummary(null, "vprevious", changes.upstreamBase)).toThrow(
      "summary",
    );
    expect(notes).toContain("https://github.com/owner/upstream/commit/");
    expect(notes).toContain("https://github.com/owner/fork/commit/");
    expect(notes).not.toContain("retained sessions");
    expect(notes).toContain("Updated fork patches");
    expect(notes).toContain("Removed fork patches");
    expect(notes).toContain("<summary>Full changelog</summary>");
    expect(
      collectForkReleaseChanges({ cwd, ref, previousRef: ref, upstreamRef: upstream }).fork,
    ).toEqual([]);
    const initial = collectForkReleaseChanges({
      cwd,
      ref,
      previousRef: null,
      upstreamRef: upstream,
    });
    expect(initial.upstream).toEqual([]);
    expect(initial.fork).toHaveLength(4);
    expect(
      formatForkReleaseNotes(initial, {
        version: "1.0.0",
        repository: "owner/fork",
        upstreamRepository: "owner/upstream",
        previousRef: null,
        ref,
        summary: ["Initial fork release."],
      }),
    ).toContain("Initial fork release");
  } finally {
    NodeFS.rmSync(cwd, { recursive: true, force: true });
  }
});
