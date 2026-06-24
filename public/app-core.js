// public/app-core.js
// Hàm chính cho việc refresh dữ liệu và xử lý socket events

// 1. REFRESH DỮ LIỆU TỪ SERVER
async function refreshDataFromServer() {
  if (!isSocketConnected()) {
    console.log('[REFRESH] Socket chưa kết nối, bỏ qua refetch');
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const resp = await fetch('/api/state', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!resp.ok) {
      console.error('[REFRESH] Failed to fetch:', resp.status);
      return;
    }
    
    const result = await resp.json();
    console.log('[REFRESH] Dữ liệu mới lấy từ server:', result);
    
    // Cập nhật state trong bộ nhớ (giả sử có biến global S)
    if (window.S && result.data) {
      Object.assign(window.S, result.data);
      console.log('[REFRESH] State đã được cập nhật');
    }
  } catch (err) {
    console.error('[REFRESH] Lỗi:', err);
  }
}

// 2. XỬ LÝ KHI NHẬN THÔNG BÁO STATE-UPDATED TỪ SOCKET
function onStateUpdatedFromSocket(msg) {
  console.log('[SOCKET-EVENT] State được cập nhật từ', msg.updated_by);
  
  // Cập nhật state
  if (window.S && msg.data) {
    Object.assign(window.S, msg.data);
    console.log('[SOCKET-EVENT] State đã sync');
  }
  
  // Tự động re-render các trang hiện tại nếu cần
  const currentPage = document.querySelector('.page.on')?.id;
  if (currentPage) {
    const pageNameMatch = currentPage.match(/page-(.+)/);
    if (pageNameMatch) {
      const pageName = pageNameMatch[1];
      const renderFunc = `render${pageName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`;
      
      if (typeof window[renderFunc] === 'function') {
        console.log(`[SOCKET-EVENT] Gọi ${renderFunc}()`);
        window[renderFunc]();
      }
    }
  }
}

// 3. CẬP NHẬT SAVE DATA ĐỂ GỬI SOCKET ID
const originalSaveData = window.saveData;
window.saveData = async function() {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    // Gửi socket ID để server biết không gửi event trở lại cho chính người này
    const socketId = getSocketId();
    console.log('[SAVE] Socket ID:', socketId);
    
    const resp = await fetch('/api/state', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-socket-id': socketId || ''
      },
      body: JSON.stringify({ data: window.S })
    });
    
    if (resp.ok) {
      const result = await resp.json();
      console.log('[SAVE] ✓ Dữ liệu đã lưu at', result.updated_at, 'by', result.updated_by);
      
      // Hiện thông báo "Đã lưu"
      const savedMsg = document.getElementById('savedMsg');
      if (savedMsg) {
        savedMsg.classList.add('show');
        setTimeout(() => savedMsg.classList.remove('show'), 3000);
      }
    } else {
      console.error('[SAVE] Lỗi:', resp.status);
    }
  } catch (err) {
    console.error('[SAVE] Exception:', err);
  }
};

// 4. KHỞI ĐỘNG SOCKET KHI ĐĂNG NHẬP THÀNH CÔNG
const originalDoLogin = window.doLogin;
window.doLogin = async function() {
  // Gọi hàm đăng nhập gốc
  if (originalDoLogin) {
    originalDoLogin();
  }
  
  // Sau đó khởi động socket (sau 500ms để đảm bảo token đã được lưu)
  setTimeout(() => {
    const token = localStorage.getItem('token');
    if (token && !socket) {
      console.log('[LOGIN] Initializing socket connection...');
      initSocket(token);
    }
  }, 500);
};

// 5. CLEANUP KHI ĐĂNG XUẤT
const originalDoLogout = window.doLogout;
window.doLogout = function() {
  console.log('[LOGOUT] Disconnecting...');
  stopAutoRefetch();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  if (originalDoLogout) {
    originalDoLogout();
  }
};
