module.exports = {
  apps: [{
    name: "andromeda-rsi",
    script: "./dist/_core/index.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "2G",
    env: {
      NODE_ENV: "production",
      PORT: 3000
    },
    log_date_format: "YYYY-MM-DD HH:mm Z",
    error_file: "logs/error.log",
    out_file: "logs/out.log",
    merge_logs: true,
    time: true
  }]
};
