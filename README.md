# Doc Reader

一个轻量级文档阅读器，支持 Markdown、TXT、JSON 与手机浏览。

![Version](https://img.shields.io/badge/version-1.1.37-blue)
![Python](https://img.shields.io/badge/python-3.8+-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## 功能特性

- 📁 **目录树浏览** - 支持多目录管理，可展开/折叠
- 📖 **Markdown 渲染** - 支持完整的 Markdown 语法
- 🎨 **代码高亮** - 使用 Highlight.js 实现语法高亮
- 📱 **响应式设计** - 完美支持桌面和移动设备
- 🔍 **文档搜索** - 快速全文搜索
- 🌙 **暗色模式** - 支持亮色/暗色主题切换
- 🔐 **JWT 认证** - 可选的用户认证系统
- 🔗 **只读分享链接** - 为单个文档生成可过期、可撤销、可限制访问次数的公开链接
- 🔗 **内部链接** - 支持 Markdown 文档间跳转
- 📋 **目录导航** - 自动生成文章目录
- ⌨️ **快捷键** - Cmd+K 搜索，Cmd+\ 切换侧边栏

## 截图

> 建议添加项目截图到 `screenshots/` 目录

## 快速开始

### 方式一：一键安装（推荐）

只需一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/EaniaHuui/doc-reader/main/install.sh | bash
```

安装完成后：

```bash
# 进入目录
cd ~/doc-reader

# 编辑配置文件（配置你的文档目录）
vi config.yaml

# 启动服务
./start.sh
```

### 方式二：克隆安装

```bash
# 克隆仓库
git clone https://github.com/EaniaHuui/doc-reader.git
cd doc-reader

# 运行安装脚本
./install.sh

# 编辑配置文件
vi config.yaml

# 启动服务
./start.sh
```

### 方式三：手动安装

```bash
# 克隆仓库
git clone https://github.com/EaniaHuui/doc-reader.git
cd doc-reader

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 复制配置文件
cp config.yaml.example config.yaml

# 编辑配置文件
vi config.yaml

# 启动服务
python app.py
```

访问 http://localhost:5000

## 配置说明

编辑 `config.yaml` 文件进行配置：

```yaml
# 文档目录（支持多个）
directories:
  - path: ~/Documents/markdown
    name: 示例文档

# 服务器配置
server:
  host: 127.0.0.1
  port: 5000
  debug: false

# 认证配置
auth:
  enabled: false
  jwt_secret: "your-secret-key"
  token_expiration_hours: 720
  users:
    - username: change-me
      password: change-me-too
      hashed: false

# 功能开关
features:
  search: true
  dark_mode: true
```

### 配置项说明

| 配置项 | 说明 |
|--------|------|
| `directories` | 文档目录列表，支持配置多个 |
| `server.host` | 监听地址，`0.0.0.0` 表示所有网卡 |
| `server.port` | 监听端口 |
| `auth.enabled` | 是否启用认证，公开部署前建议配置好密钥和账户后再开启 |
| `auth.jwt_secret` | JWT 密钥，**生产环境请务必修改** |
| `auth.users` | 用户列表 |

### 隐私与开源说明

- `config.yaml` 仅用于本地运行，不应提交到公开仓库。
- `directories.json` 会保存你本地添加过的目录列表，也不应提交。
- `share_links.json` 会保存公开分享令牌，也不应提交。
- 运行日志如 `server.log` 可能包含本地路径和访问记录，不应提交。
- `docs/brainstorms/` 与 `docs/plans/` 如包含内部工作草稿，公开前建议移出仓库或单独整理后再发布。
- 建议公开仓库时仅保留 `config.yaml.example` 作为示例配置。

## 技术栈

- **后端**: Python Flask
- **前端**: 原生 JavaScript + CSS
- **Markdown**: Python-Markdown
- **代码高亮**: Highlight.js
- **认证**: JWT

## 项目结构

```
doc-reader/
├── app.py              # Flask 主程序
├── config.yaml         # 本地配置文件（不要提交）
├── share_links.json    # 分享链接本地存储（自动生成，不要提交）
├── requirements.txt    # Python 依赖
├── install.sh          # 一键安装脚本
├── start.sh            # 启动脚本
├── static/
│   ├── script.js       # 前端 JavaScript
│   └── style.css       # 样式文件
└── templates/
    └── index.html      # 主页面模板
```

## 支持的文件类型

| 类型 | 说明 |
|------|------|
| `.md` | Markdown 文件，完整渲染 |
| `.txt` | 纯文本文件，预览显示 |
| `.json` | JSON 文件，格式化显示 |
| 图片 | 支持 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg`、`.ico` 预览和相对路径图片显示 |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + K` | 打开搜索 |
| `Cmd/Ctrl + \` | 切换侧边栏 |

## 开发

```bash
# 安装开发依赖
pip install -r requirements.txt

# 启动调试模式
python app.py
```

## 开源前检查清单

- 确认 `config.yaml` 未提交，仓库中只保留 `config.yaml.example`。
- 确认 `directories.json` 未提交，避免暴露本地目录结构。
- 清理 `server.log`、`.gstack/`、截图草稿和其他本地运行产物。
- 检查 GitHub 仓库名、README 标题、远程地址是否统一为 `doc-reader`。
- 如果之前提交过真实凭据，公开前应继续确认远程历史里也已清除。

## 贡献

欢迎提交 Issue 和 Pull Request！

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

## 许可证

[MIT License](LICENSE)

## 更新日志

查看 [VERSION](VERSION) 文件了解版本历史。
