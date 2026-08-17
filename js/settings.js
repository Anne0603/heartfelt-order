// ============================================================
// 系統設定頁（僅超級管理員能進來）
// 分頁籤：Cloudinary / 待審核申請 / 成員
// 品牌圖案改成「直接點側邊欄頭像上傳」，不在這裡（見 app.js）
// ============================================================
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast } from "./utils.js";
import { currentSession, ROLE_LABELS } from "./auth.js";

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

const TABS = [
  { id: "cloudinary", label: "Cloudinary" },
  { id: "pending", label: "待審核申請" },
  { id: "members", label: "成員" },
];

export async function renderSettingsPage(container) {
  const isSuperadmin = currentSession.member?.role === "superadmin";
  if (!isSuperadmin) return;

  let activeTab = "cloudinary";

  container.innerHTML = `
    <div class="page-header"><h2>系統設定</h2></div>
    <div class="settings-tabs" id="settings-tabs"></div>
    <div id="settings-tab-content"></div>
  `;

  const tabsEl = container.querySelector("#settings-tabs");
  const contentEl = container.querySelector("#settings-tab-content");

  function renderTabs() {
    tabsEl.innerHTML = TABS.map((t) => `
      <button class="settings-tab-btn ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>
    `).join("");
    tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.getAttribute("data-tab");
        renderTabs();
        renderContent();
      });
    });
  }

  async function renderContent() {
    if (activeTab === "cloudinary") return renderCloudinaryTab();
    if (activeTab === "pending") return renderPendingTab();
    if (activeTab === "members") return renderMembersTab();
  }

  // ---------- Cloudinary ----------
  async function renderCloudinaryTab() {
    const cloudSettings = await getCloudinarySettings();
    contentEl.innerHTML = `
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
    contentEl.querySelector("#btn-save-cloudinary").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const cloudName = contentEl.querySelector("#input-cloud-name").value;
      const uploadPreset = contentEl.querySelector("#input-upload-preset").value;
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

  // ---------- 待審核 ----------
  async function renderPendingTab() {
    contentEl.innerHTML = `
      <div class="card">
        <table class="simple-table">
          <thead><tr><th>Email</th><th>姓名</th><th style="width:200px;">角色</th><th></th></tr></thead>
          <tbody id="pending-table-body"><tr><td colspan="4">載入中…</td></tr></tbody>
        </table>
      </div>
    `;
    const body = contentEl.querySelector("#pending-table-body");
    try {
      const all = await listAllMembers();
      const pending = all.filter((m) => m.status === "pending");
      body.innerHTML = pending.length === 0
        ? `<tr><td colspan="4" style="color:var(--text-muted);">目前沒有待審核申請</td></tr>`
        : pending.map((m) => `
            <tr>
              <td>${m.email}</td>
              <td>${m.displayName || "-"}</td>
              <td><select class="pending-role-select" data-email="${m.email}">${roleOptionsHtml("order_staff")}</select></td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-primary" data-approve="${m.email}" style="padding:6px 12px;font-size:12px;">核准</button>
                <button class="btn btn-danger" data-reject="${m.email}" style="padding:6px 12px;font-size:12px;">拒絕</button>
              </td>
            </tr>
          `).join("");

      body.querySelectorAll("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-approve");
          const select = body.querySelector(`.pending-role-select[data-email="${email}"]`);
          try {
            await approveMember(email, select.value);
            showToast("已核准", "success");
            renderPendingTab();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
      body.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-reject");
          if (!confirm(`拒絕 ${email} 的申請？`)) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已拒絕", "success");
            renderPendingTab();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" style="color:var(--rose);">載入失敗</td></tr>`;
    }
  }

  // ---------- 成員 ----------
  async function renderMembersTab() {
    contentEl.innerHTML = `
      <div class="card">
        <table class="simple-table">
          <thead><tr><th>Email</th><th style="width:200px;">角色</th><th></th></tr></thead>
          <tbody id="members-table-body"><tr><td colspan="3">載入中…</td></tr></tbody>
        </table>
      </div>
    `;
    const body = contentEl.querySelector("#members-table-body");
    try {
      const all = await listAllMembers();
      const active = all.filter((m) => m.status === "active");
      body.innerHTML = active.length === 0
        ? `<tr><td colspan="3" style="color:var(--text-muted);">目前沒有成員</td></tr>`
        : active.map((m) => {
            const isSelf = m.email === currentSession.user?.email;
            const isTargetSuperadmin = m.role === "superadmin";
            return `
              <tr>
                <td>${m.email}${isSelf ? " <span class=\"hint\">(你)</span>" : ""}</td>
                <td>
                  ${isTargetSuperadmin
                    ? `<span class="seal-badge warn"><span class="dot"></span>超級管理員</span>`
                    : `<select class="member-role-select" data-email="${m.email}">${roleOptionsHtml(m.role)}</select>`
                  }
                </td>
                <td style="text-align:right;">
                  ${isTargetSuperadmin || isSelf ? "" : `<button class="btn btn-danger" data-remove="${m.email}" style="padding:6px 12px;font-size:12px;">移除</button>`}
                </td>
              </tr>
            `;
          }).join("");

      body.querySelectorAll(".member-role-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          const email = sel.getAttribute("data-email");
          try {
            await changeRole(email, sel.value);
            showToast("已更新", "success");
          } catch (err) {
            showToast("失敗：" + err.message, "error");
            renderMembersTab();
          }
        });
      });
      body.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-remove");
          if (!confirm(`移除 ${email} 的存取權限？`)) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已移除", "success");
            renderMembersTab();
          } catch (err) {
            showToast("失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<tr><td colspan="3" style="color:var(--rose);">載入失敗</td></tr>`;
    }
  }

  renderTabs();
  renderContent();
}
