const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保 data 目录存在
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 数据库初始化
const db = new Database(path.join(dataDir, 'classroom.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    department TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS classrooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    building TEXT NOT NULL,
    floor INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    equipment TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,
    borrower_name TEXT NOT NULL,
    department TEXT NOT NULL,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    notes TEXT,
    date TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
  );

  CREATE TABLE IF NOT EXISTS approval_logs (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    old_values TEXT,
    new_values TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (admin_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    booking_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 插入初始管理员用户
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const adminId = uuidv4();
  const hashedPw = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (id, username, password, name, department, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    adminId, 'admin', hashedPw, '系统管理员', '信息中心', '0000', 'admin'
  );
}

// 插入初始普通用户
const userExists = db.prepare('SELECT id FROM users WHERE username = ?').get('user1');
if (!userExists) {
  const userId = uuidv4();
  const hashedPw = bcrypt.hashSync('user123', 10);
  db.prepare('INSERT INTO users (id, username, password, name, department, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId, 'user1', hashedPw, '张三', '计算机系', '13800001111', 'user'
  );
}

// 插入初始教室数据
const classroomsData = [
  { name: 'A101 多媒体教室', building: '教学楼A', floor: 1, capacity: 60, equipment: '投影仪,电脑,音响,白板' },
  { name: 'A201 普通教室', building: '教学楼A', floor: 2, capacity: 40, equipment: '白板' },
  { name: 'A301 大阶梯教室', building: '教学楼A', floor: 3, capacity: 150, equipment: '投影仪,电脑,音响,白板,录播设备' },
  { name: 'B102 实验教室', building: '教学楼B', floor: 1, capacity: 30, equipment: '投影仪,电脑,实验台' },
  { name: 'B201 会议室', building: '教学楼B', floor: 2, capacity: 20, equipment: '投影仪,白板,视频会议系统' },
  { name: 'C101 研讨室', building: '教学楼C', floor: 1, capacity: 15, equipment: '白板,电视' },
];

const classroomInsert = db.prepare('INSERT INTO classrooms (id, name, building, floor, capacity, equipment, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
for (const c of classroomsData) {
  const cExists = db.prepare('SELECT id FROM classrooms WHERE name = ?').get(c.name);
  if (!cExists) {
    classroomInsert.run(uuidv4(), c.name, c.building, c.floor, c.capacity, c.equipment, '');
  }
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// multer 配置（文件上传）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 CSV 或 Excel 文件'));
    }
  }
});

// ========== 日志记录中间件 ==========
function logOperation(userId, action, targetType, targetId, details) {
  db.prepare('INSERT INTO operation_logs (id, user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(), userId, action, targetType, targetId, details ? JSON.stringify(details) : null
  );
}

// ========== 通知函数 ==========
function createNotification(userId, bookingId, title, content) {
  db.prepare('INSERT INTO notifications (id, user_id, booking_id, title, content) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), userId, bookingId, title, content
  );
}

// ========== 冲突检测 ==========
function checkConflict(classroomId, date, startTime, endTime, excludeBookingId = null) {
  let query = `SELECT * FROM bookings WHERE classroom_id = ? AND date = ? AND status != 'rejected' AND status != 'cancelled'`;
  const params = [classroomId, date];
  if (excludeBookingId) {
    query += ` AND id != ?`;
    params.push(excludeBookingId);
  }
  query += ` AND NOT (end_time <= ? OR start_time >= ?)`;
  params.push(startTime, endTime);

  return db.prepare(query).all(...params);
}

// ========== 认证API ==========

// 用户登录
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, role);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.json({ success: false, message: '用户名或密码错误' });
  }
  const token = uuidv4();
  // 简易 token 存储 (生产环境应使用 JWT)
  logOperation(user.id, 'login', 'user', user.id, null);
  res.json({
    success: true,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department, phone: user.phone }
  });
});

