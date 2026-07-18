'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db-init');

const PORT = process.env.PORT || 80;
const SEC = process.env.JWT_SECRET;
if (!SEC) { console.error('FATAL: JWT_SECRET environment variable is required'); process.exit(1); }
const CK = 'cp_token';
const PUBLIC = path.join(__dirname, 'public');
fs.existsSync(PUBLIC) || fs.mkdirSync(PUBLIC, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(PUBLIC));

// No-cache for HTML pages (prevent stale auth state after logout)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// ─── Rate Limiter ───
const rateLimitStore = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimitStore.set(key, entry);
  return entry.count <= max;
}
// Clean old entries every 10 minutes
setInterval(() => { const n = Date.now(); for (const [k, v] of rateLimitStore) { if (n > v.reset) rateLimitStore.delete(k); } }, 600000);

// ─── Auth ───
function setToken(res, teacher) {
  const token = jwt.sign({ id: teacher.id, role: teacher.role, institution_id: teacher.institution_id }, SEC, { expiresIn: '7d' });
  res.cookie(CK, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 * 1000 });
  return token;
}

function needAuth(req, res, next) {
  const token = req.cookies[CK] || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const d = jwt.verify(token, SEC);
    const t = db.getTeacherById(d.id);
    if (!t) return res.status(401).json({ error: '用户不存在' });
    req.user = { id: t.id, phone: t.phone, name: t.name, role: t.role, institution_id: t.institution_id, institution_name: t.institution_name };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录过期，请重新登录' });
  }
}

function needSchoolAdmin(req, res, next) {
  if (!req.user.institution_id) return res.status(400).json({ error: '请先创建学校' });
  if (req.user.role !== 'school_admin') return res.status(403).json({ error: '仅校长/管理员可操作' });
  next();
}

function needClassOwner(req, res, next) {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  // 校长可以管本校所有班级
  if (req.user.role === 'school_admin' && c.institution_id === req.user.institution_id) {
    req.classObj = c; return next();
  }
  if (c.teacher_id !== req.user.id) return res.status(403).json({ error: '无权操作此班级' });
  req.classObj = c; next();
}

// ─── API ───
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 注册
app.post('/api/register', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit('reg_' + ip, 3, 60000)) return res.status(429).json({ error: '注册太频繁，请1分钟后再试' });
    const { phone, password, name } = req.body || {};
    if (!phone || !password) return res.status(400).json({ error: '手机号和密码必填' });
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    if (db.getTeacherByPhone(phone)) return res.status(409).json({ error: '该手机号已注册' });
    const hash = await bcrypt.hash(password, 10);
    const r = db.createTeacher(phone, hash, name || '老师');
    const tid = r.lastInsertRowid;
    const t = { id: tid, phone, name: name || '老师', role: 'teacher', institution_id: null };

    // Auto-create demo class with pre-leveled pets so garden looks alive day one
    const demoClass = db.createClass(tid, null, '我的班级');
    const demoStudents = [
      { name: '小明', pet: 'cat', scores: 7, reasons: ['午饭吃光光','主动帮助同学','积极举手'] },
      { name: '小红', pet: 'rabbit', scores: 5, reasons: ['午睡安静','排队整齐'] },
      { name: '小刚', pet: 'dog', scores: 6, reasons: ['认真做操','玩具分享','上课认真'] },
      { name: '小丽', pet: 'panda', scores: 8, reasons: ['主动打招呼','画画很认真','从不挑食'] },
      { name: '小宇', pet: 'chick', scores: 4, reasons: ['安静看书','坐姿端正'] },
      { name: '小美', pet: 'hamster', scores: 5, reasons: ['帮老师发本子','唱歌好听'] },
    ];
    const students = demoStudents.map(s => db.addStudent(demoClass.id, s.name, s.pet));
    students.forEach((s, i) => {
      const reasons = demoStudents[i].reasons;
      for (let j = 0; j < demoStudents[i].scores; j++) {
        db.addScore(s.id, 1, reasons[j % reasons.length], tid);
      }
    });

    setToken(res, t);
    res.json({
      ok: true,
      teacher: { id: t.id, phone, name: t.name, role: 'teacher' },
      demo_class: { id: demoClass.id, name: demoClass.name, invite_code: demoClass.invite_code },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 登录
app.post('/api/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit('login_' + ip, 10, 60000)) return res.status(429).json({ error: '登录尝试太频繁，请1分钟后再试' });
    const { phone, password } = req.body || {};
    if (!phone || !password) return res.status(400).json({ error: '手机号和密码必填' });
    const t = db.getTeacherByPhone(phone);
    if (!t) return res.status(401).json({ error: '手机号未注册' });
    if (!await bcrypt.compare(password, t.password)) return res.status(401).json({ error: '密码错误' });
    setToken(res, t);
    const inst = t.institution_id ? db.getInstitutionById(t.institution_id) : null;
    res.json({ ok: true, teacher: { id: t.id, phone: t.phone, name: t.name, role: t.role }, institution: inst });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => { res.clearCookie(CK, { httpOnly: true, sameSite: 'lax', path: '/' }); res.json({ ok: true }); });

app.get('/api/me', needAuth, (req, res) => {
  res.json({ teacher: { id: req.user.id, phone: req.user.phone, name: req.user.name, role: req.user.role, institution_name: req.user.institution_name }, institution_id: req.user.institution_id });
});

app.put('/api/me', needAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '名称必填' });
  db.updateTeacher(req.user.id, { name: name.trim() });
  req.user.name = name.trim();
  res.json({ ok: true, teacher: req.user });
});

