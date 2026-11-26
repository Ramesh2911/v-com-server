const components = {
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Authorization: Bearer <accessToken> (15 min TTL; refresh via /auth/refresh)',
    },
  },
  parameters: {
    page: { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 }, description: 'Page number' },
    limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: 15, minimum: 1, maximum: 100 }, description: 'Items per page' },
    idPath: { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Resource id' },
  },
  responses: {
    Unauthorized: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Invalid or expired token', errors: null } } },
    },
    Forbidden: {
      description: 'Insufficient permissions',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Forbidden', errors: null } } },
    },
    NotFound: {
      description: 'Resource not found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Not found', errors: null } } },
    },
    ValidationError: {
      description: 'Validation failed',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Validation failed', errors: [{ field: 'email', message: 'Invalid email' }] } } },
    },
    Conflict: {
      description: 'Duplicate / conflict',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Already exists', errors: null } } },
    },
  },
  schemas: {
    Error: {
      type: 'object',
      required: ['success', 'message'],
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Something went wrong' },
        errors: {
          type: 'array',
          nullable: true,
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
    Pagination: {
      type: 'object',
      properties: {
        total: { type: 'integer', example: 120 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 15 },
        totalPages: { type: 'integer', example: 8 },
        hasNext: { type: 'boolean', example: true },
        hasPrev: { type: 'boolean', example: false },
      },
    },
    PaginationAlt: {
      type: 'object',
      description: 'Alternate pagination shape (events list, payouts list)',
      properties: {
        current_page: { type: 'integer', example: 1 },
        total_pages: { type: 'integer', example: 5 },
        total_items: { type: 'integer', example: 48 },
        per_page: { type: 'integer', example: 10 },
      },
    },
    AuthTokens: {
      type: 'object',
      properties: {
        accessToken: { type: 'string', description: 'JWT, 15 min' },
        refreshToken: { type: 'string', description: 'JWT, 7 days' },
        user: { $ref: '#/components/schemas/User' },
      },
    },
    User: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: { type: 'string', nullable: true },
        user_type: { type: 'string', enum: ['customer', 'vendor', 'technician', 'staff', 'admin'] },
        status: { type: 'string', enum: ['active', 'inactive', 'pending', 'blocked'] },
        role_id: { type: 'integer', nullable: true },
        role: { type: 'string', nullable: true },
        avatar: { type: 'string', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Address: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        label: { type: 'string' },
        line1: { type: 'string' },
        line2: { type: 'string', nullable: true },
        city: { type: 'string' },
        state: { type: 'string' },
        pincode: { type: 'string' },
        latitude: { type: 'number', nullable: true },
        longitude: { type: 'number', nullable: true },
        is_default: { type: 'boolean' },
      },
    },
    ServiceModule: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        code: { type: 'string', enum: ["special-service", "quick-service", "general-assistance"] },
        name: { type: 'string', example: 'Professional Service' },
        description: { type: 'string', nullable: true },
        icon: { type: 'string', nullable: true },
        image: { type: 'string', nullable: true },
        status: { type: 'integer', example: 1 },
        sort_order: { type: 'integer' },
        category_count: { type: 'integer', description: 'Admin only — active categories', example: 18 },
        request_count: { type: 'integer', description: 'Admin only' },
        categories: { type: 'array', items: { $ref: '#/components/schemas/ServiceCategory' } },
      },
    },
    ServiceCategory: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        module_id: { type: 'integer' },
        name: { type: 'string', example: 'CCTV and Automation' },
        description: { type: 'string', nullable: true },
        image: { type: 'string', nullable: true },
        price: { type: 'string', nullable: true, description: 'DECIMAL string — Quick Service pricing' },
        is_featured: { type: 'integer', enum: ["0", "1"] },
        status: { type: 'integer', enum: ["0", "1"], description: '0 = hidden' },
        sort_order: { type: 'integer' },
        group_name: { type: 'string', enum: ["professional", "quick", "special"] },
        module_code: { type: 'string' },
        bg_color: { type: 'string', nullable: true },
        text_color: { type: 'string', nullable: true },
        ref_code: { type: 'string', nullable: true },
      },
    },
    SubService: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        code: { type: 'string' },
        title: { type: 'string' },
        subtitle: { type: 'string', nullable: true },
        image: { type: 'string', nullable: true },
        bg_color: { type: 'string', nullable: true },
        text_color: { type: 'string', nullable: true },
        is_active: { type: 'boolean' },
      },
    },
    ServiceRequest: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        ticket_no: { type: 'string', example: 'REQ-INT-2026-1' },
        booking_ref: { type: 'string', nullable: true },
        module_id: { type: 'integer' },
        category_id: { type: 'integer' },
        customer_id: { type: 'integer' },
        status: { type: 'string', enum: ['pending_review', 'assigned', 'in_progress', 'completed', 'cancelled', 'rejected'] },
        priority: { type: 'string', nullable: true },
        notes: { type: 'string', nullable: true },
        scheduled_time: { type: 'string', nullable: true },
        address: { $ref: '#/components/schemas/Address' },
        attachments: { type: 'array', items: { type: 'string' } },
        sub_services: { type: 'array', items: { $ref: '#/components/schemas/SubService' } },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Quotation: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        request_id: { type: 'integer' },
        vendor_id: { type: 'integer' },
        amount: { type: 'string' },
        notes: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'clarified', 'withdrawn'] },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Job: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        job_no: { type: 'string', example: 'JOB-2026-1' },
        request_id: { type: 'integer' },
        vendor_id: { type: 'integer' },
        technician_id: { type: 'integer', nullable: true },
        stage: { type: 'string', enum: ['assigned', 'in_progress', 'completed', 'cancelled'] },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Vendor: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        user_id: { type: 'integer' },
        business_name: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'active', 'blocked'] },
        city: { type: 'string', nullable: true },
        categories: { type: 'string', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Event: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        image: { type: 'string', nullable: true },
        location: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        starts_at: { type: 'string', format: 'date-time', nullable: true },
        ends_at: { type: 'string', format: 'date-time', nullable: true },
        status: { type: 'string', enum: ['draft', 'published', 'cancelled'] },
        is_featured: { type: 'boolean' },
      },
    },
    Banner: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        image: { type: 'string' },
        link: { type: 'string', nullable: true },
        sort_order: { type: 'integer' },
        status: { type: 'integer', enum: ["0", "1"] },
      },
    },
    Offer: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        image: { type: 'string', nullable: true },
        category_id: { type: 'integer', nullable: true },
        discount_type: { type: 'string', enum: ['percent', 'flat'] },
        discount_value: { type: 'string' },
        starts_at: { type: 'string', format: 'date-time', nullable: true },
        ends_at: { type: 'string', format: 'date-time', nullable: true },
        status: { type: 'integer', enum: ["0", "1"] },
      },
    },
    Coupon: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        code: { type: 'string', example: 'SAVE10' },
        discount_type: { type: 'string', enum: ['percent', 'flat'] },
        discount_value: { type: 'string' },
        max_uses: { type: 'integer', nullable: true },
        used_count: { type: 'integer' },
        expires_at: { type: 'string', format: 'date-time', nullable: true },
        status: { type: 'integer', enum: ["0", "1"] },
      },
    },
    Payout: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        vendor_id: { type: 'integer' },
        amount: { type: 'string' },
        note: { type: 'string', nullable: true },
        job_ref: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['pending', 'processed'] },
        created_by: { type: 'integer' },
        created_at: { type: 'string', format: 'date-time' },
        processed_at: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    Property: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        listing_type: { type: 'string', enum: ['sale', 'rent'] },
        property_type: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        price: { type: 'string', nullable: true },
        status: { type: 'string', nullable: true },
      },
    },
    Review: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        request_id: { type: 'integer' },
        customer_id: { type: 'integer' },
        rating: { type: 'integer', minimum: 1, maximum: 5 },
        comment: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['visible', 'hidden'] },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    Notification: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        body: { type: 'string', nullable: true },
        is_read: { type: 'boolean' },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    SOS: {
      type: 'object',
      description: 'Admin SOS ticket row (DB shape)',
      properties: {
        id: { type: 'integer' },
        ticket_no: { type: 'string', example: 'VCOM-SOS-000001' },
        customer_id: { type: 'integer' },
        status: { type: 'string', enum: ["open", "acknowledged", "dispatched", "in_progress", "resolved", "closed", "cancelled"] },
        priority: { type: 'string', enum: ["high", "critical"] },
        description: { type: 'string' },
        address: { type: 'string', nullable: true },
        requester_phone: { type: 'string', nullable: true },
        requester_location: { type: 'string', nullable: true },
        category_id: { type: 'integer', nullable: true },
        category_name: { type: 'string', nullable: true },
        photo_url: { type: 'string', nullable: true },
        is_for_other: { type: 'boolean' },
        other_person_name: { type: 'string', nullable: true },
        relationship: { type: 'string', nullable: true },
        other_person_phone: { type: 'string', nullable: true },
        patient_location: { type: 'string', nullable: true },
        special_instructions: { type: 'string', nullable: true },
        cancelled_at: { type: 'string', format: 'date-time', nullable: true },
        assigned_to: { type: 'integer', nullable: true },
        responder_id: { type: 'integer', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
    SOSPublic: {
      type: 'object',
      description: 'Public SOS response (uppercase status/priority, nested requester/patient/responder)',
      properties: {
        id: { type: 'integer' },
        ticket_no: { type: 'string', example: 'VCOM-SOS-000001' },
        category: { type: 'string', nullable: true, example: 'Medical Emergency' },
        category_id: { type: 'integer', nullable: true },
        category_code: { type: 'string', nullable: true, example: 'MEDICAL' },
        status: { type: 'string', enum: ["OPEN", "ACKNOWLEDGED", "DISPATCHED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"] },
        priority: { type: 'string', enum: ["HIGH", "HIGH_CRITICAL"] },
        description: { type: 'string' },
        dispatched_at: { type: 'string', format: 'date-time' },
        requester: {
          type: 'object',
          properties: { phone: { type: 'string', nullable: true }, location: { type: 'string', nullable: true } },
        },
        patient: {
          type: 'object',
          properties: {
            is_for_other: { type: 'boolean' },
            name: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            exact_location: { type: 'string', nullable: true },
          },
        },
        photo_url: { type: 'string', nullable: true },
        special_instructions: { type: 'string', nullable: true },
        latitude: { type: 'number', nullable: true },
        longitude: { type: 'number', nullable: true },
        assigned_responder: {
          type: 'object',
          nullable: true,
          properties: {
            unit_name: { type: 'string' },
            contact_no: { type: 'string' },
            vehicle_no: { type: 'string', nullable: true },
            driver_name: { type: 'string', nullable: true },
            estimated_eta: { type: 'string', example: '10 mins' },
          },
        },
        cancelled_at: { type: 'string', format: 'date-time', nullable: true },
        history: {
          type: 'array',
          nullable: true,
          items: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              note: { type: 'string', nullable: true },
              changed_by_name: { type: 'string', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
    SOSHistoryItem: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        ticket_no: { type: 'string' },
        category: { type: 'string', nullable: true },
        status: { type: 'string' },
        priority: { type: 'string' },
        description: { type: 'string' },
        requester_location: { type: 'string', nullable: true },
        cancelled_at: { type: 'string', format: 'date-time', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    SOSResponder: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        category_id: { type: 'integer', nullable: true },
        category_name: { type: 'string', nullable: true },
        unit_name: { type: 'string' },
        contact_no: { type: 'string' },
        vehicle_no: { type: 'string', nullable: true },
        driver_name: { type: 'string', nullable: true },
        latitude: { type: 'number', nullable: true },
        longitude: { type: 'number', nullable: true },
        status: { type: 'string', enum: ["active", "inactive"] },
      },
    },
    SOSCategory: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        code: { type: 'string', example: 'MEDICAL' },
        name: { type: 'string' },
        subtitle: { type: 'string' },
        helpline: { type: 'string', nullable: true },
        theme_color: { type: 'string', example: '#DC2626' },
        image_url: { type: 'string' },
      },
    },
    Attendance: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        employee_id: { type: 'integer' },
        date: { type: 'string', format: 'date' },
        check_in: { type: 'string', format: 'date-time', nullable: true },
        check_out: { type: 'string', format: 'date-time', nullable: true },
        status: { type: 'string', nullable: true },
      },
    },
    Leave: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        employee_id: { type: 'integer' },
        type: { type: 'string' },
        from_date: { type: 'string', format: 'date' },
        to_date: { type: 'string', format: 'date' },
        reason: { type: 'string', nullable: true },
        status: { type: 'string', enum: ["pending", "approved", "rejected"] },
      },
    },
    Role: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        slug: { type: 'string' },
        is_system: { type: 'boolean' },
        description: { type: 'string', nullable: true },
        permissions: { type: 'array', items: { type: 'string' } },
      },
    },
    DashboardStats: {
      type: 'object',
      properties: {
        requests: { type: 'object', properties: { total: { type: 'integer' }, active: { type: 'integer' }, completed: { type: 'integer' } } },
        vendors: { type: 'object', properties: { total: { type: 'integer' }, pending: { type: 'integer' } } },
        customers: { type: 'object', properties: { total: { type: 'integer' } } },
        revenue: { type: 'object', nullable: true },
        module_daily: { type: 'array', items: { type: 'object' }, description: 'Per-day request counts per module (days query param)' },
      },
    },
    // ---- envelope wrappers (use with allOf for typed success) ----
    SuccessEnvelope: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'OK' },
        data: { type: 'object', nullable: true },
      },
    },
    PaginatedEnvelope: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'OK' },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array', items: {} },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        },
      },
    },
  },
};

