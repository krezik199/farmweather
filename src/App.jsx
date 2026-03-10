import { useState, useEffect, useCallback } from "react";
import GDDTab from "./GDDTab.jsx";
import DataTab from "./DataTab.jsx";

const DEFAULT_FARMS = [
  { id: 1, name: "Wheeler",     lat: 47.145960, lon: -119.084559 },
  { id: 2, name: "Meyer",       lat: 47.228213, lon: -119.087152 },
  { id: 3, name: "Hirz",        lat: 47.263619, lon: -119.205851 },
  { id: 4, name: "County Line", lat: 47.115975, lon: -118.981951 },
  { id: 5, name: "Kulm",        lat: 46.995123, lon: -118.849620 },
  { id: 6, name: "Lincoln",     lat: 47.309481, lon: -118.915966 },
  { id: 7, name: "Wilbur",      lat: 47.634717, lon: -118.657076 },
];

const WMO_CODES = {
  0:"Clear",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",
  45:"Fog",48:"Icy Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",
  61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",
  75:"Heavy Snow",77:"Snow Grains",80:"Rain Showers",81:"Rain Showers",
  82:"Violent Showers",85:"Snow Showers",86:"Heavy Snow Showers",
  95:"Thunderstorm",96:"Thunderstorm w/ Hail",99:"Thunderstorm w/ Heavy Hail",
};
const WMO_ICON = {
  0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",
  51:"🌦️",53:"🌦️",55:"🌧️",61:"🌧️",63:"🌧️",65:"🌧️",
  71:"🌨️",73:"❄️",75:"❄️",77:"🌨️",80:"🌧️",81:"🌧️",
  82:"⛈️",85:"🌨️",86:"❄️",95:"⛈️",96:"⛈️",99:"⛈️",
};
const DAYS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function windDir(deg) {
  const d = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(deg/22.5)%16];
}
function sprayStatus(windMph, precip) {
  if (precip > 0.05) return { label:"NO SPRAY — Rain",          color:"#ef4444", bg:"#7f1d1d" };
  if (windMph < 3)   return { label:"CAUTION — Inversion Risk", color:"#f59e0b", bg:"#78350f" };
  if (windMph <= 12) return { label:"GOOD TO SPRAY",            color:"#22c55e", bg:"#14532d" };
  if (windMph <= 15) return { label:"MARGINAL — Verify",        color:"#f59e0b", bg:"#78350f" };
  return               { label:"NO SPRAY — Too Windy",          color:"#ef4444", bg:"#7f1d1d" };
}
function frostRisk(tempF) {
  if (tempF <= 28) return { label:"HARD FREEZE", color:"#a78bfa" };
  if (tempF <= 32) return { label:"FREEZE WARNING", color:"#818cf8" };
  if (tempF <= 36) return { label:"FROST POSSIBLE", color:"#93c5fd" };
  return null;
}

async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,` +
    `wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,` +
    `wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=America%2FLos_Angeles&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}

// ── Push notification helpers ──
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function getVapidKey() {
  const res = await fetch('/api/vapid-public-key');
  const { key } = await res.json();
  return key;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push not supported');
  const reg = await navigator.serviceWorker.ready;
  const vapidKey = await getVapidKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  const res = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  return res.ok;
}

async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

async function getCurrentPushSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function WindArrow({ deg, size = 20 }) {
  // Wind degree = direction it comes FROM. Add 180° so arrow points where wind is GOING.
  const arrowDeg = (deg + 180) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{ transform:`rotate(${arrowDeg}deg)`, display:"inline-block" }}>
      <path d="M12 2 L7 18 L12 14 L17 18 Z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

