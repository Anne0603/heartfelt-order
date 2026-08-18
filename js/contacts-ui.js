// ============================================================
// 客戶與廠商頁面 UI
// ============================================================
import { showToast } from "./utils.js";
import { currentSession } from "./auth.js";
import { listContacts, createContact, updateContact, setContactArchived } from "./contacts.js";
import { listCategories } from "./categories.js";

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
  let showArchived = false;

  container.innerHTML = `
    <div class="page-header">
      <h2>客戶與廠商</h2>
      ${canWrite() ? `<button class="btn btn-primary" id="btn-new-contact">新增聯絡人</button>` : ""}
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="search-input" placeholder="搜尋名稱" style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;" />
        <select id="filter-role" style="padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:15px;">
          <option value="all">全部</option>
          <option value="customer">客戶</option>
          <option value="supplier">廠商</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text-muted);">
          <input type="checkbox" id="show-archived" /> 顯示已停用
        </label>
      </div>
    </div>
    <div id="contacts-list"></div>
  `;

  container.querySelector("#search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    renderList();
  });
  container.querySelector("#filter-role").addEventListener("change", (e) => {
    filterRole = e.target.value;
    renderList();
  });
  container.querySelector("#show-archived").addEventListener("change", async (e) => {
    showArchived = e.target.checked;
    await reload();
  });
  if (canWrite()) {
    container.querySelector("#btn-new-contact").addEventListener("click", () => openContactModal());
  }

  async function reload() {
    const listEl = container.querySelector("#contacts-list");
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      [contacts, inventoryCategories] = await Promise.all([
        listContacts({ includeArchived: showArchived }),
        listCategories("inventory"),
      ]);
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗：${err.message}</div>`;
    }
  }

  function renderList() {
    const listEl = container.querySelector("#contacts-list");
    let filtered = contacts;
    if (filterRole !== "all") filtered = filtered.filter((c) => (c.roles || []).includes(filterRole));
    if (searchText) filtered = filtered.filter((c) => (c.name || "").toLowerCase().includes(searchText));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="card" style="color:var(--text-muted);text-align:center;">沒有聯絡人</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((c) => {
      const isArchived = c.status === "archived";
      return `
        <div class="card" style="margin-bottom:10px;${isArchived ? "opacity:0.55;" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:16px;color:var(--ink);">${c.name} ${isArchived ? `<span class="hint">(已停用)</span>` : ""}</div>
              <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">
                ${(c.roles || []).map((r) => `<span class="seal-badge ok"><span class="dot"></span>${ROLE_LABELS[r]}</span>`).join("")}
              </div>
              ${c.phone ? `<div class="hint" style="margin-top:6px;">📞 ${c.phone}</div>` : ""}
              ${c.address ? `<div class="hint">📍 ${c.address}</div>` : ""}
              ${c.roles?.includes("customer") && c.orderChannel ? `<div class="hint">訂購管道：${c.orderChannel}</div>` : ""}
              ${c.roles?.includes("supplier") && c.supplyCategory ? `<div class="hint">供應類別：${c.supplyCategory}</div>` : ""}
            </div>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            ${canWrite() ? `<button class="btn btn-secondary" data-edit="${c.id}" style="padding:7px 14px;font-size:13px;">編輯</button>` : ""}
            ${canWrite() ? `<button class="btn btn-secondary" data-archive="${c.id}" style="padding:7px 14px;font-size:13px;">${isArchived ? "恢復使用" : "停用"}</button>` : ""}
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
    listEl.querySelectorAll("[data-archive]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const c = contacts.find((x) => x.id === btn.getAttribute("data-archive"));
        const willArchive = c.status !== "archived";
        if (willArchive && !confirm(`確定要停用「${c.name}」嗎？`)) return;
        try {
          await setContactArchived(c.id, willArchive);
          showToast(willArchive ? "已停用" : "已恢復使用", "success");
          await reload();
        } catch (err) {
          showToast("操作失敗：" + err.message, "error");
        }
      });
    });
  }

  function openModal(innerHtml) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(20,22,28,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `<div class="card" style="max-width:520px;width:100%;max-height:88vh;overflow-y:auto;" id="modal-box">${innerHtml}</div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openContactModal(contact = null) {
    const isEdit = !!contact;
    const roles = contact?.roles || [];

    const overlay = openModal(`
      <h3 style="margin-bottom:16px;">${isEdit ? "編輯聯絡人" : "新增聯絡人"}</h3>
      <div class="field"><label>名稱</label><input type="text" id="c-name" value="${contact?.name || ""}" /></div>
      <div class="field"><label>類型（至少選一個）</label>
        <div style="display:flex;gap:16px;">
          <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="c-role-customer" ${roles.includes("customer") ? "checked" : ""} /> 客戶</label>
          <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="c-role-supplier" ${roles.includes("supplier") ? "checked" : ""} /> 廠商</label>
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
      <div class="field"><label>備註（選填）</label><input type="text" id="c-note" value="${contact?.note || ""}" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" id="c-cancel">取消</button>
        <button class="btn btn-primary" id="c-save">儲存</button>
      </div>
    `);

    function syncRoleFields() {
      const isCustomer = overlay.querySelector("#c-role-customer").checked;
      const isSupplier = overlay.querySelector("#c-role-supplier").checked;
      overlay.querySelector("#c-channel-field").style.display = isCustomer ? "block" : "none";
      overlay.querySelector("#c-supply-field").style.display = isSupplier ? "block" : "none";
    }
    overlay.querySelector("#c-role-customer").addEventListener("change", syncRoleFields);
    overlay.querySelector("#c-role-supplier").addEventListener("change", syncRoleFields);

    overlay.querySelector("#c-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#c-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const name = overlay.querySelector("#c-name").value.trim();
      const selectedRoles = [];
      if (overlay.querySelector("#c-role-customer").checked) selectedRoles.push("customer");
      if (overlay.querySelector("#c-role-supplier").checked) selectedRoles.push("supplier");
      if (!name) { showToast("請輸入名稱", "error"); return; }
      if (selectedRoles.length === 0) { showToast("類型至少要選一個", "error"); return; }

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
