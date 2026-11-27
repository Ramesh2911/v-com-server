const { ok, okPaginated, created, body, security, noSecurity, idPath } = require('../components');

const admin = (s) => ({ ...s, tags: ['Admin'], security: security() });

const propIdPath = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Property id (e.g. prop-101)', example: 'prop-101' };
const codePath = { name: 'code', in: 'path', required: true, schema: { type: 'string' }, description: 'Reservation code (VCB-YYYY-NNNNNN)', example: 'VCB-2026-001245' };

const paths = {
  // ===================== PUBLIC — HOTEL BOOKINGS =====================

  '/hotel-bookings/categories': {
    get: {
      tags: ['HotelBookings'],
      summary: 'List stay categories (4)',
      description: 'Hardcoded booking categories: Hotels, Resorts, Villas & Private Stays, Boutique & Heritage.',
      security: noSecurity,
      responses: {
        200: ok(null, {
          success: true,
          message: 'Stay categories retrieved successfully',
          data: [
            { id: 'hotels', title: 'Hotels', subtitle: '3-Star, 4-Star & 5-Star Luxury Hotels', icon: 'hotel', image_url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80' },
            { id: 'resorts', title: 'Resorts', subtitle: 'Beach, Hill, Nature & Wellness Resorts', icon: 'beach_access', image_url: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80' },
            { id: 'villas', title: 'Villas & Private Stays', subtitle: 'Private Pool Villas, Holiday Homes', icon: 'villa', image_url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&auto=format&fit=crop&q=80' },
            { id: 'boutique_heritage', title: 'Boutique & Heritage', subtitle: 'Unique, Heritage & Royal Palaces', icon: 'castle', image_url: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&auto=format&fit=crop&q=80' },
          ],
        }),
      },
    },
  },

  '/hotel-bookings/properties': {
    get: {
      tags: ['HotelBookings'],
      summary: 'Search & filter hotels, resorts, villas',
      description:
        'Public property search. Optional date params reduce `available_rooms` per room. ' +
        'Response: `data: { total, items }` (flat, not paginated envelope).',
      security: noSecurity,
      parameters: [
        { name: 'city', in: 'query', schema: { type: 'string' }, description: 'City or area (alias: destination)', example: 'Mangalore' },
        { name: 'destination', in: 'query', schema: { type: 'string' }, description: 'Alias of city' },
        { name: 'check_in', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD' },
        { name: 'check_out', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD' },
        { name: 'adults', in: 'query', schema: { type: 'integer', default: 2 } },
        { name: 'children', in: 'query', schema: { type: 'integer', default: 0 } },
        { name: 'rooms', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'category_id', in: 'query', schema: { type: 'string', enum: ['all', 'hotels', 'resorts', 'villas', 'boutique_heritage'] } },
        { name: 'star_rating', in: 'query', schema: { type: 'string', enum: ['all', '3-Star', '4-Star', '5-Star', 'Luxury'] } },
        { name: 'min_price', in: 'query', schema: { type: 'number' }, description: 'Min starting tariff (EP) per night' },
        { name: 'max_price', in: 'query', schema: { type: 'number' } },
        { name: 'amenities', in: 'query', schema: { type: 'string' }, description: 'Comma tokens: pool,wifi,beach_access,spa' },
        { name: 'sort_by', in: 'query', schema: { type: 'string', enum: ['recommended', 'price_low', 'price_high', 'rating'], default: 'recommended' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
      ],
      responses: {
        200: ok(null, {
          success: true,
          message: 'Properties fetched successfully',
          data: {
            total: 12,
            items: [
              {
                id: 'prop-101',
                name: 'Ocean View Luxury Resort & Spa',
                star_rating: '5-Star',
                category_id: 'resorts',
                property_type: 'Beachfront Luxury Resort',
                location: 'Panambur Beach Road, Mangalore',
                city: 'Mangalore',
                guest_rating: 4.8,
                reviews_count: 230,
                starting_tariff: 6999,
                main_image: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80',
                key_amenities: ['Infinity Swimming Pool', 'Free High-Speed Wi-Fi', 'Private Beach Access', 'Multi-Cuisine Dining'],
                has_free_cancellation: true,
                has_breakfast_included: true,
              },
            ],
          },
        }),
      },
    },
  },

  '/hotel-bookings/properties/{id}': {
    get: {
      tags: ['HotelBookings'],
      summary: 'Property detail (gallery, amenities, policies)',
      security: noSecurity,
      parameters: [propIdPath],
      responses: {
        200: ok('#/components/schemas/HotelPropertyDetail', {
          id: 'prop-101',
          name: 'Ocean View Luxury Resort & Spa',
          star_rating: '5-Star',
          category: 'Resorts',
          property_type: 'Beachfront Luxury Resort',
          location: 'Panambur Beach Road, Mangalore, Karnataka - 575010',
          gps_coordinates: { latitude: 12.9463, longitude: 74.8052 },
          guest_rating: 4.8,
          reviews_count: 230,
          description: 'Experience coastal luxury at its finest with private beach access, world-class ayurvedic spa treatments, infinity sea-view pool, and sunset dining.',
          gallery_images: [
            'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80',
            'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&auto=format&fit=crop&q=80',
            'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80',
          ],
          amenities: ['Swimming Pool', 'Free High-Speed Wi-Fi', 'Private Beach Access', 'Multi-Cuisine Restaurant', 'Full-Service Spa & Ayurveda', 'Fitness Centre & Gym', '24-Hour Front Desk', 'Valet Parking', 'Airport Transfers'],
          policies: {
            check_in_time: '02:00 PM',
            check_out_time: '11:00 AM',
            id_proof_mandatory: true,
            pet_friendly: false,
            cancellation_policy: 'Free cancellation up to 48 hours prior to check-in. Non-refundable thereafter.',
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/hotel-bookings/properties/{id}/rooms': {
    get: {
      tags: ['HotelBookings'],
      summary: 'Room categories & meal-plan tariffs (EP/CP/MAP/AP)',
      description: 'Returns array (not envelope-wrapped list). With `check_in`/`check_out`, `available_rooms` is reduced by overlapping CONFIRMED bookings.',
      security: noSecurity,
      parameters: [
        propIdPath,
        { name: 'check_in', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'check_out', in: 'query', schema: { type: 'string', format: 'date' } },
      ],
      responses: {
        200: ok(null, {
          success: true,
          message: 'Rooms fetched successfully',
          data: [
            {
              room_id: 'rm-101-1',
              room_name: 'Deluxe Sea View Room',
              bed_type: '1 King Bed',
              room_size: '420 sq. ft.',
              view: 'Direct Ocean View',
              max_adults: 2,
              max_children: 1,
              available_rooms: 6,
              image_url: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&auto=format&fit=crop&q=80',
              amenities: ['Private Balcony', 'Smart TV', 'Mini Bar', 'Rain Shower', 'Bathtub'],
              tariffs: {
                EP: { plan_name: 'Room Only', rate_per_night: 6999 },
                CP: { plan_name: 'Room + Breakfast', rate_per_night: 7699, is_recommended: true },
                MAP: { plan_name: 'Breakfast + Dinner', rate_per_night: 8999 },
                AP: { plan_name: 'All Meals Included', rate_per_night: 10499 },
              },
            },
            {
              room_id: 'rm-101-2',
              room_name: 'Executive Beachfront Suite',
              bed_type: '1 Super King Bed',
              room_size: '750 sq. ft.',
              view: 'Panoramic Beach View',
              max_adults: 3,
              max_children: 2,
              available_rooms: 2,
              image_url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&auto=format&fit=crop&q=80',
              amenities: ['Jacuzzi', 'Living Room', 'Espresso Machine', 'Butler Service'],
              tariffs: {
                EP: { plan_name: 'Room Only', rate_per_night: 11999 },
                CP: { plan_name: 'Room + Breakfast', rate_per_night: 12999, is_recommended: true },
                MAP: { plan_name: 'Breakfast + Dinner', rate_per_night: 14499 },
                AP: { plan_name: 'All Meals Included', rate_per_night: 15999 },
              },
            },
          ],
        }),
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/hotel-bookings/reservations': {
    post: {
      tags: ['HotelBookings'],
      summary: 'Create hotel reservation (booking confirm)',
      description:
        'Requires Bearer token. Validates dates, meal plan, room occupancy and availability. ' +
        '409 when overlapping CONFIRMED bookings exceed `available_rooms`. Generates voucher PDF best-effort. ' +
        'Price: nights x rate x rooms + 18% GST.',
      security: security(),
      requestBody: body(
        {
          type: 'object',
          required: ['property_id', 'room_id', 'meal_plan', 'check_in_date', 'check_out_date', 'guest_name'],
          properties: {
            property_id: { type: 'string', example: 'prop-101' },
            room_id: { type: 'string', example: 'rm-101-1' },
            meal_plan: { type: 'string', enum: ['EP', 'CP', 'MAP', 'AP'], example: 'CP' },
            check_in_date: { type: 'string', format: 'date', example: '2026-11-27' },
            check_out_date: { type: 'string', format: 'date', example: '2026-11-29' },
            number_of_nights: { type: 'integer', description: 'Optional; recomputed from dates', example: 2 },
            number_of_rooms: { type: 'integer', default: 1, example: 1 },
            adults: { type: 'integer', default: 1, example: 2 },
            children: { type: 'integer', default: 0, example: 0 },
            guest_name: { type: 'string', example: 'Suhail Ahmed' },
            guest_phone: { type: 'string', nullable: true, example: '+91 98765 43210' },
            guest_email: { type: 'string', nullable: true, format: 'email', example: 'suhail.ahmed@example.com' },
            special_requests: { type: 'string', nullable: true, example: 'Non-smoking room on upper floor please.' },
            payment_method: { type: 'string', enum: ['pay_at_hotel', 'online'], default: 'pay_at_hotel', example: 'pay_at_hotel' },
          },
        },
        {
          property_id: 'prop-101',
          room_id: 'rm-101-1',
          meal_plan: 'CP',
          check_in_date: '2026-11-27',
          check_out_date: '2026-11-29',
          number_of_nights: 2,
          number_of_rooms: 1,
          adults: 2,
          children: 0,
          guest_name: 'Suhail Ahmed',
          guest_phone: '+91 98765 43210',
          guest_email: 'suhail.ahmed@example.com',
          special_requests: 'Non-smoking room on upper floor please.',
          payment_method: 'pay_at_hotel',
        }
      ),
      responses: {
        201: created('#/components/schemas/HotelReservationCreated'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        409: {
          description: 'Room sold out for these dates',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { success: false, message: 'Selected room category is sold out for these dates.', errors: null },
            },
          },
        },
      },
    },
  },

  '/hotel-bookings/reservations/{code}/voucher': {
    get: {
      tags: ['HotelBookings'],
      summary: 'Digital booking voucher + QR code',
      description: 'Owner only (404 for other users). Path param is the reservation code. PDF regenerated if missing.',
      security: security(),
      parameters: [codePath],
      responses: {
        200: ok('#/components/schemas/HotelVoucher', {
          reservation_id: 'VCB-2026-001245',
          qr_code_data: 'VCOM_HOTEL_VCB-2026-001245_VERIFIED',
          property: { name: 'Ocean View Luxury Resort & Spa', address: 'Panambur Beach Road, Mangalore', phone: '+91 824 244 5555' },
          stay_details: {
            guest_name: 'Suhail Ahmed',
            adults: 2,
            rooms: 1,
            room_category: 'Deluxe Sea View Room',
            meal_plan: 'CP',
            check_in: '27 November 2026 (02:00 PM)',
            check_out: '29 November 2026 (11:00 AM)',
          },
          payment_summary: {
            room_tariff: 15398,
            taxes: 2771.64,
            total_amount: 18169.64,
            paid_amount: 0,
            balance_payable_at_hotel: 18169.64,
            status: 'Pay at Property',
          },
          voucher_pdf_download_url: '/uploads/vouchers/VCB-2026-001245.pdf',
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/hotel-bookings/my-reservations': {
    get: {
      tags: ['HotelBookings'],
      summary: "User's reservations (past & current)",
      security: security(),
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], default: 'all' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } },
      ],
      responses: {
        200: ok(null, {
          success: true,
          message: 'Reservations fetched successfully',
          data: {
            total: 1,
            items: [
              {
                reservation_id: 'VCB-2026-001245',
                property_name: 'Ocean View Luxury Resort & Spa',
                main_image: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80',
                check_in: '2026-11-27',
                check_out: '2026-11-29',
                total_amount: 18169.64,
                status: 'CONFIRMED',
              },
            ],
          },
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/hotel-bookings/reservations/{code}/cancel': {
    post: {
      tags: ['HotelBookings'],
      summary: 'Cancel reservation (free cancellation)',
      description: 'Owner only. Only CONFIRMED reservations can be cancelled (400 otherwise). refund_amount = 0 (pay_at_hotel).',
      security: security(),
      parameters: [codePath],
      requestBody: body(
        { type: 'object', properties: { cancellation_reason: { type: 'string', nullable: true, example: 'Change of travel plans' } } },
        { cancellation_reason: 'Change of travel plans' }
      ),
      responses: {
        200: ok(null, {
          success: true,
          message: 'Reservation cancelled successfully.',
          data: { reservation_id: 'VCB-2026-001245', status: 'CANCELLED', refund_amount: 0, cancelled_at: '2026-11-26T13:30:00.000Z' },
        }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/hotel-bookings/properties/{id}/reviews': {
    post: {
      tags: ['HotelBookings'],
      summary: 'Submit verified stay review (7 ratings 1-5)',
      description:
        'Requires the user\'s reservation on this property with stay completed (COMPLETED, or CONFIRMED with check_out <= today). ' +
        'One review per reservation (409 duplicate). Updates property guest_rating (weighted) + reviews_count.',
      security: security(),
      parameters: [propIdPath],
      requestBody: body(
        {
          type: 'object',
          required: ['reservation_id', 'overall_rating', 'cleanliness_rating', 'room_comfort_rating', 'staff_behaviour_rating', 'food_quality_rating', 'amenities_rating', 'value_for_money_rating'],
          properties: {
            reservation_id: { type: 'string', example: 'VCB-2026-001245' },
            overall_rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            cleanliness_rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            room_comfort_rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            staff_behaviour_rating: { type: 'integer', minimum: 1, maximum: 5, example: 4 },
            food_quality_rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            amenities_rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            value_for_money_rating: { type: 'integer', minimum: 1, maximum: 5, example: 4 },
            review_text: { type: 'string', nullable: true, example: 'Exceptional beachfront location and delicious buffet breakfast. Rooms are super clean with breathtaking sea views.' },
            stay_type: { type: 'string', nullable: true, example: 'Family Vacation' },
            would_recommend: { type: 'boolean', default: true },
          },
        },
        {
          reservation_id: 'VCB-2026-001245',
          overall_rating: 5,
          cleanliness_rating: 5,
          room_comfort_rating: 5,
          staff_behaviour_rating: 4,
          food_quality_rating: 5,
          amenities_rating: 5,
          value_for_money_rating: 4,
          review_text: 'Exceptional beachfront location and delicious buffet breakfast. Rooms are super clean with breathtaking sea views.',
          stay_type: 'Family Vacation',
          would_recommend: true,
        }
      ),
      responses: {
        201: {
          description: 'Review published',
          content: {
            'application/json': {
              schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/HotelReviewResult' } } }] },
              example: {
                success: true,
                message: 'Thank you! Your verified stay review has been published.',
                data: { review_id: 'rev-98124', property_id: 'prop-101', average_rating: 4.7, created_at: '2026-11-26T13:35:00.000Z' },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        409: {
          description: 'Already reviewed this stay',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'You have already reviewed this stay', errors: null } } },
        },
      },
    },
  },

  // ===================== ADMIN — HOTEL BOOKINGS =====================

  '/admin/hotel/properties': {
    get: admin({
      summary: 'List properties (admin)',
      parameters: [
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'name / city / location' },
        { name: 'city', in: 'query', schema: { type: 'string' } },
        { name: 'category_id', in: 'query', schema: { type: 'string', enum: ['hotels', 'resorts', 'villas', 'boutique_heritage'] } },
        { name: 'star_rating', in: 'query', schema: { type: 'string', enum: ['3-Star', '4-Star', '5-Star', 'Luxury'] } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
      ],
      responses: {
        200: okPaginated('#/components/schemas/HotelPropertyAdmin', [
          {
            id: 'prop-101',
            name: 'Ocean View Luxury Resort & Spa',
            star_rating: '5-Star',
            category_id: 'resorts',
            location: 'Panambur Beach Road, Mangalore',
            city: 'Mangalore',
            status: 'active',
            guest_rating: 4.8,
            reviews_count: 230,
            starting_tariff: 6999,
            created_at: '2026-11-20T10:00:00.000Z',
          },
        ]),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
    post: admin({
      summary: 'Create property',
      description: 'Requires `hotel.manage`. Auto id: prop-<next>.',
      requestBody: body(
        {
          type: 'object',
          required: ['name', 'location', 'city'],
          properties: {
            name: { type: 'string', example: 'Sunset Beach Resort' },
            star_rating: { type: 'string', enum: ['3-Star', '4-Star', '5-Star', 'Luxury'], default: '4-Star' },
            category_id: { type: 'string', enum: ['hotels', 'resorts', 'villas', 'boutique_heritage'], default: 'hotels' },
            property_type: { type: 'string', nullable: true },
            location: { type: 'string', example: 'Beach Road, Panambur' },
            city: { type: 'string', example: 'Mangalore' },
            gps_lat: { type: 'number', nullable: true },
            gps_lng: { type: 'number', nullable: true },
            description: { type: 'string', nullable: true },
            main_image: { type: 'string', nullable: true },
            gallery_images: { type: 'array', items: { type: 'string' } },
            amenities: { type: 'array', items: { type: 'string' } },
            key_amenities: { type: 'array', items: { type: 'string' } },
            check_in_time: { type: 'string', default: '02:00 PM' },
            check_out_time: { type: 'string', default: '11:00 AM' },
            id_proof_mandatory: { type: 'boolean', default: false },
            pet_friendly: { type: 'boolean', default: false },
            cancellation_policy: { type: 'string', nullable: true },
            has_free_cancellation: { type: 'boolean', default: true },
            has_breakfast_included: { type: 'boolean', default: false },
            status: { type: 'string', enum: ['active', 'inactive'], default: 'active' },
            popular_score: { type: 'integer', default: 0 },
          },
        },
        { name: 'Sunset Beach Resort', star_rating: '4-Star', category_id: 'resorts', location: 'Beach Road, Panambur', city: 'Mangalore' }
      ),
      responses: {
        201: created('#/components/schemas/HotelPropertyAdmin'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },

  '/admin/hotel/properties/{id}': {
    get: admin({
      summary: 'Property detail (admin)',
      parameters: [propIdPath],
      responses: {
        200: ok('#/components/schemas/HotelPropertyAdmin', { id: 'prop-101', name: 'Ocean View Luxury Resort & Spa', status: 'active' }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
    put: admin({
      summary: 'Update property (partial)',
      parameters: [propIdPath],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] }, guest_rating: { type: 'number' } } }, { name: 'Ocean View Luxury Resort & Spa v2', status: 'active' }),
      responses: {
        200: ok('#/components/schemas/HotelPropertyAdmin', { id: 'prop-101', name: 'Ocean View Luxury Resort & Spa v2', status: 'active' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
    delete: admin({
      summary: 'Delete property',
      description: 'Requires `hotel.manage`. 409 if reservations exist for this property.',
      parameters: [propIdPath],
      responses: {
        200: ok(null, { success: true, message: 'Property deleted successfully', data: { id: 'prop-111' } }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    }),
  },

  '/admin/hotel/rooms': {
    get: admin({
      summary: 'List rooms (admin)',
      parameters: [
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
        { name: 'property_id', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
      ],
      responses: {
        200: okPaginated('#/components/schemas/HotelAdminRoom', [
          { id: 'rm-101-1', property_id: 'prop-101', property_name: 'Ocean View Luxury Resort & Spa', room_name: 'Deluxe Sea View Room', ep_rate: 6999, cp_rate: 7699, map_rate: 8999, ap_rate: 10499, available_rooms: 6, status: 'active' },
        ]),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
    post: admin({
      summary: 'Create room',
      description: 'Requires `hotel.manage`. Auto id: rm-<propNum>-<seq>. `ep_rate` required; cp/map/ap optional.',
      requestBody: body(
        {
          type: 'object',
          required: ['property_id', 'room_name', 'ep_rate'],
          properties: {
            property_id: { type: 'string', example: 'prop-101' },
            room_name: { type: 'string', example: 'Garden View Room' },
            bed_type: { type: 'string', nullable: true },
            room_size: { type: 'string', nullable: true },
            view: { type: 'string', nullable: true },
            max_adults: { type: 'integer', default: 2 },
            max_children: { type: 'integer', default: 0 },
            available_rooms: { type: 'integer', default: 1 },
            ep_rate: { type: 'number', example: 3999 },
            cp_rate: { type: 'number', nullable: true },
            map_rate: { type: 'number', nullable: true },
            ap_rate: { type: 'number', nullable: true },
            image_url: { type: 'string', nullable: true },
            amenities: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['active', 'inactive'], default: 'active' },
          },
        },
        { property_id: 'prop-101', room_name: 'Garden View Room', ep_rate: 3999, cp_rate: 4499, map_rate: 4999, ap_rate: 5499, available_rooms: 4 }
      ),
      responses: {
        201: created('#/components/schemas/HotelAdminRoom'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/hotel/rooms/{id}': {
    put: admin({
      summary: 'Update room (partial)',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'rm-101-1' }],
      requestBody: body({ type: 'object', properties: { ep_rate: { type: 'number' }, available_rooms: { type: 'integer' }, status: { type: 'string', enum: ['active', 'inactive'] } } }, { ep_rate: 7499 }),
      responses: {
        200: ok('#/components/schemas/HotelAdminRoom', { id: 'rm-101-1', ep_rate: 7499, status: 'active' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
    delete: admin({
      summary: 'Delete room',
      description: '409 if reservations exist for this room.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'rm-101-1' }],
      responses: {
        200: ok(null, { success: true, message: 'Room deleted successfully', data: { id: 'rm-101-1' } }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    }),
  },

  '/admin/hotel/reservations': {
    get: admin({
      summary: 'List reservations (admin)',
      parameters: [
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] } },
        { name: 'property_id', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'code / guest name / phone' },
      ],
      responses: {
        200: okPaginated('#/components/schemas/HotelAdminReservation', [
          {
            id: 1,
            reservation_code: 'VCB-2026-001245',
            user_id: 6,
            property_id: 'prop-101',
            room_id: 'rm-101-1',
            property_name: 'Ocean View Luxury Resort & Spa',
            room_name: 'Deluxe Sea View Room',
            meal_plan: 'CP',
            check_in_date: '2026-11-27',
            check_out_date: '2026-11-29',
            number_of_nights: 2,
            number_of_rooms: 1,
            adults: 2,
            children: 0,
            guest_name: 'Suhail Ahmed',
            payment_method: 'pay_at_hotel',
            payment_status: 'PAY_AT_PROPERTY',
            booking_status: 'CONFIRMED',
            total_amount: 18169.64,
            created_at: '2026-11-26T13:25:00.000Z',
          },
        ]),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },

  '/admin/hotel/reservations/{id}': {
    get: admin({
      summary: 'Reservation detail (admin, by id or code)',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Numeric id or reservation code', example: 'VCB-2026-001245' }],
      responses: {
        200: ok('#/components/schemas/HotelAdminReservation', { id: 1, reservation_code: 'VCB-2026-001245', booking_status: 'CONFIRMED', property_name: 'Ocean View Luxury Resort & Spa', room_name: 'Deluxe Sea View Room' }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/hotel/reservations/{id}/status': {
    patch: admin({
      summary: 'Update reservation status (admin)',
      description: 'Requires `hotel.manage`. Allowed: COMPLETED, NO_SHOW, CANCELLED. Cancelled rows cannot change.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'VCB-2026-001245' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['COMPLETED', 'NO_SHOW', 'CANCELLED'], example: 'COMPLETED' } } }, { status: 'COMPLETED' }),
      responses: {
        200: ok('#/components/schemas/HotelAdminReservation', { id: 1, reservation_code: 'VCB-2026-001245', booking_status: 'COMPLETED' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/hotel/reviews': {
    get: admin({
      summary: 'List hotel reviews (admin)',
      parameters: [
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'published', 'hidden'] } },
        { name: 'property_id', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        200: okPaginated('#/components/schemas/HotelAdminReview', [
          { review_id: 'rev-1', property_id: 'prop-105', property_name: 'Heritage Palace Stay', guest_name: 'Demo Customer', overall_rating: 5, status: 'published', review_text: 'Clean rooms, warm staff.', created_at: '2026-11-22T09:00:00.000Z' },
        ]),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },

  '/admin/hotel/reviews/{id}/status': {
    patch: admin({
      summary: 'Publish / hide review (admin)',
      description: 'Requires `hotel.manage`. Path id = numeric review id (not rev- prefix).',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['published', 'hidden'] } } }, { status: 'hidden' }),
      responses: {
        200: ok('#/components/schemas/HotelAdminReview', { review_id: 'rev-1', status: 'hidden' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/hotel/stats': {
    get: admin({
      summary: 'Hotel bookings stats (admin)',
      responses: {
        200: ok('#/components/schemas/HotelStats', {
          total_properties: 10,
          active_properties: 10,
          total_rooms: 21,
          active_rooms: 21,
          total_reservations: 6,
          confirmed: 3,
          completed: 1,
          cancelled: 1,
          no_show: 1,
          total_revenue: 36400.5,
          total_reviews: 2,
          avg_rating: 4.7,
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },
};

module.exports = paths;
