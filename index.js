import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 5000;

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

// Enable CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);

app.use(express.json());

// Database Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1); // Exit process if connection fails
  }
};

// Initialize ImageKit
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

// API Routes
app.get("/api/upload", (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    res.status(200).json(result);
  } catch (error) {
    console.error("Error generating auth parameters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create Chat
app.post("/api/chats", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const newChat = new Chat({
      userId,
      history: [{ role: "user", parts: [{ text }] }],
    });

    const savedChat = await newChat.save();

    // Find user chats
    let userChats = await UserChats.findOne({ userId });

    if (!userChats) {
      userChats = new UserChats({
        userId,
        chats: [{ _id: savedChat._id, title: text.substring(0, 40) }],
      });

      await userChats.save();
    } else {
      userChats.chats.push({ _id: savedChat._id, title: text.substring(0, 40) });
      await userChats.save();
    }

    res.status(201).json({ chatId: savedChat._id });
  } catch (err) {
    console.error("Error creating chat:", err);
    res.status(500).json({ error: "Error creating chat" });
  }
});

// Get User Chats
app.get("/api/userchats", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const userChats = await UserChats.findOne({ userId });

    if (!userChats) {
      return res.status(404).json({ error: "No chats found" });
    }

    res.status(200).json(userChats.chats);
  } catch (err) {
    console.error("Error fetching user chats:", err);
    res.status(500).json({ error: "Error fetching user chats" });
  }
});

// Get Chat by ID
app.get("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.status(200).json(chat);
  } catch (err) {
    console.error("Error fetching chat:", err);
    res.status(500).json({ error: "Error fetching chat" });
  }
});

// Update Chat
app.put("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { question, answer, img } = req.body;

  if (!answer) {
    return res.status(400).json({ error: "Answer is required" });
  }

  const newItems = [
    ...(question ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }] : []),
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      { $push: { history: { $each: newItems } } }
    );

    if (updatedChat.modifiedCount === 0) {
      return res.status(404).json({ error: "Chat not found or not modified" });
    }

    res.status(200).json({ message: "Chat updated successfully" });
  } catch (err) {
    console.error("Error updating chat:", err);
    res.status(500).json({ error: "Error updating chat" });
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// Static Files (Vercel Deployment)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
  });
}

// Start Server
app.listen(port, async () => {
  await connectDB();
  console.log(🚀 Server running on port ${port});
});

export default app;
