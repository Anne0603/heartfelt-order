// ============================================================
// 重算待處理訂單成本（超級管理員專用）
// 用在商品配方調整之後（尤其是巢狀配方功能上線後），讓還沒出貨的
// 舊訂單成本數字跟上最新配方，不用重打訂單。已出貨的訂單不會被
// 這個功能碰到——那些訂單出貨當下已經真的扣過庫存，回頭改成本
// 容易讓庫存帳對不起來，風險比較高，刻意排除。
// ============================================================
import { recalcPendingOrderCosts, listOrders, normalizeShipStatus } from "./orders.js?v=20260830-92";
import { listItems, buildItemsIndex } from "./items.js?v=20260830-92";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-92";
import { openModal } from "./modal-ui.js?v=20260830-92";
import { showToast, friendlyErrorMessage } from "./utils.js?v=20260830-92";

export async function renderRecalcCostPage(container) {
  container.innerHTML = `${pageNavHtml("重算待處理訂單成本")}<div class="card"><div class="hint">載入中…</div></div>`;
  wirePageNav(container);

  let pendingCount = 0;
  try {
    const orders = await listOrders();
    pendingCount = orders.filter((o) => !o.voided && normalizeShipStatus(o.shipStatus) !== "shipped").length;
  } catch (err) {
    container.innerHTML = `${pageNavHtml("重算待處理訂單成本")}<div class="card" style="color:var(--rose);">載入失敗：${friendlyErrorMessage(err)}</div>`;
    wirePageNav(container);
    return;
  }

  render();

  function render() {
    container.innerHTML = `
      ${pageNavHtml("重算待處理訂單成本")}
      <div class="card" style="margin-bottom:16px;">
        <p style="margin:0 0 12px;color:var(--text-primary);">
          商品配方調整之後（例如禮盒配方補上裡面裝的單顆商品），還沒出貨的
          舊訂單成本數字不會自動跟著變——這是刻意設計，訂單成立當下的成本
          本來就會鎖住。這個功能可以一次把「還沒出貨」的訂單成本，用商品
          目前的配方重新算一次。
        </p>
        <p class="hint" style="margin:0 0 12px;">
          <b>已出貨的訂單不會被這個功能碰到</b>——那些訂單出貨當下已經真的
          扣過庫存，回頭改成本容易讓庫存帳對不起來，風險比較高，刻意排除。
          客戶要付的金額（售價、總金額、收款狀態）完全不會受影響，這個
          功能只動成本／毛利相關的數字。
        </p>
        <div class="hint" style="margin-bottom:16px;">目前有 <b style="color:var(--ink);">${pendingCount}</b> 筆還沒出貨、沒作廢的訂單符合條件。</div>
        <button class="btn btn-primary" id="btn-open-recalc" ${pendingCount === 0 ? "disabled" : ""}>開始重算</button>
      </div>
      <div id="recalc-result"></div>
    `;
    wirePageNav(container);
    container.querySelector("#btn-open-recalc")?.addEventListener("click", openConfirmModal);
  }

  function openConfirmModal() {
    const overlay = openModal(`
      <h3 style="margin-bottom:4px;">確認重算成本</h3>
      <div class="hint" style="margin-bottom:14px;">即將重算 ${pendingCount} 筆還沒出貨的訂單，執行後無法復原（只能之後再重算一次覆蓋回去，不能還原成重算前的數字）。</div>
      <div class="field"><label>確定要執行的話，請輸入「確認」兩個字</label><input type="text" id="rc-confirm-text" placeholder="確認" /></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-secondary" id="rc-cancel">取消</button>
        <button class="btn btn-primary" id="rc-confirm">開始重算</button>
      </div>
    `, 420);
    overlay.querySelector("#rc-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#rc-confirm").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const text = overlay.querySelector("#rc-confirm-text").value.trim();
      if (text !== "確認") { showToast("請輸入「確認」兩個字才能執行", "error"); return; }
      btn.disabled = true;
      btn.textContent = "重算中…";
      try {
        const allItems = await listItems({ includeArchived: true });
        const itemsById = buildItemsIndex(allItems);
        const result = await recalcPendingOrderCosts(itemsById);
        overlay.remove();
        showToast(`重算完成，共更新 ${result.updated} 筆訂單`, "success");
        renderResult(result);
      } catch (err) {
        showToast("重算失敗：" + friendlyErrorMessage(err), "error");
        btn.disabled = false;
        btn.textContent = "開始重算";
      }
    });
  }

  function renderResult(result) {
    const resultEl = container.querySelector("#recalc-result");
    if (!resultEl) return;
    resultEl.innerHTML = `
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:10px;">重算結果</h3>
        <div style="margin-bottom:4px;">符合條件：${result.total} 筆</div>
        <div style="margin-bottom:4px;color:var(--jade);">已更新：${result.updated} 筆</div>
        ${result.skipped.length > 0 ? `
          <div style="margin-top:12px;">
            <div style="font-weight:600;color:var(--rose);margin-bottom:6px;">${result.skipped.length} 筆有商品找不到（該項目成本保留原值）：</div>
            ${result.skipped.map((s) => `<div class="hint">${s.orderNumber} — ${s.reason}</div>`).join("")}
          </div>
        ` : ""}
        ${result.warnings.length > 0 ? `
          <div style="margin-top:12px;">
            <div style="font-weight:600;color:var(--rose);margin-bottom:6px;">${result.warnings.length} 筆偵測到配方循環引用：</div>
            ${result.warnings.map((w) => `<div class="hint">${w.orderNumber} — ${w.reason}</div>`).join("")}
          </div>
        ` : ""}
        ${result.skipped.length === 0 && result.warnings.length === 0 ? `<div class="hint" style="margin-top:8px;">全部順利完成，沒有任何警告。</div>` : ""}
      </div>
    `;
  }
}
