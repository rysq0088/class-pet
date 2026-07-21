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
      { name: '小明', pet: 'cat', scores: 3, reasons: ['午饭吃光光','主动帮助同学','积极举手'] },
      { name: '小红', pet: 'rabbit', scores: 15, reasons: ['午睡安静','排队整齐','上课认真','画画好看','故事大王','帮忙收玩具','主动捡垃圾','坐姿超端正'] },
      { name: '小刚', pet: 'dog', scores: 8, reasons: ['认真做操','玩具分享','上课认真'] },
      { name: '小丽', pet: 'panda', scores: 55, reasons: ['主动打招呼','画画很认真','从不挑食','值日最干净','帮助小朋友'] },
      { name: '小宇', pet: 'chick', scores: 25, reasons: ['安静看书','坐姿端正','排队最快','午睡不吵闹'] },
      { name: '小美', pet: 'hamster', scores: 120, reasons: ['帮老师发本子','唱歌好听','跳绳第一名','作业最工整','从不迟到'] },
      { name: '小杰', pet: 'dog', scores: 45, reasons: ['跑步第一','帮助同学','举旗手','打扫最认真'] },
      { name: '小兰', pet: 'fox', scores: 85, reasons: ['讲故事好听','作业整齐','画画得奖','不挑食'] },
      { name: '小涛', pet: 'turtle', scores: 200, reasons: ['慢慢写好字','不着急','坚持不放弃','进步最大'] },
      { name: '小悦', pet: 'panda', scores: 10, reasons: ['值日认真','爱护花草'] },
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
  // Free tier: limit to 1 class
  const t = db.db.prepare('SELECT premium, premium_expires FROM teachers WHERE id=?').get(req.user.id);
  const isPremium = t && t.premium === 1 && (!t.premium_expires || new Date(t.premium_expires) > new Date());
  if (!isPremium) {
    const classes = db.getTeacherClasses(req.user.id);
    if (classes.length >= 1) return res.status(403).json({ error: '免费版仅限1个班级，请升级 www.classpet.site/pricing 查看' });
  }
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
        if (s.student_id && s.points !== 0) {
          const absP = Math.abs(parseInt(s.points));
          const reason = s.reason || (s.points > 0 ? '表现优秀' : '需要改进');
          // Prevent score going too negative
          const student = db.getStudentById(parseInt(s.student_id));
          if (student && s.points < 0 && student.score + parseInt(s.points) < -50) {
            throw new Error(student.name + '积分已到-50下限');
          }
          db.addScoreWithReason(parseInt(s.student_id), parseInt(s.points), reason, req.user.id);
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
  const ranking = db.db.prepare("SELECT s.id, s.name, s.pet_type, s.score, s.pet_exp FROM students s WHERE s.class_id = ? ORDER BY s.score DESC").all(c.id);
  const group_ranking = db.db.prepare("SELECT g.id, g.name, COALESCE(SUM(s.score),0) as total_score, COUNT(sg.student_id) as member_count FROM groups_table g LEFT JOIN student_groups sg ON sg.group_id = g.id LEFT JOIN students s ON s.id = sg.student_id WHERE g.class_id = ? GROUP BY g.id ORDER BY total_score DESC").all(c.id);
  const pickerRow = db.db.prepare("SELECT value FROM meta WHERE key = ?").get('class_picker_' + c.id);
  res.json({ class: c, garden: db.gardenData(c.id), today_logs: db.getClassTodayLogs(c.id), mode: (modeRow && modeRow.value || 'active'), ranking, group_ranking, picker: pickerRow ? JSON.parse(pickerRow.value) : null });
});

// ─── 课堂模式开关（老师用） ───
app.get('/api/classes/:classId/mode', needAuth, needClassOwner, (req, res) => {
  const row = db.db.prepare('SELECT value FROM meta WHERE key = ?').get('class_mode_' + req.classObj.id);
  res.json({ mode: row?.value || 'active' });
});
app.post('/api/classes/:classId/mode', needAuth, needClassOwner, (req, res) => {
  const m = req.body?.mode; const mode = (m === 'quiet' || m === 'exam') ? m : 'active';
  db.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('class_mode_' + req.classObj.id, mode);
  res.json({ ok: true, mode });
});

// 随机点名控制
app.post('/api/classes/:classId/picker', needAuth, needClassOwner, (req, res) => {
  const { action, student_ids } = req.body || {};
  if (action === 'start' && Array.isArray(student_ids) && student_ids.length > 0) {
    db.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'class_picker_' + req.classObj.id,
      JSON.stringify({ active: true, student_ids, seed: Date.now() })
    );
    res.json({ ok: true });
  } else if (action === 'stop') {
    db.db.prepare('DELETE FROM meta WHERE key = ?').run('class_picker_' + req.classObj.id);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: '参数不完整' });
  }
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
  const todayBuys = (db.db.prepare("SELECT COUNT(*) as cnt FROM purchases WHERE student_id=? AND category='food' AND purchased_at LIKE ?").get(sid, today + '%')?.cnt || 0);
  if (category === 'food' && todayBuys >= 3) return res.status(400).json({ error: '今天已经喂了3次啦，明天再喂吧！🥰' });
  const result = db.shopBuy(sid, item_key, item_name, category, parseInt(cost));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, student: db.studentDetail(sid) });
});

