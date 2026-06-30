// server/stores.js
const express = require('express');
const { pool, createStore } = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if (!req.user?.is_superadmin) {
    return res.status(403).json({ error: 'Chỉ Super Admin mới có quyền này' });
  }
  next();
}

// ─── Danh sách cửa hàng — DÙNG Ở MÀN HÌNH LOGIN (không cần đăng nhập) ───
// Chỉ trả về id, slug, name, is_active — KHÔNG lộ dữ liệu nhạy cảm
router.get('/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, slug, name FROM stores WHERE is_active = TRUE ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Danh sách đầy đủ (Super Admin) ───
router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, slug, name, is_active, created_at FROM stores ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Thêm cửa hàng mới (Super Admin) ───
router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const { slug, name } = req.body;
  if (!slug || !name) {
    return res.status(400).json({ error: 'Vui lòng nhập mã cửa hàng (slug) và tên cửa hàng' });
  }
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!cleanSlug) {
    return res.status(400).json({ error: 'Mã cửa hàng không hợp lệ' });
  }
  try {
    const store = await createStore(cleanSlug, name);
    res.json(store);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Mã cửa hàng này đã tồn tại, hãy chọn mã khác' });
    res.status(500).json({ error: e.message });
  }
});

// ─── Sửa tên / trạng thái hoạt động cửa hàng (Super Admin) ───
router.put('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, is_active } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM stores WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Không tìm thấy cửa hàng' });

    if (name) await pool.query('UPDATE stores SET name = $1 WHERE id = $2', [name.trim(), id]);
    if (typeof is_active === 'boolean') {
      await pool.query('UPDATE stores SET is_active = $1 WHERE id = $2', [is_active, id]);
    }
    res.json({ message: 'Đã cập nhật' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Xoá cửa hàng (Super Admin) — chặn nếu vẫn còn user thuộc cửa hàng đó ───
router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rows: userCount } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM users WHERE store_id = $1', [id]
    );
    if (userCount[0].c > 0) {
      return res.status(400).json({ error: 'Không thể xoá: cửa hàng vẫn còn tài khoản nhân viên. Hãy xoá hết tài khoản trước.' });
    }
    await pool.query('DELETE FROM stores WHERE id = $1', [id]);
    res.json({ message: 'Đã xoá cửa hàng' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
