// ai-service.js
//
// 這個檔案是整個產品「唯一」跟 AI 邏輯溝通的入口。
// app.js（UI 邏輯）只會呼叫這裡的四個函式，完全不知道背後是 mock 還是真的 API。
//
// ============================================================
// 【重要】未來接真 API 時，只需要改這個檔案裡面的實作，規則如下：
//
// 1. 這四個函式最終應該改成 fetch 我們「自己 server 的 endpoint」，
//    例如 fetch('/api/analyze-task', {...})，
//    再由 server 端去呼叫 OpenAI / Anthropic。
// 2. API key 絕對不能寫在這支前端檔案，也不能出現在瀏覽器 devtools 看得到的地方。
// 3. 呼叫端（app.js）收到的資料格式現在就先定好，之後 server 回傳的 JSON
//    要符合一樣的形狀，UI 才不用改。
//
// 目前這個檔案先用 mock 資料，還沒有任何網路呼叫。
//
// 【這一版的改動】原本 analyzeTask 不管輸入什麼都固定回傳案例 C，
// 現在改成可以指定要用哪一個 mock 案例（caseId），讓六個測試案例都能真的
// 在畫面上點過一次。等真 API 接上後，caseId 這個參數就會整個拿掉，
// 因為屆時是模型真的去分析 taskInput/context，不再需要指定案例。
//
// 注意：這裡故意不用 import/export（ES module），原因跟 mock-data.js 一樣，
// 是為了讓 index.html 可以直接雙擊打開跑，不需要架本地伺服器。
// 這個檔案要在 index.html 裡排在 mock-data.js 之後載入，
// 才能透過 window.MockData 拿到資料。
//
// 整個檔案也包在 IIFE 裡，原因跟 mock-data.js 一樣：
// 避免函式名稱（analyzeTask 等）洩漏到全域跟 app.js 撞名。
// 對外只透過 window.AIService 曝露這四個函式。
// ============================================================
(function () {

const allCases = window.MockData.cases;

// ------------------------------------------------------------
// 影響分數規則（deterministic，不是模型決定的）
//
// 模型（未來）只需要判斷一個不確定事項「影響哪些面向」，
// 例如 affectedAspects: ["strategy", "budget"]。
// 分數則完全由我們自己寫的規則計算，可以在 README 清楚解釋，
// 也方便之後調整權重而不用重新設計 prompt。
// ------------------------------------------------------------
const ASPECT_WEIGHTS = {
  goal: 5, // 核心目標
  external: 5, // 對外 / 不可逆行動
  strategy: 4, // 主要內容 / 策略
  budget: 4, // 預算 / 資源
  audience: 3, // 使用者 / 受眾
  deadline: 3, // Deadline
  format: 1, // 格式 / 表面呈現
};

// 超過這個分數才值得打斷使用者問問題
const IMPACT_THRESHOLD = 6;

function calculateImpactScore(affectedAspects = []) {
  return affectedAspects.reduce((total, aspect) => {
    return total + (ASPECT_WEIGHTS[aspect] || 0);
  }, 0);
}

// 把模型（或 mock）給的 uncertainties 補上 impactScore，並選出關鍵一問。
// mock 與 Live 共用這段，分數永遠不是模型決定的。
function scoreAndSelectCriticalIssue(confirmed, uncertainties) {
  const uncertaintiesWithScore = (uncertainties || []).map((u) => ({
    ...u,
    impactScore: calculateImpactScore(u.affectedAspects),
  }));

  const sorted = [...uncertaintiesWithScore].sort(
    (a, b) => b.impactScore - a.impactScore
  );
  const topIssue = sorted[0];
  const needsClarification =
    !!topIssue && topIssue.impactScore >= IMPACT_THRESHOLD;

  return {
    confirmed: confirmed || [],
    uncertainties: uncertaintiesWithScore,
    needsClarification,
    criticalIssue: needsClarification ? topIssue : null,
  };
}

// 模擬網路延遲，之後真的接 API 時可以直接刪掉這個
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// 1. analyzeTaskMock(taskInput, context, caseId)
//
// caseId：指定要用 mock-data.js 裡哪一個案例的資料
// （例如 "caseA" ~ "caseF"）。Demo 模式會用這個函式。
//
// 回傳格式：
// {
//   caseId,
//   confirmed: [{ field, value, source }],
//   uncertainties: [{ id, description, affectedAspects, impactScore, question, reason, answerOptions? }],
//   needsClarification: boolean,
//   criticalIssue: 上面 uncertainties 其中一項（分數最高且超過門檻），或 null
// }
// ------------------------------------------------------------
async function analyzeTaskMock(taskInput, context, caseId) {
  await delay(600);

  const mockCase = allCases[caseId] || allCases.caseC;
  const scored = scoreAndSelectCriticalIssue(
    mockCase.confirmed,
    mockCase.uncertainties
  );

  return {
    caseId,
    ...scored,
  };
}

// ------------------------------------------------------------
// analyzeTaskLive(taskInput, context)
//
// 這是這次新增的「真的呼叫 API」版本。
// 不接受 caseId 參數 —— Live 模式下模型必須真的分析 taskInput/context 的
// 實際內容，不能用案例代號去查表。
//
// server 只回 { confirmed, uncertainties }（含 affectedAspects）。
// impactScore / needsClarification / criticalIssue 在前端用跟 mock 同一套規則補上。
//
// 失敗時：丟出一個 Error，訊息盡量簡短、給使用者看得懂的中文，
// 讓 app.js 可以直接把 err.message 顯示出來。
// ------------------------------------------------------------
async function analyzeTaskLive(taskInput, context) {
  let response;
  try {
    response = await fetch("http://localhost:3000/api/analyze-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskInput, context }),
    });
  } catch (networkErr) {
    // 通常是 server 根本沒開，或網路完全不通
    throw new Error("AI 預檢暫時無法連線，請重試");
  }

  let body;
  try {
    body = await response.json();
  } catch (parseErr) {
    throw new Error("AI 預檢暫時無法連線，請重試");
  }

  if (!response.ok || !body.success) {
    throw new Error("AI 預檢暫時無法連線，請重試");
  }

  // body.data 應該長得像 { confirmed: [...], uncertainties: [...] }
  return scoreAndSelectCriticalIssue(body.data.confirmed, body.data.uncertainties);
}

// ------------------------------------------------------------
// 2. buildExecutionContract(analysisResult, userAnswerId)
//
// userAnswerId：使用者選的「選項 id」（例如 "yes" / "no"）。
// 如果 needsClarification 一開始就是 false，這裡會是 null，
// 這種情況固定使用該案例 outcomes 裡的 "direct" 那組資料。
//
// 回傳：一個純物件，代表「工作契約」，畫面 3 會直接渲染這個物件。
// ------------------------------------------------------------
async function buildExecutionContract(analysisResult, userAnswerId) {
  await delay(400);

  const mockCase = allCases[analysisResult.caseId] || allCases.caseC;
  const outcomeKey = analysisResult.needsClarification ? userAnswerId : "direct";
  const outcome = mockCase.outcomes[outcomeKey] || mockCase.outcomes.direct;

  // 找出選項的顯示文字（給畫面 3 顯示「這是根據你選的哪個答案建立的」）
  const selectedOption = analysisResult.criticalIssue?.answerOptions?.find(
    (opt) => opt.id === userAnswerId
  );

  return {
    ...outcome.contract,
    // _ 開頭的欄位是內部用的，畫面 3 渲染契約時會略過，不會顯示出來，
    // 但 executeTask/verifyResult 需要靠它們找到正確的那組 outcome。
    _caseId: analysisResult.caseId,
    _outcomeKey: outcomeKey,
    _resolvedFrom: {
      question: analysisResult.criticalIssue?.question || null,
      userAnswer: selectedOption?.label || null,
    },
  };
}

// ------------------------------------------------------------
// 3. executeTask(contract)
//
// 回傳：字串（AI 生成的成果內容）
// ------------------------------------------------------------
async function executeTask(contract) {
  await delay(800);
  // 之後接真 API：這裡改成把 contract 當成 prompt 的一部分送給模型。
  const mockCase = allCases[contract._caseId] || allCases.caseC;
  const outcome = mockCase.outcomes[contract._outcomeKey] || mockCase.outcomes.direct;
  return outcome.executionResult;
}

// ------------------------------------------------------------
// 4. verifyResult(result, contract)
//
// 回傳：
// {
//   checklist: [{ label, passed }],
//   passedCount: number,
//   totalCount: number
// }
// ------------------------------------------------------------
async function verifyResult(result, contract) {
  await delay(500);
  const mockCase = allCases[contract._caseId] || allCases.caseC;
  const outcome = mockCase.outcomes[contract._outcomeKey] || mockCase.outcomes.direct;
  const checklist = outcome.verificationChecklist;
  const passedCount = checklist.filter((item) => item.passed).length;
  return {
    checklist,
    passedCount,
    totalCount: checklist.length,
  };
}

// 掛到全域變數上，讓 app.js 可以直接用 AIService.analyzeTaskMock(...) 呼叫
window.AIService = {
  analyzeTaskMock,
  analyzeTaskLive,
  buildExecutionContract,
  executeTask,
  verifyResult,
  IMPACT_THRESHOLD,
};

})(); // IIFE 結束
