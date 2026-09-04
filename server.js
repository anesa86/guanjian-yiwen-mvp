require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 最簡單的測試路徑，先確認 server 有沒有正常開機
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "server 活著" });
});

// 測試路徑：確認 server 能不能成功呼叫 Anthropic API
app.get("/api/test-claude", async (req, res) => {
  try {
    console.log("正在呼叫 Anthropic API...");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "請用繁體中文回答：1+1等於多少？" }],
    });
    res.json({ success: true, reply: message.content[0].text });
  } catch (err) {
    console.error("呼叫 API 時發生錯誤：", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server 已啟動，網址：http://localhost:${PORT}`);
});