// ── Notification Settings Panel ──
function NotificationPanel({ onClose }) {
  const [status, setStatus]     = useState('checking');
  const [loading, setLoading]   = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg]           = useState('');
  const [alertResults, setAlertResults] = useState(null); // null | []

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setStatus('unsupported'); return; }
      if (Notification.permission === 'denied') { setStatus('denied'); return; }
      const sub = await getCurrentPushSub();
      setStatus(sub ? 'subscribed' : 'unsubscribed');
    })();
  }, []);

  async function enable() {
    setLoading(true); setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus('denied'); setLoading(false); return; }
      await subscribeToPush();
      setStatus('subscribed');
      setMsg('✅ Alerts enabled on this device!');
    } catch (e) { setMsg('❌ Error: ' + e.message); }
    setLoading(false);
  }

  async function disable() {
    setLoading(true);
    await unsubscribeFromPush();
    setStatus('unsubscribed');
    setMsg('Alerts disabled on this device.');
    setLoading(false);
  }

  async function getMySubscription() {
    try {
      const reg = await navigator.serviceWorker.ready;
      return await reg.pushManager.getSubscription();
    } catch { return null; }
  }

  async function sendTest() {
    setLoading(true); setMsg(''); setAlertResults(null);
    try {
      const subscription = await getMySubscription();
      const res = await fetch('/api/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
      if (res.ok) setMsg('📲 Test notification sent!');
      else setMsg('❌ Failed to send test.');
    } catch { setMsg('❌ Error sending test.'); }
    setLoading(false);
  }

  async function checkNow() {
    setChecking(true); setMsg(''); setAlertResults(null);
    try {
      const subscription = await getMySubscription();
      const res = await fetch('/api/check-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
      const data = await res.json();
      setAlertResults(data.alerts || []);
      if (data.alerts.length === 0) setMsg('');
    } catch { setMsg('❌ Error checking alerts.'); }
    setChecking(false);
  }

  const s = {
    overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:200, display:'flex', alignItems:'flex-end' },
    box: { background:'#0f1f35', border:'1px solid #1e3a5f', borderRadius:'20px 20px 0 0', padding:24, width:'100%', maxWidth:430, margin:'0 auto', maxHeight:'88vh', overflowY:'auto' },
    title: { fontSize:17, fontWeight:700, marginBottom:4, color:'#f0f9ff' },
    sub: { fontSize:13, color:'#64748b', marginBottom:16 },
    row: { background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:12, padding:'12px 14px', marginBottom:8 },
    rowTitle: { fontSize:13, fontWeight:700, color:'#e2e8f0', marginBottom:3 },
    rowDesc: { fontSize:12, color:'#64748b' },
    badge: (on) => ({ display:'inline-block', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
      background: on ? '#14532d' : '#1e293b', color: on ? '#22c55e' : '#475569', marginBottom:10 }),
    btn: (v) => ({ width:'100%', padding:13, borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer',
      border:'none', marginBottom:8, background: v==='primary'?'#38bdf8': v==='danger'?'#7f1d1d': v==='green'?'#15803d':'#1e293b',
      color: v==='primary'?'#0a0f1a': v==='danger'?'#f87171': v==='green'?'#f0fdf4':'#94a3b8' }),
    msg: { fontSize:13, color:'#94a3b8', textAlign:'center', marginBottom:8, minHeight:20 },
  };

  const ALERT_ICONS = { frost:'❄️', rain:'🌧️', wind:'💨', heat:'🌡️' };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.title}>🔔 Push Notifications</div>
        <div style={s.sub}>Alerts sent to this device at 6am, noon, and 6pm for the next 3 days.</div>

        {/* Alert types */}
        {[
          { emoji:'❄️', title:'Frost & Freeze',  desc:'36°F frost possible · 32°F freeze · 28°F hard freeze — up to 3 days ahead' },
          { emoji:'🌧️', title:'Rain',             desc:'50%+ chance or 0.1"+ forecast — up to 3 days ahead' },
          { emoji:'💨', title:'High Wind',        desc:'Sustained winds ≥20 mph — spray condition risk' },
          { emoji:'🌡️', title:'Heat',             desc:'High temperatures ≥95°F forecast' },
        ].map(a => (
          <div key={a.title} style={s.row}>
            <div style={s.rowTitle}>{a.emoji} {a.title}</div>
            <div style={s.rowDesc}>{a.desc}</div>
          </div>
        ))}

        {/* Status */}
        {status === 'checking' && <div style={s.msg}>Checking notification status...</div>}
        {status === 'unsupported' && <div style={{ ...s.msg, color:'#f87171' }}>⚠️ Push requires iOS 16.4+ and app added to Home Screen via Safari.</div>}
        {status === 'denied' && <div style={{ ...s.msg, color:'#f87171' }}>Notifications blocked. Go to Settings → Safari → Notifications to allow.</div>}

        {(status === 'subscribed' || status === 'unsubscribed') && (
          <>
            <div style={s.badge(status === 'subscribed')}>
              {status === 'subscribed' ? '● ALERTS ON' : '○ ALERTS OFF'}
            </div>
            {msg && <div style={s.msg}>{msg}</div>}

            {/* Manual check results */}
            {alertResults !== null && (
              <div style={{ background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:12, padding:'12px 14px', marginBottom:10 }}>
                {alertResults.length === 0 ? (
                  <div style={{ fontSize:13, color:'#22c55e', textAlign:'center' }}>
                    ✅ No weather alerts in the next 3 days
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:12, fontWeight:700, color:'#f59e0b', marginBottom:8 }}>
                      {alertResults.length} notification{alertResults.length !== 1 ? 's' : ''} sent
                    </div>
                    {alertResults.map((a, i) => (
                      <div key={i} style={{ padding:'8px 0', borderBottom: i < alertResults.length-1 ? '1px solid #1e293b' : 'none' }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0', marginBottom:3 }}>{a.title}</div>
                        <div style={{ fontSize:11, color:'#475569', lineHeight:1.5 }}>{a.body}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {status === 'unsubscribed' && (
              <button style={s.btn('primary')} onClick={enable} disabled={loading}>
                {loading ? 'Enabling...' : 'Enable Alerts on This Device'}
              </button>
            )}
            {status === 'subscribed' && (
              <>
                <button style={s.btn('green')} onClick={checkNow} disabled={checking || loading}>
                  {checking ? 'Checking...' : '🔍 Check for Alerts Now'}
                </button>
                <button style={s.btn('secondary')} onClick={sendTest} disabled={loading || checking}>
                  {loading ? 'Sending...' : '📲 Send Test Notification'}
                </button>
                <button style={s.btn('danger')} onClick={disable} disabled={loading}>
                  Disable Alerts
                </button>
              </>
            )}
          </>
        )}

        <button style={s.btn('secondary')} onClick={onClose}>Close</button>
        <div style={{ fontSize:11, color:'#334155', textAlign:'center', marginTop:4 }}>
          Scheduled at 6am · 12pm · 6pm Pacific · Each device subscribes independently
        </div>
      </div>
    </div>
  );
}

// ── Main App ──
export default function FarmWeather() {
  const [farms, setFarms] = useState(() => {
    try { return JSON.parse(localStorage.getItem("farms")) || DEFAULT_FARMS; } catch { return DEFAULT_FARMS; }
  });
  const [activeFarm, setActiveFarm]     = useState(0);
  const [weather, setWeather]           = useState({});
  const [loading, setLoading]           = useState({});
  const [errors, setErrors]             = useState({});
  const [tab, setTab]                   = useState("now");
  const [mainTab, setMainTab]           = useState("weather"); // "weather" | "gdd"
  const [showAddFarm, setShowAddFarm]   = useState(false);
  const [newFarm, setNewFarm]           = useState({ name:"", lat:"", lon:"" });
  const [editingId, setEditingId]       = useState(null);
  const [lastRefresh, setLastRefresh]   = useState(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showManageFarms, setShowManageFarms] = useState(false);
  const [notifOn, setNotifOn]           = useState(false);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
    getCurrentPushSub().then(sub => setNotifOn(!!sub));
  }, []);

  const loadWeather = useCallback(async (farm) => {
    setLoading(l => ({ ...l, [farm.id]: true }));
    setErrors(e  => ({ ...e,  [farm.id]: null }));
    try {
      const data = await fetchWeather(farm.lat, farm.lon);
      setWeather(w => ({ ...w, [farm.id]: data }));
      setLastRefresh(new Date());
    } catch {
      setErrors(e => ({ ...e, [farm.id]: "Unable to load weather" }));
    } finally {
      setLoading(l => ({ ...l, [farm.id]: false }));
    }
  }, []);

  useEffect(() => { farms.forEach(f => loadWeather(f)); }, []);
  useEffect(() => { try { localStorage.setItem("farms", JSON.stringify(farms)); } catch {} }, [farms]);

  const farm    = farms[activeFarm];
  const data    = farm ? weather[farm.id]  : null;
  const isLoading = farm ? loading[farm.id] : false;
  const error   = farm ? errors[farm.id]   : null;
  const cur     = data?.current;
  const daily   = data?.daily;
  const hourly  = data?.hourly;
  const windMph = cur?.wind_speed_10m || 0;
  const spray   = cur ? sprayStatus(windMph, cur.precipitation) : null;
  const frost   = daily ? frostRisk(daily.temperature_2m_min[0]) : null;

  const now = new Date();
  const hourlyFull = hourly ? hourly.time.map((t,i) => ({
    time: new Date(t),
    precip: hourly.precipitation[i],
    prob:   hourly.precipitation_probability[i],
    wind:   hourly.wind_speed_10m[i],
    windDir:hourly.wind_direction_10m[i],
    temp:   hourly.temperature_2m[i],
    code:   hourly.weather_code[i],
  })).filter(h => h.time >= now).slice(0,24) : [];

  function addFarm() {
    if (!newFarm.name || !newFarm.lat || !newFarm.lon) return;
    const f = { id:Date.now(), name:newFarm.name, lat:parseFloat(newFarm.lat), lon:parseFloat(newFarm.lon) };
    const updated = [...farms, f];
    setFarms(updated);
    setShowAddFarm(false);
    setNewFarm({ name:"", lat:"", lon:"" });
    loadWeather(f);
  }
  function deleteFarm(id) {
    const updated = farms.filter(f => f.id !== id);
    setFarms(updated);
    if (activeFarm >= updated.length) setActiveFarm(Math.max(0, updated.length-1));
  }

  const S = {
    app:{ fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif", background:"#0a0f1a", color:"#e2e8f0", minHeight:"100vh", maxWidth:430, margin:"0 auto", paddingBottom:"calc(65px + env(safe-area-inset-bottom, 0px))" },
    header:{ background:"linear-gradient(135deg,#0f172a 0%,#1e293b 100%)", borderBottom:"1px solid #1e3a5f", padding:"env(safe-area-inset-top, 16px) 20px 0", paddingTop:"max(env(safe-area-inset-top), 16px)", position:"sticky", top:0, zIndex:50 },
    headerTop:{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 },
    logo:{ fontSize:13, fontWeight:700, letterSpacing:"0.15em", textTransform:"uppercase", color:"#38bdf8" },
    headerActions:{ display:"flex", gap:8, alignItems:"center" },
    notifBtn:(on) => ({ background:"transparent", border:"1px solid " + (on?"#38bdf8":"#334155"), color: on?"#38bdf8":"#94a3b8", borderRadius:8, padding:"6px 10px", fontSize:16, cursor:"pointer" }),
    refreshBtn:{ background:"transparent", border:"1px solid #334155", color:"#94a3b8", borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer" },
    farmSelector:{ display:"flex", gap:8, paddingBottom:14, alignItems:"center" },
    farmDropdownWrap:{ flex:1, position:"relative" },
    farmDropdown:{ width:"100%", background:"#1e293b", border:"1px solid #2d3748", borderRadius:10, padding:"9px 36px 9px 14px", color:"#f0f9ff", fontSize:15, fontWeight:600, cursor:"pointer", appearance:"none", WebkitAppearance:"none" },
    farmDropdownArrow:{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"#475569", fontSize:12 },
    manageFarmsBtn:{ background:"transparent", border:"1px solid #334155", color:"#94a3b8", borderRadius:10, padding:"9px 13px", fontSize:13, cursor:"pointer", whiteSpace:"nowrap" },
    body:{ padding:"0 16px" },
    card:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:16, padding:18, marginTop:14 },
    bigTemp:{ fontSize:72, fontWeight:300, lineHeight:1, letterSpacing:-4, color:"#f0f9ff" },
    weatherIcon:{ fontSize:48 },
    desc:{ fontSize:16, color:"#94a3b8", marginTop:4 },
    feelsLike:{ fontSize:13, color:"#64748b", marginTop:2 },
    statGrid:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:14 },
    stat:{ background:"#0a1628", borderRadius:12, padding:"12px 14px", border:"1px solid #1e3a5f" },
    statLabel:{ fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" },
    statValue:{ fontSize:20, fontWeight:600, color:"#e2e8f0", marginTop:2 },
    statSub:{ fontSize:12, color:"#64748b", marginTop:1 },
    alertBanner:(bg,color) => ({ background:bg, border:`1px solid ${color}`, borderRadius:12, padding:"12px 16px", marginTop:12, display:"flex", alignItems:"center", gap:10 }),
    sprayBanner:(spray) => ({ background:spray.bg, border:`1px solid ${spray.color}`, borderRadius:12, padding:"14px 16px", marginTop:12 }),
    tabs:{ display:"flex", gap:2, background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:12, padding:4, marginTop:14 },
    tab:(a) => ({ flex:1, padding:"8px 0", borderRadius:9, fontSize:13, fontWeight:a?700:500, background:a?"#38bdf8":"transparent", color:a?"#0a0f1a":"#64748b", border:"none", cursor:"pointer" }),
    dayRow:{ display:"flex", alignItems:"center", padding:"12px 0", borderBottom:"1px solid #1e293b", gap:10 },
    hourRow:{ display:"flex", alignItems:"center", padding:"9px 0", borderBottom:"1px solid #1e293b", gap:8, fontSize:13 },
    sectionTitle:{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#475569", marginBottom:2 },
    modal:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:100 },
    modalBox:{ background:"#0f1f35", border:"1px solid #1e3a5f", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxWidth:430, margin:"0 auto" },
    input:{ width:"100%", background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:10, padding:"10px 14px", color:"#e2e8f0", fontSize:15, marginBottom:10, boxSizing:"border-box" },
    btn:(v) => ({ width:"100%", padding:13, borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", border:"none", marginBottom:8, background:v==="primary"?"#38bdf8":"#1e293b", color:v==="primary"?"#0a0f1a":"#94a3b8" }),
    loadingBox:{ display:"flex", flexDirection:"column", alignItems:"center", padding:"60px 0", color:"#475569", gap:12 },
    spinner:{ width:36, height:36, border:"3px solid #1e3a5f", borderTop:"3px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  };

  return (
    <div style={S.app}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} ::-webkit-scrollbar{display:none} *{box-sizing:border-box} body{margin:0;background:#0a0f1a} input::placeholder{color:#475569}`}</style>

      <div style={S.header}>
        <div style={S.headerTop}>
          <div style={S.logo}>⛅ FarmWeather</div>
          <div style={S.headerActions}>
            <button style={S.notifBtn(notifOn)} title="Notification Settings"
              onClick={() => setShowNotifPanel(true)}>🔔</button>
            <button style={S.refreshBtn} onClick={() => farms.forEach(f => loadWeather(f))}>↻ Refresh</button>
          </div>
        </div>
        <div style={S.farmSelector}>
          <div style={S.farmDropdownWrap}>
            <select style={S.farmDropdown} value={activeFarm}
              onChange={e => setActiveFarm(parseInt(e.target.value))}>
              {farms.map((f,i) => (
                <option key={f.id} value={i}>{f.name}</option>
              ))}
            </select>
            <span style={S.farmDropdownArrow}>▼</span>
          </div>
          <button style={S.manageFarmsBtn} onClick={() => setShowManageFarms(true)}>⚙ Manage</button>
        </div>
      </div>

      {mainTab === "gdd" && <GDDTab farms={farms} />}
      {mainTab === "data" && <DataTab farms={farms} />}

      {mainTab === "weather" && <div style={S.body}>
        {isLoading && (
          <div style={S.loadingBox}><div style={S.spinner} /><span style={{ fontSize:13 }}>Fetching weather...</span></div>
        )}
        {error && !isLoading && (
          <div style={{ ...S.card, textAlign:"center", color:"#f87171" }}>
            ⚠️ {error}<br/><button style={{ ...S.refreshBtn, marginTop:10 }} onClick={() => loadWeather(farm)}>Retry</button>
          </div>
        )}

        {cur && !isLoading && (
          <>
            <div style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <div style={S.bigTemp}>{Math.round(cur.temperature_2m)}°</div>
                  <div style={S.desc}>{WMO_CODES[cur.weather_code]||"—"}</div>
                  <div style={S.feelsLike}>Feels like {Math.round(cur.apparent_temperature)}° · {cur.relative_humidity_2m}% humidity</div>
                </div>
                <div style={S.weatherIcon}>{WMO_ICON[cur.weather_code]||"🌡️"}</div>
              </div>
              <div style={S.statGrid}>
                <div style={S.stat}>
                  <div style={S.statLabel}>Wind</div>
                  <div style={{ ...S.statValue, display:"flex", alignItems:"center", gap:6 }}>
                    <WindArrow deg={cur.wind_direction_10m} size={18}/>{Math.round(windMph)} mph
                  </div>
                  <div style={S.statSub}>{windDir(cur.wind_direction_10m)} · Gusts {Math.round(cur.wind_gusts_10m)} mph</div>
                </div>
                <div style={S.stat}>
                  <div style={S.statLabel}>Precip Today</div>
                  <div style={S.statValue}>{daily?.precipitation_sum[0]?.toFixed(2)??"0.00"}"</div>
                  <div style={S.statSub}>{daily?.precipitation_probability_max[0]}% chance</div>
                </div>
                <div style={S.stat}>
                  <div style={S.statLabel}>Today High/Low</div>
                  <div style={S.statValue}>{Math.round(daily?.temperature_2m_max[0])}° / {Math.round(daily?.temperature_2m_min[0])}°</div>
                  <div style={S.statSub}>
                    {daily?.sunrise[0] ? new Date(daily.sunrise[0]).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : "—"} ↑ ·{" "}
                    {daily?.sunset[0]  ? new Date(daily.sunset[0]).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})  : "—"} ↓
                  </div>
                </div>
                <div style={S.stat}>
                  <div style={S.statLabel}>Max Wind Today</div>
                  <div style={S.statValue}>{Math.round(daily?.wind_speed_10m_max[0])} mph</div>
                  <div style={S.statSub}>Gusts to {Math.round(daily?.wind_gusts_10m_max[0])} mph</div>
                </div>
              </div>
            </div>

            {spray && (
              <div style={S.sprayBanner(spray)}>
                <div style={S.sectionTitle}>🌿 Spray Conditions</div>
                <div style={{ fontSize:17, fontWeight:800, color:spray.color, marginTop:4 }}>{spray.label}</div>
                <div style={{ fontSize:12, color:"#94a3b8", marginTop:4 }}>
                  {Math.round(windMph)} mph {windDir(cur.wind_direction_10m)} · Gusts {Math.round(cur.wind_gusts_10m)} mph
                </div>
              </div>
            )}

            {frost && (
              <div style={S.alertBanner("#1a0a2e", frost.color)}>
                <span style={{ fontSize:22 }}>❄️</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:frost.color }}>{frost.label}</div>
                  <div style={{ fontSize:12, color:"#94a3b8" }}>Tonight's low: {Math.round(daily?.temperature_2m_min[0])}°F</div>
                </div>
              </div>
            )}

            <div style={S.tabs}>
              {["now","7day","wind","rain"].map(t => (
                <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>
                  {t==="now"?"Hourly":t==="7day"?"7 Day":t==="wind"?"Wind":"Rain"}
                </button>
              ))}
            </div>

            <div style={{ ...S.card, marginTop:0, borderTopLeftRadius:0, borderTopRightRadius:0, borderTop:"none" }}>
              {tab==="7day" && daily && daily.time.map((d,i) => {
                const dt = new Date(d+"T12:00:00");
                const fr = frostRisk(daily.temperature_2m_min[i]);
                return (
                  <div key={d} style={S.dayRow}>
                    <div style={{ width:40, fontSize:13, color:"#94a3b8", fontWeight:600 }}>{i===0?"Today":DAYS[dt.getDay()]}</div>
                    <div style={{ width:32, fontSize:20, textAlign:"center" }}>{WMO_ICON[daily.weather_code[i]]||"🌡️"}</div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#f0f9ff" }}>{Math.round(daily.temperature_2m_max[i])}°</span>
                      <span style={{ fontSize:14, color:"#64748b", marginLeft:6 }}>{Math.round(daily.temperature_2m_min[i])}°</span>
                      {fr && <span style={{ fontSize:11, color:fr.color, marginLeft:6 }}>● {fr.label}</span>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:12, color:"#38bdf8" }}>{daily.precipitation_sum[i]?.toFixed(2)}"</div>
                      <div style={{ fontSize:11, color:"#475569" }}>{daily.precipitation_probability_max[i]}%</div>
                      <div style={{ fontSize:11, color:"#64748b" }}>{Math.round(daily.wind_speed_10m_max[i])}mph</div>
                    </div>
                  </div>
                );
              })}

              {tab==="now" && (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"55px 36px 1fr 50px 50px", gap:6, padding:"6px 0 10px", fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em", borderBottom:"1px solid #1e293b" }}>
                    <span>Time</span><span>Sky</span><span>Conditions</span><span>Temp</span><span>Wind</span>
                  </div>
                  {hourlyFull.map((h,i) => {
                    const hh=h.time.getHours(), ampm=hh>=12?"pm":"am", h12=hh%12||12;
                    return (
                      <div key={i} style={S.hourRow}>
                        <div style={{ width:55, color:"#94a3b8" }}>{h12}{ampm}</div>
                        <div style={{ width:36, fontSize:18 }}>{WMO_ICON[h.code]||"—"}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, color:"#94a3b8" }}>{WMO_CODES[h.code]||"—"}</div>
                          {h.precip>0 && <div style={{ fontSize:11, color:"#38bdf8" }}>{h.precip.toFixed(2)}"</div>}
                        </div>
                        <div style={{ width:46, textAlign:"right", fontSize:14, fontWeight:600 }}>{Math.round(h.temp)}°</div>
                        <div style={{ width:50, textAlign:"right", fontSize:12, color:"#64748b" }}>{Math.round(h.wind)}mph</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab==="wind" && (
                <div>
                  <div style={{ ...S.sprayBanner(spray), marginTop:0, marginBottom:14 }}>
                    <div style={S.sectionTitle}>Current Spray Window</div>
                    <div style={{ fontSize:18, fontWeight:800, color:spray.color, marginTop:4 }}>{spray.label}</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"55px 1fr 65px 55px", gap:6, padding:"6px 0 10px", fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em", borderBottom:"1px solid #1e293b" }}>
                    <span>Time</span><span>Status</span><span>Speed</span><span>Dir</span>
                  </div>
                  {hourlyFull.map((h,i) => {
                    const hh=h.time.getHours(), ampm=hh>=12?"pm":"am", h12=hh%12||12;
                    const s = sprayStatus(h.wind, h.precip);
                    return (
                      <div key={i} style={S.hourRow}>
                        <div style={{ width:55, color:"#94a3b8" }}>{h12}{ampm}</div>
                        <div style={{ flex:1, fontSize:12, color:s.color, fontWeight:600 }}>{s.label}</div>
                        <div style={{ width:60, textAlign:"right", fontSize:13 }}>{Math.round(h.wind)} mph</div>
                        <div style={{ width:50, textAlign:"right", fontSize:12, color:"#64748b", display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4 }}>
                          <WindArrow deg={h.windDir} size={13}/>{windDir(h.windDir)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab==="rain" && (
                <div>
                  <div style={{ marginBottom:14 }}>
                    <div style={S.sectionTitle}>7-Day Precipitation</div>
                    {daily?.time.map((d,i) => {
                      const dt = new Date(d+"T12:00:00");
                      const pct = daily.precipitation_probability_max[i];
                      return (
                        <div key={d} style={{ padding:"10px 0", borderBottom:"1px solid #1e293b" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                            <span style={{ fontSize:13, color:"#94a3b8" }}>{i===0?"Today":`${DAYS[dt.getDay()]} ${MONTHS[dt.getMonth()]} ${dt.getDate()}`}</span>
                            <span style={{ fontSize:13, color:"#38bdf8", fontWeight:600 }}>{daily.precipitation_sum[i]?.toFixed(2)}" · {pct}%</span>
                          </div>
                          <div style={{ height:6, background:"#0a1628", borderRadius:3, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pct}%`, background:pct>60?"#3b82f6":pct>30?"#60a5fa":"#93c5fd", borderRadius:3 }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={S.sectionTitle}>Next 24h Hourly Rain</div>
                  {hourlyFull.filter(h=>h.prob>5||h.precip>0).length===0 ? (
                    <div style={{ fontSize:14, color:"#64748b", padding:"12px 0" }}>No significant rain expected in next 24 hours.</div>
                  ) : hourlyFull.filter(h=>h.prob>5||h.precip>0).map((h,i) => {
                    const hh=h.time.getHours(), ampm=hh>=12?"pm":"am", h12=hh%12||12;
                    return (
                      <div key={i} style={S.hourRow}>
                        <div style={{ width:50, color:"#94a3b8" }}>{h12}{ampm}</div>
                        <div style={{ flex:1, fontSize:12, color:"#94a3b8" }}>{h.precip.toFixed(2)}" expected</div>
                        <div style={{ fontSize:13, color:"#38bdf8" }}>{h.prob}% chance</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {lastRefresh && (
              <div style={{ textAlign:"center", fontSize:11, color:"#334155", marginTop:12, paddingBottom:8 }}>
                Updated {lastRefresh.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Open-Meteo
              </div>
            )}
          </>
        )}
      </div>}

      {/* Manage Farms Modal */}
      {showManageFarms && (() => {
        const isAdding = showAddFarm;
        return (
          <div style={S.modal} onClick={() => { setShowManageFarms(false); setShowAddFarm(false); setEditingId(null); }}>
            <div style={{ ...S.modalBox, maxHeight:"85vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>

              {/* Add new farm form */}
              {isAdding ? (
                <>
                  <div style={{ fontSize:17, fontWeight:700, marginBottom:4, color:"#f0f9ff" }}>Add Farm Location</div>
                  <div style={{ fontSize:12, color:"#475569", marginBottom:14 }}>💡 Tap & hold in Google Maps to get coordinates</div>
                  <input style={S.input} placeholder="Farm Name (e.g. South Pivot)" value={newFarm.name} onChange={e=>setNewFarm(n=>({...n,name:e.target.value}))} autoFocus/>
                  <input style={S.input} placeholder="Latitude (e.g. 47.2341)" value={newFarm.lat} onChange={e=>setNewFarm(n=>({...n,lat:e.target.value}))} type="number" step="0.0001"/>
                  <input style={S.input} placeholder="Longitude (e.g. -119.0823)" value={newFarm.lon} onChange={e=>setNewFarm(n=>({...n,lon:e.target.value}))} type="number" step="0.0001"/>
                  <button style={S.btn("primary")} onClick={() => { addFarm(); setShowManageFarms(false); }}>Add Farm</button>
                  <button style={S.btn("secondary")} onClick={() => setShowAddFarm(false)}>← Back</button>
                </>
              ) : editingId ? (() => {
                const ef = farms.find(f=>f.id===editingId);
                if (!ef) return null;
                return (
                  <>
                    <div style={{ fontSize:17, fontWeight:700, marginBottom:14, color:"#f0f9ff" }}>Edit — {ef.name}</div>
                    <input style={S.input} placeholder="Farm Name" value={ef.name}
                      onChange={e=>setFarms(fs=>fs.map(f=>f.id===editingId?{...f,name:e.target.value}:f))}/>
                    <input style={S.input} placeholder="Latitude" value={ef.lat} type="number" step="0.0001"
                      onChange={e=>setFarms(fs=>fs.map(f=>f.id===editingId?{...f,lat:parseFloat(e.target.value)}:f))}/>
                    <input style={S.input} placeholder="Longitude" value={ef.lon} type="number" step="0.0001"
                      onChange={e=>setFarms(fs=>fs.map(f=>f.id===editingId?{...f,lon:parseFloat(e.target.value)}:f))}/>
                    <div style={{ fontSize:11, color:"#475569", marginBottom:12 }}>
                      Current: {ef.lat.toFixed(6)}, {ef.lon.toFixed(6)}
                    </div>
                    <button style={S.btn("primary")} onClick={()=>{ loadWeather(ef); setEditingId(null); }}>Save & Refresh</button>
                    <button style={S.btn("secondary")} onClick={()=>setEditingId(null)}>← Back</button>
                  </>
                );
              })() : (
                <>
                  <div style={{ fontSize:17, fontWeight:700, marginBottom:4, color:"#f0f9ff" }}>Manage Farm Locations</div>
                  <div style={{ fontSize:12, color:"#475569", marginBottom:14 }}>Tap a farm to edit its name or coordinates.</div>

                  {farms.map((f,i) => (
                    <div key={f.id} style={{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:12, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1, cursor:"pointer" }} onClick={()=>setEditingId(f.id)}>
                        <div style={{ fontSize:15, fontWeight:700, color:"#f0f9ff" }}>{f.name}</div>
                        <div style={{ fontSize:11, color:"#475569", marginTop:2, fontFamily:"monospace" }}>
                          {f.lat.toFixed(6)}, {f.lon.toFixed(6)}
                        </div>
                      </div>
                      <button
                        style={{ background:"transparent", border:"1px solid #334155", color:"#94a3b8", borderRadius:8, padding:"6px 10px", fontSize:13, cursor:"pointer" }}
                        onClick={()=>setEditingId(f.id)}>✎</button>
                      {farms.length > 1 && (
                        <button
                          style={{ background:"transparent", border:"1px solid #7f1d1d", color:"#f87171", borderRadius:8, padding:"6px 10px", fontSize:13, cursor:"pointer" }}
                          onClick={()=>{ deleteFarm(f.id); }}>🗑</button>
                      )}
                    </div>
                  ))}

                  <button style={{ ...S.btn("primary"), marginTop:8 }} onClick={()=>setShowAddFarm(true)}>+ Add New Farm</button>
                  <button style={S.btn("secondary")} onClick={()=>{ setShowManageFarms(false); setEditingId(null); }}>Done</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Notification Panel */}
      {showNotifPanel && (
        <NotificationPanel onClose={() => { setShowNotifPanel(false); getCurrentPushSub().then(s=>setNotifOn(!!s)); }}/>
      )}

      {/* Bottom Nav */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:"#0a0f1a",
        borderTop:"1px solid #1e3a5f",
        display:"flex",
        paddingBottom:"env(safe-area-inset-bottom, 0px)",
        zIndex:60,
      }}>
        <div style={{ display:"flex", width:"100%", maxWidth:430, margin:"0 auto" }}>
        {[
          { id:"weather", label:"Weather", icon:"⛅" },
          { id:"gdd",     label:"GDD",     icon:"🌡️" },
          { id:"data",    label:"Data",    icon:"📋" },
        ].map(t => (
          <button key={t.id} onClick={() => setMainTab(t.id)} style={{
            flex:1, padding:"10px 0 8px", background:"transparent", border:"none", cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          }}>
            <span style={{ fontSize:22 }}>{t.icon}</span>
            <span style={{ fontSize:11, fontWeight: mainTab===t.id ? 700 : 500, color: mainTab===t.id ? "#38bdf8" : "#475569" }}>
              {t.label}
            </span>
            {mainTab===t.id && <div style={{ width:20, height:2, borderRadius:1, background:"#38bdf8" }}/>}
          </button>
        ))}
        </div>
      </div>
    </div>
  );
}
