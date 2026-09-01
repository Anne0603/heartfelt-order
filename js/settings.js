// ============================================================
// 管理功能（超級管理員專用，側邊欄直接顯示為獨立項目）：
// Cloudinary 設定 / 待審核申請 / 成員
// 品牌圖案改成「直接點側邊欄 Logo 上傳」，邏輯在 app.js
// ============================================================
import { db } from "./firebase-config.js?v=20260830-59";
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, linkifyErrorMessage, friendlyErrorMessage } from "./utils.js?v=20260830-59";
import { currentSession, ROLE_LABELS } from "./auth.js?v=20260830-59";
import { listCategories, createCategory, renameCategory, deleteCategory } from "./categories.js?v=20260830-59";
import { listUnits, createUnit, renameUnit, deleteUnit } from "./units.js?v=20260830-59";
import { confirmDialog, openModal } from "./modal-ui.js?v=20260830-59";
import { pageNavHtml, wirePageNav } from "./page-nav.js?v=20260830-59";

const CLOUDINARY_DOC = doc(db, "publicSettings", "cloudinary");
const BRAND_DOC = doc(db, "publicSettings", "brand");

// 可以在畫面上指派的角色。原本不含 superadmin，是刻意的保守設計——
// 避免有人不小心把超級管理員權限開給不該開的人。現在加回來是因為
// 使用者明確表示需要自己開一個備援帳號，且這個操作本來就限定只有
// 現任超級管理員才看得到這個畫面（Firestore 規則也限定只有超級管理員
// 能改角色），加上下面已經有「顯示舊角色→新角色、輸入確認才生效」的
// 二次確認機制，风险在可接受範圍內。
const ASSIGNABLE_ROLES = ["superadmin", "admin", "order_staff", "viewer"];

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
  if (!res.ok) {
    // 把 Cloudinary 實際回傳的失敗原因顯示出來（例如檔案格式不允許、
    // 檔案太大等），不要只丟一句籠統的「上傳失敗」——不然使用者跟
    // 開發者都沒辦法知道真正卡在哪裡，很難排查。
    let detail = "";
    try {
      const errData = await res.json();
      detail = errData?.error?.message || "";
    } catch (e) { /* 讀不到細節就算了，至少還有下面的狀態碼 */ }
    throw new Error(`上傳失敗（${res.status}）${detail ? "：" + detail : ""}`);
  }
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

// 拒絕：保留這筆記錄、標記成 rejected，不刪掉——這樣同一個信箱之後自己
// 再申請一次，系統看到記錄已經存在，會直接擋下來，不會又跑出一筆新的待審核。
async function rejectMember(email) {
  await setDoc(doc(db, "members", email), {
    status: "rejected",
    role: null,
    rejectedAt: serverTimestamp(),
    rejectedBy: currentSession.user?.email || null,
  }, { merge: true });
}

// 移除：給「已經是 active 成員」用的，真的整筆刪掉，之後這個人還是可以重新申請
// （移除通常是行政上的異動，不代表永久拒絕這個人）。
async function removeMember(email) {
  await deleteDoc(doc(db, "members", email));
}

// 解除封鎖：把「已拒絕」的記錄整筆刪掉，讓這個人下次登入時可以重新走一次申請流程。
async function unblockRejectedMember(email) {
  await deleteDoc(doc(db, "members", email));
}

async function changeRole(email, role) {
  await setDoc(doc(db, "members", email), {
    role,
    approvedAt: serverTimestamp(),
    approvedBy: currentSession.user?.email || null,
  }, { merge: true });
}

