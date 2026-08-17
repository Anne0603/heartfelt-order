// ============================================================
// 系統設定頁
// 1. Cloudinary 設定（Cloud Name / Upload Preset）— 存在
//    Firestore 的 settings/cloudinary 文件裡，不寫死在程式碼。
// 2. 成員白名單管理 — 存在 members/{email} collection，
//    只有 role === 'admin' 的人可以新增 / 移除成員。
// ============================================================
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc,
  collection, getDocs, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, isValidEmail } from "./utils.js";
import { currentSession } from "./auth.js";

const CLOUDINARY_DOC = doc(db, "settings", "cloudinary");

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

async function listMembers() {
  const snap = await getDocs(collection(db, "members"));
  const list = [];
  snap.forEach((d) => list.push({ email: d.id, ...d.data() }));
  list.sort((a, b) => a.email.localeCompare(b.email));
  return list;
}

async function addMember(email, role) {
  const id = email.trim().toLowerCase();
  await setDoc(doc(db, "members", id), {
    role,
    addedAt: serverTimestamp(),
    addedBy: currentSession.user?.email || null
  });
}

async function removeMember(email) {
  await deleteDoc(doc(db, "members", email));
}

export async function renderSettingsPage(container) {
  const isAdmin = currentSession.member?.role === "admin";

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h2>系統設定</h2>
        <div class="desc">Cloudinary 圖片上傳設定，以及可以登入系統的成員名單</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:15px;margin-bottom:14px;">Cloudinary 圖片上傳設定</h3>
      <div class="field">
        <label>Cloud Name</label>
        <input type="text" id="input-cloud-name" placeholder="例如 dxxxxxxx" />
        <div class="hint">在 Cloudinary Dashboard 頁面上方可以看到。</div>
      </div>
      <div class="field">
        <label>Upload Preset 名稱</label>
        <input type="text" id="input-upload-preset" placeholder="例如 heartfelt-order" />
        <div class="hint">Cloudinary → Settings → Upload → Upload presets 裡設定的名稱，Signing Mode 必須是 Unsigned。</div>
      </div>
      <button class="btn btn-primary" id="btn-save-cloudinary">儲存設定</button>
      <span id="cloudinary-status" style="margin-left:10px;font-size:12px;color:var(--text-muted);"></span>
    </div>

    <div class="card">
      <h3 style="font-size:15px;margin-bottom:4px;">成員名單</h3>
      <div class="desc" style="margin-bottom:14px;">只有列在這裡的 Google 帳號可以登入系統，其他人即使用 Google 登入也看不到任何資料。</div>

      ${isAdmin ? `
        <div class="flex-row" style="display:flex;gap:10px;align-items:flex-end;margin-bottom:18px;flex-wrap:wrap;">
          <div class="field" style="flex:1;min-width:220px;margin-bottom:0;">
            <label>Google 帳號 Email</label>
            <input type="email" id="input-new-member-email" placeholder="name@gmail.com" />
          </div>
          <div class="field" style="width:140px;margin-bottom:0;">
            <label>權限</label>
            <select id="input-new-member-role">
              <option value="staff">一般成員</option>
              <option value="admin">管理員</option>
            </select>
          </div>
          <button class="btn btn-primary" id="btn-add-member">新增成員</button>
        </div>
      ` : `<div class="hint" style="margin-bottom:14px;">你目前是「一般成員」，只有管理員可以新增或移除成員。</div>`}

      <table class="simple-table">
        <thead>
          <tr><th>Email</th><th>權限</th><th></th></tr>
        </thead>
        <tbody id="members-table-body">
          <tr><td colspan="3" style="color:var(--text-muted);">載入中…</td></tr>
        </tbody>
      </table>
    </div>
  `;

  // --- Cloudinary 設定：載入現有值 ---
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
      console.error(err);
      showToast("儲存失敗：" + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  // --- 成員名單：載入 + 渲染 ---
  async function refreshMembersTable() {
    const tbody = container.querySelector("#members-table-body");
    try {
      const members = await listMembers();
      if (members.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);">目前沒有任何成員</td></tr>`;
        return;
      }
      tbody.innerHTML = members.map((m) => `
        <tr>
          <td>${m.email}${m.email === currentSession.user?.email ? " <span class=\"hint\">(你)</span>" : ""}</td>
          <td>
            <span class="seal-badge ${m.role === "admin" ? "warn" : "ok"}">
              <span class="dot"></span>${m.role === "admin" ? "管理員" : "一般成員"}
            </span>
          </td>
          <td style="text-align:right;">
            ${isAdmin && m.email !== currentSession.user?.email
              ? `<button class="btn btn-danger" data-remove="${m.email}" style="padding:6px 12px;font-size:12px;">移除</button>`
              : ""}
          </td>
        </tr>
      `).join("");

      tbody.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-remove");
          if (!confirm(`確定要移除 ${email} 的存取權限嗎？`)) return;
          try {
            await removeMember(email);
            showToast("已移除成員", "success");
            refreshMembersTable();
          } catch (err) {
            showToast("移除失敗：" + err.message, "error");
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" style="color:var(--rose);">載入失敗：${err.message}</td></tr>`;
    }
  }

  if (isAdmin) {
    container.querySelector("#btn-add-member").addEventListener("click", async () => {
      const emailInput = container.querySelector("#input-new-member-email");
      const roleInput = container.querySelector("#input-new-member-role");
      const email = emailInput.value.trim();
      if (!isValidEmail(email)) {
        showToast("Email 格式不對", "error");
        return;
      }
      try {
        await addMember(email, roleInput.value);
        emailInput.value = "";
        showToast("成員已新增", "success");
        refreshMembersTable();
      } catch (err) {
        showToast("新增失敗：" + err.message, "error");
      }
    });
  }

  refreshMembersTable();
}
