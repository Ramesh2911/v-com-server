/* Hotel Bookings upgrade — 4 tables + demo seed + hotel permissions.
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

const img = (id) => `https://images.unsplash.com/photo-${id}?w=800&auto=format&fit=crop&q=80`;

// ---- demo properties (doc responses er shape onujayi) ----
const PROPERTIES = [
  ['prop-101', 'Ocean View Luxury Resort & Spa', '5-Star', 'resorts', 'Beachfront Luxury Resort',
    'Panambur Beach Road, Mangalore', 'Mangalore', 12.9463, 74.8052, 4.8, 230,
    'Experience coastal luxury at its finest with private beach access, world-class ayurvedic spa treatments, infinity sea-view pool, and sunset dining.',
    img('1540541338287-41700207dee6'),
    JSON.stringify([img('1540541338287-41700207dee6'), img('1571896349842-33c89424de2d'), img('1566073771259-6a8506099945')]),
    JSON.stringify(['Swimming Pool', 'Free High-Speed Wi-Fi', 'Private Beach Access', 'Multi-Cuisine Restaurant', 'Full-Service Spa & Ayurveda', 'Fitness Centre & Gym', '24-Hour Front Desk', 'Valet Parking', 'Airport Transfers']),
    JSON.stringify(['Infinity Swimming Pool', 'Free High-Speed Wi-Fi', 'Private Beach Access', 'Multi-Cuisine Dining']),
    '02:00 PM', '11:00 AM', 1, 0,
    'Free cancellation up to 48 hours prior to check-in. Non-refundable thereafter.', 1, 1, 95],
  ['prop-102', 'Grand Bay Beach Resort', '4-Star', 'resorts', 'Family Beach Resort',
    'Tannirbhavi Beach Road, Mangalore', 'Mangalore', 12.8784, 74.8431, 4.5, 164,
    'Family-friendly beach resort with kids pool, indoor games and fresh seafood restaurant by the shore.',
    img('1571003123894-1f0594d2b5d9'),
    JSON.stringify([img('1571003123894-1f0594d2b5d9'), img('1582719478250-c89cae4dc85b')]),
    JSON.stringify(['Swimming Pool', 'Free Wi-Fi', 'Beach Access', 'Restaurant', 'Kids Play Area', '24-Hour Front Desk']),
    JSON.stringify(['Beachfront Location', 'Kids Pool', 'Free Wi-Fi']),
    '01:00 PM', '11:00 AM', 1, 1,
    'Free cancellation up to 24 hours prior to check-in.', 1, 1, 80],
  ['prop-103', 'Heritage Palace Boutique', '5-Star', 'boutique_heritage', 'Royal Heritage Palace',
    'Saraswathipuram, Mysuru', 'Mysuru', 12.3052, 76.6552, 4.7, 198,
    'A restored royal residence with courtyard gardens, classical dining and curated Mysuru heritage experiences.',
    img('1520250497591-112f2f40a3f4'),
    JSON.stringify([img('1520250497591-112f2f40a3f4'), img('1566073771259-6a8506099945')]),
    JSON.stringify(['Heritage Architecture', 'Free Wi-Fi', 'Spa', 'Multi-Cuisine Restaurant', 'Airport Transfers', 'Concierge']),
    JSON.stringify(['Royal Courtyard', 'Heritage Dining', 'Spa & Massage']),
    '02:00 PM', '11:00 AM', 1, 0,
    'Free cancellation up to 72 hours prior to check-in.', 1, 1, 88],
  ['prop-104', 'Palm Grove Villa Retreat', '4-Star', 'villas', 'Private Pool Villa',
    'Madikeri Road, Coorg', 'Coorg', 12.4244, 75.7382, 4.6, 87,
    'Private pool villa amid coffee plantations with butler service and bonfire evenings.',
    img('1580587771525-78b9dba3b914'),
    JSON.stringify([img('1580587771525-78b9dba3b914'), img('1613490493576-7fde63acd811')]),
    JSON.stringify(['Private Pool', 'Free Wi-Fi', 'Garden', 'Barbecue', 'Parking', '24-Hour Front Desk']),
    JSON.stringify(['Private Pool', 'Plantation View', 'Bonfire Nights']),
    '02:00 PM', '10:00 AM', 0, 1,
    'Non-refundable. Reschedule allowed up to 48 hours prior.', 0, 0, 72],
  ['prop-105', 'Seaside Inn & Suites', '3-Star', 'hotels', 'Budget Beach Hotel',
    'Bunder Road, Mangalore', 'Mangalore', 12.8687, 74.8776, 4.2, 112,
    'Clean, comfortable rooms a short walk from the beach with honest pricing and warm service.',
    img('1566073771259-6a8506099945'),
    JSON.stringify([img('1566073771259-6a8506099945'), img('1590490360182-c33d57733427')]),
    JSON.stringify(['Free Wi-Fi', 'Air Conditioning', 'Restaurant', '24-Hour Front Desk', 'Parking']),
    JSON.stringify(['Near Beach', 'Budget Friendly', 'Free Wi-Fi']),
    '12:00 PM', '10:00 AM', 1, 0,
    'Free cancellation up to 24 hours prior to check-in.', 1, 1, 60],
  ['prop-106', 'Mountain Mist Resort', '4-Star', 'resorts', 'Hill View Nature Resort',
    'Raja Seat Road, Coorg', 'Coorg', 12.3375, 75.8069, 4.5, 143,
    'Misty hills resort with valley-view rooms, trekking trails and campfire dining.',
    img('1571896349842-33c89424de2d'),
    JSON.stringify([img('1571896349842-33c89424de2d'), img('1540541338287-41700207dee6')]),
    JSON.stringify(['Valley View', 'Free Wi-Fi', 'Trekking', 'Restaurant', 'Bonfire', 'Parking']),
    JSON.stringify(['Misty Valleys', 'Trekking Trails', 'Campfire Dining']),
    '02:00 PM', '11:00 AM', 1, 0,
    'Free cancellation up to 48 hours prior to check-in.', 1, 1, 76],
  ['prop-107', 'Royal Orchid Heritage Stay', 'Luxury', 'boutique_heritage', 'Boutique Heritage Haveli',
    'Jaganmohan Palace Road, Mysuru', 'Mysuru', 12.2958, 76.6394, 4.9, 76,
    'Intimate 12-room haveli with rooftop dining overlooking the palace lights.',
    img('1566073771259-6a8506099945'),
    JSON.stringify([img('1520250497591-112f2f40a3f4'), img('1571896349842-33c89424de2d')]),
    JSON.stringify(['Rooftop Dining', 'Free Wi-Fi', 'Spa', 'Concierge', 'Airport Transfers']),
    JSON.stringify(['Palace View', 'Rooftop Dining', 'Butler Service']),
    '02:00 PM', '11:00 AM', 1, 0,
    'Free cancellation up to 72 hours prior to check-in.', 1, 1, 84],
  ['prop-108', 'Goa Sands Resort & Spa', '5-Star', 'resorts', 'Beach Resort & Spa',
    'Calangute Beach Road, Goa', 'Goa', 15.5057, 73.7661, 4.7, 312,
    'Goa beachfront resort with three pools, casino lounge and ayurvedic spa by the sand.',
    img('1540541338287-41700207dee6'),
    JSON.stringify([img('1540541338287-41700207dee6'), img('1566073771259-6a8506099945'), img('1571896349842-33c89424de2d')]),
    JSON.stringify(['Swimming Pool', 'Private Beach', 'Spa', 'Casino Lounge', 'Free Wi-Fi', 'Gym', 'Airport Transfers']),
    JSON.stringify(['Three Pools', 'Beachfront Spa', 'Casino Lounge']),
    '02:00 PM', '11:00 AM', 1, 0,
    'Free cancellation up to 48 hours prior to check-in. Non-refundable thereafter.', 1, 1, 92],
  ['prop-109', 'Downtown Business Hotel', '3-Star', 'hotels', 'City Business Hotel',
    'Hampankatta Circle, Mangalore', 'Mangalore', 12.8767, 74.8846, 4.1, 98,
    'Central business hotel with conference rooms, express check-out and late dining.',
    img('1590490360182-c33d57733427'),
    JSON.stringify([img('1590490360182-c33d57733427'), img('1566073771259-6a8506099945')]),
    JSON.stringify(['Free Wi-Fi', 'Conference Room', 'Restaurant', 'Laundry', '24-Hour Front Desk']),
    JSON.stringify(['City Center', 'Business Ready', 'Express Check-out']),
    '12:00 PM', '10:00 AM', 1, 0,
    'Free cancellation up to 24 hours prior to check-in.', 1, 1, 55],
  ['prop-110', 'Private Pool Villa Cocoon', 'Luxury', 'villas', 'Luxury Private Pool Villa',
    'Anjuna Village, Goa', 'Goa', 15.5763, 73.7408, 4.9, 54,
    'Four-bedroom party villa with private infinity pool, DJ deck and chef-on-call.',
    img('1613490493576-7fde63acd811'),
    JSON.stringify([img('1613490493576-7fde63acd811'), img('1580587771525-78b9dba3b914')]),
    JSON.stringify(['Private Infinity Pool', 'Free Wi-Fi', 'DJ Deck', 'Chef on Call', 'Parking']),
    JSON.stringify(['Infinity Pool', 'DJ Deck', 'Chef on Call']),
    '03:00 PM', '11:00 AM', 0, 1,
    'Non-refundable. 50% charge within 72 hours of check-in.', 0, 0, 70],
];

// ---- rooms: [id, property_id, name, bed, size, view, adults, children, available, image, amenities, ep, cp, map, ap] ----
const ROOMS = [
  ['rm-101-1', 'prop-101', 'Deluxe Sea View Room', '1 King Bed', '420 sq. ft.', 'Direct Ocean View', 2, 1, 6,
    img('1590490360182-c33d57733427'),
    JSON.stringify(['Private Balcony', 'Smart TV', 'Mini Bar', 'Rain Shower', 'Bathtub']), 6999, 7699, 8999, 10499],
  ['rm-101-2', 'prop-101', 'Executive Beachfront Suite', '1 Super King Bed', '750 sq. ft.', 'Panoramic Beach View', 3, 2, 2,
    img('1582719478250-c89cae4dc85b'),
    JSON.stringify(['Jacuzzi', 'Living Room', 'Espresso Machine', 'Butler Service']), 11999, 12999, 14499, 15999],
  ['rm-101-3', 'prop-101', 'Garden View Twin Room', '2 Single Beds', '360 sq. ft.', 'Garden View', 2, 1, 8,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Balcony', 'Smart TV', 'Rain Shower']), 5499, 6199, 7399, 8799],
  ['rm-102-1', 'prop-102', 'Standard Family Room', '1 Queen + 1 Single Bed', '380 sq. ft.', 'Pool View', 3, 2, 10,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Air Conditioning', 'Smart TV', 'Mini Fridge']), 4299, 4899, 5999, 7199],
  ['rm-102-2', 'prop-102', 'Beach Facing Deluxe', '1 King Bed', '420 sq. ft.', 'Sea View', 2, 1, 5,
    img('1571003123894-1f0594d2b5d9'),
    JSON.stringify(['Balcony', 'Mini Bar', 'Rain Shower']), 5799, 6399, 7599, 8999],
  ['rm-103-1', 'prop-103', 'Palace Heritage Room', '1 King Bed', '450 sq. ft.', 'Courtyard View', 2, 1, 6,
    img('1520250497591-112f2f40a3f4'),
    JSON.stringify(['Antique Furnishing', 'Free Wi-Fi', 'Bathtub']), 9999, 10999, 12999, 14999],
  ['rm-103-2', 'prop-103', 'Royal Suite', '1 King Bed + Sofa', '780 sq. ft.', 'Palace View', 3, 2, 2,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Living Room', 'Butler Service', 'Jacuzzi']), 15999, 17499, 19999, 22999],
  ['rm-104-1', 'prop-104', 'Plantation Pool Villa', '1 King Bed', '900 sq. ft.', 'Plantation View', 4, 2, 3,
    img('1580587771525-78b9dba3b914'),
    JSON.stringify(['Private Pool', 'Kitchen', 'Barbecue Deck']), 12999, 14499, 16999, 19499],
  ['rm-104-2', 'prop-104', 'Garden Cottage', '1 Queen Bed', '400 sq. ft.', 'Garden View', 2, 1, 4,
    img('1613490493576-7fde63acd811'),
    JSON.stringify(['Sit-out', 'Free Wi-Fi', 'Tea Maker']), 7499, 8299, 9799, 11499],
  ['rm-105-1', 'prop-105', 'Cozy Double Room', '1 Double Bed', '260 sq. ft.', 'City View', 2, 1, 12,
    img('1590490360182-c33d57733427'),
    JSON.stringify(['Air Conditioning', 'Free Wi-Fi', 'TV']), 2499, 2899, 3499, 4199],
  ['rm-105-2', 'prop-105', 'Triple Family Room', '1 Queen + 1 Single Bed', '320 sq. ft.', 'Street View', 3, 2, 6,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Air Conditioning', 'Free Wi-Fi', 'TV']), 3199, 3599, 4299, 5099],
  ['rm-106-1', 'prop-106', 'Valley View Deluxe', '1 King Bed', '400 sq. ft.', 'Valley View', 2, 1, 7,
    img('1571896349842-33c89424de2d'),
    JSON.stringify(['Balcony', 'Heater', 'Free Wi-Fi']), 5999, 6699, 7999, 9499],
  ['rm-106-2', 'prop-106', 'Misty Twin Room', '2 Single Beds', '340 sq. ft.', 'Hill View', 2, 1, 6,
    img('1540541338287-41700207dee6'),
    JSON.stringify(['Heater', 'Free Wi-Fi', 'TV']), 4999, 5599, 6699, 7999],
  ['rm-107-1', 'prop-107', 'Haveli Deluxe Room', '1 King Bed', '430 sq. ft.', 'Palace Lights View', 2, 1, 5,
    img('1520250497591-112f2f40a3f4'),
    JSON.stringify(['Handcrafted Interiors', 'Free Wi-Fi', 'Bathtub']), 11999, 13299, 15499, 17999],
  ['rm-107-2', 'prop-107', 'Rooftop Terrace Suite', '1 King Bed + Sofa', '690 sq. ft.', 'Rooftop Terrace', 3, 2, 2,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Private Terrace', 'Butler Service', 'Jacuzzi']), 18999, 20999, 23999, 27999],
  ['rm-108-1', 'prop-108', 'Sand Side Deluxe', '1 King Bed', '440 sq. ft.', 'Beach View', 2, 1, 9,
    img('1540541338287-41700207dee6'),
    JSON.stringify(['Balcony', 'Mini Bar', 'Rain Shower']), 8999, 9899, 11799, 13999],
  ['rm-108-2', 'prop-108', 'Pool Access Room', '1 King Bed', '460 sq. ft.', 'Pool Access', 2, 2, 5,
    img('1571896349842-33c89424de2d'),
    JSON.stringify(['Direct Pool Access', 'Sun Loungers', 'Mini Bar']), 10499, 11599, 13499, 15999],
  ['rm-109-1', 'prop-109', 'Business Single', '1 Single Bed', '220 sq. ft.', 'City View', 1, 0, 14,
    img('1590490360182-c33d57733427'),
    JSON.stringify(['Work Desk', 'Free Wi-Fi', 'TV']), 2199, 2549, 3049, 3649],
  ['rm-109-2', 'prop-109', 'Executive Double', '1 Queen Bed', '300 sq. ft.', 'City View', 2, 1, 8,
    img('1566073771259-6a8506099945'),
    JSON.stringify(['Work Desk', 'Free Wi-Fi', 'Mini Fridge']), 2999, 3399, 4049, 4799],
  ['rm-110-1', 'prop-110', 'Infinity Villa 4BHK', '4 King Beds', '3200 sq. ft.', 'Pool & Sea View', 8, 4, 1,
    img('1613490493576-7fde63acd811'),
    JSON.stringify(['Infinity Pool', 'DJ Deck', 'Chef Kitchen', 'Sound System']), 34999, 38999, 44999, 51999],
  ['rm-110-2', 'prop-110', 'Poolside Master Suite', '1 King Bed', '520 sq. ft.', 'Pool View', 2, 2, 2,
    img('1580587771525-78b9dba3b914'),
    JSON.stringify(['Pool Access', 'Outdoor Shower', 'Mini Bar']), 13999, 15499, 17999, 20999],
];

async function upgrade(cfg, label) {
  const conn = await mysql.createConnection(cfg);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS hotel_properties (
        id VARCHAR(20) NOT NULL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        star_rating ENUM('3-Star','4-Star','5-Star','Luxury') NOT NULL DEFAULT '3-Star',
        category_id VARCHAR(30) NOT NULL,
        property_type VARCHAR(100) NULL,
        location VARCHAR(255) NOT NULL,
        city VARCHAR(60) NOT NULL,
        gps_lat DECIMAL(10,7) NULL,
        gps_lng DECIMAL(10,7) NULL,
        guest_rating DECIMAL(2,1) NOT NULL DEFAULT 0,
        reviews_count INT UNSIGNED NOT NULL DEFAULT 0,
        description TEXT NULL,
        main_image VARCHAR(500) NULL,
        gallery_images JSON NULL,
        amenities JSON NULL,
        key_amenities JSON NULL,
        check_in_time VARCHAR(20) NOT NULL DEFAULT '02:00 PM',
        check_out_time VARCHAR(20) NOT NULL DEFAULT '11:00 AM',
        id_proof_mandatory TINYINT(1) NOT NULL DEFAULT 1,
        pet_friendly TINYINT(1) NOT NULL DEFAULT 0,
        cancellation_policy VARCHAR(500) NULL,
        has_free_cancellation TINYINT(1) NOT NULL DEFAULT 1,
        has_breakfast_included TINYINT(1) NOT NULL DEFAULT 0,
        popular_score INT NOT NULL DEFAULT 0,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_hp_city (city),
        KEY idx_hp_category (category_id),
        KEY idx_hp_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] hotel_properties table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS hotel_rooms (
        id VARCHAR(20) NOT NULL PRIMARY KEY,
        property_id VARCHAR(20) NOT NULL,
        room_name VARCHAR(120) NOT NULL,
        bed_type VARCHAR(60) NULL,
        room_size VARCHAR(40) NULL,
        view VARCHAR(80) NULL,
        max_adults INT UNSIGNED NOT NULL DEFAULT 2,
        max_children INT UNSIGNED NOT NULL DEFAULT 1,
        available_rooms INT UNSIGNED NOT NULL DEFAULT 1,
        image_url VARCHAR(500) NULL,
        amenities JSON NULL,
        ep_rate DECIMAL(10,2) NOT NULL,
        cp_rate DECIMAL(10,2) NOT NULL,
        map_rate DECIMAL(10,2) NOT NULL,
        ap_rate DECIMAL(10,2) NOT NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_hr_property (property_id),
        CONSTRAINT fk_hr_property FOREIGN KEY (property_id) REFERENCES hotel_properties(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] hotel_rooms table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS hotel_reservations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reservation_code VARCHAR(30) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        property_id VARCHAR(20) NOT NULL,
        room_id VARCHAR(20) NOT NULL,
        meal_plan ENUM('EP','CP','MAP','AP') NOT NULL DEFAULT 'CP',
        check_in_date DATE NOT NULL,
        check_out_date DATE NOT NULL,
        number_of_nights INT UNSIGNED NOT NULL,
        number_of_rooms INT UNSIGNED NOT NULL DEFAULT 1,
        adults INT UNSIGNED NOT NULL DEFAULT 1,
        children INT UNSIGNED NOT NULL DEFAULT 0,
        guest_name VARCHAR(120) NOT NULL,
        guest_phone VARCHAR(30) NULL,
        guest_email VARCHAR(120) NULL,
        special_requests TEXT NULL,
        payment_method ENUM('pay_at_hotel','online') NOT NULL DEFAULT 'pay_at_hotel',
        payment_status VARCHAR(30) NOT NULL DEFAULT 'PAY_AT_PROPERTY',
        booking_status ENUM('CONFIRMED','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'CONFIRMED',
        room_tariff DECIMAL(12,2) NOT NULL,
        taxes_gst DECIMAL(12,2) NOT NULL DEFAULT 0,
        extras DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        voucher_pdf_path VARCHAR(300) NULL,
        cancellation_reason VARCHAR(500) NULL,
        cancelled_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_hres_code (reservation_code),
        KEY idx_hres_user (user_id),
        KEY idx_hres_property (property_id),
        KEY idx_hres_room (room_id),
        KEY idx_hres_status (booking_status),
        KEY idx_hres_dates (room_id, check_in_date, check_out_date),
        CONSTRAINT fk_hres_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_hres_property FOREIGN KEY (property_id) REFERENCES hotel_properties(id) ON DELETE CASCADE,
        CONSTRAINT fk_hres_room FOREIGN KEY (room_id) REFERENCES hotel_rooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] hotel_reservations table ok`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS hotel_reviews (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT UNSIGNED NOT NULL,
        property_id VARCHAR(20) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        overall_rating TINYINT UNSIGNED NOT NULL,
        cleanliness_rating TINYINT UNSIGNED NOT NULL,
        room_comfort_rating TINYINT UNSIGNED NOT NULL,
        staff_behaviour_rating TINYINT UNSIGNED NOT NULL,
        food_quality_rating TINYINT UNSIGNED NOT NULL,
        amenities_rating TINYINT UNSIGNED NOT NULL,
        value_for_money_rating TINYINT UNSIGNED NOT NULL,
        review_text TEXT NULL,
        stay_type VARCHAR(60) NULL,
        would_recommend TINYINT(1) NOT NULL DEFAULT 1,
        status ENUM('published','hidden') NOT NULL DEFAULT 'published',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_hrev_reservation (reservation_id),
        KEY idx_hrev_property (property_id),
        CONSTRAINT fk_hrev_reservation FOREIGN KEY (reservation_id) REFERENCES hotel_reservations(id) ON DELETE CASCADE,
        CONSTRAINT fk_hrev_property FOREIGN KEY (property_id) REFERENCES hotel_properties(id) ON DELETE CASCADE,
        CONSTRAINT fk_hrev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`[${label}] hotel_reviews table ok`);

    // ---- seed properties + rooms (only when empty) ----
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM hotel_properties');
    if (n === 0) {
      for (const p of PROPERTIES) {
        await conn.query(
          `INSERT INTO hotel_properties
             (id, name, star_rating, category_id, property_type, location, city, gps_lat, gps_lng,
              guest_rating, reviews_count, description, main_image, gallery_images, amenities, key_amenities,
              check_in_time, check_out_time, id_proof_mandatory, pet_friendly, cancellation_policy,
              has_free_cancellation, has_breakfast_included, popular_score)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          p
        );
      }
      console.log(`[${label}] seeded ${PROPERTIES.length} properties`);
    } else {
      console.log(`[${label}] properties already present (${n}) — skip seed`);
    }

    const [[{ rn }]] = await conn.query('SELECT COUNT(*) AS rn FROM hotel_rooms');
    if (rn === 0) {
      for (const r of ROOMS) {
        await conn.query(
          `INSERT INTO hotel_rooms
             (id, property_id, room_name, bed_type, room_size, view, max_adults, max_children,
              available_rooms, image_url, amenities, ep_rate, cp_rate, map_rate, ap_rate)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          r
        );
      }
      console.log(`[${label}] seeded ${ROOMS.length} rooms`);
    } else {
      console.log(`[${label}] rooms already present (${rn}) — skip seed`);
    }

    // ---- demo reservations (customer@vcom.com = user 6) ----
    const [[{ hn }]] = await conn.query('SELECT COUNT(*) AS hn FROM hotel_reservations');
    if (hn === 0) {
      // VCB-2026-001245 — doc example exactly (CP 7699 x 2 nights = 15398 + 18% GST)
      await conn.query(
        `INSERT INTO hotel_reservations
           (reservation_code, user_id, property_id, room_id, meal_plan, check_in_date, check_out_date,
            number_of_nights, number_of_rooms, adults, children, guest_name, guest_phone, guest_email,
            special_requests, payment_method, payment_status, booking_status,
            room_tariff, taxes_gst, extras, total_amount)
         VALUES ('VCB-2026-001245', 6, 'prop-101', 'rm-101-1', 'CP', '2026-11-27', '2026-11-29',
            2, 1, 2, 0, 'Suhail Ahmed', '+91 98765 43210', 'suhail.ahmed@example.com',
            'Non-smoking room on upper floor please.', 'pay_at_hotel', 'PAY_AT_PROPERTY', 'CONFIRMED',
            15398.00, 2771.64, 0, 18169.64)`
      );
      // completed past stay → review demo
      await conn.query(
        `INSERT INTO hotel_reservations
           (reservation_code, user_id, property_id, room_id, meal_plan, check_in_date, check_out_date,
            number_of_nights, number_of_rooms, adults, children, guest_name, guest_phone, guest_email,
            payment_method, payment_status, booking_status,
            room_tariff, taxes_gst, extras, total_amount)
         VALUES ('VCB-2026-000987', 6, 'prop-105', 'rm-105-1', 'CP', '2026-10-10', '2026-10-12',
            2, 1, 2, 0, 'Demo Customer', '9830000006', 'customer@vcom.com',
            'pay_at_hotel', 'PAID', 'COMPLETED',
            5798.00, 1043.64, 0, 6841.64)`
      );
      console.log(`[${label}] seeded 2 demo reservations`);
    } else {
      console.log(`[${label}] reservations already present (${hn}) — skip seed`);
    }

    // ---- demo review on the completed stay ----
    const [[{ vn }]] = await conn.query('SELECT COUNT(*) AS vn FROM hotel_reviews');
    if (vn === 0) {
      await conn.query(
        `INSERT INTO hotel_reviews
           (reservation_id, property_id, user_id, overall_rating, cleanliness_rating, room_comfort_rating,
            staff_behaviour_rating, food_quality_rating, amenities_rating, value_for_money_rating,
            review_text, stay_type, would_recommend, status)
         SELECT r.id, r.property_id, r.user_id, 5, 5, 4, 5, 4, 4, 5,
                'Clean rooms, warm staff and a short walk to the beach. Great value for the price.',
                'Family Vacation', 1, 'published'
           FROM hotel_reservations r WHERE r.reservation_code = 'VCB-2026-000987'`
      );
      await conn.query(`UPDATE hotel_properties SET guest_rating = 4.2, reviews_count = 113 WHERE id = 'prop-105'`);
      console.log(`[${label}] seeded 1 demo review`);
    } else {
      console.log(`[${label}] reviews already present (${vn}) — skip seed`);
    }

    // ---- permissions (hotel.view / hotel.manage) + grants to Super Admin(1) + Operations Manager(2) ----
    for (const [code, labelTxt] of [['hotel.view', 'View hotel bookings'], ['hotel.manage', 'Manage hotel bookings']]) {
      const [[perm]] = await conn.query('SELECT id FROM permissions WHERE code = ?', [code]);
      let permId;
      if (perm) {
        permId = perm.id;
      } else {
        const [r] = await conn.query('INSERT INTO permissions (code, module, label) VALUES (?, ?, ?)', [code, 'hotel', labelTxt]);
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
