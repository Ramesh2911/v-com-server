/* Seed special-service category colors/ref_codes + 141 sub-services from special-sub-services.json.
   Idempotent — safe to re-run (upserts). Run from server/:
     node db/seed-special-services.js local
     node db/seed-special-services.js clever   (Clever Cloud = live) */
const mysql = require('mysql2/promise');
const path = require('path');
const data = require('./special-sub-services.json');

const target = process.argv[2] || 'local';

const cfg = target === 'clever'
  ? {
      host: 'b4ymerf6b5blcfdyr2ol-mysql.services.clever-cloud.com',
      user: 'uzzj8iz17bp2hjzd',
      password: 'JekseWO6p8SIyxGQoJKs',
      database: 'b4ymerf6b5blcfdyr2ol',
      port: 3306,
      ssl: { rejectUnauthorized: false },
    }
  : { host: 'localhost', user: 'root', password: 'Ramesh@0329', database: 'vcom_db' };

const DDL_SUB_SERVICES = `
CREATE TABLE IF NOT EXISTS service_sub_services (
  id INT UNSIGNED PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  subtitle VARCHAR(255) NULL,
  image VARCHAR(512) NULL,
  bg_color VARCHAR(9) NULL,
  text_color VARCHAR(9) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sub_code (category_id, code),
  KEY idx_sub_category (category_id),
  CONSTRAINT fk_sub_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_REQUEST_SUB_SERVICES = `
CREATE TABLE IF NOT EXISTS request_sub_services (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  sub_service_id INT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rss_request (request_id),
  KEY idx_rss_sub (sub_service_id),
  CONSTRAINT fk_rss_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function ensureColumn(conn, table, column, ddl) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) {
    await conn.query(ddl);
    console.log(`  + column ${table}.${column}`);
  }
}

async function main() {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  console.log(`Seeding special services -> ${target} (${cfg.database})`);

  // 1. schema (idempotent)
  await ensureColumn(conn, 'service_categories', 'bg_color',
    `ALTER TABLE service_categories ADD COLUMN bg_color VARCHAR(9) NULL AFTER price`);
  await ensureColumn(conn, 'service_categories', 'text_color',
    `ALTER TABLE service_categories ADD COLUMN text_color VARCHAR(9) NULL AFTER bg_color`);
  await ensureColumn(conn, 'service_categories', 'ref_code',
    `ALTER TABLE service_categories ADD COLUMN ref_code VARCHAR(10) NULL AFTER text_color`);
  await conn.query(DDL_SUB_SERVICES);
  await conn.query(DDL_REQUEST_SUB_SERVICES);
  console.log('  schema ok');

  let catsDone = 0;
  let subsDone = 0;

  for (const cat of data.categories) {
    const [found] = await conn.query(
      `SELECT id FROM service_categories WHERE name = ? LIMIT 1`,
      [cat.name]
    );
    if (!found.length) throw new Error(`Category not found in DB: "${cat.name}"`);
    const catId = found[0].id;

    await conn.query(
      `UPDATE service_categories SET bg_color = ?, text_color = ?, ref_code = ? WHERE id = ?`,
      [cat.bg_color, cat.text_color, cat.ref_code, catId]
    );
    catsDone += 1;

    for (const s of cat.sub_services) {
      await conn.query(
        `INSERT INTO service_sub_services
           (id, category_id, code, title, subtitle, image, bg_color, text_color, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           category_id = VALUES(category_id), code = VALUES(code), title = VALUES(title),
           subtitle = VALUES(subtitle), image = VALUES(image), bg_color = VALUES(bg_color),
           text_color = VALUES(text_color), is_active = VALUES(is_active), sort_order = VALUES(sort_order)`,
        [s.id, catId, s.code, s.title, s.subtitle, s.image, s.bg_color, s.text_color, s.is_active, 0]
      );
      subsDone += 1;
    }
    console.log(`  ${cat.name} (id=${catId}, ${cat.ref_code}) -> ${cat.sub_services.length} sub-services`);
  }

  const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM service_sub_services`);
  console.log(`Done: ${catsDone} categories updated, ${subsDone} sub-service upserts, table total = ${n}`);
  await conn.end();
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
