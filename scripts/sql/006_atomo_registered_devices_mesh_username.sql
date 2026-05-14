-- MeshCentral / Forge login username per registration row (who saved this device in the app).
-- Enables Settings → list devices for this account and counts per contact email.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'atomo_registered_devices'
    AND column_name = 'mesh_username'
);
SET @add_col := IF(
  @col_exists = 0,
  'ALTER TABLE atomo_registered_devices ADD COLUMN mesh_username VARCHAR(256) NULL DEFAULT NULL AFTER serial_number',
  'SELECT 1'
);
PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'atomo_registered_devices'
    AND index_name = 'idx_mesh_username'
);
SET @add_idx := IF(
  @idx_exists = 0,
  'ALTER TABLE atomo_registered_devices ADD KEY idx_mesh_username (mesh_username)',
  'SELECT 1'
);
PREPARE stmt2 FROM @add_idx;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

CREATE OR REPLACE VIEW v_atomo_device_registrations AS
SELECT
  id,
  serial_number,
  mesh_username AS meshcentral_username,
  device_name,
  organization_name,
  email,
  phone,
  location,
  CASE cloud_sync WHEN 1 THEN 'on' ELSE 'off' END AS cloud_sync,
  created_at AS registered_at,
  updated_at AS last_updated_at
FROM atomo_registered_devices;
