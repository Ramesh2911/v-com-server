/* Catalog v2: group_name column + group/sort fixes + 2 renames + 5 new categories
   + 30 sub-service adds + 16 title syncs (spec: Professional/Quick/Special lists).
   Idempotent — safe to re-run. Run from server/:
      node db/seed-catalog-v2.js local
      node db/seed-catalog-v2.js clever   (Clever Cloud = live) */
const mysql = require('mysql2/promise');
const data = require('./catalog-v2-data.json');

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

async function categoryIdByName(conn, name) {
  const [rows] = await conn.query('SELECT id FROM service_categories WHERE name = ? LIMIT 1', [name]);
  if (!rows.length) return null;
  return rows[0].id;
}

async function main() {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  console.log(`Seeding catalog v2 -> ${target} (${cfg.database})`);

  await ensureColumn(conn, 'service_categories', 'group_name',
    `ALTER TABLE service_categories ADD COLUMN group_name VARCHAR(16) NOT NULL DEFAULT 'professional' AFTER ref_code`);

  // 1. groups for existing categories via module mapping
  const [grp] = await conn.query(
    `UPDATE service_categories c JOIN service_modules m ON m.id = c.module_id
        SET c.group_name = CASE m.code
              WHEN 'special-service'   THEN 'professional'
              WHEN 'quick-service'     THEN 'quick'
              WHEN 'general-assistance' THEN 'special'
              ELSE c.group_name END`
  );
  console.log(`  groups mapped: ${grp.affectedRows} rows`);

  // 2. sort_order fixes (spec order within each group)
  for (const s of data.sort_updates) {
    const id = await categoryIdByName(conn, s.name);
    if (!id) throw new Error(`sort_update: category not found "${s.name}"`);
    await conn.query('UPDATE service_categories SET sort_order = ? WHERE id = ?', [s.sort_order, id]);
  }
  console.log(`  sort updates: ${data.sort_updates.length}`);

  // 3. renames (skip if already renamed — fresh installs use new names in seed.js)
  let renamed = 0;
  for (const r of data.renames) {
    const fromId = await categoryIdByName(conn, r.from);
    if (!fromId) {
      const toId = await categoryIdByName(conn, r.to);
      if (toId) { console.log(`  rename skip (done): ${r.to}`); continue; }
      throw new Error(`rename: neither "${r.from}" nor "${r.to}" found`);
    }
    await conn.query('UPDATE service_categories SET name = ? WHERE id = ?', [r.to, fromId]);
    renamed += 1;
    console.log(`  rename: ${r.from} -> ${r.to}`);
  }

  // 4. new categories (idempotent by name)
  let newCats = 0;
  for (const c of data.new_categories) {
    const [mods] = await conn.query('SELECT id FROM service_modules WHERE code = ?', [c.module_code]);
    if (!mods.length) throw new Error(`module not found: ${c.module_code}`);
    const id = await categoryIdByName(conn, c.name);
    if (id) {
      await conn.query(
        'UPDATE service_categories SET group_name = ?, sort_order = ?, module_id = ?, status = 1 WHERE id = ?',
        [c.group_name, c.sort_order, mods[0].id, id]
      );
    } else {
      await conn.query(
        `INSERT INTO service_categories (module_id, name, description, group_name, status, sort_order)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [mods[0].id, c.name, c.description || null, c.group_name, c.sort_order]
      );
    }
    newCats += 1;
  }
  console.log(`  new categories: ${newCats}`);

  // 5. sub-service adds (explicit PK ids, ON DUP = re-run safe)
  let subsAdded = 0;
  for (const s of data.sub_adds) {
    const catId = await categoryIdByName(conn, s.category);
    if (!catId) throw new Error(`sub_add: category not found "${s.category}"`);
    await conn.query(
      `INSERT INTO service_sub_services
         (id, category_id, code, title, subtitle, image, bg_color, text_color, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), subtitle = VALUES(subtitle), image = VALUES(image),
         bg_color = VALUES(bg_color), text_color = VALUES(text_color), is_active = 1`,
      [s.id, catId, s.code, s.title, s.subtitle, s.image, s.bg_color, s.text_color]
    );
    subsAdded += 1;
  }
  console.log(`  sub-service adds: ${subsAdded}`);

  // 6. title syncs (existing codes -> spec titles, ids/codes untouched)
  let synced = 0;
  for (const t of data.title_syncs) {
    const catId = await categoryIdByName(conn, t.category);
    if (!catId) throw new Error(`title_sync: category not found "${t.category}"`);
    const [r] = await conn.query(
      'UPDATE service_sub_services SET title = ? WHERE category_id = ? AND code = ?',
      [t.title, catId, t.code]
    );
    if (!r.affectedRows) throw new Error(`title_sync: sub not found ${t.category}/${t.code}`);
    synced += 1;
  }
  console.log(`  title syncs: ${synced}`);

  const [[stats]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM service_categories) cats,
            (SELECT COUNT(*) FROM service_sub_services) subs,
            (SELECT COUNT(*) FROM service_categories WHERE group_name = 'professional') prof,
            (SELECT COUNT(*) FROM service_categories WHERE group_name = 'quick') quick,
            (SELECT COUNT(*) FROM service_categories WHERE group_name = 'special') special`
  );
  console.log(`Done: ${stats.cats} categories (prof=${stats.prof}, quick=${stats.quick}, special=${stats.special}), ${stats.subs} sub-services`);
  await conn.end();
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
