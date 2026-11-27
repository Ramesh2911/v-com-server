const HOTEL_CATEGORIES = [
  {
    id: 'hotels',
    title: 'Hotels',
    subtitle: '3-Star, 4-Star & 5-Star Luxury Hotels',
    icon: 'hotel',
    image_url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'resorts',
    title: 'Resorts',
    subtitle: 'Beach, Hill, Nature & Wellness Resorts',
    icon: 'beach_access',
    image_url: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'villas',
    title: 'Villas & Private Stays',
    subtitle: 'Private Pool Villas, Holiday Homes',
    icon: 'villa',
    image_url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'boutique_heritage',
    title: 'Boutique & Heritage',
    subtitle: 'Unique, Heritage & Royal Palaces',
    icon: 'castle',
    image_url: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&auto=format&fit=crop&q=80',
  },
];

const CATEGORY_IDS = HOTEL_CATEGORIES.map((c) => c.id);

const MEAL_PLANS = {
  EP: { plan_name: 'Room Only', full: 'EP (European Plan - Room Only)' },
  CP: { plan_name: 'Room + Breakfast', full: 'CP (Continental Plan - Breakfast Included)' },
  MAP: { plan_name: 'Breakfast + Dinner', full: 'MAP (Modified American Plan - Breakfast + Lunch/Dinner)' },
  AP: { plan_name: 'All Meals Included', full: 'AP (American Plan - Room + Breakfast + Lunch + Dinner)' },
};

const STAR_RATINGS = ['3-Star', '4-Star', '5-Star', 'Luxury'];

module.exports = { HOTEL_CATEGORIES, CATEGORY_IDS, MEAL_PLANS, STAR_RATINGS };
