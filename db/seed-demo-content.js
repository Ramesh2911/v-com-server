/* Seed demo content: module/category images + descriptions + prices + completed requests + reviews.
   Idempotent — replaces prior VCOM-SEED-% data. Run from server/:
     node db/seed-demo-content.js local
     node db/seed-demo-content.js clever   (uses Clever Cloud env — edit cfg below if needed) */
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

const MODULE_IMG = {
  'special-service': 'https://placehold.co/800x600/f97316/ffffff?text=Special+Service',
  'quick-service': 'https://placehold.co/800x600/4f46e5/ffffff?text=Quick+Service',
  'general-assistance': 'https://placehold.co/800x600/0d9488/ffffff?text=General+Assistance',
};

const CATEGORY_CONTENT = {
  'Fabrication and Welding': 'Custom metal fabrication, gate/grill welding and on-site repair work by skilled welders.',
  'CCTV and Automation': 'CCTV camera installation, DVR/NVR setup, intercom and smart home automation services.',
  'Packers and Movers': 'Safe packing, loading and relocation of homes and offices — local and long-distance shifts.',
  'Website and Graphic Designing': 'Website design & development, logos, branding and social media creative design.',
  'Pest Control and Deep Cleaning': 'Professional pest control treatments and deep cleaning for homes and workplaces.',
  'Interior and Office Inventory': 'Interior design, modular setups and complete office inventory management solutions.',
  'Electrical and Plumbing': 'Combined electrical and plumbing fixes — wiring, fittings, leaks and installations.',
  'Construction, Renovation and Documentation': 'Renovation, civil work and end-to-end project documentation support.',
  'Accounting and Statutory': 'Bookkeeping, GST/tax filing, audits and statutory compliance for businesses.',
  'Fire and Safety': 'Fire extinguishers, alarm systems, safety audits and emergency preparedness setup.',
  'Housekeeping and Security': 'Trained housekeeping staff and security personnel for homes and commercial spaces.',
  'Event and Corporate Arrangements': 'Corporate events, conferences, exhibitions and private celebration management.',
  'Computer and Hardware': 'Computer/laptop repair, networking, hardware upgrades and AMC services.',
  'HVAC': 'AC sales, installation, gas filling, AMC and all HVAC maintenance solutions.',
  'Gardening and Landscaping': 'Garden design, lawn care, plant maintenance and landscape transformation.',
  'Water & Sewage Treatment': 'RO/plant installation, sewage treatment solutions and water quality management.',
  'Special Care & Health Care': 'Attendants, elder care and support services for patients at home.',
  'Electrical Work': 'Fan, light, switchboard, inverter and complete home electrical repairs at your doorstep.',
  'Plumbing Work': 'Tap, pipe, mixer, bathroom and kitchen plumbing repairs with same-day service.',
  'Carpentry Work': 'Furniture repair, door/window fixes, modular fitting and custom woodwork.',
  'Air Conditioning Work': 'AC installation, servicing, gas charging and breakdown repair by certified technicians.',
  'Building Maintenance Work': 'General building maintenance — civil patches, fittings and periodic upkeep.',
  'Repair Work (Any Category)': 'Multi-category quick repair service — tell us the problem, we send the right expert.',
  'SOS/Emergency': '24×7 emergency response for electrical, medical, lockout and safety situations.',
  'HR and Recruitment': 'Hiring support, temporary staffing and recruitment for blue-collar and white-collar roles.',
  'Events and Exhibitions': 'Trade shows, fairs, stage events and exhibition stall setup & management.',
  'Bookings and Admissions': 'Help with course admissions, ticketing, reservations and appointment bookings.',
  'Travel and Insurance Schemes': 'Travel planning, ticketing and assistance with insurance claims & renewals.',
  'Scrap and Waste Management': 'Scrap pickup, e-waste disposal and scheduled waste management for homes & offices.',
};

const QUICK_PRICES = {
  'Electrical Work': 499, 'Plumbing Work': 499, 'Carpentry Work': 599,
  'Air Conditioning Work': 799, 'Building Maintenance Work': 699, 'Repair Work (Any Category)': 399,
};

