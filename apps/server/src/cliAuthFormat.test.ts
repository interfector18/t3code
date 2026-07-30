import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import { formatSessionList } from "./cliAuthFormat.ts";

it("formats non-expiring sessions as Never", () => {
  const listedOutput = formatSessionList(
    [
      {
        sessionId: "session-never" as never,
        method: "bearer-access-token",
        scopes: ["orchestration:read"],
        subject: "persistent-phone",
        client: { label: "Phone", deviceType: "mobile" },
        connected: false,
        current: false,
        issuedAt: DateTime.makeUnsafe("2026-04-08T09:00:00.000Z"),
        expiresAt: null,
        lastConnectedAt: null,
      },
    ],
    { json: false },
  );

  expect(listedOutput).toContain("expires: Never");
});
