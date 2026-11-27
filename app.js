const $ = id => document.getElementById(id);
const API = window.APP_CONFIG?.API_URL || "";

let token = "";
let me = null;
let meta = { classes: [], subjects: [], evalConfig: [] };
let students = [];
let assessments = {}; // studentId -> { "1": "HTT", "2": "HT", ... }
let currentSlotCount = 6;

function toast(msg) {
  const e = $("toast");
  e.textContent = msg;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 2500);
}

async function api(action, data = {}) {
  if (!API) throw Error("Chưa cấu hình API_URL");
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, ...data })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw Error(j.error || "Lỗi kết nối");
  return j;
}

// ==================== LOGIN ====================
$("loginForm").onsubmit = async e => {
  e.preventDefault();
  const btn = $("loginForm").querySelector("button");
  $("loginMsg").textContent = "Đang đăng nhập...";
  btn.disabled = true;
  try {
    const r = await api("login", {
      username: $("username").value.trim(),
      password: $("password").value
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("dgt_token", token);
    $("loginMsg").textContent = "Đang tải dữ liệu...";
    await enter();
  } catch (err) {
    $("loginMsg").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
};

async function enter() {
  const loginView = $("loginView");
  if (loginView) {
    loginView.hidden = true;
    loginView.style.display = "none";
  }
  $("appView").hidden = false;
  $("userLabel").textContent = me?.displayName || me?.username || "";

  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = me?.role !== "admin";
  });

  try {
    const r = await api("init");
    meta = r.meta;
    fillSelects();
    showTab("evaluate");
  } catch (e) {
    toast("Lỗi tải dữ liệu: " + e.message);
  }
}

$("logoutBtn").onclick = () => {
  token = "";
  me = null;
  localStorage.removeItem("dgt_token");
  $("appView").hidden = true;
  const lv = $("loginView");
  if (lv) {
    lv.hidden = false;
    lv.style.display = "";
  }
  $("loginMsg").textContent = "";
  $("username").value = "";
  $("password").value = "";
};

// ==================== SELECTS ====================
function fill(id, arr, placeholder) {
  const el = $(id);
  if (!el) return;
  const old = el.value;
  el.innerHTML = "";
  if (placeholder) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = placeholder;
    el.appendChild(o);
  }
  (arr || []).forEach(item => {
    const o = document.createElement("option");
    o.value = item.id;
    o.textContent = item.name;
    el.appendChild(o);
  });
  if (old && [...el.options].some(o => o.value === old)) el.value = old;
}

function fillSelects() {
  fill("subjectSelect", meta.subjects, "— Chọn môn —");
  fill("classSelect", meta.classes, "— Chọn lớp —");
  fill("statsSubject", meta.subjects, "Tất cả môn");
  fill("statsStudentSubject", meta.subjects, "Tất cả môn");
  fill("statsClass", meta.classes, "— Chọn lớp —");
  fill("statsClassFilter", meta.classes, "— Chọn lớp —");
  fill("uploadClass", meta.classes, "— Chọn lớp —");
  fill("manageStudentClass", meta.classes, "— Chọn lớp —");
  fill("clearClass", meta.classes, "Tất cả lớp");
  fill("clearSubject", meta.subjects, "Tất cả môn");
  fill("configSubject", meta.subjects, "— Chọn môn —");

  // print multi-select
  const ps = $("printSubjects");
  if (ps) {
    ps.innerHTML = "";
    (meta.subjects || []).forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      ps.appendChild(o);
    });
  }

  // restore last choices
  const sem = localStorage.getItem("dgt_semester");
  if (sem) $("semesterSelect").value = sem;
  const sub = localStorage.getItem("dgt_subject");
  if (sub && [...$("subjectSelect").options].some(o => o.value === sub)) $("subjectSelect").value = sub;
  const cls = localStorage.getItem("dgt_class");
  if (cls && [...$("classSelect").options].some(o => o.value === cls)) $("classSelect").value = cls;
  renderEvalTable();
}

// ==================== TABS ====================
document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => showTab(btn.dataset.tab);
});

function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== name);
  if (name === "manage") refreshManageLists();
  if (name === "config") loadConfigSlots();
}

