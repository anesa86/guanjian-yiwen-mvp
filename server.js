require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = 3000;

// 讓 server 可以讀懂瀏覽器傳來的 JSON 格式資料
app.use(express.json());
// 允許瀏覽器（包含用 file:// 打開的網頁）呼叫這個 server。
// 沒有這段，瀏覽器會因為 CORS 安全機制直接擋掉請求，
// 連 server 有沒有正常運作都測試不到。
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 給模型的規則，只負責「理解語意」，不負責算分數、不負責決定要不要問
const ANALYZE_TASK_SYSTEM_PROMPT = `你是一個任務分析助手。使用者會給你一個工作任務（taskInput）與一段背景資訊（context）。

你的工作只有兩件事：
1. 找出已經確認清楚的資訊（confirmed）——必須同時從 taskInput 與 context 抽取，不能只看 context。
2. 找出資訊中缺漏或互相衝突的地方（uncertainties）。

判斷 uncertainty 的規則（只有符合以下其中一種情況才列為 uncertainty）：
- 使用者提供的資訊彼此明確衝突；或
- 根據使用者明確要求的工作動作，某項資訊是完成該動作不可缺少、且不同答案會實質改變執行結果的條件。
不得依產業慣例或「通常這類任務可能還需要什麼」自行假設還需要其他欄位。只根據 taskInput 與 context 裡實際出現的內容判斷。

低影響缺漏的處理：
- 如果 taskInput/context 有明確提到一個低影響的缺漏（例如任務裡提到報告但沒指定字體），仍要回傳這個 uncertainty，並將 affectedAspects 標為 format。
- 但如果使用者根本沒有提到某個面向（例如沒人提字體、顏色、版型），不要自己枚舉「可能還缺字體、顏色……」去湊出 uncertainty。
- 一個 uncertainty 該不該真的拿去打斷使用者，由後續的 deterministic 規則決定，不由你決定；你只需要如實回報「有沒有明確缺漏或衝突」。

affectedAspects 只能從這七個詞裡面選（可複選，不可自創新詞）：
goal（核心目標）、external（對外或不可逆行動）、strategy（主要內容或策略）、
budget（預算或資源）、audience（使用者或受眾）、deadline（時程）、format（格式或呈現）

evidence 規則：
- evidence 永遠是陣列，不可省略這個欄位。
- type 為 conflict 時，原則上應包含造成衝突的來源證據（每個衝突的來源各一筆）。
- type 為 missing 時，允許回傳空陣列 []；但如果輸入中有能支持這個判斷的片段，也可以加入 evidence。
- 絕對不可以為了填滿 evidence 而杜撰不存在的來源或內容。
- evidence 裡的 value 必須優先使用輸入文字中的原始短片段，不要自己改寫或發明。

其他規則：
- 每個 uncertainty 的 question 必須直接針對這個缺漏或衝突本身提問，不要問寬泛、模糊、或範圍過大的問題。
- 每個 uncertainty 的 reason 必須具體說明「如果不確認這件事，執行結果會被怎麼改變」，不能只寫「這很重要」「這需要確認」這類空泛描述。
- 如果背景資訊完全沒有符合上述條件的缺漏或衝突，uncertainties 回傳空陣列 []，不要為了「湊一個問題」而硬找。
- 絕對不要輸出 impactScore、needsClarification、criticalIssue、answerOptions，這些由我們自己的程式計算，與你無關。

只回傳 JSON，不要有任何其他文字、不要加 markdown 的 \`\`\`json 標記，格式如下：
{
  "confirmed": [
    { "field": "...", "value": "...", "source": "..." }
  ],
  "uncertainties": [
    {
      "id": "u1",
      "field": "...",
      "type": "missing 或 conflict",
      "description": "...",
      "evidence": [
        { "source": "...", "value": "..." }
      ],
      "affectedAspects": ["strategy", "budget"],
      "question": "...",
      "reason": "..."
    }
  ]
}`;

// 最簡單的測試路徑，先確認 server 有沒有正常開機
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "server 活著" });
});

// 真正的分析路徑：接收 taskInput 與 context，讓 Claude 分析
app.post("/api/analyze-task", async (req, res) => {
  const { taskInput, context } = req.body;

  if (!taskInput) {
    return res.status(400).json({ success: false, error: "缺少 taskInput" });
  }

  try {
    console.log("正在分析任務：", taskInput);
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: ANALYZE_TASK_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `taskInput: ${taskInput}\n\ncontext: ${context || "（無）"}`,
        },
      ],
    });

    let rawText = message.content[0].text;

    // 模型有時候會習慣性把 JSON 包在 markdown 的 ```json 標記裡，
    // 即使 prompt 已經要求不要這樣做，這裡先做一層防呆，把包裝拿掉再解析。
    rawText = rawText.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("無法解析模型回傳的 JSON：", rawText);
      return res.status(500).json({
        success: false,
        error: "模型回傳的內容不是有效的 JSON",
        rawText,
      });
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error("呼叫 API 時發生錯誤：", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server 已啟動，網址：http://localhost:${PORT}`);
});