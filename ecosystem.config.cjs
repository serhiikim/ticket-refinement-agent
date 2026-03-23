const path = require("path");

module.exports = {
  apps: [
    {
      name: "ai-ticket-agent",
      script: "npx",
      args: "tsx src/index.ts",
      cwd: __dirname,
      interpreter: "none",
      env_file: path.join(__dirname, ".env"),
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: path.join(__dirname, "logs", "out.log"),
      error_file: path.join(__dirname, "logs", "error.log"),
    },
  ],
};
