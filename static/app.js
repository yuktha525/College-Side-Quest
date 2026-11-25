/* CampusSideQuest — Lightweight RPG Quest Board Client */

const state = {
  token: localStorage.getItem("csq_token") || "",
  user: null,
  meta: null,
  quests: [],
  myQuests: [],
  leaderboard: null,
  guildMode: "departments",
  activeView: "board",
  activeCategory: "all",
  searchQuery: "",
  activeQuestId: null,
  sfxEnabled: localStorage.getItem("csq_sfx") !== "off",
};

const CAT_ICONS = {
  rescue: "⚡",
  skill: "🧠",
  errand: "🏃",
  squad: "🎮",
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/* ---- API Helper ---- */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }
  const res = await fetch(path, { ...options, headers });
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

function renderHud() {
  $("sfx-toggle").textContent = state.sfxEnabled ? "🔊" : "🔇";

  if (state.user) {
    $("hero-pill").classList.remove("hidden");
    $("signin-open-btn").classList.add("hidden");
    $("hud-avatar").textContent = state.user.avatar;
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
  const icon = CAT_ICONS[q.category] || "⚔️";
  const statusTag =
    q.status === "open"
      ? `<span class="card-timer">⏱ ${escapeHtml(formatTimeLeft(q.expires_at))}</span>`
      : `<span class="status-pill status-${escapeHtml(q.status)}">${escapeHtml(q.status)}</span>`;

  let ctaLabel = "Inspect";
  if (q.status === "open" && !q.is_creator) ctaLabel = "Accept Quest";
  if (q.status === "claimed" && q.is_claimer) ctaLabel = "Enter PIN";
  if (q.is_creator && q.status !== "completed") ctaLabel = "Manage";

  return `
    <article class="quest-card" data-cat="${escapeHtml(q.category)}" data-quest-id="${q.id}">
      <div class="card-top">
        <span class="cat-badge cat-${escapeHtml(q.category)}">${icon} ${escapeHtml(q.category_label)}</span>
        ${statusTag}
      </div>
      <h3 class="card-title">${escapeHtml(q.title)}</h3>
      <div class="card-location">📍 ${escapeHtml(q.location)} • ${escapeHtml(q.creator.avatar)} ${escapeHtml(q.creator.name)}</div>
      <div class="card-bottom">
        <div class="card-rewards">
          <span class="reward-pill">🎁 ${escapeHtml(q.reward_text)}</span>
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
    $("mine-guest").classList.remove("hidden");
    $("mine-grid").innerHTML = "";
    $("mine-empty").classList.add("hidden");
    return;
  }
  $("mine-guest").classList.add("hidden");
  try {
    const data = await api("/api/quests?scope=mine");
    state.myQuests = data.quests || [];
    if (!state.myQuests.length) {
      $("mine-grid").innerHTML = "";
      $("mine-empty").classList.remove("hidden");
      return;
    }
    $("mine-empty").classList.add("hidden");
    $("mine-grid").innerHTML = state.myQuests.map(createQuestCardHtml).join("");
  } catch (err) {
    showToast(err.message, true);
  }
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
  const icon = CAT_ICONS[q.category] || "⚔️";
  const catEl = $("detail-category");
  catEl.className = `cat-badge cat-${q.category}`;
  catEl.textContent = `${icon} ${q.category_label}`;

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
      <span class="lb-avatar">${escapeHtml(q.creator.avatar)}</span>
      <span><strong>Posted by ${escapeHtml(q.creator.name)}</strong><br/><small class="lb-sub">Lv.${q.creator.level} ${escapeHtml(q.creator.department)} • ${q.creator.reliability}% reliable</small></span>
    </div>`,
  ];
  if (q.claimer) {
    partyHtml.push(
      `<div class="party-chip">
        <span class="lb-avatar">${escapeHtml(q.claimer.avatar)}</span>
        <span><strong>Accepted by ${escapeHtml(q.claimer.name)}</strong><br/><small class="lb-sub">Lv.${q.claimer.level} ${escapeHtml(q.claimer.department)} • ${q.claimer.reliability}% reliable</small></span>
      </div>`
    );
  }
  $("detail-party").innerHTML = partyHtml.join("");

  // Handshake / Action Box
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
    box.innerHTML = `<div class="action-row"><strong>🎉 Quest Completed!</strong><span>XP and badges have been awarded.</span></div>`;
  } else if (q.status === "cancelled" || q.status === "expired") {
    box.innerHTML = `<div class="action-row"><span>This quest is ${escapeHtml(q.status)}.</span></div>`;
  } else if (q.is_creator) {
    box.innerHTML = `
      <div>
        <strong>🔑 Handshake PIN (share in person when done):</strong>
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
        <button class="btn btn-emerald" id="detail-claim-btn" type="button">⚔️ Accept Quest (+${q.xp_value} XP)</button>
      </div>
    `;
    $("detail-claim-btn").onclick = () => questAction(q.id, "claim", "Quest accepted! Head to the meetup spot.");
  } else if (q.status === "claimed" && q.is_claimer) {
    box.innerHTML = `
      <div>
        <strong>🤝 Enter Poster's 4-Digit Handshake PIN to Claim +${q.xp_value} XP:</strong>
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
            ? ` Badge unlocked: ${res.new_badges.map((b) => `${b.icon} ${b.name}`).join(", ")}!`
            : "";
        showToast(`+${res.xp_awarded} XP earned!${badgeText}`);
        await refreshAfterAction(q.id);
      } catch (err) {
        showToast(err.message, true);
      }
    };
    $("detail-unclaim-btn").onclick = () => questAction(q.id, "unclaim", "Quest released back to the board");
  } else {
    box.innerHTML = `<div class="action-row"><span>🔒 Another campus hero is currently completing this quest.</span></div>`;
  }

  // Messages
  const msgContainer = $("detail-messages");
  if (!messages.length) {
    msgContainer.innerHTML = `<div class="muted-text" style="font-size:0.84rem;">No messages yet. Say hello to coordinate!</div>`;
  } else {
    msgContainer.innerHTML = messages
      .map(
        (m) => `
      <div class="chat-msg">
        <div class="chat-msg-head">
          <strong>${escapeHtml(m.sender_avatar)} ${escapeHtml(m.sender_name)}</strong>
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
  const medals = ["🥇", "🥈", "🥉"];
  $("lb-heroes").innerHTML = state.leaderboard.heroes
    .map(
      (h, i) => `
    <div class="lb-row">
      <div class="lb-left">
        <span class="lb-rank">${medals[i] || `#${i + 1}`}</span>
        <span class="lb-avatar">${escapeHtml(h.avatar)}</span>
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
  $("profile-avatar").textContent = u.avatar;
  $("profile-name").textContent = u.name;
  $("profile-subtitle").textContent = `Lv.${u.level} ${u.rank} • ${u.hero_class} (${u.department})`;
  $("profile-xp-label").textContent = `${u.xp_in_level} / ${u.xp_next_level} XP (${u.xp} total)`;
  $("profile-reliability").textContent = `${u.reliability}% Reliable`;
  $("profile-xp-fill").style.width = `${Math.min(100, Math.round((u.xp_in_level / u.xp_next_level) * 100))}%`;

  const earnedSet = new Set((u.badges || []).map((b) => b.id));
  const catalog = state.meta?.badges || [];
  $("profile-badges").innerHTML = catalog
    .map(
      (b) => `
    <div class="badge-tile ${earnedSet.has(b.id) ? "" : "locked"}">
      <span style="font-size:1.3rem;">${escapeHtml(b.icon)}</span>
      <span><strong>${escapeHtml(b.name)}</strong><small>${escapeHtml(b.description)}</small></span>
    </div>`
    )
    .join("");

  openModal("profile-modal");
}

/* ---- Live SSE Updates ---- */
function connectEvents() {
  if (!window.EventSource) return;
  const es = new EventSource("/api/events");
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

  // Category filters
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

  // Click card to open detail
  const handleGridClick = (e) => {
    const card = e.target.closest(".quest-card");
    if (card) openQuestDetail(Number(card.dataset.questId));
  };
  $("board-grid").onclick = handleGridClick;
  $("mine-grid").onclick = handleGridClick;

  // Guild toggle
  $("guild-toggle").onclick = (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.guildMode = btn.dataset.guild;
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderLeaderboard();
  };

  // Auth tabs
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.onclick = () => {
      const target = tab.dataset.authTab;
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
      $("auth-pane-demo").classList.toggle("active", target === "demo");
      $("login-form").classList.toggle("active", target === "login");
      $("register-form").classList.toggle("active", target === "register");
    };
  });

  // Demo quick login
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
        showToast(`Welcome, ${res.user.avatar} ${res.user.name}!`);
        await refreshActiveView();
      } catch (err) {
        showToast(err.message, true);
      }
    };
  });

  // Email login
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

  // Register
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

  // Create quest
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

  // Chat message
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

  // Profile actions
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

/* ---- Bootstrap ---- */
async function init() {
  bindEvents();
  renderHud();

  try {
    state.meta = await api("/api/meta");
  } catch {
    state.meta = { badges: [] };
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
