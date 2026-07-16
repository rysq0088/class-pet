'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db-init');

const PORT = process.env.PORT || 80;
const SEC = process.env.JWT_SECRET || 'classpet-2026-secret-key';
const CK = 'cp_token';
const PUBLIC = path.join(__dirname, 'public');
fs.existsSync(PUBLIC) || fs.mkdirSync(PUBLIC, { recursive: true });

// ─── Express ───
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(PUBLIC));

// ─── Auth middleware ───
function needTeacher(req, res, next) {
  const token = req.cookies[CK] || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    req.teacher = jwt.verify(token, SEC);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录过期，请重新登录' });
  }
}
function setToken(res, id) {
  const token = jwt.sign({ id }, SEC, { expiresIn: '7d' });
  res.cookie(CK, token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
  return token;
}

// ─── API ───

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/me', needTeacher, (req, res) => { res.json({ teacher: req.teacher }); });
app.put('/api/me', needTeacher, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '名称必填' });
  db.db.prepare('UPDATE teachers SET name=? WHERE id=?').run(name.trim(), req.teacher.id);
  req.teacher.name = name.trim();
  res.json({ ok: true, teacher: req.teacher });
});

// 注册
app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, name } = req.body || {};
    if (!phone || !password) return res.status(400).json({ error: '手机号和密码必填' });
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
    if (db.getTeacherByPhone(phone)) return res.status(409).json({ error: '该手机号已注册' });
    const hash = await bcrypt.hash(password, 10);
    const r = db.createTeacher(phone, hash, name || '老师');
    setToken(res, r.lastInsertRowid);
    res.json({ ok: true, teacher: { id: r.lastInsertRowid, phone, name: name || '老师' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 登录
app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password) return res.status(400).json({ error: '手机号和密码必填' });
    const t = db.getTeacherByPhone(phone);
    if (!t) return res.status(401).json({ error: '手机号未注册' });
    if (!await bcrypt.compare(password, t.password)) return res.status(401).json({ error: '密码错误' });
    setToken(res, t.id);
    res.json({ ok: true, teacher: { id: t.id, phone: t.phone, name: t.name } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 登出
app.post('/api/logout', (req, res) => { res.clearCookie(CK); res.json({ ok: true }); });

// 获取个人信息
app.get('/api/me', needTeacher, (req, res) => {
  const t = db.getTeacherById(req.teacher.id);
  if (!t) return res.status(404).json({ error: '用户不存在' });
  res.json({ teacher: { id: t.id, phone: t.phone, name: t.name } });
});

// ─── 班级 ───
app.get('/api/classes', needTeacher, (req, res) => {
  res.json({ classes: db.getTeacherClasses(req.teacher.id) });
});

app.post('/api/classes', needTeacher, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '班级名称必填' });
  res.json({ ok: true, class: db.createClass(req.teacher.id, name.trim()) });
});

app.put('/api/classes/:classId', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '班级名称必填' });
  db.updateClass(c.id, name.trim());
  res.json({ ok: true, class: db.getClassById(c.id) });
});

app.get('/api/classes/:classId/history', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
  res.json({ history: db.getClassScoreHistory(c.id, 100) });
});

// ─── 学生 ───
app.get('/api/classes/:classId/students', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  res.json({ class: c, students: db.getClassStudents(c.id) });
});

app.post('/api/classes/:classId/students', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  const { name, pet_type } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '学生姓名必填' });
  res.json({ ok: true, student: db.addStudent(c.id, name.trim(), pet_type) });
});

app.put('/api/classes/:classId/students/:studentId', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
  const { name, pet_type } = req.body || {};
  if (!name?.trim() && !pet_type) return res.status(400).json({ error: '至少修改一项' });
  db.updateStudent(parseInt(req.params.studentId), name?.trim(), pet_type);
  res.json({ ok: true, student: db.getStudentById(parseInt(req.params.studentId)) });
});

app.delete('/api/classes/:classId/students/:studentId', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
  const sid = parseInt(req.params.studentId);
  const s = db.getStudentById(sid);
  if (!s || s.class_id !== c.id) return res.status(404).json({ error: '学生不在该班级' });
  db.deleteStudent(sid);
  res.json({ ok: true });
});

app.get('/api/classes/:classId/students/:studentId/detail', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
  res.json(db.studentDetail(parseInt(req.params.studentId)));
});

// ─── 积分（老师批量加分）───
app.post('/api/classes/:classId/scores', needTeacher, (req, res) => {
  try {
    const c = db.getClassById(parseInt(req.params.classId));
    if (!c || c.teacher_id !== req.teacher.id) return res.status(403).json({ error: '无权操作此班级' });
    const { scores } = req.body || {};
    if (!Array.isArray(scores) || scores.length === 0) return res.status(400).json({ error: '请选择要加分的学生' });
    const tx = db.db.transaction(() => {
      scores.forEach(s => {
        if (s.student_id && s.points > 0) {
          db.addScore(parseInt(s.student_id), parseInt(s.points), s.reason || '表现优秀', req.teacher.id);
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

// 今天加了哪些分（大屏轮询用）
app.get('/api/classes/:classId/today', needTeacher, (req, res) => {
  const c = db.getClassById(parseInt(req.params.classId));
  if (!c) return res.status(404).json({ error: '班级不存在' });
  res.json({ logs: db.getClassTodayLogs(c.id) });
});

// ─── 花园数据（大屏/家长公开访问，不需要登录） ───
app.get('/api/garden/:code', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  res.json({ class: c, garden: db.gardenData(c.id) });
});

// ─── 学生详情（家长端用，通过邀请码+学生ID访问） ───
app.get('/api/student/:code/:studentId', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  const detail = db.studentDetail(parseInt(req.params.studentId));
  if (!detail) return res.status(404).json({ error: '学生不存在' });
  res.json(detail);
});

// ─── 商店购买 ───
app.post('/api/student/:code/:studentId/buy', (req, res) => {
  const c = db.getClassByCode(req.params.code);
  if (!c) return res.status(404).json({ error: '无效邀请码' });
  const { item_key, item_name, category, cost } = req.body || {};
  if (!item_key || !cost) return res.status(400).json({ error: '参数不完整' });
  const result = db.shopBuy(parseInt(req.params.studentId), item_key, item_name, category, parseInt(cost));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, student: db.studentDetail(parseInt(req.params.studentId)) });
});

// ─── 页面路由 ───
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/login', (req, res) => {
  // If already logged in, redirect based on user agent
  const token = req.cookies[CK];
  if (token) {
    try {
      const ua = req.headers['user-agent'] || '';
      const isMobile = /Mobile|Android|iPhone/i.test(ua);
      return res.redirect(isMobile ? '/teacher' : '/admin');
    } catch(e) {}
  }
  res.sendFile(path.join(PUBLIC, 'login.html'));
});
app.get('/demo', (req, res) => res.sendFile(path.join(PUBLIC, 'demo.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC, 'teacher.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/print', (req, res) => res.sendFile(path.join(PUBLIC, 'print.html')));
app.get('/screen/:code', (req, res) => res.sendFile(path.join(PUBLIC, 'screen.html')));
app.get('/parent/:code/:studentId', (req, res) => res.sendFile(path.join(PUBLIC, 'parent.html')));

app.listen(PORT, () => console.log(`ClassPet v2 running on port ${PORT}`));