const REVIEW_SEED = [
  { cat: 'Electrical Work', items: [
    { r: 5, t: 5, c: 'Fixed the kitchen wiring in under an hour. Very professional and clean work.', v: 1 },
    { r: 4, t: 4, c: 'Good work overall. Arrived a bit late but resolved the issue properly.', v: 1 },
    { r: 5, t: 4, c: 'Transparent pricing and neat finishing. Highly recommended.', v: 2 },
    { r: 4, t: 5, c: 'Polite technician, explained the problem clearly before starting.', v: 1 },
  ]},
  { cat: 'Plumbing Work', items: [
    { r: 5, t: 5, c: 'Leak fixed permanently on the first visit. Great service.', v: 1 },
    { r: 4, t: 4, c: 'Quick response. Bathroom fittings done neatly.', v: 1 },
    { r: 3, t: 4, c: 'Service was fine, but took longer than expected.', v: 2 },
    { r: 5, t: 5, c: 'Best plumber we have used. On time and courteous.', v: 1 },
  ]},
  { cat: 'CCTV and Automation', items: [
    { r: 5, t: 5, c: 'Four cameras installed and configured the same day. App setup guided properly.', v: 1 },
    { r: 4, t: 5, c: 'Very tidy cabling work. Picture quality is excellent.', v: 1 },
    { r: 5, t: 4, c: 'Good advice on camera placement. Happy with the result.', v: 1 },
    { r: 4, t: 4, c: 'Reasonable price for the package. Would book again.', v: 2 },
  ]},
  { cat: 'Pest Control and Deep Cleaning', items: [
    { r: 5, t: 5, c: 'Complete deep cleaning after renovation — spotless result.', v: 1 },
    { r: 4, t: 4, c: 'Team arrived on schedule. Kitchen ant problem gone within days.', v: 1 },
    { r: 5, t: 5, c: 'Chemicals were child-safe as promised. Very satisfied.', v: 2 },
    { r: 4, t: 5, c: 'Polite crew, they explained the process and precautions well.', v: 1 },
  ]},
  { cat: 'Packers and Movers', items: [
    { r: 5, t: 5, c: 'Shifted our 2BHK without a single scratch. Packing was superb.', v: 1 },
    { r: 4, t: 4, c: 'Good handling. Two items arrived a day later but support was responsive.', v: 1 },
    { r: 5, t: 4, c: 'Fair quote, no hidden charges. Crew worked fast.', v: 2 },
    { r: 4, t: 5, c: 'Door-to-door service was smooth and stress free.', v: 1 },
  ]},
  { cat: 'Scrap and Waste Management', items: [
    { r: 5, t: 5, c: 'Same-day scrap pickup and instant payment. Excellent.', v: 1 },
    { r: 4, t: 4, c: 'Old fridge removed cleanly. Will use again.', v: 1 },
    { r: 5, t: 4, c: 'Very cooperative scheduling. Recommended for office clear-outs.', v: 2 },
    { r: 4, t: 5, c: 'Staff were professional and recycled everything properly.', v: 1 },
  ]},
];

const img = (name, bg) => `https://placehold.co/800x600/${bg}/ffffff?text=${encodeURIComponent(name)}`;

