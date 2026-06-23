// public/app-sync.js
// Module cho quản lý Socket.IO reconnection và auto-refetch dữ liệu

let socket = null;
let autoRefetchInterval = null;
const AUTO_REFETCH_INTERVAL = 10000; // 10 giây
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

// ────────────────────────────────────────────────────────────────
// 1. KHỞI TẠO SOCKET.IO VỚI RECONNECTION LOGIC
// ────────────────────────────────────────────────────────────────
function initSocket(token) {
  console.log('[SOCKET] Initializing socket connection...');
  
  socket = io({
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  // Kết nối thành công
  socket.on('connect', () => {
    console.log('[SOCKET] ✅ Connected - Socket ID:', socket.id);
    reconnectAttempts = 0;
    updateSyncStatus(true);
    startAutoRefetch();
  });

  // Mất kết nối
  socket.on('disconnect', (reason) => {
    console.log('[SOCKET] ❌ Disconnected - Reason:', reason);
    updateSyncStatus(false);
    stopAutoRefetch();
  });

  // Lỗi kết nối
  socket.on('connect_error', (error) => {
    console.error('[SOCKET] ⚠️ Connection Error:', error.message);
    updateSyncStatus(false);
  });

  // Reconnection attempt
  socket.on('reconnect_attempt', () => {
    reconnectAttempts++;
    console.log(`[SOCKET] Reconnect attempt ${reconnectAttempts}...`);
  });

  // Nhận thông báo dữ liệu được cập nhật từ server
  socket.on('state-updated', (msg) => {
    console.log(`[SOCKET] State updated by ${msg.updated_by} at ${msg.updated_at}`);
    // Gọi function reload dữ liệu từ app chính
    if (typeof onStateUpdatedFromSocket === 'function') {
      onStateUpdatedFromSocket(msg);
    }
  });
}

// ────────────────────────────────────────────────────────────────
// 2. AUTO-REFETCH DỮ LIỆU
// ────────────────────────────────────────────────────────────────
function startAutoRefetch() {
  if (autoRefetchInterval) {
    clearInterval(autoRefetchInterval);
  }
  
  console.log('[AUTO-REFETCH] Starting auto-refetch every 10 seconds...');
  
  autoRefetchInterval = setInterval(async () => {
    if (typeof refreshDataFromServer === 'function') {
      console.log('[AUTO-REFETCH] Fetching latest data from server...');
      await refreshDataFromServer();
    }
  }, AUTO_REFETCH_INTERVAL);
}

function stopAutoRefetch() {
  if (autoRefetchInterval) {
    clearInterval(autoRefetchInterval);
    autoRefetchInterval = null;
    console.log('[AUTO-REFETCH] Auto-refetch stopped');
  }
}

// ────────────────────────────────────────────────────────────────
// 3. CẬP NHẬT TRẠNG THÁI KẾT NỐI TRÊN UI
// ────────────────────────────────────────────────────────────────
function updateSyncStatus(isConnected) {
  const syncDot = document.getElementById('syncDot');
  const syncLabel = document.getElementById('syncLabel');
  
  if (syncDot && syncLabel) {
    if (isConnected) {
      syncDot.classList.remove('off');
      syncLabel.textContent = '✓ Đã kết nối';
      console.log('[UI] Sync status: Connected');
    } else {
      syncDot.classList.add('off');
      syncLabel.textContent = '✗ Mất kết nối';
      console.log('[UI] Sync status: Disconnected');
    }
  }
}

// ────────────────────────────────────────────────────────────────
// 4. LẤY SOCKET ID ĐỂ GỬI KHI SAVE
// ────────────────────────────────────────────────────────────────
function getSocketId() {
  return socket ? socket.id : null;
}

// ────────────────────────────────────────────────────────────────
// 5. KIỂM TRA KẾT NỐI
// ────────────────────────────────────────────────────────────────
function isSocketConnected() {
  return socket && socket.connected;
}
