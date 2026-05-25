-- DEPRECATED: superseded by scripts/sql/events/001 (database atomo_forge, table detection_events, image in MySQL BLOB).
-- Left for reference; auth-server no longer uses meshcentral.atomo_detection_events.

CREATE TABLE IF NOT EXISTS atomo_detection_events (
  id VARCHAR(64) NOT NULL,
  mesh_username VARCHAR(255) NOT NULL,
  created_at_ms BIGINT UNSIGNED NOT NULL,
  detection_workspace VARCHAR(32) NOT NULL DEFAULT 'cameras',
  camera_id VARCHAR(64) NOT NULL,
  camera_name VARCHAR(255) NULL,
  model_name VARCHAR(255) NULL,
  label VARCHAR(255) NOT NULL,
  score DOUBLE NULL,
  session_id VARCHAR(64) NULL,
  image_path VARCHAR(512) NOT NULL,
  box_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_user_workspace_time (mesh_username, detection_workspace, created_at_ms),
  KEY idx_user_time (mesh_username, created_at_ms),
  KEY idx_camera_time (camera_id, created_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
