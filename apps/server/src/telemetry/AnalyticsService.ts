import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { constant } from "effect/Function";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

// Retain the upstream service boundary, but never collect identities, buffer events, or send them.
export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
      options?: { readonly anonymous?: boolean },
    ) => Effect.Effect<boolean>;
    readonly flush: Effect.Effect<void>;
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

// Hot compatibility calls must not create replacement analytics spans.
export const layer = Layer.succeed(AnalyticsService, {
  record: constant(Effect.succeed(false)),
  flush: Effect.void,
  recordOwners: constant(Effect.void),
});