// Helper: generic success response with a schema ref
const ok = (ref, example) => ({
  description: 'Success',
  content: {
    'application/json': {
      schema: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: example !== undefined ? { example } : ref ? { $ref: ref } : { type: 'object', nullable: true },
            },
          },
        ],
      },
      ...(example !== undefined ? { example: { success: true, message: 'OK', data: example } } : {}),
    },
  },
});

const okPaginated = (itemRef, itemsExample) => ({
  description: 'Paginated success',
  content: {
    'application/json': {
      schema: {
        allOf: [
          { $ref: '#/components/schemas/PaginatedEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  items: itemRef ? { type: 'array', items: { $ref: itemRef } } : { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        ],
      },
      ...(itemsExample !== undefined
        ? { example: { success: true, message: 'OK', data: { items: itemsExample, pagination: { total: 1, page: 1, limit: 15, totalPages: 1, hasNext: false, hasPrev: false } } } }
        : {}),
    },
  },
});

const created = (ref) => ({
  description: 'Created',
  content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: ref ? { $ref: ref } : { type: 'object' } } }] } } },
});

const noContent = (message = 'OK') => ({
  description: 'Success (no body data)',
  content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, message: { type: 'string', example: message }, data: { type: 'object', nullable: true } } } } },
});

const csv = (description = 'CSV file') => ({
  description,
  content: { 'text/csv': { schema: { type: 'string' } } },
});

const body = (schema, example) => ({
  required: true,
  content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } },
});

const multipart = (schema) => ({
  required: true,
  content: { 'multipart/form-data': { schema } },
});

const security = () => [{ BearerAuth: [] }];
const noSecurity = [];

module.exports = { components, ok, okPaginated, created, noContent, csv, body, multipart, security, noSecurity };
