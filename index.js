import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ CORS Setup
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

// ✅ MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
};
connectDB();

// ✅ ImageKit Configuration
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

// ✅ Routes
app.get("/", (req, res) => {
  res.send("🚀 Backend is working!");
});

// 🔹 Image Upload Authentication
app.get("/api/upload", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
});

// 🔹 Create Chat
app.post("/api/chats", ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { text } = req.body;
    const newChat = new Chat({ userId, history: [{ role: "user", parts: [{ text }] }] });
    const savedChat = await newChat.save();

    // Check if user already has chats
    const userChats = await UserChats.findOne({ userId });

    if (!userChats) {
      const newUserChats = new UserChats({ userId, chats: [{ _id: savedChat._id, title: text.substring(0, 40) }] });
      await newUserChats.save();
    } else {
      await UserChats.updateOne({ userId }, { $push: { chats: { _id: savedChat._id, title: text.substring(0, 40) } } });
    }

    res.status(201).json({ chatId: savedChat._id });
  } catch (err) {
    console.error("❌ Error creating chat:", err);
    res.status(500).json({ message: "Error creating chat" });
  }
});

// 🔹 Get User Chats
app.get("/api/userchats", ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const userChats = await UserChats.findOne({ userId });
    res.status(200).json(userChats ? userChats.chats : []);
  } catch (err) {
    console.error("❌ Error fetching user chats:", err);
    res.status(500).json({ message: "Error fetching user chats" });
  }
});

// 🔹 Get a Specific Chat
app.get("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const chat = await Chat.findOne({ _id: req.params.id, userId });
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    res.status(200).json(chat);
  } catch (err) {
    console.error("❌ Error fetching chat:", err);
    res.status(500).json({ message: "Error fetching chat" });
  }
});

// 🔹 Update Chat with New Messages
app.put("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { question, answer, img } = req.body;
    const newItems = [
      ...(question ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }] : []),
      { role: "model", parts: [{ text: answer }] },
    ];

    const updatedChat = await Chat.updateOne({ _id: req.params.id, userId }, { $push: { history: { $each: newItems } } });
    res.status(200).json(updatedChat);
  } catch (err) {
    console.error("❌ Error updating chat:", err);
    res.status(500).json({ message: "Error updating chat" });
  }
});

// 🔹 Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.stack);
  res.status(500).json({ message: "Internal Server Error" });
});

// ✅ Export Express App for Vercel
export default app;