// 注册用户
app.post('/api/register', (req, res) => {
  const { username, password, name, department, phone, role = 'user' } = req.body;
  if (!username || !password || !name) {
    return res.json({ success: false, message: '必填信息缺失' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.json({ success: false, message: '用户名已存在' });
  }
  const id = uuidv4();
  const hashedPw = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, username, password, name, department, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, username, hashedPw, name, department || '', phone || '', role
  );
  logOperation(id, 'register', 'user', id, null);
  res.json({ success: true, user: { id, username, name, role, department, phone } });
});

// ========== 批量导入用户API ==========
app.post('/api/users/batch-register', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: '请上传文件' });
  }

  const { adminId } = req.body;
  if (!adminId) {
    return res.json({ success: false, message: '缺少管理员ID' });
  }

  // 检查管理员权限
  const admin = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(adminId, 'admin');
  if (!admin) {
    return res.json({ success: false, message: '仅管理员可执行批量导入' });
  }

  const fileBuffer = req.file.buffer;
  const fileName = req.file.originalname;
  const ext = path.extname(fileName).toLowerCase();

  let rows = [];

  try {
    if (ext === '.csv') {
      // CSV 解析
      const content = fileBuffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        return res.json({ success: false, message: 'CSV文件内容不足（至少需标题行+1条数据）' });
      }
      // 跳过标题行
      const headerLine = lines[0];
      const headers = parseCSVLine(headerLine);
      // 标题映射：支持中英文列名
      const headerMap = {
        '姓名': 'name', 'name': 'name',
        '学号': 'studentId', '工号': 'studentId', 'student_id': 'studentId', 'studentid': 'studentId', 'id': 'studentId',
        '手机号': 'phone', '电话': 'phone', 'phone': 'phone', 'mobile': 'phone',
        '部门': 'department', '班级': 'department', '所属部门': 'department', 'department': 'department', 'class': 'department'
      };

      const mappedHeaders = headers.map(h => {
        const lower = h.trim().toLowerCase();
        return headerMap[lower] || headerMap[h.trim()] || null;
      });

      // 检查必要列
      const hasName = mappedHeaders.includes('name');
      const hasStudentId = mappedHeaders.includes('studentId');
      if (!hasName || !hasStudentId) {
        return res.json({ success: false, message: 'CSV文件必须包含"姓名"和"学号/工号"列' });
      }

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        mappedHeaders.forEach((key, idx) => {
          if (key) row[key] = values[idx] ? values[idx].trim() : '';
        });
        row._line = i + 1; // 原始行号（含标题行）
        rows.push(row);
      }
    } else {
      // Excel (.xlsx/.xls) 需要额外库，这里提示使用 CSV
      return res.json({ success: false, message: '当前版本仅支持CSV文件格式，请将Excel另存为CSV后上传' });
    }
  } catch (err) {
    return res.json({ success: false, message: `文件解析失败：${err.message}` });
  }

  // 数据校验与批量插入
  const results = { success: 0, failed: 0, total: rows.length, errors: [] };
  const existingUsers = db.prepare('SELECT username FROM users').all().map(u => u.username);

  const insertStmt = db.prepare(
    'INSERT INTO users (id, username, password, name, department, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const lineNum = row._line;
      // 必填校验
      if (!row.name) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.studentId || '未知', error: '姓名为空' });
        continue;
      }
      if (!row.studentId) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.name, error: '学号/工号为空' });
        continue;
      }

      // 学号格式校验（仅允许字母数字）
      if (!/^[\w]+$/.test(row.studentId)) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.name, error: `学号格式异常：${row.studentId}（仅允许字母数字下划线）` });
        continue;
      }

      // 重复检测
      if (existingUsers.includes(row.studentId)) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.name, error: `学号 ${row.studentId} 已存在` });
        continue;
      }

      // 手机号格式校验（可选字段，如果填写了就验证）
      if (row.phone && !/^1[3-9]\d{9}$/.test(row.phone)) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.name, error: `手机号格式异常：${row.phone}` });
        continue;
      }

      // 密码默认为学号
      const hashedPw = bcrypt.hashSync(row.studentId, 10);
      const id = uuidv4();

      try {
        insertStmt.run(id, row.studentId, hashedPw, row.name, row.department || '', row.phone || '', 'user');
        existingUsers.push(row.studentId); // 防止文件内重复
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ line: lineNum, name: row.name, error: `数据库写入失败：${err.message}` });
      }
    }
  });

  insertMany(rows);

  // 记录操作日志
  logOperation(adminId, 'batch_register', 'user', 'batch', {
    total: results.total, success: results.success, failed: results.failed,
    file: fileName
  });

  res.json({ success: true, results });
});

