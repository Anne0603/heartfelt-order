// ============================================================
// 管理功能（超級管理員專用，側邊欄直接顯示為獨立項目）：
// Cloudinary 設定 / 待審核申請 / 成員
// 品牌圖案改成「直接點側邊欄 Logo 上傳」，邏輯在 app.js
// ============================================================
import { db } from "./firebase-config.js?v=20260826-9";
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, linkifyErrorMessage } from "./utils.js?v=20260826-9";
import { currentSession, ROLE_LABELS } from "./auth.js?v=20260826-9";
import { listCategories, createCategory, renameCategory, deleteCategory } from "./categories.js?v=20260826-9";
import { listUnits, createUnit, renameUnit, deleteUnit } from "./units.js?v=20260826-9";
import { confirmDialog } from "./modal-ui.js?v=20260826-9";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260826-9";

const CLOUDINARY_DOC = doc(db, "publicSettings", "cloudinary");
const BRAND_DOC = doc(db, "publicSettings", "brand");

const ASSIGNABLE_ROLES = ["admin", "order_staff", "viewer"];

export async function getCloudinarySettings() {
  const snap = await getDoc(CLOUDINARY_DOC);
  return snap.exists() ? snap.data() : { cloudName: "", uploadPreset: "" };
}

async function saveCloudinarySettings(cloudName, uploadPreset) {
  await setDoc(CLOUDINARY_DOC, {
    cloudName: cloudName.trim(),
    uploadPreset: uploadPreset.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: currentSession.user?.email || null
  });
}

