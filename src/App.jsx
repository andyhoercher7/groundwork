import { useState, useRef, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const fmt = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const today = new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const genCode = () => "GW-" + Math.random().toString(36).substring(2, 8).toUpperCase();

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function callClaude(messages, system) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system, messages }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.content?.find(b => b.type === "text")?.text || "";
  } catch (e) {
    throw new Error("Claude API call failed: " + e.message);
  }
}

function recomputeMilestoneStatus(m) {
  if (m.status === "Released") return "Released";
  if (m.contractorDone && m.homeownerDone) return "Ready to Release";
  if (m.contractorDone && !m.homeownerDone) return "Pending Homeowner";
  if (!m.contractorDone && m.homeownerDone) return "Pending Contractor";
  return "Upcoming";
}

const MILESTONE_COLOR = { Released: "#22c55e", "Pending Homeowner": "#f59e0b", "Pending Contractor": "#60a5fa", "Ready to Release": "#a78bfa", Disputed: "#ef4444", Upcoming: "#3b4266" };
const DOC_TYPES = ["Contract", "Estimate", "Permit", "Insurance", "Receipt", "Correspondence", "Inspection", "Photo", "Other"];
const DOC_ICON = { Contract: "📄", Estimate: "📋", Permit: "🏛️", Insurance: "🛡️", Receipt: "🧾", Correspondence: "✉️", Inspection: "🔍", Photo: "📷", Other: "📁" };
const EXP_CATS = ["Materials", "Labor", "Subcontractor", "Permit", "Other"];
const ROLE_CFG = {
  homeowner: { label: "Homeowner", color: "#60a5fa", bg: "#1e2d4a", avatar: "HO", greeting: "Andrew & Stephanie" },
  contractor: { label: "Contractor", color: "#c8a96e", bg: "#1e1c10", avatar: "CO", greeting: "MC Carpentry Plus" },
};

// IRS Capital Improvement Categories
const IRS_CATEGORIES = [
  { id: "addition",    label: "Additions",              desc: "Adding new rooms, garage, deck, porch",                qualifies: true  },
  { id: "hvac",        label: "HVAC Systems",            desc: "New heating, cooling, or ductwork systems",            qualifies: true  },
  { id: "plumbing",    label: "Plumbing",                desc: "New pipes, water heater, septic system",               qualifies: true  },
  { id: "electrical",  label: "Electrical",              desc: "New wiring, panel upgrades, permanent fixtures",       qualifies: true  },
  { id: "roofing",     label: "Roofing",                 desc: "New roof, skylights (not repairs)",                    qualifies: true  },
  { id: "flooring",    label: "Flooring",                desc: "New hardwood, tile, or permanent flooring",            qualifies: true  },
  { id: "bathroom",    label: "Bathroom Renovation",     desc: "Full bath remodel, new fixtures, tile",                qualifies: true  },
  { id: "kitchen",     label: "Kitchen Renovation",      desc: "Full kitchen remodel, cabinets, counters",             qualifies: true  },
  { id: "exterior",    label: "Exterior Improvements",   desc: "Siding, windows, doors (not repairs)",                 qualifies: true  },
  { id: "landscaping", label: "Landscaping",             desc: "Permanent landscaping, irrigation, fencing",           qualifies: true  },
  { id: "permits",     label: "Permit Fees",             desc: "Building permits required for improvements",           qualifies: true  },
  { id: "insulation",  label: "Insulation",              desc: "New insulation added to home",                         qualifies: true  },
  { id: "repair",      label: "Repairs & Maintenance",   desc: "Fixing existing items — does NOT increase basis",      qualifies: false },
  { id: "appliances",  label: "Appliances (movable)",    desc: "Freestanding appliances — does NOT increase basis",    qualifies: false },
  { id: "painting",    label: "Interior Painting",       desc: "Paint alone — does NOT increase basis",                qualifies: false },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE PROJECT DATA
// ═══════════════════════════════════════════════════════════════════════════════
const SAMPLE_PROJECT = {
  id: 1, name: "Basement Bathroom Renovation", address: "123 Maple St, Penfield, NY",
  homeowner: "Andrew & Stephanie", contractor: "MC Carpentry Plus Inc.",
  contractorLicense: "NY-HC-009821", startDate: "2025-10-01", endDate: "2025-12-15",
  contractValue: 18500, daysElapsed: 63, daysTotal: 75,
  homePurchasePrice: 285000, homePurchaseYear: 2019,
  milestones: [
    { id: 1, title: "Initial Deposit & Project Start", due: "2025-10-01", amount: 4625, contractorDone: true,  homeownerDone: true,  status: "Released", photos: [], description: "Contract signed, permit submitted, site prep begun.", paymentCode: "GW-A1B2C3", paymentDate: "2025-10-01" },
    { id: 2, title: "Rough-In Complete",               due: "2025-11-01", amount: 4625, contractorDone: true,  homeownerDone: true,  status: "Released", photos: [], description: "Framing, plumbing rough-in, electrical rough-in passed.", paymentCode: "GW-D4E5F6", paymentDate: "2025-11-02" },
    { id: 3, title: "Tile & Waterproofing Complete",   due: "2025-12-01", amount: 4625, contractorDone: true,  homeownerDone: false, status: "Pending Homeowner", photos: [], description: "All tile set, grout finished, shower pan waterproofed.", paymentCode: null, paymentDate: null },
    { id: 4, title: "Final Completion & Punch List",   due: "2025-12-15", amount: 4625, contractorDone: false, homeownerDone: false, status: "Upcoming", photos: [], description: "All work complete, punch list resolved, final walkthrough.", paymentCode: null, paymentDate: null },
  ],
  expenses: [
    { id: 1, date: "2025-10-05", category: "Materials",     description: "Cement board & backer",  amount: 342.50, paidBy: "Contractor", receipt: true,  approved: true,  receiptFile: null, irsCategory: "bathroom" },
    { id: 2, date: "2025-10-12", category: "Labor",         description: "Demo & framing",          amount: 1800,   paidBy: "Contractor", receipt: false, approved: true,  receiptFile: null, irsCategory: "bathroom" },
    { id: 3, date: "2025-10-18", category: "Materials",     description: "Tile & grout",             amount: 890.25, paidBy: "Homeowner",  receipt: true,  approved: true,  receiptFile: null, irsCategory: "flooring" },
    { id: 4, date: "2025-11-02", category: "Subcontractor", description: "Plumbing rough-in",       amount: 2200,   paidBy: "Contractor", receipt: true,  approved: false, receiptFile: null, irsCategory: "plumbing" },
    { id: 5, date: "2025-11-14", category: "Materials",     description: "Vanity & fixtures",        amount: 1640,   paidBy: "Homeowner",  receipt: true,  approved: true,  receiptFile: null, irsCategory: "bathroom" },
    { id: 6, date: "2025-11-28", category: "Labor",         description: "Tile installation",        amount: 2400,   paidBy: "Contractor", receipt: false, approved: false, receiptFile: null, irsCategory: "flooring" },
    { id: 7, date: "2025-12-03", category: "Materials",     description: "Drywall & paint",          amount: 415.75, paidBy: "Contractor", receipt: true,  approved: true,  receiptFile: null, irsCategory: "repair" },
  ],
  docs: [
    { id: 1, name: "Signed Contract",          type: "Contract",       date: "2025-09-28", size: "1.2 MB", url: null },
    { id: 2, name: "Building Permit",          type: "Permit",         date: "2025-10-02", size: "480 KB", url: null },
    { id: 3, name: "Insurance Certificate",    type: "Insurance",      date: "2025-10-01", size: "340 KB", url: null },
    { id: 4, name: "Scope of Work Addendum 1", type: "Contract",       date: "2025-10-20", size: "220 KB", url: null },
    { id: 5, name: "Punch List (Homeowner)",   type: "Correspondence", date: "2025-12-04", size: "95 KB",  url: null },
  ],
  disputes: [
    { id: 1, title: "Milestone 3 payment withheld — work incomplete", linkedMilestone: "Tile & Waterproofing Complete", raisedBy: "homeowner", date: "2025-12-05", priority: "High", status: "Open", amount: 4625, description: "Tile installation does not meet contract spec. Grout missing in shower corners. Water test not performed.", resolution: null, aiSummary: null,
      messages: [
        { id: 1, from: "homeowner", date: "2025-12-05", time: "9:14 AM",  text: "Work does not meet contract spec. Grout is missing in the NE shower corner and the water test was never performed. Withholding payment until punch list is complete.", attachments: [] },
        { id: 2, from: "contractor",date: "2025-12-06", time: "11:02 AM", text: "Work is substantially complete. A couple minor touch-up items remain. Payment is due at substantial completion per Section 4.1.", attachments: [] },
        { id: 3, from: "homeowner", date: "2025-12-07", time: "8:47 AM",  text: "Section 4.1 defines substantial completion as 95% complete with no open safety items. Missing waterproofing documentation is a safety item.", attachments: ["Punch_List_Dec4.pdf"] },
        { id: 4, from: "contractor",date: "2025-12-08", time: "2:30 PM",  text: "We can complete remaining items by December 12. Can we release 75% of the draw now and balance upon completion?", attachments: [] },
      ],
    },
  ],
  generalMessages: [
    { id: 1, from: "homeowner", date: "2025-12-01", time: "10:00 AM", text: "Quick check-in — are we still on track for December 15 completion?", attachments: [] },
    { id: 2, from: "contractor",date: "2025-12-01", time: "2:15 PM",  text: "Yes, we're on schedule. Tile work wraps this week, then fixtures and final paint next week.", attachments: [] },
    { id: 3, from: "homeowner", date: "2025-12-03", time: "9:30 AM",  text: "I walked the site yesterday. The grout in the NE corner looks incomplete.", attachments: [] },
    { id: 4, from: "contractor",date: "2025-12-03", time: "4:00 PM",  text: "Thanks for the heads up, I'll have it addressed by end of week.", attachments: [] },
  ],
  schedule: [
    { id: 1, phase: "Demo & Framing",     start: "2025-10-01", end: "2025-10-14", status: "Complete" },
    { id: 2, phase: "Rough-In (Plumbing/Electrical)", start: "2025-10-15", end: "2025-10-31", status: "Complete" },
    { id: 3, phase: "Tile & Waterproofing", start: "2025-11-01", end: "2025-11-30", status: "In Progress" },
    { id: 4, phase: "Fixtures & Vanity",  start: "2025-12-01", end: "2025-12-08", status: "Upcoming" },
    { id: 5, phase: "Paint & Trim",       start: "2025-12-09", end: "2025-12-12", status: "Upcoming" },
    { id: 6, phase: "Final Walkthrough",  start: "2025-12-15", end: "2025-12-15", status: "Upcoming" },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UI
// ═══════════════════════════════════════════════════════════════════════════════
function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, []);
  return <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: type === "success" ? "#1a2d1a" : "#2d1e1e", border: `1px solid ${type === "success" ? "#22c55e44" : "#ef444444"}`, borderRadius: 8, padding: "12px 18px", fontFamily: "'Lato',sans-serif", fontSize: 13, color: type === "success" ? "#22c55e" : "#ef4444", boxShadow: "0 8px 32px #00000066", animation: "fadeUp .3s ease" }}>{type === "success" ? "✓" : "✗"} {msg}</div>;
}

