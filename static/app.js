// ── Application State ────────────────────────────────────────────────────────
let state = {
  projects: [],
  activeProjectId: null,
  activeProjectName: "",
  theme: "dark",
  downloadMode: "all",
  searchMode: "manual",
  auditMode: "sequential",
  aiResponse: null,
  activeFilter: [],          // e.g. ["Red", "Yellow"]
  activeRequirement: ""      // stored requirement text for re-auditing
};

// ── DOM References ───────────────────────────────────────────────────────────
const elProjectsList = document.getElementById("projects-list");
const elActiveProjectTitle = document.getElementById("active-project-title");
const elActiveProjectDate = document.getElementById("active-project-date");
const elEmptyState = document.getElementById("empty-state");
const elProjectPanel = document.getElementById("project-panel");

// Mode Panels
const elBtnModeManual = document.getElementById("btn-mode-manual");
const elBtnModeAi = document.getElementById("btn-mode-ai");
const elPanelManual = document.getElementById("panel-manual");
const elPanelAi = document.getElementById("panel-ai");

// Manual Search Form
const elScrapeFormManual = document.getElementById("scrape-form-manual");
const elKeywordsInput = document.getElementById("keywords-input");
const elLimitInputManual = document.getElementById("limit-input-manual");
const elBtnManualScrape = document.getElementById("btn-manual-scrape");
const elBtnManualText = document.getElementById("btn-manual-text");
const elSpinnerManual = document.getElementById("spinner-manual");

// AI Search Steps
const elAiStepInput = document.getElementById("ai-step-input");
const elAiStepReview = document.getElementById("ai-step-review");
const elRequirementInput = document.getElementById("requirement-input");
const elLimitInputAi = document.getElementById("limit-input-ai");
const elBtnGenerateQueries = document.getElementById("btn-generate-queries");
const elBtnGenerateText = document.getElementById("btn-generate-text");
const elSpinnerAi = document.getElementById("spinner-ai");
const elAiBtnIcon = document.getElementById("ai-btn-icon");

// Query Review
const elBtnBackToInput = document.getElementById("btn-back-to-input");
const elAiRationale = document.getElementById("ai-rationale");
const elEditableQueries = document.getElementById("editable-queries");
const elCpcTags = document.getElementById("cpc-tags");
const elBtnConfirmSearch = document.getElementById("btn-confirm-search");
const elBtnConfirmText = document.getElementById("btn-confirm-text");
const elSpinnerConfirm = document.getElementById("spinner-confirm");

// Live Progress Feed
const elLiveFeed = document.getElementById("live-feed");
const elLiveLog = document.getElementById("live-log");
const elAuditProgressBarWrap = document.getElementById("audit-progress-bar-wrap");
const elAuditProgressText = document.getElementById("audit-progress-text");
const elAuditProgressPct = document.getElementById("audit-progress-pct");
const elAuditProgressBar = document.getElementById("audit-progress-bar");
const elHistoryContainer = document.getElementById("history-container");

// Pills
const pills = {
  planning: document.getElementById("pill-planning"),
  scraping: document.getElementById("pill-scraping"),
  auditing: document.getElementById("pill-auditing"),
  saving: document.getElementById("pill-saving"),
  complete: document.getElementById("pill-complete")
};

// Global Export Elements
const elToggleDownloadAll = document.getElementById("toggle-download-all");
const elToggleDownloadSelected = document.getElementById("toggle-download-selected");
const elBtnGlobalExportCsv = document.getElementById("btn-global-export-csv");
const elBtnGlobalExportPdf = document.getElementById("btn-global-export-pdf");

// Modals
const elModalProject = document.getElementById("modal-project");
const elProjectForm = document.getElementById("project-form");
const elProjectNameInput = document.getElementById("project-name-input");
const elBtnNewProject = document.getElementById("btn-new-project");
const elBtnCloseModal = document.getElementById("btn-close-modal");
const elBtnCancelProject = document.getElementById("btn-cancel-project");

const elBtnSettings = document.getElementById("btn-settings");
const elModalSettings = document.getElementById("modal-settings");
const elBtnCloseSettings = document.getElementById("btn-close-settings");

// Theme
const elThemeToggle = document.getElementById("theme-toggle");
const elThemeIconSun = document.getElementById("theme-icon-sun");
const elThemeIconMoon = document.getElementById("theme-icon-moon");

// New modals & buttons
const elModalFilter = document.getElementById("modal-filter");
const elBtnRelevancyFilter = document.getElementById("btn-relevancy-filter");
const elBtnCloseFilter = document.getElementById("btn-close-filter");
const elBtnFilterApply = document.getElementById("btn-filter-apply");
const elBtnFilterReset = document.getElementById("btn-filter-reset");

