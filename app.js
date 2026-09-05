// app.js
//
// 這個檔案只負責「畫面」：
// - 使用者按了哪個按鈕
// - 呼叫 ai-service.js 對應的函式
// - 把回傳的資料塞進 DOM、切換顯示哪個畫面
//
// 這裡完全不知道資料是 mock 還是真的 API，
// 也不做任何 impact_score 的計算（那是 ai-service.js 的責任）。
//
// 注意：這裡故意不用 import（ES module），原因跟另外兩個檔案一樣，
// 是為了讓 index.html 可以直接雙擊打開跑。
// 這個檔案要排在 mock-data.js、ai-service.js 之後載入。

const analyzeTaskMock = window.AIService.analyzeTaskMock;
const analyzeTaskLive = window.AIService.analyzeTaskLive;
const buildExecutionContract = window.AIService.buildExecutionContract;
const buildExecutionContractLive = window.AIService.buildExecutionContractLive;
const executeTask = window.AIService.executeTask;
const executeTaskLive = window.AIService.executeTaskLive;
const verifyResult = window.AIService.verifyResult;
const verifyResultLive = window.AIService.verifyResultLive;
const IMPACT_THRESHOLD = window.AIService.IMPACT_THRESHOLD;
const ASPECT_WEIGHTS = window.AIService.ASPECT_WEIGHTS;

// 保存這一輪流程的狀態，畫面之間互相傳遞用
const state = {
  taskInput: "",
  context: "",
  mode: "live",
  analysisResult: null,
  userAnswer: null,
  pendingQuestions: [],
  clarifications: [],
  contract: null,
  executionResult: null,
};

// ---------- 範例任務（正式產品用，純粹示範怎麼寫，不切換任何模式）----------
// 這三組範例只負責把文字填進輸入框，使用者仍要自己按「開始預檢」，
// 而且一律走 analyzeTaskLive，不會因為點了範例就變成查表的 Mock 結果。
const EXAMPLE_TASKS = [
  {
    label: "行銷提案",
    taskInput: "幫我做好新品提案，等等寄給代理商。",
    context:
      "1. 會議紀錄：本季主要目標是舊客回購，不考慮 KOL。\n" +
      "2. 舊版 brief：預算最高 30 萬，TA 為 18–24 歲。\n" +
      "3. 最新團隊訊息：主管今天提到 micro influencer 似乎可以測試看看。",
  },
  {
    label: "信件改寫",
    taskInput: "把這封客戶信件的語氣改得更正式一點。",
    context:
      "原信件內容：嗨，你們的貨到現在都還沒到，到底什麼時候會到啦？我等超久了，快點處理一下謝謝。",
  },
  {
    label: "客戶退款",
    taskInput: "幫我回覆這位客戶並處理他的退款要求。",
    context:
      "客戶表示收到的商品外盒破損，要求全額退款。訂單已確認是在 7 天內購買，" +
      "客服紀錄中有訂單編號與商品問題說明。目前主管尚未說明這筆訂單可直接核准的退款金額範圍，" +
      "客服人員也沒有收到本次個案的退款授權。",
  },
];

(function renderExampleTasks() {
  const container = document.getElementById("example-task-selector");
  EXAMPLE_TASKS.forEach((example) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-btn";
    btn.textContent = example.label;
    btn.addEventListener("click", () => {
      document.getElementById("task-input").value = example.taskInput;
      document.getElementById("context-input").value = example.context;
      // 只填文字，不自動送出，使用者仍要自己按「開始預檢」
    });
    container.appendChild(btn);
  });
})();

// ---------- 畫面切換 ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    const isTarget = el.id === id;
    el.classList.toggle("active", isTarget);
    el.style.display = isTarget ? "block" : "none";
  });
}

// ---------- 畫面 1：任務輸入 ----------
const liveStatusEl = document.getElementById("live-status");
const liveErrorEl = document.getElementById("live-error");
const liveErrorTextEl = document.getElementById("live-error-text");
const liveDebugEl = document.getElementById("live-debug");
const liveDebugContentEl = document.getElementById("live-debug-content");

function hideLiveStatusBlocks() {
  liveStatusEl.classList.add("hidden");
  liveErrorEl.classList.add("hidden");
  liveDebugEl.classList.add("hidden");
}

