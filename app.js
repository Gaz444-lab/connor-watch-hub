/**
 * Connor's Watch Hub — JustWatch-style show/movie tracker
 * Static HTML/CSS/JS · localStorage · catalog in data/catalog.json
 */
(function () {
  "use strict";

  const STORAGE_KEY = "connor-watch-hub-v1";
  const STATUSES = [
    { id: "none", label: "Not tracking", emoji: "○" },
    { id: "watchlist", label: "Watchlist", emoji: "📌" },
    { id: "watching", label: "Watching", emoji: "▶️" },
    { id: "seen", label: "Seen", emoji: "✅" },
    { id: "dropped", label: "Dropped", emoji: "⛔" },
  ];

  // ——— Runtime state ———
  let catalog = { platforms: [], genres: [], titles: [] };
  let state = null;
  let currentView = "home";
  let searchQuery = "";
  let searchResults = null; // live search hits
  let searchLoading = false;
  let liveReady = false;
  let liveLoading = true;
  let discoverFilters = {
    type: "all",
    platform: "all",
    genre: "all",
    sort: "trending",
    source: "all", // all | live | local
  };
  let toastTimer = null;
  let searchTimer = null;
  let detailId = null;

  // ——— Bootstrap ———
  async function init() {
    state = loadState();
    applyTheme();
    bindChrome();
    try {
      const res = await fetch("data/catalog.json", { cache: "no-store" });
      if (!res.ok) throw new Error("catalog " + res.status);
      catalog = await res.json();
    } catch (err) {
      console.warn("Catalog load failed, using empty:", err);
      catalog = { platforms: [], genres: [], titles: [] };
      toast("Couldn’t load local catalog — live search still works online.");
    }
    mergeCustomIntoCatalog();
    render(); // paint shell immediately

    // Live feeds (TVmaze) — no API key
    if (window.WatchLive) {
      liveLoading = true;
      try {
        const result = await window.WatchLive.bootstrap();
        liveReady = !!result.online || (window.WatchLive.popular || []).length > 0;
        liveLoading = false;
        if (result.online) {
          toast("Live data connected · TVmaze");
        } else if (result.error) {
          toast("Offline mode — using local catalog");
        }
      } catch (err) {
        liveLoading = false;
        liveReady = false;
        console.warn("Live bootstrap failed", err);
      }
      render();
    } else {
      liveLoading = false;
    }
  }

  // ——— Persistence ———
  function defaultState() {
    return {
      version: 1,
      userName: "Connor",
      theme: "dark",
      /** platform id → subscribed boolean */
      subscriptions: {
        netflix: true,
        disney: true,
        showmax: true,
        prime: false,
        apple: false,
        youtube: true,
        dstv: false,
        paramount: false,
        max: false,
        other: true,
      },
      /** titleId → user data */
      library: {},
      /** custom titles added by user (same shape as catalog titles + custom:true) */
      customTitles: [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        subscriptions: { ...base.subscriptions, ...(parsed.subscriptions || {}) },
        library: parsed.library || {},
        customTitles: parsed.customTitles || [],
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme === "light" ? "light" : "dark");
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = state.theme === "light" ? "🌙" : "☀️";
  }

  // ——— Catalog helpers ———
  function mergeCustomIntoCatalog() {
    // Ensure custom titles appear in allTitles()
  }

  function allTitles() {
    const map = new Map();
    // Local seed catalog (movies + curated)
    for (const t of catalog.titles || []) map.set(t.id, { ...t, custom: false, live: false });
    // Live TVmaze cache (overwrites same id only if tvmaze-*)
    if (window.WatchLive) {
      for (const t of window.WatchLive.allCachedTitles()) {
        map.set(t.id, { ...t, custom: false });
      }
    }
    // User custom titles
    for (const t of state.customTitles || []) map.set(t.id, { ...t, custom: true });
    return [...map.values()];
  }

  function getTitle(id) {
    if (window.WatchLive) {
      const live = window.WatchLive.getCached(id);
      if (live) return live;
    }
    return allTitles().find((t) => t.id === id) || null;
  }

  function livePopular() {
    return window.WatchLive ? window.WatchLive.popular : [];
  }

  function liveSchedule() {
    return window.WatchLive ? window.WatchLive.schedule : [];
  }

  function isLiveOnline() {
    return !!(window.WatchLive && window.WatchLive.online);
  }

  function platformById(id) {
    return (catalog.platforms || []).find((p) => p.id === id) || { id, name: id, color: "#666", emoji: "📺" };
  }

  function userEntry(id) {
    return (
      state.library[id] || {
        status: "none",
        rating: 0,
        review: "",
        notes: "",
        progress: 0, // 0–100 or episodes watched for series
        episodesWatched: 0,
        updatedAt: null,
      }
    );
  }

  function setUserEntry(id, patch) {
    const prev = userEntry(id);
    state.library[id] = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    // Clean empty "none" with no other data
    const e = state.library[id];
    if (e.status === "none" && !e.rating && !e.review && !e.notes && !e.episodesWatched && !e.progress) {
      delete state.library[id];
    }
    saveState();
    updateBadges();
  }

  function titlesByStatus(status) {
    return allTitles().filter((t) => userEntry(t.id).status === status);
  }

  function countStatus(status) {
    return Object.values(state.library).filter((e) => e.status === status).length;
  }

  // ——— Chrome bindings ———
  function bindChrome() {
    document.getElementById("main-nav")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      currentView = btn.dataset.view;
      searchQuery = "";
      const si = document.getElementById("global-search");
      if (si) si.value = "";
      closeDrawer();
      render();
    });

    document.getElementById("theme-toggle")?.addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      saveState();
      applyTheme();
    });

    document.getElementById("btn-add-title")?.addEventListener("click", () => openAddModal());

    const search = document.getElementById("global-search");
    search?.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      searchResults = null;
      clearTimeout(searchTimer);
      if (!searchQuery) {
        searchLoading = false;
        render();
        return;
      }
      searchLoading = true;
      render();
      searchTimer = setTimeout(() => runLiveSearch(searchQuery), 320);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        search?.focus();
      }
      if (e.key === "Escape") closeModal();
    });

    document.getElementById("mobile-menu")?.addEventListener("click", () => {
      document.body.classList.toggle("nav-open");
      const bd = document.getElementById("drawer-backdrop");
      if (bd) bd.hidden = !document.body.classList.contains("nav-open");
    });
    document.getElementById("drawer-backdrop")?.addEventListener("click", closeDrawer);

    document.getElementById("modal-root")?.addEventListener("click", (e) => {
      if (e.target.matches("[data-close-modal]")) closeModal();
    });
  }

  function closeDrawer() {
    document.body.classList.remove("nav-open");
    const bd = document.getElementById("drawer-backdrop");
    if (bd) bd.hidden = true;
  }

  function updateBadges() {
    setBadge("badge-watchlist", countStatus("watchlist"));
    setBadge("badge-watching", countStatus("watching"));
  }

  function setBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) {
      el.hidden = false;
      el.textContent = String(n);
    } else {
      el.hidden = true;
    }
  }

  function setActiveNav() {
    document.querySelectorAll(".nav-btn[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === currentView);
    });
    const user = document.getElementById("sidebar-user");
    if (user) user.textContent = state.userName || "Connor";
  }

  // ——— Toast ———
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  async function runLiveSearch(q) {
    const query = q.trim();
    if (!query) return;
    try {
      let liveHits = [];
      if (window.WatchLive) {
        liveHits = await window.WatchLive.search(query, 30);
      }
      // Also match local catalog / custom
      const localHits = filterTitles(allTitles().filter((t) => !t.live), {
        query,
        sort: "rating",
      });
      // Merge: live first, then local not already similar by title
      const seenTitles = new Set(liveHits.map((t) => t.title.toLowerCase()));
      const merged = [
        ...liveHits,
        ...localHits.filter((t) => !seenTitles.has(t.title.toLowerCase())),
      ];
      if (searchQuery === query) {
        searchResults = merged;
        searchLoading = false;
        render();
      }
    } catch (err) {
      console.warn("Live search failed", err);
      if (searchQuery === query) {
        searchResults = filterTitles(allTitles(), { query, sort: "rating" });
        searchLoading = false;
        toast("Live search unavailable — showing local results");
        render();
      }
    }
  }

  // ——— Render router ———
  function render() {
    setActiveNav();
    updateBadges();
    const main = document.getElementById("main");
    if (!main) return;

    if (searchQuery && currentView !== "settings") {
      main.innerHTML = renderSearchResults();
      bindTitleCards(main);
      bindViewHandlers(main);
      return;
    }

    switch (currentView) {
      case "home":
        main.innerHTML = renderHome();
        break;
      case "discover":
        main.innerHTML = renderDiscover();
        break;
      case "new":
        main.innerHTML = renderNewHot();
        break;
      case "watchlist":
        main.innerHTML = renderStatusPage("watchlist", "Watchlist", "📌", "Shows & movies you want to watch.");
        break;
      case "watching":
        main.innerHTML = renderStatusPage("watching", "Currently watching", "▶️", "Pick up where you left off.");
        break;
      case "seen":
        main.innerHTML = renderStatusPage("seen", "Seen", "✅", "Finished titles and your ratings.");
        break;
      case "reviews":
        main.innerHTML = renderReviews();
        break;
      case "stats":
        main.innerHTML = renderStats();
        break;
      case "platforms":
        main.innerHTML = renderPlatforms();
        break;
      case "settings":
        main.innerHTML = renderSettings();
        break;
      default:
        main.innerHTML = renderHome();
    }
    bindTitleCards(main);
    bindViewHandlers(main);
  }

  function bindTitleCards(root) {
    root.querySelectorAll("[data-title-id]").forEach((el) => {
      el.addEventListener("click", (e) => {
        // ignore clicks on nested controls that stopPropagation
        if (e.target.closest("[data-stop]")) return;
        openDetail(el.dataset.titleId);
      });
    });
  }

  function bindViewHandlers(root) {
    root.querySelectorAll("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => {
        currentView = el.dataset.goto;
        searchQuery = "";
        const si = document.getElementById("global-search");
        if (si) si.value = "";
        render();
      });
    });

    root.querySelectorAll("[data-filter]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.filter;
        const val = el.dataset.value;
        discoverFilters[key] = val;
        render();
      });
    });

    root.querySelectorAll("[data-filter-select]").forEach((el) => {
      el.addEventListener("change", () => {
        discoverFilters[el.dataset.filterSelect] = el.value;
        render();
      });
    });

    // Platform toggles
    root.querySelectorAll("[data-sub-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.dataset.subToggle;
        state.subscriptions[id] = !state.subscriptions[id];
        saveState();
        render();
        toast(state.subscriptions[id] ? `Subscribed: ${platformById(id).name}` : `Unsubscribed: ${platformById(id).name}`);
      });
    });

    root.querySelectorAll("[data-platform-filter]").forEach((el) => {
      const go = (e) => {
        if (e.target.closest("[data-stop]")) return;
        discoverFilters.platform = el.dataset.platformFilter;
        currentView = "discover";
        render();
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go(e);
        }
      });
    });

    // Settings
    const nameInput = root.querySelector("#settings-name");
    nameInput?.addEventListener("change", () => {
      state.userName = nameInput.value.trim() || "Connor";
      saveState();
      setActiveNav();
      toast("Name saved");
    });

    root.querySelector("#export-data")?.addEventListener("click", exportData);
    root.querySelector("#import-data")?.addEventListener("change", importData);
    root.querySelector("#reset-data")?.addEventListener("click", () => {
      if (!confirm("Clear all your watchlist, ratings and reviews? This cannot be undone.")) return;
      state.library = {};
      state.customTitles = [];
      saveState();
      render();
      toast("Library cleared");
    });

    root.querySelector("#refresh-live")?.addEventListener("click", async () => {
      if (!window.WatchLive) return;
      toast("Refreshing live data…");
      liveLoading = true;
      render();
      try {
        await window.WatchLive.refreshFeeds();
        liveReady = true;
        liveLoading = false;
        toast("Live feeds updated");
      } catch {
        liveLoading = false;
        toast("Couldn’t refresh — check internet");
      }
      render();
    });
  }

  // ——— Filtering / sorting ———
  function filterTitles(list, opts = {}) {
    let out = [...list];
    const q = (opts.query ?? searchQuery).toLowerCase();
    if (q) {
      out = out.filter((t) => {
        const hay = [t.title, t.overview, ...(t.genres || []), t.type, String(t.year)]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (opts.type && opts.type !== "all") {
      out = out.filter((t) => t.type === opts.type);
    }
    if (opts.platform && opts.platform !== "all") {
      out = out.filter((t) => (t.platforms || []).includes(opts.platform));
    }
    if (opts.genre && opts.genre !== "all") {
      out = out.filter((t) => (t.genres || []).includes(opts.genre));
    }
    if (opts.onlySubscribed) {
      out = out.filter((t) => (t.platforms || []).some((p) => state.subscriptions[p]));
    }
    const sort = opts.sort || "title";
    out.sort((a, b) => {
      if (sort === "trending") {
        const ta = (b.trending ? 2 : 0) + (b.new ? 1 : 0) + (b.rating || 0) / 10;
        const tb = (a.trending ? 2 : 0) + (a.new ? 1 : 0) + (a.rating || 0) / 10;
        return ta - tb;
      }
      if (sort === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sort === "year") return (b.year || 0) - (a.year || 0);
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "updated") {
        const ua = userEntry(a.id).updatedAt || "";
        const ub = userEntry(b.id).updatedAt || "";
        return ub.localeCompare(ua);
      }
      return 0;
    });
    return out;
  }

  function recommendations() {
    // Prefer genres user rated highly
    const rated = Object.entries(state.library)
      .filter(([, e]) => e.rating >= 4)
      .map(([id]) => getTitle(id))
      .filter(Boolean);
    const genreScores = {};
    for (const t of rated) {
      for (const g of t.genres || []) genreScores[g] = (genreScores[g] || 0) + 1;
    }
    const topGenres = Object.entries(genreScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g);

    const tracked = new Set(
      Object.entries(state.library)
        .filter(([, e]) => e.status !== "none")
        .map(([id]) => id)
    );

    let pool = allTitles().filter((t) => !tracked.has(t.id));
    if (topGenres.length) {
      pool = pool.filter((t) => (t.genres || []).some((g) => topGenres.includes(g)));
    }
    // Prefer subscribed platforms
    pool.sort((a, b) => {
      const sa = (a.platforms || []).some((p) => state.subscriptions[p]) ? 1 : 0;
      const sb = (b.platforms || []).some((p) => state.subscriptions[p]) ? 1 : 0;
      return sb - sa || (b.rating || 0) - (a.rating || 0);
    });
    return pool.slice(0, 12);
  }

  // ——— HTML pieces ———
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function starString(n) {
    const r = Math.round(n || 0);
    return "★".repeat(Math.min(5, Math.max(0, r))) + "☆".repeat(Math.max(0, 5 - r));
  }

  function platformPills(platforms) {
    return (platforms || [])
      .map((id) => {
        const p = platformById(id);
        return `<span class="platform-pill" style="background:${p.color}">${escapeHtml(p.name)}</span>`;
      })
      .join("");
  }

  function statusBadge(status) {
    if (!status || status === "none") return "";
    const map = {
      watchlist: ["Watchlist", "status-watchlist"],
      watching: ["Watching", "status-watching"],
      seen: ["Seen", "status-seen"],
      dropped: ["Dropped", "status-dropped"],
    };
    const [label, cls] = map[status] || [status, "status"];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function titleCard(t, opts = {}) {
    const u = userEntry(t.id);
    const hue = t.posterHue ?? 220;
    const letter = (t.title || "?").charAt(0).toUpperCase();
    const year = t.endYear && t.endYear !== t.year ? `${t.year}–${t.endYear}` : t.year || "";
    const typeLabel = t.type === "movie" ? "Movie" : "Series";
    let progressHtml = "";
    if (u.status === "watching" && (u.progress > 0 || u.episodesWatched > 0)) {
      const pct = u.progress || 0;
      progressHtml = `<div class="progress-bar" title="${pct}%"><span style="width:${pct}%"></span></div>`;
    }
    let userStars = "";
    if (u.rating) {
      userStars = `<span class="stars" title="Your rating">${starString(u.rating)}</span>`;
    } else if (t.rating) {
      userStars = `<span title="Score">${Number(t.rating).toFixed(1)} ★</span>`;
    }

    const hasImg = !!t.image;
    const airing =
      t.airingEpisode && t.airingEpisode.season
        ? `S${t.airingEpisode.season}E${t.airingEpisode.number || "?"} airing`
        : "";

    return `
      <button type="button" class="title-card" data-title-id="${escapeHtml(t.id)}" style="--hue:${hue}">
        <div class="poster ${hasImg ? "has-image" : ""}" style="--hue:${hue}">
          ${hasImg ? `<img class="poster-img" src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
          <span class="poster-letter">${escapeHtml(letter)}</span>
          <div class="badge-row">
            ${t.live ? `<span class="badge live">Live</span>` : ""}
            ${t.new ? `<span class="badge new">New</span>` : ""}
            ${t.trending && !opts.hideTrending ? `<span class="badge trending">Hot</span>` : ""}
            ${statusBadge(u.status)}
          </div>
          <div class="poster-meta">
            <div class="t-name">${escapeHtml(t.title)}</div>
            <div class="t-year">${escapeHtml(String(year || "—"))} · ${typeLabel}${airing ? ` · ${escapeHtml(airing)}` : ""}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="platform-row">${platformPills(t.platforms)}${t.network && (!t.platforms || t.platforms[0] === "other") ? `<span class="platform-pill" style="background:#555">${escapeHtml(t.network)}</span>` : ""}</div>
          <div class="meta-line">
            ${userStars}
            ${(t.genres || []).slice(0, 2).map((g) => `<span>${escapeHtml(g)}</span>`).join("<span>·</span>")}
          </div>
          ${progressHtml}
        </div>
      </button>
    `;
  }

  function creditLine() {
    return `<p class="credit-line">Live TV data by <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a> · posters & schedules update when online</p>`;
  }

  function liveStatusChip() {
    if (liveLoading) return `<span class="live-dot">Loading live data…</span>`;
    if (isLiveOnline() || livePopular().length) {
      return `<span class="live-dot">Live · TVmaze</span>`;
    }
    return `<span class="live-dot offline">Offline · local catalog</span>`;
  }

  function titleGrid(list, emptyMsg) {
    if (!list.length) {
      return `
        <div class="empty">
          <div class="empty-icon">🍿</div>
          <h3>Nothing here yet</h3>
          <p>${escapeHtml(emptyMsg || "Try another filter, or add a title.")}</p>
        </div>
      `;
    }
    return `<div class="grid">${list.map((t) => titleCard(t)).join("")}</div>`;
  }

  function titleRail(list) {
    if (!list.length) return `<p class="hint">Nothing to show.</p>`;
    return `<div class="rail">${list.map((t) => titleCard(t)).join("")}</div>`;
  }

  // ——— Views ———
  function renderHome() {
    const watching = titlesByStatus("watching").slice(0, 12);
    const watchlist = titlesByStatus("watchlist").slice(0, 12);
    const popular = livePopular().slice(0, 14);
    const schedule = liveSchedule().slice(0, 14);
    const trending =
      popular.length > 0
        ? popular
        : filterTitles(allTitles(), { sort: "trending" }).slice(0, 12);
    const news =
      schedule.length > 0
        ? schedule
        : allTitles().filter((t) => t.new).slice(0, 12);
    const recs = recommendations();
    const name = state.userName || "Connor";
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const featured =
      watching[0] ||
      watchlist[0] ||
      trending.find((t) => (t.platforms || []).some((p) => state.subscriptions[p])) ||
      trending[0];

    return `
      <div class="hero">
        <div class="hero-kicker">🍿 Watch Hub · for ${escapeHtml(name)} · ${liveStatusChip()}</div>
        <h2>${greet}. What are we watching?</h2>
        <p>Live show data from the web — search millions of titles, see what’s airing, track watchlist & reviews. Works offline with the local catalog too.</p>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary" data-goto="discover">Discover</button>
          <button type="button" class="btn btn-secondary" data-goto="new" style="background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.2);color:#fff">Airing now</button>
          ${
            featured
              ? `<button type="button" class="btn btn-ghost" style="color:#fff" data-title-id="${escapeHtml(featured.id)}">Open: ${escapeHtml(featured.title)}</button>`
              : ""
          }
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Watchlist</div>
          <div class="stat-value">${countStatus("watchlist")}</div>
          <div class="stat-sub">queued up</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Watching</div>
          <div class="stat-value">${countStatus("watching")}</div>
          <div class="stat-sub">in progress</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Seen</div>
          <div class="stat-value">${countStatus("seen")}</div>
          <div class="stat-sub">finished</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Live library</div>
          <div class="stat-value">${livePopular().length + liveSchedule().length || allTitles().length}</div>
          <div class="stat-sub">${isLiveOnline() ? "from TVmaze" : "local titles"}</div>
        </div>
      </div>

      ${
        liveLoading
          ? `<div class="loading-block"><div class="spinner"></div>Fetching live shows & posters…</div>`
          : ""
      }

      ${
        watching.length
          ? `<section class="section">
              <div class="section-head">
                <h3>Continue watching</h3>
                <button type="button" class="linkish" data-goto="watching">See all</button>
              </div>
              ${titleRail(watching)}
            </section>`
          : ""
      }

      ${
        watchlist.length
          ? `<section class="section">
              <div class="section-head">
                <h3>From your watchlist</h3>
                <button type="button" class="linkish" data-goto="watchlist">See all</button>
              </div>
              ${titleRail(watchlist)}
            </section>`
          : ""
      }

      <section class="section">
        <div class="section-head">
          <h3>${popular.length ? "Popular on streaming" : "Trending now"}</h3>
          <button type="button" class="linkish" data-goto="discover">Discover</button>
        </div>
        ${titleRail(trending)}
      </section>

      ${
        news.length
          ? `<section class="section">
              <div class="section-head">
                <h3>${schedule.length ? "Airing today / tomorrow" : "New arrivals"}</h3>
                <button type="button" class="linkish" data-goto="new">New & hot</button>
              </div>
              ${titleRail(news)}
            </section>`
          : ""
      }

      <section class="section">
        <div class="section-head">
          <h3>Recommended for you</h3>
        </div>
        ${
          recs.length
            ? titleRail(recs)
            : `<p class="hint">Rate a few shows you’ve seen and we’ll suggest more in those genres.</p>`
        }
      </section>

      ${creditLine()}
    `;
  }

  function renderDiscover() {
    let pool = allTitles();
    if (discoverFilters.source === "live") {
      pool = pool.filter((t) => t.live);
    } else if (discoverFilters.source === "local") {
      pool = pool.filter((t) => !t.live);
    }

    const list = filterTitles(pool, {
      type: discoverFilters.type,
      platform: discoverFilters.platform,
      genre: discoverFilters.genre,
      sort: discoverFilters.sort,
    });

    const platforms = catalog.platforms || [];
    const genres = catalog.genres || [];

    return `
      <div class="page-header">
        <div>
          <h2>Discover</h2>
          <p>${liveStatusChip()} · ${list.length} titles · use search for the full live database</p>
        </div>
      </div>

      <div class="filters">
        <button type="button" class="chip ${discoverFilters.source === "all" ? "active" : ""}" data-filter="source" data-value="all">All sources</button>
        <button type="button" class="chip ${discoverFilters.source === "live" ? "active" : ""}" data-filter="source" data-value="live">🔴 Live</button>
        <button type="button" class="chip ${discoverFilters.source === "local" ? "active" : ""}" data-filter="source" data-value="local">📦 Local</button>

        <button type="button" class="chip ${discoverFilters.type === "all" ? "active" : ""}" data-filter="type" data-value="all">All types</button>
        <button type="button" class="chip ${discoverFilters.type === "series" ? "active" : ""}" data-filter="type" data-value="series">Series</button>
        <button type="button" class="chip ${discoverFilters.type === "movie" ? "active" : ""}" data-filter="type" data-value="movie">Movies</button>

        <select class="filter-select" data-filter-select="platform" aria-label="Platform">
          <option value="all">All platforms</option>
          ${platforms
            .map(
              (p) =>
                `<option value="${escapeHtml(p.id)}" ${discoverFilters.platform === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`
            )
            .join("")}
        </select>

        <select class="filter-select" data-filter-select="genre" aria-label="Genre">
          <option value="all">All genres</option>
          ${genres
            .map(
              (g) =>
                `<option value="${escapeHtml(g)}" ${discoverFilters.genre === g ? "selected" : ""}>${escapeHtml(g)}</option>`
            )
            .join("")}
        </select>

        <select class="filter-select" data-filter-select="sort" aria-label="Sort">
          <option value="trending" ${discoverFilters.sort === "trending" ? "selected" : ""}>Trending</option>
          <option value="rating" ${discoverFilters.sort === "rating" ? "selected" : ""}>Top rated</option>
          <option value="year" ${discoverFilters.sort === "year" ? "selected" : ""}>Newest year</option>
          <option value="title" ${discoverFilters.sort === "title" ? "selected" : ""}>A–Z</option>
        </select>
      </div>

      ${titleGrid(list, "No titles match these filters. Try Live search in the top bar.")}
      ${creditLine()}
    `;
  }

  function renderNewHot() {
    const schedule = liveSchedule();
    const popular = livePopular();
    const fallback = filterTitles(
      allTitles().filter((t) => t.new || t.trending),
      { sort: "trending" }
    );
    const news = schedule.length ? schedule : fallback;
    const onMyPlatforms = news.filter((t) => (t.platforms || []).some((p) => state.subscriptions[p]));
    const streamingOnly = news.filter((t) => t.platforms && t.platforms[0] !== "other");

    return `
      <div class="page-header">
        <div>
          <h2>New & hot</h2>
          <p>${liveStatusChip()} · live airing schedule + popular streaming shows</p>
        </div>
        <button type="button" class="btn btn-secondary" id="refresh-live">Refresh live</button>
      </div>

      ${
        liveLoading
          ? `<div class="loading-block"><div class="spinner"></div>Loading schedule…</div>`
          : ""
      }

      ${
        onMyPlatforms.length
          ? `<section class="section">
              <div class="section-head"><h3>On your platforms</h3></div>
              ${titleGrid(onMyPlatforms)}
            </section>`
          : ""
      }

      ${
        streamingOnly.length && streamingOnly.length !== onMyPlatforms.length
          ? `<section class="section">
              <div class="section-head"><h3>Streaming / major platforms</h3></div>
              ${titleGrid(streamingOnly)}
            </section>`
          : ""
      }

      <section class="section">
        <div class="section-head"><h3>${schedule.length ? "Airing today & tomorrow" : "New & trending"}</h3></div>
        ${titleGrid(news, "No schedule loaded — connect to the internet and hit Refresh live.")}
      </section>

      ${
        popular.length
          ? `<section class="section">
              <div class="section-head"><h3>Popular right now</h3></div>
              ${titleGrid(popular)}
            </section>`
          : ""
      }

      ${creditLine()}
    `;
  }

  function renderStatusPage(status, title, emoji, blurb) {
    const list = filterTitles(titlesByStatus(status), { sort: "updated" });
    return `
      <div class="page-header">
        <div>
          <h2>${emoji} ${escapeHtml(title)}</h2>
          <p>${escapeHtml(blurb)} · ${list.length} title${list.length === 1 ? "" : "s"}</p>
        </div>
        <button type="button" class="btn btn-secondary" data-goto="discover">Find more</button>
      </div>
      ${titleGrid(
        list,
        status === "watchlist"
          ? "Add shows from Discover — tap a title and hit Watchlist."
          : status === "watching"
            ? "Mark something as Watching to track progress."
            : "Mark finished shows as Seen and leave a rating."
      )}
    `;
  }

  function renderReviews() {
    const items = Object.entries(state.library)
      .filter(([, e]) => e.rating || (e.review && e.review.trim()))
      .map(([id, e]) => ({ id, e, t: getTitle(id) }))
      .filter((x) => x.t)
      .sort((a, b) => (b.e.updatedAt || "").localeCompare(a.e.updatedAt || ""));

    return `
      <div class="page-header">
        <div>
          <h2>Your reviews</h2>
          <p>Ratings and notes you’ve written · ${items.length}</p>
        </div>
      </div>
      ${
        !items.length
          ? `<div class="empty">
              <div class="empty-icon">⭐</div>
              <h3>No reviews yet</h3>
              <p>Open any title and rate it (1–5 stars) or write a short review.</p>
              <button type="button" class="btn btn-primary" data-goto="discover">Browse titles</button>
            </div>`
          : `<div class="list">
              ${items
                .map(({ id, e, t }) => {
                  const hue = t.posterHue ?? 220;
                  return `
                    <button type="button" class="list-item" data-title-id="${escapeHtml(id)}">
                      <div class="list-poster ${t.image ? "has-image" : ""}" style="--hue:${hue}">
                        ${t.image ? `<img src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : escapeHtml(t.title.charAt(0))}
                      </div>
                      <div class="list-body">
                        <h4>${escapeHtml(t.title)}</h4>
                        <div class="meta-line">
                          ${e.rating ? `<span class="stars">${starString(e.rating)}</span>` : ""}
                          ${statusBadge(e.status)}
                          <span>${escapeHtml((t.genres || []).slice(0, 2).join(" · "))}</span>
                        </div>
                        ${e.review ? `<p class="review-text">${escapeHtml(e.review)}</p>` : ""}
                        ${e.notes && e.notes !== e.review ? `<p class="review-text" style="opacity:0.8">${escapeHtml(e.notes)}</p>` : ""}
                      </div>
                    </button>
                  `;
                })
                .join("")}
            </div>`
      }
    `;
  }

  function renderStats() {
    const lib = Object.entries(state.library);
    const seen = lib.filter(([, e]) => e.status === "seen");
    const ratings = lib.map(([, e]) => e.rating).filter((r) => r > 0);
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Genre breakdown from tracked titles
    const genreCount = {};
    for (const [id, e] of lib) {
      if (e.status === "none") continue;
      const t = getTitle(id);
      if (!t) continue;
      for (const g of t.genres || []) genreCount[g] = (genreCount[g] || 0) + 1;
    }
    const genresSorted = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxG = genresSorted[0]?.[1] || 1;

    // Platform breakdown
    const platCount = {};
    for (const [id, e] of lib) {
      if (e.status === "none") continue;
      const t = getTitle(id);
      if (!t) continue;
      for (const p of t.platforms || []) platCount[p] = (platCount[p] || 0) + 1;
    }
    const platsSorted = Object.entries(platCount).sort((a, b) => b[1] - a[1]);
    const maxP = platsSorted[0]?.[1] || 1;

    // Estimated hours (rough: seen movies = runtime, series = seasons * 8 * runtime)
    let hours = 0;
    for (const [id, e] of seen) {
      const t = getTitle(id);
      if (!t) continue;
      if (t.type === "movie") hours += (t.runtime || 100) / 60;
      else hours += ((t.seasons || 1) * 8 * (t.runtime || 45)) / 60;
    }

    const topRated = lib
      .filter(([, e]) => e.rating >= 4)
      .map(([id, e]) => ({ t: getTitle(id), e }))
      .filter((x) => x.t)
      .sort((a, b) => b.e.rating - a.e.rating || (b.e.updatedAt || "").localeCompare(a.e.updatedAt || ""))
      .slice(0, 6);

    return `
      <div class="page-header">
        <div>
          <h2>Your stats</h2>
          <p>A snapshot of what you’ve been watching</p>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Tracked</div>
          <div class="stat-value">${lib.filter(([, e]) => e.status !== "none").length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Finished</div>
          <div class="stat-value">${seen.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg rating</div>
          <div class="stat-value">${ratings.length ? avg.toFixed(1) : "—"}</div>
          <div class="stat-sub">${ratings.length} rated</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Est. hours</div>
          <div class="stat-value">${Math.round(hours)}</div>
          <div class="stat-sub">from Seen list</div>
        </div>
      </div>

      <div class="two-col">
        <div class="card-panel">
          <h3>Genres you track</h3>
          ${
            genresSorted.length
              ? `<div class="bar-chart">
                  ${genresSorted
                    .map(
                      ([g, n]) => `
                    <div class="bar-row">
                      <span class="bar-label">${escapeHtml(g)}</span>
                      <div class="bar-track"><div class="bar-fill" style="width:${(n / maxG) * 100}%"></div></div>
                      <span class="bar-n">${n}</span>
                    </div>`
                    )
                    .join("")}
                </div>`
              : `<p class="hint">Start tracking titles to see genre stats.</p>`
          }
        </div>
        <div class="card-panel">
          <h3>Platforms</h3>
          ${
            platsSorted.length
              ? `<div class="bar-chart">
                  ${platsSorted
                    .map(([id, n]) => {
                      const p = platformById(id);
                      return `
                      <div class="bar-row">
                        <span class="bar-label">${escapeHtml(p.name)}</span>
                        <div class="bar-track"><div class="bar-fill" style="width:${(n / maxP) * 100}%;background:${p.color}"></div></div>
                        <span class="bar-n">${n}</span>
                      </div>`;
                    })
                    .join("")}
                </div>`
              : `<p class="hint">No platform data yet.</p>`
          }
        </div>
      </div>

      ${
        topRated.length
          ? `<section class="section" style="margin-top:20px">
              <div class="section-head"><h3>Your favourites</h3></div>
              ${titleRail(topRated.map((x) => x.t))}
            </section>`
          : ""
      }
    `;
  }

  function renderPlatforms() {
    const platforms = catalog.platforms || [];
    const titles = allTitles();

    return `
      <div class="page-header">
        <div>
          <h2>Platforms</h2>
          <p>Toggle what you subscribe to — New & Hot will prioritise those. Tap a card to browse.</p>
        </div>
      </div>
      <div class="platform-grid">
        ${platforms
          .map((p) => {
            const count = titles.filter((t) => (t.platforms || []).includes(p.id)).length;
            const on = !!state.subscriptions[p.id];
            return `
              <div class="platform-card" style="--pcolor:${p.color}" data-platform-filter="${escapeHtml(p.id)}" role="button" tabindex="0">
                <div class="p-top">
                  <div class="p-emoji">${p.emoji || "📺"}</div>
                  <div>
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="p-count">${count} in catalog</div>
                  </div>
                </div>
                <div class="toggle-sub">
                  <button type="button" class="toggle ${on ? "on" : ""}" data-sub-toggle="${escapeHtml(p.id)}" data-stop aria-label="Toggle subscription"></button>
                  <span>${on ? "Subscribed" : "Not subscribed"}</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderSettings() {
    return `
      <div class="page-header">
        <div>
          <h2>Settings</h2>
          <p>Your data stays in this browser on this Mac.</p>
        </div>
      </div>

      <div class="card-panel settings-block">
        <h3>Profile</h3>
        <div class="field">
          <label for="settings-name">Display name</label>
          <input id="settings-name" type="text" value="${escapeHtml(state.userName || "")}" maxlength="40" />
        </div>
        <p class="hint">Theme: use the sun/moon button in the top bar. Current: <strong>${state.theme === "light" ? "Light" : "Dark"}</strong>.</p>
      </div>

      <div class="card-panel settings-block">
        <h3>Backup</h3>
        <p class="hint" style="margin-bottom:10px">Export a JSON backup of your library, or import one from another Mac.</p>
        <div class="settings-actions">
          <button type="button" class="btn btn-secondary" id="export-data">Export backup</button>
          <label class="btn btn-secondary" style="cursor:pointer">
            Import backup
            <input type="file" id="import-data" accept="application/json,.json" hidden />
          </label>
          <button type="button" class="btn btn-danger" id="reset-data">Clear library</button>
        </div>
      </div>

      <div class="card-panel settings-block">
        <h3>Live data</h3>
        <p class="hint" style="margin-bottom:10px">
          ${liveStatusChip()}<br />
          Popular cached: ${livePopular().length} · Schedule: ${liveSchedule().length}<br />
          Source: <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a> (free, no API key). Search the top bar to query the full live database.
        </p>
        <div class="settings-actions">
          <button type="button" class="btn btn-secondary" id="refresh-live">Refresh live feeds</button>
        </div>
      </div>

      <div class="card-panel settings-block">
        <h3>About</h3>
        <p class="hint">
          <strong>Watch Hub</strong> — a JustWatch-style tracker for Connor.<br />
          Local catalog: v${escapeHtml(String(catalog.version || "—"))} · ${escapeHtml(catalog.updated || "—")}<br />
          ${allTitles().length} titles in memory · ${Object.keys(state.library).length} personal entries<br />
          Updates: double-click <strong>Update Watch Hub.command</strong> on the Desktop.
        </p>
      </div>
    `;
  }

  function renderSearchResults() {
    if (searchLoading && !searchResults) {
      return `
        <div class="page-header">
          <div>
            <h2>Search</h2>
            <p>Searching live database for “${escapeHtml(searchQuery)}”…</p>
          </div>
        </div>
        <div class="loading-block"><div class="spinner"></div>Talking to TVmaze…</div>
      `;
    }
    const list = searchResults || filterTitles(allTitles(), { query: searchQuery, sort: "rating" });
    const liveCount = list.filter((t) => t.live).length;
    return `
      <div class="page-header">
        <div>
          <h2>Search</h2>
          <p>${list.length} result${list.length === 1 ? "" : "s"} for “${escapeHtml(searchQuery)}”
            ${liveCount ? ` · ${liveCount} live` : ""}</p>
        </div>
      </div>
      ${titleGrid(list, "No matches — try another word, or add a custom title with + Add.")}
      ${creditLine()}
    `;
  }

  // ——— Detail modal ———
  async function openDetail(id) {
    let t = getTitle(id);
    if (!t) {
      toast("Title not found");
      return;
    }
    detailId = id;

    // Refresh live show if we only have a stub
    if (t.tvmazeId && window.WatchLive) {
      try {
        const fresh = await window.WatchLive.getShow(t.tvmazeId);
        if (fresh) t = fresh;
      } catch {
        /* keep cached */
      }
    }

    const u = userEntry(id);
    const hue = t.posterHue ?? 220;
    const year =
      t.endYear && t.endYear !== t.year ? `${t.year}–${t.endYear}` : t.year || "—";
    const typeLabel = t.type === "movie" ? "Movie" : `Series${t.seasons ? ` · ${t.seasons} season${t.seasons > 1 ? "s" : ""}` : ""}`;
    const hasImg = !!t.image;

    const root = document.getElementById("modal-root");
    const titleEl = document.getElementById("modal-title");
    const body = document.getElementById("modal-body");
    const footer = document.getElementById("modal-footer");
    if (!root || !body) return;

    titleEl.textContent = t.title;
    body.innerHTML = `
      <div class="detail-layout">
        <div class="detail-poster ${hasImg ? "has-image" : ""}" style="--hue:${hue}">
          ${hasImg ? `<img src="${escapeHtml(t.image)}" alt="" referrerpolicy="no-referrer" />` : escapeHtml(t.title.charAt(0))}
        </div>
        <div>
          <div class="meta-line" style="margin-bottom:6px">
            <strong>${escapeHtml(String(year))}</strong>
            <span>·</span>
            <span>${escapeHtml(typeLabel)}</span>
            ${t.rating ? `<span>·</span><span>${Number(t.rating).toFixed(1)} ★</span>` : ""}
            ${t.runtime ? `<span>·</span><span>~${t.runtime} min</span>` : ""}
            ${t.live ? `<span>·</span><span class="live-dot" style="font-size:0.75rem">Live</span>` : ""}
          </div>
          <div class="platform-row" style="margin-bottom:8px">
            ${platformPills(t.platforms)}
            ${t.network ? `<span class="platform-pill" style="background:#444">${escapeHtml(t.network)}</span>` : ""}
          </div>
          <div class="meta-line">${(t.genres || []).map((g) => `<span class="chip" style="padding:3px 8px;cursor:default">${escapeHtml(g)}</span>`).join("")}</div>
          ${t.showStatus ? `<p class="hint" style="margin:6px 0 0">Show status: <strong>${escapeHtml(t.showStatus)}</strong>${t.airingEpisode ? ` · Latest listed: S${t.airingEpisode.season}E${t.airingEpisode.number || "?"} (${escapeHtml(t.airingEpisode.airdate || "")})` : ""}</p>` : ""}
          <p class="detail-overview">${escapeHtml(t.overview || "No overview yet.")}</p>
          ${t.tvmazeUrl ? `<p class="hint"><a href="${escapeHtml(t.tvmazeUrl)}" target="_blank" rel="noopener">View on TVmaze ↗</a>${t.officialSite ? ` · <a href="${escapeHtml(t.officialSite)}" target="_blank" rel="noopener">Official site ↗</a>` : ""}</p>` : ""}
          <div id="episode-info" class="hint"></div>
        </div>
      </div>

      <h3 style="font-family:var(--font-display);font-size:0.95rem;margin:16px 0 6px">Status</h3>
      <div class="status-pills" id="status-pills">
        ${STATUSES.map(
          (s) =>
            `<button type="button" class="status-pill ${u.status === s.id ? "active" : ""}" data-set-status="${s.id}">${s.emoji} ${escapeHtml(s.label)}</button>`
        ).join("")}
      </div>

      ${
        t.type === "series" || u.status === "watching"
          ? `
        <div class="field" style="margin-top:10px">
          <label for="progress-range">Progress ${u.progress || 0}%</label>
          <input type="range" id="progress-range" min="0" max="100" step="5" value="${u.progress || 0}" />
        </div>
        ${
          t.type === "series"
            ? `<div class="field">
                <label for="episodes-watched">Episodes watched (optional)</label>
                <input type="number" id="episodes-watched" min="0" max="999" value="${u.episodesWatched || 0}" />
              </div>`
            : ""
        }
      `
          : ""
      }

      <h3 style="font-family:var(--font-display);font-size:0.95rem;margin:14px 0 4px">Your rating</h3>
      <div class="star-picker" id="star-picker">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" class="star-btn ${u.rating >= n ? "on" : ""}" data-rate="${n}" aria-label="${n} stars">⭐</button>`
          )
          .join("")}
        ${u.rating ? `<button type="button" class="btn btn-ghost btn-sm" id="clear-rating">Clear</button>` : ""}
      </div>

      <div class="field">
        <label for="review-text">Review</label>
        <textarea id="review-text" rows="3" placeholder="What did you think? Spoilers OK — this is just for you.">${escapeHtml(u.review || "")}</textarea>
      </div>
      <div class="field">
        <label for="notes-text">Private notes</label>
        <textarea id="notes-text" rows="2" placeholder="Where you left off, who recommended it…">${escapeHtml(u.notes || "")}</textarea>
      </div>
    `;

    footer.innerHTML = `
      ${t.custom ? `<button type="button" class="btn btn-danger" id="delete-custom" style="margin-right:auto">Delete title</button>` : `<span style="margin-right:auto"></span>`}
      <button type="button" class="btn btn-secondary" data-close-modal>Close</button>
      <button type="button" class="btn btn-primary" id="save-detail">Save</button>
    `;

    root.hidden = false;

    // Bind detail interactions
    body.querySelectorAll("[data-set-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const status = btn.dataset.setStatus;
        setUserEntry(id, { status });
        toast(STATUSES.find((s) => s.id === status)?.label || "Updated");
        // Refresh detail (progress fields depend on status) + background list
        openDetail(id);
        render();
        // Keep modal open after re-render
        const r = document.getElementById("modal-root");
        if (r) r.hidden = false;
      });
    });

    body.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rating = Number(btn.dataset.rate);
        const cur = userEntry(id);
        setUserEntry(id, {
          rating,
          status: cur.status === "none" ? "seen" : cur.status,
        });
        openDetail(id);
        toast(`Rated ${rating}/5`);
        render();
      });
    });

    body.querySelector("#clear-rating")?.addEventListener("click", () => {
      setUserEntry(id, { rating: 0 });
      openDetail(id);
      render();
    });

    const range = body.querySelector("#progress-range");
    range?.addEventListener("input", () => {
      const label = range.previousElementSibling;
      if (label) label.textContent = `Progress ${range.value}%`;
    });

    footer.querySelector("#save-detail")?.addEventListener("click", () => {
      const review = body.querySelector("#review-text")?.value || "";
      const notes = body.querySelector("#notes-text")?.value || "";
      const progress = Number(body.querySelector("#progress-range")?.value || userEntry(id).progress || 0);
      const episodesWatched = Number(body.querySelector("#episodes-watched")?.value || 0);
      const cur = userEntry(id);
      setUserEntry(id, {
        review: review.trim(),
        notes: notes.trim(),
        progress,
        episodesWatched,
        status: cur.status === "none" && (review.trim() || notes.trim()) ? "watchlist" : cur.status,
      });
      closeModal();
      render();
      toast("Saved");
    });

    footer.querySelector("#delete-custom")?.addEventListener("click", () => {
      if (!confirm(`Delete “${t.title}” from your library?`)) return;
      state.customTitles = state.customTitles.filter((x) => x.id !== id);
      delete state.library[id];
      saveState();
      closeModal();
      render();
      toast("Deleted");
    });

    footer.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModal));

    // Live episode count for series
    if (t.tvmazeId && window.WatchLive) {
      const epEl = body.querySelector("#episode-info");
      if (epEl) {
        epEl.textContent = "Loading episode list…";
        window.WatchLive
          .fetchEpisodes(t.tvmazeId)
          .then((eps) => {
            if (detailId !== id || !epEl.isConnected) return;
            const aired = eps.filter((e) => e.airdate && Date.parse(e.airdate) <= Date.now());
            const next = eps.find((e) => e.airdate && Date.parse(e.airdate) > Date.now());
            const seasons = new Set(eps.map((e) => e.season).filter((s) => s != null));
            epEl.innerHTML = `<strong>${eps.length}</strong> episodes · <strong>${seasons.size}</strong> seasons · <strong>${aired.length}</strong> aired${
              next
                ? ` · next: S${next.season}E${next.number} (${escapeHtml(next.airdate)})`
                : ""
            }`;
          })
          .catch(() => {
            if (epEl.isConnected) epEl.textContent = "";
          });
      }
    }
  }

  function closeModal() {
    const root = document.getElementById("modal-root");
    if (root) root.hidden = true;
    detailId = null;
  }

  // ——— Add custom title ———
  function openAddModal() {
    const root = document.getElementById("modal-root");
    const titleEl = document.getElementById("modal-title");
    const body = document.getElementById("modal-body");
    const footer = document.getElementById("modal-footer");
    if (!root || !body) return;

    const platforms = catalog.platforms || [];
    const genres = catalog.genres || [];

    titleEl.textContent = "Add a title";
    body.innerHTML = `
      <div class="field">
        <label for="add-title">Title *</label>
        <input id="add-title" type="text" placeholder="e.g. Arcane" required />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="add-type">Type</label>
          <select id="add-type">
            <option value="series">Series</option>
            <option value="movie">Movie</option>
          </select>
        </div>
        <div class="field">
          <label for="add-year">Year</label>
          <input id="add-year" type="number" min="1900" max="2100" value="${new Date().getFullYear()}" />
        </div>
      </div>
      <div class="field">
        <label for="add-platforms">Platforms (hold ⌘/Ctrl to multi-select)</label>
        <select id="add-platforms" multiple size="5">
          ${platforms.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="add-genres">Genres (comma-separated)</label>
        <input id="add-genres" type="text" placeholder="${escapeHtml(genres.slice(0, 5).join(", "))}" list="genre-list" />
        <datalist id="genre-list">${genres.map((g) => `<option value="${escapeHtml(g)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label for="add-overview">Overview</label>
        <textarea id="add-overview" rows="3" placeholder="Short plot blurb…"></textarea>
      </div>
      <div class="field">
        <label for="add-status">Add to</label>
        <select id="add-status">
          <option value="watchlist">Watchlist</option>
          <option value="watching">Currently watching</option>
          <option value="seen">Seen</option>
          <option value="none">Catalog only</option>
        </select>
      </div>
    `;

    footer.innerHTML = `
      <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
      <button type="button" class="btn btn-primary" id="confirm-add">Add title</button>
    `;
    root.hidden = false;

    footer.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);
    footer.querySelector("#confirm-add")?.addEventListener("click", () => {
      const title = body.querySelector("#add-title")?.value.trim();
      if (!title) {
        toast("Enter a title");
        return;
      }
      const type = body.querySelector("#add-type")?.value || "series";
      const year = Number(body.querySelector("#add-year")?.value) || new Date().getFullYear();
      const platSelect = body.querySelector("#add-platforms");
      const platformsSel = platSelect ? [...platSelect.selectedOptions].map((o) => o.value) : [];
      const genresRaw = body.querySelector("#add-genres")?.value || "";
      const genresSel = genresRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const overview = body.querySelector("#add-overview")?.value.trim() || "";
      const status = body.querySelector("#add-status")?.value || "watchlist";

      const id =
        "custom-" +
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) +
        "-" +
        Date.now().toString(36);

      const hue = Math.floor(Math.random() * 360);
      const entry = {
        id,
        title,
        type,
        year,
        seasons: type === "series" ? 1 : undefined,
        genres: genresSel.length ? genresSel : ["Drama"],
        platforms: platformsSel.length ? platformsSel : ["other"],
        overview: overview || "Added by you.",
        rating: 0,
        runtime: type === "movie" ? 120 : 45,
        new: true,
        trending: false,
        posterHue: hue,
        custom: true,
      };

      state.customTitles.push(entry);
      if (status !== "none") {
        state.library[id] = {
          status,
          rating: 0,
          review: "",
          notes: "",
          progress: 0,
          episodesWatched: 0,
          updatedAt: new Date().toISOString(),
        };
      }
      saveState();
      closeModal();
      render();
      toast(`Added “${title}”`);
      openDetail(id);
    });
  }

  // ——— Import / export ———
  function exportData() {
    const payload = {
      app: "connor-watch-hub",
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `watch-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  }

  function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = data.state || data;
        if (!incoming || typeof incoming !== "object") throw new Error("bad shape");
        const base = defaultState();
        state = {
          ...base,
          ...incoming,
          version: 1,
          subscriptions: { ...base.subscriptions, ...(incoming.subscriptions || {}) },
          library: incoming.library || {},
          customTitles: incoming.customTitles || [],
        };
        saveState();
        applyTheme();
        render();
        toast("Backup imported");
      } catch {
        toast("Couldn’t import that file");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  // ——— Go ———
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