const elModalSavedKeywords = document.getElementById("modal-saved-keywords");
const elBtnCloseKeywords = document.getElementById("btn-close-keywords");
const elSavedKeywordsList = document.getElementById("saved-keywords-list");

const elModalAlert = document.getElementById("modal-alert");
const elAlertMessage = document.getElementById("alert-message");
const elBtnAlertOk = document.getElementById("btn-alert-ok");

// ── Initialization ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadProjects();
  setupEventListeners();
});

// ── Theme Management ─────────────────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  setTheme(savedTheme);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  
  if (theme === "dark") {
    elThemeIconSun.classList.remove("hidden");
    elThemeIconMoon.classList.add("hidden");
  } else {
    elThemeIconSun.classList.add("hidden");
    elThemeIconMoon.classList.remove("hidden");
  }
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

// ── Projects Operations ──────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Failed to fetch projects");
    state.projects = await res.json();
    renderProjectsList();
  } catch (err) {
    console.error("Error loading projects:", err);
  }
}

function renderProjectsList() {
  elProjectsList.innerHTML = "";
  
  if (state.projects.length === 0) {
    elProjectsList.innerHTML = `<li class="meta-text" style="padding: 10px 0; text-align: center;">No projects created</li>`;
    return;
  }
  
  state.projects.forEach(p => {
    const li = document.createElement("li");
    li.className = `project-item ${state.activeProjectId === p.id ? 'active' : ''}`;
    li.dataset.id = p.id;
    
    li.addEventListener("click", (e) => {
      if (e.target.closest(".project-delete-btn")) return;
      selectProject(p.id, p.name, p.created_at);
    });

    li.innerHTML = `
      <span class="project-item-name">${escapeHtml(p.name)}</span>
      <button class="project-delete-btn" aria-label="Delete Project">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    `;
    
    const btnDelete = li.querySelector(".project-delete-btn");
    btnDelete.addEventListener("click", () => handleDeleteProject(p.id, p.name));
    
    elProjectsList.appendChild(li);
  });
}

async function selectProject(id, name, createdAt) {
  state.activeProjectId = id;
  state.activeProjectName = name;
  
  Array.from(elProjectsList.children).forEach(child => {
    if (child.dataset.id == id) {
      child.classList.add("active");
    } else {
      child.classList.remove("active");
    }
  });

  elActiveProjectTitle.innerText = name;
  const dateObj = new Date(createdAt);
  elActiveProjectDate.innerText = `Created: ${dateObj.toLocaleDateString()} at ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
  
  state.downloadMode = "all";
  elToggleDownloadAll.classList.add("active");
  elToggleDownloadSelected.classList.remove("active");
  
  elEmptyState.classList.add("hidden");
  elProjectPanel.classList.remove("hidden");
  
  resetAISearchPanel();
  await loadProjectHistory(id);
}

async function handleDeleteProject(id, name) {
  if (!confirm(`Are you sure you want to delete the project "${name}"? All associated search runs and patent data will be permanently deleted.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete project");
    
    if (state.activeProjectId === id) {
      state.activeProjectId = null;
      state.activeProjectName = "";
      elActiveProjectTitle.innerText = "Select a project";
      elActiveProjectDate.innerText = "";
      elProjectPanel.classList.add("hidden");
      elEmptyState.classList.remove("hidden");
    }
    
    await loadProjects();
  } catch (err) {
    console.error("Error deleting project:", err);
  }
}

// ── Search & Mode Toggling ──────────────────────────────────────────────────
function switchSearchMode(mode) {
  state.searchMode = mode;
  if (mode === "manual") {
    elBtnModeManual.classList.add("active");
    elBtnModeAi.classList.remove("active");
    elPanelManual.classList.remove("hidden");
    elPanelAi.classList.add("hidden");
  } else {
    elBtnModeAi.classList.add("active");
    elBtnModeManual.classList.remove("active");
    elPanelAi.classList.remove("hidden");
    elPanelManual.classList.add("hidden");
  }
}

function resetAISearchPanel() {
  elAiStepInput.classList.remove("hidden");
  elAiStepReview.classList.add("hidden");
  elRequirementInput.value = "";
  elEditableQueries.innerHTML = "";
  elCpcTags.innerHTML = "";
  elAiRationale.innerText = "";
  state.aiResponse = null;
  elLiveFeed.classList.add("hidden");
  clearLiveLog();
}

function clearLiveLog() {
  elLiveLog.innerHTML = "";
  elAuditProgressBarWrap.classList.add("hidden");
  elAuditProgressBar.style.width = "0%";
  Object.values(pills).forEach(p => p.className = "stage-pill");
}

