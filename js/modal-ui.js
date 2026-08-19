// ============================================================
// 共用彈跳視窗：右上角 X 關閉，點外面也能關
// ============================================================
export function openModal(innerHtml, width = 560) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:${width}px;width:100%;max-height:90vh;overflow-y:auto;overflow-x:hidden;position:relative;box-sizing:border-box;" id="modal-box">
      <button id="modal-close-x" aria-label="關閉" style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:none;background:var(--paper);color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1;z-index:1;">✕</button>
      ${innerHtml}
    </div>
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#modal-close-x").addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
  return overlay;
}
