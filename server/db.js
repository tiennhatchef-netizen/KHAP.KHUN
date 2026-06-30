// server/db.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function initSchema() {
  // Bảng users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'staff',
      is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Migration: thêm cột is_superadmin nếu DB cũ chưa có
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  // Bảng lưu trạng thái app (dữ liệu KhạpKhun)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  // ── Tạo tài khoản superadmin lần đầu ──
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, name, role, is_superadmin)
       VALUES ($1, $2, $3, 'admin', TRUE)`,
      [username, hash, 'Super Admin']
    );
    console.log(`✅ Tài khoản SUPER ADMIN: "${username}" / "${password}"`);
    console.log('⚠️  Đây là tài khoản gốc — không ai có thể xoá hoặc hạ quyền!');
  } else {
    // Migration: đảm bảo tài khoản id=1 luôn là superadmin (kể cả DB đã có sẵn)
    await pool.query(
      `UPDATE users SET is_superadmin = TRUE, role = 'admin'
       WHERE id = (SELECT MIN(id) FROM users) AND is_superadmin = FALSE`
    );
  }

  // Seed app_state rỗng nếu chưa có
  const stateRes = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (stateRes.rows.length === 0) {
    await pool.query(
      'INSERT INTO app_state (id, data, updated_by) VALUES (1, $1, $2)',
      [JSON.stringify({}), 'system']
    );
  }
}

module.exports = { pool, initSchema };
