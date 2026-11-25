# V_COM Platform — API Contract

REST API for the V_COM Business Management Platform. Consumed by:

- **Customer mobile app** (`/customer/*`, `/auth/*`, public endpoints)
- **Vendor mobile app** (`/vendor/*`, `/auth/*`, public endpoints)
- **Admin web panel** (`/admin/*`, `/auth/*`, `/me`)

---

## 1. Conventions

| Item | Value |
|---|---|
| Base URL (dev) | `http://localhost:8000/api/v1` |
| Base URL (prod) | `https://v-com-server.onrender.com/api/v1` |
| Content type | `application/json` (except uploads: `multipart/form-data`) |
| Auth | `Authorization: Bearer <accessToken>` |
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days |
| OTP verify token TTL | 5 minutes |
| Timestamps | MySQL `DATETIME` / ISO-ish `YYYY-MM-DD HH:MM:SS` (UTC server time) |

**Common request headers:**

| Header | When | Value |
|---|---|---|
| `Content-Type` | always (JSON bodies) | `application/json` |
| `Authorization` | auth required | `Bearer <accessToken>` |
| `Content-Type` | uploads | `multipart/form-data` (set boundary automatically) |

> All paths below are prefixed with the base URL, e.g. `/auth/otp/send` → `POST /api/v1/auth/otp/send`.

### 1.1 Response envelope

Every JSON response uses the same shape:

```json
{ "success": true, "message": "OK", "data": { } }
```

Paginated lists (`sendPaginated`):

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "items": [ ... ],
    "pagination": {
      "total": 120, "page": 1, "limit": 15, "totalPages": 8,
      "hasNext": true, "hasPrev": false
    }
  }
}
```

Errors:

```json
{ "success": false, "message": "Human readable reason", "errors": [ { "message": "..." } ] }
```

Validation errors return **400** with `errors[]`. Standard codes:

| Code | Meaning |
|---|---|
| 400 | Validation / bad request |
| 401 | Missing/expired token, bad credentials |
| 403 | Authenticated but lacks permission (RBAC) |
| 404 | Not found |
| 409 | Conflict (duplicate email/code/slug) |
| 413 | File too large |
| 429 | Rate limited (login, register) |
| 500 | Server error |

### 1.2 Pagination query params

`?page=1&limit=15` — `limit` max **100** (default 15). Some mobile lists (customer requests, notifications) return plain arrays capped at 100 rows.

### 1.3 RBAC

- Permissions are checked on admin routes (`requirePermission('x.y')`).
- Mobile endpoints only require a valid token + correct `user_type` (customer/vendor).
- `modules.all` permission = super admin (bypasses module filtering).
- Module access permissions: `module.<code>.access` for each service module, plus `module.sos.access`, `module.hr.access`.

Full permission list: see §9.

---

## 2. Auth (`/api/v1/auth`, `/api/v1/me`)

### 2.1 App phone + OTP flow (mobile apps)

```
┌──────────────┐   ┌────────────────────────────┐
│ 1. otp/send  │──▶│ 2. otp/verify              │
│  {phone}     │   │ {phone, code, client?}     │
└──────────────┘   └─────────────┬──────────────┘
                       ┌─────────┴──────────┐
              EXISTS user              NEW user
                       │                    │
              tokens + user           verifyToken + isNewUser:true
              (isNewUser:false)              │
                                   ┌─────────┴──────────┐
                                   │ 3. register        │
                                   │ {verifyToken,name, │
                                   │  email,client,role?}│
                                   └─────────┬──────────┘
                                       tokens + user
```

**Step 1 — send OTP**

```
POST /api/v1/auth/otp/send
Headers: Content-Type: application/json
```
```json
{ "phone": "9876543210" }
```
→ **200**
```json
{
  "success": true,
  "message": "OTP sent successfully to +91 9876543210",
  "data": { "phone": "9876543210", "expiresIn": 300, "devOtp": "123456" }
}
```
- Phone: 10-digit Indian mobile (`+91`/`0` prefix auto-stripped), must start 6–9.
- `devOtp` returned **only in non-production** (mock SMS). Test OTP = `123456`.
- Rate limits: **3/min per IP**, **1/min per phone**, **5/day per phone** → `429`.

**Step 2 — verify OTP (existing user logs in here — no separate login API)**

```
POST /api/v1/auth/otp/verify
Headers: Content-Type: application/json
```
```json
{ "phone": "9876543210", "code": "123456", "client": "customer" }
```

-OTP: 6 digits, TTL **5 min**, max **5 wrong attempts** then burnt, single-use.
- `client` optional but recommended — enforces app↔role match (403 on mismatch). Values: `"customer" | "vendor" | "technician"`.
- **`client: "technician"`** → looks up the **technicians table by phone** (not users): unregistered phone → `404` (before OTP burn); inactive tech → `403` + `data: { status }`; on success a shadow `users` row (role `technician`) is created lazily and the response carries a `technician` object instead of `vendor` (see §12).

**2a — existing user → 200 (login payload, ready to use):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": 7, "name": "...", "email": "...", "phone": "9876543210",
              "user_type": "customer", "role_slug": "customer", "permissions": ["services.view"] },
    "vendor": null,
    "accessToken": "jwt...",
    "refreshToken": "jwt...",
    "isNewUser": false
  }
}
```
→ App: `isNewUser === false` → home screen. Done.

> **`client: "vendor"` login response** — `vendor` carries the **vendors table status** for screen routing:
> `{ id, business_name, status, coverage_areas, photo, rejection_reason }`
> - `vendor === null` → no provider account yet (fresh customer phone on the vendor app)
> - `status: "pending"` → waiting-for-approval screen · `"approved"` → home ·
>   `"rejected"` → rejected screen (show `rejection_reason`) · `"suspended"` → suspended screen

**2b — new user → 200 (register next):**
```json
{
  "success": true,
  "message": "Phone verified — complete your registration",
  "data": { "verifyToken": "eyJhbGciOi...", "isNewUser": true, "phone": "9876543210", "vendor": null }
}
```
`vendor: null` — no vendors row exists yet (it is created by `POST /auth/register` for `client: "vendor"`).
Errors: `400` incorrect/expired/already-used · `429` too many attempts · `403` wrong-app login.

**Step 3 — register (new user only)**

```
POST /api/v1/auth/register
Content-Type: application/json            (customer flow)
Content-Type: multipart/form-data         (vendor flow — fields + KYC images)
```
Customer example (JSON):
```json
{
  "verifyToken": "eyJhbGciOi...",
  "name": "Rahul Das",
  "email": "rahul@example.com",
  "client": "customer"
}
```
Vendor (service provider owner) example — **multipart**, creates a `pending` vendor with KYC documents:
```
Fields (all strings):
  verifyToken*, name*, client="vendor", business_name*, address*,
  contact_person?, city?, state?, pincode?, gst_no?,
  email?, category_ids*   (JSON string e.g. "[1,5,18]" or CSV)
Files (all required, images only, ≤10MB each):
  photo*, aadhar_front*, aadhar_back*, pan_front*, pan_back*
```
| Field | Required | Notes |
|---|---|---|
| `verifyToken` | ✓ | from step 2b (5 min TTL, retry ok) |
| `name` | ✓ | min 1 char |
| `email` | vendor: optional · else ✓ | unique; must be valid if sent |
| `client` | ✓ | `"customer"` \| `"vendor"` |
| `role` | vendor only | `"provider_owner"` (default). `"technician"` → **400** |
| `business_name` | vendor ✓ | |
| `address` | vendor ✓ | max 255 chars |
| `contact_person`, `city`, `state`, `pincode` | vendor optional | |
| `gst_no` | vendor optional | max 30 chars |
| `category_ids` | vendor ✓ | ≥1 active service category ids (JSON array string or CSV) |
| `photo, aadhar_front, aadhar_back, pan_front, pan_back` | vendor ✓ (files) | multipart files — **images only** (png/jpg/…), each ≤ `MAX_UPLOAD_SIZE_MB` (default 10). Uploaded to Cloudinary; stored URLs on the vendor row |

→ **201** — same login payload as 2a. `vendor` object includes `status: "pending"` + `photo` URL. Files upload **before** any DB write — upload/tx failure leaves nothing behind (retry with same verifyToken).
Errors: `400` missing business/address/category/files (`"PAN back image is required"`), non-image file, invalid category · `409` phone/email conflict · `401` invalid verifyToken.

**Role mapping:**

| `client` | `role` sent | Resulting `role_slug` | `user_type` | App |
|---|---|---|---|---|
| `customer` | — (forced) | `customer` | `customer` | Customer app |
| `vendor` | omitted → `provider_owner` | `provider_owner` | `customer` | Vendor app (owner) — creates pending `vendors` row + `vendor_service_categories` + saves KYC |
| `vendor` | `technician` | — | — | **400** — technicians are created by the owner via `POST /vendor/technicians` |

> Super admin cannot self-register; an existing super admin phone OTP-login korle tokens pabe.
> **403 "This account does not belong to this app"** on `otp/verify` = that phone already belongs to another role (e.g. a customer account). Use a fresh number for vendor signup.

**Token refresh / logout**

