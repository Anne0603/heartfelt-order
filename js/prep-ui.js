// ============================================================
// 備料清單
// 把「還沒出貨」的訂單彙總起來，算出：
//   1. 每個商品總共要準備幾份
//   2. 自製商品配方展開後，包材/原料總共要用多少，
//      跟現有庫存比對，直接告訴你還缺多少要補
// 用意是幫忙回答「我要準備多少原料」這個問題，不用自己一張一張訂單
// 累加計算。
// ============================================================
import { listOrders, normalizeShipStatus } from "./orders.js?v=20260830-83";
import { listItems, buildItemsIndex, computeStock, STOCK_TRACKED_TYPES, expandRecipe } from "./items.js?v=20260830-83";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-83";
import { showToast, friendlyErrorMessage } from "./utils.js?v=20260830-83";

export async function renderPrepListPage(container) {
  let orders = [];
  let itemsById = new Map();
  let filterStart = "";
  let filterEnd = "";

  async function loadData() {
    const [allOrders, allItems] = await Promise.all([
      listOrders(),
      listItems({ includeArchived: true }),
    ]);
    orders = allOrders;
    itemsById = buildItemsIndex(allItems);
  }

  function computeSummary() {
    // 只算「還沒出貨、沒作廢」的訂單——已經出貨的東西不用再準備了。
    // 如果有設定日期區間，只算「預計出貨/取貨日期」落在區間內的訂單，
    // 沒設定的話就是全部還沒出貨的訂單一起算。
    const relevant = orders.filter((o) => {
      if (o.voided) return false;
      if (normalizeShipStatus(o.shipStatus) === "shipped") return false;
      if (filterStart && (!o.expectedDate || o.expectedDate < filterStart)) return false;
      if (filterEnd && (!o.expectedDate || o.expectedDate > filterEnd)) return false;
      return true;
    });

    const productNeeds = new Map(); // productId -> { name, unit, qty, type, pendingQty, bundledQty, hasContents }
    const materialNeeds = new Map(); // itemId -> { name, unit, qty, pendingQty }

    relevant.forEach((o) => {
      // 這張訂單如果還「待確認」，代表資訊可能還會變動——需求量裡要
      // 額外標出「這裡面有多少其實還不確定」，避免使用者照著數字備料，
      // 結果客戶後來改單，白白準備錯份量。
      const isPending = !!o.needsConfirmation;

      o.lineItems.forEach((li) => {
        const item = itemsById.get(li.productId);
        const name = item ? item.name : li.productName;
        const unit = item?.unit || "個";
        const pKey = li.productId || li.productName;
        const pCur = productNeeds.get(pKey) || { name, unit, qty: 0, pendingQty: 0, bundledQty: 0, hasContents: false, productId: li.productId, type: item?.type };
        pCur.name = name;
        pCur.qty += li.qty;
        if (isPending) pCur.pendingQty += li.qty;
        productNeeds.set(pKey, pCur);

        // 自製商品要把配方完全展開：包材需求算進「包材/原料需求」表，
        // 如果配方裡引用到「其他自製商品」（例如禮盒裝了單顆蛋黃酥），
        // 那些單顆商品的需求量也要一併加進「商品需求」表——不然像禮盒
        // 這種組合商品賣出去，系統會完全不知道裡面裝的東西也要多做。
        if (item && item.type === "self_made") {
          const { selfMadeNeeds, packagingNeeds } = expandRecipe(item, li.qty, itemsById);

          if (selfMadeNeeds.size > 0) pCur.hasContents = true; // 這個商品本身是「組合商品」，裡面裝了其他東西

          for (const [subItemId, subQty] of selfMadeNeeds) {
            const subItem = itemsById.get(subItemId);
            const subName = subItem ? subItem.name : "（已刪除的項目）";
            const subUnit = subItem?.unit || "個";
            const sCur = productNeeds.get(subItemId) || { name: subName, unit: subUnit, qty: 0, pendingQty: 0, bundledQty: 0, hasContents: false, productId: subItemId, type: subItem?.type };
            sCur.name = subName;
            sCur.qty += subQty;
            sCur.bundledQty += subQty; // 記錄「這裡面有多少是從別的組合商品拆解出來的」
            if (isPending) sCur.pendingQty += subQty;
            productNeeds.set(subItemId, sCur);
          }

          for (const [matItemId, matQty] of packagingNeeds) {
            const matItem = itemsById.get(matItemId);
            const matName = matItem ? matItem.name : "（已刪除的項目）";
            const matUnit = matItem?.unit || "個";
            const mCur = materialNeeds.get(matItemId) || { name: matName, unit: matUnit, qty: 0, pendingQty: 0 };
            mCur.name = matName;
            mCur.qty += matQty;
            if (isPending) mCur.pendingQty += matQty;
            materialNeeds.set(matItemId, mCur);
          }
        }
      });
    });

    // 包材/原料需求要跟現有庫存比對，算出還缺多少
    const materials = [...materialNeeds.entries()].map(([itemId, m]) => {
      const matItem = itemsById.get(itemId);
      const currentStock = matItem && STOCK_TRACKED_TYPES.includes(matItem.type) ? computeStock(matItem) : null;
      const shortfall = currentStock !== null ? Math.max(0, m.qty - currentStock) : null;
      return { ...m, currentStock, shortfall };
    }).sort((a, b) => (b.shortfall || 0) - (a.shortfall || 0) || b.qty - a.qty);

    // 商品需求也要跟庫存比對——現貨商品（resale）本身就有庫存追蹤，
    // 之前漏掉沒有跟包材用同一套邏輯比對，導致看不出現貨商品夠不夠賣。
    // 自製商品（self_made）沒有庫存概念（做多少賣多少），比對欄位顯示「—」。
    const products = [...productNeeds.values()].map((p) => {
      const item = p.productId ? itemsById.get(p.productId) : null;
      const currentStock = item && STOCK_TRACKED_TYPES.includes(item.type) ? computeStock(item) : null;
      const shortfall = currentStock !== null ? Math.max(0, p.qty - currentStock) : null;
      return { ...p, currentStock, shortfall };
    }).sort((a, b) => (b.shortfall || 0) - (a.shortfall || 0) || b.qty - a.qty);

    return { orderCount: relevant.length, products, materials };
  }

  function render() {
    const { orderCount, products, materials } = computeSummary();
    const shortfallCount = materials.filter((m) => (m.shortfall || 0) > 0).length;

    container.innerHTML = `
      ${pageNavHtml("備料清單")}
      <div class="card" style="margin-bottom:16px;">
        <p class="hint" style="margin:0 0 14px;">
          彙總「還沒出貨」的訂單，算出每個商品總共要準備幾份，
          自製商品也會展開配方，直接告訴你包材/原料還缺多少要補。
        </p>
        <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin-bottom:8px;">預計出貨/取貨日期範圍（選填）</label>
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;">
          <input type="date" id="pl-date-start" value="${filterStart}" style="flex:1;min-width:0;max-width:150px;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;" />
          <span class="hint">～</span>
          <input type="date" id="pl-date-end" value="${filterEnd}" style="flex:1;min-width:0;max-width:150px;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;" />
        </div>
        ${(filterStart || filterEnd) ? `<div style="text-align:center;margin-top:8px;"><button type="button" id="pl-clear-dates" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">清除日期，看全部</button></div>` : ""}
        <div class="hint" style="margin-top:12px;text-align:center;">${(filterStart || filterEnd) ? "" : "不填日期＝統計全部還沒出貨的訂單。"}共 ${orderCount} 張訂單符合條件。</div>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <h3 style="font-size:15px;margin-bottom:4px;">商品需求（要準備幾份）</h3>
        <div class="hint" style="margin-bottom:10px;">現貨商品已跟目前庫存比對；自製商品做多少賣多少，沒有庫存概念，顯示「—」。禮盒這種組合商品，裡面裝的東西會分開列在下方，數量已經自動拆解合併好了。</div>
        ${products.length === 0 ? `<div class="hint" style="text-align:center;padding:16px 0;">沒有符合條件的訂單</div>` : products.map((p) => `
          <div style="padding:12px 0;border-top:1px solid var(--paper-line);">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
              <span style="font-size:15px;color:var(--ink);font-weight:600;">${p.name}${p.hasContents ? `<span class="hint" style="font-weight:400;"> · 內含其他商品，已分開列出</span>` : ""}</span>
              <span style="font-family:var(--font-mono);font-weight:700;font-size:17px;color:var(--ink);white-space:nowrap;">${p.qty} ${p.unit}</span>
            </div>
            <div class="hint" style="margin-top:2px;">
              ${p.currentStock !== null ? `目前庫存 ${p.currentStock} · ` : ""}${p.shortfall !== null ? (p.shortfall > 0 ? `<span style="color:var(--rose);font-weight:600;">還缺 ${p.shortfall}</span>` : `<span style="color:var(--jade);">庫存夠用</span>`) : "不追蹤庫存"}
            </div>
            ${p.bundledQty > 0 ? `<div class="hint">其中 ${p.bundledQty} ${p.unit} 是從禮盒等組合商品拆解出來的</div>` : ""}
            ${p.pendingQty > 0 ? `<div class="hint">其中 ${p.pendingQty} ${p.unit} 來自尚待確認的訂單</div>` : ""}
          </div>
        `).join("")}
      </div>

      ${materials.length > 0 ? `
        <div class="card">
          <h3 style="font-size:15px;margin-bottom:4px;">包材／原料需求</h3>
          <div class="hint" style="margin-bottom:10px;">
            自製商品依配方展開後的總用量，已經跟目前庫存比對過。
            ${shortfallCount > 0 ? `<span style="color:var(--rose);font-weight:600;">有 ${shortfallCount} 項庫存不夠，需要補貨。</span>` : `目前庫存都夠用，不用額外採購。`}
          </div>
          ${materials.map((m) => `
            <div style="padding:12px 0;border-top:1px solid var(--paper-line);">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
                <span style="font-size:15px;color:var(--ink);font-weight:600;">${m.name}</span>
                <span style="font-family:var(--font-mono);font-weight:700;font-size:17px;color:var(--ink);white-space:nowrap;">${m.qty} ${m.unit}</span>
              </div>
              <div class="hint" style="margin-top:2px;">
                目前庫存 ${m.currentStock !== null ? m.currentStock : "—"} · ${m.shortfall !== null ? (m.shortfall > 0 ? `<span style="color:var(--rose);font-weight:600;">還缺 ${m.shortfall}</span>` : `<span style="color:var(--jade);">庫存夠用</span>`) : "—"}
              </div>
              ${m.pendingQty > 0 ? `<div class="hint">其中 ${m.pendingQty} ${m.unit} 來自尚待確認的訂單</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    `;
    wirePageNav(container);

    container.querySelector("#pl-date-start").addEventListener("change", (e) => { filterStart = e.target.value; render(); });
    container.querySelector("#pl-date-end").addEventListener("change", (e) => { filterEnd = e.target.value; render(); });
    container.querySelector("#pl-clear-dates")?.addEventListener("click", () => { filterStart = ""; filterEnd = ""; render(); });
  }

  container.innerHTML = `${pageNavHtml("備料清單")}<div class="card"><div class="hint">載入中…</div></div>`;
  wirePageNav(container);
  try {
    await loadData();
    render();
  } catch (err) {
    container.innerHTML = `${pageNavHtml("備料清單")}<div class="card" style="color:var(--rose);">載入失敗：${friendlyErrorMessage(err)}</div>`;
    wirePageNav(container);
    showToast("載入失敗：" + friendlyErrorMessage(err), "error");
  }
}
