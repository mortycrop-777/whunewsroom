// ========== 管理员端逻辑 ==========

let adminUser = null;
let currentApproveBookingId = null;
let currentModifyBookingId = null;
let currentCancelBookingId = null;
let viewMode = 'gantt';

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadUser();
  if (saved && saved.role === 'admin') {
    showAdminApp(saved);
  }
});

// ========== 登录 ==========
async function adminLogin() {
  const username = document.getElementById('adminLoginUsername').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  if (!username || !password) { showToast('请填写账号和密码', 'error'); return; }
  const res = await api('/api/login', 'POST', { username, password, role: 'admin' });
  if (res.success) {
    saveUser(res.user);
    showAdminApp(res.user);
    showToast('登录成功', 'success');
  } else {
    showToast(res.message, 'error');
  }
}

function adminLogout() {
  clearUser();
  document.getElementById('adminMainApp').style.display = 'none';
  document.getElementById('adminLoginPage').style.display = 'flex';
}

function showAdminApp(user) {
  adminUser = user;
  document.getElementById('adminLoginPage').style.display = 'none';
  document.getElementById('adminMainApp').style.display = 'block';
  document.getElementById('adminName').textContent = user.name;
  loadDashboard();
  loadAdminNotifications();
  setInterval(loadAdminNotifications, 30000);
}

