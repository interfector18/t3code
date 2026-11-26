// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Launches a packaged desktop app against a seeded T3 home, opens a thread, and checks its
// messages render. Release jobs run it so a build whose backend or bundle cannot start fails
// before it is published.
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeUtil from "node:util";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import { chromium, type Browser } from "playwright-core";

// A snapshot from an older build on purpose: the packaged server must migrate it forward, as it
// does for every upgrading user. It holds one project and two threads, nothing else.
const FIXTURE_DB = NodePath.join(import.meta.dirname, "fixtures/desktop-launch/statev2.sqlite");
const THREAD_TITLE = "Release launch check";
const THREAD_MESSAGE = "The release opens and shows this thread.";
const STEP_TIMEOUT_MS = 60_000;
const platform = Effect.runSync(Effect.service(HostProcess.Platform));

function waitForCdpEndpoint(child: NodeChildProcess.ChildProcess): Promise<string> {
  const stderr = child.stderr;
  if (!stderr) return Promise.reject(new Error("Desktop stderr was not piped."));
  return new Promise((resolve, reject) => {
    let pending = "";
    const timeout = new AbortController();
    const finish = (error: Error | undefined, endpoint?: string) => {
      timeout.abort();
      stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(endpoint!);
    };
    const onData = (chunk: Buffer) => {
      pending += chunk.toString();
      const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(pending)?.[1];
      if (endpoint) finish(undefined, endpoint);
      else pending = pending.slice(-1024);
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish(new Error("Desktop exited before its renderer debugger started."));
    void NodeTimersPromises.setTimeout(STEP_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(
      () => finish(new Error("Desktop renderer debugger did not start within 60 seconds.")),
      () => {},
    );
    stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

const { values } = NodeUtil.parseArgs({
  options: {
    executable: { type: "string" },
    // An unpackaged app directory for a plain Electron executable, as PR CI runs it.
    app: { type: "string" },
    "artifacts-dir": { type: "string" },
  },
});
const executable = values.executable;
if (!executable)
  throw new Error(
    "Usage: smoke-desktop-app.ts --executable <app> [--app <dir>] [--artifacts-dir <dir>]",
  );
const artifactsDir = NodePath.resolve(values["artifacts-dir"] ?? "desktop-launch-check");

const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-launch-"));
const t3Home = NodePath.join(home, "t3");
NodeFS.mkdirSync(NodePath.join(t3Home, "userdata"), { recursive: true });
NodeFS.copyFileSync(FIXTURE_DB, NodePath.join(t3Home, "userdata/statev2.sqlite"));

let step = "launching the app";
let child: NodeChildProcess.ChildProcess | undefined;
let browser: Browser | undefined;
let output = "";
NodeFS.mkdirSync(artifactsDir, { recursive: true });
try {
  // Packaged builds disable the Node inspector; renderer CDP does not need that fuse.
  const spawned = NodeChildProcess.spawn(
    executable,
    [
      ...(values.app ? [NodePath.resolve(values.app)] : []),
      "--no-sandbox",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // HOME stays real: on macOS a fake HOME has no login keychain, and safeStorage blocks the
      // main process on a keychain dialog. macOS keeps its Electron profile in the runner's HOME.
      env: {
        ...process.env,
        ...(platform === "linux" ? { HOME: home } : {}),
        XDG_CONFIG_HOME: NodePath.join(home, ".config"),
        XDG_DATA_HOME: NodePath.join(home, ".local/share"),
        T3CODE_HOME: t3Home,
        T3CODE_TELEMETRY_ENABLED: "false",
        T3CODE_DISABLE_AUTO_UPDATE: "true",
      },
    },
  );
  child = spawned;
  const capture = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-128 * 1024);
  };
  spawned.stdout.on("data", capture);
  spawned.stderr.on("data", capture);
  const endpoint = await waitForCdpEndpoint(spawned);
  browser = await chromium.connectOverCDP(endpoint, { timeout: STEP_TIMEOUT_MS });
  // A backend that never starts leaves no window, or only the "could not start" window, so the
  // thread wait below fails either way and its screenshot shows the startup error.
  step = "waiting for the first window";
  const context = browser.contexts()[0];
  if (!context) throw new Error("Desktop renderer context was not created.");
  const page =
    context.pages()[0] ?? (await context.waitForEvent("page", { timeout: STEP_TIMEOUT_MS }));
  try {
    step = `finding "${THREAD_TITLE}" in the sidebar`;
    const thread = page.locator("li[data-thread-item]", { hasText: THREAD_TITLE });
    await thread.waitFor({ timeout: STEP_TIMEOUT_MS });
    step = "opening the thread";
    await thread.click();
    await page.getByText(THREAD_MESSAGE).waitFor({ timeout: STEP_TIMEOUT_MS });
  } catch (error) {
    NodeFS.mkdirSync(artifactsDir, { recursive: true });
    await page
      .screenshot({ path: NodePath.join(artifactsDir, "window.png"), timeout: 10_000 })
      .catch(() => {});
    throw error;
  }
  console.log("Desktop launch check passed: the app opened and showed the seeded thread.");
} catch (error) {
  console.error(`Desktop launch check failed while ${step}.`);
  NodeFS.mkdirSync(artifactsDir, { recursive: true });
  console.error(error instanceof Error ? error.message : error);
  const logs = NodePath.join(t3Home, "userdata/logs");
  if (NodeFS.existsSync(logs)) {
    NodeFS.cpSync(logs, NodePath.join(artifactsDir, "logs"), { recursive: true });
    const serverLog = NodePath.join(logs, "server-child.log");
    if (NodeFS.existsSync(serverLog)) {
      console.error("\nLast backend output (server-child.log):");
      console.error(NodeFS.readFileSync(serverLog, "utf8").split("\n").slice(-20).join("\n"));
    }
  }
  process.exitCode = 1;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const launched = child;
    const exited = new Promise<void>((resolve) => launched.once("exit", () => resolve()));
    const closed = (async () => {
      if (browser) {
        const session = await browser.newBrowserCDPSession().catch(() => undefined);
        await session?.send("Browser.close").catch(() => {});
      }
      launched.kill("SIGTERM");
      await exited;
    })().catch(() => {});
    const timeout = new AbortController();
    try {
      await Promise.race([
        exited,
        closed,
        NodeTimersPromises.setTimeout(10_000, undefined, { signal: timeout.signal }),
      ]);
    } finally {
      timeout.abort();
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
  await browser?.close().catch(() => {});
  NodeFS.writeFileSync(NodePath.join(artifactsDir, "process.log"), output);
  NodeFS.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
