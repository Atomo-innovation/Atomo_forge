-- Creates four workspace databases. GRANTs applied by: npm run grant:events-db

CREATE DATABASE IF NOT EXISTS atomo_forge_person
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS atomo_forge_fire
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS atomo_forge_face
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS atomo_forge_safety
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
