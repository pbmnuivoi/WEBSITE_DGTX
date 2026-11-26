const $ = id => document.getElementById(id);
const API = window.APP_CONFIG?.API_URL || "";

let token = "";
let me = null;
let meta = { classes: [], subjects: [], weeks: [] };
let students = [];
let assessments = {};

const rating = [
  { v: "TOT", i: "★", t: "Tốt" },
  { v: "HT",  i: "✿", t: "Hoàn thành" },
  { v: "CĐ",  i: "ϟ", t: "Cần cố gắng" }
];

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
    el.append(o);
  }
  (arr || []).forEach(x => {
    const o = document.createElement("option");
    o.value = x.id;
    o.textContent = x.name;
    el.append(o);
  });
  if ([...el.options].some(o => o.value === old)) el.value = old;
}

function fillSelects() {
  fill("weekSelect", meta.weeks);
  fill("subjectSelect", meta.subjects, "Chọn môn");
  fill("classSelect", meta.classes, "Chọn lớp");

  fill("statsWeek", meta.weeks, "Tất cả tuần");
  fill("statsSubject", meta.subjects, "Tất cả môn");
  fill("statsClassFilter", meta.classes, "Tất cả lớp");

  fill("statsClass", meta.classes, "Chọn lớp");
  fill("statsStudentSubject", meta.subjects, "Tất cả môn");

  fill("uploadClass", meta.classes, "Chọn lớp");
  fill("manageStudentClass", meta.classes, "Chọn lớp");
  fill("clearClass", meta.classes, "Tất cả lớp");
  fill("clearSubject", meta.subjects, "Tất cả môn");

  // Khôi phục lựa chọn tuần/môn đã lưu
  const w = localStorage.getItem("dgt_week");
  const s = localStorage.getItem("dgt_subject");
  if (w && [...$("weekSelect").options].some(o => o.value === w)) $("weekSelect").value = w;
  if (s && [...$("subjectSelect").options].some(o => o.value === s)) $("subjectSelect").value = s;
}

// ==================== TABS ====================
function showTab(id) {
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== id);
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  if (id === "evaluate") loadStudents();
  if (id === "manage") {
    renderManageTables();
    loadStudentManageList();
  }
}
document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => showTab(btn.dataset.tab);
});

// ==================== ĐÁNH GIÁ (nhanh – theo 1 tuần) ====================
if ($("weekSelect")) {
  $("weekSelect").onchange = () => {
    localStorage.setItem("dgt_week", $("weekSelect").value);
    loadStudents();
  };
}
if ($("subjectSelect")) {
  $("subjectSelect").onchange = () => {
    localStorage.setItem("dgt_subject", $("subjectSelect").value);
    loadStudents();
  };
}
if ($("classSelect")) $("classSelect").onchange = loadStudents;
if ($("studentSearch")) $("studentSearch").oninput = renderStudents;

async function loadStudents() {
  const classId = $("classSelect").value;
  const weekId = $("weekSelect").value;
  const subjectId = $("subjectSelect").value;

  if (!classId || !weekId || !subjectId) {
    $("evalBody").innerHTML = `<tr><td colspan="3" class="empty">Vui lòng chọn đủ Tuần – Môn – Lớp</td></tr>`;
    return;
  }

  $("evalBody").innerHTML = `<tr><td colspan="3" class="empty">Đang tải...</td></tr>`;

  try {
    const [stuRes, assRes] = await Promise.all([
      api("students", { classId }),
      api("getAssessments", { classId, weekId, subjectId })
    ]);
    students = stuRes.students || [];
    assessments = assRes.assessments || {};
    renderStudents();
  } catch (e) {
    $("evalBody").innerHTML = `<tr><td colspan="3" class="empty">${e.message}</td></tr>`;
  }
}