// ─── 学校/机构 ───
app.post('/api/institution', needAuth, (req, res) => {
  if (req.user.institution_id) return res.status(400).json({ error: '您已有所属学校，不能重复创建' });
  const { name, province, city, address, contact_name, contact_phone } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '学校名称必填' });
  const inst = db.createInstitution(name.trim(), province, city, address, contact_name, contact_phone);
  db.setTeacherInstitution(req.user.id, inst.id, 'school_admin');
  req.user.role = 'school_admin';
  req.user.institution_id = inst.id;
  req.user.institution_name = inst.name;
  setToken(res, req.user);
  res.json({ ok: true, institution: inst });
});

app.get('/api/institution', needAuth, (req, res) => {
  if (!req.user.institution_id) return res.json({ institution: null });
  const inst = db.getInstitutionById(req.user.institution_id);
  const stats = db.getInstitutionStats(req.user.institution_id);
  const teachers = req.user.role === 'school_admin' ? db.getInstitutionTeachers(req.user.institution_id) : null;
  const classes = req.user.role === 'school_admin' ? db.getInstitutionClasses(req.user.institution_id) : null;
  res.json({ institution: inst, stats, teachers, classes });
});

app.put('/api/institution', needAuth, needSchoolAdmin, (req, res) => {
  db.updateInstitution(req.user.institution_id, req.body);
  res.json({ ok: true, institution: db.getInstitutionById(req.user.institution_id) });
});

// 校长邀请老师加入学校
app.post('/api/institution/teachers', needAuth, needSchoolAdmin, (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: '请输入要邀请的老师的手机号' });
  const t = db.getTeacherByPhone(phone);
  if (!t) return res.status(404).json({ error: '该手机号未注册，请先让老师注册' });
  if (t.institution_id) return res.status(400).json({ error: '该老师已有所属学校' + (t.institution_id === req.user.institution_id ? '' : '') });
  db.setTeacherInstitution(t.id, req.user.institution_id, 'teacher');
  res.json({ ok: true, teacher: { id: t.id, name: t.name, phone: t.phone } });
});

// 校长移除老师
app.delete('/api/institution/teachers/:teacherId', needAuth, needSchoolAdmin, (req, res) => {
  const tid = parseInt(req.params.teacherId);
  const t = db.getTeacherById(tid);
  if (!t || t.institution_id !== req.user.institution_id) return res.status(404).json({ error: '老师不在本校' });
  if (t.role === 'school_admin') return res.status(400).json({ error: '不能移除校长' });
  db.setTeacherInstitution(tid, null, 'teacher');
  res.json({ ok: true });
});

// ─── 班级 ───
app.get('/api/classes', needAuth, (req, res) => {
  // 校长看全校班级，普通老师看自己的
  if (req.user.role === 'school_admin') {
    const classes = db.getInstitutionClasses(req.user.institution_id);
    return res.json({ classes });
  }
  res.json({ classes: db.getTeacherClasses(req.user.id) });
});

app.post('/api/classes', needAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '班级名称必填' });
  const c = db.createClass(req.user.id, req.user.institution_id, name.trim());
  res.json({ ok: true, class: c });
});

app.put('/api/classes/:classId', needAuth, needClassOwner, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '班级名称必填' });
  db.updateClass(req.classObj.id, name.trim());
  res.json({ ok: true, class: db.getClassById(req.classObj.id) });
});

app.get('/api/classes/:classId/history', needAuth, needClassOwner, (req, res) => {
  res.json({ history: db.getClassScoreHistory(req.classObj.id, 100) });
});

// ─── 学生 ───
app.get('/api/classes/:classId/students', needAuth, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  // 权限：本人or本校校长
  if (c.teacher_id !== req.user.id && !(req.user.role === 'school_admin' && c.institution_id === req.user.institution_id)) {
    return res.status(403).json({ error: '无权查看此班级' });
  }
  res.json({ class: c, students: db.getClassStudents(c.id) });
});

app.post('/api/classes/:classId/students', needAuth, needClassOwner, (req, res) => {
  const { name, pet_type } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '学生姓名必填' });
  res.json({ ok: true, student: db.addStudent(req.classObj.id, name.trim(), pet_type) });
});

app.put('/api/classes/:classId/students/:studentId', needAuth, needClassOwner, (req, res) => {
  const { name, pet_type } = req.body || {};
  if (!name?.trim() && !pet_type) return res.status(400).json({ error: '至少修改一项' });
  db.updateStudent(parseInt(req.params.studentId), name?.trim(), pet_type);
  res.json({ ok: true, student: db.getStudentById(parseInt(req.params.studentId)) });
});

