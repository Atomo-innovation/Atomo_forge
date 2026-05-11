#!/usr/bin/env node
/**
 * Set MeshCentral MySQL user password for MESHCENTRAL_PROVISION_USER to match MESHCENTRAL_PROVISION_PASS
 * using the same hashing as MeshCentral pass.js (pbkdf2 sha384).
 *
 * Usage (from ready_atomo-forge-suite):
 *   npm run meshcentral:sync-password              # dry-run
 *   npm run meshcentral:sync-password -- --apply # write to MySQL
 *
 * MYSQL_* = database server login (not the MeshCentral web account).
 */
const path = require('path');
require(path.join(__dirname, '..', 'load-env.cjs'));

const mysql = require('mysql2/promise');
const pass = require(path.join(__dirname, '..', '..', 'pass.js'));

const apply = process.argv.includes('--apply');

const provisionUser = String(process.env.MESHCENTRAL_PROVISION_USER || 'atomo')
  .trim()
  .toLowerCase();
const provisionPass = String(process.env.MESHCENTRAL_PROVISION_PASS || '').trim();

if (!provisionPass) {
  console.error('MESHCENTRAL_PROVISION_PASS is empty. Set it in .env to the password you want for MeshCentral user', provisionUser);
  process.exit(1);
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'atomo',
    password: process.env.MYSQL_PASSWORD || 'atomo@1234',
    database: process.env.MYSQL_DATABASE || 'meshcentral',
    waitForConnections: true,
    connectionLimit: 2,
  });

  const [rows] = await pool.query(
    'SELECT id, doc FROM main WHERE type = ? AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(doc, "$.name"))) = ? LIMIT 1',
    ['user', provisionUser]
  );

  if (!rows || rows.length === 0) {
    console.error('No MeshCentral user named "' + provisionUser + '" in main. Create the account in the MeshCentral UI first, or set MESHCENTRAL_PROVISION_USER.');
    await pool.end();
    process.exit(1);
  }

  const row = rows[0];
  const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;

  await new Promise((resolve, reject) => {
    pass.hash(provisionPass, (err, salt, hash) => {
      if (err) return reject(err);
      doc.salt = salt;
      doc.hash = hash;
      const newDoc = JSON.stringify(doc);
      if (!apply) {
        console.log('[dry-run] Would update user id=' + row.id + ' (' + provisionUser + ') with new salt/hash from MESHCENTRAL_PROVISION_PASS.');
        console.log('Run with --apply to write to MySQL.');
        resolve();
        return;
      }
      pool
        .query('UPDATE main SET doc = ? WHERE id = ?', [newDoc, row.id])
        .then(() => {
          console.log('Updated MeshCentral user "' + provisionUser + '" (id=' + row.id + ') password in MySQL to match MESHCENTRAL_PROVISION_PASS.');
          resolve();
        })
        .catch(reject);
    });
  });

  await pool.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