// ── Manual Scrape Flow ──────────────────────────────────────────────────────
async function handleManualScrapeSubmit(e) {
  e.preventDefault();
  
  if (!state.activeProjectId) {
    alert("Please select or create a project first.");
    return;
  }

  const keywords = elKeywordsInput.value.trim();
  const maxResults = parseInt(elLimitInputManual.value, 10);
  
  if (!keywords) return;

  setManualLoading(true);
  
  // Reuse Live Log UI to show progress for manual scrapes too
  elLiveFeed.classList.remove("hidden");
  clearLiveLog();
  writeLogLine("🚀 Initializing manual keyword search...", "info");
  updateStagePill("planning", "active");

  try {
    const kwList = keywords.split(",").map(k => k.trim()).filter(Boolean);
    updateStagePill("planning", "done");
    updateStagePill("scraping", "active");

    for (let i = 0; i < kwList.length; i++) {
      const kw = kwList[i];
      writeLogLine(`🔍 Searching for keyword: "${kw}" (Batch ${i+1}/${kwList.length})`, "info");
    }

    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: state.activeProjectId,
        keywords: keywords,
        max_results: maxResults
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.detail || "Scrape operation failed");
    }

    const result = await response.json();
    writeLogLine("💾 Search results saved successfully.", "success");
    updateStagePill("scraping", "done");
    updateStagePill("complete", "done");

    elKeywordsInput.value = "";
    renderHistory(result.data);
  } catch (err) {
    writeLogLine(`❌ Error: ${err.message}`, "error");
    updateStagePill("scraping", "error");
    alert(`Error running scrape: ${err.message}`);
  } finally {
    setManualLoading(false);
  }
}

function setManualLoading(isLoading) {
  if (isLoading) {
    elBtnManualScrape.disabled = true;
    elKeywordsInput.disabled = true;
    elLimitInputManual.disabled = true;
    elSpinnerManual.classList.remove("hidden");
    elBtnManualText.innerText = "Scraping...";
  } else {
    elBtnManualScrape.disabled = false;
    elKeywordsInput.disabled = false;
    elLimitInputManual.disabled = false;
    elSpinnerManual.classList.add("hidden");
    elBtnManualText.innerText = "Scrape Patents";
  }
}

// ── AI Scrape Step 1: Generate Queries ───────────────────────────────────────
async function handleGenerateQueries() {
  const requirement = elRequirementInput.value.trim();
  if (!requirement) {
    alert("Please enter your invention requirement first.");
    return;
  }
  if (requirement.length < 30) {
    alert("Requirement too short. Please provide a more descriptive mechanism (minimum 30 characters).");
    return;
  }

  setGenerateLoading(true);

  try {
    const res = await fetch("/api/ai/generate-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirement })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to generate search queries.");
    }

    const strategy = await res.json();
    state.aiResponse = strategy;
    renderQueryReviewPanel(strategy);
  } catch (err) {
    alert(`AI Error: ${err.message}`);
  } finally {
    setGenerateLoading(false);
  }
}

function setGenerateLoading(isLoading) {
  if (isLoading) {
    elBtnGenerateQueries.disabled = true;
    elRequirementInput.disabled = true;
    elSpinnerAi.classList.remove("hidden");
    elAiBtnIcon.classList.add("hidden");
    elBtnGenerateText.innerText = "Analyzing Requirement...";
  } else {
    elBtnGenerateQueries.disabled = false;
    elRequirementInput.disabled = false;
    elSpinnerAi.classList.add("hidden");
    elAiBtnIcon.classList.remove("hidden");
    elBtnGenerateText.innerText = "Generate Queries with AI";
  }
}

