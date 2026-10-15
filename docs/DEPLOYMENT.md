# 部署、维护与备份

## 安装前

确认 Node.js 20+、npm、Git 和当前用户的 PM2 可用。运行 `lsof -nP -iTCP:7000 -sTCP:LISTEN` 检查端口，不要为了腾端口终止其他应用。macOS Control Center 的 `*:7000` 与本项目精确绑定 `127.0.0.1:7000` 在已验证机器上可以共存；若仍报 EADDRINUSE，改用 `DASHBOARD_PORT=7100`。

建议把源码放在稳定目录，比如 `$HOME/Projects/pm2-observatory`。项目根目录包含所有源码；`node_modules` 可用 `npm ci` 恢复。项目所在目录不要与其他应用混用。

## 启动与访问

```sh
npm ci
npm run check
npm test
pm2 start ecosystem.config.cjs
curl -fsS http://127.0.0.1:7000/api/snapshot > /dev/null
node scripts/install-launchagent.cjs
```

用浏览器打开 `http://127.0.0.1:7000`。在另一台电脑上访问，使用已有 SSH 权限建立隧道（替换账号/IP）：

```sh
ssh -N -L 7000:127.0.0.1:7000 user@mini-host
```

客户端打开 `http://127.0.0.1:7000`。转发端口必须与远端监听端口一致，因为服务校验 Host。客户端端口已占用时，可在远端配置 `DASHBOARD_PORT=7100`，然后两端都用 7100。不要禁用 Host/Origin 校验来迁就代理。

## 更新

先查看 `git status`，不要覆盖未提交的改动。

```sh
git fetch --tags
git pull --ff-only
npm ci
npm run check
npm test
pm2 restart pm2-observatory --update-env
```

如果路径或 Node/PM2 安装位置变化，重新运行 `node scripts/install-launchagent.cjs`，它会备份本项目原有 plist 到 `local/`。

## 备份

完整源码的首选备份是 GitHub + 本机 Git 历史。发布前也可建立离线备份：

```sh
mkdir -p backups
git bundle create backups/pm2-observatory.bundle --all
git archive --format=tar.gz --output=backups/pm2-observatory-source.tar.gz HEAD
shasum -a 256 backups/*
```

`backups/` 和 `local/` 已加入 gitignore。部署时可把机器路径、Node 路径、PM2 home、启动项位置、部署 commit 和验证结果记录在 `local/DEPLOYMENT.md`，不要提交机器专属信息、日志或登录凭据。

恢复：`git clone backups/pm2-observatory.bundle recovered`，进入恢复目录运行 `npm ci`、测试、PM2 启动并重新安装登录启动项。

## 停止与卸载

仅临时停止：`pm2 stop pm2-observatory`。它可能在下次登录时被本项目启动项重新启动。

永久移除启动项和本服务：

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.sandy9707.pm2-observatory.plist"
rm "$HOME/Library/LaunchAgents/io.github.sandy9707.pm2-observatory.plist"
pm2 delete pm2-observatory
```

这些操作不触碰其他 PM2 进程。保留源码和离线 bundle 作为备份即可。

## 故障排查

- 空列表：检查 `ps ax` 中的 PM2 daemon、PM2_HOME 以及 socket 读取权限；不要盲目新建 daemon。
- 本机服务扫描失败：在相同用户下运行 `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN`，确认系统权限。
- 非 PM2 没日志：设计如此。只提供 PM2 已报告的日志路径，避免任意文件读取。
- 外置卷未挂载：先挂载原路径，再启动服务；若路径变更，重新安装启动项。
- 登录启动失败：查看 `$HOME/Library/Logs/pm2-observatory/login.err.log` 和 `launchctl print gui/$(id -u)/io.github.sandy9707.pm2-observatory`。
- GitHub CI 与本机不同：测试应适应 0 个 PM2 实例，不要把真实机器进程数写进断言。

登录启动项的工作目录使用用户 home，启动日志写入 Library/Logs。不要将这两项改到 Documents 或受限外置目录：launchd 可能在启动程序前直接以 EX_CONFIG (78) 退出。应用自身仍使用源码目录作为 cwd。
