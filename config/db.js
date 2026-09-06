import mongoose from "mongoose";
import { env } from "./env.js";

// Cached across invocations. On serverless the module is reused between warm
// requests, so a new connection per request would exhaust the connection pool.
let connectionPromise = null;

export const connectDB = () => {
  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(env.DB_URI, { serverSelectionTimeoutMS: 10_000 })
      .then((conn) => {
        console.log("Connected to MongoDB");
        return conn;
      })
      .catch((err) => {
        // Cleared so a later request can retry rather than reusing a rejected
        // promise forever.
        connectionPromise = null;
        throw err;
      });
  }
  return connectionPromise;
};
