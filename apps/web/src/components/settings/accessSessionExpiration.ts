import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

export function formatSessionExpiration(
  expiresAt: string | null,
  formatAbsolute: (value: string) => string,
  resolve: MessageResolver = m,
): string {
  return expiresAt === null
    ? resolve(msg("Never", { $context: "session expiration" }))
    : formatAbsolute(expiresAt);
}