export async function uploadImageToCloudinary(file) {
  const { cloudName, uploadPreset } = await getCloudinarySettings();
  if (!cloudName || !uploadPreset) {
    throw new Error("尚未設定 Cloudinary，請聯絡超級管理員");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("上傳失敗");
  const data = await res.json();
  return data.secure_url;
}

export async function saveBrandLogoUrl(logoUrl) {
  await setDoc(BRAND_DOC, {
    logoUrl: logoUrl || "",
    updatedAt: serverTimestamp(),
    updatedBy: currentSession.user?.email || null
  });
}

async function listAllMembers() {
  const snap = await getDocs(collection(db, "members"));
  const list = [];
  snap.forEach((d) => list.push({ email: d.id, ...d.data() }));
  list.sort((a, b) => a.email.localeCompare(b.email));
  return list;
}

export async function getPendingCount() {
  const all = await listAllMembers();
  return all.filter((m) => m.status === "pending").length;
}

async function approveMember(email, role) {
  await setDoc(doc(db, "members", email), {
    status: "active",
    role,
    approvedAt: serverTimestamp(),
    approvedBy: currentSession.user?.email || null,
  }, { merge: true });
}

async function rejectOrRemoveMember(email) {
  await deleteDoc(doc(db, "members", email));
}

async function changeRole(email, role) {
  await setDoc(doc(db, "members", email), {
    role,
    approvedAt: serverTimestamp(),
    approvedBy: currentSession.user?.email || null,
  }, { merge: true });
}

function roleOptionsHtml(selected) {
  return ASSIGNABLE_ROLES.map((r) =>
    `<option value="${r}" ${r === selected ? "selected" : ""}>${ROLE_LABELS[r]}</option>`
  ).join("");
}

// ---------- Cloudinary ----------
export async function renderCloudinaryPage(container) {
  const cloudSettings = await getCloudinarySettings();
  container.innerHTML = `
    ${pageNavHtml("Cloudinary")}
    <div class="card">
      <div class="field">
        <label>Cloud Name</label>
        <input type="text" id="input-cloud-name" value="${cloudSettings.cloudName || ""}" />
      </div>
      <div class="field">
        <label>Upload Preset</label>
        <input type="text" id="input-upload-preset" value="${cloudSettings.uploadPreset || ""}" />
      </div>
      <button class="btn btn-primary" id="btn-save-cloudinary">儲存</button>
    </div>
  `;
  wirePageNav(container);
  container.querySelector("#btn-save-cloudinary").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const cloudName = container.querySelector("#input-cloud-name").value;
    const uploadPreset = container.querySelector("#input-upload-preset").value;
    if (!cloudName || !uploadPreset) {
      showToast("請填寫完整", "error");
      return;
    }
    btn.disabled = true;
    try {
      await saveCloudinarySettings(cloudName, uploadPreset);
      showToast("已儲存", "success");
    } catch (err) {
      showToast("儲存失敗：" + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- 待審核申請 ----------
export async function renderPendingPage(container) {
  container.innerHTML = `
    ${pageNavHtml("待審核申請")}
    <div id="pending-list"></div>
  `;
  wirePageNav(container);
  const listEl = container.querySelector("#pending-list");
  await refresh();

  async function refresh() {
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const all = await listAllMembers();
      const pending = all.filter((m) => m.status === "pending");
      listEl.innerHTML = pending.length === 0
        ? `<div class="card" style="color:var(--text-muted);text-align:center;">目前沒有待審核申請</div>`
        : pending.map((m) => `
            <div class="card" style="margin-bottom:10px;">
              <div style="font-size:15px;color:var(--ink);word-break:break-all;">${m.email}</div>
              <div class="hint" style="margin-top:2px;">${m.displayName || "（未提供姓名）"}</div>
              <div style="margin-top:10px;">
                <select class="pending-role-select" data-email="${m.email}" style="width:100%;padding:9px 10px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;margin-bottom:8px;">${roleOptionsHtml("order_staff")}</select>
                <div style="display:flex;gap:8px;">
                  <button class="btn btn-primary" data-approve="${m.email}" style="padding:8px 14px;font-size:13px;flex:1;">核准</button>
                  <button class="btn btn-danger" data-reject="${m.email}" style="padding:8px 14px;font-size:13px;flex:1;">拒絕</button>
                </div>
              </div>
            </div>
          `).join("");

      listEl.querySelectorAll("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-approve");
          const select = listEl.querySelector(`.pending-role-select[data-email="${email}"]`);
          try {
            await approveMember(email, select.value);
            showToast("已核准", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
      listEl.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-reject");
          if (!await confirmDialog(`拒絕 ${email} 的申請？`, { confirmLabel: "拒絕", danger: true })) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已拒絕", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗</div>`;
    }
  }
}

// ---------- 成員 ----------
export async function renderMembersPage(container) {
  container.innerHTML = `
    ${pageNavHtml("成員")}
    <div id="members-list"></div>
  `;
  wirePageNav(container);
  const listEl = container.querySelector("#members-list");
  await refresh();

  async function refresh() {
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const all = await listAllMembers();
      const active = all.filter((m) => m.status === "active");
      listEl.innerHTML = active.length === 0
        ? `<div class="card" style="color:var(--text-muted);text-align:center;">目前沒有成員</div>`
        : active.map((m) => {
            const isSelf = m.email === currentSession.user?.email;
            const isTargetSuperadmin = m.role === "superadmin";
            return `
              <div class="card" style="margin-bottom:10px;">
                <div style="font-size:15px;color:var(--ink);word-break:break-all;">${m.email}${isSelf ? ` <span class="hint">(你)</span>` : ""}</div>
                <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                  ${isTargetSuperadmin
                    ? `<span class="seal-badge warn" style="white-space:nowrap;"><span class="dot"></span>超級管理員</span>`
                    : `<select class="member-role-select" data-email="${m.email}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;font-size:14px;">${roleOptionsHtml(m.role)}</select>`
                  }
                  ${isTargetSuperadmin || isSelf ? "" : `<button class="btn btn-danger" data-remove="${m.email}" style="padding:6px 12px;font-size:12px;">移除</button>`}
                </div>
              </div>
            `;
          }).join("");

      listEl.querySelectorAll(".member-role-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          const email = sel.getAttribute("data-email");
          try {
            await changeRole(email, sel.value);
            showToast("已更新", "success");
          } catch (err) {
            showToast("失敗：" + err.message, "error");
            refresh();
          }
        });
      });
      listEl.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-remove");
          if (!await confirmDialog(`移除 ${email} 的存取權限？`, { confirmLabel: "移除", danger: true })) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已移除", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗</div>`;
    }
  }
}

// ---------- 分類管理 ----------
export async function renderCategoriesPage(container) {
  container.innerHTML = `
    ${pageNavHtml("分類管理")}
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:10px;">自製商品分類</h3>
      <div id="cat-selfmade-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-selfmade-input" placeholder="新增分類名稱，例如：月餅" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="cat-selfmade-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:10px;">現貨商品分類</h3>
      <div id="cat-resale-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-resale-input" placeholder="新增分類名稱" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="cat-resale-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:10px;">包材分類</h3>
      <div id="cat-packaging-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-packaging-input" placeholder="新增分類名稱，例如：盒子" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="cat-packaging-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:4px;">銷貨成本類別</h3>
      <div class="hint" style="margin-bottom:10px;">跟著訂單/產量變動的成本，例如原料、不追蹤數量的小包材。</div>
      <div id="cat-cogs-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-cogs-input" placeholder="新增類別名稱，例如：原料" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="cat-cogs-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:4px;">營業費用類別</h3>
      <div class="hint" style="margin-bottom:10px;">不管有沒有訂單都要付的固定支出，例如電費、房租、設備。</div>
      <div id="cat-opex-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-opex-input" placeholder="新增類別名稱，例如：電費" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="cat-opex-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
  `;

  wirePageNav(container);
  await setupCategorySection("items_self_made", "cat-selfmade-list", "cat-selfmade-input", "cat-selfmade-add");
  await setupCategorySection("items_resale", "cat-resale-list", "cat-resale-input", "cat-resale-add");
  await setupCategorySection("items_packaging", "cat-packaging-list", "cat-packaging-input", "cat-packaging-add");
  await setupCategorySection("expense_cogs", "cat-cogs-list", "cat-cogs-input", "cat-cogs-add");
  await setupCategorySection("expense_opex", "cat-opex-list", "cat-opex-input", "cat-opex-add");

  async function setupCategorySection(module, listId, inputId, addBtnId) {
    const listEl = container.querySelector(`#${listId}`);
    const inputEl = container.querySelector(`#${inputId}`);
    const addBtn = container.querySelector(`#${addBtnId}`);

    async function refresh() {
      listEl.innerHTML = `<div class="hint">載入中…</div>`;
      try {
        const cats = await listCategories(module);
        listEl.innerHTML = cats.length === 0
          ? `<div class="hint">尚未新增任何分類</div>`
          : cats.map((c) => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--paper-line);">
                <input type="text" class="cat-name-input" data-id="${c.id}" value="${c.name}" style="flex:1;padding:6px 10px;border:1px solid transparent;border-radius:6px;font-size:14px;" />
                <button class="btn btn-secondary cat-rename" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">改名</button>
                <button class="btn btn-danger cat-delete" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">刪除</button>
              </div>
            `).join("");

        listEl.querySelectorAll(".cat-rename").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            const input = listEl.querySelector(`.cat-name-input[data-id="${id}"]`);
            const newName = input.value.trim();
            if (!newName) { showToast("名稱不能空白", "error"); return; }
            try {
              await renameCategory(id, newName);
              showToast("已更新分類名稱", "success");
              refresh();
            } catch (err) {
              showToast("失敗：" + err.message, "error");
            }
          });
        });
        listEl.querySelectorAll(".cat-delete").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            if (!await confirmDialog("確定要刪除這個分類嗎？", { confirmLabel: "刪除", danger: true })) return;
            try {
              await deleteCategory(id);
              showToast("已刪除", "success");
              refresh();
            } catch (err) {
              showToast(err.message, "error");
            }
          });
        });
      } catch (err) {
        listEl.innerHTML = `<div style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
      }
    }

    addBtn.addEventListener("click", async () => {
      const name = inputEl.value.trim();
      if (!name) { showToast("請輸入分類名稱", "error"); return; }
      try {
        await createCategory(module, name);
        inputEl.value = "";
        showToast("已新增", "success");
        refresh();
      } catch (err) {
        showToast("失敗：" + err.message, "error");
      }
    });

    await refresh();
  }
}

// ---------- 單位管理 ----------
export async function renderUnitsPage(container) {
  container.innerHTML = `
    ${pageNavHtml("單位管理")}
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px;">數量單位</h3>
      <div id="unit-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="unit-input" placeholder="新增單位，例如：捲、公斤" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;" />
        <button class="btn btn-primary" id="unit-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
  `;
  wirePageNav(container);

  const listEl = container.querySelector("#unit-list");
  const inputEl = container.querySelector("#unit-input");

  async function refresh() {
    listEl.innerHTML = `<div class="hint">載入中…</div>`;
    try {
      const units = await listUnits();
      listEl.innerHTML = units.length === 0
        ? `<div class="hint">尚未新增任何單位</div>`
        : units.map((u) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--paper-line);">
              <input type="text" class="unit-name-input" data-id="${u.id}" value="${u.name}" style="flex:1;padding:6px 10px;border:1px solid transparent;border-radius:6px;font-size:14px;" />
              <button class="btn btn-secondary unit-rename" data-id="${u.id}" style="padding:5px 10px;font-size:12px;">改名</button>
              <button class="btn btn-danger unit-delete" data-id="${u.id}" style="padding:5px 10px;font-size:12px;">刪除</button>
            </div>
          `).join("");

      listEl.querySelectorAll(".unit-rename").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const input = listEl.querySelector(`.unit-name-input[data-id="${id}"]`);
          const newName = input.value.trim();
          if (!newName) { showToast("名稱不能空白", "error"); return; }
          try {
            await renameUnit(id, newName);
            showToast("已更新單位名稱", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
      listEl.querySelectorAll(".unit-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          if (!await confirmDialog("確定要刪除這個單位嗎？", { confirmLabel: "刪除", danger: true })) return;
          try {
            await deleteUnit(id);
            showToast("已刪除", "success");
            refresh();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div style="color:var(--rose);">載入失敗：${linkifyErrorMessage(err.message)}</div>`;
    }
  }

  container.querySelector("#unit-add").addEventListener("click", async () => {
    const name = inputEl.value.trim();
    if (!name) { showToast("請輸入單位名稱", "error"); return; }
    try {
      await createUnit(name);
      inputEl.value = "";
      showToast("已新增", "success");
      refresh();
    } catch (err) {
      showToast("失敗：" + err.message, "error");
    }
  });

  await refresh();
}
