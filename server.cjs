const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT || 7000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535)
  throw new Error("Invalid DASHBOARD_PORT");
const axon = require("pm2-axon"),
  rpc = require("pm2-axon-rpc");
const interval = 3000,
  maxHistory = 1200;
const homes = new Map(),
  history = [];
let snapshot = null,
  rawProcesses = new Map(),
  polling = false,
  discoveryError = null;
let previousCPU = os.cpus();
const idFor = (s) =>
  crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
function sanitize(value, key = "") {
  if (
    /password|passwd|secret|token|api.?key|authorization|credential|private.?key|cookie/i.test(
      key,
    )
  )
    return "[已隐藏]";
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]),
    );
  if (typeof value === "string")
    return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[已隐藏]@");
  return value;
}
function readDaemon(home) {
  return new Promise((resolve, reject) => {
    const sock = axon.socket("req"),
      client = new rpc.Client(sock);
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.close();
      err ? reject(err) : resolve(data);
    };
    const timer = setTimeout(() => finish(new Error("PM2 RPC 连接超时")), 1800);
    sock.on("error", (err) => finish(err));
    sock.once("connect", () =>
      client.call("getMonitorData", {}, (err, list) => finish(err, list)),
    );
    try {
      sock.connect(path.join(home, "rpc.sock"));
    } catch (err) {
      finish(err);
    }
  });
}
async function discover() {
  try {
    const { stdout } = await exec("/bin/ps", ["ax", "-o", "pid=,command="], {
      timeout: 2500,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const line of stdout.split("\n")) {
      const match = line.match(
        /^\s*(\d+)\s+PM2 v([^:]+): God Daemon \((.+)\)\s*$/,
      );
      if (match)
        homes.set(match[3], {
          id: idFor(match[3]),
          home: match[3],
          pid: +match[1],
          version: match[2],
        });
    }
    discoveryError = null;
  } catch (err) {
    discoveryError = err.message;
  }
  const defaults = [
    path.join(os.homedir(), ".pm2"),
    ...(process.env.PM2_HOME ? [process.env.PM2_HOME] : []),
    ...(process.env.DASHBOARD_PM2_HOMES || "")
      .split(path.delimiter)
      .filter(Boolean),
  ];
  for (const home of defaults) {
    try {
      await fs.access(path.join(home, "rpc.sock"));
      if (!homes.has(home)) homes.set(home, { id: idFor(home), home });
    } catch {}
  }
}
let endpointCache = new Map(),
  endpointTime = 0,
  endpointSignature = "";
let localProcesses = [],
  serviceScanError = null;
async function serviceLinks(processes) {
  const signature = processes
    .map((p) => `${p.key}:${p.pid}:${p.status}`)
    .join("|");
  if (Date.now() - endpointTime < 15000 && signature === endpointSignature)
    return endpointCache;
  try {
    const results = await Promise.allSettled([
      exec("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], {
        timeout: 2500,
        maxBuffer: 4 * 1024 * 1024,
      }),
      exec("/bin/ps", ["ax", "-o", "pid=,ppid=,%cpu=,rss=,etime=,comm="], {
        timeout: 2500,
        maxBuffer: 4 * 1024 * 1024,
      }),
    ]);
    if (results.some((r) => r.status === "rejected"))
      throw Error("无法读取本机监听进程");
    const meta = new Map();
    for (const line of results[1].value.stdout.split("\n")) {
      const m = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (m)
        meta.set(+m[1], {
          parent: +m[2],
          cpu: +m[3],
          memory: +m[4] * 1024,
          elapsed: m[5],
          executable: m[6],
        });
    }
    const listeners = [];
    let pid, name;
    for (const line of results[0].value.stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      if (line.startsWith("c")) name = line.slice(1);
      if (line.startsWith("n")) {
        const m = line.slice(1).match(/^(.*):(\d+)$/);
        if (!m) continue;
        const address = m[1],
          port = +m[2];
        const host = address === "*" ? "127.0.0.1" : address;
        listeners.push({
          pid,
          name,
          address,
          port,
          url: `http://${host}:${port}`,
        });
      }
    }
    const belongsTo = (pid, root) => {
      const seen = new Set();
      while (pid > 1 && !seen.has(pid)) {
        if (pid === root) return true;
        seen.add(pid);
        pid = meta.get(pid)?.parent;
      }
      return false;
    };
    const owner = (l) =>
      processes.find((p) => p.pid && belongsTo(l.pid, p.pid));
    // A wildcard listener must not inherit the link of a different, loopback-bound service.
    const candidates = listeners.filter(
      (l) =>
        !listeners.some(
          (o) =>
            o.pid !== l.pid &&
            o.port === l.port &&
            l.address === "*" &&
            o.address === "127.0.0.1",
        ),
    );
    const probes = new Map();
    const probe = (url) => {
      if (!probes.has(url))
        probes.set(
          url,
          new Promise((resolve) => {
            let done = false;
            const finish = (ok) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              req.destroy();
              resolve(ok);
            };
            const req = http.request(url, { method: "HEAD" }, (res) => {
              res.resume();
              finish(true);
            });
            const timer = setTimeout(() => finish(false), 1000);
            req.on("error", () => finish(false));
            req.end();
          }),
        );
      return probes.get(url);
    };
    const verified = new Set();
    await Promise.all(
      [...new Set(candidates.map((l) => l.url))].map(async (url) => {
        if (await probe(url)) verified.add(url);
      }),
    );
    const next = new Map(processes.map((p) => [p.key, []]));
    for (const l of candidates) {
      const p = owner(l);
      if (p && verified.has(l.url) && !next.get(p.key).includes(l.url))
        next.get(p.key).push(l.url);
    }
    const groups = new Map();
    for (const l of listeners) {
      if (owner(l)) continue;
      if (!groups.has(l.pid)) groups.set(l.pid, []);
      groups.get(l.pid).push(l);
    }
    const locals = [];
    for (const [pid, ls] of groups) {
      const m = meta.get(pid) || {},
        executable = m.executable || ls[0].name;
      const app = executable.match(/\/([^/]+)\.app\//)?.[1];
      let name = app || ls[0].name;
      // Use process cwd to identify otherwise anonymous Node/Python web servers.
      if (/^(node|python|bun|deno)/i.test(name)) {
        try {
          const r = await exec(
            "/usr/sbin/lsof",
            ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
            { timeout: 800 },
          );
          const cwd = r.stdout
            .split("\n")
            .find((x) => x.startsWith("n"))
            ?.slice(1);
          if (cwd) {
            m.cwd = cwd;
            name =
              path.basename(cwd) === "claudecodeui"
                ? "CloudCLI"
                : path.basename(cwd);
          }
        } catch {}
      }
      locals.push({
        key: `local:${pid}`,
        instanceId: "local",
        source: "local",
        id: null,
        pid,
        name,
        status: "online",
        cpu: m.cpu ?? null,
        memory: m.memory ?? null,
        restarts: null,
        elapsed: m.elapsed,
        script: executable,
        cwd: m.cwd,
        namespace: "非 PM2",
        ports: [...new Set(ls.map((l) => `${l.address}:${l.port}`))],
        links: [
          ...new Set(
            candidates
              .filter((l) => l.pid === pid && verified.has(l.url))
              .map((l) => l.url),
          ),
        ],
      });
    }
    localProcesses = locals;
    serviceScanError = null;
    endpointCache = next;
    endpointTime = Date.now();
    endpointSignature = signature;
    return next;
  } catch (err) {
    serviceScanError = err.message;
    localProcesses = [];
    return new Map();
  }
}
function hostMetrics() {
  const current = os.cpus();
  let idle = 0,
    total = 0;
  current.forEach((cpu, i) => {
    const prev = previousCPU[i];
    if (!prev) return;
    idle += cpu.times.idle - prev.times.idle;
    for (const k of Object.keys(cpu.times))
      total += cpu.times[k] - prev.times[k];
  });
  previousCPU = current;
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cores: current.length,
    cpuModel: current[0]?.model,
    cpuPercent: total ? 100 * (1 - idle / total) : null,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    loadAverage: os.loadavg(),
    node: process.version,
  };
}
async function collect() {
  if (polling) return;
  polling = true;
  try {
    if (!snapshot || Date.now() - lastDiscovery > 15000) {
      await discover();
      lastDiscovery = Date.now();
    }
    const nextRaw = new Map();
    const instances = await Promise.all(
      [...homes.values()].map(async (instance) => {
        try {
          const rows = await readDaemon(instance.home);
          if (!Array.isArray(rows)) throw new Error("PM2 返回了无效数据");
          const processes = rows.map((p) => {
            const e = p.pm2_env || {},
              key = instance.id + ":" + p.pm_id;
            nextRaw.set(key, { instance, process: p });
            return {
              key,
              instanceId: instance.id,
              id: p.pm_id,
              name: p.name || e.name,
              namespace: e.namespace || "default",
              pid: p.pid,
              status: e.status,
              cpu: p.monit?.cpu ?? null,
              memory: p.monit?.memory ?? null,
              restarts: e.restart_time || 0,
              unstableRestarts: e.unstable_restarts || 0,
              uptime: e.pm_uptime,
              createdAt: e.created_at,
              mode: e.exec_mode,
              script: e.pm_exec_path,
              cwd: e.pm_cwd,
              interpreter: e.exec_interpreter,
              nodeVersion: e.node_version,
              version: e.version,
              watch: e.watch,
              autorestart: e.autorestart,
              instances: e.instances,
              exitCode: e.exit_code,
              metrics: sanitize(e.axm_monitor || {}),
              outLog: e.pm_out_log_path,
              errorLog: e.pm_err_log_path,
            };
          });
          return { ...instance, connected: true, processes };
        } catch (err) {
          return {
            ...instance,
            connected: false,
            error: err.message,
            processes: [],
          };
        }
      }),
    );
    rawProcesses = nextRaw;
    const processes = instances.flatMap((i) => i.processes),
      time = Date.now();
    const links = await serviceLinks(processes);
    for (const p of processes) p.links = links.get(p.key) || [];
    const summary = {
      total: processes.length,
      online: processes.filter((p) => p.status === "online").length,
      offline: processes.filter((p) => p.status !== "online").length,
      cpu: processes.reduce((n, p) => n + (p.cpu || 0), 0),
      memory: processes.reduce((n, p) => n + (p.memory || 0), 0),
      restarts: processes.reduce((n, p) => n + p.restarts, 0),
    };
    const host = hostMetrics();
    history.push({
      time,
      cpu: summary.cpu,
      memory: summary.memory,
      hostCpu: host.cpuPercent,
      processes: Object.fromEntries(
        processes.map((p) => [p.key, { cpu: p.cpu, memory: p.memory }]),
      ),
    });
    if (history.length > maxHistory) history.shift();
    snapshot = {
      time,
      interval,
      discoveryError,
      host,
      summary,
      instances,
      localProcesses,
      serviceScanError,
      serviceScanTime: endpointTime,
    };
  } finally {
    polling = false;
  }
}
let lastDiscovery = 0;
async function tail(file, lines = 200) {
  if (!file) return { text: "", error: "PM2 未配置此日志路径" };
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return { text: "", error: "日志路径不是普通文件" };
    const length = Math.min(stat.size, 131072),
      buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      length,
      stat.size - length,
    );
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (stat.size > length) text = text.slice(text.indexOf("\n") + 1);
    return {
      text: text.split("\n").slice(-lines).join("\n"),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      truncated: stat.size > length,
      path: file,
    };
  } catch (err) {
    return {
      text: "",
      path: file,
      error: err.code === "ENOENT" ? "日志文件尚未生成" : err.message,
    };
  } finally {
    await handle?.close();
  }
}
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body),
  );
}
const staticFiles = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/tokens.css": ["tokens.css", "text/css; charset=utf-8"],
};
const server = http.createServer(async (req, res) => {
  try {
    const port = server.address()?.port || PORT;
    const allowed = [`${HOST}:${port}`, `localhost:${port}`];
    if (
      !allowed.includes(req.headers.host) ||
      (req.headers.origin &&
        !allowed.map((h) => "http://" + h).includes(req.headers.origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return send(res, 403, { error: "仅允许本机同源访问" });
    if (req.method !== "GET")
      return send(res, 405, { error: "只读 dashboard" });
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === "/api/snapshot")
      return snapshot
        ? send(res, 200, { ...snapshot, history })
        : send(res, 503, { error: "正在连接 PM2，请稍后重试" });
    if (url.pathname === "/api/process") {
      const item = rawProcesses.get(url.searchParams.get("key"));
      if (!item)
        return send(res, 404, {
          error: "进程已退出或当前无法连接所属 PM2 实例",
        });
      return send(res, 200, {
        instance: item.instance,
        process: sanitize(item.process),
      });
    }
    if (url.pathname === "/api/logs") {
      const kind = url.searchParams.get("kind") || "out";
      if (!["out", "error", "daemon"].includes(kind))
        return send(res, 400, { error: "无效日志类型" });
      let file;
      if (kind === "daemon") {
        const instance = [...homes.values()].find(
          (i) => i.id === url.searchParams.get("instance"),
        );
        if (!instance) return send(res, 404, { error: "未找到 PM2 实例" });
        file = path.join(instance.home, "pm2.log");
      } else {
        const item = rawProcesses.get(url.searchParams.get("key"));
        if (!item) return send(res, 404, { error: "未找到进程" });
        file =
          item.process.pm2_env[
            kind === "error" ? "pm_err_log_path" : "pm_out_log_path"
          ];
      }
      const lines = Math.max(
        50,
        Math.min(1000, Number(url.searchParams.get("lines")) || 200),
      );
      return send(res, 200, await tail(file, lines));
    }
    if (url.pathname === "/api/export")
      return send(res, 200, {
        ...snapshot,
        processes: [...rawProcesses.values()].map((x) => ({
          instance: x.instance,
          process: sanitize(x.process),
        })),
        history,
      });
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname];
      return send(
        res,
        200,
        await fs.readFile(path.join(__dirname, file)),
        type,
      );
    }
    return send(res, 404, { error: "未找到页面" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});
async function start() {
  server.on("error", (err) => {
    console.error(err.message);
    process.exit(1);
  });
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  console.log(`PM2 Observatory http://${HOST}:${server.address().port}`);
  await collect();
  const timer = setInterval(
    () => collect().catch((err) => console.error(err.message)),
    interval,
  );
  const stop = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (require.main === module)
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
module.exports = { sanitize, tail, readDaemon, idFor };
