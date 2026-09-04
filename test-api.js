require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  console.log("正在呼叫 Anthropic API...");
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 100,
    messages: [{ role: "user", content: "請用繁體中文回答：1+1等於多少？" }],
  });
  console.log("收到回應：");
  console.log(message.content[0].text);
}

main().catch((err) => {
  console.error("發生錯誤：", err.message);
});