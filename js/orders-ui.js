// ============================================================
// 訂單管理頁面 UI
// ============================================================
import { showToast, linkifyErrorMessage } from "./utils.js";
import { currentSession } from "./auth.js";
import {
  listOrders, createOrder, updateOrderBeforeShip, updateAmountReceived, getPaymentStatus,
  markPreparing, markShipped, markDone, voidOrder,
  SHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS,
} from "./orders.js";
import { listItems, buildItemsIndex, ORDERABLE_TYPES } from "./items.js";
import { listContacts, createContact } from "./contacts.js";
import { printOrderSlip } from "./print-slip.js";
import { exportOrders } from "./export-xlsx.js";
import { setFab } from "./fab-ui.js";
import { openSearchPicker } from "./picker-ui.js";
import { openModal, confirmDialog } from "./modal-ui.js";

function canSeeCost() {
  return ["superadmin", "admin", "viewer"].includes(currentSession.member?.role);
}
function canWrite() {
  return ["superadmin", "admin", "order_staff"].includes(currentSession.member?.role);
}
function canVoid() {
  return ["superadmin", "admin"].includes(currentSession.member?.role);
}

function shipBadgeClass(status) {
  if (status === "done") return "ok";
  if (status === "shipped") return "ok";
  if (status === "preparing") return "warn";
  return "warn";
}
function paymentBadgeClass(status) {
  if (status === "paid") return "ok";
  if (status === "deposit") return "warn";
  return "bad";
}

