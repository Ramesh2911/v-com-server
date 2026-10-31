/* eslint-disable no-console */
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const MODULES = [
  { code: 'special-service', name: 'Special Service', icon: 'sparkles', description: 'Full-service, specialist offerings for homes, offices and businesses.' },
  { code: 'quick-service', name: 'Quick Service', icon: 'wrench', description: 'Fast, on-demand repair and maintenance jobs with transparent pricing.' },
  { code: 'general-assistance', name: 'General Assistance', icon: 'megaphone', description: 'Everyday help — emergencies, staffing, events, bookings and more.' },
];

const CATEGORIES = {
  'special-service': [
    'Fabrication and Welding',
    'CCTV and Automation',
    'Packers and Movers',
    'Website and Graphic Designing',
    'Pest Control and Deep Cleaning',
    'Interior and Office Inventory',
    'Electrical and Plumbing',
    'Construction, Renovation and Documentation',
    'Accounting and Statutory',
    'Fire and Safety',
    'Housekeeping and Security',
    'Event and Corporate Arrangements',
    'Computer and Hardware',
    'HVAC',
    'Gardening and Landscaping',
    'Water & Sewage Treatment',
    'Special Care & Health Care',
  ],
  'quick-service': [
    'Electrical Work',
    'Plumbing Work',
    'Carpentry Work',
    'Air Conditioning Work',
    'Building Maintenance Work',
    'Repair Work (Any Category)',
  ],
  'general-assistance': [
    'SOS/Emergency',
    'HR and Recruitment',
    'Events and Exhibitions',
    'Bookings and Admissions',
    'Travel and Insurance Schemes',
    'Scrap and Waste Management',
  ],
};

const PERMISSIONS = [
  ['dashboard.view', 'dashboard', 'View dashboard'],
  ['customers.view', 'customers', 'View customers'],
  ['customers.manage', 'customers', 'Manage customers'],
  ['vendors.view', 'vendors', 'View vendors'],
  ['vendors.approve', 'vendors', 'Approve / reject vendors'],
  ['vendors.manage', 'vendors', 'Manage vendors'],
  ['requests.view', 'requests', 'View requests'],
  ['requests.manage', 'requests', 'Manage requests'],
  ['requests.assign', 'requests', 'Assign vendors to requests'],
  ['quotations.view', 'quotations', 'View quotations'],
  ['quotations.manage', 'quotations', 'Review quotations'],
  ['jobs.view', 'jobs', 'View jobs / orders'],
  ['jobs.manage', 'jobs', 'Manage jobs / orders'],
  ['sos.view', 'sos', 'View SOS tickets'],
  ['sos.manage', 'sos', 'Manage SOS tickets'],
  ['properties.view', 'properties', 'View properties'],
  ['properties.manage', 'properties', 'Manage properties'],
  ['properties.enquiries', 'properties', 'Manage property enquiries'],
  ['services.view', 'services', 'View services & content'],
  ['services.manage', 'services', 'Manage services & content'],
  ['hr.view', 'hr', 'View HR data'],
  ['hr.manage', 'hr', 'Manage HR (attendance, leaves)'],
  ['notifications.manage', 'notifications', 'Manage notification templates'],
  ['reports.view', 'reports', 'View reports'],
  ['reports.export', 'reports', 'Export reports'],
  ['roles.manage', 'roles', 'Manage roles & permissions'],
  ['staff.manage', 'staff', 'Manage staff accounts'],
  ['support.manage', 'support', 'Manage support tickets'],
  ['settings.manage', 'settings', 'Manage system settings'],
  ['audit.view', 'audit', 'View audit logs'],
  ['modules.all', 'modules', 'Access all service modules'],
];

const MODULE_ACCESS = MODULES.map((m) => [
  `module.${m.code}.access`,
  'modules',
  `Access ${m.name} module`,
]);
MODULE_ACCESS.push(['module.sos.access', 'modules', 'Access SOS module']);
MODULE_ACCESS.push(['module.hr.access', 'modules', 'Access HR module']);

