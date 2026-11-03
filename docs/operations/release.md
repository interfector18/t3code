# Personal fork releases

For upstream releases, use [the release runbook](./03_release.md). This runbook covers the personal fork's fleet and Android delivery requirements.

## Fork release parties: fleet diagnostics gate

The personal fork's rollout includes **Scar**, **zenbook-a16**, **mini-elite**, and
**mjolnir** on every release party, including small rebases. CI publication or a
downloaded AppImage proves availability, not activation or working diagnostics.

The owner also has standing approval for isolated headless browser regressions
in release checks, including `check:changed`; do not ask on each release. This
does not authorize opening or changing existing app connections or sessions.

The owner has standing authorization for release-party pushes of verified rebased
`main` to the personal fork with an explicit `--force-with-lease`; do not ask again
unless that authorization is revoked or the scope changes. Server activation and
restarts remain user-driven through the existing UI, not authorized by a push.

Scar, mini-elite, and mjolnir retain the same managed Linux desktop installation. The
persistent `~/.local/opt/t3code/managed/T3-Code.AppImage` supplies both desktop and
legacy headless server until it is migrated; `runtime.py` caches desktop extraction
by content hash. Migrated servers use upstream's native boot-service launcher and
fork CLI archives, independently of the desktop AppImage. The persistent marker
`~/.local/opt/t3code/managed/server-mode` contains `boot-service`; their selected
server version lives in `~/.t3/runtime/service-state.json`. Regenerate
their service, updater watcher, and desktop/headless launchers from
[`scripts/install-managed-linux.ts`](../../scripts/install-managed-linux.ts),
deployed beside `install-headless-launcher.ts` and `cleanup-managed-linux.py` in each
host's managed directory. The installer and existing desktop/extraction launchers
remove unused application builds and installation backups, preserving
running/selected runtimes and database backups. Cleanup adds no service or timer.
The installer honors that marker, leaving the upstream-owned service unit and
disabled legacy updater watcher alone. It backs up replaced files and links but
never changes the AppImage, starts a server, or restarts a service. Run it with
`--check` after installation.

Zenbook uses the same generator with `server-mode` set to `desktop-only`; it
regenerates only desktop launchers, never a headless launcher or service. Desktop
launchers and URL-handler entries pass `APPIMAGELAUNCHER_DISABLE=1` so
AppImageLauncher does not offer to move the updater-managed AppImage.

The managed generator also retains the native service's network/no-browser
drop-in. Upstream `t3 service install` owns the main unit and leaves this drop-in
intact, so repairs must not reset the server's port, host, PATH, or private umask.
To bootstrap an existing legacy host, back up its unit/launcher configuration,
stop the legacy watcher and server after obtaining restart authorization, and
take an integrity-checked stopped-database snapshot. Run the verified fork native
CLI's `service install --base-dir ~/.t3` with the drop-in in place, write the
`boot-service` marker, then regenerate/check the managed installation. Leave the
old AppImage/runtime and migration backup available for recovery. Prove a later
release can update through the existing client RPC before migrating more hosts.
Do not use the legacy snapshot desktop installer for these managed hosts.

Do not select fleet server builds with `systemctl --user set-environment
T3CODE_SERVER_RUNTIME=...`: that setting disappears on reboot. The managed
AppImage is the legacy shared-runtime selection only. For a deferred legacy release, cache the new
image/runtime only; do not replace the watched AppImage. With activation
authorized, stop `t3code-runtime.path` and its refresh service, back up and
atomically replace the managed AppImage, regenerate/check the installation,
reload systemd, clear any legacy runtime override, re-enable the watcher, and
restart `t3code.service`. The watcher otherwise refreshes the server when the
desktop updater replaces the image. Keep `~/.t3` and existing rollback artifacts
untouched. Verify future launches select the managed image without a manager
environment override, as well as verifying the newly running process.

