const $=id=>document.getElementById(id);
const API=window.APP_CONFIG?.API_URL||"";
let token="",me=null,meta={classes:[],subjects:[],weeks:[]},students=[],assessments={};
const rating=[{v:"TOT",i:"★",t:"Tốt"},{v:"HT",i:"✿",t:"Hoàn thành"},{v:"CĐ",i:"ϟ",t:"Chưa đạt"}];
function toast(s){let e=$("toast");e.textContent=s;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2500)}

async function api(action, data = {}) {
  if (!API) {
    throw Error("Chưa cấu hình API_URL");
  }

  let response;

  try {
    response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        token,
        ...data
      })
    });
  } catch (e) {
    throw Error("Không kết nối được API: " + e.message);
  }

  const raw = await response.text();

  if (!raw || !raw.trim()) {
    throw Error(
      "API trả về dữ liệu rỗng. HTTP: " +
      response.status +
      ". Kiểm tra Netlify Functions."
    );
  }

  let result;

  try {
    result = JSON.parse(raw);
  } catch (e) {
    throw Error(
      "API không trả về JSON hợp lệ. HTTP: " +
      response.status +
      ". Nội dung: " + raw.substring(0, 300)
    );
  }

  if (!response.ok || !result.ok) {
    throw Error(
      result.error ||
      result.message ||
      "API lỗi HTTP " + response.status
    );
  }

  return result;
}