```
POST /api/v1/auth/refresh        Headers: Content-Type: application/json
Body: { "refreshToken": "eyJ..." }   (alias accepted: { "refresh_token": "..." })
→ 200 { accessToken, refreshToken }   (rotation — store BOTH, old refresh token revoked)

POST /api/v1/auth/logout          Headers: Authorization: Bearer <accessToken>
Body: { "refreshToken": "eyJ..." }   (optional — revokes all user sessions if omitted)
→ 200
```

Refresh rules (for apps):
- **Rotation + 60s grace:** each refresh returns a new pair; a token rotated ≤60 s ago is still accepted (multi-tab / concurrent-refresh race safe). Older revoked tokens → `401 Refresh token revoked or expired`.
- `401` from refresh (invalid / expired / revoked beyond grace) → **session dead: clear tokens and re-login**. Never infinite-retry.
- Network error / `5xx` / `429` on refresh → **transient: keep tokens and retry later** (do not log the user out).
- Refresh token lifetime: **7 days** (`JWT_REFRESH_EXPIRES_IN`). Access token: **15 min** (`JWT_EXPIRES_IN`).
- Recommended client flow: on any API `401` → POST `/auth/refresh` with stored refresh token → retry original request with new access token; sync rotated tokens across tabs (storage events).

**Test numbers (dev):**

| Phone | Flow | Expected |
|---|---|---|
| `9876543210` | verify → tokens (existing after first register) | customer |
| `9876500001` | verify → tokens | customer (seed) |
| `9876500003` | verify `client:vendor` → tokens | `provider_owner` + vendor payload |
| `9000000001` | verify → tokens | super admin |
| any new 10-digit | verify → `isNewUser:true` → register | new account |

### 2.2 Email + password (admin web panel)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `name, email, password, phone?` | Creates **customer**. Rate-limited 20/h. Returns login payload + 201. |
| POST | `/auth/login` | `email, password` | Returns `{ user, accessToken, refreshToken }`. `user` includes `permissions[]` and `user_type`. |
| POST | `/auth/forgot-password` | `email` | Always 200 (no user enumeration). Token logged/emailed if configured. |
| POST | `/auth/reset-password` | `token, password` | |
| POST | `/auth/change-password` | `currentPassword, newPassword` | Auth required. `newPassword` min 6. |
| GET | `/me` | — | Auth. Returns profile + `permissions[]` + `vendor` + `employee` objects. |
| PUT | `/me` | `name?, email?, phone?, avatar?` | Auth. Partial update → **returns full updated profile** (same shape as GET) + `message: "Profile updated"`. Duplicate email/phone (other user) → `409 Email/Phone already in use`. `avatar`: `""` clears; **base64 data URI** auto-uploaded to Cloudinary (stored as URL; falls back to raw if upload unavailable); any other string accepted as-is (https URL, `file://`, `content://`, relative path, raw base64, or `{ uri }` object — mobile picker friendly, stored in MEDIUMTEXT); max ~6 MB. JSON body limit 10 MB. |

**Login/register response (`data`):**

```json
{
  "user": {
    "id": 1, "name": "...", "email": "...", "phone": "...",
    "user_type": "staff|customer|employee",
    "role_name": "...", "role_slug": "super_admin|customer|provider_owner|technician|...",
    "permissions": ["dashboard.view", ...]
  },
  "vendor": { "id": 3, "business_name": "...", "status": "approved" } | null,
  "accessToken": "jwt...",
  "refreshToken": "jwt..."
}
```

> Mobile apps: after login, route by `role_slug` — `customer` → `/customer/*`; `provider_owner`/`technician` → `/vendor/*`.

---

## 3. Public endpoints (no auth)

### 3.1 Services (`/api/v1/services`)

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/services` | — | All active modules, each **nested with `categories[]`** |
| GET | `/services/featured` | — | Featured categories (max 12) with `module_name` |
| GET | `/services/search` | `q` | `{ modules: [], categories: [] }` matching name/description |
| GET | `/services/category/:id` | — | **Category/service detail** (must be numeric category id) + review block |
| GET | `/services/:id` | — | Numeric id: **module first**, else falls back to **category**. Response has `kind: "module" | "category"` + review block |
| GET | `/services/:id/reviews` | `page, limit` | Paginated **public reviews** for the service (module or category id) |

**Module:** `{ kind: "module", id, code, name, description, icon, theme, colors, image, status, sort_order, created_at, updated_at, categories: [...], review_summary, reviews }`

**Category:** `{ kind: "category", id, module_id, name, description, image, price, is_featured, status, sort_order, group_name, ref_code, module_name, module_code, module_theme, module_colors, review_summary, reviews }`

**Card theme presets** — admin picks `theme` per module (create/update); every GET returns resolved `colors` so the app just renders them:

| `theme` | `colors` |
|---|---|
| `quick` | `{ "background": "#0F172A", "text": "#FFFFFF", "accent": "#FFFFFF", "on_accent": "#0F172A" }` (black bg · white theme) |
| `special` | `{ "background": "#DBEAFE", "text": "#0F172A", "accent": "#0F172A", "on_accent": "#FFFFFF" }` (light blue bg · black theme) |
| `professional` | `{ "background": "#FFFFFF", "text": "#1F2937", "accent": "#FFF3D6", "on_accent": "#1F2937" }` (white bg · cream theme) |
| `null` | `colors: null` — app falls back to its default icon-based gradient |

`background` = card banner bg, `text` = primary text on it, `accent` = icon-box/chip fill, `on_accent` = text on accent. Module responses carry `theme`+`colors`; category responses carry `module_theme`+`module_colors` (parent module's).

**Review block** (on `/services/:id` and `/services/category/:id`) — **service rating only, technician reviews are never public**:

```json
"review_summary": {
  "service_avg": 4.5,
  "service_count": 12,
  "distribution": { "1": 0, "2": 1, "3": 0, "4": 2, "5": 9 }
},
"reviews": [
  { "id": 7, "service_rating": 5, "service_comment": "Great work",
    "created_at": "2026-11-05T12:00:00.000Z",
    "customer_name": "Ramesh K.", "customer_avatar": null }
]
```

- `reviews` = latest **10** visible reviews (module: matches `module_id`; category: matches `category_id`). Paginated list: `GET /services/:id/reviews` → `{ items, pagination }` same item shape.
- `customer_name` is **masked** (`First L.`); `customer_avatar` full URL or `null`. Only `status = visible` reviews are returned.

- **Ids are numeric only.** Non-numeric (e.g. literal `/:31`) → `400 Invalid id — numeric module or category id required`. Unknown id → `404 Service not found`.
- **Module vs category ids differ per DB** (local: modules `1-3`; Clever/Render: modules `7-9`, categories `31-59`). Use `kind` (or `/services/category/:id`) to avoid ambiguity.

- `image`: full URL (Cloudinary `https://res.cloudinary.com/...` or `/uploads/...`), `null` if unset.
- `price`: `string|null` (DECIMAL, Quick Service pricing), `null` = not priced.
- Only `status = 1` rows returned (public). 3 modules / **31 categories** seeded:
  `special-service` → group `professional` (18), `quick-service` → group `quick` (7), `general-assistance` → group `special` (6).

**Catalog groups (v2)** — every category carries `group_name` (`professional` | `quick` | `special`) for the client's three-list UI; `sort_order` = position within its group:

- **professional (18):** Fabrication and Welding (1) … Fire and Safety (10), Manpower and Security (11), Event and Corporate Arrangements (12), Computer and Hardware (13), HVAC (14), Gardening and Landscaping (15), Water & Sewage Treatment (16), Special Care & Health Care (17), Real Estate & Properties (18).
- **quick (7):** Electrical Work (1) … Sunday Maid (7).
- **special (6):** SOS & Emergency (1), HR and Recruitment (2), Events and Offers (3), Bookings and Admissions (4), Legal & Advisory (5), Scrap and Waste Management (6).
- Soft-hidden (kept for FK/history, `status = 0`): Housekeeping and Security, Marketing, Travel and Insurance Schemes. Renames: *Interior and Office Inventory → **Interior Design and Carpentry***, *Events and Exhibitions → **Events and Offers***, *SOS/Emergency → **SOS & Emergency***.
- Admin `POST|PUT /admin/services/categories` accepts/validates `group_name`.

Example `GET /services` (first module trimmed):

```json
{
  "success": true,
  "data": [
    {
      "id": 1, "code": "special-service", "name": "Professional Service",
      "icon": "sparkles", "image": null, "status": 1, "sort_order": 1,
      "categories": [
        { "id": 1, "module_id": 1, "name": "Fabrication and Welding",
          "image": null, "price": null, "is_featured": 1, "status": 1,
          "group_name": "professional",
          "module_code": "special-service" }
      ]
    }
  ]
}
```

### 3.1a Special sub-services (`/api/v1/categories`)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/categories/:id/sub-services` | **none (public)** | `200` `{ category_id, category_name, bg_color, text_color, sub_services[] }` — `message: "Sub-services fetched successfully"` |

`/categories/:id/sub-services` — **work-type cards** (now **15 categories** with sub-services: the special-service set minus Housekeeping, plus Event and Corporate Arrangements (6); 6–14 cards each). `/api/v1/categories/:id/sub-services` e call korbe (slug route নেই).

