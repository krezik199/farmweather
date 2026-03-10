const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// ── VAPID config (set these as environment variables on Render) ──
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'you@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Subscription storage (flat file — fine for a small crew) ──
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ── Farm locations (pulled from env or defaults) ──
const FARMS = JSON.parse(process.env.FARMS || JSON.stringify([
  { id: 1, name: "Wheeler",     lat: 47.145960, lon: -119.084559 },
  { id: 2, name: "Meyer",       lat: 47.228213, lon: -119.087152 },
  { id: 3, name: "Hirz",        lat: 47.263619, lon: -119.205851 },
  { id: 4, name: "County Line", lat: 47.115975, lon: -118.981951 },
  { id: 5, name: "Kulm",        lat: 46.995123, lon: -118.849620 },
  { id: 6, name: "Lincoln",     lat: 47.309481, lon: -118.915966 },
  { id: 7, name: "Wilbur",      lat: 47.634717, lon: -118.657076 },
]));

// ── Alert thresholds ──
const FROST_THRESHOLDS = [
  { temp: 28, label: "HARD FREEZE WARNING", emoji: "🥶" },
  { temp: 32, label: "FREEZE WARNING",       emoji: "❄️" },
  { temp: 36, label: "FROST POSSIBLE",       emoji: "🌡️" },
];
const RAIN_PROB_THRESHOLD = 50;   // % chance to trigger rain alert
const RAIN_AMT_THRESHOLD  = 0.1;  // inches/day to trigger rain alert
const WIND_THRESHOLD      = 20;   // mph sustained to trigger wind alert
const HEAT_THRESHOLD      = 95;   // °F high to trigger heat alert
const LOOKAHEAD_DAYS      = 3;    // days ahead to check

// ── Fetch 3-day forecast from Open-Meteo ──
async function fetchWeather(farm) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${farm.lat}&longitude=${farm.lon}` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max` +
    `&hourly=precipitation,precipitation_probability,temperature_2m,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=America%2FLos_Angeles&forecast_days=${LOOKAHEAD_DAYS + 1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed for ${farm.name}`);
  return res.json();
}

// ── Send push to all subscribers ──
async function sendPush(title, body, tag) {
  const subs = loadSubs();
  const payload = JSON.stringify({ title, body, tag });
  const dead = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      else console.error('Push error:', err.message);
    }
  }
  if (dead.length) saveSubs(subs.filter(s => !dead.includes(s.endpoint)));
  return subs.length - dead.length;
}

// ── Send push to one specific subscription ──
async function sendPushToOne(subscription, title, body, tag) {
  const payload = JSON.stringify({ title, body, tag });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Clean up dead sub
      saveSubs(loadSubs().filter(s => s.endpoint !== subscription.endpoint));
    } else {
      console.error('Push error:', err.message);
    }
    return false;
  }
}

// ── Alert dedup: once per alert-window (6hr block) per farm per type ──
const alertedThisWindow = new Set();
function alertWindowKey(farmId, type, date) {
  // Groups by 6-hour window: 0-6, 6-12, 12-18, 18-24
  const now = new Date();
  const window = Math.floor(now.getHours() / 6);
  return `${now.toDateString()}:${window}:${farmId}:${type}:${date}`;
}

