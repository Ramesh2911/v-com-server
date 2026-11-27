const SCRAP_CATEGORIES = [
  { id: 1, code: 'PAPER', name: 'Paper & Newspapers', description: 'Old newspapers, books, cartons', image: 'imageling', theme_color: '#0284C7' },
  { id: 2, code: 'CARDBOARD', name: 'Cardboard & Cartons', description: 'Corrugated boxes, packaging cartons', image: 'imageling', theme_color: '#D97706' },
  { id: 3, code: 'IRON_STEEL', name: 'Iron & Steel Scraps', description: 'Rods, grills, sheets, MS scrap', image: 'imageling', theme_color: '#475569' },
  { id: 4, code: 'METALS', name: 'Copper, Brass & Aluminium', description: 'Wires, utensils, pipes, motors', image: 'imageling', theme_color: '#EA580C' },
  { id: 5, code: 'PLASTIC', name: 'Plastic Bottles & Items', description: 'Water bottles, HDPE containers, buckets', image: 'imageling', theme_color: '#16A34A' },
  { id: 6, code: 'E_WASTE', name: 'E-Waste & Electronics', description: 'Laptops, cables, batteries, PCBs', image: 'imageling', theme_color: '#7C3AED' },
  { id: 7, code: 'RUBBER', name: 'Rubber & Tyres', description: 'Bicycle/car tyres, tubes, rubber mats', image: 'imageling', theme_color: '#1E293B' },
  { id: 8, code: 'MIXED', name: 'Mixed Household Scrap', description: 'Combined household clutter', image: 'imageling', theme_color: '#0F766E' },
];

const PICKUP_SLOTS = {
  weight_ranges: [
    '< 15 kg (Light)',
    '15 - 50 kg (Standard)',
    '50 - 150 kg (Heavy)',
    '> 150 kg (Commercial Bulk)',
  ],
  pickup_types: [
    { type: 'Doorstep', title: 'Doorstep Pickup', description: 'Homes, Flats & Apartments' },
    { type: 'Bulk', title: 'Bulk / Commercial', description: 'Offices, Shops & Warehouses' },
  ],
  date_options: ['Today', 'Tomorrow', 'Day After Tomorrow'],
  time_slots: [
    '09:00 AM - 12:00 PM',
    '10:00 AM - 01:00 PM',
    '02:00 PM - 05:00 PM',
    '05:00 PM - 07:30 PM',
  ],
};

const SCRAP_STATUSES = [
  'REQUEST_PLACED', 'BUYER_ASSIGNED', 'OUT_FOR_PICKUP',
  'WEIGHING_COMPLETED', 'PAYMENT_COMPLETED', 'CANCELLED',
];

module.exports = { SCRAP_CATEGORIES, PICKUP_SLOTS, SCRAP_STATUSES };