(async () => {
  const c = await mysql.createConnection(cfg);
  console.log('TARGET:', target);

  // 1. module images
  for (const [code, url] of Object.entries(MODULE_IMG)) {
    await c.query('UPDATE service_modules SET image = ? WHERE code = ?', [url, code]);
  }

  // 2. category descriptions + images + quick prices
  const [cats] = await c.query('SELECT id, module_id, name, price FROM service_categories');
  const [mods] = await c.query('SELECT id, code FROM service_modules');
  const modById = Object.fromEntries(mods.map((m) => [m.id, m.code]));
  let descN = 0, imgN = 0, priceN = 0;
  for (const cat of cats) {
    const desc = CATEGORY_CONTENT[cat.name];
    const code = modById[cat.module_id];
    const bg = code === 'quick-service' ? '4f46e5' : code === 'general-assistance' ? '0d9488' : 'f97316';
    const sets = []; const vals = [];
    if (desc) { sets.push('description = ?'); vals.push(desc); descN++; }
    sets.push('image = ?'); vals.push(img(cat.name, bg)); imgN++;
    if (cat.price == null && QUICK_PRICES[cat.name] != null) {
      sets.push('price = ?'); vals.push(QUICK_PRICES[cat.name]); priceN++;
    }
    await c.query(`UPDATE service_categories SET ${sets.join(', ')} WHERE id = ?`, [...vals, cat.id]);
  }
  console.log(`categories updated: desc=${descN} image=${imgN} price=${priceN}`);

  // 3. wipe prior seed
  await c.query(`DELETE FROM requests WHERE ticket_no LIKE 'VCOM-SEED-%'`);

  // 4. customers + vendors (exclude vendor-owner accounts)
  const [customers] = await c.query(
    `SELECT u.id FROM users u
      WHERE u.user_type = 'customer' AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.user_id = u.id)
      ORDER BY u.id`
  );
  const [vendors] = await c.query(`SELECT id FROM vendors ORDER BY id`);
  if (!customers.length || !vendors.length) throw new Error('need at least 1 customer and 1 vendor');
  const cust = customers.map((x) => x.id);
  const vend = vendors.map((x) => x.id);

  // 5. completed requests + reviews — named blocks first, then auto-fill remaining categories
  const AUTO_COMMENTS = [
    (n) => `Excellent ${n.toLowerCase()} service — completed on time and priced fairly.`,
    (n) => `Good experience. The technician was polite and the work quality is neat.`,
    (n) => `Quick response and professional handling. Would recommend to others.`,
    (n) => `Satisfactory job. Support team kept me updated throughout the work.`,
  ];
  const AUTO_RATINGS = [
    { r: 5, t: 5 }, { r: 4, t: 4 }, { r: 4, t: 5 }, { r: 5, t: 4 },
  ];
  const blocks = [...REVIEW_SEED];
  const seededCats = new Set(blocks.map((b) => b.cat));
  for (const cat of cats) {
    if (seededCats.has(cat.name)) continue;
    blocks.push({
      cat: cat.name,
      items: AUTO_COMMENTS.map((fn, i) => ({
        r: AUTO_RATINGS[i].r, t: AUTO_RATINGS[i].t, c: fn(cat.name),
        v: vend[i % vend.length],
      })).slice(0, 3),
    });
  }

  let reqN = 0, revN = 0, seq = 0;
  for (const block of blocks) {
    const cat = cats.find((x) => x.name === block.cat);
    if (!cat) { console.log('!! category not found:', block.cat); continue; }
    for (let i = 0; i < block.items.length; i++) {
      const it = block.items[i];
      seq++;
      const ticket = `VCOM-SEED-${String(seq).padStart(3, '0')}`;
      const customerId = cust[(seq - 1) % cust.length];
      const vendorId = vend.includes(it.v) ? it.v : vend[0];
      const [res] = await c.query(
        `INSERT INTO requests (ticket_no, customer_id, module_id, category_id, title, description,
                               status, assigned_vendor_id, source, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, 'admin', NOW() - INTERVAL ? DAY)`,
        [ticket, customerId, cat.module_id, cat.id,
         `${block.cat} — demo job #${i + 1}`,
         'Seeded demo request so the service page shows live-looking reviews.',
         vendorId, (seq % 5) + 1]
      );
      reqN++;
      await c.query(
        `INSERT INTO service_reviews
           (request_id, customer_id, module_id, category_id, vendor_id,
            service_rating, service_comment, technician_rating, technician_comment, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', NOW() - INTERVAL ? DAY)`,
        [res.insertId, customerId, cat.module_id, cat.id, vendorId,
         it.r, it.c, it.t, `Technician rating ${it.t}/5 for ${block.cat}.`, (seq % 5) + 1]
      );
      revN++;
    }
  }

  // 6. recompute vendor ratings from visible technician ratings
  for (const v of vend) {
    await c.query(
      `UPDATE vendors SET rating = COALESCE((
         SELECT ROUND(AVG(technician_rating), 2) FROM service_reviews
         WHERE vendor_id = ? AND status = 'visible' AND technician_rating IS NOT NULL
       ), 0) WHERE id = ?`,
      [v, v]
    );
  }

  const [[rc]] = await c.query('SELECT COUNT(*) c FROM service_reviews');
  const [[dc]] = await c.query('SELECT COUNT(*) c FROM service_categories WHERE description IS NOT NULL');
  const [[ic]] = await c.query('SELECT COUNT(*) c FROM service_categories WHERE image IS NOT NULL');
  const [vr] = await c.query('SELECT id, rating FROM vendors');
  console.log(`OK requests=${reqN} reviews=${revN} (total reviews=${rc.c}) desc=${dc.c}/29 img=${ic.c}/29 vendors=${JSON.stringify(vr)}`);
  await c.end();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
