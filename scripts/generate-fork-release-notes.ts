// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

interface Commit {
  readonly sha: string;
  readonly subject: string;
}

interface Changes {
  readonly upstreamBase: string;
  readonly previousUpstreamBase: string | null;
  readonly upstream: readonly Commit[];
  readonly fork: readonly (Commit & { readonly updated: boolean })[];
  readonly removedFork: readonly Commit[];
}

function git(cwd: string, args: readonly string[]): string {
  return NodeChildProcess.execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // Hooks can export an index or repository belonging to a different checkout.
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  }).trim();
}

function commits(cwd: string, args: readonly string[]): Commit[] {
  const records = git(cwd, ["log", "--no-merges", "--format=%H%x00%s", ...args]);
  return records
    ? records.split("\n").map((record) => {
        const [sha, subject] = record.split("\0");
        if (!sha || !subject) throw new Error("Invalid Git commit record");
        return { sha, subject };
      })
    : [];
}

export function collectForkReleaseChanges(input: {
  readonly cwd: string;
  readonly ref: string;
  readonly previousRef: string | null;
  readonly upstreamRef: string;
}): Changes {
  const { cwd } = input;
  const resolve = (ref: string) =>
    git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const ref = resolve(input.ref);
  const upstreamRef = resolve(input.upstreamRef);
  const upstreamBase = git(cwd, ["merge-base", ref, upstreamRef]);
  if (input.previousRef === null) {
    return {
      upstreamBase,
      previousUpstreamBase: null,
      upstream: [],
      fork: commits(cwd, [`${upstreamBase}..${ref}`]).map((c) => ({ ...c, updated: false })),
      removedFork: [],
    };
  }
  const previous = resolve(input.previousRef);
  const previousUpstreamBase = git(cwd, ["merge-base", previous, upstreamRef]);
  if (git(cwd, ["merge-base", previousUpstreamBase, upstreamBase]) !== previousUpstreamBase) {
    throw new Error("Upstream history moved backwards or diverged; review the release baseline");
  }
  const previousSubjects = new Set(
    commits(cwd, [`${previousUpstreamBase}..${previous}`]).map((c) => c.subject),
  );
  const currentSubjects = new Set(commits(cwd, [`${upstreamBase}..${ref}`]).map((c) => c.subject));
  const range = `${previous}...${ref}`;
  return {
    upstreamBase,
    previousUpstreamBase,
    upstream: commits(cwd, [`${previousUpstreamBase}..${upstreamBase}`]),
    // Patch equivalence, not ancestry: releases retain fork patches through rebases.
    fork: commits(cwd, ["--cherry-pick", "--right-only", range, "--not", upstreamRef]).map((c) => ({
      ...c,
      updated: previousSubjects.has(c.subject),
    })),
    removedFork: commits(cwd, ["--cherry-pick", "--left-only", range, "--not", upstreamRef]).filter(
      (c) => !currentSubjects.has(c.subject),
    ),
  };
}

function text(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_[\]]/g, "\\$&");
}

export function parseForkReleaseSummary(
  value: unknown,
  previousRelease: string | null,
  upstreamBase: string,
): readonly string[] {
  if (typeof value !== "object" || value === null)
    throw new Error("Missing reviewed release summary");
  if (
    !("previousRelease" in value) ||
    value.previousRelease !== previousRelease ||
    !("upstreamBase" in value) ||
    value.upstreamBase !== upstreamBase
  )
    throw new Error("Reviewed release summary baseline is stale; review this release's changes");
  if (
    !("highlights" in value) ||
    !Array.isArray(value.highlights) ||
    value.highlights.length === 0 ||
    value.highlights.length > 8 ||
    value.highlights.some(
      (entry) => typeof entry !== "string" || !entry.trim() || /[\r\n]/.test(entry),
    )
  )
    throw new Error("Reviewed release summary needs 1–8 non-empty, single-line highlights");
  return value.highlights.map((entry: string) => entry.trim());
}

function item(commit: Commit, repository: string): string {
  return `${text(commit.subject.replace(/\s+\(#\d+\)$/, ""))} ([${commit.sha.slice(0, 10)}](https://github.com/${repository}/commit/${commit.sha}))`;
}

