# ♻️ V-Com — Scrap & Waste Management API Documentation

> **মডিউল:** Scrap & Waste Management (`/feature/scrap_waste`)  
> **উদ্দেশ্য:** বাসা-বাড়ি, ফ্ল্যাট ও বাণিজ্যিক প্রতিষ্ঠানের বাতিল স্ক্র্যাপ (কাগজ, লোহা, প্লাস্টিক, ই-বর্জ্য) ডিজিটাল ওজন ও স্পট পেমেন্টের মাধ্যমে ডোরস্টেপ পিকআপ করা।  
> **Base URL:** `https://v-com-server.onrender.com/api/v1/scrap-waste`  
> **Content-Type:** `multipart/form-data` (স্ক্র্যাপের ছবি আপলোড সহ) এবং `application/json`  
> **Auth:** স্ক্র্যাপ ক্যাটাগরি ও স্লট দেখতে পাবলিক। কিন্তু পিকআপ রিকোয়েস্ট পাঠাতে এবং ট্র্যাকিং করতে `Authorization: Bearer <token>` দেওয়া বাধ্যতামূলক।

---

## 📋 সূচিপত্র (Table of Contents)

1. [API Endpoints Overview](#-api-endpoints-overview)
2. [1️⃣ GET `/categories` — স্ক্র্যাপ ম্যাটেরিয়াল ক্যাটাগরি তালিকা](#1️⃣-get-categories--স্ক্র্যাপ-ম্যাটেরিয়াল-ক্যাটাগরি-তালিকা)
3. [2️⃣ GET `/pickup-slots` — পিকআপ তারিখ ও সময় স্লট তালিকা](#2️⃣-get-pickup-slots--পিকআপ-তারিখ-ও-সময়-স্লট-তালিকা)
4. [3️⃣ POST `/pickup-request` — ডোরস্টেপ স্ক্র্যাপ পিকআপ রিকোয়েস্ট সাবমিশন](#3️⃣-post-pickup-request--ডোরস্টেপ-স্ক্র্যাপ-পিকআপ-রিকোয়েস্ট-সাবমিশন)
5. [4️⃣ GET `/requests/:id/track` — লাইভ পিকআপ স্ট্যাটাস ট্র্যাকিং](#4️⃣-get-requestsidtrack--লাইভ-পিকআপ-স্ট্যাটাস-ট্র্যাকিং)
6. [5️⃣ GET `/my-pickups` — ইউজারের অতীতের ও চলমান পিকআপ হিস্ট্রি](#5️⃣-get-my-pickups--ইউজারের-অতীতের-ও-চলমান-পিকআপ-হিস্ট্রি)
7. [6️⃣ POST `/requests/:id/cancel` — পিকআপ রিকোয়েস্ট বাতিল](#6️⃣-post-requestsidcancel--পিকআপ-রিকোয়েস্ট-বাতিল)
8. [Error Codes & Responses](#-error-codes--responses)

---

## 🔗 API Endpoints Overview

| Method | Endpoint | কাজ (Description) | Content-Type |
|:---|:---|:---|:---:|
| `GET` | `/categories` | অনুমোদিত স্ক্র্যাপ ক্যাটাগরি তালিকা (কাগজ, মেটাল, প্লাস্টিক ইত্যাদি) | `application/json` |
| `GET` | `/pickup-slots` | অ্যাভেইলেবল পিকআপ তারিখ, সময় স্লট ও ওজনের রেঞ্জ | `application/json` |
| `POST` | `/pickup-request` | ক্যাটাগরি, ওজন, ঠিকানা, স্লট ও ছবি সহ **পিকআপ শিডিউল** করা | `multipart/form-data` |
| `GET` | `/requests/:id/track` | সংগ্রাহক/বায়ারের লাইভ অবস্থান ও পিকআপের বর্তমান অগ্রগতি দেখা | `application/json` |
| `GET` | `/my-pickups` | ইউজারের নিজস্ব সব অতীত ও বর্তমান স্ক্র্যাপ বিক্রির হিস্ট্রি | `application/json` |
| `POST` | `/requests/:id/cancel` | প্রয়োজন হলে নির্দিষ্ট পিকআপ রিকোয়েস্ট বাতিল করা | `application/json` |

---

# 1️⃣ GET `/categories` — স্ক্র্যাপ ম্যাটেরিয়াল ক্যাটাগরি তালিকা

অ্যাপের স্ক্রিনে প্রদর্শন করার জন্য রিসাইকেলযোগ্য সকল স্ক্র্যাপ ক্যাটাগরির তালিকা প্রদান করে।

### **Request:**
```http
GET /api/v1/scrap-waste/categories
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "Scrap categories retrieved successfully",
  "data": [
    {
      "id": 1,
      "code": "PAPER",
      "name": "Paper & Newspapers",
      "description": "Old newspapers, books, cartons",
      "image": "imageling",
      "theme_color": "#0284C7"
    },
    {
      "id": 2,
      "code": "CARDBOARD",
      "name": "Cardboard & Cartons",
      "description": "Corrugated boxes, packaging cartons",
       "image": "imageling",
      "theme_color": "#D97706"
    },
    {
      "id": 3,
      "code": "IRON_STEEL",
      "name": "Iron & Steel Scraps",
      "description": "Rods, grills, sheets, MS scrap",
       "image": "imageling",
      "theme_color": "#475569"
    },
    {
      "id": 4,
      "code": "METALS",
      "name": "Copper, Brass & Aluminium",
      "description": "Wires, utensils, pipes, motors",
       "image": "imageling",
      "theme_color": "#EA580C"
    },
    {
      "id": 5,
      "code": "PLASTIC",
      "name": "Plastic Bottles & Items",
      "description": "Water bottles, HDPE containers, buckets",
       "image": "imageling",
      "theme_color": "#16A34A"
    },
    {
      "id": 6,
      "code": "E_WASTE",
      "name": "E-Waste & Electronics",
      "description": "Laptops, cables, batteries, PCBs",
       "image": "imageling",
      "theme_color": "#7C3AED"
    },
    {
      "id": 7,
      "code": "RUBBER",
      "name": "Rubber & Tyres",
      "description": "Bicycle/car tyres, tubes, rubber mats",
      "image": "imageling",
      "theme_color": "#1E293B"
    },
    {
      "id": 8,
      "code": "MIXED",
      "name": "Mixed Household Scrap",
      "description": "Combined household clutter",
       "image": "imageling",
      "theme_color": "#0F766E"
    }
  ]
}
```

---

# 2️⃣ GET `/pickup-slots` — পিকআপ তারিখ ও সময় স্লট তালিকা

পিকআপ শিডিউলিংয়ের জন্য সমর্থিত ওজনের রেঞ্জ, পিকআপের ধরন এবং সময় স্লটের তথ্য প্রদান করে।

### **Request:**
```http
GET /api/v1/scrap-waste/pickup-slots
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "weight_ranges": [
      "< 15 kg (Light)",
      "15 - 50 kg (Standard)",
      "50 - 150 kg (Heavy)",
      "> 150 kg (Commercial Bulk)"
    ],
    "pickup_types": [
      {
        "type": "Doorstep",
        "title": "Doorstep Pickup",
        "description": "Homes, Flats & Apartments"
      },
      {
        "type": "Bulk",
        "title": "Bulk / Commercial",
        "description": "Offices, Shops & Warehouses"
      }
    ],
    "date_options": ["Today", "Tomorrow", "Day After Tomorrow"],
    "time_slots": [
      "09:00 AM - 12:00 PM",
      "10:00 AM - 01:00 PM",
      "02:00 PM - 05:00 PM",
      "05:00 PM - 07:30 PM"
    ]
  }
}
```

---

# 3️⃣ POST `/pickup-request` — ডোরস্টেপ স্ক্র্যাপ পিকআপ রিকোয়েস্ট সাবমিশন

ইউজার ক্যাটাগরি, আনুমানিক ওজন, পিকআপের ধরন, ঠিকানা এবং স্লট নির্বাচন করে **"Request Doorstep Pickup"** চাপলে এই API কল হয়।

### **Request:**
```http
POST /api/v1/scrap-waste/pickup-request
Authorization: Bearer <user_token>
Content-Type: multipart/form-data
```

### **Multipart Form Fields:**

| Field Name | Type | Required | Description |
|:---|:---:|:---:|:---|
| `material_categories` | `JSON array` | ✅ | সিলেক্ট করা ক্যাটাগরির নামের অ্যারে (যেমন: `["Paper & Newspapers", "Iron & Steel Scraps"]`) |
| `approx_weight_range`| `string` | ✅ | ওজনের পরিধি (যেমন: `"15 - 50 kg (Standard)"`) |
| `pickup_type` | `string` | ✅ | `"Doorstep"` অথবা `"Bulk"` |
| `pickup_address` | `string` | ✅ | পূর্ণাঙ্গ ঠিকানা (যেমন: `"Bejai Main Road, Mangalore - 575004"`) |
| `latitude` | `double` | ❌ | ডিভাইসের GPS অক্ষাংশ (Latitude) |
| `longitude` | `double` | ❌ | ডিভাইসের GPS দ্রাঘিমাংশ (Longitude) |
| `contact_phone` | `string` | ✅ | ইউজারের যোগাযোগের ১০ ডিজিট মোবাইল নম্বর |
| `preferred_date` | `string` | ✅ | `"Today"`, `"Tomorrow"` ইত্যাদি |
| `preferred_time_slot`| `string` | ✅ | `"10:00 AM - 01:00 PM"` ইত্যাদি |
| `scrap_photo` | `File (Binary)`| ❌ | স্ক্র্যাপের ছবি (ঐচ্ছিক — `.jpg` / `.png`) |
| `special_instructions`| `string`| ❌ | বিশেষ নির্দেশনা (যেমন: `"Scrap is on 2nd floor, lift available"`) |

### **Success Response `201 Created`:**
```json
{
  "success": true,
  "message": "Scrap pickup scheduled successfully. An authorized buyer has been assigned.",
  "data": {
    "request_id": "VSW-2026-90412",
    "materials": [
      "Paper & Newspapers",
      "Iron & Steel Scraps"
    ],
    "approx_load": "15 - 50 kg (Standard)",
    "pickup_type": "Doorstep",
    "scheduled_date": "Tomorrow",
    "scheduled_slot": "10:00 AM - 01:00 PM",
    "pickup_address": "Bejai Main Road, Bejai, Mangalore, Karnataka - 575004",
    "status": "BUYER_ASSIGNED",
    "assigned_buyer": {
      "name": "Suresh Gowda",
      "phone": "+91 824 244 5555",
      "vehicle_no": "KA-19-E-4421",
      "scale_type": "Certified Electronic Digital Scale"
    },
    "created_at": "2026-11-26T13:40:00.000Z"
  }
}
```

---

# 4️⃣ GET `/requests/:id/track` — লাইভ পিকআপ স্ট্যাটাস ট্র্যাকিং

রিকোয়েস্ট আইডি দিয়ে পিকআপের বর্তমান অবস্থা ট্র্যাক করার API।

### **Request:**
```http
GET /api/v1/scrap-waste/requests/VSW-2026-90412/track
Authorization: Bearer <user_token>
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "request_id": "VSW-2026-90412",
    "status": "OUT_FOR_PICKUP",
    "materials": ["Paper & Newspapers", "Iron & Steel Scraps"],
    "pickup_slot": "Tomorrow, 10:00 AM - 01:00 PM",
    "address": "Bejai Main Road, Bejai, Mangalore",
    "buyer": {
      "name": "Suresh Gowda",
      "phone": "+91 824 244 5555",
      "vehicle_no": "KA-19-E-4421"
    },
    "timeline": [
      { "status": "REQUEST_PLACED", "time": "10:00 AM", "done": true },
      { "status": "BUYER_ASSIGNED", "time": "10:05 AM", "done": true },
      { "status": "OUT_FOR_PICKUP", "time": "10:30 AM", "done": true },
      { "status": "WEIGHING_COMPLETED", "time": null, "done": false },
      { "status": "PAYMENT_COMPLETED", "time": null, "done": false }
    ]
  }
}
```

---

# 5️⃣ GET `/my-pickups` — ইউজারের অতীতের ও চলমান পিকআপ হিস্ট্রি

### **Request:**
```http
GET /api/v1/scrap-waste/my-pickups?page=1&limit=10
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
        "request_id": "VSW-2026-90412",
        "materials": "Paper & Newspapers, Iron & Steel Scraps",
        "scheduled_date": "Tomorrow, 10:00 AM - 01:00 PM",
        "status": "BUYER_ASSIGNED",
        "created_at": "2026-11-26T13:40:00.000Z"
      }
    ]
  }
}
```

---

# 6️⃣ POST `/requests/:id/cancel` — পিকআপ রিকোয়েস্ট বাতিল

### **Request:**
```http
POST /api/v1/scrap-waste/requests/VSW-2026-90412/cancel
Authorization: Bearer <user_token>
Content-Type: application/json
```

```json
{
  "cancellation_reason": "Not available at home during scheduled slot"
}
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "Scrap pickup request cancelled successfully.",
  "data": {
    "request_id": "VSW-2026-90412",
    "status": "CANCELLED"
  }
}
```

---

## ⚠️ Error Codes & Responses

| Status Code | Scenario | Sample Error Response |
|:---:|:---|:---|
| `400 Bad Request` | কোনো উপাদান সিলেক্ট না করা হলে বা ঠিকানা খালি থাকলে | `{"success": false, "message": "At least one scrap material category is required"}` |
| `401 Unauthorized` | লগইন টোকেন না থাকলে বা মেয়াদ শেষ হলে | `{"success": false, "message": "Authentication required. Please login."}` |
| `404 Not Found` | অবৈধ রিকোয়েস্ট আইডি | `{"success": false, "message": "Pickup request not found"}` |
| `500 Server Error` | ব্যাকএন্ড ডাটাবেস এরর | `{"success": false, "message": "Internal server error. Please try again later."}` |
