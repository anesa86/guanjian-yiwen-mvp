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
const executeTask = window.AIService.executeTask;
const verifyResult = window.AIService.verifyResult;
const IMPACT_THRESHOLD = window.AIService.IMPACT_THRESHOLD;

// 保存這一輪流程的狀態，畫面之間互相傳遞用
const state = {
  taskInput: "",
  context: "",
  selectedCaseId: "caseC", // 預設案例 C，可透過畫面 1 的按鈕切換
  // mode 目前固定是 "live"，這一步（階段 7 第一小步）還沒有做 Live/Demo
  // 切換的開關，那是下一步的事。先把這個狀態欄位建起來，之後直接用。
  mode: "live",
  analysisResult: null,
  userAnswer: null,
  contract: null,
  executionResult: null,
};

// ---------- 案例選擇（Mock 階段專用）----------
// 依照 mock-data.js 裡的六個案例，動態產生按鈕，
// 按下去會直接把該案例的 taskInput/context 填進欄位，
// 並記住選了哪個案例，之後呼叫 analyzeTask 時會用到。
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

      // 標示目前選到哪個案例
      document.querySelectorAll(".case-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    container.appendChild(btn);
  });
})();

// ---------- 畫面切換 ----------
// 這裡故意「不只」靠 CSS 的 class 來隱藏畫面，
// 而是直接用 JS 設定每個畫面的 display，
// 這樣即使外部 style.css 在某些預覽環境沒被正確套用，
// 畫面切換還是一定會生效，不會四個畫面同時疊在一起。
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    const isTarget = el.id === id;
    el.classList.toggle("active", isTarget);
    el.style.display = isTarget ? "block" : "none";
  });
}

// ---------- 畫面 1：任務輸入 ----------
//
// 目前固定走 Live AI：成功後把計分後的結果交給既有 renderScreen2。
// 這一步不進入工作契約 / 執行 / 驗證。
// 失敗時顯示錯誤訊息跟「重新嘗試」按鈕。

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
  // 已確認資訊
  const confirmedList = document.getElementById("confirmed-list");
  confirmedList.innerHTML = "";
  analysisResult.confirmed.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.field}：${item.value}（來源：${item.source}）`;
    confirmedList.appendChild(li);
  });

  // 不確定事項（含分數，方便展示「有規則、不是憑感覺」）
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

  if (analysisResult.needsClarification) {
    heroPanel.classList.remove("hidden");
    skipPanel.classList.add("hidden");
    document.getElementById("critical-question-text").textContent =
      analysisResult.criticalIssue.question;
    document.getElementById("critical-question-reason").textContent =
      analysisResult.criticalIssue.reason;

    // Live 模式沒有模型給的選項，用既有自由文字框；這一步不送出、不進契約。
    // Demo/mock 若帶 answerOptions，仍動態產生按鈕（目前主流程是 Live）。
    const optionsContainer = document.getElementById("critical-question-options");
    const freeTextEl = document.getElementById("critical-question-freetext");
    optionsContainer.innerHTML = "";

    const options = analysisResult.criticalIssue.answerOptions || [];
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

// 不需要澄清，直接建立契約
document.getElementById("btn-skip-question").addEventListener("click", async () => {
  state.userAnswer = null;
  await goToContract();
});

async function goToContract() {
  const contract = await buildExecutionContract(state.analysisResult, state.userAnswer);
  state.contract = contract;
  renderScreen3(contract);
  showScreen("screen-3");
}

// ---------- 畫面 3：工作契約 ----------
function renderScreen3(contract) {
  const list = document.getElementById("contract-list");
  list.innerHTML = "";
  Object.entries(contract).forEach(([key, value]) => {
    if (key.startsWith("_")) return; // 略過內部欄位（如 _resolvedFrom）
    const li = document.createElement("li");
    if (Array.isArray(value)) {
      li.textContent = `${key}：${value.join("、")}`;
    } else {
      li.textContent = `${key}：${value}`;
    }
    list.appendChild(li);
  });
}

document.getElementById("btn-execute").addEventListener("click", async () => {
  const btn = document.getElementById("btn-execute");
  btn.disabled = true;
  btn.textContent = "執行中...";

  const resultText = await executeTask(state.contract);
  state.executionResult = resultText;

  const verification = await verifyResult(resultText, state.contract);

  btn.disabled = false;
  btn.textContent = "開始執行";

  renderScreen4(resultText, verification);
  showScreen("screen-4");
});

// ---------- 畫面 4：成果 + 驗證 ----------
function renderScreen4(resultText, verification) {
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
}

// ---------- 重新開始 ----------
document.getElementById("btn-restart").addEventListener("click", () => {
  document.getElementById("task-input").value = "";
  document.getElementById("context-input").value = "";
  document.querySelectorAll(".case-btn").forEach((b) => b.classList.remove("selected"));
  Object.keys(state).forEach((k) => (state[k] = null));
  state.selectedCaseId = "caseC";
  state.mode = "live";
  showScreen("screen-1");
});

// ---------- 初始化 ----------
// 頁面剛載入時，主動呼叫一次，確保只有畫面 1 顯示，
// 不要依賴 CSS 是否有正確套用「screen.active」這個 class。
showScreen("screen-1");
