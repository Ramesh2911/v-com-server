/* Scrap & Waste Management upgrade — 2 tables + buyer seed + demo request + permissions.
   Idempotent: safe to run on local + live. */
const mysql = require('mysql2/promise');

const REMOTE = {
  host: 'b4ymerf6b5blcfdyr2ol-mysql.services.clever-cloud.com',
  port: 3306,
  user: 'uzzj8iz17bp2hjzd',
  password: 'JekseWO6p8SIyxGQoJKs',
  database: 'b4ymerf6b5blcfdyr2ol',
};
const LOCAL = { host: 'localhost', user: 'root', password: 'Ramesh@0329', database: 'vcom_db' };

const BUYERS = [
  ['Suresh Gowda', '+91 824 244 5555', 'KA-19-E-4421', 'Certified Electronic Digital Scale'],
  ['Ravi Kumar', '+91 98450 11223', 'KA-19-F-7788', 'Portable Platform Scale'],
  ['Manju Shetty', '+91 99860 44556', 'KA-05-M-2211', 'Mechanical Weighing Scale'],
  ['Imran Sheikh', '+91 90080 77889', 'KA-19-H-9900', 'Certified Electronic Digital Scale'],
];

async function upgrade(cfg, label) {
  const conn = await mysql.createConnection(cfg);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS scrap_buyers (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        vehicle_no VARCHAR(30) NULL,
        scale_type VARCHAR(120) NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] scrap_buyers table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS scrap_requests (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        request_code VARCHAR(30) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        material_categories JSON NOT NULL,
        approx_weight_range VARCHAR(60) NOT NULL,
        pickup_type ENUM('Doorstep','Bulk') NOT NULL DEFAULT 'Doorstep',
        pickup_address VARCHAR(500) NOT NULL,
        latitude DOUBLE NULL,
        longitude DOUBLE NULL,
        contact_phone VARCHAR(30) NOT NULL,
        preferred_date VARCHAR(30) NOT NULL,
        preferred_time_slot VARCHAR(60) NOT NULL,
        scrap_photo_url VARCHAR(500) NULL,
        special_instructions TEXT NULL,
        status ENUM('REQUEST_PLACED','BUYER_ASSIGNED','OUT_FOR_PICKUP','WEIGHING_COMPLETED','PAYMENT_COMPLETED','CANCELLED') NOT NULL DEFAULT 'REQUEST_PLACED',
        assigned_buyer_id INT UNSIGNED NULL,
        actual_weight_kg DECIMAL(10,2) NULL,
        final_amount DECIMAL(12,2) NULL,
        payment_mode VARCHAR(40) NULL,
        assigned_at DATETIME NULL,
        out_at DATETIME NULL,
        weighed_at DATETIME NULL,
        paid_at DATETIME NULL,
        cancellation_reason VARCHAR(500) NULL,
        cancelled_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_swr_code (request_code),
        KEY idx_swr_user (user_id),
        KEY idx_swr_status (status),
        KEY idx_swr_buyer (assigned_buyer_id),
        CONSTRAINT fk_swr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_swr_buyer FOREIGN KEY (assigned_buyer_id) REFERENCES scrap_buyers(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] scrap_requests table ok`);

    // ---- buyers (only when empty) ----
    const [[{ bn }]] = await conn.query('SELECT COUNT(*) AS bn FROM scrap_buyers');
    if (bn === 0) {
      for (const b of BUYERS) {
        await conn.query('INSERT INTO scrap_buyers (name, phone, vehicle_no, scale_type) VALUES (?,?,?,?)', b);
      }
      console.log(`[${label}] seeded ${BUYERS.length} buyers`);
    } else {
      console.log(`[${label}] buyers already present (${bn}) — skip seed`);
    }

    // ---- demo request (doc example: VSW-2026-90412, OUT_FOR_PICKUP, buyer assigned) ----
    const [[{ rn }]] = await conn.query('SELECT COUNT(*) AS rn FROM scrap_requests');
    if (rn === 0) {
      await conn.query(
        `INSERT INTO scrap_requests
           (request_code, user_id, material_categories, approx_weight_range, pickup_type,
            pickup_address, latitude, longitude, contact_phone, preferred_date, preferred_time_slot,
            scrap_photo_url, special_instructions, status, assigned_buyer_id,
            assigned_at, out_at, created_at)
         VALUES ('VSW-2026-90412', 6,
            JSON_ARRAY('Paper & Newspapers', 'Iron & Steel Scraps'),
            '15 - 50 kg (Standard)', 'Doorstep',
            'Bejai Main Road, Bejai, Mangalore, Karnataka - 575004', 12.9057, 74.8606,
            '+91 98765 43210', 'Tomorrow', '10:00 AM - 01:00 PM',
            NULL, 'Scrap is on 2nd floor, lift available', 'OUT_FOR_PICKUP', 1,
            '2026-11-26 10:05:00', '2026-11-26 10:30:00', '2026-11-26 10:00:00')`
      );
      console.log(`[${label}] seeded 1 demo request VSW-2026-90412`);
    } else {
      console.log(`[${label}] requests already present (${rn}) — skip seed`);
    }

    // ---- permissions (scrap.view / scrap.manage) + grants to Super Admin(1) + Operations Manager(2) ----
    for (const [code, labelTxt] of [['scrap.view', 'View scrap pickups'], ['scrap.manage', 'Manage scrap pickups']]) {
      const [[perm]] = await conn.query('SELECT id FROM permissions WHERE code = ?', [code]);
      let permId;
      if (perm) {
        permId = perm.id;
      } else {
        const [r] = await conn.query('INSERT INTO permissions (code, module, label) VALUES (?, ?, ?)', [code, 'scrap', labelTxt]);
        permId = r.insertId;
        console.log(`[${label}] permission ${code} created`);
      }
      for (const roleId of [1, 2]) {
        const [[rp]] = await conn.query('SELECT role_id FROM role_permissions WHERE role_id = ? AND permission_id = ?', [roleId, permId]);
        if (!rp) {
          await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permId]);
          console.log(`[${label}] ${code} granted to role ${roleId}`);
        }
      }
    }
  } finally {
    await conn.end();
  }
}

(async () => {
  const which = process.argv[2] || 'both';
  if (which === 'local' || which === 'both') await upgrade(LOCAL, 'local');
  if (which === 'remote' || which === 'both') await upgrade(REMOTE, 'live');
  console.log('done');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
