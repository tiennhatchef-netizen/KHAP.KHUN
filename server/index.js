// server/index.js
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { pool, initSchema } = require('./db');
const { router: authRouter } = require('./auth');
const usersRouter = require('./users');
const storesRouter = require('./stores');
const stateRouterFactory = require('./state');

const SECRET = process.env.JWT_SECRET || 'doi-secret-nay-trong-file-.env';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json({ limit: '15mb' })); // du lieu S co the kha lon (menu + ban hang nhieu thang)

// ------------------- API -------------------
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/stores', storesRouter);
app.use('/api/state', stateRouterFactory(io));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ------------------- SOCKET.IO: xac thuc bang JWT + vao dung "phong" cua hang -------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Chưa đăng nhập'));
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return next(new Error('Phiên đăng nhập hết hạn'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  const storeId = socket.user?.store_id;
  if (storeId) {
    socket.join(`store-${storeId}`);
  }
  console.log(`🔌 ${socket.user?.name || 'unknown'} (cửa hàng: ${socket.user?.store_name || '—'}) đã kết nối (${socket.id})`);
  socket.on('disconnect', () => {
    console.log(`🔌 ${socket.user?.name || 'unknown'} đã ngắt kết nối`);
  });
});

// ------------------- FRONTEND TINH (static) -------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ------------------- KHOI DONG -------------------
initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 KhạpKhun server đang chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Lỗi khởi tạo database:', err.message);
    process.exit(1);
  });