// CSV行解析（处理逗号分隔和引号包裹）
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ========== 教室API ==========

// 获取教室列表
app.get('/api/classrooms', (req, res) => {
  const { building, capacity, equipment } = req.query;
  let query = 'SELECT * FROM classrooms WHERE 1=1';
  const params = [];
  if (building) { query += ' AND building = ?'; params.push(building); }
  if (capacity) { query += ' AND capacity >= ?'; params.push(parseInt(capacity)); }
  if (equipment) {
    const equipList = equipment.split(',');
    for (const eq of equipList) {
      query += ' AND equipment LIKE ?';
      params.push(`%${eq}%`);
    }
  }
  query += ' ORDER BY building, floor, name';
  const classrooms = db.prepare(query).all(...params);
  res.json({ success: true, classrooms });
});

// 获取单个教室详情
app.get('/api/classrooms/:id', (req, res) => {
  const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
  if (!classroom) return res.json({ success: false, message: '教室不存在' });
  res.json({ success: true, classroom });
});

// 获取教室某日的已预约时段
app.get('/api/classrooms/:id/schedule', (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ success: false, message: '缺少日期参数' });
  const bookings = db.prepare(
    `SELECT b.*, u.name as user_name FROM bookings b JOIN users u ON b.user_id = u.id
     WHERE b.classroom_id = ? AND b.date = ? AND b.status != 'rejected' AND b.status != 'cancelled'
     ORDER BY b.start_time`
  ).all(req.params.id, date);
  res.json({ success: true, bookings });
});

// 新增教室 (管理员)
app.post('/api/classrooms', (req, res) => {
  const { name, building, floor, capacity, equipment, notes, adminId } = req.body;
  if (!name || !building || !floor || !capacity) {
    return res.json({ success: false, message: '必填信息缺失' });
  }
  const id = uuidv4();
  db.prepare('INSERT INTO classrooms (id, name, building, floor, capacity, equipment, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, name, building, floor, capacity, equipment || '', notes || ''
  );
  logOperation(adminId, 'create_classroom', 'classroom', id, { name, building, floor, capacity, equipment, notes });
  res.json({ success: true, classroom: { id, name, building, floor, capacity, equipment, notes } });
});

// 修改教室 (管理员)
app.put('/api/classrooms/:id', (req, res) => {
  const { name, building, floor, capacity, equipment, notes, adminId } = req.body;
  const old = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
  if (!old) return res.json({ success: false, message: '教室不存在' });
  db.prepare('UPDATE classrooms SET name=?, building=?, floor=?, capacity=?, equipment=?, notes=? WHERE id=?').run(
    name || old.name, building || old.building, floor || old.floor, capacity || old.capacity,
    equipment || old.equipment, notes || old.notes, req.params.id
  );
  logOperation(adminId, 'update_classroom', 'classroom', req.params.id, { old, new: { name, building, floor, capacity, equipment, notes } });
  res.json({ success: true });
});

// 删除教室 (管理员)
app.delete('/api/classrooms/:id', (req, res) => {
  const { adminId } = req.body;
  const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
  if (!classroom) return res.json({ success: false, message: '教室不存在' });
  // 检查是否有未完成的预约
  const activeBookings = db.prepare(
    `SELECT COUNT(*) as count FROM bookings WHERE classroom_id = ? AND status IN ('pending', 'approved')`
  ).get(req.params.id);
  if (activeBookings.count > 0) {
    return res.json({ success: false, message: '该教室存在未完成的预约，无法删除' });
  }
  db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);
  logOperation(adminId, 'delete_classroom', 'classroom', req.params.id, { classroom });
  res.json({ success: true });
});

// ========== 预约API ==========

