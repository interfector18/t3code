import type { ManagedPolicySummary } from "@t3tools/contracts";
import * as RelayTracing from "@t3tools/shared/relayTracing";

export const allowedFor = (
  _env: Readonly<Record<string, string | undefined>>,
  _policy: ManagedPolicySummary | undefined,
) => false;

const relayLayer = (
  resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">,
  config: RelayTracing.RelayClientTracingConfig | null = null,
) => RelayTracing.layer(config, { ...resource, serviceInstanceId: "" });

export const layerHeadlessRelayClient = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  client: "headless-cli",
});
export const layerServerRelayBroker = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  client: "environment-server",
  component: "relay-broker",
});