const ROLES = [
  {
    name: 'Super Admin',
    slug: 'super_admin',
    is_system: 1,
    description: 'Full system access',
    permissions: PERMISSIONS.map((p) => p[0]),
  },
  {
    name: 'Operations Manager',
    slug: 'operations_manager',
    is_system: 0,
    description: 'Manages requests, vendors, quotations and jobs across modules',
    permissions: [
      'dashboard.view', 'customers.view', 'vendors.view', 'vendors.approve', 'vendors.manage',
      'requests.view', 'requests.manage', 'requests.assign',
      'quotations.view', 'quotations.manage', 'jobs.view', 'jobs.manage',
      'services.view', 'reports.view', 'reports.export', 'support.manage',
      'properties.view', 'properties.manage', 'properties.enquiries',
      ...MODULE_ACCESS.map((p) => p[0]),
    ],
  },
  {
    name: 'HR Manager',
    slug: 'hr_manager',
    is_system: 0,
    description: 'Manages employees, attendance and leaves',
    permissions: ['dashboard.view', 'hr.view', 'hr.manage', 'module.hr.access', 'staff.view'],
  },
  {
    name: 'SOS Coordinator',
    slug: 'sos_coordinator',
    is_system: 0,
    description: 'Handles emergency SOS tickets',
    permissions: ['dashboard.view', 'sos.view', 'sos.manage', 'module.sos.access', 'requests.view'],
  },
  ...MODULES.map((m) => ({
    name: `${m.name} Manager`,
    slug: `${m.code.replace(/-/g, '_')}_manager`,
    is_system: 0,
    description: `Manages ${m.name} requests and jobs`,
    permissions: [
      'dashboard.view', 'requests.view', 'requests.manage', 'requests.assign',
      'quotations.view', 'quotations.manage', 'jobs.view', 'jobs.manage',
      'vendors.view', `module.${m.code}.access`, 'reports.view',
    ],
  })),
];

const TEMPLATES = [
  ['request_created', 'in_app', 'New request {{ticket_no}}', 'A new {{module}} request has been submitted.'],
  ['request_assigned', 'in_app', 'Request {{ticket_no}} assigned', 'Request {{ticket_no}} has been assigned to you.'],
  ['request_status_updated', 'in_app', 'Request {{ticket_no}} — {{status}}', 'Your request status changed to {{status}}.'],
  ['quotation_submitted', 'in_app', 'Quotation {{ticket_no}} received', 'A quotation has been submitted for request {{request_ticket}}.'],
  ['quotation_decision', 'in_app', 'Quotation {{ticket_no}} — {{status}}', 'Your quotation for {{request_ticket}} was {{status}}.'],
  ['job_stage_updated', 'in_app', 'Job {{job_no}} — {{stage}}', 'Job status updated to {{stage}}.'],
  ['sos_created', 'in_app', 'SOS Alert {{ticket_no}}', 'An emergency SOS ticket has been raised.'],
  ['sos_status_updated', 'in_app', 'SOS {{ticket_no}} — {{status}}', 'SOS ticket status updated to {{status}}.'],
  ['leave_requested', 'in_app', 'Leave request {{leave_no}}', 'A new leave request awaits approval.'],
  ['leave_reviewed', 'in_app', 'Leave {{leave_no}} — {{status}}', 'Your leave request was {{status}}.'],
  ['property_enquiry', 'in_app', 'Property enquiry {{ticket_no}}', 'New enquiry received for property: {{property_title}}.'],
  ['vendor_status', 'in_app', 'Vendor account — {{status}}', 'Your vendor account status is now {{status}}.'],
  ['welcome', 'in_app', 'Welcome to V_COM', 'Your account has been created successfully.'],
  ['support_reply', 'in_app', 'Support ticket {{ticket_no}}', 'There is a reply on your support ticket.'],
];

const SETTINGS = [
  ['app_name', 'V_COM', 'general', 'Application Name'],
  ['support_email', 'support@vcom.com', 'general', 'Support Email'],
  ['support_phone', '+91 98765 43210', 'general', 'Support Phone'],
  ['company_address', 'V_COM HQ, India', 'general', 'Company Address'],
  ['currency', 'INR', 'general', 'Currency'],
  ['default_tax_rate', '18', 'pricing', 'Default Tax Rate (%)'],
  ['sos_enabled', '1', 'sos', 'SOS Feature Enabled'],
  ['sos_escalation_minutes', '15', 'sos', 'SOS Escalation Window (minutes)'],
  ['property_max_media', '15', 'properties', 'Max Property Media Files'],
  ['enquiry_auto_close_days', '30', 'workflow', 'Auto-close inactive requests (days)'],
  ['vendor_auto_assign', '0', 'workflow', 'Auto-assign requests to vendors'],
  ['maintenance_mode', '0', 'general', 'Maintenance Mode'],
];

