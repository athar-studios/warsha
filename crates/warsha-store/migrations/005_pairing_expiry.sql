-- 005: pairing expiry (security audit H1).
--
-- A pairing secret must stop authenticating when the pairing offer it was minted
-- from expires. The column holds the offer's deadline in Unix seconds; NULL means
-- a record the legacy `pairing.create` RPC wrote without one (revocation-only).
--
-- Applied by the settings schema (`SqliteStore::migrate` in persistence.rs),
-- which owns `pairing_devices`, once, and only while the column is missing: the
-- async `Store`'s sqlx migrator skips version 5 because it does not create this
-- table. 004 stays reserved for K6.

ALTER TABLE pairing_devices ADD COLUMN expires_at INTEGER;

-- Grandfather rows written before this migration with a 10-minute grace window:
-- an owner upgrading a daemon can still use a phone that was paired under the old
-- code, and the secret can never outlive that window. The `WHERE` makes the
-- statement idempotent if the file is ever applied again.
UPDATE pairing_devices
   SET expires_at = CAST(strftime('%s', 'now') AS INTEGER) + 600
 WHERE expires_at IS NULL;
