module.exports = {
  apps: [
    {
      name: 'sprout-canvas',
      script: 'server.mjs',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '8787'
      },
      max_memory_restart: '512M',
      time: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true
    }
  ]
};
