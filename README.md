# codex-acc

> Codex / Claude 多账号管理工具 | Multi-account manager for Codex CLI and Claude Code

[![npm version](https://img.shields.io/npm/v/codex-acc.svg)](https://www.npmjs.com/package/codex-acc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

---

`codex-acc` 是 [OpenAI Codex CLI](https://github.com/openai/codex) 与 Claude Code 的多账号管理包装工具。它让你可以保存多个 Codex / Claude 账号，随时一键切换，并实时查看每个账号的额度剩余情况。

`codex-acc` is a multi-account wrapper for the [OpenAI Codex CLI](https://github.com/openai/codex) and Claude Code. Save multiple accounts, switch between them instantly, and check real-time quota usage.

---

## 为什么不用 cc-switch？| Why not cc-switch?

[cc-switch](https://www.npmjs.com/package/cc-switch) 是另一款 Codex 账号切换工具，`codex-acc` 在两个核心场景上有明显优势：

### 1. 按别名直接启动，无需菜单

```bash
# codex-acc：一条命令，指定别名直接启动
codex-cc gmail
codex-cc work --model o4-mini

# cc-switch：每次都要进交互菜单选择
```

你可以把常用账号的别名写进 shell alias 或脚本，做到真正的"零交互启动"：

```bash
# ~/.zshrc
alias cx='codex-cc gmail'
alias cxw='codex-cc work'
```

### 2. 实时查看所有账号额度，一目了然

```bash
codex-cc list
```

并发查询所有账号的**5小时窗口额度**和**周额度**，以表格展示，额度不足 20% 自动红色告警：
<img width="1039" height="506" alt="image" src="https://github.com/user-attachments/assets/10211eec-d4ba-4b3c-8bac-5ff5a264d83f" />

```
┌──────┬───────┬──────────────────┬──────┬─────────────────────────────┬─────────────────────────────┐
│ 当前 │ 别名  │ 账号             │ 套餐 │ 5h额度                      │ 周额度                      │
├──────┼───────┼──────────────────┼──────┼─────────────────────────────┼─────────────────────────────┤
│ 是   │ gmail │ user@gmail.com   │ Pro  │ 80% 剩余（今日 18:00 恢复） │ 60% 剩余（03-28 恢复）      │
│      │ 163   │ user@163.com     │ Team │ 45% 剩余（今日 20:00 恢复） │ 15% 剩余（03-29 恢复）  🔴  │
└──────┴───────┴──────────────────┴──────┴─────────────────────────────┴─────────────────────────────┘
```

cc-switch 不提供额度查询功能，你只能在启动后才发现某个账号额度已耗尽。

---

## 功能特性 | Features

- **多账号存储**：保存任意数量的 Codex / Claude 账号，每个账号设置一个别名
- **一键切换**：交互式菜单按额度排序，快速选择并启动对应原生命令
- **实时额度**：并发查询所有账号的 5 小时窗口额度和周额度，低于 20% 红色告警
- **参数透传**：切换账号后，所有额外参数原样传递给原生 `codex` 或 `claude`
- **代理支持**：通过环境变量配置 HTTP/HTTPS 代理
- **跨平台**：macOS、Linux、Windows 均可使用

---

## 前置要求 | Prerequisites

1. 已安装 [Node.js](https://nodejs.org) **v18+**
2. 已安装 [OpenAI Codex CLI](https://github.com/openai/codex)：
   ```bash
   npm install -g @openai/codex
   ```

---

## 安装 | Installation

```bash
npm install -g codex-acc
```

升级：

```bash
npm update -g codex-acc
```

---

## 快速开始 | Quick Start

### 第一步：登录并保存账号

```bash
codex-cc login
```

此命令会先让你选择要登录 `Codex` 还是 `Claude`，然后启动对应原生登录流程。登录完成后提示你输入一个别名（如 `163`、`gmail`、`work`），账号将以该别名保存到本地。

如果当前 `Codex` 或 `Claude` 已经存在登录态，但还没加入 `codex-cc` 列表，那么执行 `codex-cc`、`codex-cc list` 或 `codex-cc <别名>` 时，会自动将该账号加入列表，默认别名优先使用 `default`。

### 重新登录并覆盖已有账号

```bash
codex-cc relogin 163
```

当某个别名账号出现登录态异常时，可以直接执行 `codex-cc relogin <别名>`。命令会重新拉起对应工具的原生登录流程，登录完成后覆盖该别名对应的本地账号快照。

### 第二步：启动 Codex（交互式选择）

```bash
codex-cc
```

弹出交互菜单，列出所有已保存账号（按额度从高到低排序），选择后自动切换并启动对应原生命令。

### 直接通过别名启动

```bash
codex-cc 163
```

### 切换账号并透传参数给 codex

```bash
codex-cc gmail --model o4-mini
codex-cc claude-work --model claude-sonnet-4-6
```

---

## 命令参考 | Commands

| 命令 | 说明 |
|------|------|
| `codex-cc` | 交互式菜单，选择账号后启动对应原生命令 |
| `codex-cc login [codex|claude]` | 登录指定工具并保存账号 |
| `codex-cc relogin <别名>` | 重新登录并覆盖指定别名账号 |
| `codex-cc list` | 查看所有账号及实时额度 |
| `codex-cc clear [codex|claude|<别名>]` | 清理指定工具当前登录态 |
| `codex-cc rename <旧别名> <新别名>` | 重命名已保存账号别名 |
| `codex-cc <别名>` | 切换到指定账号并启动对应原生命令 |
| `codex-cc <别名> [参数...]` | 切换账号后透传参数给 codex 或 claude |
| `codex-cc --help` | 显示帮助信息 |

---

## 登录态保活 | Auth Keepalive

- `codex-cc list` 和 `codex-cc <别名>` 在查询额度前，会先检查本地 `access_token` 是否已过期；若已过期，或 `last_refresh` 距今超过 8 天，会优先尝试使用 `refresh_token` 自动刷新。
- 若额度接口返回 `401`，脚本会按 Codex managed auth 的方式再尝试一次 `refresh_token` 刷新，并使用新 token 重试一次额度查询。
- 当刷新失败时，日志会优先展示明确原因，例如 `token_expired`、`refresh_token_reused`、`refresh_token_expired`，而不是只显示“接口返回 401”。
- Claude 账号额度直接调用 Claude Code 的 OAuth Usage 接口 `https://api.anthropic.com/api/oauth/usage`，按官方返回的利用率换算成剩余额度。
- 若列表或启动时命中 Codex 的 `401`、`402`、`refresh_token` 失效，或 Claude 的 OAuth 过期 / 鉴权失败等场景，日志会明确提示执行 `codex-cc relogin <别名>`。

---

## 额度展示说明 | Quota Display

执行 `codex-cc list` 或启动时，会实时查询每个账号的额度并以表格展示：

```
┌──────┬───────────────┬──────────────────────────┬──────┬──────────────────────────────┬──────────────────────────────┬────────────────────┐
│ 当前 │ 别名          │ 账号                     │ 套餐 │ 5h额度                       │ 周额度                       │ 更新时间           │
├──────┼───────────────┼──────────────────────────┼──────┼──────────────────────────────┼──────────────────────────────┼────────────────────┤
│ 是   │ gmail         │ user@gmail.com           │ Pro  │ 80% 剩余（今日 18:00 恢复）  │ 60% 剩余（03-28 10:30 恢复） │ 2026-03-22 10:30   │
│      │ 163           │ user@163.com             │ Team │ 45% 剩余（今日 20:00 恢复）  │ 30% 剩余（03-29 09:00 恢复） │ 2026-03-22 10:30   │
└──────┴───────────────┴──────────────────────────┴──────┴──────────────────────────────┴──────────────────────────────┴────────────────────┘
```

- **5h额度**：当前 5 小时滚动窗口的剩余用量百分比
- **周额度**：本周剩余用量百分比
- 额度不足 **20%** 时显示为**红色**警告
- 账号列表按周额度降序、5h额度降序、别名字母顺序排列

---

## 数据存储 | Data Storage

账号信息存储在本地，不上传任何服务器：

| 文件 | 说明 |
|------|------|
| `~/.codex/codex-cc.json` | 账号快照存储（别名、认证信息、额度缓存） |
| `~/.codex/auth.json` | 当前生效的 Codex 认证信息 |
| `~/.claude.json` | 当前生效的 Claude 认证信息 |
| `~/.codex-acc/logs/` | 运行日志目录 |

---

## 代理配置 | Proxy Configuration

如果你的网络需要通过代理访问 ChatGPT API，`codex-acc` 会直接继承本机当前 shell 的代理环境变量。优先级如下：

```bash
CODEX_ACC_PROXY > HTTPS_PROXY > HTTP_PROXY > ALL_PROXY
```

例如：

```bash
export CODEX_ACC_PROXY=http://127.0.0.1:7890

# 或直接复用你本机已经设置的通用代理
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export ALL_PROXY=socks5://127.0.0.1:7890
```

也就是说，如果你本地 `codex`、浏览器或其他 CLI 已经依赖这些代理变量联网，`codex-acc` 查询额度时会走同一套代理配置，不需要额外再开一套。

---

## 环境变量 | Environment Variables

| 变量名 | 说明 |
|--------|------|
| `CODEX_ACC_PROXY` | HTTP/HTTPS 代理地址 |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | 通用代理环境变量（备用） |
| `CODEX_ACC_FORCE_VPN` | 设为 `1` 启用 VPN 感知 DNS 解析 |
| `CODEX_ACC_DNS` | 自定义 DNS 服务器地址（配合 VPN 使用） |
| `CODEX_ACC_DNS_DOMAINS` | 自定义需要走 VPN DNS 的域名后缀，逗号分隔 |
| `VERBOSE` | 设为 `true` 开启调试日志 |

---

## 常见问题 | FAQ

**Q: `codex` 命令找不到怎么办？**

请先安装 Codex CLI：
```bash
npm install -g @openai/codex
```

**Q: 额度查询失败显示"查询失败"？**

- 检查网络是否能访问 `chatgpt.com`
- 如需代理，设置 `CODEX_ACC_PROXY` 环境变量
- 账号 token 可能已过期；当前版本会先自动尝试 `refresh_token` 刷新
- 如果日志里出现 `refresh_token_reused`、`refresh_token_expired`、`refresh_token_invalidated`，或者出现 `401/402` 重新登录提示，请执行 `codex-cc relogin <别名>`

**Q: 如何删除某个账号？**

直接编辑 `~/.codex/codex-cc.json`，删除对应别名的条目后保存即可。

**Q: 如何重命名某个账号别名？**

直接执行：

```bash
codex-cc rename default work
```

如果重命名的是当前账号，脚本会同步更新当前账号标记。

**Q: Windows 下能用吗？**

可以，Windows 下通过 `shell: true` 调用 `codex`，功能完全兼容。

**Q: codex-cc 和 codex-acc 什么关系？**

`codex-acc` 是 npm 包名，`codex-cc` 是安装后的 CLI 命令名。

---

## 开发 | Development

```bash
git clone https://github.com/VangelisHaha/codex-acc.git
cd codex-acc
npm install
node bin/codex-cc.js --help
```

---

## License

[MIT](LICENSE)
