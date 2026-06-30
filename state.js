// server/state.js
const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./auth');

module.exports = function (io) {
  const router = express.Router();

  // Lay toan bo du lieu (S object) cua DUNG cua hang dang dang nhap
  router.get('/', requireAuth, async (req, res) => {
    const storeId = req.user.store_id;
    if (!storeId) {
      return res.status(400).json({ error: 'Tài khoản chưa thuộc cửa hàng nào. Vui lòng vào một cửa hàng cụ thể.' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT data, updated_at, updated_by FROM app_state WHERE store_id = $1', [storeId]
      );
      res.json(rows[0] || { data: {}, updated_at: null, updated_by: null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Luu du lieu CUA DUNG cua hang, roi bao cho cac thiet bi khac TRONG CUNG CUA HANG biet de cap nhat
  router.put('/', requireAuth, async (req, res) => {
    const storeId = req.user.store_id;
    if (!storeId) {
      return res.status(400).json({ error: 'Tài khoản chưa thuộc cửa hàng nào. Vui lòng vào một cửa hàng cụ thể.' });
    }
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE app_state SET data = $1, updated_at = now(), updated_by = $2
         WHERE store_id = $3 RETURNING updated_at`,
        [JSON.stringify(data), req.user.name, storeId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Không tìm thấy dữ liệu cửa hàng này' });
      }
      const updated_at = rows[0].updated_at;

      // Chỉ báo cho các thiết bị KHÁC đang ở CÙNG CỬA HÀNG (room theo store_id)
      const senderSocketId = req.headers['x-socket-id'];
      io.to(`store-${storeId}`).sockets?.forEach?.(() => {}); // no-op safeguard
      io.in(`store-${storeId}`).fetchSockets().then((sockets) => {
        sockets.forEach((s) => {
          if (s.id !== senderSocketId) {
            s.emit('state-updated', { data, updated_at, updated_by: req.user.name });
          }
        });
      }).catch(() => {});

      res.json({ updated_at, updated_by: req.user.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
