// ========== 用户端逻辑 ==========

// 日历状态
let calendarState = {
  classroomId: null,
  classroomName: null,
  classroomCapacity: null,
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  selectedDate: null,
  selectedStartTime: null,
  selectedEndTime: null,
  bookedSlots: [], // 某日已预约时段
};

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  // 登录/注册切换
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      document.getElementById('loginForm').style.display = tabName === 'login' ? 'block' : 'none';
      document.getElementById('registerForm').style.display = tabName === 'register' ? 'block' : 'none';
    });
  });

  // 检查已登录
  const saved = loadUser();
  if (saved && saved.role === 'user') {
    showMainApp(saved);
  }
});

// ========== 登录/注册 ==========
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { showToast('请填写用户名和密码', 'error'); return; }
  const res = await api('/api/login', 'POST', { username, password, role: 'user' });
  if (res.success) {
    saveUser(res.user);
    showMainApp(res.user);
    showToast('登录成功', 'success');
  } else {
    showToast(res.message, 'error');
  }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const name = document.getElementById('regName').value.trim();
  const department = document.getElementById('regDepartment').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  if (!username || !password || !name) { showToast('请填写必填信息', 'error'); return; }
  const res = await api('/api/register', 'POST', { username, password, name, department, phone, role: 'user' });
  if (res.success) {
    saveUser(res.user);
    showMainApp(res.user);
    showToast('注册成功', 'success');
  } else {
    showToast(res.message, 'error');
  }
}

function logout() {
  clearUser();
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  showToast('已退出', 'info');
}

function showMainApp(user) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userDisplayName').textContent = user.name;

  // 自动填入申请表信息
  document.getElementById('bfBorrowerName').value = user.name || '';
  document.getElementById('bfDepartment').value = user.department || '';
  document.getElementById('bfPhone').value = user.phone || '';

  loadFilterOptions();
  loadClassrooms();
  loadNotifications();
  // 定时刷新通知
  setInterval(loadNotifications, 30000);
}

// ========== Tab切换 ==========
function switchTab(tab) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab-item[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('classroomsTab').style.display = tab === 'classrooms' ? 'block' : 'none';
  document.getElementById('bookingsTab').style.display = tab === 'bookings' ? 'block' : 'none';
  if (tab === 'bookings') loadMyBookings();
}

// ========== 加载筛选选项 ==========
async function loadFilterOptions() {
  const buildingsRes = await api('/api/buildings');
  if (buildingsRes.success) {
    const select = document.getElementById('filterBuilding');
    select.innerHTML = '<option value="">全部楼栋</option>';
    buildingsRes.buildings.forEach(b => {
      select.innerHTML += `<option value="${b}">${b}</option>`;
    });
  }
  const tagsRes = await api('/api/equipment-tags');
  if (tagsRes.success) {
    const select = document.getElementById('filterEquipment');
    select.innerHTML = '<option value="">不限设备</option>';
    tagsRes.tags.forEach(t => {
      select.innerHTML += `<option value="${t}">${t}</option>`;
    });
  }
}

// ========== 加载教室列表 ==========
async function loadClassrooms() {
  const building = document.getElementById('filterBuilding').value;
  const capacity = document.getElementById('filterCapacity').value;
  const equipment = document.getElementById('filterEquipment').value;
  const params = new URLSearchParams();
  if (building) params.set('building', building);
  if (capacity) params.set('capacity', capacity);
  if (equipment) params.set('equipment', equipment);

  const res = await api(`/api/classrooms?${params.toString()}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  const grid = document.getElementById('classroomGrid');
  if (res.classrooms.length === 0) {
    grid.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg><div class="text">暂无符合条件的教室</div></div>`;
    return;
  }

  grid.innerHTML = res.classrooms.map(c => `
    <div class="classroom-card" onclick="openCalendar('${c.id}', '${c.name}', ${c.capacity})">
      <div class="name">${c.name}</div>
      <div class="info">📍 ${c.building} ${c.floor}F</div>
      <div class="info">👥 容量：${c.capacity}人</div>
      ${c.equipment ? `<div class="tags">${renderEquipmentTags(c.equipment)}</div>` : ''}
    </div>
  `).join('');
}

