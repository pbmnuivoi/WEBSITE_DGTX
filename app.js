const $ = id => document.getElementById(id);
const API = window.APP_CONFIG?.API_URL || "";

let token = "";
let me = null;
let meta = { classes: [], subjects: [], weeks: [] };
let students = [];
let assessmentsMap = {}; // key: studentId_weekId → value

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
  fill("subjectSelect", meta.subjects, "Chọn môn");
  fill("classSelect", meta.classes, "Chọn lớp");
  fill("statsWeek", meta.weeks, "Tất cả tuần");
  fill("statsSubject", meta.subjects, "Tất cả môn");
  fill("statsClass", meta.classes, "Chọn lớp");
  fill("statsStudentSubject", meta.subjects, "Tất cả môn");
  fill("uploadClass", meta.classes, "Chọn lớp");
  fill("manageStudentClass", meta.classes, "Chọn lớp");
}

// ==================== TABS ====================
function showTab(id) {
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== id);
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  if (id === "evaluate") loadEvalTable();
  if (id === "manage") {
    renderManageTables();
    loadStudentManageList();
  }
}
document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => showTab(btn.dataset.tab);
});

// ==================== ĐÁNH GIÁ – BẢNG MA TRẬN ====================
$("classSelect").onchange = loadEvalTable;
$("subjectSelect").onchange = loadEvalTable;
$("studentSearch").oninput = () => renderEvalTable();
$("reloadEval").onclick = loadEvalTable;

async function loadEvalTable() {
  const classId = $("classSelect").value;
  const subjectId = $("subjectSelect").value;

  if (!classId || !subjectId) {
    $("evalBody").innerHTML = `<tr><td colspan="30" class="empty">Vui lòng chọn Lớp và Môn học</td></tr>`;
    return;
  }

  $("evalBody").innerHTML = `<tr><td colspan="30" class="empty">Đang tải dữ liệu...</td></tr>`;

  try {
    const r = await api("students", { classId });
    students = r.students || [];

    // Lấy tất cả đánh giá của lớp + môn (mọi tuần)
    assessmentsMap = {};
    for (const week of meta.weeks) {
      const a = await api("getAssessments", {
        classId,
        weekId: week.id,
        subjectId
      });
      Object.entries(a.assessments || {}).forEach(([sid, val]) => {
        assessmentsMap[`${sid}_${week.id}`] = val;
      });
    }

    renderEvalTable();
  } catch (e) {
    $("evalBody").innerHTML = `<tr><td colspan="30" class="empty">${e.message}</td></tr>`;
  }
}

function renderEvalTable() {
  const q = ($("studentSearch").value || "").toLocaleLowerCase("vi");
  const list = students.filter(s => s.name.toLocaleLowerCase("vi").includes(q));

  // Header
  const header = $("evalHeader");
  header.innerHTML = `<th class="student-col">Học sinh</th>`;
  meta.weeks.forEach(w => {
    const th = document.createElement("th");
    th.className = "week-col";
    th.textContent = w.name;
    header.append(th);
  });

  // Body
  const body = $("evalBody");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${meta.weeks.length + 1}" class="empty">Không tìm thấy học sinh</td></tr>`;
    return;
  }

  list.forEach(s => {
    const tr = document.createElement("tr");

    // Cột tên học sinh
    const tdName = document.createElement("td");
    tdName.className = "student-col";
    tdName.innerHTML = `<div>${s.name}</div><div style="font-size:12px;color:#64748b;font-weight:400">${s.code || ""}</div>`;
    tr.append(tdName);

    // Các cột tuần
    meta.weeks.forEach(w => {
      const td = document.createElement("td");
      td.className = "cell";
      const key = `${s.id}_${w.id}`;
      const current = assessmentsMap[key] || "";

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "4px";
      wrap.style.justifyContent = "center";

      rating.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "rate-btn" + (current === r.v ? ` selected-${r.v}` : "");
        btn.textContent = r.i;
        btn.title = r.t;
        btn.onclick = () => saveCell(s, w, r.v, btn);
        wrap.append(btn);
      });

      td.append(wrap);
      tr.append(td);
    });

    body.append(tr);
  });
}