const BUILDERS = [
  ['Skyline Builders', 'Premium residential and commercial developer'],
  ['Green Heights Infra', 'Township and plotted development specialists'],
  ['Urban Nest Realty', 'Affordable housing and rental projects'],
];
const PROJECTS = [
  [1, 'Skyline Residency', '3 & 4 BHK luxury apartments with clubhouse'],
  [1, 'Skyline Business Park', 'Modern office spaces in the IT corridor'],
  [2, 'Green Heights Township', 'Plotted township with park and schools'],
  [3, 'Urban Nest Flats', 'Affordable 1 & 2 BHK homes'],
];
const AREAS = [
  ['Whitefield', 'Bangalore East', 'Bangalore'],
  ['HSR Layout', 'South Bangalore', 'Bangalore'],
  ['Electronic City', 'South Bangalore', 'Bangalore'],
  ['Andheri West', 'Mumbai Suburban', 'Mumbai'],
  ['Baner', 'Pune West', 'Pune'],
];

async function seed() {
  const conn = await pool.getConnection();
  try {
    console.log('Seeding database...');
    await conn.beginTransaction();

    // ---- permissions ----
    const allPerms = [...PERMISSIONS, ...MODULE_ACCESS];
    for (const [code, module, label] of allPerms) {
      await conn.query(
        `INSERT INTO permissions (code, module, label) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE module = VALUES(module), label = VALUES(label)`,
        [code, module, label]
      );
    }
    const [permRows] = await conn.query('SELECT id, code FROM permissions');
    const permMap = Object.fromEntries(permRows.map((p) => [p.code, p.id]));
    console.log(`  permissions: ${permRows.length}`);

    // ---- roles ----
    for (const role of ROLES) {
      await conn.query(
        `INSERT INTO roles (name, slug, description, is_system, status) VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
        [role.name, role.slug, role.description, role.is_system]
      );
      const [[roleRow]] = await conn.query('SELECT id FROM roles WHERE slug = ?', [role.slug]);
      await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleRow.id]);
      for (const code of role.permissions) {
        if (permMap[code]) {
          await conn.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
            roleRow.id,
            permMap[code],
          ]);
        }
      }
    }
    console.log(`  roles: ${ROLES.length}`);

    // ---- service modules + categories ----
    MODULES.forEach(async () => {});
    for (let i = 0; i < MODULES.length; i++) {
      const m = MODULES[i];
      await conn.query(
        `INSERT INTO service_modules (code, name, description, icon, status, sort_order)
         VALUES (?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), icon = VALUES(icon)`,
        [m.code, m.name, m.description, m.icon, i + 1]
      );
      const [[mod]] = await conn.query('SELECT id FROM service_modules WHERE code = ?', [m.code]);
      const cats = CATEGORIES[m.code] || [];
      for (let j = 0; j < cats.length; j++) {
        await conn.query(
          `INSERT INTO service_categories (module_id, name, is_featured, status, sort_order)
           VALUES (?, ?, ?, 1, ?)`,
          [mod.id, cats[j], j < 2 ? 1 : 0, j + 1]
        );
      }
    }
    console.log(`  modules: ${MODULES.length}, categories: ${Object.values(CATEGORIES).flat().length}`);

    // ---- users ----
    const [[superRole]] = await conn.query(`SELECT id FROM roles WHERE slug = 'super_admin'`);
    const [[opsRole]] = await conn.query(`SELECT id FROM roles WHERE slug = 'operations_manager'`);
    const [[hrRole]] = await conn.query(`SELECT id FROM roles WHERE slug = 'hr_manager'`);
    const [[sosRole]] = await conn.query(`SELECT id FROM roles WHERE slug = 'sos_coordinator'`);
    const [[specialRole]] = await conn.query(`SELECT id FROM roles WHERE slug = 'special_service_manager'`);

    const hash = (pw) => bcrypt.hashSync(pw, 10);
    const users = [
      { name: 'Super Admin', email: 'admin@vcom.com', phone: '9000000001', pw: 'Admin@123', type: 'staff', role: superRole.id },
      { name: 'Ravi Operations', email: 'ops@vcom.com', phone: '9000000002', pw: 'Ops@123', type: 'staff', role: opsRole.id },
      { name: 'Priya HR', email: 'hr@vcom.com', phone: '9000000003', pw: 'Hr@12345', type: 'staff', role: hrRole.id },
      { name: 'SOS Control', email: 'sos@vcom.com', phone: '9000000004', pw: 'Sos@1234', type: 'staff', role: sosRole.id },
      { name: 'CCTV Manager', email: 'cctv@vcom.com', phone: '9000000005', pw: 'Cctv@1234', type: 'staff', role: specialRole ? specialRole.id : opsRole.id },
      { name: 'Amit Sharma', email: 'customer@vcom.com', phone: '9876500001', pw: 'Customer@123', type: 'customer', role: null },
      { name: 'Neha Verma', email: 'customer2@vcom.com', phone: '9876500002', pw: 'Customer@123', type: 'customer', role: null },
      { name: 'SecureTech Solutions', email: 'vendor@vcom.com', phone: '9876500003', pw: 'Vendor@123', type: 'customer', role: null },
      { name: 'QuickScrap Co', email: 'vendor2@vcom.com', phone: '9876500004', pw: 'Vendor@123', type: 'customer', role: null },
      { name: 'Rahul Employee', email: 'employee@vcom.com', phone: '9876500005', pw: 'Employee@123', type: 'employee', role: null },
    ];
    const userIds = {};
    for (const u of users) {
      await conn.query(
        `INSERT INTO users (name, email, phone, password_hash, user_type, role_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone)`,
        [u.name, u.email, u.phone, hash(u.pw), u.type, u.role]
      );
      const [[row]] = await conn.query('SELECT id FROM users WHERE email = ?', [u.email]);
      userIds[u.email] = row.id;
    }
    console.log(`  users: ${users.length}`);

    // ---- vendors ----
    const [[cctvCat]] = await conn.query(
      `SELECT c.id FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE m.code = 'special-service' AND c.name = 'CCTV and Automation' LIMIT 1`
    );
    const [[scrapCat]] = await conn.query(
      `SELECT c.id FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE m.code = 'general-assistance' AND c.name = 'Scrap and Waste Management' LIMIT 1`
    );
    const vendors = [
      {
        user: 'vendor@vcom.com', business: 'SecureTech Solutions', contact: 'Vikram Singh',
        city: 'Bangalore', status: 'approved', cats: [cctvCat.id], coverage: 'Bangalore, Mysore',
      },
      {
        user: 'vendor2@vcom.com', business: 'QuickScrap Co', contact: 'Sameer Khan',
        city: 'Bangalore', status: 'pending', cats: [scrapCat.id], coverage: 'Bangalore East',
      },
    ];
    for (const v of vendors) {
      await conn.query(
        `INSERT INTO vendors (user_id, business_name, contact_person, city, coverage_areas, status, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, IF(? = 'approved', NOW(), NULL))
         ON DUPLICATE KEY UPDATE business_name = VALUES(business_name), status = VALUES(status)`,
        [userIds[v.user], v.business, v.contact, v.city, v.coverage, v.status, superRole ? userIds['admin@vcom.com'] : null, v.status]
      );
      const [[ven]] = await conn.query('SELECT id FROM vendors WHERE user_id = ?', [userIds[v.user]]);
      for (const catId of v.cats) {
        await conn.query('INSERT IGNORE INTO vendor_service_categories (vendor_id, category_id) VALUES (?, ?)', [
          ven.id, catId,
        ]);
      }
    }
    console.log(`  vendors: ${vendors.length}`);

    // ---- employee ----
    await conn.query(
      `INSERT INTO employees (user_id, employee_code, designation, department, date_of_joining, status)
       VALUES (?, 'EMP-001', 'Frontend Developer', 'Technology', '2024-06-01', 'active')
       ON DUPLICATE KEY UPDATE designation = VALUES(designation)`,
      [userIds['employee@vcom.com']]
    );

    // ---- notification templates ----
    for (const [code, channel, title, body] of TEMPLATES) {
      await conn.query(
        `INSERT INTO notification_templates (event_code, channel, title_template, body_template, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE title_template = VALUES(title_template), body_template = VALUES(body_template)`,
        [code, channel, title, body]
      );
    }
    console.log(`  notification templates: ${TEMPLATES.length}`);

    // ---- settings ----
    for (const [key, value, group, label] of SETTINGS) {
      await conn.query(
        `INSERT INTO settings (setting_key, setting_value, setting_group, label)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value, group, label]
      );
    }
    console.log(`  settings: ${SETTINGS.length}`);

    // ---- properties ----
    for (const [name, desc] of BUILDERS) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await conn.query(
        `INSERT INTO builders (name, slug, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [name, slug, desc]
      );
    }
    const [builderRows] = await conn.query('SELECT id, name FROM builders');
    const builderMap = Object.fromEntries(builderRows.map((b) => [b.name, b.id]));
    const builderNames = builderRows.map((b) => b.name);

    for (let i = 0; i < PROJECTS.length; i++) {
      const [builderName, name, desc] = PROJECTS[i];
      const bId = builderMap[builderName] || builderMap[builderNames[i % builderNames.length]];
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await conn.query(
        `INSERT INTO projects (builder_id, name, slug, description) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description), builder_id = VALUES(builder_id)`,
        [bId, name, slug, desc]
      );
    }
    for (const [name, locality, city] of AREAS) {
      await conn.query(
        `INSERT INTO areas (name, locality, city) VALUES (?, ?, ?)`,
        [name, locality, city]
      );
    }
    const [[proj1]] = await conn.query(`SELECT id FROM projects WHERE slug = 'skyline-residency'`);
    const [[proj2]] = await conn.query(`SELECT id FROM projects WHERE slug = 'green-heights-township'`);
    const [[area1]] = await conn.query(`SELECT id FROM areas WHERE name = 'Whitefield'`);
    const [[area2]] = await conn.query(`SELECT id FROM areas WHERE name = 'Baner'`);
    const [[area3]] = await conn.query(`SELECT id FROM areas WHERE name = 'HSR Layout'`);
    if (builderMap['Skyline Builders'] && proj1 && area1) {
      await conn.query(
        `INSERT INTO properties (property_code, builder_id, project_id, area_id, title, description, listing_type, property_type,
          area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms, address, status, is_featured, created_by)
         VALUES ('VCOM-PROP-000001', ?, ?, ?, 'Premium 3 BHK Skyline Residency',
           'Spacious 3 BHK apartment with modular kitchen, covered parking and clubhouse access. East facing, Vaastu compliant.',
           'sale', 'apartment', 1650.00, 'East', 7, 14, 12500000.00, 7575.76, 3, 3, 'Skyline Residency, Whitefield, Bangalore',
           'available', 1, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [builderMap['Skyline Builders'], proj1.id, area1.id, userIds['admin@vcom.com']]
      );
      await conn.query(
        `INSERT INTO properties (property_code, builder_id, project_id, area_id, title, description, listing_type, property_type,
          area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms, address, status, is_featured, created_by)
         VALUES ('VCOM-PROP-000002', ?, ?, ?, '2 BHK Rental Flat — Green Heights',
           'Semi-furnished 2 BHK available for rent. Gated community with 24x7 security, power backup and children park.',
           'rent', 'apartment', 1100.00, 'North', 3, 9, 28000.00, NULL, 2, 2, 'Green Heights Township, Baner, Pune',
           'available', 0, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [builderMap['Green Heights Infra'], proj2.id, area2.id, userIds['admin@vcom.com']]
      );
      await conn.query(
        `INSERT INTO properties (property_code, builder_id, project_id, area_id, title, description, listing_type, property_type,
          area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms, address, status, is_featured, created_by)
         VALUES ('VCOM-PROP-000003', ?, ?, ?, 'Commercial Office Space — HSR',
           'Ready-to-move 2200 sqft office space with conference room, pantry and 6 covered parking lots.',
           'sale', 'commercial', 2200.00, 'West', 2, 5, 18500000.00, 8409.09, NULL, 2, 'HSR Layout, Bangalore',
           'available', 1, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [builderMap['Urban Nest Realty'], null, area3.id, userIds['admin@vcom.com']]
      );
      console.log('  properties: 3');
    }

    await conn.commit();
    console.log('Seed complete.');
    console.log('\nDemo logins (email / password):');
    console.log('  Super Admin   admin@vcom.com / Admin@123');
    console.log('  Operations    ops@vcom.com / Ops@123');
    console.log('  HR Manager    hr@vcom.com / Hr@12345');
    console.log('  SOS Coord     sos@vcom.com / Sos@1234');
    console.log('  Special Service Manager  cctv@vcom.com / Cctv@1234');
    console.log('  Customer      customer@vcom.com / Customer@123');
    console.log('  Vendor        vendor@vcom.com / Vendor@123');
    console.log('  Employee      employee@vcom.com / Employee@123');
  } catch (err) {
    await conn.rollback();
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    pool.end();
  }
}

seed();
