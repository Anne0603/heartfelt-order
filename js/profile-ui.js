// ============================================================
// 個人資料彈跳視窗：設定暱稱、查看綁定帳號與角色、
// （管理員以上）更換品牌圖案
// ============================================================
import { currentSession, ROLE_LABELS, updateMyNickname } from "./auth.js?v=20260830-61";
import { showToast, friendlyErrorMessage } from "./utils.js?v=20260830-61";
import { openModal } from "./modal-ui.js?v=20260830-61";
import { uploadImageToCloudinary, saveBrandLogoUrl } from "./settings.js?v=20260830-61";
import { logActivity } from "./activity-log.js?v=20260830-61";

export function openProfileModal({ brandLogoUrl, onBrandUpdated }) {
  const user = currentSession.user;
  const member = currentSession.member;
  const canEditBrand = ["superadmin", "admin"].includes(member?.role);

  const overlay = openModal(`
    <h3 style="margin-bottom:16px;">個人資料</h3>

    ${canEditBrand ? `
      <div style="text-align:center;margin-bottom:18px;">
        <div id="pf-photo-box" style="width:88px;height:88px;border-radius:50%;border:1.5px dashed var(--paper-line);background:#fff;margin:0 auto;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;">
          ${brandLogoUrl ? `<img src="${brandLogoUrl}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-family:var(--font-display);font-weight:900;font-size:26px;">心</span>`}
        </div>
        <div class="hint" style="margin-top:6px;">點擊更換品牌圖案（全系統共用）</div>
        <input type="file" accept="image/*" id="pf-photo-input" style="display:none;" />
      </div>
    ` : ""}

    <div class="field"><label>暱稱</label><input type="text" id="pf-nickname" value="${member?.nickname || ""}" placeholder="${user?.displayName || ""}" /></div>
    <div class="field"><label>綁定的 Google 帳號</label><div class="hint" style="font-size:14px;color:var(--text-primary);">${user?.email || ""}</div></div>
    <div class="field"><label>目前角色</label><div class="hint" style="font-size:14px;color:var(--text-primary);">${ROLE_LABELS[member?.role] || member?.role || ""}</div></div>

    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary" id="pf-save">儲存</button>
    </div>
  `, 420);

  if (canEditBrand) {
    const photoBox = overlay.querySelector("#pf-photo-box");
    const photoInput = overlay.querySelector("#pf-photo-input");
    photoBox.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      photoBox.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">上傳中…</div>`;
      try {
        const url = await uploadImageToCloudinary(file);
        await saveBrandLogoUrl(url);
        photoBox.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
        showToast("品牌圖案已更新", "success");
        logActivity({ module: "profile", action: "update", summary: "更換了品牌圖案" });
        onBrandUpdated && onBrandUpdated(url);
      } catch (err) {
        showToast("上傳失敗：" + friendlyErrorMessage(err), "error");
        photoBox.innerHTML = `<span style="font-family:var(--font-display);font-weight:900;font-size:26px;">心</span>`;
      }
    });
  }

  overlay.querySelector("#pf-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const nickname = overlay.querySelector("#pf-nickname").value.trim();
    btn.disabled = true;
    try {
      const oldNickname = member?.nickname || "";
      await updateMyNickname(nickname);
      if (nickname !== oldNickname) {
        logActivity({ module: "profile", action: "update", summary: oldNickname ? `暱稱從「${oldNickname}」改成「${nickname}」` : `設定暱稱為「${nickname}」` });
      }
      showToast("已儲存", "success");
      overlay.remove();
      window.location.reload(); // 簡單作法：重整讓全站的姓名顯示同步更新
    } catch (err) {
      showToast("失敗：" + friendlyErrorMessage(err), "error");
      btn.disabled = false;
    }
  });
}
