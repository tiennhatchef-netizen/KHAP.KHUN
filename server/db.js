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
  // ── Bảng cửa hàng (stores) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id         SERIAL PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      is_active  BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ── Bảng users ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'staff',
      is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
      store_id      INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Migration: thêm cột is_superadmin nếu DB cũ chưa có
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  // Migration: thêm cột store_id nếu DB cũ chưa có
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE;
  `);

  // Migration: bỏ ràng buộc UNIQUE cũ trên username (vì giờ unique theo từng store)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key'
      ) THEN
        ALTER TABLE users DROP CONSTRAINT users_username_key;
      END IF;
    END $$;
  `);

  // Username unique theo từng cửa hàng (NULL store_id = superadmin, vẫn unique riêng)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_store_uidx
    ON users (username, COALESCE(store_id, 0));
  `);

  // ── Bảng lưu trạng thái app — MỖI CỬA HÀNG 1 ROW RIÊNG ──
  // Tạo bảng mới nếu chưa tồn tại (DB hoàn toàn mới)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      store_id   INTEGER PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );
  `);

  // Kiểm tra xem app_state là bảng CŨ (schema "id INTEGER PRIMARY KEY DEFAULT 1") hay chưa
  const oldStateCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'app_state' AND column_name = 'id'
  `);
  const hasOldIdCol = oldStateCheck.rows.length > 0;

  // Nếu là bảng CŨ: thêm cột store_id trước khi làm gì khác (để các câu query sau không lỗi)
  if (hasOldIdCol) {
    await pool.query(`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS store_id INTEGER`);
  }

  // Đảm bảo có ràng buộc FK + PK đúng (chỉ áp dụng được sau khi đã có bảng stores ở trên)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='app_state' AND constraint_name='app_state_store_id_fkey'
      ) THEN
        BEGIN
          ALTER TABLE app_state ADD CONSTRAINT app_state_store_id_fkey
            FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
        EXCEPTION WHEN OTHERS THEN
          -- bỏ qua nếu chưa thể thêm (vd: dữ liệu store_id NULL tạm thời ở bước migrate)
          NULL;
        END;
      END IF;
    END $$;
  `);

  // ── Tạo cửa hàng gốc "Pinoong" nếu chưa có cửa hàng nào ──
  const { rows: storeCountRows } = await pool.query('SELECT COUNT(*)::int AS c FROM stores');
  let rootStoreId;
  if (storeCountRows[0].c === 0) {
    const { rows: insertedStore } = await pool.query(
      `INSERT INTO stores (slug, name) VALUES ($1, $2) RETURNING id`,
      ['pinoong', 'Quán Thái Pinoong']
    );
    rootStoreId = insertedStore[0].id;
    console.log(`✅ Đã tạo cửa hàng gốc: "Quán Thái Pinoong" (id=${rootStoreId})`);
  } else {
    const { rows } = await pool.query(`SELECT id FROM stores ORDER BY id ASC LIMIT 1`);
    rootStoreId = rows[0].id;
  }

  // ── Migration dữ liệu app_state cũ (schema id=1 single row) sang app_state mới (store_id) ──
  if (hasOldIdCol) {
    // Lấy dữ liệu cũ (nếu có) trước khi thay đổi cấu trúc bảng
    const { rows: oldData } = await pool.query(
      `SELECT data, updated_at, updated_by FROM app_state WHERE id = 1`
    ).catch(() => ({ rows: [] }));

    // Gỡ ràng buộc cũ, xoá cột id cũ — giờ bảng chỉ còn store_id (đã thêm ở bước trên)
    await pool.query(`ALTER TABLE app_state DROP CONSTRAINT IF EXISTS single_row`);
    await pool.query(`ALTER TABLE app_state DROP COLUMN IF EXISTS id`);

    // Gán store_id cho dòng dữ liệu cũ duy nhất (nếu còn NULL)
    if (oldData.length > 0) {
      await pool.query(
        `UPDATE app_state SET store_id = $1 WHERE store_id IS NULL`,
        [rootStoreId]
      );
      console.log(`✅ Đã chuyển dữ liệu cũ sang cửa hàng gốc (store_id=${rootStoreId})`);
    } else {
      // Không có dữ liệu cũ — xoá sạch các dòng store_id NULL còn sót (nếu có)
      await pool.query(`DELETE FROM app_state WHERE store_id IS NULL`);
    }

    // Đảm bảo store_id là PRIMARY KEY (cần thiết cho ON CONFLICT phía dưới)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name='app_state' AND constraint_type='PRIMARY KEY'
        ) THEN
          ALTER TABLE app_state ADD PRIMARY KEY (store_id);
        END IF;
      END $$;
    `);
  }

  // Seed app_state rỗng cho cửa hàng gốc nếu chưa có (idempotent, dùng ON CONFLICT an toàn)
  await pool.query(
    `INSERT INTO app_state (store_id, data, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id) DO NOTHING`,
    [rootStoreId, JSON.stringify({}), 'system']
  );

  // ── Migration: users cũ (chưa có store_id) → gán vào cửa hàng gốc, trừ superadmin ──
  await pool.query(
    `UPDATE users SET store_id = $1 WHERE store_id IS NULL AND is_superadmin = FALSE`,
    [rootStoreId]
  );

  // ── Tạo tài khoản superadmin lần đầu (store_id = NULL → quản lý mọi cửa hàng) ──
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users WHERE is_superadmin = TRUE');
  if (rows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, name, role, is_superadmin, store_id)
       VALUES ($1, $2, $3, 'admin', TRUE, NULL)`,
      [username, hash, 'Super Admin']
    );
    console.log(`✅ Tài khoản SUPER ADMIN: "${username}" / "${password}"`);
    console.log('⚠️  Đây là tài khoản gốc — không ai có thể xoá hoặc hạ quyền!');
  } else {
    // Migration: đảm bảo tài khoản admin đầu tiên luôn là superadmin với store_id NULL
    await pool.query(
      `UPDATE users SET is_superadmin = TRUE, role = 'admin', store_id = NULL
       WHERE id = (SELECT MIN(id) FROM users WHERE is_superadmin = TRUE) AND store_id IS NOT NULL`
    );
  }
}

// Tạo cửa hàng mới + app_state rỗng cho cửa hàng đó
async function createStore(slug, name) {
  const { rows } = await pool.query(
    `INSERT INTO stores (slug, name) VALUES ($1, $2) RETURNING id, slug, name, is_active, created_at`,
    [slug.trim().toLowerCase(), name.trim()]
  );
  const store = rows[0];
  await pool.query(
    `INSERT INTO app_state (store_id, data, updated_by) VALUES ($1, $2, $3)`,
    [store.id, JSON.stringify({}), 'system']
  );
  return store;
}

module.exports = { pool, initSchema, createStore };
