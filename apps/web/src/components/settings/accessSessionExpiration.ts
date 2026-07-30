export function formatSessionExpiration(
  expiresAt: string | null,
  formatAbsolute: (value: string) => string,
): string {
  return expiresAt === null ? "Never" : formatAbsolute(expiresAt);
}
