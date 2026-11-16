module.exports = {
  apps: [
    {
      name: "listo-carousel",
      script: "backend/dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        TZ: "America/Sao_Paulo",
      },
    },
  ],
};
