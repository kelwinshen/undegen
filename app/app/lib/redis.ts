import { Redis } from "ioredis";

const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    // Default maxRetriesPerRequest (20) combined with the default backoff
    // can leave a single command hanging for 30+ seconds during a reconnect
    // (e.g. after a write EPIPE) instead of failing fast.
    maxRetriesPerRequest: 3,
    commandTimeout: 5000,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