// ─── 页面 ───
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC, 'login.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(PUBLIC, 'pricing.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(PUBLIC, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(PUBLIC, 'privacy.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(PUBLIC, 'demo.html')));
app.get('/pet-zone', (req,res) => res.sendFile(path.join(PUBLIC, 'pet-zone.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC, 'teacher.html')));
app.get('/school', (req, res) => res.sendFile(path.join(PUBLIC, 'school.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/print', (req, res) => res.sendFile(path.join(PUBLIC, 'print.html')));
app.get('/screen/:code', (req, res) => res.sendFile(path.join(PUBLIC, 'screen.html')));
app.get('/parent/:code/:studentId', (req, res) => res.sendFile(path.join(PUBLIC, 'parent.html')));

// ─── 排行榜 ───
app.get('/api/classes/:classId/ranking', needAuth, needClassOwner, (req, res) => {
  const period = req.query.period || 'total';
  res.json({ ranking: db.getRanking(req.classObj.id, period) });
});

// ─── 小组 ───
app.get('/api/classes/:classId/groups', needAuth, needClassOwner, (req, res) => {
  res.json({ groups: db.getClassGroups(req.classObj.id) });
});
app.post('/api/classes/:classId/groups', needAuth, needClassOwner, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '小组名称必填' });
  const r = db.createGroup(req.classObj.id, name.trim());
  res.json({ ok: true, group: { id: r.lastInsertRowid, class_id: req.classObj.id, name: name.trim() } });
});
app.delete('/api/classes/:classId/groups/:groupId', needAuth, needClassOwner, (req, res) => {
  db.deleteGroup(parseInt(req.params.groupId));
  res.json({ ok: true });
});
app.post('/api/classes/:classId/groups/:groupId/members', needAuth, needClassOwner, (req, res) => {
  const { student_id } = req.body || {};
  if (!student_id) return res.status(400).json({ error: '学生ID必填' });
  db.assignStudentToGroup(parseInt(student_id), parseInt(req.params.groupId));
  res.json({ ok: true });
});
app.delete('/api/classes/:classId/groups/:groupId/members', needAuth, needClassOwner, (req, res) => {
  const { student_id } = req.body || {};
  if (!student_id) return res.status(400).json({ error: '学生ID必填' });
  db.removeStudentFromGroup(parseInt(student_id), parseInt(req.params.groupId));
  res.json({ ok: true });
});
app.get('/api/classes/:classId/groups/:groupId/members', needAuth, needClassOwner, (req, res) => {
  res.json({ members: db.getGroupMembers(parseInt(req.params.groupId)) });
});


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

// ═══ PAYMENT & PREMIUM ═══

app.post('/api/v1/orders', needAuth, (req, res) => {
  const orderId = 'CP' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2,6);
  db.db.prepare('INSERT INTO orders_table (id, user_id, amount) VALUES (?,?,?)').run(orderId, req.user.id, 1900);
  res.json({ ok: true, order_no: orderId, qr_url: '/images/pay-qr.png', amount: 19 });
});

app.get('/api/v1/orders/:id', needAuth, (req, res) => {
  const row = db.db.prepare('SELECT id, status, paid_at FROM orders_table WHERE id=?').get(req.params.id);
  if (!row) return res.json({ ok: false, status: 'not_found' });
  res.json({ ok: true, status: row.status, paid_at: row.paid_at });
});

app.post('/api/v1/orders/:id/confirm', (req, res) => {
  const { secret } = req.body;
  if (secret !== 'classpet2026') return res.status(403).json({ ok: false, error: 'no permission' });
  db.db.prepare("UPDATE orders_table SET status='paid', paid_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
  const order = db.db.prepare('SELECT user_id FROM orders_table WHERE id=?').get(req.params.id);
  if (order && order.user_id) {
    const exp = new Date(Date.now() + 365*86400000).toISOString().split('T')[0];
    db.db.prepare('UPDATE teachers SET premium=1, premium_expires=? WHERE id=?').run(exp, order.user_id);
  }
  res.json({ ok: true });
});

app.post('/api/v1/activation-codes/redeem', needAuth, (req, res) => {
  const { code } = req.body;
  const row = db.db.prepare('SELECT * FROM activation_codes WHERE code=? AND used_by IS NULL').get(code);
  if (!row) return res.json({ ok: false, error: 'invalid code' });
  const days = row.duration_days || 365;
  const exp = new Date(Date.now() + days*86400000).toISOString().split('T')[0];
  db.db.prepare(`UPDATE activation_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=?`).run(req.user.id, code);
  db.db.prepare('UPDATE teachers SET premium=1, premium_expires=? WHERE id=?').run(exp, req.user.id);
  res.json({ ok: true, expires: exp });
});

app.get('/api/v1/user/premium', needAuth, (req, res) => {
  const t = db.db.prepare('SELECT premium, premium_expires FROM teachers WHERE id=?').get(req.user.id);
  const valid = t && t.premium === 1 && (!t.premium_expires || new Date(t.premium_expires) > new Date());
  res.json({ premium: !!valid, expires: t ? t.premium_expires : null });
});

app.post('/api/v1/admin/gen-codes', (req, res) => {
  const { count, days, secret } = req.body;
  if (secret !== 'classpet2026') return res.status(403).json({ ok: false });
  const codes = [];
  for (let i = 0; i < (count || 10); i++) {
    const code = 'CP-' + Math.random().toString(36).slice(2,8).toUpperCase();
    db.db.prepare('INSERT OR IGNORE INTO activation_codes (code, duration_days) VALUES (?,?)').run(code, days || 365);
    codes.push(code);
  }
  res.json({ ok: true, codes });
});



// Additional pages
app.get('/school', (req, res) => res.sendFile(PUBLIC + '/school.html'));

app.get('/garden', (req,res) => res.sendFile(path.join(PUBLIC, 'garden.html')));
app.get('/shop', (req,res) => res.sendFile(path.join(PUBLIC, 'shop.html')));
app.get('/help', (req, res) => res.sendFile(PUBLIC + '/help.html'));


// ─── Pet-Zone: Rules ───
app.get('/api/classes/:classId/rules', needAuth, needClassOwner, (req, res) => {
  try { res.json({ ok: true, rules: db.getRules(req.classObj.id) }); }
  catch(e) { res.status(500).json({ error: '获取规则失败' }); }
});
app.post('/api/classes/:classId/rules', needAuth, needClassOwner, (req, res) => {
  const { name, category, points, kind, description, icon } = req.body || {};
  if (!name?.trim() || !category || !points || !kind) return res.status(400).json({ error: '参数不完整' });
  try { res.json({ ok: true, rule: db.addRule(req.classObj.id, name.trim(), category, points, kind, description, icon) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/classes/:classId/rules/:ruleId', needAuth, needClassOwner, (req, res) => {
  const rule = db.updateRule(parseInt(req.params.ruleId), req.body || {});
  if (!rule) return res.status(404).json({ error: '规则不存在' });
  res.json({ ok: true, rule });
});
app.delete('/api/classes/:classId/rules/:ruleId', needAuth, needClassOwner, (req, res) => {
  if (!db.deleteRule(parseInt(req.params.ruleId))) return res.status(404).json({ error: '规则不存在' });
  res.json({ ok: true });
});

// ─── Pet-Zone: Store ───
app.get('/api/classes/:classId/store', needAuth, needClassOwner, (req, res) => {
  try { res.json({ ok: true, items: db.getStoreItems(req.classObj.id) }); }
  catch(e) { res.status(500).json({ error: '获取商品失败' }); }
});
app.post('/api/classes/:classId/store', needAuth, needClassOwner, (req, res) => {
  const { name, description, price_badges, price_score, stock, icon, category } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '商品名称必填' });
  try { res.json({ ok: true, item: db.addStoreItem(req.classObj.id, name.trim(), description, price_badges, price_score, stock, icon, category) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/classes/:classId/store/redeem', needAuth, needClassOwner, (req, res) => {
  const { student_id, item_id, quantity } = req.body || {};
  if (!student_id || !item_id) return res.status(400).json({ error: '参数不完整' });
  try { res.json(db.redeemItem(parseInt(student_id), parseInt(item_id), parseInt(quantity)||1)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/classes/:classId/store/records', needAuth, needClassOwner, (req, res) => {
  try { res.json({ ok: true, records: db.getRedeemRecords(req.classObj.id) }); }
  catch(e) { res.status(500).json({ error: '获取记录失败' }); }
});

// ─── Pet-Zone: Rankings & Growth ───
app.get('/api/classes/:classId/rankings', needAuth, needClassOwner, (req, res) => {
  try { res.json({ ok: true, rankings: db.getEnhancedRanking(req.classObj.id, req.query.time||'all', req.query.sort||'score', req.query.type||'student') }); }
  catch(e) { res.status(500).json({ error: '获取排行榜失败' }); }
});
app.get('/api/classes/:classId/petgrowth', needAuth, needClassOwner, (req, res) => {
  try { res.json({ ok: true, growth: db.getPetGrowth(req.classObj.id) }); }
  catch(e) { res.status(500).json({ error: '获取成长设置失败' }); }
});
app.put('/api/classes/:classId/petgrowth', needAuth, needClassOwner, (req, res) => {
  const { levels } = req.body || {};
  if (!Array.isArray(levels) || levels.length===0) return res.status(400).json({ error: '等级配置必填' });
  try { res.json({ ok: true, levels: db.updatePetGrowth(req.classObj.id, levels) }); }
  catch(e) { res.status(500).json({ error: '更新失败' }); }
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).sendFile(PUBLIC + '/404.html');
});

app.listen(PORT, () => console.log(`ClassPet v3 running on port ${PORT}`));