function dayLabel(dateStr) {
  // Always compare dates in Pacific time to match the farm locations
  const nowPacific = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit' });
  const [m, d, y] = nowPacific.split('/');
  const todayPacific = `${y}-${m}-${d}`;
  const tomorrowDate = new Date(`${todayPacific}T12:00:00-08:00`);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowPacific = tomorrowDate.toISOString().split('T')[0];

  if (dateStr === todayPacific) return 'today';
  if (dateStr === tomorrowPacific) return 'tomorrow';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── Core check logic — one summary push per day across all farms ──
// targetSub: if set, only push to that one device (for manual checks)
async function checkAllFarms(manual = false, targetSub = null) {
  console.log(`[${new Date().toISOString()}] Checking weather (manual=${manual})...`);

  // Collect all conditions keyed by date
  // dayMap[date] = { frost: [{farm, low, threshold}], rain: [{farm, prob, amt}], wind: [{farm, speed, gusts}], heat: [{farm, high}] }
  const dayMap = {};

  for (const farm of FARMS) {
    try {
      const data = await fetchWeather(farm);

      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        const date     = data.daily.time[i];
        const low      = data.daily.temperature_2m_min[i];
        const high     = data.daily.temperature_2m_max[i];
        const rainProb = data.daily.precipitation_probability_max[i];
        const rainAmt  = data.daily.precipitation_sum[i];
        const maxWind  = data.daily.wind_speed_10m_max[i];
        const maxGusts = data.daily.wind_gusts_10m_max[i];

        if (!dayMap[date]) dayMap[date] = { frost:[], rain:[], wind:[], heat:[] };

        // Frost — only the worst threshold per farm per day
        const worstFrost = FROST_THRESHOLDS.find(t => low <= t.temp);
        if (worstFrost) {
          dayMap[date].frost.push({ farm: farm.name, low, threshold: worstFrost });
        }

        if (rainProb >= RAIN_PROB_THRESHOLD || rainAmt >= RAIN_AMT_THRESHOLD) {
          dayMap[date].rain.push({ farm: farm.name, prob: rainProb, amt: rainAmt });
        }

        if (maxWind >= WIND_THRESHOLD) {
          dayMap[date].wind.push({ farm: farm.name, speed: Math.round(maxWind), gusts: Math.round(maxGusts) });
        }

        if (high >= HEAT_THRESHOLD) {
          dayMap[date].heat.push({ farm: farm.name, high });
        }
      }
    } catch (err) {
      console.error(`  Error fetching ${farm.name}:`, err.message);
    }
  }

  // Now send one notification per day that has any alerts
  const allAlerts = [];
  const sortedDates = Object.keys(dayMap).sort();

  for (const date of sortedDates) {
    const day = dayMap[date];
    const label = dayLabel(date);
    const dateIndex = sortedDates.indexOf(date);
    const hasAny = day.frost.length || day.rain.length || day.wind.length || day.heat.length;
    if (!hasAny) continue;

    // Dedup key — one notification per day per check window
    const key = alertWindowKey('all', 'summary', date);
    if (!manual && alertedThisWindow.has(key)) continue;
    alertedThisWindow.add(key);

    // Build title — use worst frost level if present, otherwise generic
    const worstOverall = day.frost.length
      ? FROST_THRESHOLDS.find(t => day.frost.some(f => f.threshold.temp === t.temp))
      : null;

    const titleParts = [];
    if (worstOverall)      titleParts.push(`${worstOverall.emoji} ${worstOverall.label}`);
    if (day.rain.length)   titleParts.push('🌧️ Rain');
    if (day.wind.length)   titleParts.push('💨 Wind');
    if (day.heat.length)   titleParts.push('🌡️ Heat');

    const title = `${label.charAt(0).toUpperCase() + label.slice(1)}: ${titleParts.join(' · ')}`;

    // Build body lines
    const lines = [];

    if (day.frost.length) {
      // Group farms by frost level
      const byLevel = {};
      for (const f of day.frost) {
        const lbl = f.threshold.label;
        if (!byLevel[lbl]) byLevel[lbl] = [];
        byLevel[lbl].push(`${f.farm} (${Math.round(f.low)}°F)`);
      }
      for (const [lbl, farms] of Object.entries(byLevel)) {
        lines.push(`${lbl}: ${farms.join(', ')}`);
      }
    }

    if (day.rain.length) {
      const farmList = day.rain.map(r => `${r.farm} (${r.prob}%)`).join(', ');
      lines.push(`Rain: ${farmList}`);
    }

    if (day.wind.length) {
      const worst = day.wind.reduce((a, b) => b.speed > a.speed ? b : a);
      const farmList = day.wind.map(w => w.farm).join(', ');
      lines.push(`Wind ${worst.speed} mph, gusts ${worst.gusts} mph: ${farmList}`);
    }

    if (day.heat.length) {
      const farmList = day.heat.map(h => `${h.farm} (${Math.round(h.high)}°F)`).join(', ');
      lines.push(`Heat: ${farmList}`);
    }

    const body = lines.join(' | ');
    if (targetSub) {
      await sendPushToOne(targetSub, title, body, `summary-${date}`);
    } else {
      await sendPush(title, body, `summary-${date}`);
    }
    console.log(`  [summary] ${date}: ${title}`);

    allAlerts.push({ date, label, title, body,
      frost: day.frost, rain: day.rain, wind: day.wind, heat: day.heat });
  }

  return allAlerts;
}

