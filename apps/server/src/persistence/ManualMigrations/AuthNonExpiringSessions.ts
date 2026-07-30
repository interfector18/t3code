import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Manual compatibility migration for persistent, non-expiring auth sessions.
 *
 * This migration previously ran locally as migration 33 before upstream assigned
 * that tracked ID to ProjectionThreadsSettled. It is intentionally kept outside
 * the automatic migration registry so future rebases cannot create another ID
 * collision or cause Effect's numeric migration tracking to skip upstream work.
 *
 * The current local database has already applied this schema change. Apply this
 * effect manually to a fresh or replaced database when persistent sessions are
 * still required. The guards below make repeated application safe.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const pairingLinkColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_pairing_links)
  `;
  if (!pairingLinkColumns.some((column) => column.name === "session_expiration")) {
    yield* sql`
      ALTER TABLE auth_pairing_links
      ADD COLUMN session_expiration TEXT NOT NULL DEFAULT 'default'
    `;
  }

  const sessionColumns = yield* sql<{ readonly name: string; readonly notnull: number }>`
    PRAGMA table_info(auth_sessions)
  `;
  const expiresAt = sessionColumns.find((column) => column.name === "expires_at");
  if (expiresAt?.notnull === 1) {
    yield* sql`ALTER TABLE auth_sessions RENAME TO auth_sessions_legacy_034`;
    yield* sql`
      CREATE TABLE auth_sessions (
        session_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        scopes TEXT NOT NULL,
        method TEXT NOT NULL,
        client_label TEXT,
        client_ip_address TEXT,
        client_user_agent TEXT,
        client_device_type TEXT NOT NULL DEFAULT 'unknown',
        client_os TEXT,
        client_browser TEXT,
        client_surface TEXT,
        client_app_version TEXT,
        issued_at TEXT NOT NULL,
        expires_at TEXT,
        last_connected_at TEXT,
        revoked_at TEXT
      )
    `;
    yield* sql`
      INSERT INTO auth_sessions (
        session_id, subject, scopes, method, client_label, client_ip_address,
        client_user_agent, client_device_type, client_os, client_browser,
        client_surface, client_app_version,
        issued_at, expires_at, last_connected_at, revoked_at
      )
      SELECT session_id, subject, scopes, method, client_label, client_ip_address,
        client_user_agent, client_device_type, client_os, client_browser,
        client_surface, client_app_version,
        issued_at, expires_at, last_connected_at, revoked_at
      FROM auth_sessions_legacy_034
    `;
    yield* sql`DROP TABLE auth_sessions_legacy_034`;
    yield* sql`
      CREATE INDEX idx_auth_sessions_active
      ON auth_sessions(revoked_at, expires_at, issued_at)
    `;
  }
});