$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginMsg").textContent="Đang đăng nhập...";try{let r=await api("login",{username:$("username").value.trim(),password:$("password").value});token=r.token;me=r.user;localStorage.setItem("dgt_token",token);await enter()}catch(x){$("loginMsg").textContent=x.message}};
async function enter(){let r=await api("init");meta=r.meta; $("loginView").hidden=true;$("appView").hidden=false;$("userLabel").textContent=me?.displayName||me?.username||"";document.querySelectorAll(".admin-only").forEach(x=>x.hidden=me?.role!=="admin");fillSelects();await loadStudents();showTab("evaluate")}
$("logoutBtn").onclick=()=>{token="";me=null;localStorage.removeItem("dgt_token");$("appView").hidden=true;$("loginView").hidden=false};
function fill(id,arr,placeholder){let el=$(id),old=el.value;el.innerHTML="";if(placeholder){let o=document.createElement("option");o.value="";o.textContent=placeholder;el.append(o)}arr.forEach(x=>{let o=document.createElement("option");o.value=x.id;o.textContent=x.name;el.append(o)});if([...el.options].some(o=>o.value===old))el.value=old}
function fillSelects(){fill("weekSelect",meta.weeks);fill("subjectSelect",meta.subjects);fill("classSelect",meta.classes,"Chọn lớp");fill("statsWeek",meta.weeks);fill("statsSubject",meta.subjects);fill("statsClass",meta.classes,"Tất cả lớp");fill("uploadClass",meta.classes,"Chọn lớp");let w=localStorage.getItem("dgt_week"),s=localStorage.getItem("dgt_subject");if(w&&[...$("weekSelect").options].some(o=>o.value===w))$("weekSelect").value=w;if(s&&[...$("subjectSelect").options].some(o=>o.value===s))$("subjectSelect").value=s;$("statsWeek").value=$("weekSelect").value;$("statsSubject").value=$("subjectSelect").value}
function showTab(id){document.querySelectorAll(".panel").forEach(x=>x.hidden=x.id!==id);document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));if(id==="stats")loadStats()}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("weekSelect").onchange=()=>{localStorage.setItem("dgt_week",$("weekSelect").value);loadStudents()};
$("subjectSelect").onchange=()=>{localStorage.setItem("dgt_subject",$("subjectSelect").value);loadStudents()};
$("classSelect").onchange=loadStudents;$("studentSearch").oninput=renderStudents;
async function loadStudents(){if(!$("classSelect").value){students=[];renderStudents();return}try{let r=await api("students",{classId:$("classSelect").value});students=r.students;let a=await api("getAssessments",{classId:$("classSelect").value,weekId:$("weekSelect").value,subjectId:$("subjectSelect").value});assessments=a.assessments||{};renderStudents()}catch(e){toast(e.message)}}
function renderStudents(){let q=$("studentSearch").value.toLocaleLowerCase("vi"),list=students.filter(s=>s.name.toLocaleLowerCase("vi").includes(q));let box=$("studentList");box.innerHTML="";if(!list.length){box.innerHTML='<div class="empty">Không tìm thấy học sinh</div>';return}list.forEach(s=>{let row=document.createElement("div");row.className="student-row";let name=document.createElement("div");name.innerHTML=`<div class="student-name"></div><div class="student-meta"></div>`;name.querySelector(".student-name").textContent=s.name;name.querySelector(".student-meta").textContent=s.code||"";let buttons=document.createElement("div");buttons.className="ratings";rating.forEach(r=>{let b=document.createElement("button");b.className="rate"+(assessments[s.id]===r.v?" selected":"");b.dataset.value=r.v;b.title=r.t;b.textContent=r.i;b.onclick=()=>saveRating(s,r.v,b);buttons.append(b)});row.append(name,buttons);box.append(row)})}
async function saveRating(s,value,btn){let key=s.id,old=assessments[key];assessments[key]=value;renderStudents();$("saveStatus").textContent="Đang lưu...";try{await api("saveAssessment",{studentId:key,classId:$("classSelect").value,weekId:$("weekSelect").value,subjectId:$("subjectSelect").value,value});$("saveStatus").textContent=`Đã lưu ${s.name} · ${rating.find(x=>x.v===value).t}`}catch(e){assessments[key]=old;renderStudents();$("saveStatus").textContent="Lưu thất bại: "+e.message}}
async function submitNamed(form,action,key){form.onsubmit=async e=>{e.preventDefault();try{let name=new FormData(form).get("name").trim();await api(action,{name});await refreshMeta();$(key).textContent="Đã thêm thành công";form.reset()}catch(x){$(key).textContent=x.message}}}
submitNamed($("classForm"),"addClass","manageMsg");submitNamed($("subjectForm"),"addSubject","manageMsg");submitNamed($("weekForm"),"addWeek","manageMsg");
async function refreshMeta(){let r=await api("init");meta=r.meta;fillSelects()}
// Đọc đúng bảng điểm Excel gốc: STT | Mã học sinh | Họ và tên (C+D) | Nhận xét | XL GK1.
function cellText(v){
 if(v===undefined||v===null)return "";
 if(typeof v==="number"&&Number.isFinite(v))return Number.isInteger(v)?String(v):String(v).trim();
 return String(v).replace(/\s+/g," ").trim();
}
function parseCsv(text){
 const out=[];let row=[],value="",quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'&&quoted&&text[i+1]==='"'){value+='"';i++;}
  else if(c==='"')quoted=!quoted;
  else if((c===','||c===';'||c==='\t')&&!quoted){row.push(value);value="";}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>String(x).trim()))out.push(row);row=[];value="";}
  else value+=c;
 }
 row.push(value);if(row.some(x=>String(x).trim()))out.push(row);return out;
}
function parseStudentRows(rows){
 const norm=x=>cellText(x).toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d");
 const header=rows.findIndex(r=>{
  const cells=r.map(norm);
  return cells.some(x=>/^(ho va ten|ho ten)$/.test(x))&&cells.some(x=>/^(ma hoc sinh|ma hs)$/.test(x));
 });
 if(header<0)throw Error("Không nhận diện được dòng tiêu đề của file 5D. Cần có các cột Mã học sinh và Họ và tên.");
 const h=rows[header].map(norm);
 const nameCol=h.findIndex(x=>/^(ho va ten|ho ten)$/.test(x));
 const codeCol=h.findIndex(x=>/^(ma hoc sinh|ma hs)$/.test(x));
 const sttCol=h.findIndex(x=>/^stt$/.test(x));
 // Trong file 5D.xls, họ tên được chia làm hai cột: C là họ/tên đệm, D là tên.
 // Cột D không có tiêu đề riêng nên phải ghép với cột C.
 const nextHeader=norm(rows[header][nameCol+1]);
 const nameNext=(nameCol>=0&&(!nextHeader||nextHeader==="ten"))?nameCol+1:-1;
 const data=[];
 for(const r of rows.slice(header+1)){
  const first=cellText(r[nameCol]);
  const last=nameNext>=0?cellText(r[nameNext]):"";
  const name=[first,last].filter(Boolean).join(" ").trim();
  const code=cellText(r[codeCol]);
  if(!name)continue; // Bỏ các dòng tiêu đề, dòng trống và phần ghi chú cuối bảng.
  data.push({name,code,stt:sttCol>=0?cellText(r[sttCol]):""});
 }
 if(!data.length)throw Error("Đã tìm thấy tiêu đề nhưng không có dòng học sinh hợp lệ.");
 return data;
}
$("uploadForm").onsubmit=async e=>{
 e.preventDefault();
 const file=$("studentFile").files[0],classId=$("uploadClass").value;
 if(!file||!classId){$("manageMsg").textContent="Vui lòng chọn lớp và file danh sách.";return;}
 const submit=$("uploadForm").querySelector('button[type="submit"],button:not([type])');
 const oldText=submit?.textContent;if(submit){submit.disabled=true;submit.textContent="Đang đọc và nạp...";}
 try{
  let rows;
  if(file.name.toLowerCase().endsWith(".csv"))rows=parseCsv(await file.text());
  else{
   if(!window.XLSX)throw Error("Không tải được thư viện đọc Excel. Hãy tải lại trang rồi thử lại.");
   const wb=XLSX.read(await file.arrayBuffer(),{type:"array",raw:false,cellText:true});
   if(!wb.SheetNames.length)throw Error("File Excel không có trang tính.");
   rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:"",raw:false});
  }
  const data=parseStudentRows(rows);
  const out=await api("importStudents",{classId,students:data.map(x=>({name:x.name,code:x.code}))});
  $("manageMsg").textContent=`Đọc được ${data.length} học sinh từ file; đã thêm ${out.count} học sinh vào lớp. Họ tên được ghép từ hai cột theo mẫu Excel gốc.`;
  toast("Nạp danh sách thành công");
  await loadStudents();
 }catch(x){$("manageMsg").textContent=x.message;}
 finally{if(submit){submit.disabled=false;submit.textContent=oldText||"Nạp học sinh";}}
};
async function loadStats(){try{let r=await api("stats",{weekId:$("statsWeek").value,subjectId:$("statsSubject").value,classId:$("statsClass").value});$("statsSummary").innerHTML="";[["Tốt",r.total.good],["Hoàn thành",r.total.complete],["Chưa đạt",r.total.notYet],["Đã đánh giá",r.total.assessed]].forEach(([n,v])=>{let d=document.createElement("div");d.className="stat";d.innerHTML="<b></b><span></span>";d.querySelector("b").textContent=v;d.querySelector("span").textContent=n;$("statsSummary").append(d)});$("rankBody").innerHTML="";r.ranking.slice(0,10).forEach((x,i)=>{let tr=document.createElement("tr");[i+1,x.className,x.good,x.complete,x.notYet,x.goodRate+"%"].forEach(v=>{let td=document.createElement("td");td.textContent=v;tr.append(td)});$("rankBody").append(tr)})}catch(e){toast(e.message)}}
$("loadStats").onclick=loadStats;
(async()=>{let t=localStorage.getItem("dgt_token");if(t){token=t;try{let r=await api("me");me=r.user;await enter()}catch(e){localStorage.removeItem("dgt_token")}}})();
