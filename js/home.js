// ============================================================
// 首頁儀表板
// 第一層：今天要做的事（全部角色，不含金額）
// 第二層：快速操作按鈕（依角色顯示）
// ============================================================
import { currentSession } from "./auth.js?v=20260826-38";
import { lowStockItems } from "./items.js?v=20260826-38";
import { listOrders, normalizeShipStatus } from "./orders.js?v=20260826-38";
import { iconHtml } from "./icons.js?v=20260826-38";

const QUICK_ACTIONS = [
  { id: "orders",    label: "新增訂單",     icon: "pencil", roles: ["superadmin","admin","order_staff"], filter: "openNew" },
  { id: "items",     label: "商品與庫存",   icon: "box", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "orders",    label: "訂單列表",     icon: "search", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "expenses",  label: "支出管理",     icon: "cash", roles: ["superadmin","admin","viewer"] },
  { id: "contacts",  label: "客戶與廠商",   icon: "idcard", roles: ["superadmin","admin","order_staff","viewer"] },
  { id: "profit",    label: "利潤總覽",     icon: "coin", roles: ["superadmin","admin","viewer"] },
];

export async function renderHomePage(container, navigateTo) {
  const role = currentSession.member?.role;

  container.innerHTML = `
    <div id="home-stats" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
      <div class="card" style="padding:16px;cursor:pointer;position:relative;" id="pending-card">
        <div class="hint">待處理訂單</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);" id="pending-count">載入中</div>
        <span style="position:absolute;top:14px;right:14px;color:var(--text-muted);">→</span>
      </div>
      <div class="card" style="padding:16px;cursor:pointer;position:relative;" id="today-ship-card">
        <div class="hint">今日應出貨</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);" id="today-ship-count">載入中</div>
        <span style="position:absolute;top:14px;right:14px;color:var(--text-muted);">→</span>
      </div>
      <div class="card" style="padding:16px;cursor:pointer;position:relative;" id="overdue-card">
        <div class="hint">已逾期未出貨</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--rose);" id="overdue-count">載入中</div>
        <span style="position:absolute;top:14px;right:14px;color:var(--text-muted);">→</span>
      </div>
      <div class="card" style="padding:16px;cursor:pointer;position:relative;" id="low-stock-card">
        <div class="hint">低庫存項目</div>
        <div class="stat-loading" style="font-family:var(--font-mono);font-size:26px;font-weight:700;color:var(--ink);" id="low-stock-count">載入中</div>
        <span style="position:absolute;top:14px;right:14px;color:var(--text-muted);">→</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;" id="quick-actions"></div>
    <h3 style="font-size:15px;color:var(--ink);margin-bottom:10px;">今日待辦</h3>
    <div id="todo-list"><div class="card" style="color:var(--text-muted);">載入中…</div></div>
  `;

  const actionsEl = container.querySelector("#quick-actions");
  actionsEl.innerHTML = QUICK_ACTIONS.filter((a) => a.roles.includes(role)).map((a) => `
    <button class="card" data-goto="${a.id}" data-filter="${a.filter || ""}" style="cursor:pointer;border:none;text-align:center;padding:18px 8px;font-family:var(--font-body);">
      <div style="margin-bottom:6px;color:var(--gold-deep);">${iconHtml(a.icon, "--icon-size:26px;")}</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--ink);">${a.label}</div>
    </button>
  `).join("");
  actionsEl.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-goto");
      const filter = btn.getAttribute("data-filter");
      let filterObj = null;
      if (filter === "today") filterObj = { quick: "today" };
      else if (filter === "openNew") filterObj = { openNew: true };
      navigateTo(id, filterObj);
    });
  });

  container.querySelector("#pending-card").addEventListener("click", () => navigateTo("orders", { shipStatus: "pending" }));
  container.querySelector("#today-ship-card").addEventListener("click", () => navigateTo("orders", { quick: "today" }));
  container.querySelector("#overdue-card").addEventListener("click", () => navigateTo("orders", { quick: "overdue" }));
  container.querySelector("#low-stock-card").addEventListener("click", () => navigateTo("items"));

  try {
    const orders = await listOrders();
    const active = orders.filter((o) => !o.voided);
    const today = new Date().toISOString().slice(0, 10);
    const pendingEl = container.querySelector("#pending-count");
    const todayEl = container.querySelector("#today-ship-count");
    const overdueEl = container.querySelector("#overdue-count");
    [pendingEl, todayEl, overdueEl].forEach((el) => el.classList.remove("stat-loading"));
    const overdueOrders = active.filter((o) => o.expectedDate && o.expectedDate < today && normalizeShipStatus(o.shipStatus) !== "shipped");
    const todayOrders = active.filter((o) => o.expectedDate === today && normalizeShipStatus(o.shipStatus) !== "shipped");
    pendingEl.textContent = active.filter((o) => normalizeShipStatus(o.shipStatus) === "pending").length;
    todayEl.textContent = todayOrders.length;
    overdueEl.textContent = overdueOrders.length;

    const todoEl = container.querySelector("#todo-list");
    const todoOrders = [...overdueOrders, ...todayOrders].slice(0, 6);
    if (todoOrders.length === 0) {
      todoEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">目前沒有今天要出貨或逾期的訂單 🎉</div>`;
    } else {
      todoEl.innerHTML = todoOrders.map((o) => {
        const isOverdue = o.expectedDate < today;
        const itemsSummary = o.lineItems.map((li) => `${li.productName}x${li.qty}`).join("、");
        return `
          <div class="card" style="margin-bottom:8px;padding:12px 14px;cursor:pointer;" data-order="${o.id}" data-quick="${isOverdue ? "overdue" : "today"}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
              <span style="font-weight:700;font-size:14px;color:var(--ink);font-family:var(--font-mono);">${o.orderNumber}</span>
              <span class="seal-badge ${isOverdue ? "bad" : "warn"}" style="flex-shrink:0;"><span class="dot"></span>${isOverdue ? "已逾期" : "今日"}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${o.contactName || "（未指定客戶）"} · ${itemsSummary}</div>
          </div>
        `;
      }).join("");
      todoEl.querySelectorAll("[data-order]").forEach((card) => {
        card.addEventListener("click", () => navigateTo("orders", { quick: card.getAttribute("data-quick") }));
      });
    }
  } catch (err) {
    ["#pending-count", "#today-ship-count", "#overdue-count"].forEach((sel) => {
      const el = container.querySelector(sel);
      el.classList.remove("stat-loading");
      el.textContent = "—";
    });
    container.querySelector("#todo-list").innerHTML = `<div class="card" style="color:var(--rose);">載入失敗</div>`;
  }

  try {
    const low = await lowStockItems();
    const countEl = container.querySelector("#low-stock-count");
    countEl.classList.remove("stat-loading");
    countEl.textContent = low.length;
    countEl.style.color = low.length > 0 ? "var(--rose)" : "var(--ink)";
  } catch (err) {
    const countEl = container.querySelector("#low-stock-count");
    countEl.classList.remove("stat-loading");
    countEl.textContent = "—";
  }
}
