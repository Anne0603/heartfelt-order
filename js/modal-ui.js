// ============================================================
// 共用彈跳視窗：右上角 X 關閉（不會因為誤觸外部而清空表單內容）
// ============================================================

// ---------- 背景頁面捲動鎖定 ----------
// 彈窗開著的時候，把背後那頁的捲動鎖住——不然在彈窗裡面滑動（例如
// 搜尋清單）時，手指劃過的地方如果不小心壓到背景，背景會跟著一起
// 滑動，感覺很不像原生 App。
//
// 用「數一數目前開著幾層彈窗」的方式處理，因為有些情境是彈窗疊彈窗
// （例如表單彈窗上面又跳出一個確認對話框），要等最外層也關掉、
// 完全沒有任何彈窗開著了，才真的解鎖背景捲動，不然裡面那層一關，
// 背景就會提早解鎖，外層彈窗還開著卻可以滑動背景，一樣不對。
//
// 用 MutationObserver 自動偵測彈窗何時從畫面上被移除（不管是哪個
// 按鈕觸發的 remove()），呼叫端完全不用自己記得要解鎖，避免像之前
// 輸入框字級問題一樣，因為到處都有呼叫點，一個一個改容易漏掉。
let scrollLockCount = 0;
let savedScrollY = 0;

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
  }
  scrollLockCount++;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }
}

/**
 * 掛上這個彈窗：鎖住背景捲動，並自動盯著這個彈窗元素，
 * 一旦它從畫面上消失（不管誰呼叫 .remove()），就自動解鎖。
 * 所有會跳出全螢幕遮罩彈窗的地方都要呼叫這個，取代自己手動
 * append 到 document.body。
 */
export function mountOverlay(overlay) {
  lockBodyScroll();
  document.body.appendChild(overlay);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      unlockBodyScroll();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

/**
 * 圖片放大預覽（點縮圖看清楚用），點外面或 X 都能關閉。
 */
export function openImageLightbox(url) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.85);z-index:400;display:flex;align-items:center;justify-content:center;padding:24px;";
  overlay.innerHTML = `
    <button id="lb-close" aria-label="關閉" style="position:absolute;top:16px;right:16px;width:38px;height:38px;border-radius:50%;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:18px;cursor:pointer;line-height:1;">✕</button>
    <img src="${url}" style="max-width:100%;max-height:100%;border-radius:8px;object-fit:contain;" />
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#lb-close").addEventListener("click", () => overlay.remove());
  mountOverlay(overlay);
}

export function openModal(innerHtml, width = 560) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:${width}px;width:100%;max-height:90vh;overflow-y:auto;overflow-x:hidden;position:relative;box-sizing:border-box;" id="modal-box">
      <button id="modal-close-x" aria-label="關閉" style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:none;background:var(--paper);color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1;z-index:1;">✕</button>
      ${innerHtml}
    </div>
  `;
  overlay.querySelector("#modal-close-x").addEventListener("click", () => overlay.remove());
  mountOverlay(overlay);
  return overlay;
}

/**
 * 共用確認對話框，取代原生 confirm()。回傳 Promise<boolean>。
 */
export function confirmDialog(message, { confirmLabel = "確定", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
      <div class="card" style="max-width:340px;width:100%;">
        <div style="font-size:15px;color:var(--ink);margin-bottom:18px;line-height:1.6;">${message}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="cf-cancel">取消</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="cf-ok">${confirmLabel}</button>
        </div>
      </div>
    `;
    mountOverlay(overlay);
    overlay.querySelector("#cf-cancel").addEventListener("click", () => { overlay.remove(); resolve(false); });
    overlay.querySelector("#cf-ok").addEventListener("click", () => { overlay.remove(); resolve(true); });
  });
}

/**
 * 簡單的訊息提示彈窗，取代原生 alert()。
 */
export function alertDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
      <div class="card" style="max-width:340px;width:100%;">
        <div style="font-size:15px;color:var(--ink);margin-bottom:18px;line-height:1.6;">${message}</div>
        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" id="al-ok">知道了</button>
        </div>
      </div>
    `;
    mountOverlay(overlay);
    overlay.querySelector("#al-ok").addEventListener("click", () => { overlay.remove(); resolve(); });
  });
}

/**
 * 簡單的單行文字輸入彈窗（例如選單裡選「其他」時用來輸入自訂文字）。
 * 原本只在訂單頁面用，現在客戶資料頁的訂購管道也要用同一套，
 * 移到這裡變成共用元件，避免兩邊各自維護一份重複的程式碼。
 */
export function openCustomTextModal(title, initialValue, onConfirm) {
  const overlay = openModal(`
    <h3 style="margin-bottom:16px;">${title}</h3>
    <div class="field"><input type="text" id="ct-input" value="${initialValue}" /></div>
    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary" id="ct-confirm">確定</button>
    </div>
  `, 360);
  overlay.querySelector("#ct-confirm").addEventListener("click", () => {
    const val = overlay.querySelector("#ct-input").value.trim();
    overlay.remove();
    onConfirm(val);
  });
}
