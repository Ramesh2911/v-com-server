const pool = require('../config/db');

async function writeAudit({ actor = null, action, entity = null, entityId = null, details = null, req = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_name, action, entity, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actor ? actor.id : null,
        actor ? actor.name : 'system',
        action,
        entity,
        entityId != null ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        req ? req.ip || req.headers['x-forwarded-for'] || null : null,
      ]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { writeAudit };