function renderStudents() {
  const q = ($("studentSearch").value || "").toLocaleLowerCase("vi");
  const list = students.filter(s => s.name.toLocaleLowerCase("vi").includes(q));
  const body = $("evalBody");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="3" class="empty">Không tìm thấy học sinh</td></tr>`;
    return;
  }

  list.forEach(s => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.innerHTML = `<strong>${s.name}</strong>`;
    tr.append(tdName);

    const tdCode = document.createElement("td");
    tdCode.textContent = s.code || "";
    tdCode.style.color = "#64748b";
    tr.append(tdCode);

    const tdRate = document.createElement("td");
    tdRate.style.textAlign = "center";
    const wrap = document.createElement("div");
    wrap.style.display = "inline-flex";
    wrap.style.gap = "6px";

    rating.forEach(r => {
      const btn = document.createElement("button");
      btn.className = "rate-btn" + (assessments[s.id] === r.v ? ` selected-${r.v}` : "");
      btn.textContent = r.i;
      btn.title = r.t;
      btn.onclick = () => saveRating(s, r.v);
      wrap.append(btn);
    });

    tdRate.append(wrap);
    tr.append(tdRate);
    body.append(tr);
  });
}

async function saveRating(student, value) {
  const key = student.id;
  const old = assessments[key];
  // Bấm lại mức đang chọn → bỏ chọn (xóa đánh giá)
  const isClear = old === value;
  const newValue = isClear ? "" : value;

  if (isClear) delete assessments[key];
  else assessments[key] = newValue;
  renderStudents();
  $("saveStatus").textContent = isClear
    ? `Đang xóa đánh giá ${student.name}...`
    : `Đang lưu ${student.name}...`;

  try {
    await api("saveAssessment", {
      studentId: key,
      classId: $("classSelect").value,
      weekId: $("weekSelect").value,
      subjectId: $("subjectSelect").value,
      value: isClear ? "CLEAR" : newValue
    });
    $("saveStatus").textContent = isClear
      ? `Đã xóa đánh giá: ${student.name}`
      : `Đã lưu: ${student.name} · ${rating.find(x => x.v === newValue).t}`;
  } catch (e) {
    if (isClear) assessments[key] = old;
    else assessments[key] = old;
    renderStudents();
    $("saveStatus").textContent = "Lỗi: " + e.message;
  }
}

// ==================== THỐNG KÊ ====================
// Top 1-10 (lớp hoặc học sinh tùy chọn)
$("loadClassRank").onclick = async () => {
  try {
    const classId = $("statsClassFilter").value;
    const r = await api("stats", {
      weekId: $("statsWeek").value,
      subjectId: $("statsSubject").value,
      classId,
      semester: $("statsSemester") ? $("statsSemester").value : ""
    });

    $("classRankSummary").innerHTML = "";
    [
      ["Tốt", r.total.good],
      ["Hoàn thành", r.total.complete],
      ["Cần cố gắng", r.total.notYet],
      ["Đã đánh giá", r.total.assessed]
    ].forEach(([label, val]) => {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<b>${val}</b><span>${label}</span>`;
      $("classRankSummary").append(d);
    });

    const body = $("rankBody");
    body.innerHTML = "";

    // Cập nhật tiêu đề cột theo mode
    const thead = body.closest("table").querySelector("thead tr");
    if (r.mode === "student") {
      thead.innerHTML = `
        <th>Hạng</th>
        <th>Học sinh</th>
        <th>Mã HS</th>
        <th>Tốt</th>
        <th>Hoàn thành</th>
        <th>Cần cố gắng</th>
        <th>Tỷ lệ Tốt</th>`;
      (r.ranking || []).slice(0, 10).forEach((x, i) => {
        const tr = document.createElement("tr");
        [i + 1, x.studentName, x.studentCode || "", x.good, x.complete, x.notYet, x.goodRate + "%"]
          .forEach(v => {
            const td = document.createElement("td");
            td.textContent = v;
            tr.append(td);
          });
        body.append(tr);
      });
    } else {
      thead.innerHTML = `
        <th>Hạng</th>
        <th>Lớp</th>
        <th>Tốt</th>
        <th>Hoàn thành</th>
        <th>Cần cố gắng</th>
        <th>Tỷ lệ Tốt</th>`;
      (r.ranking || []).slice(0, 10).forEach((x, i) => {
        const tr = document.createElement("tr");
        [i + 1, x.className, x.good, x.complete, x.notYet, x.goodRate + "%"]
          .forEach(v => {
            const td = document.createElement("td");
            td.textContent = v;
            tr.append(td);
          });
        body.append(tr);
      });
    }
  } catch (e) {
    toast(e.message);
  }
};

