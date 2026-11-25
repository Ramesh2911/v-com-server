/* One-off for EXISTING databases (seed.js is NOT idempotent for categories,
   so never re-run it here): creates payouts table + events/payouts permissions
   + links them to the Super Admin role.
   Run from server/:
     node db/add-payouts-events.js local
     node db/add-payouts-events.js clever   (Clever Cloud = live) */
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

const DDL_PAYOUTS = `
CREATE TABLE IF NOT EXISTS payouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT UNSIGNED NOT NULL,
  job_id INT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('pending','processed') NOT NULL DEFAULT 'pending',
  note VARCHAR(255) NULL,
  processed_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_payouts_vendor (vendor_id),
  KEY idx_payouts_status (status),
  KEY idx_payouts_job (job_id),
  CONSTRAINT fk_payouts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_payouts_job FOREIGN KEY (job_id) REFERENCES jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const PERMS = [
  ['events.view', 'events', 'View events'],
  ['events.manage', 'events', 'Manage events'],
  ['payouts.view', 'payouts', 'View payouts'],
  ['payouts.manage', 'payouts', 'Manage payouts'],
];

async function main() {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  try {
    await conn.query(DDL_PAYOUTS);
    console.log('payouts table: ok');

    for (const [code, module, label] of PERMS) {
      await conn.query(
        `INSERT INTO permissions (code, module, label) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE module = VALUES(module), label = VALUES(label)`,
        [code, module, label]
      );
    }
    const codes = PERMS.map((p) => p[0]);
    const [permRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${codes.map(() => '?').join(',')})`,
      codes
    );

    const [[role]] = await conn.query(`SELECT id FROM roles WHERE slug = 'super_admin'`);
    if (!role) throw new Error('super_admin role not found');
    for (const p of permRows) {
      await conn.query(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [role.id, p.id]
      );
    }

    const [[cnt]] = await conn.query(
      `SELECT COUNT(*) AS n FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ? AND p.code IN (${codes.map(() => '?').join(',')})`,
      [role.id, ...codes]
    );
    console.log(`permissions: ${permRows.length}/${PERMS.length} created, ${cnt.n} linked to super_admin`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
