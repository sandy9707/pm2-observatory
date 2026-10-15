// Register only this dashboard for the current macOS GUI user's next login.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
if (process.platform !== "darwin")
  throw Error("This installer supports macOS only.");
const root = path.resolve(__dirname, "..");
const pm2 = execFileSync("/usr/bin/which", ["pm2"], {
  encoding: "utf8",
}).trim();
const label = "io.github.sandy9707.pm2-observatory";
const local = path.join(root, "local");
fs.mkdirSync(local, { recursive: true });
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const config = path.join(root, "ecosystem.config.cjs");
const args = [
  process.execPath,
  pm2,
  "start",
  config,
  "--only",
  "pm2-observatory",
];
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((s) => "<string>" + esc(s) + "</string>").join("")}</array>
<key>WorkingDirectory</key><string>${esc(root)}</string>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${esc([path.dirname(process.execPath), path.dirname(pm2), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"))}</string>
<key>PM2_HOME</key><string>${esc(process.env.PM2_HOME || path.join(os.homedir(), ".pm2"))}</string>
<key>DASHBOARD_PORT</key><string>${esc(process.env.DASHBOARD_PORT || "7000")}</string>
</dict>
<key>StandardOutPath</key><string>${esc(path.join(local, "launchagent.out.log"))}</string>
<key>StandardErrorPath</key><string>${esc(path.join(local, "launchagent.err.log"))}</string>
</dict></plist>
`;
const dir = path.join(os.homedir(), "Library", "LaunchAgents");
fs.mkdirSync(dir, { recursive: true });
const destination = path.join(dir, label + ".plist");
if (fs.existsSync(destination)) {
  fs.copyFileSync(
    destination,
    path.join(local, label + ".backup-" + Date.now() + ".plist"),
  );
  // Replace only our own named job, never the machine's general PM2 startup.
  try {
    execFileSync(
      "/bin/launchctl",
      ["bootout", `gui/${process.getuid()}`, destination],
      { stdio: "pipe" },
    );
  } catch {}
}
fs.writeFileSync(destination, plist, { mode: 0o600 });
execFileSync("/usr/bin/plutil", ["-lint", destination], { stdio: "inherit" });
try {
  execFileSync(
    "/bin/launchctl",
    ["bootstrap", `gui/${process.getuid()}`, destination],
    { stdio: "inherit" },
  );
} catch {
  console.error(
    "Plist saved but bootstrap failed. Log into this macOS GUI account and run the installer again.",
  );
  process.exit(1);
}
console.log("Installed login startup: " + destination);
console.log(
  "Only pm2-observatory is started; existing PM2 process dumps are not rewritten.",
);