async function saveCell(student, week, value, btn) {
  const classId = $("classSelect").value;
  const subjectId = $("subjectSelect").value;
  const key = `${student.id}_${week.id}`;
  const old = assessmentsMap[key];

  assessmentsMap[key] = value;
  // cập nhật UI ngay
  const parent = btn.parentElement;
  parent.querySelectorAll(".rate-btn").forEach(b => {
    b.className = "rate-btn";
  });
  btn.className = `rate-btn selected-${value}`;

  $("saveStatus").textContent = `Đang lưu ${student.name} – ${week.name}...`;

  try {
    await api("saveAssessment", {
      studentId: student.id,
      classId,
      weekId: week.id,
      subjectId,
      value
    });
    $("saveStatus").textContent = `Đã lưu: ${student.name} · ${week.name} · ${rating.find(x => x.v === value).t}`;
  } catch (e) {
    assessmentsMap[key] = old;
    renderEvalTable();
    $("saveStatus").textContent = "Lỗi: " + e.message;
  }
}

// ==================== THỐNG KÊ ====================
// Top lớp
$("loadClassRank").onclick = async () => {
  try {
    const r = await api("stats", {
      weekId: $("statsWeek").value,
      subjectId: $("statsSubject").value
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
    (r.ranking || []).slice(0, 10).forEach((x, i) => {
      const tr = document.createElement("tr");
      [i + 1, x.className, x.good, x.complete, x.notYet, x.goodRate + "%"].forEach(v => {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      });
      body.append(tr);
    });
  } catch (e) {
    toast(e.message);
  }
};

// Thống kê 1 học sinh
$("statsClass").onchange = async () => {
  const classId = $("statsClass").value;
  const sel = $("statsStudent");
  sel.innerHTML = `<option value="">-- Chọn học sinh --</option>`;
  if (!classId) return;
  try {
    const r = await api("students", { classId });
    (r.students || []).forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name + (s.code ? ` (${s.code})` : "");
      sel.append(o);
    });
  } catch (e) {
    toast(e.message);
  }
};

$("loadStudentStats").onclick = async () => {
  const studentId = $("statsStudent").value;
  if (!studentId) return toast("Vui lòng chọn học sinh");

  try {
    const r = await api("studentStats", { studentId });

    // Lọc theo môn nếu có chọn
    const subjectFilter = $("statsStudentSubject").value;
    let detail = r.detail || [];
    if (subjectFilter) {
      const subName = meta.subjects.find(s => s.id === subjectFilter)?.name;
      detail = detail.filter(d => d.subjectName === subName);
    }

    $("studentStatsInfo").style.display = "block";
    $("statsStudentName").textContent =
      `${r.student.name}${r.student.code ? " (" + r.student.code + ")" : ""}`;

    // summary (tính lại nếu lọc môn)
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
      body.innerHTML = `<tr><td colspan="5" class="empty">Chưa có dữ liệu</td></tr>`;
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
        <td>
          <button class="ghost small edit-eval">Sửa</button>
        </td>
      `;
      tr.querySelector(".edit-eval").onclick = () => {
        const newVal = prompt("Chọn mức mới:\n1 = Tốt\n2 = Hoàn thành\n3 = Cần cố gắng", 
          item.value === "TOT" ? "1" : item.value === "HT" ? "2" : "3");
        if (!newVal) return;
        const valMap = { "1": "TOT", "2": "HT", "3": "CĐ" };
        const v = valMap[newVal.trim()];
        if (!v) return toast("Giá trị không hợp lệ");
        // Tìm weekId + subjectId để gọi save
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
          toast("Đã cập nhật đánh giá");
          $("loadStudentStats").click();
        }).catch(e => toast(e.message));
      };
      body.append(tr);
    });
  } catch (e) {
    toast(e.message);
  }
};

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

// Học sinh trong quản lý
$("manageStudentClass").onchange = loadStudentManageList;

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
