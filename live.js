/**
 * Live TV data via TVmaze (no API key, CORS-enabled).
 * https://www.tvmaze.com/api — CC BY-SA, credit TVmaze in the UI.
 */
(function (global) {
  "use strict";

  const BASE = "https://api.tvmaze.com";
  const CACHE_KEY = "connor-watch-hub-live-cache-v1";
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

  /** Known popular shows for Home bootstrap (TVmaze IDs) */
  const POPULAR_IDS = [
    2993, 46562, 54198, 37336, 49041, 44778, 44933, 15299, 53647, 55138,
    43031, 45039, 38052, 52341, 38963, 44458, 27848, 46065, 56512, 55352,
    82, 169, 431, 526, 179, 335, 4, 5, 6, 13,
  ];

  /** Map network / web channel names → our platform ids */
  const CHANNEL_MAP = [
    [/netflix/i, "netflix"],
    [/disney\+/i, "disney"],
    [/disney plus/i, "disney"],
    [/hulu/i, "disney"],
    [/prime video/i, "prime"],
    [/amazon/i, "prime"],
    [/apple tv/i, "apple"],
    [/\bmax\b/i, "max"],
    [/hbo/i, "max"],
    [/paramount/i, "paramount"],
    [/showmax/i, "showmax"],
    [/youtube/i, "youtube"],
    [/dstv/i, "dstv"],
    [/peacock/i, "other"],
    [/bbc/i, "other"],
    [/hulu/i, "disney"],
  ];

  const memory = {
    byId: new Map(), // tvmaze-123 → title
    popular: [],
    schedule: [],
    online: true,
    lastError: null,
    loadedAt: 0,
  };

  function stripHtml(html) {
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || "").trim();
  }

  function yearFrom(dateStr) {
    if (!dateStr) return null;
    const y = parseInt(String(dateStr).slice(0, 4), 10);
    return Number.isFinite(y) ? y : null;
  }

  function hueFrom(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function mapChannel(show) {
    const name =
      (show.webChannel && show.webChannel.name) ||
      (show.network && show.network.name) ||
      "";
    if (!name) return ["other"];
    for (const [re, id] of CHANNEL_MAP) {
      if (re.test(name)) return [id];
    }
    return ["other"];
  }

  function normalizeShow(show, extra = {}) {
    if (!show || !show.id) return null;
    const id = `tvmaze-${show.id}`;
    const premiered = yearFrom(show.premiered);
    const ended = yearFrom(show.ended);
    const avg = show.rating && show.rating.average != null ? Number(show.rating.average) : 0;
    const image =
      (show.image && (show.image.medium || show.image.original)) ||
      extra.image ||
      null;
    const channelName =
      (show.webChannel && show.webChannel.name) ||
      (show.network && show.network.name) ||
      extra.channel ||
      "";

    const title = {
      id,
      tvmazeId: show.id,
      title: show.name || "Untitled",
      type: "series",
      year: premiered || extra.year || null,
      endYear: ended || null,
      seasons: extra.seasons || null,
      genres: Array.isArray(show.genres) ? show.genres : [],
      platforms: mapChannel(show),
      overview: stripHtml(show.summary) || extra.overview || "No overview yet.",
      rating: avg,
      runtime: show.runtime || show.averageRuntime || 45,
      new: extra.new || isRecent(show.premiered, 120),
      trending: !!extra.trending,
      posterHue: hueFrom(show.name || id),
      image,
      live: true,
      network: channelName,
      showStatus: show.status || "",
      language: show.language || "",
      tvmazeUrl: show.url || `https://www.tvmaze.com/shows/${show.id}`,
      officialSite: show.officialSite || null,
      premiered: show.premiered || null,
      weight: show.weight || 0,
    };

    memory.byId.set(id, title);
    return title;
  }

  function isRecent(dateStr, days) {
    if (!dateStr) return false;
    const t = Date.parse(dateStr);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < days * 86400000;
  }

  async function fetchJson(path) {
    const url = path.startsWith("http") ? path : BASE + path;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 429) {
      await sleep(2000);
      const retry = await fetch(url, { headers: { Accept: "application/json" } });
      if (!retry.ok) throw new Error("TVmaze " + retry.status);
      return retry.json();
    }
    if (!res.ok) throw new Error("TVmaze " + res.status);
    return res.json();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function loadDiskCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || Date.now() - data.ts > CACHE_TTL_MS) return null;
      return data;
    } catch {
      return null;
    }
  }

  function saveDiskCache() {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          popular: memory.popular,
          schedule: memory.schedule,
          titles: [...memory.byId.values()],
        })
      );
    } catch {
      /* quota */
    }
  }

  function restoreDiskCache(data) {
    memory.popular = data.popular || [];
    memory.schedule = data.schedule || [];
    memory.loadedAt = data.ts || Date.now();
    for (const t of data.titles || []) {
      if (t && t.id) memory.byId.set(t.id, t);
    }
  }

  async function getShow(tvmazeId) {
    const key = `tvmaze-${tvmazeId}`;
    if (memory.byId.has(key) && memory.byId.get(key).overview) {
      return memory.byId.get(key);
    }
    const show = await fetchJson(`/shows/${tvmazeId}`);
    return normalizeShow(show, { trending: true });
  }

  async function search(query, limit = 24) {
    const q = String(query || "").trim();
    if (!q) return [];
    const rows = await fetchJson(`/search/shows?q=${encodeURIComponent(q)}`);
    return (rows || [])
      .map((row) => normalizeShow(row.show, { trending: false }))
      .filter(Boolean)
      .slice(0, limit);
  }

  async function fetchPopular() {
    const out = [];
    // Batch popular IDs (respect rate limits lightly)
    const ids = POPULAR_IDS.slice(0, 24);
    const chunk = 6;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const part = await Promise.all(
        slice.map(async (id) => {
          try {
            return await getShow(id);
          } catch {
            return null;
          }
        })
      );
      out.push(...part.filter(Boolean));
      if (i + chunk < ids.length) await sleep(350);
    }
    // Sort by rating / weight
    out.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.weight || 0) - (a.weight || 0));
    memory.popular = out;
    return out;
  }

  function extractShowFromEpisode(ep) {
    if (!ep) return null;
    const show = (ep._embedded && ep._embedded.show) || ep.show;
    if (!show || typeof show !== "object" || !show.id) return null;
    const channel =
      (show.webChannel && show.webChannel.name) ||
      (show.network && show.network.name) ||
      "";
    return normalizeShow(show, {
      trending: true,
      new: true,
      channel,
      overview: stripHtml(ep.summary) || undefined,
    });
  }

  async function fetchSchedule() {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrowDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const [webToday, webTomorrow, usToday] = await Promise.all([
      fetchJson(`/schedule/web?date=${today}`).catch(() => []),
      fetchJson(`/schedule/web?date=${tomorrowDate}`).catch(() => []),
      fetchJson(`/schedule?country=US&date=${today}`).catch(() => []),
    ]);

    const seen = new Set();
    const list = [];
    for (const ep of [...(webToday || []), ...(webTomorrow || []), ...(usToday || [])]) {
      const t = extractShowFromEpisode(ep);
      if (!t || seen.has(t.id)) continue;
      // Prefer streaming / known platforms; still keep interesting US network
      seen.add(t.id);
      t.airingEpisode = {
        name: ep.name,
        season: ep.season,
        number: ep.number,
        airdate: ep.airdate,
      };
      list.push(t);
    }

    // Prefer shows on mapped platforms we care about
    list.sort((a, b) => {
      const pa = a.platforms[0] !== "other" ? 1 : 0;
      const pb = b.platforms[0] !== "other" ? 1 : 0;
      return pb - pa || (b.rating || 0) - (a.rating || 0);
    });

    memory.schedule = list;
    return list;
  }

  async function fetchEpisodes(tvmazeId) {
    const eps = await fetchJson(`/shows/${tvmazeId}/episodes`);
    return Array.isArray(eps) ? eps : [];
  }

  async function bootstrap() {
    const cached = loadDiskCache();
    if (cached) {
      restoreDiskCache(cached);
      memory.online = true;
      // Refresh in background
      refreshFeeds().catch(() => {});
      return { fromCache: true, online: true };
    }
    try {
      await refreshFeeds();
      return { fromCache: false, online: true };
    } catch (err) {
      memory.online = false;
      memory.lastError = String(err.message || err);
      return { fromCache: false, online: false, error: memory.lastError };
    }
  }

  async function refreshFeeds() {
    memory.online = true;
    memory.lastError = null;
    await Promise.all([fetchPopular(), fetchSchedule()]);
    memory.loadedAt = Date.now();
    saveDiskCache();
  }

  function allCachedTitles() {
    return [...memory.byId.values()];
  }

  function getCached(id) {
    return memory.byId.get(id) || null;
  }

  global.WatchLive = {
    bootstrap,
    refreshFeeds,
    search,
    getShow,
    fetchEpisodes,
    allCachedTitles,
    getCached,
    normalizeShow,
    get popular() {
      return memory.popular.slice();
    },
    get schedule() {
      return memory.schedule.slice();
    },
    get online() {
      return memory.online;
    },
    get lastError() {
      return memory.lastError;
    },
    get loadedAt() {
      return memory.loadedAt;
    },
    attribution: {
      name: "TVmaze",
      url: "https://www.tvmaze.com",
    },
  };
})(window);
