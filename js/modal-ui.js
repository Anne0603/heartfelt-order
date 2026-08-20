// ============================================================
// 共用彈跳視窗：右上角 X 關閉（不會因為誤觸外部而清空表單內容）
// ============================================================
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
  document.body.appendChild(overlay);
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
  document.body.appendChild(overlay);
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
    document.body.appendChild(overlay);
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
    document.body.appendChild(overlay);
    overlay.querySelector("#al-ok").addEventListener("click", () => { overlay.remove(); resolve(); });
  });
}
