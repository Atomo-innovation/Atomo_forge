-- Allow the same contact email on multiple devices (different serial numbers).
-- Drops the functional unique index from 002 when present. Idempotent without requiring DROP INDEX IF EXISTS.
-- NOTE: 004_atomo_registered_devices_email_unique_restore.sql recreates this index if you need strict unique email again.

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'atomo_registered_devices'
    AND index_name = 'uq_atomo_reg_devices_email_lower'
);
SET @drop_stmt := IF(
  @idx_exists > 0,
  'ALTER TABLE atomo_registered_devices DROP INDEX uq_atomo_reg_devices_email_lower',
  'SELECT 1'
);
PREPARE stmt FROM @drop_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
