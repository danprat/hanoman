import "./env";
import Redis from "ioredis";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
// BullMQ needs maxRetriesPerRequest: null; pub/sub needs *separate* connections
// (a subscribed client can't issue other commands), so publisher()/subscriber()
// mint fresh ioredis instances per caller.
export const bullConnection = { host: new URL(url).hostname, port: Number(new URL(url).port || 6379), maxRetriesPerRequest: null as null };
export const publisher = () => new Redis(url);
export const subscriber = () => new Redis(url);
