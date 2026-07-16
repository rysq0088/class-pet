#!/usr/bin/env node
/**
 * 解锁码生成工具（仅供开发者使用）
 *
 * 用法:
 *   node generate-code.js              → 显示帮助
 *   node generate-code.js 3 30         → 生成3个班/30天月度包
 *   node generate-code.js 10 365       → 生成10个班/365天年度包
 *   node generate-code.js 999 0        → 生成不限班/永久包
 *
 * 生成的码结构: XXXXXXXX-<maxSeats>-<days>
 *   前8位 = HMAC-SHA256(MASTER_SECRET, "maxSeats:days") 截取
 *   后两段 = 明文参数（服务器解析验证）
 */

const crypto = require('crypto');
const MASTER_SECRET = process.env.MASTER_SECRET || 'class-pet-master-2026';

const args = process.argv.slice(2);

if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
🔑 班级宠物管理系统 — 解锁码生成器

用法:
  node generate-code.js <maxSeats> <days> [count]

参数:
  maxSeats  班级席位上限（1-999，999=不限）
  days      有效天数（0=永久）
  count     生成数量（默认1，最多10）

套餐参考:
  月度包   ¥9.9    3个班  30天    → generate-code.js 3 30
  年度包   ¥49     10个班 365天   → generate-code.js 10 365
  永久包   ¥99     不限班 永久    → generate-code.js 999 0

示例:
  node generate-code.js 3 30          → 生成1个月度码
  node generate-code.js 10 365 5      → 生成5个年度码
`);
  process.exit(0);
}

const maxSeats = parseInt(args[0]);
const days = parseInt(args[1]);
const count = Math.min(parseInt(args[2] || '1'), 10);

if (isNaN(maxSeats) || maxSeats < 1) {
  console.error('❌ maxSeats 必须是 >=1 的整数');
  process.exit(1);
}
if (isNaN(days) || days < 0) {
  console.error('❌ days 必须是 >=0 的整数（0=永久）');
  process.exit(1);
}

console.log(`\n🔑 解锁码生成 [MASTER_SECRET: ${MASTER_SECRET.substring(0, 8)}...]`);
console.log(`   配置: ${maxSeats === 999 ? '不限' : maxSeats}个班 · ${days === 0 ? '永久' : days + '天'}`);
console.log(`   生成: ${count} 个\n`);

for (let i = 0; i < count; i++) {
  // 加个随机salt防止两个码一样
  const salt = crypto.randomBytes(2).toString('hex').toUpperCase();
  const payload = `${maxSeats}:${days}:${salt}`;
  const hmac = crypto.createHmac('sha256', MASTER_SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 8)
    .toUpperCase();
  const code = `${hmac}-${maxSeats}-${days}-${salt}`;
  console.log(`  ${i + 1}. ${code}`);

  // 打印信息
  const desc = days === 0 ? '永久有效' : `${days}天有效`;
  const seats = maxSeats === 999 ? '不限班级' : `${maxSeats}个班级`;
  console.log(`     → ${seats} · ${desc}\n`);
}

console.log('---');
console.log('⚠️  这些码只能在部署了相同 MASTER_SECRET 的服务器上使用');
console.log('   部署时请通过环境变量 MASTER_SECRET 设置密钥\n');
