#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Host-side native build and artifact timestamps, outside an Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";

import {
  ANDROID_PREVIEW_PACKAGE,
  ANDROID_PREVIEW_SIGNER,
  apkSigningCertificate,
  nextAndroidPreviewCode,
  verifyAndroidPreview,
} from "./lib/android-preview.ts";

const repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const mobile = NodePath.join(repo, "apps/mobile");
const home = NodeOS.homedir();
const state = NodePath.join(home, ".local/state/t3code/android-preview");
const key = NodePath.join(home, ".local/share/t3code/android-preview-signing/preview.keystore");
const nativeKey = NodePath.join(mobile, "android/app/debug.keystore");
const apk = NodePath.join(mobile, "android/app/build/outputs/apk/release/app-release.apk");
const defaultOutput = NodePath.join(home, "Synced/Android-T3");

async function capture(command: string, args: string[], cwd = repo, env = process.env) {
  return new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(`${NodePath.basename(command)} failed (${code}): ${stderr.slice(-2000)}`),
          ),
    );
  });
}

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${NodePath.basename(command)} failed (${code})`)),
    );
  });
}

async function exists(path: string) {
  return NodeFSP.stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function keyCertificate(file: string, keytool: string) {
  const output = await capture(
    keytool,
    ["-list", "-v", "-keystore", file, "-storepass", "android", "-alias", "androiddebugkey"],
    repo,
    { ...process.env, LC_ALL: "C" },
  );
  const fingerprint = /SHA256:\s*([0-9A-F:]+)/iu
    .exec(output)?.[1]
    ?.replaceAll(":", "")
    .toLowerCase();
  if (fingerprint !== ANDROID_PREVIEW_SIGNER)
    throw new Error("Preview keystore does not match the existing phone signing identity");
}

export async function publishAndroidPreview(
  apk: string,
  output: string,
  manifest: { readonly file: string },
) {
  await NodeFSP.mkdir(output, { recursive: true });
  // The friendly delivery path may link to a synced folder on another filesystem.
  const destination = await NodeFSP.realpath(output);
  const temporary = await NodeFSP.mkdtemp(
    NodePath.join(NodePath.dirname(destination), ".t3-android-publish-"),
  );
  try {
    await NodeFSP.copyFile(apk, NodePath.join(temporary, manifest.file));
    await NodeFSP.writeFile(
      NodePath.join(temporary, "latest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await NodeFSP.rename(
      NodePath.join(temporary, manifest.file),
      NodePath.join(destination, manifest.file),
    );
    await NodeFSP.rename(
      NodePath.join(temporary, "latest.json"),
      NodePath.join(destination, "latest.json"),
    );
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
}

async function main(args: string[]) {
  let output = defaultOutput,
    check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--check") check = true;
    else if (arg === "--output-dir" && args[index + 1] && !args[index + 1]!.startsWith("--"))
      output = NodePath.resolve(args[++index]!);
    else if (arg === "--help") {
      console.log(
        "Usage: node scripts/build-android-preview.ts [--check] [--output-dir PATH]\nBuilds and verifies the ARM64 preview, then atomically publishes T3-Code-Preview.apk and latest.json.\nDoes not install on a device, publish online, or configure Syncthing. --check performs read-only preflight.",
      );
      return;
    } else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (output === "/" || output === home || output === repo)
    throw new Error("Choose a dedicated APK delivery directory");
  const java = process.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk";
  const sdk =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? NodePath.join(home, "Android/Sdk");
  const versions = (await NodeFSP.readdir(NodePath.join(sdk, "build-tools")))
    .filter((v) => /^\d+\.\d+\.\d+$/u.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions[0]) throw new Error("Android SDK build-tools are missing");
  const tools = NodePath.join(sdk, "build-tools", versions[0]);
  const keytool = NodePath.join(java, "bin/keytool");
  for (const path of [
    keytool,
    NodePath.join(java, "bin/java"),
    NodePath.join(tools, "aapt"),
    NodePath.join(tools, "apksigner"),
    NodePath.join(mobile, "node_modules/.bin/expo"),
  ]) {
    await NodeFSP.access(path, NodeFS.constants.X_OK);
  }
  const sourceKey = (await exists(key)) ? key : nativeKey;
  if (!(await exists(sourceKey)))
    throw new Error(
      "Existing preview keystore is missing; restore it rather than generating a new signing identity",
    );
  await keyCertificate(sourceKey, keytool);
  const counterFile = NodePath.join(state, "counter.json");
  const previous: unknown = (await exists(counterFile))
    ? JSON.parse(await NodeFSP.readFile(counterFile, "utf8"))
    : 1;
  if (typeof previous !== "number") throw new Error("Invalid saved Android build counter");
  const versionCode = nextAndroidPreviewCode(previous, Date.now());
  const versionName = `2.0.0-preview.${versionCode}`;
  console.log(
    `Preview ${versionName} (${versionCode}) → ${output}\nSigning identity verified; upstream Expo OTA will be disabled for this fork build.`,
  );
  if (check) {
    console.log("Preflight passed. No files changed.");
    return;
  }

  await NodeFSP.mkdir(state, { recursive: true, mode: 0o700 });
  const lock = NodePath.join(state, "build.lock");
  await NodeFSP.mkdir(lock).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST")
      throw new Error(`Another build holds ${lock}; inspect it before removing a stale lock`);
    throw error;
  });
  try {
    await NodeFSP.writeFile(NodePath.join(lock, "pid"), String(process.pid), { mode: 0o600 });
    await NodeFSP.mkdir(NodePath.dirname(key), { recursive: true, mode: 0o700 });
    if (!(await exists(key)))
      await NodeFSP.copyFile(sourceKey, key, NodeFS.constants.COPYFILE_EXCL);
    await NodeFSP.chmod(key, 0o600);
    const latestCounter: unknown = (await exists(counterFile))
      ? JSON.parse(await NodeFSP.readFile(counterFile, "utf8"))
      : 1;
    if (typeof latestCounter !== "number" || latestCounter >= versionCode)
      throw new Error("Build counter changed; retry the build");
    await NodeFSP.writeFile(counterFile, JSON.stringify(versionCode), { mode: 0o600 });
    const commit = (await capture("git", ["rev-parse", "HEAD"])).trim();
    const dirty = (await capture("git", ["status", "--porcelain"])).trim().length > 0;
    const env = {
      ...process.env,
      APP_VARIANT: "preview",
      CI: "1",
      EXPO_NO_GIT_STATUS: "1",
      T3CODE_MOBILE_VERSION: versionName,
      T3CODE_ANDROID_VERSION_CODE: String(versionCode),
      T3CODE_MOBILE_UPDATES_ENABLED: "0",
      JAVA_HOME: java,
      ANDROID_HOME: sdk,
      PATH: `${NodePath.join(repo, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
    };
    await run(
      NodePath.join(mobile, "node_modules/.bin/expo"),
      ["prebuild", "--platform", "android", "--no-install"],
      mobile,
      env,
    );
    await NodeFSP.copyFile(key, nativeKey);
    await NodeFSP.chmod(nativeKey, 0o600);
    await run(
      "./gradlew",
      ["assembleRelease", "-PreactNativeArchitectures=arm64-v8a", "--max-workers=2", "--no-daemon"],
      NodePath.join(mobile, "android"),
      env,
    );
    const certificate = apkSigningCertificate(
      await capture(NodePath.join(tools, "apksigner"), ["verify", "--print-certs", apk]),
    );
    verifyAndroidPreview({
      badging: await capture(NodePath.join(tools, "aapt"), ["dump", "badging", apk]),
      certificate,
      versionCode,
      versionName,
    });
    const xml = await capture(NodePath.join(tools, "aapt"), [
      "dump",
      "xmltree",
      apk,
      "AndroidManifest.xml",
    ]);
    if (
      !/android:name[^\n]*="expo\.modules\.updates\.ENABLED"[^\n]*\n\s*A: android:value[^\n]*=\(type 0x12\)0x0\b/u.test(
        xml,
      )
    )
      throw new Error("Upstream Expo OTA was not disabled in the built APK");
    const hash = NodeCrypto.createHash("sha256");
    for await (const chunk of NodeFS.createReadStream(apk)) hash.update(chunk);
    const manifest = {
      file: "T3-Code-Preview.apk",
      package: ANDROID_PREVIEW_PACKAGE,
      versionCode,
      versionName,
      commit,
      dirty,
      sha256: hash.digest("hex"),
      signerSha256: certificate,
      bytes: (await NodeFSP.stat(apk)).size,
      builtAt: new Date().toISOString(),
      expoOtaEnabled: false,
    };
    await publishAndroidPreview(apk, output, manifest);
    console.log(
      `Verified preview ready: ${NodePath.join(output, manifest.file)}\nSHA-256: ${manifest.sha256}\nSyncthing can transfer it; approve the update on the phone. No app data was cleared.`,
    );
  } finally {
    await NodeFSP.rm(lock, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Android preview build failed");
    process.exitCode = 1;
  });
}
