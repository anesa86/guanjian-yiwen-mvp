// mock-data.js
//
// 這個檔案「不是」AI，它只是把每個測試案例「應該長什麼樣的資料」寫死下來。
// ai-service.js 在 mock 階段會直接回傳這裡的資料，
// 未來接上真的 API 之後，這個檔案只會拿來做「6 個測試案例的評估資料集」，
// 不會再出現在正式的判斷邏輯裡。
//
// 這一版把六個案例統一成同一種資料格式，讓 ai-service.js 可以用同一套邏輯
// 處理任何一個案例，不用每個案例各寫一套 if/else：
//
// case = {
//   taskInput, context,
//   confirmed: [{ field, value, source }],
//   uncertainties: [{ id, description, affectedAspects, question, reason, answerOptions? }],
//   outcomes: {
//     // 如果所有 uncertainties 都低於門檻（不需要澄清），用 "direct" 這組：
//     direct: { contract, executionResult, verificationChecklist },
//     // 如果有需要澄清的問題，依 answerOptions 的每個 id 各存一組：
//     [optionId]: { contract, executionResult, verificationChecklist },
//   }
// }
//
// 注意：這裡故意不用 import/export（ES module），
// 因為 module 語法在瀏覽器用 file:// 直接打開時會被擋掉。
// 改用最單純的寫法：把資料掛在一個全域變數 MockData 上，
// index.html 用一般 <script> 依序載入即可，不需要任何伺服器。
//
// 整個檔案包在 IIFE（自我執行函式）裡，是為了避免這裡面的變數名稱
// 洩漏到全域、跟其他檔案（如 ai-service.js、app.js）的變數撞名。
// 對外只透過 window.MockData 曝露資料。
(function () {

const cases = {

  // ---------------------------------------------------------
  // 案例 A：不該問（背景完整，應直接執行）
  // ---------------------------------------------------------
  caseA: {
    label: "案例 A：不該問",
    taskInput: "把以下 2000 字文章整理成 300 字繁體中文摘要。",
    context: "（文章全文已完整提供，背景資訊完整）",
    confirmed: [
      { field: "任務類型", value: "文章摘要", source: "任務描述" },
      { field: "字數要求", value: "約 300 字", source: "任務描述" },
      { field: "語言", value: "繁體中文", source: "任務描述" },
    ],
    uncertainties: [], // 沒有任何不確定事項，應直接執行
    outcomes: {
      direct: {
        contract: {
          任務類型: "文章摘要",
          字數要求: "約 300 字",
          語言: "繁體中文",
        },
        executionResult:
          "【文章摘要】\n\n" +
          "（此為 mock 產出內容）本文摘要約 300 字，保留原文章的核心論點與結論，" +
          "省略細節舉例與重複敘述，以繁體中文呈現。",
        verificationChecklist: [
          { label: "摘要字數約為 300 字", passed: true },
          { label: "使用繁體中文", passed: true },
          { label: "保留原文章核心論點", passed: true },
        ],
      },
    },
  },

  // ---------------------------------------------------------
  // 案例 B：不該問（owner 資訊已完整）
  // ---------------------------------------------------------
  caseB: {
    label: "案例 B：不該問",
    taskInput: "把這份會議紀錄整理成三項 Action Item，每項附 owner。",
    context: "會議紀錄中三項 Action Item 的 owner 皆已明確列出。",
    confirmed: [
      { field: "輸出格式", value: "三項 Action Item", source: "任務描述" },
      { field: "必要欄位", value: "每項附 owner", source: "任務描述" },
      { field: "owner 資訊", value: "會議紀錄中已完整列出", source: "會議紀錄" },
    ],
    uncertainties: [],
    outcomes: {
      direct: {
        contract: {
          輸出格式: "三項 Action Item",
          必要欄位: "owner",
        },
        executionResult:
          "【Action Item 整理】\n\n" +
          "1. 完成新版簡報草稿（Owner：小美）\n" +
          "2. 確認下週會議室與時間（Owner：小華）\n" +
          "3. 彙整客戶回饋並回報（Owner：小明）\n\n" +
          "（此為 mock 產出內容，owner 依會議紀錄內容取得）",
        verificationChecklist: [
          { label: "共列出 3 項 Action Item", passed: true },
          { label: "每項皆附 owner", passed: true },
          { label: "內容取自會議紀錄", passed: true },
        ],
      },
    },
  },

  // ---------------------------------------------------------
  // 案例 C：應該問（influencer 政策衝突）
  // ---------------------------------------------------------
  caseC: {
    label: "案例 C：應該問",
    taskInput: "幫我做好新品提案，等等寄給代理商。",
    context:
      "1. 會議紀錄：本季主要目標是舊客回購，不考慮 KOL。\n" +
      "2. 舊版 brief：預算最高 30 萬，TA 為 18–24 歲。\n" +
      "3. 最新團隊訊息：主管今天提到 micro influencer 似乎可以測試看看。",
    confirmed: [
      { field: "目標", value: "舊客回購", source: "會議紀錄" },
      { field: "預算上限", value: "NT$300,000", source: "舊版 brief" },
      { field: "TA", value: "18–24 歲", source: "舊版 brief" },
      { field: "對外用途", value: "代理商提案", source: "任務描述" },
    ],
    uncertainties: [
      {
        id: "u1",
        description: "是否可使用 influencer 存在衝突",
        conflictingValues: [
          "不考慮 KOL（來源：會議紀錄）",
          "micro influencer 可以測試（來源：最新團隊訊息）",
        ],
        affectedAspects: ["strategy", "budget"],
        question: "最新主管訊息是否代表本次已允許使用 micro influencer？",
        reason: "因為這會直接改變渠道策略、預算配置與內容方向。",
        answerOptions: [
          { id: "yes", label: "是，本次允許使用 micro influencer" },
          { id: "no", label: "否，維持不使用 influencer" },
        ],
      },
      {
        id: "u2",
        description: "提案格式未指定",
        affectedAspects: ["format"],
        question: "提案要用 PPT 還是一般文件格式？",
        reason: "僅影響呈現形式，不改變策略方向。",
      },
    ],
    outcomes: {
      yes: {
        contract: {
          目標: "舊客回購",
          TA: "18–24 歲",
          預算: "<= NT$300,000",
          Influencer政策: "允許 micro influencer（測試性質）",
          對外對象: "Agency（代理商）",
          Deadline: "今晚",
          已確認限制: [
            "不可超預算",
            "主要目標不能偏離舊客回購",
            "僅可使用已確認的 influencer 政策（允許 micro influencer）",
          ],
        },
        executionResult:
          "【新品提案 Draft】\n\n" +
          "目標：促進舊客回購\n" +
          "TA：18–24 歲舊客群\n" +
          "渠道策略：以舊客名單再行銷為主，搭配 1–2 位 micro influencer 進行小規模測試曝光\n" +
          "預算配置：總預算 NT$300,000 內，其中 micro influencer 測試預算控制在 15% 以內\n" +
          "內容方向：以「回購優惠 + 真實使用心得」為主軸，避免大型 KOL 造勢型內容\n\n" +
          "（此為 mock 產出內容，之後將由真實模型依工作契約生成）",
        verificationChecklist: [
          { label: "主要目標為舊客回購", passed: true },
          { label: "預算未超過 NT$300,000", passed: true },
          { label: "僅使用已確認的 micro influencer 政策", passed: true },
          { label: "TA 維持 18–24 歲", passed: true },
          { label: "未加入未授權策略（如大型 KOL）", passed: true },
        ],
      },
      no: {
        contract: {
          目標: "舊客回購",
          TA: "18–24 歲",
          預算: "<= NT$300,000",
          Influencer政策: "維持不使用 influencer（含 micro influencer）",
          對外對象: "Agency（代理商）",
          Deadline: "今晚",
          已確認限制: [
            "不可超預算",
            "主要目標不能偏離舊客回購",
            "不可使用任何 influencer（含 micro influencer）",
          ],
        },
        executionResult:
          "【新品提案 Draft】\n\n" +
          "目標：促進舊客回購\n" +
          "TA：18–24 歲舊客群\n" +
          "渠道策略：完全聚焦舊客名單再行銷，透過 EDM／簡訊／APP 推播進行回購優惠溝通，不使用任何 influencer 曝光\n" +
          "預算配置：總預算 NT$300,000 內，全數投入舊客渠道與回購優惠設計\n" +
          "內容方向：以「專屬舊客回饋方案」為主軸，強調熟客尊榮感\n\n" +
          "（此為 mock 產出內容，之後將由真實模型依工作契約生成）",
        verificationChecklist: [
          { label: "主要目標為舊客回購", passed: true },
          { label: "預算未超過 NT$300,000", passed: true },
          { label: "未使用任何 influencer（含 micro influencer）", passed: true },
          { label: "TA 維持 18–24 歲", passed: true },
          { label: "未加入未授權策略（如大型 KOL）", passed: true },
        ],
      },
    },
  },

  // ---------------------------------------------------------
  // 案例 D：應該問（退款金額與授權未知）
  // ---------------------------------------------------------
  caseD: {
    label: "案例 D：應該問",
    taskInput: "幫我回覆客戶並答應退款。",
    context: "背景資訊中沒有退款金額，也沒有退款授權範圍。",
    confirmed: [{ field: "客戶要求", value: "退款", source: "任務描述" }],
    uncertainties: [
      {
        id: "d1",
        description: "退款金額與授權範圍未知",
        affectedAspects: ["external", "budget"],
        question: "這筆退款屬於哪種情況？",
        reason: "退款屬於對外且不可逆的承諾，金額與授權範圍會直接影響能否同意。",
        answerOptions: [
          { id: "small", label: "小額退款（NT$1,000 以內），可直接同意" },
          { id: "large", label: "金額較大或無法確認上限，需先取得主管核准" },
        ],
      },
    ],
    outcomes: {
      small: {
        contract: {
          客戶要求: "退款",
          退款範圍: "NT$1,000 以內",
          對外承諾: "已同意退款",
        },
        executionResult:
          "【客戶回覆草稿】\n\n" +
          "您好，已確認您的退款申請在可直接處理的範圍內，我們將盡快為您辦理退款，" +
          "款項將於 3–5 個工作天內退回原付款方式。\n\n（此為 mock 產出內容）",
        verificationChecklist: [
          { label: "退款金額在可直接決定的授權範圍內", passed: true },
          { label: "未逾越個人可決定的退款上限", passed: true },
          { label: "已明確告知客戶處理結果", passed: true },
        ],
      },
      large: {
        contract: {
          客戶要求: "退款",
          退款範圍: "金額較大，需主管核准",
          對外承諾: "尚未答應退款，先回覆處理中",
        },
        executionResult:
          "【客戶回覆草稿】\n\n" +
          "您好，收到您的退款申請了，因金額需要進一步確認，我們會盡快處理並在 1–2 個工作天內回覆您結果，" +
          "造成不便還請見諒。\n\n（此為 mock 產出內容，尚未對外承諾退款）",
        verificationChecklist: [
          { label: "未在無授權下直接承諾退款", passed: true },
          { label: "已即時回應讓客戶知道處理進度", passed: true },
          { label: "保留後續與主管確認的空間", passed: true },
        ],
      },
    },
  },

  // ---------------------------------------------------------
  // 案例 E：應該問（campaign 目標前後衝突）
  // ---------------------------------------------------------
  caseE: {
    label: "案例 E：應該問",
    taskInput: "幫我排下週 campaign。",
    context:
      "舊文件：本次 campaign 目標是提升轉換率。\n最新訊息：主管提到這次改成衝品牌知名度。",
    confirmed: [{ field: "執行時間", value: "下週", source: "任務描述" }],
    uncertainties: [
      {
        id: "e1",
        description: "campaign 主要目標前後衝突",
        conflictingValues: [
          "轉換率（來源：舊文件）",
          "品牌知名度（來源：最新訊息）",
        ],
        affectedAspects: ["goal", "strategy"],
        question: "這次 campaign 的主要目標，是要維持轉換率，還是改成品牌知名度？",
        reason: "目標不同會直接改變素材方向、版位配置與成效衡量方式。",
        answerOptions: [
          { id: "conversion", label: "維持以轉換率為主要目標" },
          { id: "awareness", label: "改成以品牌知名度為主要目標" },
        ],
      },
    ],
    outcomes: {
      conversion: {
        contract: {
          主要目標: "轉換率",
          素材方向: "導購型素材，強調限時優惠與行動呼籲",
          成效指標: "轉換率、ROAS",
        },
        executionResult:
          "【Campaign 排程草案】\n\n" +
          "主要目標：轉換率\n" +
          "素材方向：導購型素材，強調限時優惠與明確的行動呼籲（CTA）\n" +
          "版位建議：以搜尋與再行銷版位為主\n\n（此為 mock 產出內容）",
        verificationChecklist: [
          { label: "主要目標為轉換率", passed: true },
          { label: "素材方向聚焦導購", passed: true },
          { label: "排程符合下週時間", passed: true },
        ],
      },
      awareness: {
        contract: {
          主要目標: "品牌知名度",
          素材方向: "品牌故事型素材，強調觸及與曝光",
          成效指標: "觸及人數、曝光次數",
        },
        executionResult:
          "【Campaign 排程草案】\n\n" +
          "主要目標：品牌知名度\n" +
          "素材方向：品牌故事型素材，強調情感連結與品牌識別\n" +
          "版位建議：以社群動態與影音版位為主，擴大觸及\n\n（此為 mock 產出內容）",
        verificationChecklist: [
          { label: "主要目標為品牌知名度", passed: true },
          { label: "素材方向聚焦品牌曝光", passed: true },
          { label: "排程符合下週時間", passed: true },
        ],
      },
    },
  },

  // ---------------------------------------------------------
  // 案例 F：低價值缺漏不該問（只是不知道字體）
  // ---------------------------------------------------------
  caseF: {
    label: "案例 F：不該問",
    taskInput: "幫我做一份月報。",
    context: "策略、受眾、目標、預算皆清楚，只是沒說報告要用哪個字體。",
    confirmed: [
      { field: "策略", value: "已提供", source: "背景資訊" },
      { field: "受眾", value: "已提供", source: "背景資訊" },
      { field: "目標", value: "已提供", source: "背景資訊" },
      { field: "預算", value: "已提供", source: "背景資訊" },
    ],
    uncertainties: [
      {
        id: "f1",
        description: "報告字體未指定",
        affectedAspects: ["format"],
        question: "報告要用哪個字體？",
        reason: "僅影響呈現形式，不改變內容或策略。",
      },
    ],
    outcomes: {
      direct: {
        contract: {
          策略: "依背景資訊",
          受眾: "依背景資訊",
          目標: "依背景資訊",
          預算: "依背景資訊",
        },
        executionResult:
          "【月報草案】\n\n" +
          "（此為 mock 產出內容）已依既有策略、受眾、目標與預算資訊完成月報草案，" +
          "字體採用預設樣式，如需調整可事後再更換。",
        verificationChecklist: [
          { label: "涵蓋已提供的策略／受眾／目標／預算", passed: true },
          { label: "未因格式問題卡住產出", passed: true },
        ],
      },
    },
  },
};

// 掛到全域變數上，讓其他 <script> 可以直接用 MockData.cases.caseC 存取
window.MockData = { cases };

})(); // IIFE 結束
