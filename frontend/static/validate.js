/* === Pre-Trade Validation — Module 2 === */

// ── State ────────────────────────────────────────────
const vState = {
    currentStep: 1,
    stock: null,
    regimeConfirmed: null,  // true = agree, false = disagree
    thesis: "",
    targetPrice: null,
    stopPrice: null,
    asymmetryRatio: null,
    biasAnswers: {},        // { anchoring: bool, herding: bool, ... }
    decision: null,         // "GO" or "NO-GO"
};

// ── Init ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadStockData();
    setupThesisListener();
});

function loadStockData() {
    let raw = localStorage.getItem("pending_validation");

    // If no localStorage data, check URL params for ticker and try to build from query
    if (!raw) {
        const params = new URLSearchParams(window.location.search);
        const ticker = params.get("ticker");
        if (!ticker) {
            document.querySelector(".steps-wrapper").innerHTML =
                '<div class="step-card" style="text-align:center;padding:60px 20px;">' +
                '<h2>No Stock Selected</h2>' +
                '<p class="step-desc">Please select a candidate from the screener and click "Validate This Trade" to begin.</p>' +
                '<a href="/" class="btn btn-primary" style="margin-top:16px">Go to Screener</a></div>';
            return;
        }
    }

    try {
        vState.stock = JSON.parse(raw);
    } catch {
        document.querySelector(".steps-wrapper").innerHTML =
            '<div class="step-card" style="text-align:center;padding:60px 20px;">' +
            '<h2>Invalid Data</h2>' +
            '<p class="step-desc">The stock data could not be read. Please return to the screener and try again.</p>' +
            '<a href="/" class="btn btn-primary" style="margin-top:16px">Go to Screener</a></div>';
        return;
    }

    const s = vState.stock;

    // Header badge
    document.getElementById("header-ticker").textContent = s.ticker;
    document.getElementById("header-price").textContent = `$${s.price?.toFixed(2) ?? "—"}`;
    const regimeBadge = document.getElementById("header-regime");
    regimeBadge.textContent = s.regime;
    regimeBadge.className = `regime-badge regime-${s.regime}`;

    // Step 1: Regime info
    const regimeDisp = document.getElementById("regime-display");
    regimeDisp.textContent = s.regime;
    regimeDisp.className = `regime-badge regime-lg regime-${s.regime}`;

    document.getElementById("regime-score").textContent = s.composite_score ?? "—";
    document.getElementById("regime-vol").textContent =
        s.indicators?.vol_percentile != null ? s.indicators.vol_percentile.toFixed(1) + "%" : "—";
    document.getElementById("regime-sma").textContent = s.indicators?.sma_trend ?? "—";
    document.getElementById("regime-hurst").textContent =
        s.indicators?.hurst != null ? s.indicators.hurst.toFixed(3) : "—";
    document.getElementById("regime-tail").textContent =
        s.indicators?.tail_risk != null ? s.indicators.tail_risk.toFixed(2) + "%" : "—";

    // Step 2: Ticker reference
    document.getElementById("thesis-ticker").textContent = s.ticker;

    // Step 3: Current price
    document.getElementById("asym-current").textContent = `$${s.price?.toFixed(2) ?? "0.00"}`;

    // Step 4: Position size reference
    document.getElementById("bias-position").textContent = (s.position_pct ?? "—") + "%";
}

