// server/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();
const VALID_ROLES = ['admin', 'staff', 'bep', 'phucvu', 'thungan'];

// ─── Helper: lấy thông tin user theo id ───────────────────────
async function getUser(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// ─── Danh sách người dùng — chỉ trong CÙNG cửa hàng (trừ Super Admin xem hết) ───
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    let rows;
    if (req.user.is_superadmin && !req.user.store_id) {
      // Super Admin chưa "vào" cửa hàng nào → xem toàn bộ user mọi cửa hàng
      ({ rows } = await pool.query(
        `SELECT u.id, u.username, u.name, u.role, u.is_superadmin, u.store_id, s.name AS store_name, u.created_at
         FROM users u LEFT JOIN stores s ON s.id = u.store_id
         ORDER BY u.store_id NULLS FIRST, u.id ASC`
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, username, name, role, is_superadmin, store_id, created_at
         FROM users WHERE store_id = $1 ORDER BY id ASC`,
        [req.user.store_id]
      ));
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Thêm người dùng mới — luôn gắn vào cửa hàng hiện tại của người tạo ───
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role } = req.body;
  const storeId = req.user.store_id;
  if (!storeId) {
    return res.status(400).json({ error: 'Vui lòng vào một cửa hàng cụ thể trước khi tạo tài khoản' });
  }
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ: Tên, Tài khoản, Mật khẩu' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Mật khẩu phải từ 4 ký tự trở lên' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  }
  // Không ai được tạo thêm superadmin qua API
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, is_superadmin, store_id)
       VALUES ($1, $2, $3, $4, FALSE, $5)
       RETURNING id, username, name, role, is_superadmin, store_id`,
      [username.trim(), hash, name.trim(), role, storeId]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Tên tài khoản này đã tồn tại trong cửa hàng này, hãy chọn tên khác' });
    res.status(500).json({ error: e.message });
  }
});

// ─── Cập nhật thông tin (chỉ admin, không đụng superadmin, không đụng user cửa hàng khác) ────
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { name, role, password } = req.body;

  try {
    const target = await getUser(targetId);
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    // Superadmin chỉ tự sửa được mật khẩu của chính mình — không ai khác sửa được
    if (target.is_superadmin && req.user.id !== targetId) {
      return res.status(403).json({ error: '⛔ Không thể sửa thông tin tài khoản Super Admin' });
    }

    // Admin thường (không phải superadmin) chỉ được sửa user trong CÙNG cửa hàng
    if (!req.user.is_superadmin && target.store_id !== req.user.store_id) {
      return res.status(403).json({ error: '⛔ Không thể sửa tài khoản của cửa hàng khác' });
    }

    // Không cho hạ role superadmin
    if (target.is_superadmin && role && role !== 'admin') {
      return res.status(403).json({ error: '⛔ Không thể thay đổi vai trò của Super Admin' });
    }

    if (name && !target.is_superadmin) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, targetId]);
    }
    if (role && VALID_ROLES.includes(role) && !target.is_superadmin) {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
    }
    if (password) {
      if (password.length < 4) return res.status(400).json({ error: 'Mật khẩu phải từ 4 ký tự trở lên' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    }
    res.json({ message: 'Đã cập nhật' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Xoá người dùng — chỉ trong cùng cửa hàng (trừ Super Admin) ───────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Không thể tự xoá chính mình' });
  }

  try {
    const target = await getUser(targetId);
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    // SUPERADMIN KHÔNG THỂ BỊ XOÁ BỞI BẤT KỲ AI
    if (target.is_superadmin) {
      return res.status(403).json({ error: '⛔ Tài khoản Super Admin không thể bị xoá' });
    }

    if (!req.user.is_superadmin && target.store_id !== req.user.store_id) {
      return res.status(403).json({ error: '⛔ Không thể xoá tài khoản của cửa hàng khác' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({ message: 'Đã xoá' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
