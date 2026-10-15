# PM2 Observatory

一个轻量、本机优先的 macOS 服务仪表盘：统一查看 **多个 PM2 实例与其他 TCP 监听进程**，直接跳转服务、查看状态、资源趋势和日志。

A local-first macOS dashboard for PM2 daemons and TCP listeners. Chinese UI, read-only APIs, no cloud backend, no frontend build step. MIT licensed.

## 快速开始

要求：macOS、Node.js 20+、npm。查看 PM2 数据需要当前用户有权限访问对应 daemon；没有 PM2 也可查看其他监听服务。

```sh
git clone https://github.com/sandy9707/pm2-observatory.git
cd pm2-observatory
npm ci
npm start
```

打开 **http://127.0.0.1:7000/**。仅绑定 loopback，不向局域网公开环境变量或日志。

## 功能

- 顶部统一列表：PM2 进程 + 非 PM2 的 TCP 监听进程，按来源、状态、名称、PID、路径和端口筛选。
- 服务优先排序，按 CPU、RSS 内存、重启次数排序；有 HTTP 入口时提供新标签页跳转。
- 自动发现多套 PM2 home，每 3 秒读取进程状态；端口和非 PM2 进程每 15 秒扫描。
- 根据 PID 和父子进程关系合并服务，避免把 PM2 的子进程重复列为独立服务。
- PM2 CPU / 内存趋势：最多 1200 个采样点，约一小时，重启即清空。两条曲线独立缩放。
- 进程配置、自定义指标和全部 PM2 字段；按名称隐藏常见密钥字段。
- stdout、stderr、daemon 日志，最多读取文件末尾 128 KiB，支持行数、复制和跟随最新。
- 系统 CPU、内存、运行时间；暂停刷新、JSON 导出、⌘K 搜索。
- 原生 HTML/CSS/JavaScript，无前端构建、外部字体、分析统计或遥测。

**统计口径：**总进程数包含其他监听进程；注明 PM2 的汇总和趋势只统计 PM2。非 PM2 的 CPU/RSS 来自 `ps`，不提供伪造的 PM2 重启次数或日志。

## 后台运行

使用机器现有的 PM2（若未安装，可自行 `npm install -g pm2`）：

```sh
pm2 start ecosystem.config.cjs
pm2 logs pm2-observatory --lines 100
pm2 restart pm2-observatory
pm2 stop pm2-observatory
```

默认名称 `pm2-observatory`。配置中的 Node 路径由当前运行环境解析，不包含作者机器路径。

需要在当前 macOS 用户登录时自动启动：

```sh
node scripts/install-launchagent.cjs
```

此脚本只创建本项目的用户级 LaunchAgent，不修改全局 PM2 启动项，不执行 `pm2 save`，不保存其他应用的进程快照。登录后由 LaunchAgent 启动本服务，再由 PM2 负责异常重启。**这不等于无人登录时的系统级开机服务。**项目放在外置卷时，卷必须已挂载。

## 配置

| 环境变量              | 默认值       | 含义                                      |
| --------------------- | ------------ | ----------------------------------------- |
| `DASHBOARD_PORT`      | `7000`       | HTTP 端口；测试可设为 `0` 让系统分配      |
| `DASHBOARD_PM2_HOMES` | 空           | 额外的 PM2 home，macOS 用 `:` 分隔        |
| `PM2_HOME`            | 当前用户默认 | 同时作为额外监控目录和 PM2 CLI 的目标目录 |

```sh
DASHBOARD_PORT=7100 npm start
DASHBOARD_PM2_HOMES="$HOME/.pm2:$HOME/Library/my-service/pm2" npm start
```

配置变化后请重新启动服务；PM2 使用 `--update-env` 传入环境更新。

## 开发与验证

```sh
npm ci
npm run check
npm test
```

测试自行启动临时端口，无需预先运行 dashboard，也不假设本机 PM2 进程数量。集成测试会读取本机可见的监听状态，并发送不跟随跳转的本机 HTTP HEAD 探测；不会停止或启动任何真实 PM2 服务。CI 在 macOS / Node.js 22、24 上执行。

## 范围与限制

- 当前正式支持 macOS，采集依赖 macOS `ps` 与 `/usr/sbin/lsof`；未声称支持 Windows/Linux。
- 只展示当前用户可见的 TCP 监听进程和可连接的 PM2 daemon。不包含 UDP、未启动服务、无监听端口的普通进程或其他账户无权限读取的服务。
- HTTP 探测成功不代表有可视化首页：系统接口可能返回 401、403 或 404。暂不主动识别纯 HTTPS 入口；这些服务仍以监听端口展示。
- 环境字段名称遮盖不是通用脱敏；日志、命令参数、导出文件仍可能有敏感内容。不要公开上传真实日志或快照。
- 同一账户下的本地进程可访问接口。Host / Origin 校验是防跨站读取措施，不是用户身份认证。不要把此服务直接反向代理到公网。
- 端口扫描可能暂时失效，界面会显示采集错误。PM2 运行数据仍独立采集。

## 文档

- [部署、更新与恢复](docs/DEPLOYMENT.md)
- [架构与 API](docs/ARCHITECTURE.md)
- [AI / 人工接手指南](docs/AI_AGENT_HANDOFF.md)
- [当前状态](docs/PROJECT_STATUS.md)
- [已知限制与回归检查](docs/BUGS_AND_REGRESSIONS.md)
- [Agent 兼容说明](docs/AGENT_COMPATIBILITY.md)
- [贡献说明](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [MIT 许可证](LICENSE)
