-- Forge detection events — no MeshCentral dependency.
-- Database atomo_forge is standalone (login may be local board@local or any Forge account id).
-- Images stored as JPEG BLOB in MySQL.
--
-- If CREATE DATABASE fails, grant on EC2:
--   GRANT ALL PRIVILEGES ON atomo_forge.* TO 'atomo'@'%';
--   FLUSH PRIVILEGES;

CREATE DATABASE IF NOT EXISTS atomo_forge
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE atomo_forge;

CREATE TABLE IF NOT EXISTS detection_events (
  id VARCHAR(64) NOT NULL,
  forge_account VARCHAR(255) NOT NULL,
  created_at_ms BIGINT UNSIGNED NOT NULL,
  detection_workspace VARCHAR(32) NOT NULL DEFAULT 'cameras',
  camera_id VARCHAR(64) NOT NULL,
  camera_name VARCHAR(255) NULL,
  model_name VARCHAR(255) NULL,
  label VARCHAR(255) NOT NULL,
  score DOUBLE NULL,
  session_id VARCHAR(64) NULL,
  box_json JSON NULL,
  image_jpeg MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_workspace_time (forge_account, detection_workspace, created_at_ms),
  KEY idx_user_time (forge_account, created_at_ms),
  KEY idx_camera_time (camera_id, created_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
