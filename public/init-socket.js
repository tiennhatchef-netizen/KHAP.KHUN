// public/init-socket.js
// Khởi động socket ngay khi trang load nếu user đã đăng nhập

document.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] App loaded');
  
  const token = localStorage.getItem('token');
  if (token) {
    console.log('[INIT] User already logged in, initializing socket...');
    setTimeout(() => {
      initSocket(token);
    }, 100);
  }
});
