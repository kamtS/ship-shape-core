import 'dotenv/config';
import path from 'node:path';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { createApp } from './app.js';
import { readOAuthConfig } from './oauth.js';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST?.trim() || '0.0.0.0';
const dist = path.resolve(process.cwd(), 'dist');
const oauthConfig = readOAuthConfig(process.env);
const redisUrl = process.env.REDIS_URL?.trim();

if (process.env.REQUIRE_GITHUB_OAUTH === '1' && !oauthConfig) {
  throw new Error('Hosted mode requires GitHub OAuth configuration. Refusing to start in demo mode.');
}
if (process.env.REQUIRE_REDIS === '1' && !redisUrl) {
  throw new Error('Hosted mode requires REDIS_URL. Refusing to use the in-memory session store.');
}
if (process.env.NODE_ENV === 'production' && oauthConfig && process.env.ALLOW_INSECURE_HTTP !== '1') {
  const appUrl = new URL(oauthConfig.appUrl);
  const callbackUrl = new URL(oauthConfig.callbackUrl);
  if (appUrl.protocol !== 'https:' || callbackUrl.protocol !== 'https:') {
    throw new Error('Production APP_URL and GITHUB_OAUTH_CALLBACK_URL must use HTTPS.');
  }
}

const redisClient = redisUrl ? createClient({ url: redisUrl }) : undefined;
if (redisClient) {
  redisClient.on('error', () => console.error('Redis session store connection error.'));
  await redisClient.connect();
}
const sessionStore = redisClient ? new RedisStore({ client: redisClient, prefix: 'shipshape:session:' }) : undefined;

const app = createApp({
  oauthConfig,
  sessionSecret: process.env.SESSION_SECRET,
  secureCookies: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  staticDir: dist,
  sessionStore,
  readinessCheck: redisClient ? async () => { await redisClient.ping(); } : undefined,
});

const server = app.listen(port, host, () => {
  const mode = oauthConfig ? 'github-oauth' : 'demo';
  const sessions = redisClient ? 'redis' : 'memory';
  console.log(`Ship Shape API listening on ${host}:${port} (${mode} mode, ${sessions} sessions)`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(async () => {
    try {
      if (redisClient?.isOpen) await redisClient.quit();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
