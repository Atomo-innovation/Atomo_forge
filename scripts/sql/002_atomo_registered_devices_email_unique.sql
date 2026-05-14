-- Case-insensitive unique email for atomo_registered_devices (when email is non-NULL).
-- Multiple rows with NULL email remain allowed. Requires MySQL 8.0.13+ for IF NOT EXISTS on CREATE INDEX.
-- NOTE: 003_atomo_registered_devices_drop_email_unique.sql removes this index so one email may register multiple devices (different serials).
--
-- If this fails with "Duplicate entry", dedupe or fix conflicting emails first:
--   SELECT LOWER(email) AS e, COUNT(*) FROM atomo_registered_devices WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY LOWER(email) HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_atomo_reg_devices_email_lower
  ON atomo_registered_devices ((LOWER(email)));
