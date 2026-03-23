/* === Trade Journal — Module 3 === */

const jState = {
    trades: [],
    currentTab: "open",
    closingTradeId: null,
};

// ── Init ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    checkPendingEntry();
    loadTrades();
    loadStats();

    // Show/hide prediction prob field based on trade type
    document.getElementById("f-type").addEventListener("change", (e) => {
        document.getElementById("f-pred-group").style.display =
            e.target.value === "prediction" ? "block" : "none";
    });
});

// ── Check for pending journal entry from Module 2 ────
function checkPendingEntry() {
    const raw = localStorage.getItem("pending_journal_entry");
    if (!raw) return;

    try {
        const data = JSON.parse(raw);
        localStorage.removeItem("pending_journal_entry");
        openNewTradeForm();
        prefillForm(data);
    } catch (e) {
        console.warn("Failed to parse pending journal entry:", e);
    }
}

function prefillForm(data) {
    document.getElementById("f-ticker").value = data.ticker || "";
    document.getElementById("f-price").value = data.price || "";
    document.getElementById("f-date").value = new Date().toISOString().split("T")[0];
    document.getElementById("f-regime").value = data.regime || "";
    document.getElementById("f-thesis").value = data.thesis || "";
    document.getElementById("f-target").value = data.target_price || "";
    document.getElementById("f-stop").value = data.stop_price || "";

    // Hidden fields
    document.getElementById("f-name").value = data.name || "";
    document.getElementById("f-sector").value = data.sector || "";
    document.getElementById("f-composite").value = data.composite_score ?? "";
    document.getElementById("f-positionpct").value = data.position_pct ?? "";
    document.getElementById("f-asymmetry").value = data.asymmetry_ratio ?? "";
    document.getElementById("f-biasscore").value = data.bias_score ?? "";
    document.getElementById("f-regimeconfirmed").value = data.regime_confirmed ?? "";
    document.getElementById("f-vol").value = data.indicators?.vol_percentile ?? "";
    document.getElementById("f-sma").value = data.indicators?.sma_trend ?? "";
    document.getElementById("f-hurst").value = data.indicators?.hurst ?? "";
    document.getElementById("f-tailrisk").value = data.indicators?.tail_risk ?? "";
}

// ── API Calls ────────────────────────────────────────
async function loadTrades() {
    try {
        const res = await fetch("/api/journal");
        jState.trades = await res.json();
        renderTable();
    } catch (e) {
        console.error("Failed to load trades:", e);
    }
}

async function loadStats() {
    try {
        const res = await fetch("/api/journal/stats");
        const s = await res.json();
        renderDashboard(s);
    } catch (e) {
        console.error("Failed to load stats:", e);
    }
}

// ── Dashboard ────────────────────────────────────────
function renderDashboard(s) {
    document.getElementById("d-total").textContent = s.total_trades;
    document.getElementById("d-open").textContent = s.open_trades;
    document.getElementById("d-closed").textContent = s.closed_trades;

    const winEl = document.getElementById("d-winrate");
    winEl.textContent = s.closed_trades > 0 ? s.win_rate + "%" : "—";
    winEl.className = "dash-value mono" + (s.win_rate >= 50 ? " green" : s.closed_trades > 0 ? " red" : "");
    document.getElementById("d-wins").textContent = s.wins;
    document.getElementById("d-losses").textContent = s.losses;

    const regEl = document.getElementById("d-regime");
    regEl.textContent = s.closed_trades > 0 ? s.regime_accuracy + "%" : "—";
    regEl.className = "dash-value mono" + (s.regime_accuracy >= 60 ? " green" : s.closed_trades > 0 ? " yellow" : "");

    const thEl = document.getElementById("d-thesis");
    thEl.textContent = s.closed_trades > 0 ? s.thesis_accuracy + "%" : "—";
    thEl.className = "dash-value mono" + (s.thesis_accuracy >= 60 ? " green" : s.closed_trades > 0 ? " yellow" : "");

    document.getElementById("d-asym").textContent = s.avg_asymmetry > 0 ? s.avg_asymmetry + "x" : "—";

    const pnlEl = document.getElementById("d-pnl");
    const pnlVal = s.total_pnl_dollars;
    pnlEl.textContent = (pnlVal >= 0 ? "+$" : "-$") + Math.abs(pnlVal).toLocaleString();
    pnlEl.className = "dash-value mono" + (pnlVal >= 0 ? " green" : " red");
    document.getElementById("d-avgpnl").textContent = s.avg_pnl_pct + "%";

    document.getElementById("d-dd").textContent = "$" + s.max_drawdown.toLocaleString();

    const brierEl = document.getElementById("d-brier");
    brierEl.textContent = s.brier_score !== null ? s.brier_score.toFixed(4) : "—";
    if (s.brier_score !== null) {
        brierEl.className = "dash-value mono" + (s.brier_score <= 0.25 ? " green" : s.brier_score <= 0.5 ? " yellow" : " red");
    }
    document.getElementById("d-predcount").textContent = s.prediction_trade_count;
}

