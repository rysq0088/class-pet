/**
 * class-pet 全自动测试修复脚本
 * 不依赖外部 exec，所有逻辑在本文件内完成
 * 用法: node run-all.js
 * 结果写入: test-result.log
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const PROJECT = 'C:\\Users\\ybl\\.qclaw\\workspace-lqnapxrjdq1wfjhu\\class-pet';
const DATA = path.join(PROJECT, 'data');
const LOG = path.join(PROJECT, 'test-result.log');

// 动态端口（main()中设置）
let PORT = 3002;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

function runCmd(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { cwd: PROJECT, encoding: 'utf8', ...opts });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  } catch (e) {
    return { code: -1, out: '', err: e.message };
  }
}

function isPortFree(port) {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1');
    let done = false;
    const finish = v => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(v); } };
    s.on('connect', () => finish(false));
    s.on('error', () => finish(true));
    setTimeout(() => finish(true), 800);
  });
}

async function pickFreePort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    const p = Math.floor(Math.random() * 5000 + 5000);
    if (await isPortFree(p)) return p;
  }
  return Math.floor(Math.random() * 5000 + 5000);
}

function httpReq(method, p, body, cookie) {
  return new Promise((resolve) => {
    const url = new URL(p, 'http://localhost:' + PORT);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json' }
    };
    if (cookie) opts.headers['Cookie'] = cookie;
    const req = http.request(opts, res => {
      const sc = res.headers['set-cookie'];
      let cookieOut = cookie;
      if (sc) cookieOut = 'cp_session=' + sc[0].split(';')[0].replace('cp_session=', '');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), cookie: cookieOut }); }
        catch { resolve({ status: res.statusCode, body: data.substring(0, 200), cookie: cookieOut }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: e.message, cookie }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await httpReq('GET', '/api/health');
      if (r.status === 200) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function runTests() {
  log('=== 开始测试 ===');
  const results = [];
  let instCookie = '', teachCookie = '', parentCookie = '';

  const ts = String(Date.now()).slice(-8);
  const instPhone = '138' + ts.padStart(8, '0');
  const teachPhone = '139' + ts.padStart(8, '0');
  const parentPhone = '137' + ts.padStart(8, '0');
  async function T(label, fn) {
    try {
      const r = await fn();
      const pass = r && r.status >= 200 && r.status < 300 && (r.body && (r.body.ok === true || r.status === 200));
      results.push({ label, pass, status: r?.status, detail: JSON.stringify(r?.body)?.substring(0, 150) });
      log(`${pass ? 'PASS' : 'FAIL'} [${label}] status=${r?.status} ${JSON.stringify(r?.body)?.substring(0, 120)}`);
      return r;
    } catch (e) {
      results.push({ label, pass: false, status: 0, detail: e.message });
      log(`FAIL [${label}] EXCEPTION: ${e.message}`);
      return null;
    }
  }

  // 1. 机构注册
  const r1 = await T('机构注册', () => httpReq('POST', '/api/auth/institution/register', { name: '阳光少年宫', phone: instPhone, password: '123456' }).then(r => { instCookie = r.cookie; return r; }));
  // 2. 机构登录
  const r2 = await T('机构登录', () => httpReq('POST', '/api/auth/institution/login', { phone: instPhone, password: '123456' }, instCookie).then(r => { instCookie = r.cookie || instCookie; return r; }));
  // 3. 购买席位
  const r3 = await T('购买席位', () => httpReq('POST', '/api/institution/purchase', { childCount: 30 }, instCookie));
  const r4 = await T('机构统计(购买后配额未送)', async () => {
    const r = await httpReq('GET', '/api/institution/stats', null, instCookie);
    if (r.status === 200 && r.body && r.body.stats && r.body.stats.usedQuota === 0) {
      return { ...r, status: 200, body: { ok: true, usedQuota: r.body.stats.usedQuota } };
    }
    return { ...r, status: r.status === 200 ? 400 : r.status, body: { ok: false, detail: '购买后不应直接开通席位', stats: r.body?.stats } };
  });
  // 4b. 验证支付闭环：购买→模拟支付成功→容量增加、已用不变、订单paid（覆盖 confirmSeatOrder 容量 bug 修复）
  const beforeQuota = (await httpReq('GET', '/api/institution/me', null, instCookie)).body.institution.childQuota;
  const buyR = await T('支付闭环-创建订单', () => httpReq('POST', '/api/institution/purchase', { childCount: 5 }, instCookie));
  const loopR = await T('支付闭环-模拟支付后开通席位', async () => {
    const oid = buyR.body && buyR.body.orderId;
    if (!oid) return { ...buyR, status: 400, body: { ok: false, reason: '无订单号' } };
    const sim = await httpReq('POST', `/api/payment/dev-simulate/${oid}`, null, instCookie);
    if (sim.status !== 200) return { ...sim, status: sim.status, body: { ok: false, reason: '模拟支付失败', sim } };
    const me = await httpReq('GET', '/api/institution/me', null, instCookie);
    const after = me.body.institution.childQuota, used = me.body.institution.usedQuota;
    const ord = await httpReq('GET', `/api/institution/order/${oid}`, null, instCookie);
    if (after !== beforeQuota + 5) return { ...me, status: 400, body: { ok: false, reason: '容量未增加', before: beforeQuota, after, expect: beforeQuota + 5 } };
    if (used !== 0) return { ...me, status: 400, body: { ok: false, reason: '已用不应变化', used } };
    if (ord.body.order.status !== 'paid') return { ...ord, status: 400, body: { ok: false, reason: '订单未标记paid' } };
    return { ...me, status: 200, body: { ok: true, before: beforeQuota, after, used, status: ord.body.order.status } };
  });
  // 5. 添加老师
  const r5 = await T('添加老师', () => httpReq('POST', '/api/institution/teachers', { name: '李老师', phone: teachPhone, password: 'teacher01' }, instCookie));
  // 6. 老师登录
  const r6 = await T('老师登录', () => httpReq('POST', '/api/auth/teacher/login', { phone: teachPhone, password: 'teacher01' }).then(r => { teachCookie = r.cookie; return r; }));
  // 7. 创建班级
  let clsId;
  const r7 = await T('创建班级', () => httpReq('POST', '/api/classes', { name: '小班A' }, teachCookie));
  clsId = r7?.body?.class?.id;
  // 8. 添加学生
  let stuId;
  const r8 = await T('添加学生', () => httpReq('POST', `/api/classes/${clsId}/students`, { name: '张小明', petType: 'cat', petName: '糖糖' }, teachCookie));
  stuId = r8?.body?.student?.id;
  // 9. 加分
  const r9 = await T('加分+10', () => httpReq('POST', `/api/classes/${clsId}/students/${stuId}/points`, { delta: 10, reason: '作业' }, teachCookie));
  // 10. 进化
  const r10 = await T('加分触发进化', () => httpReq('POST', `/api/classes/${clsId}/students/${stuId}/points`, { delta: 50, reason: '爆发' }, teachCookie));
  // 11. 喂养
  const r11 = await T('喂养', () => httpReq('POST', `/api/classes/${clsId}/students/${stuId}/feed`, {}, teachCookie));
  // 12. 家长邀请码
  let inviteCode;
  const r12 = await T('生成家长码', () => httpReq('POST', `/api/classes/${clsId}/parent-code`, {}, teachCookie));
  inviteCode = r12?.body?.code;
  // 13. 家长注册
  const r13 = await T('家长注册', () => httpReq('POST', '/api/auth/parent/register', { phone: parentPhone, password: 'parent01', code: inviteCode, studentName: '张小明', consent: true }).then(r => { parentCookie = r.cookie; return r; }));
  // 14. 家长登录
  const r14 = await T('家长登录', () => httpReq('POST', '/api/auth/parent/login', { phone: parentPhone, password: 'parent01' }, parentCookie).then(r => { parentCookie = r.cookie || parentCookie; return r; }));
  // 15. 家长查看孩子
  const r15 = await T('家长查看孩子', () => httpReq('GET', '/api/parent/children', null, parentCookie));
  // 16. 家长成长报告
  const r16 = await T('家长成长报告', () => httpReq('GET', `/api/parent/weekly-report/${stuId}`, null, parentCookie));
  // 17. 无认证
  const r17 = await T('安全-无认证401', async () => { const r = await httpReq('GET', '/api/classes', null, null); return { ...r, status: r.status === 401 ? 200 : r.status, body: r.status === 401 ? { ok: true } : r.body }; });
  // 18. 老师跨角色
  const r18 = await T('安全-老师跨角色403', async () => { const r = await httpReq('GET', '/api/institution/me', null, teachCookie); return { ...r, status: (r.status === 403 || r.status === 401) ? 200 : r.status, body: (r.status === 403 || r.status === 401) ? { ok: true } : r.body }; });
  // 19. 机构跨班级
  const r19 = await T('安全-机构跨班级403', async () => { const r = await httpReq('POST', `/api/classes/${clsId}/students/${stuId}/points`, { delta: 5 }, instCookie); return { ...r, status: r.status === 403 ? 200 : r.status, body: r.status === 403 ? { ok: true } : r.body }; });
  // 20. 空班级名 → 400
  const r20 = await T('边界-空班级名400', async () => { const r = await httpReq('POST', '/api/classes', { name: '  ' }, teachCookie); return { ...r, status: r.status === 400 ? 200 : r.status, body: r.status === 400 ? { ok: true } : r.body }; });
  // 21. 家长码重复使用 → 失败
  const r21 = await T('边界-家长码复用', async () => { const r = await httpReq('POST', '/api/auth/parent/register', { phone: '136' + ts.padStart(8, '0'), password: 'parent02', code: inviteCode, studentName: '李雷' }, null); return { ...r, status: (r.status === 400 || r.status === 409) ? 200 : r.status, body: (r.status === 400 || r.status === 409) ? { ok: true } : r.body }; });
  // 22. 扣分（负delta）→ 200
  const r22 = await T('扣分-10', () => httpReq('POST', `/api/classes/${clsId}/students/${stuId}/points`, { delta: -10, reason: '违纪' }, teachCookie));
  // 23. 非法手机号注册 → 400
  const r23 = await T('边界-非法手机号400', async () => { const r = await httpReq('POST', '/api/auth/institution/register', { name: 'X', phone: '123', password: '123456' }, null); return { ...r, status: r.status === 400 ? 200 : r.status, body: r.status === 400 ? { ok: true } : r.body }; });
  // 24. 重复机构手机号 → 409
  const r24 = await T('边界-重复机构手机号409', async () => { const r = await httpReq('POST', '/api/auth/institution/register', { name: '重复', phone: instPhone, password: '123456' }, null); return { ...r, status: r.status === 409 ? 200 : r.status, body: r.status === 409 ? { ok: true } : r.body }; });
  // 25. 未登录访问家长端点 → 401
  const r25 = await T('边界-家长未登录401', async () => { const r = await httpReq('GET', '/api/parent/children', null, null); return { ...r, status: r.status === 401 ? 200 : r.status, body: r.status === 401 ? { ok: true } : r.body }; });
  // 26. 大加分触发多次进化
  const r26 = await T('大加分+500', () => httpReq('POST', `/api/classes/${clsId}/students/${stuId}/points`, { delta: 500, reason: '大爆发' }, teachCookie));

  // 27. 支付回调未配置应拒绝（防止伪造支付直接开通席位）
  const r28 = await T('安全-支付回调未配置拒绝', async () => {
    const r = await httpReq('POST', '/api/payment/notify', { orderId: 'ORD_TEST', sign: 'x', status: 'paid' }, null);
    return { ...r, status: r.status === 400 ? 200 : r.status, body: r.status === 400 ? { ok: true } : r.body };
  });

  // 28-29. 跨机构隔离：机构2 的家长绝不能看到机构1 的孩子（验证学生 ID 全局唯一 + 绑定按班级作用域）
  const ts2 = String(Date.now()).slice(-7) + '1';
  const instPhone2 = '135' + ts2.padStart(8, '0');
  const teachPhone2 = '136' + ts2.padStart(8, '0');
  const parentPhone2 = '137' + ts2.padStart(8, '0');
  let instCookie2 = '', teachCookie2 = '', parentCookie2 = '';
  await T('隔离-机构2注册', () => httpReq('POST', '/api/auth/institution/register', { name: '快乐学堂', phone: instPhone2, password: '123456' }).then(r => { instCookie2 = r.cookie; return r; }));
  await T('隔离-机构2买席位', () => httpReq('POST', '/api/institution/purchase', { childCount: 10 }, instCookie2));
  await T('隔离-机构2加老师', () => httpReq('POST', '/api/institution/teachers', { name: '王老师', phone: teachPhone2, password: 'teacher02' }, instCookie2));
  await T('隔离-老师2登录', () => httpReq('POST', '/api/auth/teacher/login', { phone: teachPhone2, password: 'teacher02' }).then(r => { teachCookie2 = r.cookie; return r; }));
  let clsId2;
  await T('隔离-机构2建班', () => httpReq('POST', '/api/classes', { name: '中班B' }, teachCookie2).then(r => { clsId2 = r.body?.class?.id; return r; }));
  await T('隔离-机构2加学生', () => httpReq('POST', `/api/classes/${clsId2}/students`, { name: '李华' }, teachCookie2));
  let inviteCode2;
  await T('隔离-机构2家长码', () => httpReq('POST', `/api/classes/${clsId2}/parent-code`, {}, teachCookie2).then(r => { inviteCode2 = r.body?.code; return r; }));
  await T('隔离-家长2注册', () => httpReq('POST', '/api/auth/parent/register', { phone: parentPhone2, password: 'parent02', code: inviteCode2, studentName: '李华', consent: true }).then(r => { parentCookie2 = r.cookie; return r; }));
  const r29 = await T('安全-跨机构家长隔离', async () => {
    const r = await httpReq('GET', '/api/parent/children', null, parentCookie2);
    const kids = r.body?.children || [];
    const seesOthers = kids.some(k => k.student_name === '张小明'); // 机构1 的孩子，绝不应出现在机构2 家长视角
    if (r.status === 200 && !seesOthers) return { ...r, status: 200, body: { ok: true, count: kids.length } };
    return { ...r, status: 400, body: { ok: false, seesOthers, kids: kids.map(k => k.student_name) } };
  });

  // 30. 家长2注销账号（验证删除端点可用，且不影响机构1数据）
  const r30 = await T('隔离-家长2注销', () => httpReq('POST', '/api/parent/delete-account', {}, parentCookie2));

  const failCount = results.filter(r => !r.pass).length;
  log(`=== 测试完成: PASS=${results.length - failCount} FAIL=${failCount} ===`);
  return { results, failCount };
}

async function main() {
  fs.writeFileSync(LOG, '');
  log('=== 全自动测试开始 ===');

  // Step 0: 随机端口（只绑定真正空闲的端口，避免旧 zombie server 干扰）
  PORT = await pickFreePort();
  log(`[0] 使用端口: ${PORT}`);

  // Step 1: 清理数据（只用 fs，不依赖外部命令）
  log('[1] 清理数据...');
  for (const f of ['classpet.db', 'classpet.db-wal', 'classpet.db-shm']) {
    const fp = path.join(DATA, f);
    try {
      if (fs.existsSync(fp)) { fs.unlinkSync(fp); log(`  删除 ${f}`); }
      else { log(`  ${f} 不存在，跳过`); }
    } catch (e) { log(`  删除 ${f} 失败: ${e.message}`); }
  }


  // Step 2: 启动服务（使用随机端口）
  log('[2] 启动服务...');
  const server = spawn('node', ['server.js'], { cwd: PROJECT, detached: true, stdio: 'pipe', env: { ...process.env, PORT: String(PORT), ENABLE_KILL: '1' } });
  server.unref();
  log(`  服务进程 PID=${server.pid}`);

  // 捕获启动错误
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d.toString(); });
  server.stderr.on('data', d => { serverLog += '[ERR] ' + d.toString(); });

  // Step 3: 等待服务就绪
  log('[3] 等待服务就绪...');
  const ready = await waitForServer(20000);
  if (!ready) {
    log('  [ERROR] 服务启动失败');
    log('  服务器日志: ' + serverLog.substring(0, 500));
    process.exit(1);
  }
  log('  服务在线');

  // Step 4: 测试
  log('[4] 运行测试...');
  const { failCount } = await runTests();

  log('=== 最终结论 ===');
  if (failCount === 0) {
    log('✅ 全部测试通过（功能 + 安全回归）');
  } else {
    log(`❌ 有 ${failCount} 个失败项，需要修复`);
  }
  // Step 5: 自清理（kill 自己启动的 server，避免 zombie 堆积）
  try { await httpReq('POST', '/api/kill'); } catch {}
  await new Promise(r => setTimeout(r, 500));

  log('=== 测试结束 ===');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