// Thống kê học sinh – dùng ô nhập tên, không dùng select
$("loadStudentStats").onclick = async () => {
  const classId = $("statsClass").value;
  const nameQuery = ($("statsStudentName").value || "").trim().toLocaleLowerCase("vi");

  if (!classId) return toast("Vui lòng chọn lớp");

  $("studentListBox").style.display = "none";
  $("studentStatsInfo").style.display = "none";

  try {
    const r = await api("students", { classId });
    let list = r.students || [];

    if (nameQuery) {
      list = list.filter(s => s.name.toLocaleLowerCase("vi").includes(nameQuery));
    }

    // Nếu chỉ còn đúng 1 học sinh → hiện chi tiết luôn
    if (list.length === 1) {
      await showStudentDetail(list[0].id, list[0]);
      return;
    }

    // Nhiều học sinh hoặc không nhập tên → hiện danh sách
    $("studentListBox").style.display = "block";
    const tbody = $("statsStudentList");
    tbody.innerHTML = "";

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Không tìm thấy học sinh</td></tr>`;
      return;
    }

    list.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${s.name}</strong></td>
        <td style="color:#64748b">${s.code || ""}</td>
        <td><button class="ghost small">Xem thống kê</button></td>
      `;
      tr.querySelector("button").onclick = () => showStudentDetail(s.id, s);
      tbody.append(tr);
    });
  } catch (e) {
    toast(e.message);
  }
};