// ── Trades Table ─────────────────────────────────────
function switchTab(tab) {
    jState.currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add("active");
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("trades-body");
    const empty = document.getElementById("empty-state");

    let filtered = jState.trades;
    if (jState.currentTab === "open") {
        filtered = filtered.filter(t => t.status === "OPEN");
    } else if (jState.currentTab === "closed") {
        filtered = filtered.filter(t => t.status === "CLOSED");
    }

    if (filtered.length === 0) {
        tbody.innerHTML = "";
        empty.style.display = "block";
        return;
    }

    empty.style.display = "none";
    tbody.innerHTML = filtered.map(t => {
        const daysHeld = calcDaysHeld(t);
        const statusHTML = t.status === "OPEN"
            ? '<span class="status-open">OPEN</span>'
            : `<span class="status-closed ${t.outcome?.toLowerCase()}">${t.outcome || "CLOSED"}</span>`;

        const actionsHTML = t.status === "OPEN"
            ? `<button class="action-btn close-trade" onclick="openCloseTrade(${t.id})">Close</button>
               <button class="action-btn delete" onclick="deleteTrade(${t.id})">&#10005;</button>`
            : `<button class="action-btn delete" onclick="deleteTrade(${t.id})">&#10005;</button>`;

        return `<tr>
            <td class="ticker-cell">${t.ticker}</td>
            <td><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase">${t.trade_type || "equity"}</span></td>
            <td style="font-family:var(--font-mono);font-size:12px">${t.entry_date || "—"}</td>
            <td class="price-cell">$${t.entry_price?.toFixed(2) ?? "—"}</td>
            <td class="numeric-cell">$${t.position_dollars?.toLocaleString() ?? "—"}</td>
            <td><span class="regime-badge regime-${t.regime_at_entry}">${t.regime_at_entry || "—"}</span></td>
            <td><div class="thesis-preview" title="${escapeHTML(t.thesis || "")}">${t.thesis?.substring(0, 40) || "—"}${(t.thesis?.length || 0) > 40 ? "..." : ""}</div></td>
            <td class="numeric-cell">${t.target_price ? "$" + t.target_price.toFixed(2) : "—"}</td>
            <td class="numeric-cell">${t.stop_price ? "$" + t.stop_price.toFixed(2) : "—"}</td>
            <td class="numeric-cell">${t.asymmetry_ratio ? t.asymmetry_ratio.toFixed(1) + "x" : "—"}</td>
            <td class="numeric-cell">${daysHeld}</td>
            <td>${statusHTML}${t.pnl_pct != null ? `<br><span style="font-size:11px;font-family:var(--font-mono);color:${t.pnl_pct >= 0 ? "var(--green)" : "var(--red)"}">${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct}%</span>` : ""}</td>
            <td>${actionsHTML}</td>
        </tr>`;
    }).join("");
}

