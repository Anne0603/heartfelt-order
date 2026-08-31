// ============================================================
// 共用的日期區間選擇器：預設當月整月，兩個日期選擇器直接調，
// 選了就立刻套用，不用額外按鈕
// ============================================================
import { localDateStr } from "./utils.js?v=20260829-51";

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function defaultRange() {
  const today = new Date();
  return { start: localDateStr(startOfMonth(today)), end: localDateStr(endOfMonth(today)) };
}

/**
 * 渲染日期區間選擇器到 container，onChange({start,end}) 會在區間變動時呼叫。
 * 回傳 { getRange() } 供外部讀取目前選到的區間。
 */
export function renderDateRangePicker(container, onChange, initialRange = null) {
  let current = initialRange || defaultRange();

  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center;margin-bottom:10px;">
      <input type="date" id="range-start" value="${current.start}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;width:150px;" />
      <span class="hint">～</span>
      <input type="date" id="range-end" value="${current.end}" style="padding:8px 10px;border:1px solid var(--paper-line);border-radius:8px;width:150px;" />
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <button type="button" id="range-whole-year" class="hint" style="background:none;border:none;text-decoration:underline;cursor:pointer;color:var(--gold-deep);">看整年</button>
    </div>
  `;

  function applyFromInputs() {
    current = {
      start: container.querySelector("#range-start").value,
      end: container.querySelector("#range-end").value,
    };
    onChange(current);
  }
  container.querySelector("#range-start").addEventListener("change", applyFromInputs);
  container.querySelector("#range-end").addEventListener("change", applyFromInputs);
  container.querySelector("#range-whole-year").addEventListener("click", () => {
    const baseYear = current.start ? new Date(current.start).getFullYear() : new Date().getFullYear();
    current = { start: `${baseYear}-01-01`, end: `${baseYear}-12-31` };
    container.querySelector("#range-start").value = current.start;
    container.querySelector("#range-end").value = current.end;
    onChange(current);
  });

  return { getRange: () => current };
}
