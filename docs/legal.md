# ⚖️ V-Com — Legal & Advisory Services API Documentation

> **মডিউল:** Legal & Advisory Services (`/feature/legal_advisory`)  
> **ট্যাগলাইন:** *Your Legal Assistance, Our Support — Connect. Consult. Resolve.*  
> **Base URL:** `https://v-com-server.onrender.com/api/v1/legal-advisory`  
> **Content-Type:** `application/json`  
> **Auth:** পাবলিক ডেটা (ক্যাটাগরি) দেখতে টোকেন অপশনাল। কিন্তু রিকোয়েস্ট তৈরি/কনফার্ম ও ট্র্যাক করতে `Authorization: Bearer <token>` দিতে হবে।  
> **ফ্লো আপডেট (Updated Flow):**  
> ইউজার অ্যাপে শুধুমাত্র **ক্যাটাগরি নির্বাচন**, **লোকেশন (GPS বা ম্যানুয়াল)** এবং **Confirm Request** বোতাম থাকবে। ইউজার যদি ৮ নম্বর ক্যাটাগরি **"Other Legal Advisory"** সিলেক্ট করে, তবে একটি বিবরণ লেখার ফর্মফিল্ড (`other_query`) খুলে যাবে।

---

## 🔗 API Endpoints Overview

| Method | Endpoint | কাজ (Description) | Auth |
|:---|:---|:---|:---:|
| `GET` | `/categories` | ৮টি লিগ্যাল ক্যাটাগরির বিস্তারিত লিস্ট ফেচ করা | ❌ Public |
| `POST` | `/request` | **Confirm Request** — ক্যাটাগরি, লোকেশন ও ডিটেইলস সহ সরাসরি রিকোয়েস্ট জমা দেওয়া | 🔒 Required |
| `GET` | `/track/:ticket_no` | টিকিটের লাইভ স্ট্যাটাস ট্র্যাকিং দেখা | 🔒 Required |
| `GET` | `/history` | ইউজারের নিজস্ব সব অতীত ও বর্তমান কনসাল্টেশন হিস্ট্রি দেখা | 🔒 Required |

---

# 1️⃣ GET `/categories` — ৮টি লিগ্যাল ক্যাটাগরি তালিকা

অ্যাপে প্রদর্শন করার জন্য ৮টি অনুমোদিত লিগ্যাল ক্যাটাগরির তালিকা নিয়ে আসে।

### **Request:**
```http
GET /api/v1/legal-advisory/categories
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "message": "Legal categories retrieved successfully",
  "data": [
    {
      "id": 1,
      "code": "CRIMINAL",
      "title": "Criminal Law",
      "subtitle": "Criminal cases, bail, complaints",
      "icon": "Icons.gavel_rounded",
      "theme_color": "#DC2626"
    },
    {
      "id": 2,
      "code": "CIVIL",
      "title": "Civil Law",
      "subtitle": "Property disputes, recovery",
      "icon": "Icons.balance_rounded",
      "theme_color": "#0969DA"
    },
    {
      "id": 3,
      "code": "CORPORATE",
      "title": "Corporate & Business Law",
      "subtitle": "Contracts, compliance",
      "icon": "Icons.handshake_rounded",
      "theme_color": "#2563EB"
    },
    {
      "id": 4,
      "code": "FAMILY",
      "title": "Family Law",
      "subtitle": "Divorce, custody, maintenance",
      "icon": "Icons.family_restroom_rounded",
      "theme_color": "#9333EA"
    },
    {
      "id": 5,
      "code": "PROPERTY",
      "title": "Property & Real Estate Law",
      "subtitle": "Land disputes, registration",
      "icon": "Icons.home_work_rounded",
      "theme_color": "#EA580C"
    },
    {
      "id": 6,
      "code": "CONSUMER",
      "title": "Consumer & Legal Rights",
      "subtitle": "Consumer disputes, compensation",
      "icon": "Icons.shopping_bag_outlined",
      "theme_color": "#0D9488"
    },
    {
      "id": 7,
      "code": "LABOUR",
      "title": "Labour & Employment Law",
      "subtitle": "Employment matters",
      "icon": "Icons.work_outline_rounded",
      "theme_color": "#475569"
    },
    {
      "id": 8,
      "code": "OTHER",
      "title": "Other Legal Advisory",
      "subtitle": "Any other legal assistance",
      "icon": "Icons.more_horiz_rounded",
      "theme_color": "#1E293B",
      "requires_custom_input": true
    }
  ]
}
```

---

# 2️⃣ POST `/request` — Confirm Legal Assistance Request

ইউজার ক্যাটাগরি ও লোকেশন সিলেক্ট করে **"Confirm Request"** চাপলে এই API কল হবে। যদি **"Other Legal Advisory"** ক্যাটাগরি হয়, তবে অতিরিক্ত `other_query` টেক্সট পাঠানো হবে।

### **Request:**
```http
POST /api/v1/legal-advisory/request
Authorization: Bearer <user_token>
Content-Type: application/json
```

```json
{
  "category_id": 8,
  "category_name": "Other Legal Advisory",
  "location": "Bejai Main Road, Bejai, Mangalore, Karnataka - 575004",
  "latitude": 12.8912,
  "longitude": 74.8423,
  "other_query": "Need legal review of our commercial warehouse lease agreement and partnership dispute settlement."
}
```

### **Success Response `201 Created`:**
```json
{
  "success": true,
  "message": "Legal assistance request submitted successfully",
  "data": {
    "ticket_no": "VLA-2026-90412",
    "category": "Other Legal Advisory",
    "location": "Bejai Main Road, Bejai, Mangalore, Karnataka - 575004",
    "other_query": "Need legal review of our commercial warehouse lease agreement...",
    "status": "REQUEST_RECEIVED",
    "submitted_at": "2026-11-26T10:40:00.000Z"
  }
}
```

---

# 3️⃣ GET `/track/:ticket_no` — রিয়েল-টাইম টিকিট স্ট্যাটাস

### **Request:**
```http
GET /api/v1/legal-advisory/track/VLA-2026-90412
Authorization: Bearer <user_token>
```

### **Success Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "ticket_no": "VLA-2026-90412",
    "category": "Other Legal Advisory",
    "location": "Bejai, Mangalore",
    "status": "ADVOCATE_ASSIGNED",
    "assigned_advocate": {
      "name": "Adv. Mohammed A.",
      "specialization": "Civil & Commercial Advisory",
      "contact_status": "Will call at registered number"
    },
    "created_at": "2026-11-26T10:40:00.000Z"
  }
}
```
