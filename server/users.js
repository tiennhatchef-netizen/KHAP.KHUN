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

// ─── Danh sách người dùng ─────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, name, role, is_superadmin, created_at FROM users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Thêm người dùng mới ──────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role } = req.body;
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
      `INSERT INTO users (username, password_hash, name, role, is_superadmin)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, username, name, role, is_superadmin`,
      [username.trim(), hash, name.trim(), role]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Tên tài khoản này đã tồn tại, hãy chọn tên khác' });
    res.status(500).json({ error: e.message });
  }
});

// ─── Cập nhật thông tin (chỉ admin, không đụng superadmin) ────
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

// ─── Xoá người dùng ───────────────────────────────────────────
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

    await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({ message: 'Đã xoá' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