function calcDaysHeld(t) {
    if (!t.entry_date) return "—";
    const entry = new Date(t.entry_date);
    const end = t.exit_date ? new Date(t.exit_date) : new Date();
    const diff = Math.floor((end - entry) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : 0;
}

function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── New Trade Modal ──────────────────────────────────
function openNewTradeForm() {
    document.getElementById("new-trade-modal").classList.add("open");
    if (!document.getElementById("f-date").value) {
        document.getElementById("f-date").value = new Date().toISOString().split("T")[0];
    }
}

function closeModal() {
    document.getElementById("new-trade-modal").classList.remove("open");
}

async function submitNewTrade() {
    const data = {
        ticker: document.getElementById("f-ticker").value.toUpperCase().trim(),
        name: document.getElementById("f-name").value || null,
        sector: document.getElementById("f-sector").value || null,
        entry_price: parseFloat(document.getElementById("f-price").value),
        entry_date: document.getElementById("f-date").value,
        trade_type: document.getElementById("f-type").value,
        position_dollars: parseFloat(document.getElementById("f-dollars").value) || 0,
        regime_at_entry: document.getElementById("f-regime").value || null,
        thesis: document.getElementById("f-thesis").value || null,
        target_price: parseFloat(document.getElementById("f-target").value) || null,
        stop_price: parseFloat(document.getElementById("f-stop").value) || null,
        composite_score: parseInt(document.getElementById("f-composite").value) || null,
        position_pct: parseInt(document.getElementById("f-positionpct").value) || null,
        asymmetry_ratio: parseFloat(document.getElementById("f-asymmetry").value) || null,
        bias_score: parseInt(document.getElementById("f-biasscore").value) || null,
        regime_confirmed: document.getElementById("f-regimeconfirmed").value === "true" ? true :
                           document.getElementById("f-regimeconfirmed").value === "false" ? false : null,
        vol_percentile: parseFloat(document.getElementById("f-vol").value) || null,
        sma_trend: document.getElementById("f-sma").value || null,
        hurst: parseFloat(document.getElementById("f-hurst").value) || null,
        tail_risk: parseFloat(document.getElementById("f-tailrisk").value) || null,
        predicted_probability: parseFloat(document.getElementById("f-predprob").value) || null,
    };

    if (!data.ticker || !data.entry_price || !data.entry_date) {
        alert("Ticker, entry price, and date are required.");
        return;
    }

    try {
        const res = await fetch("/api/journal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create trade");

        closeModal();
        clearForm();
        await loadTrades();
        await loadStats();
    } catch (e) {
        alert("Error creating trade: " + e.message);
    }
}

function clearForm() {
    document.querySelectorAll("#new-trade-modal .form-input").forEach(el => {
        if (el.tagName === "SELECT") el.selectedIndex = 0;
        else el.value = "";
    });
    document.querySelectorAll("#new-trade-modal input[type=hidden]").forEach(el => el.value = "");
}

// ── Close Trade Modal ────────────────────────────────
function openCloseTrade(id) {
    jState.closingTradeId = id;
    const trade = jState.trades.find(t => t.id === id);
    if (!trade) return;

    document.getElementById("close-ticker").textContent = trade.ticker;
    document.getElementById("close-info").innerHTML = `
        <strong>${trade.ticker}</strong> — Entered ${trade.entry_date} at $${trade.entry_price?.toFixed(2)}<br>
        Regime: ${trade.regime_at_entry || "—"} · Target: $${trade.target_price?.toFixed(2) || "—"} · Stop: $${trade.stop_price?.toFixed(2) || "—"}
    `;

    // Show prediction field if prediction market trade
    document.getElementById("c-pred-group").style.display =
        trade.trade_type === "prediction" ? "block" : "none";

    document.getElementById("close-trade-modal").classList.add("open");
}

function closeCloseModal() {
    document.getElementById("close-trade-modal").classList.remove("open");
    jState.closingTradeId = null;
}

async function submitCloseTrade() {
    const id = jState.closingTradeId;
    if (!id) return;

    const exitPrice = parseFloat(document.getElementById("c-exit").value);
    if (!exitPrice) {
        alert("Exit price is required.");
        return;
    }

    const data = {
        exit_price: exitPrice,
        outcome: document.getElementById("c-outcome").value,
        regime_correct: document.getElementById("c-regime").value === "true",
        thesis_correct: document.getElementById("c-thesis").value === "true",
        key_learning: document.getElementById("c-learning").value || "",
        actual_outcome_binary: document.getElementById("c-pred-group").style.display !== "none"
            ? parseInt(document.getElementById("c-actual").value) : null,
    };

    try {
        const res = await fetch(`/api/journal/${id}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to close trade");

        closeCloseModal();
        await loadTrades();
        await loadStats();
    } catch (e) {
        alert("Error closing trade: " + e.message);
    }
}

// ── Delete Trade ─────────────────────────────────────
async function deleteTrade(id) {
    if (!confirm("Delete this trade? This cannot be undone.")) return;

    try {
        const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete");
        await loadTrades();
        await loadStats();
    } catch (e) {
        alert("Error deleting trade: " + e.message);
    }
}

// ── Export ────────────────────────────────────────────
function exportExcel() {
    window.open("/api/journal/export", "_blank");
}

// ── Expose globals ───────────────────────────────────
window.openNewTradeForm = openNewTradeForm;
window.closeModal = closeModal;
window.submitNewTrade = submitNewTrade;
window.openCloseTrade = openCloseTrade;
window.closeCloseModal = closeCloseModal;
window.submitCloseTrade = submitCloseTrade;
window.deleteTrade = deleteTrade;
window.switchTab = switchTab;
window.exportExcel = exportExcel;
