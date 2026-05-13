-- Registered devices table for atomo-forge-suite.
-- Populated by POST /api/devices/register (auth-server.cjs).
-- Lives alongside MeshCentral's `main` table in the `meshcentral` schema so
-- the same MySQL user (atomo) can read users and write devices.
--
-- `serial_number` is the natural key; the API uses
-- INSERT ... ON DUPLICATE KEY UPDATE on it.

CREATE TABLE IF NOT EXISTS atomo_registered_devices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  serial_number VARCHAR(128) NOT NULL,
  device_name VARCHAR(255) NOT NULL,
  organization_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  location VARCHAR(255) NULL,
  cloud_sync TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_serial_number (serial_number),
  KEY idx_organization_name (organization_name),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
