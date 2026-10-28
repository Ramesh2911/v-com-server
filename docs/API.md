# V_COM Platform — API Contract

REST API for the V_COM Business Management Platform. Consumed by:

- **Customer mobile app** (`/customer/*`, `/auth/*`, public endpoints)
- **Vendor mobile app** (`/vendor/*`, `/auth/*`, public endpoints)
- **Admin web panel** (`/admin/*`, `/auth/*`, `/me`)

---

## 1. Conventions

| Item | Value |
|---|---|
| Base URL (dev) | `http://localhost:5000/api` |
| Content type | `application/json` (except uploads: `multipart/form-data`) |
| Auth | `Authorization: Bearer <accessToken>` |
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days |
| Timestamps | MySQL `DATETIME` / ISO-ish `YYYY-MM-DD HH:MM:SS` (UTC server time) |

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

## 2. Auth (`/api/auth`, `/api/me`)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `name, email, password, phone?` | Creates **customer**. Rate-limited 20/h. Returns login payload + 201. |
| POST | `/auth/login` | `email, password` | Returns `{ user, accessToken, refreshToken }`. `user` includes `permissions[]` and `user_type`. |
| POST | `/auth/refresh` | `refreshToken` | Returns new `{ accessToken, refreshToken }`. Old refresh token revoked. |
| POST | `/auth/logout` | `refreshToken?` | Revokes refresh token. Requires access token. |
| POST | `/auth/forgot-password` | `email` | Always 200 (no user enumeration). Token logged/emailed if configured. |
| POST | `/auth/reset-password` | `token, password` | |
| POST | `/auth/change-password` | `currentPassword, newPassword` | Auth required. `newPassword` min 6. |
| GET | `/me` | — | Auth. Returns profile + `permissions[]` + `vendor` + `employee` objects. |
| PUT | `/me` | `name?, phone?, avatar?` | Auth. Partial update. |

**Login response (`data`):**

```json
{
  "user": {
    "id": 1, "name": "...", "email": "...", "user_type": "staff|customer|vendor|employee",
    "role_name": "...", "role_slug": "...", "permissions": ["dashboard.view", ...]
  },
  "accessToken": "jwt...",
  "refreshToken": "jwt..."
}
```

> Mobile apps: after login, route by `user_type`. Customers use `/customer/*`, vendors use `/vendor/*`.

---

## 3. Public endpoints (no auth)

### 3.1 Services (`/api/services`)

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/services` | — | Active service modules (with category counts) |
| GET | `/services/featured` | — | Featured categories |
| GET | `/services/search` | `q` | Search modules + categories |
| GET | `/services/:id` | — | Module detail with categories |

Module: `{ id, code, name, description, icon, image, status, sort_order, category_count }` (image is a full URL).

### 3.2 Properties (`/api/properties`)

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/properties` | `search, listing_type (sale\|rent), property_type, city, area_id, builder_id, builder_name, project_id, project_name, min_amount, max_amount, featured, page, limit` | Paginated listings |
| GET | `/properties/filters` | — | Distinct builders/projects/areas/cities for filter UI |
| GET | `/properties/:id` | — | Detail incl. media, builder, project, area |
| POST | `/properties/:id/enquiry` | — | Body: `name, email, phone, message` → creates `VCOM-ENQ-*` ticket |

Property media URLs: returned as absolute URLs. Listing includes `{ property_code, title, listing_type, total_amount, status, ... }`.

---

## 4. Customer app (`/api/customer/*`) — auth required, `user_type = customer`

### 4.1 Requests

| Method | Path | Body / Query |
|---|---|---|
| GET | `/customer/requests` | `status?, module_id?, search?` → array (max 100) with `attachments[]` |
| GET | `/customer/requests/:id` | → detail + `history[]` + `attachments[]` + `quotations[]` |
| POST | `/customer/requests` | `module_id, category_id?, title, description, site_location?, city?, latitude?, longitude?, quantity?, specifications?, priority?` + multipart `attachments[]` (≤8 files) |
| POST | `/customer/requests/:id/cancel` | — → `VCOM-REQ-*` status → `cancelled` |

Ticket no: `VCOM-REQ-000123`. Statuses: `pending_review → assigned → in_progress → completed / closed / cancelled`.

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

---

## 5. Vendor app (`/api/vendor/*`) — auth required, `user_type = vendor`

> New vendor accounts start as `status = pending` until approved by admin.

