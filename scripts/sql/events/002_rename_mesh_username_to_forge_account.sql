-- Upgrade old atomo_forge.detection_events if created with mesh_username column.
USE atomo_forge;

SET @has_old = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'atomo_forge' AND table_name = 'detection_events' AND column_name = 'mesh_username'
);
SET @has_new = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'atomo_forge' AND table_name = 'detection_events' AND column_name = 'forge_account'
);

SET @sql = IF(
  @has_old > 0 AND @has_new = 0,
  'ALTER TABLE detection_events CHANGE COLUMN mesh_username forge_account VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