// ========== Tab切换 ==========
function adminSwitchTab(tab) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab-item[data-tab="${tab}"]`).classList.add('active');
  ['dashboard', 'pending', 'schedule', 'classrooms', 'logs'].forEach(t => {
    document.getElementById(`${t}Tab`).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'pending') loadAdminBookings();
  if (tab === 'schedule') { initScheduleFilters(); loadScheduleView(); }
  if (tab === 'classrooms') loadClassroomTable();
  if (tab === 'logs') loadLogs();
}

// ========== 概览Dashboard ==========
async function loadDashboard() {
  const today = toDateString(new Date());

  // 统计数据
  const allBookings = await api('/api/bookings');
  const pendingCount = allBookings.success ? allBookings.bookings.filter(b => b.status === 'pending').length : 0;
  const approvedCount = allBookings.success ? allBookings.bookings.filter(b => b.status === 'approved').length : 0;
  const todayBookings = allBookings.success ? allBookings.bookings.filter(b => b.date === today && b.status !== 'rejected' && b.status !== 'cancelled') : [];
  const classroomsRes = await api('/api/classrooms');
  const classroomCount = classroomsRes.success ? classroomsRes.classrooms.length : 0;

  document.getElementById('adminStats').innerHTML = `
    <div class="stat-card"><div class="number">${pendingCount}</div><div class="label">待审批</div></div>
    <div class="stat-card"><div class="number">${approvedCount}</div><div class="label">已通过</div></div>
    <div class="stat-card"><div class="number">${todayBookings.length}</div><div class="label">今日预约</div></div>
    <div class="stat-card"><div class="number">${classroomCount}</div><div class="label">教室总数</div></div>
  `;

  // 待审批列表
  const pendingBookings = allBookings.success ? allBookings.bookings.filter(b => b.status === 'pending') : [];
  if (pendingBookings.length === 0) {
    document.getElementById('dashboardPending').innerHTML = `<div class="empty-state"><div class="text">暂无待审批申请</div></div>`;
  } else {
    document.getElementById('dashboardPending').innerHTML = pendingBookings.slice(0, 5).map(b => `
      <div style="padding:12px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="openApproveModal('${b.id}')">
        <div>
          <div style="font-weight:500">${b.borrower_name} · ${b.classroom_name}</div>
          <div style="font-size:13px;color:var(--text-secondary)">${b.date} ${formatTimeRange(b.start_time, b.end_time)} · ${b.purpose}</div>
        </div>
        <div class="btn-group">
          <button class="btn btn-success btn-sm" onclick="openApproveModal('${b.id}')">审批</button>
        </div>
      </div>
    `).join('');
  }

  // 今日预约
  if (todayBookings.length === 0) {
    document.getElementById('dashboardToday').innerHTML = `<div class="empty-state"><div class="text">今日无预约</div></div>`;
  } else {
    document.getElementById('dashboardToday').innerHTML = todayBookings.map(b => `
      <div style="padding:12px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:500">${b.classroom_name} · ${b.borrower_name}</div>
          <div style="font-size:13px;color:var(--text-secondary)">${formatTimeRange(b.start_time, b.end_time)} · ${b.purpose}</div>
        </div>
        ${renderStatusBadge(b.status)}
      </div>
    `).join('');
  }
}

// ========== 审批管理 ==========
async function loadAdminBookings() {
  const status = document.getElementById('adminBookingStatus').value;
  const classroomId = document.getElementById('adminBookingClassroom').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (classroomId) params.set('classroomId', classroomId);

  const res = await api(`/api/bookings?${params.toString()}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  // 加载教室筛选选项
  if (!document.getElementById('adminBookingClassroom').dataset.loaded) {
    const classroomsRes = await api('/api/classrooms');
    if (classroomsRes.success) {
      const select = document.getElementById('adminBookingClassroom');
      select.innerHTML = '<option value="">全部教室</option>';
      classroomsRes.classrooms.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
      select.dataset.loaded = 'true';
    }
  }

  const container = document.getElementById('adminBookingsList');
  if (res.bookings.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="text">暂无符合条件的预约</div></div>`;
    return;
  }

  container.innerHTML = res.bookings.map(b => `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:600">${b.classroom_name} · ${b.borrower_name}（${b.user_name}）</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${b.date} ${formatTimeRange(b.start_time, b.end_time)} · ${b.purpose} · ${b.expected_count}人</div>
          ${b.department ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${b.department} · ${b.phone}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${renderStatusBadge(b.status)}
          <div class="btn-group">
            ${b.status === 'pending' ? `<button class="btn btn-success btn-sm" onclick="openApproveModal('${b.id}')">审批</button>` : ''}
            ${b.status === 'approved' ? `
              <button class="btn btn-warning btn-sm" onclick="openModifyModal('${b.id}')">修改</button>
              <button class="btn btn-danger btn-sm" onclick="openCancelModal('${b.id}')">取消</button>
            ` : ''}
            <button class="btn btn-outline btn-sm" onclick="viewBookingDetail('${b.id}')">详情</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ========== 审批操作 ==========
async function openApproveModal(bookingId) {
  currentApproveBookingId = bookingId;
  const res = await api(`/api/bookings/${bookingId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const b = res.booking;
  document.getElementById('approveBookingInfo').innerHTML = `
    <div style="padding:16px;background:var(--bg-light);border-radius:6px">
      <div style="margin-bottom:8px"><strong>教室：</strong>${b.classroom_name}（${b.building}，容量${b.capacity}人）</div>
      <div style="margin-bottom:8px"><strong>时段：</strong>${b.date} ${formatTimeRange(b.start_time, b.end_time)}</div>
      <div style="margin-bottom:8px"><strong>借用人：</strong>${b.borrower_name}（${b.department}）</div>
      <div style="margin-bottom:8px"><strong>电话：</strong>${b.phone}</div>
      <div style="margin-bottom:8px"><strong>用途：</strong>${b.purpose}</div>
      <div><strong>人数：</strong>${b.expected_count}人</div>
      ${b.notes ? `<div style="margin-top:8px"><strong>备注：</strong>${b.notes}</div>` : ''}
    </div>
  `;
  document.getElementById('rejectReasonGroup').style.display = 'none';
  document.getElementById('rejectReason').value = '';
  document.getElementById('approveModal').classList.add('active');
}

function closeApproveModal() {
  document.getElementById('approveModal').classList.remove('active');
}

async function doApprove(action) {
  if (action === 'reject') {
    document.getElementById('rejectReasonGroup').style.display = 'block';
    const reason = document.getElementById('rejectReason').value.trim();
    if (!reason) { showToast('拒绝预约必须填写理由', 'error'); return; }
  }
  const reason = document.getElementById('rejectReason').value.trim();
  const res = await api(`/api/bookings/${currentApproveBookingId}/approve`, 'POST', {
    adminId: adminUser.id, action, reason
  });
  if (res.success) {
    showToast(action === 'approve' ? '审批通过' : '已拒绝', action === 'approve' ? 'success' : 'warning');
    closeApproveModal();
    loadDashboard();
    if (document.getElementById('pendingTab').style.display !== 'none') loadAdminBookings();
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 修改预约 ==========
async function openModifyModal(bookingId) {
  currentModifyBookingId = bookingId;
  const res = await api(`/api/bookings/${bookingId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const b = res.booking;

  document.getElementById('modifyBookingInfo').innerHTML = `
    当前预约：${b.classroom_name} · ${b.date} ${formatTimeRange(b.start_time, b.end_time)}
  `;
  document.getElementById('modifyDate').value = b.date;
  document.getElementById('modifyStartTime').value = '';
  document.getElementById('modifyEndTime').value = '';

  // 加载教室选择
  const classroomsRes = await api('/api/classrooms');
  if (classroomsRes.success) {
    const select = document.getElementById('modifyClassroom');
    select.innerHTML = '<option value="">不更换</option>';
    classroomsRes.classrooms.forEach(c => {
      select.innerHTML += `<option value="${c.id}" ${c.id === b.classroom_id ? 'selected' : ''}>${c.name}（${c.capacity}人）</option>`;
    });
  }

  document.getElementById('modifyModal').classList.add('active');
}

function closeModifyModal() {
  document.getElementById('modifyModal').classList.remove('active');
}

async function doModify() {
  const classroomId = document.getElementById('modifyClassroom').value || undefined;
  const date = document.getElementById('modifyDate').value || undefined;
  const startTime = document.getElementById('modifyStartTime').value ? parseInt(document.getElementById('modifyStartTime').value) : undefined;
  const endTime = document.getElementById('modifyEndTime').value ? parseInt(document.getElementById('modifyEndTime').value) : undefined;

  if (!classroomId && !date && !startTime && !endTime) {
    showToast('未做任何修改', 'warning'); return;
  }

  const res = await api(`/api/bookings/${currentModifyBookingId}/modify`, 'PUT', {
    adminId: adminUser.id, classroomId, date, startTime, endTime
  });
  if (res.success) {
    showToast('预约已修改', 'success');
    closeModifyModal();
    loadDashboard();
    loadAdminBookings();
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 取消预约 ==========
async function openCancelModal(bookingId) {
  currentCancelBookingId = bookingId;
  const res = await api(`/api/bookings/${bookingId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const b = res.booking;
  document.getElementById('cancelBookingInfo').innerHTML = `
    ${b.classroom_name} · ${b.date} ${formatTimeRange(b.start_time, b.end_time)} · ${b.borrower_name}
  `;
  document.getElementById('cancelReason').value = '';
  document.getElementById('cancelModal').classList.add('active');
}

function closeCancelModal() {
  document.getElementById('cancelModal').classList.remove('active');
}

async function doCancel() {
  const reason = document.getElementById('cancelReason').value.trim();
  const res = await api(`/api/bookings/${currentCancelBookingId}/cancel`, 'POST', {
    adminId: adminUser.id, reason
  });
  if (res.success) {
    showToast('预约已取消', 'success');
    closeCancelModal();
    loadDashboard();
    loadAdminBookings();
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 查看预约详情 ==========
async function viewBookingDetail(bookingId) {
  const res = await api(`/api/bookings/${bookingId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const b = res.booking;

  // 加载审批日志
  const logsRes = await api(`/api/approval-logs/${bookingId}`);
  let logsHtml = '';
  if (logsRes.success && logsRes.logs.length > 0) {
    logsHtml = `<div style="margin-top:16px"><div style="font-weight:600;margin-bottom:8px">审批记录</div>`;
    logsRes.logs.forEach(l => {
      logsHtml += `<div style="padding:8px;border-bottom:1px solid var(--border-light);font-size:13px">
        ${l.admin_name} · ${l.action === 'approve' ? '通过' : l.action === 'reject' ? '拒绝' : l.action === 'modify' ? '修改' : '取消'}
        ${l.reason ? `（${l.reason}）` : ''} · ${l.created_at}
      </div>`;
    });
    logsHtml += '</div>';
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title"><span>预约详情</span><span class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</span></div>
      <div style="padding:16px;background:var(--bg-light);border-radius:6px">
        <div style="margin-bottom:8px"><strong>教室：</strong>${b.classroom_name}（${b.building}）</div>
        <div style="margin-bottom:8px"><strong>时段：</strong>${b.date} ${formatTimeRange(b.start_time, b.end_time)}</div>
        <div style="margin-bottom:8px"><strong>状态：</strong>${renderStatusBadge(b.status)}</div>
        <div style="margin-bottom:8px"><strong>借用人：</strong>${b.borrower_name}（${b.department}）</div>
        <div style="margin-bottom:8px"><strong>电话：</strong>${b.phone}</div>
        <div style="margin-bottom:8px"><strong>用途：</strong>${b.purpose}</div>
        <div style="margin-bottom:8px"><strong>人数：</strong>${b.expected_count}人</div>
        ${b.notes ? `<div><strong>备注：</strong>${b.notes}</div>` : ''}
      </div>
      ${logsHtml}
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ========== 排班视图 ==========
async function initScheduleFilters() {
  const today = new Date();
  const weekEnd = addDays(today, 7);
  document.getElementById('scheduleStartDate').value = toDateString(today);
  document.getElementById('scheduleEndDate').value = toDateString(weekEnd);

  // 加载教室选项
  if (!document.getElementById('scheduleClassroom').dataset.loaded) {
    const classroomsRes = await api('/api/classrooms');
    if (classroomsRes.success) {
      const select = document.getElementById('scheduleClassroom');
      select.innerHTML = '<option value="">全部教室</option>';
      classroomsRes.classrooms.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
      select.dataset.loaded = 'true';
    }
  }
}

function switchViewMode(mode) {
  viewMode = mode;
  document.getElementById('viewGanttBtn').style.background = mode === 'gantt' ? 'var(--primary)' : '';
  document.getElementById('viewGanttBtn').style.color = mode === 'gantt' ? 'white' : '';
  document.getElementById('viewCalendarBtn').style.background = mode === 'calendar' ? 'var(--primary)' : '';
  document.getElementById('viewCalendarBtn').style.color = mode === 'calendar' ? 'white' : '';
  document.getElementById('ganttView').style.display = mode === 'gantt' ? 'block' : 'none';
  document.getElementById('calendarView').style.display = mode === 'calendar' ? 'block' : 'none';
  loadScheduleView();
}

async function loadScheduleView() {
  const startDate = document.getElementById('scheduleStartDate').value;
  const endDate = document.getElementById('scheduleEndDate').value;
  const classroomId = document.getElementById('scheduleClassroom').value;
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (classroomId) params.set('classroomId', classroomId);

  const res = await api(`/api/schedule-overview?${params.toString()}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  if (viewMode === 'gantt') {
    renderGanttView(res.bookings, res.classrooms);
  } else {
    renderCalendarView(res.bookings, res.classrooms, startDate, endDate);
  }
}

function renderGanttView(bookings, classrooms) {
  const container = document.getElementById('ganttView');
  if (bookings.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="text">该时段无预约数据</div></div>`;
    return;
  }

  // 按教室分组
  const byClassroom = {};
  bookings.forEach(b => {
    if (!byClassroom[b.classroom_id]) byClassroom[b.classroom_id] = { name: b.classroom_name, bookings: [] };
    byClassroom[b.classroom_id].bookings.push(b);
  });

  // 甘特图范围：8-22点
  const totalHours = 14; // 8 to 22
  const hourWidth = 100 / totalHours;

  let html = `<div class="gantt-time-header">
    ${[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].map(h => `<div class="gantt-time-cell">${h}</div>`).join('')}
  </div>`;

  // 逐教室逐日渲染
  const dates = [...new Set(bookings.map(b => b.date))].sort();

  for (const classroomId of Object.keys(byClassroom)) {
    const cr = byClassroom[classroomId];
    // 逐日
    for (const date of dates) {
      const dayBookings = cr.bookings.filter(b => b.date === date);
      if (dayBookings.length === 0) continue;

      html += `<div class="gantt-row">
        <div class="gantt-label">${cr.name} · ${date.slice(5)}</div>
        <div class="gantt-bars">`;

      dayBookings.forEach(b => {
        const left = (b.start_time - 8) * hourWidth;
        const width = (b.end_time - b.start_time) * hourWidth;
        html += `<div class="gantt-bar ${b.status}" style="left:${left}%;width:${width}%" onclick="viewBookingDetail('${b.id}')">
          <div class="gantt-bar-tooltip">${b.borrower_name} ${b.start_time}:00-${b.end_time}:00</div>
          ${b.borrower_name}
        </div>`;
      });

      html += `</div></div>`;
    }
  }

  container.innerHTML = html;
}

function renderCalendarView(bookings, classrooms, startDate, endDate) {
  const container = document.getElementById('calendarView');
  if (!startDate || !endDate) {
    container.innerHTML = `<div class="empty-state"><div class="text">请选择日期范围</div></div>`;
    return;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(toDateString(d));
  }

  const headers = ['一', '二', '三', '四', '五', '六', '日'];

  let html = `<div class="card-header">日历视图 · ${startDate} 至 ${endDate}</div>`;
  html += `<div class="calendar-view-grid">`;

  // 头部
  headers.forEach(h => html += `<div class="calendar-header-cell" style="font-size:12px;font-weight:600;padding:8px;text-align:center">${h}</div>`);

  // 日期格
  const firstDay = new Date(startDate).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  for (let i = 0; i < startOffset; i++) {
    html += `<div style="min-height:60px;background:var(--bg-gray);border-radius:4px"></div>`;
  }

  days.forEach(day => {
    const dayBookings = bookings.filter(b => b.date === day);
    html += `<div class="calendar-day-cell">
      <div class="day-label">${day.slice(8)}</div>`;
    dayBookings.forEach(b => {
      const statusColor = b.status === 'approved' ? '#E8F8E0' : b.status === 'pending' ? '#FFF7E0' : '#FFE0E0';
      const textColor = b.status === 'approved' ? '#389E0D' : b.status === 'pending' ? '#D48806' : '#CF1322';
      html += `<div class="booking-dot" style="background:${statusColor};color:${textColor}" onclick="viewBookingDetail('${b.id}')" title="${b.borrower_name} ${b.start_time}:00-${b.end_time}:00">
        ${b.classroom_name.slice(0, 8)} ${b.start_time}:00
      </div>`;
    });
    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

// ========== 教室管理 ==========
async function loadClassroomTable() {
  const res = await api('/api/classrooms');
  if (!res.success) { showToast(res.message, 'error'); return; }

  const tbody = document.getElementById('classroomTableBody');
  tbody.innerHTML = res.classrooms.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.building}</td>
      <td>${c.floor}F</td>
      <td>${c.capacity}人</td>
      <td>${renderEquipmentTags(c.equipment)}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-warning btn-sm" onclick="editClassroom('${c.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="deleteClassroom('${c.id}')">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openAddClassroomModal() {
  document.getElementById('newClassName').value = '';
  document.getElementById('newClassBuilding').value = '';
  document.getElementById('newClassFloor').value = '';
  document.getElementById('newClassCapacity').value = '';
  document.getElementById('newClassEquipment').value = '';
  document.getElementById('newClassNotes').value = '';
  document.getElementById('addClassroomModal').classList.add('active');
}

function closeAddClassroomModal() {
  document.getElementById('addClassroomModal').classList.remove('active');
}

async function addClassroom(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('newClassName').value.trim(),
    building: document.getElementById('newClassBuilding').value.trim(),
    floor: parseInt(document.getElementById('newClassFloor').value),
    capacity: parseInt(document.getElementById('newClassCapacity').value),
    equipment: document.getElementById('newClassEquipment').value.trim(),
    notes: document.getElementById('newClassNotes').value.trim(),
    adminId: adminUser.id,
  };
  const res = await api('/api/classrooms', 'POST', data);
  if (res.success) {
    showToast('教室已添加', 'success');
    closeAddClassroomModal();
    loadClassroomTable();
    loadDashboard();
  } else {
    showToast(res.message, 'error');
  }
}

async function editClassroom(classroomId) {
  const res = await api(`/api/classrooms/${classroomId}`);
  if (!res.success) { showToast(res.message, 'error'); return; }
  const c = res.classroom;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title"><span>编辑教室</span><span class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</span></div>
      <form onsubmit="updateClassroom(event, '${classroomId}')">
        <div class="form-group">
          <label class="form-label">教室名称 <span class="required">*</span></label>
          <input type="text" class="form-input" id="editClassName" value="${c.name}" required>
        </div>
        <div style="display:flex;gap:12px">
          <div class="form-group" style="flex:1">
            <label class="form-label">楼栋</label>
            <input type="text" class="form-input" id="editClassBuilding" value="${c.building}">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">楼层</label>
            <input type="number" class="form-input" id="editClassFloor" value="${c.floor}" min="1">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">容量</label>
          <input type="number" class="form-input" id="editClassCapacity" value="${c.capacity}" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">设备清单（逗号分隔）</label>
          <input type="text" class="form-input" id="editClassEquipment" value="${c.equipment}">
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <textarea class="form-textarea" id="editClassNotes">${c.notes || ''}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">保存修改</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function updateClassroom(e, classroomId) {
  e.preventDefault();
  const res = await api(`/api/classrooms/${classroomId}`, 'PUT', {
    name: document.getElementById('editClassName').value.trim(),
    building: document.getElementById('editClassBuilding').value.trim(),
    floor: parseInt(document.getElementById('editClassFloor').value),
    capacity: parseInt(document.getElementById('editClassCapacity').value),
    equipment: document.getElementById('editClassEquipment').value.trim(),
    notes: document.getElementById('editClassNotes').value.trim(),
    adminId: adminUser.id,
  });
  if (res.success) {
    showToast('教室已更新', 'success');
    document.querySelector('.modal-overlay.active').remove();
    loadClassroomTable();
  } else {
    showToast(res.message, 'error');
  }
}

async function deleteClassroom(classroomId) {
  if (!confirm('确定要删除此教室吗？删除后无法恢复。')) return;
  const res = await api(`/api/classrooms/${classroomId}`, 'DELETE', { adminId: adminUser.id });
  if (res.success) {
    showToast('教室已删除', 'success');
    loadClassroomTable();
  } else {
    showToast(res.message, 'error');
  }
}

// ========== 操作日志 ==========
async function loadLogs() {
  const targetType = document.getElementById('logType').value;
  const params = new URLSearchParams();
  if (targetType) params.set('targetType', targetType);

  const res = await api(`/api/logs?${params.toString()}`);
  if (!res.success) { showToast(res.message, 'error'); return; }

  const tbody = document.getElementById('logTableBody');
  if (res.logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">暂无日志记录</td></tr>`;
    return;
  }

  tbody.innerHTML = res.logs.map(l => `
    <tr>
      <td>${l.created_at}</td>
      <td>${l.user_name}</td>
      <td>${l.action}</td>
      <td>${l.target_type}</td>
      <td>${l.details ? `<span style="font-size:12px;color:var(--text-secondary)">${l.details}</span>` : '-'}</td>
    </tr>
  `).join('');
}

// ========== 管理员通知 ==========
async function loadAdminNotifications() {
  if (!adminUser) return;
  const res = await api(`/api/notifications/${adminUser.id}`);
  if (!res.success) return;

  const badge = document.getElementById('adminNotifBadge');
  const unreadRes = await api(`/api/notifications/${adminUser.id}/unread-count`);
  if (unreadRes.success && unreadRes.count > 0) {
    badge.style.display = 'inline-flex';
    badge.textContent = unreadRes.count;
  } else {
    badge.style.display = 'none';
  }

  const list = document.getElementById('adminNotifList');
  if (res.notifications.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="text">暂无通知</div></div>`;
    return;
  }

  list.innerHTML = res.notifications.map(n => `
    <div class="notification-item ${n.read ? '' : 'unread'}" onclick="readAdminNotif('${n.id}')">
      <div class="title">${n.title}</div>
      <div class="content">${n.content}</div>
      <div class="time">${n.created_at}</div>
    </div>
  `).join('');
}

function toggleAdminNotif() {
  document.getElementById('adminNotifPanel').classList.toggle('open');
}

async function readAdminNotif(notifId) {
  await api(`/api/notifications/${notifId}/read`, 'POST');
  loadAdminNotifications();
}
