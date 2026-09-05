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

// 保存這一輪流程的狀態，畫面之間互相傳遞用
const state = {
  taskInput: "",
  context: "",
  selectedCaseId: "caseC",
  mode: "live",
  analysisResult: null,
  userAnswer: null,
  pendingQuestions: [],
  clarifications: [],
  contract: null,
  executionResult: null,
};

// ---------- 案例選擇（Mock 階段專用）----------
(function renderCaseSelector() {
  const container = document.getElementById("case-selector");
  const cases = window.MockData.cases;
  Object.keys(cases).forEach((caseId) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "case-btn";
    btn.textContent = cases[caseId].label;
    btn.addEventListener("click", () => {
      const mockCase = cases[caseId];
      document.getElementById("task-input").value = mockCase.taskInput;
      document.getElementById("context-input").value = mockCase.context;
      state.selectedCaseId = caseId;

      document.querySelectorAll(".case-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
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

  const uncertaintyList = document.getElementById("uncertainty-list");
  uncertaintyList.innerHTML = "";
  analysisResult.uncertainties.forEach((u) => {
    const li = document.createElement("li");
    li.className = "uncertainty-item";
    const isHigh = u.impactScore >= IMPACT_THRESHOLD;
    li.innerHTML = `${u.description}
      <span class="impact-tag ${isHigh ? "impact-high" : "impact-low"}">
        影響分數 ${u.impactScore}
      </span>`;
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
  overallEl.textContent = allPassed ? "驗證通過 ✓" : "結果需要人工確認";
  overallEl.className = "verification-overall " + (allPassed ? "all-passed" : "needs-review");
}

// ---------- 重新開始 ----------
document.getElementById("btn-restart").addEventListener("click", () => {
  document.getElementById("task-input").value = "";
  document.getElementById("context-input").value = "";
  document.querySelectorAll(".case-btn").forEach((b) => b.classList.remove("selected"));
  Object.keys(state).forEach((k) => (state[k] = null));
  state.selectedCaseId = "caseC";
  state.mode = "live";
  state.clarifications = [];
  state.pendingQuestions = [];
  showScreen("screen-1");
});

// ---------- 初始化 ----------
showScreen("screen-1");