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

function toast(s) {
  const e = $("toast");
  e.textContent = s;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 2500);
}

async function api(action, data = {}) {
  if (!API) throw Error("Chưa cấu hình API_URL trong config.js");
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
  } catch (x) {
    $("loginMsg").textContent = x.message;
  } finally {
    btn.disabled = false;
  }
};

async function enter() {
  // Ẩn login ngay
  const loginView = $("loginView");
  if (loginView) {
    loginView.hidden = true;
    loginView.style.display = "none";
  }
  $("appView").hidden = false;
  $("userLabel").textContent = me?.displayName || me?.username || "Đang tải...";

  document.querySelectorAll(".admin-only").forEach(x => {
    x.hidden = me?.role !== "admin";
  });

  try {
    const r = await api("init");
    meta = r.meta;
    fillSelects();
    $("userLabel").textContent = me?.displayName || me?.username || "";
    loadStudents();
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

  const loginView = $("loginView");
  if (loginView) {
    loginView.hidden = false;
    loginView.style.display = "";
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
  arr.forEach(x => {
    const o = document.createElement("option");
    o.value = x.id;
    o.textContent = x.name;
    el.append(o);
  });
  if ([...el.options].some(o => o.value === old)) el.value = old;
}

function fillSelects() {
  fill("weekSelect", meta.weeks);
  fill("subjectSelect", meta.subjects);
  fill("classSelect", meta.classes, "Chọn lớp");
  fill("statsClass", meta.classes, "Chọn lớp");
  fill("uploadClass", meta.classes, "Chọn lớp");
  fill("manageStudentClass", meta.classes, "Chọn lớp");

  const w = localStorage.getItem("dgt_week");
  const s = localStorage.getItem("dgt_subject");
  if (w && [...$("weekSelect").options].some(o => o.value === w)) $("weekSelect").value = w;
  if (s && [...$("subjectSelect").options].some(o => o.value === s)) $("subjectSelect").value = s;
}

// ==================== TABS ====================
function showTab(id) {
  document.querySelectorAll(".panel").forEach(x => x.hidden = x.id !== id);
  document.querySelectorAll(".tab").forEach(x => {
    x.classList.toggle("active", x.dataset.tab === id);
  });
  if (id === "manage") {
    renderManageLists();
    loadStudentManageList();
  }
}

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => showTab(b.dataset.tab);
});

// ==================== STUDENTS (Đánh giá) ====================
$("weekSelect").onchange = () => {
  localStorage.setItem("dgt_week", $("weekSelect").value);
  loadStudents();
};
$("subjectSelect").onchange = () => {
  localStorage.setItem("dgt_subject", $("subjectSelect").value);
  loadStudents();
};
$("classSelect").onchange = loadStudents;
$("studentSearch").oninput = renderStudents;

async function loadStudents() {
  if (!$("classSelect").value) {
    students = [];
    renderStudents();
    return;
  }
  try {
    const r = await api("students", { classId: $("classSelect").value });
    students = r.students;
    const a = await api("getAssessments", {
      classId: $("classSelect").value,
      weekId: $("weekSelect").value,
      subjectId: $("subjectSelect").value
    });
    assessments = a.assessments || {};
    renderStudents();
  } catch (e) {
    toast(e.message);
  }
}

function renderStudents() {
  const q = $("studentSearch").value.toLocaleLowerCase("vi");
  const list = students.filter(s => s.name.toLocaleLowerCase("vi").includes(q));
  const box = $("studentList");
  box.innerHTML = "";

  if (!list.length) {
    box.innerHTML = '<div class="empty">Không tìm thấy học sinh</div>';
    return;
  }

  list.forEach(s => {
    const row = document.createElement("div");
    row.className = "student-row";

    const name = document.createElement("div");
    name.innerHTML = `<div class="student-name"></div><div class="student-meta"></div>`;
    name.querySelector(".student-name").textContent = s.name;
    name.querySelector(".student-meta").textContent = s.code || "";

    const buttons = document.createElement("div");
    buttons.className = "ratings";
    rating.forEach(r => {
      const b = document.createElement("button");
      b.className = "rate" + (assessments[s.id] === r.v ? " selected" : "");
      b.dataset.value = r.v;
      b.title = r.t;
      b.textContent = r.i;
      b.onclick = () => saveRating(s, r.v);
      buttons.append(b);
    });

    row.append(name, buttons);
    box.append(row);
  });
}

async function saveRating(s, value) {
  const key = s.id;
  const old = assessments[key];
  assessments[key] = value;
  renderStudents();
  $("saveStatus").textContent = "Đang lưu...";

  try {
    await api("saveAssessment", {
      studentId: key,
      classId: $("classSelect").value,
      weekId: $("weekSelect").value,
      subjectId: $("subjectSelect").value,
      value
    });
    $("saveStatus").textContent = `Đã lưu ${s.name} · ${rating.find(x => x.v === value).t}`;
  } catch (e) {
    assessments[key] = old;
    renderStudents();
    $("saveStatus").textContent = "Lưu thất bại: " + e.message;
  }
}

