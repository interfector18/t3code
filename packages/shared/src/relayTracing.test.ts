import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import { layer, withLocalTracing, withRelayClientTracing } from "./relayTracing.ts";

it.effect(
  "keeps relay and local spans on the caller's tracer even with a vendor endpoint configured",
  () =>
    Effect.gen(function* () {
      const spans: string[] = [];
      const tracer = Tracer.make({
        span(options) {
          spans.push(options.name);
          return new Tracer.NativeSpan(options);
        },
      });
      yield* Effect.void.pipe(
        Effect.withSpan("relay.operation"),
        withRelayClientTracing,
        Effect.withTracer(tracer),
      );
      yield* Effect.void.pipe(
        Effect.withSpan("local.operation"),
        withLocalTracing,
        Effect.withTracer(tracer),
      );
      assert.deepStrictEqual(spans, ["relay.operation", "local.operation"]);
    }).pipe(
      Effect.provide(
        layer(
          {
            tracesUrl: "https://must-not-be-contacted.example",
            tracesDataset: "relay",
            tracesToken: "token",
          },
          { serviceName: "test", runtime: "node", serviceInstanceId: "private", client: "test" },
          { isEnabled: () => true },
        ),
      ),
    ),
);
