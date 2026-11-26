/* SOS public API upgrade — additive migration.
   - sos_tickets: category/photo/requester/patient/OTP columns + status 'cancelled'
   - sos_responders: new table + seed
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

const NEW_COLS = [
  ['category_id', 'INT UNSIGNED NULL'],
  ['photo_url', 'VARCHAR(500) NULL'],
  ['requester_phone', 'VARCHAR(20) NULL'],
  ['requester_location', 'VARCHAR(255) NULL'],
  ['is_for_other', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['other_person_name', 'VARCHAR(100) NULL'],
  ['relationship', 'VARCHAR(50) NULL'],
  ['other_person_phone', 'VARCHAR(20) NULL'],
  ['patient_location', 'VARCHAR(255) NULL'],
  ['special_instructions', 'VARCHAR(500) NULL'],
  ['verification_phone', 'VARCHAR(20) NULL'],
  ['cancelled_at', 'DATETIME NULL'],
  ['responder_id', 'INT UNSIGNED NULL'],
];

const RESPONDERS = [
  // category_id NULL = general fallback
  [null, 'V-COM Emergency Control', '+91 8000000100', 'KA-01-EM-0001', 'Control Desk', 12.9716, 77.5946, 'active'],
  [1, 'Apollo Medical Response Unit 1', '+91 8000000108', 'KA-19-EM-9921', 'Suresh Gowda', 12.9352, 77.6245, 'active'],
  [1, 'Apollo Medical Response Unit 4', '+91 8000000109', 'KA-05-EM-4410', 'Ravi Kumar', 12.9716, 77.5946, 'active'],
  [2, 'City Fire Rescue Unit 2', '+91 8000000101', 'KA-03-FR-2210', 'Mohammed Irfan', 12.9592, 77.6482, 'active'],
  [3, 'Rapid Police Response 1', '+91 8000000100', 'KA-02-PR-1105', 'Anil Sharma', 12.9764, 77.6033, 'active'],
  [4, 'Women & Child Helpline Unit', '+91 8000000109', 'KA-07-WC-9091', 'Priya Nair', 12.9716, 77.6389, 'active'],
  [5, 'Road Accident Rescue Unit', '+91 8000000107', 'KA-19-RA-1073', 'Venkatesh R', 12.9141, 77.6472, 'active'],
  [6, 'Roadside Assistance Van 1', '+91 8000000160', 'KA-04-BD-6060', 'Ganesh Patil', 12.9250, 77.5938, 'active'],
  [7, 'Disaster Response Unit', '+91 8000000107', 'KA-09-DR-1077', 'Disaster Cell', 12.9716, 77.5946, 'active'],
  [8, 'Electrical Emergency Van', '+91 8000000191', 'KA-06-UT-1912', 'BESCOM Team', 12.9450, 77.5860, 'active'],
  [9, 'Doctor on Call Unit', '+91 8000000108', 'KA-08-DR-0099', 'Dr. Meera Joshi', 12.9716, 77.6200, 'active'],
  [10, 'General Emergency Unit', '+91 8000000112', 'KA-11-GE-0112', 'Rajesh Singh', 12.9716, 77.5946, 'active'],
];

async function upgrade(cfg, label) {
  const conn = await mysql.createConnection(cfg);
  try {
    // 1) new columns
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sos_tickets'`,
      [cfg.database]
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    for (const [name, def] of NEW_COLS) {
      if (have.has(name)) {
        console.log(`[${label}] column ${name} exists — skip`);
        continue;
      }
      await conn.query(`ALTER TABLE sos_tickets ADD COLUMN \`${name}\` ${def}`);
      console.log(`[${label}] added column ${name}`);
    }

    // 2) status enum += cancelled
    const [st] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sos_tickets' AND COLUMN_NAME = 'status'`,
      [cfg.database]
    );
    const cur = st[0] ? st[0].COLUMN_TYPE : '';
    if (cur && !/cancelled/.test(cur)) {
      await conn.query(
        `ALTER TABLE sos_tickets MODIFY status
          ENUM('open','acknowledged','dispatched','in_progress','resolved','closed','cancelled')
          NOT NULL DEFAULT 'open'`
      );
      console.log(`[${label}] status enum += cancelled (was: ${cur})`);
    } else {
      console.log(`[${label}] status enum already has cancelled — skip`);
    }

    // 3) sos_responders table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sos_responders (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        category_id INT UNSIGNED NULL,
        unit_name VARCHAR(120) NOT NULL,
        contact_no VARCHAR(30) NOT NULL,
        vehicle_no VARCHAR(30) NULL,
        driver_name VARCHAR(100) NULL,
        latitude DECIMAL(11,8) NULL,
        longitude DECIMAL(11,8) NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sr_category (category_id),
        KEY idx_sr_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] sos_responders table ok`);

    // 4) seed (only when empty)
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM sos_responders');
    if (n === 0) {
      for (const r of RESPONDERS) {
        await conn.query(
          `INSERT INTO sos_responders (category_id, unit_name, contact_no, vehicle_no, driver_name, latitude, longitude, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          r
        );
      }
      console.log(`[${label}] seeded ${RESPONDERS.length} responders`);
    } else {
      console.log(`[${label}] responders already present (${n}) — skip seed`);
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