async function runLiveAnalysis() {
  const taskInput = document.getElementById("task-input").value.trim();
  const context = document.getElementById("context-input").value.trim();

  if (!taskInput) {
    alert("請先輸入你希望 AI 完成什麼任務");
    return;
  }

  const btn = document.getElementById("btn-start-check");

  hideLiveStatusBlocks();
  btn.disabled = true;
  btn.textContent = "分析中...";
  liveStatusEl.classList.remove("hidden");

  try {
    const result = await analyzeTaskLive(taskInput, context);

    state.taskInput = taskInput;
    state.context = context;
    state.analysisResult = result;
    state.clarifications = [];

    state.pendingQuestions = (result.uncertainties || [])
      .filter((u) => u.impactScore >= IMPACT_THRESHOLD)
      .sort((a, b) => b.impactScore - a.impactScore);

    hideLiveStatusBlocks();
    renderScreen2(result);
    showScreen("screen-2");
  } catch (err) {
    liveErrorEl.classList.remove("hidden");
    liveErrorTextEl.textContent = err.message || "AI 預檢暫時無法連線，請重試";
  } finally {
    liveStatusEl.classList.add("hidden");
    btn.disabled = false;
    btn.textContent = "開始預檢";
  }
}

document.getElementById("btn-start-check").addEventListener("click", runLiveAnalysis);
document.getElementById("btn-retry-live").addEventListener("click", runLiveAnalysis);

