// Debug script to check Redis connection configuration
require('dotenv').config();
// Only load .env.local in development (not in Railway/production)
if (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

console.log('=== Redis Configuration Debug ===');
console.log('REDIS_URL:', process.env.REDIS_URL ? 'SET' : 'NOT SET');
console.log('REDIS_URL value:', process.env.REDIS_URL);
console.log('REDIS_HOST:', process.env.REDIS_HOST || 'not set');
console.log('REDIS_PORT:', process.env.REDIS_PORT || 'not set');
console.log('REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? 'SET' : 'not set');

// Show what connection config will be used
const redisConnection = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    };

console.log('\nConnection config that will be used:');
console.log(JSON.stringify(redisConnection, null, 2));
