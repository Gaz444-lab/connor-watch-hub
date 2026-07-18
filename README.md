# Connor's Watch Hub 🍿

**JustWatch-style tracker for shows & movies** — where to watch, watchlist, progress, ratings and reviews.

Same family setup as **School Hub** and **Mystery Hollow**: runs in the browser on the Mac, Desktop shortcuts to open / update, data stays local.

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

## What’s in the hub

| Area | Features |
|------|----------|
| **Home** | Greeting, continue watching, **live popular** shows, **airing today**, recommendations |
| **Discover** | Live + local catalog · filter by source / type / platform / genre |
| **New & Hot** | **Live airing schedule** (today & tomorrow) + popular streaming titles · Refresh button |
| **Search** | **Live search** against the full TVmaze database (posters, networks, ratings) |
| **Watchlist / Watching / Seen** | Status lists · progress bar · works for live *and* local titles |
| **Reviews** | Star ratings + written reviews |
| **Stats** | Counts, average rating, estimated hours, genre & platform charts |
| **Platforms** | Toggle Netflix, Disney+, Showmax, Prime, Apple TV+, YouTube, DStv, Paramount+, Max… |
| **+ Add** | Custom titles not found online |
| **Settings** | Name, live refresh, export/import backup, clear library |

**Detail panel:** real posters, network/platform, live episode counts & next air date (when online), status, stars, review, notes.

### Live data

- Powered by **[TVmaze](https://www.tvmaze.com/api)** (free, no API key, works in the browser).
- Needs internet for search / schedule / posters; falls back to the local catalog offline.
- Live results are cached ~30 minutes in the browser session.
- Attribution is shown in the app (TVmaze license: CC BY-SA).

Local seed catalog still includes **60+** popular series & movies (including films TVmaze doesn’t cover).

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
