require("dotenv").config();
const express = require("express");

const app = express();
const PORT = 3000;

// 最簡單的測試路徑，先確認 server 有沒有正常開機
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "server 活著" });
});

app.listen(PORT, () => {
  console.log(`Server 已啟動，網址：http://localhost:${PORT}`);
});