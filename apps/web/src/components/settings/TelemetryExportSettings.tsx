import { T, useGT } from "gt-react";
import { SettingsSection } from "./settingsLayout";

export function TelemetryExportSettings() {
  const gt = useGT();
  return (
    <SettingsSection title={gt("OpenTelemetry export")} id="telemetry-export">
      <p className="text-sm text-muted-foreground">
        <T>Outbound telemetry is unavailable in this fork. Diagnostics stay on your machines.</T>
      </p>
    </SettingsSection>
  );
}