function DropZone({ onFile, accept, icon, label, sublabel }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  const drop = useCallback(e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }, [onFile]);
  return (
    <div onClick={() => ref.current.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop}
      style={{ border: `2px dashed ${drag ? "#c8a96e" : "#3b4266"}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "all .2s", background: drag ? "#1e1c10" : "#0f1117" }}>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 14, color: "#e2e8f0", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, fontFamily: "'Lato',sans-serif" }}>{sublabel}</div>
    </div>
  );
}

function Spinner({ icon = "⏳", label = "Processing..." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0" }}>
      <div style={{ position: "relative", width: 56, height: 56 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", border: "2px solid #252a3a", borderTop: "2px solid #c8a96e", animation: "spin 1s linear infinite" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#c8a96e", letterSpacing: "0.1em" }}>{label}</div>
    </div>
  );
}

function Avatar({ role, size = 30 }) {
  const c = ROLE_CFG[role] || { color: "#64748b", bg: "#252a3a", avatar: "?" };
  return <div style={{ width: size, height: size, borderRadius: "50%", background: c.bg, border: `2px solid ${c.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace", fontSize: size * .33, color: c.color, flexShrink: 0, fontWeight: 500 }}>{c.avatar}</div>;
}

function Modal({ title, onClose, children, maxWidth = 560 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 12, width: "100%", maxWidth, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #252a3a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      {label && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontFamily: "'Lato',sans-serif" }}>{label}</div>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 6, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", width: "100%", outline: "none" }} />
    </div>
  );
}

function Sel({ label, value, onChange, options }) {
  return (
    <div>
      {label && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontFamily: "'Lato',sans-serif" }}>{label}</div>}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 6, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", width: "100%", outline: "none" }}>
        {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, onClick, color = "#c8a96e", disabled = false, full = false, small = false }) {
  return <button disabled={disabled} onClick={onClick} style={{ background: disabled ? "#252a3a" : color, color: disabled ? "#444" : color === "#c8a96e" || color === "#22c55e" || color === "#f59e0b" ? "#0f1117" : "#fff", border: "none", borderRadius: 6, padding: small ? "6px 14px" : "10px 20px", fontFamily: "'Lato',sans-serif", fontWeight: 700, fontSize: small ? 12 : 13, cursor: disabled ? "not-allowed" : "pointer", width: full ? "100%" : "auto", transition: "all .2s" }}>{children}</button>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT HOME SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function ProjectWizard({ onSave, onClose }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", address: "", homeowner: "", contractor: "", contractorLicense: "", startDate: "", endDate: "", contractValue: "", homePurchasePrice: "", homePurchaseYear: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const steps = [
    { title: "Project Details", fields: [{ l: "Project Name", k: "name", ph: "e.g. Basement Bathroom Renovation" }, { l: "Property Address", k: "address", ph: "123 Main St, City, State" }] },
    { title: "Parties", fields: [{ l: "Homeowner Name(s)", k: "homeowner", ph: "e.g. John & Jane Smith" }, { l: "Contractor / Company", k: "contractor", ph: "e.g. ABC Renovations LLC" }, { l: "Contractor License #", k: "contractorLicense", ph: "NY-HC-000000" }] },
    { title: "Contract & Dates", fields: [{ l: "Contract Value ($)", k: "contractValue", ph: "0.00", t: "number" }, { l: "Start Date", k: "startDate", t: "date" }, { l: "End Date", k: "endDate", t: "date" }] },
    { title: "Home Info (for Cost Basis)", fields: [{ l: "Home Purchase Price ($)", k: "homePurchasePrice", ph: "0.00", t: "number" }, { l: "Year Purchased", k: "homePurchaseYear", ph: "2020", t: "number" }] },
  ];
  const cur = steps[step - 1];
  const canNext = cur.fields.every(f => !f.required || form[f.k]);

  return (
    <Modal title={`New Project — Step ${step} of ${steps.length}: ${cur.title}`} onClose={onClose} maxWidth={500}>
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {steps.map((_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < step ? "#c8a96e" : "#252a3a", transition: "background .3s" }} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
        {cur.fields.map(f => <Inp key={f.k} label={f.l} value={form[f.k]} onChange={v => set(f.k, v)} type={f.t || "text"} placeholder={f.ph || ""} />)}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {step > 1 && <Btn onClick={() => setStep(s => s - 1)} color="#252a3a">← Back</Btn>}
        {step < steps.length
          ? <Btn full onClick={() => setStep(s => s + 1)}>Next →</Btn>
          : <Btn full color="#22c55e" onClick={() => {
            onSave({ ...form, id: Date.now(), contractValue: parseFloat(form.contractValue) || 0, homePurchasePrice: parseFloat(form.homePurchasePrice) || 0, homePurchaseYear: parseInt(form.homePurchaseYear) || 2020, daysElapsed: 0, daysTotal: 90, milestones: [], expenses: [], docs: [], disputes: [], generalMessages: [], schedule: [] });
            onClose();
          }}>Create Project ✓</Btn>
        }
      </div>
    </Modal>
  );
}

function HomeScreen({ projects, onSelect, onNew }) {
  const [showCostBasis, setShowCostBasis] = useState(false);

  // Aggregate cost basis across all projects
  const firstProject = projects[0];
  const originalBasis = firstProject?.homePurchasePrice || 0;
  const purchaseYear = firstProject?.homePurchaseYear || "—";
  const allExpenses = projects.flatMap(p => (p.expenses || []).map(e => ({ ...e, projectName: p.name })));
  const qualifyingTotal = allExpenses.filter(e => {
    const cat = IRS_CATEGORIES.find(c => c.id === e.irsCategory);
    return cat?.qualifies && e.approved;
  }).reduce((s, e) => s + e.amount, 0);
  const adjustedBasis = originalBasis + qualifyingTotal;
  const estTaxSavings = qualifyingTotal * 0.15;

  return (
    <div style={{ fontFamily: "'Georgia',serif", background: "#0a0d14", minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 24px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=Lato:wght@300;400;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0;} @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}} @keyframes spin{to{transform:rotate(360deg);}}`}</style>
      <div style={{ textAlign: "center", marginBottom: 52, animation: "fadeUp .5s ease" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 42, fontWeight: 700, color: "#c8a96e", letterSpacing: "-0.02em", marginBottom: 8 }}>GroundWork</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#3b4266", letterSpacing: "0.18em" }}>RENOVATION MANAGEMENT PLATFORM</div>
        <div style={{ fontSize: 14, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 12 }}>Your projects, payments, and people — all in one place.</div>
      </div>

      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: "#e2e8f0" }}>Your Projects</div>
          <Btn onClick={onNew} color="#c8a96e">+ New Project</Btn>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {projects.map((p, i) => {
            const released = (p.milestones || []).filter(m => m.status === "Released").reduce((s, m) => s + m.amount, 0);
            const openDisp = (p.disputes || []).filter(d => d.status === "Open").length;
            const pct = p.contractValue > 0 ? Math.round((released / p.contractValue) * 100) : 0;
            return (
              <div key={p.id} onClick={() => onSelect(p.id)} style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 12, padding: "20px 24px", cursor: "pointer", transition: "all .2s", animation: `fadeUp .4s ease ${i * .07}s both` }}
                onMouseOver={e => e.currentTarget.style.borderColor = "#c8a96e44"} onMouseOut={e => e.currentTarget.style.borderColor = "#252a3a"}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0", marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>{p.address}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {openDisp > 0 && <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: "#2d1e1e", color: "#ef4444", border: "1px solid #3d2020" }}>⚠ {openDisp} Dispute{openDisp > 1 ? "s" : ""}</span>}
                    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: "#1a2d1a", color: "#22c55e", border: "1px solid #1f3d1f" }}>Open →</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
                  {[{ l: "Contract", v: fmt(p.contractValue) }, { l: "Released", v: fmt(released) }, { l: "Contractor", v: p.contractor || "—" }, { l: "Timeline", v: `${p.startDate} → ${p.endDate}` }].map(s => (
                    <div key={s.l}>
                      <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#3b4266", letterSpacing: "0.1em", marginBottom: 2 }}>{s.l.toUpperCase()}</div>
                      <div style={{ fontSize: 13, fontFamily: "'Lato',sans-serif", color: "#94a3b8" }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#0f1117", borderRadius: 4, height: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#c8a96e,#e8c97e)", borderRadius: 4, transition: "width .6s ease" }} />
                </div>
                <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{pct}% complete</div>
              </div>
            );
          })}

          {projects.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#3b4266" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#64748b", marginBottom: 8 }}>No projects yet</div>
              <div style={{ fontSize: 13, color: "#3b4266", fontFamily: "'Lato',sans-serif" }}>Click "+ New Project" to get started</div>
            </div>
          )}
        </div>

        {/* Cost Basis Section */}
        {projects.length > 0 && (
          <div style={{ marginTop: 36, animation: "fadeUp .6s ease .2s both" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: "#e2e8f0" }}>🏠 Cost Basis Tracker</div>
                <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 3 }}>Across all projects · IRS Publication 523</div>
              </div>
              <button onClick={() => setShowCostBasis(v => !v)} style={{ background: "none", border: "1px solid #252a3a", borderRadius: 6, color: "#64748b", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, cursor: "pointer", padding: "5px 12px" }}>
                {showCostBasis ? "Hide Details ▲" : "Show Details ▼"}
              </button>
            </div>

            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: showCostBasis ? 20 : 0 }}>
              {[
                { l: "Original Basis", v: fmt(originalBasis), a: "#64748b", sub: `Purchased ${purchaseYear}` },
                { l: "Improvements", v: fmt(qualifyingTotal), a: "#22c55e", sub: `${projects.length} project${projects.length !== 1 ? "s" : ""}` },
                { l: "Adjusted Basis", v: fmt(adjustedBasis), a: "#c8a96e", sub: "Current estimate" },
                { l: "Est. Tax Benefit", v: fmt(estTaxSavings), a: "#a78bfa", sub: "At 15% cap gains" },
              ].map(s => (
                <div key={s.l} style={{ background: "linear-gradient(135deg,#181c27,#1a1e2e)", border: `1px solid ${s.a}22`, borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#64748b", letterSpacing: "0.1em", marginBottom: 4 }}>{s.l.toUpperCase()}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: s.a, fontWeight: 500, marginBottom: 2 }}>{s.v}</div>
                  <div style={{ fontSize: 10, color: "#3b4266", fontFamily: "'Lato',sans-serif" }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Expanded detail */}
            {showCostBasis && (
              <div>
                <div style={{ background: "#1a1428", border: "1px solid #a78bfa33", borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 12, color: "#94a3b8", fontFamily: "'Lato',sans-serif", lineHeight: 1.8 }}>
                  ⚖️ A capital improvement must <strong style={{ color: "#e2e8f0" }}>add value</strong>, <strong style={{ color: "#e2e8f0" }}>prolong useful life</strong>, or <strong style={{ color: "#e2e8f0" }}>adapt to new uses</strong>. Repairs that maintain existing condition do <strong style={{ color: "#ef4444" }}>not</strong> qualify. Consult a CPA for your specific situation.
                </div>

                {projects.map(p => {
                  const pExpenses = (p.expenses || []).filter(e => { const cat = IRS_CATEGORIES.find(c => c.id === e.irsCategory); return cat?.qualifies && e.approved; });
                  const pTotal = pExpenses.reduce((s, e) => s + e.amount, 0);
                  if (pTotal === 0 && pExpenses.length === 0) return null;
                  return (
                    <div key={p.id} style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #252a3a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#e2e8f0" }}>{p.name}</div>
                        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#22c55e" }}>{fmt(pTotal)} qualifying</div>
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Lato',sans-serif", fontSize: 12 }}>
                        <tbody>
                          {pExpenses.map((e, i) => {
                            const cat = IRS_CATEGORIES.find(c => c.id === e.irsCategory);
                            return (
                              <tr key={e.id} style={{ borderBottom: "1px solid #1e2130", background: i % 2 === 0 ? "#181c27" : "#161926" }}>
                                <td style={{ padding: "8px 14px", color: "#e2e8f0" }}>{e.description}</td>
                                <td style={{ padding: "8px 14px", color: "#64748b" }}>{cat?.label || e.irsCategory}</td>
                                <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: "#c8a96e" }}>{fmt(e.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}

                <div style={{ padding: "12px 16px", background: "#181c27", border: "1px dashed #252a3a", borderRadius: 8, fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>
                  💡 Save all receipts, permits, and contractor invoices. Your adjusted cost basis reduces taxable capital gain when you sell.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function HealthRing({ pct, color, label, size = 72 }) {
  const r = (size - 12) / 2, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#252a3a" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 1s ease" }} />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle"
          style={{ transform: `rotate(90deg) translate(0,-${size}px)`, transformOrigin: `${size / 2}px ${size / 2}px` }}
          fill={color} fontSize={size * .2} fontFamily="'IBM Plex Mono',monospace" fontWeight="500">{pct}%</text>
      </svg>
      <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

function DashboardView({ project, role, setTab, setActiveDispute }) {
  const { milestones, expenses, disputes } = project;
  const cfg = ROLE_CFG[role];
  const released = milestones.filter(m => m.status === "Released").reduce((s, m) => s + m.amount, 0);
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
  const openDisp = disputes.filter(d => d.status === "Open").length;
  const daysLeft = project.daysTotal - project.daysElapsed;
  const unapproved = expenses.filter(e => !e.approved).reduce((s, e) => s + e.amount, 0);
  const mDone = milestones.filter(m => m.status === "Released").length;
  const checks = [{ l: "Contract on file", ok: project.docs?.some(d => d.type === "Contract") }, { l: "Permits obtained", ok: project.docs?.some(d => d.type === "Permit") }, { l: "Insurance verified", ok: project.docs?.some(d => d.type === "Insurance") }, { l: "All draws current", ok: false }, { l: "No open disputes", ok: openDisp === 0 }, { l: "Expenses approved", ok: unapproved === 0 }, { l: "Final inspection done", ok: false }];
  const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
  const actions = role === "homeowner"
    ? [{ l: "Approve Milestone 3", i: "✓", c: "#22c55e", u: true, tab: "milestones" }, { l: "Reply to Dispute", i: "💬", c: "#ef4444", u: true, tab: "disputes" }, { l: "Scan Receipt", i: "🧾", c: "#c8a96e", u: false, tab: "financials" }, { l: "View Documents", i: "📁", c: "#a78bfa", u: false, tab: "documents" }]
    : [{ l: "Respond to Dispute", i: "⚖️", c: "#ef4444", u: true, tab: "disputes" }, { l: "Upload Photo", i: "📷", c: "#f59e0b", u: true, tab: "milestones" }, { l: "Submit Expense", i: "💰", c: "#c8a96e", u: false, tab: "financials" }, { l: "Update Schedule", i: "📅", c: "#60a5fa", u: false, tab: "milestones" }];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: cfg.color, letterSpacing: "0.1em", marginBottom: 6 }}>{cfg.label.toUpperCase()} DASHBOARD</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.2 }}>Good morning,<br /><span style={{ color: cfg.color }}>{cfg.greeting}</span></div>
        </div>
        {openDisp > 0
          ? <span style={{ padding: "4px 14px", borderRadius: 20, background: "#2d1e1e", color: "#ef4444", border: "1px solid #3d2020", fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>● In Dispute</span>
          : <span style={{ padding: "4px 14px", borderRadius: 20, background: "#1a2d1a", color: "#22c55e", border: "1px solid #1f3d1f", fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>● On Track</span>}
      </div>

      {/* Progress strip */}
      <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: "16px 20px", marginBottom: 22 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 8 }}>CONTRACT PROGRESS · {mDone}/{milestones.length} MILESTONES</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {milestones.map(m => <div key={m.id} style={{ flex: 1, height: 6, background: MILESTONE_COLOR[m.status] || "#252a3a", borderRadius: 3 }} />)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "'Lato',sans-serif", color: "#64748b" }}>
          <span>{fmt(released)} released of {fmt(project.contractValue)}</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "#c8a96e" }}>{project.contractValue > 0 ? Math.round((released / project.contractValue) * 100) : 0}%</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
        {[{ l: "Contract Value", v: fmt(project.contractValue), a: "#c8a96e" }, { l: "Released to Date", v: fmt(released), a: "#22c55e" }, { l: "Days Remaining", v: daysLeft, a: daysLeft < 14 ? "#ef4444" : "#60a5fa" }, { l: "Open Disputes", v: openDisp, a: openDisp > 0 ? "#ef4444" : "#22c55e" }].map((s, i) => (
          <div key={s.l} style={{ background: "linear-gradient(135deg,#181c27,#1a1e2e)", border: `1px solid ${s.a}22`, borderRadius: 10, padding: "16px 18px", animation: `fadeUp .5s ease ${i * .07}s both` }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 5 }}>{s.l.toUpperCase()}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 20, color: s.a, fontWeight: 500 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e2e8f0", marginBottom: 10 }}>Your Action Items</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {actions.map((a, i) => {
                const [hov, setHov] = useState(false);
                return <div key={a.l} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={() => setTab(a.tab)} style={{ background: hov ? a.c + "18" : "#181c27", border: `1px solid ${a.u ? a.c + "55" : "#252a3a"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", transition: "all .2s", display: "flex", alignItems: "center", gap: 10, animation: `fadeUp .4s ease ${i * .08}s both` }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: a.c + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{a.i}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: hov ? a.c : "#e2e8f0" }}>{a.l}</div>
                    {a.u && <div style={{ fontSize: 10, color: a.c, fontFamily: "'IBM Plex Mono',monospace", marginTop: 1, letterSpacing: "0.06em" }}>● ACTION NEEDED</div>}
                  </div>
                  <div style={{ fontSize: 14, color: "#3b4266" }}>→</div>
                </div>;
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: 18 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#e2e8f0", marginBottom: 14 }}>Project Health</div>
            <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 14 }}>
              <HealthRing pct={project.contractValue > 0 ? Math.round((totalExp / project.contractValue) * 100) : 0} color="#c8a96e" label="BUDGET" />
              <HealthRing pct={milestones.length > 0 ? Math.round((mDone / milestones.length) * 100) : 0} color="#22c55e" label="MILESTONES" />
              <HealthRing pct={project.daysTotal > 0 ? Math.round((project.daysElapsed / project.daysTotal) * 100) : 0} color="#60a5fa" label="SCHEDULE" />
              <HealthRing pct={score} color={score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444"} label="OVERALL" />
            </div>
            {checks.map((c, i) => <div key={c.l} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < checks.length - 1 ? "1px solid #1a1e2e" : "none" }}><span style={{ color: c.ok ? "#22c55e" : "#3b4266", fontSize: 12, width: 14 }}>{c.ok ? "✓" : "○"}</span><span style={{ fontSize: 11, fontFamily: "'Lato',sans-serif", color: c.ok ? "#94a3b8" : "#64748b" }}>{c.l}</span></div>)}
          </div>
          {openDisp > 0 && (
            <div style={{ background: "#1e1010", border: "1px solid #ef444444", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><span style={{ fontSize: 18 }}>⚠️</span><div><div style={{ fontFamily: "'Playfair Display',serif", fontSize: 13, color: "#ef4444", marginBottom: 2 }}>Active Dispute</div><div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Lato',sans-serif" }}>{disputes.find(d => d.status === "Open")?.title}</div></div></div>
              <Btn full color="#ef4444" onClick={() => { setTab("disputes"); setActiveDispute(disputes.find(d => d.status === "Open")?.id); }}>Go to Dispute →</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MILESTONES (multi-photo + schedule)
// ═══════════════════════════════════════════════════════════════════════════════
function MilestonesView({ project, updateProject, role }) {
  const { milestones, schedule } = project;
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleData, setScheduleData] = useState(schedule || []);
  const [form, setForm] = useState({ title: "", due: "", amount: "", description: "" });
  const photoRef = useRef();

  const updateMilestone = (id, changes) => {
    const updated = milestones.map(m => {
      if (m.id !== id) return m;
      const u = { ...m, ...changes };
      if (!("status" in changes)) u.status = recomputeMilestoneStatus(u);
      return u;
    });
    updateProject({ milestones: updated });
    setSelected(id);
  };

  const addPhotos = (milestoneId, files) => {
    const m = milestones.find(m => m.id === milestoneId);
    if (!m) return;
    const existing = m.photos || [];
    if (existing.length >= 5) return;
    const toAdd = Array.from(files).slice(0, 5 - existing.length);
    Promise.all(toAdd.map(f => new Promise(res => { const r = new FileReader(); r.onload = e => res({ url: e.target.result, name: f.name }); r.readAsDataURL(f); }))).then(newPhotos => {
      updateMilestone(milestoneId, { photos: [...existing, ...newPhotos] });
    });
  };

  const sel = selected ? milestones.find(m => m.id === selected) : null;
  const released = milestones.filter(m => m.status === "Released").reduce((s, m) => s + m.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0", marginBottom: 4 }}>Milestones & Payments</div>
          <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>{fmt(released)} of {fmt(project.contractValue)} released</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn color="#1e2d4a" onClick={() => setShowSchedule(true)}>📅 Schedule</Btn>
          <Btn onClick={() => setShowAdd(true)}>+ Add Milestone</Btn>
        </div>
      </div>

      {/* Progress */}
      <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
          {milestones.map(m => <div key={m.id} style={{ flex: 1, height: 5, background: MILESTONE_COLOR[m.status] || "#252a3a", borderRadius: 3 }} />)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "'Lato',sans-serif", color: "#64748b" }}>
          <span>{milestones.filter(m => m.status === "Released").length} of {milestones.length} milestones released</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: "#c8a96e" }}>{project.contractValue > 0 ? Math.round((released / project.contractValue) * 100) : 0}%</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {milestones.map((m, i) => {
          const color = MILESTONE_COLOR[m.status] || "#3b4266";
          const photos = m.photos || [];
          return (
            <div key={m.id} onClick={() => setSelected(m.id)} style={{ background: "#181c27", border: "1px solid #252a3a", borderLeft: `3px solid ${color}`, borderRadius: 10, cursor: "pointer", transition: "all .2s", animation: `fadeUp .4s ease ${i * .07}s both` }}
              onMouseOver={e => e.currentTarget.style.borderColor = color + "66"} onMouseOut={e => e.currentTarget.style.borderColor = "#252a3a"}>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <div style={{ width: 52, display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #252a3a" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, color: m.status === "Released" ? "#c8a96e" : "#252a3a" }}>{String(m.id).padStart(2, "0")}</div>
                </div>
                <div style={{ flex: 1, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#e2e8f0" }}>{m.title}</span>
                    <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", background: color + "22", color, border: `1px solid ${color}44` }}>{m.status}</span>
                    {photos.length > 0 && <span style={{ fontSize: 11, color: "#22c55e", fontFamily: "'IBM Plex Mono',monospace" }}>📷 {photos.length}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[{ l: "Contractor", d: m.contractorDone, c: "#c8a96e" }, { l: "Homeowner", d: m.homeownerDone, c: "#60a5fa" }].map(p => (
                      <span key={p.l} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", background: p.d ? p.c + "22" : "#1e2130", color: p.d ? p.c : "#3b4266", border: `1px solid ${p.d ? p.c + "44" : "#252a3a"}` }}>{p.d ? "✓" : "○"} {p.l}</span>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "14px 16px", borderLeft: "1px solid #252a3a", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", minWidth: 100 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: m.status === "Released" ? "#22c55e" : "#e2e8f0" }}>{fmt(m.amount)}</div>
                  <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 2 }}>Due {m.due}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Milestone detail modal */}
      {sel && (
        <Modal title={sel.title} onClose={() => setSelected(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#0f1117", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", marginBottom: 4 }}>DRAW AMOUNT</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, color: "#c8a96e" }}>{fmt(sel.amount)}</div>
            </div>
            <div style={{ background: "#0f1117", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", marginBottom: 4 }}>DUE DATE</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#e2e8f0" }}>{sel.due}</div>
            </div>
          </div>
          {sel.description && <div style={{ marginBottom: 16, padding: "10px 14px", background: "#0f1117", borderRadius: 8, fontSize: 13, color: "#94a3b8", fontFamily: "'Lato',sans-serif", lineHeight: 1.6 }}>{sel.description}</div>}

          {/* Confirmations */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 8 }}>DUAL CONFIRMATION</div>
            {[{ l: "Contractor", d: sel.contractorDone, c: "#c8a96e" }, { l: "Homeowner", d: sel.homeownerDone, c: "#60a5fa" }].map(p => (
              <div key={p.l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#0f1117", borderRadius: 8, border: `1px solid ${p.d ? p.c + "33" : "#252a3a"}`, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: p.d ? p.c + "22" : "#252a3a", border: `2px solid ${p.d ? p.c : "#3b4266"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: p.d ? p.c : "#3b4266", flexShrink: 0 }}>{p.d ? "✓" : "○"}</div>
                <div><div style={{ fontSize: 13, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: p.d ? "#e2e8f0" : "#64748b" }}>{p.l}</div><div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b" }}>{p.d ? "Confirmed" : "Not yet confirmed"}</div></div>
              </div>
            ))}
          </div>

          {/* Photos */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em" }}>COMPLETION PHOTOS ({(sel.photos || []).length}/5)</div>
              {(sel.photos || []).length < 5 && <button onClick={() => photoRef.current.click()} style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 5, color: "#94a3b8", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontFamily: "'Lato',sans-serif" }}>+ Add Photo</button>}
            </div>
            <input ref={photoRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => addPhotos(sel.id, e.target.files)} />
            {(sel.photos || []).length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {(sel.photos || []).map((p, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={p.url} alt={p.name} style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #252a3a" }} />
                    <button onClick={e => { e.stopPropagation(); updateMilestone(sel.id, { photos: (sel.photos || []).filter((_, j) => j !== i) }); }} style={{ position: "absolute", top: 3, right: 3, background: "#000000aa", border: "none", borderRadius: "50%", color: "#ef4444", width: 18, height: 18, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                  </div>
                ))}
                {(sel.photos || []).length < 5 && <div onClick={() => photoRef.current.click()} style={{ height: 90, border: "2px dashed #3b4266", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#3b4266", cursor: "pointer" }}>+</div>}
              </div>
            ) : (
              <div onClick={() => photoRef.current.click()} style={{ border: "2px dashed #3b4266", borderRadius: 8, padding: "20px 0", textAlign: "center", cursor: "pointer" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>📷</div>
                <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>Upload up to 5 completion photos</div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!sel.contractorDone && role === "contractor" && <Btn full color="#c8a96e" onClick={() => updateMilestone(sel.id, { contractorDone: true })}>✓ Confirm as Contractor — Work Complete</Btn>}
            {!sel.homeownerDone && role === "homeowner" && <Btn full color="#60a5fa" onClick={() => updateMilestone(sel.id, { homeownerDone: true })}>✓ Confirm as Homeowner — Work Accepted</Btn>}
            {sel.status === "Ready to Release" && role === "homeowner" && <Btn full color="#22c55e" onClick={() => updateMilestone(sel.id, { status: "Released", paymentCode: genCode(), paymentDate: today })}>🔓 Release {fmt(sel.amount)} — Both Confirmed</Btn>}
          </div>
        </Modal>
      )}

      {/* Add milestone */}
      {showAdd && (
        <Modal title="New Milestone" onClose={() => setShowAdd(false)} maxWidth={440}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            {[{ l: "Title", k: "title", t: "text", ph: "e.g. Drywall Complete" }, { l: "Due Date", k: "due", t: "date" }, { l: "Draw Amount ($)", k: "amount", t: "number", ph: "0.00" }].map(f => (
              <Inp key={f.k} label={f.l} value={form[f.k]} onChange={v => setForm({ ...form, [f.k]: v })} type={f.t || "text"} placeholder={f.ph || ""} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn full disabled={!form.title || !form.due || !form.amount} onClick={() => {
              updateProject({ milestones: [...milestones, { id: milestones.length + 1, title: form.title, due: form.due, amount: parseFloat(form.amount), contractorDone: false, homeownerDone: false, status: "Upcoming", photos: [], description: "" }] });
              setForm({ title: "", due: "", amount: "", description: "" }); setShowAdd(false);
            }}>Add Milestone</Btn>
            <Btn color="#252a3a" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {/* Schedule modal */}
      {showSchedule && (
        <Modal title="Project Schedule" onClose={() => setShowSchedule(false)} maxWidth={640}>
          <div style={{ marginBottom: 16, fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>Track project phases and update status as work progresses.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {scheduleData.map((s, i) => (
              <div key={s.id} style={{ background: "#0f1117", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: "#e2e8f0", marginBottom: 2 }}>{s.phase}</div>
                  <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b" }}>{s.start} → {s.end}</div>
                </div>
                <select value={s.status} onChange={e => setScheduleData(scheduleData.map((x, j) => j === i ? { ...x, status: e.target.value } : x))}
                  style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 5, color: s.status === "Complete" ? "#22c55e" : s.status === "In Progress" ? "#f59e0b" : "#64748b", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, padding: "4px 8px", outline: "none" }}>
                  <option>Upcoming</option><option>In Progress</option><option>Complete</option><option>Delayed</option>
                </select>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #252a3a", paddingTop: 14, display: "flex", gap: 10 }}>
            <Btn full onClick={() => { updateProject({ schedule: scheduleData }); setShowSchedule(false); }}>Save Schedule</Btn>
            <Btn color="#252a3a" onClick={() => setShowSchedule(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIALS
// ═══════════════════════════════════════════════════════════════════════════════
function FinancialsView({ project, updateProject }) {
  const { expenses } = project;
  const [showScan, setShowScan] = useState(false);
  const [stage, setStage] = useState("upload");
  const [preview, setPreview] = useState(null);
  const [scanned, setScanned] = useState(null);
  const [linkTarget, setLinkTarget] = useState("");
  const [scanErr, setScanErr] = useState("");

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const handleScanFile = async f => {
    setPreview(URL.createObjectURL(f));
    setStage("scanning"); setScanErr("");
    try {
      const b64 = await fileToBase64(f);
      const isImg = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf";
      const contentBlock = isImg
        ? { type: "image", source: { type: "base64", media_type: f.type, data: b64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
      const msgs = [{ role: "user", content: [contentBlock, { type: "text", text: `This is a purchase receipt. Extract all details and respond ONLY with a valid JSON object — no markdown, no explanation, no code fences. Required fields: date (YYYY-MM-DD or empty string), vendor (store name), amount (number, total amount paid), description (brief description of what was bought), category (one of: Materials, Labor, Subcontractor, Permit, Other), confidence (low, medium, or high). Example: {"date":"2025-10-05","vendor":"Floor & Decor","amount":342.50,"description":"Tile and grout supplies","category":"Materials","confidence":"high"}` }] }];
      const sys = "You are a receipt data extractor for a construction project management app. Always return only valid JSON with no markdown formatting, no code fences, no explanation. Just the raw JSON object.";
      const raw = await callClaude(msgs, sys);
      const clean = raw.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(clean);
      setScanned({ ...parsed, paidBy: "Contractor" });
      setStage("review");
    } catch (e) {
      setScanErr("Could not auto-parse receipt. Please fill in the details manually below.");
      setScanned({ date: "", vendor: "", amount: "", description: "", category: "Materials", paidBy: "Contractor", confidence: "low" });
      setStage("review");
    }
  };

  const saveScan = () => {
    if (linkTarget) {
      updateProject({ expenses: expenses.map(e => String(e.id) === String(linkTarget) ? { ...e, receipt: true, receiptFile: preview } : e) });
    } else {
      updateProject({ expenses: [...expenses, { id: expenses.length + 1, date: scanned.date || today, category: scanned.category || "Materials", description: scanned.description || scanned.vendor || "Scanned receipt", amount: parseFloat(scanned.amount) || 0, paidBy: scanned.paidBy || "Contractor", receipt: true, approved: false, receiptFile: preview, irsCategory: "bathroom" }] });
    }
    setShowScan(false); setStage("upload"); setPreview(null); setScanned(null); setLinkTarget("");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0", marginBottom: 4 }}>Expense Ledger</div>
          <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>{expenses.length} entries · {fmt(total)} total</div>
        </div>
        <Btn onClick={() => setShowScan(true)}>🧾 Scan Receipt</Btn>
      </div>

      <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Lato',sans-serif", fontSize: 13 }}>
          <thead><tr style={{ background: "#0f1117", borderBottom: "1px solid #252a3a" }}>{["Date", "Category", "Description", "Paid By", "Amount", "Receipt", "Status"].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.1em", color: "#64748b", fontWeight: 400 }}>{h}</th>)}</tr></thead>
          <tbody>
            {expenses.map((e, i) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #1e2130", background: i % 2 === 0 ? "#181c27" : "#161926" }}>
                <td style={{ padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#64748b" }}>{e.date}</td>
                <td style={{ padding: "10px 14px" }}><span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: e.category === "Labor" ? "#1e2d4a" : e.category === "Subcontractor" ? "#2d1e3a" : "#1e2d1e", color: e.category === "Labor" ? "#60a5fa" : e.category === "Subcontractor" ? "#a78bfa" : "#4ade80" }}>{e.category}</span></td>
                <td style={{ padding: "10px 14px", color: "#e2e8f0" }}>{e.description}</td>
                <td style={{ padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: e.paidBy === "Contractor" ? "#c8a96e" : "#60a5fa" }}>{e.paidBy}</td>
                <td style={{ padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500, color: "#e2e8f0" }}>{fmt(e.amount)}</td>
                <td style={{ padding: "10px 14px" }}>{e.receiptFile ? <img src={e.receiptFile} alt="r" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", border: "1px solid #3b4266" }} /> : <span style={{ color: e.receipt ? "#22c55e" : "#3b4266", fontSize: 13 }}>{e.receipt ? "✓" : "—"}</span>}</td>
                <td style={{ padding: "10px 14px" }}><span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", background: e.approved ? "#1a2d1a" : "#2d2a1a", color: e.approved ? "#22c55e" : "#f59e0b", border: `1px solid ${e.approved ? "#1f3d1f" : "#3d371a"}` }}>{e.approved ? "Approved" : "Pending"}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ background: "#0f1117", borderTop: "2px solid #252a3a" }}><td colSpan={4} style={{ padding: "11px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em" }}>TOTAL EXPENSES</td><td style={{ padding: "11px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, color: "#c8a96e" }}>{fmt(total)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>

      {showScan && (
        <Modal title="Receipt Scanner" onClose={() => { setShowScan(false); setStage("upload"); setPreview(null); setScanned(null); }}>
          {stage === "upload" && <DropZone onFile={handleScanFile} accept="image/*,application/pdf" icon="🧾" label="Drop your receipt here" sublabel="JPG, PNG, HEIC, or PDF — Claude extracts all details" />}
          {stage === "scanning" && <Spinner icon="🧾" label="READING RECEIPT..." />}
          {stage === "review" && scanned && (
            <div>
              {scanErr && <div style={{ background: "#2d1e1e", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#f87171", fontFamily: "'Lato',sans-serif", marginBottom: 14, lineHeight: 1.5 }}>{scanErr}</div>}
              {preview && <img src={preview} alt="receipt" style={{ width: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 8, border: "1px solid #252a3a", background: "#0f1117", marginBottom: 14 }} />}
              {scanned.confidence && <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b" }}>EXTRACTION CONFIDENCE</span>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: scanned.confidence === "high" ? "#1a2d1a" : scanned.confidence === "medium" ? "#2d2a1a" : "#2d1e1e", color: scanned.confidence === "high" ? "#22c55e" : scanned.confidence === "medium" ? "#f59e0b" : "#ef4444" }}>{scanned.confidence.toUpperCase()}</span>
              </div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                {[{ l: "Date", k: "date", t: "date" }, { l: "Amount ($)", k: "amount", t: "number" }, { l: "Vendor", k: "vendor", t: "text" }, { l: "Description", k: "description", t: "text" }].map(f => <Inp key={f.k} label={f.l} value={scanned[f.k] || ""} onChange={v => setScanned({ ...scanned, [f.k]: v })} type={f.t} />)}
                <Sel label="Category" value={scanned.category} onChange={v => setScanned({ ...scanned, category: v })} options={EXP_CATS} />
                <Sel label="Paid By" value={scanned.paidBy || "Contractor"} onChange={v => setScanned({ ...scanned, paidBy: v })} options={["Contractor", "Homeowner"]} />
              </div>
              <div style={{ background: "#0f1117", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#c8a96e", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.08em", marginBottom: 8 }}>LINK TO EXISTING EXPENSE?</div>
                <Sel label="" value={linkTarget} onChange={setLinkTarget} options={[{ value: "", label: "— Create new expense entry —" }, ...expenses.map(e => ({ value: String(e.id), label: `${e.date} · ${e.description} · ${fmt(e.amount)}` }))]} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn full onClick={saveScan}>{linkTarget ? "Attach to Expense" : "Create New Entry"}</Btn>
                <Btn color="#252a3a" onClick={() => { setStage("upload"); setPreview(null); setScanned(null); }}>Try Again</Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS (with viewer)
// ═══════════════════════════════════════════════════════════════════════════════
function DocumentsView({ project, updateProject }) {
  const { docs } = project;
  const [showUpload, setShowUpload] = useState(false);
  const [upStage, setUpStage] = useState("upload");
  const [upFile, setUpFile] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [docName, setDocName] = useState("");
  const [viewing, setViewing] = useState(null);

  const handleUpFile = async f => {
    setUpFile(f); setUpStage("scanning");
    try {
      const b64 = await fileToBase64(f);
      const isImg = f.type.startsWith("image/"), isPdf = f.type === "application/pdf";
      const content = [];
      if (isImg) content.push({ type: "image", source: { type: "base64", media_type: f.type, data: b64 } });
      else if (isPdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
      content.push({ type: "text", text: `Filename: "${f.name}". Respond ONLY with JSON (no markdown): {type (Contract|Permit|Insurance|Receipt|Correspondence|Inspection|Photo|Other), suggestedName, confidence (low|medium|high), reason}` });
      const raw = await callClaude([{ role: "user", content }], "You are a document classifier. Return only valid JSON.");
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setSuggested(parsed); setConfirmed(parsed.type); setDocName(parsed.suggestedName || f.name.replace(/\.[^.]+$/, ""));
    } catch {
      setSuggested({ type: "Other", suggestedName: f.name.replace(/\.[^.]+$/, ""), confidence: "low", reason: "Could not auto-detect." });
      setConfirmed("Other"); setDocName(f.name.replace(/\.[^.]+$/, ""));
    }
    setUpStage("confirm");
  };

  const saveDoc = () => {
    const url = upFile ? URL.createObjectURL(upFile) : null;
    const mimeType = upFile?.type || "";
    updateProject({ docs: [...docs, { id: docs.length + 1, name: docName, type: confirmed, date: today, size: upFile ? `${(upFile.size / 1024).toFixed(0)} KB` : "—", url, mimeType }] });
    setShowUpload(false); setUpStage("upload"); setUpFile(null); setSuggested(null); setConfirmed(null); setDocName("");
  };

  const grouped = DOC_TYPES.filter(t => docs.some(d => d.type === t));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0", marginBottom: 4 }}>Documents</div>
          <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>{docs.length} files · Click any document to view it</div>
        </div>
        <Btn onClick={() => setShowUpload(true)}>↑ Upload Document</Btn>
      </div>

      {grouped.map(type => (
        <div key={type} style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.14em", color: "#64748b", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {DOC_ICON[type]} {type.toUpperCase()}
            <span style={{ background: "#252a3a", borderRadius: 4, padding: "1px 7px", color: "#3b4266", fontSize: 10 }}>{docs.filter(d => d.type === type).length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {docs.filter(d => d.type === type).map((d, i) => (
              <div key={d.id} style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 9, display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", animation: `fadeUp .4s ease ${i * .06}s both` }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "#0f1117", border: "1px solid #252a3a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{DOC_ICON[d.type] || "📁"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: "#e2e8f0" }}>{d.name}</div>
                  <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b", marginTop: 2 }}>{d.date} · {d.size}</div>
                </div>
                {d.url && <Btn small color="#1e2d4a" onClick={() => setViewing(d)}>👁 View</Btn>}
                {d.url && <a href={d.url} download={d.name}><Btn small color="#252a3a">↓</Btn></a>}
                {!d.url && <span style={{ fontSize: 11, color: "#3b4266", fontFamily: "'IBM Plex Mono',monospace" }}>Sample</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Document viewer */}
      {viewing && (
        <div style={{ position: "fixed", inset: 0, background: "#000000ee", zIndex: 300, display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#0d1020", borderBottom: "1px solid #252a3a", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18 }}>{DOC_ICON[viewing.type] || "📁"}</span>
            <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: "#e2e8f0", flex: 1 }}>{viewing.name}</span>
            <a href={viewing.url} download={viewing.name}><Btn small color="#252a3a">↓ Download</Btn></a>
            <button onClick={() => setViewing(null)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer", marginLeft: 8 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            {viewing.mimeType?.startsWith("image/")
              ? <img src={viewing.url} alt={viewing.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
              : viewing.mimeType === "application/pdf"
                ? <iframe src={viewing.url} style={{ width: "100%", height: "calc(100vh - 100px)", border: "none", borderRadius: 8 }} title={viewing.name} />
                : <div style={{ color: "#64748b", fontFamily: "'Lato',sans-serif", fontSize: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>{DOC_ICON[viewing.type] || "📁"}</div>
                  <div>{viewing.name}</div>
                  <div style={{ marginTop: 10 }}><a href={viewing.url} download={viewing.name}><Btn color="#c8a96e">↓ Download to View</Btn></a></div>
                </div>}
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <Modal title="Upload Document" onClose={() => setShowUpload(false)} maxWidth={500}>
          {upStage === "upload" && <DropZone onFile={handleUpFile} accept="*/*" icon="📁" label="Drop any project document" sublabel="PDF, images, Word docs — Claude suggests the category" />}
          {upStage === "scanning" && <Spinner icon="📁" label="CLASSIFYING DOCUMENT..." />}
          {upStage === "confirm" && suggested && (
            <div>
              <div style={{ background: "#0f1117", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b", letterSpacing: "0.1em", marginBottom: 8 }}>AI SUGGESTION</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{DOC_ICON[suggested.type] || "📁"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#c8a96e" }}>{suggested.type}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 2 }}>{suggested.reason}</div>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: suggested.confidence === "high" ? "#1a2d1a" : suggested.confidence === "medium" ? "#2d2a1a" : "#2d1e1e", color: suggested.confidence === "high" ? "#22c55e" : suggested.confidence === "medium" ? "#f59e0b" : "#ef4444" }}>{suggested.confidence?.toUpperCase()}</span>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}><Inp label="Document Name" value={docName} onChange={setDocName} /></div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontFamily: "'Lato',sans-serif" }}>Confirm Category</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {DOC_TYPES.map(t => <button key={t} onClick={() => setConfirmed(t)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12, fontFamily: "'Lato',sans-serif", cursor: "pointer", background: confirmed === t ? "#c8a96e" : "#252a3a", color: confirmed === t ? "#0f1117" : "#94a3b8", border: `1px solid ${confirmed === t ? "#c8a96e" : "#3b4266"}`, fontWeight: confirmed === t ? 700 : 400 }}>{DOC_ICON[t]} {t}</button>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn full onClick={saveDoc}>Save Document</Btn>
                <Btn color="#252a3a" onClick={() => setShowUpload(false)}>Cancel</Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS (simulated transfer)
// ═══════════════════════════════════════════════════════════════════════════════
function PaymentsView({ project, updateProject, role }) {
  const { milestones } = project;
  const [sending, setSending] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const initTransfer = (m) => setSending(m);
  const executeTransfer = () => {
    const code = genCode();
    const updated = milestones.map(m => m.id === sending.id ? { ...m, status: "Released", paymentCode: code, paymentDate: today } : m);
    updateProject({ milestones: updated });
    setReceipt({ ...sending, code, date: today });
    setSending(null);
  };
  const confirmReceipt = (m) => {
    updateProject({ milestones: milestones.map(x => x.id === m.id ? { ...x, receivedConfirmed: true, receivedDate: today } : x) });
  };

  const released = milestones.filter(m => m.status === "Released").reduce((s, m) => s + m.amount, 0);

  return (
    <div>
      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0", marginBottom: 6 }}>Payments</div>
      <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif", marginBottom: 22 }}>Milestone draw schedule with simulated transfer & confirmation receipts</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        {[{ l: "Total Contract", v: fmt(project.contractValue), a: "#c8a96e" }, { l: "Released", v: fmt(released), a: "#22c55e" }, { l: "Remaining", v: fmt(project.contractValue - released), a: "#f59e0b" }].map(s => (
          <div key={s.l} style={{ background: "linear-gradient(135deg,#181c27,#1a1e2e)", border: `1px solid ${s.a}22`, borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 4 }}>{s.l.toUpperCase()}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 20, color: s.a }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {milestones.map((m, i) => {
          const color = MILESTONE_COLOR[m.status] || "#3b4266";
          const canSend = m.status === "Ready to Release" && role === "homeowner";
          const canConfirm = m.status === "Released" && !m.receivedConfirmed && role === "contractor";
          return (
            <div key={m.id} style={{ background: "#181c27", border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "18px 20px", animation: `fadeUp .4s ease ${i * .07}s both` }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#3b4266" }}>M{m.id}</span>
                    <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: color + "22", color, border: `1px solid ${color}44` }}>{m.status}</span>
                    {m.receivedConfirmed && <span style={{ fontSize: 11, color: "#22c55e", fontFamily: "'IBM Plex Mono',monospace" }}>✓ Received</span>}
                  </div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e2e8f0", marginBottom: 4 }}>{m.title}</div>
                  {m.paymentCode && (
                    <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#22c55e", background: "#1a2d1a", padding: "2px 8px", borderRadius: 4 }}>🔑 {m.paymentCode}</span>
                      {m.paymentDate && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#64748b" }}>Sent {m.paymentDate}</span>}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 20, color: m.status === "Released" ? "#22c55e" : "#e2e8f0" }}>{fmt(m.amount)}</div>
                  <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 3 }}>Due {m.due}</div>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {canSend && <Btn small color="#22c55e" onClick={() => initTransfer(m)}>💸 Send Payment</Btn>}
                    {canConfirm && <Btn small color="#60a5fa" onClick={() => confirmReceipt(m)}>✓ Confirm Received</Btn>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transfer confirmation modal */}
      {sending && (
        <Modal title="Confirm Payment Transfer" onClose={() => setSending(null)} maxWidth={440}>
          <div style={{ background: "#0f1117", borderRadius: 10, padding: 20, marginBottom: 20, textAlign: "center" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#64748b", marginBottom: 8 }}>TRANSFER AMOUNT</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 36, color: "#22c55e", fontWeight: 500 }}>{fmt(sending.amount)}</div>
            <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 8 }}>To: {project.contractor}</div>
            <div style={{ fontSize: 12, color: "#3b4266", fontFamily: "'Lato',sans-serif", marginTop: 2 }}>For: {sending.title}</div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Lato',sans-serif", lineHeight: 1.7, marginBottom: 20, padding: "10px 14px", background: "#181c27", borderRadius: 8, border: "1px solid #252a3a" }}>
            ⚠️ <strong style={{ color: "#f59e0b" }}>Demo Mode:</strong> This simulates a payment transfer and generates a confirmation code. In the full version, this connects to your bank account via Stripe Treasury.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn full color="#22c55e" onClick={executeTransfer}>✓ Confirm & Send {fmt(sending.amount)}</Btn>
            <Btn color="#252a3a" onClick={() => setSending(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {/* Receipt modal */}
      {receipt && (
        <Modal title="Payment Receipt" onClose={() => setReceipt(null)} maxWidth={420}>
          <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: "#22c55e", marginBottom: 4 }}>Payment Sent</div>
            <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>A confirmation has been logged to both parties</div>
          </div>
          <div style={{ background: "#0f1117", borderRadius: 10, padding: 20, marginBottom: 16 }}>
            {[{ l: "Confirmation Code", v: receipt.code, big: true, color: "#c8a96e" }, { l: "Amount", v: fmt(receipt.amount), color: "#22c55e" }, { l: "Milestone", v: receipt.title }, { l: "To", v: project.contractor }, { l: "Date", v: receipt.date }].map(r => (
              <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid #1a1e2e" }}>
                <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b", letterSpacing: "0.08em" }}>{r.l.toUpperCase()}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: r.big ? 16 : 13, color: r.color || "#e2e8f0", fontWeight: r.big ? 600 : 400 }}>{r.v}</span>
              </div>
            ))}
          </div>
          <Btn full onClick={() => setReceipt(null)}>Done</Btn>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COST BASIS CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════
function CostBasisView({ project, updateProject }) {
  const { expenses } = project;
  const [expCats, setExpCats] = useState(() => {
    const map = {};
    expenses.forEach(e => { map[e.id] = e.irsCategory || "bathroom"; });
    return map;
  });

  const qualifying = expenses.filter(e => {
    const cat = IRS_CATEGORIES.find(c => c.id === (expCats[e.id] || e.irsCategory));
    return cat?.qualifies && e.approved;
  });
  const nonQualifying = expenses.filter(e => {
    const cat = IRS_CATEGORIES.find(c => c.id === (expCats[e.id] || e.irsCategory));
    return !cat?.qualifies && e.approved;
  });

  const qualifyingTotal = qualifying.reduce((s, e) => s + e.amount, 0);
  const originalBasis = project.homePurchasePrice || 0;
  const newBasis = originalBasis + qualifyingTotal;
  const potentialTaxSavings = qualifyingTotal * 0.15; // approx 15% capital gains

  const saveCategories = () => {
    updateProject({ expenses: expenses.map(e => ({ ...e, irsCategory: expCats[e.id] || e.irsCategory })) });
  };

  return (
    <div>
      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0", marginBottom: 4 }}>Cost Basis Calculator</div>
      <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif", marginBottom: 22 }}>Based on IRS Publication 523 — only capital improvements increase your home's cost basis</div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { l: "Original Basis", v: fmt(originalBasis), a: "#64748b", sub: `Purchased ${project.homePurchaseYear || "—"}` },
          { l: "Qualifying Improvements", v: fmt(qualifyingTotal), a: "#22c55e", sub: `${qualifying.length} approved items` },
          { l: "New Adjusted Basis", v: fmt(newBasis), a: "#c8a96e", sub: "After this project" },
          { l: "Est. Tax Benefit", v: fmt(potentialTaxSavings), a: "#a78bfa", sub: "At 15% cap gains rate" },
        ].map(s => (
          <div key={s.l} style={{ background: "linear-gradient(135deg,#181c27,#1a1e2e)", border: `1px solid ${s.a}22`, borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", marginBottom: 5 }}>{s.l.toUpperCase()}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, color: s.a, fontWeight: 500, marginBottom: 3 }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#3b4266", fontFamily: "'Lato',sans-serif" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* IRS info box */}
      <div style={{ background: "#1a1428", border: "1px solid #a78bfa33", borderRadius: 10, padding: 18, marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>⚖️</span>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#a78bfa" }}>IRS Capital Improvement Rules</div>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Lato',sans-serif", lineHeight: 1.8 }}>
          A capital improvement must <strong style={{ color: "#e2e8f0" }}>add value</strong> to your home, <strong style={{ color: "#e2e8f0" }}>prolong its useful life</strong>, or <strong style={{ color: "#e2e8f0" }}>adapt it to new uses</strong>. Repairs that simply maintain existing condition do <strong style={{ color: "#ef4444" }}>not</strong> qualify. Keep all receipts for at least 3 years after you sell. Consult a tax professional for your specific situation.
        </div>
      </div>

      {/* Expense categorization */}
      <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #252a3a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e2e8f0" }}>Classify Each Expense</div>
          <Btn small onClick={saveCategories}>Save Classifications</Btn>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Lato',sans-serif", fontSize: 13 }}>
          <thead><tr style={{ background: "#0f1117" }}>{["Description", "Amount", "IRS Category", "Qualifies"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.08em", fontWeight: 400 }}>{h}</th>)}</tr></thead>
          <tbody>
            {expenses.map((e, i) => {
              const catId = expCats[e.id] || e.irsCategory || "bathroom";
              const cat = IRS_CATEGORIES.find(c => c.id === catId);
              const qualifies = cat?.qualifies && e.approved;
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid #1e2130", background: i % 2 === 0 ? "#181c27" : "#161926" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ color: "#e2e8f0" }}>{e.description}</div>
                    {!e.approved && <div style={{ fontSize: 10, color: "#f59e0b", fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>⏳ Pending approval — not counted</div>}
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#e2e8f0" }}>{fmt(e.amount)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <select value={catId} onChange={ev => setExpCats({ ...expCats, [e.id]: ev.target.value })}
                      style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 5, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 12, padding: "5px 8px", outline: "none", maxWidth: 200 }}>
                      {IRS_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}{!c.qualifies ? " ✗" : " ✓"}</option>)}
                    </select>
                    <div style={{ fontSize: 10, color: "#3b4266", fontFamily: "'Lato',sans-serif", marginTop: 3 }}>{cat?.desc}</div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: qualifies ? "#1a2d1a" : "#2d1e1e", color: qualifies ? "#22c55e" : "#ef4444", border: `1px solid ${qualifies ? "#1f3d1f" : "#3d2020"}` }}>
                      {qualifies ? "✓ Qualifies" : "✗ Does Not"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "12px 16px", background: "#181c27", border: "1px dashed #252a3a", borderRadius: 8, fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>
        💡 <strong style={{ color: "#94a3b8" }}>Tip:</strong> Save all your receipts, permits, and contractor invoices. When you sell your home, your adjusted cost basis reduces your taxable capital gain. This calculator is for estimation only — consult a CPA for tax advice.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPUTES & MESSAGING
// ═══════════════════════════════════════════════════════════════════════════════
function DisputesView({ project, updateProject, role, activeDispute, setActiveDispute }) {
  const { disputes, generalMessages } = project;
  const [msgTab, setMsgTab] = useState("disputes");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ title: "", description: "", amount: "", priority: "Medium" });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const fileRef = useRef();
  const bottomRef = useRef();

  const activeD = disputes.find(d => d.id === activeDispute);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeD?.messages, generalMessages, msgTab]);

  const send = () => {
    if (!input.trim() && attachments.length === 0) return;
    const msg = { id: Date.now(), from: role, date: today, time: nowTime(), text: input.trim(), attachments: attachments.map(f => f.name) };
    if (msgTab === "disputes" && activeD) {
      updateProject({ disputes: disputes.map(d => d.id === activeD.id ? { ...d, messages: [...d.messages, msg] } : d) });
    } else {
      updateProject({ generalMessages: [...generalMessages, msg] });
    }
    setInput(""); setAttachments([]);
  };

  const generateMediation = async () => {
    if (!activeD) return;
    setAiLoading(true); setAiError("");
    try {
      const transcript = activeD.messages.map(m => `[${ROLE_CFG[m.from]?.label || m.from} — ${m.date}]: ${m.text}`).join("\n");
      const sys = `You are a neutral construction dispute mediator. Analyze this dispute and respond with ONLY a valid JSON object — no markdown, no code fences, no explanation. Use this exact structure: {"summary":"...","homeownerPosition":"...","contractorPosition":"...","commonGround":"...","suggestedResolution":"...","urgency":"low|medium|high"}`;
      const raw = await callClaude([{ role: "user", content: `Dispute title: "${activeD.title}"\nAmount in dispute: $${activeD.amount}\nDescription: ${activeD.description}\n\nConversation transcript:\n${transcript}\n\nProvide a neutral mediation analysis.` }], sys);
      const clean = raw.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(clean);
      updateProject({ disputes: disputes.map(d => d.id === activeD.id ? { ...d, aiSummary: parsed } : d) });
    } catch (e) {
      setAiError("Could not generate summary. Please check your connection and try again. Error: " + e.message);
    }
    setAiLoading(false);
  };

  const openCount = disputes.filter(d => d.status === "Open").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 140px)" }}>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #252a3a", marginBottom: 16 }}>
        {[{ id: "disputes", label: "Disputes", badge: openCount }, { id: "messages", label: "General Messaging" }].map(t => (
          <button key={t.id} onClick={() => setMsgTab(t.id)} style={{ background: "none", border: "none", color: msgTab === t.id ? "#c8a96e" : "#64748b", fontFamily: "'Lato',sans-serif", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", padding: "8px 16px", borderBottom: msgTab === t.id ? "2px solid #c8a96e" : "2px solid transparent", transition: "all .2s" }}>
            {t.label}{t.badge > 0 && <span style={{ marginLeft: 6, background: "#ef4444", color: "#fff", borderRadius: "50%", width: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {msgTab === "disputes" && (
        <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 14, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#e2e8f0" }}>Disputes</span>
              <Btn small color="#ef4444" onClick={() => setShowNew(true)}>+ File</Btn>
            </div>
            {disputes.map(d => {
              const sc = { Open: { c: "#ef4444", bg: "#2d1e1e", b: "#3d2020" }, Mediation: { c: "#a78bfa", bg: "#2d1e3a", b: "#3d205f" }, Resolved: { c: "#22c55e", bg: "#1a2d1a", b: "#1f3d1f" } }[d.status] || { c: "#64748b", bg: "#1e2130", b: "#252a3a" };
              return (
                <div key={d.id} onClick={() => setActiveDispute(d.id)} style={{ background: activeDispute === d.id ? "#1e1a1a" : "#181c27", border: `1px solid ${activeDispute === d.id ? "#ef444466" : "#252a3a"}`, borderRadius: 8, padding: "11px 13px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: "#e2e8f0", flex: 1, lineHeight: 1.3 }}>{d.title}</div>
                    <span style={{ padding: "2px 7px", borderRadius: 20, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", background: sc.bg, color: sc.c, border: `1px solid ${sc.b}`, flexShrink: 0 }}>{d.status}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#64748b" }}>
                    {d.amount > 0 && <span style={{ color: "#c8a96e" }}>{fmt(d.amount)}</span>}
                    <span>💬 {d.messages.length}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {activeD ? (
            <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #252a3a" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: "#e2e8f0", marginBottom: 4 }}>{activeD.title}</div>
                    <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif", lineHeight: 1.5 }}>{activeD.description}</div>
                    {activeD.amount > 0 && <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#c8a96e", marginTop: 4 }}>{fmt(activeD.amount)} in dispute</div>}
                  </div>
                  {activeD.status === "Open" && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <Btn small color="#2d1e3a" onClick={() => updateProject({ disputes: disputes.map(d => d.id === activeD.id ? { ...d, status: "Mediation" } : d) })}>⚖️ Mediate</Btn>
                      <Btn small color="#1a2d1a" onClick={() => updateProject({ disputes: disputes.map(d => d.id === activeD.id ? { ...d, status: "Resolved", resolution: today } : d) })}>✓ Resolve</Btn>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", paddingRight: 4, marginBottom: 12 }}>
                {/* AI Mediation panel */}
                {(activeD.status === "Open" || activeD.status === "Mediation") && (
                  <div style={{ background: "#1a1428", border: "1px dashed #a78bfa55", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>⚖️</span>
                      <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "#a78bfa" }}>AI Mediation Assistant</span>
                    </div>
                    {!activeD.aiSummary && !aiLoading && (
                      <>
                        <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif", marginBottom: 10, lineHeight: 1.6 }}>Claude will read the full dispute thread and provide a neutral analysis with suggested resolution.</div>
                        <Btn small color="#a78bfa" onClick={generateMediation}>⚖️ Generate Mediation Summary</Btn>
                      </>
                    )}
                    {aiLoading && <Spinner icon="⚖️" label="ANALYZING DISPUTE..." />}
                    {aiError && <div style={{ fontSize: 12, color: "#f87171", fontFamily: "'Lato',sans-serif", lineHeight: 1.5, marginTop: 8, padding: "8px 12px", background: "#2d1e1e", borderRadius: 6 }}>{aiError}<br /><button onClick={generateMediation} style={{ marginTop: 8, background: "#a78bfa", border: "none", borderRadius: 5, color: "#0f1117", padding: "5px 12px", fontFamily: "'Lato',sans-serif", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>Try Again</button></div>}
                    {activeD.aiSummary && !aiLoading && (
                      <div>
                        <div style={{ fontSize: 12, color: "#cbd5e1", fontFamily: "'Lato',sans-serif", lineHeight: 1.7, marginBottom: 10, padding: "10px 12px", background: "#0f0c1a", borderRadius: 8 }}>{activeD.aiSummary.summary}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                          {[{ l: "🏠 Homeowner", t: activeD.aiSummary.homeownerPosition, c: "#60a5fa" }, { l: "🔨 Contractor", t: activeD.aiSummary.contractorPosition, c: "#c8a96e" }].map(p => (
                            <div key={p.l} style={{ background: "#0f0c1a", borderRadius: 7, padding: "10px 12px", borderLeft: `3px solid ${p.c}` }}>
                              <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: p.c, letterSpacing: "0.08em", marginBottom: 4 }}>{p.l.toUpperCase()}</div>
                              <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Lato',sans-serif", lineHeight: 1.5 }}>{p.t}</div>
                            </div>
                          ))}
                        </div>
                        {activeD.aiSummary.suggestedResolution && <div style={{ background: "#1f1535", borderRadius: 8, padding: "10px 12px", border: "1px solid #a78bfa33" }}>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#a78bfa", letterSpacing: "0.08em", marginBottom: 4 }}>💡 SUGGESTED RESOLUTION</div>
                          <div style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", lineHeight: 1.6 }}>{activeD.aiSummary.suggestedResolution}</div>
                        </div>}
                        <button onClick={generateMediation} style={{ marginTop: 10, background: "none", border: "1px solid #3b4266", borderRadius: 5, color: "#64748b", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontFamily: "'Lato',sans-serif" }}>Refresh</button>
                      </div>
                    )}
                  </div>
                )}

                {activeD.messages.map(m => {
                  const isMe = m.from === role;
                  const meta = ROLE_CFG[m.from] || { color: "#64748b", label: m.from };
                  return (
                    <div key={m.id} style={{ display: "flex", gap: 8, flexDirection: isMe ? "row-reverse" : "row", alignItems: "flex-end", marginBottom: 10 }}>
                      <Avatar role={m.from} size={26} />
                      <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 3 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexDirection: isMe ? "row-reverse" : "row" }}>
                          <span style={{ fontSize: 11, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: meta.color }}>{meta.label}</span>
                          <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#3b4266" }}>{m.date} {m.time}</span>
                        </div>
                        <div style={{ padding: "9px 12px", borderRadius: isMe ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: isMe ? (role === "homeowner" ? "#1e2d4a" : "#1e1c10") : "#1a1e2e", border: `1px solid ${isMe ? meta.color + "33" : "#252a3a"}`, fontSize: 13, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", lineHeight: 1.6 }}>{m.text}</div>
                        {m.attachments?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{m.attachments.map((a, i) => <span key={i} style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "#60a5fa", background: "#1e2d4a", padding: "2px 6px", borderRadius: 4 }}>📎 {a}</span>)}</div>}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <button onClick={() => fileRef.current.click()} style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 7, color: "#64748b", fontSize: 15, padding: "8px 10px", cursor: "pointer", flexShrink: 0 }}>📎</button>
                <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && setAttachments([...attachments, e.target.files[0]])} />
                <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Write a message… (Enter to send)" rows={2}
                  style={{ flex: 1, background: "#252a3a", border: "1px solid #3b4266", borderRadius: 8, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", outline: "none", resize: "none", lineHeight: 1.5 }} />
                <Btn onClick={send} color={ROLE_CFG[role]?.color || "#c8a96e"}>Send</Btn>
              </div>
            </div>
          ) : (
            <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#3b4266", fontFamily: "'Lato',sans-serif", fontSize: 14 }}>Select a dispute</div>
          )}
        </div>
      )}

      {msgTab === "messages" && (
        <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: 18, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #252a3a" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e2e8f0" }}>Project Messaging</div>
            <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 2 }}>All messages are timestamped and logged</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
            {generalMessages.map(m => {
              const isMe = m.from === role;
              const meta = ROLE_CFG[m.from] || { color: "#64748b", label: m.from };
              return (
                <div key={m.id} style={{ display: "flex", gap: 8, flexDirection: isMe ? "row-reverse" : "row", alignItems: "flex-end", marginBottom: 10 }}>
                  <Avatar role={m.from} size={26} />
                  <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 3 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexDirection: isMe ? "row-reverse" : "row" }}>
                      <span style={{ fontSize: 11, fontFamily: "'Lato',sans-serif", fontWeight: 700, color: meta.color }}>{meta.label}</span>
                      <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#3b4266" }}>{m.date} {m.time}</span>
                    </div>
                    <div style={{ padding: "9px 12px", borderRadius: isMe ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: isMe ? (role === "homeowner" ? "#1e2d4a" : "#1e1c10") : "#1a1e2e", border: `1px solid ${isMe ? meta.color + "33" : "#252a3a"}`, fontSize: 13, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", lineHeight: 1.6 }}>{m.text}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Write a message…" rows={2}
              style={{ flex: 1, background: "#252a3a", border: "1px solid #3b4266", borderRadius: 8, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", outline: "none", resize: "none", lineHeight: 1.5 }} />
            <Btn onClick={send} color={ROLE_CFG[role]?.color || "#c8a96e"}>Send</Btn>
          </div>
        </div>
      )}

      {showNew && (
        <Modal title="File a Dispute" onClose={() => setShowNew(false)} maxWidth={480}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <Inp label="Title" value={newForm.title} onChange={v => setNewForm({ ...newForm, title: v })} placeholder="e.g. Work not completed per spec" />
            <div><div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontFamily: "'Lato',sans-serif" }}>Description</div><textarea rows={3} value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} placeholder="Describe the issue clearly…" style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 6, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", width: "100%", outline: "none", resize: "none" }} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="Amount ($)" value={newForm.amount} onChange={v => setNewForm({ ...newForm, amount: v })} type="number" placeholder="0.00" />
              <Sel label="Priority" value={newForm.priority} onChange={v => setNewForm({ ...newForm, priority: v })} options={["Low", "Medium", "High"]} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn full color="#ef4444" disabled={!newForm.title || !newForm.description} onClick={() => {
              const nd = { id: disputes.length + 1, title: newForm.title, raisedBy: role, date: today, priority: newForm.priority, status: "Open", amount: parseFloat(newForm.amount) || 0, description: newForm.description, resolution: null, aiSummary: null, messages: [] };
              updateProject({ disputes: [...disputes, nd] });
              setActiveDispute(nd.id); setShowNew(false); setNewForm({ title: "", description: "", amount: "", priority: "Medium" });
            }}>File Dispute</Btn>
            <Btn color="#252a3a" onClick={() => setShowNew(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE
// ═══════════════════════════════════════════════════════════════════════════════
const INV_CATS = ["Materials", "Labor", "Subcontractor", "Permit", "Equipment", "Other"];

function InvoiceView({ project, updateProject, role }) {
  const invoices = project.invoices || [];
  const [activeInv, setActiveInv] = useState(invoices.length > 0 ? invoices[0].id : null);
  const [showNew, setShowNew] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [newInvForm, setNewInvForm] = useState({ notes: "", dueDate: "" });
  const [editItem, setEditItem] = useState(null);
  const [itemForm, setItemForm] = useState({ description: "", category: "Materials", qty: "1", unitPrice: "" });

  const inv = invoices.find(i => i.id === activeInv);
  const subtotal = inv ? inv.lineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0) : 0;
  const tax = 0;
  const total = subtotal + tax;

  const createInvoice = () => {
    const num = "INV-" + String(invoices.length + 1).padStart(4, "0");
    const ni = { id: Date.now(), invoiceNumber: num, date: today, dueDate: newInvForm.dueDate || "", notes: newInvForm.notes, status: "Draft", lineItems: [] };
    updateProject({ invoices: [...invoices, ni] });
    setActiveInv(ni.id);
    setShowNew(false);
    setNewInvForm({ notes: "", dueDate: "" });
  };

  const addLineItem = () => {
    if (!itemForm.description || !itemForm.unitPrice) return;
    const li = { id: Date.now(), description: itemForm.description, category: itemForm.category, qty: parseFloat(itemForm.qty) || 1, unitPrice: parseFloat(itemForm.unitPrice) || 0 };
    updateProject({ invoices: invoices.map(i => i.id === activeInv ? { ...i, lineItems: [...i.lineItems, li] } : i) });
    setItemForm({ description: "", category: "Materials", qty: "1", unitPrice: "" });
    setEditItem(null);
  };

  const removeLineItem = (liId) => {
    updateProject({ invoices: invoices.map(i => i.id === activeInv ? { ...i, lineItems: i.lineItems.filter(li => li.id !== liId) } : i) });
  };

  const updateStatus = (status) => {
    updateProject({ invoices: invoices.map(i => i.id === activeInv ? { ...i, status } : i) });
  };

  const STATUS_COLOR = { Draft: { bg: "#252a3a", color: "#64748b" }, Sent: { bg: "#1e2d4a", color: "#60a5fa" }, Paid: { bg: "#1a2d1a", color: "#22c55e" } };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#c8a96e", letterSpacing: "0.1em", marginBottom: 4 }}>CONTRACTOR INVOICING</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, color: "#e2e8f0" }}>Invoices</div>
          <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Lato',sans-serif", marginTop: 2 }}>{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} · Bill materials and labor to homeowner</div>
        </div>
        <Btn onClick={() => setShowNew(true)}>+ New Invoice</Btn>
      </div>

      {invoices.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#3b4266" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#64748b", marginBottom: 8 }}>No invoices yet</div>
          <div style={{ fontSize: 13, color: "#3b4266", fontFamily: "'Lato',sans-serif" }}>Click "+ New Invoice" to create your first invoice for this project</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 18 }}>
          {/* Invoice list sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invoices.map(i => {
              const iTotal = i.lineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);
              const sc = STATUS_COLOR[i.status] || STATUS_COLOR.Draft;
              return (
                <div key={i.id} onClick={() => setActiveInv(i.id)}
                  style={{ background: activeInv === i.id ? "#1e2335" : "#181c27", border: `1px solid ${activeInv === i.id ? "#c8a96e44" : "#252a3a"}`, borderRadius: 8, padding: "12px 14px", cursor: "pointer", transition: "all .2s" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#c8a96e", marginBottom: 3 }}>{i.invoiceNumber}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Lato',sans-serif", marginBottom: 5 }}>{i.date}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: "#e2e8f0", marginBottom: 6 }}>{fmt(iTotal)}</div>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", background: sc.bg, color: sc.color }}>{i.status}</span>
                </div>
              );
            })}
          </div>

          {/* Invoice detail */}
          {inv && (
            <div>
              <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                {/* Invoice header */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #252a3a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0" }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>
                      Issued: {inv.date}{inv.dueDate ? ` · Due: ${inv.dueDate}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {["Draft", "Sent", "Paid"].map(s => {
                      const sc = STATUS_COLOR[s];
                      return (
                        <button key={s} onClick={() => updateStatus(s)}
                          style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: inv.status === s ? sc.bg : "#0f1117", color: inv.status === s ? sc.color : "#3b4266", border: `1px solid ${inv.status === s ? sc.color + "44" : "#252a3a"}`, cursor: "pointer", transition: "all .2s" }}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Line items table */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Lato',sans-serif", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#0f1117", borderBottom: "1px solid #252a3a" }}>
                      {["Description", "Category", "Qty", "Unit Price", "Amount", ""].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: h === "Qty" || h === "Unit Price" || h === "Amount" ? "right" : "left", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.1em", color: "#64748b", fontWeight: 400 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lineItems.map((li, idx) => (
                      <tr key={li.id} style={{ borderBottom: "1px solid #1e2130", background: idx % 2 === 0 ? "#181c27" : "#161926" }}>
                        <td style={{ padding: "10px 14px", color: "#e2e8f0" }}>{li.description}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", background: li.category === "Labor" ? "#1e2d4a" : li.category === "Subcontractor" ? "#2d1e3a" : "#1e2d1e", color: li.category === "Labor" ? "#60a5fa" : li.category === "Subcontractor" ? "#a78bfa" : "#4ade80" }}>{li.category}</span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: "#94a3b8" }}>{li.qty}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: "#94a3b8" }}>{fmt(li.unitPrice)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500, color: "#e2e8f0" }}>{fmt(li.qty * li.unitPrice)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          <button onClick={() => removeLineItem(li.id)} style={{ background: "none", border: "none", color: "#3b4266", cursor: "pointer", fontSize: 14, padding: 2 }} title="Remove">✕</button>
                        </td>
                      </tr>
                    ))}
                    {inv.lineItems.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "24px 14px", textAlign: "center", color: "#3b4266", fontFamily: "'Lato',sans-serif", fontSize: 13 }}>No line items yet — add materials, labor, and inputs below</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#0f1117", borderTop: "2px solid #252a3a" }}>
                      <td colSpan={4} style={{ padding: "12px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textAlign: "right" }}>SUBTOTAL</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#c8a96e", fontWeight: 500 }}>{fmt(subtotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>

                {inv.notes && (
                  <div style={{ padding: "12px 20px", borderTop: "1px solid #252a3a", fontSize: 12, color: "#64748b", fontFamily: "'Lato',sans-serif" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#3b4266", letterSpacing: "0.08em", marginRight: 8 }}>NOTES</span>{inv.notes}
                  </div>
                )}
              </div>

              {/* Add line item form */}
              <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 10, padding: "16px 20px", marginBottom: 16 }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#c8a96e", letterSpacing: "0.1em", marginBottom: 14 }}>ADD LINE ITEM</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 110px", gap: 10, marginBottom: 12 }}>
                  <Inp label="Description" value={itemForm.description} onChange={v => setItemForm(f => ({ ...f, description: v }))} placeholder="e.g. 2×4 lumber (16 ft)" />
                  <Sel label="Category" value={itemForm.category} onChange={v => setItemForm(f => ({ ...f, category: v }))} options={INV_CATS} />
                  <Inp label="Qty" value={itemForm.qty} onChange={v => setItemForm(f => ({ ...f, qty: v }))} type="number" placeholder="1" />
                  <Inp label="Unit Price ($)" value={itemForm.unitPrice} onChange={v => setItemForm(f => ({ ...f, unitPrice: v }))} type="number" placeholder="0.00" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {itemForm.description && itemForm.unitPrice ? (
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#64748b" }}>
                      Line total: <span style={{ color: "#c8a96e" }}>{fmt((parseFloat(itemForm.qty) || 1) * (parseFloat(itemForm.unitPrice) || 0))}</span>
                    </div>
                  ) : <div />}
                  <Btn onClick={addLineItem} disabled={!itemForm.description || !itemForm.unitPrice}>Add Item +</Btn>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => setShowPreview(true)} disabled={inv.lineItems.length === 0}>🖨 Generate Invoice for Homeowner</Btn>
                {inv.status === "Draft" && inv.lineItems.length > 0 && (
                  <Btn onClick={() => updateStatus("Sent")} color="#60a5fa">Send to Homeowner</Btn>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Invoice Modal */}
      {showNew && (
        <Modal title="Create New Invoice" onClose={() => setShowNew(false)} maxWidth={440}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <Inp label="Due Date (optional)" value={newInvForm.dueDate} onChange={v => setNewInvForm(f => ({ ...f, dueDate: v }))} type="date" />
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontFamily: "'Lato',sans-serif" }}>Notes (optional)</div>
              <textarea value={newInvForm.notes} onChange={e => setNewInvForm(f => ({ ...f, notes: e.target.value }))} placeholder="Payment terms, scope notes, etc."
                style={{ background: "#252a3a", border: "1px solid #3b4266", borderRadius: 6, color: "#e2e8f0", fontFamily: "'Lato',sans-serif", fontSize: 13, padding: "9px 12px", width: "100%", outline: "none", resize: "vertical", minHeight: 80 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn full onClick={createInvoice}>Create Invoice</Btn>
            <Btn color="#252a3a" onClick={() => setShowNew(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {/* Invoice Preview / Print Modal */}
      {showPreview && inv && (
        <Modal title="Invoice Preview" onClose={() => setShowPreview(false)} maxWidth={680}>
          <div id="invoice-print" style={{ background: "#fff", color: "#111", borderRadius: 8, padding: "32px 36px", fontFamily: "'Lato',sans-serif" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, borderBottom: "2px solid #e5e7eb", paddingBottom: 20 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1e293b", fontFamily: "'Playfair Display',serif", marginBottom: 4 }}>INVOICE</div>
                <div style={{ fontSize: 13, color: "#64748b" }}>{inv.invoiceNumber}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginBottom: 2 }}>{project.contractor || "Contractor"}</div>
                {project.contractorLicense && <div style={{ fontSize: 12, color: "#64748b" }}>License: {project.contractorLicense}</div>}
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Date: {inv.date}</div>
                {inv.dueDate && <div style={{ fontSize: 12, color: "#64748b" }}>Due: {inv.dueDate}</div>}
              </div>
            </div>

            {/* Parties */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94a3b8", marginBottom: 6, textTransform: "uppercase" }}>Bill To</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{project.homeowner || "Homeowner"}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>{project.address || ""}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94a3b8", marginBottom: 6, textTransform: "uppercase" }}>Project</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{project.name}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>{project.address}</div>
              </div>
            </div>

            {/* Line items table */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
                  {["Description", "Category", "Qty", "Unit Price", "Amount"].map((h, i) => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: i > 1 ? "right" : "left", fontSize: 10, letterSpacing: "0.1em", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.map((li, idx) => (
                  <tr key={li.id} style={{ borderBottom: "1px solid #f1f5f9", background: idx % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "9px 12px", color: "#1e293b" }}>{li.description}</td>
                    <td style={{ padding: "9px 12px", color: "#64748b" }}>{li.category}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#475569" }}>{li.qty}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#475569" }}>{fmt(li.unitPrice)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600, color: "#1e293b" }}>{fmt(li.qty * li.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #1e293b" }}>
                  <td colSpan={4} style={{ padding: "12px", textAlign: "right", fontWeight: 700, fontSize: 14, color: "#1e293b" }}>TOTAL DUE</td>
                  <td style={{ padding: "12px", textAlign: "right", fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{fmt(subtotal)}</td>
                </tr>
              </tfoot>
            </table>

            {inv.notes && (
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "12px 14px", fontSize: 12, color: "#475569", borderLeft: "3px solid #c8a96e" }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#1e293b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
                {inv.notes}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Btn full onClick={() => window.print()}>🖨 Print / Save as PDF</Btn>
            <Btn color="#252a3a" onClick={() => setShowPreview(false)}>Close</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: "dashboard",  label: "Dashboard",    icon: "⊞" },
  { id: "milestones", label: "Milestones",   icon: "🏁" },
  { id: "financials", label: "Financials",   icon: "💰" },
  { id: "payments",   label: "Payments",     icon: "💸" },
  { id: "documents",  label: "Documents",    icon: "📁" },
  { id: "disputes",   label: "Disputes",     icon: "⚠️" },
  { id: "invoice",    label: "Invoicing",    icon: "🧾", contractorOnly: true },
];

// ── localStorage helpers ─────────────────────────────────────────────────────
const STORAGE_KEY = "groundwork_projects_v1";

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) return saved;
    }
  } catch {}
  return [SAMPLE_PROJECT];
}

function saveProjects(projects) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch {}
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [projects, setProjects] = useState(() => loadProjects());
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [role, setRole] = useState("homeowner");
  const [tab, setTab] = useState("dashboard");
  const [activeDispute, setActiveDispute] = useState(1);
  const [toast, setToast] = useState(null);

  // Auto-save whenever projects change
  useEffect(() => { saveProjects(projects); }, [projects]);

  const activeProject = projects.find(p => p.id === activeProjectId);
  const showToast = (msg, type = "success") => { setToast({ msg, type }); };

  const updateProject = (changes) => {
    setProjects(ps => ps.map(p => p.id === activeProjectId ? { ...p, ...changes } : p));
  };

  const openProject = (id) => { setActiveProjectId(id); setScreen("project"); setTab("dashboard"); setActiveDispute(null); };

  const openDisp = activeProject?.disputes?.filter(d => d.status === "Open").length || 0;

  if (screen === "home") return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=Lato:wght@300;400;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0;} @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}} @keyframes spin{to{transform:rotate(360deg);}}`}</style>
      <HomeScreen projects={projects} onSelect={openProject} onNew={() => setShowWizard(true)} />
      {showWizard && <ProjectWizard onSave={p => { setProjects([...projects, p]); openProject(p.id); }} onClose={() => setShowWizard(false)} />}
    </>
  );

  if (!activeProject) return null;
  const cfg = ROLE_CFG[role];

  return (
    <div style={{ fontFamily: "'Georgia',serif", background: "#0a0d14", minHeight: "100vh", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=Lato:wght@300;400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#1e2130;}::-webkit-scrollbar-thumb{background:#3b4266;border-radius:2px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.5;}}
        .nav-btn{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:8px;cursor:pointer;transition:all .2s;font-family:'Lato',sans-serif;font-size:12px;color:#64748b;border:none;background:none;width:100%;text-align:left;}
        .nav-btn:hover{background:#181c27;color:#e2e8f0;}
        .nav-btn.active{background:#1e2335;color:#c8a96e;}
      `}</style>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "100vh" }}>
        {/* Sidebar */}
        <div style={{ background: "#0d1020", borderRight: "1px solid #1a1e2e", display: "flex", flexDirection: "column", padding: "20px 12px", position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
          <div style={{ marginBottom: 4, paddingLeft: 2 }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "#3b4266", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", marginBottom: 4 }}>← All Projects</button>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 700, color: "#c8a96e", letterSpacing: "-0.02em" }}>GroundWork</div>
          </div>

          {/* Role switcher */}
          <div style={{ background: "#181c27", border: "1px solid #252a3a", borderRadius: 9, padding: 10, marginBottom: 18, marginTop: 14 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#3b4266", letterSpacing: "0.12em", marginBottom: 7 }}>VIEWING AS</div>
            {Object.entries(ROLE_CFG).map(([key, c]) => (
              <button key={key} onClick={() => setRole(key)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 6, border: `1px solid ${role === key ? c.color + "44" : "#252a3a"}`, background: role === key ? c.bg : "none", color: role === key ? c.color : "#64748b", fontFamily: "'Lato',sans-serif", fontSize: 12, cursor: "pointer", width: "100%", marginBottom: 4, fontWeight: role === key ? 700 : 400 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: role === key ? c.color + "33" : "#252a3a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: role === key ? c.color : "#3b4266", flexShrink: 0 }}>{c.avatar}</div>
                {c.label}
              </button>
            ))}
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
            {TABS.filter(t => (!t.homeownerOnly || role === "homeowner") && (!t.contractorOnly || role === "contractor")).map(t => (
              <button key={t.id} className={`nav-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
                <span style={{ fontSize: 13 }}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id === "disputes" && openDisp > 0 && <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: "50%", width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, animation: "pulse 2s infinite" }}>{openDisp}</span>}
              </button>
            ))}
          </nav>

          <div style={{ borderTop: "1px solid #1a1e2e", paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'Lato',sans-serif", lineHeight: 1.6 }}>
              <div style={{ color: "#94a3b8", fontWeight: 700, marginBottom: 2, fontSize: 11 }}>{activeProject.name}</div>
              <div style={{ fontSize: 10, color: "#3b4266" }}>{activeProject.address}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#3b4266", marginTop: 3 }}>{activeProject.startDate} → {activeProject.endDate}</div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div key={activeProjectId} style={{ overflowY: "auto", padding: "26px 30px" }}>
          {tab === "dashboard"  && <DashboardView  project={activeProject} role={role} setTab={setTab} setActiveDispute={setActiveDispute} />}
          {tab === "milestones" && <MilestonesView project={activeProject} updateProject={updateProject} role={role} />}
          {tab === "financials" && <FinancialsView project={activeProject} updateProject={updateProject} />}
          {tab === "payments"   && <PaymentsView   project={activeProject} updateProject={updateProject} role={role} />}
          {tab === "documents"  && <DocumentsView  project={activeProject} updateProject={updateProject} />}
          {tab === "disputes"   && <DisputesView   project={activeProject} updateProject={updateProject} role={role} activeDispute={activeDispute} setActiveDispute={setActiveDispute} />}
          {tab === "invoice"    && <InvoiceView    project={activeProject} updateProject={updateProject} role={role} />}
        </div>
      </div>
    </div>
  );
}

