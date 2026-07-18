/**
 * Watch Hub · Neon Deck
 * Live TVmaze + local catalog · seasons/episodes/hours · rewatches · multi-platform Top 10
 */
(function () {
  "use strict";

  const STORAGE_KEY = "connor-watch-hub-v1";
  const STATUSES = [
    { id: "none", label: "Off", emoji: "○" },
    { id: "watchlist", label: "Queue", emoji: "◇" },
    { id: "watching", label: "Watching", emoji: "▶" },
    { id: "seen", label: "Seen", emoji: "✓" },
    { id: "dropped", label: "Dropped", emoji: "⛔" },
  ];

  const TOP10_CATEGORIES = [
    { id: "all", label: "Overall" },
    { id: "Action", label: "Action" },
    { id: "Comedy", label: "Comedy" },
    { id: "Drama", label: "Drama" },
    { id: "Sci-Fi", label: "Sci-Fi" },
    { id: "Fantasy", label: "Fantasy" },
    { id: "Horror", label: "Horror" },
    { id: "Thriller", label: "Thriller" },
    { id: "Crime", label: "Crime" },
    { id: "Animation", label: "Animation" },
    { id: "Documentary", label: "Doc" },
  ];

  let catalog = { platforms: [], genres: [], titles: [] };
  let state = null;
  let currentView = "home";
  let searchQuery = "";
  let searchResults = null;
  let searchLoading = false;
  let liveReady = false;
  let liveLoading = true;
  let top10Category = "all";
  let discoverFilters = {
    type: "all",
    genre: "all",
    sort: "trending",
    source: "all",
  };
  let toastTimer = null;
  let searchTimer = null;
  let detailId = null;
  /** cached episode lists: titleId → episodes[] */
  let episodeCache = {};

  // ─── Bootstrap ───
  async function init() {
    state = loadState();
    applyTheme();
    bindChrome();
    renderPlatformChips();
    try {
      const res = await fetch("data/catalog.json", { cache: "no-store" });
      if (!res.ok) throw new Error("catalog " + res.status);
      catalog = await res.json();
    } catch (err) {
      console.warn(err);
      catalog = { platforms: [], genres: [], titles: [] };
    }
    renderPlatformChips();
    render();

    if (window.WatchLive) {
      liveLoading = true;
      updateLivePill();
      try {
        const result = await window.WatchLive.bootstrap();
        liveReady = !!result.online || (window.WatchLive.popular || []).length > 0;
        liveLoading = false;
        if (result.online) toast("Live grid locked · TVmaze");
        else toast("Offline deck · local catalog");
      } catch (e) {
        liveLoading = false;
        liveReady = false;
      }
      updateLivePill();
      render();
    } else {
      liveLoading = false;
      updateLivePill();
    }
  }

  // ─── State ───
  function defaultState() {
    return {
      version: 2,
      userName: "Connor",
      theme: "dark",
      /** multi-select: which platforms are “on” for browsing (filters junk) */
      activePlatforms: ["netflix", "disney", "showmax", "prime", "apple", "youtube"],
      subscriptions: {
        netflix: true,
        disney: true,
        showmax: true,
        prime: true,
        apple: false,
        youtube: true,
        dstv: false,
        paramount: false,
        max: false,
        other: false,
      },
      library: {},
      customTitles: [],
    };
  }

  function defaultEntry() {
    return {
      status: "none",
      rating: 0,
      review: "",
      notes: "",
      progress: 0,
      episodesWatched: 0,
      seasonsCompleted: 0,
      rewatches: 0,
      runtimeMinutes: null, // avg episode / movie runtime
      totalEpisodes: null,
      totalSeasons: null,
      watchedMinutesBase: 0, // computed base minutes (before rewatch mult)
      updatedAt: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const lib = {};
      for (const [id, e] of Object.entries(parsed.library || {})) {
        lib[id] = { ...defaultEntry(), ...e };
      }
      return {
        ...base,
        ...parsed,
        version: 2,
        subscriptions: { ...base.subscriptions, ...(parsed.subscriptions || {}) },
        activePlatforms: Array.isArray(parsed.activePlatforms)
          ? parsed.activePlatforms
          : base.activePlatforms,
        library: lib,
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
    if (btn) btn.textContent = state.theme === "light" ? "●" : "◐";
  }

  function updateLivePill() {
    const el = document.getElementById("live-pill");
    if (!el) return;
    if (liveLoading) {
      el.textContent = "SYNC";
      el.classList.remove("off");
    } else if (isLiveOnline() || livePopular().length) {
      el.textContent = "LIVE";
      el.classList.remove("off");
    } else {
      el.textContent = "OFF";
      el.classList.add("off");
    }
  }

  // ─── Catalog / live ───
  function allTitles() {
    const map = new Map();
    for (const t of catalog.titles || []) map.set(t.id, { ...t, custom: false, live: !!t.live });
    if (window.WatchLive) {
      for (const t of window.WatchLive.allCachedTitles()) map.set(t.id, { ...t, custom: false });
    }
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

  function platformsList() {
    return catalog.platforms || [];
  }

  function activePlatformSet() {
    return new Set(state.activePlatforms || []);
  }

  function titleOnActivePlatforms(t) {
    const active = activePlatformSet();
    if (!active.size) return true; // none selected = show all (explicit clear)
    const plats = t.platforms || [];
    if (!plats.length) return active.has("other");
    return plats.some((p) => active.has(p));
  }

  function filterByActivePlatforms(list) {
    return list.filter(titleOnActivePlatforms);
  }

  function userEntry(id) {
    return state.library[id] ? { ...defaultEntry(), ...state.library[id] } : defaultEntry();
  }

  function setUserEntry(id, patch) {
    const prev = userEntry(id);
    const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    // auto compute base minutes when episode/runtime fields change
    next.watchedMinutesBase = computeBaseMinutes(id, next);
    state.library[id] = next;
    const e = state.library[id];
    if (
      e.status === "none" &&
      !e.rating &&
      !e.review &&
      !e.notes &&
      !e.episodesWatched &&
      !e.progress &&
      !e.rewatches &&
      !e.seasonsCompleted
    ) {
      delete state.library[id];
    }
    saveState();
    updateBadges();
  }

  /** Base minutes from seasons/episodes/runtime (before rewatch multiplier) */
  function computeBaseMinutes(id, entry) {
    const e = entry || userEntry(id);
    const t = getTitle(id);
    const runtime =
      Number(e.runtimeMinutes) ||
      Number(t && t.runtime) ||
      (t && t.type === "movie" ? 120 : 45);

    if (e.episodesWatched > 0) {
      return Math.round(e.episodesWatched * runtime);
    }

    if (e.seasonsCompleted > 0) {
      // ~8 eps/season fallback when we don't know episode count
      const epsPerSeason = e.totalEpisodes && e.totalSeasons
        ? Math.max(1, Math.round(e.totalEpisodes / e.totalSeasons))
        : 8;
      return Math.round(e.seasonsCompleted * epsPerSeason * runtime);
    }

    if (e.status === "seen") {
      if (t && t.type === "movie") return Math.round(runtime);
      if (e.totalEpisodes) return Math.round(e.totalEpisodes * runtime);
      const seasons = e.totalSeasons || (t && t.seasons) || 1;
      return Math.round(seasons * 8 * runtime);
    }

    if (e.progress > 0 && t) {
      if (t.type === "movie") return Math.round((e.progress / 100) * runtime);
      const totalEps = e.totalEpisodes || ((t.seasons || 1) * 8);
      return Math.round((e.progress / 100) * totalEps * runtime);
    }

    if (e.status === "watching" && e.progress > 0) {
      const totalEps = e.totalEpisodes || 10;
      return Math.round((e.progress / 100) * totalEps * runtime);
    }

    return Number(e.watchedMinutesBase) || 0;
  }

  /** Total minutes including rewatches */
  function totalMinutesFor(id, entry) {
    const e = entry || userEntry(id);
    const base = computeBaseMinutes(id, e);
    const re = Math.max(0, Number(e.rewatches) || 0);
    // rewatches = extra full plays → total plays = 1 + rewatches when you've watched something
    if (base <= 0) return 0;
    return Math.round(base * (1 + re));
  }

  function formatHours(mins) {
    if (!mins || mins < 1) return "0h";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function titlesByStatus(status) {
    return allTitles().filter((t) => userEntry(t.id).status === status);
  }

  function countStatus(status) {
    return Object.values(state.library).filter((e) => e.status === status).length;
  }

  function globalHoursMinutes() {
    let mins = 0;
    for (const id of Object.keys(state.library)) {
      mins += totalMinutesFor(id);
    }
    return mins;
  }

  // ─── Chrome ───
  function bindChrome() {
    document.getElementById("main-nav")?.addEventListener("click", onNavClick);
    document.getElementById("bottom-dock")?.addEventListener("click", onNavClick);

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
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
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

    document.getElementById("platforms-all")?.addEventListener("click", () => {
      state.activePlatforms = platformsList().map((p) => p.id);
      saveState();
      renderPlatformChips();
      render();
      toast("All platforms on");
    });
    document.getElementById("platforms-mine")?.addEventListener("click", () => {
      state.activePlatforms = Object.entries(state.subscriptions)
        .filter(([, on]) => on)
        .map(([id]) => id);
      if (!state.activePlatforms.length) {
        state.activePlatforms = ["netflix", "disney", "showmax"];
      }
      saveState();
      renderPlatformChips();
      render();
      toast("Your streams only");
    });
    document.getElementById("platforms-none")?.addEventListener("click", () => {
      state.activePlatforms = [];
      saveState();
      renderPlatformChips();
      render();
      toast("Filter cleared — showing everything");
    });
  }

  function onNavClick(e) {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    currentView = btn.dataset.view;
    searchQuery = "";
    searchResults = null;
    const si = document.getElementById("global-search");
    if (si) si.value = "";
    closeDrawer();
    render();
  }

  function closeDrawer() {
    document.body.classList.remove("nav-open");
    const bd = document.getElementById("drawer-backdrop");
    if (bd) bd.hidden = true;
  }

  function renderPlatformChips() {
    const root = document.getElementById("platform-chips");
    if (!root) return;
    const active = activePlatformSet();
    root.innerHTML = platformsList()
      .map((p) => {
        const on = active.has(p.id);
        return `<button type="button" class="p-chip ${on ? "on" : ""}" data-plat-toggle="${escapeHtml(p.id)}" style="--pcolor:${p.color}">
          <span class="swatch" style="background:${p.color}"></span>${escapeHtml(p.name)}
        </button>`;
      })
      .join("");
    root.querySelectorAll("[data-plat-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.platToggle;
        const set = new Set(state.activePlatforms);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        state.activePlatforms = [...set];
        saveState();
        renderPlatformChips();
        render();
      });
    });
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
    } else el.hidden = true;
  }

  function setActiveNav() {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === currentView);
    });
    const user = document.getElementById("sidebar-user");
    if (user) user.textContent = state.userName || "Connor";
  }

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

  // ─── Search ───
  async function runLiveSearch(q) {
    const query = q.trim();
    if (!query) return;
    try {
      let liveHits = [];
      if (window.WatchLive) liveHits = await window.WatchLive.search(query, 40);
      const localHits = filterTitles(
        allTitles().filter((t) => !String(t.id).startsWith("tvmaze-")),
        { query, sort: "rating" }
      );
      const seen = new Set(liveHits.map((t) => t.title.toLowerCase()));
      let merged = [
        ...liveHits,
        ...localHits.filter((t) => !seen.has(t.title.toLowerCase())),
      ];
      // Prefer titles on selected platforms (but don't hide all if zero match)
      const onPlat = merged.filter(titleOnActivePlatforms);
      if (onPlat.length) merged = [...onPlat, ...merged.filter((t) => !onPlat.includes(t))];
      if (searchQuery === query) {
        searchResults = merged;
        searchLoading = false;
        render();
      }
    } catch {
      if (searchQuery === query) {
        searchResults = filterByActivePlatforms(
          filterTitles(allTitles(), { query, sort: "rating" })
        );
        searchLoading = false;
        toast("Live search offline — local only");
        render();
      }
    }
  }

  // ─── Filter / sort ───
  function filterTitles(list, opts = {}) {
    let out = [...list];
    const q = (opts.query ?? "").toLowerCase();
    if (q) {
      out = out.filter((t) =>
        [t.title, t.overview, ...(t.genres || []), t.type, String(t.year), t.network || ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    if (opts.type && opts.type !== "all") out = out.filter((t) => t.type === opts.type);
    if (opts.genre && opts.genre !== "all") {
      out = out.filter((t) => (t.genres || []).includes(opts.genre));
    }
    if (opts.platformsActive) out = out.filter(titleOnActivePlatforms);

    const sort = opts.sort || "title";
    out.sort((a, b) => {
      if (sort === "trending") {
        return (
          (b.trending ? 2 : 0) + (b.new ? 1 : 0) + (b.rating || 0) / 10 -
          ((a.trending ? 2 : 0) + (a.new ? 1 : 0) + (a.rating || 0) / 10)
        );
      }
      if (sort === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sort === "year") return (b.year || 0) - (a.year || 0);
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "updated") {
        return (userEntry(b.id).updatedAt || "").localeCompare(userEntry(a.id).updatedAt || "");
      }
      return 0;
    });
    return out;
  }

  function recommendations() {
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
    let pool = filterByActivePlatforms(allTitles()).filter((t) => !tracked.has(t.id));
    if (topGenres.length) pool = pool.filter((t) => (t.genres || []).some((g) => topGenres.includes(g)));
    pool.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return pool.slice(0, 12);
  }

  /** Top 10 for a category across active platforms */
  function top10ForCategory(catId) {
    let pool = filterByActivePlatforms(allTitles());
    if (catId && catId !== "all") {
      pool = pool.filter((t) => (t.genres || []).includes(catId));
    }
    // Prefer higher rated + trending; require some rating when possible
    pool = pool.filter((t) => t.rating || t.trending || t.live);
    pool.sort((a, b) => {
      const sa = (b.rating || 0) * 10 + (b.trending ? 5 : 0) + (b.weight || 0) / 20;
      const sb = (a.rating || 0) * 10 + (a.trending ? 5 : 0) + (a.weight || 0) / 20;
      return sa - sb;
    });
    // de-dupe by title
    const seen = new Set();
    const out = [];
    for (const t of pool) {
      const k = t.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= 10) break;
    }
    return out;
  }

  // ─── Render helpers ───
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
        return `<span class="plat" style="background:${p.color}">${escapeHtml(p.name)}</span>`;
      })
      .join("");
  }

  function statusBadge(status) {
    if (!status || status === "none") return "";
    const map = {
      watchlist: ["Queue", "st-watchlist"],
      watching: ["Now", "st-watching"],
      seen: ["Seen", "st-seen"],
      dropped: ["Drop", "st-dropped"],
    };
    const [label, cls] = map[status] || [status, ""];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function ticketCard(t) {
    const u = userEntry(t.id);
    const hue = t.posterHue ?? 280;
    const year = t.endYear && t.endYear !== t.year ? `${t.year}–${t.endYear}` : t.year || "—";
    const hasImg = !!t.image;
    const mins = totalMinutesFor(t.id, u);
    const re = u.rewatches || 0;

    return `
      <button type="button" class="ticket" data-title-id="${escapeHtml(t.id)}" style="--hue:${hue}">
        <div class="ticket-poster ${hasImg ? "has-img" : ""}" style="--hue:${hue}">
          ${hasImg ? `<img src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
          <span class="letter">${escapeHtml((t.title || "?").charAt(0))}</span>
          <div class="ticket-badges">
            ${t.live ? `<span class="badge live">Live</span>` : ""}
            ${t.new ? `<span class="badge new">New</span>` : ""}
            ${t.trending ? `<span class="badge hot">Hot</span>` : ""}
            ${statusBadge(u.status)}
            ${re > 0 ? `<span class="badge rewatch">×${re + 1}</span>` : ""}
          </div>
        </div>
        <div class="ticket-stub">
          <h4>${escapeHtml(t.title)}</h4>
          <div class="ticket-meta">
            <span>${escapeHtml(String(year))}</span>
            <span>${t.type === "movie" ? "Film" : "Series"}</span>
            ${t.rating ? `<span>${Number(t.rating).toFixed(1)}★</span>` : ""}
            ${u.episodesWatched ? `<span>${u.episodesWatched} ep</span>` : ""}
            ${mins ? `<span>${formatHours(mins)}</span>` : ""}
          </div>
          <div class="platform-row">${platformPills(t.platforms)}</div>
          ${
            u.status === "watching" && u.progress > 0
              ? `<div class="progress"><i style="width:${u.progress}%"></i></div>`
              : ""
          }
        </div>
      </button>
    `;
  }

  function ticketGrid(list, emptyMsg) {
    if (!list.length) {
      return `<div class="empty"><div style="font-size:2rem">🎞</div><h3>Empty reel</h3><p>${escapeHtml(
        emptyMsg || "Nothing matches your signal filters."
      )}</p></div>`;
    }
    return `<div class="grid-tickets">${list.map(ticketCard).join("")}</div>`;
  }

  function ticketRail(list) {
    if (!list.length) return `<p class="hint">Nothing here yet.</p>`;
    return `<div class="rail-scroll">${list.map(ticketCard).join("")}</div>`;
  }

  function creditLine() {
    return `<p class="credit">Live TV by <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a> · Neon Deck for Connor</p>`;
  }

  // ─── Views ───
  function render() {
    setActiveNav();
    updateBadges();
    updateLivePill();
    const main = document.getElementById("main");
    if (!main) return;

    if (searchQuery && currentView !== "settings") {
      main.innerHTML = renderSearchResults();
      bindStage(main);
      return;
    }

    switch (currentView) {
      case "home":
        main.innerHTML = renderHome();
        break;
      case "top10":
        main.innerHTML = renderTop10();
        break;
      case "discover":
        main.innerHTML = renderDiscover();
        break;
      case "new":
        main.innerHTML = renderNewHot();
        break;
      case "watchlist":
        main.innerHTML = renderStatusPage("watchlist", "Queue", "Titles you want to hit next");
        break;
      case "watching":
        main.innerHTML = renderStatusPage("watching", "In progress", "Log seasons & episodes for accurate hours");
        break;
      case "seen":
        main.innerHTML = renderStatusPage("seen", "Seen", "Finished — rewatches still add hours");
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
    bindStage(main);
  }

  function bindStage(root) {
    root.querySelectorAll("[data-title-id]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-stop]")) return;
        openDetail(el.dataset.titleId);
      });
    });
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
        discoverFilters[el.dataset.filter] = el.dataset.value;
        render();
      });
    });
    root.querySelectorAll("[data-filter-select]").forEach((el) => {
      el.addEventListener("change", () => {
        discoverFilters[el.dataset.filterSelect] = el.value;
        render();
      });
    });
    root.querySelectorAll("[data-top-cat]").forEach((el) => {
      el.addEventListener("click", () => {
        top10Category = el.dataset.topCat;
        render();
      });
    });
    root.querySelectorAll("[data-sub-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.dataset.subToggle;
        state.subscriptions[id] = !state.subscriptions[id];
        saveState();
        render();
      });
    });
    root.querySelector("#export-data")?.addEventListener("click", exportData);
    root.querySelector("#import-data")?.addEventListener("change", importData);
    root.querySelector("#reset-data")?.addEventListener("click", () => {
      if (!confirm("Clear all library data?")) return;
      state.library = {};
      state.customTitles = [];
      saveState();
      render();
      toast("Library wiped");
    });
    root.querySelector("#settings-name")?.addEventListener("change", (e) => {
      state.userName = e.target.value.trim() || "Connor";
      saveState();
      setActiveNav();
      toast("Name saved");
    });
    root.querySelector("#refresh-live")?.addEventListener("click", async () => {
      if (!window.WatchLive) return;
      toast("Syncing live feeds…");
      liveLoading = true;
      updateLivePill();
      try {
        await window.WatchLive.refreshFeeds();
        liveReady = true;
        liveLoading = false;
        toast("Feeds refreshed");
      } catch {
        liveLoading = false;
        toast("Sync failed");
      }
      updateLivePill();
      render();
    });
  }

  function renderHome() {
    const name = state.userName || "Connor";
    const watching = filterByActivePlatforms(titlesByStatus("watching")).slice(0, 12);
    const watchlist = filterByActivePlatforms(titlesByStatus("watchlist")).slice(0, 12);
    const popular = filterByActivePlatforms(livePopular()).slice(0, 14);
    const schedule = filterByActivePlatforms(liveSchedule()).slice(0, 14);
    const top = top10ForCategory("all").slice(0, 10);
    const recs = recommendations();
    const hours = globalHoursMinutes();
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Night";

    return `
      <div class="hero-bento">
        <div class="hero-main">
          <div class="tag">${greet.toUpperCase()} SIGNAL · ${escapeHtml(name)}</div>
          <h2>What hits the screen next?</h2>
          <p>Multi-platform deck with live airings, season logs, rewatch hours, and Top 10 boards — junk filtered by your streams.</p>
          <div class="hero-actions">
            <button type="button" class="btn btn-primary" data-goto="top10">Open Top 10</button>
            <button type="button" class="btn btn-secondary" data-goto="new">Airing now</button>
            <button type="button" class="btn btn-ghost" data-goto="stats" style="color:#fff">Hours: ${formatHours(hours)}</button>
          </div>
        </div>
        <div class="hero-side">
          <div class="stat-tile acid">
            <div class="lbl">Total watched</div>
            <div class="val">${formatHours(hours)}</div>
            <div class="sub">incl. rewatches</div>
          </div>
          <div class="stat-tile pink">
            <div class="lbl">In queue / now</div>
            <div class="val">${countStatus("watchlist")}<span style="color:var(--muted);font-size:1rem"> / </span>${countStatus("watching")}</div>
            <div class="sub">queue · watching</div>
          </div>
        </div>
      </div>

      <div class="led-row">
        <div class="led"><div class="n">${countStatus("seen")}</div><div class="l">Seen</div></div>
        <div class="led"><div class="n">${Object.values(state.library).reduce((s, e) => s + (e.rewatches || 0), 0)}</div><div class="l">Rewatches</div></div>
        <div class="led"><div class="n">${Object.values(state.library).reduce((s, e) => s + (e.episodesWatched || 0), 0)}</div><div class="l">Episodes</div></div>
        <div class="led"><div class="n">${state.activePlatforms.length}</div><div class="l">Signals on</div></div>
      </div>

      ${liveLoading ? `<div class="loading"><div class="spinner"></div>Syncing neon grid…</div>` : ""}

      ${
        top.length
          ? `<section class="section">
              <div class="section-head">
                <h3>Top 10 on your platforms</h3>
                <button type="button" class="linkish" data-goto="top10">Full boards →</button>
              </div>
              ${renderTop10List(top, "Overall")}
            </section>`
          : ""
      }

      ${
        watching.length
          ? `<section class="section"><div class="section-head"><h3>Continue</h3><button type="button" class="linkish" data-goto="watching">All</button></div>${ticketRail(watching)}</section>`
          : ""
      }
      ${
        watchlist.length
          ? `<section class="section"><div class="section-head"><h3>Queue</h3><button type="button" class="linkish" data-goto="watchlist">All</button></div>${ticketRail(watchlist)}</section>`
          : ""
      }
      <section class="section">
        <div class="section-head"><h3>${popular.length ? "Popular streams" : "Trending"}</h3><button type="button" class="linkish" data-goto="discover">Browse</button></div>
        ${ticketRail(popular.length ? popular : filterByActivePlatforms(filterTitles(allTitles(), { sort: "trending" })).slice(0, 12))}
      </section>
      ${
        schedule.length
          ? `<section class="section"><div class="section-head"><h3>Airing window</h3><button type="button" class="linkish" data-goto="new">Schedule</button></div>${ticketRail(schedule)}</section>`
          : ""
      }
      <section class="section">
        <div class="section-head"><h3>For you</h3></div>
        ${recs.length ? ticketRail(recs) : `<p class="hint">Rate a few shows — the deck learns your genres.</p>`}
      </section>
      ${creditLine()}
    `;
  }

  function renderTop10List(list, label) {
    if (!list.length) {
      return `<div class="empty"><h3>No Top 10 yet</h3><p>Turn on more platforms or wait for live sync.</p></div>`;
    }
    return `
      <div class="top10-board">
        <header>
          <h3>▲ ${escapeHtml(label)}</h3>
          <span>${list.length} ranked · your signals</span>
        </header>
        <ol class="top10-list">
          ${list
            .map((t, i) => {
              const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
              const hue = t.posterHue ?? 280;
              return `
                <li>
                  <button type="button" class="top10-row" data-title-id="${escapeHtml(t.id)}">
                    <span class="rank ${rankClass}">${String(i + 1).padStart(2, "0")}</span>
                    <div class="top10-thumb" style="--hue:${hue}">
                      ${t.image ? `<img src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                    </div>
                    <div class="top10-body">
                      <h4>${escapeHtml(t.title)}</h4>
                      <p>${escapeHtml((t.genres || []).slice(0, 2).join(" · ") || t.type)} · ${t.year || "—"}
                      ${t.network ? ` · ${escapeHtml(t.network)}` : ""}</p>
                      <div class="platform-row" style="margin-top:4px">${platformPills(t.platforms)}</div>
                    </div>
                    <span class="top10-score">${t.rating ? Number(t.rating).toFixed(1) : "—"}★</span>
                  </button>
                </li>`;
            })
            .join("")}
        </ol>
      </div>
    `;
  }

  function renderTop10() {
    const cats = TOP10_CATEGORIES;
    const list = top10ForCategory(top10Category);
    const catLabel = cats.find((c) => c.id === top10Category)?.label || "Overall";

    // Also build a few multi-platform category boards
    const multiBoards = ["Action", "Comedy", "Sci-Fi", "Drama"]
      .filter((c) => c !== top10Category)
      .map((c) => ({ cat: c, list: top10ForCategory(c).slice(0, 10) }))
      .filter((b) => b.list.length >= 3);

    return `
      <div class="page-head">
        <div>
          <h2>Top <span class="slash">10</span></h2>
          <p>Across your selected platforms · toggle signals above to change the pool</p>
        </div>
      </div>
      <div class="cat-chips">
        ${cats
          .map(
            (c) =>
              `<button type="button" class="cat-chip ${top10Category === c.id ? "on" : ""}" data-top-cat="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>
      ${renderTop10List(list, catLabel)}
      ${multiBoards
        .map(
          (b) => `
        <section class="section">
          <div class="section-head"><h3>${escapeHtml(b.cat)} Top 10</h3></div>
          ${renderTop10List(b.list, b.cat)}
        </section>`
        )
        .join("")}
      ${creditLine()}
    `;
  }

  function renderDiscover() {
    let pool = allTitles();
    if (discoverFilters.source === "live") pool = pool.filter((t) => t.live);
    if (discoverFilters.source === "local") pool = pool.filter((t) => !t.live);
    pool = filterByActivePlatforms(pool);
    const list = filterTitles(pool, {
      type: discoverFilters.type,
      genre: discoverFilters.genre,
      sort: discoverFilters.sort,
    });
    const genres = catalog.genres || [];

    return `
      <div class="page-head">
        <div>
          <h2>Browse</h2>
          <p>${list.length} titles on active signals · search for full live DB</p>
        </div>
      </div>
      <div class="filters">
        <button type="button" class="chip ${discoverFilters.source === "all" ? "on" : ""}" data-filter="source" data-value="all">All</button>
        <button type="button" class="chip ${discoverFilters.source === "live" ? "on" : ""}" data-filter="source" data-value="live">Live</button>
        <button type="button" class="chip ${discoverFilters.source === "local" ? "on" : ""}" data-filter="source" data-value="local">Local</button>
        <button type="button" class="chip ${discoverFilters.type === "all" ? "on" : ""}" data-filter="type" data-value="all">Any</button>
        <button type="button" class="chip ${discoverFilters.type === "series" ? "on" : ""}" data-filter="type" data-value="series">Series</button>
        <button type="button" class="chip ${discoverFilters.type === "movie" ? "on" : ""}" data-filter="type" data-value="movie">Films</button>
        <select class="filter-select" data-filter-select="genre">
          <option value="all">All genres</option>
          ${genres.map((g) => `<option value="${escapeHtml(g)}" ${discoverFilters.genre === g ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}
        </select>
        <select class="filter-select" data-filter-select="sort">
          <option value="trending" ${discoverFilters.sort === "trending" ? "selected" : ""}>Hot</option>
          <option value="rating" ${discoverFilters.sort === "rating" ? "selected" : ""}>Rating</option>
          <option value="year" ${discoverFilters.sort === "year" ? "selected" : ""}>Year</option>
          <option value="title" ${discoverFilters.sort === "title" ? "selected" : ""}>A–Z</option>
        </select>
      </div>
      ${ticketGrid(list)}
      ${creditLine()}
    `;
  }

  function renderNewHot() {
    const schedule = filterByActivePlatforms(liveSchedule());
    const popular = filterByActivePlatforms(livePopular());
    return `
      <div class="page-head">
        <div>
          <h2>Airing</h2>
          <p>Live schedule filtered to your platforms</p>
        </div>
        <button type="button" class="btn btn-secondary" id="refresh-live">↻ Sync</button>
      </div>
      ${liveLoading ? `<div class="loading"><div class="spinner"></div>Loading schedule…</div>` : ""}
      <section class="section">
        <div class="section-head"><h3>Today / tomorrow</h3></div>
        ${ticketGrid(schedule, "No airings on your selected platforms. Try enabling more signals.")}
      </section>
      ${
        popular.length
          ? `<section class="section"><div class="section-head"><h3>Popular</h3></div>${ticketGrid(popular)}</section>`
          : ""
      }
      ${creditLine()}
    `;
  }

  function renderStatusPage(status, title, blurb) {
    const list = filterTitles(titlesByStatus(status), { sort: "updated" });
    return `
      <div class="page-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(blurb)} · ${list.length} titles</p>
        </div>
        <button type="button" class="btn btn-secondary" data-goto="discover">Find more</button>
      </div>
      ${ticketGrid(list, "Empty — open a title and set status.")}
    `;
  }

  function renderReviews() {
    const items = Object.entries(state.library)
      .filter(([, e]) => e.rating || (e.review && e.review.trim()))
      .map(([id, e]) => ({ id, e, t: getTitle(id) }))
      .filter((x) => x.t)
      .sort((a, b) => (b.e.updatedAt || "").localeCompare(a.e.updatedAt || ""));

    return `
      <div class="page-head"><div><h2>Takes</h2><p>Your ratings & reviews · ${items.length}</p></div></div>
      ${
        !items.length
          ? `<div class="empty"><h3>No takes yet</h3><p>Open a title and drop stars.</p></div>`
          : `<div class="list">${items
              .map(({ id, e, t }) => {
                const hue = t.posterHue ?? 280;
                const mins = totalMinutesFor(id, e);
                return `
                <button type="button" class="list-row" data-title-id="${escapeHtml(id)}">
                  <div class="list-thumb" style="--hue:${hue}">
                    ${t.image ? `<img src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                  </div>
                  <div>
                    <strong>${escapeHtml(t.title)}</strong>
                    <div class="ticket-meta" style="margin-top:4px">
                      ${e.rating ? `<span style="color:var(--amber)">${starString(e.rating)}</span>` : ""}
                      ${e.rewatches ? `<span>↻ ${e.rewatches}</span>` : ""}
                      ${mins ? `<span>${formatHours(mins)}</span>` : ""}
                    </div>
                    ${e.review ? `<p class="hint" style="margin-top:6px;font-family:var(--font)">${escapeHtml(e.review)}</p>` : ""}
                  </div>
                  <span class="hint">${statusBadge(e.status)}</span>
                </button>`;
              })
              .join("")}</div>`
      }
    `;
  }

  function renderStats() {
    const lib = Object.entries(state.library);
    const totalMins = globalHoursMinutes();
    const baseMins = lib.reduce((s, [id, e]) => s + computeBaseMinutes(id, e), 0);
    const rewatchMins = totalMins - baseMins;
    const eps = lib.reduce((s, [, e]) => s + (e.episodesWatched || 0), 0);
    const seasons = lib.reduce((s, [, e]) => s + (e.seasonsCompleted || 0), 0);
    const rewatches = lib.reduce((s, [, e]) => s + (e.rewatches || 0), 0);
    const ratings = lib.map(([, e]) => e.rating).filter((r) => r > 0);
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Top time sinks
    const byTime = lib
      .map(([id, e]) => ({ id, e, t: getTitle(id), mins: totalMinutesFor(id, e) }))
      .filter((x) => x.t && x.mins > 0)
      .sort((a, b) => b.mins - a.mins)
      .slice(0, 8);

    const genreMins = {};
    for (const [id, e] of lib) {
      const t = getTitle(id);
      if (!t) continue;
      const m = totalMinutesFor(id, e);
      for (const g of t.genres || ["Other"]) genreMins[g] = (genreMins[g] || 0) + m;
    }
    const genresSorted = Object.entries(genreMins).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxG = genresSorted[0]?.[1] || 1;

    const platMins = {};
    for (const [id, e] of lib) {
      const t = getTitle(id);
      if (!t) continue;
      const m = totalMinutesFor(id, e);
      for (const p of t.platforms || ["other"]) platMins[p] = (platMins[p] || 0) + m;
    }
    const platsSorted = Object.entries(platMins).sort((a, b) => b[1] - a[1]);
    const maxP = platsSorted[0]?.[1] || 1;

    return `
      <div class="page-head">
        <div>
          <h2>Hours</h2>
          <p>Built from seasons, episodes, runtimes & rewatches</p>
        </div>
      </div>

      <div class="hero-bento" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-tile acid">
          <div class="lbl">Lifetime hours</div>
          <div class="val">${formatHours(totalMins)}</div>
          <div class="sub">${Math.round(totalMins)} minutes</div>
        </div>
        <div class="stat-tile cyan">
          <div class="lbl">First watch</div>
          <div class="val">${formatHours(baseMins)}</div>
          <div class="sub">base runtime</div>
        </div>
        <div class="stat-tile pink">
          <div class="lbl">Rewatch hours</div>
          <div class="val">${formatHours(rewatchMins)}</div>
          <div class="sub">${rewatches} rewatch marks</div>
        </div>
      </div>

      <div class="led-row">
        <div class="led"><div class="n">${eps}</div><div class="l">Episodes logged</div></div>
        <div class="led"><div class="n">${seasons}</div><div class="l">Seasons done</div></div>
        <div class="led"><div class="n">${countStatus("seen")}</div><div class="l">Titles seen</div></div>
        <div class="led"><div class="n">${ratings.length ? avg.toFixed(1) : "—"}</div><div class="l">Avg rating</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <h3>Time by genre</h3>
          ${
            genresSorted.length
              ? genresSorted
                  .map(
                    ([g, n]) => `
                <div class="bar-row">
                  <span class="bar-label">${escapeHtml(g)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${(n / maxG) * 100}%"></div></div>
                  <span class="bar-n">${formatHours(n)}</span>
                </div>`
                  )
                  .join("")
              : `<p class="hint">Log episodes to fill this chart.</p>`
          }
        </div>
        <div class="panel">
          <h3>Time by platform</h3>
          ${
            platsSorted.length
              ? platsSorted
                  .map(([id, n]) => {
                    const p = platformById(id);
                    return `
                  <div class="bar-row">
                    <span class="bar-label">${escapeHtml(p.name)}</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${(n / maxP) * 100}%;background:${p.color}"></div></div>
                    <span class="bar-n">${formatHours(n)}</span>
                  </div>`;
                  })
                  .join("")
              : `<p class="hint">No platform time yet.</p>`
          }
        </div>
      </div>

      ${
        byTime.length
          ? `<section class="section" style="margin-top:18px">
              <div class="section-head"><h3>Biggest time sinks</h3></div>
              <div class="list">
                ${byTime
                  .map(({ id, e, t, mins }) => {
                    const hue = t.posterHue ?? 280;
                    return `
                    <button type="button" class="list-row" data-title-id="${escapeHtml(id)}">
                      <div class="list-thumb" style="--hue:${hue}">
                        ${t.image ? `<img src="${escapeHtml(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                      </div>
                      <div>
                        <strong>${escapeHtml(t.title)}</strong>
                        <div class="ticket-meta" style="margin-top:4px">
                          ${e.episodesWatched ? `<span>${e.episodesWatched} eps</span>` : ""}
                          ${e.seasonsCompleted ? `<span>${e.seasonsCompleted} seasons</span>` : ""}
                          ${e.rewatches ? `<span>↻×${e.rewatches}</span>` : ""}
                          <span>~${e.runtimeMinutes || t.runtime || "?"}m each</span>
                        </div>
                      </div>
                      <strong style="color:var(--acid);font-family:var(--mono)">${formatHours(mins)}</strong>
                    </button>`;
                  })
                  .join("")}
              </div>
            </section>`
          : ""
      }
    `;
  }

  function renderPlatforms() {
    const titles = allTitles();
    return `
      <div class="page-head">
        <div>
          <h2>Streams</h2>
          <p>Subscriptions (for “Mine”) · use the top multi-select to filter junk</p>
        </div>
      </div>
      <div class="grid-tickets" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${platformsList()
          .map((p) => {
            const count = titles.filter((t) => (t.platforms || []).includes(p.id)).length;
            const on = !!state.subscriptions[p.id];
            const active = activePlatformSet().has(p.id);
            return `
              <div class="panel" style="--pcolor:${p.color}">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                  <span style="font-size:1.4rem">${p.emoji || "📺"}</span>
                  <div>
                    <strong>${escapeHtml(p.name)}</strong>
                    <div class="hint">${count} in memory · filter ${active ? "ON" : "off"}</div>
                  </div>
                </div>
                <button type="button" class="btn ${on ? "btn-primary" : "btn-secondary"} btn-sm" data-sub-toggle="${escapeHtml(p.id)}" data-stop>
                  ${on ? "Subscribed" : "Not subscribed"}
                </button>
              </div>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderSettings() {
    return `
      <div class="page-head"><div><h2>Setup</h2><p>Profile, live sync, backups</p></div></div>
      <div class="panel">
        <h3>Profile</h3>
        <div class="field">
          <label for="settings-name">Display name</label>
          <input id="settings-name" type="text" value="${escapeHtml(state.userName || "")}" maxlength="40" />
        </div>
      </div>
      <div class="panel">
        <h3>Live data</h3>
        <p class="hint" style="margin-bottom:10px">Popular: ${livePopular().length} · Schedule: ${liveSchedule().length} · ${isLiveOnline() ? "Online" : "Offline"}</p>
        <button type="button" class="btn btn-secondary" id="refresh-live">↻ Refresh live feeds</button>
      </div>
      <div class="panel">
        <h3>Backup</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-secondary" id="export-data">Export JSON</button>
          <label class="btn btn-secondary" style="cursor:pointer">Import<input type="file" id="import-data" accept="application/json,.json" hidden /></label>
          <button type="button" class="btn btn-danger" id="reset-data">Clear library</button>
        </div>
      </div>
      <div class="panel">
        <h3>About</h3>
        <p class="hint">Watch Hub Neon Deck · seasons, hours, rewatches, multi-platform Top 10<br/>Local catalog v${escapeHtml(String(catalog.version || "—"))} · ${allTitles().length} titles loaded</p>
      </div>
    `;
  }

  function renderSearchResults() {
    if (searchLoading && !searchResults) {
      return `<div class="page-head"><div><h2>Search</h2><p>Scanning live grid for “${escapeHtml(searchQuery)}”…</p></div></div>
        <div class="loading"><div class="spinner"></div>TVmaze…</div>`;
    }
    const list = searchResults || filterTitles(allTitles(), { query: searchQuery, sort: "rating" });
    return `
      <div class="page-head">
        <div>
          <h2>Search</h2>
          <p>${list.length} hits for “${escapeHtml(searchQuery)}” · platforms ranked first</p>
        </div>
      </div>
      ${ticketGrid(list, "No hits — try another query.")}
      ${creditLine()}
    `;
  }

  // ─── Detail modal (seasons / episodes / rewatches) ───
  async function openDetail(id) {
    let t = getTitle(id);
    if (!t) {
      toast("Title not found");
      return;
    }
    detailId = id;

    if (t.tvmazeId && window.WatchLive) {
      try {
        const fresh = await window.WatchLive.getShow(t.tvmazeId);
        if (fresh) t = fresh;
      } catch {
        /* keep */
      }
    }

    let episodes = episodeCache[id] || null;
    if (t.tvmazeId && window.WatchLive && !episodes) {
      try {
        episodes = await window.WatchLive.fetchEpisodes(t.tvmazeId);
        episodeCache[id] = episodes;
      } catch {
        episodes = [];
      }
    }

    const u = userEntry(id);
    // hydrate totals from live episodes
    let totalEpisodes = u.totalEpisodes;
    let totalSeasons = u.totalSeasons;
    let runtimeMinutes = u.runtimeMinutes || t.runtime || null;
    let seasonStats = [];

    if (episodes && episodes.length) {
      totalEpisodes = episodes.length;
      const bySeason = {};
      let runtimeSum = 0;
      let runtimeN = 0;
      for (const ep of episodes) {
        const s = ep.season ?? 0;
        if (!bySeason[s]) bySeason[s] = { season: s, count: 0, minutes: 0 };
        bySeason[s].count++;
        const rt = ep.runtime || t.runtime || 45;
        bySeason[s].minutes += rt;
        if (ep.runtime) {
          runtimeSum += ep.runtime;
          runtimeN++;
        }
      }
      seasonStats = Object.values(bySeason).sort((a, b) => a.season - b.season);
      totalSeasons = seasonStats.filter((s) => s.season > 0).length || seasonStats.length;
      if (runtimeN) runtimeMinutes = Math.round(runtimeSum / runtimeN);
    }

    const hue = t.posterHue ?? 280;
    const year =
      t.endYear && t.endYear !== t.year ? `${t.year}–${t.endYear}` : t.year || "—";
    const hasImg = !!t.image;
    const previewMins = totalMinutesFor(id, {
      ...u,
      runtimeMinutes,
      totalEpisodes,
      totalSeasons,
    });

    const root = document.getElementById("modal-root");
    const titleEl = document.getElementById("modal-title");
    const body = document.getElementById("modal-body");
    const footer = document.getElementById("modal-footer");
    if (!root || !body) return;

    titleEl.textContent = t.title;
    body.innerHTML = `
      <div class="detail-hero">
        <div class="detail-poster" style="--hue:${hue}">
          ${hasImg ? `<img src="${escapeHtml(t.image)}" alt="" referrerpolicy="no-referrer" />` : escapeHtml(t.title.charAt(0))}
        </div>
        <div>
          <div class="ticket-meta">
            <span>${escapeHtml(String(year))}</span>
            <span>${t.type === "movie" ? "Film" : "Series"}</span>
            ${t.rating ? `<span>${Number(t.rating).toFixed(1)}★</span>` : ""}
            ${runtimeMinutes ? `<span>~${runtimeMinutes}m</span>` : ""}
            ${t.live ? `<span style="color:var(--ok)">LIVE</span>` : ""}
          </div>
          <div class="platform-row" style="margin-top:8px">
            ${platformPills(t.platforms)}
            ${t.network ? `<span class="plat" style="background:#444">${escapeHtml(t.network)}</span>` : ""}
          </div>
          <p class="detail-overview">${escapeHtml(t.overview || "No overview.")}</p>
          ${
            totalEpisodes
              ? `<p class="hint">${totalEpisodes} episodes · ${totalSeasons || "?"} seasons${
                  seasonStats.length
                    ? " · " +
                      seasonStats
                        .filter((s) => s.season > 0)
                        .map((s) => `S${s.season}:${s.count}ep/${formatHours(s.minutes)}`)
                        .join(" · ")
                    : ""
                }</p>`
              : ""
          }
          ${t.tvmazeUrl ? `<p class="hint"><a href="${escapeHtml(t.tvmazeUrl)}" target="_blank" rel="noopener">TVmaze ↗</a></p>` : ""}
        </div>
      </div>

      <h3 style="margin:0 0 6px;font-size:0.9rem">Status</h3>
      <div class="status-pills">
        ${STATUSES.map(
          (s) =>
            `<button type="button" class="status-pill ${u.status === s.id ? "on" : ""}" data-set-status="${s.id}" data-status="${s.id}">${s.emoji} ${escapeHtml(s.label)}</button>`
        ).join("")}
      </div>

      <div class="panel" style="margin-top:8px">
        <h3>Seasons · episodes · time</h3>
        <div class="field-row three">
          <div class="field">
            <label for="eps-watched">Episodes watched</label>
            <input id="eps-watched" type="number" min="0" max="9999" value="${u.episodesWatched || 0}" />
          </div>
          <div class="field">
            <label for="seasons-done">Seasons completed</label>
            <input id="seasons-done" type="number" min="0" max="100" value="${u.seasonsCompleted || 0}" />
          </div>
          <div class="field">
            <label for="runtime-min">Mins / ep (or film)</label>
            <input id="runtime-min" type="number" min="1" max="400" value="${runtimeMinutes || 45}" />
          </div>
        </div>
        <div class="field">
          <label for="progress-range">Progress ${u.progress || 0}%</label>
          <input type="range" id="progress-range" min="0" max="100" step="5" value="${u.progress || 0}" />
        </div>
        ${
          seasonStats.length
            ? `<div class="season-grid" id="season-quick">
                ${seasonStats
                  .filter((s) => s.season > 0)
                  .map(
                    (s) =>
                      `<button type="button" class="season-chip" data-log-season="${s.season}" data-season-eps="${s.count}" data-season-mins="${s.minutes}" title="${s.count} eps · ${formatHours(s.minutes)}">S${s.season} · ${s.count}ep</button>`
                  )
                  .join("")}
              </div>
              <p class="hint">Tap a season to add those episodes to your watched count.</p>`
            : ""
        }
        ${
          totalEpisodes
            ? `<button type="button" class="btn btn-secondary btn-sm" id="log-all-eps" style="margin-bottom:8px">Log all ${totalEpisodes} episodes as watched</button>`
            : ""
        }

        <h3 style="margin:12px 0 6px;font-size:0.9rem">Rewatches</h3>
        <div class="stepper">
          <button type="button" id="rewatch-dec" aria-label="Fewer rewatches">−</button>
          <input id="rewatch-count" type="number" min="0" max="99" value="${u.rewatches || 0}" />
          <button type="button" id="rewatch-inc" aria-label="More rewatches">+</button>
          <span class="hint">extra full plays after the first</span>
        </div>

        <div class="hours-preview" id="hours-preview">
          Estimated for stats: <strong>${formatHours(previewMins)}</strong>
          <span class="hint" style="display:block;margin-top:4px">eps × runtime × (1 + rewatches)</span>
        </div>
      </div>

      <h3 style="margin:12px 0 4px;font-size:0.9rem">Your rating</h3>
      <div class="star-picker" id="star-picker">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" class="star-btn ${u.rating >= n ? "on" : ""}" data-rate="${n}">⭐</button>`
          )
          .join("")}
      </div>
      <div class="field">
        <label for="review-text">Review</label>
        <textarea id="review-text" rows="3" placeholder="Your take…">${escapeHtml(u.review || "")}</textarea>
      </div>
      <div class="field">
        <label for="notes-text">Notes</label>
        <textarea id="notes-text" rows="2" placeholder="Where you left off…">${escapeHtml(u.notes || "")}</textarea>
      </div>
    `;

    footer.innerHTML = `
      ${t.custom ? `<button type="button" class="btn btn-danger" id="delete-custom" style="margin-right:auto">Delete</button>` : `<span style="margin-right:auto"></span>`}
      <button type="button" class="btn btn-secondary" data-close-modal>Close</button>
      <button type="button" class="btn btn-primary" id="save-detail">Save log</button>
    `;
    root.hidden = false;

    const meta = {
      totalEpisodes,
      totalSeasons,
      runtimeMinutes,
    };

    function readFormHours() {
      const episodesWatched = Number(body.querySelector("#eps-watched")?.value || 0);
      const seasonsCompleted = Number(body.querySelector("#seasons-done")?.value || 0);
      const runtime = Number(body.querySelector("#runtime-min")?.value || meta.runtimeMinutes || 45);
      const rewatches = Number(body.querySelector("#rewatch-count")?.value || 0);
      const progress = Number(body.querySelector("#progress-range")?.value || 0);
      const draft = {
        ...u,
        episodesWatched,
        seasonsCompleted,
        runtimeMinutes: runtime,
        rewatches,
        progress,
        totalEpisodes: meta.totalEpisodes,
        totalSeasons: meta.totalSeasons,
      };
      const mins = totalMinutesFor(id, draft);
      const prev = body.querySelector("#hours-preview");
      if (prev) {
        prev.innerHTML = `Estimated for stats: <strong>${formatHours(mins)}</strong>
          <span class="hint" style="display:block;margin-top:4px">${episodesWatched || 0} eps · ${runtime}m · ↻${rewatches} → ${Math.round(mins)} min</span>`;
      }
      const lab = body.querySelector("label[for='progress-range']");
      if (lab) lab.textContent = `Progress ${progress}%`;
      return draft;
    }

    ["#eps-watched", "#seasons-done", "#runtime-min", "#rewatch-count", "#progress-range"].forEach(
      (sel) => {
        body.querySelector(sel)?.addEventListener("input", readFormHours);
      }
    );

    body.querySelector("#rewatch-dec")?.addEventListener("click", () => {
      const inp = body.querySelector("#rewatch-count");
      inp.value = Math.max(0, Number(inp.value || 0) - 1);
      readFormHours();
    });
    body.querySelector("#rewatch-inc")?.addEventListener("click", () => {
      const inp = body.querySelector("#rewatch-count");
      inp.value = Math.min(99, Number(inp.value || 0) + 1);
      readFormHours();
    });

    body.querySelectorAll("[data-log-season]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const add = Number(btn.dataset.seasonEps || 0);
        const inp = body.querySelector("#eps-watched");
        inp.value = Number(inp.value || 0) + add;
        const sDone = body.querySelector("#seasons-done");
        sDone.value = Number(sDone.value || 0) + 1;
        btn.classList.add("on");
        readFormHours();
        toast(`Logged S${btn.dataset.logSeason}`);
      });
    });

    body.querySelector("#log-all-eps")?.addEventListener("click", () => {
      const inp = body.querySelector("#eps-watched");
      inp.value = meta.totalEpisodes || 0;
      const sDone = body.querySelector("#seasons-done");
      sDone.value = meta.totalSeasons || 0;
      body.querySelector("#progress-range").value = 100;
      readFormHours();
      toast("All episodes loaded");
    });

    body.querySelectorAll("[data-set-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        body.querySelectorAll("[data-set-status]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        const status = btn.dataset.setStatus;
        if (status === "seen" && meta.totalEpisodes) {
          body.querySelector("#eps-watched").value = meta.totalEpisodes;
          body.querySelector("#seasons-done").value = meta.totalSeasons || 0;
          body.querySelector("#progress-range").value = 100;
        }
        readFormHours();
      });
    });

    body.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rating = Number(btn.dataset.rate);
        body.querySelectorAll("[data-rate]").forEach((b) => {
          b.classList.toggle("on", Number(b.dataset.rate) <= rating);
        });
        body.dataset.pendingRating = String(rating);
      });
    });

    footer.querySelector("#save-detail")?.addEventListener("click", () => {
      const draft = readFormHours();
      const statusBtn = body.querySelector(".status-pill.on");
      const status = statusBtn?.dataset.setStatus || u.status || "watchlist";
      const rating = body.dataset.pendingRating
        ? Number(body.dataset.pendingRating)
        : u.rating || 0;
      const review = body.querySelector("#review-text")?.value.trim() || "";
      const notes = body.querySelector("#notes-text")?.value.trim() || "";

      setUserEntry(id, {
        status,
        rating,
        review,
        notes,
        episodesWatched: draft.episodesWatched,
        seasonsCompleted: draft.seasonsCompleted,
        runtimeMinutes: draft.runtimeMinutes,
        rewatches: draft.rewatches,
        progress: draft.progress,
        totalEpisodes: meta.totalEpisodes,
        totalSeasons: meta.totalSeasons,
      });
      closeModal();
      render();
      toast(`Saved · ${formatHours(totalMinutesFor(id))}`);
    });

    footer.querySelector("#delete-custom")?.addEventListener("click", () => {
      if (!confirm(`Delete “${t.title}”?`)) return;
      state.customTitles = state.customTitles.filter((x) => x.id !== id);
      delete state.library[id];
      saveState();
      closeModal();
      render();
      toast("Deleted");
    });

    footer.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModal));
  }

  function closeModal() {
    const root = document.getElementById("modal-root");
    if (root) root.hidden = true;
    detailId = null;
  }

  // ─── Add custom ───
  function openAddModal() {
    const root = document.getElementById("modal-root");
    const titleEl = document.getElementById("modal-title");
    const body = document.getElementById("modal-body");
    const footer = document.getElementById("modal-footer");
    if (!root || !body) return;

    titleEl.textContent = "Log a title";
    body.innerHTML = `
      <div class="field"><label for="add-title">Title *</label><input id="add-title" type="text" placeholder="Show or film name" /></div>
      <div class="field-row">
        <div class="field"><label for="add-type">Type</label>
          <select id="add-type"><option value="series">Series</option><option value="movie">Film</option></select>
        </div>
        <div class="field"><label for="add-year">Year</label>
          <input id="add-year" type="number" value="${new Date().getFullYear()}" />
        </div>
      </div>
      <div class="field"><label for="add-platforms">Platforms (⌘/Ctrl multi)</label>
        <select id="add-platforms" multiple size="5">
          ${platformsList().map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field-row three">
        <div class="field"><label for="add-runtime">Runtime min</label><input id="add-runtime" type="number" value="45" /></div>
        <div class="field"><label for="add-eps">Episodes</label><input id="add-eps" type="number" value="0" /></div>
        <div class="field"><label for="add-status">Status</label>
          <select id="add-status">
            <option value="watchlist">Queue</option>
            <option value="watching">Watching</option>
            <option value="seen">Seen</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="add-overview">Overview</label><textarea id="add-overview" rows="2"></textarea></div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
      <button type="button" class="btn btn-primary" id="confirm-add">Add</button>
    `;
    root.hidden = false;
    footer.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);
    footer.querySelector("#confirm-add")?.addEventListener("click", () => {
      const title = body.querySelector("#add-title")?.value.trim();
      if (!title) {
        toast("Need a title");
        return;
      }
      const type = body.querySelector("#add-type")?.value || "series";
      const year = Number(body.querySelector("#add-year")?.value) || new Date().getFullYear();
      const platSelect = body.querySelector("#add-platforms");
      const platformsSel = platSelect ? [...platSelect.selectedOptions].map((o) => o.value) : [];
      const runtime = Number(body.querySelector("#add-runtime")?.value || 45);
      const eps = Number(body.querySelector("#add-eps")?.value || 0);
      const status = body.querySelector("#add-status")?.value || "watchlist";
      const overview = body.querySelector("#add-overview")?.value.trim() || "Added by you.";
      const id =
        "custom-" +
        title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) +
        "-" +
        Date.now().toString(36);

      state.customTitles.push({
        id,
        title,
        type,
        year,
        genres: ["Drama"],
        platforms: platformsSel.length ? platformsSel : ["other"],
        overview,
        rating: 0,
        runtime,
        new: true,
        trending: false,
        posterHue: Math.floor(Math.random() * 360),
        custom: true,
      });
      setUserEntry(id, {
        status,
        episodesWatched: eps,
        runtimeMinutes: runtime,
        progress: status === "seen" ? 100 : 0,
      });
      closeModal();
      render();
      toast(`Added “${title}”`);
      openDetail(id);
    });
  }

  function exportData() {
    const payload = { app: "connor-watch-hub", exportedAt: new Date().toISOString(), state };
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
        const base = defaultState();
        state = {
          ...base,
          ...incoming,
          version: 2,
          subscriptions: { ...base.subscriptions, ...(incoming.subscriptions || {}) },
          activePlatforms: incoming.activePlatforms || base.activePlatforms,
          library: incoming.library || {},
          customTitles: incoming.customTitles || [],
        };
        saveState();
        applyTheme();
        renderPlatformChips();
        render();
        toast("Imported");
      } catch {
        toast("Import failed");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
