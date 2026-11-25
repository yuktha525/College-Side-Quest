/* CampusSideQuest — RPG Quest Board Client (Live Backend + Static GitHub Pages Fallback) */

const state = {
  token: localStorage.getItem("csq_token") || "",
  user: null,
  meta: null,
  quests: [],
  myQuests: [],
  leaderboard: null,
  guildMode: "departments",
  myFilter: "active",
  activeView: "board",
  activeCategory: "all",
  searchQuery: "",
  activeQuestId: null,
  staticMode: false,
  theme: localStorage.getItem("csq_theme") === "light" ? "light" : "dark",
  sfxEnabled: localStorage.getItem("csq_sfx") !== "off",
};

const CATEGORIES_META = {
  rescue: { label: "Quick Rescue", default_xp: 75 },
  skill: { label: "Skill Swap", default_xp: 100 },
  errand: { label: "Campus Errand", default_xp: 60 },
  squad: { label: "Squad Up", default_xp: 80 },
};

const HERO_CLASSES_META = [
  { avatar: "CM", label: "Code Mage" },
  { avatar: "TR", label: "Tech Ranger" },
  { avatar: "PB", label: "Pixel Bard" },
  { avatar: "ST", label: "Squad Tank" },
  { avatar: "NO", label: "Night Owl" },
  { avatar: "LA", label: "Lab Alchemist" },
];

const BADGES_META = [
  { id: "first_quest", name: "First Blood", icon: "I", description: "Completed your first campus quest" },
  { id: "lifesaver", name: "Lifesaver", icon: "II", description: "Rescued a classmate on an urgent quest" },
  { id: "debug_wizard", name: "Debug Wizard", icon: "III", description: "Completed 2+ Skill Swap quests" },
  { id: "squad_mvp", name: "Clutch Player", icon: "IV", description: "Completed 2+ Squad Up quests" },
  { id: "trusted_five", name: "Campus Legend", icon: "V", description: "Completed 5+ quests for fellow students" },
];

const LOCAL_DB_KEY = "csq_static_db_v2";
const $ = (id) => document.getElementById(id);

