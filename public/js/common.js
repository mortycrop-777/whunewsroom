// ========== 公共工具函数 ==========

// API请求
async function api(url, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  return res.json();
}

// Toast提示
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// 格式化日期
function formatDate(dateStr) {
  return dateStr;
}

// 格式化时段
function formatTimeRange(start, end) {
  return `${start}:00 - ${end}:00`;
}

// 状态文本
function statusText(status) {
  const map = { pending: '待审批', approved: '已通过', rejected: '已拒绝', cancelled: '已取消' };
  return map[status] || status;
}

// 状态样式类
function statusClass(status) {
  return `status-${status}`;
}

// 标签类
function tagClass(status) {
  return `tag-${status}`;
}

// 渲染设备标签
function renderEquipmentTags(equipment) {
  if (!equipment) return '';
  return equipment.split(',').map(eq =>
    `<span class="tag tag-primary">${eq.trim()}</span>`
  ).join('');
}

// 渲染状态徽章
function renderStatusBadge(status) {
  return `<span class="status-badge ${statusClass(status)}">${statusText(status)}</span>`;
}

// 日期加减
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 获取本周起始日期
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

// 格式化日期为 YYYY-MM-DD
function toDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 当前登录用户 (简易session)
let currentUser = null;

function saveUser(user) {
  currentUser = user;
  localStorage.setItem('classroomUser', JSON.stringify(user));
}

function loadUser() {
  const data = localStorage.getItem('classroomUser');
  if (data) {
    currentUser = JSON.parse(data);
    return currentUser;
  }
  return null;
}

function clearUser() {
  currentUser = null;
  localStorage.removeItem('classroomUser');
}