export function formatForkReleaseNotes(
  changes: Changes,
  input: {
    readonly version: string;
    readonly repository: string;
    readonly upstreamRepository: string;
    readonly previousRef: string | null;
    readonly ref: string;
    readonly summary: readonly string[];
  },
): string {
  const { version, repository, upstreamRepository, previousRef, ref } = input;
  const additions = changes.fork.filter((c) => !c.updated);
  const updates = changes.fork.filter((c) => c.updated);
  const lines = [
    `v${text(version)} · ${changes.upstream.length} upstream commits, ${additions.length} new fork commits, ${updates.length} updated fork patches, ${changes.removedFork.length} removed fork patches.`,
    "",
    ...input.summary.map((highlight) => `- ${highlight}`),
    "",
    "<details>",
    "<summary>Full changelog</summary>",
    "",
    previousRef
      ? `Changes since [${text(previousRef)}](https://github.com/${repository}/releases/tag/${encodeURIComponent(previousRef)}).`
      : "Initial fork release: records the current fork patches, not all upstream history.",
    "",
  ];
  for (const [title, entries, repo] of [
    ["Fork additions", additions, repository],
    ["Updated fork patches", updates, repository],
    ["Removed fork patches", changes.removedFork, repository],
    ["Upstream changes", changes.upstream, upstreamRepository],
  ] as const) {
    if (entries.length === 0) continue;
    lines.push(`### ${title}`, "", ...entries.slice(0, 150).map((c) => `- ${item(c, repo)}`), "");
    if (entries.length > 150)
      lines.push(`${entries.length - 150} additional commits; see the comparison below.`, "");
  }
  if (changes.previousUpstreamBase !== null && changes.upstream.length > 0) {
    lines.push(
      `Full upstream comparison: https://github.com/${upstreamRepository}/compare/${changes.previousUpstreamBase}...${changes.upstreamBase}`,
      "",
    );
  }
  lines.push(
    "</details>",
    "",
    `Build: [${ref.slice(0, 10)}](https://github.com/${repository}/commit/${ref}). Upstream base: [${changes.upstreamBase.slice(0, 10)}](https://github.com/${upstreamRepository}/commit/${changes.upstreamBase}).`,
    "",
    "Windows ARM64 and Linux x64/ARM64 desktop builds; Linux x64/ARM64 server archives include collectors and checksums. WSL runtime is not bundled. Android preview delivery is separate; these notes do not assert phone installation or fleet activation.",
    "",
  );
  return lines.join("\n");
}

function previousNightly(repository: string, version: string): string | null {
  const pages: unknown = JSON.parse(
    NodeChildProcess.execFileSync(
      "gh",
      ["api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    ),
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw new Error("Invalid release list");
  const releases = pages
    .flat()
    .filter(
      (entry): entry is { tag_name: string; draft: false; published_at: string } =>
        typeof entry === "object" &&
        entry !== null &&
        entry.draft === false &&
        typeof entry.tag_name === "string" &&
        /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(entry.tag_name) &&
        entry.tag_name !== `v${version}` &&
        typeof entry.published_at === "string",
    );
  return (
    releases.toSorted((a, b) => b.published_at.localeCompare(a.published_at))[0]?.tag_name ?? null
  );
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      repository: { type: "string" },
      "upstream-repository": { type: "string", default: "pingdotgg/t3code" },
      ref: { type: "string", default: "HEAD" },
      "upstream-ref": { type: "string", default: "refs/remotes/upstream/main" },
      "previous-ref": { type: "string" },
      version: { type: "string" },
      output: { type: "string" },
      summary: { type: "string", default: "scripts/fork-release-summary.json" },
    },
  });
  if (!values.repository || !values.version || !values.output)
    throw new Error("Required: --repository --version --output");
  for (const repository of [values.repository, values["upstream-repository"]]) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid release repository");
  }
  const previousRef = values["previous-ref"] ?? previousNightly(values.repository, values.version);
  const ref = git(process.cwd(), ["rev-parse", "--verify", `${values.ref}^{commit}`]);
  const changes = collectForkReleaseChanges({
    cwd: process.cwd(),
    ref,
    previousRef,
    upstreamRef: values["upstream-ref"],
  });
  const summary = parseForkReleaseSummary(
    JSON.parse(NodeFS.readFileSync(values.summary, "utf8")),
    previousRef,
    changes.upstreamBase,
  );
  NodeFS.writeFileSync(
    values.output,
    formatForkReleaseNotes(changes, {
      version: values.version,
      repository: values.repository,
      upstreamRepository: values["upstream-repository"],
      previousRef,
      ref,
      summary,
    }),
  );
  console.log(
    `Release notes: ${changes.upstream.length} upstream, ${changes.fork.length} fork changes; baseline ${previousRef ?? "initial"}`,
  );
}
