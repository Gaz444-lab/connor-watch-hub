# Connor's Watch Hub · Neon Deck 🎞

**JustWatch-style tracker** with a full neon redesign — live data, multi-platform filters, Top 10 boards, season/episode logs, rewatches, and real hours-watched stats.

Same family setup as **School Hub**: browser app, Desktop open/update shortcuts, data stays local.

---

## For Connor’s Mac (after Xcode / git is ready)

### First time only

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/Gaz444-lab/connor-watch-hub/main/scripts/setup-for-connor.sh | bash
```

That clones into `~/Documents/connor-watch-hub` and puts on the **Desktop**:

| Shortcut | When to use |
|----------|-------------|
| **Watch Hub.command** | Open the app |
| **Update Watch Hub.command** | After Dad says he pushed an update |

macOS may ask to allow Terminal the first time → **Open**.

### Every day

1. Double-click **Watch Hub.command**
2. Browser opens → `http://127.0.0.1:8766/`
3. Browse, add to watchlist, rate shows, write reviews

### When Dad ships an update

Double-click **Update Watch Hub.command**, then open **Watch Hub** again.

> Your watchlist, ratings and reviews live in **browser storage on that Mac** — updates never wipe them. Use **Settings → Export backup** if you want a file copy.

---

## What’s in the hub (v1.2.4 Neon Deck)

**Durable library:** Seen / Queue / hours save to the browser **and** to `data/user-state.json` on disk (when launched via Desktop shortcut or Deck). That way stop/relaunch does not drop selections. Always open via **Watch Hub.command** or Connor’s Deck — not a random `file://` or GitHub Pages tab for daily use.

| Area | Features |
|------|----------|
| **Deck (Home)** | Bento hero, LED stats, continue/queue rails, Top 10 teaser, live popular + airing |
| **Top 10** | Category boards (Overall, Action, Comedy, Sci-Fi…) ranked across **your selected platforms** |
| **Signals bar** | **Multi-select platforms** (All / Mine / Clear) — filters junk from browse, airing, Top 10 |
| **Browse / Airing** | Live + local · filtered to active platforms |
| **Search** | Full TVmaze search · platforms you care about ranked first |
| **Queue / Watching / Seen** | Status lists with episode + hours badges |
| **Hours (Stats)** | **Total hours** from seasons/episodes × runtime × **rewatches** · genre & platform time charts |
| **Detail log** | Episodes watched, seasons completed, mins/ep, season chips from live data, rewatch stepper, hours preview |
| **Setup** | Name, live sync, export/import backup |

### Hours math

`episodes × runtime minutes × (1 + rewatches)`  
(or seasons × ~eps/season × runtime when you log seasons). Marking **Seen** can auto-fill all aired episodes from TVmaze.

### Live data

- **[TVmaze](https://www.tvmaze.com/api)** (free, no API key).
- Offline falls back to local **60+** title seed catalog.

---

## For Dad (your Mac)

Repo: https://github.com/Gaz444-lab/connor-watch-hub  
Local: `~/connor-watch-hub`

```bash
cd ~/connor-watch-hub
# edit files…
git add -A
git commit -m "Describe the change"
git push
```

Tell Connor to run **Update Watch Hub.command**.

His library lives in **his** browser `localStorage` — not in git.

### Local run (dev)

```bash
cd ~/connor-watch-hub
./launch.sh
# → http://127.0.0.1:8766/
```

Port **8766** (School Hub uses 8765 so both can run).

---

## Tech

Static HTML/CSS/JS · no Node required · Python local server · catalog in `data/catalog.json` · PWA manifest.

Made for Connor 🌊
