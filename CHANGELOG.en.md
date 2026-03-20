# Changelog

### v1.4.1

- Removed the “Rain Bias” setting and simplified the weather continuity logic
- Fixed an issue where the weather type could change after continuity adjustment but the `isRainy` flag was not updated accordingly
- Unified all weather sources (API + roll) to always include a correct `isRainy` flag
- Adjusted season mapping so that September is treated as summer, avoiding unrealistically low temperatures in early autumn for South China
- Slightly increased the daily mean temperature for low‑latitude regions (|latitude| ≤ 25°) during September–November to better match perceived temperatures
- Slightly optimized the temperature continuity calculation to reduce extreme day‑to‑day temperature jumps

### v1.4.0

- Added bilingual UI (auto-detect + manual switch)
- Default language follows SillyTavern settings
- Improved English time parsing (common date/time formats)
- Improved location parsing (multiple writing styles)
- Location auto-detection without fixed format (fallback)

### v1.3.0
- Added fixed WORLD format parsing mode (only parses [[WORLD]]...[[/WORLD]])
- Added WORLD prompt injection toggle (disable injection, keep parsing)
- Parsing settings panel collapsed by default for a cleaner UI
- One-click debug button (if a bug occurs, copy the result and send it to me; it will include the last AI output, so remove private content)
- Fixed holiday API misidentifying weekdays as holidays
- Removed scene field parsing & injection to save tokens
- Menstrual system added age input; age affects cycle simulation and fluctuation probability

### v1.2.3
- Added regex presets: one-click save & dropdown switch for time/scene/location
- Added delete current preset button, supports clearing old presets

### v1.2.2
- Ancient mode: added “random base Gregorian year” so progression works without manual start year
- Ancient time parsing now supports lunar calendar + shichen format (e.g., “July 3, Wei hour”)

## v1.2.1
- Anniversaries can bind character cards (multi-select), only injected in those character chats
- Anniversary character selection supports search, select all, clear

## v1.2.0
- Added ancient mode: injects lunar date + solar terms + shichen
- Supports automatic detection and progression of era year prefixes
- Weather/menstrual descriptions now use classical style
- Added ancient-to-modern place name mapping for weather queries
- Fixed correct usage of Chinese Days lunar/solar terms; modern mode lunar restored
- Compatible with PC/mobile settings panel mount timing

> After updating, internet is required; in ancient mode, it is recommended that AI outputs “era + year” at least once

## v1.1.2

- Fixed PC/mobile settings panel mount timing issues
- Fixed duplicate parser.js syntax causing plugin load failure

---

## v1.1.1

- Custom time/scene/location regex supports multiple capture groups; automatically uses the last non-empty group
- If location parsing fails, automatically falls back to the scene field

> After updating, ensure the LLM outputs a city at least once or manually select a city in settings, otherwise Open-Meteo cannot be called

---

## v1.1.0

- Integrated Open-Meteo API; optimized weather roll points based on regional climate history
- Added location parsing and default city support
- Weather continuity and future-time fallback
- Added multi-character menstrual cycle simulation

> After updating, internet is required
