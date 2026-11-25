const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { writeAudit } = require('../../utils/audit');

const payouts = express.Router();

payouts.use(authMiddleware, requirePermission('payouts.view'));

const parseId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid payout id required');
  return id;
};

const PAYOUT_SELECT = `
  SELECT p.*, v.business_name AS vendor_name, j.job_no
  FROM payouts p
  JOIN vendors v ON v.id = p.vendor_id
  LEFT JOIN jobs j ON j.id = p.job_id`;

const toView = (r) => ({
  id: r.id,
  vendor_id: r.vendor_id,
  vendor_name: r.vendor_name,
  job_id: r.job_id || null,
  job_no: r.job_no || null,
  amount: Number(r.amount),
  status: r.status,
  note: r.note || null,
  processed_at: r.processed_at || null,
  created_by: r.created_by || null,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/* ---- list (filters: status, vendor_id; paginated) ---- */
payouts.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status === 'pending' || req.query.status === 'processed') {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.vendor_id) {
      const vid = Number(req.query.vendor_id);
      if (!Number.isInteger(vid) || vid < 1) throw ApiError.badRequest('vendor_id must be a positive integer');
      where.push('p.vendor_id = ?');
      params.push(vid);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payouts p${whereSql}`,
      params
    );
    const { page, limit, offset } = getPagination({ ...req.query, limit: req.query.limit ?? '20' });
    const [rows] = await pool.query(
      `${PAYOUT_SELECT}${whereSql} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendSuccess(res, {
      items: rows.map(toView),
      pagination: {
        current_page: page,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        total_items: total,
        per_page: limit,
      },
    }, 'Payouts fetched');
  })
);

/* ---- CSV export (all matching rows, no pagination) ---- */
const escapeCsv = (val) => {
  if (val == null) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

payouts.get(
  '/export',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status === 'pending' || req.query.status === 'processed') {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `${PAYOUT_SELECT}${whereSql} ORDER BY p.created_at DESC, p.id DESC LIMIT 5000`,
      params
    );
    const cols = [
      ['ID', 'id'], ['Vendor', 'vendor_name'], ['Job', 'job_no'], ['Amount', 'amount'],
      ['Status', 'status'], ['Note', 'note'], ['Created', 'created_at'], ['Processed', 'processed_at'],
    ];
    const csv = [
      cols.map((c) => escapeCsv(c[0])).join(','),
      ...rows.map((r) => cols.map((c) => escapeCsv(r[c[1]])).join(',')),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vcom-payouts-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  })
);

/* ---- summary (dashboard card + page header) ---- */
payouts.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const [[s]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN status = 'processed' THEN amount END), 0) AS processed_amount,
        COALESCE(SUM(amount), 0) AS total_amount,
        COALESCE(SUM(status = 'pending'), 0) AS pending_count,
        COALESCE(SUM(status = 'processed'), 0) AS processed_count
      FROM payouts`);
    sendSuccess(res, {
      pending_amount: Number(s.pending_amount),
      processed_amount: Number(s.processed_amount),
      total_amount: Number(s.total_amount),
      pending_count: Number(s.pending_count),
      processed_count: Number(s.processed_count),
    }, 'Payout summary fetched');
  })
);

/* ---- create (manual entry: vendor + amount + optional job + note) ---- */
payouts.post(
  '/',
  requirePermission('payouts.manage'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const vendorId = Number(b.vendor_id);
    if (!Number.isInteger(vendorId) || vendorId < 1) throw ApiError.badRequest('vendor_id is required');

    const [[vendor]] = await pool.query('SELECT id FROM vendors WHERE id = ?', [vendorId]);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99) {
      throw ApiError.badRequest('amount must be a number greater than 0');
    }

    let jobId = null;
    if (b.job_id !== undefined && b.job_id !== null && b.job_id !== '') {
      jobId = Number(b.job_id);
      if (!Number.isInteger(jobId) || jobId < 1) throw ApiError.badRequest('job_id must be a positive integer');
      const [[job]] = await pool.query('SELECT id, vendor_id FROM jobs WHERE id = ?', [jobId]);
      if (!job) throw ApiError.notFound('Job not found');
      if (Number(job.vendor_id) !== vendorId) {
        throw ApiError.badRequest('job_id does not belong to this vendor');
      }
    }

    const note = b.note ? String(b.note).trim().slice(0, 255) : null;

    const [result] = await pool.query(
      `INSERT INTO payouts (vendor_id, job_id, amount, status, note, created_by)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [vendorId, jobId, amount, note, req.user.id]
    );
    await writeAudit({ actor: req.user, action: 'payout.create', entity: 'payouts', entityId: result.insertId, req });
    const [[row]] = await pool.query(`${PAYOUT_SELECT} WHERE p.id = ?`, [result.insertId]);
    sendSuccess(res, toView(row), 'Payout created', 201);
  })
);

/* ---- process (pending -> processed, one-way) ---- */
payouts.patch(
  '/:id/status',
  requirePermission('payouts.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = req.body || {};
    if (status !== 'processed') throw ApiError.badRequest("status must be 'processed'");

    const [rows] = await pool.query(`${PAYOUT_SELECT} WHERE p.id = ?`, [id]);
    if (!rows.length) throw ApiError.notFound('Payout not found');
    if (rows[0].status === 'processed') throw ApiError.badRequest('Payout is already processed');

    await pool.query(
      `UPDATE payouts SET status = 'processed', processed_at = NOW() WHERE id = ?`,
      [id]
    );
    await writeAudit({ actor: req.user, action: 'payout.processed', entity: 'payouts', entityId: id, req });
    const [[row]] = await pool.query(`${PAYOUT_SELECT} WHERE p.id = ?`, [id]);
    sendSuccess(res, toView(row), 'Payout processed');
  })
);

module.exports = { payouts };
