/* Legal & Advisory upgrade — new tables + seed advocates.
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

// category_id: 1..8 per LEGAL_CATEGORIES const
const ADVOCATES = [
  [1, 'Adv. Rajesh Menon', 'Criminal Law — bail, trials, complaints', 'Will call at registered number', '+91 9000000101', 'active'],
  [2, 'Adv. Priya Deshmukh', 'Civil & Commercial Advisory', 'Will call at registered number', '+91 9000000102', 'active'],
  [3, 'Adv. Arjun Krishnan', 'Corporate Contracts & Compliance', 'Chat preferred on registered number', '+91 9000000103', 'active'],
  [4, 'Adv. Sneha Rao', 'Family Law — divorce, custody, maintenance', 'Will call at registered number', '+91 9000000104', 'active'],
  [5, 'Adv. Vikram Shetty', 'Property & Real Estate — land disputes, registration', 'Will call at registered number', '+91 9000000105', 'active'],
  [6, 'Adv. Anita Thomas', 'Consumer & Legal Rights — disputes, compensation', 'Email preferred', '+91 9000000106', 'active'],
  [7, 'Adv. Suresh Nair', 'Labour & Employment Law', 'Will call at registered number', '+91 9000000107', 'active'],
  [8, 'Adv. Mohammed A.', 'General Legal Advisory — multi-domain', 'Will call at registered number', '+91 9000000108', 'active'],
  [null, 'V-COM Legal Helpdesk', 'Intake & routing desk', 'Desk line — 10am to 7pm', '+91 9000000100', 'active'],
];

async function upgrade(cfg, label) {
  const conn = await mysql.createConnection(cfg);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS legal_advocates (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        category_id INT UNSIGNED NULL,
        name VARCHAR(120) NOT NULL,
        specialization VARCHAR(200) NOT NULL,
        contact_status VARCHAR(100) NOT NULL DEFAULT 'Will call at registered number',
        phone VARCHAR(30) NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_la_category (category_id),
        KEY idx_la_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] legal_advocates table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS legal_tickets (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ticket_no VARCHAR(30) NOT NULL,
        customer_id INT UNSIGNED NOT NULL,
        category_id INT UNSIGNED NOT NULL,
        category_name VARCHAR(100) NOT NULL,
        location VARCHAR(255) NOT NULL,
        latitude DECIMAL(11,8) NULL,
        longitude DECIMAL(11,8) NULL,
        other_query TEXT NULL,
        status ENUM('request_received','advocate_assigned','in_consultation','resolved','cancelled')
          NOT NULL DEFAULT 'request_received',
        advocate_id INT UNSIGNED NULL,
        resolved_at DATETIME NULL,
        cancelled_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_legal_ticket (ticket_no),
        KEY idx_legal_customer (customer_id),
        KEY idx_legal_status (status),
        CONSTRAINT fk_legal_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_legal_advocate FOREIGN KEY (advocate_id) REFERENCES legal_advocates(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] legal_tickets table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS legal_status_history (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        legal_id INT UNSIGNED NOT NULL,
        status VARCHAR(30) NOT NULL,
        note VARCHAR(500) NULL,
        changed_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_lsh_legal (legal_id),
        CONSTRAINT fk_lsh_legal FOREIGN KEY (legal_id) REFERENCES legal_tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_lsh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] legal_status_history table ok`);

    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM legal_advocates');
    if (n === 0) {
      for (const a of ADVOCATES) {
        await conn.query(
          `INSERT INTO legal_advocates (category_id, name, specialization, contact_status, phone, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          a
        );
      }
      console.log(`[${label}] seeded ${ADVOCATES.length} advocates`);
    } else {
      console.log(`[${label}] advocates already present (${n}) — skip seed`);
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
