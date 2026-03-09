import { useState, useEffect, useCallback } from "react";

const BASE_TEMP = 45;

const CROPS = {
  onion: {
    label: "Onions",
    emoji: "🧅",
    varieties: ["Legend", "Red Carpet", "Cometa"],
    stages: [
      { name: "Emergence",       gdd: 100  },
      { name: "3-Leaf Stage",    gdd: 400  },
      { name: "Bulb Initiation", gdd: 800  },
      { name: "Bulb Fill",       gdd: 1400 },
      { name: "Maturity",        gdd: 2000 },
    ],
  },
  potato: {
    label: "Potatoes",
    emoji: "🥔",
    varieties: ["Norkotah", "Little Star", "Rising Star", "Ruby Red", "Primabelle", "Agata", "Purple Majesty"],
    stages: [
      { name: "Emergence",        gdd: 100  },
      { name: "Tuber Initiation", gdd: 350  },
      { name: "Tuber Bulking",    gdd: 700  },
      { name: "Maturity",         gdd: 1200 },
    ],
  },
};

const S = {
  card:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:16, padding:18, marginTop:14 },
  sectionTitle:{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569", marginBottom:10 },
  input:{ width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box" },
  select:{ width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box", appearance:"none", WebkitAppearance:"none" },
  btn:(v) => ({ width:"100%", padding:"12px", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", border:"none", marginBottom:8,
    background: v==="primary"?"#38bdf8": v==="danger"?"#7f1d1d":"#1e293b",
    color: v==="primary"?"#0a0f1a": v==="danger"?"#f87171":"#94a3b8" }),
  btnSm:(v) => ({ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none",
    background: v==="danger"?"transparent":"#1e293b",
    color: v==="danger"?"#f87171":"#94a3b8",
    borderWidth:1, borderStyle:"solid",
    borderColor: v==="danger"?"#7f1d1d":"#334155" }),
  modal:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", zIndex:100 },
  modalBox:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"85vh", overflowY:"auto" },
  spinner:{ width:28, height:28, border:"3px solid #1e3a5f", borderTop:"3px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto" },
  stageRow:{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid #1e293b" },
  progressBar:(pct, color) => ({
    height:6, borderRadius:3, overflow:"hidden", background:"#0a1628", marginTop:3,
  }),
  progressFill:(pct, color) => ({
    height:"100%", width:`${Math.min(100,pct)}%`, borderRadius:3,
    background: pct >= 100 ? "#22c55e" : color || "#38bdf8",
    transition:"width 0.5s",
  }),
};

function StageProgress({ crop, totalGDD }) {
  const cropDef = CROPS[crop];
  if (!cropDef) return null;
  const maxGDD = cropDef.stages[cropDef.stages.length - 1].gdd;

  return (
    <div>
      {cropDef.stages.map((stage, i) => {
        const prevGDD = i === 0 ? 0 : cropDef.stages[i-1].gdd;
        const reached = totalGDD >= stage.gdd;
        const inProgress = totalGDD >= prevGDD && totalGDD < stage.gdd;
        const pct = inProgress
          ? ((totalGDD - prevGDD) / (stage.gdd - prevGDD)) * 100
          : reached ? 100 : 0;

        return (
          <div key={stage.name} style={S.stageRow}>
            <div style={{ fontSize:16 }}>{reached ? "✅" : inProgress ? "🌱" : "○"}</div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:13, fontWeight: reached||inProgress ? 700 : 500, color: reached ? "#22c55e" : inProgress ? "#f0f9ff" : "#475569" }}>
                  {stage.name}
                </span>
                <span style={{ fontSize:11, color:"#475569" }}>{stage.gdd} GDD</span>
              </div>
              <div style={S.progressBar(pct)}>
                <div style={S.progressFill(pct, inProgress ? "#38bdf8" : "#22c55e")}/>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldCard({ field, farms, onEdit, onDelete }) {
  const [gddData, setGddData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/fields/${field.id}/gdd`)
      .then(r => r.json())
      .then(d => { setGddData(d); setLoading(false); })
      .catch(() => { setError("Failed to load GDD"); setLoading(false); });
  }, [field.id]);

  const farm = farms.find(f => f.id === field.farmId);
  const cropDef = CROPS[field.crop];
  const planted = new Date(field.plantingDate + 'T12:00:00');
  const today = new Date();
  const daysSincePlanting = Math.floor((today - planted) / 86400000);

  // Current stage
  let currentStage = null;
  let nextStage = null;
  if (gddData && cropDef) {
    const totalGDD = gddData.totalGDD;
    for (let i = 0; i < cropDef.stages.length; i++) {
      if (totalGDD < cropDef.stages[i].gdd) {
        nextStage = cropDef.stages[i];
        currentStage = i > 0 ? cropDef.stages[i-1] : null;
        break;
      } else {
        currentStage = cropDef.stages[i];
      }
    }
  }

  return (
    <div style={{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:14, padding:16, marginBottom:12 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ cursor:"pointer", flex:1 }} onClick={() => setExpanded(e => !e)}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>{cropDef?.emoji || "🌾"}</span>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:"#f0f9ff" }}>{field.name}</div>
              <div style={{ fontSize:12, color:"#475569" }}>{cropDef?.label}{field.variety ? ` · ${field.variety}` : ""} · {farm?.name || "Unknown farm"}</div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button style={S.btnSm()} onClick={() => onEdit(field)}>✎</button>
          <button style={S.btnSm("danger")} onClick={() => onDelete(field.id)}>🗑</button>
        </div>
      </div>

      {/* GDD summary */}
      {loading && <div style={{ marginTop:12 }}><div style={S.spinner}/></div>}
      {error && <div style={{ marginTop:10, fontSize:13, color:"#f87171" }}>{error}</div>}

      {gddData && !loading && (
        <div style={{ marginTop:14 }}>
          {/* Big GDD number */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
            <div style={{ background:"#0f1f35", borderRadius:10, padding:"10px 12px", border:"1px solid #1e3a5f", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Total GDD</div>
              <div style={{ fontSize:24, fontWeight:700, color:"#38bdf8", marginTop:2 }}>{gddData.totalGDD}</div>
              <div style={{ fontSize:10, color:"#475569" }}>base {BASE_TEMP}°F</div>
            </div>
            <div style={{ background:"#0f1f35", borderRadius:10, padding:"10px 12px", border:"1px solid #1e3a5f", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Days</div>
              <div style={{ fontSize:24, fontWeight:700, color:"#e2e8f0", marginTop:2 }}>{daysSincePlanting}</div>
              <div style={{ fontSize:10, color:"#475569" }}>since planting</div>
            </div>
            <div style={{ background:"#0f1f35", borderRadius:10, padding:"10px 12px", border:"1px solid #1e3a5f", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Planted</div>
              <div style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", marginTop:4 }}>
                {planted.toLocaleDateString('en-US', {month:'short', day:'numeric'})}
              </div>
              <div style={{ fontSize:10, color:"#475569" }}>{new Date(field.plantingDate).getFullYear()}</div>
            </div>
          </div>

          {/* Current stage callout */}
          {nextStage && (
            <div style={{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
              <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Current Stage</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#f0f9ff", marginTop:2 }}>
                {currentStage ? currentStage.name : "Pre-emergence"}
              </div>
              <div style={{ fontSize:12, color:"#38bdf8", marginTop:2 }}>
                {nextStage.gdd - gddData.totalGDD > 0
                  ? `${Math.round(nextStage.gdd - gddData.totalGDD)} GDD until ${nextStage.name}`
                  : `${nextStage.name} reached`}
              </div>
            </div>
          )}
          {!nextStage && (
            <div style={{ background:"#14532d", border:"1px solid #22c55e", borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#22c55e" }}>✅ Maturity Reached</div>
            </div>
          )}

          {/* Stage progress — expandable */}
          <button
            style={{ background:"transparent", border:"none", color:"#38bdf8", fontSize:13, cursor:"pointer", padding:0, marginBottom: expanded ? 8 : 0 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? "▲ Hide stage detail" : "▼ Show stage detail"}
          </button>

          {expanded && (
            <>
              <StageProgress crop={field.crop} totalGDD={gddData.totalGDD} />
              {/* Last 7 days of GDD */}
              <div style={{ marginTop:14 }}>
                <div style={S.sectionTitle}>Last 7 Days</div>
                {gddData.daily.slice(-7).reverse().map(d => (
                  <div key={d.date} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #1e293b", fontSize:13 }}>
                    <span style={{ color:"#94a3b8" }}>
                      {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}
                    </span>
                    <span style={{ color:"#64748b" }}>{Math.round(d.tmin)}° – {Math.round(d.tmax)}°</span>
                    <span style={{ color:"#38bdf8", fontWeight:600 }}>+{d.gdd} GDD</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function GDDTab({ farms }) {
  const [fields, setFields]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [form, setForm]               = useState({ name:"", farmId:"", crop:"onion", plantingDate:"" });

  const loadFields = useCallback(() => {
    fetch('/api/fields')
      .then(r => r.json())
      .then(data => { setFields(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadFields(); }, []);

  function openAdd() {
    setForm({ name:"", farmId: farms[0]?.id || "", crop:"onion", variety: CROPS.onion.varieties[0], plantingDate:"" });
    setEditingField(null);
    setShowAdd(true);
  }

  function openEdit(field) {
    setForm({ name: field.name, farmId: field.farmId, crop: field.crop, variety: field.variety || "", plantingDate: field.plantingDate });
    setEditingField(field);
    setShowAdd(true);
  }

  async function saveField() {
    if (!form.name || !form.farmId || !form.crop || !form.plantingDate) return;
    setSaving(true);
    try {
      const url = editingField ? `/api/fields/${editingField.id}` : '/api/fields';
      const method = editingField ? 'PUT' : 'POST';
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, farmId: parseInt(form.farmId), variety: form.variety || "" }),
      });
      setShowAdd(false);
      loadFields();
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  async function deleteField(id) {
    await fetch(`/api/fields/${id}`, { method: 'DELETE' });
    loadFields();
  }

  const inputStyle = { ...S.input };
  const selectStyle = { ...S.select };

  return (
    <div style={{ padding:"0 16px", paddingBottom:80 }}>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, marginBottom:4 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569" }}>
          🌡️ Growing Degree Days · Base {BASE_TEMP}°F
        </div>
        <button
          style={{ background:"#38bdf8", border:"none", color:"#0a0f1a", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}
          onClick={openAdd}>
          + Add Field
        </button>
      </div>

      <div style={{ fontSize:12, color:"#334155", marginBottom:14 }}>
        GDD calculated from planting date using weather at the linked farm location.
      </div>

      {loading && (
        <div style={{ display:"flex", justifyContent:"center", padding:"40px 0" }}>
          <div style={S.spinner}/>
        </div>
      )}

      {!loading && fields.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", color:"#475569", padding:"40px 20px" }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🌾</div>
          <div style={{ fontSize:15, fontWeight:600, color:"#64748b" }}>No fields yet</div>
          <div style={{ fontSize:13, marginTop:6 }}>Add a field to start tracking GDD</div>
          <button style={{ ...S.btn("primary"), marginTop:16, width:"auto", padding:"10px 24px" }} onClick={openAdd}>
            + Add First Field
          </button>
        </div>
      )}

      {fields.map(field => (
        <FieldCard
          key={field.id}
          field={field}
          farms={farms}
          onEdit={openEdit}
          onDelete={deleteField}
        />
      ))}

      {/* Add/Edit Modal */}
      {showAdd && (
        <div style={S.modal} onClick={() => setShowAdd(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:4, color:"#f0f9ff" }}>
              {editingField ? "Edit Field" : "Add Field"}
            </div>
            <div style={{ fontSize:12, color:"#475569", marginBottom:16 }}>
              Fields are shared — all users will see this field.
            </div>

            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Field Name</div>
            <input style={inputStyle} placeholder="e.g. Wheeler North 40"
              value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}/>

            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Farm Location (for weather)</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={selectStyle} value={form.farmId}
                onChange={e => setForm(f => ({...f, farmId: e.target.value}))}>
                <option value="">Select farm...</option>
                {farms.map(farm => (
                  <option key={farm.id} value={farm.id}>{farm.name}</option>
                ))}
              </select>
              <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:"#475569", pointerEvents:"none" }}>▼</span>
            </div>

            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Crop Type</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={selectStyle} value={form.crop}
                onChange={e => setForm(f => ({...f, crop: e.target.value, variety: CROPS[e.target.value]?.varieties[0] || ""}))}>
                {Object.entries(CROPS).map(([key, val]) => (
                  <option key={key} value={key}>{val.emoji} {val.label}</option>
                ))}
              </select>
              <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:"#475569", pointerEvents:"none" }}>▼</span>
            </div>

            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Variety</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={selectStyle} value={form.variety}
                onChange={e => setForm(f => ({...f, variety: e.target.value}))}>
                <option value="">Select variety...</option>
                {(CROPS[form.crop]?.varieties || []).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:"#475569", pointerEvents:"none" }}>▼</span>
            </div>

            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Planting Date</div>
            <input style={inputStyle} type="date"
              value={form.plantingDate}
              onChange={e => setForm(f => ({...f, plantingDate: e.target.value}))}/>

            <div style={{ fontSize:11, color:"#334155", marginBottom:14 }}>
              GDD will be calculated from this date using historical weather data at the selected farm location.
            </div>

            <button style={S.btn("primary")} onClick={saveField} disabled={saving}>
              {saving ? "Saving..." : editingField ? "Save Changes" : "Add Field"}
            </button>
            <button style={S.btn("secondary")} onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