function getWeekNumber(weekName) {
  const m = String(weekName || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function filterBySemester(detail, semester) {
  if (semester === "1") return detail.filter(d => {
    const n = getWeekNumber(d.weekName);
    return n >= 1 && n <= 18;
  });
  if (semester === "2") return detail.filter(d => {
    const n = getWeekNumber(d.weekName);
    return n >= 19 && n <= 35;
  });
  return detail;
}

async function showStudentDetail(studentId, studentInfo) {
  try {
    const semester = $("statsStudentSemester") ? $("statsStudentSemester").value : "";
    const r = await api("studentStats", {
      studentId,
      semester
    });

    // Lọc theo môn nếu có
    const subjectFilter = $("statsStudentSubject").value;
    let detail = r.detail || [];
    if (subjectFilter) {
      const subName = meta.subjects.find(s => s.id === subjectFilter)?.name;
      detail = detail.filter(d => d.subjectName === subName);
    }
    // Lọc lại theo học kỳ ở client (đảm bảo không lẫn tuần HK khác)
    detail = filterBySemester(detail, semester);

    $("studentListBox").style.display = "none";
    $("studentStatsInfo").style.display = "block";

    $("statsStudentNameTitle").textContent =
      `${r.student.name}${r.student.code ? " (" + r.student.code + ")" : ""}`;

    const summary = {
      good: detail.filter(x => x.value === "TOT").length,
      complete: detail.filter(x => x.value === "HT").length,
      needImprove: detail.filter(x => x.value === "CĐ").length,
      total: detail.length
    };

    $("statsSummary").innerHTML = "";
    [
      ["Tốt", summary.good],
      ["Hoàn thành", summary.complete],
      ["Cần cố gắng", summary.needImprove],
      ["Tổng số lần", summary.total]
    ].forEach(([label, val]) => {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<b>${val}</b><span>${label}</span>`;
      $("statsSummary").append(d);
    });

    const body = $("statsDetailBody");
    body.innerHTML = "";

    if (!detail.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">Chưa có dữ liệu đánh giá</td></tr>`;
      return;
    }

    const map = { TOT: "★ Tốt", HT: "✿ Hoàn thành", CĐ: "ϟ Cần cố gắng" };

    detail.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.weekName}</td>
        <td>${item.subjectName}</td>
        <td>${map[item.value] || item.value}</td>
        <td>${item.updatedAt ? new Date(item.updatedAt).toLocaleString("vi") : ""}</td>
        <td><button class="ghost small edit-eval">Sửa</button></td>
      `;
      tr.querySelector(".edit-eval").onclick = () => {
        const choice = prompt("Chọn mức mới:\n1 = Tốt\n2 = Hoàn thành\n3 = Cần cố gắng",
          item.value === "TOT" ? "1" : item.value === "HT" ? "2" : "3");
        if (!choice) return;
        const valMap = { "1": "TOT", "2": "HT", "3": "CĐ" };
        const v = valMap[choice.trim()];
        if (!v) return toast("Giá trị không hợp lệ");

        const week = meta.weeks.find(w => w.name === item.weekName);
        const subject = meta.subjects.find(s => s.name === item.subjectName);
        if (!week || !subject) return toast("Không tìm thấy tuần/môn");

        api("saveAssessment", {
          studentId,
          classId: $("statsClass").value,
          weekId: week.id,
          subjectId: subject.id,
          value: v
        }).then(() => {
          toast("Đã cập nhật");
          showStudentDetail(studentId, studentInfo);
        }).catch(e => toast(e.message));
      };
      body.append(tr);
    });
  } catch (e) {
    toast(e.message);
  }
}

// ==================== QUẢN LÝ ====================
function setLoading(btn, loading, text = "Đang xử lý...") {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.old = btn.dataset.old || btn.textContent;
  btn.textContent = loading ? text : btn.dataset.old;
}

function bindAddForm(formId, action) {
  const form = $(formId);
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector("button");
    setLoading(btn, true, "Đang thêm...");
    try {
      const name = new FormData(form).get("name").trim();
      await api(action, { name });
      await refreshMeta();
      renderManageTables();
      $("manageMsg").textContent = "Đã thêm thành công";
      form.reset();
    } catch (err) {
      $("manageMsg").textContent = err.message;
    } finally {
      setLoading(btn, false);
    }
  };
}
bindAddForm("classForm", "addClass");
bindAddForm("subjectForm", "addSubject");
bindAddForm("weekForm", "addWeek");

async function refreshMeta() {
  const r = await api("init");
  meta = r.meta;
  fillSelects();
}

function renderManageTables() {
  renderTableList("classList", meta.classes, "updateClass", "deleteClass");
  renderTableList("subjectList", meta.subjects, "updateSubject", "deleteSubject");
  renderTableList("weekList", meta.weeks, "updateWeek", "deleteWeek");
}

function renderTableList(tbodyId, items, updateAction, deleteAction) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty">Chưa có dữ liệu</td></tr>`;
    return;
  }
  items.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.name}</td>
      <td class="actions">
        <button class="ghost small edit">Sửa</button>
        <button class="ghost small danger del">Xóa</button>
      </td>
    `;
    tr.querySelector(".edit").onclick = async () => {
      const newName = prompt("Tên mới:", item.name);
      if (!newName || newName.trim() === item.name) return;
      try {
        await api(updateAction, { id: item.id, name: newName.trim() });
        await refreshMeta();
        renderManageTables();
        toast("Đã cập nhật");
      } catch (e) { toast(e.message); }
    };
    tr.querySelector(".del").onclick = async () => {
      if (!confirm(`Xóa "${item.name}"?`)) return;
      try {
        await api(deleteAction, { id: item.id });
        await refreshMeta();
        renderManageTables();
        toast("Đã xóa");
      } catch (e) { toast(e.message); }
    };
    tbody.append(tr);
  });
}

if ($("manageStudentClass")) $("manageStudentClass").onchange = loadStudentManageList;

async function loadStudentManageList() {
  const classId = $("manageStudentClass").value;
  const tbody = $("studentManageList");
  if (!classId) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">Chọn lớp để xem danh sách</td></tr>`;
    return;
  }
  try {
    const r = await api("students", { classId });
    const list = r.students || [];
    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Lớp chưa có học sinh</td></tr>`;
      return;
    }
    list.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.name}</td>
        <td>${s.code || ""}</td>
        <td class="actions">
          <button class="ghost small edit">Sửa</button>
          <button class="ghost small danger del">Xóa</button>
        </td>
      `;
      tr.querySelector(".edit").onclick = async () => {
        const name = prompt("Họ tên mới:", s.name);
        if (!name) return;
        const code = prompt("Mã học sinh:", s.code || "");
        try {
          await api("updateStudent", { id: s.id, name: name.trim(), code: (code || "").trim() });
          loadStudentManageList();
          toast("Đã cập nhật");
        } catch (e) { toast(e.message); }
      };
      tr.querySelector(".del").onclick = async () => {
        if (!confirm(`Xóa học sinh "${s.name}"?`)) return;
        try {
          await api("deleteStudent", { id: s.id });
          loadStudentManageList();
          toast("Đã xóa");
        } catch (e) { toast(e.message); }
      };
      tbody.append(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">${e.message}</td></tr>`;
  }
}

// Nạp Excel
function cellText(v) {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : String(v).trim();
  return String(v).replace(/\s+/g, " ").trim();
}
function parseCsv(text) {
  const out = []; let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i+1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if ((c === ',' || c === ';' || c === '\t') && !quoted) { row.push(value); value = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(value);
      if (row.some(x => String(x).trim())) out.push(row);
      row = []; value = "";
    } else value += c;
  }
  row.push(value);
  if (row.some(x => String(x).trim())) out.push(row);
  return out;
}
function parseStudentRows(rows) {
  const norm = x => cellText(x).toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d");
  const header = rows.findIndex(r => {
    const cells = r.map(norm);
    return cells.some(x => /^(ho va ten|ho ten)$/.test(x)) && cells.some(x => /^(ma hoc sinh|ma hs)$/.test(x));
  });
  if (header < 0) throw Error("Không nhận diện được tiêu đề (cần cột Mã học sinh và Họ và tên)");
  const h = rows[header].map(norm);
  const nameCol = h.findIndex(x => /^(ho va ten|ho ten)$/.test(x));
  const codeCol = h.findIndex(x => /^(ma hoc sinh|ma hs)$/.test(x));
  const nextH = norm(rows[header][nameCol+1] || "");
  const nameNext = (nameCol >= 0 && (!nextH || nextH === "ten")) ? nameCol + 1 : -1;
  const data = [];
  for (const r of rows.slice(header+1)) {
    const first = cellText(r[nameCol]);
    const last = nameNext >= 0 ? cellText(r[nameNext]) : "";
    const name = [first, last].filter(Boolean).join(" ").trim();
    if (!name) continue;
    data.push({ name, code: cellText(r[codeCol]) });
  }
  if (!data.length) throw Error("Không có dòng học sinh hợp lệ");
  return data;
}

