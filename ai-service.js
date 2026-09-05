// ai-service.js
//
// 這個檔案是整個產品「唯一」跟 AI 邏輯溝通的入口。
// app.js（UI 邏輯）只會呼叫這裡的函式，完全不知道背後是 mock 還是真的 API。
//
// API key 絕對不能寫在這支前端檔案，也不能出現在瀏覽器 devtools 看得到的地方。
//
// 整個檔案包在 IIFE 裡，避免函式名稱洩漏到全域跟 app.js 撞名。
// 對外只透過 window.AIService 曝露這些函式。
(function () {

  const allCases = window.MockData.cases;
  
  // ------------------------------------------------------------
  // 影響分數規則（deterministic，不是模型決定的）
  // ------------------------------------------------------------
  const ASPECT_WEIGHTS = {
    goal: 5,
    external: 5,
    strategy: 4,
    budget: 4,
    audience: 3,
    deadline: 3,
    format: 1,
  };
  
  const IMPACT_THRESHOLD = 6;
  
  function calculateImpactScore(affectedAspects) {
    const aspects = affectedAspects || [];
    return aspects.reduce(function (total, aspect) {
      return total + (ASPECT_WEIGHTS[aspect] || 0);
    }, 0);
  }
  
  // 把模型（或 mock）給的 uncertainties 補上 impactScore，並選出關鍵一問。
  function scoreAndSelectCriticalIssue(confirmed, uncertainties) {
    const list = uncertainties || [];
    const uncertaintiesWithScore = list.map(function (u) {
      return Object.assign({}, u, {
        impactScore: calculateImpactScore(u.affectedAspects),
      });
    });
  
    const sorted = uncertaintiesWithScore.slice().sort(function (a, b) {
      return b.impactScore - a.impactScore;
    });
    const topIssue = sorted[0];
    const needsClarification = !!topIssue && topIssue.impactScore >= IMPACT_THRESHOLD;
  
    return {
      confirmed: confirmed || [],
      uncertainties: uncertaintiesWithScore,
      needsClarification: needsClarification,
      criticalIssue: needsClarification ? topIssue : null,
    };
  }
  
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  
  // ------------------------------------------------------------
  // analyzeTaskMock：Demo 模式用，依 caseId 查表
  // ------------------------------------------------------------
  async function analyzeTaskMock(taskInput, context, caseId) {
    await delay(600);
    const mockCase = allCases[caseId] || allCases.caseC;
    const scored = scoreAndSelectCriticalIssue(mockCase.confirmed, mockCase.uncertainties);
    return Object.assign({ caseId: caseId }, scored);
  }
  
  // ------------------------------------------------------------
  // analyzeTaskLive：真的呼叫 API 分析任意輸入
  // ------------------------------------------------------------
  async function analyzeTaskLive(taskInput, context) {
    let response;
    try {
      response = await fetch("http://localhost:3000/api/analyze-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskInput: taskInput, context: context }),
      });
    } catch (networkErr) {
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
  
    return scoreAndSelectCriticalIssue(body.data.confirmed, body.data.uncertainties);
  }
  
  // ------------------------------------------------------------
  // executeTaskLive：依工作契約產生成果
  // ------------------------------------------------------------
  async function executeTaskLive(contract) {
    let response;
    try {
      response = await fetch("http://localhost:3000/api/execute-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract: contract }),
      });
    } catch (networkErr) {
      throw new Error("AI 執行暫時無法連線，請重試");
    }
  
    let body;
    try {
      body = await response.json();
    } catch (parseErr) {
      throw new Error("AI 執行暫時無法連線，請重試");
    }
  
    if (!response.ok || !body.success) {
      throw new Error(body.error || "AI 執行暫時無法連線，請重試");
    }
  
    return body.result;
  }
  
  // ------------------------------------------------------------
  // verifyResultLive：逐項比對契約與成果
  // ------------------------------------------------------------
  async function verifyResultLive(result, contract) {
    let response;
    try {
      response = await fetch("http://localhost:3000/api/verify-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract: contract, result: result }),
      });
    } catch (networkErr) {
      throw new Error("AI 驗證暫時無法連線，請重試");
    }
  
    let body;
    try {
      body = await response.json();
    } catch (parseErr) {
      throw new Error("AI 驗證暫時無法連線，請重試");
    }
  
    if (!response.ok || !body.success) {
      throw new Error(body.error || "AI 驗證暫時無法連線，請重試");
    }
  
    return body.data;
  }
  
  // ------------------------------------------------------------
  // buildExecutionContract：Mock 模式專用
  // ------------------------------------------------------------
  async function buildExecutionContract(analysisResult, userAnswerId) {
    await delay(400);
  
    const mockCase = allCases[analysisResult.caseId] || allCases.caseC;
    const outcomeKey = analysisResult.needsClarification ? userAnswerId : "direct";
    const outcome = mockCase.outcomes[outcomeKey] || mockCase.outcomes.direct;
  
    let selectedOption = null;
    if (analysisResult.criticalIssue && analysisResult.criticalIssue.answerOptions) {
      selectedOption = analysisResult.criticalIssue.answerOptions.find(function (opt) {
        return opt.id === userAnswerId;
      });
    }
  
    return Object.assign({}, outcome.contract, {
      _caseId: analysisResult.caseId,
      _outcomeKey: outcomeKey,
      _resolvedFrom: {
        question: analysisResult.criticalIssue ? analysisResult.criticalIssue.question : null,
        userAnswer: selectedOption ? selectedOption.label : null,
      },
    });
  }
  
  // ------------------------------------------------------------
  // buildExecutionContractLive：Live 模式專用，純程式整理，不呼叫模型
  // 這次修正：多帶上 context 原文，讓 execute 時真的有素材可以處理
  // ------------------------------------------------------------
  async function buildExecutionContractLive(taskInput, context, confirmed, clarifications) {
    const confirmedList = confirmed || [];
    const clarificationList = clarifications || [];
  
    return {
      _mode: "live",
      taskInput: taskInput,
      context: context || "",
      confirmedItems: confirmedList.map(function (c) {
        return { field: c.field, value: c.value, source: c.source };
      }),
      clarifications: clarificationList.map(function (c) {
        return {
          field: c.field,
          question: c.question,
          answer: c.answer,
          source: "使用者確認",
        };
      }),
    };
  }
  
  // ------------------------------------------------------------
  // executeTask：Mock 模式專用
  // ------------------------------------------------------------
  async function executeTask(contract) {
    await delay(800);
    const mockCase = allCases[contract._caseId] || allCases.caseC;
    const outcome = mockCase.outcomes[contract._outcomeKey] || mockCase.outcomes.direct;
    return outcome.executionResult;
  }
  
  // ------------------------------------------------------------
  // verifyResult：Mock 模式專用
  // ------------------------------------------------------------
  async function verifyResult(result, contract) {
    await delay(500);
    const mockCase = allCases[contract._caseId] || allCases.caseC;
    const outcome = mockCase.outcomes[contract._outcomeKey] || mockCase.outcomes.direct;
    const checklist = outcome.verificationChecklist;
    const passedCount = checklist.filter(function (item) {
      return item.passed;
    }).length;
    return {
      checklist: checklist,
      passedCount: passedCount,
      totalCount: checklist.length,
    };
  }
  
  window.AIService = {
    analyzeTaskMock: analyzeTaskMock,
    analyzeTaskLive: analyzeTaskLive,
    buildExecutionContract: buildExecutionContract,
    buildExecutionContractLive: buildExecutionContractLive,
    executeTask: executeTask,
    executeTaskLive: executeTaskLive,
    verifyResult: verifyResult,
    verifyResultLive: verifyResultLive,
    IMPACT_THRESHOLD: IMPACT_THRESHOLD,
  };
  
  })();