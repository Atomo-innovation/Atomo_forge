-- Creates atomo_forge only. GRANT lines are applied by scripts/grant-atomo-forge-on-ec2.sh
-- (MySQL 8 error 1410 if GRANT targets a user@host that does not exist).

CREATE DATABASE IF NOT EXISTS atomo_forge
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