function formatEmblem(avatar, fallbackName = "Hero") {
  const clean = String(avatar ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (clean) return clean.slice(0, 3).toUpperCase();
  const parts = String(fallbackName || "H").trim().split(/\s+/);
  return parts.map((p) => p[0] || "").join("").slice(0, 2).toUpperCase() || "HR";
}

const AVATAR_STYLES = {
  CM: {
    bg: "#312e81",
    accent: "#a78bfa",
    face: "#fde68a",
    inner: '<path d="M12 5 L28 5 L32 22 L8 22 Z" fill="#6d28d9"/><circle cx="20" cy="20" r="8" fill="#fde68a"/><circle cx="17" cy="19" r="1.4" fill="#1e1b4b"/><circle cx="23" cy="19" r="1.4" fill="#1e1b4b"/><path d="M10 38 C10 29 30 29 30 38" fill="#5b21b6"/><path d="M18 10 L22 10 L20 14 Z" fill="#fbbf24"/>',
  },
  TR: {
    bg: "#0c4a6e",
    accent: "#38bdf8",
    face: "#fed7aa",
    inner: '<circle cx="20" cy="18" r="8.5" fill="#fed7aa"/><path d="M11 16 C12 9 28 9 29 16 L28 19 L12 19 Z" fill="#0284c7"/><rect x="13.5" y="16" width="13" height="4" rx="2" fill="#e0f2fe"/><path d="M10 38 C10 29 30 29 30 38" fill="#0369a1"/>',
  },
  PB: {
    bg: "#701a75",
    accent: "#f472b6",
    face: "#fde68a",
    inner: '<circle cx="20" cy="19" r="8" fill="#fde68a"/><path d="M12 15 Q20 7 28 15 L29 18 L11 18 Z" fill="#db2777"/><circle cx="17" cy="20" r="1.3" fill="#1f2937"/><circle cx="23" cy="20" r="1.3" fill="#1f2937"/><path d="M10 38 C10 29 30 29 30 38" fill="#be185d"/><circle cx="29" cy="11" r="2.5" fill="#fbbf24"/>',
  },
  ST: {
    bg: "#064e3b",
    accent: "#34d399",
    face: "#fed7aa",
    inner: '<rect x="12" y="10" width="16" height="16" rx="6" fill="#059669"/><rect x="14.5" y="15.5" width="11" height="5" rx="2" fill="#d1fae5"/><rect x="18.5" y="10" width="3" height="6" fill="#fbbf24"/><path d="M9 38 C9 29 31 29 31 38" fill="#047857"/>',
  },
  NO: {
    bg: "#1e293b",
    accent: "#fbbf24",
    face: "#fde68a",
    inner: '<circle cx="20" cy="19" r="8.5" fill="#fde68a"/><path d="M11 17 Q20 11 29 17 L27 21 L13 21 Z" fill="#334155"/><circle cx="16.5" cy="18.5" r="2.2" fill="#fbbf24"/><circle cx="23.5" cy="18.5" r="2.2" fill="#fbbf24"/><path d="M10 38 C10 29 30 29 30 38" fill="#475569"/>',
  },
  LA: {
    bg: "#7c2d12",
    accent: "#fb923c",
    face: "#fed7aa",
    inner: '<circle cx="20" cy="19" r="8" fill="#fed7aa"/><path d="M11 15 Q20 8 29 15 Z" fill="#ea580c"/><circle cx="16.5" cy="18" r="2.8" fill="#fff" stroke="#1e293b" stroke-width="1.3"/><circle cx="23.5" cy="18" r="2.8" fill="#fff" stroke="#1e293b" stroke-width="1.3"/><circle cx="16.5" cy="18" r="1.1" fill="#0f172a"/><circle cx="23.5" cy="18" r="1.1" fill="#0f172a"/><path d="M10 38 C10 29 30 29 30 38" fill="#c2410c"/>',
  },
};

function renderAvatarSvg(avatarKey, fallbackName = "Hero") {
  const code = formatEmblem(avatarKey, fallbackName);
  const keys = Object.keys(AVATAR_STYLES);
  const picked = AVATAR_STYLES[code] || AVATAR_STYLES[keys[(code.charCodeAt(0) || 0) % keys.length]];
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="40" height="40" fill="${picked.bg}"/><circle cx="20" cy="20" r="18" fill="none" stroke="${picked.accent}" stroke-opacity="0.35" stroke-width="1.5"/>${picked.inner}</svg>`;
}

function formatBadgeCode(icon, name = "B") {
  const clean = String(icon ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (clean) return clean.slice(0, 3);
  return String(name || "B").slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---- LocalStorage Static Engine (runs automatically on GitHub Pages) ---- */
function computeLevelLocal(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  const level = 1 + Math.floor(safeXp / 150);
  const rank =
    level >= 5 ? "Campus Legend" : level === 4 ? "Guild Hero" : level === 3 ? "Sidekick" : level === 2 ? "Quad Runner" : "Campus Rookie";
  return {
    level,
    rank,
    xp: safeXp,
    xp_in_level: safeXp % 150,
    xp_next_level: 150,
  };
}

function seedLocalDb() {
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  return {
    nextUserId: 5,
    nextQuestId: 5,
    nextMsgId: 1,
    users: [
      { id: 1, name: "Maya Lin", email: "maya@campus.edu", password: "quest123", department: "CS", hostel: "North Hall", avatar: "CM", hero_class: "Code Mage", xp: 340, reliability: 100, quests_completed: 4, badges: ["first_quest", "debug_wizard"] },
      { id: 2, name: "Arjun Verma", email: "arjun@campus.edu", password: "quest123", department: "ECE", hostel: "Cedar Block", avatar: "TR", hero_class: "Tech Ranger", xp: 210, reliability: 98, quests_completed: 3, badges: ["first_quest", "lifesaver"] },
      { id: 3, name: "Zoya Khan", email: "zoya@campus.edu", password: "quest123", department: "Design", hostel: "Artisan Wing", avatar: "PB", hero_class: "Pixel Bard", xp: 165, reliability: 100, quests_completed: 2, badges: ["first_quest"] },
      { id: 4, name: "Kabir Rao", email: "kabir@campus.edu", password: "quest123", department: "Mech", hostel: "North Hall", avatar: "ST", hero_class: "Squad Tank", xp: 95, reliability: 95, quests_completed: 1, badges: [] },
    ],
    quests: [
      { id: 1, creator_id: 2, claimer_id: null, title: "Need a USB-C Mac charger for 1 hour", description: "Battery is at 6% before my project presentation. Sitting near the window desks!", category: "rescue", location: "Central Library 2F", reward_text: "1 Iced Coffee", xp_value: 75, status: "open", completion_code: "4821", expires_at: iso(2 * 3600000), created_at: iso(-12 * 60000) },
      { id: 2, creator_id: 3, claimer_id: null, title: "Help fix a Python Flask CORS bug (20 mins)", description: "My frontend can't hit my local API route. Will trade a Figma crash-course or canteen chai!", category: "skill", location: "CS Innovation Lab", reward_text: "Figma tips + Chai", xp_value: 100, status: "open", completion_code: "7390", expires_at: iso(5 * 3600000), created_at: iso(-25 * 60000) },
      { id: 3, creator_id: 4, claimer_id: null, title: "Need 1 goalkeeper for 5v5 football at 5:30 PM", description: "Friendly hostel match, gloves provided. Just show up and have fun!", category: "squad", location: "Main Turf Ground", reward_text: "Post-match Gatorade", xp_value: 80, status: "open", completion_code: "1549", expires_at: iso(4 * 3600000), created_at: iso(-40 * 60000) },
      { id: 4, creator_id: 1, claimer_id: null, title: "Grab 20-page spiral print from Main Gate shop", description: "Stuck in studio review. Will pay exact print bill + extra samosa for the trouble.", category: "errand", location: "Design Block Atrium", reward_text: "Samosa + Print cost", xp_value: 60, status: "open", completion_code: "6024", expires_at: iso(3 * 3600000), created_at: iso(-5 * 60000) },
    ],
    messages: [],
  };
}

function getLocalDb() {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.quests)) {
        return parsed;
      }
    }
  } catch {
    // Re-seed if corrupted
  }
  const seeded = seedLocalDb();
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveLocalDb(db) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function serializeLocalUser(u, includeEmail = false) {
  const badgeMap = Object.fromEntries(BADGES_META.map((b) => [b.id, b]));
  const lvl = computeLevelLocal(u.xp);
  const out = {
    id: u.id,
    name: u.name,
    department: u.department,
    hostel: u.hostel,
    avatar: u.avatar,
    hero_class: u.hero_class,
    reliability: u.reliability,
    quests_completed: u.quests_completed,
    badges: (u.badges || []).map((bid) => badgeMap[bid]).filter(Boolean),
    ...lvl,
  };
  if (includeEmail) out.email = u.email;
  return out;
}

function serializeLocalQuest(db, q, viewerId) {
  const creator = db.users.find((u) => u.id === q.creator_id);
  const claimer = q.claimer_id ? db.users.find((u) => u.id === q.claimer_id) : null;
  const isCreator = viewerId !== null && q.creator_id === viewerId;
  const isClaimer = viewerId !== null && q.claimer_id === viewerId;
  const out = {
    id: q.id,
    title: q.title,
    description: q.description,
    category: q.category,
    category_label: CATEGORIES_META[q.category]?.label || q.category,
    location: q.location,
    reward_text: q.reward_text,
    xp_value: q.xp_value,
    status: q.status,
    expires_at: q.expires_at,
    created_at: q.created_at,
    is_creator: isCreator,
    is_claimer: isClaimer,
    creator: {
      id: creator.id,
      name: creator.name,
      avatar: creator.avatar,
      department: creator.department,
      level: computeLevelLocal(creator.xp).level,
      reliability: creator.reliability,
    },
    claimer: claimer
      ? {
          id: claimer.id,
          name: claimer.name,
          avatar: claimer.avatar,
          department: claimer.department,
          level: computeLevelLocal(claimer.xp).level,
          reliability: claimer.reliability,
        }
      : null,
  };
  if (isCreator) out.completion_code = q.completion_code;
  return out;
}

function getLocalViewer(db) {
  if (!state.token.startsWith("local:")) return null;
  const uid = Number(state.token.slice(6));
  return db.users.find((u) => u.id === uid) || null;
}

function expireLocalQuests(db) {
  const now = Date.now();
  let changed = false;
  db.quests.forEach((q) => {
    if (q.status === "open" && new Date(q.expires_at).getTime() <= now) {
      q.status = "expired";
      changed = true;
    }
  });
  if (changed) saveLocalDb(db);
}

function localApi(rawPath, options = {}) {
  const db = getLocalDb();
  expireLocalQuests(db);

  const [pathOnly, queryStr] = rawPath.split("?");
  const path = pathOnly.replace(/^\./, "");
  const params = new URLSearchParams(queryStr || "");
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const viewer = getLocalViewer(db);
  const viewerId = viewer ? viewer.id : null;

  if (path === "/api/meta") {
    return { categories: CATEGORIES_META, hero_classes: HERO_CLASSES_META, badges: BADGES_META };
  }

  if (path === "/api/auth/demo" && method === "POST") {
    const email = String(body.email || "maya@campus.edu").toLowerCase();
    const u = db.users.find((x) => x.email === email);
    if (!u) throw new Error("Demo hero not found");
    return { token: `local:${u.id}`, user: serializeLocalUser(u, true) };
  }

  if (path === "/api/auth/login" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const u = db.users.find((x) => x.email === email && x.password === password);
    if (!u) throw new Error("Invalid email or password");
    return { token: `local:${u.id}`, user: serializeLocalUser(u, true) };
  }

  if (path === "/api/auth/register" && method === "POST") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2) throw new Error("Name must be at least 2 characters");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid college email address");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    if (db.users.some((x) => x.email === email)) throw new Error("An account with this email already exists");

    const avatar = String(body.avatar || "CM");
    const cls = HERO_CLASSES_META.find((c) => c.avatar === avatar)?.label || "Code Mage";
    const newUser = {
      id: db.nextUserId++,
      name,
      email,
      password,
      department: String(body.department || "CS").trim() || "CS",
      hostel: String(body.hostel || "North Hall").trim() || "North Hall",
      avatar,
      hero_class: cls,
      xp: 0,
      reliability: 100,
      quests_completed: 0,
      badges: [],
    };
    db.users.push(newUser);
    saveLocalDb(db);
    return { token: `local:${newUser.id}`, user: serializeLocalUser(newUser, true) };
  }

  if (path === "/api/me") {
    if (!viewer) throw new Error("Please sign in first");
    return { user: serializeLocalUser(viewer, true) };
  }

  if (path === "/api/quests" && method === "GET") {
    const scope = params.get("scope") || "board";
    const category = params.get("category") || "all";
    const qStr = (params.get("q") || "").trim().toLowerCase();

    let rows = db.quests.slice();
    if (scope === "mine") {
      if (!viewer) throw new Error("Sign in to view your quests");
      rows = rows.filter((q) => q.creator_id === viewerId || q.claimer_id === viewerId);
    } else {
      rows = rows.filter((q) => q.status === "open" || q.status === "claimed");
    }
    if (CATEGORIES_META[category]) {
      rows = rows.filter((q) => q.category === category);
    }
    if (qStr) {
      rows = rows.filter(
        (q) =>
          q.title.toLowerCase().includes(qStr) ||
          q.location.toLowerCase().includes(qStr) ||
          q.reward_text.toLowerCase().includes(qStr)
      );
    }
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { quests: rows.map((q) => serializeLocalQuest(db, q, viewerId)) };
  }

  if (path === "/api/quests" && method === "POST") {
    if (!viewer) throw new Error("Please sign in first");
    const title = String(body.title || "").trim();
    const location = String(body.location || "").trim();
    const category = String(body.category || "rescue");
    if (title.length < 4) throw new Error("Title must be at least 4 characters");
    if (location.length < 2) throw new Error("Location must be at least 2 characters");
    if (!CATEGORIES_META[category]) throw new Error("Invalid quest category");
    const mins = Math.max(15, Math.min(1440, Number(body.duration_minutes) || 120));
    const q = {
      id: db.nextQuestId++,
      creator_id: viewerId,
      claimer_id: null,
      title,
      description: String(body.description || "").trim() || "Meet at the campus spot to complete this quest!",
      category,
      location,
      reward_text: String(body.reward_text || "").trim() || "Campus Karma",
      xp_value: CATEGORIES_META[category].default_xp,
      status: "open",
      completion_code: String(Math.floor(1000 + Math.random() * 9000)),
      expires_at: new Date(Date.now() + mins * 60000).toISOString(),
      created_at: new Date().toISOString(),
    };
    db.quests.push(q);
    saveLocalDb(db);
    return { quest: serializeLocalQuest(db, q, viewerId) };
  }

  const questMatch = path.match(/^\/api\/quests\/(\d+)(?:\/(claim|unclaim|complete|cancel|messages))?$/);
  if (questMatch) {
    const qid = Number(questMatch[1]);
    const action = questMatch[2] || "";
    const q = db.quests.find((item) => item.id === qid);
    if (!q) throw new Error("Quest not found");

    if (!action && method === "GET") {
      const msgs = db.messages
        .filter((m) => m.quest_id === qid)
        .map((m) => {
          const sender = db.users.find((u) => u.id === m.sender_id);
          return { ...m, sender_name: sender?.name || "Hero", sender_avatar: sender?.avatar || "CM" };
        });
      return { quest: serializeLocalQuest(db, q, viewerId), messages: msgs };
    }

    if (!viewer) throw new Error("Please sign in first");

    if (action === "claim") {
      if (q.creator_id === viewerId) throw new Error("You cannot accept your own quest");
      if (q.status !== "open") throw new Error(`Quest is already ${q.status}`);
      q.status = "claimed";
      q.claimer_id = viewerId;
      saveLocalDb(db);
      return { quest: serializeLocalQuest(db, q, viewerId) };
    }

    if (action === "unclaim") {
      if (q.status !== "claimed") throw new Error("Only claimed quests can be released");
      if (viewerId !== q.claimer_id && viewerId !== q.creator_id) throw new Error("Not allowed to release this quest");
      if (viewerId === q.claimer_id) viewer.reliability = Math.max(50, viewer.reliability - 2);
      q.status = "open";
      q.claimer_id = null;
      saveLocalDb(db);
      return { quest: serializeLocalQuest(db, q, viewerId) };
    }

    if (action === "cancel") {
      if (q.creator_id !== viewerId) throw new Error("Only the quest poster can cancel it");
      if (q.status === "completed") throw new Error("Completed quests cannot be cancelled");
      q.status = "cancelled";
      saveLocalDb(db);
      return { status: "cancelled" };
    }

    if (action === "complete") {
      if (q.status !== "claimed") throw new Error("Quest must be claimed before completion");
      if (q.claimer_id !== viewerId) throw new Error("Only the assigned hero can enter the completion PIN");
      if (String(body.pin || "").trim() !== q.completion_code) throw new Error("Incorrect 4-digit handshake PIN");

      q.status = "completed";
      viewer.xp += q.xp_value;
      viewer.quests_completed += 1;
      viewer.reliability = Math.min(100, viewer.reliability + 1);
      const poster = db.users.find((u) => u.id === q.creator_id);
      if (poster) poster.xp += 15;

      const doneQuests = db.quests.filter((item) => item.claimer_id === viewerId && item.status === "completed");
      const newBadges = [];
      const award = (bid) => {
        if (!viewer.badges.includes(bid)) {
          viewer.badges.push(bid);
          const meta = BADGES_META.find((b) => b.id === bid);
          if (meta) newBadges.push(meta);
        }
      };
      if (doneQuests.length >= 1) award("first_quest");
      if (doneQuests.some((item) => item.category === "rescue")) award("lifesaver");
      if (doneQuests.filter((item) => item.category === "skill").length >= 2) award("debug_wizard");
      if (doneQuests.filter((item) => item.category === "squad").length >= 2) award("squad_mvp");
      if (doneQuests.length >= 5) award("trusted_five");

      saveLocalDb(db);
      return {
        quest: serializeLocalQuest(db, q, viewerId),
        user: serializeLocalUser(viewer, true),
        xp_awarded: q.xp_value,
        new_badges: newBadges,
      };
    }

    if (action === "messages") {
      const text = String(body.body || "").trim();
      if (!text) throw new Error("Message cannot be empty");
      if (q.status === "claimed" && viewerId !== q.creator_id && viewerId !== q.claimer_id) {
        throw new Error("Chat is private between poster and helper");
      }
      const msg = {
        id: db.nextMsgId++,
        quest_id: qid,
        sender_id: viewerId,
        body: text,
        created_at: new Date().toISOString(),
      };
      db.messages.push(msg);
      saveLocalDb(db);
      return { message: { ...msg, sender_name: viewer.name, sender_avatar: viewer.avatar } };
    }
  }

  if (path === "/api/leaderboard") {
    const heroes = db.users
      .slice()
      .sort((a, b) => b.xp - a.xp || b.quests_completed - a.quests_completed)
      .slice(0, 12)
      .map((u) => serializeLocalUser(u));

    const groupBy = (key) => {
      const map = new Map();
      db.users.forEach((u) => {
        const k = u[key];
        const entry = map.get(k) || { [key]: k, total_xp: 0, total_done: 0, members: 0 };
        entry.total_xp += u.xp;
        entry.total_done += u.quests_completed;
        entry.members += 1;
        map.set(k, entry);
      });
      return Array.from(map.values()).sort((a, b) => b.total_xp - a.total_xp);
    };

    return {
      heroes,
      departments: groupBy("department"),
      hostels: groupBy("hostel"),
    };
  }

  throw new Error("Unsupported action");
}

/* ---- Subtle Web Audio Game Chimes ---- */
let audioCtx = null;

function playSfx(kind) {
  if (!state.sfxEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const now = audioCtx.currentTime;

    const notes =
      kind === "victory"
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === "accept"
        ? [440, 587.33]
        : [523.25, 659.25];

    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.06, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.2);
    });
  } catch {
    // Audio playback is strictly optional
  }
}

/* ---- Confetti Celebration ---- */
function launchConfetti() {
  const canvas = $("confetti-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ["#fbbf24", "#34d399", "#38bdf8", "#a78bfa", "#fb7185"];
  const pieces = Array.from({ length: 85 }, () => ({
    x: canvas.width * (0.25 + Math.random() * 0.5),
    y: canvas.height * 0.45,
    vx: (Math.random() - 0.5) * 14,
    vy: -6 - Math.random() * 10,
    size: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
  }));

  let frame = 0;
  function tick() {
    frame += 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.restore();
    });
    if (frame < 95) {
      requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(tick);
}

/* ---- Toasts & Modals ---- */
function showToast(message, isError = false) {
  const box = document.createElement("div");
  box.className = `toast${isError ? " error" : ""}`;
  box.textContent = message;
  $("toast-container").appendChild(box);
  setTimeout(() => box.remove(), 3400);
}

function openModal(id) {
  $(id).classList.remove("hidden");
}

function closeModal(id) {
  $(id).classList.add("hidden");
  if (id === "detail-modal") {
    state.activeQuestId = null;
  }
}

/* ---- Unified API Helper ---- */
async function api(path, options = {}) {
  if (state.staticMode) {
    return localApi(path, options);
  }
  const relPath = path.startsWith("/") ? `.${path}` : path;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }
  const res = await fetch(relPath, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

/* ---- Time Formatting ---- */
function formatTimeLeft(isoStr) {
  const diffMs = new Date(isoStr).getTime() - Date.now();
  if (diffMs <= 0) return "Expired";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m left` : `${hrs}h left`;
}

/* ---- Session & HUD ---- */
function setSession(token, user) {
  state.token = token || "";
  state.user = user || null;
  if (state.token) {
    localStorage.setItem("csq_token", state.token);
  } else {
    localStorage.removeItem("csq_token");
  }
  renderHud();
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const isLight = state.theme === "light";
  $("theme-icon-sun").classList.toggle("hidden", isLight);
  $("theme-icon-moon").classList.toggle("hidden", !isLight);
}

function renderHud() {
  applyTheme();
  $("sfx-toggle").textContent = state.sfxEnabled ? "🔊" : "🔇";

  if (state.user) {
    $("hero-pill").classList.remove("hidden");
    $("signin-open-btn").classList.add("hidden");
    $("hud-avatar").innerHTML = renderAvatarSvg(state.user.avatar, state.user.name);
    $("hud-name").textContent = state.user.name.split(" ")[0];
    $("hud-level").textContent = `Lv.${state.user.level}`;
    const pct = Math.min(100, Math.round((state.user.xp_in_level / state.user.xp_next_level) * 100));
    $("hud-xp-fill").style.width = `${pct}%`;
  } else {
    $("hero-pill").classList.add("hidden");
    $("signin-open-btn").classList.remove("hidden");
  }
}

/* ---- Views ---- */
function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `view-${viewName}`);
  });

  if (viewName === "board") loadBoard();
  if (viewName === "mine") loadMyQuests();
  if (viewName === "leaderboard") loadLeaderboard();
}

