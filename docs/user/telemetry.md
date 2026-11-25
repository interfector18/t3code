# Privacy and local diagnostics

This personal fork does not send product usage events, account/device analytics identifiers,
agent feedback, mobile crash reports, startup reports, or relay diagnostic traces to T3 Code,
PostHog, Axiom, or Clerk's telemetry service. OpenTelemetry export and endpoint probes are
unavailable, including exports configured previously through settings or environment variables.
The mobile crash-upload SDK is not included in new native builds.

CPU/memory diagnostics, resource history, local logs, and local traces remain available. Your
authenticated clients can still read diagnostics from the environments you connect to.

This does not make the app offline: provider requests, sign-in, software updates, configured
remote connections, artifact caching, and enabled notification/activity publishing still use the
network for their features. Those services can keep their own operational records. Separately
installed provider CLIs and build tools have their own privacy settings.

Existing saved connections, permissions, identities, and settings are preserved. Old installed
or running builds retain their previous behavior until updated and restarted. Removing senders
cannot retract data that an earlier build already sent.
