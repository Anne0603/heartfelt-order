// ============================================================
// 個人資料彈跳視窗：設定暱稱、查看綁定帳號與角色、
// （管理員以上）更換品牌圖案
// ============================================================
import { currentSession, ROLE_LABELS, updateMyNickname, markHomeScreenTipSeen } from "./auth.js?v=20260830-94";
import { showToast, friendlyErrorMessage } from "./utils.js?v=20260830-94";
import { openModal } from "./modal-ui.js?v=20260830-94";
import { uploadImageToCloudinary, saveBrandLogoUrl } from "./settings.js?v=20260830-94";
import { logActivity } from "./activity-log.js?v=20260830-94";

export function openProfileModal({ brandLogoUrl, onBrandUpdated, mandatory = false, showHomeScreenTip = false }) {
  const user = currentSession.user;
  const member = currentSession.member;
  const canEditBrand = ["superadmin", "admin"].includes(member?.role);

  const overlay = openModal(`
    <h3 style="margin-bottom:16px;">個人資料</h3>

    ${mandatory ? `
      <div class="card" style="background:var(--gold-pale);border-color:var(--gold-deep);margin-bottom:16px;">
        <div style="font-weight:700;color:var(--gold-deep);">還沒有設定暱稱</div>
      </div>
    ` : ""}

    ${showHomeScreenTip ? `
      <div class="card" style="margin-bottom:16px;">
        <div style="font-weight:700;color:var(--ink);margin-bottom:8px;">📱 小提醒：可以把系統加到手機主畫面</div>
        <div style="font-size:14px;color:var(--text-primary);line-height:1.8;">
          加到主畫面之後，打開會像一個獨立的 App，沒有網址列，更方便日常使用：
          <div style="margin-top:8px;padding-left:4px;">
            <b>iPhone（Safari）：</b><br>
            1. 點下方工具列的「分享」按鈕（方框加箭頭圖示）<br>
            2. 往下滑，點「加入主畫面」<br>
            3. 右上角點「新增」
          </div>
          <div style="margin-top:8px;padding-left:4px;">
            <b>Android（Chrome）：</b><br>
            點右上角選單（⋮）→「加到主畫面」或「安裝應用程式」
          </div>
        </div>
      </div>
    ` : ""}

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

  // 只要看過這個彈窗（不管是按儲存還是直接關掉），就標記已經看過主畫面
  // 教學，之後不會再自動跳出來。跟 modal-ui.js 本身的關閉按鈕事件
  // 疊加在一起，不衝突。
  if (showHomeScreenTip) {
    overlay.querySelector("#modal-close-x")?.addEventListener("click", () => markHomeScreenTipSeen());
  }

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
    if (mandatory && !nickname) {
      showToast("請輸入暱稱後再儲存", "error");
      return;
    }
    btn.disabled = true;
    try {
      const oldNickname = member?.nickname || "";
      await updateMyNickname(nickname);
      if (nickname !== oldNickname) {
        logActivity({ module: "profile", action: "update", summary: oldNickname ? `暱稱從「${oldNickname}」改成「${nickname}」` : `設定暱稱為「${nickname}」` });
      }
      if (showHomeScreenTip) await markHomeScreenTipSeen();
      showToast("已儲存", "success");
      overlay.remove();
      window.location.reload(); // 簡單作法：重整讓全站的姓名顯示同步更新
    } catch (err) {
      showToast("失敗：" + friendlyErrorMessage(err), "error");
      btn.disabled = false;
    }
  });
}
