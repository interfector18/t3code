#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Host installation files, never live T3 data.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import { renderBootServiceLauncher, renderHeadlessLauncher } from "./install-headless-launcher.ts";

const runtimePython = `#!/usr/bin/env python3
"""Extract the managed AppImage once; desktop and server share this persistent selection."""
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path.home() / '.local/opt/t3code/managed'
image = root / 'T3-Code.AppImage'
cache = root / 'runtime'
cache.mkdir(parents=True, exist_ok=True)
with (cache / '.extract.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    digest = hashlib.file_digest(image.open('rb'), 'sha256').hexdigest()
    destination = cache / digest
    if not (destination / 'squashfs-root/t3code').is_file():
        temporary = Path(tempfile.mkdtemp(prefix='.extract-', dir=cache))
        try:
            subprocess.run([str(image), '--appimage-extract'], cwd=temporary,
                           stdout=subprocess.DEVNULL, check=True)
            if not (temporary / 'squashfs-root/t3code').is_file():
                raise RuntimeError('AppImage extraction did not produce Electron')
            os.rename(temporary, destination)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    print(destination / 'squashfs-root')
`;

const desktopLauncher = `#!/bin/sh
set -eu
managed="$HOME/.local/opt/t3code/managed"
unset ELECTRON_RUN_AS_NODE
export T3CODE_HOME="$HOME/.t3"
systemctl --user start t3code.service
if test -f "$managed/local-session.json"; then
    helper="$(python3 "$managed/helper-runtime.py")"
    "$helper/t3code"
fi
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$managed/T3-Code.AppImage" "$@"
`;

const refreshRuntime = `#!/bin/sh
set -eu
managed="$HOME/.local/opt/t3code/managed"
if test -f "$managed/server-mode" && test "$(cat "$managed/server-mode")" = boot-service; then
    exit 0
fi
# The updater unlinks before renaming; its next file event retries an absent image.
test -f "$managed/T3-Code.AppImage"
python3 "$managed/runtime.py" >/dev/null
systemctl --user try-restart t3code.service
`;

function filesFor(home: string, bootService: boolean) {
  const managed = `${home}/.local/opt/t3code/managed`;
  const service = `[Unit]
Description=T3 Code headless server
After=network.target

[Service]
Type=simple
WorkingDirectory=${home}
Environment=PATH=${home}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${home}/.local/bin/t3 start --no-browser --host 0.0.0.0 --port 3773 --base-dir ${home}/.t3
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`;
  return [
    {
      path: ".local/bin/t3",
      content: bootService ? renderBootServiceLauncher() : renderHeadlessLauncher("shared"),
      mode: 0o755,
    },
    { path: ".local/bin/t3code", content: desktopLauncher, mode: 0o755 },
    { path: ".local/opt/t3code/managed/runtime.py", content: runtimePython, mode: 0o755 },
    { path: ".local/opt/t3code/managed/refresh-runtime", content: refreshRuntime, mode: 0o755 },
    { path: ".config/systemd/user/t3code.service", content: service, mode: 0o644 },
    {
      path: ".config/systemd/user/t3code-runtime.path",
      content: `[Unit]
Description=Refresh the T3 server when its shared AppImage updates

[Path]
PathChanged=${managed}/T3-Code.AppImage
Unit=t3code-runtime-refresh.service

[Install]
WantedBy=default.target
`,
      mode: 0o644,
    },
    {
      path: ".config/systemd/user/t3code-runtime-refresh.service",
      content: `[Unit]
Description=Load the updated T3 runtime and restart its active server

[Service]
Type=oneshot
ExecStart=${managed}/refresh-runtime
`,
      mode: 0o644,
    },
    {
      path: ".local/share/applications/t3code-local.desktop",
      content: `[Desktop Entry]
Type=Application
Name=T3 Code (Fork Nightly)
Comment=T3 Code using the local background server
Exec=${home}/.local/bin/t3code %U
Icon=${home}/.local/share/icons/hicolor/1024x1024/apps/t3code-local.png
Terminal=false
Categories=Development;Utility;
StartupWMClass=t3code
MimeType=x-scheme-handler/t3code;
`,
      mode: 0o644,
    },
    {
      path: ".local/share/applications/com.t3tools.T3Code.desktop",
      content: `[Desktop Entry]
Type=Application
Name=T3 Code (Nightly)
Exec="${managed}/T3-Code.AppImage" %U
Icon=${home}/.local/share/icons/com.t3tools.T3Code.desktop.png
Terminal=false
NoDisplay=true
StartupNotify=false
MimeType=x-scheme-handler/t3code;
`,
      mode: 0o644,
    },
  ].filter(
    (file) =>
      !bootService ||
      ![
        ".config/systemd/user/t3code.service",
        ".config/systemd/user/t3code-runtime.path",
        ".config/systemd/user/t3code-runtime-refresh.service",
      ].includes(file.path),
  );
}

