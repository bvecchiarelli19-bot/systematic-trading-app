/* === Systematic Trading Screener — Frontend Logic === */

const API = {
    async get(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
    },
    async post(url) {
        const res = await fetch(url, { method: "POST" });
        return res.json();
    },
};

// ── State ──────────────────────────────────────────────
const state = {
    data: null,
    status: null,
    search: "",
    regime: "",
    sector: "",
    candidatesOnly: true,
    sortBy: "composite_score",
    sortDir: "asc",
    selectedTicker: null,
    detail: null,
    polling: null,
    page: 0,
    pageSize: 25,
};

// ── Init ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    pollStatus();
    fetchData();
    // Poll every 15 seconds for status updates
    state.polling = setInterval(() => {
        pollStatus();
        fetchData();
    }, 15000);
});

function setupEventListeners() {
    document.getElementById("search").addEventListener("input", (e) => {
        state.search = e.target.value.toLowerCase();
        renderTable();
    });

    document.getElementById("regime-filter").addEventListener("change", (e) => {
        state.regime = e.target.value;
        fetchData();
    });

    document.getElementById("sector-filter").addEventListener("change", (e) => {
        state.sector = e.target.value;
        fetchData();
    });

    document.getElementById("refresh-btn").addEventListener("click", async () => {
        const btn = document.getElementById("refresh-btn");
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></span> Refreshing...';
        try {
            await API.post("/api/refresh");
        } catch (e) {
            console.error(e);
        }
        // Re-enable after 5 seconds
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '&#8635; Refresh Data';
        }, 5000);
    });

    // Toggle buttons for candidates/all
    document.querySelectorAll(".toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.candidatesOnly = btn.dataset.value === "candidates";
            fetchData();
        });
    });

    // Close detail panel
    document.getElementById("detail-overlay").addEventListener("click", (e) => {
        if (e.target.id === "detail-overlay") closeDetail();
    });

    document.getElementById("close-detail").addEventListener("click", closeDetail);

    // Keyboard
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDetail();
    });
}

// ── Data Fetching ──────────────────────────────────────
async function fetchData() {
    try {
        const params = new URLSearchParams();
        if (state.regime) params.set("regime", state.regime);
        if (state.sector) params.set("sector", state.sector);
        params.set("sort", state.sortBy);
        params.set("direction", state.sortDir);
        params.set("candidates_only", state.candidatesOnly);

        state.data = await API.get(`/api/screener?${params}`);
        renderStats();
        renderTable();
        populateSectorFilter();
    } catch (e) {
        console.error("Failed to fetch data:", e);
    }
}

async function pollStatus() {
    try {
        state.status = await API.get("/api/status");
        renderStatus();
    } catch (e) {
        console.error("Failed to fetch status:", e);
    }
}

async function fetchDetail(ticker) {
    try {
        state.detail = await API.get(`/api/screener/${ticker}`);
        renderDetail();
    } catch (e) {
        console.error("Failed to fetch detail:", e);
    }
}

// ── Rendering ──────────────────────────────────────────
function renderStatus() {
    const s = state.status;
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");

    if (s.is_running) {
        dot.className = "status-dot loading";
        text.textContent = "Loading market data...";
    } else if (s.last_error) {
        dot.className = "status-dot error";
        text.textContent = "Error — " + s.last_error.substring(0, 40);
    } else if (s.last_refresh) {
        dot.className = "status-dot";
        const ago = timeAgo(s.last_refresh);
        text.textContent = `Updated ${ago}`;
    } else {
        dot.className = "status-dot loading";
        text.textContent = "Waiting for initial data load...";
    }
}

function renderStats() {
    const d = state.data;
    if (!d) return;

    document.getElementById("stat-screened").textContent = d.total_screened || "—";
    document.getElementById("stat-passing").textContent = d.total_passing || "—";
    document.getElementById("stat-displayed").textContent = d.candidates?.length || "0";

    // Regime distribution
    const regimes = { CALM: 0, CAUTIOUS: 0, RISKY: 0, CRISIS: 0 };
    if (d.candidates) {
        d.candidates.forEach((c) => {
            if (regimes.hasOwnProperty(c.regime)) regimes[c.regime]++;
        });
    }
    const distHtml = Object.entries(regimes)
        .map(([r, n]) => `<span class="regime-badge regime-${r}" style="margin-right:6px">${r} ${n}</span>`)
        .join("");
    document.getElementById("stat-regimes").innerHTML = distHtml;
}