### 5.1 Profile

| Method | Path | Body |
|---|---|---|
| GET | `/vendor/profile` | → vendor record |
| PUT | `/vendor/profile` | `business_name?, contact_person?, city?, state?, pincode?, coverage_areas?, address?, gst_number?` |
| POST | `/vendor/complete-profile` | Same fields — validates profile completion |
| GET | `/vendor/summary` | → stats: requests/jobs/quotations counts + earnings |
| GET | `/vendor/available-categories` | → service categories not yet selected |
| PUT | `/vendor/service-categories` | `category_ids: [ids]` |

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
| POST | `/vendor/jobs` | `request_id, schedule_date?, amount?` → `VCOM-JOB-*` |
| GET | `/vendor/jobs/:id` | detail |
| POST | `/vendor/jobs/:id/status` | `stage, note?, schedule_date?, completion_notes?` |
| POST | `/vendor/jobs/:id/attachments` | multipart `files[]` (≤10), `kind?` |

Stages: `pending → accepted → scheduled → in_progress → awaiting_approval → completed` (+ `cancelled`).

### 5.5 Notifications & Support

Mirror customer endpoints at `/vendor/notifications` and `/vendor/support` (same bodies).

---

## 6. Admin API (`/api/admin/*`) — auth + permission required

All routes below need `Authorization: Bearer …` **and** the listed permission.

### 6.1 Dashboard & reports

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/dashboard` | `dashboard.view` | KPI counts, recent activity, monthly series |
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
| POST | `/admin/jobs` | `jobs.manage` | `{ request_id, vendor_id, ... }` |
| GET | `/admin/sos?status&search&page&limit` | `sos.view` | |
| GET | `/admin/sos/stats` | `sos.view` | |
| GET | `/admin/sos/:id` | `sos.view` | |
| POST | `/admin/sos/:id/status` | `sos.manage` | `{ status, note?, assign_to?, resolution_notes? }` |

### 6.5 Services & content

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/services/modules` | `services.view` | with `category_count`, `request_count` |
| POST | `/admin/services/modules` | `services.manage` | `code, name, description?, sort_order?, status?` + multipart `image` |
| PUT | `/admin/services/modules/:id` | `services.manage` | |
| DELETE | `/admin/services/modules/:id` | `services.manage` | blocked if requests exist |
| GET | `/admin/services/categories?module_id` | `services.view` | with `module_name` |
| POST | `/admin/services/categories` | `services.manage` | `module_id, name, is_featured?, sort_order?, status?` + `image` |
| PUT | `/admin/services/categories/:id` | `services.manage` | |
| DELETE | `/admin/services/categories/:id` | `services.manage` | blocked if requests exist |

### 6.6 Properties admin

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

### 6.7 HR admin

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

### 6.8 Notifications, roles, support, audit, settings

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

---

## 7. File uploads

- Transport: `multipart/form-data`; field names listed per endpoint (`attachments`, `files`, `media`, `image`, `logo`).
- Public URL: `http://localhost:5000/uploads/<folder>/<filename>` (served statically; `folder` = `general | requests | properties | jobs | avatars`).
- Max sizes: images/PDF/docs **10 MB**, videos **50 MB** (`MAX_VIDEO_SIZE_MB`).
- Allowed: images (`jpg,jpeg,png,webp,gif`), video (`mp4,mov,avi,mkv`), docs (`pdf,doc,docx,xls,xlsx`).
- Client-side helper: media path `general/x.png` → `${BASE_URL}/uploads/general/x.png`.

---

## 8. Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@vcom.com` | `Admin@123` |
| Operations | `ops@vcom.com` | `Ops@123` |
| HR | `hr@vcom.com` | `Hr@12345` |
| SOS | `sos@vcom.com` | `Sos@1234` |
| CCTV | `cctv@vcom.com` | `Cctv@1234` |
| Customer | `customer@vcom.com` | `Customer@123` |
| Vendor | `vendor@vcom.com` | `Vendor@123` |
| Employee | `employee@vcom.com` | `Employee@123` |

Service modules (seeded): `scrap-waste`, `cctv-automation`, `fire-safety`, `fabrication-welding`, `website-graphic`, `printing-promotions-gifting`.

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

*Companion machine-readable collection: [`V_COM.postman_collection.json`](./V_COM.postman_collection.json) (set `baseUrl` + `token` variables after running the Login request).*