// 成員權限變更是敏感操作，不能點一下下拉選單就直接生效，
// 要先看清楚「從什麼角色改成什麼角色」，輸入「確認」兩個字才會真的執行。
function openRoleChangeReviewModal(email, oldRole, newRole, { onConfirmed, onCancelled }) {
  const overlay = openModal(`
    <h3 style="margin-bottom:4px;">確認變更成員權限</h3>
    <div class="hint" style="margin-bottom:16px;">${email}</div>
    <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:18px;">
      <span class="seal-badge muted"><span class="dot"></span>${ROLE_LABELS[oldRole] || oldRole}</span>
      <span class="hint">→</span>
      <span class="seal-badge warn"><span class="dot"></span>${ROLE_LABELS[newRole] || newRole}</span>
    </div>
    <div class="field"><label>確定要變更的話，請輸入「確認」兩個字</label><input type="text" id="rc-confirm-text" placeholder="確認" /></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-secondary" id="rc-cancel">取消</button>
      <button class="btn btn-primary" id="rc-confirm">確定變更</button>
    </div>
  `, 400);

  let resolved = false;
  overlay.querySelector("#rc-cancel").addEventListener("click", () => {
    resolved = true;
    overlay.remove();
    onCancelled();
  });
  overlay.querySelector("#rc-confirm").addEventListener("click", (e) => {
    const text = overlay.querySelector("#rc-confirm-text").value.trim();
    if (text !== "確認") { showToast("請輸入「確認」兩個字才能執行", "error"); return; }
    resolved = true;
    overlay.remove();
    onConfirmed();
  });
  // 如果直接關掉視窗（點 X），也要當作取消，避免選單卡在新值但沒真的套用
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay) && !resolved) {
      resolved = true;
      onCancelled();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

function roleOptionsHtml(selected) {
  return ASSIGNABLE_ROLES.map((r) =>
    `<option value="${r}" ${r === selected ? "selected" : ""}>${ROLE_LABELS[r]}</option>`
  ).join("");
}

// ---------- Cloudinary ----------
// ---------- 資料備份 ----------
// 把資料庫裡所有集合（訂單、商品、客戶、支出、分類、單位、成員…）整份
// 讀出來，包成一個 JSON 檔案讓瀏覽器下載。這是超級管理員專用的功能，
// 用意是留一份「萬一資料出問題時」可以自己保存的完整快照。
//
// 技術備註：publicProfiles（暱稱資料）這個集合因為 Firestore 規則設計成
// 完全禁止「列出全部」（即使是超級管理員也一樣，是為了防止有心人士掃出
// 全部成員信箱清單），所以沒辦法透過這個備份功能匯出，只有暱稱資料會
// 缺席，其餘商業資料（訂單/商品/客戶/支出等）都完整包含在內。
const BACKUP_COLLECTIONS = [
  "orders", "items", "itemPurchases", "itemUsages", "itemStocktakes",
  "contacts", "categories", "units", "expenses", "activityLog", "members",
];

async function collectAllDataForBackup(onProgress) {
  const result = {};
  for (const name of BACKUP_COLLECTIONS) {
    onProgress && onProgress(name);
    const snap = await getDocs(collection(db, name));
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    result[name] = docs;
  }
  return result;
}

function downloadJsonFile(filename, dataObj) {
  const json = JSON.stringify(dataObj, (key, value) => {
    // Firestore 的 Timestamp 物件轉成人看得懂的日期字串，不然存出來的
    // JSON 會是一堆看不懂的內部欄位
    if (value && typeof value === "object" && typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }
    return value;
  }, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function renderBackupPage(container) {
  container.innerHTML = `
    ${pageNavHtml("資料備份")}
    <div class="card">
      <p style="margin:0 0 14px;color:var(--text-primary);">
        一鍵把訂單、商品、客戶、支出、分類、單位、成員等全部資料下載成一個
        JSON 檔案，存在自己的電腦或雲端硬碟，當作萬一資料出問題時的備份。
      </p>
      <p class="hint" style="margin:0 0 18px;">
        暱稱資料因為系統設計上的限制無法一併匯出，其餘資料都完整包含在內。
        建議定期（例如每個月）備份一次，存在系統以外的地方比較安心。
      </p>
      <button class="btn btn-primary" id="btn-run-backup" style="display:flex;align-items:center;gap:8px;">
        下載完整備份
      </button>
      <div id="backup-progress" class="hint" style="margin-top:12px;"></div>
    </div>
  `;
  wirePageNav(container);

  container.querySelector("#btn-run-backup").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const progressEl = container.querySelector("#backup-progress");
    btn.disabled = true;
    btn.textContent = "備份中…";
    try {
      const data = await collectAllDataForBackup((name) => {
        progressEl.textContent = `正在讀取「${name}」…`;
      });
      const todayStr = new Date().toISOString().slice(0, 10);
      downloadJsonFile(`heartfelt-order-backup-${todayStr}.json`, data);
      progressEl.textContent = "備份完成，檔案已開始下載";
      showToast("備份完成", "success");
    } catch (err) {
      progressEl.textContent = "";
      showToast("備份失敗：" + friendlyErrorMessage(err), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "下載完整備份";
    }
  });
}

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
      showToast("儲存失敗：" + friendlyErrorMessage(err), "error");
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
    <h3 style="font-size:15px;margin:20px 0 10px;color:var(--ink);">已拒絕名單</h3>
    <div class="hint" style="margin-bottom:10px;">這些信箱之前被拒絕過，不會再自己跑出申請。想讓對方能重新申請，點「解除封鎖」。</div>
    <div class="card" style="margin-bottom:10px;">
      <label style="font-size:13px;color:var(--text-muted);margin-bottom:6px;display:block;">手動封鎖信箱（不用等對方申請過，直接輸入信箱就能先擋起來）</label>
      <div style="display:flex;gap:8px;">
        <input type="email" id="manual-block-email" placeholder="example@gmail.com" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <button class="btn btn-danger" id="manual-block-btn" style="padding:9px 16px;">封鎖</button>
      </div>
    </div>
    <div id="rejected-list"></div>
  `;
  wirePageNav(container);
  const listEl = container.querySelector("#pending-list");
  const rejectedEl = container.querySelector("#rejected-list");
  container.querySelector("#manual-block-btn").addEventListener("click", async () => {
    const email = container.querySelector("#manual-block-email").value.trim().toLowerCase();
    if (!email || !email.includes("@")) { showToast("請輸入正確的信箱", "error"); return; }
    if (!await confirmDialog(`封鎖 ${email}？封鎖後這個信箱不會再自己跑出申請。`, { confirmLabel: "封鎖", danger: true })) return;
    try {
      await rejectMember(email);
      showToast("已封鎖", "success");
      container.querySelector("#manual-block-email").value = "";
      refresh();
    } catch (err) {
      showToast("失敗：" + friendlyErrorMessage(err), "error");
    }
  });
  await refresh();

  async function refresh() {
    listEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    rejectedEl.innerHTML = `<div class="card" style="color:var(--text-muted);">載入中…</div>`;
    try {
      const all = await listAllMembers();
      const pending = all.filter((m) => m.status === "pending");
      const rejected = all.filter((m) => m.status === "rejected");
      listEl.innerHTML = pending.length === 0
        ? `<div class="card" style="color:var(--text-muted);text-align:center;">目前沒有待審核申請</div>`
        : pending.map((m) => `
            <div class="card" style="margin-bottom:10px;">
              <div style="font-size:15px;color:var(--ink);word-break:break-all;">${m.email}</div>
              <div class="hint" style="margin-top:2px;">${m.displayName || "（未提供姓名）"}</div>
              <div style="margin-top:10px;">
                <select class="pending-role-select" data-email="${m.email}" style="width:100%;padding:9px 10px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;margin-bottom:8px;">${roleOptionsHtml("order_staff")}</select>
                <div style="display:flex;gap:8px;">
                  <button class="btn btn-primary" data-approve="${m.email}" style="padding:8px 14px;font-size:13px;flex:1;">核准</button>
                  <button class="btn btn-danger" data-reject="${m.email}" style="padding:8px 14px;font-size:13px;flex:1;">拒絕</button>
                </div>
              </div>
            </div>
          `).join("");

      rejectedEl.innerHTML = rejected.length === 0
        ? `<div class="card" style="color:var(--text-muted);text-align:center;">目前沒有被拒絕的名單</div>`
        : rejected.map((m) => `
            <div class="card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div style="min-width:0;">
                <div style="font-size:14px;color:var(--ink);word-break:break-all;">${m.email}</div>
                <div class="hint" style="margin-top:2px;">${m.displayName || "（未提供姓名）"}</div>
              </div>
              <button class="btn btn-secondary" data-unblock="${m.email}" style="padding:7px 12px;font-size:12px;flex-shrink:0;">解除封鎖</button>
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
            showToast("失敗：" + friendlyErrorMessage(err), "error");
          }
        });
      });
      listEl.querySelectorAll("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-reject");
          if (!await confirmDialog(`拒絕 ${email} 的申請？拒絕後這個信箱不會再自己跑出申請，除非你之後手動解除封鎖。`, { confirmLabel: "拒絕", danger: true })) return;
          try {
            await rejectMember(email);
            showToast("已拒絕", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + friendlyErrorMessage(err), "error");
          }
        });
      });
      rejectedEl.querySelectorAll("[data-unblock]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-unblock");
          if (!await confirmDialog(`解除封鎖 ${email}？解除後對方下次登入會重新跑出一筆待審核申請。`, { confirmLabel: "解除封鎖" })) return;
          try {
            await unblockRejectedMember(email);
            showToast("已解除封鎖", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + friendlyErrorMessage(err), "error");
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="card" style="color:var(--rose);">載入失敗</div>`;
      rejectedEl.innerHTML = "";
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
                <div style="font-size:16px;font-weight:700;color:var(--ink);">${m.nickname || "（尚未設定暱稱）"}${isSelf ? ` <span class="hint" style="font-weight:400;">(你)</span>` : ""}</div>
                <div style="font-size:13px;color:var(--text-muted);word-break:break-all;margin-top:2px;">${m.email}</div>
                <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                  ${isTargetSuperadmin
                    ? `<span class="seal-badge warn" style="white-space:nowrap;"><span class="dot"></span>超級管理員</span>`
                    : `<select class="member-role-select" data-email="${m.email}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;">${roleOptionsHtml(m.role)}</select>`
                  }
                  ${isTargetSuperadmin || isSelf ? "" : `<button class="btn btn-danger" data-remove="${m.email}" style="padding:6px 12px;font-size:12px;">移除</button>`}
                </div>
              </div>
            `;
          }).join("");

      listEl.querySelectorAll(".member-role-select").forEach((sel) => {
        const originalValue = sel.value;
        sel.addEventListener("change", () => {
          const email = sel.getAttribute("data-email");
          const newRole = sel.value;
          openRoleChangeReviewModal(email, originalValue, newRole, {
            onConfirmed: async () => {
              try {
                await changeRole(email, newRole);
                showToast("已更新角色", "success");
                refresh();
              } catch (err) {
                showToast("失敗：" + friendlyErrorMessage(err), "error");
                refresh();
              }
            },
            onCancelled: () => {
              sel.value = originalValue; // 取消的話把選單還原，不要看起來像已經改了
            },
          });
        });
      });
      listEl.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const email = btn.getAttribute("data-remove");
          if (!await confirmDialog(`移除 ${email} 的存取權限？移除後這個人還是可以重新申請一次，如果不希望他能再申請，請改用「拒絕」（在待審核申請頁面操作，只是他要先重新申請一次才會出現在那邊）。`, { confirmLabel: "移除", danger: true })) return;
          try {
            await removeMember(email);
            showToast("已移除", "success");
            refresh();
          } catch (err) {
            showToast("失敗：" + friendlyErrorMessage(err), "error");
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
        <input type="text" id="cat-selfmade-input" placeholder="新增分類名稱，例如：月餅" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <button class="btn btn-primary" id="cat-selfmade-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:10px;">現貨商品分類</h3>
      <div id="cat-resale-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-resale-input" placeholder="新增分類名稱" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <button class="btn btn-primary" id="cat-resale-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:10px;">包材分類</h3>
      <div id="cat-packaging-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-packaging-input" placeholder="新增分類名稱，例如：盒子" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <button class="btn btn-primary" id="cat-packaging-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="font-size:15px;margin-bottom:4px;">銷貨成本類別</h3>
      <div class="hint" style="margin-bottom:10px;">跟著訂單/產量變動的成本，例如原料、不追蹤數量的小包材。</div>
      <div id="cat-cogs-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-cogs-input" placeholder="新增類別名稱，例如：原料" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
        <button class="btn btn-primary" id="cat-cogs-add" style="padding:9px 16px;">新增</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:4px;">營業費用類別</h3>
      <div class="hint" style="margin-bottom:10px;">不管有沒有訂單都要付的固定支出，例如電費、房租、設備。</div>
      <div id="cat-opex-list"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="cat-opex-input" placeholder="新增類別名稱，例如：電費" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
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
                <input type="text" class="cat-name-input" data-id="${c.id}" value="${c.name}" style="flex:1;padding:6px 10px;border:1px solid transparent;border-radius:6px;font-size:16px;" />
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
              showToast("失敗：" + friendlyErrorMessage(err), "error");
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
              showToast(friendlyErrorMessage(err), "error");
            }
          });
        });
      } catch (err) {
        listEl.innerHTML = `<div style="color:var(--rose);">載入失敗：${linkifyErrorMessage(friendlyErrorMessage(err))}</div>`;
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
        showToast("失敗：" + friendlyErrorMessage(err), "error");
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
        <input type="text" id="unit-input" placeholder="新增單位，例如：捲、公斤" style="flex:1;padding:9px 12px;border:1px solid var(--paper-line);border-radius:8px;font-size:16px;" />
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
              <input type="text" class="unit-name-input" data-id="${u.id}" value="${u.name}" style="flex:1;padding:6px 10px;border:1px solid transparent;border-radius:6px;font-size:16px;" />
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
            showToast("失敗：" + friendlyErrorMessage(err), "error");
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
            showToast(friendlyErrorMessage(err), "error");
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div style="color:var(--rose);">載入失敗：${linkifyErrorMessage(friendlyErrorMessage(err))}</div>`;
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
      showToast("失敗：" + friendlyErrorMessage(err), "error");
    }
  });

  await refresh();
}
