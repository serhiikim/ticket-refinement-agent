module.exports = {
  apps: [
    {
      name: "ai-ticket-agent",
      script: "npx",
      args: "tsx index.ts",
      cwd: "/home/openclaw/agent",
      interpreter: "none",
      env_file: "/home/openclaw/agent/.env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "/home/openclaw/agent/logs/out.log",
      error_file: "/home/openclaw/agent/logs/error.log",
    },
  ],
};
