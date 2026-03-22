# codex-acc

> Codex 多账号管理工具 | Multi-account manager for OpenAI Codex CLI

[![npm version](https://img.shields.io/npm/v/codex-acc.svg)](https://www.npmjs.com/package/codex-acc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

---

`codex-acc` 是 [OpenAI Codex CLI](https://github.com/openai/codex) 的多账号管理包装工具。它让你可以保存多个 Codex 账号，随时一键切换，并实时查看每个账号的额度剩余情况。

`codex-acc` is a multi-account wrapper for the [OpenAI Codex CLI](https://github.com/openai/codex). Save multiple accounts, switch between them instantly, and check real-time quota usage.

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

- **多账号存储**：保存任意数量的 Codex 账号，每个账号设置一个别名
- **一键切换**：交互式菜单按额度排序，快速选择并启动
- **实时额度**：并发查询所有账号的 5 小时窗口额度和周额度，低于 20% 红色告警
- **参数透传**：切换账号后，所有额外参数原样传递给原生 `codex`
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

此命令会启动原生 `codex login` 流程，登录完成后提示你输入一个别名（如 `163`、`gmail`、`work`），账号将以该别名保存到本地。

### 第二步：启动 Codex（交互式选择）

```bash
codex-cc
```

弹出交互菜单，列出所有已保存账号（按额度从高到低排序），选择后自动切换并启动 `codex`。

### 直接通过别名启动

```bash
codex-cc 163
```

### 切换账号并透传参数给 codex

```bash
codex-cc gmail --model o4-mini
codex-cc work -q "帮我写一个快排算法"
```

---

## 命令参考 | Commands

| 命令 | 说明 |
|------|------|
| `codex-cc` | 交互式菜单，选择账号后启动 codex |
| `codex-cc login` | 登录 Codex 并保存账号 |
| `codex-cc list` | 查看所有账号及实时额度 |
| `codex-cc clear` | 删除当前 `~/.codex/auth.json`（退出登录） |
| `codex-cc <别名>` | 切换到指定账号并启动 codex |
| `codex-cc <别名> [参数...]` | 切换账号后透传参数给 codex |
| `codex-cc --help` | 显示帮助信息 |

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
| `~/.codex/auth.json` | 当前生效账号的认证信息（原生 codex 使用） |
| `~/.codex-acc/logs/` | 运行日志目录 |

---

## 代理配置 | Proxy Configuration

如果你的网络需要通过代理访问 ChatGPT API，可通过以下环境变量配置：

```bash
# 优先级从高到低
export CODEX_ACC_PROXY=http://127.0.0.1:7890
# 或使用通用环境变量
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

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
- 账号 token 可能已过期，重新执行 `codex-cc login` 刷新

**Q: 如何删除某个账号？**

直接编辑 `~/.codex/codex-cc.json`，删除对应别名的条目后保存即可。

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
