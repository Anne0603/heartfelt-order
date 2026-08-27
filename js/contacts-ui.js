// ============================================================
// 客戶與廠商頁面 UI
// ============================================================
import { showToast, linkifyErrorMessage } from "./utils.js?v=20260826-21";
import { currentSession } from "./auth.js?v=20260826-21";
import { openModal, confirmDialog } from "./modal-ui.js?v=20260826-21";
import { listContacts, createContact, updateContact, setContactArchived } from "./contacts.js?v=20260826-21";
import { listOrders, getPaymentStatus } from "./orders.js?v=20260826-21";
import { listCategories } from "./categories.js?v=20260826-21";

async function listMergedSupplyCategories() {
  // 廠商供應的通常是現貨商品或包材，不是自製商品，所以合併這兩種分類清單
  const [resale, packaging] = await Promise.all([
    listCategories("items_resale"),
    listCategories("items_packaging"),
  ]);
  const seen = new Map();
  [...resale, ...packaging].forEach((c) => { if (!seen.has(c.name)) seen.set(c.name, c); });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
import { exportContacts } from "./export-xlsx.js?v=20260826-21";
import { setFab } from "./fab-ui.js?v=20260826-21";
import { iconHtml } from "./icons.js?v=20260826-21";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260826-21";

const ROLE_LABELS = { customer: "客戶", supplier: "廠商" };

function canWrite() {
  const r = currentSession.member?.role;
  return ["superadmin", "admin", "order_staff"].includes(r);
}

export async function renderContactsPage(container) {
  let contacts = [];
  let inventoryCategories = [];
  let filterRole = "all";
  let searchText = "";
  let statusTab = "active"; // 'active' | 'archived'

  container.innerHTML = `
    ${pageNavHtml("客戶與廠商", `<button class="btn btn-secondary" id="btn-export-contacts" style="padding:7px 12px;font-size:13px;">匯出</button>`)}
    <div class="pill-toggle" id="status-toggle">
      <button class="pill-toggle-btn ${statusTab === "active" ? "active" : ""}" data-status="active">使用中</button>
      <button class="pill-toggle-btn ${statusTab === "archived" ? "active" : ""}" data-status="archived">已停用</button>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋名稱/電話" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <select id="filter-role" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;">
          <option value="all">全部</option>
          <option value="customer">客戶</option>
          <option value="supplier">廠商</option>
        </select>
      </div>
    </div>
    <div id="contacts-list"></div>
  `;

  wirePageNav(container);
  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-role").addEventListener("change", (e) => {
    filterRole = e.target.value;
    renderList();
  });
  container.querySelector("#status-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn) return;
    statusTab = btn.getAttribute("data-status");
    container.querySelectorAll("#status-toggle [data-status]").forEach((b) => b.classList.toggle("active", b === btn));
    renderList();
  });
  if (canWrite()) {
    setFab([{ icon: "add", label: "新增聯絡人", onClick: () => openContactModal() }]);
  }
  container.querySelector("#btn-export-contacts").addEventListener("click", () => {
    openExportModal();
  });

  function openExportModal() {
    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">匯出 Excel</h3>
      <div class="field"><label>狀態</label>
        <select id="exp-status">
          <option value="all">全部（使用中＋已停用）</option>
          <option value="active">只匯出使用中</option>
          <option value="archived">只匯出已停用</option>
        </select>
      </div>
      <div class="field"><label>類型</label>
        <select id="exp-role">
          <option value="all">全部</option>
          <option value="customer">客戶</option>
          <option value="supplier">廠商</option>
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="exp-confirm">確認匯出</button>
      </div>
    `, 400);

    overlay.querySelector("#exp-role").value = filterRole;

    overlay.querySelector("#exp-confirm").addEventListener("click", () => {
      const status = overlay.querySelector("#exp-status").value;
      const role = overlay.querySelector("#exp-role").value;

      let filtered = contacts;
      if (status !== "all") filtered = filtered.filter((c) => (status === "archived") === (c.status === "archived"));
      if (role !== "all") filtered = filtered.filter((c) => (c.roles || []).includes(role));

      if (filtered.length === 0) { showToast("沒有符合條件的聯絡人可以匯出", "error"); return; }
      exportContacts(filtered);
      overlay.remove();
    });
  }

  function getFilteredContacts() {
    let filtered = contacts.filter((c) => (statusTab === "archived") === (c.status === "archived"));
    if (filterRole !== "all") filtered = filtered.filter((c) => (c.roles || []).includes(filterRole));
    if (searchText) filtered = filtered.filter((c) =>
      (c.name || "").toLowerCase().includes(searchText) ||
      (c.phone || "").includes(searchText)
    );
    return filtered;
  }

  async function reload() {
    const listEl = container.querySelector("#contacts-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [contacts, inventoryCategories] = await Promise.all([
        listContacts({ includeArchived: true }),
        listMergedSupplyCategories(),
      ]);
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#contacts-list");
    const filtered = getFilteredContacts();

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">${statusTab === "archived" ? "沒有已停用的聯絡人" : "沒有聯絡人"}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((c) => {
      const isArchived = c.status === "archived";
      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:16px;color:var(--ink);">${c.name}</div>
              <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">
                ${(c.roles || []).map((r) => `<span class="seal-badge ok"><span class="dot"></span>${ROLE_LABELS[r]}</span>`).join("")}
                ${isArchived ? `<span class="seal-badge muted"><span class="dot"></span>已停用</span>` : ""}
              </div>
              ${c.phone ? `<div class="hint" style="margin-top:6px;">${iconHtml("phone", "--icon-size:13px;")} ${c.phone}</div>` : ""}
              ${c.address ? `<div class="hint">${iconHtml("pin", "--icon-size:13px;")} ${c.address}</div>` : ""}
              ${c.roles?.includes("customer") && c.orderChannel ? `<div class="hint">訂購管道：${c.orderChannel}</div>` : ""}
              ${c.roles?.includes("supplier") && c.supplyCategory ? `<div class="hint">供應類別：${c.supplyCategory}</div>` : ""}
            </div>
          </div>
          <div style="margin-top:10px;display:flex;justify-content:flex-end;">
            ${canWrite() ? `<button class="btn btn-secondary" data-edit="${c.id}" style="padding:7px 14px;font-size:13px;">編輯</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = contacts.find((x) => x.id === btn.getAttribute("data-edit"));
        openContactModal(c);
      });
    });
  }

  async function loadOrderHistory(contact, overlay) {
    const box = overlay.querySelector("#c-order-history");
    if (!box) return;
    try {
      const orders = await listOrders();
      const theirs = orders.filter((o) => o.contactId === contact.id && !o.voided);
      if (theirs.length === 0) {
        box.innerHTML = `<div class="hint">這位客戶還沒有訂購紀錄</div>`;
        return;
      }
      const totalSpent = theirs.reduce((s, o) => s + o.totalAmount, 0);
      const sorted = [...theirs].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
      const lastOrder = sorted[0];
      const unpaidCount = theirs.filter((o) => getPaymentStatus(o) !== "paid").length;

      box.innerHTML = `
        <div class="hint" style="margin-bottom:8px;font-weight:600;color:var(--ink);">訂購紀錄</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;">
          <div><div class="hint">累積訂單</div><div style="font-family:var(--font-mono);font-weight:700;">${theirs.length} 張</div></div>
          <div><div class="hint">累積消費</div><div style="font-family:var(--font-mono);font-weight:700;">$${totalSpent.toFixed(0)}</div></div>
          <div><div class="hint">最後下單</div><div style="font-family:var(--font-mono);font-weight:700;">${lastOrder.orderDate}</div></div>
        </div>
        ${unpaidCount > 0 ? `<div class="hint" style="color:var(--rose);margin-bottom:8px;">有 ${unpaidCount} 張訂單還沒收齊款項</div>` : ""}
        <div style="border-top:1px solid var(--paper-line);padding-top:8px;">
          ${sorted.slice(0, 3).map((o) => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;">
              <span>${o.orderDate} · ${o.orderNumber}</span>
              <span style="font-family:var(--font-mono);">$${o.totalAmount}</span>
            </div>
          `).join("")}
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div class="hint">訂購紀錄載入失敗</div>`;
    }
  }

  function openContactModal(contact = null) {
    const isEdit = !!contact;
    const roles = contact?.roles || [];

    let selectedRoles = [...roles];

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯聯絡人" : "新增聯絡人"}</h3>
      <div class="field"><label>名稱</label><input type="text" id="c-name" value="${contact?.name || ""}" /></div>
      ${isEdit && roles.includes("customer") ? `<div class="card" style="background:var(--paper);box-shadow:none;margin-bottom:16px;" id="c-order-history"><div class="hint">載入訂購紀錄中…</div></div>` : ""}
      <div class="field"><label>類型（至少選一個）</label>
        <div class="chip-select">
          <button type="button" class="chip-btn ${selectedRoles.includes("customer") ? "active" : ""}" data-role="customer">客戶</button>
          <button type="button" class="chip-btn ${selectedRoles.includes("supplier") ? "active" : ""}" data-role="supplier">廠商</button>
        </div>
      </div>
      <div class="field"><label>聯絡電話（選填）</label><input type="text" id="c-phone" value="${contact?.phone || ""}" /></div>
      <div class="field"><label>地址（選填）</label><input type="text" id="c-address" value="${contact?.address || ""}" /></div>
      <div class="field" id="c-channel-field" style="display:${roles.includes("customer") ? "block" : "none"};">
        <label>訂購管道（選填）</label><input type="text" id="c-channel" placeholder="例如 LINE / IG / FB" value="${contact?.orderChannel || ""}" />
      </div>
      <div class="field" id="c-supply-field" style="display:${roles.includes("supplier") ? "block" : "none"};">
        <label>主要供應類別（選填）</label>
        <select id="c-supply-category">
          <option value="">不指定</option>
          ${inventoryCategories.map((cat) => `<option value="${cat.name}" ${cat.name === contact?.supplyCategory ? "selected" : ""}>${cat.name}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>備註（選填）</label><textarea id="c-note" rows="3" style="resize:vertical;">${contact?.note || ""}</textarea></div>
      <div style="display:flex;justify-content:${isEdit && canWrite() ? "space-between" : "flex-end"};align-items:center;">
        ${isEdit && canWrite() ? `<button class="btn ${contact.status === "archived" ? "btn-success" : "btn-secondary"}" id="c-toggle-archive">${contact.status === "archived" ? "恢復使用" : "停用"}</button>` : ""}
        <button class="btn btn-primary" id="c-save">儲存</button>
      </div>
    `);

    function syncRoleFields() {
      overlay.querySelector("#c-channel-field").style.display = selectedRoles.includes("customer") ? "block" : "none";
      overlay.querySelector("#c-supply-field").style.display = selectedRoles.includes("supplier") ? "block" : "none";
    }
    if (isEdit && roles.includes("customer")) {
      loadOrderHistory(contact, overlay);
    }

    overlay.querySelectorAll("[data-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        if (selectedRoles.includes(role)) selectedRoles = selectedRoles.filter((r) => r !== role);
        else selectedRoles.push(role);
        btn.classList.toggle("active");
        syncRoleFields();
      });
    });

    overlay.querySelector("#c-toggle-archive")?.addEventListener("click", async () => {
      const willArchive = contact.status !== "archived";
      if (willArchive && !await confirmDialog(`確定要停用「${contact.name}」嗎？`)) return;
      try {
        await setContactArchived(contact.id, willArchive, contact.name);
        showToast(willArchive ? "已停用" : "已恢復使用", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("操作失敗：" + err.message, "error");
      }
    });

    overlay.querySelector("#c-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const name = overlay.querySelector("#c-name").value.trim();
      if (!name) { showToast("請輸入名稱", "error"); return; }
      if (selectedRoles.length === 0) { showToast("類型至少要選一個", "error"); return; }

      if (!isEdit) {
        const dup = contacts.find((c) => c.status !== "archived" && (c.name || "").trim().toLowerCase() === name.toLowerCase());
        if (dup) {
          const proceed = await confirmDialog(`已經有一筆叫「${dup.name}」的聯絡人了，確定要繼續新增嗎？`, { confirmLabel: "繼續新增" });
          if (!proceed) return;
        }
      }

      const data = {
        name,
        roles: selectedRoles,
        phone: overlay.querySelector("#c-phone").value,
        address: overlay.querySelector("#c-address").value,
        note: overlay.querySelector("#c-note").value,
        orderChannel: overlay.querySelector("#c-channel")?.value || "",
        supplyCategory: overlay.querySelector("#c-supply-category")?.value || "",
      };

      btn.disabled = true;
      try {
        if (isEdit) await updateContact(contact.id, data);
        else await createContact(data);
        showToast("已儲存", "success");
        overlay.remove();
        await reload();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
        btn.disabled = false;
      }
    });
  }

  await reload();
}