// ========== 日历选择 ==========
function openCalendar(classroomId, name, capacity) {
  calendarState.classroomId = classroomId;
  calendarState.classroomName = name;
  calendarState.classroomCapacity = capacity;
  calendarState.selectedDate = null;
  calendarState.selectedStartTime = null;
  calendarState.selectedEndTime = null;

  const now = new Date();
  calendarState.currentMonth = now.getMonth();
  calendarState.currentYear = now.getFullYear();

  document.getElementById('calendarTitle').textContent = name;
  document.getElementById('calendarClassroomInfo').textContent = `${name} · 容量${capacity}人 · 请选择借用日期和时段`;
  document.getElementById('timeSlotSection').style.display = 'none';
  renderCalendar();
  document.getElementById('calendarModal').classList.add('active');
}

function closeCalendarModal() {
  document.getElementById('calendarModal').classList.remove('active');
}

function calendarPrevMonth() {
  calendarState.currentMonth--;
  if (calendarState.currentMonth < 0) { calendarState.currentMonth = 11; calendarState.currentYear--; }
  calendarState.selectedDate = null;
  renderCalendar();
}

function calendarNextMonth() {
  calendarState.currentMonth++;
  if (calendarState.currentMonth > 11) { calendarState.currentMonth = 0; calendarState.currentYear++; }
  calendarState.selectedDate = null;
  renderCalendar();
}

