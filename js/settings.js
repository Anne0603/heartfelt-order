// ============================================================
// 系統設定頁（只有超級管理員能進來）
// 1. Cloudinary 設定
// 2. 待審核申請：核准（指派角色）／拒絕
// 3. 現有成員：改角色／移除
// ============================================================
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast } from "./utils.js";
import { currentSession, ROLE_LABELS } from "./auth.js";

const CLOUDINARY_DOC = doc(db, "settings", "cloudinary");

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

export async function renderSettingsPage(container) {
  const isSuperadmin = currentSession.member?.role === "superadmin";

  if (!isSuperadmin) {
    container.innerHTML = `
      <div class="page-header"><h2>系統設定</h2></div>
      <div class="card placeholder-page">
        <div class="moon-badge"></div>
        <h3>只有超級管理員能使用這個頁面</h3>
        <p>如果你需要調整權限或系統設定，請聯絡超級管理員。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h2>系統設定</h2>
        <div class="desc">Cloudinary 圖片上傳設定、成員審核與權限管理</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
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
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:15px;margin-bottom:4px;">待審核申請</h3>
      <div class="desc" style="margin-bottom:14px;">有人用 Google 登入但還沒被核准時，會出現在這裡。</div>
      <table class="simple-table">
        <thead><tr><th>Email</th><th>姓名</th><th style="width:220px;">指派角色</th><th></th></tr></thead>
        <tbody id="pending-table-body"><tr><td colspan="4" style="color:var(--text-muted);">載入中…</td></tr></tbody>
      </table>
    </div>

    <div class="card">
      <h3 style="font-size:15px;margin-bottom:4px;">現有成員</h3>
      <div class="desc" style="margin-bottom:14px;">角色隨時可以調整，只有超級管理員能異動。</div>
      <table class="simple-table">
        <thead><tr><th>Email</th><th style="width:220px;">角色</th><th></th></tr></thead>
        <tbody id="members-table-body"><tr><td colspan="3" style="color:var(--text-muted);">載入中…</td></tr></tbody>
      </table>
    </div>
  `;

  // ---------- Cloudinary ----------
  const cloudSettings = await getCloudinarySettings();
  container.querySelector("#input-cloud-name").value = cloudSettings.cloudName || "";
  container.querySelector("#input-upload-preset").value = cloudSettings.uploadPreset || "";

  container.querySelector("#btn-save-cloudinary").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const cloudName = container.querySelector("#input-cloud-name").value;
    const uploadPreset = container.querySelector("#input-upload-preset").value;
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

  // ---------- 待審核 + 成員清單 ----------
  async function refreshTables() {
    const pendingBody = container.querySelector("#pending-table-body");
    const membersBody = container.querySelector("#members-table-body");
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

      // 核准
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
      // 拒絕
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
      // 改角色
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
      // 移除
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