function renderQueryReviewPanel(strategy) {
  elAiRationale.innerText = strategy.search_rationale || "";
  elEditableQueries.innerHTML = "";
  
  strategy.keyword_queries.forEach((q, idx) => {
    const row = document.createElement("div");
    row.className = "query-edit-row";
    row.innerHTML = `
      <span class="query-num">${idx + 1}</span>
      <input type="text" class="query-edit-input" value="${escapeHtml(q)}" title="Edit search query">
      <button type="button" class="btn-remove-query" onclick="this.parentElement.remove()" title="Remove query">
        <svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    elEditableQueries.appendChild(row);
  });

  elCpcTags.innerHTML = "";
  strategy.suggested_cpc_codes.forEach(cpc => {
    const tag = document.createElement("span");
    tag.className = "cpc-tag-pill";
    tag.innerText = cpc;
    elCpcTags.appendChild(tag);
  });

  elAiStepInput.classList.add("hidden");
  elAiStepReview.classList.remove("hidden");
}

// ── AI Scrape Step 2: Confirm & Stream Search ───────────────────────────────
async function handleConfirmSearch() {
  const queryInputs = elEditableQueries.querySelectorAll(".query-edit-input");
  const queries = Array.from(queryInputs).map(inp => inp.value.trim()).filter(Boolean);
  
  if (queries.length === 0) {
    alert("Please configure at least one query to search.");
    return;
  }

  const cpcs = Array.from(elCpcTags.querySelectorAll(".cpc-tag-pill")).map(pill => pill.innerText);
  const requirement = elRequirementInput.value.trim();
  const maxResults = parseInt(elLimitInputAi.value, 10);
  state.activeRequirement = requirement;  // store for re-audit

  setConfirmLoading(true);
  elLiveFeed.classList.remove("hidden");
  clearLiveLog();
  writeLogLine("🚀 Submitting pipeline execution request to backend...", "info");

  try {
    const res = await fetch("/api/ai/confirm-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: state.activeProjectId,
        requirement: requirement,
        queries: queries,
        cpc_codes: cpcs,
        ai_rationale: state.aiResponse.search_rationale || "",
        max_results: maxResults,
        audit_mode: state.auditMode
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Search request rejected.");
    }

    const { task_id } = await res.json();
    writeLogLine(`📡 Connection established. Task ID: ${task_id}`, "info");
    startSSEStream(task_id);
  } catch (err) {
    writeLogLine(`❌ Failed to start background task: ${err.message}`, "error");
    setConfirmLoading(false);
  }
}

function setConfirmLoading(isLoading) {
  if (isLoading) {
    elBtnConfirmSearch.disabled = true;
    elSpinnerConfirm.classList.remove("hidden");
    elBtnConfirmText.innerText = "Initializing Agent...";
  } else {
    elBtnConfirmSearch.disabled = false;
    elSpinnerConfirm.classList.add("hidden");
    elBtnConfirmText.innerText = "Confirm & Start Search";
  }
}

// ── SSE Stream Listener ──────────────────────────────────────────────────────
function startSSEStream(taskId) {
  const eventSource = new EventSource(`/api/ai/stream/${taskId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEStageUpdate(data);
    } catch (err) {
      console.error("SSE JSON parsing error:", err, event.data);
    }
  };

  eventSource.onerror = (err) => {
    console.error("SSE Connection error:", err);
    writeLogLine("⚠️ EventStream disconnected. Checking task completion status...", "warning");
    eventSource.close();
    setConfirmLoading(false);
  };
}

function handleSSEStageUpdate(data) {
  const { stage, message, current, total } = data;
  
  if (stage) {
    updateStagePill(stage, "active");
    // Mark previous stages as done
    const stagesOrder = ["planning", "scraping", "auditing", "saving", "complete"];
    const currentIdx = stagesOrder.indexOf(stage);
    if (currentIdx !== -1) {
      for (let i = 0; i < currentIdx; i++) {
        updateStagePill(stagesOrder[i], "done");
      }
    }
  }

  if (message) {
    let type = "info";
    if (message.includes("✅")) type = "success";
    if (message.includes("❌")) type = "skip";
    if (message.includes("⚠️")) type = "warning";
    writeLogLine(message, type);
  }

  // Audit Progress bar update
  if (stage === "auditing" && total > 0) {
    elAuditProgressBarWrap.classList.remove("hidden");
    const progressVal = current || 0;
    const percentage = Math.round((progressVal / total) * 100);
    elAuditProgressText.innerText = `Auditing Patents: ${progressVal}/${total}`;
    elAuditProgressPct.innerText = `${percentage}%`;
    elAuditProgressBar.style.width = `${percentage}%`;
    // Live-update individual patent card if patent_id is in the event
    if (data.patent_id && data.relevance_category) {
      updatePatentCardRelevancy(data.patent_id, data.relevance_category, data.confidence_score);
    }
  }

  if (stage === "complete") {
    updateStagePill("complete", "done");
    writeLogLine("🎉 Agent Pipeline Finished Successfully!", "success");
    setConfirmLoading(false);
    
    // Automatically transition back to requirement input
    setTimeout(() => {
      resetAISearchPanel();
    }, 4000);
    
    if (data.data) {
      renderHistory(data.data);
    }
  }

  if (stage === "error") {
    updateStagePill("complete", "error");
    writeLogLine(`❌ Critical Pipeline Error: ${message}`, "error");
    setConfirmLoading(false);
    alert(`Pipeline Error: ${message}`);
  }
}

function updateStagePill(stage, status) {
  const pill = pills[stage];
  if (!pill) return;
  pill.className = `stage-pill ${status}`;
}

function writeLogLine(text, type = "info") {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const line = document.createElement("div");
  line.className = `log-line log-${type}`;
  line.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-text">${escapeHtml(text)}</span>`;
  elLiveLog.appendChild(line);
  elLiveLog.scrollTop = elLiveLog.scrollHeight;
}

// ── Search Accordion & Patent Render ──────────────────────────────────────────
async function loadProjectHistory(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}/data`);
    if (!res.ok) throw new Error("Failed to load project details");
    const searches = await res.json();
    renderHistory(searches);
  } catch (err) {
    console.error("Error loading project history:", err);
  }
}

function renderHistory(searches) {
  elHistoryContainer.innerHTML = "";

  if (searches.length === 0) {
    elHistoryContainer.innerHTML = `
      <div class="meta-text" style="padding: 40px; text-align: center; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
        No prior art searches recorded for this project yet.
      </div>
    `;
    return;
  }

  searches.forEach(s => {
    const card = document.createElement("div");
    card.className = "query-card";
    card.id = `query-card-${s.id}`;
    
    const dateStr = new Date(s.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const isAi = s.search_mode === "ai";

    card.innerHTML = `
      <div class="query-card-header">
        <div class="query-title-info">
          <input type="checkbox" class="keyword-select-checkbox" data-search-id="${s.id}" title="Select all patents in this group">
          <span class="query-tag ${isAi ? 'ai-tag' : 'manual-tag'}">${isAi ? 'AI Pipeline' : 'Keyword'}</span>
          <span class="query-text" title="${escapeHtml(s.query)}">${escapeHtml(s.query)}</span>
          <span class="meta-text">${dateStr}</span>
        </div>
        <div class="query-actions-wrapper">
          ${isAi ? `<button type="button" class="btn-ai-audit-trigger" data-search-id="${s.id}" title="Audit these patents with Gemini">AI Audit</button>` : ''}
          <button type="button" class="btn-icon toggle-expand-btn" aria-label="Toggle accordion">
            <svg class="icon chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <div class="query-card-body">
        ${isAi ? renderAiSearchMeta(s) : ''}
        <div class="patent-list">
          ${renderPatentCards(s.patents, s.query, s.id)}
        </div>
      </div>
    `;

    const headerCheckbox = card.querySelector(".keyword-select-checkbox");
    headerCheckbox.addEventListener("click", (e) => {
      e.stopPropagation();
      const isChecked = headerCheckbox.checked;
      card.querySelectorAll(".patent-select-checkbox").forEach(cb => {
        cb.checked = isChecked;
        // trigger handler to enforce active filter validation if user manually selects all
        if (isChecked) handlePatentCheckboxChange(cb);
      });
    });

    const childCheckboxes = card.querySelectorAll(".patent-select-checkbox");
    childCheckboxes.forEach(cb => {
      cb.addEventListener("change", () => {
        const allChecked = Array.from(childCheckboxes).every(c => c.checked);
        headerCheckbox.checked = allChecked;
      });
    });

    // Audit button click handler
    if (isAi) {
      const btnAudit = card.querySelector(".btn-ai-audit-trigger");
      btnAudit.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerAudit(s.id, s.query);
      });
    }

    card.querySelector(".query-card-header").addEventListener("click", (e) => {
      if (e.target.closest(".keyword-select-checkbox") || e.target.closest(".btn-ai-audit-trigger")) return;
      const isOpen = card.classList.toggle("open");
      card.querySelector(".chevron").style.transform = isOpen ? "rotate(180deg)" : "rotate(0deg)";
    });

    elHistoryContainer.appendChild(card);
  });
}

function renderAiSearchMeta(s) {
  const queries = s.ai_queries || [];
  const cpc = s.ai_cpc_codes || [];
  return `
    <div class="ai-meta-display">
      <div class="ai-meta-row">
        <strong>Generated Search Queries:</strong>
        <div class="ai-meta-pills">
          ${queries.map(q => `<span class="ai-meta-pill-query">${escapeHtml(q)}</span>`).join('')}
        </div>
      </div>
      <div class="ai-meta-row">
        <strong>Suggested CPC Codes:</strong>
        <div class="ai-meta-pills">
          ${cpc.map(c => `<span class="cpc-tag-pill">${escapeHtml(c)}</span>`).join('')}
        </div>
      </div>
      ${s.ai_rationale ? `
      <div class="ai-meta-row">
        <strong>Search Rationale:</strong>
        <p class="ai-rationale-display">${escapeHtml(s.ai_rationale)}</p>
      </div>` : ''}
    </div>
  `;
}

function renderPatentCards(patents, query, searchId) {
  if (patents.length === 0) {
    return `<div class="meta-text" style="text-align: center; padding: 20px;">No patents matched this criteria.</div>`;
  }

  const terms = query.split(/\s+/).map(t => escapeRegExp(t)).filter(t => t.length > 2);
  const highlight = (text) => {
    if (terms.length === 0) return escapeHtml(text);
    const regex = new RegExp(`(${terms.join("|")})`, "gi");
    return escapeHtml(text).replace(regex, `<mark class="term-highlight">$1</mark>`);
  };

  return patents.map(p => {
    const score = p.confidence_score;
    const relevancy = scoreToRelevancy(score);
    const cardClass = `patent-card relevancy-${relevancy.toLowerCase()}`;

    return `
      <div class="${cardClass}" id="patent-card-${p.id}" data-relevancy="${relevancy}">
        <input type="checkbox" class="patent-select-checkbox" data-patent-id="${p.id}"
               data-search-id="${searchId}" data-relevancy="${relevancy}" title="Select patent"
               onchange="handlePatentCheckboxChange(this)">
        <div class="patent-card-content">
          <div class="patent-card-header">
            <div class="patent-title-line">
              <a href="${escapeHtml(p.url)}" target="_blank" class="patent-id-badge" title="Open patent">
                ${escapeHtml(p.patent_id)}
                <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
              </a>
              <h4 class="patent-title">${highlight(p.title)}</h4>
            </div>
            <span class="relevancy-badge relevancy-badge--${relevancy.toLowerCase()}">${relevancy}</span>
          </div>
          <p class="patent-abstract">${highlight(p.abstract)}</p>
          ${p.ai_reasoning ? `
            <div class="ai-reasoning-callout">
              <strong>Gemini Assessment:</strong> <em>${escapeHtml(p.ai_reasoning)}</em>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

function scoreToRelevancy(score) {
  if (score === null || score === undefined) return "Unaudited";
  if (score >= 0.75) return "Red";
  if (score >= 0.4)  return "Yellow";
  return "Green";
}

function updatePatentCardRelevancy(dbId, category, score) {
  const el = document.getElementById(`patent-card-${dbId}`);
  if (!el) return;
  const label = scoreToRelevancy(score);
  el.className = `patent-card relevancy-${label.toLowerCase()}`;
  el.dataset.relevancy = label;
  const cb = el.querySelector(".patent-select-checkbox");
  if (cb) cb.dataset.relevancy = label;
  let badge = el.querySelector(".relevancy-badge");
  if (badge) {
    badge.className = `relevancy-badge relevancy-badge--${label.toLowerCase()}`;
    badge.textContent = label;
  }
}

function handlePatentCheckboxChange(cb) {
  if (!cb.checked) return;
  if (state.activeFilter.length === 0) return; // no filter active
  const cardRelevancy = cb.dataset.relevancy || "Unaudited";
  if (!state.activeFilter.includes(cardRelevancy)) {
    cb.checked = false;
    showAlertDialog(
      `This patent is marked <strong>${cardRelevancy}</strong>, which is outside your active filter.` +
      ` Please adjust your filter or choose a patent within the selected categories.`
    );
  }
}

function showAlertDialog(msg) {
  elAlertMessage.innerHTML = msg;
  elModalAlert.classList.remove("hidden");
}

// ── Exporter Operations ──────────────────────────────────────────────────────
async function downloadExport(format, patentIds = null) {
  if (!state.activeProjectId) {
    alert("Please select a project first.");
    return;
  }

  const url = `/api/projects/${state.activeProjectId}/export/${format}`;
  const body = {};
  if (patentIds) body.patent_ids = patentIds;
  if (state.activeFilter.length > 0) body.relevancy_filter = state.activeFilter;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Export failed" }));
      throw new Error(err.detail || "Export failed");
    }
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const cleanProjName = state.activeProjectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    a.download = `patentlens_${cleanProjName}_${patentIds ? "selected" : "all"}_${timestamp}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}

function handleGlobalExport(format) {
  if (state.downloadMode === "all") {
    downloadExport(format, null);
  } else {
    const checkedCbs = document.querySelectorAll(".patent-select-checkbox:checked");
    if (checkedCbs.length === 0) {
      alert("Please select at least one patent checkbox, or switch to 'Download All'.");
      return;
    }
    const patentIds = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.patentId, 10));
    downloadExport(format, patentIds);
  }
}

