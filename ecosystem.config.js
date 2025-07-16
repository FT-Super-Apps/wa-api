require('dotenv').config();

module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || 'WA-API',
      script: 'app.js',
      instances: 1, // Single instance
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        APP_PORT: process.env.APP_PORT || 8000,
      },
      env_development: {
        NODE_ENV: 'development',
        APP_PORT: process.env.APP_PORT || 8000,
      },
      env_production: {
        NODE_ENV: 'production',
        APP_PORT: process.env.APP_PORT || 8000,
      },
      // Logging configuration
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring and restart policies
      min_uptime: '10s',
      max_restarts: 10,
      
      // Performance tuning
      node_args: '--max-old-space-size=4096',
      
      // Health monitoring
      health_check_grace_period: 3000,
      health_check_interval: 30000,
    },
  ],
  
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:FT-Super-Apps/wa-api.git',
      path: '/var/www/wa-api',
      'post-deploy':
        'npm install && pm2 restart ecosystem.config.js --env production',
    },
  },
};
