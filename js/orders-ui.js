// ============================================================
// 訂單管理頁面 UI
// ============================================================
import { showToast, linkifyErrorMessage } from "./utils.js?v=20260826-2";
import { currentSession } from "./auth.js?v=20260826-2";
import {
  listOrders, createOrder, updateOrderBeforeShip, updateAmountReceived, getPaymentStatus,
  markShipped, markDone, voidOrder,
  SHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS, getShipStatusLabel,
} from "./orders.js?v=20260826-2";
import { listItems, buildItemsIndex, ORDERABLE_TYPES } from "./items.js?v=20260826-2";
import { listContacts, createContact } from "./contacts.js?v=20260826-2";
import { printOrderSlip, printShippingList } from "./print-slip.js?v=20260826-2";
import { exportOrders } from "./export-xlsx.js?v=20260826-2";
import { setFab, clearFab } from "./fab-ui.js?v=20260826-2";
import { openSearchPicker } from "./picker-ui.js?v=20260826-2";
import { openModal, confirmDialog } from "./modal-ui.js?v=20260826-2";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260826-2";

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
  let selectMode = false;
  let selectedIds = new Set();

  function renderListView() {
    container.innerHTML = `
      ${pageNavHtml("訂單管理", `<button class="btn btn-secondary" id="btn-export-orders" style="padding:7px 12px;font-size:13px;">匯出</button>`)}
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button class="btn btn-secondary" id="btn-toggle-select" style="padding:7px 12px;font-size:13px;">${selectMode ? "取消批次列印" : "批次列印出貨清單"}</button>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <input type="text" id="search-input" placeholder="搜尋訂單編號/客戶/電話" value="${searchText}" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;" />
        <select id="filter-status" style="width:100%;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;margin-bottom:10px;">
          <option value="all">全部狀態</option>
          <option value="pending">待處理</option>
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
          <input type="date" id="filter-date-start" value="${filterDateStart}" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;" />
          <span class="hint">～</span>
          <input type="date" id="filter-date-end" value="${filterDateEnd}" style="flex:1;min-width:0;padding:9px 8px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;" />
        </div>
      </div>
      <div id="orders-list"></div>
    `;

    wirePageNav(container);
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
    updateFab();
    container.querySelector("#btn-export-orders").addEventListener("click", () => {
      openExportModal();
    });
    container.querySelector("#btn-toggle-select").addEventListener("click", () => {
      selectMode = !selectMode;
      selectedIds.clear();
      renderListView();
    });
    renderList();
  }

  function updateFab() {
    if (selectMode) {
      if (selectedIds.size > 0) {
        setFab([{ icon: "receipt", label: `列印已選 ${selectedIds.size} 張`, onClick: () => {
          const chosen = orders.filter((o) => selectedIds.has(o.id));
          if (chosen.length === 0) { showToast("請先勾選訂單", "error"); return; }
          printShippingList(chosen);
        }}]);
      } else {
        clearFab();
      }
    } else if (canWrite()) {
      setFab([{ icon: "add", label: "新增訂單", onClick: () => renderOrderFormPage() }]);
    }
  }

  function openExportModal() {
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">匯出 Excel</h3>
      <div class="field"><label>出貨狀態</label>
        <select id="exp-status">
          <option value="all">全部狀態</option>
          <option value="pending">待處理</option>
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
      const checked = selectedIds.has(o.id);
      return `
        <div class="card" style="margin-bottom:8px;padding:14px 16px;cursor:pointer;display:flex;gap:10px;${o.voided ? "opacity:0.5;" : ""}" data-open="${o.id}">
          ${selectMode ? `<div style="flex-shrink:0;padding-top:2px;"><span class="switch"><input type="checkbox" data-select-cb="${o.id}" ${checked ? "checked" : ""}><span class="switch-slider"></span></span></div>` : ""}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
              <div style="font-weight:700;font-size:14.5px;color:var(--ink);font-family:var(--font-mono);">${o.orderNumber}${o.voided ? `<span class="hint"> (已作廢)</span>` : ""}</div>
              <div style="font-family:var(--font-mono);font-size:17px;font-weight:700;color:var(--ink);white-space:nowrap;">$${o.totalAmount}</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:4px;">
              <div style="font-size:13.5px;color:var(--text-muted);">${o.contactName || "（未指定客戶）"} · ${o.orderDate}${o.expectedDate ? " · 預計 " + o.expectedDate : ""}</div>
              ${canSeeCost() ? `<div style="font-size:12px;color:${profit>=0?"var(--jade)":"var(--rose)"};white-space:nowrap;">毛利 $${profit.toFixed(0)}</div>` : ""}
            </div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              <span class="seal-badge ${shipBadgeClass(o.shipStatus)}"><span class="dot"></span>${getShipStatusLabel(o.shipStatus)}</span>
              <span class="seal-badge ${paymentBadgeClass(getPaymentStatus(o))}"><span class="dot"></span>${PAYMENT_STATUS_LABELS[getPaymentStatus(o)]}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-open]").forEach((card) => {
      card.addEventListener("click", (e) => {
        const orderId = card.getAttribute("data-open");
        if (selectMode) {
          if (selectedIds.has(orderId)) selectedIds.delete(orderId);
          else selectedIds.add(orderId);
          const cb = card.querySelector(`[data-select-cb="${orderId}"]`);
          if (cb) cb.checked = selectedIds.has(orderId);
          updateFab();
        } else {
          renderOrderDetailPage(orderId);
        }
      });
    });
  }

  // ---------- 新增 / 編輯訂單（出貨前） ----------
  const PICKUP_METHODS = ["自取", "宅配", "郵寄", "超商取貨", "其他"];
  const ORDER_CHANNELS = ["LINE", "IG", "FB", "現場", "其他"];

  function renderOrderFormPage(order = null) {
    clearFab();
    const isEdit = !!order;
    const activeProducts = allItems.filter((i) => ORDERABLE_TYPES.includes(i.type) && i.status !== "archived");
    const customerContacts = contacts.filter((c) => c.roles?.includes("customer"));
    let lineItems = isEdit
      ? order.lineItems.map((li) => ({ ...li }))
      : [{ productId: "", productName: "", qty: 1, unitPrice: 0 }];
    let selectedContact = isEdit ? contacts.find((c) => c.id === order.contactId) || null : null;

    function backToList() {
      renderListView();
    }

    container.innerHTML = `
      ${pageNavHtml(isEdit ? "編輯訂單" : "新增訂單")}

      <div class="card">
        <div class="field"><label>客戶</label>
          <div style="display:flex;gap:8px;">
            <button type="button" id="o-contact-btn" class="picker-trigger" style="flex:1;">${selectedContact ? selectedContact.name : "點選客戶（選填）"}</button>
            <button class="btn btn-secondary" id="o-new-contact" type="button" style="padding:8px 12px;flex-shrink:0;">新增客戶</button>
          </div>
        </div>
        <div class="field"><label>訂購管道（選填）</label>
          <button type="button" id="o-channel-btn" class="picker-trigger">${order?.orderChannel || "不指定"}</button>
        </div>
        <div class="field"><label>訂購日期</label><input type="date" id="o-date" value="${order?.orderDate || new Date().toISOString().slice(0,10)}" /></div>

        <label style="display:block;font-size:14.5px;font-weight:600;color:var(--ink);margin:14px 0 6px;">商品品項</label>
        <div style="display:flex;gap:6px;padding:0 2px;margin-bottom:4px;">
          <div style="flex:2;font-size:12px;color:var(--text-muted);">商品</div>
          <div style="width:64px;flex-shrink:0;font-size:12px;color:var(--text-muted);">數量</div>
          <div style="width:72px;flex-shrink:0;font-size:12px;color:var(--text-muted);">單價</div>
        </div>
        <div id="o-lineitems"></div>
        <button class="btn btn-secondary" id="o-add-line" type="button" style="margin:8px 0 14px;">+ 新增品項</button>

        <div class="field"><label>運費（選填）</label><input type="number" id="o-shipping" value="${order?.shippingFee || 0}" /></div>
        <div class="field"><label>取貨方式</label>
          <button type="button" id="o-pickup-btn" class="picker-trigger">${order?.pickupMethod || "請選擇"}</button>
        </div>
        <div class="field"><label>預計出貨/取貨日期</label><input type="date" id="o-expected" value="${order?.expectedDate || ""}" /></div>
        <div class="field"><label>備註（選填）</label><input type="text" id="o-note" value="${order?.note || ""}" /></div>

        <div id="o-total-preview" style="text-align:right;font-size:15px;font-weight:700;margin:10px 0;"></div>

        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" id="o-save">儲存</button>
        </div>
      </div>
    `;

    wirePageNav(container, backToList);

    // picker-trigger 樣式跟 .field input 對齊

    let orderChannelValue = order?.orderChannel || "";
    container.querySelector("#o-channel-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇訂購管道",
        items: [{ id: "", name: "不指定" }, ...ORDER_CHANNELS.map((c) => ({ id: c, name: c }))],
        renderLabel: (c) => c.name,
        onSelect: (c) => {
          if (c.id === "其他") {
            openCustomTextModal("請輸入訂購管道", orderChannelValue && !ORDER_CHANNELS.includes(orderChannelValue) ? orderChannelValue : "", (val) => {
              orderChannelValue = val;
              container.querySelector("#o-channel-btn").textContent = val || "不指定";
            });
          } else {
            orderChannelValue = c.id;
            container.querySelector("#o-channel-btn").textContent = c.name;
          }
        },
      });
    });

    let pickupMethodValue = order?.pickupMethod || "";
    container.querySelector("#o-pickup-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇取貨方式",
        items: PICKUP_METHODS.map((m) => ({ id: m, name: m })),
        renderLabel: (m) => m.name,
        onSelect: (m) => {
          if (m.id === "其他") {
            openCustomTextModal("請輸入取貨方式", pickupMethodValue && !PICKUP_METHODS.includes(pickupMethodValue) ? pickupMethodValue : "", (val) => {
              pickupMethodValue = val;
              container.querySelector("#o-pickup-btn").textContent = val || "請選擇";
            });
          } else {
            pickupMethodValue = m.id;
            container.querySelector("#o-pickup-btn").textContent = m.name;
          }
        },
      });
    });

    function updateTotalPreview() {
      const itemsTotal = lineItems.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
      const shipping = Number(container.querySelector("#o-shipping").value || 0);
      container.querySelector("#o-total-preview").textContent = `總金額：$${(itemsTotal + shipping).toFixed(0)}`;
    }

    function renderLineItems() {
      const wrap = container.querySelector("#o-lineitems");
      wrap.innerHTML = lineItems.map((li, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;" data-line="${idx}">
          <button type="button" class="l-product-btn picker-trigger compact" style="flex:2;">${li.productName || "點選商品"}</button>
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
    container.querySelector("#o-shipping").addEventListener("input", updateTotalPreview);

    container.querySelector("#o-add-line").addEventListener("click", () => {
      lineItems.push({ productId: "", productName: "", qty: 1, unitPrice: 0 });
      renderLineItems();
    });

    container.querySelector("#o-contact-btn").addEventListener("click", () => {
      openSearchPicker({
        title: "選擇客戶",
        items: customerContacts,
        renderLabel: (c) => c.name,
        renderSub: (c) => c.phone || "",
        emptyText: "還沒有任何客戶",
        onSelect: (c) => {
          selectedContact = c;
          container.querySelector("#o-contact-btn").textContent = c.name;
        },
      });
    });

    container.querySelector("#o-new-contact").addEventListener("click", () => {
      openQuickContactModal((newContact) => {
        contacts.push(newContact);
        selectedContact = newContact;
        container.querySelector("#o-contact-btn").textContent = newContact.name;
      });
    });

    container.querySelector("#o-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const validLines = lineItems.filter((li) => li.productId && Number(li.qty) > 0);
      if (validLines.length === 0) { showToast("請至少選一個商品品項", "error"); return; }
      const expectedDate = container.querySelector("#o-expected").value;
      if (!expectedDate) { showToast("請選擇預計出貨/取貨日期", "error"); return; }
      if (!pickupMethodValue) { showToast("請選擇取貨方式", "error"); return; }

      const pickupMethod = pickupMethodValue;
      const orderChannel = orderChannelValue;

      const data = {
        orderDate: container.querySelector("#o-date").value,
        orderChannel,
        contactId: selectedContact?.id || null,
        contactName: selectedContact?.name || "",
        contactPhone: selectedContact?.phone || "",
        contactAddress: selectedContact?.address || "",
        lineItems: validLines,
        shippingFee: container.querySelector("#o-shipping").value,
        pickupMethod,
        expectedDate,
        note: container.querySelector("#o-note").value,
      };

      btn.disabled = true;
      try {
        if (isEdit) await updateOrderBeforeShip(order.id, data, itemsById);
        else await createOrder(data, itemsById);
        showToast("已儲存", "success");
        backToList();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  // ---------- 快速新增客戶（訂單表單內用） ----------
  // ---------- 自訂文字輸入（訂購管道/取貨方式選「其他」時用） ----------
  function openCustomTextModal(title, initialValue, onConfirm) {
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
  function renderOrderDetailPage(orderId) {
    const order = orders.find((o) => o.id === orderId);
    const profit = order.lineItems.reduce((s, li) => s + (li.subtotal - li.unitCost * li.qty), 0);
    const received = order.amountReceived || 0;
    const outstanding = order.totalAmount - received;
    const payStatus = getPaymentStatus(order);

    function ledgerLine(label, value, opts = {}) {
      return `<div style="display:flex;justify-content:space-between;padding:3px 0;${opts.style || ""}"><span class="hint">${label}</span><span style="font-family:var(--font-mono);${opts.valueStyle || ""}">${value}</span></div>`;
    }

    container.innerHTML = `
      ${pageNavHtml(order.orderNumber)}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        <span class="seal-badge ${shipBadgeClass(order.shipStatus)}"><span class="dot"></span>${getShipStatusLabel(order.shipStatus)}</span>
        <span class="seal-badge ${paymentBadgeClass(payStatus)}"><span class="dot"></span>${PAYMENT_STATUS_LABELS[payStatus]}</span>
        ${order.voided ? `<span class="seal-badge bad"><span class="dot"></span>已作廢</span>` : ""}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div>
            <div class="hint">客戶</div>
            <div style="font-size:15px;color:var(--ink);">${order.contactName || "（未指定客戶）"}${order.contactPhone ? " · " + order.contactPhone : ""}</div>
          </div>
          ${order.createdByName ? `<div style="text-align:right;flex-shrink:0;"><div class="hint">建立人</div><div style="font-size:13px;color:var(--text-muted);">${order.createdByName}</div></div>` : ""}
        </div>
        <div style="display:flex;gap:22px;flex-wrap:wrap;">
          <div><div class="hint">訂購日期</div><div style="font-size:14px;color:var(--ink);">${order.orderDate}</div></div>
          ${order.orderChannel ? `<div><div class="hint">訂購管道</div><div style="font-size:14px;color:var(--ink);">${order.orderChannel}</div></div>` : ""}
          ${order.pickupMethod ? `<div><div class="hint">取貨方式</div><div style="font-size:14px;color:var(--ink);">${order.pickupMethod}</div></div>` : ""}
          ${order.expectedDate ? `<div><div class="hint">預計出貨/取貨</div><div style="font-size:14px;color:var(--ink);">${order.expectedDate}</div></div>` : ""}
        </div>
        ${order.note ? `<div class="hint" style="margin-top:10px;">備註：${order.note}</div>` : ""}
        ${order.shippedByName ? `<div class="hint" style="margin-top:6px;">出貨紀錄：${order.shippedByName}</div>` : ""}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <h3 style="font-size:15px;margin-bottom:10px;">品項明細</h3>
        <table class="simple-table">
          <thead><tr><th>品項</th><th style="text-align:right;">數量</th><th style="text-align:right;">單價</th><th style="text-align:right;">小計</th></tr></thead>
          <tbody>
            ${order.lineItems.map((li) => `<tr><td>${li.productName}</td><td style="text-align:right;">${li.qty}</td><td style="text-align:right;">$${li.unitPrice}</td><td style="text-align:right;font-family:var(--font-mono);">$${li.subtotal}</td></tr>`).join("")}
          </tbody>
        </table>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--paper-line);">
          ${ledgerLine("商品小計", `$${order.itemsTotal}`)}
          ${ledgerLine("運費", `$${order.shippingFee}`)}
          ${ledgerLine("總金額", `$${order.totalAmount}`, { style: "margin-top:4px;", valueStyle: "font-weight:700;font-size:16px;" })}
          ${ledgerLine("已收", `$${received}`)}
          ${outstanding > 0 ? ledgerLine("尚欠", `$${outstanding}`, { valueStyle: "color:var(--rose);font-weight:700;" }) : ""}
          ${canSeeCost() ? ledgerLine("毛利", `$${profit.toFixed(0)}`, { style: "margin-top:4px;", valueStyle: `color:${profit>=0?"var(--jade)":"var(--rose)"};font-weight:700;` }) : ""}
        </div>
      </div>

      <div id="detail-actions-card" class="card"></div>
    `;

    wirePageNav(container, () => renderListView());
    renderOrderDetailActions(order);
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

  // ---------- 動作按鈕：依優先度分組（主要流程 / 常用工具 / 危險區） ----------
  function renderOrderDetailActions(order) {
    const actionsCard = container.querySelector("#detail-actions-card");
    const msgEl = document.createElement("div");
    msgEl.className = "hint";
    msgEl.style.cssText = "color:var(--rose);margin-top:8px;";

    if (order.voided) {
      actionsCard.innerHTML = `
        <button class="btn btn-secondary" id="d-print" style="width:100%;">列印出貨單</button>
      `;
      actionsCard.querySelector("#d-print").addEventListener("click", () => printOrderSlip(order));
      return;
    }

    const primaryBtns = [];
    const utilityBtns = [];

    if (canWrite() && order.shipStatus === "pending") {
      primaryBtns.push({ label: "標記已出貨", cls: "btn-primary", handler: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await markShipped(order.id, itemsById);
          showToast("已出貨，庫存已自動扣除", "success");
          await reload();
          renderOrderDetailPage(order.id);
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      }});
      utilityBtns.push({ label: "編輯訂單", cls: "btn-secondary", handler: () => renderOrderFormPage(order) });
    }
    if (canWrite() && order.shipStatus === "shipped") {
      primaryBtns.push({ label: "標記已完成", cls: "btn-primary", handler: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await markDone(order.id);
          showToast("已標記完成", "success");
          await reload();
          renderOrderDetailPage(order.id);
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      }});
    }
    if (canWrite()) {
      utilityBtns.push({ label: "登記收款", cls: "btn-secondary", handler: () => {
        openReceivePaymentModal(order, async () => { await reload(); renderOrderDetailPage(order.id); });
      }});
    }
    utilityBtns.push({ label: "列印出貨單", cls: "btn-secondary", handler: () => printOrderSlip(order) });

    actionsCard.innerHTML = `
      ${primaryBtns.length ? `<div id="d-primary" style="display:flex;flex-direction:column;gap:8px;margin-bottom:${utilityBtns.length ? "14px" : "0"};"></div>` : ""}
      ${utilityBtns.length ? `<div id="d-utility" style="display:flex;gap:8px;flex-wrap:wrap;"></div>` : ""}
      <div id="d-msg-slot"></div>
      ${canVoid() ? `
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--paper-line);">
          <button class="btn btn-danger" id="d-void" style="width:100%;">作廢訂單</button>
        </div>
      ` : ""}
    `;
    actionsCard.querySelector("#d-msg-slot").appendChild(msgEl);

    const primaryEl = actionsCard.querySelector("#d-primary");
    primaryBtns.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = `btn ${a.cls}`;
      btn.style.cssText = "width:100%;padding:11px;";
      btn.textContent = a.label;
      btn.addEventListener("click", a.handler);
      primaryEl?.appendChild(btn);
    });

    const utilityEl = actionsCard.querySelector("#d-utility");
    utilityBtns.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = `btn ${a.cls}`;
      btn.style.cssText = "padding:8px 14px;font-size:13px;flex:1;min-width:120px;";
      btn.textContent = a.label;
      btn.addEventListener("click", a.handler);
      utilityEl?.appendChild(btn);
    });

    if (canVoid()) {
      actionsCard.querySelector("#d-void").addEventListener("click", async (e) => {
        const willRestoreStock = ["shipped", "done"].includes(order.shipStatus);
        if (!await confirmDialog(willRestoreStock ? "這張訂單已出貨，作廢後會自動還原庫存，確定嗎？" : "確定要作廢這張訂單嗎？", { confirmLabel: "作廢", danger: true })) return;
        e.currentTarget.disabled = true;
        try {
          await voidOrder(order.id);
          showToast("已作廢" + (willRestoreStock ? "，庫存已還原" : ""), "success");
          await reload();
          renderOrderDetailPage(order.id);
        } catch (err) {
          msgEl.textContent = "失敗：" + err.message;
          e.currentTarget.disabled = false;
        }
      });
    }
  }

  renderListView();
  await reload();
  if (initialFilter?.openNew && canWrite()) {
    renderOrderFormPage();
  }
}