// 提交预约申请
app.post('/api/bookings', (req, res) => {
  const { userId, classroomId, borrowerName, department, phone, purpose, expectedCount, notes, date, startTime, endTime } = req.body;

  // 前端校验
  if (!userId || !classroomId || !borrowerName || !department || !phone || !purpose || !expectedCount || !date || !startTime || !endTime) {
    return res.json({ success: false, message: '必填信息缺失' });
  }
  if (startTime >= endTime) {
    return res.json({ success: false, message: '结束时间必须大于开始时间' });
  }
  if (startTime < 8 || endTime > 22) {
    return res.json({ success: false, message: '预约时段须在8:00-22:00之间' });
  }

  // 冲突检测
  const conflicts = checkConflict(classroomId, date, startTime, endTime);
  if (conflicts.length > 0) {
    const conflictInfo = conflicts.map(c => `${c.start_time}:00-${c.end_time}:00 (${c.borrower_name})`).join(', ');
    return res.json({ success: false, message: `时段冲突，以下时段已被预约：${conflictInfo}` });
  }

  // 容量检查
  const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(classroomId);
  if (expectedCount > classroom.capacity) {
    return res.json({ success: false, message: `预计人数(${expectedCount})超过教室容量(${classroom.capacity})` });
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO bookings (id, user_id, classroom_id, borrower_name, department, phone, purpose, expected_count, notes, date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(id, userId, classroomId, borrowerName, department, phone, purpose, expectedCount, notes || '', date, startTime, endTime);

  logOperation(userId, 'create_booking', 'booking', id, { classroomId, date, startTime, endTime });

  // 通知所有管理员
  const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin');
  for (const admin of admins) {
    createNotification(admin.id, id, '新预约申请', `${borrowerName} 申请借用 ${classroom.name}（${date} ${startTime}:00-${endTime}:00），用途：${purpose}`);
  }

  res.json({ success: true, bookingId: id });
});

// 获取用户申请记录
app.get('/api/bookings/user/:userId', (req, res) => {
  const { status, startDate, endDate } = req.query;
  let query = `SELECT b.*, c.name as classroom_name, c.building, c.capacity FROM bookings b JOIN classrooms c ON b.classroom_id = c.id WHERE b.user_id = ?`;
  const params = [req.params.userId];
  if (status) { query += ' AND b.status = ?'; params.push(status); }
  if (startDate) { query += ' AND b.date >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND b.date <= ?'; params.push(endDate); }
  query += ' ORDER BY b.date DESC, b.start_time';
  const bookings = db.prepare(query).all(...params);
  res.json({ success: true, bookings });
});

// 获取所有预约 (管理员)
app.get('/api/bookings', (req, res) => {
  const { status, classroomId, startDate, endDate } = req.query;
  let query = `SELECT b.*, c.name as classroom_name, c.building, c.capacity, u.name as user_name FROM bookings b JOIN classrooms c ON b.classroom_id = c.id JOIN users u ON b.user_id = u.id`;
  const params = [];
  let hasWhere = false;
  if (status) { query += hasWhere ? ' AND' : ' WHERE'; query += ' b.status = ?'; params.push(status); hasWhere = true; }
  if (classroomId) { query += hasWhere ? ' AND' : ' WHERE'; query += ' b.classroom_id = ?'; params.push(classroomId); hasWhere = true; }
  if (startDate) { query += hasWhere ? ' AND' : ' WHERE'; query += ' b.date >= ?'; params.push(startDate); hasWhere = true; }
  if (endDate) { query += hasWhere ? ' AND' : ' WHERE'; query += ' b.date <= ?'; params.push(endDate); hasWhere = true; }
  query += ' ORDER BY b.date DESC, b.start_time';
  const bookings = db.prepare(query).all(...params);
  res.json({ success: true, bookings });
});

// 获取单条预约详情
app.get('/api/bookings/:id', (req, res) => {
  const booking = db.prepare(
    `SELECT b.*, c.name as classroom_name, c.building, c.capacity, c.equipment, u.name as user_name FROM bookings b JOIN classrooms c ON b.classroom_id = c.id JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).get(req.params.id);
  if (!booking) return res.json({ success: false, message: '预约不存在' });
  res.json({ success: true, booking });
});

// 审批预约 (管理员)
app.post('/api/bookings/:id/approve', (req, res) => {
  const { adminId, action, reason } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.json({ success: false, message: '预约不存在' });
  if (booking.status !== 'pending') return res.json({ success: false, message: '该预约已被处理' });

  if (action === 'approve') {
    // 审批通过前再次做冲突检测
    const conflicts = checkConflict(booking.classroom_id, booking.date, booking.start_time, booking.end_time, booking.id);
    if (conflicts.length > 0) {
      const conflictInfo = conflicts.map(c => `${c.start_time}:00-${c.end_time}:00 (${c.borrower_name})`).join(', ');
      return res.json({ success: false, message: `时段冲突，以下时段已被预约：${conflictInfo}` });
    }
    db.prepare('UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('approved', req.params.id);
  } else if (action === 'reject') {
    if (!reason) return res.json({ success: false, message: '拒绝预约必须填写理由' });
    db.prepare('UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('rejected', req.params.id);
  }

  // 记录审批日志
  db.prepare(
    `INSERT INTO approval_logs (id, booking_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), req.params.id, adminId, action, reason || '');

  logOperation(adminId, `approve_${action}`, 'booking', req.params.id, { action, reason });

  // 通知用户
  const statusText = action === 'approve' ? '已通过' : '已被拒绝';
  const classroom = db.prepare('SELECT name FROM classrooms WHERE id = ?').get(booking.classroom_id);
  createNotification(booking.user_id, req.params.id,
    `预约${statusText}`,
    `您申请借用 ${classroom.name}（${booking.date} ${booking.start_time}:00-${booking.end_time}:00）的预约${statusText}。${action === 'reject' ? `拒绝理由：${reason}` : ''}`
  );

  res.json({ success: true });
});

// 管理员修改预约（更换教室/调整时段）
app.put('/api/bookings/:id/modify', (req, res) => {
  const { adminId, classroomId, date, startTime, endTime } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.json({ success: false, message: '预约不存在' });
  if (booking.status !== 'approved') return res.json({ success: false, message: '只能修改已通过的预约' });

  const newClassroomId = classroomId || booking.classroom_id;
  const newDate = date || booking.date;
  const newStartTime = startTime || booking.start_time;
  const newEndTime = endTime || booking.end_time;

  // 冲突检测
  const conflicts = checkConflict(newClassroomId, newDate, newStartTime, newEndTime, req.params.id);
  if (conflicts.length > 0) {
    const conflictInfo = conflicts.map(c => `${c.start_time}:00-${c.end_time}:00 (${c.borrower_name})`).join(', ');
    return res.json({ success: false, message: `时段冲突，以下时段已被预约：${conflictInfo}` });
  }

  const oldValues = { classroom_id: booking.classroom_id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time };
  db.prepare('UPDATE bookings SET classroom_id=?, date=?, start_time=?, end_time=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    newClassroomId, newDate, newStartTime, newEndTime, req.params.id
  );

  db.prepare(
    `INSERT INTO approval_logs (id, booking_id, admin_id, action, reason, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), req.params.id, adminId, 'modify', '', JSON.stringify(oldValues), JSON.stringify({ classroom_id: newClassroomId, date: newDate, start_time: newStartTime, end_time: newEndTime }));

  logOperation(adminId, 'modify_booking', 'booking', req.params.id, { oldValues, newValues: { classroom_id: newClassroomId, date: newDate, start_time: newStartTime, end_time: newEndTime } });

  const classroom = db.prepare('SELECT name FROM classrooms WHERE id = ?').get(newClassroomId);
  createNotification(booking.user_id, req.params.id,
    '预约已调整',
    `您的借用预约已被管理员调整：${classroom.name}（${newDate} ${newStartTime}:00-${newEndTime}:00），请留意时间变更。`
  );

  res.json({ success: true });
});

// 取消预约 (管理员)
app.post('/api/bookings/:id/cancel', (req, res) => {
  const { adminId, reason } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.json({ success: false, message: '预约不存在' });

  db.prepare('UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', req.params.id);

  db.prepare(
    `INSERT INTO approval_logs (id, booking_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), req.params.id, adminId, 'cancel', reason || '');

  logOperation(adminId, 'cancel_booking', 'booking', req.params.id, { reason });

  const classroom = db.prepare('SELECT name FROM classrooms WHERE id = ?').get(booking.classroom_id);
  createNotification(booking.user_id, req.params.id,
    '预约已取消',
    `您借用 ${classroom.name}（${booking.date} ${booking.start_time}:00-${booking.end_time}:00）的预约已被管理员取消。${reason ? `原因：${reason}` : ''}`
  );

  res.json({ success: true });
});

// 用户取消自己的预约
app.post('/api/bookings/:id/user-cancel', (req, res) => {
  const { userId } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.json({ success: false, message: '预约不存在' });
  if (booking.user_id !== userId) return res.json({ success: false, message: '无权操作' });
  if (booking.status === 'cancelled' || booking.status === 'rejected') return res.json({ success: false, message: '预约已取消或已拒绝' });

  db.prepare('UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', req.params.id);
  logOperation(userId, 'user_cancel_booking', 'booking', req.params.id, null);

  const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin');
  const classroom = db.prepare('SELECT name FROM classrooms WHERE id = ?').get(booking.classroom_id);
  for (const admin of admins) {
    createNotification(admin.id, req.params.id, '用户取消预约', `${booking.borrower_name} 已取消借用 ${classroom.name}（${booking.date} ${booking.start_time}:00-${booking.end_time}:00）的预约`);
  }

  res.json({ success: true });
});

// ========== 通知API ==========

// 获取用户通知
app.get('/api/notifications/:userId', (req, res) => {
  const notifications = db.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).all(req.params.userId);
  res.json({ success: true, notifications });
});

// 标记通知已读
app.post('/api/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 获取未读通知数量
app.get('/api/notifications/:userId/unread-count', (req, res) => {
  const result = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(req.params.userId);
  res.json({ success: true, count: result.count });
});

// ========== 甘特图/日历数据API ==========

// 获取指定日期范围的预约视图数据
app.get('/api/schedule-overview', (req, res) => {
  const { startDate, endDate, classroomId } = req.query;
  let query = `SELECT b.*, c.name as classroom_name, c.building, c.capacity FROM bookings b JOIN classrooms c ON b.classroom_id = c.id WHERE b.status != 'rejected' AND b.status != 'cancelled'`;
  const params = [];
  if (startDate) { query += ' AND b.date >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND b.date <= ?'; params.push(endDate); }
  if (classroomId) { query += ' AND b.classroom_id = ?'; params.push(classroomId); }
  query += ' ORDER BY c.name, b.date, b.start_time';
  const bookings = db.prepare(query).all(...params);

  // 获取所有教室
  const classrooms = db.prepare('SELECT * FROM classrooms ORDER BY building, floor, name').all();

  res.json({ success: true, bookings, classrooms });
});

// ========== 操作日志API ==========

app.get('/api/logs', (req, res) => {
  const { targetType, limit = 100 } = req.query;
  let query = `SELECT ol.*, u.name as user_name FROM operation_logs ol JOIN users u ON ol.user_id = u.id`;
  const params = [];
  if (targetType) { query += ' WHERE ol.target_type = ?'; params.push(targetType); }
  query += ` ORDER BY ol.created_at DESC LIMIT ?`;
  params.push(parseInt(limit));
  const logs = db.prepare(query).all(...params);
  res.json({ success: true, logs });
});

// ========== 审批日志API ==========

app.get('/api/approval-logs/:bookingId', (req, res) => {
  const logs = db.prepare(
    `SELECT al.*, u.name as admin_name FROM approval_logs al JOIN users u ON al.admin_id = u.id WHERE al.booking_id = ? ORDER BY al.created_at`
  ).all(req.params.bookingId);
  res.json({ success: true, logs });
});

// ========== 获取所有楼栋列表 ==========
app.get('/api/buildings', (req, res) => {
  const buildings = db.prepare('SELECT DISTINCT building FROM classrooms ORDER BY building').all();
  res.json({ success: true, buildings: buildings.map(b => b.building) });
});

// ========== 获取设备标签列表 ==========
app.get('/api/equipment-tags', (req, res) => {
  const classrooms = db.prepare("SELECT equipment FROM classrooms WHERE equipment IS NOT NULL AND equipment != ''").all();
  const allTags = new Set();
  for (const c of classrooms) {
    c.equipment.split(',').forEach(tag => { if (tag.trim()) allTags.add(tag.trim()); });
  }
  res.json({ success: true, tags: Array.from(allTags).sort() });
});

// 页面路由
app.get('/user', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.listen(PORT, () => {
  console.log(`新闻院教室借用管理系统已启动: http://localhost:${PORT}`);
  console.log(`用户端入口: http://localhost:${PORT}/user`);
  console.log(`管理员端入口: http://localhost:${PORT}/admin`);
});
