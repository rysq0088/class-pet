# ClassPet 🐾

让好习惯在教室里"活"起来 —— 用宠物养成驱动的幼儿园课堂正向激励系统。

## 产品定位

- **给老师：** 每天 3 次批量加分（午饭后/午睡后/放学前），每次 2-3 分钟，不打断课堂节奏
- **给小朋友：** 自己的专属宠物，好行为=积分=宠物长大，教室大屏实时展示
- **给家长：** 扫实体二维码卡片，和孩子一起看宠物、逛商店、花积分，是亲子仪式不是手机喂养

**不拍照片 · 不监控 · 不做排名 · 只做正向激励**

## 技术栈

Node.js + Express + better-sqlite3 (WAL 模式) + JWT 认证 + 纯 HTML/CSS/JS 前端

## 快速开始

```bash
npm install
node server.js
# 访问 http://localhost/login
```

## API 一览

| 端点 | 鉴权 | 说明 |
|------|------|------|
| POST /api/register | 无 | 教师注册 |
| POST /api/login | 无 | 教师登录 |
| GET /api/me | JWT | 获取当前教师信息 |
| PUT /api/me | JWT | 修改教师名字 |
| GET/POST /api/classes | JWT | 班级列表/创建 |
| PUT /api/classes/:id | JWT | 修改班级名称 |
| GET /api/classes/:id/history | JWT | 全班积分历史 |
| GET/POST /api/classes/:id/students | JWT | 学生列表/添加 |
| PUT/DELETE /api/classes/:id/students/:sid | JWT | 编辑/删除学生 |
| GET /api/classes/:id/students/:sid/detail | JWT | 学生完整档案 |
| POST /api/classes/:id/scores | JWT | 批量加分 |
| GET /api/classes/:id/today | JWT | 今日加分记录 |
| GET /api/garden/:code | 公开 | 大屏花园数据 |
| GET /api/student/:code/:sid | 公开 | 家长端学生详情 |
| POST /api/student/:code/:sid/buy | 公开 | 商店购买 |

## 页面路由

| 路径 | 说明 |
|------|------|
| / | 产品首页 |
| /demo | 演示模式（无需登录） |
| /login | 教师登录/注册 |
| /teacher | 教师手机打卡端 |
| /admin | 管理后台（5个标签页） |
| /print | 可打印的二维码卡片 |
| /screen/:code | 教室大屏宠物花园 |
| /parent/:code/:sid | 家长端（宠物+商店） |

## 数据库表

| 表 | 说明 |
|------|------|
| teachers | 教师账号 |
| classes | 班级 + 邀请码 |
| students | 学生 + 宠物 + 积分 + 经验 |
| score_logs | 积分流水 |
| purchases | 商店购买记录 |

## 宠物进化

| 经验 | 等级 | 图标 |
|------|------|------|
| 0-9 | 宝宝 | 🥚 |
| 10-39 | 幼年 | 🌱 |
| 40-99 | 成长 | 🌿 |
| 100-249 | 成年 | 🌳 |
| 250+ | 传说 | ⭐ |

## 定价

| 版本 | 价格 | 功能 |
|------|------|------|
| 基础版 | 免费 | 1班·10人·全功能 |
| 高级版 | ¥19.9/月 | 无限班级·无限人数·数据导出 |

## 许可

MIT