// ── Step Navigation ──────────────────────────────────
function goToStep(step) {
    if (step < 1 || step > 5) return;

    // Hide current step
    document.getElementById(`step-${vState.currentStep}`).classList.remove("active");

    // Show new step
    vState.currentStep = step;
    document.getElementById(`step-${step}`).classList.add("active");

    // Update progress indicators
    updateProgress();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateProgress() {
    const steps = document.querySelectorAll(".progress-step");
    const connectors = document.querySelectorAll(".progress-connector");

    steps.forEach((el, i) => {
        const stepNum = i + 1;
        el.classList.remove("active", "completed");
        if (stepNum === vState.currentStep) {
            el.classList.add("active");
        } else if (stepNum < vState.currentStep) {
            el.classList.add("completed");
        }
    });

    connectors.forEach((el, i) => {
        el.classList.toggle("completed", i + 1 < vState.currentStep);
    });
}

// ── Step 1: Regime Confirmation ──────────────────────
function confirmRegime(agrees) {
    vState.regimeConfirmed = agrees;

    // Update button styles
    const btns = document.querySelectorAll("#regime-confirm-btns .confirm-btn");
    btns.forEach(btn => btn.classList.remove("selected"));

    if (agrees) {
        btns[0].classList.add("selected");
        document.getElementById("disagree-warning").style.display = "none";
    } else {
        btns[1].classList.add("selected");
        document.getElementById("disagree-warning").style.display = "flex";
    }

    // Show continue button
    document.getElementById("step1-actions").style.display = "flex";
}

// ── Step 2: Thesis Input ─────────────────────────────
function setupThesisListener() {
    const textarea = document.getElementById("thesis-input");
    const counter = document.getElementById("char-count");
    const continueBtn = document.getElementById("thesis-continue");
    const qualityBox = document.getElementById("thesis-quality");

    textarea.addEventListener("input", () => {
        const text = textarea.value.trim();
        const len = text.length;
        counter.textContent = len;

        // Enable continue if minimum length met
        continueBtn.disabled = len < 50;

        // Show quality check when enough text
        if (len >= 30) {
            qualityBox.style.display = "block";
            checkThesisQuality(text);
        } else {
            qualityBox.style.display = "none";
        }
    });
}

function checkThesisQuality(text) {
    const lower = text.toLowerCase();

    // Specific: mentions numbers, dates, data, catalysts
    const specific = /\d/.test(text) ||
        /catalyst|data|earnings|revenue|margin|growth|pipeline|approval|filing|patent|contract|guidance/i.test(text);
    updateQuality("q-specific", specific);

    // Contrarian: explains disagreement with market
    const contrarian = /market.*wrong|consensus.*wrong|overestimat|underestimat|mispriced|overlooked|undervalued|overvalued|pricing in|not pricing|ignoring|missing|discount/i.test(text);
    updateQuality("q-contrarian", contrarian);

    // Falsifiable: can be disproven
    const falsifiable = /if\s|unless|would invalidate|prove wrong|trigger|exit|stop|deadline|by\s(q[1-4]|20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text);
    updateQuality("q-falsifiable", falsifiable);
}

function updateQuality(id, passes) {
    const el = document.getElementById(id);
    if (passes) {
        el.classList.add("pass");
        el.querySelector(".q-icon").innerHTML = "&#x2713;";
    } else {
        el.classList.remove("pass");
        el.querySelector(".q-icon").innerHTML = "&#x2717;";
    }
}

function submitThesis() {
    const text = document.getElementById("thesis-input").value.trim();
    if (text.length < 50) return;
    vState.thesis = text;
    goToStep(3);
}

// ── Step 3: Asymmetry Gate ───────────────────────────
function calcAsymmetry() {
    const current = vState.stock?.price;
    const target = parseFloat(document.getElementById("target-price").value);
    const stop = parseFloat(document.getElementById("stop-price").value);

    if (!current || !target || !stop || isNaN(target) || isNaN(stop)) {
        document.getElementById("asymmetry-result").style.display = "none";
        document.getElementById("asym-continue").disabled = true;
        return;
    }

    // Validate price logic
    if (target <= current) {
        showAsymError("Target must be above current price");
        return;
    }
    if (stop >= current) {
        showAsymError("Stop must be below current price");
        return;
    }

    const upside = ((target - current) / current * 100);
    const downside = ((current - stop) / current * 100);
    const ratio = upside / downside;

    vState.targetPrice = target;
    vState.stopPrice = stop;
    vState.asymmetryRatio = ratio;

    // Display
    const resultEl = document.getElementById("asymmetry-result");
    resultEl.style.display = "block";

    const ratioEl = document.getElementById("asym-ratio");
    ratioEl.textContent = `${ratio.toFixed(1)}x`;
    ratioEl.className = `asym-value mono ${ratio >= 5 ? "pass" : "fail"}`;

    document.getElementById("asym-upside").textContent = `+${upside.toFixed(1)}%`;
    document.getElementById("asym-downside").textContent = `-${downside.toFixed(1)}%`;

    const gateEl = document.getElementById("asym-gate");
    if (ratio >= 5) {
        gateEl.className = "asym-gate pass";
        gateEl.textContent = `PASSES 5x GATE — ${ratio.toFixed(1)}x asymmetry confirmed`;
        document.getElementById("asym-continue").disabled = false;
    } else {
        gateEl.className = "asym-gate fail";
        gateEl.textContent = `BLOCKED — ${ratio.toFixed(1)}x does not meet 5x minimum. Adjust target or stop.`;
        document.getElementById("asym-continue").disabled = true;
    }
}

function showAsymError(msg) {
    const resultEl = document.getElementById("asymmetry-result");
    resultEl.style.display = "block";
    document.getElementById("asym-ratio").textContent = "—";
    document.getElementById("asym-ratio").className = "asym-value mono";
    document.getElementById("asym-upside").textContent = "—";
    document.getElementById("asym-downside").textContent = "—";
    const gateEl = document.getElementById("asym-gate");
    gateEl.className = "asym-gate fail";
    gateEl.textContent = msg;
    document.getElementById("asym-continue").disabled = true;
}

// ── Step 4: Behavioral Bias Checklist ────────────────
function answerBias(bias, isBiased) {
    // For Q4 (wrongdefined) the "good" answer is true (yes defined), bad is false
    // For Q5 (positionsize) the "good" answer is true (yes respect), bad is false
    // For Q1-3, the "good" answer is false (no bias), bad is true (yes biased)
    const isFlagged = (bias === "wrongdefined" || bias === "positionsize") ? !isBiased : isBiased;

    vState.biasAnswers[bias] = { isBiased, isFlagged };

    // Update UI
    const item = document.querySelector(`.bias-item[data-bias="${bias}"]`);
    item.classList.add("answered");
    item.classList.toggle("flagged", isFlagged);

    // Update button styles
    const btns = item.querySelectorAll(".bias-btn");
    btns.forEach(btn => btn.classList.remove("selected-good", "selected-bad"));

    if (bias === "wrongdefined" || bias === "positionsize") {
        // First button is the "bad" answer, second is "good"
        if (isBiased) {
            btns[0].classList.add("selected-bad");
        } else {
            btns[1].classList.add("selected-good");
        }
    } else {
        // First button is "yes biased" (bad), second is "no" (good)
        if (isBiased) {
            btns[0].classList.add("selected-bad");
        } else {
            btns[1].classList.add("selected-good");
        }
    }

    // Check if all answered
    const allBiases = ["anchoring", "herding", "overconfidence", "wrongdefined", "positionsize"];
    const allAnswered = allBiases.every(b => vState.biasAnswers[b] !== undefined);

    if (allAnswered) {
        showBiasSummary();
        document.getElementById("bias-continue").disabled = false;
    }
}

function showBiasSummary() {
    const summary = document.getElementById("bias-summary");
    summary.style.display = "block";

    const answers = vState.biasAnswers;
    const flagCount = Object.values(answers).filter(a => a.isFlagged).length;
    const score = 5 - flagCount; // 5 = perfect, 0 = all flagged
    const pct = (score / 5) * 100;

    document.getElementById("bias-score-value").textContent = `${score}/5`;

    const fill = document.getElementById("bias-score-fill");
    fill.style.width = `${pct}%`;

    if (score >= 4) {
        fill.style.background = "var(--green)";
        document.getElementById("bias-score-label").textContent = "Low bias risk — disciplined mindset";
    } else if (score >= 3) {
        fill.style.background = "var(--yellow)";
        document.getElementById("bias-score-label").textContent = "Moderate bias risk — proceed with awareness";
    } else {
        fill.style.background = "var(--red)";
        document.getElementById("bias-score-label").textContent = "High bias risk — strong recommendation to reconsider";
    }
}

// ── Step 5: Go/No-Go Decision ────────────────────────
function renderDecision() {
    goToStep(5);

    const s = vState.stock;
    const answers = vState.biasAnswers;
    const flagCount = Object.values(answers).filter(a => a.isFlagged).length;
    const biasScore = 5 - flagCount;

    // Decision logic
    const regimeOk = (s.regime === "CALM" || s.regime === "CAUTIOUS");
    const asymmetryOk = vState.asymmetryRatio >= 5;
    const thesisOk = vState.thesis.length >= 50;
    const biasOk = biasScore >= 2;

    // Count passes
    const checks = [
        { name: "regime", pass: regimeOk },
        { name: "asymmetry", pass: asymmetryOk },
        { name: "thesis", pass: thesisOk },
        { name: "bias", pass: biasOk },
    ];
    const passCount = checks.filter(c => c.pass).length;

    // GO requires: regime OK + asymmetry OK + thesis written + bias score >= 2
    const isGo = passCount === 4;
    vState.decision = isGo ? "GO" : "NO-GO";

    // Render verdict
    const display = document.getElementById("decision-display");
    display.className = `decision-display ${isGo ? "go" : "nogo"}`;
    display.innerHTML = `
        <div class="decision-verdict">${isGo ? "GO" : "NO-GO"}</div>
        <div class="decision-subtitle">${isGo
            ? `${s.ticker} passes all validation gates — cleared for execution`
            : `${s.ticker} does not meet all validation criteria`
        }</div>
    `;

    // Render reasoning sections
    const reasoning = document.getElementById("decision-reasoning");
    reasoning.innerHTML = `
        <div class="reasoning-section">
            <div class="reasoning-header">
                <span class="reasoning-title">Regime Assessment</span>
                <span class="reasoning-badge ${regimeOk ? "pass" : "fail"}">${regimeOk ? "PASS" : "FAIL"}</span>
            </div>
            <div class="reasoning-text">
                ${s.ticker} is classified as <strong>${s.regime}</strong> with a composite score of ${s.composite_score}.
                Vol Percentile: ${s.indicators?.vol_percentile?.toFixed(1) ?? "—"}% ·
                SMA Trend: ${s.indicators?.sma_trend ?? "—"} ·
                Hurst: ${s.indicators?.hurst?.toFixed(3) ?? "—"} ·
                CVaR: ${s.indicators?.tail_risk?.toFixed(2) ?? "—"}%.
                ${vState.regimeConfirmed
                    ? "You confirmed agreement with this classification."
                    : '<span style="color:var(--orange)">You disagreed with this classification — override noted.</span>'
                }
                Position sizing: ${s.position_pct}% of portfolio.
            </div>
        </div>

        <div class="reasoning-section">
            <div class="reasoning-header">
                <span class="reasoning-title">Asymmetry</span>
                <span class="reasoning-badge ${asymmetryOk ? "pass" : "fail"}">${vState.asymmetryRatio?.toFixed(1) ?? "—"}x</span>
            </div>
            <div class="reasoning-text">
                Target: $${vState.targetPrice?.toFixed(2) ?? "—"} ·
                Stop: $${vState.stopPrice?.toFixed(2) ?? "—"} ·
                Upside: +${((vState.targetPrice - s.price) / s.price * 100).toFixed(1)}% ·
                Downside: -${((s.price - vState.stopPrice) / s.price * 100).toFixed(1)}%.
                ${asymmetryOk
                    ? `Risk/reward of ${vState.asymmetryRatio?.toFixed(1)}x exceeds the 5x minimum threshold.`
                    : `Risk/reward of ${vState.asymmetryRatio?.toFixed(1)}x does not meet the 5x minimum. This gate is hard-blocked.`
                }
            </div>
        </div>

        <div class="reasoning-section">
            <div class="reasoning-header">
                <span class="reasoning-title">Thesis Quality</span>
                <span class="reasoning-badge ${thesisOk ? "pass" : "fail"}">${thesisOk ? "WRITTEN" : "INSUFFICIENT"}</span>
            </div>
            <div class="reasoning-text">
                "${vState.thesis.length > 200 ? vState.thesis.substring(0, 200) + "..." : vState.thesis}"
            </div>
        </div>

        <div class="reasoning-section">
            <div class="reasoning-header">
                <span class="reasoning-title">Bias Check</span>
                <span class="reasoning-badge ${biasScore >= 4 ? "pass" : biasScore >= 3 ? "warn" : "fail"}">${biasScore}/5</span>
            </div>
            <div class="reasoning-text">
                ${buildBiasReasoningText(answers, biasScore)}
            </div>
        </div>
    `;

    // Show/hide journal button
    document.getElementById("journal-btn").style.display = isGo ? "inline-flex" : "none";
}

function buildBiasReasoningText(answers, score) {
    const flags = [];
    if (answers.anchoring?.isFlagged) flags.push("price anchoring detected");
    if (answers.herding?.isFlagged) flags.push("possible herd behavior");
    if (answers.overconfidence?.isFlagged) flags.push("overconfidence acknowledged");
    if (answers.wrongdefined?.isFlagged) flags.push("exit criteria not defined");
    if (answers.positionsize?.isFlagged) flags.push("position sizing override");

    if (flags.length === 0) {
        return "No behavioral bias flags raised. Clean decision process.";
    }

    return `Flags raised: ${flags.join(", ")}. ` +
        (score >= 3
            ? "Bias risk is manageable — proceed with awareness of these tendencies."
            : "Multiple bias flags suggest this decision may be emotionally driven rather than analytically grounded."
        );
}

// ── Send to Journal (Module 3) ───────────────────────
function sendToJournal() {
    const s = vState.stock;

    const journalEntry = {
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        price: s.price,
        regime: s.regime,
        position_pct: s.position_pct,
        composite_score: s.composite_score,
        indicators: s.indicators,
        scores: s.scores,
        regime_confirmed: vState.regimeConfirmed,
        thesis: vState.thesis,
        target_price: vState.targetPrice,
        stop_price: vState.stopPrice,
        asymmetry_ratio: vState.asymmetryRatio,
        bias_answers: vState.biasAnswers,
        bias_score: 5 - Object.values(vState.biasAnswers).filter(a => a.isFlagged).length,
        decision: vState.decision,
        validated_at: new Date().toISOString(),
        screened_at: s.screened_at,
    };

    localStorage.setItem("pending_journal_entry", JSON.stringify(journalEntry));

    // Navigate to Module 3
    window.location.href = `/journal?ticker=${s.ticker}`;
}

// ── Expose globals ───────────────────────────────────
window.confirmRegime = confirmRegime;
window.goToStep = goToStep;
window.submitThesis = submitThesis;
window.calcAsymmetry = calcAsymmetry;
window.answerBias = answerBias;
window.renderDecision = renderDecision;
window.sendToJournal = sendToJournal;
