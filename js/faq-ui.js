// ============================================================
// 常見問題 / 操作說明
// 內容依照使用者角色自動篩選——例如「小幫手」看不到「作廢
// 訂單」的說明，因為那個角色本來就沒有這個權限，顯示了也用不到，
// 只會造成困擾。每一個章節、每一則問答都可以個別設定「哪些角色看得到」，
// 沒特別設定的話就沿用整個章節的權限範圍。
// ============================================================
import { currentSession } from "./auth.js?v=20260830-81";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-81";

const FAQ_SECTIONS = [
  {
    title: "訂單管理",
    roles: ["superadmin", "admin", "order_staff", "viewer"],
    items: [
      {
        q: "怎麼新增一張訂單？",
        a: "側邊欄「訂單管理」→ 右下角「+」按鈕。選客戶（或直接新增一個）、加商品、填運費、選取貨方式跟預計出貨/取貨日期，存檔即可。",
        roles: ["superadmin", "admin", "order_staff"],
      },
      {
        q: "訂單列表怎麼預設只有近3個月的？我要找更早的訂單怎麼辦？",
        a: "訂單量大了之後，一次抓全部歷史訂單會拖慢載入速度，所以列表預設只顯示近3個月。畫面上會有「顯示全部歷史訂單」按鈕，點一下就會展開抓全部；用搜尋欄位、日期篩選、或「待確認」「已逾期未出貨」這類篩選時，系統也會自動幫你展開抓全部，不用擔心漏掉舊資料。",
      },
      {
        q: "「待確認」標記是做什麼用的？",
        a: "有時候 key 單當下有些資訊還不確定（例如取貨時間），可以在訂單裡勾選「待確認」並附註要確認什麼。列表跟詳細頁都會有明顯的黃色提示，訂單列表也可以直接篩選出所有待確認的訂單，跟客戶確認完之後在詳細頁按「已跟客戶確認，取消標記」就能清掉。",
        roles: ["superadmin", "admin", "order_staff"],
      },
      {
        q: "怎麼登記出貨、登記收款？",
        a: "進訂單詳細頁，符合狀態的話會看到對應的按鈕（例如還沒出貨的訂單會有「標記已出貨」，還沒收清的訂單會有「登記收款」）。",
        roles: ["superadmin", "admin", "order_staff"],
      },
      {
        q: "怎麼作廢訂單？",
        a: "訂單詳細頁有「作廢」按鈕，需要輸入「確認」兩個字才會真的執行，避免手滑誤觸。作廢後不能復原，畫面上只會顯示「已作廢」，其他狀態徽章都不會再顯示。",
        roles: ["superadmin", "admin"],
      },
      {
        q: "客戶退貨怎麼處理？",
        a: "已出貨的訂單詳細頁有「登記退貨」按鈕，可以選要退哪些商品、退幾件，並選擇要不要加回庫存（商品完好可以繼續賣就勾選，壞掉不能賣就不要勾）。系統會自動算出退款金額、更新應收/應退狀態，不會直接改動原始訂單內容，保留完整歷史軌跡。",
        roles: ["superadmin", "admin", "order_staff"],
      },
      {
        q: "怎麼一次列印多張訂單的出貨單？",
        a: "訂單列表頁開啟「批次選取」模式，勾選要列印的訂單，點「批次列印出貨清單」。會自動依取貨日期排序、A4橫向列印，如果有「待確認」的訂單也會用淡黃色底色標示出來。",
        roles: ["superadmin", "admin", "order_staff"],
      },
    ],
  },
  {
    title: "商品與庫存",
    roles: ["superadmin", "admin", "order_staff", "viewer"],
    items: [
      {
        q: "自製商品、現貨商品、包材有什麼不同？",
        a: "自製商品：自己現做的東西，不追蹤庫存量（做多少賣多少），成本 = 配方裡每一項的成本加總。現貨商品：進貨轉賣的東西，有庫存追蹤，成本是進貨均價。包材：純粹用來組成自製商品的材料（紙盒、貼紙等），不能直接被訂購，只能被拿去當配方的一部分。",
      },
      {
        q: "自製商品的權限限制是什麼？",
        a: "自製商品的新增/編輯限定管理員以上（超級管理員、管理員），因為牽涉到定價、配方這種決策性的資訊。現貨商品跟包材的新增/編輯，小幫手也可以做，因為那是比較日常性的庫存操作。",
      },
      {
        q: "什麼是「配方」？禮盒裡面裝了好幾種東西要怎麼設定？",
        a: "配方是自製商品「用了什麼」的清單，除了包材（紙盒、貼紙），現在也能加入其他自製商品——例如禮盒配方可以寫「蛋黃酥 x6、鳳梨酥 x2」，系統會自動把成本、出貨扣庫存、備料清單都正確展開，不用重複輸入。",
        roles: ["superadmin", "admin"],
      },
      {
        q: "配方裡「散裝，不算它自己的包材」勾選框是做什麼的？",
        a: "如果一個自製商品（例如蛋黃酥）平常單獨賣的時候有自己的小包裝（例如貼紙），但裝進禮盒時是散裝、不需要那個小包裝，就可以在禮盒配方裡勾選這個，避免包材成本跟庫存被重複計算。",
        roles: ["superadmin", "admin"],
      },
    ],
  },
  {
    title: "備料清單",
    roles: ["superadmin", "admin", "order_staff", "viewer"],
    items: [
      {
        q: "備料清單在算什麼？",
        a: "把所有「還沒出貨」的訂單（包含已逾期未出貨的）彙總起來，算出每個商品總共要準備幾份。自製商品會自動展開配方，包材/原料需求會跟目前庫存比對，直接告訴你還缺多少要補。",
      },
      {
        q: "為什麼有些商品後面的庫存欄位顯示「—」？",
        a: "自製商品是做多少賣多少，沒有庫存概念，所以比對欄位顯示「—」是正常的，不是漏資料。只有現貨商品跟包材才有庫存追蹤。",
      },
      {
        q: "禮盒展開之後，商品需求表格會不會搞混？",
        a: "不會混在一起——禮盒本身那一列會標註「內含其他商品，已分開列出」，被拆解出來的單顆商品會標註「其中 X 個是從禮盒等組合商品拆解出來的」，兩者是分開列出、各自獨立的數字。",
      },
      {
        q: "怎麼只看特定時間範圍要準備的量？",
        a: "頁面上方可以選填「預計出貨/取貨日期」區間，例如只看這週要出的貨。不填的話就是統計全部還沒出貨的訂單。",
      },
    ],
  },
  {
    title: "客戶與廠商",
    roles: ["superadmin", "admin", "order_staff", "viewer"],
    items: [
      {
        q: "訂購管道為什麼不能自己打字？",
        a: "訂購管道（LINE/IG/FB/現場/其他）統一用下拉選單選擇，跟訂單頁面一致，避免同一個管道被打成不同寫法（例如「LINE」跟「line」），之後統計才對得起來。",
      },
      {
        q: "客戶詳細頁的「訂購紀錄」是怎麼算的？",
        a: "是用客戶的固定 ID 去比對訂單，不是用名字，所以不管客戶資料怎麼編輯，訂購紀錄都會正確關聯，不會跑掉。",
      },
    ],
  },
  {
    title: "統計報表／利潤總覽／支出管理",
    roles: ["superadmin", "admin", "viewer"],
    items: [
      {
        q: "毛利數字後面的「*」星號是什麼意思？",
        a: "代表這個成本不是完整成本——自製商品的毛利只算了配方裡的包材/其他自製商品成本，沒有扣原料/人工，那些是每月統一算在「利潤總覽」裡，不是每個商品單獨算。",
      },
      {
        q: "退貨會影響營收/毛利數字嗎？",
        a: "會，而且已經是正確扣除的：營收會扣掉退貨金額，如果退貨有加回庫存，當初認列的成本也會跟著沖銷一部分，毛利計算會更準確。",
      },
      {
        q: "為什麼商品改名之後，銷售排行看起來數字不太對？",
        a: "已經修正過這個問題——商品銷售排行、成本拆解都是用商品的固定 ID 分組，不是用名稱，改名之後舊訂單的統計數字也會自動顯示新名字，同一個商品的數字不會被拆成兩筆。",
      },
    ],
  },
  {
    title: "超級管理員專區",
    roles: ["superadmin"],
    items: [
      {
        q: "Cloudinary 是什麼？",
        a: "商品/收據照片上傳用的圖床服務設定，一般不需要更動，除非要更換帳號。",
      },
      {
        q: "什麼時候要用「重算訂單成本」？",
        a: "商品配方調整之後（例如禮盒補上配方），還沒出貨的舊訂單成本不會自動跟著變（訂單成立當下的成本本來就會鎖住）。這個功能可以一次把「還沒出貨」的訂單成本用商品目前的配方重新算一次。已出貨的訂單不會被這個功能碰到，因為那些訂單已經真的扣過庫存，回頭改成本風險較高。",
      },
      {
        q: "「資料備份」下載下來的檔案缺少什麼？",
        a: "會缺少暱稱資料（publicProfiles），因為 Firestore 規則設計上禁止列出全部暱稱資料（防止掃出所有成員信箱），其餘商業資料（訂單/商品/客戶/支出等）都完整包含。",
      },
      {
        q: "怎麼新增第二位超級管理員？",
        a: "用第二個 Google 帳號登入一次（會卡在審核中畫面），再用原本的超級管理員帳號到「待審核申請」核准、角色選「超級管理員」即可。",
      },
      {
        q: "成員被移除之後，權限什麼時候會失效？",
        a: "即時失效——如果那個人正在使用系統，系統會即時偵測到權限被拿掉，自動登出並跳出提示，不用等他自己重新整理頁面才發現。",
      },
    ],
  },
];