// ---------- 畫面 2：工作預檢 / 關鍵一問 ----------
function renderScreen2(analysisResult) {
  const confirmedList = document.getElementById("confirmed-list");
  confirmedList.innerHTML = "";
  analysisResult.confirmed.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.field}：${item.value}（來源：${item.source}）`;
    confirmedList.appendChild(li);
  });
  // Decision Summary：先給結論，再看細節。純粹用deterministic的分數做計算，不是模型生成的。
  const highCount = analysisResult.uncertainties.filter((u) => u.impactScore >= IMPACT_THRESHOLD).length;
  const lowCount = analysisResult.uncertainties.length - highCount;
  const summaryEl = document.getElementById("decision-summary");
  if (analysisResult.uncertainties.length === 0) {
    summaryEl.textContent = "沒有發現任何不確定事項，可直接執行。";
  } else if (highCount === 0) {
    summaryEl.textContent = `發現 ${lowCount} 個不確定事項，皆低於中斷門檻，可直接執行。`;
  } else {
    summaryEl.textContent = `發現 ${analysisResult.uncertainties.length} 個不確定事項，${highCount} 個需要澄清，${lowCount} 個可直接略過。`;
  }
  const uncertaintyList = document.getElementById("uncertainty-list");
  uncertaintyList.innerHTML = "";

  // 面向名稱對照表：模型輸出的英文代號 → 中文顯示
  const ASPECT_LABELS = {
    goal: "核心目標",
    external: "對外/不可逆",
    strategy: "策略",
    budget: "預算",
    audience: "受眾",
    deadline: "時程",
    format: "格式",
  };

  analysisResult.uncertainties.forEach((u) => {
    const li = document.createElement("li");
    li.className = "uncertainty-item";
    const isHigh = u.impactScore >= IMPACT_THRESHOLD;

    // 證據列表（可能是空陣列，missing類型常見沒有evidence）
    const evidenceHtml = (u.evidence || [])
      .map((e) => `<li>「${e.value}」— 來源：${e.source}</li>`)
      .join("");

    // 影響面向的badge
    const aspectsHtml = (u.affectedAspects || [])
      .map((a) => {
        const weight = ASPECT_WEIGHTS[a] || 0;
        return `<span class="aspect-tag">${ASPECT_LABELS[a] || a} +${weight}</span>`;
      })
      .join("");

    li.innerHTML = `
      <p class="uncertainty-desc">${u.description}</p>
      ${evidenceHtml ? `<div class="evidence-block"><p class="trace-label">證據</p><ul class="evidence-list">${evidenceHtml}</ul></div>` : ""}
      <div class="aspect-block">
        <p class="trace-label">影響面向</p>
        <div class="aspect-tags">${aspectsHtml}</div>
      </div>
      <p class="decision-line ${isHigh ? "decision-ask" : "decision-proceed"}">
        ${u.impactScore} 分 ${isHigh ? "≥" : "<"} 門檻 ${IMPACT_THRESHOLD} 分
        → ${isHigh ? "值得打斷，觸發關鍵一問" : "不打斷，不影響執行"}
      </p>
    `;
    uncertaintyList.appendChild(li);
  });

  const heroPanel = document.getElementById("critical-question-panel");
  const skipPanel = document.getElementById("no-clarification-panel");

  const currentQuestion =
    state.mode === "live" ? state.pendingQuestions[0] : analysisResult.criticalIssue;
  const stillNeedsClarification =
    state.mode === "live" ? state.pendingQuestions.length > 0 : analysisResult.needsClarification;

  if (stillNeedsClarification) {
    heroPanel.classList.remove("hidden");
    skipPanel.classList.add("hidden");
    document.getElementById("critical-question-text").textContent = currentQuestion.question;
    document.getElementById("critical-question-reason").textContent = currentQuestion.reason;

    const optionsContainer = document.getElementById("critical-question-options");
    const freeTextEl = document.getElementById("critical-question-freetext");
    const answerInput = document.getElementById("critical-answer-input");
    optionsContainer.innerHTML = "";
    if (answerInput) answerInput.value = "";

    const options = currentQuestion.answerOptions || [];
    const useFreeText = state.mode === "live" || options.length === 0;

    if (useFreeText) {
      optionsContainer.classList.add("hidden");
      if (freeTextEl) freeTextEl.classList.remove("hidden");
    } else {
      if (freeTextEl) freeTextEl.classList.add("hidden");
      optionsContainer.classList.remove("hidden");
      options.forEach((option) => {
        const btn = document.createElement("button");
        btn.textContent = option.label;
        btn.addEventListener("click", async () => {
          state.userAnswer = option.id;
          await goToContract();
        });
        optionsContainer.appendChild(btn);
      });
    }
  } else {
    heroPanel.classList.add("hidden");
    skipPanel.classList.remove("hidden");
  }
}

document.getElementById("btn-submit-live-answer").addEventListener("click", () => {
  const answerInput = document.getElementById("critical-answer-input");
  const answer = answerInput.value.trim();

  if (!answer) {
    alert("請先輸入你的回答。");
    return;
  }

  const answeredQuestion = state.pendingQuestions.shift();
  state.clarifications.push({
    field: answeredQuestion.field,
    question: answeredQuestion.question,
    answer,
  });

  if (state.pendingQuestions.length > 0) {
    renderScreen2(state.analysisResult);
  } else {
    goToLiveContract();
  }
});

async function goToLiveContract() {
  const contract = await buildExecutionContractLive(
    state.taskInput,
    state.context,
    state.analysisResult.confirmed,
    state.clarifications
  );
  state.contract = contract;
  renderScreen3(contract);
  showScreen("screen-3");
}

document.getElementById("btn-skip-question").addEventListener("click", async () => {
  if (state.mode === "live") {
    // Live 模式：不需要澄清，直接用空的 clarifications 建立契約
    await goToLiveContract();
  } else {
    state.userAnswer = null;
    await goToContract();
  }
});

async function goToContract() {
  const contract = await buildExecutionContract(state.analysisResult, state.userAnswer);
  state.contract = contract;
  renderScreen3(contract);
  showScreen("screen-3");
}

// ---------- 畫面 3：工作契約 ----------
function renderScreen3(contract) {
  const mockPanel = document.getElementById("mock-contract-panel");
  const livePanel = document.getElementById("live-contract-panel");

  if (contract._mode === "live") {
    mockPanel.classList.add("hidden");
    livePanel.classList.remove("hidden");
    renderLiveContract(contract);
  } else {
    livePanel.classList.add("hidden");
    mockPanel.classList.remove("hidden");
    renderMockContract(contract);
  }
}

function renderMockContract(contract) {
  const list = document.getElementById("contract-list");
  list.innerHTML = "";
  Object.entries(contract).forEach(([key, value]) => {
    if (key.startsWith("_")) return;
    const li = document.createElement("li");
    if (Array.isArray(value)) {
      li.textContent = `${key}：${value.join("、")}`;
    } else {
      li.textContent = `${key}：${value}`;
    }
    list.appendChild(li);
  });
}

function renderLiveContract(contract) {
  document.getElementById("live-contract-task").textContent = contract.taskInput;

  const confirmedList = document.getElementById("live-contract-confirmed");
  confirmedList.innerHTML = "";
  contract.confirmedItems.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `${item.field}：${item.value}<span class="source-tag">來源：${item.source}</span>`;
    confirmedList.appendChild(li);
  });

  const clarificationList = document.getElementById("live-contract-clarifications");
  clarificationList.innerHTML = "";
  contract.clarifications.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `${item.field}：${item.answer}<span class="source-tag">來源：使用者確認</span>`;
    clarificationList.appendChild(li);
  });
}

// ---------- 畫面 4：成果 + 驗證 ----------
//
// Mock 跟 Live 用 state.contract._mode 判斷走哪條路，兩條路互不干擾。

const liveExecuteStatusEl = document.getElementById("live-execute-status");
const liveVerifyStatusEl = document.getElementById("live-verify-status");
const mockNoticeEl = document.getElementById("mock-notice");

document.getElementById("btn-execute").addEventListener("click", async () => {
  const btn = document.getElementById("btn-execute");
  btn.disabled = true;

  if (state.contract._mode === "live") {
    // ---------- Live 模式：Execute → Verify 兩階段 ----------
    mockNoticeEl.classList.add("hidden");
    liveExecuteStatusEl.classList.remove("hidden");
    liveVerifyStatusEl.classList.add("hidden");
    btn.textContent = "執行中...";

    try {
      const resultText = await executeTaskLive(state.contract);
      state.executionResult = resultText;

      liveExecuteStatusEl.classList.add("hidden");
      liveVerifyStatusEl.classList.remove("hidden");

      const verification = await verifyResultLive(resultText, state.contract);

      liveVerifyStatusEl.classList.add("hidden");
      btn.disabled = false;
      btn.textContent = "開始執行";

      renderScreen4Live(resultText, verification);
      showScreen("screen-4");
    } catch (err) {
      liveExecuteStatusEl.classList.add("hidden");
      liveVerifyStatusEl.classList.add("hidden");
      btn.disabled = false;
      btn.textContent = "開始執行";
      alert(err.message || "執行或驗證暫時失敗，請重試");
    }
  } else {
    // ---------- Mock 模式：完全維持原本邏輯 ----------
    mockNoticeEl.classList.remove("hidden");
    btn.textContent = "執行中...";

    const resultText = await executeTask(state.contract);
    state.executionResult = resultText;

    const verification = await verifyResult(resultText, state.contract);

    btn.disabled = false;
    btn.textContent = "開始執行";

    renderScreen4Mock(resultText, verification);
    showScreen("screen-4");
  }
});
// 複製成果按鈕：Mock跟Live共用，因為state.executionResult兩種模式都有存
document.getElementById("btn-copy-result").addEventListener("click", async () => {
  const feedback = document.getElementById("copy-feedback");
  try {
    await navigator.clipboard.writeText(state.executionResult || "");
    feedback.classList.remove("hidden");
    setTimeout(() => feedback.classList.add("hidden"), 2000);
  } catch (err) {
    alert("複製失敗，請手動選取文字複製");
  }
});

// Mock 版渲染（跟原本一模一樣，只是改個名字方便跟 Live 版分開）
function renderScreen4Mock(resultText, verification) {
  document.getElementById("result-text").textContent = resultText;

  const list = document.getElementById("verification-list");
  list.innerHTML = "";
  verification.checklist.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.passed ? "✓" : "✗"} ${item.label}`;
    list.appendChild(li);
  });

  document.getElementById("verification-score").textContent =
    `${verification.passedCount} / ${verification.totalCount} 條件符合`;

  document.getElementById("verification-overall-status").textContent = "";
  document.getElementById("verification-overall-status").className = "verification-overall";
}