/* ---- Render Quest Cards ---- */
function createQuestCardHtml(q) {
  const statusTag =
    q.status === "open"
      ? `<span class="card-timer">${escapeHtml(formatTimeLeft(q.expires_at))}</span>`
      : `<span class="status-pill status-${escapeHtml(q.status)}">${escapeHtml(q.status)}</span>`;

  let ctaLabel = "Inspect";
  if (q.status === "open" && !q.is_creator) ctaLabel = "Accept Quest";
  if (q.status === "claimed" && q.is_claimer) ctaLabel = "Enter PIN";
  if (q.is_creator && q.status !== "completed") ctaLabel = "Manage";

  return `
    <article class="quest-card" data-cat="${escapeHtml(q.category)}" data-quest-id="${q.id}">
      <div class="card-top">
        <span class="cat-badge cat-${escapeHtml(q.category)}">${escapeHtml(q.category_label)}</span>
        ${statusTag}
      </div>
      <h3 class="card-title">${escapeHtml(q.title)}</h3>
      <div class="card-location">
        <span class="hero-avatar-box hero-avatar-sm">${renderAvatarSvg(q.creator.avatar, q.creator.name)}</span>
        <span>${escapeHtml(q.location)} • ${escapeHtml(q.creator.name)}</span>
      </div>
      <div class="card-bottom">
        <div class="card-rewards">
          <span class="reward-pill">Reward: ${escapeHtml(q.reward_text)}</span>
          <span class="xp-pill">+${q.xp_value} XP</span>
        </div>
        <button class="btn btn-secondary btn-card" type="button">${ctaLabel}</button>
      </div>
    </article>
  `;
}

