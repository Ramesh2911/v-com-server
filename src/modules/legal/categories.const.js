// Legal & Advisory categories — public contract (docs/legal_advisory.md)
// Hardcoded: stable IDs mobile app er jonno.
const LEGAL_CATEGORIES = [
  {
    id: 1,
    code: 'CRIMINAL',
    title: 'Criminal Law',
    subtitle: 'Criminal cases, bail, complaints',
    icon: 'Icons.gavel_rounded',
    theme_color: '#DC2626',
  },
  {
    id: 2,
    code: 'CIVIL',
    title: 'Civil Law',
    subtitle: 'Property disputes, recovery',
    icon: 'Icons.balance_rounded',
    theme_color: '#0969DA',
  },
  {
    id: 3,
    code: 'CORPORATE',
    title: 'Corporate & Business Law',
    subtitle: 'Contracts, compliance',
    icon: 'Icons.handshake_rounded',
    theme_color: '#2563EB',
  },
  {
    id: 4,
    code: 'FAMILY',
    title: 'Family Law',
    subtitle: 'Divorce, custody, maintenance',
    icon: 'Icons.family_restroom_rounded',
    theme_color: '#9333EA',
  },
  {
    id: 5,
    code: 'PROPERTY',
    title: 'Property & Real Estate Law',
    subtitle: 'Land disputes, registration',
    icon: 'Icons.home_work_rounded',
    theme_color: '#EA580C',
  },
  {
    id: 6,
    code: 'CONSUMER',
    title: 'Consumer & Legal Rights',
    subtitle: 'Consumer disputes, compensation',
    icon: 'Icons.shopping_bag_outlined',
    theme_color: '#0D9488',
  },
  {
    id: 7,
    code: 'LABOUR',
    title: 'Labour & Employment Law',
    subtitle: 'Employment matters',
    icon: 'Icons.work_outline_rounded',
    theme_color: '#475569',
  },
  {
    id: 8,
    code: 'OTHER',
    title: 'Other Legal Advisory',
    subtitle: 'Any other legal assistance',
    icon: 'Icons.more_horiz_rounded',
    theme_color: '#1E293B',
    requires_custom_input: true,
  },
];

const byId = (id) => LEGAL_CATEGORIES.find((c) => c.id === Number(id)) || null;

module.exports = { LEGAL_CATEGORIES, byId };
