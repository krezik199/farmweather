import { useState, useEffect, useCallback } from "react";

const CROPS = {
  onion: {
    emoji: "🧅",
    stages: ["Emergence", "3-Leaf Stage", "Bulb Initiation", "Bulb Fill", "Maturity"],
  },
  potato: {
    emoji: "🥔",
    stages: ["Emergence", "Tuber Initiation", "Tuber Bulking", "Maturity"],
  },
};

const S = {
  sectionTitle: { fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569", marginBottom:8 },
  card: { background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:14, padding:16, marginBottom:12 },
  input: { width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box" },
  textarea: { width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:14, marginBottom:10, boxSizing:"border-box", minHeight:72, resize:"vertical", fontFamily:"inherit" },
  btn: (v) => ({ width:"100%", padding:"12px", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", border:"none", marginBottom:8,
    background: v==="primary" ? "#38bdf8" : v==="danger" ? "#7f1d1d" : "#1e293b",
    color: v==="primary" ? "#0a0f1a" : v==="danger" ? "#f87171" : "#94a3b8" }),
  btnSm: (v) => ({ padding:"5px 11px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid",
    background: "transparent",
    borderColor: v==="danger" ? "#7f1d1d" : "#334155",
    color: v==="danger" ? "#f87171" : "#94a3b8" }),
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", zIndex:100 },
  modalBox: { background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"88vh", overflowY:"auto" },
  spinner: { width:28, height:28, border:"3px solid #1e3a5f", borderTop:"3px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"16px auto" },
};

function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function daysBetween(a, b) {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return Math.round((db - da) / 86400000);
}

// ── Field card with its observations ──
function FieldObservations({ field, observations, gddData, onAdd, onDelete }) {
  const cropDef = CROPS[field.crop];
  if (!cropDef) return null;

  const fieldObs = observations.filter(o => o.fieldId === field.id);

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:18 }}>{cropDef.emoji}</span>
            <div style={{ fontSize:15, fontWeight:700, color:"#f0f9ff" }}>{field.name}</div>
          </div>
          <div style={{ fontSize:12, color:"#475569", marginTop:2 }}>
            {field.variety ? `${field.variety} · ` : ""} Planted {fmt(field.plantingDate)}
          </div>
        </div>
        <button
          style={{ background:"#38bdf8", border:"none", color:"#0a0f1a", borderRadius:9, padding:"7px 13px", fontSize:13, fontWeight:700, cursor:"pointer" }}
          onClick={() => onAdd(field)}>
          + Log
        </button>
      </div>

      {/* Stage rows */}
      {cropDef.stages.map(stage => {
        const obs = fieldObs.find(o => o.stage === stage);
        const proj = gddData?.stageProjections?.find(s => s.name === stage);
        const projDate = proj?.reached ? proj.date : proj?.date ?? null;
        const daysFromPlanting = obs ? daysBetween(field.plantingDate, obs.date) : null;

        return (
          <div key={stage} style={{ padding:"10px 0", borderBottom:"1px solid #1e293b" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13 }}>{obs ? "✅" : "○"}</span>
                  <span style={{ fontSize:13, fontWeight: obs ? 700 : 500, color: obs ? "#22c55e" : "#94a3b8" }}>
                    {stage}
                  </span>
                </div>

                {obs ? (
                  <div style={{ marginTop:5, marginLeft:20 }}>
                    <div style={{ fontSize:13, color:"#e2e8f0" }}>
                      📅 {fmt(obs.date)}
                      <span style={{ color:"#475569", fontSize:12 }}> · day {daysFromPlanting}</span>
                    </div>
                    {obs.gddAtObservation != null && (
                      <div style={{ fontSize:12, color:"#38bdf8" }}>
                        {obs.gddAtObservation} GDD accumulated
                        {proj?.gdd && obs.gddAtObservation !== proj.gdd && (
                          <span style={{ color:"#475569" }}> (model: {proj.gdd})</span>
                        )}
                      </div>
                    )}
                    {obs.notes && (
                      <div style={{ fontSize:12, color:"#64748b", marginTop:3, fontStyle:"italic" }}>"{obs.notes}"</div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginLeft:20, marginTop:3, fontSize:12, color:"#334155" }}>
                    {projDate ? `Model est: ${fmt(projDate)}` : "No estimate"}
                  </div>
                )}
              </div>

              {obs && (
                <button style={S.btnSm("danger")} onClick={() => onDelete(obs.id)}>🗑</button>
              )}
            </div>
          </div>
        );
      })}

      {/* Season summary if maturity observed */}
      {(() => {
        const matObs = fieldObs.find(o => o.stage === cropDef.stages[cropDef.stages.length - 1]);
        if (!matObs) return null;
        const totalDays = daysBetween(field.plantingDate, matObs.date);
        return (
          <div style={{ marginTop:12, background:"#0f1f35", borderRadius:10, padding:"10px 14px", border:"1px solid #1e3a5f" }}>
            <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Season Summary</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#22c55e", marginTop:4 }}>
              {totalDays} days to maturity
              {field.variety && CROPS[field.crop]?.varieties?.[field.variety]?.dtm && (
                <span style={{ fontSize:12, color:"#475569", fontWeight:400 }}>
                  {" "}(DTM model: {CROPS[field.crop].varieties[field.variety].dtm} days)
                </span>
              )}
            </div>
            {matObs.gddAtObservation != null && (
              <div style={{ fontSize:12, color:"#38bdf8", marginTop:2 }}>
                {matObs.gddAtObservation} total GDD (model: 2000)
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Log observation modal ──
function LogModal({ field, existingObs, gddData, onSave, onClose }) {
  const cropDef = CROPS[field.crop];
  const [stage, setStage] = useState(() => {
    // Default to next unobserved stage
    const logged = new Set(existingObs.filter(o => o.fieldId === field.id).map(o => o.stage));
    return cropDef.stages.find(s => !logged.has(s)) || cropDef.stages[0];
  });
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Look up the GDD at the observed date from historical data
  function getGDDAtDate(dateStr) {
    if (!gddData?.daily) return null;
    const match = [...gddData.daily].reverse().find(d => d.date <= dateStr);
    return match ? match.cumulative : null;
  }

  async function save() {
    if (!stage || !date) { setError("Please select a stage and date."); return; }
    setSaving(true);
    setError(null);
    const gddAtObservation = getGDDAtDate(date);
    try {
      const res = await fetch('/api/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldId: field.id, stage, date, notes: notes.trim(), gddAtObservation }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `Error ${res.status}`);
        setSaving(false);
        return;
      }
      onSave();
    } catch(e) {
      setError("Network error — try again.");
    }
    setSaving(false);
  }

  const logged = new Set(existingObs.filter(o => o.fieldId === field.id).map(o => o.stage));

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:700, color:"#f0f9ff", marginBottom:4 }}>Log Observation</div>
        <div style={{ fontSize:12, color:"#475569", marginBottom:16 }}>
          {cropDef.emoji} {field.name}{field.variety ? ` · ${field.variety}` : ""}
        </div>

        {error && (
          <div style={{ background:"#7f1d1d", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:13, color:"#fca5a5" }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Growth Stage</div>
        <div style={{ position:"relative", marginBottom:10 }}>
          <select
            style={{ ...S.input, marginBottom:0, appearance:"none", WebkitAppearance:"none" }}
            value={stage}
            onChange={e => setStage(e.target.value)}>
            {cropDef.stages.map(s => (
              <option key={s} value={s}>
                {logged.has(s) ? "✅ " : ""}{s}
              </option>
            ))}
          </select>
          <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:"#475569", pointerEvents:"none" }}>▼</span>
        </div>

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Observed Date</div>
        <input style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />

        {/* Show GDD at that date if available */}
        {(() => {
          const gdd = getGDDAtDate(date);
          if (gdd == null) return null;
          return (
            <div style={{ fontSize:12, color:"#38bdf8", marginTop:-6, marginBottom:10 }}>
              ~{gdd} GDD accumulated by this date
            </div>
          );
        })()}

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>Notes (optional)</div>
        <textarea
          style={S.textarea}
          placeholder="e.g. Uniform emergence across field, slight uneven stand on north end..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />

        <button style={S.btn("primary")} onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Observation"}
        </button>
        <button style={S.btn()} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main DataTab ──
export default function DataTab({ farms }) {
  const [fields, setFields]           = useState([]);
  const [observations, setObservations] = useState([]);
  const [gddCache, setGddCache]       = useState({});
  const [loading, setLoading]         = useState(true);
  const [logTarget, setLogTarget]     = useState(null); // field being logged
  const [filterCrop, setFilterCrop]   = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, oRes] = await Promise.all([
        fetch('/api/fields'),
        fetch('/api/observations'),
      ]);
      const fData = await fRes.json();
      const oData = await oRes.json();
      setFields(Array.isArray(fData) ? fData : []);
      setObservations(Array.isArray(oData) ? oData : []);

      // Fetch GDD data for each field (for the model comparison)
      const cache = {};
      await Promise.all((Array.isArray(fData) ? fData : []).map(async field => {
        try {
          const r = await fetch(`/api/fields/${field.id}/gdd`);
          cache[field.id] = await r.json();
        } catch { cache[field.id] = null; }
      }));
      setGddCache(cache);
    } catch(e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  async function deleteObs(id) {
    await fetch(`/api/observations/${id}`, { method: 'DELETE' });
    load();
  }

  const filtered = fields.filter(f => filterCrop === "all" || f.crop === filterCrop);

  return (
    <div style={{ padding:"0 16px", paddingBottom:80 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, marginBottom:4 }}>
        <div style={S.sectionTitle}>📋 Field Observations</div>
        <div style={{ display:"flex", gap:6 }}>
          {["all","onion","potato"].map(c => (
            <button key={c} onClick={() => setFilterCrop(c)} style={{
              padding:"5px 11px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid",
              background: filterCrop===c ? "#38bdf8" : "transparent",
              color: filterCrop===c ? "#0a0f1a" : "#475569",
              borderColor: filterCrop===c ? "#38bdf8" : "#334155",
            }}>
              {c === "all" ? "All" : c === "onion" ? "🧅" : "🥔"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize:12, color:"#334155", marginBottom:14 }}>
        Log actual observed stage dates to refine the GDD model over time.
      </div>

      {loading && <div style={S.spinner}/>}

      {!loading && filtered.length === 0 && (
        <div style={{ ...S.card, textAlign:"center", padding:"40px 20px" }}>
          <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
          <div style={{ fontSize:15, color:"#64748b", fontWeight:600 }}>No fields yet</div>
          <div style={{ fontSize:13, color:"#334155", marginTop:6 }}>Add fields in the GDD tab first</div>
        </div>
      )}

      {!loading && filtered.map(field => (
        <FieldObservations
          key={field.id}
          field={field}
          observations={observations}
          gddData={gddCache[field.id]}
          onAdd={f => setLogTarget(f)}
          onDelete={deleteObs}
        />
      ))}

      {logTarget && (
        <LogModal
          field={logTarget}
          existingObs={observations}
          gddData={gddCache[logTarget.id]}
          onSave={() => { setLogTarget(null); load(); }}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}
