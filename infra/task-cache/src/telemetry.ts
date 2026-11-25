// Kept for already-installed task hooks: neither new nor queued reports leave this fork.
export function observeSummaries(
  _root: string,
  _endpoint: string,
  _env: NodeJS.ProcessEnv,
  _home?: string,
) {
  return () => {};
}

export async function flushTelemetry(_home?: string, _env?: NodeJS.ProcessEnv): Promise<void> {}
