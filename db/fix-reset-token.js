/* Widen password_resets.token — JWT reset tokens exceed VARCHAR(120).
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

async function fix(cfg, label) {
  const conn = await mysql.createConnection(cfg);
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'password_resets' AND COLUMN_NAME = 'token'`,
      [cfg.database]
    );
    const cur = cols[0] ? cols[0].COLUMN_TYPE : null;
    if (!cur) {
      console.log(`[${label}] password_resets.token not found — skip`);
      return;
    }
    if (/varchar\(500\)/i.test(cur)) {
      console.log(`[${label}] already VARCHAR(500) — ok`);
      return;
    }
    await conn.query(`ALTER TABLE password_resets MODIFY token VARCHAR(500) NOT NULL`);
    console.log(`[${label}] altered: ${cur} -> varchar(500)`);
  } finally {
    await conn.end();
  }
}

(async () => {
  const which = process.argv[2] || 'both';
  if (which === 'local' || which === 'both') await fix(LOCAL, 'local');
  if (which === 'remote' || which === 'both') await fix(REMOTE, 'live');
  console.log('done');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