// ==================== EVALUATE ====================
["semesterSelect", "subjectSelect", "classSelect"].forEach(id => {
  const el = $(id);
  if (el) {
    el.onchange = () => {
      if ($("semesterSelect")) localStorage.setItem("dgt_semester", $("semesterSelect").value);
      if ($("subjectSelect")) localStorage.setItem("dgt_subject", $("subjectSelect").value);
      if ($("classSelect")) localStorage.setItem("dgt_class", $("classSelect").value);
      renderEvalTable();
    };
  }
});

if ($("studentSearch")) {
  $("studentSearch").oninput = () => renderEvalBody();
}

async function renderEvalTable() {
  currentSlotCount = 6; // luôn 6 lần như mẫu ảnh
  const semester = $("semesterSelect").value;
  const subjectId = $("subjectSelect").value;
  const classId = $("classSelect").value;

  const head = $("evalHead");
  const body = $("evalBody");

  if (!semester || !subjectId || !classId) {
    head.innerHTML = "";
    body.innerHTML = `<tr><td colspan="20" class="empty">Chọn Học kỳ – Môn – Lớp để bắt đầu đánh giá</td></tr>`;
    $("evalInfo").textContent = "";
    return;
  }

  // Header: STT | Học sinh (sticky) | HTT 1-6 | HT 1-6
  let h = `<tr>
    <th rowspan="2" class="col-stt">STT</th>
    <th rowspan="2" class="col-name">Học sinh</th>
    <th colspan="${currentSlotCount}" class="htt-header">Đánh giá HTT</th>
    <th colspan="${currentSlotCount}" class="ht-header">Đánh giá HT</th>
  </tr>
  <tr>`;
  for (let i = 1; i <= currentSlotCount; i++) h += `<th class="slot-h htt-slot">${i}</th>`;
  for (let i = 1; i <= currentSlotCount; i++) h += `<th class="slot-h ht-slot">${i}</th>`;
  h += `</tr>`;
  head.innerHTML = h;

  body.innerHTML = `<tr><td colspan="${2 + currentSlotCount * 2}" class="empty">Đang tải...</td></tr>`;

  try {
    const [stRes, asRes] = await Promise.all([
      api("students", { classId }),
      api("getAssessments", { classId, subjectId, semester })
    ]);
    students = (stRes.students || []).sort((a, b) => (a.name || "").localeCompare(b.name || "", "vi"));
    assessments = asRes.assessments || {};
    const subName = (meta.subjects.find(s => s.id === subjectId) || {}).name || "";
    $("evalInfo").textContent = `${students.length} HS · ${subName} · Học kỳ ${semester}`;
    renderEvalBody();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="20" class="empty">${e.message}</td></tr>`;
  }
}

function renderEvalBody() {
  const body = $("evalBody");
  const q = ($("studentSearch").value || "").trim().toLowerCase();
  const list = q
    ? students.filter(s =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q)
      )
    : students;

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${2 + currentSlotCount * 2}" class="empty">Không tìm thấy học sinh</td></tr>`;
    return;
  }

  body.innerHTML = "";
  list.forEach((s, idx) => {
    const tr = document.createElement("tr");
    const as = assessments[s.id] || {};

    // STT + tên sticky (không hiện mã HS)
    let html = `<td class="col-stt center">${idx + 1}</td>
      <td class="col-name"><strong>${escapeHtml(s.name)}</strong></td>`;

    // HTT stars — ẩn nếu đã chọn HT cùng lần
    for (let slot = 1; slot <= currentSlotCount; slot++) {
      const val = as[String(slot)];
      if (val === "HT") {
        html += `<td class="star-cell muted-cell">—</td>`;
      } else {
        const active = val === "HTT";
        html += `<td class="star-cell">
          <button type="button" class="star-btn htt ${active ? "on" : ""}" data-sid="${s.id}" data-slot="${slot}" data-type="HTT" title="Hoàn thành tốt - Lần ${slot}">
            ${active ? "★" : "☆"}
          </button>
        </td>`;
      }
    }

    // HT stars — ẩn nếu đã chọn HTT cùng lần
    for (let slot = 1; slot <= currentSlotCount; slot++) {
      const val = as[String(slot)];
      if (val === "HTT") {
        html += `<td class="star-cell muted-cell">—</td>`;
      } else {
        const active = val === "HT";
        html += `<td class="star-cell">
          <button type="button" class="star-btn ht ${active ? "on" : ""}" data-sid="${s.id}" data-slot="${slot}" data-type="HT" title="Hoàn thành - Lần ${slot}">
            ${active ? "★" : "☆"}
          </button>
        </td>`;
      }
    }

    tr.innerHTML = html;
    body.appendChild(tr);
  });

  // bind clicks
  body.querySelectorAll(".star-btn").forEach(btn => {
    btn.onclick = () => toggleStar(btn);
  });
}

