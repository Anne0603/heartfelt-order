// ============================================================
// 共用的日期區間選擇器（本週／本月／自訂）
// ============================================================
import { localDateStr } from "./utils.js";

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // 週一為第一天
  date.setDate(date.getDate() - diff);
  return date;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function presetRange(preset) {
  const today = new Date();
  if (preset === "week") {
    const start = startOfWeek(today);
    return { start: localDateStr(start), end: localDateStr(today) };
  }
  if (preset === "month") {
    return { start: localDateStr(startOfMonth(today)), end: localDateStr(endOfMonth(today)) };
  }
  return { start: localDateStr(today), end: localDateStr(today) };
}

/**
 * 渲染日期區間選擇器到 container，onChange({start,end}) 會在區間變動時呼叫。
 * 回傳 { getRange() } 供外部讀取目前選到的區間。
 */
export function renderDateRangePicker(container, onChange) {
  let current = presetRange("month");

  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      <button class="btn btn-secondary" data-preset="week" style="padding:8px 14px;font-size:13px;">本週</button>
      <button class="btn btn-secondary" data-preset="month" style="padding:8px 14px;font-size:13px;">本月</button>
      <input type="text" id="range-start" value="${current.start}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;width:130px;" />
      <span class="hint">～</span>
      <input type="text" id="range-end" value="${current.end}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;width:130px;" />
      <button class="btn btn-primary" id="range-apply" style="padding:8px 14px;font-size:13px;">套用</button>
    </div>
  `;

  container.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      current = presetRange(btn.getAttribute("data-preset"));
      container.querySelector("#range-start").value = current.start;
      container.querySelector("#range-end").value = current.end;
      onChange(current);
    });
  });
  container.querySelector("#range-apply").addEventListener("click", () => {
    current = {
      start: container.querySelector("#range-start").value,
      end: container.querySelector("#range-end").value,
    };
    onChange(current);
  });

  return { getRange: () => current };
}
