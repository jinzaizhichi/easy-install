# Sudoku 一键部署脚本

[English](#english) | [中文](#中文)

---

<a name="中文"></a>
## 🚀 快速开始

在你的 Linux 服务器上运行以下命令：

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"
```

Cloudflare Worker 入口部署请看：[README.worker.zh-CN.md](./README.worker.zh-CN.md)。如果用户没有 GitHub，也可以直接使用仓库里的单文件版 `cf-worker/dashboard/sudoku-worker.one.js` 粘贴到 Cloudflare Dashboard 的 Hello World Worker 中。Worker 管理页会先用 `cf.877774.xyz` 占位，页面加载后直接读取 `https://ip.164746.xyz/` 的第一个结果作为导出的 `server_address`。

---

## 💻 客户端配置

服务端部署完成后，脚本会输出 **短链接** 和 **Mihomo HTTPS 订阅链接**。桌面端（Windows/macOS/Linux）请统一使用官方 GUI 客户端：[`sudoku-desktop`](https://github.com/SUDOKU-ASCII/sudoku-desktop)。

### 桌面 GUI 客户端（Windows / macOS / Linux）

#### 1. 下载并安装

从 [`sudoku-desktop` Releases](https://github.com/SUDOKU-ASCII/sudoku-desktop/releases) 下载对应系统包：
- Windows: `sudoku4x4_*_windows-amd64.zip`
- macOS Intel: `sudoku4x4_*_darwin-amd64.dmg`
- macOS Apple Silicon: `sudoku4x4_*_darwin-arm64.dmg`
- Linux: `sudoku4x4_*_linux-amd64.tar.gz`


#### 2. 导入短链接

1. 打开客户端，进入 **节点 (Nodes)** 页面
2. 点击 **新增节点 (Add Node)**
3. 在 **短链接快速导入** 区域粘贴 `sudoku://...`
4. 点击 **解析短链接**（或直接用 **剪贴板一键识别**）
5. 点击 **保存**

#### 3. 启动代理

1. 选择刚导入的节点并点击 **使用**
2. 在总览页点击 **启动**
3. 客户端会负责代理启停（托盘菜单也可 **Start Proxy / Stop Proxy**）

默认本地端口仍为 `127.0.0.1:10233`（如你未在节点里修改 `localPort`）。

#### 4. 平台说明

- macOS：首次打开若被拦截，先执行以下命令清理隔离属性后再打开：
  ```bash
  xattr -cr "/Applications/sudoku4x4.app"
  ```
- macOS / Linux：启用/停止 `TUN` 时系统可能弹密码框，这是正常行为。

---

### Android 客户端 (Sudodroid)

#### 1. 下载安装

从 [GitHub Releases](https://github.com/SUDOKU-ASCII/sudoku-android/releases) 下载最新 APK 并安装。

> 💡 如需自行编译，请参考项目的 [README](https://github.com/SUDOKU-ASCII/sudoku-android)。

#### 2. 导入短链接

打开 Sudodroid 后，有以下方式导入节点：

**方法一：使用「Quick Import」快捷导入**

1. 点击右下角 **「+」** 浮动按钮
2. 在弹出的对话框顶部找到 **「Quick Import」** 区域
3. 将 `sudoku://...` 短链接粘贴到输入框中
4. 点击 **「Import Short Link」** 按钮
5. 节点会自动导入并被选中

**方法二：使用剪贴板粘贴**

1. 复制服务端生成的短链接（以 `sudoku://` 开头）
2. 打开 Sudodroid，点击 **「+」** 按钮
3. 在 **「sudoku:// link」** 输入框右侧点击 **📋 粘贴图标**
4. 系统会自动从剪贴板读取内容
5. 点击 **「Import Short Link」** 完成导入


#### 3. 连接 VPN

1. 选择一个节点（点击节点卡片）
2. 点击顶部 **「Start VPN」** 按钮
3. 首次连接会请求 VPN 权限，点击「确定」授权
4. 连接成功后，状态栏会显示 VPN 图标

---

### 脚本功能

- ✅ 自动检测系统架构 (amd64/arm64)
- ✅ 从 GitHub Releases 下载最新版本
- ✅ 自动生成密钥对
- ✅ 自动获取服务器公网 IP
- ✅ 创建 systemd 服务（开机自启）
- ✅ 自动部署 Cloudflare 风格 500 错误页回落站（默认 `127.0.0.1:10232`，失败则回落 `127.0.0.1:80`）
- ✅ 自动配置 UFW 防火墙（如果启用）
- ✅ 输出短链接和 Mihomo HTTPS 订阅链接

### 默认配置

| 配置项 | 默认值 |
|--------|--------|
| 端口 | `50001-65535` 内随机可用端口 |
| 模式 | `up_ascii_down_entropy` |
| AEAD | `chacha20-poly1305` |
| X/P/V 表 | 随机 `custom_table` |
| 纯 Sudoku 下行 | `false` (带宽优化模式) |
| HTTP 掩码 | `true` (`auto`) |
| HTTP 掩码路径前缀 | 随机 `6-10` 位小写字母 |

### 自定义配置

通过环境变量自定义安装：

```bash
# 自定义端口
sudo SUDOKU_PORT=8443 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 自定义回落地址
sudo SUDOKU_FALLBACK="127.0.0.1:8080" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 关闭 Cloudflare 500 错误页回落站（将不会自动覆盖 SUDOKU_FALLBACK）
sudo SUDOKU_CF_FALLBACK=false bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 自定义 Cloudflare 500 错误页回落站端口（优先 10232，失败再尝试 80）
sudo SUDOKU_CF_FALLBACK_PORT=10232 SUDOKU_CF_FALLBACK_FALLBACK_PORT=80 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 指定短链接/导出节点使用的域名或 IP（例如走 CDN 时用域名）
sudo SERVER_IP="example.com" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 指定 Mihomo HTTPS 订阅使用的域名（默认：SERVER_IP 为域名时直接使用，否则自动派生为 <ipv4>.sslip.io）
sudo SUDOKU_SUBSCRIPTION_DOMAIN="sub.example.com" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Mihomo HTTPS 订阅默认监听 8443，也可以显式覆盖
sudo SUDOKU_SUBSCRIPTION_PORT=8443 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 指定订阅文件路径（默认随机）
sudo SUDOKU_SUBSCRIPTION_PATH="subscription.yaml" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 指定节点名
sudo SUDOKU_SUBSCRIPTION_NODE_NAME="sudoku-hk" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 如需覆盖内置模板，可显式传入自定义模板 URL
sudo SUDOKU_SUBSCRIPTION_TEMPLATE_URL="https://example.com/my-template.yaml" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 关闭 HTTP 掩码（直连 TCP）
sudo SUDOKU_HTTP_MASK=false bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 指定 HTTP 掩码模式（auto / stream / poll / legacy / ws）
sudo SUDOKU_HTTP_MASK_MODE=poll bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# 开启 tunnel 模式 HTTPS（v0.1.4 起不再按端口自动推断 TLS）
sudo SUDOKU_HTTP_MASK_TLS=true bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# HTTP mask/tunnel 路径前缀（一级路径；默认随机 6-10 位小写字母，例如 aabbcc => /aabbcc/session /aabbcc/stream）
sudo SUDOKU_HTTP_MASK_PATH_ROOT=aabbcc bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"
```

### 卸载

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)" -- --uninstall
```

### 更新内核

再次运行一键命令会自动检测已有安装，仅更新 `/usr/local/bin/sudoku` 并重启服务，不会覆盖 `/etc/sudoku/config.json`（如检测到旧版 `http_mask_*` / `disable_http_mask` 遗留字段，会自动迁移到 `httpmask` 结构）。

---

## 📋 输出说明

安装完成后，脚本会输出：

### 1. 短链接 (Short Link)

```
sudoku://eyJoIjoiMS4yLjMuNCIsInAiOjEwMjMzLC...
```

客户端使用方式：
在桌面 GUI 客户端里导入该 `sudoku://...` 短链接即可（见上方「桌面 GUI 客户端」步骤）。

### 2. Mihomo HTTPS 订阅链接

```text
https://1-2-3-4.sslip.io:8443/subscription-xxxxxxxxxxxx.yaml
```

订阅行为说明：
- 脚本会在本机用 ACME 申请证书，并通过 `8443` 输出 HTTPS 订阅；若 `8443` 被占用，会自动切换到 `2053`。
- `80` 端口只在 ACME 申请/续期期间临时占用；若被 `nginx` 等常见 Web 服务占用，脚本会先临时停掉，完成后再恢复。
- 默认只生成一个 `Proxy` 分组，不再保留模板里的 `Auto` 组。
- 若未显式设置 `SUDOKU_SUBSCRIPTION_TEMPLATE_URL`，脚本会使用内置模板，不会把你的私有模板链接写进代码。

导入方式：
- 在 Mihomo / Clash Meta GUI 中选择「订阅 / Profile / Remote URL」之类入口，粘贴上面的 HTTPS 地址即可。

---

## 🌐 平台部署指南

### VPS 部署 (推荐)

直接使用一键脚本即可。支持：
- Ubuntu / Debian
- CentOS / RHEL / AlmaLinux
- Alpine Linux

---

## 🔧 服务管理

```bash
# 查看状态
sudo systemctl status sudoku

# 查看 Cloudflare 500 回落站状态
sudo systemctl status sudoku-fallback

# 重启服务
sudo systemctl restart sudoku

# 查看日志
sudo journalctl -u sudoku -f

# 停止服务
sudo systemctl stop sudoku
```

---

## 📁 文件位置

| 文件 | 路径 |
|------|------|
| 二进制 | `/usr/local/bin/sudoku` |
| 配置文件 | `/etc/sudoku/config.json` |
| 服务文件 | `/etc/systemd/system/sudoku.service` |
| Cloudflare 500 回落站服务 | `/etc/systemd/system/sudoku-fallback.service` |
| Cloudflare 500 回落站文件 | `/usr/local/lib/sudoku-fallback` |

---

<a name="english"></a>
## 🚀 Quick Start (English)

Run on your Linux server:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"
```

---

## 💻 Client Configuration

After server deployment, the script outputs a **short link** and a **Mihomo HTTPS subscription URL**. For desktop use (Windows/macOS/Linux), use the official GUI client: [`sudoku-desktop`](https://github.com/SUDOKU-ASCII/sudoku-desktop).

### Desktop GUI Client (Windows / macOS / Linux)

#### 1. Download and Install

Download your package from [`sudoku-desktop` Releases](https://github.com/SUDOKU-ASCII/sudoku-desktop/releases):
- Windows: `sudoku4x4_*_windows-amd64.zip`
- macOS Intel: `sudoku4x4_*_darwin-amd64.dmg`
- macOS Apple Silicon: `sudoku4x4_*_darwin-arm64.dmg`
- Linux: `sudoku4x4_*_linux-amd64.tar.gz`


#### 2. Import Short Link

1. Open the app and go to **Nodes**
2. Click **Add Node**
3. Paste `sudoku://...` in **Quick short link import**
4. Click **Parse short link** (or use **Parse from clipboard**)
5. Click **Save**

#### 3. Start Proxy

1. Select the imported node and click **Use**
2. Click **Start** in Dashboard
3. You can also use tray menu **Start Proxy / Stop Proxy**

Default local endpoint is still `127.0.0.1:10233` (unless you changed `localPort`).

#### 4. Platform Notes

- macOS: if app launch is blocked on first run, clear quarantine then open again:
  ```bash
  xattr -cr "/Applications/sudoku4x4.app"
  ```
- macOS / Linux: starting/stopping `TUN` may trigger a password prompt; this is expected.

---

### Android Client (Sudodroid)

#### 1. Download

Download the latest APK from [GitHub Releases](https://github.com/SUDOKU-ASCII/sudoku-android/releases).

#### 2. Import Short Link

Open Sudodroid and import nodes using one of these methods:

**Option 1: Quick Import**

1. Tap the **"+"** floating button (bottom right)
2. Find the **"Quick Import"** section at the top of the dialog
3. Paste the `sudoku://...` short link into the input field
4. Tap **"Import Short Link"** button
5. The node will be imported and selected automatically

**Option 2: Clipboard Paste**

1. Copy the short link from server (starts with `sudoku://`)
2. Open Sudodroid, tap **"+"** button
3. Tap the **📋 paste icon** next to the "sudoku:// link" input field
4. The link will be read from clipboard automatically
5. Tap **"Import Short Link"** to complete


#### 3. Connect VPN

1. Select a node (tap the node card)
2. Tap **"Start VPN"** button at the top
3. Grant VPN permission when prompted (first time only)
4. VPN icon appears in status bar when connected


---

### Features

- ✅ Auto-detect system architecture (amd64/arm64)
- ✅ Download latest release from GitHub
- ✅ Generate keypair automatically
- ✅ Detect server public IP
- ✅ Create systemd service (auto-start)
- ✅ Deploy Cloudflare-style 500 error fallback page (default `127.0.0.1:10232`, falls back to `127.0.0.1:80`)
- ✅ Configure UFW firewall (if enabled)
- ✅ Output short link and Mihomo HTTPS subscription URL

### Default Configuration

| Setting | Default |
|---------|---------|
| Port | Random available port in `50001-65535` |
| Mode | `up_ascii_down_entropy` |
| AEAD | `chacha20-poly1305` |
| X/P/V Table | Random `custom_table` |
| Pure Sudoku Downlink | `false` (bandwidth optimized) |
| HTTP Mask | `true` (`auto`) |

### Customization

```bash
# Custom port
sudo SUDOKU_PORT=8443 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Custom fallback
sudo SUDOKU_FALLBACK="127.0.0.1:8080" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Disable Cloudflare 500 fallback page service (will not override SUDOKU_FALLBACK)
sudo SUDOKU_CF_FALLBACK=false bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Customize Cloudflare 500 fallback page ports (try 10232 first, then 80)
sudo SUDOKU_CF_FALLBACK_PORT=10232 SUDOKU_CF_FALLBACK_FALLBACK_PORT=80 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Override advertised host (domain/IP) used in short link and exported Sudoku node (use a domain for CDN)
sudo SERVER_IP="example.com" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Override HTTPS subscription domain (default: use SERVER_IP when it is a domain, otherwise derive <ipv4>.sslip.io)
sudo SUDOKU_SUBSCRIPTION_DOMAIN="sub.example.com" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# HTTPS subscription listens on 8443 by default
sudo SUDOKU_SUBSCRIPTION_PORT=8443 bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Override subscription path
sudo SUDOKU_SUBSCRIPTION_PATH="subscription.yaml" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Override exported node name inside the generated Mihomo profile
sudo SUDOKU_SUBSCRIPTION_NODE_NAME="sudoku-hk" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Override the built-in template with your own remote YAML
sudo SUDOKU_SUBSCRIPTION_TEMPLATE_URL="https://example.com/my-template.yaml" bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Disable HTTP mask (raw TCP)
sudo SUDOKU_HTTP_MASK=false bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# HTTP mask mode (auto / stream / poll / legacy / ws)
sudo SUDOKU_HTTP_MASK_MODE=poll bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# Enable HTTPS in tunnel modes (since v0.1.4, no port-based TLS inference)
sudo SUDOKU_HTTP_MASK_TLS=true bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"

# HTTP mask/tunnel path root (single segment; default is random 6-10 lowercase letters, e.g. aabbcc => /aabbcc/session /aabbcc/stream)
sudo SUDOKU_HTTP_MASK_PATH_ROOT=aabbcc bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)"
```

### Uninstall

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/SUDOKU-ASCII/easy-install/main/install.sh)" -- --uninstall
```

### Update

Re-run the one-click command to update `/usr/local/bin/sudoku` and restart the service; it will not overwrite `/etc/sudoku/config.json` (legacy `http_mask_*` / `disable_http_mask` fields will be migrated into `httpmask` automatically if detected).

---

## 📋 Output

After installation, the script outputs:

### 1. Short Link

```
sudoku://eyJoIjoiMS4yLjMuNCIsInAiOjEwMjMzLC...
```

Client usage:
Import this `sudoku://...` short link in the desktop GUI client (see "Desktop GUI Client" above).

### 2. Mihomo HTTPS Subscription URL

```text
https://1-2-3-4.sslip.io:8443/subscription-xxxxxxxxxxxx.yaml
```

Behavior:
- The script issues a local ACME certificate and serves the Mihomo profile over HTTPS on `8443`; if `8443` is busy, it automatically falls back to `2053`.
- Port `80` is used only temporarily for ACME issue/renew; if it is occupied by common web services such as `nginx`, the script stops them briefly and restores them afterward.
- The generated profile keeps a single `Proxy` group only; the template `Auto` group is removed.
- If `SUDOKU_SUBSCRIPTION_TEMPLATE_URL` is unset, the script uses a built-in template so private template URLs are never baked into the code.

Import this URL in your Mihomo / Clash Meta GUI as a remote profile / subscription.

---

## 🌐 Platform Deployment

### VPS (Recommended)

Use the one-click script directly. Supports:
- Ubuntu / Debian
- CentOS / RHEL / AlmaLinux
- Alpine Linux

---

## 🔧 Service Management

```bash
sudo systemctl status sudoku    # Status
sudo systemctl status sudoku-fallback   # CF fallback page status
sudo systemctl restart sudoku   # Restart
sudo journalctl -u sudoku -f    # Logs
```

---

## License

GPL-3.0
