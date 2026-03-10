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
const RAIN_LOOKAHEAD_HOURS = 6;
const RAIN_PROB_THRESHOLD  = 50;  // % chance to trigger
const RAIN_AMT_THRESHOLD   = 0.05; // inches

// ── Fetch weather from Open-Meteo ──
async function fetchWeather(farm) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${farm.lat}&longitude=${farm.lon}` +
    `&daily=temperature_2m_min,precipitation_sum,precipitation_probability_max` +
    `&hourly=precipitation,precipitation_probability,temperature_2m` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=America%2FLos_Angeles&forecast_days=2`;
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
}

// ── Alert state (prevent duplicate alerts same day) ──
const alertedToday = new Set();
function alertKey(farmId, type) {
  return `${new Date().toDateString()}:${farmId}:${type}`;
}

// ── Core check logic ──
async function checkAllFarms() {
  console.log(`[${new Date().toISOString()}] Checking weather for all farms...`);
  for (const farm of FARMS) {
    try {
      const data = await fetchWeather(farm);
      const tonightLow = data.daily.temperature_2m_min[0];

      // Frost checks
      for (const threshold of FROST_THRESHOLDS) {
        const key = alertKey(farm.id, `frost-${threshold.temp}`);
        if (tonightLow <= threshold.temp && !alertedToday.has(key)) {
          alertedToday.add(key);
          await sendPush(
            `${threshold.emoji} ${threshold.label} — ${farm.name}`,
            `Tonight's low: ${Math.round(tonightLow)}°F at ${farm.name}. Check tender crops.`,
            `frost-${farm.id}`
          );
          console.log(`  Frost alert sent for ${farm.name}: ${Math.round(tonightLow)}°F`);
        }
      }

      // Rain in next N hours check
      const now = new Date();
      const rainKey = alertKey(farm.id, 'rain');
      if (!alertedToday.has(rainKey)) {
        const upcoming = data.hourly.time
          .map((t, i) => ({ time: new Date(t), prob: data.hourly.precipitation_probability[i], amt: data.hourly.precipitation[i] }))
          .filter(h => h.time >= now && h.time <= new Date(now.getTime() + RAIN_LOOKAHEAD_HOURS * 3600000));

        const rainHour = upcoming.find(h => h.prob >= RAIN_PROB_THRESHOLD || h.amt >= RAIN_AMT_THRESHOLD);
        if (rainHour) {
          alertedToday.add(rainKey);
          const hrs = Math.round((rainHour.time - now) / 3600000);
          await sendPush(
            `🌧️ Rain Expected — ${farm.name}`,
            `${rainHour.prob}% chance of rain in ~${hrs} hour${hrs !== 1 ? 's' : ''} at ${farm.name}.`,
            `rain-${farm.id}`
          );
          console.log(`  Rain alert sent for ${farm.name}`);
        }
      }
    } catch (err) {
      console.error(`  Error checking ${farm.name}:`, err.message);
    }
  }
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
    await sendPush('🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fields storage (shared across all users) ──
const FIELDS_FILE = path.join(__dirname, 'fields.json');
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

    // Historical GDD from planting date
    const data = await fetchGDDData(farm.lat, farm.lon, field.plantingDate);
    let cumulative = 0;
    const daily = data.daily.time.map((date, i) => {
      const tmax = Math.min(data.daily.temperature_2m_max[i], 86);
      const tmin = Math.max(data.daily.temperature_2m_min[i], BASE);
      const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
      cumulative += gdd;
      return { date, tmax: data.daily.temperature_2m_max[i], tmin: data.daily.temperature_2m_min[i], gdd: Math.round(gdd * 10) / 10, cumulative: Math.round(cumulative * 10) / 10 };
    });
    const totalGDD = Math.round(cumulative * 10) / 10;

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

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ── Cron schedule: check every 30 minutes ──
cron.schedule('*/30 * * * *', checkAllFarms);

// Also run once on startup
checkAllFarms();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FarmWeather server running on port ${PORT}`));
