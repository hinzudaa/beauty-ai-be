import { MongoMemoryServer } from "mongodb-memory-server";

let mongod: MongoMemoryServer;

export async function setup() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "beauty_test";
  (global as unknown as Record<string, unknown>).__MONGOD__ = mongod;
}

export async function teardown() {
  const mongod = (global as unknown as Record<string, unknown>).__MONGOD__ as MongoMemoryServer;
  if (mongod) await mongod.stop();
}