$("uploadForm").onsubmit = async e => {
  e.preventDefault();
  const file = $("studentFile").files[0];
  const classId = $("uploadClass").value;
  if (!file || !classId) return $("manageMsg").textContent = "Chọn lớp và file";
  const btn = $("uploadForm").querySelector("button");
  setLoading(btn, true, "Đang nạp...");
  try {
    let rows;
    if (file.name.toLowerCase().endsWith(".csv")) {
      rows = parseCsv(await file.text());
    } else {
      if (!window.XLSX) throw Error("Thiếu thư viện Excel");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellText: true });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
    }
    const data = parseStudentRows(rows);
    const out = await api("importStudents", {
      classId,
      students: data.map(x => ({ name: x.name, code: x.code }))
    });
    $("manageMsg").textContent = `Đọc ${data.length} học sinh, đã thêm ${out.count}`;
    toast("Nạp thành công");
    loadStudentManageList();
  } catch (err) {
    $("manageMsg").textContent = err.message;
  } finally {
    setLoading(btn, false);
  }
};


// ==================== XÓA DỮ LIỆU ĐÁNH GIÁ ====================
async function clearAssessmentsData() {
  const classId = $("clearClass")?.value || "";
  const semester = $("clearSemester")?.value || "";
  const subjectId = $("clearSubject")?.value || "";

  let msg = "Bạn có chắc muốn XÓA dữ liệu đánh giá";
  if (classId) {
    const c = meta.classes.find(x => x.id === classId);
    msg += ` của lớp ${c ? c.name : ""}`;
  }
  if (semester === "1") msg += " – Học kỳ 1 (Tuần 1-18)";
  else if (semester === "2") msg += " – Học kỳ 2 (Tuần 19-35)";
  if (subjectId) {
    const s = meta.subjects.find(x => x.id === subjectId);
    msg += ` – môn ${s ? s.name : ""}`;
  }
  msg += "?\n\nHành động này KHÔNG thể hoàn tác!";

  if (!confirm(msg)) return;

  const btn = $("btnClearAssessments");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang xóa...";
  }
  try {
    const r = await api("clearAssessments", { classId, semester, subjectId });
    toast(`Đã xóa ${r.deleted} bản ghi đánh giá`);
    $("manageMsg").textContent = `Đã xóa ${r.deleted} bản ghi đánh giá`;
  } catch (e) {
    toast(e.message);
    $("manageMsg").textContent = e.message;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Xóa dữ liệu đánh giá";
    }
  }
}
if ($("btnClearAssessments")) {
  $("btnClearAssessments").onclick = clearAssessmentsData;
}

// ==================== AUTO LOGIN ====================
(async () => {
  const t = localStorage.getItem("dgt_token");
  if (t) {
    token = t;
    try {
      const r = await api("me");
      me = r.user;
      await enter();
    } catch {
      localStorage.removeItem("dgt_token");
    }
  }
})();