// ── API routes ──
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = loadSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    saveSubs(subs);
    console.log(`New subscriber: ${sub.endpoint.slice(0, 50)}...`);
  }
  res.json({ ok: true, count: subs.length });
});

app.delete('/api/subscribe', (req, res) => {
  const { endpoint } = req.body;
  const subs = loadSubs().filter(s => s.endpoint !== endpoint);
  saveSubs(subs);
  res.json({ ok: true });
});

app.post('/api/test-push', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (subscription) {
      // Send only to the requesting device
      await sendPushToOne(subscription, '🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    } else {
      await sendPush('🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual alert check — sends only to the requesting device ──
app.post('/api/check-alerts', async (req, res) => {
  try {
    const { subscription } = req.body;
    const alerts = await checkAllFarms(true, subscription || null);
    res.json({ ok: true, count: alerts.length, alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: show raw forecast values used for alert checks ──
app.get('/api/debug-alerts', async (req, res) => {
  try {
    const results = [];
    for (const farm of FARMS) {
      const data = await fetchWeather(farm);
      const days = [];
      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        days.push({
          date:     data.daily.time[i],
          low:      data.daily.temperature_2m_min[i],
          high:     data.daily.temperature_2m_max[i],
          rainProb: data.daily.precipitation_probability_max[i],
          rainAmt:  data.daily.precipitation_sum[i],
          wind:     data.daily.wind_speed_10m_max[i],
          gusts:    data.daily.wind_gusts_10m_max[i],
        });
      }
      results.push({ farm: farm.name, days });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fields storage (shared across all users) ──
const FIELDS_FILE = path.join('/data', 'fields.json');
function loadFields() {
  try { return JSON.parse(fs.readFileSync(FIELDS_FILE, 'utf8')); } catch { return []; }
}
function saveFields(fields) {
  fs.writeFileSync(FIELDS_FILE, JSON.stringify(fields, null, 2));
}

// ── GDD fetch: historical daily temps from planting date to today ──
async function fetchGDDData(lat, lon, plantingDate) {
  const start = plantingDate; // 'YYYY-MM-DD'
  const end = new Date().toISOString().split('T')[0];
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit` +
    `&timezone=America%2FLos_Angeles` +
    `&start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('GDD fetch failed');
  return res.json();
}

// ── Startup migration: ensure all farmIds are stored as numbers ──
(function migrateFields() {
  try {
    const fields = loadFields();
    let changed = false;
    fields.forEach(f => {
      if (typeof f.farmId !== 'number') {
        f.farmId = parseInt(f.farmId);
        changed = true;
      }
    });
    if (changed) {
      saveFields(fields);
      console.log('[Migration] Coerced farmId to number for existing fields');
    }
  } catch(e) { console.error('[Migration] Error:', e.message); }
})();

// ── Fields API ──
app.get('/api/fields', (req, res) => {
  res.json(loadFields());
});

app.post('/api/fields', (req, res) => {
  const { name, farmId, crop, plantingDate } = req.body;
  if (!name || !farmId || !crop || !plantingDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const fields = loadFields();
  const field = { id: Date.now(), name, farmId: parseInt(farmId), crop, variety: req.body.variety || '', plantingDate, createdAt: new Date().toISOString() };
  fields.push(field);
  saveFields(fields);
  res.json(field);
});

app.put('/api/fields/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const fields = loadFields();
  const idx = fields.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Field not found' });
  fields[idx] = { ...fields[idx], ...req.body, id };
  saveFields(fields);
  res.json(fields[idx]);
});

app.delete('/api/fields/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const fields = loadFields().filter(f => f.id !== id);
  saveFields(fields);
  res.json({ ok: true });
});

app.get('/api/fields/:id/gdd', async (req, res) => {
  const id = parseInt(req.params.id);
  const fields = loadFields();
  const field = fields.find(f => f.id === id);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  const farm = FARMS.find(f => f.id === parseInt(field.farmId));
  if (!farm) return res.status(400).json({ error: `Farm not found — farmId: ${field.farmId} (${typeof field.farmId})` });

  try {
    const BASE = 45;
    console.log(`[GDD] field="${field.name}" farm="${farm.name}" lat=${farm.lat} lon=${farm.lon} planted=${field.plantingDate}`);

    // If planting date is in the future, skip historical fetch entirely
    const today = new Date().toISOString().split('T')[0];
    let daily = [];
    let totalGDD = 0;

    if (field.plantingDate <= today) {
      const data = await fetchGDDData(farm.lat, farm.lon, field.plantingDate);
      let cumulative = 0;
      daily = data.daily.time.map((date, i) => {
        const tmax = Math.min(data.daily.temperature_2m_max[i], 86);
        const tmin = Math.max(data.daily.temperature_2m_min[i], BASE);
        const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
        cumulative += gdd;
        return { date, tmax: data.daily.temperature_2m_max[i], tmin: data.daily.temperature_2m_min[i], gdd: Math.round(gdd * 10) / 10, cumulative: Math.round(cumulative * 10) / 10 };
      });
      totalGDD = Math.round(cumulative * 10) / 10;
    } // end if plantingDate <= today

    // 14-day forecast GDD
    const fcastUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${farm.lat}&longitude=${farm.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit` +
      `&timezone=America%2FLos_Angeles` +
      `&forecast_days=14`;
    const fcastRes = await fetch(fcastUrl);
    const fcastData = await fcastRes.json();

    let forecastCumulative = totalGDD;
    const forecastDays = fcastData.daily.time.map((date, i) => {
      const tmax = Math.min(fcastData.daily.temperature_2m_max[i], 86);
      const tmin = Math.max(fcastData.daily.temperature_2m_min[i], BASE);
      const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
      forecastCumulative += gdd;
      return { date, tmax: fcastData.daily.temperature_2m_max[i], tmin: fcastData.daily.temperature_2m_min[i], gdd: Math.round(gdd * 10) / 10, projected: Math.round(forecastCumulative * 10) / 10 };
    });

    // Stage projections
    const CROP_STAGES = {
      onion:  [
        { name: "Emergence",       gdd: 100  },
        { name: "3-Leaf Stage",    gdd: 400  },
        { name: "Bulb Initiation", gdd: 800  },
        { name: "Bulb Fill",       gdd: 1400 },
        { name: "Maturity",        gdd: 2000 },
      ],
      potato: [
        { name: "Emergence",        gdd: 100  },
        { name: "Tuber Initiation", gdd: 350  },
        { name: "Tuber Bulking",    gdd: 700  },
        { name: "Maturity",         gdd: 1200 },
      ],
    };
    const stages = CROP_STAGES[field.crop] || [];
    const stageProjections = stages.map(stage => {
      if (totalGDD >= stage.gdd) {
        const reachedDay = daily.find(d => d.cumulative >= stage.gdd);
        return { name: stage.name, gdd: stage.gdd, reached: true, date: reachedDay ? reachedDay.date : null };
      }
      const forecastDay = forecastDays.find(d => d.projected >= stage.gdd);
      if (forecastDay) {
        const daysAway = forecastDays.indexOf(forecastDay) + 1;
        return { name: stage.name, gdd: stage.gdd, reached: false, date: forecastDay.date, daysAway };
      }
      // Beyond 14-day window - extrapolate from avg of last 7 forecast days
      const last7 = forecastDays.slice(-7);
      const avgGDDperDay = last7.reduce((sum, d) => sum + d.gdd, 0) / last7.length;
      const gddNeeded = stage.gdd - forecastCumulative;
      if (avgGDDperDay > 0) {
        const extraDays = Math.ceil(gddNeeded / avgGDDperDay);
        const lastDate = new Date(forecastDays[forecastDays.length - 1].date + 'T12:00:00');
        lastDate.setDate(lastDate.getDate() + extraDays);
        return { name: stage.name, gdd: stage.gdd, reached: false, date: lastDate.toISOString().split('T')[0], daysAway: forecastDays.length + extraDays, estimated: true };
      }
      return { name: stage.name, gdd: stage.gdd, reached: false, date: null, daysAway: null };
    });

    res.json({ field, farm: farm.name, daily, totalGDD, daysTracked: daily.length, forecastDays, stageProjections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Observations storage ──
const OBS_FILE = path.join('/data', 'observations.json');
function loadObs() {
  try { return JSON.parse(fs.readFileSync(OBS_FILE, 'utf8')); } catch { return []; }
}
function saveObs(obs) {
  fs.writeFileSync(OBS_FILE, JSON.stringify(obs, null, 2));
}

app.get('/api/observations', (req, res) => {
  res.json(loadObs());
});

app.post('/api/observations', (req, res) => {
  const { fieldId, stage, date, notes, gddAtObservation } = req.body;
  if (!fieldId || !stage || !date) return res.status(400).json({ error: 'Missing required fields' });
  const obs = loadObs();
  // Remove any existing observation for this field+stage (replace with new one)
  const filtered = obs.filter(o => !(o.fieldId === parseInt(fieldId) && o.stage === stage));
  const newObs = {
    id: Date.now(),
    fieldId: parseInt(fieldId),
    stage,
    date,
    notes: notes || '',
    gddAtObservation: gddAtObservation ?? null,
    createdAt: new Date().toISOString(),
  };
  filtered.push(newObs);
  saveObs(filtered);
  res.json(newObs);
});

app.delete('/api/observations/:id', (req, res) => {
  const id = parseInt(req.params.id);
  saveObs(loadObs().filter(o => o.id !== id));
  res.json({ ok: true });
});

// ── Backup & Restore endpoints ──
app.get('/api/backup', (req, res) => {
  res.json({
    fields: loadFields(),
    observations: loadObs(),
  });
});

app.post('/api/restore/fields', (req, res) => {
  try {
    const fields = req.body;
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'Expected an array' });
    saveFields(fields);
    res.json({ ok: true, count: fields.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restore/observations', (req, res) => {
  try {
    const obs = req.body;
    if (!Array.isArray(obs)) return res.status(400).json({ error: 'Expected an array' });
    saveObs(obs);
    res.json({ ok: true, count: obs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ── Cron schedule: 6am, noon, 6pm Pacific (America/Los_Angeles) ──
cron.schedule('0 6 * * *',  () => checkAllFarms(), { timezone: 'America/Los_Angeles' });
cron.schedule('0 12 * * *', () => checkAllFarms(), { timezone: 'America/Los_Angeles' });
cron.schedule('0 18 * * *', () => checkAllFarms(), { timezone: 'America/Los_Angeles' });

// Run once on startup (no push, just warms up)
console.log('[Startup] FarmWeather server ready. Alerts scheduled at 6am, 12pm, 6pm Pacific.');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FarmWeather server running on port ${PORT}`));