/** Explicit host migration: back up replaced files/links; never select an image or start a service. */
export async function installManagedLinuxFiles(home: string, check = false) {
  if (!NodePath.isAbsolute(home) || /[\s"\\%]/u.test(home) || home === "/") {
    throw new Error(
      "Managed systemd templates require an absolute home path without spaces or escapes",
    );
  }
  const changes = [];
  const serverMode = await NodeFSP.readFile(
    NodePath.join(home, ".local/opt/t3code/managed/server-mode"),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "shared";
    throw error;
  });
  if (!["shared", "boot-service"].includes(serverMode.trim()))
    throw new Error("Unrecognized managed server mode");
  for (const file of filesFor(home, serverMode.trim() === "boot-service")) {
    const destination = NodePath.join(home, file.path);
    const stat = await NodeFSP.lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (stat && !stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(`Not a regular file or symlink: ${destination}`);
    }
    if (
      stat?.isFile() &&
      (await NodeFSP.readFile(destination, "utf8")) === file.content &&
      (stat.mode & 0o777) === file.mode
    )
      continue;
    changes.push({ ...file, destination, existed: stat !== null });
  }
  if (check) {
    if (changes.length)
      throw new Error(`Managed installation differs: ${changes.map((f) => f.path).join(", ")}`);
    return { changed: false, backupDirectory: null };
  }
  if (!changes.length) return { changed: false, backupDirectory: null };
  const managed = NodePath.join(home, ".local/opt/t3code/managed");
  await NodeFSP.mkdir(managed, { recursive: true });
  const backupDirectory = await NodeFSP.mkdtemp(`${managed}/installation-backup-`);
  await NodeFSP.chmod(backupDirectory, 0o700);
  for (const file of changes) {
    if (file.existed) {
      const backup = NodePath.join(backupDirectory, file.path);
      await NodeFSP.mkdir(NodePath.dirname(backup), { recursive: true });
      await NodeFSP.cp(file.destination, backup, { dereference: false, verbatimSymlinks: true });
    }
  }
  await NodeFSP.writeFile(
    NodePath.join(backupDirectory, "changed-files.json"),
    JSON.stringify(changes.map(({ path, existed }) => ({ path, existed }))),
    { mode: 0o600 },
  );
  for (const file of changes) {
    await NodeFSP.mkdir(NodePath.dirname(file.destination), { recursive: true });
    const temporary = `${file.destination}.next-${process.pid}`;
    try {
      await NodeFSP.writeFile(temporary, file.content, { flag: "wx", mode: file.mode });
      await NodeFSP.rename(temporary, file.destination);
    } finally {
      await NodeFSP.rm(temporary, { force: true });
    }
  }
  return { changed: true, backupDirectory };
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--check"))
    throw new Error("Usage: node install-managed-linux.ts [--check]");
  console.log(
    JSON.stringify(await installManagedLinuxFiles(NodeOS.homedir(), args.includes("--check"))),
  );
}
