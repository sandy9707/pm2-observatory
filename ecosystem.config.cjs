module.exports = {
  apps: [
    {
      name: "pm2-observatory",
      script: __dirname + "/server.cjs",
      cwd: __dirname,
      interpreter: process.execPath,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      max_memory_restart: "256M",
      time: true,
      env: {
        NODE_ENV: "production",
        DASHBOARD_PORT: process.env.DASHBOARD_PORT || "7000",
      },
    },
  ],
};
