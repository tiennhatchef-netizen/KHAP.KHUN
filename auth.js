// server/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'doi-secret-nay-trong-file-.env';

function signToken(user, storeInfo) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      is_superadmin: user.is_superadmin || false,
      store_id: user.store_id || null,
      store_slug: storeInfo?.slug || null,
      store_name: storeInfo?.name || null
    },
    SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const token = header.split(' ')[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại' });
    req.user = decoded;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản lý mới có quyền này' });
  }
  next();
}

// ------------------- LOGIN -------------------
// Super Admin: chỉ cần username + password (không cần store)
// Nhân viên: cần store (id hoặc slug) + username + password
router.post('/login', async (req, res) => {
  const { username, password, store_id, store_slug } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });
  try {
    // Trước tiên thử tìm tài khoản Super Admin (store_id IS NULL) theo username — không cần chọn cửa hàng
    let { rows: superRows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_superadmin = TRUE', [username]
    );
    if (superRows.length > 0) {
      const user = superRows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
      const token = signToken(user, null);
      return res.json({
        token,
        user: {
          id: user.id, username: user.username, name: user.name, role: user.role,
          is_superadmin: true, store_id: null, store_name: null
        }
      });
    }

    // Nếu không phải superadmin → bắt buộc phải có store
    let storeRow = null;
    if (store_id) {
      const { rows } = await pool.query('SELECT * FROM stores WHERE id = $1 AND is_active = TRUE', [store_id]);
      storeRow = rows[0] || null;
    } else if (store_slug) {
      const { rows } = await pool.query('SELECT * FROM stores WHERE slug = $1 AND is_active = TRUE', [store_slug]);
      storeRow = rows[0] || null;
    }
    if (!storeRow) {
      return res.status(400).json({ error: 'Vui lòng chọn cửa hàng trước khi đăng nhập' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND store_id = $2', [username, storeRow.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });

    const token = signToken(user, storeRow);
    res.json({
      token,
      user: {
        id: user.id, username: user.username, name: user.name, role: user.role,
        is_superadmin: false, store_id: storeRow.id, store_name: storeRow.name
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------- SUPER ADMIN: VÀO XEM 1 CỬA HÀNG CỤ THỂ -------------------
// Cho phép Super Admin "switch" vào dữ liệu của 1 cửa hàng mà không cần mật khẩu riêng
router.post('/enter-store', requireAuth, async (req, res) => {
  if (!req.user.is_superadmin) {
    return res.status(403).json({ error: 'Chỉ Super Admin mới có quyền này' });
  }
  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'Thiếu store_id' });
  try {
    const { rows } = await pool.query('SELECT * FROM stores WHERE id = $1', [store_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy cửa hàng' });
    const storeRow = rows[0];

    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userRows[0];
    const token = signToken(user, storeRow);
    res.json({
      token,
      user: {
        id: user.id, username: user.username, name: user.name, role: user.role,
        is_superadmin: true, store_id: storeRow.id, store_name: storeRow.name
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------- ĐỔI MẬT KHẨU CỦA CHÍNH MÌNH -------------------
router.post('/change-password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: 'Mật khẩu mới phải từ 4 ký tự trở lên' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    const ok = await bcrypt.compare(old_password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Đã đổi mật khẩu' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, requireAuth, requireAdmin };