For migrated servers, use Settings → Environments to activate a newer fork
release through the existing authorized update RPC. CI must publish the Linux
CLI archives and `SHA256SUMS` alongside desktop assets before the release becomes
available. The managed launcher preflights candidates, supervises handoff, and
rolls back failed trials. Never re-enable `t3code-runtime.path` on these hosts:
desktop auto-updates must not restart or select the independent server. A deferred
server update remains deferred until activation is authorized.

1. Inventory all four hosts before and after deployment. Record the installed
   artifact version/hash and the versions of **running** desktop and server
   processes, their PIDs/start times, and the selected next-start runtime. Read
   desktop versions from the running executable's packaged `resources/app.asar/package.json`,
   and native server versions from the actual `/proc/<pid>/exe --version` plus
   launcher service state (not just the CLI wrapper or systemd's parent PID),
   not just the checkout, symlink, service status, or release tag. Distinguish
   auto-update availability, installed files, and active processes. Zenbook is
   ARM64 with a desktop-managed server: inspect that server, never start a second.
2. Confirm current restart authorization per environment. An earlier release's
   permission is not a new authorization, and an explicit deferral remains in
   force. Preserve active turns. Cached files without activation are **staged,
   verification pending**. Each managed AppImage affects both desktop and
   headless launches; verify each running process separately after activation.
3. Maintain the custom headless launchers on Scar, mini-elite, and mjolnir from
   [`scripts/install-headless-launcher.ts`](../../scripts/install-headless-launcher.ts).
   Deploy this source to each host's
   `~/.local/opt/t3code/managed/install-headless-launcher.ts`, run it with Node to
   regenerate `~/.local/bin/t3`, then run it with `--check`. Keep the deployed
   source for local regeneration as well as the versioned repository source.
   It backs up recognized old launchers, preserves each host's runtime selection
   behavior, and never restarts anything. Inspect an unrecognized launcher before
   changing it. Use this source for future setup/deployment generators; do not
   recreate an untracked shell template in release scripts.

   After selecting `runtime`, every generated launcher must export:

   ```sh
   export T3CODE_RESOURCE_MONITOR_PATH="$runtime/resources/resource-monitor/t3-resource-monitor"
   ```

   Verify the selected binary is a regular executable and that the variable
   survives `exec` into the server. Derive it from the selected runtime on every
   launch, never a version/hash directory. Keep `ELECTRON_RUN_AS_NODE` and existing
   arguments intact. Check the real extraction, updater handoff, and rollback
   selections, not only the new artifact; each needs its own executable collector.
   Neither `runtime.py` nor updater hooks may regenerate a collector-less launcher.
   Run the focused executable regression:
   `vp test run scripts/install-headless-launcher.test.ts scripts/install-managed-linux.test.ts`.

   Native CLI archives instead place the collector at
   `$runtime/resource-monitor/linux-<arch>/t3-resource-monitor`. Both the persistent
   CLI wrapper and `apps/server/src/serviceLauncher.ts` derive that path from the
   selected runtime and check that it is a regular executable. Each trial and
   rollback child gets its own override, replacing any stale parent value.
   Run `vp test run src/serviceLauncher.test.ts` from `apps/server` as well.

4. After an authorized activation, verify the server PID/version, its inherited
   collector path, an actual collector child, and healthy native telemetry with a
   fresh sample (`health.native.status`, `lastSampleAt`, and `lastError`). Inspect
   the current PID's journal for exact startup/protocol errors. HTTP 200 or an
   executable installed on disk alone does not pass this gate. An unchanged old
   process cannot prove the new launcher's environment reached the server.
5. Through **Zenbook's existing saved connection**, verify every environment
   supplies a current CPU/memory sample and resource history gains samples while
   Diagnostics stays open. Compare timestamps/sequences or counts across multiple
   sample intervals. Use existing authenticated SSH/API access where possible;
   ask the user for the existing-app UI check when it cannot prove that client
   path. Do not create another browser session or mint a replacement connection.
   The collector intentionally stops timed sampling without live Diagnostics
   subscribers; a closed Diagnostics view is not a history-growth test.
6. Check **Traces independently**: inspect the active build's trace configuration,
   trace-level environment, trace file presence/size/mtime, read errors, and the
   trace diagnostics result through the existing connection. Report disabled
   tracing, absent files, and read/permission errors distinctly. A missing resource
   collector does not establish why Traces is empty. Do not enable tracing as an
   unrequested workaround or claim it fixed from resource samples alone.
7. Preserve data, environment identities, saved connections, permissions, and
   device settings. Use existing grants; never blanket-upgrade permissions to
   make diagnostics pass. Do not alter live databases or create parallel servers.
8. Report every host as **passed**, **failed** (with the exact error), or
   **pending restart**. Include incomplete client/Traces checks explicitly as
   verification pending even when server-side checks passed. A deferred update
   remains **staged, verification pending** until its new server actually runs.
   Do not call the rollout fully verified while any required check is pending.

For every party, review the incoming changes and update `scripts/fork-release-summary.json`
with 1–8 short, user-facing highlights grouped by outcome rather than copied commit titles.
Explain visible changes, performance work, and relevant caveats without inventing benchmarks
or claiming installation/activation. Include mobile changes when relevant. Set `previousRelease`
to the last published nightly tag and `upstreamBase` to this release's upstream commit.
CI rejects a missing or stale summary instead of silently recycling old notes.

The script adds counts and expandable commit references from the last published nightly,
separating upstream changes from new, updated, and removed fork patches; patch-equivalent
rebased commits are not new changes. Publication needs full commit history, release tags,
and upstream's `main`; missing or divergent history fails publication.

## Fork Android preview delivery

For personal fork release parties, use this script instead of ad-hoc native
build/signing commands. Delivery to the sync folder is not proof of installation:
report the APK as ready to sync until the phone's in-place update is confirmed.

Run `./scripts/build-android-preview.sh --check` for a read-only toolchain/signing
preflight, then `./scripts/build-android-preview.sh` to build the ARM64 release preview.
The Bash entry point adds repository-local tools to PATH; no global `vp` install
or manual `node_modules/.bin` PATH setup is needed. It also works from another
working directory when invoked by its absolute path.
Java 21 and the Android SDK must be installed; `JAVA_HOME` and `ANDROID_HOME`
override the local defaults. This does not require or install onto a connected
phone, change Syncthing settings, or publish to GitHub.

The default delivery path is `~/Synced/Android-T3`, a convenience symlink to the
real directory `~/Data/Phone/Sync Folder/Apps/t3` in the existing phone sync folder.
Keep real files inside that sync folder: Syncthing syncs symlinks but does not
follow them. No separate Syncthing folder is needed. Override the output location
with `--output-dir /absolute/path` if necessary. Publication resolves symlinks
before staging files so atomic renames stay on the destination filesystem. The script
atomically replaces `T3-Code-Preview.apk` only after verifying its package,
version and existing preview signer. `latest.json` records the build identity
and checksum. Wait for synchronization to finish, open the APK on the phone,
and approve an in-place update; do not uninstall the existing app.

The signing key is backed up privately under
`~/.local/share/t3code/android-preview-signing/`, never in the synchronized
folder. Preserve it and the monotonic build counter under
`~/.local/state/t3code/android-preview/`; do not generate a replacement key or
reset the counter when rebasing. Each build reserves a new version code, so
failed builds can leave harmless gaps. A build lock prevents concurrent native
builds from mixing their outputs; inspect a leftover lock before removing it.

These personal fork builds disable the upstream Expo OTA endpoint. Compatible
fork OTA delivery can be configured separately; changing that configuration
requires installing a newly built APK first. Ordinary upstream/EAS profiles
are unchanged by these build-script-specific environment overrides.