async function loadBoard() {
  const params = new URLSearchParams({
    scope: "board",
    category: state.activeCategory,
    q: state.searchQuery,
  });
  try {
    const data = await api(`/api/quests?${params.toString()}`);
    state.quests = data.quests || [];
    renderBoard();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderBoard() {
  const openCount = state.quests.filter((q) => q.status === "open").length;
  const activeCount = state.quests.filter((q) => q.status === "claimed").length;
  $("stat-open-count").textContent = String(openCount);
  $("stat-active-count").textContent = String(activeCount);

  const grid = $("board-grid");
  const empty = $("board-empty");
  if (!state.quests.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = state.quests.map(createQuestCardHtml).join("");
}

async function loadMyQuests() {
  if (!state.user) {
    $("mine-filter").classList.add("hidden");
    $("mine-guest").classList.remove("hidden");
    $("mine-grid").innerHTML = "";
    $("mine-empty").classList.add("hidden");
    return;
  }
  $("mine-guest").classList.add("hidden");
  $("mine-filter").classList.remove("hidden");
  try {
    const data = await api("/api/quests?scope=mine");
    state.myQuests = data.quests || [];
    renderMyQuests();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderMyQuests() {
  const activeList = state.myQuests.filter((q) => q.status === "open" || q.status === "claimed");
  const completedList = state.myQuests.filter((q) => q.status === "completed");

  const activeBtn = document.querySelector('[data-mine-filter="active"]');
  const completedBtn = document.querySelector('[data-mine-filter="completed"]');
  if (activeBtn) activeBtn.textContent = `Active (${activeList.length})`;
  if (completedBtn) completedBtn.textContent = `Completed (${completedList.length})`;

  const visible = state.myFilter === "completed" ? completedList : activeList;
  if (!visible.length) {
    $("mine-grid").innerHTML = "";
    $("mine-empty-title").textContent =
      state.myFilter === "completed" ? "No completed quests yet" : "No active quests right now";
    $("mine-empty-desc").textContent =
      state.myFilter === "completed"
        ? "Finish a quest with a 4-digit handshake PIN to see it in your trophy history."
        : "Accept an open quest from the board or post one of your own!";
    $("mine-empty").classList.remove("hidden");
    return;
  }
  $("mine-empty").classList.add("hidden");
  $("mine-grid").innerHTML = visible.map(createQuestCardHtml).join("");
}

/* ---- Quest Detail & Handshake ---- */
async function openQuestDetail(questId) {
  state.activeQuestId = questId;
  try {
    const data = await api(`/api/quests/${questId}`);
    renderQuestDetail(data.quest, data.messages || []);
    openModal("detail-modal");
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderQuestDetail(q, messages) {
  const catEl = $("detail-category");
  catEl.className = `cat-badge cat-${q.category}`;
  catEl.textContent = q.category_label;

  const statusEl = $("detail-status");
  statusEl.className = `status-pill status-${q.status}`;
  statusEl.textContent = q.status;

  $("detail-title").textContent = q.title;
  $("detail-desc").textContent = q.description;
  $("detail-location").textContent = q.location;
  $("detail-reward").textContent = q.reward_text;
  $("detail-xp").textContent = `+${q.xp_value} XP`;
  $("detail-timer").textContent = q.status === "completed" ? "Completed" : formatTimeLeft(q.expires_at);

  const partyHtml = [
    `<div class="party-chip">
      <span class="hero-avatar-box">${renderAvatarSvg(q.creator.avatar, q.creator.name)}</span>
      <span><strong>Posted by ${escapeHtml(q.creator.name)}</strong><br/><small class="lb-sub">Lv.${q.creator.level} ${escapeHtml(q.creator.department)} • ${q.creator.reliability}% reliable</small></span>
    </div>`,
  ];
  if (q.claimer) {
    partyHtml.push(
      `<div class="party-chip">
        <span class="hero-avatar-box">${renderAvatarSvg(q.claimer.avatar, q.claimer.name)}</span>
        <span><strong>Accepted by ${escapeHtml(q.claimer.name)}</strong><br/><small class="lb-sub">Lv.${q.claimer.level} ${escapeHtml(q.claimer.department)} • ${q.claimer.reliability}% reliable</small></span>
      </div>`
    );
  }
  $("detail-party").innerHTML = partyHtml.join("");

  const box = $("detail-action-box");
  if (!state.user) {
    box.innerHTML = `
      <div class="action-row">
        <span>Sign in as a campus hero to accept this quest and earn <strong>+${q.xp_value} XP</strong>.</span>
        <button class="btn btn-primary" id="detail-login-btn" type="button">Sign In to Accept</button>
      </div>
    `;
    $("detail-login-btn").onclick = () => {
      closeModal("detail-modal");
      openModal("auth-modal");
    };
  } else if (q.status === "completed") {
    box.innerHTML = `<div class="action-row"><strong>Quest Completed!</strong><span>XP and badges have been awarded.</span></div>`;
  } else if (q.status === "cancelled" || q.status === "expired") {
    box.innerHTML = `<div class="action-row"><span>This quest is ${escapeHtml(q.status)}.</span></div>`;
  } else if (q.is_creator) {
    box.innerHTML = `
      <div>
        <strong>Handshake PIN (share in person when done):</strong>
        <div class="pin-display">${escapeHtml(q.completion_code)}</div>
        <div class="action-row">
          <small class="muted-text">Your helper enters this 4-digit PIN to complete the quest.</small>
          <div style="display:flex; gap:8px;">
            ${q.status === "claimed" ? `<button class="btn btn-secondary" id="detail-reopen-btn" type="button">Reopen</button>` : ""}
            <button class="btn btn-danger" id="detail-cancel-btn" type="button">Cancel Quest</button>
          </div>
        </div>
      </div>
    `;
    if ($("detail-reopen-btn")) {
      $("detail-reopen-btn").onclick = () => questAction(q.id, "unclaim", "Quest reopened on the board");
    }
    $("detail-cancel-btn").onclick = () => questAction(q.id, "cancel", "Quest cancelled", true);
  } else if (q.status === "open") {
    box.innerHTML = `
      <div class="action-row">
        <span>Ready to help? Accepting locks this quest for you.</span>
        <button class="btn btn-emerald" id="detail-claim-btn" type="button">Accept Quest (+${q.xp_value} XP)</button>
      </div>
    `;
    $("detail-claim-btn").onclick = () => questAction(q.id, "claim", "Quest accepted! Head to the meetup spot.");
  } else if (q.status === "claimed" && q.is_claimer) {
    box.innerHTML = `
      <div>
        <strong>Enter Poster's 4-Digit Handshake PIN to Claim +${q.xp_value} XP:</strong>
        <form id="complete-pin-form" class="pin-form">
          <input id="pin-input" class="pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" required />
          <button class="btn btn-emerald" type="submit">Complete Quest</button>
          <button class="btn btn-secondary" id="detail-unclaim-btn" type="button">Release</button>
        </form>
      </div>
    `;
    $("complete-pin-form").onsubmit = async (e) => {
      e.preventDefault();
      const pin = $("pin-input").value.trim();
      try {
        const res = await api(`/api/quests/${q.id}/complete`, {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        setSession(state.token, res.user);
        playSfx("victory");
        launchConfetti();
        const badgeText =
          res.new_badges && res.new_badges.length
            ? ` Badge unlocked: ${res.new_badges.map((b) => b.name).join(", ")}!`
            : "";
        showToast(`+${res.xp_awarded} XP earned!${badgeText}`);
        await refreshAfterAction(q.id);
      } catch (err) {
        showToast(err.message, true);
      }
    };
    $("detail-unclaim-btn").onclick = () => questAction(q.id, "unclaim", "Quest released back to the board");
  } else {
    box.innerHTML = `<div class="action-row"><span>Locked: another campus hero is currently completing this quest.</span></div>`;
  }

  const msgContainer = $("detail-messages");
  if (!messages.length) {
    msgContainer.innerHTML = `<div class="muted-text" style="font-size:0.84rem;">No messages yet. Say hello to coordinate!</div>`;
  } else {
    msgContainer.innerHTML = messages
      .map(
        (m) => `
      <div class="chat-msg">
        <div class="chat-msg-head">
          <strong style="display:inline-flex;align-items:center;gap:6px;"><span class="hero-avatar-box hero-avatar-sm">${renderAvatarSvg(m.sender_avatar, m.sender_name)}</span> ${escapeHtml(m.sender_name)}</strong>
          <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div>${escapeHtml(m.body)}</div>
      </div>`
      )
      .join("");
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  const canChat = Boolean(state.user) && (q.status === "open" || q.is_creator || q.is_claimer);
  $("chat-input").disabled = !canChat;
  $("chat-input").placeholder = canChat ? "Send a quick message..." : "Sign in to chat on open quests";
}

async function questAction(questId, action, toastText, closeAfter = false) {
  try {
    await api(`/api/quests/${questId}/${action}`, { method: "POST", body: "{}" });
    if (action === "claim") playSfx("accept");
    showToast(toastText);
    if (closeAfter) {
      closeModal("detail-modal");
      await refreshActiveView();
    } else {
      await refreshAfterAction(questId);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function refreshAfterAction(questId) {
  await refreshActiveView();
  if (state.activeQuestId === questId) {
    const data = await api(`/api/quests/${questId}`);
    renderQuestDetail(data.quest, data.messages || []);
  }
}

async function refreshActiveView() {
  if (state.activeView === "board") await loadBoard();
  if (state.activeView === "mine") await loadMyQuests();
  if (state.activeView === "leaderboard") await loadLeaderboard();
}

/* ---- Leaderboard ---- */
async function loadLeaderboard() {
  try {
    state.leaderboard = await api("/api/leaderboard");
    renderLeaderboard();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderLeaderboard() {
  if (!state.leaderboard) return;
  $("lb-heroes").innerHTML = state.leaderboard.heroes
    .map(
      (h, i) => `
    <div class="lb-row">
      <div class="lb-left">
        <span class="lb-rank rank-${i + 1}">#${i + 1}</span>
        <span class="hero-avatar-box">${renderAvatarSvg(h.avatar, h.name)}</span>
        <div>
          <span class="lb-name">${escapeHtml(h.name)}</span>
          <span class="lb-sub">Lv.${h.level} ${escapeHtml(h.rank)} • ${escapeHtml(h.department)}</span>
        </div>
      </div>
      <span class="lb-xp">${h.xp} XP</span>
    </div>`
    )
    .join("");

  const list = state.leaderboard[state.guildMode] || [];
  const maxXp = Math.max(1, ...list.map((g) => g.total_xp));
  const key = state.guildMode === "departments" ? "department" : "hostel";
  $("lb-guilds").innerHTML = list
    .map((g) => {
      const pct = Math.round((g.total_xp / maxXp) * 100);
      return `
      <div class="lb-row guild-row">
        <div class="guild-top">
          <div>
            <span class="lb-name">${escapeHtml(g[key])}</span>
            <span class="lb-sub">${g.members} heroes • ${g.total_done} quests done</span>
          </div>
          <span class="lb-xp">${g.total_xp} XP</span>
        </div>
        <div class="xp-track"><div class="xp-fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");
}

/* ---- Profile Modal ---- */
function openProfileModal() {
  if (!state.user) return;
  const u = state.user;
  $("profile-avatar").innerHTML = `<span class="hero-avatar-box">${renderAvatarSvg(u.avatar, u.name)}</span>`;
  $("profile-name").textContent = u.name;
  $("profile-subtitle").textContent = `Lv.${u.level} ${u.rank} • ${u.hero_class} (${u.department})`;
  $("profile-xp-label").textContent = `${u.xp_in_level} / ${u.xp_next_level} XP (${u.xp} total)`;
  $("profile-reliability").textContent = `${u.reliability}% Reliable`;
  $("profile-xp-fill").style.width = `${Math.min(100, Math.round((u.xp_in_level / u.xp_next_level) * 100))}%`;

  const earnedSet = new Set((u.badges || []).map((b) => b.id));
  const catalog = state.meta?.badges || BADGES_META;
  $("profile-badges").innerHTML = catalog
    .map(
      (b) => `
    <div class="badge-tile ${earnedSet.has(b.id) ? "" : "locked"}">
      <span class="badge-crest">${escapeHtml(formatBadgeCode(b.icon, b.name))}</span>
      <span><strong>${escapeHtml(b.name)}</strong><small>${escapeHtml(b.description)}</small></span>
    </div>`
    )
    .join("");

  openModal("profile-modal");
}

/* ---- Live SSE Updates (Backend mode only) ---- */
function connectEvents() {
  if (state.staticMode || !window.EventSource) return;
  const es = new EventSource("./api/events");
  es.addEventListener("board_update", async () => {
    await refreshActiveView();
    if (state.activeQuestId) {
      try {
        const data = await api(`/api/quests/${state.activeQuestId}`);
        renderQuestDetail(data.quest, data.messages || []);
      } catch {
        // Ignore if closed
      }
    }
  });
  es.addEventListener("quest_message", async (e) => {
    const payload = JSON.parse(e.data || "{}");
    if (state.activeQuestId && payload.quest_id === state.activeQuestId) {
      const data = await api(`/api/quests/${state.activeQuestId}`);
      renderQuestDetail(data.quest, data.messages || []);
    }
  });
}

/* ---- Event Wiring ---- */
function bindEvents() {
  $("brand-btn").onclick = () => switchView("board");

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  $("theme-toggle").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("csq_theme", state.theme);
    renderHud();
  };

  $("sfx-toggle").onclick = () => {
    state.sfxEnabled = !state.sfxEnabled;
    localStorage.setItem("csq_sfx", state.sfxEnabled ? "on" : "off");
    renderHud();
    if (state.sfxEnabled) playSfx("chime");
  };

  $("signin-open-btn").onclick = () => openModal("auth-modal");
  $("mine-signin-btn").onclick = () => openModal("auth-modal");
  $("hero-pill").onclick = openProfileModal;

  const openPost = () => {
    if (!state.user) {
      openModal("auth-modal");
      showToast("Pick a hero or sign in first to post a quest");
      return;
    }
    openModal("create-modal");
  };
  $("new-quest-btn").onclick = openPost;
  $("empty-post-btn").onclick = openPost;

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    };
  });

  $("category-filters").onclick = (e) => {
    const pill = e.target.closest(".filter-pill");
    if (!pill) return;
    state.activeCategory = pill.dataset.cat;
    document.querySelectorAll(".filter-pill").forEach((p) => p.classList.toggle("active", p === pill));
    loadBoard();
  };

  let searchTimer = null;
  $("search-input").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      loadBoard();
    }, 180);
  };

  const handleGridClick = (e) => {
    const card = e.target.closest(".quest-card");
    if (card) openQuestDetail(Number(card.dataset.questId));
  };
  $("board-grid").onclick = handleGridClick;
  $("mine-grid").onclick = handleGridClick;

  $("guild-toggle").onclick = (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.guildMode = btn.dataset.guild;
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderLeaderboard();
  };

  $("mine-filter").onclick = (e) => {
    const btn = e.target.closest("[data-mine-filter]");
    if (!btn) return;
    state.myFilter = btn.dataset.mineFilter;
    document.querySelectorAll("[data-mine-filter]").forEach((b) => b.classList.toggle("active", b === btn));
    renderMyQuests();
  };

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.onclick = () => {
      const target = tab.dataset.authTab;
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
      $("auth-pane-demo").classList.toggle("active", target === "demo");
      $("login-form").classList.toggle("active", target === "login");
      $("register-form").classList.toggle("active", target === "register");
    };
  });

  document.querySelectorAll(".demo-card").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const res = await api("/api/auth/demo", {
          method: "POST",
          body: JSON.stringify({ email: btn.dataset.demoEmail }),
        });
        setSession(res.token, res.user);
        closeModal("auth-modal");
        playSfx("chime");
        showToast(`Welcome, ${res.user.name}!`);
        await refreshActiveView();
      } catch (err) {
        showToast(err.message, true);
      }
    };
  });

  $("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      setSession(res.token, res.user);
      closeModal("auth-modal");
      playSfx("chime");
      showToast(`Signed in as ${res.user.name}`);
      await refreshActiveView();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $("register-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const res = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      setSession(res.token, res.user);
      closeModal("auth-modal");
      playSfx("victory");
      showToast(`Hero created! Welcome, ${res.user.name}`);
      await refreshActiveView();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $("create-quest-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    try {
      await api("/api/quests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      e.target.reset();
      closeModal("create-modal");
      playSfx("chime");
      showToast("Quest published to the board!");
      switchView("board");
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $("chat-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.activeQuestId) return;
    const body = $("chat-input").value.trim();
    if (!body) return;
    try {
      await api(`/api/quests/${state.activeQuestId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      $("chat-input").value = "";
      const data = await api(`/api/quests/${state.activeQuestId}`);
      renderQuestDetail(data.quest, data.messages || []);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $("switch-hero-btn").onclick = () => {
    closeModal("profile-modal");
    openModal("auth-modal");
  };
  $("logout-btn").onclick = () => {
    setSession("", null);
    closeModal("profile-modal");
    showToast("Signed out");
    refreshActiveView();
  };
}

/* ---- Detect Backend vs Static Hosting ---- */
async function detectBackend() {
  if (location.hostname.endsWith("github.io")) {
    return false;
  }
  try {
    const res = await fetch("./api/health", { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.status === "ok";
  } catch {
    return false;
  }
}

/* ---- Bootstrap ---- */
async function init() {
  document.querySelectorAll("[data-avatar-key]").forEach((el) => {
    el.innerHTML = renderAvatarSvg(el.dataset.avatarKey, el.dataset.avatarKey);
  });
  bindEvents();
  renderHud();

  const hasBackend = await detectBackend();
  state.staticMode = !hasBackend;
  if (state.staticMode) {
    $("mode-pill").innerHTML = '<span class="pulse-dot"></span> Interactive Demo Mode (Browser Storage)';
  }

  try {
    state.meta = await api("/api/meta");
  } catch {
    state.meta = { badges: BADGES_META };
  }

  if (state.token) {
    try {
      const me = await api("/api/me");
      state.user = me.user;
      renderHud();
    } catch {
      setSession("", null);
    }
  }

  await loadBoard();
  connectEvents();
}

init();
