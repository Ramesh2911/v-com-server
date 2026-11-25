/* Align service_modules/service_categories with the official catalog:
   - Professional (special-service): 18 cats — drop Housekeeping and Security + Marketing, renumber sort
   - Quick (quick-service): 7 cats — unchanged
   - Special (general-assistance): 6 cats — drop Travel and Insurance Schemes, rename SOS/Emergency -> SOS & Emergency
   - Enable quick-service + general-assistance modules (were status=0 on live)
   Soft-deletes extras (status=0) so requests/sub-services keep FK integrity.
   Idempotent. Run from server/:
     node db/fix-catalog.js local
     node db/fix-catalog.js clever */
const mysql = require('mysql2/promise');

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

const PROFESSIONAL_ORDER = [
  'Fabrication and Welding',
  'CCTV and Automation',
  'Packers and Movers',
  'Website and Graphic Designing',
  'Pest Control and Deep Cleaning',
  'Interior Design and Carpentry',
  'Electrical and Plumbing',
  'Construction, Renovation and Documentation',
  'Accounting and Statutory',
  'Fire and Safety',
  'Manpower and Security',
  'Event and Corporate Arrangements',
  'Computer and Hardware',
  'HVAC',
  'Gardening and Landscaping',
  'Water & Sewage Treatment',
  'Special Care & Health Care',
  'Real Estate & Properties',
];

const QUICK_ORDER = [
  'Electrical Work',
  'Plumbing Work',
  'Carpentry Work',
  'Air Conditioning Work',
  'Building Maintenance Work',
  'Repair Work (Any Category)',
  'Sunday Maid',
];

const SPECIAL_ORDER = [
  'SOS & Emergency',
  'HR and Recruitment',
  'Events and Offers',
  'Bookings and Admissions',
  'Legal & Advisory',
  'Scrap and Waste Management',
];

const HIDE = ['Housekeeping and Security', 'Marketing', 'Travel and Insurance Schemes'];
const RENAME = [['SOS/Emergency', 'SOS & Emergency']];
const ENABLE_MODULES = ['quick-service', 'general-assistance'];

async function main() {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  console.log(`fix-catalog -> ${target} (${cfg.database})`);

  for (const [from, to] of RENAME) {
    const [r] = await conn.query(
      `UPDATE service_categories SET name = ? WHERE name = ? AND name <> ?`,
      [to, from, to]
    );
    if (r.affectedRows) console.log(`  rename: ${from} -> ${to} (${r.affectedRows})`);
    else {
      const [[ok]] = await conn.query(`SELECT id FROM service_categories WHERE name = ? LIMIT 1`, [to]);
      console.log(`  rename: ${from} -> ${to} ${ok ? 'already done' : 'NOT FOUND'}`);
    }
  }

  for (const name of HIDE) {
    const [r] = await conn.query(
      `UPDATE service_categories SET status = 0 WHERE name = ? AND status <> 0`,
      [name]
    );
    if (r.affectedRows) console.log(`  hide: ${name} (${r.affectedRows})`);
    else console.log(`  hide: ${name} already hidden or absent`);
  }

  const sets = [
    ['special-service', PROFESSIONAL_ORDER],
    ['quick-service', QUICK_ORDER],
    ['general-assistance', SPECIAL_ORDER],
  ];
  for (const [code, order] of sets) {
    const [mods] = await conn.query(`SELECT id FROM service_modules WHERE code = ?`, [code]);
    if (!mods.length) throw new Error(`module not found: ${code}`);
    const mid = mods[0].id;
    for (let i = 0; i < order.length; i++) {
      const [r] = await conn.query(
        `UPDATE service_categories SET sort_order = ?, status = 1
          WHERE module_id = ? AND name = ?`,
        [i + 1, mid, order[i]]
      );
      if (!r.affectedRows) console.log(`  WARN: ${code}#${i + 1} "${order[i]}" not found`);
    }
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) n FROM service_categories WHERE module_id = ? AND status = 1`,
      [mid]
    );
    console.log(`  ${code}: ${n}/${order.length} active cats ordered`);
  }

  for (const code of ENABLE_MODULES) {
    const [r] = await conn.query(
      `UPDATE service_modules SET status = 1 WHERE code = ? AND status <> 1`,
      [code]
    );
    if (r.affectedRows) console.log(`  enable module: ${code}`);
    else console.log(`  enable module: ${code} already active`);
  }

  const [rows] = await conn.query(
    `SELECT m.code, m.status, COUNT(c.id) active_cats
       FROM service_modules m
       LEFT JOIN service_categories c ON c.module_id = m.id AND c.status = 1
      GROUP BY m.id, m.code, m.status ORDER BY m.sort_order, m.id`
  );
  console.log('Result:');
  rows.forEach((r) => console.log(`  ${r.code} status=${r.status} active=${r.active_cats}`));

  const [hidden] = await conn.query(
    `SELECT name FROM service_categories WHERE status = 0 ORDER BY id`
  );
  if (hidden.length) console.log(`Hidden leftovers: ${hidden.map((h) => h.name).join(', ')}`);

  await conn.end();
}

main().catch((err) => {
  console.error('FIX FAILED:', err.message);
  process.exit(1);
});
