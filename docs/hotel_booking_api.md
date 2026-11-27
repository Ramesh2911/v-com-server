# 🏨 V-Com — Bookings Module (Hotels, Resorts & Premium Stays) API Documentation

> **মডিউল:** Bookings & Accommodations (`/feature/hotel_booking`)  
> **ট্যাগলাইন:** *V-COM BOOKINGS — Discover. Stay. Experience.*  
> **Base URL:** `https://v-com-server.onrender.com/api/v1/hotel-bookings`  
> **Content-Type:** `application/json`  
> **Auth:** হোটেল খোঁজা, রুম ও রেট দেখতে টোকেন অপশনাল (`Public`)। তবে রুম রিজার্ভেশন করা, ভাউচার দেখা ও বুকিং ক্যান্সেল করতে `Authorization: Bearer <token>` হেডার দেওয়া বাধ্যতামূলক।

---

## 📋 সূচিপত্র (Table of Contents)

1. [API Endpoints Overview](#-api-endpoints-overview)
2. [1️⃣ GET `/categories` — স্টে ক্যাটাগরি তালিকা](#1️⃣-get-categories--স্টে-ক্যাটাগরি-তালিকা)
3. [2️⃣ GET `/properties` — হোটেল, রিসোর্ট ও ভিলা সার্চ ও ফিল্টারিং](#2️⃣-get-properties--হোটেল-রিসোর্ট-ও-ভিলা-সার্চ-ও-ফিল্টারিং)
4. [3️⃣ GET `/properties/:id` — প্রপার্টির বিস্তারিত তথ্য ও গ্যালারি](#3️⃣-get-propertiesid--প্রপার্টির-বিস্তারিত-তথ্য-ও-গ্যালারি)
5. [4️⃣ GET `/properties/:id/rooms` — রুম ক্যাটাগরি ও মিল প্ল্যান ট্যারিফ (EP, CP, MAP, AP)](#4️⃣-get-propertiesidrooms--রুম-ক্যাটাগরি-ও-মিল-প্ল্যান-ট্যারিফ-ep-cp-map-ap)
6. [5️⃣ POST `/reservations` — রুম বুকিং ও রিজার্ভেশন কনফার্ম](#5️⃣-post-reservations--রুম-বুকিং-ও-রিজার্ভেশন-কনফার্ম)
7. [6️⃣ GET `/reservations/:id/voucher` — ডিজিটাল বুকিং ভাউচার ও QR কোড](#6️⃣-get-reservationsidvoucher--ডিজিটাল-বুকিং-ভাউচার-ও-qr-কোড)
8. [7️⃣ GET `/my-reservations` — ইউজারের অতীতের ও চলমান বুকিং তালিকা](#7️⃣-get-my-reservations--ইউজারের-অতীতের-ও-চলমান-বুকিং-তালিকা)
9. [8️⃣ POST `/reservations/:id/cancel` — বুকিং বাতিল ও রিফান্ড রিকোয়েস্ট](#8️⃣-post-reservationsidcancel--বুকিং-বাতিল-ও-রিফান্ড-রিকোয়েস্ট)
10. [9️⃣ POST `/properties/:id/reviews` — কাস্টমার রিভিউ ও স্টার রেটিং](#9️⃣-post-propertiesidreviews--কাস্টমার-রিভিউ-ও-স্টার-রেটিং)
11. [Error Codes & Responses](#-error-codes--responses)

---

## 🔗 API Endpoints Overview

| Method | Endpoint | কাজ (Description) | Auth |
|:---|:---|:---|:---:|
| `GET` | `/categories` | Hotels, Resorts, Villas, Boutique & Heritage ক্যাটাগরি তালিকা | ❌ Public |
| `GET` | `/properties` | শহর/লোকেশন, তারিখ, গেস্ট ও স্টার রেটিং অনুযায়ী হোটেল সার্চ | ❌ Public |
| `GET` | `/properties/:id` | নির্দিষ্ট প্রপার্টির ছবি, সুযোগ-সুবিধা ও পলিসির বিস্তারিত ভিউ | ❌ Public |
| `GET` | `/properties/:id/rooms` | রুমের ধরন, বেড টাইপ ও ৪টি মিল প্ল্যান (EP, CP, MAP, AP) অনুযায়ী রেট | ❌ Public |
| `POST` | `/reservations` | রুম বুকিং কনফার্ম করা (`pay_at_hotel` অথবা অনলাইন পেমেন্ট) | 🔒 Required |
| `GET` | `/reservations/:id/voucher` | ভাউচার ডাটা, QR কোড ও PDF ডাউনলোড লিঙ্ক পাওয়া | 🔒 Required |
| `GET` | `/my-reservations` | লগইন থাকা ইউজারের সকল রিজার্ভেশন ইতিহাস দেখা | 🔒 Required |
| `POST` | `/reservations/:id/cancel` | ফ্রি ক্যান্সেলেশন পলিসি অনুযায়ী বুকিং বাতিল করা | 🔒 Required |
| `POST` | `/properties/:id/reviews` | স্টে সম্পন্ন হওয়ার পর ১০টি প্যারামিটারে গেস্ট রিভিউ দেওয়া | 🔒 Required |

---

# 1️⃣ GET `/categories` — স্টে ক্যাটাগরি তালিকা

বুকিং ড্যাশবোর্ডের শীর্ষে প্রদর্শিত প্রধান স্টে ক্যাটাগরিগুলো রিটার্ন করে।

### **Request:**
```http
GET /api/v1/hotel-bookings/categories
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "hotels",
      "title": "Hotels",
      "subtitle": "3-Star, 4-Star & 5-Star Luxury Hotels",
      "icon": "hotel",
      "image_url": "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80"
    },
    {
      "id": "resorts",
      "title": "Resorts",
      "subtitle": "Beach, Hill, Nature & Wellness Resorts",
      "icon": "beach_access",
      "image_url": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80"
    },
    {
      "id": "villas",
      "title": "Villas & Private Stays",
      "subtitle": "Private Pool Villas, Holiday Homes",
      "icon": "villa",
      "image_url": "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&auto=format&fit=crop&q=80"
    },
    {
      "id": "boutique_heritage",
      "title": "Boutique & Heritage",
      "subtitle": "Unique, Heritage & Royal Palaces",
      "icon": "castle",
      "image_url": "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&auto=format&fit=crop&q=80"
    }
  ]
}
```

---

# 2️⃣ GET `/properties` — হোটেল, রিসোর্ট ও ভিলা সার্চ ও ফিল্টারিং

ইউজার যখন ডেসটিনেশন, তারিখ, রুম/গেস্ট সংখ্যা এবং ফিল্টার দিয়ে সার্চ করে (ক্লায়েন্ট ডকের Section 10, 11 ও 12 অনুযায়ী)।

### **Request:**
```http
GET /api/v1/hotel-bookings/properties?city=Mangalore&check_in=2026-11-27&check_out=2026-11-29&adults=2&rooms=1&star_rating=5-Star&sort_by=popular&page=1&limit=10
```

### **Query Parameters:**

| Parameter | Type | Required | Default | Description |
|:---|:---:|:---:|:---:|:---|
| `city` / `destination` | `string` | ❌ | All | শহর বা এরিয়া (যেমন: `Mangalore`, `Goa`, `Coorg`) |
| `check_in` | `string` | ❌ | Tomorrow | চেক-ইন তারিখ: `YYYY-MM-DD` |
| `check_out` | `string` | ❌ | Day after | চেক-আউট তারিখ: `YYYY-MM-DD` |
| `adults` | `integer` | ❌ | `2` | প্রাপ্তবয়স্ক গেস্টের সংখ্যা |
| `children` | `integer` | ❌ | `0` | শিশুর সংখ্যা |
| `rooms` | `integer` | ❌ | `1` | প্রয়োজনীয় রুমের সংখ্যা |
| `category_id` | `string` | ❌ | `all` | `hotels`, `resorts`, `villas`, `boutique_heritage` |
| `star_rating` | `string` | ❌ | `all` | `3-Star`, `4-Star`, `5-Star`, `Luxury` |
| `min_price` | `number` | ❌ | - | সর্বনিম্ন বাজেট (যেমন `3000`) |
| `max_price` | `number` | ❌ | - | সর্বোচ্চ বাজেট (যেমন `15000`) |
| `amenities` | `string` | ❌ | - | কমা দিয়ে সেপারেটেড: `pool,wifi,beach_access,spa` |
| `sort_by` | `string` | ❌ | `recommended` | `recommended`, `price_low`, `price_high`, `rating` |

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "total": 12,
    "items": [
      {
        "id": "prop-101",
        "name": "Ocean View Luxury Resort & Spa",
        "star_rating": "5-Star",
        "category_id": "resorts",
        "property_type": "Beachfront Luxury Resort",
        "location": "Panambur Beach Road, Mangalore",
        "city": "Mangalore",
        "guest_rating": 4.8,
        "reviews_count": 230,
        "starting_tariff": 6999.0,
        "main_image": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80",
        "key_amenities": [
          "Infinity Swimming Pool",
          "Free High-Speed Wi-Fi",
          "Private Beach Access",
          "Multi-Cuisine Dining"
        ],
        "has_free_cancellation": true,
        "has_breakfast_included": true
      }
    ]
  }
}
```

---

# 3️⃣ GET `/properties/:id` — প্রপার্টির বিস্তারিত তথ্য ও গ্যালারি

নির্দিষ্ট একটি হোটেল/রিসোর্টের পূর্ণাঙ্গ মাস্টার প্রোফাইল, ফটো গ্যালারি, সুযোগ-সুবিধা এবং পলিসি প্রদর্শন করে (ক্লায়েন্ট ডকের Section 2, 4, 5 ও 8 অনুযায়ী)।

### **Request:**
```http
GET /api/v1/hotel-bookings/properties/prop-101
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "prop-101",
    "name": "Ocean View Luxury Resort & Spa",
    "star_rating": "5-Star",
    "category": "Resorts",
    "property_type": "Beachfront Luxury Resort",
    "location": "Panambur Beach Road, Mangalore, Karnataka - 575010",
    "gps_coordinates": {
      "latitude": 12.9463,
      "longitude": 74.8052
    },
    "guest_rating": 4.8,
    "reviews_count": 230,
    "description": "Experience coastal luxury at its finest with private beach access, world-class ayurvedic spa treatments, infinity sea-view pool, and sunset dining.",
    "gallery_images": [
      "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80"
    ],
    "amenities": [
      "Swimming Pool",
      "Free High-Speed Wi-Fi",
      "Private Beach Access",
      "Multi-Cuisine Restaurant",
      "Full-Service Spa & Ayurveda",
      "Fitness Centre & Gym",
      "24-Hour Front Desk",
      "Valet Parking",
      "Airport Transfers"
    ],
    "policies": {
      "check_in_time": "02:00 PM",
      "check_out_time": "11:00 AM",
      "id_proof_mandatory": true,
      "pet_friendly": false,
      "cancellation_policy": "Free cancellation up to 48 hours prior to check-in. Non-refundable thereafter."
    }
  }
}
```

---

# 4️⃣ GET `/properties/:id/rooms` — রুম ক্যাটাগরি ও মিল প্ল্যান ট্যারিফ (EP, CP, MAP, AP)

ক্লায়েন্ট ডকের Section 6 ও 7 অনুযায়ী প্রতিটি রুমের ৪টি মিল প্ল্যানের রেট তালিকা রিটার্ন করে:
- **EP (European Plan):** Room only, no meals
- **CP (Continental Plan):** Room + Daily Breakfast
- **MAP (Modified American Plan):** Room + Breakfast + Lunch/Dinner
- **AP (American Plan):** Room + Breakfast + Lunch + Dinner

### **Request:**
```http
GET /api/v1/hotel-bookings/properties/prop-101/rooms?check_in=2026-11-27&check_out=2026-11-29
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "room_id": "rm-101-1",
      "room_name": "Deluxe Sea View Room",
      "bed_type": "1 King Bed",
      "room_size": "420 sq. ft.",
      "view": "Direct Ocean View",
      "max_adults": 2,
      "max_children": 1,
      "available_rooms": 6,
      "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&auto=format&fit=crop&q=80",
      "amenities": ["Private Balcony", "Smart TV", "Mini Bar", "Rain Shower", "Bathtub"],
      "tariffs": {
        "EP": {
          "plan_name": "Room Only",
          "rate_per_night": 6999.0
        },
        "CP": {
          "plan_name": "Room + Breakfast",
          "rate_per_night": 7699.0,
          "is_recommended": true
        },
        "MAP": {
          "plan_name": "Breakfast + Dinner",
          "rate_per_night": 8999.0
        },
        "AP": {
          "plan_name": "All Meals Included",
          "rate_per_night": 10499.0
        }
      }
    },
    {
      "room_id": "rm-101-2",
      "room_name": "Executive Beachfront Suite",
      "bed_type": "1 Super King Bed",
      "room_size": "750 sq. ft.",
      "view": "Panoramic Beach View",
      "max_adults": 3,
      "max_children": 2,
      "available_rooms": 2,
      "image_url": "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&auto=format&fit=crop&q=80",
      "amenities": ["Jacuzzi", "Living Room", "Espresso Machine", "Butler Service"],
      "tariffs": {
        "EP": { "rate_per_night": 11999.0 },
        "CP": { "rate_per_night": 12999.0 },
        "MAP": { "rate_per_night": 14499.0 },
        "AP": { "rate_per_night": 15999.0 }
      }
    }
  ]
}
```

---

# 5️⃣ POST `/reservations` — রুম বুকিং ও রিজার্ভেশন কনফার্ম

ইউজার রুম, মিল প্ল্যান এবং পেমেন্ট মেথড (`pay_at_hotel` বা অনলাইন) বেছে নিয়ে বুকিং কনফার্ম করলে এই API কল হয়।

### **Request:**
```http
POST /api/v1/hotel-bookings/reservations
Authorization: Bearer <user_token>
Content-Type: application/json
```

```json
{
  "property_id": "prop-101",
  "room_id": "rm-101-1",
  "meal_plan": "CP",
  "check_in_date": "2026-11-27",
  "check_out_date": "2026-11-29",
  "number_of_nights": 2,
  "number_of_rooms": 1,
  "adults": 2,
  "children": 0,
  "guest_name": "Suhail Ahmed",
  "guest_phone": "+91 98765 43210",
  "guest_email": "suhail.ahmed@example.com",
  "special_requests": "Non-smoking room on upper floor please.",
  "payment_method": "pay_at_hotel"
}
```

### **Success Response `201 Created`:**
```json
{
  "success": true,
  "message": "Hotel reservation confirmed successfully",
  "data": {
    "reservation_id": "VCB-2026-001245",
    "property_name": "Ocean View Luxury Resort & Spa",
    "room_name": "Deluxe Sea View Room",
    "meal_plan": "CP (Continental Plan - Breakfast Included)",
    "check_in": "2026-11-27",
    "check_out": "2026-11-29",
    "duration_nights": 2,
    "pricing": {
      "room_tariff": 15398.0,
      "taxes_gst_18": 2771.64,
      "extras": 0.0,
      "total_amount": 18169.64,
      "currency": "INR"
    },
    "payment_status": "PAY_AT_PROPERTY",
    "booking_status": "CONFIRMED",
    "voucher_pdf_url": "https://v-com-assets.s3.amazonaws.com/vouchers/VCB-2026-001245.pdf",
    "created_at": "2026-11-26T13:25:00.000Z"
  }
}
```

---

# 6️⃣ GET `/reservations/:id/voucher` — ডিজিটাল বুকিং ভাউচার ও QR কোড

ক্লায়েন্ট ডকের Section 15 অনুযায়ী হোটেল চেক-ইন ও রিসিপশনের জন্য ডিজিটাল ভাউচার রিটার্ন করে।

### **Request:**
```http
GET /api/v1/hotel-bookings/reservations/VCB-2026-001245/voucher
Authorization: Bearer <user_token>
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "reservation_id": "VCB-2026-001245",
    "qr_code_data": "VCOM_HOTEL_VCB-2026-001245_VERIFIED",
    "property": {
      "name": "Ocean View Luxury Resort & Spa",
      "address": "Panambur Beach Road, Mangalore",
      "phone": "+91 824 244 5555"
    },
    "stay_details": {
      "guest_name": "Suhail Ahmed",
      "adults": 2,
      "rooms": 1,
      "room_category": "Deluxe Sea View Room",
      "meal_plan": "CP",
      "check_in": "27 November 2026 (02:00 PM)",
      "check_out": "29 November 2026 (11:00 AM)"
    },
    "payment_summary": {
      "room_tariff": 15398.0,
      "taxes": 2771.64,
      "total_amount": 18169.64,
      "paid_amount": 0.0,
      "balance_payable_at_hotel": 18169.64,
      "status": "Pay at Property"
    },
    "voucher_pdf_download_url": "https://v-com-assets.s3.amazonaws.com/vouchers/VCB-2026-001245.pdf"
  }
}
```

---

# 7️⃣ GET `/my-reservations` — ইউজারের সকল বুকিং তালিকা

### **Request:**
```http
GET /api/v1/hotel-bookings/my-reservations?status=all&page=1&limit=10
Authorization: Bearer <user_token>
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "total": 1,
    "items": [
      {
        "reservation_id": "VCB-2026-001245",
        "property_name": "Ocean View Luxury Resort & Spa",
        "main_image": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&auto=format&fit=crop&q=80",
        "check_in": "2026-11-27",
        "check_out": "2026-11-29",
        "total_amount": 18169.64,
        "status": "CONFIRMED"
      }
    ]
  }
}
```

---

# 8️⃣ POST `/reservations/:id/cancel` — বুকিং বাতিল

### **Request:**
```http
POST /api/v1/hotel-bookings/reservations/VCB-2026-001245/cancel
Authorization: Bearer <user_token>
Content-Type: application/json
```

```json
{
  "cancellation_reason": "Change of travel plans"
}
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "Reservation cancelled successfully.",
  "data": {
    "reservation_id": "VCB-2026-001245",
    "status": "CANCELLED",
    "refund_amount": 0.0,
    "cancelled_at": "2026-11-26T13:30:00.000Z"
  }
}
```

---

# 9️⃣ POST `/properties/:id/reviews` — কাস্টমার রিভিউ ও স্টার রেটিং

চেক-আউট হওয়ার পর ক্লায়েন্ট ডকের Section 20 অনুযায়ী ১০টি রেটিং ফ্যাক্টরের ফিডব্যাক জমা দেওয়ার API।

### **Request:**
```http
POST /api/v1/hotel-bookings/properties/prop-101/reviews
Authorization: Bearer <user_token>
Content-Type: application/json
```

```json
{
  "reservation_id": "VCB-2026-001245",
  "overall_rating": 5,
  "cleanliness_rating": 5,
  "room_comfort_rating": 5,
  "staff_behaviour_rating": 4,
  "food_quality_rating": 5,
  "amenities_rating": 5,
  "value_for_money_rating": 4,
  "review_text": "Exceptional beachfront location and delicious buffet breakfast. Rooms are super clean with breathtaking sea views.",
  "stay_type": "Family Vacation",
  "would_recommend": true
}
```

### **Success Response `201 Created`:**
```json
{
  "success": true,
  "message": "Thank you! Your verified stay review has been published.",
  "data": {
    "review_id": "rev-98124",
    "property_id": "prop-101",
    "average_rating": 4.7,
    "created_at": "2026-11-26T13:35:00.000Z"
  }
}
```

---

## ⚠️ Error Codes & Responses

| Status Code | Scenario | Sample Error Response |
|:---:|:---|:---|
| `400 Bad Request` | চেক-আউট তারিখ চেক-ইনের পূর্ববর্তী হলে বা ইনভ্যালিড ডেট | `{"success": false, "message": "check_out_date must be after check_in_date"}` |
| `401 Unauthorized` | লগইন টোকেন না থাকলে | `{"success": false, "message": "Authentication token missing or expired"}` |
| `404 Not Found` | ইনভ্যালিড প্রপার্টি বা রিজার্ভেশন আইডি | `{"success": false, "message": "Property not found"}` |
| `409 Sold Out` | উক্ত তারিখে সিলেক্ট করা রুম স্টক শেষ হয়ে গেলে | `{"success": false, "message": "Selected room category is sold out for these dates."}` |
| `500 Server Error` | ব্যাকএন্ড ডাটাবেস এরর | `{"success": false, "message": "Internal server error. Please try again later."}` |