// ── Settings modal ───────────────────────────────────────────────────────────
function showSettingsModal() {
  elModalSettings.classList.remove("hidden");
  // Highlight currently selected radio button
  const radio = elModalSettings.querySelector(`input[name="audit-mode"][value="${state.auditMode}"]`);
  if (radio) radio.checked = true;
}

function hideSettingsModal() {
  elModalSettings.classList.add("hidden");
}

function handleAuditModeChange(e) {
  state.auditMode = e.target.value;
}

// ── Event Handlers ───────────────────────────────────────────────────────────
// ── AI Audit execution ───────────────────────────────────────────────────────
async function triggerAudit(searchId, queryText) {
  if (!state.activeProjectId) return;
  elLiveFeed.classList.remove("hidden");
  clearLiveLog();
  writeLogLine(`🤖 Initiating Gemini audit for search run #${searchId}...`, "info");
  updateStagePill("planning", "done");
  updateStagePill("scraping", "done");
  updateStagePill("auditing", "active");

  try {
    const res = await fetch(`/api/ai/audit/${searchId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirement: queryText || "" })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Audit request rejected.");
    }
    const { task_id } = await res.json();
    writeLogLine(`📡 Connection established. Audit Task ID: ${task_id}`, "info");
    startSSEStream(task_id);
  } catch (err) {
    writeLogLine(`❌ Failed to start audit task: ${err.message}`, "error");
  }
}

// ── Saved Search Strategies Modal ────────────────────────────────────────────
async function showSavedKeywordsModal() {
  if (!state.activeProjectId) {
    alert("Please select a project first.");
    return;
  }
  elSavedKeywordsList.innerHTML = '<p class="meta-text">Loading saved searches...</p>';
  elModalSavedKeywords.classList.remove("hidden");

  try {
    const res = await fetch(`/api/projects/${state.activeProjectId}/data`);
    if (!res.ok) throw new Error("Failed to load project details");
    const searches = await res.json();
    
    elSavedKeywordsList.innerHTML = "";
    if (searches.length === 0) {
      elSavedKeywordsList.innerHTML = '<p class="meta-text">No saved searches for this project yet.</p>';
      return;
    }

    searches.forEach(s => {
      const div = document.createElement("div");
      div.className = "saved-keyword-item";
      const isAi = s.search_mode === "ai";
      const dateStr = new Date(s.created_at).toLocaleDateString();
      
      div.innerHTML = `
        <div class="saved-keyword-info">
          <span class="query-tag ${isAi ? 'ai-tag' : 'manual-tag'}">${isAi ? 'AI Strategy' : 'Manual'}</span>
          <span class="saved-keyword-text" title="${escapeHtml(s.query)}">${escapeHtml(s.query)}</span>
          <span class="meta-text">${dateStr}</span>
        </div>
        <button type="button" class="btn-primary btn-sm btn-load-strategy">Load</button>
      `;

      div.querySelector(".btn-load-strategy").addEventListener("click", () => {
        if (isAi) {
          switchSearchMode("ai");
          elRequirementInput.value = s.query;
        } else {
          switchSearchMode("manual");
          elKeywordsInput.value = s.query;
        }
        elModalSavedKeywords.classList.add("hidden");
      });

      elSavedKeywordsList.appendChild(div);
    });
  } catch (err) {
    elSavedKeywordsList.innerHTML = `<p class="log-error">Error loading saved searches: ${err.message}</p>`;
  }
}

// ── Relevancy Filter Modal ───────────────────────────────────────────────────
function showFilterModal() {
  elModalFilter.classList.remove("hidden");
  // Pre-fill checkboxes based on active state
  const checkboxes = elModalFilter.querySelectorAll('input[name="filter-relevancy"]');
  checkboxes.forEach(cb => {
    cb.checked = state.activeFilter.includes(cb.value);
  });
}

function hideFilterModal() {
  elModalFilter.classList.add("hidden");
}

function applyFilter() {
  const checkboxes = elModalFilter.querySelectorAll('input[name="filter-relevancy"]:checked');
  state.activeFilter = Array.from(checkboxes).map(cb => cb.value);

  // Update filter button appearance
  if (state.activeFilter.length > 0) {
    elBtnRelevancyFilter.classList.add("active");
  } else {
    elBtnRelevancyFilter.classList.remove("active");
  }

  // Checkbox validation: Uncheck selected patents outside the active filter
  if (state.activeFilter.length > 0) {
    const checkedPatents = document.querySelectorAll(".patent-select-checkbox:checked");
    checkedPatents.forEach(cb => {
      const cardRelevancy = cb.dataset.relevancy || "Unaudited";
      if (!state.activeFilter.includes(cardRelevancy)) {
        cb.checked = false;
        // Uncheck header checkbox too
        const card = cb.closest(".query-card");
        if (card) {
          const headerCb = card.querySelector(".keyword-select-checkbox");
          if (headerCb) headerCb.checked = false;
        }
      }
    });
  }

  hideFilterModal();
}

function resetFilter() {
  state.activeFilter = [];
  elBtnRelevancyFilter.classList.remove("active");
  const checkboxes = elModalFilter.querySelectorAll('input[name="filter-relevancy"]');
  checkboxes.forEach(cb => cb.checked = false);
  hideFilterModal();
}

// ── Event Handlers ───────────────────────────────────────────────────────────
function setupEventListeners() {
  elThemeToggle.addEventListener("click", toggleTheme);

  // Mode buttons
  elBtnModeManual.addEventListener("click", () => switchSearchMode("manual"));
  elBtnModeAi.addEventListener("click", () => switchSearchMode("ai"));

  // Forms
  elScrapeFormManual.addEventListener("submit", handleManualScrapeSubmit);
  elBtnGenerateQueries.addEventListener("click", handleGenerateQueries);
  elBtnConfirmSearch.addEventListener("click", handleConfirmSearch);
  elBtnBackToInput.addEventListener("click", () => {
    elAiStepInput.classList.remove("hidden");
    elAiStepReview.classList.add("hidden");
  });

  // Project Modals
  elBtnNewProject.addEventListener("click", () => {
    elModalProject.classList.remove("hidden");
    elProjectNameInput.focus();
  });
  elBtnCloseModal.addEventListener("click", () => elModalProject.classList.add("hidden"));
  elBtnCancelProject.addEventListener("click", () => elModalProject.classList.add("hidden"));
  elModalProject.addEventListener("click", (e) => {
    if (e.target === elModalProject) elModalProject.classList.add("hidden");
  });
  elProjectForm.addEventListener("submit", handleCreateProject);

  // Settings Modal
  elBtnSettings.addEventListener("click", showSettingsModal);
  elBtnCloseSettings.addEventListener("click", hideSettingsModal);
  elModalSettings.addEventListener("click", (e) => {
    if (e.target === elModalSettings) hideSettingsModal();
  });
  elModalSettings.querySelectorAll('input[name="audit-mode"]').forEach(radio => {
    radio.addEventListener("change", handleAuditModeChange);
  });

  // Saved Keywords Modal
  const btnSavedKeywords = document.getElementById("btn-saved-keywords");
  if (btnSavedKeywords) {
    btnSavedKeywords.addEventListener("click", showSavedKeywordsModal);
  }
  if (elBtnCloseKeywords) {
    elBtnCloseKeywords.addEventListener("click", () => elModalSavedKeywords.classList.add("hidden"));
  }
  elModalSavedKeywords.addEventListener("click", (e) => {
    if (e.target === elModalSavedKeywords) elModalSavedKeywords.classList.add("hidden");
  });

  // Relevancy Filter Modal
  if (elBtnRelevancyFilter) {
    elBtnRelevancyFilter.addEventListener("click", showFilterModal);
  }
  if (elBtnCloseFilter) {
    elBtnCloseFilter.addEventListener("click", hideFilterModal);
  }
  elModalFilter.addEventListener("click", (e) => {
    if (e.target === elModalFilter) hideFilterModal();
  });
  if (elBtnFilterApply) {
    elBtnFilterApply.addEventListener("click", applyFilter);
  }
  if (elBtnFilterReset) {
    elBtnFilterReset.addEventListener("click", resetFilter);
  }

  // Mismatch Alert Modal
  if (elBtnAlertOk) {
    elBtnAlertOk.addEventListener("click", () => elModalAlert.classList.add("hidden"));
  }
  elModalAlert.addEventListener("click", (e) => {
    if (e.target === elModalAlert) elModalAlert.classList.add("hidden");
  });

  // Download Toggles
  elToggleDownloadAll.addEventListener("click", () => {
    state.downloadMode = "all";
    elToggleDownloadAll.classList.add("active");
    elToggleDownloadSelected.classList.remove("active");
  });
  
  elToggleDownloadSelected.addEventListener("click", () => {
    state.downloadMode = "selected";
    elToggleDownloadSelected.classList.add("active");
    elToggleDownloadAll.classList.remove("active");
  });

  elBtnGlobalExportCsv.addEventListener("click", () => handleGlobalExport("csv"));
  elBtnGlobalExportPdf.addEventListener("click", () => handleGlobalExport("pdf"));
}

async function handleCreateProject(e) {
  e.preventDefault();
  const name = elProjectNameInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error("Could not create project");
    const newProject = await res.json();
    
    elModalProject.classList.add("hidden");
    elProjectForm.reset();
    await loadProjects();
    selectProject(newProject.id, newProject.name, newProject.created_at);
  } catch (err) {
    alert("Project already exists or failed to create.");
  }
}

// ── Utility Helpers ──────────────────────────────────────────────────────────
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
