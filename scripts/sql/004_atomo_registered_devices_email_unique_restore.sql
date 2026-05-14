-- Restore case-insensitive UNIQUE(email): each non-null email appears at most once table-wide.
-- 003 dropped this index so multi-device could share one email; 004 brings uniqueness back for installs that need it.
--
-- If EXECUTE fails with duplicate entry, fix data first, e.g.:
--   SELECT LOWER(TRIM(email)) AS e, COUNT(*), GROUP_CONCAT(serial_number)
--   FROM atomo_registered_devices WHERE email IS NOT NULL AND TRIM(email) <> ''
--   GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'atomo_registered_devices'
    AND index_name = 'uq_atomo_reg_devices_email_lower'
);
SET @create_stmt := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX uq_atomo_reg_devices_email_lower ON atomo_registered_devices ((LOWER(email)))',
  'SELECT 1'
);
PREPARE stmt FROM @create_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