export async function renderFaqPage(container) {
  const role = currentSession.member?.role;
  const state = { keyword: "" };

  function render() {
    const visibleSections = FAQ_SECTIONS
      .filter((s) => s.roles.includes(role))
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => !it.roles || it.roles.includes(role)),
      }))
      .filter((s) => s.items.length > 0);

    const keyword = state.keyword.trim().toLowerCase();
    const filtered = keyword
      ? visibleSections.map((s) => ({ ...s, items: s.items.filter((it) => (it.q + it.a).toLowerCase().includes(keyword)) })).filter((s) => s.items.length > 0)
      : visibleSections;

    container.innerHTML = `
      ${pageNavHtml("常見問題")}
      <div class="field" style="margin-bottom:16px;">
        <input type="text" id="faq-search" placeholder="輸入關鍵字搜尋，例如「退貨」" value="${state.keyword}" />
      </div>
      ${filtered.length === 0 ? `<div class="card"><div class="hint" style="text-align:center;padding:16px 0;">找不到符合的內容</div></div>` : filtered.map((s) => `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:16px;margin-bottom:12px;">${s.title}</h3>
          ${s.items.map((it, idx) => `
            <div style="${idx > 0 ? "border-top:1px solid var(--paper-line);padding-top:12px;margin-top:12px;" : ""}">
              <div style="font-weight:600;color:var(--ink);margin-bottom:4px;">Q. ${it.q}</div>
              <div style="font-size:14.5px;color:var(--text-primary);line-height:1.7;">${it.a}</div>
            </div>
          `).join("")}
        </div>
      `).join("")}
    `;
    wirePageNav(container);
    const input = container.querySelector("#faq-search");
    input.addEventListener("input", (e) => { state.keyword = e.target.value; render(); });
    // 重新渲染後把游標放回輸入框，維持輸入體驗連貫
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  render();
}