function renderCalendar() {
  const year = calendarState.currentYear;
  const month = calendarState.currentMonth;
  document.getElementById('calendarMonthLabel').textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = toDateString(today);

  const headers = ['一', '二', '三', '四', '五', '六', '日'];
  // 转换 firstDay: 0=周日 → index 6
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  let html = headers.map(h => `<div class="calendar-header-cell">${h}</div>`).join('');

  // 前面空格
  for (let i = 0; i < startOffset; i++) {
    html += `<div class="calendar-cell disabled"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isPast = new Date(dateStr) < new Date(todayStr);
    const isToday = dateStr === todayStr;
    const isSelected = calendarState.selectedDate === dateStr;
    let classes = 'calendar-cell';
    if (isPast) classes += ' disabled';
    if (isToday) classes += ' today';
    if (isSelected) classes += ' selected';

    html += `<div class="${classes}" ${!isPast ? `onclick="selectDate('${dateStr}')"` : ''}>${d}</div>`;
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

async function selectDate(dateStr) {
  calendarState.selectedDate = dateStr;
  calendarState.selectedStartTime = null;
  calendarState.selectedEndTime = null;
  renderCalendar();

  // 加载该日预约时段
  const res = await api(`/api/classrooms/${calendarState.classroomId}/schedule?date=${dateStr}`);
  if (res.success) {
    calendarState.bookedSlots = res.bookings.map(b => ({ start: b.start_time, end: b.end_time, name: b.borrower_name }));
  } else {
    calendarState.bookedSlots = [];
  }

  document.getElementById('timeSlotSection').style.display = 'block';
  renderTimeSlots();
  document.getElementById('timeRangeInfo').style.display = 'none';
  document.getElementById('goToFormBtn').style.display = 'none';
}

function renderTimeSlots() {
  const grid = document.getElementById('timeSlotGrid');
  let html = '';
  for (let h = 8; h <= 22; h++) {
    const isBooked = calendarState.bookedSlots.some(s => h >= s.start && h < s.end);
    let classes = 'time-slot';
    if (isBooked) classes += ' booked';
    if (h === calendarState.selectedStartTime) classes += ' selected';
    if (calendarState.selectedStartTime && !calendarState.selectedEndTime && h > calendarState.selectedStartTime && h <= (calendarState.selectedEndTime || 22)) {
      // 暂时高亮起始时间之后到预选结束时间的范围
      if (!isBooked) classes += ' start-selected';
    }
    if (calendarState.selectedStartTime && calendarState.selectedEndTime) {
      if (h >= calendarState.selectedStartTime && h < calendarState.selectedEndTime) classes += ' selected';
    }

    const disabled = isBooked ? 'onclick="showToast(\'该时段已被预约\',\'warning\')"' : `onclick="selectTimeSlot(${h})"`;
    html += `<div class="${classes}" ${disabled}>${h}:00</div>`;
  }
  grid.innerHTML = html;
}

function selectTimeSlot(hour) {
  if (!calendarState.selectedStartTime) {
    // 第一次点击：选择开始时间
    calendarState.selectedStartTime = hour;
    calendarState.selectedEndTime = null;
    renderTimeSlots();
    document.getElementById('timeRangeInfo').style.display = 'none';
    document.getElementById('goToFormBtn').style.display = 'none';
    showToast(`开始时间：${hour}:00，请选择结束时间`, 'info');
  } else if (!calendarState.selectedEndTime) {
    // 第二次点击：选择结束时间
    if (hour <= calendarState.selectedStartTime) {
      // 如果点击的时间小于等于开始时间，重新选择
      calendarState.selectedStartTime = hour;
      calendarState.selectedEndTime = null;
      renderTimeSlots();
      showToast(`开始时间已更新为：${hour}:00`, 'info');
      return;
    }
    // 检查选中范围内是否有已预约时段
    const hasConflict = calendarState.bookedSlots.some(s =>
      !(s.end <= calendarState.selectedStartTime || s.start >= hour)
    );
    if (hasConflict) {
      showToast('选中范围内存在已预约时段，请重新选择', 'error');
      calendarState.selectedStartTime = null;
      calendarState.selectedEndTime = null;
      renderTimeSlots();
      return;
    }
    calendarState.selectedEndTime = hour;
    renderTimeSlots();
    document.getElementById('timeRangeDisplay').textContent =
      `${calendarState.selectedDate} ${calendarState.selectedStartTime}:00 - ${calendarState.selectedEndTime}:00（共${calendarState.selectedEndTime - calendarState.selectedStartTime}小时）`;
    document.getElementById('timeRangeInfo').style.display = 'flex';
    document.getElementById('goToFormBtn').style.display = 'block';
  } else {
    // 已选择完毕，重新开始
    calendarState.selectedStartTime = hour;
    calendarState.selectedEndTime = null;
    renderTimeSlots();
    document.getElementById('timeRangeInfo').style.display = 'none';
    document.getElementById('goToFormBtn').style.display = 'none';
  }
}

// ========== 借用申请表 ==========
function showBookingForm() {
  if (!calendarState.selectedDate || !calendarState.selectedStartTime || !calendarState.selectedEndTime) {
    showToast('请先选择日期和时段', 'error'); return;
  }
  document.getElementById('bookingTimeInfo').innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--primary)"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 11.5a.5.5 0 01-1 0V6.5a.5.5 0 011 0v5zm0-7a.5.5 0 01-1 0v-1a.5.5 0 011 0v1z"/></svg>
    <span>${calendarState.classroomName} · ${calendarState.selectedDate} · ${calendarState.selectedStartTime}:00-${calendarState.selectedEndTime}:00</span>
  `;
  document.getElementById('bfCount').max = calendarState.classroomCapacity;
  document.getElementById('bfCount').placeholder = `最多${calendarState.classroomCapacity}人`;
  closeCalendarModal();
  document.getElementById('bookingFormModal').classList.add('active');
}

function closeBookingFormModal() {
  document.getElementById('bookingFormModal').classList.remove('active');
}

async function submitBooking(e) {
  e.preventDefault();
  const data = {
    userId: currentUser.id,
    classroomId: calendarState.classroomId,
    borrowerName: document.getElementById('bfBorrowerName').value.trim(),
    department: document.getElementById('bfDepartment').value.trim(),
    phone: document.getElementById('bfPhone').value.trim(),
    purpose: document.getElementById('bfPurpose').value.trim(),
    expectedCount: parseInt(document.getElementById('bfCount').value),
    notes: document.getElementById('bfNotes').value.trim(),
    date: calendarState.selectedDate,
    startTime: calendarState.selectedStartTime,
    endTime: calendarState.selectedEndTime,
  };
  const res = await api('/api/bookings', 'POST', data);
  if (res.success) {
    showToast('申请提交成功！', 'success');
    closeBookingFormModal();
    // 重置
    calendarState.selectedStartTime = null;
    calendarState.selectedEndTime = null;
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 我的申请记录 ==========
async function loadMyBookings() {
  if (!currentUser) return;
  const status = document.getElementById('filterStatus').value;
  const startDate = document.getElementById('filterStartDate').value;
  const endDate = document.getElementById('filterEndDate').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const res = await api(`/api/bookings/user/${currentUser.id}?${params.toString()}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  const container = document.getElementById('myBookingsList');
  if (res.bookings.length === 0) {
    container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg><div class="text">暂无申请记录</div></div>`;
    return;
  }

  container.innerHTML = res.bookings.map(b => `
    <div class="card" onclick="showBookingDetail('${b.id}')" style="cursor:pointer">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:600;font-size:15px">${b.classroom_name}</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${b.date} ${formatTimeRange(b.start_time, b.end_time)} · ${b.purpose}</div>
        </div>
        ${renderStatusBadge(b.status)}
      </div>
    </div>
  `).join('');
}

async function showBookingDetail(bookingId) {
  const res = await api(`/api/bookings/${bookingId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const b = res.booking;

  let actionsHtml = '';
  if (b.status === 'pending' || b.status === 'approved') {
    actionsHtml = `<button class="btn btn-danger" onclick="cancelMyBooking('${b.id}')">取消预约</button>`;
  }

  document.getElementById('bookingDetailContent').innerHTML = `
    <div class="booking-detail">
      <div class="row"><div class="label">教室</div><div class="value">${b.classroom_name}（${b.building}）</div></div>
      <div class="row"><div class="label">日期</div><div class="value">${b.date}</div></div>
      <div class="row"><div class="label">时段</div><div class="value">${formatTimeRange(b.start_time, b.end_time)}</div></div>
      <div class="row"><div class="label">状态</div><div class="value">${renderStatusBadge(b.status)}</div></div>
      <div class="row"><div class="label">借用人</div><div class="value">${b.borrower_name}</div></div>
      <div class="row"><div class="label">部门</div><div class="value">${b.department}</div></div>
      <div class="row"><div class="label">电话</div><div class="value">${b.phone}</div></div>
      <div class="row"><div class="label">用途</div><div class="value">${b.purpose}</div></div>
      <div class="row"><div class="label">人数</div><div class="value">${b.expected_count}人</div></div>
      ${b.notes ? `<div class="row"><div class="label">备注</div><div class="value">${b.notes}</div></div>` : ''}
      <div class="row"><div class="label">提交时间</div><div class="value">${b.created_at}</div></div>
    </div>
  `;
  document.getElementById('bookingDetailActions').innerHTML = actionsHtml;
  document.getElementById('bookingDetailModal').classList.add('active');
}

function closeBookingDetailModal() {
  document.getElementById('bookingDetailModal').classList.remove('active');
}

async function cancelMyBooking(bookingId) {
  if (!confirm('确定要取消此预约吗？')) return;
  const res = await api(`/api/bookings/${bookingId}/user-cancel`, 'POST', { userId: currentUser.id });
  if (res.success) {
    showToast('预约已取消', 'success');
    closeBookingDetailModal();
    loadMyBookings();
    loadNotifications();
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 通知 ==========
async function loadNotifications() {
  if (!currentUser) return;
  const res = await api(`/api/notifications/${currentUser.id}`);
  if (!res.success) return;

  const badge = document.getElementById('notifBadge');
  const unreadRes = await api(`/api/notifications/${currentUser.id}/unread-count`);
  if (unreadRes.success && unreadRes.count > 0) {
    badge.style.display = 'inline-flex';
    badge.textContent = unreadRes.count;
  } else {
    badge.style.display = 'none';
  }

  const list = document.getElementById('notifList');
  if (res.notifications.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="text">暂无通知</div></div>`;
    return;
  }

  list.innerHTML = res.notifications.map(n => `
    <div class="notification-item ${n.read ? '' : 'unread'}" onclick="readNotification('${n.id}')">
      <div class="title">${n.title}</div>
      <div class="content">${n.content}</div>
      <div class="time">${n.created_at}</div>
    </div>
  `).join('');
}

function toggleNotifications() {
  document.getElementById('notifPanel').classList.toggle('open');
}

async function readNotification(notifId) {
  await api(`/api/notifications/${notifId}/read`, 'POST');
  loadNotifications();
}
