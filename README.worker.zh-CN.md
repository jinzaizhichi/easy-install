# Sudoku Pure Cloudflare Worker 部署

纯 Cloudflare Worker 的 Sudoku 服务端实现。

- `httpmask.mode = ws`
- `tls = true`
- `aead = none`
- 官方 Go 客户端 `ws` early-handshake（`ed` / `X-Sudoku-Early`）
- 默认 `enable_pure_downlink = false` 的 packed downlink
- 显式开启 `enable_pure_downlink = true`
- `OpenTCP`
- `StartMux` / HTTPMask session mux
- `ascii` 对称模式和方向模式：`prefer_entropy`、`prefer_ascii`、`up_*_down_*`
- 首页先用 `cf.877774.xyz` 占位，页面加载后直接读取 `https://ip.164746.xyz/` 的第一个结果作为 `server_address`



## 目录说明

- `cf-worker/wrangler.toml`
- `cf-worker/src/go-rand.mjs`
- `cf-worker/src/sudoku-table.mjs`
- `cf-worker/src/sudoku-packed.mjs`
- `cf-worker/src/sudoku-protocol.mjs`
- `cf-worker/src/sudoku-config.mjs`
- `cf-worker/src/index.mjs`
- `cf-worker/tools/build-shortlink.mjs`
- `cf-worker/tools/build-one-line-worker.mjs`
- `cf-worker/dashboard/sudoku-worker.one.js`

## 部署步骤

1. 把当前仓库推到你自己的 GitHub 仓库。
2. 在 Cloudflare 控制台进入 `Workers 和 Pages`。
3. 选择 `导入存储库`。
4. 选择这个仓库。
5. 构建根目录选 `cf-worker`。
6. 兼容性日期设为 `2026-01-20`。
7. 部署。

## 无 GitHub 的一行 JS 部署

如果你没有 GitHub，可以直接用 Cloudflare Dashboard 里的 Hello World Worker：

1. 进入 `Workers 和 Pages`。
2. 点 `Create`，创建一个 Hello World Worker。
3. 把编辑器里的默认代码全部删掉。
4. 打开仓库里的 `cf-worker/dashboard/sudoku-worker.one.js`，复制整行内容粘进去。
5. 在 Worker 的 `Settings -> Variables` 里按下面的环境变量表配置。
6. 保存并部署。

如果后续你改了 `cf-worker/src` 下的源码，可以重新生成一行版：

```bash
node cf-worker/tools/build-one-line-worker.mjs
```

## 必填环境变量

| 变量名 | 示例 | 说明 |
| --- | --- | --- |
| `SUDOKU_KEY` | `my-shared-key` | 共享 key |

## 推荐环境变量

| 变量名 | 示例 | 说明 |
| --- | --- | --- |
| `SUDOKU_MANAGE_TOKEN` | `my-secret` | 管理页路径令牌 |
| `SUDOKU_PUBLIC_HOST` | `sudoku.example.com` | 对外给客户端展示的域名 |
| `SUDOKU_HTTP_MASK_PATH_ROOT` | `/aabbcc` | 可选固定 WS 路径前缀；未设置时会按 `SUDOKU_KEY` 稳定派生随机 `6-10` 位小写字母并以 `/` 开头导出 |
| `SUDOKU_PLACEHOLDER_SERVER_ADDRESS` | `cf.877774.xyz` | 首页加载固定优选结果前导出配置使用的占位入口 |
| `SUDOKU_CLIENT_PORT` | `10233` | 导出的客户端本地 mixed 端口 |
| `SUDOKU_HTTP_MASK_HOST` | `cdn.example.com` | 可选，覆盖客户端 Host/SNI |
| `SUDOKU_CLIENT_HTTP_MASK_MODE` | `ws` | 导出的客户端 HTTPMask 模式；需要新版 `auto` 格式时可设为 `auto` |
| `SUDOKU_NODE_NAME` | `sudoku-cf-worker-pure` | Clash 节点名 |
| `SUDOKU_AEAD` | `none` | 默认 `none` |
| `SUDOKU_ASCII` | `prefer_entropy` | 也支持 `prefer_ascii`、`up_ascii_down_entropy`、`up_entropy_down_ascii` |
| `SUDOKU_CUSTOM_TABLE` | `xpxvvpvv` | 可选，自定义表 |
| `SUDOKU_ENABLE_PURE_DOWNLINK` | `false` | 默认 packed downlink；设为 `true` 时导出 pure downlink 客户端配置 |
| `SUDOKU_HTTP_MASK_MULTIPLEX` | `off` | 默认关闭 mux；也支持 `off / auto / on` |



## 部署后路径

假设：

- 域名是 `sudoku.example.com`
- `SUDOKU_MANAGE_TOKEN=my-secret`
- 未显式设置 `SUDOKU_HTTP_MASK_PATH_ROOT`，按 key 稳定派生出一个随机段，例如 `/aabbcc`

则：

- WS 入口：`wss://sudoku.example.com/aabbcc/ws`
- 管理页：`https://sudoku.example.com/my-secret`
- 短链接：`https://sudoku.example.com/my-secret/shortlink`
- 客户端 JSON：`https://sudoku.example.com/my-secret/client.json`
- Clash 配置：`https://sudoku.example.com/my-secret/clash.yaml`

管理页初始会先用占位入口 `cf.877774.xyz:443` 生成短链接、客户端 JSON 和 Clash 配置。页面加载完成后，浏览器会直接请求 `https://ip.164746.xyz/`，取表格里的第一个 IP，并把网页上的导出内容替换为：

- `server_address = <第一个 IP>:443`
- `httpmask.host = sudoku.example.com`
- `tls = true`

也就是说，客户端实际连接固定页面返回的第一个优选 IP，但 `Host/SNI` 仍然走你的域名。`/shortlink`、`/client.json` 和 `/clash.yaml` 这几个接口保持输出占位入口。


## 本地生成短链接

纯 downlink：

```bash
node cf-worker/tools/build-shortlink.mjs \
  --host sudoku.example.com \
  --preferred-address 198.41.192.27:443 \
  --key 'my-shared-key' \
  --aead none \
  --packed-downlink false \
  --node-name sudoku-cf-worker-pure
```

packed downlink + mux：

```bash
node cf-worker/tools/build-shortlink.mjs \
  --host sudoku.example.com \
  --preferred-address 198.41.192.27:443 \
  --key 'my-shared-key' \
  --aead none \
  --packed-downlink true \
  --mux on \
  --node-name sudoku-cf-worker-packed
```
