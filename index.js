import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import userRoutes from "./routes/userRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js"
dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());

const uri = process.env.DB_URI

// DB Connection
main().catch((err) => console.log(err));

async function main() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
  }
}


// routes
app.use("/api/user", userRoutes);
app.use("/api/resume", resumeRoutes)

app.listen( () => {
  console.log(`Server is started`);
});
