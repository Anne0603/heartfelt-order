// ============================================================
// 系統設定頁
// - 超級管理員：Cloudinary 設定、待審核申請、成員角色管理、品牌圖案
// - 管理員：只看得到「品牌圖案」區塊
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

const ASSIGNABLE_ROLES = ["admin", "order_staff", "viewer"]; // superadmin 不開放指派

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

export async function getBrandSettings() {
  const snap = await getDoc(BRAND_DOC);
  return snap.exists() ? snap.data() : { logoUrl: "" };
}

async function saveBrandLogo(logoUrl) {
  await setDoc(BRAND_DOC, {
    logoUrl: logoUrl || "",
    updatedAt: serverTimestamp(),
    updatedBy: currentSession.user?.email || null
  });
}

async function uploadImageToCloudinary(file) {
  const { cloudName, uploadPreset } = await getCloudinarySettings();
  if (!cloudName || !uploadPreset) {
    throw new Error("請超級管理員先在下方設定 Cloudinary Cloud Name / Upload Preset");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("上傳失敗：" + errText);
  }
  const data = await res.json();
  return data.secure_url;
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

// ---------- 品牌圖案區塊（superadmin + admin 都看得到） ----------
async function renderBrandSection(container) {
  const brand = await getBrandSettings();
  const section = document.createElement("div");
  section.className = "card";
  section.style.marginBottom = "20px";
  section.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:4px;">品牌圖案</h3>
    <div class="desc" style="margin-bottom:14px;">這張圖會統一顯示在登入頁、側邊欄 Logo，以及每個人的頭像位置（不使用個人 Google 大頭貼）。</div>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <div id="brand-preview" style="width:64px;height:64px;border-radius:50%;overflow:hidden;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:900;font-size:26px;color:var(--ink);flex-shrink:0;">
        ${brand.logoUrl ? `<img src="${brand.logoUrl}" style="width:100%;height:100%;object-fit:cover;">` : "心"}
      </div>
      <div style="flex:1;min-width:200px;">
        <input type="file" accept="image/*" id="brand-file-input" style="margin-bottom:8px;display:block;" />
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" id="btn-upload-brand" style="padding:8px 16px;font-size:13px;">上傳並套用</button>
          ${brand.logoUrl ? `<button class="btn btn-secondary" id="btn-reset-brand" style="padding:8px 16px;font-size:13px;">恢復預設圖案</button>` : ""}
        </div>
        <div class="hint" style="margin-top:8px;">建議上傳正方形圖片，會自動裁成圓形。上傳後頁面會重新整理套用到全站。</div>
      </div>
    </div>
  `;
  container.appendChild(section);

  section.querySelector("#btn-upload-brand").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const fileInput = section.querySelector("#brand-file-input");
    const file = fileInput.files?.[0];
    if (!file) {
      showToast("請先選擇圖片", "error");
      return;
    }
    btn.disabled = true;
    btn.textContent = "上傳中…";
    try {
      const url = await uploadImageToCloudinary(file);
      await saveBrandLogo(url);
      showToast("品牌圖案已更新，重新整理套用中…", "success");
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      showToast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "上傳並套用";
    }
  });

  const resetBtn = section.querySelector("#btn-reset-brand");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!confirm("確定要恢復成預設的「心」印章圖案嗎？")) return;
      try {
        await saveBrandLogo("");
        showToast("已恢復預設圖案，重新整理套用中…", "success");
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        showToast("操作失敗：" + err.message, "error");
      }
    });
  }
}

export async function renderSettingsPage(container) {
  const role = currentSession.member?.role;
  const isSuperadmin = role === "superadmin";
  const isAdmin = role === "admin";

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h2>系統設定</h2>
        <div class="desc">${isSuperadmin ? "Cloudinary 圖片上傳設定、成員審核與權限管理、品牌圖案" : "品牌圖案設定"}</div>
      </div>
    </div>
    <div id="settings-sections"></div>
  `;
  const sections = container.querySelector("#settings-sections");

  // 品牌圖案：superadmin + admin 都看得到
  await renderBrandSection(sections);

  if (isAdmin) {
    const note = document.createElement("div");
    note.className = "card placeholder-page";
    note.innerHTML = `
      <div class="icon-badge">心</div>
      <h3>其他系統設定僅限超級管理員</h3>
      <p>Cloudinary 系統設定與成員審核，如需調整請聯絡超級管理員。</p>
    `;
    sections.appendChild(note);
    return;
  }

  if (!isSuperadmin) return; // order_staff / viewer 理論上不會進到這頁（nav 已擋）

  // ---------- 以下僅超級管理員 ----------
  const cloudinarySection = document.createElement("div");
  cloudinarySection.className = "card";
  cloudinarySection.style.marginBottom = "20px";
  cloudinarySection.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:14px;">Cloudinary 圖片上傳設定</h3>
    <div class="field">
      <label>Cloud Name</label>
      <input type="text" id="input-cloud-name" placeholder="例如 dxxxxxxx" />
    </div>
    <div class="field">
      <label>Upload Preset 名稱</label>
      <input type="text" id="input-upload-preset" placeholder="例如 heartfelt-order" />
      <div class="hint">Signing Mode 必須是 Unsigned。</div>
    </div>
    <button class="btn btn-primary" id="btn-save-cloudinary">儲存設定</button>
  `;
  sections.appendChild(cloudinarySection);

  const cloudSettings = await getCloudinarySettings();
  cloudinarySection.querySelector("#input-cloud-name").value = cloudSettings.cloudName || "";
  cloudinarySection.querySelector("#input-upload-preset").value = cloudSettings.uploadPreset || "";
  cloudinarySection.querySelector("#btn-save-cloudinary").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const cloudName = cloudinarySection.querySelector("#input-cloud-name").value;
    const uploadPreset = cloudinarySection.querySelector("#input-upload-preset").value;
    if (!cloudName || !uploadPreset) {
      showToast("Cloud Name 和 Upload Preset 都要填", "error");
      return;
    }
    btn.disabled = true;
    try {
      await saveCloudinarySettings(cloudName, uploadPreset);
      showToast("Cloudinary 設定已儲存", "success");
    } catch (err) {
      showToast("儲存失敗：" + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  const pendingSection = document.createElement("div");
  pendingSection.className = "card";
  pendingSection.style.marginBottom = "20px";
  pendingSection.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:4px;">待審核申請</h3>
    <div class="desc" style="margin-bottom:14px;">有人用 Google 登入但還沒被核准時，會出現在這裡。</div>
    <table class="simple-table">
      <thead><tr><th>Email</th><th>姓名</th><th style="width:220px;">指派角色</th><th></th></tr></thead>
      <tbody id="pending-table-body"><tr><td colspan="4" style="color:var(--text-muted);">載入中…</td></tr></tbody>
    </table>
  `;
  sections.appendChild(pendingSection);

  const membersSection = document.createElement("div");
  membersSection.className = "card";
  membersSection.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:4px;">現有成員</h3>
    <div class="desc" style="margin-bottom:14px;">角色隨時可以調整，只有超級管理員能異動。</div>
    <table class="simple-table">
      <thead><tr><th>Email</th><th style="width:220px;">角色</th><th></th></tr></thead>
      <tbody id="members-table-body"><tr><td colspan="3" style="color:var(--text-muted);">載入中…</td></tr></tbody>
    </table>
  `;
  sections.appendChild(membersSection);

  async function refreshTables() {
    const pendingBody = pendingSection.querySelector("#pending-table-body");
    const membersBody = membersSection.querySelector("#members-table-body");
    try {
      const all = await listAllMembers();
      const pending = all.filter((m) => m.status === "pending");
      const active = all.filter((m) => m.status === "active");

      pendingBody.innerHTML = pending.length === 0
        ? `<tr><td colspan="4" style="color:var(--text-muted);">目前沒有待審核申請</td></tr>`
        : pending.map((m) => `
            <tr>
              <td>${m.email}</td>
              <td>${m.displayName || "-"}</td>
              <td>
                <select class="pending-role-select" data-email="${m.email}">
                  ${roleOptionsHtml("order_staff")}
                </select>
              </td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-primary" data-approve="${m.email}" style="padding:6px 12px;font-size:12px;">核准</button>
                <button class="btn btn-danger" data-reject="${m.email}" style="padding:6px 12px;font-size:12px;">拒絕</button>
              </td>
            </tr>
          `).join("");

      membersBody.innerHTML = active.length === 0
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

      pendingBody.querySelectorAll("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-approve");
          const select = pendingBody.querySelector(`.pending-role-select[data-email="${email}"]`);
          try {
            await approveMember(email, select.value);
            showToast("已核准", "success");
            refreshTables();
          } catch (err) {
            showToast("核准失敗：" + err.message, "error");
          }
        });
      });
      pendingBody.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-reject");
          if (!confirm(`確定要拒絕 ${email} 的申請嗎？`)) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已拒絕申請", "success");
            refreshTables();
          } catch (err) {
            showToast("操作失敗：" + err.message, "error");
          }
        });
      });
      membersBody.querySelectorAll(".member-role-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          const email = sel.getAttribute("data-email");
          try {
            await changeRole(email, sel.value);
            showToast("角色已更新", "success");
          } catch (err) {
            showToast("更新失敗：" + err.message, "error");
            refreshTables();
          }
        });
      });
      membersBody.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-remove");
          if (!confirm(`確定要移除 ${email} 的存取權限嗎？`)) return;
          try {
            await rejectOrRemoveMember(email);
            showToast("已移除成員", "success");
            refreshTables();
          } catch (err) {
            showToast("移除失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      pendingBody.innerHTML = `<tr><td colspan="4" style="color:var(--rose);">載入失敗：${err.message}</td></tr>`;
      membersBody.innerHTML = "";
    }
  }

  refreshTables();
}
