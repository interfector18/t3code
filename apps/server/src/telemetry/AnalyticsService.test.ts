import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Analytics from "./AnalyticsService.ts";

it.effect(
  "cannot collect or send events, owners, or feedback even with telemetry explicitly enabled",
  () =>
    Effect.gen(function* () {
      const service = yield* Analytics.AnalyticsService;
      assert.isFalse(yield* service.record("provider.turn.completed", { model: "private-model" }));
      assert.isFalse(
        yield* service.record("agent.feedback", { conversation: "private" }, { anonymous: true }),
      );
      yield* service.recordOwners([{ source: "connect", ownerId: "account" }], "server");
      yield* service.flush;
    }).pipe(
      // Deliberately no HTTP, filesystem, secrets, randomness, policy, or server config services.
      Effect.provide(
        Layer.mergeAll(
          Analytics.layer,
          ConfigProvider.layer(
            ConfigProvider.fromEnvRecord({
              T3CODE_TELEMETRY_ENABLED: "true",
              T3CODE_POSTHOG_HOST: "https://must-not-be-contacted.example",
              T3CODE_TELEMETRY_HOST: "https://must-not-be-contacted.example",
              T3CODE_TELEMETRY_KEY: "must-not-be-used",
            }),
          ),
        ),
      ),
    ),
);
