# MIGRATION.md — ClassPet 换电脑迁移指南

## 备份什么

需要从旧电脑拷贝 3 个目录到新电脑：

| 目录 | 说明 | 大小约 |
|------|------|--------|
| `~\.qclaw\workspace-lqnapxrjdq1wfjhu\` | 所有项目代码（class-pet、content-engine 等） | ~20MB |
| `~\.qclaw\skills\` + `~\.qclaw\skillhub-skills\` | 已安装的所有 skill | ~10MB |
| `~\.ssh\` | SSH 密钥（连接服务器用） | ~5KB |

> `~` = `C:\Users\你的用户名\`

## 方案 A：云备份（推荐，自动化）

使用 cloud-upload-backup skill，一条命令搞定：

> 对我说：「把我的工作空间备份到云端」

然后在新电脑上：
> 对我说：「从云端恢复我的工作空间」

## 方案 B：手动 U 盘 / 网盘

### 旧电脑上
```powershell
# 打包所有关键数据
Compress-Archive -Path `
  "$env:USERPROFILE\.qclaw\workspace-lqnapxrjdq1wfjhu",
  "$env:USERPROFILE\.qclaw\skills",
  "$env:USERPROFILE\.qclaw\skillhub-skills",
  "$env:USERPROFILE\.ssh" `
  -DestinationPath "$env:USERPROFILE\Desktop\openclaw-backup.zip"
```

得到一个 `openclaw-backup.zip`，拷到 U 盘 / 百度网盘 / 腾讯微云。

### 新电脑上
1. 安装 OpenClaw + 登录同一账号
2. 把 `openclaw-backup.zip` 放到桌面
3. 运行：
```powershell
Expand-Archive "$env:USERPROFILE\Desktop\openclaw-backup.zip" -DestinationPath "$env:USERPROFILE\" -Force
```

## 服务器连接恢复

新电脑的 SSH 密钥是新的，需要在服务器上加一次：

**新电脑上获取公钥：**
```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

**然后告诉我**，我帮你加到服务器（或你自己在网页终端跑）：
```bash
echo "新公钥内容" >> /root/.ssh/authorized_keys
```

---

## 重要提醒

- **聊天记录**：OpenClaw 服务端保存，换电脑不丢
- **Skill 配置**：在 `~/.qclaw/skills/` 下，备份了就完整恢复
- **服务器密码**：已改用密钥，不再依赖密码
- **隧道 URL**：每次服务器重启会变，ROADMAP 里已记录买域名计划（30-60 元/年解决）
