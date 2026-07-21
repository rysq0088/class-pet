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
  -- 学校/机构
  CREATE TABLE IF NOT EXISTS institutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    province TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    contact_phone TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 教师（关联学校 + 角色）
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT DEFAULT '',
    institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
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

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS groups_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS student_groups (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE CASCADE,
    PRIMARY KEY (student_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS orders_table (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    amount INTEGER NOT NULL DEFAULT 1900,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activation_codes (
    code TEXT PRIMARY KEY,
    duration_days INTEGER NOT NULL DEFAULT 365,
    used_by INTEGER,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Ensure premium columns exist on teachers
try { db.exec("ALTER TABLE teachers ADD COLUMN premium INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE teachers ADD COLUMN premium_expires TEXT"); } catch(e) {}


// Pet-Zone: badges and experience columns
try { db.exec("ALTER TABLE students ADD COLUMN badges INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE students ADD COLUMN experience INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE students ADD COLUMN level INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE students ADD COLUMN total_score INTEGER DEFAULT 0"); } catch(e) {}

// Pet-Zone: rules, store, redeem, pet_growth tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    points INTEGER NOT NULL,
    kind TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS store_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_badges INTEGER DEFAULT 0,
    price_score INTEGER DEFAULT 0,
    stock INTEGER DEFAULT -1,
    icon TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS redeem_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    paid_badges INTEGER DEFAULT 0,
    paid_score INTEGER DEFAULT 0,
    redeemed_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS pet_growth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    exp_required INTEGER NOT NULL,
    badge_reward INTEGER DEFAULT 0,
    unlock_features TEXT DEFAULT '',
    UNIQUE(class_id, level)
  );
`);


// ─── helpers ───
function genCode() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += s[Math.floor(Math.random() * s.length)];
  return c;
}

function petLevel(exp) {
  if (exp >= 500) return { level: 8, name: '神话', emoji: '👑', next: 999 };
  if (exp >= 300) return { level: 7, name: '史诗', emoji: '💎', next: 500 };
  if (exp >= 180) return { level: 6, name: '精英', emoji: '🏆', next: 300 };
  if (exp >= 100) return { level: 5, name: '传说', emoji: '⭐', next: 180 };
  if (exp >= 50) return { level: 4, name: '成年', emoji: '🌳', next: 100 };
  if (exp >= 20) return { level: 3, name: '成长', emoji: '🌿', next: 50 };
  if (exp >= 5) return { level: 2, name: '幼年', emoji: '🌱', next: 20 };
  return { level: 1, name: '宝宝', emoji: '🥚', next: 5 };
}

const PETS = {
  cat: '🐱', dog: '🐶', rabbit: '🐰', panda: '🐼',
  chick: '🐤', turtle: '🐢', hamster: '🐹', fox: '🦊'
};

// ─── 学校/机构 ───
function createInstitution(name, province, city, address, contactName, contactPhone) {
  db.prepare('INSERT INTO institutions (name, province, city, address, contact_name, contact_phone) VALUES (?,?,?,?,?,?)')
    .run(name, province||'', city||'', address||'', contactName||'', contactPhone||'');
  return db.prepare('SELECT * FROM institutions WHERE id=last_insert_rowid()').get();
}
function getInstitutionById(id) {
  return db.prepare('SELECT * FROM institutions WHERE id=?').get(id);
}
function updateInstitution(id, fields) {
  const sets = []; const vals = [];
  const allowed = ['name','province','city','address','contact_name','contact_phone'];
  allowed.forEach(k => { if (fields[k] !== undefined) { sets.push(k+'=?'); vals.push(fields[k]); } });
  if (sets.length === 0) return { error: '无修改内容' };
  vals.push(id);
  db.prepare(`UPDATE institutions SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true };
}
function setTeacherInstitution(teacherId, institutionId, role) {
  db.prepare('UPDATE teachers SET institution_id=?, role=? WHERE id=?').run(institutionId, role||'teacher', teacherId);
  return getTeacherById(teacherId);
}
function getInstitutionTeachers(institutionId) {
  return db.prepare(
    "SELECT id, phone, name, role, created_at FROM teachers WHERE institution_id=? ORDER BY role DESC, name ASC"
  ).all(institutionId);
}
function getInstitutionClasses(institutionId) {
  return db.prepare(
    "SELECT c.*, t.name as teacher_name, (SELECT COUNT(*) FROM students WHERE class_id=c.id) as student_count FROM classes c JOIN teachers t ON c.teacher_id=t.id WHERE c.institution_id=? ORDER BY c.created_at DESC"
  ).all(institutionId);
}
function getInstitutionStats(institutionId) {
  const tCount = db.prepare('SELECT COUNT(*) as c FROM teachers WHERE institution_id=?').get(institutionId).c;
  const clCount = db.prepare('SELECT COUNT(*) as c FROM classes WHERE institution_id=?').get(institutionId).c;
  const sCount = db.prepare(
    'SELECT COUNT(*) as c FROM students s JOIN classes c ON s.class_id=c.id WHERE c.institution_id=?'
  ).get(institutionId).c;
  const today = new Date().toISOString().slice(0,10);
  const todayScore = db.prepare(
    'SELECT COALESCE(SUM(sl.points),0) as total FROM score_logs sl JOIN students s ON sl.student_id=s.id JOIN classes c ON s.class_id=c.id WHERE c.institution_id=? AND sl.date=?'
  ).get(institutionId, today).total;
  return { teacher_count: tCount, class_count: clCount, student_count: sCount, today_score: todayScore };
}

// ─── 教师 ───
function createTeacher(phone, password, name) {
  return db.prepare('INSERT INTO teachers (phone, password, name) VALUES (?,?,?)').run(phone, password, name);
}
function getTeacherByPhone(phone) {
  return db.prepare('SELECT * FROM teachers WHERE phone = ?').get(phone);
}
function getTeacherById(id) {
  return db.prepare(`SELECT t.*, i.name as institution_name, i.province, i.city 
    FROM teachers t LEFT JOIN institutions i ON t.institution_id=i.id WHERE t.id=?`).get(id);
}
function updateTeacher(id, fields) {
  const sets = []; const vals = [];
  const allowed = ['name'];
  allowed.forEach(k => { if (fields[k] !== undefined) { sets.push(k+'=?'); vals.push(fields[k]); } });
  if (sets.length === 0) return { error: '无修改内容' };
  vals.push(id);
  db.prepare(`UPDATE teachers SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true };
}

// ─── 班级 ───
function createClass(teacherId, institutionId, name) {
  const code = genCode();
  db.prepare('INSERT INTO classes (teacher_id, institution_id, name, invite_code) VALUES (?,?,?,?)')
    .run(teacherId, institutionId||null, name, code);
  return db.prepare('SELECT * FROM classes WHERE invite_code = ?').get(code);
}
function getClassByCode(code) {
  return db.prepare(
    'SELECT c.*, t.name as teacher_name, i.name as institution_name FROM classes c JOIN teachers t ON c.teacher_id=t.id LEFT JOIN institutions i ON c.institution_id=i.id WHERE c.invite_code=?'
  ).get(code);
}
function getTeacherClasses(teacherId) {
  return db.prepare("SELECT c.*, (SELECT COUNT(*) FROM students WHERE class_id=c.id) as student_count FROM classes c WHERE c.teacher_id=? ORDER BY c.created_at DESC").all(teacherId);
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
  db.prepare('INSERT INTO score_logs (student_id, points, reason, teacher_id, date) VALUES (?,?,?,?,?)')
    .run(studentId, points, reason, teacherId, today);
  db.prepare('UPDATE students SET score=score+?, pet_exp=pet_exp+? WHERE id=?').run(points, points, studentId);
}
function getStudentScoreLogs(studentId, limit) {
  return db.prepare('SELECT * FROM score_logs WHERE student_id=? ORDER BY created_at DESC LIMIT ?').all(studentId, limit || 20);
}
function getClassTodayLogs(classId) {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(
    'SELECT sl.*, s.name as student_name FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? AND sl.date=? ORDER BY sl.created_at DESC'
  ).all(classId, today);
}
function updateStudent(id, name, petType) {
  const fields = []; const vals = [];
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
  if (category !== 'food') {
    const owned = db.prepare('SELECT id FROM purchases WHERE student_id=? AND item_key=?').get(studentId, itemKey);
    if (owned) return { error: '已拥有该物品' };
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE students SET score=score-? WHERE id=?').run(cost, studentId);
    db.prepare('INSERT INTO purchases (student_id, item_key, item_name, category, cost) VALUES (?,?,?,?,?)')
      .run(studentId, itemKey, itemName, category, cost);
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

// ─── 花园数据 ───
function gardenData(classId) {
  const students = db.prepare('SELECT * FROM students WHERE class_id=? ORDER BY pet_exp DESC').all(classId);
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = db.prepare(
    'SELECT sl.*, s.name as student_name FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? AND sl.date=? ORDER BY sl.created_at DESC LIMIT 20'
  ).all(classId, today);
  // Last score date per student (for mood)
  const lastDates = {};
  db.prepare('SELECT sl.student_id, MAX(sl.date) as last_date FROM score_logs sl JOIN students s ON sl.student_id=s.id WHERE s.class_id=? GROUP BY sl.student_id').all(classId).forEach(r => { lastDates[r.student_id] = r.last_date; });
  // Latest food purchase per student (for feeding animation)
  const latestFeeds = {};
  db.prepare("SELECT student_id, item_name, purchased_at FROM purchases WHERE category='food' AND id IN (SELECT MAX(id) FROM purchases WHERE category='food' GROUP BY student_id)").all().forEach(r => { latestFeeds[r.student_id] = r; });
  return students.map(s => {
    const myLogs = todayLogs.filter(l => l.student_id === s.id);
    const lastTs = myLogs.length > 0 ? new Date(myLogs[0].created_at.replace(' ','T') + '+08:00').getTime() : 0;
    const secsAgo = lastTs ? Math.floor((Date.now() - lastTs)/1000) : 99999;
    const lastDate = lastDates[s.id] || '';
    const daysGap = lastDate ? Math.floor((Date.now() - new Date(lastDate + 'T00:00:00+08:00').getTime())/86400000) : 99;
    // Mood: excited(<60s) > happy(today) > calm(yesterday) > bored(2d) > sad(3d+)
    let mood = 'calm';
    if (secsAgo < 60) mood = 'excited';
    else if (myLogs.length > 0) mood = 'happy';
    else if (daysGap >= 3) mood = 'sad';
    else if (daysGap >= 2) mood = 'bored';
    // Feeding: food bought within 60s
    const feed = latestFeeds[s.id];
    const feedTs = feed ? new Date(feed.purchased_at.replace(' ','T') + '+08:00').getTime() : 0;
    const feeding = feedTs && (Date.now() - feedTs) < 60000 ? { item_name: feed.item_name } : null;
    return {
      ...s,
      pet_info: petLevel(s.pet_exp),
      today_points: myLogs.reduce((a, b) => a + b.points, 0),
      today_count: myLogs.length,
      latest_reason: myLogs.length > 0 ? myLogs[0].reason : '',
      mood, secs_ago: secsAgo, feeding
    };
  });
}

function studentDetail(studentId) {
  const s = getStudentById(studentId);
  if (!s) return null;
  const logs = getStudentScoreLogs(studentId, 15);
  const purchases = getStudentPurchases(studentId);
  return { ...s, pet_info: petLevel(s.pet_exp), score_logs: logs, purchases };
}


// ─── Ranking ───
function getRanking(classId, period) {
  let dateFilter = '';
  const today = new Date().toISOString().slice(0, 10);
  if (period === 'today') {
    dateFilter = `AND date = '${today}'`;
  } else if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const weekAgo = d.toISOString().slice(0, 10);
    dateFilter = `AND date >= '${weekAgo}'`;
  }
  return db.prepare(`
    SELECT s.id, s.name, s.pet_type, s.score as total_score,
      COALESCE(SUM(CASE WHEN sl.id IS NOT NULL ${dateFilter} THEN sl.points ELSE 0 END), 0) as period_score
    FROM students s
    LEFT JOIN score_logs sl ON sl.student_id = s.id
    WHERE s.class_id = ?
    GROUP BY s.id
    ORDER BY period_score DESC, s.score DESC
  `).all(classId);
}

// ─── Groups ───
function createGroup(classId, name) {
  return db.prepare('INSERT INTO groups_table (class_id, name) VALUES (?, ?)').run(classId, name);
}
function getClassGroups(classId) {
  return db.prepare('SELECT * FROM groups_table WHERE class_id = ?').all(classId);
}
function assignStudentToGroup(studentId, groupId) {
  db.prepare('INSERT OR REPLACE INTO student_groups (student_id, group_id) VALUES (?, ?)').run(studentId, groupId);
}
function removeStudentFromGroup(studentId, groupId) {
  db.prepare('DELETE FROM student_groups WHERE student_id = ? AND group_id = ?').run(studentId, groupId);
}
function deleteGroup(groupId) {
  db.prepare('DELETE FROM groups_table WHERE id = ?').run(groupId);
}
function getGroupMembers(groupId) {
  return db.prepare('SELECT s.* FROM students s JOIN student_groups sg ON s.id = sg.student_id WHERE sg.group_id = ?').all(groupId);
}
function addScoreWithReason(studentId, points, reason, teacherId, dateOverride) {
  const date = dateOverride || new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO score_logs (student_id, points, reason, teacher_id, date) VALUES (?, ?, ?, ?, ?)').run(studentId, points, reason, teacherId, date);
  db.prepare('UPDATE students SET score = score + ?, pet_exp = pet_exp + ? WHERE id = ?').run(points, points, studentId);
}


// Pet-Zone: Rules CRUD
function getRules(classId) {
  return db.prepare('SELECT * FROM rules WHERE class_id = ? ORDER BY category, points DESC').all(classId);
}
function addRule(classId, name, category, points, kind, description, icon) {
  const id = db.prepare('INSERT INTO rules (class_id, name, category, points, kind, description, icon, created_at) VALUES (?,?,?,?,?,?,?,datetime("now","localtime"))')
    .run(classId, name, category, points, kind, description||'', icon||'').lastInsertRowid;
  return db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
}
function updateRule(ruleId, updates) {
  const fields = []; const vals = [];
  if (updates.name !== undefined) { fields.push('name = ?'); vals.push(updates.name); }
  if (updates.category !== undefined) { fields.push('category = ?'); vals.push(updates.category); }
  if (updates.points !== undefined) { fields.push('points = ?'); vals.push(updates.points); }
  if (updates.kind !== undefined) { fields.push('kind = ?'); vals.push(updates.kind); }
  if (updates.description !== undefined) { fields.push('description = ?'); vals.push(updates.description); }
  if (updates.icon !== undefined) { fields.push('icon = ?'); vals.push(updates.icon); }
  if (fields.length === 0) return null;
  vals.push(ruleId);
  db.prepare('UPDATE rules SET ' + fields.join(', ') + ' WHERE id = ?').run(...vals);
  return db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId);
}
function deleteRule(ruleId) {
  return db.prepare('DELETE FROM rules WHERE id = ?').run(ruleId).changes > 0;
}

// Pet-Zone: Store
function getStoreItems(classId) {
  return db.prepare('SELECT * FROM store_items WHERE class_id = ? ORDER BY category, price_badges ASC').all(classId);
}
function addStoreItem(classId, name, description, price_badges, price_score, stock, icon, category) {
  const id = db.prepare('INSERT INTO store_items (class_id, name, description, price_badges, price_score, stock, icon, category, created_at) VALUES (?,?,?,?,?,?,?,?,datetime("now","localtime"))')
    .run(classId, name, description||'', price_badges||0, price_score||0, typeof stock==='number'?stock:-1, icon||'', category||'general').lastInsertRowid;
  return db.prepare('SELECT * FROM store_items WHERE id = ?').get(id);
}
function redeemItem(studentId, itemId, quantity) {
  const tx = db.transaction(() => {
    const student = db.prepare('SELECT s.* FROM students s WHERE s.id=?').get(studentId);
    const item = db.prepare('SELECT * FROM store_items WHERE id = ?').get(itemId);
    if (!student || !item) throw new Error('学生或商品不存在');
    if (item.class_id !== student.class_id) throw new Error('商品不属于该班级');
    if (item.stock !== -1 && item.stock < quantity) throw new Error('库存不足');
    const totalBadges = (item.price_badges || 0) * quantity;
    const totalScore = (item.price_score || 0) * quantity;
    if (totalBadges > 0 && (student.badges||0) < totalBadges) throw new Error('徽章不足');
    if (totalScore > 0 && student.score < totalScore) throw new Error('积分不足');
    if (totalBadges > 0) db.prepare('UPDATE students SET badges = badges - ? WHERE id = ?').run(totalBadges, studentId);
    if (totalScore > 0) db.prepare('UPDATE students SET score = score - ? WHERE id = ?').run(totalScore, studentId);
    if (item.stock !== -1) db.prepare('UPDATE store_items SET stock = stock - ? WHERE id = ?').run(quantity, itemId);
    const recordId = db.prepare("INSERT INTO redeem_records (student_id, item_id, quantity, paid_badges, paid_score, redeemed_at) VALUES (?,?,?,?,?,datetime('now','localtime'))")
      .run(studentId, itemId, quantity, totalBadges, totalScore).lastInsertRowid;
    const record = db.prepare('SELECT * FROM redeem_records WHERE id = ?').get(recordId);
    const updated = getStudentById(studentId);
    return { ok: true, record, student: updated };
  });
  return tx();
}
function getRedeemRecords(classId) {
  return db.prepare(
    "SELECT r.*, s.name as student_name, i.name as item_name FROM redeem_records r JOIN students s ON r.student_id=s.id JOIN store_items i ON r.item_id=i.id WHERE s.class_id=? ORDER BY r.redeemed_at DESC"
  ).all(classId);
}

// Pet-Zone: Enhanced Ranking
function getEnhancedRanking(classId, time, sort, type) {
  let timeFilter = '';
  if (time === 'day') timeFilter = "AND sl.date = date('now','localtime')";
  else if (time === 'week') timeFilter = "AND sl.date >= date('now','localtime','-7 days')";
  else if (time === 'month') timeFilter = "AND sl.date >= date('now','localtime','-30 days')";
  let orderField = 's.score';
  if (sort === 'badges') orderField = 's.badges';
  else if (sort === 'exp') orderField = 's.pet_exp';
  if (type === 'group') {
    return db.prepare(
      "SELECT g.id, g.name, COUNT(sg.student_id) as member_count, COALESCE(SUM(s.score),0) as total_score, COALESCE(SUM(s.badges),0) as total_badges, COALESCE(SUM(s.pet_exp),0) as total_exp FROM groups_table g LEFT JOIN student_groups sg ON g.id=sg.group_id LEFT JOIN students s ON sg.student_id=s.id WHERE g.class_id=? GROUP BY g.id ORDER BY " +
      (sort==='badges'?'total_badges':sort==='exp'?'total_exp':'total_score') + " DESC, g.name ASC"
    ).all(classId);
  }
  return db.prepare(
    "SELECT s.id, s.name, s.pet_type, s.pet_name, s.score, s.pet_exp, COALESCE(s.badges,0) as badges, COALESCE(s.level,1) as level, COALESCE(SUM(CASE WHEN sl.points>0 THEN sl.points ELSE 0 END),0) as recent_positive, COALESCE(SUM(CASE WHEN sl.points<0 THEN ABS(sl.points) ELSE 0 END),0) as recent_negative FROM students s LEFT JOIN score_logs sl ON s.id=sl.student_id " +
    timeFilter + " WHERE s.class_id=? GROUP BY s.id ORDER BY " + orderField + " DESC, s.name ASC LIMIT 50"
  ).all(classId);
}

// Pet-Zone: Growth System
function getPetGrowth(classId) {
  const rows = db.prepare('SELECT * FROM pet_growth WHERE class_id = ? ORDER BY level ASC').all(classId);
  if (rows.length > 0) return rows;
  return [
    { level: 1, exp_required: 5, badge_reward: 1, unlock_features: '基础宠物' },
    { level: 2, exp_required: 20, badge_reward: 2, unlock_features: '宠物命名' },
    { level: 3, exp_required: 50, badge_reward: 3, unlock_features: '表情动作' },
    { level: 4, exp_required: 100, badge_reward: 4, unlock_features: '特殊技能' },
    { level: 5, exp_required: 180, badge_reward: 5, unlock_features: '皮肤解锁' },
    { level: 6, exp_required: 300, badge_reward: 6, unlock_features: '光环特效' },
    { level: 7, exp_required: 500, badge_reward: 7, unlock_features: '专属称号' },
    { level: 8, exp_required: 999, badge_reward: 10, unlock_features: '终极形态' }
  ];
}
function updatePetGrowth(classId, levels) {
  db.prepare('DELETE FROM pet_growth WHERE class_id = ?').run(classId);
  const stmt = db.prepare('INSERT INTO pet_growth (class_id, level, exp_required, badge_reward, unlock_features) VALUES (?,?,?,?,?)');
  for (const l of levels) stmt.run(classId, l.level, l.exp_required, l.badge_reward||0, l.unlock_features||'');
  return getPetGrowth(classId);
}

module.exports = {
  db, PETS, petLevel, genCode,
  // 学校
  createInstitution, getInstitutionById, updateInstitution,
  setTeacherInstitution, getInstitutionTeachers, getInstitutionClasses, getInstitutionStats,
  // 教师
  createTeacher, getTeacherByPhone, getTeacherById, updateTeacher,
  // 班级
  createClass, getClassByCode, getTeacherClasses, getClassById, updateClass,
  // 学生
  addStudent, updateStudent, deleteStudent, getClassStudents, getStudentById,
  // 积分
  addScore, getStudentScoreLogs, getClassTodayLogs, getClassScoreHistory,
  // 商店
  shopBuy, getStudentPurchases,
  // 花园
  gardenData, studentDetail,

  getRanking,
  createGroup,
  getClassGroups,
  assignStudentToGroup,
  removeStudentFromGroup,
  deleteGroup,
  getGroupMembers,
  addScoreWithReason,

  getRules, addRule, updateRule, deleteRule,
  getStoreItems, addStoreItem, redeemItem, getRedeemRecords,
  getEnhancedRanking, getPetGrowth, updatePetGrowth,
};

