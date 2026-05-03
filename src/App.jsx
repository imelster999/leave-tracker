import { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase";

// ─── Leave types ──────────────────────────────────────────────────────────────
const LEAVE_TYPES = [
  { label: "Casual Leave/AL",     code: "C",   color: "#4F8EF7", bg: "#EEF4FF" },
  { label: "AM Leave",            code: "H1",  color: "#F59E42", bg: "#FFF6ED" },
  { label: "PM Leave",            code: "H2",  color: "#F5A623", bg: "#FFF3E0" },
  { label: "Family Care Leave",   code: "FCL", color: "#3DC98B", bg: "#EDFAF4" },
  { label: "Off-in-Lieu",         code: "OIL", color: "#6C8EF7", bg: "#EEF1FF" },
  { label: "Birthday Leave",      code: "BL",  color: "#F76DAE", bg: "#FFF0F7" },
  { label: "Sick Leave/MC",       code: "S",   color: "#F7724F", bg: "#FFF2EE" },
  { label: "Childcare Leave",     code: "CCL", color: "#2DD4BF", bg: "#EDFAFA" },
  { label: "Compassionate Leave", code: "Co",  color: "#9AAAB8", bg: "#F0F4F7" },
  { label: "Maternity Leave",     code: "M",   color: "#B97CF7", bg: "#F5EEFF" },
  { label: "On Course",           code: "OC",  color: "#1ABCFE", bg: "#E8F8FF" },
];

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

// ─── Office teams ─────────────────────────────────────────────────────────────
// Team A: Mon–Wed (days 1,2,3), Team B: Wed–Fri (days 3,4,5)
const OFFICE_TEAMS = {
  A: { label:"Team A", days:[1,2,3], dayNames:"Mon – Wed", color:"#4F8EF7", bg:"#EEF4FF" },
  B: { label:"Team B", days:[3,4,5], dayNames:"Wed – Fri", color:"#3DC98B", bg:"#EDFAF4" },
};
const QUARTERS = [
  { key:"Q1", label:"Q1", months:"Jan – Mar" },
  { key:"Q2", label:"Q2", months:"Apr – Jun" },
  { key:"Q3", label:"Q3", months:"Jul – Sep" },
  { key:"Q4", label:"Q4", months:"Oct – Dec" },
];
function quarterForDate(d) {
  const m = d.getMonth();
  if (m<=2) return "Q1"; if (m<=5) return "Q2";
  if (m<=8) return "Q3"; return "Q4";
}

// ─── Singapore Public Holidays 2026 (source: MOM) ─────────────────────────────
// Saturday PHs excluded from auto-OIL — staff choose their own OIL day.
// Only Sunday PHs get a pre-populated Monday substitute.
const SG_PUBLIC_HOLIDAYS = [
  { date:"2026-01-01", name:"New Year's Day" },
  { date:"2026-02-17", name:"Chinese New Year (Day 1)" },
  { date:"2026-02-18", name:"Chinese New Year (Day 2)" },
  { date:"2026-03-21", name:"Hari Raya Puasa" },   // Saturday — no auto OIL
  { date:"2026-04-03", name:"Good Friday" },
  { date:"2026-05-01", name:"Labour Day" },
  { date:"2026-05-27", name:"Hari Raya Haji" },
  { date:"2026-05-31", name:"Vesak Day" },          // Sunday → OIL 1 Jun
  { date:"2026-08-09", name:"National Day" },       // Sunday → OIL 10 Aug
  { date:"2026-11-08", name:"Deepavali" },          // Sunday → OIL 9 Nov
  { date:"2026-12-25", name:"Christmas Day" },
];
const SG_OIL_DAYS = [
  { date:"2026-06-01", name:"OIL \u2014 Vesak Day (Sun)" },
  { date:"2026-08-10", name:"OIL \u2014 National Day (Sun)" },
  { date:"2026-11-09", name:"OIL \u2014 Deepavali (Sun)" },
];

const PH_DATE_SET  = new Set(SG_PUBLIC_HOLIDAYS.map(h => h.date));
const OIL_DATE_SET = new Set(SG_OIL_DAYS.map(h => h.date));
function phOnDay(ds)  { return SG_PUBLIC_HOLIDAYS.find(h => h.date===ds) || null; }
function oilOnDay(ds) { return SG_OIL_DAYS.find(h => h.date===ds) || null; }

const CURRENT_YEAR = new Date().getFullYear();
const TODAY = new Date();
TODAY.setHours(0,0,0,0);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function mondayOfWeek(d) {
  const r=new Date(d); const dow=r.getDay();
  r.setDate(r.getDate()-(dow===0?6:dow-1)); return r;
}
function daysInMonth(y,m) { return new Date(y,m+1,0).getDate(); }
function leaveType(label) { return LEAVE_TYPES.find(t=>t.label===label)||LEAVE_TYPES[0]; }
function inRange(ds,s,e) { return ds>=s && ds<=e; }
function avatarHue(name) { return name.split("").reduce((a,c)=>a+c.charCodeAt(0),0)%360; }
function initials(name) { return name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase(); }
function overlapDaysMonth(leave,y,m) {
  const mS=`${y}-${String(m+1).padStart(2,"0")}-01`;
  const mE=`${y}-${String(m+1).padStart(2,"0")}-${String(daysInMonth(y,m)).padStart(2,"0")}`;
  const s=leave.start>mS?leave.start:mS; const e=leave.end<mE?leave.end:mE;
  if(s>e) return 0; return Math.round((new Date(e)-new Date(s))/86400000)+1;
}
function overlapDaysYear(leave,y) {
  const yS=`${y}-01-01`,yE=`${y}-12-31`;
  const s=leave.start>yS?leave.start:yS; const e=leave.end<yE?leave.end:yE;
  if(s>e) return 0; return Math.round((new Date(e)-new Date(s))/86400000)+1;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const S = {
  lbl: { display:"block", fontSize:11, fontWeight:700, color:"#8892A4", marginBottom:6, marginTop:14, textTransform:"uppercase", letterSpacing:0.5 },
  inp: { width:"100%", padding:"10px 14px", borderRadius:10, border:"1.5px solid #E8ECF4", fontSize:14, color:"#1a1f36", background:"#FAFBFD", boxSizing:"border-box", fontFamily:"inherit", outline:"none" },
  navBtn: { background:"#fff", border:"1.5px solid #E8ECF4", borderRadius:10, padding:"6px 12px", fontSize:17, cursor:"pointer", color:"#1a1f36", fontWeight:600, lineHeight:1.2 },
  card: { background:"#fff", borderRadius:20, boxShadow:"0 2px 12px #1a1f3610" },
};

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size=32, faded=false }) {
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:`hsl(${avatarHue(name)},55%,55%)`, color:"#fff", fontWeight:700, fontSize:size*0.38, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 1px 4px #0002", opacity:faded?0.45:1 }}>
      {initials(name)}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ type, small }) {
  const t = leaveType(type);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:t.bg, color:t.color, border:`1px solid ${t.color}22`, borderRadius:99, padding:small?"2px 8px":"4px 12px", fontSize:small?11:12, fontWeight:600, whiteSpace:"nowrap" }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:t.color, display:"inline-block" }}/>
      {type}
    </span>
  );
}

