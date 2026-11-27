const num = (v) => (v == null ? 0 : Number(v));

const parseCats = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'object' && v) return Object.values(v);
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return [];
  }
};

const fmtClock = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
};

// POST /pickup-request 201 (doc shape; manual-assign: status REQUEST_PLACED, assigned_buyer null)
const serializeRequestCreated = (r) => ({
  request_id: r.request_code,
  materials: parseCats(r.material_categories),
  approx_load: r.approx_weight_range,
  pickup_type: r.pickup_type,
  scheduled_date: r.preferred_date,
  scheduled_slot: r.preferred_time_slot,
  pickup_address: r.pickup_address,
  status: r.status,
  assigned_buyer: r.assigned_buyer_id
    ? {
        name: r.buyer_name,
        phone: r.buyer_phone,
        vehicle_no: r.buyer_vehicle_no,
        scale_type: r.buyer_scale_type,
      }
    : null,
  created_at: r.created_at,
});

// GET /requests/:id/track
const STATUS_FLOW = ['REQUEST_PLACED', 'BUYER_ASSIGNED', 'OUT_FOR_PICKUP', 'WEIGHING_COMPLETED', 'PAYMENT_COMPLETED'];

const serializeTrack = (r) => {
  const times = {
    REQUEST_PLACED: r.created_at,
    BUYER_ASSIGNED: r.assigned_at,
    OUT_FOR_PICKUP: r.out_at,
    WEIGHING_COMPLETED: r.weighed_at,
    PAYMENT_COMPLETED: r.paid_at,
  };
  const currentIdx = STATUS_FLOW.indexOf(r.status);
  const timeline = STATUS_FLOW.map((s, i) => ({
    status: s,
    time: fmtClock(times[s]),
    done: r.status === 'CANCELLED' ? !!times[s] : i <= currentIdx,
  }));

  return {
    request_id: r.request_code,
    status: r.status,
    materials: parseCats(r.material_categories),
    pickup_slot: `${r.preferred_date}, ${r.preferred_time_slot}`,
    address: r.pickup_address,
    buyer: r.assigned_buyer_id
      ? { name: r.buyer_name, phone: r.buyer_phone, vehicle_no: r.buyer_vehicle_no }
      : null,
    timeline,
  };
};

// GET /my-pickups list item (doc shape: flat { total, items })
const serializeListItem = (r) => ({
  request_id: r.request_code,
  materials: parseCats(r.material_categories).join(', '),
  scheduled_date: `${r.preferred_date}, ${r.preferred_time_slot}`,
  status: r.status,
  created_at: r.created_at,
});

module.exports = { num, parseCats, fmtClock, serializeRequestCreated, serializeTrack, serializeListItem, STATUS_FLOW };
