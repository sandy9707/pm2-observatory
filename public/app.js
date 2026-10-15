document.querySelector(".local-label").textContent = "LOCAL / " + location.host;
const $ = (id) => document.getElementById(id);
let data,
  selectedKey,
  paused = false,
  loading = false,
  detailKey,
  logRequest = 0,
  detailRequest = 0,
  daemonOverride,
  currentLog = "";
const escapeHTML = (x) =>
  String(x ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const bytes = (n) =>
  n == null
    ? "—"
    : n >= 1024 ** 3
      ? (n / 1024 ** 3).toFixed(2) + " GiB"
      : (n / 1024 ** 2).toFixed(1) + " MiB";
const pct = (n) => (n == null ? "—" : n.toFixed(1) + "%");
const time = (n) => new Date(n).toLocaleTimeString("zh-CN", { hour12: false });
function duration(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  return s >= 86400
    ? Math.floor(s / 86400) + "天 " + Math.floor((s % 86400) / 3600) + "时"
    : s >= 3600
      ? Math.floor(s / 3600) + "时 " + Math.floor((s % 3600) / 60) + "分"
      : s >= 60
        ? Math.floor(s / 60) + "分 " + (s % 60) + "秒"
        : s + "秒";
}
const statusText = (s) =>
  ({
    online: "运行中",
    stopped: "已停止",
    errored: "异常",
    launching: "启动中",
    stopping: "停止中",
    "waiting restart": "等待重启",
  })[s] || s;
const all = () => [
  ...(data?.instances.flatMap((i) => i.processes) || []),
  ...(data?.localProcesses || []),
];
const selected = () => all().find((p) => p.key === selectedKey);
const badge = (s) =>
  '<span class="status ' +
  escapeHTML(s) +
  '">' +
  escapeHTML(statusText(s)) +
  "</span>";
async function api(url) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "请求失败");
  return body;
}
function notice(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}
function fields(entries) {
  return entries
    .map(
      ([k, v]) =>
        "<div><dt>" +
        escapeHTML(k) +
        "</dt><dd>" +
        escapeHTML(v) +
        "</dd></div>",
    )
    .join("");
}
function render() {
  const { summary: s, host: h, instances } = data;
  $("subtitle").textContent =
    `${h.hostname} · ${instances.filter((i) => i.connected).length} / ${instances.length} 个 PM2 实例 · ${s.total} 个 PM2 进程 + ${(data.localProcesses || []).length} 个其他监听进程 · 端口每 15 秒扫描`;
  $("stats").innerHTML = [
    [
      "监听 / PM2 进程",
      all().length,
      `PM2 ${s.total} · 其他 ${(data.localProcesses || []).length}`,
      "",
    ],
    ["PM2 运行中", s.online, "online", "good"],
    ["PM2 未运行", s.offline, "停止 / 异常 / 过渡状态", s.offline ? "bad" : ""],
    ["PM2 CPU 合计", pct(s.cpu), "多核占用可超过 100%", ""],
    ["PM2 内存合计", bytes(s.memory), "进程 RSS 总和", ""],
    ["PM2 累计重启", s.restarts, "当前进程生命周期内", ""],
  ]
    .map(
      ([label, value, note, cls]) =>
        `<div class="stat"><span>${label}</span><strong class="${cls}">${value}</strong><small>${note}</small></div>`,
    )
    .join("");
  $("hostname").textContent = h.hostname;
  $("hostDetails").innerHTML = fields([
    ["操作系统", `${h.platform} ${h.release} / ${h.arch}`],
    ["处理器", `${h.cores} 核 · ${pct(h.cpuPercent)}`],
    [
      "内存使用",
      `${bytes(h.totalMemory - h.freeMemory)} / ${bytes(h.totalMemory)}`,
    ],
    ["系统运行", duration(h.uptime * 1000)],
    ["系统负载", h.loadAverage.map((n) => n.toFixed(2)).join(" / ")],
  ]);
  const instanceFilter = $("instance"),
    old = instanceFilter.value;
  const options =
    '<option value="">全部来源</option><option value="pm2">仅 PM2</option><option value="local">非 PM2</option><option value="web">有 HTTP 入口</option>' +
    instances
      .map(
        (i, n) =>
          `<option value="${i.id}">${n + 1} · ${escapeHTML(shortHome(i.home))}</option>`,
      )
      .join("");
  if (instanceFilter.innerHTML !== options) {
    instanceFilter.innerHTML = options;
    instanceFilter.value = old;
  }
  $("instances").innerHTML = instances
    .map(
      (i) =>
        `<div class="instance-row"><div><strong>${escapeHTML(i.home)}</strong><small>PM2 ${escapeHTML(i.version)} · daemon PID ${escapeHTML(i.pid)}${i.error ? " · " + escapeHTML(i.error) : ""}</small></div><span>${i.processes.length} 个进程</span><span class="status ${i.connected ? "online" : "errored"}">${i.connected ? "已连接" : "连接失败"}</span><button data-daemon="${i.id}">守护日志 ↗</button></div>`,
    )
    .join("");
  const failed = instances.filter((i) => !i.connected);
  notice(
    failed.length
      ? `${failed.length} 个实例连接失败，汇总仅含已连接实例：${failed.map((i) => shortHome(i.home)).join("、")}`
      : data.discoveryError
        ? "实例发现失败：" + data.discoveryError
        : data.serviceScanError
          ? "本机端口扫描失败：" + data.serviceScanError
          : "",
  );
  if (!selectedKey && all().length) selectedKey = all()[0].key;
  if (selectedKey && !selected()) {
    selectedKey = null;
    detailKey = null;
    $("detail").innerHTML =
      '<h2>进程已不可用</h2><p class="muted">进程已退出或所属实例断开。请选择其他进程。</p>';
  }
  renderRows();
  renderChart();
  renderDetail();
  $("updated").textContent = "最近采样 " + time(data.time);
}
function shortHome(home) {
  return home.endsWith("/.pm2")
    ? "默认 .pm2"
    : home.split("/").slice(-2).join("/");
}
function renderRows() {
  let processes = all();
  const q = $("search").value.toLowerCase(),
    instance = $("instance").value,
    status = $("status").value;
  processes = processes.filter(
    (p) =>
      (!instance ||
        p.instanceId === instance ||
        (instance === "pm2" && p.source !== "local") ||
        (instance === "web" && p.links?.length)) &&
      (!status ||
        (status === "online"
          ? p.status === "online"
          : p.status !== "online")) &&
      (!q ||
        [
          p.name,
          p.pid,
          p.id,
          p.script,
          p.namespace,
          ...(p.ports || []),
          ...(p.links || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  const sort = $("sort").value;
  const priority = (p) =>
    p.source !== "local" || p.cwd ? 0 : p.links?.length ? 1 : 2;
  processes.sort(
    sort === "services"
      ? (a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name)
      : sort === "name"
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => (b[sort] || 0) - (a[sort] || 0),
  );
  $("processCount").textContent = `${processes.length} / ${all().length}`;
  const html = processes.length
    ? processes
        .map((p) => {
          const instance = data.instances.find((i) => i.id === p.instanceId);
          return `<tr class="${p.key === selectedKey ? "selected" : ""}"><td><button class="process-button" data-key="${p.key}" aria-pressed="${p.key === selectedKey}">${escapeHTML(p.name)}<small>${p.source === "local" ? "非 PM2" : "PM2 #" + p.id} · PID ${p.pid} · ${escapeHTML(instance ? shortHome(instance.home) : "本机监听")}</small></button></td><td data-label="状态">${badge(p.status)}</td><td data-label="CPU" class="mono">${pct(p.cpu)}</td><td data-label="内存" class="mono">${bytes(p.memory)}</td><td data-label="运行" class="mono">${p.source === "local" ? p.elapsed || "—" : p.status === "online" ? duration(data.time - p.uptime) : "—"}</td><td data-label="重启" class="mono">${p.restarts ?? "—"}</td><td data-label="访问" class="service-links">${(p.links || []).length ? (p.links || []).map((url) => `<a class="service-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="打开 ${escapeHTML(p.name)}：${escapeHTML(url)}">${escapeHTML(url.replace(/^http:\/\//, ""))} ↗</a>`).join("") : `<span class="muted">未检测到 HTTP 入口${p.ports?.length ? " · " + escapeHTML(p.ports.join(", ")) : ""}</span>`}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="7" class="empty">没有匹配的进程。可清空搜索或切换筛选条件。</td></tr>';
  const focused = document.activeElement?.dataset.key;
  $("rows").innerHTML = html;
  if (focused)
    $("rows")
      .querySelector(`[data-key="${focused}"]`)
      ?.focus({ preventScroll: true });
}
function renderChart() {
  const hist = data.history,
    cpuMax = Math.max(1, ...hist.map((x) => x.cpu)),
    memMax = Math.max(1, ...hist.map((x) => x.memory));
  const points = (field, max) =>
    hist
      .map(
        (x, i) =>
          `${hist.length === 1 ? 0 : (i / (hist.length - 1)) * 900},${120 - (x[field] / max) * 108}`,
      )
      .join(" ");
  let paths = [24, 72, 120]
    .map(
      (y) => `<line class="chart-grid" x1="0" x2="900" y1="${y}" y2="${y}"/>`,
    )
    .join("");
  paths += `<polyline class="memory-line" points="${points("memory", memMax)}"/><polyline class="cpu-line" points="${points("cpu", cpuMax)}"/>`;
  $("chart").innerHTML = paths;
  $("chart").setAttribute(
    "aria-label",
    `CPU 当前 ${pct(data.summary.cpu)}，内存 ${bytes(data.summary.memory)}。两条曲线按各自峰值缩放。`,
  );
  $("cpuValue").textContent = "CPU " + pct(data.summary.cpu);
  $("memoryValue").textContent = "RSS " + bytes(data.summary.memory);
  $("chartStart").textContent =
    (hist.length > 1 ? time(hist[0].time) : "等待更多采样") +
    " · 独立纵轴：CPU " +
    pct(cpuMax) +
    " / RSS " +
    bytes(memMax);
}
async function renderDetail(force = false) {
  const p = selected();
  if (!p) return;
  if (p.source === "local") {
    detailKey = p.key;
    ++detailRequest;
    $("detail").innerHTML =
      `<p class="eyebrow">LOCAL / PID ${p.pid}</p><h2>${escapeHTML(p.name)}</h2><p class="detail-note">非 PM2 管理 · 系统监听进程</p><dl>${fields(
        [
          ["状态", "监听中"],
          ["CPU / RSS", pct(p.cpu) + " / " + bytes(p.memory)],
          ["运行时间", p.elapsed],
          ["程序", p.script],
          ["工作目录", p.cwd],
          ["监听地址", (p.ports || []).join(" / ")],
        ],
      )}</dl><p class="detail-note">CPU / 内存来自系统进程快照，每 15 秒更新。此进程没有 PM2 的重启次数、环境配置或日志接口。</p>`;
    return;
  }
  if (detailKey === p.key && !force) {
    const stats = $("detailLive");
    if (stats)
      stats.innerHTML = fields([
        ["状态", statusText(p.status)],
        ["CPU / RSS", pct(p.cpu) + " / " + bytes(p.memory)],
        ["累计重启", p.restarts],
        [
          "运行时长",
          p.source === "local"
            ? p.elapsed || "—"
            : p.status === "online"
              ? duration(data.time - p.uptime)
              : "—",
        ],
      ]);
    return;
  }
  detailKey = p.key;
  const request = ++detailRequest;
  $("detail").innerHTML =
    `<p class="eyebrow">PROCESS / ${p.id}</p><h2>${escapeHTML(p.name)}</h2><p class="detail-note">${escapeHTML(p.namespace)} · ${escapeHTML(p.mode)} · PID ${p.pid}</p><dl id="detailLive">${fields(
      [
        ["状态", statusText(p.status)],
        ["CPU / RSS", pct(p.cpu) + " / " + bytes(p.memory)],
        ["累计重启", p.restarts],
        [
          "运行时长",
          p.source === "local"
            ? p.elapsed || "—"
            : p.status === "online"
              ? duration(data.time - p.uptime)
              : "—",
        ],
      ],
    )}</dl><dl>${fields([
      ["脚本", p.script],
      ["工作目录", p.cwd],
      ["解释器", p.interpreter],
      ["Node / 版本", (p.nodeVersion || "—") + " / " + (p.version || "—")],
      [
        "创建时间",
        p.createdAt ? new Date(p.createdAt).toLocaleString("zh-CN") : "—",
      ],
      ["自动重启", String(p.autorestart ?? "—")],
      ["监听文件", JSON.stringify(p.watch ?? false)],
      ["退出码", p.exitCode],
      ["标准输出", p.outLog],
      ["错误日志", p.errorLog],
    ])}</dl><details><summary>自定义监控指标</summary><pre>${escapeHTML(JSON.stringify(p.metrics, null, 2))}</pre></details><details><summary>全部 PM2 字段 / 环境变量</summary><p class="detail-note">敏感字段按名称遮盖；数据在选择进程时读取。</p><button id="reloadDetail">刷新详情</button><pre id="raw">正在读取…</pre></details>`;
  try {
    const raw = await api("/api/process?key=" + encodeURIComponent(p.key));
    if (request === detailRequest && selectedKey === p.key)
      $("raw").textContent = JSON.stringify(raw.process, null, 2);
  } catch (e) {
    if (request === detailRequest && $("raw")) $("raw").textContent = e.message;
  }
}
async function refreshLogs() {
  const kind = $("logKind").value,
    p = selected();
  const instance = daemonOverride || p?.instanceId;
  if (p?.source === "local" && !(kind === "daemon" && daemonOverride)) {
    ++logRequest;
    currentLog = "";
    $("logText").textContent = "此进程不由 PM2 管理，暂无可读取的 PM2 日志。";
    $("logSource").textContent = p.name + " · 非 PM2";
    $("logInfo").textContent = "可在详情中查看程序、PID 和监听地址。";
    $("copyLog").disabled = true;
    return;
  }
  if ((kind === "daemon" && !instance) || (kind !== "daemon" && !p)) {
    currentLog = "";
    $("logText").textContent = "请选择一个可用进程或 PM2 实例。";
    $("copyLog").disabled = true;
    return;
  }
  const req = ++logRequest;
  let params = new URLSearchParams({ kind, lines: $("logLines").value });
  if (kind === "daemon") params.set("instance", instance);
  else params.set("key", p.key);
  try {
    const result = await api("/api/logs?" + params);
    if (req !== logRequest) return;
    currentLog = result.text;
    $("logText").textContent = result.error || result.text || "暂无日志。";
    $("logSource").textContent = result.path || "尚无日志路径";
    $("copyLog").disabled = !result.text;
    $("logInfo").textContent =
      result.error ||
      `文件 ${bytes(result.size)} · ${result.modifiedAt ? time(result.modifiedAt) : "—"}${result.truncated ? " · 已截取文件末尾 128 KiB" : ""}`;
    if ($("follow").checked) $("logText").scrollTop = $("logText").scrollHeight;
  } catch (e) {
    if (req === logRequest) {
      $("logInfo").textContent = "日志读取失败：" + e.message;
      $("copyLog").disabled = true;
    }
  }
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  $("refresh").textContent = "读取中…";
  try {
    data = await api("/api/snapshot");
    render();
    const stale = Date.now() - data.time > 12000;
    $("connection").textContent = stale
      ? "● 数据已过期"
      : paused
        ? "Ⅱ 已暂停"
        : "● 实时连接";
    $("connection").className = stale ? "bad" : paused ? "" : "live";
    if (stale) notice("采样超过 12 秒未更新，请检查 dashboard 服务。");
    await refreshLogs();
  } catch (e) {
    notice("连接失败：" + e.message + "。请检查服务后点击立即刷新。");
    $("connection").textContent = "● 连接中断";
    $("connection").className = "bad";
  } finally {
    loading = false;
    $("refresh").disabled = false;
    $("refresh").textContent = "立即刷新 ↻";
  }
}
for (const id of ["search", "instance", "status", "sort"])
  $(id).addEventListener(id === "search" ? "input" : "change", renderRows);
$("rows").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-key]");
  if (!btn) return;
  selectedKey = btn.dataset.key;
  daemonOverride = null;
  renderRows();
  renderDetail();
  refreshLogs();
});
$("detail").addEventListener("click", (e) => {
  if (e.target.id === "reloadDetail") renderDetail(true);
});
$("instances").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-daemon]");
  if (!btn) return;
  daemonOverride = btn.dataset.daemon;
  $("logKind").value = "daemon";
  refreshLogs();
  $("logText").scrollIntoView({ block: "center", behavior: "instant" });
});
for (const id of ["logKind", "logLines"])
  $(id).addEventListener("change", refreshLogs);
$("refresh").addEventListener("click", refresh);
$("pause").addEventListener("click", () => {
  paused = !paused;
  $("pause").textContent = paused ? "恢复刷新" : "暂停刷新";
  $("connection").textContent = paused ? "Ⅱ 已暂停" : "● 实时连接";
  $("connection").className = paused ? "" : "live";
  if (!paused) refresh();
});
$("copyLog").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentLog);
    $("copyLog").textContent = "已复制 ✓";
    setTimeout(() => ($("copyLog").textContent = "复制日志"), 1500);
  } catch (e) {
    $("logInfo").textContent = "复制失败，请直接选择日志文本复制。";
  }
});
$("export").addEventListener("click", async () => {
  const btn = $("export");
  btn.disabled = true;
  btn.textContent = "导出中…";
  try {
    const result = await api("/api/export");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "pm2-snapshot-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    notice("导出失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "导出 JSON ↓";
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    $("search").focus();
  }
});
refresh();
setInterval(() => {
  if (!paused && !document.hidden) refresh();
}, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !paused) refresh();
});