function renderTable() {
    const d = state.data;
    const tbody = document.getElementById("table-body");
    const loading = document.getElementById("loading-state");
    const table = document.getElementById("main-table");

    if (!d || !d.candidates) {
        loading.style.display = "flex";
        table.style.display = "none";
        return;
    }

    loading.style.display = "none";
    table.style.display = "table";

    let items = d.candidates;

    // Client-side search filter
    if (state.search) {
        items = items.filter(
            (c) =>
                c.ticker.toLowerCase().includes(state.search) ||
                (c.name && c.name.toLowerCase().includes(state.search)) ||
                (c.sector && c.sector.toLowerCase().includes(state.search))
        );
    }

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="11" class="empty-state">
                <div class="icon">&#128270;</div>
                <div>No stocks match your filters</div>
            </td></tr>`;
        document.getElementById("pagination").innerHTML = "";
        return;
    }

    // Pagination
    const totalPages = Math.ceil(items.length / state.pageSize);
    if (state.page >= totalPages) state.page = totalPages - 1;
    if (state.page < 0) state.page = 0;
    const start = state.page * state.pageSize;
    const pageItems = items.slice(start, start + state.pageSize);

    tbody.innerHTML = pageItems
        .map(
            (c) => `
        <tr class="candidate-row" onclick="openDetail('${c.ticker}')">
            <td class="ticker-cell">${c.ticker}</td>
            <td class="name-cell" title="${esc(c.name)}">${esc(c.name)}</td>
            <td class="sector-cell">${esc(c.sector)}</td>
            <td class="price-cell">$${c.price?.toFixed(2) ?? "—"}</td>
            <td><span class="regime-badge regime-${c.regime}">${c.regime}</span></td>
            <td>${renderPosBar(c.position_pct)}</td>
            <td class="numeric-cell">${renderScoreDots(c.scores.vol, "Vol")}</td>
            <td class="numeric-cell">${renderScoreDots(c.scores.trend, "SMA")}</td>
            <td class="numeric-cell">${renderScoreDots(c.scores.hurst, "H")}</td>
            <td class="numeric-cell">${renderScoreDots(c.scores.tail, "Tail")}</td>
            <td class="numeric-cell" style="font-weight:700">${c.composite_score ?? "—"}</td>
        </tr>`
        )
        .join("");

    // Render pagination controls
    renderPagination(items.length, totalPages);
}

function renderPagination(totalItems, totalPages) {
    const el = document.getElementById("pagination");
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        pages.push(
            `<button class="btn ${i === state.page ? "btn-primary" : ""}" onclick="goToPage(${i})" style="min-width:36px;padding:6px 10px">${i + 1}</button>`
        );
    }

    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border)">
            <span style="font-size:12px;color:var(--text-muted)">Showing ${state.page * state.pageSize + 1}–${Math.min((state.page + 1) * state.pageSize, totalItems)} of ${totalItems}</span>
            <div style="display:flex;gap:4px">
                <button class="btn" onclick="goToPage(${state.page - 1})" ${state.page === 0 ? "disabled" : ""} style="padding:6px 10px">&#8249; Prev</button>
                ${pages.join("")}
                <button class="btn" onclick="goToPage(${state.page + 1})" ${state.page >= totalPages - 1 ? "disabled" : ""} style="padding:6px 10px">Next &#8250;</button>
            </div>
        </div>`;
}

function renderPosBar(pct) {
    const cls = pct >= 100 ? "pct-100" : pct >= 66 ? "pct-66" : pct >= 33 ? "pct-33" : "pct-0";
    return `<div class="pos-bar-container">
        <div class="pos-bar"><div class="pos-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="pos-label">${pct}%</span>
    </div>`;
}

function renderScoreDots(score, label) {
    let html = '<div class="score-dots" title="' + label + ': ' + score + '/3">';
    for (let i = 0; i < 3; i++) {
        html += `<div class="score-dot ${i < score ? "filled-" + score : ""}"></div>`;
    }
    html += "</div>";
    return html;
}

function populateSectorFilter() {
    const select = document.getElementById("sector-filter");
    const d = state.data;
    if (!d || !d.sectors) return;

    const current = select.value;
    const options = ['<option value="">All Sectors</option>'];
    d.sectors.forEach((s) => {
        options.push(`<option value="${esc(s)}" ${s === current ? "selected" : ""}>${esc(s)}</option>`);
    });
    select.innerHTML = options.join("");
}

// ── Sorting ────────────────────────────────────────────
function sortTable(col) {
    if (state.sortBy === col) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
        state.sortBy = col;
        state.sortDir = "asc";
    }

    // Update header styles
    document.querySelectorAll("th[data-sort]").forEach((th) => {
        th.classList.toggle("sorted", th.dataset.sort === col);
        const arrow = th.querySelector(".sort-arrow");
        if (arrow) {
            arrow.textContent = th.dataset.sort === col ? (state.sortDir === "asc" ? "▲" : "▼") : "";
        }
    });

    fetchData();
}

