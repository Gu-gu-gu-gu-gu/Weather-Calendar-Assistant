# 🌤 Weather & Calendar Assistant (Weather-Calendar-Assistant)

[中文](README.md)

A front-end extension plugin for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It automatically tracks world time, holidays, weather, and character physiological cycles in roleplay, then injects the “world state” into prompts to keep time consistency and narrative continuity.

---

## ✨ Features

- Automatically parses time and location from AI replies
- Optional forced `[[WORLD]]...[[/WORLD]]` format parsing (newbie-friendly)
- Optional injection of `[[WORLD]]` format prompt (saves tokens)
- China (2004-2026) uses chinese-days (lunar calendar / workday adjustments)
- Other regions use Nager.Date public API
- Anniversary & birthday reminders (MM-DD / YYYY-MM-DD)
- Weather data from Open-Meteo (no API key required)
- Ancient mode supports lunar calendar, solar terms, festivals, dynastic year naming
- Female physiological cycle simulation (manual gender/age override supported)
- One-click testing for Open‑Meteo / holiday API
- Supports rollback and re-initialization

---

## 📦 Installation

### Option 1: Built-in installation in SillyTavern
1. Open SillyTavern → Extensions
2. Click “Install extension”
3. Paste the repository clone URL
4. Click “Install”
5. Refresh the SillyTavern page

### Option 2: Manual installation
1. Download and extract the repository zip
2. Place it in: SillyTavern/public/scripts/extensions/third-party/
3. Refresh the SillyTavern page

---

## 🧭 Usage

### ✅ Basic parsing
- After enabling the plugin, AI replies containing time/location will be parsed automatically
- If no time is parsed, it will prompt and stop injection
- If location cannot be parsed, the default city in settings is used

### ✅ WORLD format (highly recommended)
When “Force WORLD format” is enabled, only the following format is parsed (simplest & most stable):

```
[[WORLD]] location=Shanghai | time=2024年1月28日 13:38[[/WORLD]]
```

- Compatible with `=`, `:`, Chinese/English symbols, spaces, and commas
- Locations support “Shanghai·Lujiazui / Shanghai/Pudong / Shanghai, Pudong”

### ✅ WORLD prompt toggle
- “Inject WORLD prompt” only controls whether the format requirement is injected
- If you already fixed the format in world info or presets, you can disable it to save tokens

### ✅ Ancient mode
- Displays lunar date, solar terms, and traditional festivals
- Supports dynastic year naming (e.g., “Zhenguan 10th year”)

### ✅ Physiological cycle & age
- Automatically detects female characters and generates cycle
- Manual age input supported
- Age < 12 or ≥ 55 automatically disables period simulation

---

## 🧪 Example Output (Modern Mode)
```
[📅 World Engine - World State]
Date: 2025-06-10 17:30 (Evening)
Weekday: Tue | Calendar type: Workday
Next holiday: Dragon Boat Festival (2025-06-22, in 12 days)
Current weather: Heavy Rain, about 23°C
⚠ Extreme weather alert! Heavy rain may severely affect travel and safety.
[/World Engine]
```

---

## 🧪 Example Output (Ancient Mode)
```
[📅 World Engine - World State]
Date: Zhenguan 10th year, 3rd month 20th day, Wu Hour (Morning)
Solar term: Qingming
🎉 Festival today: Hanshi Festival
Weather: Light drizzle, slightly cool
Tip: Bring an umbrella, avoid wet clothes
Character physiological status:
- user: premenstrual phase, mood fluctuations, slight bloating
[/World Engine]
```

---

## 📸 Screenshots

![Settings Panel](assets/screenshot-1.png)
![Prompt Injection Effect](assets/screenshot-2.png)

---

## ⚠️ About Nager.Date Public API

- This plugin uses Nager.Date outside China or beyond 2004-2026
- It is a public API; stability and rate limits are not guaranteed
- Built-in caching keeps actual request volume very low

---

## ⚠️ About Open-Meteo

- The plugin uses Open‑Meteo geocoding and weather data
- No API key required, non-commercial use only
- If the timeline exceeds forecast range, historical data will be used

---

## ❤️ Acknowledgements

- [chinese-days](https://github.com/vsme/chinese-days) (MIT)
- [Nager.Date](https://date.nager.at) (Public API)
- [Open-Meteo](https://open-meteo.com) (Open Weather API)
