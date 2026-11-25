export interface TelemetryOwner {
  readonly source: "connect" | "device";
  readonly ownerId: string;
}