// ── Detail Panel ───────────────────────────────────────
function openDetail(ticker) {
    state.selectedTicker = ticker;
    document.getElementById("detail-overlay").classList.add("open");
    fetchDetail(ticker);
}

function closeDetail() {
    state.selectedTicker = null;
    document.getElementById("detail-overlay").classList.remove("open");
}

function renderDetail() {
    const d = state.detail;
    if (!d) return;

    document.getElementById("detail-ticker").textContent = d.ticker;
    document.getElementById("detail-name").textContent = d.name;
    document.getElementById("detail-sector").textContent = d.sector;
    document.getElementById("detail-price").textContent = `$${d.price?.toFixed(2) ?? "—"}`;
    document.getElementById("detail-regime").className = `regime-badge regime-${d.regime}`;
    document.getElementById("detail-regime").textContent = d.regime;
    document.getElementById("detail-position").textContent = `${d.position_pct}%`;
    document.getElementById("detail-composite").textContent = d.composite_score;

    // Indicators
    document.getElementById("detail-vol").textContent = d.indicators.vol_percentile?.toFixed(1) + "%" ?? "—";
    document.getElementById("detail-sma").textContent = d.indicators.sma_trend ?? "—";
    document.getElementById("detail-sma").className =
        "indicator-value " + (d.indicators.sma_trend === "ABOVE" ? "green" : "red");
    document.getElementById("detail-hurst").textContent = d.indicators.hurst?.toFixed(3) ?? "—";
    document.getElementById("detail-tail").textContent = d.indicators.tail_risk?.toFixed(2) + "%" ?? "—";

    // Scores
    document.getElementById("detail-vol-score").textContent = d.scores.vol + "/3";
    document.getElementById("detail-trend-score").textContent = d.scores.trend + "/3";
    document.getElementById("detail-hurst-score").textContent = d.scores.hurst + "/3";
    document.getElementById("detail-tail-score").textContent = d.scores.tail + "/3";

    // Show/hide validate button based on gate status
    const passesGates = (d.regime === "CALM" || d.regime === "CAUTIOUS") && d.indicators.sma_trend === "ABOVE";
    const validateSection = document.getElementById("validate-section");
    const noValidateSection = document.getElementById("no-validate-section");

    if (passesGates) {
        validateSection.style.display = "block";
        noValidateSection.style.display = "none";
    } else {
        validateSection.style.display = "none";
        noValidateSection.style.display = "block";
        const reasons = [];
        if (d.regime !== "CALM" && d.regime !== "CAUTIOUS") reasons.push(`Regime is ${d.regime}`);
        if (d.indicators.sma_trend !== "ABOVE") reasons.push("Price below 10M SMA");
        document.getElementById("gate-fail-reason").textContent = reasons.join(" · ");
    }

    // Draw sparkline (after validate section, so errors don't block it)
    if (d.price_history && d.price_history.length > 0) {
        try { drawSparkline(d.price_history); } catch (e) { console.warn("Sparkline error:", e); }
    }
}

function drawSparkline(priceHistory) {
    const canvas = document.getElementById("sparkline-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const prices = priceHistory.map((p) => p.close);
    const min = Math.min(...prices) * 0.998;
    const max = Math.max(...prices) * 1.002;
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);

    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    const trending = prices[prices.length - 1] >= prices[0];
    const color = trending ? "34, 197, 94" : "239, 68, 68";
    grad.addColorStop(0, `rgba(${color}, 0.15)`);
    grad.addColorStop(1, `rgba(${color}, 0)`);

    ctx.beginPath();
    ctx.moveTo(0, h);
    prices.forEach((p, i) => {
        const x = (i / (prices.length - 1)) * w;
        const y = h - ((p - min) / range) * h;
        ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    prices.forEach((p, i) => {
        const x = (i / (prices.length - 1)) * w;
        const y = h - ((p - min) / range) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = trending ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

// ── Helpers ────────────────────────────────────────────
function esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
}

function validateTrade() {
    const d = state.detail;
    if (!d) return;

    // Store the candidate data for Module 2
    const tradeData = {
        ticker: d.ticker,
        name: d.name,
        sector: d.sector,
        price: d.price,
        regime: d.regime,
        position_pct: d.position_pct,
        composite_score: d.composite_score,
        indicators: d.indicators,
        scores: d.scores,
        screened_at: new Date().toISOString(),
    };
    localStorage.setItem("pending_validation", JSON.stringify(tradeData));

    // Navigate to Module 2 (pre-trade validation)
    window.location.href = `/validate?ticker=${d.ticker}`;
}

function goToPage(page) {
    state.page = page;
    renderTable();
    // Scroll table into view
    document.querySelector(".table-container")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Expose to HTML onclick
window.sortTable = sortTable;
window.openDetail = openDetail;
window.goToPage = goToPage;
window.validateTrade = validateTrade;