// ─── Manage Schedule Modal ────────────────────────────────────────────────────
function ManageScheduleModal({ team, schedule, onSave, onClose }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(schedule)));
  const activeMembers = team.filter(m => m.active);

  function assign(quarter, name, grp) {
    setDraft(d => ({
      ...d,
      [quarter]: { ...d[quarter], [name]: d[quarter]?.[name]===grp ? null : grp },
    }));
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"#0007", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"28px 24px", width:"100%", maxWidth:560, boxShadow:"0 24px 80px #0003", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:"#1a1f36" }}>Office Schedule</h2>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", fontSize:24, color:"#8892A4", lineHeight:1, padding:4 }}>×</button>
        </div>
        <div style={{ fontSize:12, color:"#8892A4", marginBottom:20 }}>Team A = Mon–Wed · Team B = Wed–Fri · Click to assign, click again to clear</div>
        <div style={{ overflowY:"auto", flex:1 }}>
          {QUARTERS.map((q,qi) => (
            <div key={q.key} style={{ marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:13, fontWeight:700, color:"#1a1f36" }}>{q.label}</span>
                <span style={{ fontSize:12, color:"#8892A4" }}>{q.months}</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {activeMembers.map(member => {
                  const assigned = draft[q.key]?.[member.name] || null;
                  return (
                    <div key={member.name} style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <Avatar name={member.name} size={28}/>
                      <span style={{ flex:1, fontSize:13, fontWeight:500, color:"#1a1f36" }}>{member.name}</span>
                      {["A","B"].map(grp => {
                        const t = OFFICE_TEAMS[grp];
                        const active = assigned===grp;
                        return (
                          <button key={grp} onClick={() => assign(q.key,member.name,grp)} style={{ padding:"4px 14px", borderRadius:99, border:`1.5px solid ${active?t.color:"#E8ECF4"}`, background:active?t.bg:"#fff", color:active?t.color:"#8892A4", fontWeight:700, fontSize:12, cursor:"pointer", transition:"all 0.15s" }}>
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {qi < QUARTERS.length-1 && <div style={{ borderBottom:"1px solid #EDF0F8", marginTop:16 }}/>}
            </div>
          ))}
        </div>
        <div style={{ borderTop:"1.5px solid #EDF0F8", paddingTop:16, marginTop:8 }}>
          <button onClick={() => onSave(draft)} style={{ width:"100%", padding:"12px 0", borderRadius:10, border:"none", background:"#1a1f36", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
            Save Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Manage Team Modal ────────────────────────────────────────────────────────
function ManageTeamModal({ team, onToggle, onAdd, onClose }) {
  const [newName, setNewName] = useState("");
  const allNames = team.map(m=>m.name);
  function handleAdd() { const t=newName.trim(); if(t&&!allNames.includes(t)){onAdd(t);setNewName("");} }
  return (
    <div style={{ position:"fixed", inset:0, background:"#0007", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"28px 24px", width:"100%", maxWidth:400, boxShadow:"0 24px 80px #0003", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:"#1a1f36" }}>Manage Team</h2>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", fontSize:24, color:"#8892A4", lineHeight:1, padding:4 }}>×</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, marginBottom:16 }}>
          {team.map(member => (
            <div key={member.name} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 2px", borderBottom:"1px solid #F0F2F8" }}>
              <Avatar name={member.name} size={36} faded={!member.active}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:member.active?"#1a1f36":"#9AAAB8", textDecoration:member.active?"none":"line-through" }}>{member.name}</div>
                {!member.active && <span style={{ fontSize:10, fontWeight:700, color:"#9AAAB8", textTransform:"uppercase", letterSpacing:0.5 }}>Left</span>}
              </div>
              <button onClick={() => onToggle(member.name)} style={{ width:44, height:24, borderRadius:99, border:"none", cursor:"pointer", background:member.active?"#1a1f36":"#D0D6E8", position:"relative", transition:"background 0.2s", flexShrink:0, padding:0 }}>
                <span style={{ position:"absolute", top:3, left:member.active?21:3, width:18, height:18, borderRadius:"50%", background:"#fff", boxShadow:"0 1px 4px #0003", transition:"left 0.2s", display:"block" }}/>
              </button>
            </div>
          ))}
        </div>
        <div style={{ borderTop:"1.5px solid #EDF0F8", paddingTop:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Add New Member</div>
          <div style={{ display:"flex", gap:8 }}>
            <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="Full name…" style={{ ...S.inp, flex:1, marginTop:0 }}/>
            <button onClick={handleAdd} style={{ padding:"10px 16px", borderRadius:10, border:"none", background:"#1a1f36", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", flexShrink:0 }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Leave Modal ──────────────────────────────────────────────────────────────
function LeaveModal({ initial, activeTeam, onSave, onClose, onDelete }) {
  const todayIso = isoDate(TODAY);
  const [form, setForm] = useState(() => initial||{ person:activeTeam[0]?.name??"", start:todayIso, end:todayIso, type:LEAVE_TYPES[0].label });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div style={{ position:"fixed", inset:0, background:"#0007", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"28px 24px", width:"100%", maxWidth:420, boxShadow:"0 24px 80px #0003" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:"#1a1f36" }}>{initial?"Edit Leave":"Add Leave"}</h2>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", fontSize:24, color:"#8892A4", lineHeight:1, padding:4 }}>×</button>
        </div>
        <label style={S.lbl}>Team Member</label>
        <select value={form.person} onChange={e=>set("person",e.target.value)} style={S.inp}>
          {activeTeam.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
        <label style={S.lbl}>Leave Type</label>
        <select value={form.type} onChange={e=>set("type",e.target.value)} style={S.inp}>
          {LEAVE_TYPES.map(t=><option key={t.label} value={t.label}>{t.code} — {t.label}</option>)}
        </select>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><label style={S.lbl}>Start Date</label><input type="date" value={form.start} onChange={e=>set("start",e.target.value)} style={S.inp}/></div>
          <div><label style={S.lbl}>End Date</label><input type="date" value={form.end} min={form.start} onChange={e=>set("end",e.target.value)} style={S.inp}/></div>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:22 }}>
          {initial && <button onClick={()=>onDelete(initial.id)} style={{ flex:1, padding:"12px 0", borderRadius:10, border:"1.5px solid #FFD0CC", background:"#FFF5F5", color:"#E05252", fontWeight:600, fontSize:14, cursor:"pointer" }}>Delete</button>}
          <button onClick={()=>onSave(form)} style={{ flex:2, padding:"12px 0", borderRadius:10, border:"none", background:"#1a1f36", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>{initial?"Save Changes":"Add Leave"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Office Overview ──────────────────────────────────────────────────────────
function OfficeOverview({ schedule, leaves, activeMembers, todayStr }) {
  const todayDow = TODAY.getDay();
  const todayQ   = quarterForDate(TODAY);
  const todayAssignments = schedule[todayQ] || {};
  const onLeaveToday = new Set(leaves.filter(l=>inRange(todayStr,l.start,l.end)).map(l=>l.person));
  const isPHtoday = PH_DATE_SET.has(todayStr) || OIL_DATE_SET.has(todayStr);

  const todayByTeam = { A:[], B:[] };
  activeMembers.forEach(m => {
    const grp = todayAssignments[m.name];
    if (grp && OFFICE_TEAMS[grp].days.includes(todayDow) && !onLeaveToday.has(m.name) && !isPHtoday) {
      todayByTeam[grp].push(m.name);
    }
  });

  const weekMon  = mondayOfWeek(TODAY);
  const weekDays = Array.from({length:5},(_,i)=>addDays(weekMon,i));
  const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri"];

  // members assigned to each team this quarter
  const teamAMembers = activeMembers.filter(m => todayAssignments[m.name]==="A");
  const teamBMembers = activeMembers.filter(m => todayAssignments[m.name]==="B");
  const hasSchedule  = teamAMembers.length>0 || teamBMembers.length>0;

  if (!hasSchedule) return (
    <div style={{ ...S.card, padding:20, marginBottom:18, textAlign:"center" }}>
      <div style={{ fontSize:13, color:"#B0BAC9" }}>No office schedule set for {quarterForDate(TODAY)}. Click <strong>Schedule</strong> to assign teams.</div>
    </div>
  );

  return (
    <div style={{ ...S.card, padding:20, marginBottom:18 }}>
      <div style={{ fontSize:11, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:1, marginBottom:14 }}>
        Office Schedule — {quarterForDate(TODAY)}
      </div>

      {/* Today's presence */}
      <div className="two" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 }}>
        {["A","B"].map(grp => {
          const t = OFFICE_TEAMS[grp];
          const members = todayByTeam[grp];
          const isOffDay = !t.days.includes(todayDow);
          return (
            <div key={grp} style={{ borderRadius:14, border:`1.5px solid ${isOffDay||isPHtoday?"#EDF0F8":t.color+"33"}`, padding:"14px 16px", background:isOffDay||isPHtoday?"#FAFBFD":t.bg+"99" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div>
                  <span style={{ fontSize:13, fontWeight:700, color:isOffDay||isPHtoday?"#B0BAC9":t.color }}>{t.label}</span>
                  <span style={{ fontSize:11, color:"#B0BAC9", marginLeft:6 }}>{t.dayNames}</span>
                </div>
                {!isOffDay && !isPHtoday && (
                  <span style={{ fontSize:12, fontWeight:700, color:t.color, background:t.bg, borderRadius:99, padding:"2px 10px", border:`1px solid ${t.color}33` }}>
                    {members.length} in office
                  </span>
                )}
              </div>
              {isPHtoday
                ? <div style={{ fontSize:12, color:"#B0BAC9" }}>Public holiday today</div>
                : isOffDay
                ? <div style={{ fontSize:12, color:"#B0BAC9" }}>Not in office today</div>
                : members.length===0
                ? <div style={{ fontSize:12, color:"#B0BAC9" }}>Everyone is out</div>
                : <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {members.map(name => (
                      <div key={name} style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <Avatar name={name} size={24}/>
                        <span style={{ fontSize:12, color:"#1a1f36", fontWeight:500 }}>{name.split(" ")[0]}</span>
                      </div>
                    ))}
                  </div>
              }
            </div>
          );
        })}
      </div>

      {/* This week grid */}
      <div style={{ fontSize:11, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>This Week</div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:340 }}>
          <thead>
            <tr>
              <td style={{ width:120, padding:"4px 8px 8px 0", fontSize:12, color:"#8892A4" }}></td>
              {weekDays.map((d,i) => {
                const ds = isoDate(d);
                const isToday = ds===todayStr;
                const isPHday = PH_DATE_SET.has(ds)||OIL_DATE_SET.has(ds);
                return (
                  <td key={i} style={{ textAlign:"center", padding:"4px 3px 8px", minWidth:52 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:isToday?"#1a1f36":isPHday?"#F7C94F":"#8892A4" }}>{DAY_LABELS[i]}</span>
                    {isToday && <span style={{ display:"block", width:4, height:4, borderRadius:"50%", background:"#1a1f36", margin:"2px auto 0" }}/>}
                    {isPHday && <span style={{ display:"block", fontSize:9, color:"#F7C94F", fontWeight:700 }}>PH</span>}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {["A","B"].map(grp => {
              const t = OFFICE_TEAMS[grp];
              const members = activeMembers.filter(m => (schedule[quarterForDate(TODAY)]?.[m.name])===grp);
              if (!members.length) return null;
              return members.map((member,mi) => (
                <tr key={member.name} style={{ borderTop:mi===0?"1.5px solid #EDF0F8":"1px solid #F5F6FA" }}>
                  <td style={{ padding:"5px 8px 5px 0" }}>
                    {mi===0 && (
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:t.color, display:"inline-block" }}/>
                        <span style={{ fontSize:11, fontWeight:700, color:t.color }}>{t.label}</span>
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:5, paddingLeft:12 }}>
                      <Avatar name={member.name} size={20}/>
                      <span style={{ fontSize:12, color:"#4A5568" }}>{member.name.split(" ")[0]}</span>
                    </div>
                  </td>
                  {weekDays.map((d,di) => {
                    const ds = isoDate(d);
                    const dow = d.getDay();
                    const inOffice = t.days.includes(dow);
                    const onLeave  = leaves.some(l=>l.person===member.name&&inRange(ds,l.start,l.end));
                    const isPHday  = PH_DATE_SET.has(ds)||OIL_DATE_SET.has(ds);
                    const isToday  = ds===todayStr;
                    let bg="#F8F9FC", color="#C0C8D8", label="—";
                    if      (isPHday)   { bg="#FFFBEE"; color="#F7C94F"; label="PH"; }
                    else if (onLeave)   { bg="#FFF2EE"; color="#F7724F"; label="Out"; }
                    else if (inOffice)  { bg=t.bg;      color=t.color;   label="In"; }
                    return (
                      <td key={di} style={{ textAlign:"center", padding:"4px 3px" }}>
                        <span style={{ display:"inline-block", borderRadius:6, padding:"3px 8px", background:bg, color, fontSize:11, fontWeight:700, border:isToday?`1.5px solid ${color}55`:"none" }}>
                          {label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function LeaveTracker() {
  const [team, setTeam]             = useState([]);
  const [leaves, setLeaves]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [calMonth, setCalMonth]     = useState({ y:TODAY.getFullYear(), m:TODAY.getMonth() });
  const [tableMonth, setTableMonth] = useState(TODAY.getMonth());
  const [modal, setModal]           = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule]     = useState({ Q1:{}, Q2:{}, Q3:{}, Q4:{} });

  useEffect(() => {
    async function load() {
      const { data:teamData }     = await supabase.from("team").select("*").order("name");
      const { data:leavesData }   = await supabase.from("leaves").select("*");
      const { data:scheduleData } = await supabase.from("office_schedule").select("*");
      setTeam(teamData||[]);
      setLeaves((leavesData||[]).map(l=>({...l,start:l.start_date,end:l.end_date})));
      const sched = { Q1:{}, Q2:{}, Q3:{}, Q4:{} };
      (scheduleData||[]).forEach(r => { if(!sched[r.quarter]) sched[r.quarter]={}; sched[r.quarter][r.name]=r.office_team; });
      setSchedule(sched);
      setLoading(false);
    }
    load();
  }, []);

  const todayStr = isoDate(TODAY);
  const { y, m } = calMonth;

  const todayPH  = phOnDay(todayStr);
  const todayOIL = oilOnDay(todayStr);

  const activeTeam = useMemo(() => team.filter(t=>t.active), [team]);
  const activeSet  = useMemo(() => new Set(activeTeam.map(t=>t.name)), [activeTeam]);

  const nextMon = useMemo(() => mondayOfWeek(addDays(TODAY,7)), []);
  const nextSun = useMemo(() => addDays(nextMon,6), [nextMon]);
  const nwStart = useMemo(() => isoDate(nextMon), [nextMon]);
  const nwEnd   = useMemo(() => isoDate(nextSun), [nextSun]);

  const todayLeaves    = useMemo(() => leaves.filter(l=>activeSet.has(l.person)&&inRange(todayStr,l.start,l.end)), [leaves,activeSet,todayStr]);
  const nextWeekLeaves = useMemo(() => leaves.filter(l=>activeSet.has(l.person)&&l.end>=nwStart&&l.start<=nwEnd), [leaves,activeSet,nwStart,nwEnd]);

  const totalDays  = daysInMonth(y,m);
  const firstDow   = new Date(y,m,1).getDay();
  const gridOffset = firstDow===0?6:firstDow-1;
  const cells = useMemo(() => {
    const arr=Array(gridOffset).fill(null);
    for(let d=1;d<=totalDays;d++) arr.push(d);
    return arr;
  }, [y,m,gridOffset,totalDays]);

  const leavesOnDay = (day) => {
    const ds=`${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return leaves.filter(l=>inRange(ds,l.start,l.end));
  };
  const phOilOnDay = (day) => {
    const ds=`${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const results=[]; const ph=phOnDay(ds); const oil=oilOnDay(ds);
    if(ph)  results.push({ id:`ph-${ds}`,  type:"Public Holiday", label:ph.name,  code:"PH",  color:"#F7C94F", bg:"#FFFBEE" });
    if(oil) results.push({ id:`oil-${ds}`, type:"Off-in-Lieu",    label:oil.name, code:"OIL", color:"#6C8EF7", bg:"#EEF1FF" });
    return results;
  };

  const memberRows = useMemo(() => {
    const isAll = tableMonth==="all";
    return team.map(member => {
      const { name, active } = member;
      const mine = leaves.filter(l=>l.person===name);
      const entries = isAll
        ? [...mine].sort((a,b)=>a.start.localeCompare(b.start))
        : mine.filter(l=>overlapDaysMonth(l,CURRENT_YEAR,tableMonth)>0).sort((a,b)=>a.start.localeCompare(b.start));
      if (!entries.length) return null;
      const byType={};
      entries.forEach(l=>{ const d=isAll?overlapDaysYear(l,CURRENT_YEAR):overlapDaysMonth(l,CURRENT_YEAR,tableMonth); byType[l.type]=(byType[l.type]||0)+d; });
      const monthTotal=Object.values(byType).reduce((a,b)=>a+b,0);
      const ytdDays=mine.reduce((s,l)=>s+overlapDaysYear(l,CURRENT_YEAR),0);
      return { name, active, byType, monthTotal, ytdDays, entries };
    }).filter(Boolean);
  }, [leaves,tableMonth,team]);

  const totalMonth = memberRows.reduce((s,r)=>s+r.monthTotal,0);
  const totalYTD   = memberRows.reduce((s,r)=>s+r.ytdDays,0);

  async function saveLeave(form) {
    if (modal==="add") {
      const { data } = await supabase.from("leaves").insert({ person:form.person, start_date:form.start, end_date:form.end, type:form.type }).select().single();
      setLeaves(ls=>[...ls,{...data,start:data.start_date,end:data.end_date}]);
    } else {
      await supabase.from("leaves").update({ person:form.person, start_date:form.start, end_date:form.end, type:form.type }).eq("id",modal.id);
      setLeaves(ls=>ls.map(l=>l.id===modal.id?{...form,id:modal.id}:l));
    }
    setModal(null);
  }
  async function deleteLeave(id) { await supabase.from("leaves").delete().eq("id",id); setLeaves(ls=>ls.filter(l=>l.id!==id)); setModal(null); }
  async function toggleMember(name) {
    const member=team.find(m=>m.name===name);
    await supabase.from("team").update({active:!member.active}).eq("name",name);
    setTeam(t=>t.map(m=>m.name===name?{...m,active:!m.active}:m));
  }
  async function addMember(name) {
    const { data } = await supabase.from("team").insert({name,active:true}).select().single();
    setTeam(t=>[...t,data]);
  }
  async function saveSchedule(draft) {
    const rows=[];
    QUARTERS.forEach(q=>{ Object.entries(draft[q.key]||{}).forEach(([name,office_team])=>{ if(office_team) rows.push({quarter:q.key,name,office_team}); }); });
    await supabase.from("office_schedule").delete().neq("quarter","__none__");
    if(rows.length) await supabase.from("office_schedule").insert(rows);
    setSchedule(draft); setScheduleOpen(false);
  }
  function prevCal() { setCalMonth(({y,m})=>m===0?{y:y-1,m:11}:{y,m:m-1}); }
  function nextCal() { setCalMonth(({y,m})=>m===11?{y:y+1,m:0}:{y,m:m+1}); }

  if (loading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"'DM Sans',sans-serif", color:"#8892A4", fontSize:16 }}>Loading…</div>;

  return (
    <div style={{ minHeight:"100vh", background:"#F4F6FB", fontFamily:"'DM Sans',sans-serif", padding:"20px 14px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box} button,select,input{font-family:inherit}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:.5}
        ::-webkit-scrollbar{width:5px;height:5px} ::-webkit-scrollbar-thumb{background:#D0D6E8;border-radius:99px}
        .hd:hover{background:#EEF1FB !important} .hr:hover{background:#F8F9FD !important}
        .eb{opacity:0 !important;transition:opacity .15s} .hr:hover .eb{opacity:1 !important}
        @media(max-width:640px){.two{grid-template-columns:1fr !important}.hsm{display:none !important}.cmh{min-height:44px !important}.mgrid{grid-template-columns:auto 1fr auto !important}}
        @media(min-width:641px){.cmh{min-height:80px}}
      `}</style>

      <div style={{ maxWidth:1100, margin:"0 auto" }}>

        {/* HEADER */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:22, gap:12 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>Department</div>
            <h1 style={{ margin:0, fontSize:26, fontWeight:400, color:"#1a1f36", fontFamily:"'DM Serif Display',serif" }}>Leave Tracker</h1>
          </div>
          <div style={{ display:"flex", gap:8, flexShrink:0 }}>
            <button onClick={()=>setScheduleOpen(true)} style={{ background:"#fff", color:"#1a1f36", border:"1.5px solid #E8ECF4", borderRadius:12, padding:"10px 16px", fontSize:14, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:15 }}>🏢</span><span className="hsm">Schedule</span>
            </button>
            <button onClick={()=>setManageOpen(true)} style={{ background:"#fff", color:"#1a1f36", border:"1.5px solid #E8ECF4", borderRadius:12, padding:"10px 16px", fontSize:14, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:15 }}>👥</span><span className="hsm">Team</span>
            </button>
            <button onClick={()=>setModal("add")} style={{ background:"#1a1f36", color:"#fff", border:"none", borderRadius:12, padding:"10px 18px", fontSize:14, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:7, boxShadow:"0 4px 16px #1a1f3628" }}>
              <span style={{ fontSize:20, lineHeight:1 }}>+</span><span className="hsm">Add Leave</span>
            </button>
          </div>
        </div>

        {/* OFFICE OVERVIEW */}
        <OfficeOverview schedule={schedule} leaves={leaves} activeMembers={activeTeam} todayStr={todayStr}/>

        {/* TODAY + NEXT WEEK */}
        <div className="two" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:18 }}>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:8 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:1 }}>Today</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#1a1f36" }}>{TODAY.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}</div>
              </div>
              <div style={{ background:todayLeaves.length?"#FFF3E0":"#F0FFF4", color:todayLeaves.length?"#E07B00":"#2D9E6B", borderRadius:99, padding:"4px 12px", fontSize:13, fontWeight:700, flexShrink:0 }}>{todayLeaves.length} away</div>
            </div>
            {(todayPH||todayOIL) && (
              <div style={{ background:todayPH?"#FFFBEE":"#EEF1FF", border:`1px solid ${todayPH?"#F7C94F":"#6C8EF7"}44`, borderRadius:10, padding:"8px 12px", marginBottom:10, fontSize:12, fontWeight:600, color:todayPH?"#B8860B":"#6C8EF7" }}>
                {todayPH?`Public Holiday: ${todayPH.name}`:`Off-in-Lieu: ${todayOIL.name}`}
              </div>
            )}
            {todayLeaves.length===0
              ? <div style={{ color:"#B0BAC9", fontSize:13 }}>{todayPH||todayOIL?"No additional leaves logged.":"Everyone is in today 🎉"}</div>
              : todayLeaves.map(l=>(
                <div key={l.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:9 }}>
                  <Avatar name={l.person} size={30}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:"#1a1f36", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.person}</div>
                    <Badge type={l.type} small/>
                  </div>
                  <button onClick={()=>setModal(l)} style={{ background:"none", border:"none", cursor:"pointer", color:"#C0C8D8", fontSize:16 }}>✎</button>
                </div>
              ))
            }
          </div>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:8 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:1 }}>Coming Up</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#1a1f36" }}>Next Week <span style={{ fontSize:11, fontWeight:500, color:"#8892A4", marginLeft:6 }}>{nextMon.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}–{nextSun.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span></div>
              </div>
              <div style={{ background:nextWeekLeaves.length?"#EEF4FF":"#F0FFF4", color:nextWeekLeaves.length?"#4F8EF7":"#2D9E6B", borderRadius:99, padding:"4px 12px", fontSize:13, fontWeight:700, flexShrink:0 }}>{nextWeekLeaves.length} away</div>
            </div>
            {nextWeekLeaves.length===0
              ? <div style={{ color:"#B0BAC9", fontSize:13 }}>No leaves next week</div>
              : nextWeekLeaves.map(l=>(
                <div key={l.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:9 }}>
                  <Avatar name={l.person} size={30}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:"#1a1f36", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.person}</div>
                    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:2 }}>
                      <Badge type={l.type} small/>
                      <span style={{ fontSize:11, color:"#8892A4", alignSelf:"center" }}>
                        {new Date(l.start+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})}
                        {l.start!==l.end&&` – ${new Date(l.end+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`}
                      </span>
                    </div>
                  </div>
                  <button onClick={()=>setModal(l)} style={{ background:"none", border:"none", cursor:"pointer", color:"#C0C8D8", fontSize:16 }}>✎</button>
                </div>
              ))
            }
          </div>
        </div>

        {/* CALENDAR */}
        <div style={{ ...S.card, padding:"22px 18px", marginBottom:18 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
            <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:"#1a1f36", fontFamily:"'DM Serif Display',serif" }}>{MONTHS[m]} {y}</h2>
            <div style={{ display:"flex", gap:7 }}>
              <button onClick={prevCal} style={S.navBtn}>‹</button>
              <button onClick={()=>setCalMonth({y:TODAY.getFullYear(),m:TODAY.getMonth()})} style={{...S.navBtn,fontSize:11,padding:"6px 11px",color:"#4F8EF7",borderColor:"#C5D8FF"}}>Today</button>
              <button onClick={nextCal} style={S.navBtn}>›</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=><div key={d} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.3, padding:"3px 0" }}>{d}</div>)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
            {cells.map((day,i)=>{
              if(!day) return <div key={`e${i}`}/>;
              const ds=`${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const dl=leavesOnDay(day); const system=phOilOnDay(day);
              const isPH=PH_DATE_SET.has(ds); const isOIL=OIL_DATE_SET.has(ds);
              const isToday=ds===todayStr; const isWeekend=i%7>=5;
              const allChips=[...system,...dl];
              const cellBg=isToday?"#1a1f36":isPH?"#FFFBEE":isOIL?"#EEF1FF":isWeekend?"#FAFBFE":"#fff";
              const cellBorder=isToday?"none":isPH?"1.5px solid #F7C94F55":isOIL?"1.5px solid #6C8EF755":`1.5px solid ${isWeekend?"#F0F2F8":"#EDF0F8"}`;
              return (
                <div key={day} className="hd cmh" onClick={()=>dl.length===0&&setModal("add")}
                  style={{ borderRadius:9, padding:"6px 7px", background:cellBg, border:cellBorder, cursor:"pointer", transition:"background 0.12s" }}>
                  <div style={{ fontSize:12, fontWeight:700, color:isToday?"#fff":isPH?"#B8860B":isOIL?"#6C8EF7":isWeekend?"#B0BAC9":"#1a1f36", marginBottom:3 }}>{day}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {system.map(s=>(
                      <div key={s.id} title={s.label} style={{ background:isToday?"rgba(255,255,255,0.18)":s.bg, color:isToday?"#fff":s.color, borderRadius:4, padding:"2px 5px", fontSize:10, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:3 }}>
                        <span style={{ flexShrink:0 }}>{s.code}</span>
                        <span className="hsm" style={{ fontWeight:500, overflow:"hidden", textOverflow:"ellipsis" }}>{s.label.replace(/^OIL \u2014 /,"")}</span>
                      </div>
                    ))}
                    {dl.slice(0,Math.max(0,3-system.length)).map(l=>{
                      const t=leaveType(l.type);
                      return <div key={l.id} onClick={e=>{e.stopPropagation();setModal(l);}}
                        style={{ background:isToday?"rgba(255,255,255,0.18)":t.bg, color:isToday?"#fff":t.color, borderRadius:4, padding:"2px 5px", fontSize:10, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                        <span style={{ flexShrink:0 }}>{t.code}</span>
                        <span className="hsm" style={{ fontWeight:500, overflow:"hidden", textOverflow:"ellipsis" }}>{l.person.split(" ")[0]}</span>
                      </div>;
                    })}
                    {allChips.length>3 && <div style={{ fontSize:10, color:isToday?"#ccc":"#8892A4", fontWeight:600, paddingLeft:2 }}>+{allChips.length-3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:18, paddingTop:14, borderTop:"1.5px solid #EDF0F8" }}>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:8, height:8, borderRadius:"50%", background:"#F7C94F", display:"inline-block" }}/><span style={{ fontSize:11, color:"#8892A4", fontWeight:600 }}>PH</span><span style={{ fontSize:11, color:"#B0BAC9" }}>Public Holiday</span></div>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:8, height:8, borderRadius:"50%", background:"#6C8EF7", display:"inline-block" }}/><span style={{ fontSize:11, color:"#8892A4", fontWeight:600 }}>OIL</span><span style={{ fontSize:11, color:"#B0BAC9" }}>Off-in-Lieu (Sun PH substitute)</span></div>
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              {LEAVE_TYPES.map(t=>(
                <div key={t.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:t.color, display:"inline-block", flexShrink:0 }}/>
                  <span style={{ fontSize:11, color:"#8892A4", fontWeight:600 }}>{t.code}</span>
                  <span style={{ fontSize:11, color:"#B0BAC9" }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ALL LEAVES */}
        <div style={{ ...S.card, padding:"22px 18px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18, gap:12, flexWrap:"wrap" }}>
            <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:"#1a1f36", fontFamily:"'DM Serif Display',serif" }}>All Leaves</h2>
            <select value={tableMonth} onChange={e=>setTableMonth(e.target.value==="all"?"all":Number(e.target.value))}
              style={{ padding:"8px 14px", borderRadius:10, border:"1.5px solid #E8ECF4", fontSize:13, fontWeight:600, color:"#1a1f36", background:"#FAFBFD", cursor:"pointer", outline:"none" }}>
              <option value="all">All Months {CURRENT_YEAR}</option>
              {MONTHS.map((mn,i)=><option key={i} value={i}>{mn} {CURRENT_YEAR}</option>)}
            </select>
          </div>
          {memberRows.length>0 && (
            <div style={{ display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap:12, padding:"0 14px 8px", borderBottom:"2px solid #EDF0F8", marginBottom:8 }}>
              <div style={{ width:36 }}/><div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5 }}>Member / Leave</div>
              <div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5, textAlign:"center", minWidth:54 }}>{tableMonth==="all"?"Total":MONTHS[tableMonth].slice(0,3)}</div>
              <div className="hsm" style={{ fontSize:10, fontWeight:700, color:"#4F8EF7", textTransform:"uppercase", letterSpacing:0.5, textAlign:"center", minWidth:54 }}>YTD</div>
            </div>
          )}
          {memberRows.length===0
            ? <div style={{ color:"#B0BAC9", fontSize:14, padding:"28px 0", textAlign:"center" }}>No leave records for this period.</div>
            : memberRows.map(row=>(
              <div key={row.name} style={{ marginBottom:6, borderRadius:14, border:"1.5px solid #EDF0F8", overflow:"hidden" }}>
                <div className="mgrid" style={{ display:"grid", gridTemplateColumns:"auto 1fr auto auto", alignItems:"center", gap:12, padding:"13px 14px", background:row.active?"#F8F9FC":"#F4F4F6", borderBottom:"1px solid #EDF0F8" }}>
                  <div style={{ position:"relative", flexShrink:0 }}>
                    <Avatar name={row.name} size={34} faded={!row.active}/>
                    {!row.active && <span style={{ position:"absolute", bottom:-1, right:-1, width:11, height:11, borderRadius:"50%", background:"#9AAAB8", border:"2px solid #fff", display:"block" }}/>}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:row.active?"#1a1f36":"#9AAAB8" }}>{row.name}</span>
                      {!row.active && <span style={{ fontSize:9, fontWeight:700, color:"#9AAAB8", textTransform:"uppercase", letterSpacing:0.5, background:"#EBEBEF", borderRadius:99, padding:"2px 7px" }}>Left</span>}
                    </div>
                    <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                      {Object.entries(row.byType).map(([type,days])=>{ const t=leaveType(type); return <span key={type} style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, color:t.color, fontWeight:600, background:t.bg, borderRadius:99, padding:"2px 8px", border:`1px solid ${t.color}22` }}><span style={{ width:6, height:6, borderRadius:"50%", background:t.color, display:"inline-block" }}/>{t.code} · {days}d</span>; })}
                    </div>
                  </div>
                  <div style={{ textAlign:"center", minWidth:54 }}>
                    <div style={{ fontSize:9, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.4 }}>{tableMonth==="all"?"Total":MONTHS[tableMonth].slice(0,3)}</div>
                    <div style={{ fontSize:22, fontWeight:700, color:"#1a1f36", lineHeight:1.15 }}>{row.monthTotal}<span style={{ fontSize:11, color:"#8892A4", fontWeight:500 }}>d</span></div>
                  </div>
                  <div className="hsm" style={{ textAlign:"center", minWidth:54 }}>
                    <div style={{ fontSize:9, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.4 }}>YTD</div>
                    <div style={{ fontSize:22, fontWeight:700, color:"#4F8EF7", lineHeight:1.15 }}>{row.ytdDays}<span style={{ fontSize:11, color:"#8892A4", fontWeight:500 }}>d</span></div>
                  </div>
                </div>
                {row.entries.map((l,idx)=>{ const days=Math.round((new Date(l.end)-new Date(l.start))/86400000)+1; const isPast=l.end<todayStr; const t=leaveType(l.type); return (
                  <div key={l.id} className="hr" style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", alignItems:"center", gap:10, padding:"9px 14px 9px 18px", borderBottom:idx<row.entries.length-1?"1px solid #F3F4F9":"none", opacity:isPast?0.55:1, background:"#fff", transition:"background 0.12s" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7 }}><span style={{ width:3, height:3, borderRadius:"50%", background:t.color, display:"inline-block", flexShrink:0 }}/><Badge type={l.type} small/></div>
                    <div className="hsm" style={{ fontSize:12, color:"#6B7280", whiteSpace:"nowrap" }}>{new Date(l.start+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})}{l.start!==l.end&&<> – {new Date(l.end+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</>}</div>
                    <div style={{ fontSize:12, color:"#8892A4", fontWeight:700, whiteSpace:"nowrap" }}>{days}d</div>
                    <button onClick={()=>setModal(l)} className="eb" style={{ background:"none", border:"none", cursor:"pointer", color:"#B0BAC9", fontSize:15, padding:"2px 4px" }}>✎</button>
                  </div>
                ); })}
              </div>
            ))
          }
          {memberRows.length>0 && (
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16, paddingTop:14, borderTop:"1.5px solid #EDF0F8" }}>
              <div style={{ textAlign:"center", padding:"0 20px", borderRight:"1.5px solid #EDF0F8" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5 }}>{tableMonth==="all"?"Total":"Month"} Days</div>
                <div style={{ fontSize:24, fontWeight:700, color:"#1a1f36" }}>{totalMonth}<span style={{ fontSize:12, color:"#8892A4" }}>d</span></div>
              </div>
              <div className="hsm" style={{ textAlign:"center", padding:"0 20px" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#8892A4", textTransform:"uppercase", letterSpacing:0.5 }}>YTD Days</div>
                <div style={{ fontSize:24, fontWeight:700, color:"#4F8EF7" }}>{totalYTD}<span style={{ fontSize:12, color:"#8892A4" }}>d</span></div>
              </div>
            </div>
          )}
        </div>

      </div>

      {modal && <LeaveModal initial={modal!=="add"?modal:null} activeTeam={activeTeam} onSave={saveLeave} onClose={()=>setModal(null)} onDelete={deleteLeave}/>}
      {manageOpen && <ManageTeamModal team={team} onToggle={toggleMember} onAdd={addMember} onClose={()=>setManageOpen(false)}/>}
      {scheduleOpen && <ManageScheduleModal team={team} schedule={schedule} onSave={saveSchedule} onClose={()=>setScheduleOpen(false)}/>}
    </div>
  );
}
