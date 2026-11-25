# Outbound telemetry in the personal fork

This fork does not send product analytics, owner/install identities, agent feedback, crash reports,
relay connection traces, or OTLP diagnostics to external receivers. Saved preferences, managed
policy, bootstrap configuration, and environment variables cannot enable these senders.

Keep local resource monitoring, local trace/log files, and diagnostics delivered to the user's
authenticated app connections. Provider requests, authentication, updates, caching, and explicitly
configured remote features remain functional network traffic, not product telemetry.

Upstream analytics interfaces remain as non-sending compatibility boundaries so rebases do not
require changing every instrumentation call site. Do not restore identity reads, event buffers,
background flushers, exporters, or crash-reporting native modules behind those boundaries.

Use boolean `telemetry={false}` on Clerk providers. It prevents collector construction;
`{ disabled: true }` is not equivalent for SDK log reporting. Native Clerk initialization also
sets `telemetryEnabled: false` independently on Android and iOS; the JS prop does not control it.
Build/cache summary uploads are
also removed independently of functional artifact caching.

Audit incoming changes for new senders during every release. Repository-owned guarantees do not
disable telemetry inside independently installed provider CLIs, package managers, or remote services.