// Live 版渲染：checks 裡有 requirement/passed/evidence，
// 沒通過的項目要額外顯示原因跟「建議：請人工確認或重新執行」
function renderScreen4Live(resultText, verification) {
  document.getElementById("result-text").textContent = resultText;

  const list = document.getElementById("verification-list");
  list.innerHTML = "";

  verification.checks.forEach((item) => {
    const li = document.createElement("li");
    if (item.passed) {
      li.textContent = `✓ ${item.requirement}（${item.evidence}）`;
    } else {
      li.className = "verification-item-fail";
      li.innerHTML = `✗ 未符合：${item.requirement}（${item.evidence}）
        <div class="verification-suggestion">建議：請人工確認或重新執行</div>`;
    }
    list.appendChild(li);
  });

  document.getElementById("verification-score").textContent =
    `${verification.passedCount} / ${verification.totalCount} 條件符合`;

    const overallEl = document.getElementById("verification-overall-status");
    const allPassed = verification.passedCount === verification.totalCount;
    overallEl.textContent = allPassed ? "契約檢查通過 ✓" : "結果需要人工確認";
    overallEl.className = "verification-overall " + (allPassed ? "all-passed" : "needs-review");
  }
// ---------- 重新開始 ----------
document.getElementById("btn-restart").addEventListener("click", () => {
  document.getElementById("task-input").value = "";
  document.getElementById("context-input").value = "";
  Object.keys(state).forEach((k) => (state[k] = null));
  state.mode = "live";
  state.clarifications = [];
  state.pendingQuestions = [];
  showScreen("screen-1");
});

// ---------- 初始化 ----------
showScreen("screen-1");