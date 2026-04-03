import { useState, useEffect, useCallback, useRef } from "react";

const BASE_TEMP = 45;

// ─── GDD Accumulation Chart ───────────────────────────────────────────────────

const STAGE_COLORS = ["#f59e0b","#a78bfa","#34d399","#f472b6","#fb923c"];

function GDDChartModal({ gddData, field, cropDef, onClose }) {
  const svgRef = useRef(null);
  if (!gddData) return null;

  const { daily, forecastDays, stageProjections, totalGDD } = gddData;

  // Build unified data series
  // Actual: daily cumulative (historical)
  // Projected: forecastDays projected cumulative
  const actualPoints = daily.map(d => ({ date: d.date, value: d.cumulative, actual: true }));
  // forecastDays starts from today — connect to last actual point
  const projectedPoints = forecastDays.map(d => ({ date: d.date, value: d.projected, actual: false }));

  // All dates for x-axis
  const allPoints = [...actualPoints, ...projectedPoints];
  if (allPoints.length === 0) return null;

  const allValues = allPoints.map(p => p.value);
  const stageGDDs = (stageProjections || []).map(s => s.gdd);
  const maxValue = Math.max(...allValues, ...stageGDDs, totalGDD) * 1.08;
  const minValue = 0;

  // SVG dimensions
  const W = 340, H = 220;
  const PAD = { top: 20, right: 16, bottom: 44, left: 46 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Scales
  const xScale = i => (i / (allPoints.length - 1)) * chartW;
  const yScale = v => chartH - ((v - minValue) / (maxValue - minValue)) * chartH;

  // Build SVG path strings
  function pointsToPath(points, startIdx, endIdx) {
    const slice = points.slice(startIdx, endIdx + 1);
    return slice.map((p, i) => {
      const x = xScale(startIdx + i);
      const y = yScale(p.value);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  const lastActualIdx = actualPoints.length - 1;
  const actualPath = pointsToPath(allPoints, 0, lastActualIdx);
  // Projected path starts from last actual point
  const projectedPath = lastActualIdx < allPoints.length - 1
    ? pointsToPath(allPoints, lastActualIdx, allPoints.length - 1)
    : '';

  // X-axis labels — show ~5 evenly spaced dates
  const labelCount = Math.min(5, allPoints.length);
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round(i * (allPoints.length - 1) / (labelCount - 1))
  );

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Y-axis grid lines
  const yTicks = [];
  const tickStep = maxValue <= 500 ? 100 : maxValue <= 1000 ? 200 : maxValue <= 2000 ? 400 : 500;
  for (let v = 0; v <= maxValue; v += tickStep) {
    yTicks.push(v);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'flex-end', zIndex:200 }}
      onClick={onClose}>
      <div style={{ background:'#0f1f35', border:'1px solid #1e3a5f', borderRadius:'20px 20px 0 0', padding:'20px 16px 32px', width:'100%', maxWidth:430, margin:'0 auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#f0f9ff' }}>
              {cropDef?.emoji} {field.name} — GDD Curve
            </div>
            <div style={{ fontSize:11, color:'#475569', marginTop:1 }}>
              Base {BASE_TEMP}°F · Planting {formatDate(field.plantingDate)}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:'#475569', fontSize:22, cursor:'pointer', lineHeight:1 }}>✕</button>
        </div>

        {/* Legend */}
        <div style={{ display:'flex', gap:16, marginBottom:10, marginTop:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="#38bdf8" strokeWidth="2.5"/></svg>
            <span style={{ fontSize:11, color:'#94a3b8' }}>Actual</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4,3" opacity="0.6"/></svg>
            <span style={{ fontSize:11, color:'#94a3b8' }}>Projected</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <svg width="10" height="10"><line x1="5" y1="0" x2="5" y2="10" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2,2"/></svg>
            <span style={{ fontSize:11, color:'#94a3b8' }}>Growth stages</span>
          </div>
        </div>

        {/* SVG Chart */}
        <div style={{ overflowX:'auto' }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
            <g transform={`translate(${PAD.left},${PAD.top})`}>

              {/* Y-axis grid lines + labels */}
              {yTicks.map(v => (
                <g key={v}>
                  <line x1={0} y1={yScale(v)} x2={chartW} y2={yScale(v)}
                    stroke="#1e3a5f" strokeWidth="1" strokeDasharray="3,3"/>
                  <text x={-6} y={yScale(v)} textAnchor="end" dominantBaseline="middle"
                    fill="#475569" fontSize="9">{v}</text>
                </g>
              ))}

              {/* Stage threshold vertical lines */}
              {(stageProjections || []).map((stage, i) => {
                const stageGDD = stage.gdd;
                if (stageGDD > maxValue) return null;
                const color = STAGE_COLORS[i % STAGE_COLORS.length];
                // Find x position: which data point is closest to this GDD
                const stageIdx = allPoints.findIndex(p => p.value >= stageGDD);
                if (stageIdx === -1) return null;
                const x = xScale(stageIdx);
                return (
                  <g key={stage.name}>
                    <line x1={x} y1={0} x2={x} y2={chartH}
                      stroke={color} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.8"/>
                    {/* Rotated label */}
                    <text
                      x={x + 3} y={6}
                      fill={color} fontSize="8.5" fontWeight="600"
                      style={{ userSelect:'none' }}>
                      {stage.name}
                    </text>
                  </g>
                );
              })}

              {/* Shaded area under actual line */}
              {actualPoints.length > 1 && (() => {
                const areaPath = `${actualPath} L ${xScale(lastActualIdx).toFixed(1)} ${chartH} L 0 ${chartH} Z`;
                return <path d={areaPath} fill="#38bdf8" opacity="0.06"/>;
              })()}

              {/* Actual line */}
              {actualPoints.length > 1 && (
                <path d={actualPath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              )}

              {/* Projected dashed line */}
              {projectedPath && (
                <path d={projectedPath} fill="none" stroke="#38bdf8" strokeWidth="2"
                  strokeDasharray="5,4" opacity="0.6" strokeLinecap="round"/>
              )}

              {/* Today marker dot (junction of actual/projected) */}
              {actualPoints.length > 0 && (
                <circle cx={xScale(lastActualIdx)} cy={yScale(totalGDD)}
                  r="4" fill="#38bdf8" stroke="#0f1f35" strokeWidth="2"/>
              )}

              {/* X-axis baseline */}
              <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="#1e3a5f" strokeWidth="1"/>

              {/* X-axis labels */}
              {labelIndices.map(idx => (
                <text key={idx} x={xScale(idx)} y={chartH + 12} textAnchor="middle"
                  fill="#475569" fontSize="8.5">
                  {formatDate(allPoints[idx].date)}
                </text>
              ))}

              {/* "Today" label */}
              {lastActualIdx > 0 && lastActualIdx < allPoints.length - 1 && (
                <text x={xScale(lastActualIdx)} y={chartH + 22} textAnchor="middle"
                  fill="#38bdf8" fontSize="8" fontWeight="600">TODAY</text>
              )}

            </g>
          </svg>
        </div>

        {/* Current GDD callout */}
        <div style={{ display:'flex', justifyContent:'center', gap:24, marginTop:8 }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:11, color:'#475569', textTransform:'uppercase', letterSpacing:'0.08em' }}>Current</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#38bdf8' }}>{totalGDD}</div>
            <div style={{ fontSize:10, color:'#475569' }}>GDD accumulated</div>
          </div>
          {projectedPoints.length > 0 && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#475569', textTransform:'uppercase', letterSpacing:'0.08em' }}>In 7 days</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#64748b' }}>
                {projectedPoints[Math.min(6, projectedPoints.length-1)]?.value ?? '—'}
              </div>
              <div style={{ fontSize:10, color:'#475569' }}>GDD projected</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

const S = {
  card:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:16, padding:18, marginTop:14 },
  sectionTitle:{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569", marginBottom:10 },
  input:{ width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box" },
  inputSm:{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:8, padding:"7px 10px", color:"#e2e8f0", fontSize:13, boxSizing:"border-box" },
  select:{ width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box", appearance:"none", WebkitAppearance:"none" },
  btn:(v) => ({ width:"100%", padding:"12px", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", border:"none", marginBottom:8,
    background: v==="primary"?"#38bdf8": v==="danger"?"#7f1d1d":"#1e293b",
    color: v==="primary"?"#0a0f1a": v==="danger"?"#f87171":"#94a3b8" }),
  btnSm:(v) => ({ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid",
    background: v==="danger"?"transparent": v==="primary"?"#38bdf8":"#1e293b",
    color: v==="danger"?"#f87171": v==="primary"?"#0a0f1a":"#94a3b8",
    borderColor: v==="danger"?"#7f1d1d": v==="primary"?"#38bdf8":"#334155" }),
  modal:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", zIndex:100 },
  modalBox:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", overflowY:"auto" },
  spinner:{ width:28, height:28, border:"3px solid #1e3a5f", borderTop:"3px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto" },
  stageRow:{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid #1e293b" },
  tab:(active) => ({ padding:"7px 14px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", border:"none",
    background: active ? "#1e3a5f" : "transparent", color: active ? "#38bdf8" : "#475569" }),
  row:{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1e293b" },
  label:{ fontSize:12, color:"#94a3b8", marginBottom:4 },
};

function getVarieties(crops, cropKey) {
  return Object.keys(crops[cropKey]?.varieties || {});
}
function getVarietyDTM(crops, cropKey, variety) {
  return crops[cropKey]?.varieties?.[variety]?.dtm ?? null;
}
function dtmDaysToStage(dtm, pct) {
  return Math.round(dtm * pct);
}

function StageProgress({ stages, totalGDD }) {
  if (!stages?.length) return null;
  return (
    <div>
      {stages.map((stage, i) => {
        const prevGDD = i === 0 ? 0 : stages[i-1].gdd;
        const reached = totalGDD >= stage.gdd;
        const inProgress = totalGDD >= prevGDD && totalGDD < stage.gdd;
        const pct = inProgress ? ((totalGDD - prevGDD) / (stage.gdd - prevGDD)) * 100 : reached ? 100 : 0;
        return (
          <div key={stage.name} style={S.stageRow}>
            <div style={{ fontSize:16 }}>{reached ? "✅" : inProgress ? "🌱" : "○"}</div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:13, fontWeight: reached||inProgress ? 700 : 500, color: reached ? "#22c55e" : inProgress ? "#f0f9ff" : "#475569" }}>{stage.name}</span>
                <span style={{ fontSize:11, color:"#475569" }}>{stage.gdd} GDD</span>
              </div>
              <div style={{ height:6, borderRadius:3, overflow:"hidden", background:"#0a1628", marginTop:3 }}>
                <div style={{ height:"100%", width:`${Math.min(100,pct)}%`, borderRadius:3, background: pct>=100?"#22c55e":"#38bdf8", transition:"width 0.5s" }}/>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldCard({ field, farms, crops, onEdit, onDelete, apiFetch }) {
  const [gddData, setGddData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [showChart, setShowChart] = useState(false);

  useEffect(() => {
    apiFetch(`/api/fields/${field.id}/gdd`)
      .then(r => r.json())
      .then(d => { if (d?.error) { setError(d.error); setLoading(false); return; } setGddData(d); setLoading(false); })
      .catch(() => { setError("Failed to load GDD"); setLoading(false); });
  }, [field.id]);

  const farm    = farms.find(f => f.id === field.farmId);
  const cropDef = crops[field.crop];
  const stages  = cropDef?.stages || [];
  const planted = new Date(field.plantingDate + 'T12:00:00');
  const daysSincePlanting = Math.floor((new Date() - planted) / 86400000);
  const isFuturePlanting  = daysSincePlanting < 0;
  const totalGDD = gddData?.totalGDD ?? 0;
  const dtm = getVarietyDTM(crops, field.crop, field.variety);

  function blendedStageDate(stage) {
    const gddProj = gddData?.stageProjections?.find(s => s.name === stage.name);
    if (gddProj?.reached) return { date: gddProj.date, source: "actual" };
    const gddDate = gddProj?.date ? new Date(gddProj.date + 'T12:00:00') : null;
    const gddDaysAway = gddProj?.daysAway ?? null;
    const gddEstimated = gddProj?.estimated ?? false;
    if (!dtm || !stage.pct) return { date: gddProj?.date ?? null, daysAway: gddDaysAway, estimated: gddEstimated, source: "gdd" };
    const dtmDays = dtmDaysToStage(dtm, stage.pct);
    const dtmDate = new Date(planted); dtmDate.setDate(dtmDate.getDate() + dtmDays);
    const dtmDaysAway = Math.round((dtmDate - new Date()) / 86400000);
    if (!gddDate) return { date: dtmDate.toISOString().split('T')[0], daysAway: dtmDaysAway, source: "dtm" };
    const avgDate = new Date((gddDate.getTime() + dtmDate.getTime()) / 2);
    return { date: avgDate.toISOString().split('T')[0], daysAway: Math.round((avgDate - new Date()) / 86400000),
      gddDate: gddDate.toISOString().split('T')[0], dtmDate: dtmDate.toISOString().split('T')[0], estimated: gddEstimated, source: "blended" };
  }

  let currentStage = null, nextStage = null;
  if (gddData && stages.length && !isFuturePlanting) {
    for (let i = 0; i < stages.length; i++) {
      if (totalGDD < stages[i].gdd) { nextStage = stages[i]; currentStage = i > 0 ? stages[i-1] : null; break; }
      else { currentStage = stages[i]; }
    }
  } else if (stages.length && isFuturePlanting) { nextStage = stages[0]; }

  return (
    <div style={{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:14, padding:16, marginBottom:12 }}>
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
        <div style={{ display:"flex", gap:6 }}>
          <button style={S.btnSm()} onClick={() => onEdit(field)}>✎</button>
          <button style={S.btnSm("danger")} onClick={() => onDelete(field.id)}>🗑</button>
        </div>
      </div>

      {loading && <div style={{ marginTop:12 }}><div style={S.spinner}/></div>}
      {error && <div style={{ marginTop:10, fontSize:13, color:"#f87171" }}>{error}</div>}

      {gddData && !loading && (
        <div style={{ marginTop:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
            {[
              { label:"Total GDD", value: gddData.totalGDD, sub:`base ${BASE_TEMP}°F`, color:"#38bdf8", big:true, tappable:true },
              { label:"Days",      value: daysSincePlanting, sub:"since planting",      color:"#e2e8f0", big:true },
              { label:"Planted",   value: planted.toLocaleDateString('en-US',{month:'short',day:'numeric'}), sub: planted.getFullYear(), color:"#e2e8f0", big:false },
            ].map(({label,value,sub,color,big,tappable}) => (
              <div key={label}
                onClick={tappable ? () => setShowChart(true) : undefined}
                style={{ background:"#0f1f35", borderRadius:10, padding:"10px 12px", border:`1px solid ${tappable?"#2a4a7f":"#1e3a5f"}`, textAlign:"center", cursor:tappable?"pointer":"default" }}>
                <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</div>
                <div style={{ fontSize: big?24:13, fontWeight:700, color, marginTop:2 }}>{value}</div>
                <div style={{ fontSize:10, color:tappable?"#2563eb":"#475569" }}>{tappable?"📈 tap for chart":sub}</div>
              </div>
            ))}
          </div>

          {showChart && (
            <GDDChartModal
              gddData={gddData}
              field={field}
              cropDef={crops[field.crop]}
              onClose={() => setShowChart(false)}
            />
          )}

          {nextStage && (() => {
            const blend = blendedStageDate(nextStage);
            const blendDate = blend?.date ? new Date(blend.date + 'T12:00:00') : null;
            return (
              <div style={{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
                {isFuturePlanting ? (
                  <>
                    <div style={{ fontSize:11, color:"#f59e0b", textTransform:"uppercase", letterSpacing:"0.08em" }}>Not Planted Yet</div>
                    <div style={{ fontSize:14, fontWeight:700, color:"#f0f9ff", marginTop:2 }}>Plants in {Math.abs(daysSincePlanting)} day{Math.abs(daysSincePlanting)!==1?"s":""}</div>
                    <div style={{ fontSize:12, color:"#475569", marginTop:2 }}>{planted.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'})}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>Current Stage</div>
                    <div style={{ fontSize:14, fontWeight:700, color:"#f0f9ff", marginTop:2 }}>{currentStage ? currentStage.name : "Pre-emergence"}</div>
                    <div style={{ fontSize:12, color:"#38bdf8", marginTop:4 }}>Next: <strong>{nextStage.name}</strong></div>
                    {blendDate && (
                      <div style={{ fontSize:13, color:"#e2e8f0", marginTop:4 }}>
                        📅 Est. {blendDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                        {blend.daysAway != null && <span style={{ color:"#64748b", fontSize:12 }}>{" · "}{blend.daysAway<=0?"any day now":blend.daysAway===1?"tomorrow":`in ${blend.daysAway} days`}</span>}
                        {blend.source==="blended" && <span style={{ color:"#334155", fontSize:11 }}> · GDD + DTM avg</span>}
                      </div>
                    )}
                    <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>{Math.round(nextStage.gdd - totalGDD)} GDD remaining</div>
                  </>
                )}
              </div>
            );
          })()}

          {!nextStage && stages.length > 0 && (
            <div style={{ background:"#14532d", border:"1px solid #22c55e", borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#22c55e" }}>✅ Maturity Reached</div>
            </div>
          )}

          <button style={{ background:"transparent", border:"none", color:"#38bdf8", fontSize:13, cursor:"pointer", padding:0, marginBottom: expanded?8:0 }}
            onClick={() => setExpanded(e => !e)}>{expanded ? "▲ Hide stage detail" : "▼ Show stage detail"}</button>

          {expanded && (
            <>
              {stages.length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <div style={S.sectionTitle}>Stage Forecast</div>
                    {dtm && <div style={{ fontSize:10, color:"#334155" }}>GDD + {field.variety} DTM blended</div>}
                  </div>
                  {stages.map(stage => {
                    const blend = blendedStageDate(stage);
                    const d = blend?.date ? new Date(blend.date+'T12:00:00') : null;
                    const isReached = blend?.source==="actual";
                    return (
                      <div key={stage.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid #1e293b" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ fontSize:14 }}>{isReached?"✅":"📅"}</span>
                          <div>
                            <div style={{ fontSize:13, fontWeight: isReached?500:600, color: isReached?"#475569":"#f0f9ff" }}>{stage.name}</div>
                            <div style={{ fontSize:11, color:"#334155" }}>{stage.gdd} GDD</div>
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          {isReached ? <div style={{ fontSize:12, color:"#22c55e" }}>{d?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):"Reached"}</div>
                           : d ? (<><div style={{ fontSize:13, fontWeight:600, color:"#38bdf8" }}>{d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                              <div style={{ fontSize:11, color:"#475569" }}>{blend.daysAway<=0?"any day now":blend.daysAway===1?"tomorrow":blend.daysAway!=null?`in ${blend.daysAway} days`:""}{blend.source==="blended"&&blend.gddDate!==blend.dtmDate&&<span style={{ color:"#1e3a5f" }}> · avg</span>}</div></>)
                           : <div style={{ fontSize:12, color:"#334155" }}>—</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <StageProgress stages={stages} totalGDD={gddData.totalGDD} />
              <div style={{ marginTop:14 }}>
                <div style={S.sectionTitle}>Last 7 Days</div>
                {gddData.daily.slice(-7).reverse().map(d => (
                  <div key={d.date} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #1e293b", fontSize:13 }}>
                    <span style={{ color:"#94a3b8" }}>{new Date(d.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>
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

function CropManager({ crops, apiFetch, onClose, onCropsChanged }) {
  const [tab, setTab]           = useState("crops");
  const [selectedCrop, setSelectedCrop] = useState(Object.keys(crops)[0] || "");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [newCropKey,   setNewCropKey]   = useState("");
  const [newCropLabel, setNewCropLabel] = useState("");
  const [newCropEmoji, setNewCropEmoji] = useState("🌾");
  const [newVarName, setNewVarName] = useState("");
  const [newVarDTM,  setNewVarDTM]  = useState("");
  const [stagesEdit, setStagesEdit] = useState([]);
  const [stagesChanged, setStagesChanged] = useState(false);
  const cropKeys = Object.keys(crops);

  useEffect(() => {
    if (selectedCrop && crops[selectedCrop]) {
      setStagesEdit(JSON.parse(JSON.stringify(crops[selectedCrop].stages || [])));
      setStagesChanged(false);
    }
  }, [selectedCrop, crops]);

  async function addCrop() {
    const key = newCropKey.trim().toLowerCase().replace(/\s+/g,'_');
    if (!key || !newCropLabel.trim()) { setError("Key and label are required"); return; }
    setSaving(true); setError(null);
    const res = await apiFetch('/api/crops', { method:'POST', body: JSON.stringify({ key, label: newCropLabel.trim(), emoji: newCropEmoji }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    setNewCropKey(""); setNewCropLabel(""); setNewCropEmoji("🌾");
    setSaving(false); onCropsChanged(); setSelectedCrop(key);
  }

  async function deleteCrop(key) {
    if (!confirm(`Delete ${crops[key]?.label}? This won't affect existing fields.`)) return;
    await apiFetch(`/api/crops/${key}`, { method:'DELETE' });
    onCropsChanged(); setSelectedCrop(cropKeys.find(k=>k!==key)||"");
  }

  async function addVariety() {
    if (!newVarName.trim()) { setError("Variety name is required"); return; }
    setSaving(true); setError(null);
    const res = await apiFetch(`/api/crops/${selectedCrop}/varieties`, { method:'POST', body: JSON.stringify({ name: newVarName.trim(), dtm: newVarDTM||null }) });
    if (!res.ok) { const d = await res.json(); setError(d.error); setSaving(false); return; }
    setNewVarName(""); setNewVarDTM(""); setSaving(false); onCropsChanged();
  }

  async function deleteVariety(name) {
    await apiFetch(`/api/crops/${selectedCrop}/varieties/${encodeURIComponent(name)}`, { method:'DELETE' });
    onCropsChanged();
  }

  async function saveStages() {
    for (const s of stagesEdit) { if (!s.name?.trim()||!s.gdd) { setError("All stages need a name and GDD value"); return; } }
    setSaving(true); setError(null);
    const res = await apiFetch(`/api/crops/${selectedCrop}/stages`, { method:'PUT', body: JSON.stringify({ stages: stagesEdit.map((s,i) => ({ name:s.name.trim(), gdd:parseInt(s.gdd), pct: parseFloat(s.pct)||(i+1)/stagesEdit.length })) }) });
    if (!res.ok) { const d = await res.json(); setError(d.error); setSaving(false); return; }
    setSaving(false); setStagesChanged(false); onCropsChanged();
  }

  function addStageRow() { const last = stagesEdit.length ? stagesEdit[stagesEdit.length-1].gdd : 0; setStagesEdit(s=>[...s,{name:"",gdd:parseInt(last)+200,pct:1.0}]); setStagesChanged(true); }
  function updateStage(i,f,v) { setStagesEdit(s=>{const n=[...s];n[i]={...n[i],[f]:v};return n;}); setStagesChanged(true); }
  function removeStage(i) { setStagesEdit(s=>s.filter((_,idx)=>idx!==i)); setStagesChanged(true); }
  function moveStage(i,dir) { setStagesEdit(s=>{const n=[...s];const j=i+dir;if(j<0||j>=n.length)return n;[n[i],n[j]]=[n[j],n[i]];return n;}); setStagesChanged(true); }

  const cropSelector = (
    <div style={{ marginBottom:14 }}>
      <div style={S.label}>Crop</div>
      <div style={{ position:"relative" }}>
        <select style={S.select} value={selectedCrop} onChange={e=>setSelectedCrop(e.target.value)}>
          {cropKeys.map(k=><option key={k} value={k}>{crops[k]?.emoji} {crops[k]?.label}</option>)}
        </select>
        <span style={{ position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"#475569",pointerEvents:"none" }}>▼</span>
      </div>
    </div>
  );

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:17, fontWeight:700, color:"#f0f9ff" }}>🌾 Manage Crops</div>
          <button style={{ background:"transparent", border:"none", color:"#475569", fontSize:20, cursor:"pointer" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display:"flex", gap:4, marginBottom:16, background:"#0a1628", borderRadius:10, padding:4 }}>
          {["crops","varieties","stages"].map(t=>(
            <button key={t} style={{...S.tab(tab===t),flex:1,textTransform:"capitalize"}} onClick={()=>{setTab(t);setError(null);}}>
              {t}
            </button>
          ))}
        </div>

        {error && <div style={{ background:"#7f1d1d", border:"1px solid #ef4444", borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:13, color:"#fca5a5" }}>⚠️ {error}</div>}

        {tab==="crops" && (
          <>
            <div style={S.sectionTitle}>Your Crop Types</div>
            {cropKeys.map(k=>(
              <div key={k} style={S.row}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:18 }}>{crops[k]?.emoji}</span>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:"#f0f9ff" }}>{crops[k]?.label}</div>
                    <div style={{ fontSize:11, color:"#475569" }}>{Object.keys(crops[k]?.varieties||{}).length} varieties · {crops[k]?.stages?.length||0} stages</div>
                  </div>
                </div>
                <button style={S.btnSm("danger")} onClick={()=>deleteCrop(k)}>Delete</button>
              </div>
            ))}
            <div style={{ marginTop:18 }}>
              <div style={S.sectionTitle}>Add New Crop Type</div>
              <div style={S.label}>Crop Key (no spaces, e.g. "sweet_corn")</div>
              <input style={S.input} placeholder="sweet_corn" value={newCropKey} onChange={e=>setNewCropKey(e.target.value)}/>
              <div style={S.label}>Display Name</div>
              <input style={S.input} placeholder="Sweet Corn" value={newCropLabel} onChange={e=>setNewCropLabel(e.target.value)}/>
              <div style={S.label}>Emoji</div>
              <input style={{...S.input,width:80}} placeholder="🌽" value={newCropEmoji} onChange={e=>setNewCropEmoji(e.target.value)}/>
              <button style={S.btn("primary")} onClick={addCrop} disabled={saving}>{saving?"Saving...":"+ Add Crop"}</button>
            </div>
          </>
        )}

        {tab==="varieties" && (
          <>
            {cropSelector}
            <div style={S.sectionTitle}>Varieties — {crops[selectedCrop]?.label}</div>
            {Object.entries(crops[selectedCrop]?.varieties||{}).map(([name,v])=>(
              <div key={name} style={S.row}>
                <div>
                  <div style={{ fontSize:14, color:"#f0f9ff" }}>{name}</div>
                  <div style={{ fontSize:11, color:"#475569" }}>{v.dtm?`${v.dtm} days to maturity`:"No DTM set"}</div>
                </div>
                <button style={S.btnSm("danger")} onClick={()=>deleteVariety(name)}>Delete</button>
              </div>
            ))}
            {Object.keys(crops[selectedCrop]?.varieties||{}).length===0 && <div style={{ fontSize:13, color:"#475569", marginBottom:12 }}>No varieties yet</div>}
            <div style={{ marginTop:16 }}>
              <div style={S.sectionTitle}>Add Variety</div>
              <div style={S.label}>Variety Name</div>
              <input style={S.input} placeholder="e.g. Walla Walla Sweet" value={newVarName} onChange={e=>setNewVarName(e.target.value)}/>
              <div style={S.label}>Days to Maturity (optional)</div>
              <input style={S.input} type="number" placeholder="e.g. 125" value={newVarDTM} onChange={e=>setNewVarDTM(e.target.value)}/>
              <button style={S.btn("primary")} onClick={addVariety} disabled={saving}>{saving?"Saving...":"+ Add Variety"}</button>
            </div>
          </>
        )}

        {tab==="stages" && (
          <>
            {cropSelector}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={S.sectionTitle}>Growth Stages — {crops[selectedCrop]?.label}</div>
            </div>
            <div style={{ fontSize:11, color:"#334155", marginBottom:10 }}>
              GDD thresholds are cumulative from planting at Base {BASE_TEMP}°F. Last stage = maturity.
            </div>
            {stagesEdit.map((stage,i)=>(
              <div key={i} style={{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:10, marginBottom:8 }}>
                <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                  <input style={{...S.inputSm,flex:2}} placeholder="Stage name" value={stage.name} onChange={e=>updateStage(i,'name',e.target.value)}/>
                  <input style={{...S.inputSm,flex:1}} type="number" placeholder="GDD" value={stage.gdd} onChange={e=>updateStage(i,'gdd',e.target.value)}/>
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                  <button style={S.btnSm()} onClick={()=>moveStage(i,-1)} disabled={i===0}>↑</button>
                  <button style={S.btnSm()} onClick={()=>moveStage(i,1)} disabled={i===stagesEdit.length-1}>↓</button>
                  <button style={S.btnSm("danger")} onClick={()=>removeStage(i)}>Remove</button>
                </div>
              </div>
            ))}
            <button style={{...S.btn(),marginTop:4}} onClick={addStageRow}>+ Add Stage</button>
            {stagesChanged && <button style={S.btn("primary")} onClick={saveStages} disabled={saving}>{saving?"Saving...":"💾 Save Stages"}</button>}
          </>
        )}
      </div>
    </div>
  );
}

export default function GDDTab({ farms, apiFetch }) {
  const [fields, setFields]           = useState([]);
  const [crops, setCrops]             = useState({});
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadingCrops, setLoadingCrops]   = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [showCropMgr, setShowCropMgr] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState(null);
  const [form, setForm]               = useState({ name:"", farmId:"", crop:"", variety:"", plantingDate:"" });

  const loadCrops = useCallback(() => {
    setLoadingCrops(true);
    apiFetch('/api/crops').then(r=>r.json()).then(data=>{setCrops(data);setLoadingCrops(false);}).catch(()=>setLoadingCrops(false));
  }, []);

  const loadFields = useCallback(() => {
    setLoadingFields(true);
    apiFetch('/api/fields').then(r=>r.json()).then(data=>{setFields(Array.isArray(data)?data:[]);setLoadingFields(false);}).catch(()=>{setFields([]);setLoadingFields(false);});
  }, []);

  useEffect(()=>{ loadCrops(); loadFields(); },[]);

  const cropKeys = Object.keys(crops);

  function openAdd() {
    setSaveError(null);
    const firstCrop = cropKeys[0]||"";
    const firstVariety = firstCrop ? getVarieties(crops,firstCrop)[0]||"" : "";
    setForm({ name:"", farmId: farms[0]?.id??"", crop:firstCrop, variety:firstVariety, plantingDate:"" });
    setEditingField(null); setShowAdd(true);
  }
  function openEdit(field) {
    setSaveError(null);
    setForm({ name:field.name, farmId:field.farmId, crop:field.crop, variety:field.variety||getVarieties(crops,field.crop)[0]||"", plantingDate:field.plantingDate });
    setEditingField(field); setShowAdd(true);
  }

  async function saveField() {
    const farmId = Number(form.farmId);
    if (!form.name.trim()) { setSaveError("Please enter a field name."); return; }
    if (!farmId)           { setSaveError("Please select a farm location."); return; }
    if (!form.plantingDate){ setSaveError("Please enter a planting date."); return; }
    setSaveError(null); setSaving(true);
    try {
      const url = editingField ? `/api/fields/${editingField.id}` : '/api/fields';
      const method = editingField ? 'PUT' : 'POST';
      const res = await apiFetch(url, { method, body: JSON.stringify({ name:form.name.trim(), farmId, crop:form.crop, variety:form.variety||"", plantingDate:form.plantingDate }) });
      if (!res.ok) { const err = await res.json().catch(()=>({})); setSaveError(err.error||`Server error ${res.status}`); setSaving(false); return; }
      setShowAdd(false); loadFields();
    } catch { setSaveError("Network error — please try again."); }
    setSaving(false);
  }

  async function deleteField(id) {
    await apiFetch(`/api/fields/${id}`, { method:'DELETE' });
    loadFields();
  }

  const arrowSpan = <span style={{ position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"#475569",pointerEvents:"none" }}>▼</span>;
  const isLoading = loadingFields || loadingCrops;

  return (
    <div style={{ padding:"0 16px", paddingBottom:80 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, marginBottom:4 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569" }}>
          🌡️ Growing Degree Days · Base {BASE_TEMP}°F
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={{ background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:10, padding:"8px 12px", fontSize:12, fontWeight:600, cursor:"pointer" }}
            onClick={()=>setShowCropMgr(true)}>🌾 Crops</button>
          <button style={{ background:"#38bdf8", border:"none", color:"#0a0f1a", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}
            onClick={openAdd}>+ Add Field</button>
        </div>
      </div>

      <div style={{ fontSize:12, color:"#334155", marginBottom:14 }}>
        GDD calculated from planting date using weather at the linked farm location.
      </div>

      {isLoading && <div style={{ display:"flex", justifyContent:"center", padding:"40px 0" }}><div style={S.spinner}/></div>}

      {!isLoading && fields.length===0 && (
        <div style={{...S.card, textAlign:"center", color:"#475569", padding:"40px 20px"}}>
          <div style={{ fontSize:32, marginBottom:10 }}>🌾</div>
          <div style={{ fontSize:15, fontWeight:600, color:"#64748b" }}>No fields yet</div>
          <div style={{ fontSize:13, marginTop:6 }}>Add a field to start tracking GDD</div>
          <button style={{...S.btn("primary"), marginTop:16, width:"auto", padding:"10px 24px"}} onClick={openAdd}>+ Add First Field</button>
        </div>
      )}

      {!isLoading && fields.map(field=>(
        <FieldCard key={field.id} field={field} farms={farms} crops={crops} onEdit={openEdit} onDelete={deleteField} apiFetch={apiFetch}/>
      ))}

      {showAdd && (
        <div style={S.modal} onClick={()=>setShowAdd(false)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:16, color:"#f0f9ff" }}>{editingField?"Edit Field":"Add Field"}</div>

            {saveError && <div style={{ background:"#7f1d1d", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:13, color:"#fca5a5" }}>⚠️ {saveError}</div>}

            <div style={S.label}>Field Name</div>
            <input style={S.input} placeholder="e.g. Wheeler North 40" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>

            <div style={S.label}>Farm Location (for weather)</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={S.select} value={form.farmId} onChange={e=>setForm(f=>({...f,farmId:e.target.value}))}>
                {farms.map(farm=><option key={farm.id} value={farm.id}>{farm.name}</option>)}
              </select>
              {arrowSpan}
            </div>

            <div style={S.label}>Crop Type</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={S.select} value={form.crop} onChange={e=>setForm(f=>({...f,crop:e.target.value,variety:getVarieties(crops,e.target.value)[0]||""}))}>
                {cropKeys.map(k=><option key={k} value={k}>{crops[k]?.emoji} {crops[k]?.label}</option>)}
              </select>
              {arrowSpan}
            </div>

            <div style={S.label}>Variety</div>
            <div style={{ position:"relative", marginBottom:10 }}>
              <select style={S.select} value={form.variety} onChange={e=>setForm(f=>({...f,variety:e.target.value}))}>
                {getVarieties(crops,form.crop).map(v=>{const dtm=getVarietyDTM(crops,form.crop,v);return <option key={v} value={v}>{v}{dtm?` (${dtm} days)`:""}</option>;})}
                {getVarieties(crops,form.crop).length===0 && <option value="">No varieties — add in Crop Manager</option>}
              </select>
              {arrowSpan}
            </div>

            <div style={S.label}>Planting Date</div>
            <input style={S.input} type="date" value={form.plantingDate} onChange={e=>setForm(f=>({...f,plantingDate:e.target.value}))}/>
            <div style={{ fontSize:11, color:"#334155", marginBottom:14 }}>GDD will be calculated from this date using historical weather data at the selected farm.</div>

            <button style={S.btn("primary")} onClick={saveField} disabled={saving}>{saving?"Saving...":editingField?"Save Changes":"Add Field"}</button>
            <button style={S.btn()} onClick={()=>setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showCropMgr && (
        <CropManager crops={crops} apiFetch={apiFetch} onClose={()=>setShowCropMgr(false)} onCropsChanged={()=>loadCrops()}/>
      )}
    </div>
  );
}
