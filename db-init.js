'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'classpet.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pet_type TEXT NOT NULL DEFAULT 'cat',
    pet_name TEXT DEFAULT '',
    pet_exp INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS score_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    teacher_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    cost INTEGER NOT NULL,
    purchased_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// helpers
function genCode() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += s[Math.floor(Math.random() * s.length)];
  return c;
}

function petLevel(exp) {
  if (exp >= 250) return { level: 5, name: '传说', emoji: '⭐', next: 999 };
  if (exp >= 100) return { level: 4, name: '成年', emoji: '🌳', next: 250 };
  if (exp >= 40) return { level: 3, name: '成长', emoji: '🌿', next: 100 };
  if (exp >= 10) return { level: 2, name: '幼年', emoji: '🌱', next: 40 };
  return { level: 1, name: '宝宝', emoji: '🥚', next: 10 };
}

const PETS = {
  cat: '🐱', dog: '🐶', rabbit: '🐰', panda: '🐼',
  chick: '🐤', turtle: '🐢', hamster: '🐹', fox: '🦊'
};

// ─── 教师 ───
function createTeacher(phone, password, name) {
  return db.prepare('INSERT INTO teachers (phone, password, name) VALUES (?,?,?)').run(phone, password, name);
}
function getTeacherByPhone(phone) {
  return db.prepare('SELECT * FROM teachers WHERE phone = ?').get(phone);
}
function getTeacherById(id) {
  return db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
}

// ─── 班级 ───
function createClass(teacherId, name) {
  const code = genCode();
  db.prepare('INSERT INTO classes (teacher_id, name, invite_code) VALUES (?,?,?)').run(teacherId, name, code);
  return db.prepare('SELECT * FROM classes WHERE invite_code = ?').get(code);
}
function getClassByCode(code) {
  return db.prepare('SELECT c.*, t.name as teacher_name FROM classes c JOIN teachers t ON c.teacher_id=t.id WHERE c.invite_code=?').get(code);
}
function getTeacherClasses(teacherId) {
  return db.prepare('SELECT c.*, (SELECT COUNT(*) FROM students WHERE class_id=c.id) as student_count FROM classes c WHERE c.teacher_id=? ORDER BY c.created_at DESC').all(teacherId);
}
function getClassById(id) {
  return db.prepare('SELECT * FROM classes WHERE id=?').get(id);
}
function updateClass(id, name) {
  return db.prepare('UPDATE classes SET name=? WHERE id=?').run(name, id);
}

// ─── 学生 ───
function addStudent(classId, name, petType) {
  const pt = petType || 'cat';
  const emoji = PETS[pt] || '🐱';
  db.prepare('INSERT INTO students (class_id, name, pet_type, pet_name) VALUES (?,?,?,?)').run(classId, name, pt, emoji + name);
  return db.prepare('SELECT * FROM students WHERE id=last_insert_rowid()').get();
}
function getClassStudents(classId) {
  return db.prepare('SELECT * FROM students WHERE class_id=? ORDER BY score DESC, id ASC').all(classId);
}
function getStudentById(id) {
  return db.prepare('SELECT s.*, c.name as class_name, c.invite_code, c.teacher_id FROM students s JOIN classes c ON s.class_id=c.id WHERE s.id=?').get(id);
}

// ─── 积分 ───
function addScore(studentId, points, reason, teacherId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = db.prepare(
    'INSERT INTO score_logs (student_id, points, reason, teacher_id, date) VALUES (?,?,?,?,?)'
  ).run(studentId, points, reason, teacherId, today);
  // 积分加score，经验加exp（经验只升不降）
  db.prepare('UPDATE students SET score=score+?, pet_exp=pet_exp+? WHERE id=?').run(points, points, studentId);
  return result;
}
function getStudentScoreLogs(studentId, limit) {
  return db.prepare(
    'SELECT * FROM score_logs WHERE student_id=? ORDER BY created_at DESC LIMIT ?'
  ).all(studentId, limit || 20);
}
function getClassTodayLogs(classId) {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(
    'SELECT sl.*, s.name as student_name FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? AND sl.date=? ORDER BY sl.created_at DESC'
  ).all(classId, today);
}

function updateStudent(id, name, petType) {
  const fields = [];
  const vals = [];
  if (name !== undefined) { fields.push('name=?'); vals.push(name); }
  if (petType !== undefined) { fields.push('pet_type=?'); vals.push(petType); }
  if (fields.length === 0) return { error: '无修改内容' };
  vals.push(id);
  return db.prepare(`UPDATE students SET ${fields.join(',')} WHERE id=?`).run(...vals);
}
function deleteStudent(id) {
  return db.prepare('DELETE FROM students WHERE id=?').run(id);
}
function getClassScoreHistory(classId, limit) {
  return db.prepare(
    'SELECT sl.*, s.name as student_name, s.pet_type FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? ORDER BY sl.created_at DESC LIMIT ?'
  ).all(classId, limit || 50);
}

// ─── 商店 ───
function shopBuy(studentId, itemKey, itemName, category, cost) {
  const s = db.prepare('SELECT score FROM students WHERE id=?').get(studentId);
  if (!s || s.score < cost) return { error: '积分不足' };
  // 非消耗品检查是否已拥有
  if (category === 'dress' || category === 'special' || category === 'toy') {
    const owned = db.prepare('SELECT id FROM purchases WHERE student_id=? AND item_key=?').get(studentId, itemKey);
    if (owned) return { error: '已拥有该物品' };
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE students SET score=score-? WHERE id=?').run(cost, studentId);
    db.prepare('INSERT INTO purchases (student_id, item_key, item_name, category, cost) VALUES (?,?,?,?,?)').run(studentId, itemKey, itemName, category, cost);
    if (category === 'food') {
      db.prepare('UPDATE students SET pet_exp=pet_exp+? WHERE id=?').run(cost * 3, studentId);
    }
  });
  tx();
  return { ok: true };
}
function getStudentPurchases(studentId) {
  return db.prepare('SELECT * FROM purchases WHERE student_id=? ORDER BY purchased_at DESC LIMIT 30').all(studentId);
}

// ─── 花园数据（大屏+家长） ───
function gardenData(classId) {
  const students = db.prepare('SELECT * FROM students WHERE class_id=? ORDER BY pet_exp DESC').all(classId);
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = db.prepare(
    'SELECT sl.*, s.name as student_name FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? AND sl.date=? ORDER BY sl.created_at DESC LIMIT 20'
  ).all(classId, today);
  return students.map(s => ({
    ...s,
    pet_info: petLevel(s.pet_exp),
    today_points: todayLogs.filter(l => l.student_id === s.id).reduce((a, b) => a + b.points, 0)
  }));
}

function studentDetail(studentId) {
  const s = getStudentById(studentId);
  if (!s) return null;
  const logs = getStudentScoreLogs(studentId, 15);
  const purchases = getStudentPurchases(studentId);
  return { ...s, pet_info: petLevel(s.pet_exp), score_logs: logs, purchases };
}

module.exports = {
  db, PETS, petLevel, genCode,
  createTeacher, getTeacherByPhone, getTeacherById,
  createClass, getClassByCode, getTeacherClasses, getClassById, updateClass,
  addStudent, updateStudent, deleteStudent, getClassStudents, getStudentById,
  addScore, getStudentScoreLogs, getClassTodayLogs, getClassScoreHistory,
  shopBuy, getStudentPurchases,
  gardenData, studentDetail,
};
