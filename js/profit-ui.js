// ============================================================
// 利潤總覽
// 銷貨成本 = 包材（自製商品用掉的物料）+ 進貨成本（現貨商品本身的採購成本）
//          + 其他（手動登記的銷貨成本支出，例如原料）
// 毛利 = 營收 − 銷貨成本
// 淨利 = 毛利 − 營業費用
// 只有超級管理員/管理員/唯讀成員看得到（跟 MODULES 的角色設定一致）
// 支出的登記/查詢/編輯在獨立的「支出管理」頁面，這裡只看計算結果。
// 版面採用會計報表慣例：項目靠左、金額靠右，明細緊接在對應的
// 總額下面；每一行明細都能點看更細的拆解。
// ============================================================
import { listOrders, listAllReturns } from "./orders.js?v=20260830-91";
import { listItems, computeStock, computeAvgCost, STOCK_TRACKED_TYPES, buildItemsIndex } from "./items.js?v=20260830-91";
import { listExpensesInRange } from "./expenses.js?v=20260830-91";
import { renderDateRangePicker } from "./date-range-ui.js?v=20260830-91";
import { linkifyErrorMessage, friendlyErrorMessage } from "./utils.js?v=20260830-91";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-91";

export async function renderProfitPage(container, navigateTo) {
  function renderSummaryShell(initialRange) {
    container.innerHTML = `
      ${pageNavHtml("利潤總覽")}
      <div id="range-picker"></div>
      <div id="profit-summary"></div>
    `;
    wirePageNav(container);
    const { getRange } = renderDateRangePicker(container.querySelector("#range-picker"), (range) => load(range), initialRange);
    return getRange;
  }

  const getRange = renderSummaryShell();
  await load(getRange());

  // ---------- 會計報表慣例的一行：項目靠左，金額靠右 ----------
  function ledgerRow({ label, sub, amount, size = 16, weight = 700, color = "var(--ink)" }) {
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:9px 0;">
        <div>
          <div style="font-size:14.5px;color:var(--ink);">${label}</div>
          ${sub ? `<div class="hint">${sub}</div>` : ""}
        </div>
        <div style="font-family:var(--font-mono);font-size:${size}px;font-weight:${weight};color:${color};text-align:right;white-space:nowrap;">$${amount.toFixed(0)}</div>
      </div>
    `;
  }

  // ---------- 可點擊的子項目一行（縮排、灰階、右邊帶箭頭） ----------
  function subRow({ label, amount, extraClass = "", attrs = "" }) {
    return `
      <button class="profit-sub-row ${extraClass}" ${attrs} style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:8px 0 8px 14px;border:none;background:transparent;text-align:left;cursor:pointer;font-family:var(--font-body);">
        <span style="color:var(--text-muted);font-size:13.5px;">${label}</span>
        <span style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text-muted);">$${amount.toFixed(0)}</span>
      </button>
    `;
  }

  function categoryRows(list, costType) {
    const byCategory = {};
    list.forEach((e) => {
      const label = e.category || "（未分類）";
      byCategory[label] = (byCategory[label] || 0) + e.amount;
    });
    const entries = Object.entries(byCategory);
    if (entries.length === 0) return "";
    return entries.map(([label, amt]) =>
      subRow({ label, amount: amt, extraClass: "expense-cat-row", attrs: `data-costtype="${costType}" data-category="${label === "（未分類）" ? "" : label}"` })
    ).join("");
  }

  // 把日期字串往前/往後位移幾年，用來算「去年同期」的區間
  function shiftYear(dateStr, delta) {
    const d = new Date(dateStr + "T00:00:00");
    d.setFullYear(d.getFullYear() + delta);
    return d.toISOString().slice(0, 10);
  }

  // 把「退貨且有加回庫存」的部分，做成 orderId -> Map(productId -> qty) 的
  // 對照表。這裡抽成共用函式，是因為「利潤總覽總金額」跟「點進去看明細」
  // 這兩個地方都要用同一套邏輯扣退貨，才能保證總金額跟明細加總對得起來。
  function buildRestockedQtyMap(allReturns) {
    const map = new Map();
    (allReturns || []).forEach((r) => {
      (r.items || []).forEach((ri) => {
        if (!ri.restocked) return;
        if (!map.has(r.orderId)) map.set(r.orderId, new Map());
        const m = map.get(r.orderId);
        m.set(ri.productId, (m.get(ri.productId) || 0) + ri.qty);
      });
    });
    return map;
  }
  function effectiveQty(order, li, restockedMap) {
    const restockedQty = restockedMap.get(order.id)?.get(li.productId) || 0;
    return Math.max(0, li.qty - restockedQty);
  }

  // 算一段區間的營收/成本/毛利/淨利，抽出來讓「這段期間」跟「去年同期」共用同一套邏輯
  function computeStats(ordersInRange, expensesInRange, allReturns) {
    // 營收要扣掉退貨金額，不然退過貨的訂單會虛報營收
    const revenue = ordersInRange.reduce((s, o) => s + (o.totalAmount - (o.returnedAmount || 0)), 0);

    // 退貨如果有勾選「加回庫存」，代表這批商品又回到可以賣的狀態，
    // 當初出貨時認列的成本也要跟著沖銷一部分，不然毛利會被低估
    // （東西明明還在庫存裡，成本卻已經被算成「賣出去的成本」）。
    // 只有「加回庫存」的部分才沖銷——如果商品已經壞了沒辦法賣
    // （沒勾加回庫存），成本本來就該繼續算，不能沖銷。
    const restockedQtyByOrderProduct = buildRestockedQtyMap(allReturns);

    let packagingCost = 0, resaleCost = 0;
    ordersInRange.forEach((o) => {
      o.lineItems.forEach((li) => {
        const qty = effectiveQty(o, li, restockedQtyByOrderProduct);
        const cost = li.unitCost * qty;
        if (li.productType === "resale") resaleCost += cost;
        else packagingCost += cost;
      });
    });
    const cogsExpenses = expensesInRange.filter((e) => e.costType === "cogs");
    const opexExpenses = expensesInRange.filter((e) => e.costType !== "cogs");
    const cogsExtra = cogsExpenses.reduce((s, e) => s + e.amount, 0);
    const opexTotal = opexExpenses.reduce((s, e) => s + e.amount, 0);
    const totalCOGS = packagingCost + resaleCost + cogsExtra;
    const grossProfit = revenue - totalCOGS;
    const netProfit = grossProfit - opexTotal;
    return { revenue, packagingCost, resaleCost, cogsExpenses, opexExpenses, totalCOGS, opexTotal, grossProfit, netProfit };
  }

  // 「較去年同期 +12%」這種小標籤；去年同期是 0 或沒資料就不顯示，避免除以 0 出現奇怪數字
  function yoyBadge(current, previous) {
    if (!previous) return "";
    const diff = current - previous;
    const pct = (diff / Math.abs(previous)) * 100;
    const up = diff >= 0;
    return `<span style="font-size:12.5px;font-weight:600;color:${up ? "var(--jade)" : "var(--rose)"};margin-left:8px;">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}% 較去年同期</span>`;
  }

  async function load(range) {
    const summaryEl = container.querySelector("#profit-summary");
    summaryEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const lastYearRange = { start: shiftYear(range.start, -1), end: shiftYear(range.end, -1) };
      const [orders, expenses, lastYearExpenses, allItems, allReturns] = await Promise.all([
        listOrders(),
        listExpensesInRange(range.start, range.end),
        listExpensesInRange(lastYearRange.start, lastYearRange.end),
        listItems(),
        listAllReturns(),
      ]);
      const ordersInRange = orders.filter((o) => !o.voided && o.orderDate >= range.start && o.orderDate <= range.end);
      const lastYearOrders = orders.filter((o) => !o.voided && o.orderDate >= lastYearRange.start && o.orderDate <= lastYearRange.end);

      const stockValueItems = allItems.filter((i) => STOCK_TRACKED_TYPES.includes(i.type) && i.status !== "archived" && computeStock(i) > 0);
      const totalStockValue = stockValueItems.reduce((s, i) => s + computeStock(i) * computeAvgCost(i), 0);
      const itemsById = buildItemsIndex(allItems);

      const stats = computeStats(ordersInRange, expenses, allReturns);
      const lastYearStats = lastYearOrders.length > 0 ? computeStats(lastYearOrders, lastYearExpenses, allReturns) : null;
      const { revenue, packagingCost, resaleCost, cogsExpenses, opexExpenses, totalCOGS, opexTotal, grossProfit, netProfit } = stats;

      const grossMarginText = revenue > 0 ? `${((grossProfit / revenue) * 100).toFixed(1)}%` : "—";
      const netMarginText = revenue > 0 ? `${((netProfit / revenue) * 100).toFixed(1)}%` : "—";

      summaryEl.innerHTML = `
        <div class="card">
          ${ledgerRow({ label: "營收", amount: revenue, size: 20 })}
          ${lastYearStats ? `<div style="text-align:right;margin-top:-6px;margin-bottom:6px;">${yoyBadge(revenue, lastYearStats.revenue)}</div>` : ""}

          <div style="border-top:1px solid var(--paper-line);margin-top:4px;padding-top:4px;">
            ${ledgerRow({ label: "銷貨成本", amount: totalCOGS, size: 18 })}
            ${subRow({ label: "包材", amount: packagingCost, attrs: `id="btn-packaging-detail"` })}
            ${subRow({ label: "進貨成本", amount: resaleCost, attrs: `id="btn-resale-detail"` })}
            ${categoryRows(cogsExpenses, "cogs")}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "毛利", sub: `毛利率 ${grossMarginText}`, amount: grossProfit, size: 22, weight: 900, color: grossProfit>=0?"var(--ink)":"var(--rose)" })}
            ${lastYearStats ? `<div style="text-align:right;margin-top:-4px;">${yoyBadge(grossProfit, lastYearStats.grossProfit)}</div>` : ""}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "營業費用", amount: opexTotal, size: 18 })}
            ${categoryRows(opexExpenses, "opex")}
          </div>

          <div style="border-top:1px solid var(--paper-line);margin-top:8px;padding-top:4px;">
            ${ledgerRow({ label: "淨利", sub: `淨利率 ${netMarginText}`, amount: netProfit, size: 24, weight: 900, color: netProfit>=0?"var(--ink)":"var(--rose)" })}
            ${lastYearStats ? `<div style="text-align:right;margin-top:-4px;">${yoyBadge(netProfit, lastYearStats.netProfit)}</div>` : ""}
          </div>

          <div class="hint" style="margin-top:12px;">共 ${ordersInRange.length} 張訂單（不含作廢）· ${range.start} ～ ${range.end}</div>
          ${lastYearStats ? `<div class="hint" style="margin-top:2px;">去年同期（${lastYearRange.start} ～ ${lastYearRange.end}）：營收 $${lastYearStats.revenue.toFixed(0)}，共 ${lastYearOrders.length} 張訂單</div>` : `<div class="hint" style="margin-top:2px;">去年同期沒有訂單資料，無法比較</div>`}
        </div>

        <div class="card" style="margin-top:16px;background:var(--paper);">
          <h3 style="font-size:14px;margin-bottom:4px;">目前庫存價值</h3>
          <div class="hint" style="margin-bottom:10px;">現在手上還沒賣掉的存貨值多少錢，給對外申報/會計參考用，<b>不會影響上面的利潤計算</b>。</div>
          <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--ink);">$${totalStockValue.toFixed(0)}</div>
          <div class="hint" style="margin-top:4px;">${stockValueItems.length} 項有庫存的商品/包材，用目前的加權平均成本估算</div>
        </div>
      `;

      summaryEl.querySelector("#btn-packaging-detail").addEventListener("click", () => {
        renderPackagingDetailPage(range, ordersInRange, allReturns, itemsById);
      });
      summaryEl.querySelector("#btn-resale-detail").addEventListener("click", () => {
        renderResaleDetailPage(range, ordersInRange, allReturns, itemsById);
      });
      summaryEl.querySelectorAll(".expense-cat-row").forEach((btn) => {
        btn.addEventListener("click", () => {
          navigateTo("expenses", {
            costType: btn.getAttribute("data-costtype"),
            category: btn.getAttribute("data-category") || "all",
            rangeStart: range.start,
            rangeEnd: range.end,
          });
        });
      });
    } catch (err) {
      summaryEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(friendlyErrorMessage(err))}</div>`;
    }
  }

  // ---------- 明細表格（簡單表格，靠右對齊金額，跟主卡片同一套視覺語言） ----------
  function detailTable(entries, emptyText) {
    if (entries.length === 0) return `<div class="hint" style="text-align:center;padding:16px 0;">${emptyText}</div>`;
    return `<table class="simple-table">${entries.map(([label, amt, extra]) =>
      `<tr><td>${label}${extra ? `<span class="hint"> · ${extra}</span>` : ""}</td><td style="text-align:right;font-family:var(--font-mono);font-weight:600;">$${amt.toFixed(0)}</td></tr>`
    ).join("")}</table>`;
  }

  // ---------- 依訂單拆解表格（每一列可以點，帶去訂單管理搜尋出那張訂單） ----------
  function orderRowsTable(orderEntries, emptyText) {
    if (orderEntries.length === 0) return `<div class="hint" style="text-align:center;padding:16px 0;">${emptyText}</div>`;
    return `<table class="simple-table">
      ${orderEntries.map((o) => `
        <tr class="order-detail-row" data-ordernumber="${o.orderNumber}" style="cursor:pointer;">
          <td>${o.orderNumber}<div class="hint">${o.orderDate}${o.contactName ? " · " + o.contactName : ""}</div></td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:600;">$${o.amount.toFixed(0)}</td>
        </tr>
      `).join("")}
    </table>`;
  }
  function wireOrderRows(root) {
    root.querySelectorAll(".order-detail-row").forEach((row) => {
      row.addEventListener("click", () => {
        navigateTo("orders", { search: row.getAttribute("data-ordernumber") });
      });
    });
  }

  // ---------- 通用的「拆解明細頁」：分頁籤 + 每個分頁籤都能搜尋，取代彈跳視窗 ----------
  function renderDrilldownPage({ title, range, tabs, note }) {
    let activeTab = tabs[0].id;
    let searchText = "";

    container.innerHTML = `
      ${pageNavHtml(title)}
      <div class="hint" style="margin-bottom:14px;text-align:center;">${range.start} ～ ${range.end}</div>
      ${note ? `<div class="hint" style="margin-bottom:10px;">${note}</div>` : ""}
      <div class="settings-tabs" id="drill-tabs"></div>
      <div id="drill-content"></div>
    `;
    wirePageNav(container, () => {
      renderSummaryShell(range);
      load(range);
    });

    const tabsEl = container.querySelector("#drill-tabs");
    const contentEl = container.querySelector("#drill-content");

    function renderTabButtons() {
      tabsEl.innerHTML = tabs.map((t) => `<button class="settings-tab-btn ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}（${t.rows.length}）</button>`).join("");
      tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeTab = btn.getAttribute("data-tab");
          searchText = "";
          renderTabButtons();
          renderTabContent();
        });
      });
    }

    function renderTabContent() {
      const tab = tabs.find((t) => t.id === activeTab);
      contentEl.innerHTML = `
        <div class="card">
          <input type="text" id="drill-search" placeholder="搜尋" value="${searchText}" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:12px;" />
          <div id="drill-rows"></div>
        </div>
      `;
      contentEl.querySelector("#drill-search").addEventListener("input", (e) => {
        searchText = e.target.value.trim().toLowerCase();
        renderRows(tab);
      });
      renderRows(tab);
    }

    function renderRows(tab) {
      const filtered = searchText ? tab.rows.filter((r) => tab.matches(r, searchText)) : tab.rows;
      const rowsEl = contentEl.querySelector("#drill-rows");
      rowsEl.innerHTML = tab.render(filtered);
      if (tab.wire) tab.wire(rowsEl);
    }

    renderTabButtons();
    renderTabContent();
  }

  function renderPackagingDetailPage(range, ordersInRange, allReturns, itemsById) {
    const restockedQtyByOrderProduct = buildRestockedQtyMap(allReturns);
    const byProduct = new Map(); // key: productId，值含目前名稱，避免改名後被拆成兩筆
    const byMaterial = new Map(); // key: itemId，同樣道理
    const byOrder = new Map();
    let hasAnyBreakdown = false;

    ordersInRange.forEach((o) => {
      let orderCost = 0;
      o.lineItems.forEach((li) => {
        if (li.productType === "resale") return;
        const qty = effectiveQty(o, li, restockedQtyByOrderProduct);
        const lineCost = li.unitCost * qty;
        if (lineCost <= 0) return;
        const productKey = li.productId || li.productName;
        const productName = itemsById.get(li.productId)?.name || li.productName;
        const pCur = byProduct.get(productKey) || { name: productName, cost: 0 };
        pCur.name = productName;
        pCur.cost += lineCost;
        byProduct.set(productKey, pCur);
        orderCost += lineCost;

        (li.costBreakdown || []).forEach((b) => {
          if (!b.itemId) return;
          hasAnyBreakdown = true;
          const cost = b.amount * qty;
          const matQty = (b.qty || 0) * qty;
          const materialName = itemsById.get(b.itemId)?.name || b.itemName;
          const cur = byMaterial.get(b.itemId) || { itemName: materialName, qty: 0, cost: 0 };
          cur.itemName = materialName;
          cur.qty += matQty;
          cur.cost += cost;
          byMaterial.set(b.itemId, cur);
        });
      });
      if (orderCost > 0) byOrder.set(o.orderNumber, { orderNumber: o.orderNumber, orderDate: o.orderDate, contactName: o.contactName, amount: orderCost });
    });

    // byProduct 存的是 {name, cost} 物件（key 是 productId），這裡轉成
    // [目前名稱, 金額] 的格式，維持跟下面 detailTable/matches 相容
    const productRows = [...byProduct.values()].map((v) => [v.name, v.cost]).sort((a, b) => b[1] - a[1]);
    const materialRows = [...byMaterial.values()].sort((a, b) => b.cost - a.cost);
    const orderRows = [...byOrder.values()].sort((a, b) => b.amount - a.amount);

    renderDrilldownPage({
      title: "包材成本拆解",
      range,
      note: !hasAnyBreakdown && productRows.length > 0 ? "這批訂單是在支援「依包材項目」拆解之前建立的，沒有存材料明細，所以那個分頁籤列不出來；之後新建的訂單都會準確拆解。" : "",
      tabs: [
        {
          id: "product", label: "依商品", rows: productRows,
          matches: (r, kw) => r[0].toLowerCase().includes(kw),
          render: (rows) => detailTable(rows, "沒有符合的資料"),
        },
        {
          id: "material", label: "依包材項目", rows: materialRows,
          matches: (r, kw) => r.itemName.toLowerCase().includes(kw),
          render: (rows) => detailTable(rows.map((m) => [m.itemName, m.cost, `用了 ${m.qty}`]), "沒有符合的資料"),
        },
        {
          id: "order", label: "依訂單", rows: orderRows,
          matches: (r, kw) => r.orderNumber.toLowerCase().includes(kw) || (r.contactName || "").toLowerCase().includes(kw),
          render: (rows) => orderRowsTable(rows, "沒有符合的資料"),
          wire: (root) => wireOrderRows(root),
        },
      ],
    });
  }

  function renderResaleDetailPage(range, ordersInRange, allReturns, itemsById) {
    const restockedQtyByOrderProduct = buildRestockedQtyMap(allReturns);
    const byProduct = new Map(); // key: productId，避免改名後被拆成兩筆
    const byOrder = new Map();
    ordersInRange.forEach((o) => {
      let orderCost = 0;
      o.lineItems.forEach((li) => {
        if (li.productType !== "resale") return;
        const qty = effectiveQty(o, li, restockedQtyByOrderProduct);
        const cost = li.unitCost * qty;
        if (cost <= 0) return;
        const productKey = li.productId || li.productName;
        const productName = itemsById.get(li.productId)?.name || li.productName;
        const pCur = byProduct.get(productKey) || { name: productName, cost: 0 };
        pCur.name = productName;
        pCur.cost += cost;
        byProduct.set(productKey, pCur);
        orderCost += cost;
      });
      if (orderCost > 0) byOrder.set(o.orderNumber, { orderNumber: o.orderNumber, orderDate: o.orderDate, contactName: o.contactName, amount: orderCost });
    });
    const productRows = [...byProduct.values()].map((v) => [v.name, v.cost]).sort((a, b) => b[1] - a[1]);
    const orderRows = [...byOrder.values()].sort((a, b) => b.amount - a.amount);

    renderDrilldownPage({
      title: "進貨成本拆解",
      range,
      tabs: [
        {
          id: "product", label: "依商品", rows: productRows,
          matches: (r, kw) => r[0].toLowerCase().includes(kw),
          render: (rows) => detailTable(rows, "沒有符合的資料"),
        },
        {
          id: "order", label: "依訂單", rows: orderRows,
          matches: (r, kw) => r.orderNumber.toLowerCase().includes(kw) || (r.contactName || "").toLowerCase().includes(kw),
          render: (rows) => orderRowsTable(rows, "沒有符合的資料"),
          wire: (root) => wireOrderRows(root),
        },
      ],
    });
  }
}
