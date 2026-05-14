-- Forge device registration rows are stored ONLY here:
--   Schema: same as MYSQL_DATABASE (default: meshcentral)
--   Table:  atomo_registered_devices
--
-- MySQL Workbench checklist:
--   1) Connection host/port/user/password must match auth-server .env (MYSQL_*).
--      Laptop -> EC2 DB: start SSH tunnel first; use 127.0.0.1 and MYSQL_PORT (often 3307).
--   2) In Navigator, select schema `meshcentral` (not `mysql` / wrong DB).
--   3) Refresh Tables (right-click schema -> Refresh All).
--   4) MeshCentral user accounts live in table `main` (JSON) — that is NOT Forge device registration.
--
-- Quick check:
--   USE meshcentral;
--   SELECT * FROM atomo_registered_devices ORDER BY updated_at DESC;

CREATE OR REPLACE VIEW v_atomo_device_registrations AS
SELECT
  id,
  serial_number,
  device_name,
  organization_name,
  email,
  phone,
  location,
  CASE cloud_sync WHEN 1 THEN 'on' ELSE 'off' END AS cloud_sync,
  created_at AS registered_at,
  updated_at AS last_updated_at
FROM atomo_registered_devices;
