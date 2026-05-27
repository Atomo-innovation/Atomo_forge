-- Case-insensitive unique email for atomo_registered_devices (when email is non-NULL).
-- Multiple rows with NULL email remain allowed.
-- Skipped when duplicate emails already exist (003 drops this index for multi-device-per-email anyway).
--
-- If you need strict unique email and this is skipped, dedupe first:
--   SELECT LOWER(email) AS e, COUNT(*) FROM atomo_registered_devices WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY LOWER(email) HAVING COUNT(*) > 1;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'atomo_registered_devices'
    AND index_name = 'uq_atomo_reg_devices_email_lower'
);
SET @dup_emails := (
  SELECT COUNT(*) FROM (
    SELECT LOWER(TRIM(email)) AS e
    FROM atomo_registered_devices
    WHERE email IS NOT NULL AND TRIM(email) <> ''
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  ) AS d
);
SET @create_stmt := IF(
  @idx_exists = 0 AND @dup_emails = 0,
  'CREATE UNIQUE INDEX uq_atomo_reg_devices_email_lower ON atomo_registered_devices ((LOWER(email)))',
  'SELECT 1'
);
PREPARE stmt FROM @create_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
