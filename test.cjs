const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { sanitize, tail, readDaemon, idFor } = require("./server.cjs");
const axon = require("pm2-axon"),
  rpc = require("pm2-axon-rpc");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("nested credentials are masked without mutating the source", () => {
  const input = {
    name: "app",
    pm2_env: {
      PORT: 8080,
      env: { API_KEY: "fixture-secret", nested: [{ password: "private" }] },
    },
  };
  const value = sanitize(input);
  assert.equal(value.pm2_env.env.API_KEY, "[已隐藏]");
  assert.equal(value.pm2_env.env.nested[0].password, "[已隐藏]");
  assert.equal(value.pm2_env.PORT, 8080);
  assert.equal(input.pm2_env.env.API_KEY, "fixture-secret");
  assert.equal(
    sanitize("https://user:pass@example.invalid"),
    "https://[已隐藏]@example.invalid",
  );
});
test("logs are bounded, handle missing files and reject non-regular files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-"));
  try {
    const file = path.join(dir, "app.log");
    await fs.writeFile(file, "x".repeat(200000) + "\nlast line\n");
    const result = await tail(file, 50);
    assert.equal(result.truncated, true);
    assert.equal(result.text, "last line\n");
    assert.equal(
      (await tail(path.join(dir, "missing"))).error,
      "日志文件尚未生成",
    );
    assert.equal((await tail(dir)).error, "日志路径不是普通文件");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("RPC reads are scoped to the requested daemon; missing daemon does not start one", async () => {
  // Short /tmp path keeps macOS Unix socket names under the kernel limit.
  const dir = await fs.mkdtemp("/tmp/obs-");
  const sock = axon.socket("rep");
  try {
    const server = new rpc.Server(sock);
    server.expose("getMonitorData", (_opts, cb) =>
      cb(null, [{ pm_id: 0, name: "fixture" }]),
    );
    sock.bind(path.join(dir, "rpc.sock"));
    await once(sock, "bind");
    assert.equal((await readDaemon(dir))[0].name, "fixture");
    const missing = path.join(dir, "absent");
    await assert.rejects(readDaemon(missing));
    await assert.rejects(fs.access(missing));
  } finally {
    sock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("process keys do not collide between PM2 homes", () => {
  assert.notEqual(idFor("/a/.pm2") + ":0", idFor("/b/.pm2") + ":0");
});
test(
  "standalone API starts on an ephemeral port and enforces read-only local access",
  { timeout: 30000 },
  async () => {
    const child = spawn(process.execPath, ["server.cjs"], {
      cwd: __dirname,
      env: { ...process.env, DASHBOARD_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let root = "",
      stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) root = m[0];
    });
    try {
      for (let i = 0; i < 100 && !root; i++) {
        if (child.exitCode !== null) throw Error(stderr);
        await sleep(100);
      }
      assert.ok(root, "server must report its listening address");
      let s;
      for (let i = 0; i < 100; i++) {
        const r = await fetch(root + "/api/snapshot");
        if (r.ok) {
          s = await r.json();
          break;
        }
        await sleep(100);
      }
      assert.ok(s, "collector must return a snapshot");
      assert.equal(
        s.summary.total,
        s.instances.reduce((n, i) => n + i.processes.length, 0),
      );
      assert.ok(Array.isArray(s.localProcesses));
      const pm2Pids = new Set(
        s.instances.flatMap((i) => i.processes).map((p) => p.pid),
      );
      assert.ok(s.localProcesses.every((p) => !pm2Pids.has(p.pid)));
      assert.equal(
        (
          await fetch(root + "/api/snapshot", {
            headers: { Origin: "https://example.invalid" },
          })
        ).status,
        403,
      );
      const hostStatus = await new Promise((resolve, reject) =>
        http
          .get(root, { headers: { Host: "evil.invalid" } }, (r) => {
            r.resume();
            resolve(r.statusCode);
          })
          .on("error", reject),
      );
      assert.equal(hostStatus, 403);
      assert.equal(
        (
          await fetch(root + "/api/snapshot", {
            headers: { "Sec-Fetch-Site": "cross-site" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(root + "/api/snapshot", { method: "POST" })).status,
        405,
      );
      assert.equal((await fetch(root + "/api/logs?kind=other")).status, 400);
      assert.equal(
        (await fetch(root + "/api/logs?key=../../etc/passwd")).status,
        404,
      );
      const page = await fetch(root);
      assert.equal(page.status, 200);
      assert.ok(
        page.headers
          .get("content-security-policy")
          .includes("frame-ancestors 'none'"),
      );
      assert.ok(
        (await page.text()).indexOf('class="workspace"') <
          (await (await fetch(root)).text()).indexOf('id="stats"'),
      );
      for (const file of ["/app.js", "/tokens.css", "/style.css"])
        assert.equal((await fetch(root + file)).status, 200);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  },
);
