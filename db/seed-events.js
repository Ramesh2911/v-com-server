/* Seed events (Event & Corporate Arrangements) from events-data.json.
   Dates are computed DYNAMICALLY at seed time (day_offset from IST today,
   or "nextSat" / "nextSat+1") so date filters always have demo data.
   Idempotent — re-run refreshes dates (upsert). Run from server/:
     node db/seed-events.js local
     node db/seed-events.js clever   (Clever Cloud = live) */
const mysql = require('mysql2/promise');
const data = require('./events-data.json');

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

const DDL_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(16) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  organizer VARCHAR(160) NULL,
  category VARCHAR(60) NULL,
  event_date DATE NOT NULL,
  start_time VARCHAR(8) NULL,
  time_range VARCHAR(40) NULL,
  location VARCHAR(100) NOT NULL,
  venue_name VARCHAR(160) NULL,
  venue_address VARCHAR(255) NULL,
  banner_url VARCHAR(512) NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT NULL,
  highlights JSON NULL,
  amenities JSON NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_events_date (event_date),
  KEY idx_events_location (location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const istToday = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // 'YYYY-MM-DD'

const addDays = (d, n) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

const resolveOffset = (off, today) => {
  if (typeof off === 'number') return addDays(today, off);
  if (off === 'nextSat' || off === 'nextSat+1') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
    let satOff;
    if (dow === 6) satOff = 0;
    else if (dow === 0) satOff = -1; // today is Sunday — Saturday already passed this weekend; use next Saturday
    else satOff = 6 - dow;
    if (off === 'nextSat+1') {
      // Sunday of the coming weekend; if today is Saturday -> tomorrow, if today is Sunday -> today
      if (dow === 6) return addDays(today, 1);
      if (dow === 0) return today;
      return addDays(today, satOff + 1);
    }
    if (dow === 0) return addDays(today, 6); // next Saturday (strictly future after Sunday)
    return addDays(today, satOff);
  }
  throw new Error(`Unknown day_offset: ${off}`);
};

async function main() {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  console.log(`Seeding events -> ${target} (${cfg.database})`);
  await conn.query(DDL_EVENTS);
  console.log('  schema ok');

  const today = istToday();
  console.log(`  IST today = ${today}`);
  let n = 0;
  for (const e of data.events) {
    const eventDate = resolveOffset(e.day_offset, today);
    await conn.query(
      `INSERT INTO events
         (id, title, organizer, category, event_date, start_time, time_range, location,
          venue_name, venue_address, banner_url, is_featured, description,
          highlights, amenities, latitude, longitude, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), organizer = VALUES(organizer), category = VALUES(category),
         event_date = VALUES(event_date), start_time = VALUES(start_time),
         time_range = VALUES(time_range), location = VALUES(location),
         venue_name = VALUES(venue_name), venue_address = VALUES(venue_address),
         banner_url = VALUES(banner_url), is_featured = VALUES(is_featured),
         description = VALUES(description), highlights = VALUES(highlights),
         amenities = VALUES(amenities), latitude = VALUES(latitude),
         longitude = VALUES(longitude), status = 1, sort_order = VALUES(sort_order)`,
      [
        e.id, e.title, e.organizer || null, e.category || null, eventDate,
        e.start_time || null, e.time_range || null, e.location,
        e.venue_name || null, e.venue_address || null, e.banner_url || null,
        e.is_featured ? 1 : 0, e.description || null,
        JSON.stringify(e.highlights || []), JSON.stringify(e.amenities || []),
        e.latitude != null ? e.latitude : null, e.longitude != null ? e.longitude : null,
        n,
      ]
    );
    console.log(`  ${e.id} ${eventDate} ${e.title.slice(0, 55)}`);
    n += 1;
  }

  const [[{ c }]] = await conn.query(`SELECT COUNT(*) AS c FROM events`);
  console.log(`Done: ${n} events upserted, table total = ${c}`);
  await conn.end();
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