export async function renderOrdersPage(container, initialFilter = null) {
  let orders = [];
  let allItems = [];
  let itemsById = new Map();
  let contacts = [];
  let searchText = (initialFilter?.search || "").toLowerCase();
  let filterShipStatus = initialFilter?.shipStatus || "all";
  let filterQuick = initialFilter?.quick || "all"; // 'all' | 'today' | 'overdue' | 'unpaid_done'
  let filterDateStart = "";
  let filterDateEnd = "";

  container.innerHTML = `
    <div class="page-header">
      <h2>訂單管理</h2>
      <button class="btn btn-secondary" id="btn-export-orders" style="padding:8px 14px;font-size:13px;">匯出</button>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <input type="text" id="search-input" placeholder="搜尋訂單編號/客戶/電話" value="${initialFilter?.search || ""}" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;" />
      <select id="filter-status" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;">
        <option value="all">全部狀態</option>
        <option value="pending">待處理</option>
        <option value="preparing">備貨中</option>
        <option value="shipped">已出貨</option>
        <option value="done">已完成</option>
      </select>
      <select id="filter-quick" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;">
        <option value="all">不特別篩選</option>
        <option value="today">今天應出貨</option>
        <option value="overdue">已逾期未出貨</option>
        <option value="unpaid_done">已完成但未收款</option>
      </select>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="date" id="filter-date-start" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;" />
        <span class="hint">～</span>
        <input type="date" id="filter-date-end" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;" />
      </div>
    </div>
    <div id="orders-list"></div>
  `;

  container.querySelector("#filter-status").value = filterShipStatus;
  container.querySelector("#filter-quick").value = filterQuick;
  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-status").addEventListener("change", (e) => {
    filterShipStatus = e.target.value;
    renderList();
  });
  container.querySelector("#filter-quick").addEventListener("change", (e) => {
    filterQuick = e.target.value;
    renderList();
  });
  container.querySelector("#filter-date-start").addEventListener("change", (e) => {
    filterDateStart = e.target.value;
    renderList();
  });
  container.querySelector("#filter-date-end").addEventListener("change", (e) => {
    filterDateEnd = e.target.value;
    renderList();
  });
  if (canWrite()) {
    setFab([{ icon: "➕", label: "新增訂單", onClick: () => openOrderModal() }]);
  }
  container.querySelector("#btn-export-orders").addEventListener("click", () => {
    openExportModal();
  });

  function openExportModal() {
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">匯出 Excel</h3>
      <div class="field"><label>出貨狀態</label>
        <select id="exp-status">
          <option value="all">全部狀態</option>
          <option value="pending">待處理</option>
          <option value="preparing">備貨中</option>
          <option value="shipped">已出貨</option>
          <option value="done">已完成</option>
        </select>
      </div>
      <div class="field"><label>訂購日期區間（選填）</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="date" id="exp-start" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;" />
          <span class="hint">～</span>
          <input type="date" id="exp-end" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;" />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="exp-confirm">確認匯出</button>
      </div>
    `, 400);

    overlay.querySelector("#exp-status").value = filterShipStatus;

    overlay.querySelector("#exp-confirm").addEventListener("click", () => {
      const status = overlay.querySelector("#exp-status").value;
      const start = overlay.querySelector("#exp-start").value;
      const end = overlay.querySelector("#exp-end").value;

      let filtered = orders;
      if (status !== "all") filtered = filtered.filter((o) => o.shipStatus === status);
      if (start) filtered = filtered.filter((o) => o.orderDate >= start);
      if (end) filtered = filtered.filter((o) => o.orderDate <= end);

      if (filtered.length === 0) { showToast("沒有符合條件的訂單可以匯出", "error"); return; }
      exportOrders(filtered, { includeCost: canSeeCost() });
      overlay.remove();
    });
  }

  function getFilteredOrders() {
    const today = new Date().toISOString().slice(0, 10);
    let filtered = orders;
    if (filterShipStatus !== "all") filtered = filtered.filter((o) => o.shipStatus === filterShipStatus);
    if (filterQuick === "today") {
      filtered = filtered.filter((o) => !o.voided && o.expectedDate === today && !["shipped", "done"].includes(o.shipStatus));
    } else if (filterQuick === "overdue") {
      filtered = filtered.filter((o) => !o.voided && o.expectedDate && o.expectedDate < today && !["shipped", "done"].includes(o.shipStatus));
    } else if (filterQuick === "unpaid_done") {
      filtered = filtered.filter((o) => !o.voided && o.shipStatus === "done" && getPaymentStatus(o) !== "paid");
    }
    if (filterDateStart) filtered = filtered.filter((o) => o.orderDate >= filterDateStart);
    if (filterDateEnd) filtered = filtered.filter((o) => o.orderDate <= filterDateEnd);
    if (searchText) {
      filtered = filtered.filter((o) =>
        (o.orderNumber || "").toLowerCase().includes(searchText) ||
        (o.contactName || "").toLowerCase().includes(searchText) ||
        (o.contactPhone || "").includes(searchText)
      );
    }
    return filtered;
  }

  async function reload() {
    const listEl = container.querySelector("#orders-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [orders, allItems, contacts] = await Promise.all([
        listOrders(),
        listItems({ includeArchived: true }),
        listContacts(),
      ]);
      itemsById = buildItemsIndex(allItems);
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#orders-list");
    const filtered = getFilteredOrders();

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有符合的訂單</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((o) => {
      const profit = o.lineItems.reduce((s, li) => s + (li.subtotal - li.unitCost * li.qty), 0);
      return `
        <div class="card" style="margin-bottom:10px;${o.voided ? "opacity:0.5;" : ""}" data-order-row="${o.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--ink);font-family:var(--font-mono);">${o.orderNumber} ${o.voided ? `<span class="hint">(已作廢)</span>` : ""}</div>
              <div style="font-size:14px;margin-top:2px;">${o.contactName || "（未指定客戶）"} · ${o.orderDate}</div>
              ${o.expectedDate ? `<div class="hint">預計出貨/取貨：${o.expectedDate}</div>` : ""}
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--ink);">$${o.totalAmount}</div>
              ${canSeeCost() ? `<div style="font-size:12px;color:${profit>=0?"var(--jade)":"var(--rose)"};">毛利 $${profit.toFixed(0)}</div>` : ""}
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <span class="seal-badge ${shipBadgeClass(o.shipStatus)}"><span class="dot"></span>${SHIP_STATUS_LABELS[o.shipStatus]}</span>
            <span class="seal-badge ${paymentBadgeClass(getPaymentStatus(o))}"><span class="dot"></span>${PAYMENT_STATUS_LABELS[getPaymentStatus(o)]}</span>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" data-detail="${o.id}" style="padding:7px 14px;font-size:13px;">查看/處理</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => openDetailModal(btn.getAttribute("data-detail")));
    });
  }

  // ---------- 新增 / 編輯訂單（出貨前） ----------
  const PICKUP_METHODS = ["自取", "宅配", "郵寄", "超商取貨", "其他"];
  const ORDER_CHANNELS = ["LINE", "IG", "FB", "現場", "其他"];

  function openOrderModal(order = null) {
    const isEdit = !!order;
    const activeProducts = allItems.filter((i) => ORDERABLE_TYPES.includes(i.type) && i.status !== "archived");
    const customerContacts = contacts.filter((c) => c.roles?.includes("customer"));
    let lineItems = isEdit
      ? order.lineItems.map((li) => ({ ...li }))
      : [{ productId: "", productName: "", qty: 1, unitPrice: 0 }];
    let selectedContact = isEdit ? contacts.find((c) => c.id === order.contactId) || null : null;

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯訂單" : "新增訂單"}</h3>

      <div class="field"><label>客戶</label>
        <div style="display:flex;gap:8px;">
          <button type="button" id="o-contact-btn" class="picker-trigger">${selectedContact ? selectedContact.name : "點選客戶（選填）"}</button>
          <button class="btn btn-secondary" id="o-new-contact" type="button" style="padding:8px 12px;flex-shrink:0;">新增客戶</button>
        </div>
      </div>
      <div class="field"><label>訂購管道（選填）</label>
        <select id="o-channel">
          <option value="">不指定</option>
          ${ORDER_CHANNELS.map((c) => `<option value="${c}" ${order?.orderChannel === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
        <input type="text" id="o-channel-custom" placeholder="請輸入訂購管道" style="display:${order?.orderChannel && !ORDER_CHANNELS.includes(order.orderChannel) ? "block" : "none"};margin-top:6px;" value="${order?.orderChannel && !ORDER_CHANNELS.includes(order.orderChannel) ? order.orderChannel : ""}" />
      </div>
      <div class="field"><label>訂購日期</label><input type="date" id="o-date" value="${order?.orderDate || new Date().toISOString().slice(0,10)}" /></div>

      <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin:14px 0 6px;">商品品項</label>
      <div style="display:flex;gap:6px;padding:0 2px;margin-bottom:4px;">
        <div style="flex:2;font-size:12px;color:var(--text-muted);">商品</div>
        <div style="width:70px;font-size:12px;color:var(--text-muted);">數量</div>
        <div style="width:80px;font-size:12px;color:var(--text-muted);">單價</div>
      </div>
      <div id="o-lineitems"></div>
      <button class="btn btn-secondary" id="o-add-line" type="button" style="margin:8px 0 14px;">+ 新增品項</button>

      <div class="field"><label>運費（選填）</label><input type="number" id="o-shipping" value="${order?.shippingFee || 0}" /></div>
      <div class="field"><label>取貨方式</label>
        <select id="o-pickup">
          <option value="">請選擇</option>
          ${PICKUP_METHODS.map((m) => `<option value="${m}" ${order?.pickupMethod === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>預計出貨/取貨日期</label><input type="date" id="o-expected" value="${order?.expectedDate || ""}" /></div>
      <div class="field"><label>備註（選填）</label><input type="text" id="o-note" value="${order?.note || ""}" /></div>

      <div id="o-total-preview" style="text-align:right;font-size:15px;font-weight:700;margin:10px 0;"></div>

      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="o-save">儲存</button>
      </div>
    `, 640);

    // picker-trigger 樣式跟 .field input 對齊
    overlay.querySelectorAll(".picker-trigger").forEach((el) => {
      el.style.cssText = "flex:1;text-align:left;padding:10px 12px;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:15px;cursor:pointer;color:var(--text-primary);";
    });

    overlay.querySelector("#o-channel").addEventListener("change", (e) => {
      overlay.querySelector("#o-channel-custom").style.display = e.target.value === "其他" ? "block" : "none";
    });

    function updateTotalPreview() {
      const itemsTotal = lineItems.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
      const shipping = Number(overlay.querySelector("#o-shipping").value || 0);
      overlay.querySelector("#o-total-preview").textContent = `總金額：$${(itemsTotal + shipping).toFixed(0)}`;
    }

    function renderLineItems() {
      const wrap = overlay.querySelector("#o-lineitems");
      wrap.innerHTML = lineItems.map((li, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;" data-line="${idx}">
          <button type="button" class="l-product-btn picker-trigger" style="flex:2;text-align:left;padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;background:#fff;font-size:14px;cursor:pointer;">${li.productName || "點選商品"}</button>
          <input type="number" class="l-qty" placeholder="數量" value="${li.qty}" style="width:70px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
          <input type="number" class="l-price" placeholder="單價" value="${li.unitPrice}" style="width:80px;padding:8px;border:1px solid var(--paper-line);border-radius:8px;" />
          ${lineItems.length > 1 ? `<button class="btn btn-danger l-remove" type="button" style="padding:6px 10px;font-size:12px;flex-shrink:0;">刪</button>` : ""}
        </div>
      `).join("");

      wrap.querySelectorAll("[data-line]").forEach((rowEl) => {
        const idx = Number(rowEl.getAttribute("data-line"));
        rowEl.querySelector(".l-product-btn").addEventListener("click", () => {
          openSearchPicker({
            title: "選擇商品",
            items: activeProducts,
            renderLabel: (p) => p.name,
            renderSub: (p) => `$${p.price}`,
            renderThumb: (p) => p.photoUrl || null,
            emptyText: "還沒有任何商品，請先到「商品定價」新增",
            onSelect: (p) => {
              lineItems[idx].productId = p.id;
              lineItems[idx].productName = p.name;
              lineItems[idx].unitPrice = p.price;
              renderLineItems();
              updateTotalPreview();
            },
          });
        });
        rowEl.querySelector(".l-qty").addEventListener("input", (e) => { lineItems[idx].qty = e.target.value; updateTotalPreview(); });
        rowEl.querySelector(".l-price").addEventListener("input", (e) => { lineItems[idx].unitPrice = e.target.value; updateTotalPreview(); });
        const rm = rowEl.querySelector(".l-remove");
        if (rm) rm.addEventListener("click", () => { lineItems.splice(idx, 1); renderLineItems(); updateTotalPreview(); });
      });
    }
    renderLineItems();
    updateTotalPreview();
    overlay.querySelector("#o-shipping").addEventListener("input", updateTotalPreview);

    overlay.querySelector("#o-add-line").addEventListener("click", () => {
      lineItems.push({ productId: "", productName: "", qty: 1, unitPrice: 0 });
      renderLineItems();
    });

    overlay.querySelector("#o-contact-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇客戶",
        items: customerContacts,
        renderLabel: (c) => c.name,
        renderSub: (c) => c.phone || "",
        emptyText: "還沒有任何客戶",
        onSelect: (c) => {
          selectedContact = c;
          overlay.querySelector("#o-contact-btn").textContent = c.name;
        },
      });
    });

    overlay.querySelector("#o-new-contact").addEventListener("click", () => {
      openQuickContactModal((newContact) => {
        contacts.push(newContact);
        selectedContact = newContact;
        overlay.querySelector("#o-contact-btn").textContent = newContact.name;
      });
    });

    overlay.querySelector("#o-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const validLines = lineItems.filter((li) => li.productId && Number(li.qty) > 0);
      if (validLines.length === 0) { showToast("請至少選一個商品品項", "error"); return; }
      const expectedDate = overlay.querySelector("#o-expected").value;
      if (!expectedDate) { showToast("請選擇預計出貨/取貨日期", "error"); return; }
      const pickupMethod = overlay.querySelector("#o-pickup").value;
      if (!pickupMethod) { showToast("請選擇取貨方式", "error"); return; }

      const channelSel = overlay.querySelector("#o-channel").value;
      const orderChannel = channelSel === "其他" ? overlay.querySelector("#o-channel-custom").value : channelSel;

      const data = {
        orderDate: overlay.querySelector("#o-date").value,
        orderChannel,
        contactId: selectedContact?.id || null,
        contactName: selectedContact?.name || "",
        contactPhone: selectedContact?.phone || "",
        contactAddress: selectedContact?.address || "",
        lineItems: validLines,
        shippingFee: overlay.querySelector("#o-shipping").value,
        pickupMethod,
        expectedDate,
        note: overlay.querySelector("#o-note").value,
      };

      btn.disabled = true;
      try {
        if (isEdit) await updateOrderBeforeShip(order.id, data, itemsById);
        else await createOrder(data, itemsById);
        showToast("已儲存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 快速新增客戶（訂單表單內用） ----------
  function openQuickContactModal(onCreated) {
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">新增客戶</h3>
      <div class="field"><label>名稱</label><input type="text" id="qc-name" /></div>
      <div class="field"><label>聯絡電話（選填）</label><input type="text" id="qc-phone" /></div>
      <div class="field"><label>地址（選填）</label><input type="text" id="qc-address" /></div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="qc-save">新增</button>
      </div>
    `, 420);
    overlay.querySelector("#qc-save").addEventListener("click", async (e) => {
      const name = overlay.querySelector("#qc-name").value.trim();
      if (!name) { showToast("請輸入名稱", "error"); return; }
      e.currentTarget.disabled = true;
      try {
        const data = {
          name,
          roles: ["customer"],
          phone: overlay.querySelector("#qc-phone").value,
          address: overlay.querySelector("#qc-address").value,
        };
        await createContact(data);
        const fresh = await listContacts();
        const created = fresh.find((c) => c.name === name) || { id: "", name };
        showToast("已新增客戶", "success");
        overlay.remove();
        onCreated(created);
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        e.currentTarget.disabled = false;
      }
    });
  }

  // ---------- 查看 / 處理訂單 ----------
  async function openDetailModal(orderId) {
    const order = orders.find((o) => o.id === orderId);
    const overlay = openModal(renderDetailHtml(order), 600);
    wireDetailEvents(overlay, order);
  }

  function renderDetailHtml(order) {
    const profit = order.lineItems.reduce((s, li) => s + (li.subtotal - li.unitCost * li.qty), 0);
    const received = order.amountReceived || 0;
    const outstanding = order.totalAmount - received;
    const payStatus = getPaymentStatus(order);
    return `
      <h3 style="margin-bottom:4px;font-family:var(--font-mono);">${order.orderNumber}</h3>
      <div class="hint" style="margin-bottom:14px;">${order.contactName || "（未指定客戶）"} · ${order.orderDate}${order.orderChannel ? " · " + order.orderChannel : ""}</div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        <span class="seal-badge ${shipBadgeClass(order.shipStatus)}"><span class="dot"></span>${SHIP_STATUS_LABELS[order.shipStatus]}</span>
        <span class="seal-badge ${paymentBadgeClass(payStatus)}"><span class="dot"></span>${PAYMENT_STATUS_LABELS[payStatus]}</span>
        ${order.voided ? `<span class="seal-badge bad"><span class="dot"></span>已作廢</span>` : ""}
      </div>

      <table class="simple-table" style="margin-bottom:10px;">
        <thead><tr><th>品項</th><th>數量</th><th>單價</th><th>小計</th></tr></thead>
        <tbody>
          ${order.lineItems.map((li) => `<tr><td>${li.productName}</td><td>${li.qty}</td><td>$${li.unitPrice}</td><td>$${li.subtotal}</td></tr>`).join("")}
        </tbody>
      </table>
      <div style="text-align:right;font-size:14px;">
        <div>商品小計：$${order.itemsTotal}</div>
        <div>運費：$${order.shippingFee}</div>
        <div style="font-weight:700;font-size:16px;margin-top:4px;">總金額：$${order.totalAmount}</div>
        <div style="margin-top:6px;">已收：$${received}${outstanding > 0 ? `　<span style="color:var(--rose);">尚欠 $${outstanding}</span>` : ""}</div>
        ${canSeeCost() ? `<div style="color:${profit>=0?"var(--jade)":"var(--rose)"};margin-top:4px;">毛利：$${profit.toFixed(0)}</div>` : ""}
      </div>

      ${order.pickupMethod || order.expectedDate ? `
        <div class="hint" style="margin-top:10px;">
          ${order.pickupMethod ? `取貨方式：${order.pickupMethod}　` : ""}
          ${order.expectedDate ? `預計出貨/取貨：${order.expectedDate}` : ""}
        </div>
      ` : ""}
      ${order.note ? `<div class="hint" style="margin-top:6px;">備註：${order.note}</div>` : ""}
      ${order.shippedByName ? `<div class="hint" style="margin-top:6px;">出貨紀錄：${order.shippedByName}</div>` : ""}

      <div id="detail-actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;"></div>
      <div id="detail-msg" class="hint" style="margin-top:8px;"></div>
      <div style="margin-top:14px;">
        <button class="btn btn-secondary" id="d-print">列印出貨單</button>
      </div>
    `;
  }

  // ---------- 登記收款 ----------
  function openReceivePaymentModal(order, onSaved) {
    const overlay = openModal(`
      <h3 style="margin-bottom:4px;">登記收款</h3>
      <div class="hint" style="margin-bottom:16px;">${order.orderNumber} · 總金額 $${order.totalAmount}</div>
      <div class="field"><label>目前已收金額</label><input type="number" id="rp-amount" value="${order.amountReceived || 0}" /></div>
      <div class="hint" style="margin-bottom:16px;">填入「目前總共收到多少錢」，不是這次新增的金額。例如原本收了 500，這次客人又付了 300，這裡就填 800。</div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="rp-save">儲存</button>
      </div>
    `, 380);
    overlay.querySelector("#rp-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const amount = overlay.querySelector("#rp-amount").value;
      btn.disabled = true;
      try {
        await updateAmountReceived(order.id, amount);
        showToast("已更新收款", "success");
        overlay.remove();
        onSaved();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  function wireDetailEvents(overlay, order) {
    overlay.querySelector("#d-print").addEventListener("click", () => printOrderSlip(order));
    const actionsEl = overlay.querySelector("#detail-actions");
    const msgEl = overlay.querySelector("#detail-msg");

    function addActionButton(label, cls, handler) {
      const btn = document.createElement("button");
      btn.className = `btn ${cls}`;
      btn.style.cssText = "padding:8px 14px;font-size:13px;";
      btn.textContent = label;
      btn.addEventListener("click", handler);
      actionsEl.appendChild(btn);
    }

    if (order.voided) return; // 作廢的訂單不給任何操作按鈕

    if (canWrite() && order.shipStatus === "pending") {
      addActionButton("編輯訂單", "btn-secondary", () => { overlay.remove(); openOrderModal(order); });
      addActionButton("開始備貨", "btn-secondary", async () => {
        try { await markPreparing(order.id); showToast("已標記備貨中", "success"); overlay.remove(); await reload(); }
        catch (err) { msgEl.textContent = "失敗：" + err.message; }
      });
    }
    if (canWrite() && order.shipStatus === "preparing") {
      addActionButton("編輯訂單", "btn-secondary", () => { overlay.remove(); openOrderModal(order); });
      addActionButton("標記已出貨", "btn-primary", async (e) => {
        e.currentTarget.disabled = true;
        try {
          await markShipped(order.id, itemsById);
          showToast("已出貨，庫存已自動扣除", "success");
          overlay.remove();
          await reload();
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      });
    }
    if (canWrite() && order.shipStatus === "pending") {
      // 待處理狀態也允許直接跳過備貨直接標記出貨
      addActionButton("直接標記已出貨", "btn-primary", async (e) => {
        e.currentTarget.disabled = true;
        try {
          await markShipped(order.id, itemsById);
          showToast("已出貨，庫存已自動扣除", "success");
          overlay.remove();
          await reload();
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      });
    }
    if (canWrite() && order.shipStatus === "shipped") {
      addActionButton("標記已完成", "btn-primary", async () => {
        try { await markDone(order.id); showToast("已標記完成", "success"); overlay.remove(); await reload(); }
        catch (err) { msgEl.textContent = "失敗：" + err.message; }
      });
    }
    if (canWrite()) {
      addActionButton("登記收款", "btn-secondary", () => {
        openReceivePaymentModal(order, () => { overlay.remove(); reload(); });
      });
    }
    if (canVoid()) {
      addActionButton("作廢訂單", "btn-danger", async (e) => {
        const willRestoreStock = ["shipped", "done"].includes(order.shipStatus);
        if (!await confirmDialog(willRestoreStock ? "這張訂單已出貨，作廢後會自動還原庫存，確定嗎？" : "確定要作廢這張訂單嗎？", { confirmLabel: "作廢", danger: true })) return;
        e.currentTarget.disabled = true;
        try {
          await voidOrder(order.id);
          showToast("已作廢" + (willRestoreStock ? "，庫存已還原" : ""), "success");
          overlay.remove();
          await reload();
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      });
    }
  }

  await reload();
  if (initialFilter?.openNew && canWrite()) {
    openOrderModal();
  }
}
