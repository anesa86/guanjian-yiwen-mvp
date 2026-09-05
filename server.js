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

field 欄位規則：
- confirmed 與 uncertainties 裡的 field 僅作為人類可讀的項目名稱，必須使用簡短、自然的繁體中文名詞或名詞短語。
- 例如：「任務類型」、「原始內容」、「語氣方向」、「退款授權」、「會議時間」。
- 不要輸出 snake_case、camelCase、程式變數名稱或英文欄位代號。
- 品牌名、產品名或無自然中文譯名的專有名詞可以保留原文。
判斷 uncertainty 的規則（只有符合以下其中一種情況才列為 uncertainty）：
- 使用者提供的資訊彼此明確衝突；或
- 根據使用者明確要求的工作動作，某項資訊是完成該動作不可缺少、且不同答案會實質改變執行結果的條件。
不得依產業慣例或「通常這類任務可能還需要什麼」自行假設還需要其他欄位。只根據 taskInput 與 context 裡實際出現的內容判斷。

對「因資訊未出現而推論出的 missing uncertainty」，必須再通過 necessity test：

先判斷：
「即使沒有這項資訊，是否仍能忠實完成使用者明確要求的任務？」

- 如果仍然可以忠實完成，就不要因為這項資訊沒有出現而自行建立 missing uncertainty。
- 只有當缺少這項資訊會讓任務無法忠實完成，或不同答案會實質改變使用者要求的輸出結果時，才可以列為 missing uncertainty。
- 這條規則不影響使用者已經明確指出的低影響缺漏；例如使用者明確提到「字體未指定」，仍可依後面的低影響缺漏規則回傳為 format uncertainty，再交由 deterministic policy 決定是否打斷。

尤其對摘要、翻譯、改寫、格式轉換等「處理既有內容」的任務：
- 不要因為沒有提供收件者身份、公司背景、產業慣例等額外資訊而自行追問。
- 除非使用者明確要求的成果確實會因這項資訊而產生實質不同。
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
// Execute 用的規則：只根據工作契約產生成果，不能編造契約沒提到的細節
const EXECUTE_TASK_SYSTEM_PROMPT = `你是一個任務執行助手。使用者會給你一份「工作契約」，
裡面包含原始工作任務（taskInput）、已確認事項（confirmedItems）、以及使用者對關鍵問題的澄清（clarifications）。

你的工作是：根據這份工作契約，產生這個任務應該交付的實際工作成果。

嚴格規則：
- 只能根據契約裡實際出現的內容產生成果，不可以編造契約沒有提到的細節、公司規則或背景事實。
- 成果的形式要符合任務類型本身（例如：會議邀請類任務產生邀請文字、客訴類任務產生客服回覆草稿、
  提案類任務產生 proposal draft、摘要類任務產生摘要），你自己判斷最適合的形式，不需要遵循固定模板。
- 只回傳成果內容本身的純文字，不要加上任何說明、標題、或 markdown 符號（例如不要用 \`\`\` 包起來）。`;

// Verify 用的規則：逐項比對契約要求，只給 checks，passedCount/totalCount 由我們自己算
const VERIFY_RESULT_SYSTEM_PROMPT = `你是一個任務驗證助手。使用者會給你一份「工作契約」跟根據這份契約產生的「執行成果」。

你的工作是：把契約裡的 confirmedItems 跟 clarifications 每一項都轉換成一條檢查項目（requirement），
逐一比對執行成果有沒有確實符合這項要求。

規則：
- 每一條檢查都要給 passed（true/false）跟 evidence（簡短說明依據）。
- 不管 passed 是 true 或 false，evidence 都要具體：符合時說明成果裡哪裡有對應到；
  不符合時說明成果裡缺了什麼、或寫錯了什麼。
- 不要自己發明契約裡沒有的檢查項目。
- 不要輸出 passedCount 或 totalCount，這些由我們自己的程式計算，與你無關。

只回傳 JSON，不要有任何其他文字、不要加 markdown 的 \`\`\`json 標記，格式如下：
{
  "checks": [
    { "requirement": "...", "passed": true, "evidence": "..." }
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
// 執行路徑：接收工作契約，讓 Claude 產生對應的工作成果
app.post("/api/execute-task", async (req, res) => {
  const { contract } = req.body;

  if (!contract) {
    return res.status(400).json({ success: false, error: "缺少 contract" });
  }

  try {
    console.log("正在依契約產生成果：", contract.taskInput);
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: EXECUTE_TASK_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `工作契約：\n${JSON.stringify(contract, null, 2)}`,
        },
      ],
    });

    const result = message.content[0].text.trim();
    res.json({ success: true, result });
  } catch (err) {
    console.error("執行任務時發生錯誤：", err.message);
    res.status(500).json({ success: false, error: "AI 執行暫時無法連線，請重試" });
  }
});

// 驗證路徑：接收契約與執行成果，讓 Claude 逐項檢查是否符合
app.post("/api/verify-result", async (req, res) => {
  const { contract, result } = req.body;

  if (!contract || !result) {
    return res.status(400).json({ success: false, error: "缺少 contract 或 result" });
  }

  try {
    console.log("正在驗證執行成果...");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: VERIFY_RESULT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `工作契約：\n${JSON.stringify(contract, null, 2)}\n\n執行成果：\n${result}`,
        },
      ],
    });

    let rawText = message.content[0].text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("無法解析驗證結果的 JSON：", rawText);
      return res.status(500).json({
        success: false,
        error: "模型回傳的驗證結果不是有效的 JSON",
        rawText,
      });
    }

    // passedCount/totalCount 我們自己算，不信任模型算的數字
    const checks = parsed.checks || [];
    const passedCount = checks.filter((c) => c.passed).length;

    res.json({
      success: true,
      data: { checks, passedCount, totalCount: checks.length },
    });
  } catch (err) {
    console.error("驗證結果時發生錯誤：", err.message);
    res.status(500).json({ success: false, error: "AI 驗證暫時無法連線，請重試" });
  }
});

app.listen(PORT, () => {
  console.log(`Server 已啟動，網址：http://localhost:${PORT}`);
});