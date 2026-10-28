const sendSuccess = (res, data = null, message = 'OK', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

const sendPaginated = (res, { items, total, page, limit, message = 'OK' }) =>
  res.status(200).json({
    success: true,
    message,
    data: {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    },
  });

module.exports = { sendSuccess, sendPaginated };