```json
{
  "success": true,
  "message": "Sub-services fetched successfully",
  "data": {
    "category_id": 36,
    "category_name": "Interior Design and Carpentry",
    "bg_color": "#4F46E5",
    "text_color": "#FFFFFF",
    "sub_services": [
      { "id": 201, "code": "dream_project_interior", "title": "Dream Project Interior Design",
        "subtitle": "Complete turnkey luxury interior design for homes and villas.",
        "image": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500...",
        "bg_color": "#FF7E5F", "text_color": "#FFFFFF", "is_active": true }
    ]
  }
}
```

- `id` numeric only → `400`; unknown/inactive category → `404 Service not found`. Only `is_active = 1` sub-services returned (ordered by id). `image` = absolute URL as stored.
- **`service_id` / category ids are DB-specific — fetch them from `GET /services` (module `special-service`), never hardcode.** Live ids ≠ spec-doc example ids (e.g. Interior = live `36`, local `6`; Packers = live `33`). Spec-doc id map (live/Clever): Fabrication `31`, CCTV `32`, Packers `33`, Website `34`, Pest `35`, Interior `36`, Electrical `37`, Construction `38`, Accounting `39`, Fire `40`, Manpower `60`, Event `42`, Computer `43`, HVAC `44`, Gardening `45`, Water `46`, Health `47`, Real Estate `61`. Hidden: Housekeeping `41`, Travel `58`, Marketing `62`.
- **165 sub-services** seeded (`service_sub_services`; Housekeeping's 8 remain FK-bound under the hidden category); category screen theme = `bg_color`/`text_color` per category.

### 3.2 Properties (`/api/v1/properties`)

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/properties` | `search, listing_type (sale\|rent), property_type, city, area_id, builder_id, builder_name, project_id, project_name, min_amount, max_amount, featured, page, limit` | Paginated listings |
| GET | `/properties/filters` | — | Distinct builders/projects/areas/cities for filter UI |
| GET | `/properties/:id` | — | Detail incl. media, builder, project, area |
| POST | `/properties/:id/enquiry` | — | Body: `name, email, phone, message` → creates `VCOM-ENQ-*` ticket |

Property media URLs: returned as absolute URLs. Listing includes `{ property_code, title, listing_type, total_amount, status, ... }`.

### 3.3 Offers & coupons (public)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/offers` | — | **Active-now** offers: status=1, within `starts_at`/`ends_at` window, service active. Each: `{ id, title, description, discount_type, discount_value, starts_at, ends_at, image, category_id, category_name, category_image, category_price, module_id, module_name, module_code }` |
| POST | `/coupons/validate` | `{ code*, amount? }` | `{ code, title, discount_type, discount_value, max_discount, min_amount, applies_to, category_id, computed_discount }` — `computed_discount` present only when `amount` given (percent capped by `max_discount`, flat capped by `amount`) |

Errors: unknown/inactive/expired/future/usage-exhausted → `404` with clear message; `amount` < `min_amount` → `400`. Code matched case-insensitively (stored uppercase).

### 3.4 Banners (public — home carousel)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/banners` | — | **Active** banners ordered by `slot` ASC: `{ id, title, subtitle, image, slot }[]` (plain array). Active = `status=1` AND within `starts_at`/`ends_at` window (NULL = open-ended); **window evaluated in IST (Asia/Kolkata)** — matches admin-panel schedule entry. `image` is a full URL. |

No auth required. App home tab renders the list top-to-bottom by `slot` (1 = first position).

### 3.5 Events — Event & Corporate Arrangements (`/api/v1/events`, public)

| Method | Path | Query / Body | Returns |
|---|---|---|---|
| GET | `/events` | `location?` (area/city LIKE), `date?` = `all\|today\|tomorrow\|this_weekend\|this_month\|custom`, `custom_date?` (YYYY-MM-DD), `page?` (1), `limit?` (10, max 100) | `200` `{ items[], pagination }` — `message: "Events retrieved successfully"` |
| GET | `/events/:id` | — | `200` detail — `message: "Event details fetched successfully"`; unknown → `404 Event not found` |
| GET | `/events/locations` | `query?` (ba `q`) | `200` **plain string array** `["Salt Lake", ...]` (no other data) |
| POST | `/events/locations/search` | JSON `{ query? \| q? }` | same string array |

- **Auth optional** — token na dileo chole (endpoint e user context nei).
- **Dates = IST** (Asia/Kolkata): `event_date`/`start_time` stored IST wall-clock; response `date` = UTC ISO (e.g. IST `09:30` → `...T04:00:00.000Z`). Date filters IST-today dhore kaj kore (live UTC server e same).
- **Upcoming by default:** `date=all` hole `event_date >= IST-today` (past events list e nei; `/events/:id` detail e ache). `custom` = exact date (past-o dekha jay).
- `this_weekend` = আগামী Sat–Sun (aj Sat/Sun hole aj theke).
- Pagination keys spec-shaped: `{ current_page, total_pages, total_items, per_page }`.
- Item shape: `{ id ("ev-N"), title, organizer, category, date (ISO), time_range, location, venue_name, venue_address, banner_url, is_featured (bool), description, highlights[] }`; detail adds `amenities[]` + `coordinates { latitude, longitude }`.
- 16 demo events seeded (`events` table, `db/seed-events.js local|clever` — re-run refreshes dates dynamically); `ev-1`/`ev-2` app-dev spec theke verbatim.

---

## 4. Customer app (`/api/v1/customer/*`) — auth required, `role_slug = customer`

### 4.1 Requests / Bookings

| Method | Path | Body / Query |
|---|---|---|
| POST | `/customer/requests` | **Special:** multipart — `service_id*, sub_service_ids* (ids or codes; key `sub_service_ids` or `sub_service_ids[]`), address_id*, notes?, scheduled_date? (YYYY-MM-DD), scheduled_time? (HH:mm or HH:mm:ss), attachments?[] (≤8, PDF/JPG/PNG/DWG/DOC/BOQ)` → `201` special shape (below) |
| POST | `/customer/requests` | **Booking:** `service_id*, address_id*, scheduled_date* (YYYY-MM-DD), scheduled_time* (HH:mm 24hr)` → `201` booking |
| POST | `/customer/requests` | **Legacy:** `module_id, category_id?, title, description, site_location?, city?, latitude?, longitude?, quantity?, specifications?, priority?` + multipart `attachments[]` (≤8 files) → `{ id, ticket_no }` |
| GET | `/customer/requests` | `status? (upcoming\|in_progress\|completed\|cancelled or raw DB value), module_id?, search?, page?, limit?` → `{ items[], pagination }` |
| GET | `/customer/requests/:id` | → booking detail (doc shape) **+** legacy blocks `history[]`, `attachments[]`, `quotations[]`, `job`, `review` |
| PATCH | `/customer/requests/:id/cancel` | `reason?` → `{ id, status: "cancelled", cancelled_at, refund_status }` (POST alias kept) |

**Special mode** — dispatch: `sub_service_ids` key present → special handler (else booking/legacy unchanged). Validates sub-services belong to `service_id` + active; stores selected work types in `request_sub_services`, `notes` → `requests.description`, `scheduled_*` optional (seconds normalized to `HH:mm`), attachments → `request_attachments`. `booking_ref` = `REQ-{ref_code}-{year}-{id}` (ref_code per category: FAB/CCTV/INT/PM/WEB/PEST/ELE/CON/ACC/FIRE/HSK/COMP/HVAC/GRD/WATER/CARE). `ticket_no` (`VCOM-REQ-*`) generated as usual; staff notified.

```json
// 201 — message: "Special service request submitted successfully"
{ "success": true, "message": "Special service request submitted successfully",
  "data": {
    "request_id": 195, "booking_ref": "REQ-INT-2026-195", "status": "pending_review",
    "service": { "id": 36, "name": "Interior Design and Carpentry" },
    "sub_services": [ { "id": 201, "title": "Dream Project Interior Design" } ],
    "address": { "id": 12, "address_type": "Home", "formatted_address": "12A Rose Valley, Kolkata, West Bengal 700001" },
    "notes": "Work Types: ...\nRequirements: ...",
    "attachments": [ { "id": 72, "file_name": "floor_layout.dwg", "file_url": "https://.../requests/....dwg" } ],
    "created_at": "2026-11-17T11:15:00.000Z"
  } }
```

Errors: `400 "Please select at least one sub-service and address."` (missing `sub_service_ids`/`service_id`/`address_id`); `400 "Invalid sub-service selection."` (unknown code/id or wrong category); `404 Service not found` / `404 Address not found` (address must be caller's).

**Booking create** — `service_id` = service category id (`GET /services`), `address_id` = own address book id. Ticket no `VCOM-REQ-*`, booking ref `BK-YYYY-*` (fallback to ticket no for legacy rows).

**Status mapping** (DB → app): `pending_review/assigned/quoted/approved/scheduled → upcoming`, `in_progress → in_progress`, `completed/closed → completed`, `cancelled → cancelled`.

```json
POST /api/v1/customer/requests
{ "service_id": 5, "address_id": 12, "scheduled_date": "2026-11-20", "scheduled_time": "10:00" }
→ 201 { "success": true, "message": "Booking created successfully",
        "data": { "id": 101, "booking_ref": "BK-2026-101", "ticket_no": "VCOM-REQ-000101",
                  "status": "upcoming", "scheduled_at": "2026-11-20T10:00:00.000Z",
                  "service": { "id": 5, "name": "AC Servicing", "category": "Home Appliances" },
                  "address": { "id": 12, "line1": "12A, Rose Valley", "city": "Kolkata" },
                  "created_at": "..." } }
```

Errors: `400 service_id, address_id, scheduled_date and scheduled_time are required` · `404 Service not found` · `404 Address not found`.

**List item:** `{ id, booking_ref, status, scheduled_at, service: { id, name, category, image_url }, address: { line1, city, state, pincode }, payment: { total_amount, paid, method } }` + `pagination: { current_page, total_pages, total_items, per_page }`.

**Detail adds:** `service.base_price`, full `address` (line2/landmark/latitude/longitude), `provider: { id, name, phone, avatar, rating, total_jobs } | null`, `payment: { subtotal, visiting_fee, tax, discount, coupon_code, coupon_discount, total_amount, paid, method, payment_id }`, `timeline: [confirmed, partner_assigned, in_progress, completed]`, `review`. Payment block is a **stub** (no payment gateway yet): `paid: false`, fees `0`.

**Cancel rules:** `in_progress` → `400 Cannot cancel a booking that is already in progress`; `completed/closed/cancelled` → `400 Request can no longer be cancelled`. Reason stored in status history.

### 4.2 Quotations

| Method | Path | Body / Query |
|---|---|---|
| GET | `/customer/quotations` | `status?` → list with `items[]` |
| GET | `/customer/quotations/:id` | detail with `items[]` |
| POST | `/customer/quotations/:id/decision` | `decision: "accepted" \| "rejected" \| "clarification_requested", note?` |

### 4.3 SOS

| Method | Path | Body |
|---|---|---|
| POST | `/customer/sos` | `description, latitude?, longitude?, address?, priority? (default "critical")` → `VCOM-SOS-*` |
| GET | `/customer/sos` | → list |
| GET | `/customer/sos/:id` | → detail |

SOS statuses: `open → acknowledged → dispatched → resolved`.

### 4.4 HR (employee self-service)

> **403 unless the logged-in user is an active employee** (`requireEmployee`). Regular customer accounts receive `403 HR features are only available to employee accounts`. Use `employee@vcom.com` / `Employee@123` to test.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/customer/hr/me` | → employee profile |
| POST | `/customer/hr/attendance/check-in` | — |
| POST | `/customer/hr/attendance/check-out` | — |
| GET | `/customer/hr/attendance` | `month=YYYY-MM` → own records |
| POST | `/customer/hr/leaves` | `leave_type (casual\|sick\|annual\|unpaid\|other), from_date, to_date, reason` → `VCOM-LV-*` |
| GET | `/customer/hr/leaves` | → own leave requests |

### 4.5 Notifications

| Method | Path | Body |
|---|---|---|
| GET | `/customer/notifications` | → list (includes `read_at`) |
| POST | `/customer/notifications/read` | `ids: [1,2]` (empty = mark all) |
| DELETE | `/customer/notifications` | → clear all for user |

### 4.6 Support

| Method | Path | Body |
|---|---|---|
| POST | `/customer/support` | `subject, message, category?, priority? (low\|normal\|high\|urgent)` → `VCOM-SUP-*` |
| GET | `/customer/support` | → own tickets |
| GET | `/customer/support/:id` | → ticket incl. staff `reply` |

### 4.7 Addresses (`/api/v1/customer/addresses`)

Own address book with a **single default** address. Any authenticated user (not only customer role).

| Method | Path | Body |
|---|---|---|
| GET | `/customer/addresses` | → own addresses, **default first**, then newest |
| POST | `/customer/addresses` | `line1*, city*, label?, line2?, landmark?, state?, pincode?, phone?, latitude?, longitude?, is_default?` → `201` |
| PUT | `/customer/addresses/:id` | any of the same fields (partial). `is_default: true` sets default |
| PATCH | `/customer/addresses/:id/default` | — → make this the default (clears others) |
| DELETE | `/customer/addresses/:id` | — → hard delete; if it was default, oldest remaining is auto-promoted |

Rules:
- **First address is auto-default.** Max **10** per user → `409 Address limit reached`.
- Non-owner id → `404 Address not found`. Non-numeric id → `400`.
- `label` max 30 chars; `pincode` 3-10 digits; `latitude` −90..90; `longitude` −180..180. Blank `""` → stored as `null`.
- Response address shape: `{ id, user_id, label, line1, line2, landmark, city, state, pincode, phone, latitude, longitude, is_default, status, created_at, updated_at }` (`latitude/longitude` numbers, `is_default` boolean).

```json
POST /api/v1/customer/addresses
{ "label": "Home", "line1": "House 12, Road 3", "city": "Dhaka", "state": "Dhaka",
  "pincode": "1207", "latitude": 23.8103, "longitude": 90.4125 }
→ 201 { "success": true, "message": "Address created",
        "data": { "id": 41, "is_default": true, ... } }
```

### 4.8 Reviews (`/api/v1/customer/reviews`)

Customer reviews a **completed/closed request** — service rating **and** technician (vendor) rating in one submit. **Auto-published** (`status = visible`); admin can hide later. One review per request.

| Method | Path | Body |
|---|---|---|
| POST | `/customer/reviews` | `request_id*, service_rating* (1-5), service_comment? (≤2000), technician_rating* (1-5, required if request has an assigned vendor), technician_comment? (≤2000)` → `201` |
| PUT | `/customer/reviews/:id` | any of `service_rating, service_comment, technician_rating, technician_comment` (partial; owner only) |
| GET | `/customer/reviews/request/:requestId` | → own review for that request, or `null` |

Rules:
- Eligibility: request must be **owned by caller** (`404` otherwise) and status `completed` or `closed` (`400` otherwise). Duplicate → `409 You have already reviewed this request`.
- **POST/PUT responses include `technician_rating` / `technician_comment`** (the caller's own input echoed back). `GET /customer/requests/:id` → `review` block and `GET /customer/reviews/request/:requestId` **never** include technician fields (shape: `{ id, request_id, service_rating, service_comment, status, created_at, updated_at }`).
- Submitting/updating/hiding/deleting a review **recomputes `vendors.rating`** (AVG of visible `technician_rating`, `0` when none).
- `GET /customer/requests/:id` response includes `review: null | { id, service_rating, service_comment, status, created_at, updated_at }` — app uses it to toggle the "Rate service" button.

```json
POST /api/v1/customer/reviews
{ "request_id": 42, "service_rating": 5, "service_comment": "Excellent job",
  "technician_rating": 4, "technician_comment": "Polite and on time" }
→ 201 { "success": true, "message": "Review submitted",
        "data": { "id": 7, "request_id": 42, "service_rating": 5,
                  "service_comment": "Excellent job", "technician_rating": 4,
                  "technician_comment": "Polite and on time", "status": "visible",
                  "created_at": "..." } }
```

### 4.9 Job applications (`/api/v1/customer/job-applications`)

HR recruitment — any authenticated user applies with a CV. Files go to **Cloudinary** (`avatar` image, `cv` raw PDF).

| Method | Path | Body |
|---|---|---|
| POST | `/customer/job-applications` | **multipart/form-data:** `name*, email*, phone* (10 digit), address*, role?, avatar? (image ≤5MB), cv* (PDF ≤10MB)` → `201` |
| GET | `/customer/job-applications` | → own applications: `{ items: [{ id, application_ref, role, status, submitted_at }] }` |
| GET | `/customer/job-applications/:id` | → full own application (other user → `404 Application not found`) |

`application_ref` = `JOB-YYYY-001`. Status starts at `under_review` (`submitted → under_review → shortlisted → rejected → hired` for admin flow).

```json
POST /api/v1/customer/job-applications   (multipart)
name=Rohit Das&email=rohit@gmail.com&phone=9876543210&address=Salt Lake, Kolkata&role=HR Executive
cv=@resume.pdf  avatar=@photo.png
→ 201 { "success": true, "message": "Application submitted successfully",
        "data": { "id": 42, "application_ref": "JOB-2026-042", "status": "under_review",
                  "name": "Rohit Das", "email": "rohit@gmail.com", "phone": "9876543210",
                  "address": "Salt Lake, Kolkata", "role": "HR Executive",
                  "avatar_url": "https://res.cloudinary.com/...", "cv_url": "https://res.cloudinary.com/...",
                  "submitted_at": "..." } }
```

Errors: `400 name, email, phone and address are required` · `400 cv is required` · `400 cv must be a PDF` · `400 avatar must be an image (JPEG/PNG)` · `400 File too large`.

---

## 5. Vendor app (`/api/v1/vendor/*`) — auth required, `role_slug = provider_owner | technician`

> New vendor accounts start as `status = pending` until approved by admin (created by `POST /auth/register` with `client: vendor`). Pending owners can use **profile / service-categories / technicians / attendance**; request & job routes require `status = approved`.

### 5.1 Profile, status & services

| Method | Path | Body |
|---|---|---|
| GET | `/vendor/profile` | → full profile (shape below), message `Vendor profile retrieved` |
| PUT | `/vendor/profile` | `business_name?, contact_person?, city?, state?, pincode? (6 digits), coverage_areas? (array or CSV string), address?, gst_number? (alias: gst_no), name? (owner name), email? (unique-checked)` — multipart optional: `logo` + any of `photo, aadhar_front, aadhar_back, pan_front, pan_back` re-upload → **returns the updated profile** |
| PUT | `/vendor/status/toggle` | `{ is_online: boolean }` → `{ is_online }` (vendor app online/offline switch) |
| GET | `/vendor/services` | → vendor's offered categories: `{ id, name, module_name, module_code, is_active, base_price }[]` |
| POST | `/vendor/complete-profile` | notify-only stub (profile fields go through `PUT /vendor/profile`) |
| GET | `/vendor/summary` | → stats: requests/jobs/quotations counts + earnings |
| GET | `/vendor/available-categories` | → all active service categories |
| PUT | `/vendor/service-categories` | `category_ids: [ids]` |

**GET/PUT `/vendor/profile` → `data`:**
```json
{ "id": 1, "user_id": 8, "business_name": "...", "contact_person": "...",
  "status": "approved", "rejection_reason": null, "is_online": true,
  "coverage_areas": ["Bangalore", "Mysore"], "rating": 4.91, "total_jobs": 0,
  "total_ratings": 64, "kyc_complete": true,
  "logo": null, "photo": "https://...", "aadhar_front": "...", "aadhar_back": "...",
  "pan_front": "...", "pan_back": "...",
  "address": "...", "city": "...", "state": "...", "pincode": "...",
  "gst_number": "...", "gst_no": "...",
  "owner_name": "...", "email": "...", "phone": "...", "avatar": null, "user_status": "active",
  "categories": [{ "id": 2, "name": "...", "module_name": "...", "module_code": "..." }],
  "stats": { "completed_jobs": 0, "active_jobs": 0, "pending_requests": 0 } }
```
- `gst_no` is an alias of `gst_number` (same value). `total_ratings` = visible service reviews count.
- `coverage_areas` is always an **array** (stored CSV/JSON text is parsed); PUT accepts array or CSV.
- `kyc_complete` = all 5 KYC docs (photo + aadhar + pan) uploaded.
- **KYC re-upload:** a `rejected` vendor PUTs multipart doc(s) → docs replaced, `status` → `pending`, `rejection_reason` cleared, vendor notified. JSON PUT without files never changes status.
- Errors: `400` bad pincode / invalid email / unknown file field / non-image file · `409` email taken · `403` no provider account for this user.

### 5.2 Requests

| Method | Path | Body / Query |
|---|---|---|
| GET | `/vendor/requests` | `status?, scope? (assigned\|available\|all)` |
| GET | `/vendor/requests/:id` | detail |
| POST | `/vendor/requests/:id/accept` | — (assigned requests) |
| POST | `/vendor/requests/:id/decline` | `reason` |
| POST | `/vendor/requests/:id/status` | `status, note?, schedule_date?` |

### 5.3 Quotations

| Method | Path | Body |
|---|---|---|
| GET | `/vendor/quotations` | `status?` → list with `items[]` |
| POST | `/vendor/quotations` | `request_id, items[], tax_rate?, discount?, notes?, valid_until?` → 201 `VCOM-QT-*` |
| GET | `/vendor/quotations/:id` | detail with `items[]` |
| PUT | `/vendor/quotations/:id` | Same as create (only while `pending`) |
| POST | `/vendor/quotations/:id/withdraw` | — |

**Item shape:** `{ item_name, description?, quantity, unit?, rate }` — `amount = qty × rate` computed server-side. `total = subtotal + tax − discount`.

### 5.4 Jobs

| Method | Path | Body |
|---|---|---|
| GET | `/vendor/jobs` | `stage?` |
| POST | `/vendor/jobs` | `request_id, schedule_date?, amount?` → `VCOM-JOB-*` (**idempotent** — if a job already exists for the request+vendor (e.g. auto-opened on technician assign) it backfills `schedule_date`/`amount`, sets `requests.status='scheduled'` and returns the existing job with `Job already exists`) |
| GET | `/vendor/jobs/:id` | detail |
| POST | `/vendor/jobs/:id/status` | `stage, note?, schedule_date?, completion_notes?` |
| POST | `/vendor/jobs/:id/attachments` | multipart `files[]` (≤10), `kind?` |

Stages: `pending → accepted → scheduled → in_progress → awaiting_approval → completed` (+ `cancelled`).

### 5.5 Notifications & Support

- `GET /vendor/notifications` → `{ items: [{ id, title, body, created_at, read_at, data, ... }], unread, avatar }` (map `read_at !== null` → `is_read` client-side).
- `POST /vendor/support/messages` → `{ message* }` (**subject optional** — defaults to first line of message) → 201 `{ id, ticket_no }`. Also mounted at `POST /vendor/support`.

### 5.6 Technicians & attendance (owner-managed)

Technicians are **standalone rows owned by the vendor** — no login account, no self-registration. All routes scoped to the caller's vendor (other vendors' technicians → `404`). Available while `status = pending` too.

| Method | Path | Body / Query |
|---|---|---|
| POST | `/vendor/technicians` | **multipart (spec mode — when files / `aadhaar_number` / `service_ids` present):** `name*, phone* (10 digit), email?, aadhaar_number* (12 digits), service_ids* (JSON array, e.g. `"[31,45]"`), files: profile_photo*, aadhar_front*, aadhar_back*` → 201 `{ id, name, phone, status }`. **Legacy JSON mode** (no files/aadhaar/service_ids): `name*, phone?, skill?, address?, id_proof?, notes?, status?` → 201 `{ id, name, phone, status }` |
| GET | `/vendor/technicians` | `status? (all\|active\|on_duty\|offline\|inactive), search?` → spec rows: `{ id, name, phone, email, photo, is_online, rating (null), completed_jobs, active_job_id (job_no\|null), services: [names], today_status, present_30d, ... }`. `on_duty` = attendance today present · `offline` = `is_online=0` |
| PUT | `/vendor/technicians/:id` | `name*, phone?, email?, aadhaar_number?, is_online?, service_ids?, skill?, ...` — multipart optional (`profile_photo`/`aadhar_front`/`aadhar_back`) |
| DELETE | `/vendor/technicians/:id` | hard delete — attendance + services cascade |
| POST | `/vendor/technician-attendance` | **single:** `{ technician_id*, attendance_date*, status?='present', notes? }` · **bulk:** `{ attendance_date*, entries: [{ technician_id, status?, notes? }] }` (≤200). Upsert — same day re-mark updates. Future date → 400 |
| GET | `/vendor/technician-attendance` | `date?` (default today) \| `month? (YYYY-MM)` \| `technician_id? \| status?` → paginated `{ items, pagination }` |
| GET | `/vendor/technician-attendance/summary` | `month?` → per-technician `present/absent/half_days/late` counts |

Attendance `status`: `present` \| `absent` \| `half_day` \| `late`. Dates `YYYY-MM-DD`, **not in the future**. `rating` is `null` (technician-level reviews not in schema yet). Audit actions: `technician.create/update/delete`, `technician.attendance`.

### 5.7 Bookings (vendor app adapter)

Presentation layer over requests + jobs — existing `/vendor/requests` & `/vendor/jobs` untouched. `:id` accepts numeric request id, `ticket_no` (`VCOM-REQ-*`) or `job_no` (`VCOM-JOB-*`), `#` prefix allowed. Requires approved vendor.

| Method | Path | Body / Query |
|---|---|---|
| GET | `/vendor/bookings` | `status? (all\|pending\|accepted\|in_progress\|completed\|cancelled), page?, limit?, search?` → `{ total, page, limit, bookings: [...] }` |
| GET | `/vendor/bookings/:id` | detail with `payment_summary` + `timeline` |
| PUT | `/vendor/bookings/:id/action` | `{ action: "accept"\|"reject", reason? }` → `{ id, status: "accepted"\|"rejected" }` (wraps request assignment flow) |
| POST | `/vendor/bookings/:id/assign` | `{ technician_id* }` → `{ booking_id, technician_id, technician_name, status: "assigned" }` (link persists across request/job stages; **auto-opens a `jobs` row** if none exists — technician task list reads `jobs`, so assignment without a job would be invisible) |

**List item:** `{ id (ticket_no), request_id, service, category_id, category_name, customer_name, customer_phone, address, scheduled_time, display_time, amount (number), payment_status (null), status, is_urgent, job_no, technician: {id,name,phone,photo}|null }`
**Status map:** `pending_review→pending` · `assigned/quoted/approved→accepted` · `scheduled/in_progress→in_progress` · `completed/closed→completed` · `cancelled→cancelled`.
**Detail:** `{ id, service, category, customer, phone, address, time, amount ("₹650"), status ("Pending" title-case), technician (name|"Unassigned"), Photo, payment_summary: { base_fee, visiting_charges, platform_fee_taxes, total_payable, payment_mode: null }, timeline: [4 steps] }`.
> `payment_status` / `payment_mode` are `null` — payments module not in platform yet. `reject` unassigns the booking (falls out of vendor scope → detail 404).

### 5.8 Dashboard

| Method | Path | Query |
|---|---|---|
| GET | `/vendor/dashboard` | — (profile-style access: pending vendors get zeroed stats) |

Returns exactly the app home-screen shape: `{ is_online, stats: { today_earnings, total_earnings, active_bookings, technicians, vendor_rating }, revenue_chart: { title, total_earned, subtitle, growth_badge, selected_day, chart: [{ day, amount, ratio, is_highest }] ×7 }, incoming_requests: [{ id, service, category, customer, phone, address, time, amount, status: "Pending", technician: "Unassigned" }] }`.
- `revenue_chart` = current week Mon→Sun (jobs completed amounts); `ratio` = amount / week max.
- `incoming_requests` = assigned requests awaiting vendor accept (max 10). Earnings = `jobs.amount` where `stage = completed`.

---

## 6. Admin API (`/api/v1/admin/*`) — auth + permission required

All routes below need `Authorization: Bearer …` **and** the listed permission.

### 6.1 Dashboard & reports

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/dashboard?days=7\|14\|30` | `dashboard.view` | KPI counts (incl. `events_total`, `events_upcoming`, `vendors_active`, `payouts_pending_amount`, `payouts_processed_amount`, `payouts_*_count`), `module_daily[]` (per-module per-day request counts, zero-filled: `{ module_id, module_code, module_name, total, days: [{date, count}] }`), `by_module`, `by_status`, `recent_requests[]` (with `vendor_name`, `location`), `recent_activity`, `request_chart` (14d). `days` clamped to 7/14/30 (default 14) — affects `module_daily` only |
| GET | `/admin/reports/overview` | `reports.view` | `{ requests, quotations, vendors, jobs, module_performance[], monthly[] }` |
| GET | `/admin/reports/:type?format=csv` | `reports.view` | Types: `requests, quotations, jobs, customers, vendors, sos, properties, leaves`. `format=csv` → CSV download (needs auth header — fetch as blob, do not `window.open`) |

### 6.2 Users

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/customers?search&status&page&limit` | `customers.view` | |
| GET | `/admin/customers/:id` | `customers.view` | |
| PATCH | `/admin/customers/:id/status` | `customers.manage` | `{ status }` |
| GET | `/admin/staff?search&role&page&limit` | `staff.manage` | staff + employee accounts |
| POST | `/admin/staff` | `staff.manage` | `name, email, password, phone?, role_id?, user_type?` |
| PUT | `/admin/staff/:id` | `staff.manage` | partial; `password` optional |
| DELETE | `/admin/staff/:id` | `staff.manage` | not self, not super admin |

### 6.3 Vendors

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/vendors?search&status&category_id&page&limit` | `vendors.view` | |
| GET | `/admin/vendors/stats` | `vendors.view` | |
| GET | `/admin/vendors/:id` | `vendors.view` | incl. categories |
| POST | `/admin/vendors` | `vendors.manage` | creates vendor + user (`password` required) |
| PUT | `/admin/vendors/:id` | `vendors.manage` | |
| POST | `/admin/vendors/:id/approve` | `vendors.approve` | notifies vendor |
| POST | `/admin/vendors/:id/reject` | `vendors.approve` | `{ reason }` |
| PATCH | `/admin/vendors/:id/status` | `vendors.manage` | `{ status }` |
| GET | `/admin/vendors/:id/assignments` | `vendors.view` | requests/jobs history |
| GET | `/admin/vendors/:id/technicians` | `vendors.view` | read-only: technicians + `today_status` + `present_30d` |

### 6.3a Payouts (manual vendor payouts)

Permissions: `payouts.view` (reads) / `payouts.manage` (writes). Web panel: **Payouts** page (People section). Table `payouts` — manual entries only (no auto-generation), one-way `pending → processed`, no delete (audit trail).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/payouts?status&vendor_id&page&limit` | `payouts.view` | `{ items[], pagination }`; items include `vendor_name`, `job_no`, `amount` (number) |
| GET | `/admin/payouts/summary` | `payouts.view` | `{ pending_amount, processed_amount, total_amount, pending_count, processed_count }` |
| GET | `/admin/payouts/export?status` | `payouts.view` | CSV download (auth header — fetch as blob, do not `window.open`) |
| POST | `/admin/payouts` | `payouts.manage` | `vendor_id*, amount* (>0), note?, job_id?` (job must belong to vendor) → created as `pending` |
| PATCH | `/admin/payouts/:id/status` | `payouts.manage` | `{ status: "processed" }` only; sets `processed_at`; re-process → 400 |

Rules: `amount` DECIMAL(12,2) > 0; optional `job_id` validated against `vendor_id`; every write audit-logged (`payout.create`, `payout.processed`).

### 6.4 Requests & quotations & jobs & SOS

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/requests?status&module_id&priority&assigned_vendor_id&customer_id&from_date&to_date&search&page&limit` | `requests.view` | |
| GET | `/admin/requests/stats` | `requests.view` | |
| GET | `/admin/requests/:id` | `requests.view` | id = numeric id **or** ticket no; includes `history[]`, `attachments[]`, `quotations[]` |
| POST | `/admin/requests` | `requests.manage` | `customer_id, module_id, category_id?, title, description, ...` + multipart `attachments[]` |
| POST | `/admin/requests/:id/assign` | `requests.assign` | `{ vendor_id }` |
| PATCH | `/admin/requests/:id/status` | `requests.manage` | `{ status, note? }` |
| POST | `/admin/requests/:id/close` | `requests.manage` | `{ note? }` |
| POST | `/admin/requests/:id/escalate` | `requests.manage` | `{ note }` |
| DELETE | `/admin/requests/:id` | `requests.manage` | |
| GET | `/admin/quotations?status&request_id&vendor_id&search&page&limit` | `quotations.view` | |
| GET | `/admin/quotations/:id` | `quotations.view` | |
| POST | `/admin/quotations/:id/review` | `quotations.manage` | `{ decision: accepted\|rejected, note? }` |
| POST | `/admin/quotations` | `quotations.manage` | Create on behalf of vendor |
| GET | `/admin/jobs?search&page&limit` | `jobs.view` | |
| GET | `/admin/jobs/stats` | `jobs.view` | |
| GET | `/admin/jobs/:id` | `jobs.view` | |
| PATCH | `/admin/jobs/:id/stage` | `jobs.manage` | `{ stage, note? }` |
| POST | `/admin/jobs` | `jobs.manage` | `{ request_id, vendor_id, ... }` — idempotent (existing job → backfill + `Job already exists`) |
| GET | `/admin/sos?status&search&page&limit` | `sos.view` | |
| GET | `/admin/sos/stats` | `sos.view` | |
| GET | `/admin/sos/:id` | `sos.view` | |
| POST | `/admin/sos/:id/status` | `sos.manage` | `{ status, note?, assign_to?, resolution_notes? }` |

### 6.5 Services & content

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/services/modules` | `services.view` | with `category_count`, `request_count`, `theme`, `colors` |
| POST | `/admin/services/modules` | `services.manage` | multipart/form-data: `code, name, description?, icon?, theme? (quick\|special\|professional\|""), sort_order?, status?`, `image` (file, optional) |
| PUT | `/admin/services/modules/:id` | `services.manage` | multipart: partial fields + `image` (omit = keep); `theme: ""` clears to Auto (omit = keep existing); invalid theme → `400` |
| DELETE | `/admin/services/modules/:id` | `services.manage` | blocked if requests exist |
| GET | `/admin/services/categories?module_id` | `services.view` | with `module_name`, `module_code`, `price`, `image` |
| POST | `/admin/services/categories` | `services.manage` | multipart: `module_id, name, description?, price?, is_featured?, sort_order?, status?`, `image` (file) — `price` ≥ 0 or omit/null (Quick Service parent sets price) |
| PUT | `/admin/services/categories/:id` | `services.manage` | multipart: partial + `image` (omit = keep); `price: ""` clears price |
| DELETE | `/admin/services/categories/:id` | `services.manage` | blocked if requests exist |

### 6.6 Offers & coupons

Permissions: `offers.view` (reads) / `offers.manage` (writes). Web panel: **Offers & Coupons** page.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/offers?status&category_id&module_id` | `offers.view` | with `category_name`, `module_name`, `module_id`, `image` (full URL) |
| POST | `/admin/offers` | `offers.manage` | multipart: `category_id*, title*, description?, discount_type? (percent\|flat), discount_value*, starts_at?, ends_at?, status?`, `image` (file, optional banner) |
| PUT | `/admin/offers/:id` | `offers.manage` | multipart: partial; `starts_at: ""` / `ends_at: ""` clears (always-on) |
| DELETE | `/admin/offers/:id` | `offers.manage` | |
| GET | `/admin/coupons?status&search` | `offers.view` | `search` matches code/title; includes `used_count`, `category_name` |
| POST | `/admin/coupons` | `offers.manage` | `code* (3–30, A-Z0-9_- , stored UPPERCASE), title?, discount_type?, discount_value*, max_discount?, min_amount?, usage_limit?, per_user_limit?, applies_to? (all\|category), category_id? (required if category), starts_at?, ends_at?, status?` → dup code `409` |
| PUT | `/admin/coupons/:id` | `offers.manage` | partial; `usage_limit` ≥ 1 and ≥ `used_count` |
| DELETE | `/admin/coupons/:id` | `offers.manage` | |

Rules: `discount_value` > 0, percent ≤ 100; `starts_at` ≤ `ends_at`; date-only values → start 00:00, end 23:59. Offer delete cascades with category.

### 6.6a Banners

Permissions: `banners.view` (reads) / `banners.manage` (writes). Web panel: **Banners** page (HR & Content section).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/banners` | `banners.view` | full rows ordered `slot` ASC; `image` full URL; includes `status`, `starts_at`, `ends_at` as IST wall-clock strings `YYYY-MM-DD HH:mm:ss` (as entered; tz-safe) |
| POST | `/admin/banners` | `banners.manage` | multipart: `title*`, `image*` (file), `subtitle?`, `slot?` (int 1–99, default 1), `starts_at?`, `ends_at?`, `status?` (default 1) |
| PUT | `/admin/banners/:id` | `banners.manage` | multipart partial: any of `title`, `subtitle`, `slot`, `starts_at`, `ends_at`, `status`; `image` file omitted = keep existing; `starts_at: ""` / `ends_at: ""` clears (always-on) |
| DELETE | `/admin/banners/:id` | `banners.manage` | |

Rules: `slot` = carousel position (1 = first shown); `ends_at` must be after `starts_at`; public feed (§3.4) only returns banners active now. Every write is audit-logged (`banner.create/update/delete`).

### 6.6b Events admin

Permissions: `events.view` (reads) / `events.manage` (writes). Web panel: **Events** page (HR & Content section). Same `events` table as the public feed (§3.5); public endpoints unchanged.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/events?q&status` | `events.view` | all rows incl. hidden; `event_date` DESC; `q` matches title/organizer/location; `status=0\|1` filter; ≤500 |
| POST | `/admin/events` | `events.manage` | `title*, location*, event_date* (YYYY-MM-DD), start_time? (HH:MM), time_range?, organizer?, category?, venue_name?, venue_address?, banner_url?, is_featured? (0\|1), description?, highlights? (array), amenities? (array), latitude? (−90..90), longitude? (−180..180), status? (default 1), sort_order?` → id `ev-<base36>` |
| PUT | `/admin/events/:id` | `events.manage` | partial update; `highlights`/`amenities` accept array or comma-separated string; `""` clears optional fields |
| DELETE | `/admin/events/:id` | `events.manage` | hard delete (standalone table, no FK) |

Rules: `title` ≤200 and `location` ≤100 required; audit-logged (`event.create/update/delete`); public feed still filters `status = 1`.

### 6.7 Properties admin

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/properties?search&status&builder_id&page&limit` | `properties.view` |
| GET | `/admin/properties/stats` | `properties.view` |
| GET | `/admin/properties/:id` | `properties.view` |
| POST | `/admin/properties` | `properties.manage` (multipart `media[]` ≤16, `logo`) |
| PUT | `/admin/properties/:id` | `properties.manage` |
| DELETE | `/admin/properties/:id` | `properties.manage` |
| DELETE | `/admin/properties/media/:mediaId` | `properties.manage` |
| GET/POST | `/admin/properties/builders` · `PUT/DELETE …/builders/:id` | `properties.view` / `properties.manage` |
| GET/POST | `/admin/properties/projects?builder_id` · `PUT/DELETE …/projects/:id` | `properties.view` / `properties.manage` |
| GET/POST | `/admin/properties/areas` · `PUT/DELETE …/areas/:id` | `properties.view` / `properties.manage` |
| GET | `/admin/properties/enquiries/all?status&page&limit` | `properties.enquiries` |
| PATCH | `/admin/properties/enquiries/:id/status` | `properties.enquiries` — `{ status }` |

### 6.8 HR admin

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/hr/employees?search&status&department&page&limit` | `hr.view` | |
| POST | `/admin/hr/employees` | `hr.manage` | `name, email, password, employee_code, designation?, department?, ...` (creates user + employee) |
| PUT | `/admin/hr/employees/:id` | `hr.manage` | partial (email/code immutable) |
| GET | `/admin/hr/attendance?date&month&employee_id&status&page&limit` | `hr.view` | |
| POST | `/admin/hr/attendance` | `hr.manage` | `employee_id, attendance_date, check_in?, check_out?, status?, notes?` (upsert) |
| GET | `/admin/hr/attendance/summary?month=YYYY-MM` | `hr.view` | per-employee day counts |
| GET | `/admin/hr/leaves?status&employee_id&page&limit` | `hr.view` | |
| POST | `/admin/hr/leaves/:id/review` | `hr.manage` | `{ decision: approved\|rejected, review_note? }` — approval auto-marks attendance |

### 6.9 Notifications, roles, support, audit, settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/notifications/templates` | `notifications.manage` | |
| PUT | `/admin/notifications/templates/:id` | `notifications.manage` | `title_template?, body_template?, is_active?` |
| GET | `/admin/notifications/recent` | `notifications.manage` | last 50 sent |
| POST | `/admin/notifications/broadcast` | `notifications.manage` | `title, body?, user_type?` (omit = all users) |
| GET | `/admin/roles` | `roles.manage` | `{ roles[], permissions[], permission_groups{} }`; roles include `permission_ids[]`, `user_count`, `permission_count` |
| POST | `/admin/roles` | `roles.manage` | `name, slug, description?, permission_ids[]` |
| PUT | `/admin/roles/:id` | `roles.manage` | `name?, description?, permission_ids[]` — system roles blocked |
| DELETE | `/admin/roles/:id` | `roles.manage` | blocked if users assigned |
| GET | `/admin/support?status&search&page&limit` | `support.manage` | |
| POST | `/admin/support/:id/reply` | `support.manage` | `reply, status? (default in_progress)` — notifies requester |
| PATCH | `/admin/support/:id/status` | `support.manage` | `{ status }` ∈ `open, in_progress, resolved, closed` |
| GET | `/admin/audit?action&entity&actor_id&search&page&limit` | `audit.view` | `action` is a **prefix** match (e.g. `request` matches `request.create`) |
| GET | `/admin/settings` | `settings.manage` | all rows: `setting_key, setting_value, setting_group, label` |
| PUT | `/admin/settings` | `settings.manage` | `{ settings: { "key1": "value1", ... } }` |

### 6.10 Reviews moderation

Permissions: `reviews.view` (reads) / `reviews.manage` (writes). Web panel: **Service Reviews** page (Operations section). Reviews are auto-published on submit — this API hides/deletes inappropriate ones.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/reviews?status&rating&module_id&category_id&vendor_id&search&page&limit` | `reviews.view` | Paginated; items include **full review** (service + technician fields), masked `customer_name`, `customer_email`, `ticket_no`, `request_title`, `module_name`, `category_name`, `vendor_name` |
| PATCH | `/admin/reviews/:id` | `reviews.manage` | `{ status: "visible" \| "hidden" }` — hidden reviews disappear from public endpoints and `vendors.rating` recalculates |
| DELETE | `/admin/reviews/:id` | `reviews.manage` | Hard delete + vendor rating recompute + audit (`review.delete`) |

Audit actions: `review.hide`, `review.show`, `review.delete`. Grants: **Super Admin** (all) + **Operations Manager** by default; add to other roles via Roles & Permissions.

---

## 7. File uploads

- Transport: `multipart/form-data`; field names listed per endpoint (`attachments`, `files`, `media`, `image`, `logo`).
- Public URL: `http://localhost:8000/uploads/<folder>/<filename>` (prod: `https://v-com-server.onrender.com/uploads/...`; `folder` = `general | requests | properties | jobs | avatars`). Cloudinary-hosted service images return full `https://res.cloudinary.com/...` URLs directly.
- Max sizes: images/PDF/docs **10 MB**, videos **50 MB** (`MAX_VIDEO_SIZE_MB`).
- Allowed: images (`jpg,jpeg,png,webp,gif`), video (`mp4,mov,avi,mkv`), docs (`pdf,doc,docx,xls,xlsx`).
- Client-side helper: media path `general/x.png` → `${BASE_URL}/uploads/general/x.png`.

---

## 8. Demo accounts (seeded)

| Role | Email | Phone (OTP login) | Password |
|---|---|---|---|
| Super Admin | `admin@vcom.com` | `9000000001` | `Admin@123` |
| Operations | `ops@vcom.com` | `9000000002` | `Ops@123` |
| HR | `hr@vcom.com` | `9000000003` | `Hr@12345` |
| SOS | `sos@vcom.com` | `9000000004` | `Sos@1234` |
| CCTV / Special Service | `cctv@vcom.com` | `9000000005` | `Cctv@1234` |
| Customer | `customer@vcom.com` | `9876500001` | `Customer@123` |
| Vendor (Provider Owner) | `vendor@vcom.com` | `9876500003` | `Vendor@123` |
| Employee | `employee@vcom.com` | `9876500005` | `Employee@123` |

App OTP login works with any phone above (mock OTP `123456`). New app users: any valid 10-digit phone → register flow (§2.1).

Service catalog (seeded): **3 modules** — Professional Service (18), Quick Service (7), Special Service (6) — with **31 active categories**.

---

## 9. Permission catalogue

```
dashboard.view
customers.view            customers.manage
vendors.view              vendors.approve        vendors.manage
requests.view             requests.manage        requests.assign
quotations.view           quotations.manage
jobs.view                 jobs.manage
sos.view                  sos.manage
properties.view           properties.manage      properties.enquiries
services.view             services.manage
banners.view              banners.manage
events.view               events.manage
payouts.view              payouts.manage
reviews.view              reviews.manage
hr.view                   hr.manage
notifications.manage      reports.view           reports.export
roles.manage              staff.manage           support.manage
settings.manage           audit.view
modules.all
module.<code>.access      (scrap-waste, cctv-automation, fire-safety,
                           fabrication-welding, website-graphic,
                           printing-promotions-gifting, sos, hr)
```

---

## 10. Ticket number prefixes

| Entity | Prefix | Example |
|---|---|---|
| Service request | `VCOM-REQ-` | `VCOM-REQ-000123` |
| SOS | `VCOM-SOS-` | `VCOM-SOS-000007` |
| Quotation | `VCOM-QT-` | `VCOM-QT-000042` |
| Job | `VCOM-JOB-` | `VCOM-JOB-000018` |
| Property | `VCOM-PROP-` | `VCOM-PROP-000012` |
| Property enquiry | `VCOM-ENQ-` | `VCOM-ENQ-000031` |
| Support ticket | `VCOM-SUP-` | `VCOM-SUP-000009` |
| Leave request | `VCOM-LV-` | `VCOM-LV-000005` |

---

## 11. Realtime / polling

- No WebSocket — apps poll `GET /customer/notifications` / `GET /vendor/notifications` (admin web: every 30 s).
- In-app notifications are written server-side on domain events (see `notification_templates` event codes: `request_created`, `quotation_decision`, `sos_created`, `leave_reviewed`, `support_reply`, `vendor_status`, …).

---

## 12. Field Technician app (`/api/v1/technician/*`) — auth required, `role_slug = technician`

Login: `POST /auth/otp/verify` with `client: "technician"` (phone must exist in `technicians`, else 404). Response carries `technician: { id, employee_code, name, vendor_id, business_name, status, is_on_duty, rating: null }` instead of `vendor`. Shadow `users` row is created lazily on first login; `users.phone` conflict with a non-technician account → 403.

> **Null-by-design fields** (no data source in platform): `Score`, `rating`, `level`, `earned_commission`, `payment_mode`, `donut_share` → always `null`. `employee_code` derived `TECH-XXXX` when column is empty. Attendance `is_on_duty` ↔ `technicians.is_online`.

### 12.1 Profile / duty / skills

| Method | Path | Notes |
|---|---|---|
| GET | `/technician/profile` | `{ id, name, Score: null, phone: "+91 98301 23456", email, address, photo, employee_code, vendor: { id, business_name, contact_phone }, is_on_duty, rating: null, total_jobs_completed }` |
| PUT | `/technician/status/duty` | `{ is_on_duty: boolean }` → `{ is_on_duty }` · message "Duty status updated to On-Duty/Off-Duty" |
| GET | `/technician/skills` | `[{ id, name, category (module), level: null, Status: "Active"/"Inactive", Photo }]` from `technician_services` |

### 12.2 Attendance

| Method | Path | Notes |
|---|---|---|
| GET | `/technician/attendance?month=11&year=2026` | `month` accepts `1-12` or `YYYY-MM`. → `{ technician: { name, avatar (initials), designation, employee_code, is_verified }, today: { date, is_marked_today, status_text }, month, year, month_name, total_days_joined, summary_text, attended_days: ["YYYY-MM-DD"] }` (attended = present/late/half_day) |
| POST | `/technician/attendance` | `{ date?: "YYYY-MM-DD" }` (default today). Marks `present`, sets `marked_by`, flips `is_online=1` ("Duty activated"). 201 → `{ date, is_marked_today, total_days_joined, status, status_text }`. Duplicate → 400 `Attendance already marked…` · future → 400 |

### 12.3 Dashboard

`GET /technician/dashboard` → `{ is_on_duty, today_earnings, today_completed_jobs, pending_tasks, active_job, weekly_chart }`
- `active_job` (latest open job) or `null`: `{ id (job_no), service, category, status (sub_status), customer_name, customer_phone, address, distance ("2.4 km away"|null), customer_lat, customer_lng, scheduled_time ("Today"|"13 Nov"), amount, is_urgent, customer_otp, instructions }`
- `pending_tasks` = open jobs + assigned requests not yet jobbed.
- `weekly_chart` = current week Mon→Sun `[{ label, amount, jobs, ratio, is_highest }]`.
- Distance from last `technician_locations` row vs request coordinates (haversine); no location yet → `null`.

### 12.4 Jobs

| Method | Path | Notes |
|---|---|---|
| GET | `/technician/jobs?status=assigned\|ongoing\|completed` | Direct array (no pagination). Item: `{ id (job_no), service, category, status (tab), sub_status, customer_name, customer_phone (+91), address, distance, time, amount, is_urgent }`. Tab map: `completed`←stage · `ongoing`←sub_status ∈ on_the_way/reached/started/in_progress · else `assigned` |
| GET | `/technician/jobs/:id` | `:id` = job_no or numeric id (must be assigned to this tech, else 404). → `{ id, service, category, status (sub_status), amount, payment_mode: null, is_urgent, customer: { name, phone, address, latitude, longitude }, distance, customer_otp, notes, service_items: [{ name, qty, price }], timeline: [5 steps { title, time, is_done }] }` |
| PUT | `/technician/jobs/:id/status` | `{ status: "on_the_way"\|"reached"\|"started" }` → `{ id, status }`. Writes `job_status_history`. |
| POST | `/technician/jobs/:id/verify-otp` | `{ otp }` matches `jobs.customer_otp` → sets `sub_status`+`stage=in_progress`, `started_at`. → `{ id, is_otp_verified: true, status: "in_progress" }`. Wrong → 400 `Invalid OTP` |
| POST | `/technician/jobs/:id/complete` | **multipart**: `before_photo*`, `after_photo*` (required, 1 each), `completion_notes`, `extra_parts_cost`, `payment_collected` (`"true"`/`"1"` → cash). → 201 `{ id, status: "completed", earned_commission: null, completion_time }`. Closes request + notifies customer. Attachments stored `kind=before/after` |

- `customer_otp`: 4-digit code generated at **job creation** (vendor + admin routes); customer sees it in `GET /customer/requests/:id` → `job.customer_otp`.
- Status flow: `assigned → on_the_way → reached → started → (verify-otp) in_progress → completed`.

### 12.5 Location / earnings / safety / support

| Method | Path | Notes |
|---|---|---|
| POST | `/technician/location/update` | `{ latitude*, longitude*, heading?, speed?, active_job_id? }` → "Location updated". Lat −90..90, lng −180..180 |
| GET | `/technician/earnings?period=today\|this_week\|this_month` | `{ period, hero_card: { total_amount "₹1,850", currency: "INR", growth_percentage "+18.4%", completed_tasks "3 Jobs", average_per_job }, cash_vs_digital: { digital_wallet, cash_in_hand } (from payment_collected), analytics: { trend_chart: [{ label, amount, formatted, jobs, ratio, is_highest }] (cumulative: hourly/daily/1..N), growth_badge, active_index }, donut_share: null }`. Growth vs previous equal-length window; prev=0 → `+100.0%` / `0.0%` |
| GET | `/technician/earnings/history?period=` | `{ period, total_jobs, total_payout, payout_history: [{ id: "#VCOM-JOB-…", service, customer, date ("Today, 5:15 PM"\|"07 Nov 2026"), amount, mode: "Cash Collected"\|"Online Paid", status: "Cash Collected"\|"Received" }] }` |
| GET | `/technician/safety-guidelines` | Static `[{ group, guidelines: [{ id, title, description }] }]` (Personal Safety, Job Site Safety) |
| POST | `/technician/support/messages` | `{ message*, job_id? }` → 201 `{ message_id, sent_at }`. Stores `support_tickets.user_type = "technician"`, subject prefixed `[job_id]` when given. Notifies support staff |

### 12.6 Errors specific to this app

| Status | When |
|---|---|
| 401 | No/expired token |
| 403 | Non-technician user on `/technician/*` · technician `status != active` (+ `data.status`) · phone linked to another role |
| 404 | Phone not in `technicians` (otp/verify) · job not found / not assigned to this technician |
| 400 | Duplicate attendance · future date · wrong/missing OTP · bad status value · missing before/after photo |

---

*Companion machine-readable collection: [`V_COM.postman_collection.json`](./V_COM.postman_collection.json) (set `baseUrl` + `token` variables after running the Login request).*
