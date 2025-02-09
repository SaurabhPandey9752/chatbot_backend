import express from "express";
import cors from "cors";
import path from "path";
import url, { fileURLToPath } from "url";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
const port = process.env.PORT || 3000;
const app = express();

// Enable CORS - Updated to be more permissive in development
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.CLIENT_URL 
      : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection with retry logic
const connect = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO, {
        serverSelectionTimeoutMS: 5000,
        retryWrites: true,
      });
      console.log("Connected to MongoDB");
    }
  } catch (err) {
    console.error("MongoDB connection error:", err);
    // Retry connection after 5 seconds
    setTimeout(connect, 5000);
  }
};

// ImageKit Setup
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

// Health Check Route
app.get("/api/healthcheck", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Upload Route
app.get("/api/upload", (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    res.status(200).json(result);
  } catch (err) {
    console.error("ImageKit error:", err);
    res.status(500).json({ error: "Failed to get upload parameters" });
  }
});

// Create Chat Route
app.post("/api/chats", ClerkExpressRequireAuth(), async (req, res) => {
  await connect();
  const userId = req.auth.userId;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const newChat = new Chat({
      userId: userId,
      history: [{ role: "user", parts: [{ text }] }],
    });

    const savedChat = await newChat.save();
    const userChats = await UserChats.find({ userId: userId });

    if (!userChats.length) {
      const newUserChats = new UserChats({
        userId: userId,
        chats: [
          {
            _id: savedChat._id,
            title: text.substring(0, 40),
          },
        ],
      });
      await newUserChats.save();
    } else {
      await UserChats.updateOne(
        { userId: userId },
        {
          $push: {
            chats: {
              _id: savedChat._id,
              title: text.substring(0, 40),
            },
          },
        }
      );
    }

    res.status(201).json({ chatId: savedChat._id });
  } catch (err) {
    console.error("Create chat error:", err);
    res.status(500).json({ error: "Error creating chat" });
  }
});

// Get User Chats Route
app.get("/api/userchats", ClerkExpressRequireAuth(), async (req, res) => {
  await connect();
  const userId = req.auth.userId;

  try {
    const userChats = await UserChats.find({ userId });
    if (!userChats.length) {
      return res.status(200).json({ chats: [] });
    }
    res.status(200).json({ chats: userChats[0].chats });
  } catch (err) {
    console.error("Fetch userchats error:", err);
    res.status(500).json({ error: "Error fetching userchats" });
  }
});

// Get Single Chat Route
app.get("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  await connect();
  const userId = req.auth.userId;

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }
    res.status(200).json(chat);
  } catch (err) {
    console.error("Fetch chat error:", err);
    res.status(500).json({ error: "Error fetching chat" });
  }
});

// Update Chat Route
app.put("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  await connect();
  const userId = req.auth.userId;
  const { question, answer, img } = req.body;

  const newItems = [
    ...(question
      ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }]
      : []),
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          history: {
            $each: newItems,
          },
        },
      },
      { new: true }
    );
    res.status(200).json(updatedChat);
  } catch (err) {
    console.error("Update chat error:", err);
    res.status(500).json({ error: "Error updating chat" });
  }
});

// Error Handler for Clerk Authentication
app.use((err, req, res, next) => {
  console.error("Authentication error:", err);
  res.status(401).json({ error: "Unauthenticated" });
});

// Handle all other routes
app.all("*", (req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found"
  });
});

// Export the app for Vercel
export default app;
