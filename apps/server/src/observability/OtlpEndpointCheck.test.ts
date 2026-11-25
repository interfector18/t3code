import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EndpointCheck from "./OtlpEndpointCheck.ts";

it.effect("refuses outbound probes from old clients without acquiring an HTTP client", () =>
  Effect.gen(function* () {
    const checker = yield* EndpointCheck.OtlpEndpointCheck;
    for (const signal of ["traces", "metrics", "logs"] as const) {
      assert.deepStrictEqual(
        yield* checker.check({ signal, url: "https://must-not-be-contacted.example" }),
        {
          _tag: "Unreachable",
          timedOut: false,
        },
      );
    }
  }).pipe(Effect.provide(EndpointCheck.layer)),
);
