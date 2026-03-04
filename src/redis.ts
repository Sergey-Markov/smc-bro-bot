import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

let redisClient: Redis | null = null;

try {
  redisClient = redisUrl ? new Redis(redisUrl) : new Redis();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error("Failed to initialize Redis client", error);
  redisClient = null;
}

export const redis = redisClient;

