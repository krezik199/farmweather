# FarmWeather — Deployment Guide

## What You're Deploying
A Node.js server that:
- Serves the React PWA to browsers
- Checks weather every 30 minutes for all your farm locations
- Sends push notifications to subscribed devices for frost warnings and incoming rain
- Stores push subscriptions in a local JSON file

---

## Step 1 — Generate VAPID Keys (one time only)

VAPID keys are what authorize your server to send push notifications.
Run this on any machine with Node installed:

```bash
cd farmweather
npm install
npm run generate-vapid
```

Copy the two lines of output — you'll need them in Step 3.

---

## Step 2 — Create a Render.com Account

1. Go to **render.com** and sign up (free, no credit card needed)
2. Connect your GitHub account when prompted

---

## Step 3 — Push Code to GitHub

```bash
cd farmweather
git init
git add .
git commit -m "Initial FarmWeather deploy"
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/farmweather.git
git push -u origin main
```

---

## Step 4 — Create a Web Service on Render

1. In Render dashboard → **New** → **Web Service**
2. Connect your `farmweather` GitHub repo
3. Set these build settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node

---

## Step 5 — Set Environment Variables on Render

In your Render service → **Environment** tab, add:

| Key | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY` | (from Step 1) |
| `VAPID_PRIVATE_KEY` | (from Step 1) |
| `VAPID_EMAIL` | your@email.com |
| `FARMS` | (see below) |

### FARMS variable format (JSON, all on one line):
```json
[{"id":1,"name":"Home Ranch","lat":47.1234,"lon":-119.7456},{"id":2,"name":"North Field","lat":47.3456,"lon":-119.5678},{"id":3,"name":"River Bottom","lat":46.9876,"lon":-119.9012}]
```

Replace the lat/lon values with your actual farm coordinates.
**To get coordinates:** Open Google Maps → tap and hold on your field → the coordinates appear at the top of the screen.

---

## Step 6 — Deploy

Click **Deploy** in Render. It'll take 2–3 minutes to build.
Your app will be live at `https://farmweather-XXXX.onrender.com`

---

## Step 7 — Set Up Push Notifications on Each Device

### iPhones (iOS 16.4+ required)
1. Open Safari and go to your Render URL
2. Tap the **Share** button (box with arrow)
3. Tap **"Add to Home Screen"** → Add
4. **Open the app from your Home Screen icon** (important — must use the installed version)
5. Tap the 🔔 bell icon in the top right
6. Tap **"Enable Alerts on This Device"**
7. Allow notifications when prompted
8. Tap **"Send Test Notification"** to confirm it works

Repeat on each employee's iPhone.

---

## Alert Logic

| Alert | Trigger |
|-------|---------|
| 🌡️ Frost Possible | Tonight's low ≤ 36°F |
| ❄️ Freeze Warning | Tonight's low ≤ 32°F |
| 🥶 Hard Freeze Warning | Tonight's low ≤ 28°F |
| 🌧️ Rain in 6 Hours | ≥50% chance of rain in next 6 hours at any farm |

- Weather checked every **30 minutes**
- Each alert fires **once per day** per farm (no repeat spamming)
- Dead/unsubscribed devices are automatically cleaned up

---

## Updating Your Farm Locations

Two ways:
1. **In the app:** tap "Edit Location" on any farm to change its coordinates (saves to your device's browser storage)
2. **Server-side alerts:** update the `FARMS` environment variable on Render and redeploy — this controls which locations get checked for push alerts

---

## Free Tier Notes (Render)

On Render's free tier, the server **spins down after 15 minutes of inactivity**. This means:
- The app may take 30–60 seconds to load on first visit
- Push notification checks may be delayed if no one has visited recently

**To avoid this:** Upgrade to Render's $7/month "Starter" plan which keeps the server always-on. Strongly recommended for reliable frost alerts.

---

## Troubleshooting

**"Notifications are blocked" on iPhone**
→ Settings → Safari → scroll to the site → Notifications → Allow

**Not receiving test notifications**
→ Make sure you opened the app from the Home Screen icon, not Safari

**Server not sending alerts**
→ Check Render logs: Dashboard → your service → Logs tab