app.delete('/api/classes/:classId/students/:studentId', needAuth, needClassOwner, (req, res) => {
  const sid = parseInt(req.params.studentId);
  const s = db.getStudentById(sid);
  if (!s || s.class_id !== req.classObj.id) return res.status(404).json({ error: '学生不在该班级' });
  db.deleteStudent(sid);
  res.json({ ok: true });
});

app.get('/api/classes/:classId/students/:studentId/detail', needAuth, needClassOwner, (req, res) => {
  res.json(db.studentDetail(parseInt(req.params.studentId)));
});

// ─── 积分 ───
app.post('/api/classes/:classId/scores', needAuth, needClassOwner, (req, res) => {
  try {
    const { scores } = req.body || {};
    if (!Array.isArray(scores) || scores.length === 0) return res.status(400).json({ error: '请选择要加分的学生' });
    const tx = db.db.transaction(() => {
      scores.forEach(s => {
        if (s.student_id && s.points > 0) {
          db.addScore(parseInt(s.student_id), parseInt(s.points), s.reason || '表现优秀', req.user.id);
        }
      });
    });
    tx();
    res.json({ ok: true, count: scores.length });
  } catch(e) {
    console.error('Score error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/classes/:classId/today', needAuth, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  if (c.teacher_id !== req.user.id && !(req.user.role === 'school_admin' && c.institution_id === req.user.institution_id)) {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json({ logs: db.getClassTodayLogs(c.id) });
});

// ─── 花园 & 家长（班级码鉴权 + 学生归属校验） ───
app.get('/api/garden/:code', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  const modeRow = db.db.prepare('SELECT value FROM meta WHERE key = ?').get('class_mode_' + c.id);
  res.json({ class: c, garden: db.gardenData(c.id), today_logs: db.getClassTodayLogs(c.id), mode: (modeRow?.value || 'active') });
});

// ─── 课堂模式开关（老师用） ───
app.get('/api/classes/:classId/mode', needAuth, needClassOwner, (req, res) => {
  const row = db.db.prepare('SELECT value FROM meta WHERE key = ?').get('class_mode_' + req.classObj.id);
  res.json({ mode: row?.value || 'active' });
});
app.post('/api/classes/:classId/mode', needAuth, needClassOwner, (req, res) => {
  const mode = req.body?.mode === 'quiet' ? 'quiet' : 'active';
  db.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('class_mode_' + req.classObj.id, mode);
  res.json({ ok: true, mode });
});

app.get('/api/student/:code/:studentId', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  const sid = parseInt(req.params.studentId);
  const s = db.getStudentById(sid);
  if (!s || s.class_id !== c.id) return res.status(404).json({ error: '学生不存在' });
  const detail = db.studentDetail(sid);
  res.json(detail);
});

app.post('/api/student/:code/:studentId/buy', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  const sid = parseInt(req.params.studentId);
  const s = db.getStudentById(sid);
  if (!s || s.class_id !== c.id) return res.status(404).json({ error: '学生不存在' });
  const { item_key, item_name, category, cost } = req.body || {};
  if (!item_key || !cost) return res.status(400).json({ error: '参数不完整' });
  // Daily feeding limit: max 3 food purchases per day
  const today = new Date().toISOString().slice(0, 10);
  const todayBuys = (db.db.prepare("SELECT COUNT(*) as cnt FROM shop_purchases WHERE student_id=? AND category='food' AND date=?").get(sid, today)?.cnt || 0);
  if (todayBuys >= 3 && category === 'food') return res.status(400).json({ error: '今天已经喂了3次啦，明天再喂吧！🥰' });
  const result = db.shopBuy(sid, item_key, item_name, category, parseInt(cost));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, student: db.studentDetail(sid) });
});

// ─── 页面 ───
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC, 'login.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(PUBLIC, 'demo.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC, 'teacher.html')));
app.get('/school', (req, res) => res.sendFile(path.join(PUBLIC, 'school.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/print', (req, res) => res.sendFile(path.join(PUBLIC, 'print.html')));
app.get('/screen/:code', (req, res) => res.sendFile(path.join(PUBLIC, 'screen.html')));
app.get('/parent/:code/:studentId', (req, res) => res.sendFile(path.join(PUBLIC, 'parent.html')));

// ─── 运维状态 API ───
app.get('/api/status', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  let tunnelUrl = '';
  try { tunnelUrl = fs.readFileSync(path.join(PUBLIC, 'tunnel.txt'), 'utf8').trim(); } catch {}
  const teacherCount = db.db.prepare('SELECT COUNT(*) as cnt FROM teachers').get().cnt;
  const classCount = db.db.prepare('SELECT COUNT(*) as cnt FROM classes').get().cnt;
  const studentCount = db.db.prepare('SELECT COUNT(*) as cnt FROM students').get().cnt;
  res.json({
    ok: true,
    uptime: process.uptime(),
    tunnel: tunnelUrl,
    stats: { teachers: teacherCount, classes: classCount, students: studentCount },
    node: process.version
  });
});

app.listen(PORT, () => console.log(`ClassPet v3 running on port ${PORT}`));
