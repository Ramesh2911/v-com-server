# 🚨 V-Com — Emergency SOS API Documentation

> **মডিউল:** Emergency SOS (`/feature/SosRequestScreen` & `/feature/SosSuccessScreen`)  
> **উদ্দেশ্য:** ২৪/৭ ইমার্জেন্সি রেসপন্স, অ্যাম্বুলেন্স, পুলিশ, ফায়ার সার্ভিস, ডক্টর কনসাল্টেশন এবং রোডসাইড অ্যাসিস্ট্যান্স।  
> **Base URL:** `https://v-com-server.onrender.com/api/v1/sos`  
> **Content-Type:** `multipart/form-data` (যেহেতু ক্যামেরা ফটো তোলা বাধ্যতামূলক) এবং `application/json`  
> **Auth:** ইমার্জেন্সিতে লগইন টোকেন অপশনাল হলেও ব্যবহারকারীর ফোন নম্বরে **৪ ডিজিটের OTP ভেরিফিকেশন বাধ্যতামূলক** (ফেক কল/হক্স অ্যালার্ট প্রতিরোধ করার জন্য)।

---

## 📋 সূচিপত্র (Table of Contents)

1. [API Endpoints Overview](#-api-endpoints-overview)
2. [1️⃣ GET `/categories` — ১০টি ইমার্জেন্সি ক্যাটাগরি তালিকা](#1️⃣-get-categories--১০টি-ইমার্জেন্সি-ক্যাটাগরি-তালিকা)
3. [2️⃣ POST `/send-otp` — ৪-ডিজিটের ইমার্জেন্সি অথেনটিকেশন OTP পাঠানো](#2️⃣-post-send-otp--৪-ডিজিটের-ইমার্জেন্সি-অথেনটিকেশন-otp-পাঠানো)
4. [3️⃣ POST `/verify-otp` — ৪-ডিজিটের OTP যাচাই](#3️⃣-post-verify-otp--৪-ডিজিটের-otp-যাচাই)
5. [4️⃣ POST `/dispatch` — বাধ্যতামূলক ফটো ও ডিটেইলস সহ SOS রিকোয়েস্ট সাবমিশন](#4️⃣-post-dispatch--বাধ্যতামূলক-ফটো-ও-ডিটেইলস-সহ-sos-রিকোয়েস্ট-সাবমিশন)
6. [5️⃣ GET `/track/:ticket_no` — লাইভ রেসপন্ডার স্ট্যাটাস ট্র্যাকিং](#5️⃣-get-trackticket_no--লাইভ-রেসপন্ডার-স্ট্যাটাস-ট্র্যাকিং)
7. [6️⃣ POST `/cancel/:ticket_no` — SOS রিকোয়েস্ট বাতিল](#6️⃣-post-cancelticket_no--sos-রিকোয়েস্ট-বাতিল)
8. [7️⃣ GET `/history` — ইউজারের পূর্বের SOS হিস্ট্রি](#7️⃣-get-history--ইউজারের-পূর্বের-sos-হিস্ট্রি)
9. [Error Codes & Responses](#-error-codes--responses)

---

## 🔗 API Endpoints Overview

| Method | Endpoint | কাজ (Description) | Content-Type |
|:---|:---|:---|:---:|
| `GET` | `/categories` | ১০টি জরুরি ক্যাটাগরির বিস্তারিত লিস্ট ও হেল্পলাইন | `application/json` |
| `POST` | `/send-otp` | ইউজারের নম্বরে ৪ ডিজিটের ভেরিফিকেশন কোড পাঠানো | `application/json` |
| `POST` | `/verify-otp` | ব্যবহারকারীর দেওয়া ৪ ডিজিটের OTP যাচাই করা | `application/json` |
| `POST` | `/dispatch` | **ক্যামেরা ফটো**, লোকেশন ও রোগী বিবরণ সহ SOS পাঠানো | `multipart/form-data` |
| `GET` | `/track/:ticket_no` | রেসপন্ডার ও অ্যাম্বুলেন্সের লাইভ অবস্থান ও ETA ট্র্যাকিং | `application/json` |
| `POST` | `/cancel/:ticket_no` | সমস্যা সমাধান হলে বা ভুলবশত কল হলে অ্যালার্ট বাতিল করা | `application/json` |
| `GET` | `/history` | লগইন থাকা ইউজারের আগের সব জরুরি কলের তালিকা | `application/json` |

---

# 1️⃣ GET `/categories` — ১০টি ইমার্জেন্সি ক্যাটাগরি তালিকা

অ্যাপে ইমার্জেন্সি ডায়ালগ এবং গ্রিডে প্রদর্শিত ১০টি জরুরি বিভাগের তালিকা প্রদান করে।

### **Request:**
```http
GET /api/v1/sos/categories
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "Emergency categories fetched successfully",
  "data": [
    {
      "id": 1,
      "code": "MEDICAL",
      "name": "Medical Emergency",
      "subtitle": "Ambulance, first aid, medical assistance and emergency transport",
      "helpline": "108",
      "theme_color": "#DC2626",
      "image_url": "https://images.unsplash.com/photo-1587745416684-47b88f3ce0b6?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 2,
      "code": "FIRE",
      "name": "Fire Emergency",
      "subtitle": "Fire brigade, rescue and fire hazard reporting",
      "helpline": "101",
      "theme_color": "#EA580C",
      "image_url": "https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 3,
      "code": "POLICE",
      "name": "Police Assistance",
      "subtitle": "Theft, assault, threats and suspicious activities",
      "helpline": "100",
      "theme_color": "#2563EB",
      "image_url": "https://images.unsplash.com/photo-1577495508048-b635879837f1?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 4,
      "code": "WOMEN_CHILD",
      "name": "Women & Child Safety",
      "subtitle": "Harassment, stalking, missing children and personal safety",
      "helpline": "1091",
      "theme_color": "#9333EA",
      "image_url": "https://images.unsplash.com/photo-1509099836639-18ba1795216d?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 5,
      "code": "ROAD_ACCIDENT",
      "name": "Road Accident",
      "subtitle": "Accident reporting, ambulance and rescue coordination",
      "helpline": "1073",
      "theme_color": "#D97706",
      "image_url": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 6,
      "code": "BREAKDOWN",
      "name": "Vehicle Breakdown",
      "subtitle": "Towing, puncture, battery jump-start and roadside help",
      "helpline": null,
      "theme_color": "#0D9488",
      "image_url": "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 7,
      "code": "DISASTER",
      "name": "Natural Disaster",
      "subtitle": "Floods, landslides, storms and disaster assistance",
      "helpline": "1077",
      "theme_color": "#0284C7",
      "image_url": "https://images.unsplash.com/photo-1547683905-f686c993aae5?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 8,
      "code": "UTILITY",
      "name": "Electrical & Utility Emergency",
      "subtitle": "Electric shock, fallen wires, gas leaks and water hazards",
      "helpline": "1912",
      "theme_color": "#F59E0B",
      "image_url": "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 9,
      "code": "DOCTOR",
      "name": "Connect to a Doctor for Emergency",
      "subtitle": "Emergency doctor consultation, medical advice and urgent support",
      "helpline": null,
      "theme_color": "#059669",
      "image_url": "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=700&auto=format&fit=crop&q=80"
    },
    {
      "id": 10,
      "code": "GENERAL",
      "name": "General Emergency / Other",
      "subtitle": "Any other critical emergency situation requiring quick help",
      "helpline": "112",
      "theme_color": "#1E293B",
      "image_url": "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=700&auto=format&fit=crop&q=80"
    }
  ]
}
```

---

# 2️⃣ POST `/send-otp` — ৪-ডিজিটের ইমার্জেন্সি অথেনটিকেশন OTP পাঠানো

ইউজার যখন ফর্ম পূরণ করে সাবমিট করতে যায়, তখন ফেক কল ঠেকাতে সাথে সাথে তার ফোনে ৪ ডিজিটের ভেরিফিকেশন কোড পাঠানো হয়।

### **Request:**
```http
POST /api/v1/sos/send-otp
Content-Type: application/json
```

```json
{
  "phone": "9876543210"
}
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "OTP sent successfully to +91 9876543210",
  "data": {
    "phone": "9876543210",
    "otp_length": 4,
    "resend_in_seconds": 30,
    "default_test_otp": "1234"
  }
}
```

---

# 3️⃣ POST `/verify-otp` — ৪-ডিজিটের OTP যাচাই

ইউজার বটমশিট ডায়ালগে ৪ ডিজিটের কোড এন্টার করলে এই API যাচাই করে।

### **Request:**
```http
POST /api/v1/sos/verify-otp
Content-Type: application/json
```

```json
{
  "phone": "9876543210",
  "otp": "1234"
}
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "is_verified": true,
    "phone": "9876543210",
    "verification_token": "sos_token_983210_valid_until_15m"
  }
}
```

---

# 4️⃣ POST `/dispatch` — বাধ্যতামূলক ফটো ও ডিটেইলস সহ SOS রিকোয়েস্ট সাবমিশন

OTP ভেরিফাই হওয়ার পর অ্যাপ এই API-তে সমস্ত জরুরি তথ্য এবং ক্যামেরা দিয়ে তোলা ছবি পাঠায়।

### **Request:**
```http
POST /api/v1/sos/dispatch
Authorization: Bearer <token> (Optional)
Content-Type: multipart/form-data
```

### **Multipart Form Fields:**

| Field Name | Type | Required | Description |
|:---|:---:|:---:|:---|
| `category_id` | `integer` | ✅ | ইমার্জেন্সি ক্যাটাগরির আইডি (যেমন: `1` for Medical) |
| `photo` | `File (Binary)` | ✅ | **ক্যামেরা ফটো (বাধ্যতামূলক)** — `.jpg`/`.png` |
| `requester_phone` | `string` | ✅ | রিকোয়েস্টকারীর ১০ ডিজিটের মোবাইল নম্বর |
| `requester_location` | `string` | ✅ | রিকোয়েস্টকারীর ঠিকানা বা ল্যান্ডমার্ক (যেমন: `Bejai, Mangalore`) |
| `latitude` | `double` | ❌ | ডিভাইসের GPS অক্ষাংশ (Latitude) |
| `longitude` | `double` | ❌ | ডিভাইসের GPS দ্রাঘিমাংশ (Longitude) |
| `is_for_other` | `boolean` | ✅ | নিজের জন্য (`false`) নাকি অন্যের/বাবা-মায়ের জন্য (`true`) |
| `other_person_name` | `string` | ⚠️ | `is_for_other=true` হলে রোগীর/ব্যক্তির নাম |
| `relationship` | `string` | ⚠️ | সম্পর্ক: `Parents`, `Father`, `Mother`, `Spouse`, `Child`, `Neighbor`, ইত্যাদি |
| `other_person_phone`| `string` | ⚠️ | রোগীর সাথে থাকা ব্যক্তির মোবাইল নম্বর |
| `patient_location` | `string` | ⚠️ | রোগীর প্রকৃত অবস্থান (যেখানে সাহায্য পাঠাতে হবে) |
| `description` | `string` | ✅ | জরুরি ঘটনার বিবরণ (সমস্যা কী হয়েছে) |
| `special_instructions` | `string` | ❌ | রেসপন্ডারদের জন্য বিশেষ নির্দেশনা (যেমন: ৩য় তলা, লিফট নেই, গেট কোড ইত্যাদি) |
| `verification_token` | `string` | ✅ | OTP ভেরিফিকেশন টোকেন |

### **Success Response `201 Created`:**
```json
{
  "success": true,
  "message": "Emergency SOS Dispatched Successfully",
  "data": {
    "ticket_no": "SOS-2026-98124",
    "category": "Medical Emergency",
    "status": "DISPATCHED",
    "priority": "HIGH_CRITICAL",
    "dispatched_at": "2026-11-26T10:15:30.000Z",
    "requester": {
      "phone": "9876543210",
      "location": "Bejai, Mangalore"
    },
    "patient": {
      "is_for_other": true,
      "name": "Ramesh Kumar (Parents)",
      "phone": "9876500000",
      "exact_location": "Flat 302, Green Valley Apartments, Bejai Main Rd"
    },
    "photo_url": "https://v-com-assets.s3.amazonaws.com/sos_uploads/photo_98124.jpg",
    "special_instructions": "Gate code 1234, patient is on 3rd floor.",
    "assigned_responder": {
      "unit_name": "Apollo Emergency Response Unit 4",
      "contact_no": "+91 824 244 5555",
      "vehicle_no": "KA-19-EM-9921",
      "driver_name": "Suresh Gowda",
      "estimated_eta": "8 mins"
    }
  }
}
```

---