async function toggleStar(btn) {
  const studentId = btn.dataset.sid;
  const slot = Number(btn.dataset.slot);
  const type = btn.dataset.type;
  const semester = $("semesterSelect")?.value;
  const subjectId = $("subjectSelect")?.value;
  const classId = $("classSelect")?.value;

  if (!studentId || !semester || !subjectId || !classId || !slot) {
    toast("Thiếu thông tin đánh giá");
    return;
  }

  const current = (assessments[studentId] || {})[String(slot)];
  // Bấm lại sao đang chọn → xóa; bấm loại khác → đổi sang loại đó
  const newType = current === type ? "" : type;

  btn.disabled = true;
  try {
    await api("saveAssessment", {
      studentId,
      classId,
      subjectId,
      semester,
      slot,
      type: newType || "CLEAR"
    });

    // Cập nhật local ngay
    if (!assessments[studentId]) assessments[studentId] = {};
    if (newType) {
      assessments[studentId][String(slot)] = newType;
    } else {
      delete assessments[studentId][String(slot)];
    }

    // Bên còn lại tự mất màu (render lại → hiện —)
    renderEvalBody();
    if ($("saveStatus")) {
      $("saveStatus").textContent = newType
        ? `Đã lưu: ${type === "HTT" ? "Hoàn thành tốt" : "Hoàn thành"} · Lần ${slot}`
        : `Đã xóa đánh giá lần ${slot}`;
      setTimeout(() => { if ($("saveStatus")) $("saveStatus").textContent = ""; }, 2000);
    }
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ==================== PRINT ====================
if ($("printBtn")) $("printBtn").onclick = async () => {
  const classId = $("classSelect").value;
  const semester = $("semesterSelect").value;
  const ps = $("printSubjects");
  const subjectIds = [...ps.selectedOptions].map(o => o.value);

  if (!classId) {
    toast("Vui lòng chọn lớp trước");
    return;
  }
  if (!subjectIds.length) {
    // nếu không chọn môn in thì dùng môn đang đánh giá
    const cur = $("subjectSelect").value;
    if (cur) subjectIds.push(cur);
    else {
      toast("Chọn ít nhất 1 môn để in");
      return;
    }
  }

  try {
    $("printBtn").disabled = true;
    $("printBtn").textContent = "Đang tải...";
    const data = await api("printData", { classId, subjectIds, semester });
    openPrintWindow(data);
  } catch (e) {
    toast(e.message);
  } finally {
    $("printBtn").disabled = false;
    $("printBtn").textContent = "🖨 In biểu mẫu";
  }
};

function openPrintWindow(data) {
  const { className, semester, students, subjects, configs, assessments } = data;
  const slotCount = 6;
  const yearLabel = "NĂM HỌC 2026 - 2027";
  const hkLabel = semester ? `Học kỳ ${semester}` : "Cả năm";

  // Max stars = subjects * 6 * 2 (HTT + HT) but we count only filled stars
  // In sample: "SỐ SAO đạt / tối đa" e.g. 8/36 — 36 = 3 subjects * 12
  const maxStars = (subjects.length || 1) * slotCount * 2;

  let html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<title>Bảng tổng hợp đánh giá – ${escapeHtml(className)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11px; margin: 12px; color: #000; }
  h1 { text-align: center; font-size: 16px; margin: 4px 0; text-transform: uppercase; }
  h2 { text-align: center; font-size: 13px; margin: 2px 0 10px; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #222; padding: 3px 2px; text-align: center; vertical-align: middle; }
  th { background: #f5f5f5; font-size: 10px; }
  .name { text-align: left; padding-left: 6px; white-space: nowrap; min-width: 120px; }
  .sub-htt { background: #fff8e1; }
  .sub-ht { background: #e8f5e9; }
  .c0-htt { background: #fff3cd; } /* vàng nhạt - HTT */
  .c0-ht  { background: #ffeeba; }
  .c1-htt { background: #d4edda; } /* xanh lá - HTT */
  .c1-ht  { background: #c3e6cb; }
  .c2-htt { background: #d1ecf1; } /* xanh dương - HTT */
  .c2-ht  { background: #bee5eb; }
  .c3-htt { background: #f8d7da; }
  .c3-ht  { background: #f5c6cb; }
  .star { font-size: 13px; color: #000; }
  .num { font-weight: 600; white-space: nowrap; }
  .footer { margin-top: 18px; display: flex; justify-content: space-between; font-size: 11px; }
  .sign { text-align: center; min-width: 160px; }
  .note { font-size: 10px; margin-top: 8px; color: #333; }
  @media print {
    .no-print { display: none !important; }
    body { margin: 6mm; }
  }
</style></head><body>
<div class="no-print" style="margin-bottom:10px">
  <button onclick="window.print()" style="padding:8px 16px;cursor:pointer">In ngay</button>
  <button onclick="window.close()" style="padding:8px 16px;cursor:pointer;margin-left:8px">Đóng</button>
</div>
<h1>BẢNG TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ GIÁO DỤC</h1>
<h2>${yearLabel}<br>Lớp: ${escapeHtml(className)}${semester ? " · " + hkLabel : ""}</h2>
<table>
<thead>
<tr>
  <th rowspan="3">STT</th>
  <th rowspan="3" class="name">HỌ VÀ TÊN HỌC SINH</th>
  <th rowspan="3">SỐ SAO<br>đạt / tối đa</th>`;

  // Subject group headers — màu theo từng môn (giống mẫu)
  subjects.forEach((sub, si) => {
    const c = si % 4;
    html += `<th colspan="12" class="c${c}-htt">${escapeHtml(sub.name)}</th>`;
  });
  html += `</tr><tr>`;
  subjects.forEach((sub, si) => {
    const c = si % 4;
    html += `<th colspan="6" class="c${c}-htt">Đánh giá HTT</th>`;
    html += `<th colspan="6" class="c${c}-ht">Đánh giá HT</th>`;
  });
  html += `</tr><tr>`;
  subjects.forEach((sub, si) => {
    const c = si % 4;
    for (let i = 1; i <= 6; i++) html += `<th class="c${c}-htt">${i}</th>`;
    for (let i = 1; i <= 6; i++) html += `<th class="c${c}-ht">${i}</th>`;
  });
  html += `</tr></thead><tbody>`;

  students.forEach((s, idx) => {
    let starCount = 0;
    let cells = "";
    subjects.forEach((sub, si) => {
      const c = si % 4;
      // HTT 1-6
      for (let slot = 1; slot <= 6; slot++) {
        const key = `${s.id}_${sub.id}_${slot}`;
        const t = assessments[key] || "";
        if (t === "HTT") {
          cells += `<td class="c${c}-htt"><span class="star">★</span></td>`;
          starCount++;
        } else {
          cells += `<td class="c${c}-htt"></td>`;
        }
      }
      // HT 1-6
      for (let slot = 1; slot <= 6; slot++) {
        const key = `${s.id}_${sub.id}_${slot}`;
        const t = assessments[key] || "";
        if (t === "HT") {
          cells += `<td class="c${c}-ht"><span class="star">★</span></td>`;
          starCount++;
        } else {
          cells += `<td class="c${c}-ht"></td>`;
        }
      }
    });
    html += `<tr>
      <td>${idx + 1}</td>
      <td class="name">${escapeHtml(s.name)}</td>
      <td class="num">${starCount}/${maxStars}</td>
      ${cells}
    </tr>`;
  });

  const subNames = subjects.map(s => s.name).join(", ");
  html += `</tbody></table>
<p class="note">Ký hiệu: ★ = đã đánh giá mức tương ứng. Môn in: ${escapeHtml(subNames)}. Bảng được in theo lớp đang chọn.</p>
<div class="footer">
  <div></div>
  <div class="sign">
    <div>GIÁO VIÊN</div>
    <div style="margin-top:48px">...............................</div>
  </div>
</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    toast("Trình duyệt chặn popup — hãy cho phép popup để in");
    return;
  }
  w.document.write(html);
  w.document.close();
}

// ==================== STATS ====================
if ($("loadClassRank")) $("loadClassRank").onclick = async () => {
  const classId = $("statsClassFilter")?.value || "";
  if (!classId) {
    toast("Vui lòng chọn lớp để xem top học sinh");
    return;
  }
  try {
    // Dùng mode student để lấy danh sách HS trong lớp + số sao
    const r = await api("stats", {
      mode: "student",
      classId,
      semester: $("statsSemester")?.value || "",
      subjectId: $("statsSubject")?.value || "",
      name: ""
    });

    const list = (r.list || []).slice().sort((a, b) => {
      // Ưu tiên nhiều HTT, rồi tổng sao
      const ag = a.good ?? a.summary?.good ?? 0;
      const bg = b.good ?? b.summary?.good ?? 0;
      const at = a.total ?? a.summary?.total ?? 0;
      const bt = b.total ?? b.summary?.total ?? 0;
      return bg - ag || bt - at;
    });

    const totalGood = list.reduce((s, x) => s + (x.good ?? x.summary?.good ?? 0), 0);
    const totalHt = list.reduce((s, x) => s + (x.complete ?? x.summary?.complete ?? 0), 0);
    const totalAll = list.reduce((s, x) => s + (x.total ?? x.summary?.total ?? 0), 0);

    const sum = $("classRankSummary");
    if (sum) {
      sum.innerHTML = "";
      [["HTT", totalGood], ["HT", totalHt], ["Tổng sao", totalAll], ["Số HS", list.length]].forEach(([label, val]) => {
        const d = document.createElement("div");
        d.className = "stat-card";
        d.innerHTML = `<b>${val}</b><span>${label}</span>`;
        sum.appendChild(d);
      });
    }

    // Chuẩn hoá list từ student-list hoặc student-detail
    let normalized = list.map(item => {
      const st = item.student || item;
      const good = item.good ?? item.summary?.good ?? 0;
      const complete = item.complete ?? item.summary?.complete ?? 0;
      const total = item.total ?? item.summary?.total ?? 0;
      return {
        name: st.name || item.name || "",
        good, complete, total,
        rate: total ? Math.round((good / total) * 1000) / 10 : 0
      };
    }).filter(x => x.name);

    normalized.sort((a, b) => b.good - a.good || b.total - a.total);

    const body = $("rankBody");
    body.innerHTML = "";
    if (!normalized.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty">Chưa có học sinh / chưa có dữ liệu đánh giá trong lớp này</td></tr>`;
      return;
    }
    normalized.forEach((item, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.good}</td>
        <td>${item.complete}</td>
        <td>${item.total}</td>
        <td>${item.rate}%</td>`;
      body.appendChild(tr);
    });
  } catch (e) {
    toast(e.message);
  }
};

if ($("loadStudentStats")) $("loadStudentStats").onclick = async () => {
  const classId = $("statsClass")?.value;
  if (!classId) {
    toast("Chọn lớp trước");
    return;
  }
  try {
    const r = await api("stats", {
      mode: "student",
      classId,
      semester: $("statsStudentSemester")?.value || "",
      subjectId: $("statsStudentSubject")?.value || "",
      name: ($("statsStudentName")?.value || "").trim()
    });

    $("studentListBox").style.display = "none";
    $("studentStatsInfo").style.display = "none";

    if (r.mode === "student-list") {
      $("studentListBox").style.display = "block";
      const tbody = $("statsStudentList");
      tbody.innerHTML = "";
      (r.list || []).forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(item.student.name)}</td>
          <td>${item.good}</td>
          <td>${item.complete}</td>
          <td>${item.total}</td>
          <td>${item.goodRate}%</td>`;
        tbody.appendChild(tr);
      });
      if (!(r.list || []).length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty">Không tìm thấy học sinh</td></tr>`;
      }
    } else if (r.mode === "student-detail") {
      $("studentStatsInfo").style.display = "block";
      const item = (r.list || [])[0];
      if (!item) return;
      $("statsStudentNameTitle").textContent = `${item.student.name} (${item.student.code || ""})`;

      const sum = $("statsSummary");
      sum.innerHTML = "";
      [["HTT", item.summary.good], ["HT", item.summary.complete], ["Tổng", item.summary.total]].forEach(([label, val]) => {
        const d = document.createElement("div");
        d.className = "stat-card";
        d.innerHTML = `<b>${val}</b><span>${label}</span>`;
        sum.appendChild(d);
      });

      const body = $("statsDetailBody");
      body.innerHTML = "";
      const subMap = {};
      (meta.subjects || []).forEach(s => subMap[s.id] = s.name);

      (item.detail || []).sort((a, b) => a.semester - b.semester || a.slot - b.slot).forEach(d => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>HK${d.semester}</td>
          <td>Lần ${d.slot}</td>
          <td>${escapeHtml(subMap[d.subjectId] || d.subjectId)}</td>
          <td>${d.type === "HTT" ? "★ Hoàn thành tốt" : "☆ Hoàn thành"}</td>
          <td>${d.updatedAt ? new Date(d.updatedAt).toLocaleString("vi") : ""}</td>`;
        body.appendChild(tr);
      });
      if (!(item.detail || []).length) {
        body.innerHTML = `<tr><td colspan="5" class="empty">Chưa có dữ liệu đánh giá</td></tr>`;
      }
    }
  } catch (e) {
    toast(e.message);
  }
};

// ==================== CONFIG NỘI DUNG ĐÁNH GIÁ ====================
function loadConfigSlots() {
  const subjectId = $("configSubject").value;
  const box = $("configSlots");
  if (!subjectId) {
    box.innerHTML = `<p class="hint">Chọn môn học để cấu hình</p>`;
    return;
  }

  // Lấy config hiện có từ meta
  const existing = (meta.evalConfig || []).filter(c => c.subjectId === subjectId);
  const map = {};
  existing.forEach(c => map[c.slot] = c.content);

  let html = `<div class="config-grid">`;
  for (let i = 1; i <= 6; i++) {
    html += `
      <label>Lần ${i}
        <input type="text" data-slot="${i}" value="${escapeHtml(map[i] || "")}" placeholder="Ví dụ: Kiểm tra miệng / Bài tập...">
      </label>`;
  }
  html += `</div>`;
  box.innerHTML = html;
}

if ($("loadConfigBtn")) $("loadConfigBtn").onclick = () => loadConfigSlots();
if ($("configSubject")) $("configSubject").onchange = () => loadConfigSlots();
if ($("saveConfigBtn")) $("saveConfigBtn").onclick = async () => {
  const subjectId = $("configSubject").value;
  if (!subjectId) {
    toast("Chọn môn học trước");
    return;
  }
  const slots = [];
  $("configSlots").querySelectorAll("input[data-slot]").forEach(inp => {
    slots.push({ slot: Number(inp.dataset.slot), content: inp.value.trim() });
  });
  try {
    await api("saveEvalConfig", { subjectId, slots });
    // refresh meta
    const r = await api("init");
    meta = r.meta;
    $("configMsg").textContent = "Đã lưu cấu hình nội dung đánh giá.";
    $("configMsg").style.color = "#15803d";
    setTimeout(() => ($("configMsg").textContent = ""), 2500);
  } catch (e) {
    $("configMsg").textContent = e.message;
    $("configMsg").style.color = "#b91c1c";
  }
};

// ==================== MANAGE ====================
function refreshManageLists() {
  // classes
  const cl = $("classList");
  cl.innerHTML = "";
  (meta.classes || []).forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(c.name)}</td>
      <td><button class="ghost danger-btn" data-id="${c.id}" data-type="class">Xóa</button></td>`;
    cl.appendChild(tr);
  });
  cl.querySelectorAll("button").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Xóa lớp này?")) return;
      try {
        await api("deleteClass", { id: btn.dataset.id });
        const r = await api("init");
        meta = r.meta;
        fillSelects();
        refreshManageLists();
        toast("Đã xóa lớp");
      } catch (e) { toast(e.message); }
    };
  });

  // subjects
  const sl = $("subjectList");
  sl.innerHTML = "";
  (meta.subjects || []).forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(s.name)}</td>
      <td><button class="ghost danger-btn" data-id="${s.id}" data-type="subject">Xóa</button></td>`;
    sl.appendChild(tr);
  });
  sl.querySelectorAll("button").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Xóa môn này?")) return;
      try {
        await api("deleteSubject", { id: btn.dataset.id });
        const r = await api("init");
        meta = r.meta;
        fillSelects();
        refreshManageLists();
        toast("Đã xóa môn");
      } catch (e) { toast(e.message); }
    };
  });

  // students of selected class
  loadManageStudents();
}

if ($("manageStudentClass")) $("manageStudentClass").onchange = () => loadManageStudents();

async function loadManageStudents() {
  const classId = $("manageStudentClass").value;
  const tbody = $("studentManageList");
  if (!classId) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">Chọn lớp</td></tr>`;
    return;
  }
  try {
    const r = await api("students", { classId });
    tbody.innerHTML = "";
    (r.students || []).forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.code || "")}</td>
        <td><button class="ghost danger-btn" data-id="${s.id}">Xóa</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("button").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("Xóa học sinh này?")) return;
        try {
          await api("deleteStudent", { id: btn.dataset.id });
          loadManageStudents();
          toast("Đã xóa học sinh");
        } catch (e) { toast(e.message); }
      };
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">${e.message}</td></tr>`;
  }
}

if ($("classForm")) $("classForm").onsubmit = async e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  try {
    await api("addClass", { name });
    e.target.reset();
    const r = await api("init");
    meta = r.meta;
    fillSelects();
    refreshManageLists();
    toast("Đã thêm lớp");
  } catch (err) { toast(err.message); }
};

if ($("subjectForm")) $("subjectForm").onsubmit = async e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  try {
    await api("addSubject", { name });
    e.target.reset();
    const r = await api("init");
    meta = r.meta;
    fillSelects();
    refreshManageLists();
    toast("Đã thêm môn");
  } catch (err) { toast(err.message); }
};

if ($("uploadForm")) $("uploadForm").onsubmit = async e => {
  e.preventDefault();
  const classId = $("uploadClass")?.value;
  const file = $("studentFile")?.files?.[0];
  if (!file) return;
  try {
    const list = await parseStudentFile(file);
    const r = await api("importStudents", { classId, students: list });
    toast(`Đã nạp ${r.count} học sinh`);
    e.target.reset();
    loadManageStudents();
  } catch (err) {
    toast(err.message);
  }
};

async function parseStudentFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const list = [];
  rows.forEach((row, i) => {
    if (i === 0) return; // skip header
    const name = String(row[1] || row[0] || "").trim();
    const code = String(row[2] || row[0] || "").trim();
    if (name && name.length > 1) list.push({ name, code });
  });
  return list;
}

if ($("clearAssessmentsBtn")) $("clearAssessmentsBtn").onclick = async () => {
  if (!confirm("Bạn chắc chắn muốn xóa dữ liệu đánh giá? Hành động không thể hoàn tác.")) return;
  try {
    const r = await api("clearAssessments", {
      classId: $("clearClass").value,
      semester: $("clearSemester").value,
      subjectId: $("clearSubject").value
    });
    toast(`Đã xóa ${r.deleted} bản ghi`);
  } catch (e) {
    toast(e.message);
  }
};

// ==================== UTILS ====================
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Auto login
(async () => {
  const saved = localStorage.getItem("dgt_token");
  if (saved) {
    token = saved;
    try {
      const r = await api("me");
      me = r.user;
      await enter();
    } catch {
      localStorage.removeItem("dgt_token");
      token = "";
    }
  }
})();