// ==================== MANAGE ====================
function setLoading(btn, loading, text = "Đang xử lý...") {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.oldText = btn.dataset.oldText || btn.textContent;
  btn.textContent = loading ? text : btn.dataset.oldText;
}

function submitNamed(form, action, key) {
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector("button");
    setLoading(btn, true, "Đang thêm...");
    try {
      const name = new FormData(form).get("name").trim();
      await api(action, { name });
      await refreshMeta();
      renderManageLists();
      $(key).textContent = "Đã thêm thành công";
      form.reset();
    } catch (x) {
      $(key).textContent = x.message;
    } finally {
      setLoading(btn, false);
    }
  };
}

submitNamed($("classForm"), "addClass", "manageMsg");
submitNamed($("subjectForm"), "addSubject", "manageMsg");
submitNamed($("weekForm"), "addWeek", "manageMsg");

async function refreshMeta() {
  const r = await api("init");
  meta = r.meta;
  fillSelects();
}

function renderManageLists() {
  renderSimpleList("classList", meta.classes, "updateClass", "deleteClass");
  renderSimpleList("subjectList", meta.subjects, "updateSubject", "deleteSubject");
  renderSimpleList("weekList", meta.weeks, "updateWeek", "deleteWeek");
}

function renderSimpleList(containerId, items, updateAction, deleteAction) {
  const box = $(containerId);
  if (!box) return;
  box.innerHTML = "";

  if (!items.length) {
    box.innerHTML = `<div class="empty">Chưa có dữ liệu</div>`;
    return;
  }

  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <div class="manage-name">${item.name}</div>
      <div class="manage-actions">
        <button class="ghost small edit-btn">Sửa</button>
        <button class="ghost small danger delete-btn">Xóa</button>
      </div>
    `;

    row.querySelector(".edit-btn").onclick = async () => {
      const newName = prompt("Nhập tên mới:", item.name);
      if (!newName || newName.trim() === item.name) return;
      try {
        await api(updateAction, { id: item.id, name: newName.trim() });
        await refreshMeta();
        renderManageLists();
        toast("Đã cập nhật");
      } catch (e) {
        toast(e.message);
      }
    };

    row.querySelector(".delete-btn").onclick = async () => {
      if (!confirm(`Bạn có chắc muốn xóa "${item.name}"?`)) return;
      try {
        await api(deleteAction, { id: item.id });
        await refreshMeta();
        renderManageLists();
        toast("Đã xóa");
      } catch (e) {
        toast(e.message);
      }
    };

    box.append(row);
  });
}

// Student list in Manage tab
$("manageStudentClass").onchange = loadStudentManageList;

async function loadStudentManageList() {
  const classId = $("manageStudentClass")?.value;
  const box = $("studentManageList");
  if (!box) return;

  if (!classId) {
    box.innerHTML = `<div class="empty">Chọn lớp để xem danh sách học sinh</div>`;
    return;
  }

  try {
    const r = await api("students", { classId });
    const list = r.students || [];
    box.innerHTML = "";

    if (!list.length) {
      box.innerHTML = `<div class="empty">Lớp này chưa có học sinh</div>`;
      return;
    }

    list.forEach(s => {
      const row = document.createElement("div");
      row.className = "manage-row";
      row.innerHTML = `
        <div>
          <div class="manage-name">${s.name}</div>
          <div class="student-meta">${s.code || ""}</div>
        </div>
        <div class="manage-actions">
          <button class="ghost small edit-btn">Sửa</button>
          <button class="ghost small danger delete-btn">Xóa</button>
        </div>
      `;

      row.querySelector(".edit-btn").onclick = async () => {
        const newName = prompt("Họ tên mới:", s.name);
        if (!newName) return;
        const newCode = prompt("Mã học sinh mới:", s.code || "");
        try {
          await api("updateStudent", {
            id: s.id,
            name: newName.trim(),
            code: (newCode || "").trim()
          });
          loadStudentManageList();
          toast("Đã cập nhật học sinh");
        } catch (e) {
          toast(e.message);
        }
      };

      row.querySelector(".delete-btn").onclick = async () => {
        if (!confirm(`Xóa học sinh "${s.name}"?`)) return;
        try {
          await api("deleteStudent", { id: s.id });
          loadStudentManageList();
          toast("Đã xóa học sinh");
        } catch (e) {
          toast(e.message);
        }
      };

      box.append(row);
    });
  } catch (e) {
    box.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

// ==================== IMPORT STUDENTS ====================
function cellText(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v).trim();
  }
  return String(v).replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const out = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if ((c === ',' || c === ';' || c === '\t') && !quoted) { row.push(value); value = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
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
  const norm = x => cellText(x).toLocaleLowerCase("vi").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

  const header = rows.findIndex(r => {
    const cells = r.map(norm);
    return cells.some(x => /^(ho va ten|ho ten)$/.test(x)) &&
           cells.some(x => /^(ma hoc sinh|ma hs)$/.test(x));
  });
  if (header < 0) throw Error("Không nhận diện được dòng tiêu đề. Cần có cột Mã học sinh và Họ và tên.");

  const h = rows[header].map(norm);
  const nameCol = h.findIndex(x => /^(ho va ten|ho ten)$/.test(x));
  const codeCol = h.findIndex(x => /^(ma hoc sinh|ma hs)$/.test(x));
  const sttCol  = h.findIndex(x => /^stt$/.test(x));
  const nextHeader = norm(rows[header][nameCol + 1] || "");
  const nameNext = (nameCol >= 0 && (!nextHeader || nextHeader === "ten")) ? nameCol + 1 : -1;

  const data = [];
  for (const r of rows.slice(header + 1)) {
    const first = cellText(r[nameCol]);
    const last  = nameNext >= 0 ? cellText(r[nameNext]) : "";
    const name  = [first, last].filter(Boolean).join(" ").trim();
    const code  = cellText(r[codeCol]);
    if (!name) continue;
    data.push({ name, code, stt: sttCol >= 0 ? cellText(r[sttCol]) : "" });
  }
  if (!data.length) throw Error("Đã tìm thấy tiêu đề nhưng không có dòng học sinh hợp lệ.");
  return data;
}

$("uploadForm").onsubmit = async e => {
  e.preventDefault();
  const file = $("studentFile").files[0];
  const classId = $("uploadClass").value;
  if (!file || !classId) {
    $("manageMsg").textContent = "Vui lòng chọn lớp và file danh sách.";
    return;
  }

  const submit = $("uploadForm").querySelector("button");
  setLoading(submit, true, "Đang đọc và nạp...");

  try {
    let rows;
    if (file.name.toLowerCase().endsWith(".csv")) {
      rows = parseCsv(await file.text());
    } else {
      if (!window.XLSX) throw Error("Không tải được thư viện đọc Excel. Hãy tải lại trang.");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellText: true });
      if (!wb.SheetNames.length) throw Error("File Excel không có trang tính.");
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
    }

    const data = parseStudentRows(rows);
    const out = await api("importStudents", {
      classId,
      students: data.map(x => ({ name: x.name, code: x.code }))
    });

    $("manageMsg").textContent =
      `Đọc được ${data.length} học sinh; đã thêm ${out.count} học sinh vào lớp.`;
    toast("Nạp danh sách thành công");
    await loadStudents();
    loadStudentManageList();
  } catch (x) {
    $("manageMsg").textContent = x.message;
  } finally {
    setLoading(submit, false);
  }
};

// ==================== STATS (theo học sinh) ====================
$("statsClass").onchange = async () => {
  const classId = $("statsClass").value;
  const sel = $("statsStudent");
  sel.innerHTML = `<option value="">-- Chọn học sinh --</option>`;
  if (!classId) return;

  try {
    const r = await api("students", { classId });
    r.students.forEach(s => {
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
  if (!studentId) {
    toast("Vui lòng chọn học sinh");
    return;
  }

  try {
    const r = await api("studentStats", { studentId });

    $("studentStatsInfo").style.display = "block";
    $("statsStudentName").textContent =
      `${r.student.name}${r.student.code ? " (" + r.student.code + ")" : ""}`;

    $("statsSummary").innerHTML = "";
    [
      ["Tốt", r.summary.good],
      ["Hoàn thành", r.summary.complete],
      ["Cần cố gắng", r.summary.needImprove],
      ["Tổng số lần đánh giá", r.summary.total]
    ].forEach(([label, value]) => {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<b>${value}</b><span>${label}</span>`;
      $("statsSummary").append(d);
    });

    const body = $("statsDetailBody");
    body.innerHTML = "";

    if (!r.detail.length) {
      body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#888">Chưa có dữ liệu đánh giá</td></tr>`;
      return;
    }

    const ratingMap = {
      TOT: "★ Tốt",
      HT:  "✿ Hoàn thành",
      CĐ:  "ϟ Cần cố gắng"
    };

    r.detail.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.weekName}</td>
        <td>${item.subjectName}</td>
        <td>${ratingMap[item.value] || item.value}</td>
        <td>${item.updatedAt ? new Date(item.updatedAt).toLocaleString("vi") : ""}</td>
      `;
      body.append(tr);
    });
  } catch (e) {
    toast(e.message);
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
    } catch (e) {
      localStorage.removeItem("dgt_token");
    }
  }
})();
