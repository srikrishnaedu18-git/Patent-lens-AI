// Intercept 401 Unauthorized globally
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || "";
  const response = await originalFetch(...args);
  if (response.status === 401 && !url.includes('/api/auth/')) {
    document.getElementById("auth-overlay").classList.remove("hidden");
    state.projects = [];
    state.activeProjectId = null;
    if (typeof renderProjects === "function") renderProjects();
    const projectPanel = document.getElementById("project-panel");
    const emptyState = document.getElementById("empty-state");
    if (projectPanel) projectPanel.classList.add("hidden");
    if (emptyState) emptyState.classList.remove("hidden");
    throw new Error("Unauthorized");
  }
  return response;
};

// ── Application State ────────────────────────────────────────────────────────
let state = {
  projects: [],
  activeProjectId: null,
  activeProjectName: "",
  theme: "dark",
  downloadMode: "all",
  searchMode: "manual",
  auditMode: "sequential",
  searchSources: ["google"],
  aiResponse: null,
  activeFilter: [],          // e.g. ["Red", "Yellow"]
  activeRequirement: "",      // stored requirement text for re-auditing
  lastScrapedSearchId: null,
  lastScrapedKeywords: "",
  indiaOptions: {
    published: true,
    granted: false,
    date_field: "APD",
    from_date: "01/01/2020",
    to_date: "",
    logic_field: "AND",
    rows: [{ field: "TI", text: "", logic: "AND" }]
  },
  activeCaptchaTaskId: null,
  captchaMode: "auto",       // "auto" | "manual"
  captchaService: "2captcha", // currently only "2captcha" for auto
  activeTaskId: null,
  activeFlow: null
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
const elManualDescriptionInput = document.getElementById("manual-description-input");
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
const elBtnTerminateScrape = document.getElementById("btn-terminate-scrape");


// Pills
const pills = {
  planning: document.getElementById("pill-planning"),
  scraping: document.getElementById("pill-scraping"),
  auditing: document.getElementById("pill-auditing"),
  saving: document.getElementById("pill-saving"),
  complete: document.getElementById("pill-complete")
};

// Global Export Elements
const elSelectAllHistoryCheckbox = document.getElementById("select-all-history-checkbox");
const elBtnGlobalDelete = document.getElementById("btn-global-delete");
const elBtnGlobalExportCsv = document.getElementById("btn-global-export-csv");
const elBtnGlobalExportPdf = document.getElementById("btn-global-export-pdf");

// Delete confirmation modal elements
const elModalDeleteConfirm = document.getElementById("modal-delete-confirm");
const elDeleteSelectedList = document.getElementById("delete-selected-list");
const elBtnDeleteCancel = document.getElementById("btn-delete-cancel");
const elBtnDeleteConfirmAction = document.getElementById("btn-delete-confirm-action");

// CAPTCHA Mode settings
const elBtnCaptchaModeAuto = document.getElementById("btn-captcha-mode-auto");
const elBtnCaptchaModeManual = document.getElementById("btn-captcha-mode-manual");
const elCaptchaServiceSection = document.getElementById("captcha-service-section");

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

// Live log audit & Novelty Dashboard elements
const elBtnLiveAudit = document.getElementById("btn-live-audit");
const elNoveltyResultsPanel = document.getElementById("novelty-results-panel");
const elNoveltyListRed = document.getElementById("novelty-list-red");
const elNoveltyListYellow = document.getElementById("novelty-list-yellow");
const elNoveltyListGreen = document.getElementById("novelty-list-green");

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

// India options & CAPTCHA DOM elements
const elBtnIndiaOptions = document.getElementById("btn-india-options");
const elModalIndiaOptions = document.getElementById("modal-india-options");
const elBtnCloseIndiaOptions = document.getElementById("btn-close-india-options");
const elIndiaOptionsForm = document.getElementById("india-options-form");
const elIndiaOptPublished = document.getElementById("india-opt-published");
const elIndiaOptGranted = document.getElementById("india-opt-granted");
const elIndiaOptDateField = document.getElementById("india-opt-date-field");
const elIndiaOptLogicField = document.getElementById("india-opt-logic-field");
const elIndiaOptFromDate = document.getElementById("india-opt-from-date");
const elIndiaOptToDate = document.getElementById("india-opt-to-date");
const elBtnIndiaCancel = document.getElementById("btn-india-cancel");

// Manual search panel India elements
const elBtnSourceGoogle = document.getElementById("btn-source-google");
const elBtnSourceIndia = document.getElementById("btn-source-india");
const elBtnManualIndiaAddRow = document.getElementById("btn-manual-india-add-row");
const elBtnManualIndiaRemoveRow = document.getElementById("btn-manual-india-remove-row");
const elManualIndiaQueryRowsContainer = document.getElementById("manual-india-query-rows-container");

const elModalCaptcha = document.getElementById("modal-captcha");
const elCaptchaImg = document.getElementById("captcha-img");
const elCaptchaForm = document.getElementById("captcha-form");
const elCaptchaInput = document.getElementById("captcha-input");
const elBtnCaptchaSubmit = document.getElementById("btn-captcha-submit");

// ── Initialization ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSearchSources();
  initIndiaOptions();
  initAuth();
  checkAuth();
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
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

// ── Authentication Management ────────────────────────────────────────────────
let authMode = "login"; // "login" | "register"

function checkAuth() {
  // Use originalFetch directly so we don't trigger the interceptor's redirect loop
  originalFetch("/api/auth/me")
    .then(res => {
      if (res.status === 200) {
        return res.json();
      } else {
        throw new Error("Not logged in");
      }
    })
    .then(data => {
      // Logged in
      document.getElementById("user-display-name").textContent = data.username;
      document.getElementById("auth-overlay").classList.add("hidden");
      loadProjects();
    })
    .catch(() => {
      // Show auth overlay
      document.getElementById("auth-overlay").classList.remove("hidden");
    });
}

function initAuth() {
  const overlay = document.getElementById("auth-overlay");
  const form = document.getElementById("auth-form");
  const toggleBtn = document.getElementById("btn-auth-toggle");
  const title = document.getElementById("auth-title");
  const subtitle = document.getElementById("auth-subtitle");
  const submitBtn = document.getElementById("btn-auth-submit");
  const errorMsg = document.getElementById("auth-error-msg");
  const toggleText = document.getElementById("auth-toggle-text");
  
  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    errorMsg.classList.add("hidden");
    if (authMode === "login") {
      authMode = "register";
      title.textContent = "Create Account";
      subtitle.textContent = "Join PatentLens Studio to manage your projects";
      submitBtn.textContent = "Create Account";
      toggleText.textContent = "Already have an account?";
      toggleBtn.textContent = "Sign In";
    } else {
      authMode = "login";
      title.textContent = "Welcome Back";
      subtitle.textContent = "Please enter your details to sign in";
      submitBtn.textContent = "Sign In";
      toggleText.textContent = "Don't have an account?";
      toggleBtn.textContent = "Create an account";
    }
  });
  
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.classList.add("hidden");
    submitBtn.disabled = true;
    
    const username = document.getElementById("auth-username").value.trim();
    const password = document.getElementById("auth-password").value;
    
    const url = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      // Use originalFetch here too to prevent handling 401 via general interceptor
      const res = await originalFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Authentication failed");
      }
      
      const data = await res.json();
      document.getElementById("user-display-name").textContent = data.username;
      overlay.classList.add("hidden");
      
      // Clear inputs
      document.getElementById("auth-username").value = "";
      document.getElementById("auth-password").value = "";
      
      // Load dashboard data
      loadProjects();
    } catch (err) {
      errorMsg.textContent = err.message;
      errorMsg.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Logout button event listener
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await originalFetch("/api/auth/logout", { method: "POST" });
      } catch (err) {
        console.error("Logout error", err);
      }
      // Show auth overlay, clear state
      overlay.classList.remove("hidden");
      state.projects = [];
      state.activeProjectId = null;
      if (typeof renderProjects === "function") renderProjects();
      const projectPanel = document.getElementById("project-panel");
      const emptyState = document.getElementById("empty-state");
      if (projectPanel) projectPanel.classList.add("hidden");
      if (emptyState) emptyState.classList.remove("hidden");
    });
  }
}

function initSearchSources() {
  const saved = JSON.parse(localStorage.getItem("searchSources") || "null");
  if (Array.isArray(saved) && saved.length > 0) {
    state.searchSources = saved.filter(src => ["google", "india"].includes(src));
  }
  if (state.searchSources.length === 0) state.searchSources = ["google"];
  
  // Enforce mutual exclusivity
  if (state.searchSources.length > 1) {
    state.searchSources = [state.searchSources[0]];
  }

  syncSourceCheckboxes();
  syncSourceToggleButtons();
  updateSourceFieldsVisibility();
}

function syncSourceCheckboxes() {
  document.querySelectorAll('input[name="search-source"]').forEach(cb => {
    cb.checked = state.searchSources.includes(cb.value);
  });
}

function syncSourceToggleButtons() {
  const activeSource = state.searchSources[0] || "google";
  document.querySelectorAll(".source-toggle-btn").forEach(btn => {
    if (btn.dataset.source === activeSource) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function updateSourceFieldsVisibility() {
  const activeSource = state.searchSources[0] || "google";
  const elGoogleFields = document.getElementById("group-keywords-google");
  const elIndiaFields = document.getElementById("group-keywords-india");
  
  if (activeSource === "google") {
    if (elGoogleFields) elGoogleFields.classList.remove("hidden");
    if (elIndiaFields) elIndiaFields.classList.add("hidden");
  } else {
    if (elGoogleFields) elGoogleFields.classList.add("hidden");
    if (elIndiaFields) elIndiaFields.classList.remove("hidden");
    renderManualIndiaQueryRows();
  }
}

function getSourceLabel() {
  const labels = {
    google: "Google Patents",
    india: "Indian Patents"
  };
  return state.searchSources.map(src => labels[src] || src).join(", ");
}

function handleSearchSourcesChange(e) {
  const checkedCheckbox = e.target;
  if (!checkedCheckbox.checked) {
    // Prevent unchecking the only checked source
    checkedCheckbox.checked = true;
    return;
  }

  // Uncheck all other checkboxes to enforce mutual exclusivity
  document.querySelectorAll('input[name="search-source"]').forEach(cb => {
    if (cb !== checkedCheckbox) {
      cb.checked = false;
    }
  });

  state.searchSources = [checkedCheckbox.value];
  localStorage.setItem("searchSources", JSON.stringify(state.searchSources));

  syncSourceToggleButtons();
  updateSourceFieldsVisibility();
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
  const dateObj = parseUtcDate(createdAt);
  elActiveProjectDate.innerText = `Created: ${dateObj.toLocaleDateString()} at ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;

  
  if (elSelectAllHistoryCheckbox) {
    elSelectAllHistoryCheckbox.checked = false;
  }
  
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
  
  // Reset Novelty Dashboard
  if (elNoveltyResultsPanel) elNoveltyResultsPanel.classList.add("hidden");
  if (elNoveltyListRed) elNoveltyListRed.innerHTML = "";
  if (elNoveltyListYellow) elNoveltyListYellow.innerHTML = "";
  if (elNoveltyListGreen) elNoveltyListGreen.innerHTML = "";
  if (elBtnLiveAudit) elBtnLiveAudit.classList.add("hidden");
}

// ── Manual Scrape Flow ──────────────────────────────────────────────────────
async function handleManualScrapeSubmit(e) {
  e.preventDefault();
  
  if (!state.activeProjectId) {
    alert("Please select or create a project first.");
    return;
  }

  const activeSource = state.searchSources[0] || "google";
  let keywords = "";
  let maxResults = parseInt(elLimitInputManual.value, 10);

  if (activeSource === "google") {
    keywords = elKeywordsInput.value.trim();
    if (!keywords) {
      alert("Please enter at least one keyword.");
      return;
    }
  } else {
    // Collect rows from manual panel query builder
    const rows = [];
    if (elManualIndiaQueryRowsContainer) {
      elManualIndiaQueryRowsContainer.querySelectorAll(".india-query-row").forEach(rowDiv => {
        const field = rowDiv.querySelector(".row-field").value;
        const text = rowDiv.querySelector(".row-text").value.trim();
        const logic = rowDiv.querySelector(".row-logic").value;
        rows.push({ field, text, logic });
      });
    }

    if (rows.length === 0 || rows.every(r => !r.text)) {
      alert("Please provide at least one query search term.");
      return;
    }

    // Save rows into state.indiaOptions and localStorage
    state.indiaOptions.rows = rows;
    localStorage.setItem("indiaOptions", JSON.stringify(state.indiaOptions));

    // Construct human-readable combined query string
    // Note: do NOT wrap text in extra quotes — the user may have already added their own
    let queryStr = "";
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].text) continue;
      if (queryStr) {
        queryStr += ` ${rows[i].logic} `;
      }
      queryStr += `${rows[i].field}: ${rows[i].text}`;
    }
    keywords = queryStr;
  }

  setManualLoading(true);
  if (elBtnTerminateScrape) {
    elBtnTerminateScrape.classList.remove("hidden");
    elBtnTerminateScrape.disabled = false;
    elBtnTerminateScrape.innerText = "Stop";
  }
  
  // Reuse Live Log UI to show progress for manual scrapes too
  elLiveFeed.classList.remove("hidden");
  clearLiveLog();
  writeLogLine(`🚀 Initializing manual keyword search across ${getSourceLabel()}...`, "info");
  initStagePillsForFlow("manual_scrape");
  updateStagePill("planning", "active");

  try {
    // For logging, we show the search terms
    let displayList = [keywords];
    if (activeSource === "google") {
      displayList = keywords.split(",").map(k => k.trim()).filter(Boolean);
    }
    updateStagePill("planning", "done");
    updateStagePill("scraping", "active");

    for (let i = 0; i < displayList.length; i++) {
      const kw = displayList[i];
      writeLogLine(`🔍 Searching for query: "${kw}" (Batch ${i+1}/${displayList.length})`, "info");
    }

    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: state.activeProjectId,
        keywords: keywords,
        max_results: maxResults,
        sources: state.searchSources,
        india_options: state.indiaOptions,
        captcha_mode: state.captchaMode,
        captcha_service: state.captchaService
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.detail || "Scrape operation failed");
    }

    const result = await response.json();
    if (result.status === "processing") {
      state.activeTaskId = result.task_id;
      writeLogLine(`📡 Connection established. Task ID: ${result.task_id}`, "info");
      startSSEStream(result.task_id);
    } else {
      writeLogLine("💾 Search results saved successfully.", "success");
      updateStagePill("scraping", "done");
      updateStagePill("complete", "done");
      if (activeSource === "google" && elKeywordsInput) {
        elKeywordsInput.value = "";
      }
      if (result.data) {
        renderHistory(result.data);
      }
      setManualLoading(false);
      if (elBtnTerminateScrape) elBtnTerminateScrape.classList.add("hidden");
    }
  } catch (err) {
    writeLogLine(`❌ Error: ${err.message}`, "error");
    updateStagePill("scraping", "error");
    alert(`Error running scrape: ${err.message}`);
    setManualLoading(false);
    if (elBtnTerminateScrape) elBtnTerminateScrape.classList.add("hidden");
  }

}

function setManualLoading(isLoading) {
  if (isLoading) {
    elBtnManualScrape.disabled = true;
    elKeywordsInput.disabled = true;
    elLimitInputManual.disabled = true;
    if (elManualDescriptionInput) elManualDescriptionInput.disabled = true;
    elSpinnerManual.classList.remove("hidden");
    elBtnManualText.innerText = "Scraping...";
    if (elBtnManualIndiaAddRow) elBtnManualIndiaAddRow.disabled = true;
    if (elBtnManualIndiaRemoveRow) elBtnManualIndiaRemoveRow.disabled = true;
    if (elManualIndiaQueryRowsContainer) {
      elManualIndiaQueryRowsContainer.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
    }
  } else {
    elBtnManualScrape.disabled = false;
    elKeywordsInput.disabled = false;
    elLimitInputManual.disabled = false;
    if (elManualDescriptionInput) elManualDescriptionInput.disabled = false;
    elSpinnerManual.classList.add("hidden");
    elBtnManualText.innerText = "Scrape Patents";
    if (elBtnManualIndiaAddRow) elBtnManualIndiaAddRow.disabled = false;
    if (elBtnManualIndiaRemoveRow) elBtnManualIndiaRemoveRow.disabled = false;
    if (elManualIndiaQueryRowsContainer) {
      elManualIndiaQueryRowsContainer.querySelectorAll("input, select, button").forEach(el => el.disabled = false);
    }
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
  initStagePillsForFlow("ai_search");

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
        audit_mode: state.auditMode,
        sources: state.searchSources,
        india_options: state.indiaOptions,
        captcha_mode: state.captchaMode,
        captcha_service: state.captchaService
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Search request rejected.");
    }

    const { task_id } = await res.json();
    state.activeTaskId = task_id;
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
function initStagePillsForFlow(flowName) {
  state.activeFlow = flowName;
  const stages = ["planning", "scraping", "auditing", "saving", "complete"];
  
  // Define which stages are active/used in each flow
  const flows = {
    manual_scrape: ["planning", "scraping", "saving", "complete"],
    ai_search: ["planning", "scraping", "saving", "complete"],
    ai_audit: ["auditing", "complete"]
  };
  
  const activeStages = flows[flowName] || [];
  
  stages.forEach(s => {
    if (activeStages.includes(s)) {
      updateStagePill(s, "waiting");
    } else {
      updateStagePill(s, "skipped");
    }
  });
}

function startSSEStream(taskId) {
  state.activeTaskId = taskId;
  const eventSource = new EventSource(`/api/ai/stream/${taskId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEStageUpdate(data, taskId);
    } catch (err) {
      console.error("SSE JSON parsing error:", err, event.data);
    }
  };

  eventSource.onerror = (err) => {
    console.error("SSE Connection error:", err);
    writeLogLine("⚠️ EventStream disconnected. Checking task completion status...", "warning");
    eventSource.close();
    setPipelineLoading(false);
  };
}

function setPipelineLoading(isLoading) {
  setConfirmLoading(isLoading);
  setManualLoading(isLoading);
  if (!isLoading) {
    if (elBtnTerminateScrape) {
      elBtnTerminateScrape.classList.add("hidden");
    }
    if (elLiveFeed) {
      elLiveFeed.classList.add("hidden");
    }
  }
}

function handleSSEStageUpdate(data, taskId) {
  const { stage, message, current, total } = data;
  
  if (stage) {
    const stagesOrder = ["planning", "scraping", "auditing", "saving", "complete"];
    const currentIdx = stagesOrder.indexOf(stage);
    
    updateStagePill(stage, "active");
    
    // Set all previous stages that are part of the active flow to "done"
    const flows = {
      manual_scrape: ["planning", "scraping", "saving", "complete"],
      ai_search: ["planning", "scraping", "saving", "complete"],
      ai_audit: ["auditing", "complete"]
    };
    const activeStages = flows[state.activeFlow] || [];
    
    if (currentIdx !== -1) {
      for (let i = 0; i < currentIdx; i++) {
        const prevStage = stagesOrder[i];
        if (activeStages.includes(prevStage)) {
          updateStagePill(prevStage, "done");
        }
      }
    }
  }

  if (message) {
    let type = "info";
    if (message.includes("✅")) type = "success";
    if (message.includes("❌")) type = "error";
    if (message.includes("⚠️")) type = "warning";
    if (message.includes("⛔")) type = "warning";
    writeLogLine(message, type);
  }

  // Render the CAPTCHA image inside the live log console if provided
  if (data.captcha_image) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = document.createElement("div");
    line.className = "log-line log-info flex flex-col gap-1 my-2";
    
    const labelSpan = document.createElement("span");
    labelSpan.className = "log-text text-xs text-slate-400";
    labelSpan.innerHTML = `<span class="log-time">[${time}]</span> Captured CAPTCHA Image:`;
    
    const imgEl = document.createElement("img");
    imgEl.src = data.captcha_image;
    imgEl.style.display = "block";
    imgEl.style.marginTop = "4px";
    imgEl.style.marginBottom = "4px";
    imgEl.style.border = "1px solid var(--border-color)";
    imgEl.style.borderRadius = "var(--radius-sm)";
    imgEl.style.maxHeight = "50px";
    imgEl.style.maxWidth = "200px";
    imgEl.style.background = "#fff";
    imgEl.style.padding = "2px";
    
    line.appendChild(labelSpan);
    line.appendChild(imgEl);
    elLiveLog.appendChild(line);
    elLiveLog.scrollTop = elLiveLog.scrollHeight;
  }

  // Handle India Patents CAPTCHA popup
  if (stage === "captcha") {
    if (data.captcha_image) {
      elCaptchaImg.src = data.captcha_image;
      elCaptchaInput.value = "";
      elModalCaptcha.classList.remove("hidden");
      elCaptchaInput.focus();
      state.activeCaptchaTaskId = taskId;
    }
  } else if (stage === "complete" || stage === "error" || stage === "saving" || stage === "auditing") {
    // If we transition to end stages, hide the captcha modal
    elModalCaptcha.classList.add("hidden");
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
      // Populate novelty live dashboard
      addPatentToNoveltyDashboard(data);
    }
  }

  if (stage === "complete") {
    const flows = {
      manual_scrape: ["planning", "scraping", "saving", "complete"],
      ai_search: ["planning", "scraping", "saving", "complete"],
      ai_audit: ["auditing", "complete"]
    };
    const activeStages = flows[state.activeFlow] || [];
    activeStages.forEach(s => {
      updateStagePill(s, "done");
    });

    if (data.terminated && data.remaining_keywords && data.remaining_keywords.length > 0) {
      writeLogLine(`⛔ Scrape terminated. Loaded ${data.remaining_keywords.length} remaining keywords back into input.`, "warning");
      elKeywordsInput.value = data.remaining_keywords.join(", ");
      switchSearchMode("manual");
    } else {
      if (state.activeFlow === "manual_scrape") {
        writeLogLine("🎉 Manual Scrape Finished Successfully!", "success");
        elKeywordsInput.value = "";
      } else {
        writeLogLine("🎉 Agent Pipeline Finished Successfully!", "success");
      }
    }
    
    // Save last scraped search run information & show AI audit option if scraping finished
    if (state.activeFlow === "manual_scrape" && data.scraped && data.scraped.length > 0) {
      const validRuns = data.scraped.filter(run => run.search_id);
      if (validRuns.length > 0) {
        state.lastScrapedSearchId = validRuns[validRuns.length - 1].search_id;
        state.lastScrapedKeywords = validRuns.map(r => r.keyword).join(", ");
        const manualDesc = elManualDescriptionInput ? elManualDescriptionInput.value.trim() : "";
        state.activeRequirement = manualDesc || state.lastScrapedKeywords;
        if (elBtnLiveAudit) {
          elBtnLiveAudit.classList.remove("hidden");
        }
        writeLogLine("💡 Scraping complete. Click 'AI Audit Scraped' in the log header to audit target patents.", "info");
      }
    } else if (state.activeFlow === "ai_search" && data.scraped_count !== undefined) {
      state.lastScrapedSearchId = data.search_id;
      state.lastScrapedKeywords = elRequirementInput.value.trim() || "";
      state.activeRequirement = state.lastScrapedKeywords;
      if (elBtnLiveAudit) {
        elBtnLiveAudit.classList.remove("hidden");
      }
      writeLogLine("💡 Scraping complete. Click 'AI Audit Scraped' in the log header to audit target patents.", "info");
    } else if (state.activeFlow === "ai_audit") {
      writeLogLine("💡 Relevance assessment completed. Study the Novelty & Relevancy Dashboard below.", "info");
    }

    setPipelineLoading(false);
    
    if (state.activeFlow === "ai_search") {
      // Automatically transition back to requirement input for AI flows
      setTimeout(() => {
        resetAISearchPanel();
      }, 4000);
    }
    
    if (data.data) {
      renderHistory(data.data);
    }
  }

  if (stage === "error") {
    updateStagePill("complete", "error");
    writeLogLine(`❌ Critical Pipeline Error: ${message}`, "error");
    setPipelineLoading(false);
    alert(`Pipeline Error: ${message}`);
  }
}

function addPatentToNoveltyDashboard(patent) {
  if (!elNoveltyResultsPanel) return;
  elNoveltyResultsPanel.classList.remove("hidden");

  const label = patent.relevancy_label; // Red, Yellow, Green
  let listEl = null;
  let noveltyPercent = 0;
  let barColorClass = "";
  let badgeText = "";
  let badgeClass = "";

  if (label === "Red") {
    listEl = elNoveltyListRed;
    noveltyPercent = Math.round((1 - patent.confidence_score) * 100);
    barColorClass = "red";
    badgeText = "No/Low Novelty";
    badgeClass = "red";
  } else if (label === "Yellow") {
    listEl = elNoveltyListYellow;
    noveltyPercent = Math.round((1 - patent.confidence_score) * 100);
    barColorClass = "yellow";
    badgeText = "Moderate Novelty";
    badgeClass = "yellow";
  } else if (label === "Green") {
    listEl = elNoveltyListGreen;
    noveltyPercent = Math.round((1 - patent.confidence_score) * 100);
    barColorClass = "green";
    badgeText = "High Novelty";
    badgeClass = "green";
  }

  if (!listEl) return;

  // Build structured reasoning for novelty cards
  const overlapText = patent.overlap_reasons || "";
  const differenceText = patent.difference_reasons || "";
  const reasoningText = patent.reasoning || "";

  let reasoningSections = "";
  if (overlapText.trim()) {
    reasoningSections += `
      <div class="ai-reasoning-section overlap-section" style="margin-top: 6px;">
        <div class="section-label" style="font-size: 0.68rem;">🔴 Overlap</div>
        <div class="section-text" style="font-size: 0.75rem;">${escapeHtml(overlapText)}</div>
      </div>`;
  }
  if (differenceText.trim()) {
    reasoningSections += `
      <div class="ai-reasoning-section difference-section" style="margin-top: 4px;">
        <div class="section-label" style="font-size: 0.68rem;">🟢 Differs</div>
        <div class="section-text" style="font-size: 0.75rem;">${escapeHtml(differenceText)}</div>
      </div>`;
  }

  // Render the card HTML
  const card = document.createElement("div");
  card.className = "novelty-card";
  card.innerHTML = `
    <div class="novelty-card-header">
      <a href="${escapeHtml(patent.patent_url || '#')}" target="_blank" class="novelty-link">
        ${escapeHtml(patent.patent_code || 'Patent')}
        <svg style="width:10px;height:10px;margin-left:2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
      </a>
      <span class="novelty-score-badge novelty-score-badge--${badgeClass}">${badgeText}</span>
    </div>
    <h5 class="novelty-title">${escapeHtml(patent.title)}</h5>
    <div class="novelty-comparison" title="${escapeHtml(patent.comparison_query)}">
      <strong>Compared with:</strong> "${escapeHtml(patent.comparison_query)}"
    </div>
    <div class="novelty-bar-wrap">
      <div class="novelty-bar-fill novelty-bar-fill--${barColorClass}" style="width: ${noveltyPercent}%;"></div>
    </div>
    <div style="font-size: 0.72rem; text-align: right; color: var(--text-secondary); margin-top: 2px; font-weight: 600;">
      Novelty Score: ${noveltyPercent}%
    </div>
    <div class="novelty-reasoning">
      <strong>Gemini:</strong> ${escapeHtml(reasoningText)}
    </div>
    ${reasoningSections}
  `;

  listEl.appendChild(card);
  
  // Auto-scroll list to bottom as new items show up
  listEl.scrollTop = listEl.scrollHeight;
}

function updateStagePill(stage, status) {
  const pillKey = stage === "complete" ? "complete" : stage;
  const pill = pills[pillKey];
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

  const activeSearches = (searches || []).filter(s => s.search_mode !== "failed");

  if (activeSearches.length === 0) {
    elHistoryContainer.innerHTML = `
      <div class="meta-text" style="padding: 40px; text-align: center; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
        No prior art searches recorded for this project yet.
      </div>
    `;
    return;
  }

  activeSearches.forEach(s => {
    const card = document.createElement("div");
    card.className = "query-card";
    card.id = `query-card-${s.id}`;
    
    const dateStr = parseUtcDate(s.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
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
          <button type="button" class="btn-ai-audit-trigger" data-search-id="${s.id}" title="Audit these patents with Gemini">AI Audit</button>
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
      updateGlobalSelectAllState();
    });

    const childCheckboxes = card.querySelectorAll(".patent-select-checkbox");
    childCheckboxes.forEach(cb => {
      cb.addEventListener("change", () => {
        const allChecked = Array.from(childCheckboxes).every(c => c.checked);
        headerCheckbox.checked = allChecked;
        updateGlobalSelectAllState();
      });
    });

    // Audit button click handler
    const btnAudit = card.querySelector(".btn-ai-audit-trigger");
    if (btnAudit) {
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
    const source = p.source || "Google Patents";

    // Build structured reasoning HTML
    let reasoningHtml = '';
    const hasOverlap = p.overlap_reasons && p.overlap_reasons.trim();
    const hasDifference = p.difference_reasons && p.difference_reasons.trim();
    const hasBasicReasoning = p.ai_reasoning && p.ai_reasoning.trim();

    if (hasBasicReasoning || hasOverlap || hasDifference) {
      reasoningHtml = `<div class="ai-reasoning-callout">`;
      
      if (hasBasicReasoning) {
        reasoningHtml += `
          <div class="reasoning-header">🤖 Gemini Assessment</div>
          <div style="color: var(--text-secondary); font-style: italic;">${escapeHtml(p.ai_reasoning)}</div>`;
      }

      if (hasOverlap) {
        reasoningHtml += `
          <div class="ai-reasoning-section overlap-section">
            <div class="section-label">🔴 Why It Overlaps With Your Invention</div>
            <div class="section-text">${escapeHtml(p.overlap_reasons)}</div>
          </div>`;
      }

      if (hasDifference) {
        reasoningHtml += `
          <div class="ai-reasoning-section difference-section">
            <div class="section-label">🟢 How Your Invention Differs</div>
            <div class="section-text">${escapeHtml(p.difference_reasons)}</div>
          </div>`;
      }

      reasoningHtml += `</div>`;
    }

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
            <span class="patent-source-badge">${escapeHtml(source)}</span>
            <span class="relevancy-badge relevancy-badge--${relevancy.toLowerCase()}">${relevancy}</span>
          </div>
          <p class="patent-abstract">${highlight(p.abstract)}</p>
          ${reasoningHtml}
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
  const checkedCbs = document.querySelectorAll(".patent-select-checkbox:checked");
  if (checkedCbs.length > 0) {
    const patentIds = Array.from(checkedCbs).map(cb => parseInt(cb.dataset.patentId, 10));
    downloadExport(format, patentIds);
  } else {
    downloadExport(format, null);
  }
}

// ── Settings modal ───────────────────────────────────────────────────────────
function showSettingsModal() {
  elModalSettings.classList.remove("hidden");
  // Highlight currently selected radio button
  const radio = elModalSettings.querySelector(`input[name="audit-mode"][value="${state.auditMode}"]`);
  if (radio) radio.checked = true;
  syncSourceCheckboxes();
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
  initStagePillsForFlow("ai_audit");
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
    state.activeTaskId = task_id;
    writeLogLine(`📡 Connection established. Audit Task ID: ${task_id}`, "info");
    startSSEStream(task_id);
  } catch (err) {
    writeLogLine(`❌ Failed to start audit task: ${err.message}`, "error");
  }
}


// ── Saved Search Strategies Modal ────────────────────────────────────────────
function parseUtcDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr.includes("Z") || dateStr.includes("+") || dateStr.includes("-") && dateStr.length > 10 && dateStr.includes("T")) {
    return new Date(dateStr);
  }
  return new Date(dateStr + " UTC");
}

function createStrategyItemElement(s) {
  const div = document.createElement("div");
  div.className = "saved-keyword-item";
  const isAi = s.search_mode === "ai";
  const isFailed = s.search_mode === "failed";
  
  const dateObj = parseUtcDate(s.created_at);
  const dateStr = dateObj.toLocaleDateString() + ", " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  let tagClass = "manual-tag";
  let tagText = "Manual";
  if (isAi) {
    tagClass = "ai-tag";
    tagText = "AI Strategy";
  } else if (isFailed) {
    tagClass = "failed-tag";
    tagText = "Failed / Remaining";
  }

  div.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0;">
      <input type="checkbox" class="strategy-item-checkbox" data-query="${escapeHtml(s.query)}" data-mode="${s.search_mode}" style="cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;" />
      <div class="saved-keyword-info" style="margin-left: 0;">
        <span class="query-tag ${tagClass}">${tagText}</span>
        <span class="saved-keyword-text" title="${escapeHtml(s.query)}">${escapeHtml(s.query)}</span>
        <span class="meta-text">${dateStr}</span>
      </div>
    </div>
    <button type="button" class="btn-primary btn-sm btn-load-strategy" style="flex-shrink: 0;">Load</button>
  `;

  div.querySelector(".btn-load-strategy").addEventListener("click", () => {
    const cleanedQuery = s.query.replace(/\s*\[[^\]]+\]\s*$/, "");
    if (isAi) {
      switchSearchMode("ai");
      elRequirementInput.value = cleanedQuery;
    } else {
      switchSearchMode("manual");
      elKeywordsInput.value = cleanedQuery;
    }
    elModalSavedKeywords.classList.add("hidden");
  });

  return div;
}

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

    // Divide into scraped vs failed/remaining
    const scrapedList = searches.filter(s => s.search_mode !== "failed");
    const failedList = searches.filter(s => s.search_mode === "failed");

    // Helper to build a section with a select-all checkbox and Load Selected button
    function createSection(titleText, items, isFailedSection) {
      const section = document.createElement("div");
      section.className = "saved-strategy-section";
      if (isFailedSection) {
        section.style.marginTop = "24px";
      }

      const headerRow = document.createElement("div");
      headerRow.className = "section-header-row";
      headerRow.style.display = "flex";
      headerRow.style.alignItems = "center";
      headerRow.style.justifyContent = "space-between";
      headerRow.style.borderBottom = "1px solid var(--border-color)";
      headerRow.style.paddingBottom = "6px";
      headerRow.style.marginBottom = "12px";

      const leftSide = document.createElement("div");
      leftSide.style.display = "flex";
      leftSide.style.alignItems = "center";
      leftSide.style.gap = "8px";

      const selectAllCb = document.createElement("input");
      selectAllCb.type = "checkbox";
      selectAllCb.className = "section-select-all";
      selectAllCb.style.cursor = "pointer";
      selectAllCb.style.width = "16px";
      selectAllCb.style.height = "16px";

      const titleEl = document.createElement("h4");
      titleEl.className = "section-title-sm";
      titleEl.style.margin = "0";
      titleEl.style.fontSize = "0.85rem";
      titleEl.style.textTransform = "uppercase";
      titleEl.style.color = isFailedSection ? "#f59e0b" : "var(--text-secondary)";
      titleEl.innerText = titleText;

      leftSide.appendChild(selectAllCb);
      leftSide.appendChild(titleEl);

      const loadSelectedBtn = document.createElement("button");
      loadSelectedBtn.type = "button";
      loadSelectedBtn.className = "btn-primary btn-sm btn-load-selected";
      loadSelectedBtn.style.fontSize = "0.75rem";
      loadSelectedBtn.style.padding = "4px 8px";
      loadSelectedBtn.style.borderRadius = "var(--radius-sm)";
      loadSelectedBtn.innerText = "Load Selected";

      headerRow.appendChild(leftSide);
      headerRow.appendChild(loadSelectedBtn);

      const container = document.createElement("div");
      container.className = "strategies-sublist";

      section.appendChild(headerRow);
      section.appendChild(container);

      if (items.length === 0) {
        container.innerHTML = isFailedSection 
          ? '<p class="meta-text">No failed or remaining keywords recorded.</p>'
          : '<p class="meta-text">No successfully scraped keywords yet.</p>';
        selectAllCb.disabled = true;
        loadSelectedBtn.disabled = true;
        loadSelectedBtn.style.opacity = "0.5";
      } else {
        items.forEach(s => {
          const div = createStrategyItemElement(s);
          container.appendChild(div);
        });

        // Set up Event Listeners
        selectAllCb.addEventListener("change", () => {
          const checkboxes = container.querySelectorAll(".strategy-item-checkbox");
          checkboxes.forEach(cb => {
            cb.checked = selectAllCb.checked;
          });
        });

        container.addEventListener("change", (e) => {
          if (e.target.classList.contains("strategy-item-checkbox")) {
            const checkboxes = Array.from(container.querySelectorAll(".strategy-item-checkbox"));
            const allChecked = checkboxes.every(cb => cb.checked);
            selectAllCb.checked = allChecked;
          }
        });

        loadSelectedBtn.addEventListener("click", () => {
          const checkedCbs = Array.from(container.querySelectorAll(".strategy-item-checkbox:checked"));
          if (checkedCbs.length === 0) {
            alert("Please select at least one keyword first.");
            return;
          }
          const queries = checkedCbs.map(cb => cb.dataset.query.replace(/\s*\[[^\]]+\]\s*$/, ""));
          const joinedQuery = queries.join(", ");
          
          const anyAi = checkedCbs.some(cb => cb.dataset.mode === "ai");
          if (anyAi) {
            switchSearchMode("ai");
            elRequirementInput.value = joinedQuery;
          } else {
            switchSearchMode("manual");
            elKeywordsInput.value = joinedQuery;
          }
          elModalSavedKeywords.classList.add("hidden");
        });
      }

      return section;
    }

    const scrapedSection = createSection("Successfully Scraped", scrapedList, false);
    const failedSection = createSection("Failed or Remaining Keywords", failedList, true);

    elSavedKeywordsList.appendChild(scrapedSection);
    elSavedKeywordsList.appendChild(failedSection);

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

async function handleTerminateScrape() {
  if (!state.activeTaskId) return;
  if (!confirm("Are you sure you want to stop the scrape? Remaining keywords will be loaded back into the input bar.")) {
    return;
  }
  elBtnTerminateScrape.disabled = true;
  elBtnTerminateScrape.innerText = "Stopping...";
  try {
    const res = await fetch(`/api/scrape/cancel/${state.activeTaskId}`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      alert(`Could not stop scrape: ${err.detail || "Unknown error"}`);
      elBtnTerminateScrape.disabled = false;
      elBtnTerminateScrape.innerText = "Stop";
    } else {
      writeLogLine("⛔ Stop request sent. Waiting for the current keyword scrape to finish...", "warning");
    }
  } catch (err) {
    console.error(err);
    alert("Error sending stop request");
    elBtnTerminateScrape.disabled = false;
    elBtnTerminateScrape.innerText = "Stop";
  }
}

// ── Event Handlers ───────────────────────────────────────────────────────────
function setupEventListeners() {
  if (elThemeToggle) {
    elThemeToggle.addEventListener("click", toggleTheme);
  }

  if (elBtnTerminateScrape) {
    elBtnTerminateScrape.addEventListener("click", handleTerminateScrape);
  }

  // Mode buttons
  elBtnModeManual.addEventListener("click", () => switchSearchMode("manual"));
  elBtnModeAi.addEventListener("click", () => switchSearchMode("ai"));

  // Live Log Audit Button and Auditing Pill Option
  if (elBtnLiveAudit) {
    elBtnLiveAudit.addEventListener("click", () => {
      if (!state.lastScrapedSearchId) {
        alert("No recently scraped data available. Please run a search first.");
        return;
      }
      const requirement = state.activeRequirement || elRequirementInput.value.trim() || state.lastScrapedKeywords || "";
      elBtnLiveAudit.classList.add("hidden");
      triggerAudit(state.lastScrapedSearchId, requirement);
    });
  }

  const pillAuditing = pills.auditing || document.getElementById("pill-auditing");
  if (pillAuditing) {
    pillAuditing.addEventListener("click", () => {
      if (!state.lastScrapedSearchId) {
        alert("No recently scraped data available. Please run a search first.");
        return;
      }
      const requirement = state.activeRequirement || elRequirementInput.value.trim() || state.lastScrapedKeywords || "";
      if (elBtnLiveAudit) elBtnLiveAudit.classList.add("hidden");
      triggerAudit(state.lastScrapedSearchId, requirement);
    });
  }

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
  elModalSettings.querySelectorAll('input[name="search-source"]').forEach(checkbox => {
    checkbox.addEventListener("change", handleSearchSourcesChange);
  });

  // CAPTCHA Mode Toggle
  if (elBtnCaptchaModeAuto) {
    elBtnCaptchaModeAuto.addEventListener("click", () => {
      state.captchaMode = "auto";
      elBtnCaptchaModeAuto.classList.add("active");
      elBtnCaptchaModeManual.classList.remove("active");
      if (elCaptchaServiceSection) elCaptchaServiceSection.style.display = "";
    });
  }
  if (elBtnCaptchaModeManual) {
    elBtnCaptchaModeManual.addEventListener("click", () => {
      state.captchaMode = "manual";
      elBtnCaptchaModeManual.classList.add("active");
      elBtnCaptchaModeAuto.classList.remove("active");
      if (elCaptchaServiceSection) elCaptchaServiceSection.style.display = "none";
    });
  }
  elModalSettings.querySelectorAll('input[name="captcha-service"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      state.captchaService = e.target.value;
    });
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

  // Select All History Checkbox
  if (elSelectAllHistoryCheckbox) {
    elSelectAllHistoryCheckbox.addEventListener("change", () => {
      const isChecked = elSelectAllHistoryCheckbox.checked;
      document.querySelectorAll(".keyword-select-checkbox").forEach(cb => {
        cb.checked = isChecked;
      });
      document.querySelectorAll(".patent-select-checkbox").forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) handlePatentCheckboxChange(cb);
      });
    });
  }

  // Global Delete Click
  let deletePayload = { searchIds: [], patentIds: [] };
  if (elBtnGlobalDelete) {
    elBtnGlobalDelete.addEventListener("click", () => {
      const { searchIds, patentIds, displayItems } = getSelectedItemsToDelete();
      if (searchIds.length === 0 && patentIds.length === 0) {
        alert("Please select at least one keyword search or patent to delete.");
        return;
      }
      deletePayload = { searchIds, patentIds };
      
      // Populate modal list
      if (elDeleteSelectedList) {
        elDeleteSelectedList.innerHTML = displayItems.map(item => {
          return `<div style="padding: 6px 10px; background: var(--bg-secondary); border-radius: var(--radius-sm); border: 1px solid var(--border-color); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(item)}</div>`;
        }).join("");
      }
      
      if (elModalDeleteConfirm) {
        elModalDeleteConfirm.classList.remove("hidden");
      }
    });
  }

  if (elBtnDeleteCancel) {
    elBtnDeleteCancel.addEventListener("click", () => {
      if (elModalDeleteConfirm) {
        elModalDeleteConfirm.classList.add("hidden");
      }
    });
  }

  if (elModalDeleteConfirm) {
    elModalDeleteConfirm.addEventListener("click", (e) => {
      if (e.target === elModalDeleteConfirm) {
        elModalDeleteConfirm.classList.add("hidden");
      }
    });
  }

  if (elBtnDeleteConfirmAction) {
    elBtnDeleteConfirmAction.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/history/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            search_ids: deletePayload.searchIds,
            patent_ids: deletePayload.patentIds
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Delete request failed");
        }
        
        // Hide modal
        if (elModalDeleteConfirm) {
          elModalDeleteConfirm.classList.add("hidden");
        }
        
        // Uncheck select all header
        if (elSelectAllHistoryCheckbox) {
          elSelectAllHistoryCheckbox.checked = false;
        }

        // Reload project history to refresh the list
        if (state.activeProjectId) {
          await loadProjectHistory(state.activeProjectId);
        }
      } catch (err) {
        alert(`Failed to delete selected items: ${err.message}`);
      }
    });
  }

  elBtnGlobalExportCsv.addEventListener("click", () => handleGlobalExport("csv"));
  elBtnGlobalExportPdf.addEventListener("click", () => handleGlobalExport("pdf"));

  // Source Toggle Buttons listeners
  if (elBtnSourceGoogle) {
    elBtnSourceGoogle.addEventListener("click", () => {
      state.searchSources = ["google"];
      localStorage.setItem("searchSources", JSON.stringify(state.searchSources));
      syncSourceToggleButtons();
      syncSourceCheckboxes();
      updateSourceFieldsVisibility();
    });
  }
  if (elBtnSourceIndia) {
    elBtnSourceIndia.addEventListener("click", () => {
      state.searchSources = ["india"];
      localStorage.setItem("searchSources", JSON.stringify(state.searchSources));
      syncSourceToggleButtons();
      syncSourceCheckboxes();
      updateSourceFieldsVisibility();
    });
  }

  // Manual Panel India Query builder row add/remove listeners
  if (elBtnManualIndiaAddRow && elManualIndiaQueryRowsContainer) {
    elBtnManualIndiaAddRow.addEventListener("click", () => {
      addRowToUi(elManualIndiaQueryRowsContainer);
    });
  }
  if (elBtnManualIndiaRemoveRow && elManualIndiaQueryRowsContainer) {
    elBtnManualIndiaRemoveRow.addEventListener("click", () => {
      const rows = elManualIndiaQueryRowsContainer.querySelectorAll(".india-query-row");
      if (rows.length > 1) {
        rows[rows.length - 1].remove();
      } else {
        alert("At least one query row is required.");
      }
    });
  }

  // India Options modal listeners
  if (elBtnIndiaOptions) {
    elBtnIndiaOptions.addEventListener("click", showIndiaOptionsModal);
  }
  if (elBtnCloseIndiaOptions) {
    elBtnCloseIndiaOptions.addEventListener("click", () => elModalIndiaOptions.classList.add("hidden"));
  }
  if (elBtnIndiaCancel) {
    elBtnIndiaCancel.addEventListener("click", () => elModalIndiaOptions.classList.add("hidden"));
  }
  elModalIndiaOptions.addEventListener("click", (e) => {
    if (e.target === elModalIndiaOptions) elModalIndiaOptions.classList.add("hidden");
  });
  if (elIndiaOptionsForm) {
    elIndiaOptionsForm.addEventListener("submit", saveIndiaOptions);
  }

  // CAPTCHA submit listener
  if (elCaptchaForm) {
    elCaptchaForm.addEventListener("submit", handleCaptchaSubmit);
  }
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

const INDIA_SEARCH_FIELDS_MAP = {
  "TI": "Title",
  "ABS": "Abstract",
  "CSP": "Complete Specification",
  "AP": "Application Number",
  "PN": "Publication Number",
  "patent-number": "Patent Number",
  "PA": "Applicant Name",
  "ANC": "Applicant Country",
  "ANA": "Applicant Address",
  "IN": "Inventor Name",
  "INC": "Inventor Country",
  "INA": "Inventor Address",
  "FO": "Filing Office",
  "IC": "International Classification",
  "PAP": "Patent Application Publication",
  "PPN": "PCT Publication Number"
};

function getYesterdayDateString() {
  const yesterday = new Date(Date.now() - 86400000);
  const dd = String(yesterday.getDate()).padStart(2, '0');
  const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yyyy = yesterday.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function getTodayDateString() {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

async function initIndiaOptions() {
  try {
    const res = await fetch("/api/settings/defaults");
    if (!res.ok) throw new Error("Could not load backend defaults");
    const defaults = await res.json();

    // Check if we already have local overrides
    const local = localStorage.getItem("indiaOptions");
    if (local) {
      state.indiaOptions = JSON.parse(local);
      if (state.indiaOptions) {
        if (state.indiaOptions.from_date && state.indiaOptions.from_date.includes("/")) {
          const parts = state.indiaOptions.from_date.split("/");
          if (parts.length === 3 && parseInt(parts[0], 10) > 12) {
            state.indiaOptions.from_date = `${parts[1]}/${parts[0]}/${parts[2]}`;
          }
        }
        if (state.indiaOptions.to_date && state.indiaOptions.to_date.includes("/")) {
          const parts = state.indiaOptions.to_date.split("/");
          if (parts.length === 3 && parseInt(parts[0], 10) > 12) {
            state.indiaOptions.to_date = `${parts[1]}/${parts[0]}/${parts[2]}`;
          }
        }
        // Safety: If saved to_date is today or in the future, automatically reset it to yesterday to avoid crash
        const todayStr = getTodayDateString();
        if (state.indiaOptions.to_date === todayStr) {
          state.indiaOptions.to_date = getYesterdayDateString();
        }
      }
    } else {
      state.indiaOptions = defaults.india_options;
    }
  } catch (err) {
    console.error("Error loading settings defaults:", err);
    // Fallback defaults if not set yet
    if (!state.indiaOptions) {
      state.indiaOptions = {
        published: true,
        granted: false,
        date_field: "APD",
        from_date: "01/01/2020",
        to_date: getYesterdayDateString(),
        logic_field: "AND",
        rows: [{ field: "TI", text: "", logic: "AND" }]
      };
    }
  }

  if (state.indiaOptions) {
    // Enforce default date rules if blank
    if (!state.indiaOptions.from_date) {
      state.indiaOptions.from_date = "01/01/2020";
    }
    if (!state.indiaOptions.to_date) {
      state.indiaOptions.to_date = getYesterdayDateString();
    }

    // Enforce mutual exclusivity
    if (state.indiaOptions.published && state.indiaOptions.granted) {
      state.indiaOptions.granted = false;
    }
  }

  renderManualIndiaQueryRows();
}

function showIndiaOptionsModal() {
  if (!state.indiaOptions) return;

  elIndiaOptPublished.checked = !!state.indiaOptions.published;
  elIndiaOptGranted.checked = !!state.indiaOptions.granted;
  elIndiaOptDateField.value = state.indiaOptions.date_field || "APD";
  elIndiaOptLogicField.value = state.indiaOptions.logic_field || "AND";
  elIndiaOptFromDate.value = state.indiaOptions.from_date || "01/01/2020";
  elIndiaOptToDate.value = state.indiaOptions.to_date || getYesterdayDateString();

  elModalIndiaOptions.classList.remove("hidden");
}

function addRowToUi(container, field = "TI", text = "", logic = "AND") {
  if (!container) return;
  const rowCount = container.querySelectorAll(".india-query-row").length;
  if (rowCount >= 5) {
    alert("Maximum of 5 query rows is allowed.");
    return;
  }

  const rowDiv = document.createElement("div");
  rowDiv.className = "india-query-row";

  // Build field select dropdown
  let fieldOptions = "";
  for (const [val, label] of Object.entries(INDIA_SEARCH_FIELDS_MAP)) {
    fieldOptions += `<option value="${val}" ${val === field ? "selected" : ""}>${label}</option>`;
  }

  rowDiv.innerHTML = `
    <select class="row-field">
      ${fieldOptions}
    </select>
    <input type="text" class="row-text" value="${escapeHtml(text)}" placeholder="Query term (e.g. COMPUTER IMPLEMENTED)">
    <select class="row-logic">
      <option value="AND" ${logic === "AND" ? "selected" : ""}>AND</option>
      <option value="OR" ${logic === "OR" ? "selected" : ""}>OR</option>
      <option value="NOT" ${logic === "NOT" ? "selected" : ""}>NOT</option>
    </select>
    <button type="button" class="btn-remove-row" title="Remove Row">
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none"><path d="M19 7L5 7M10 11V17M14 11V17M12 3L12 4M19 7L18 20C18 20.5523 17.5523 21 17 21H7C6.44772 21 6 20.5523 6 20L5 7M10 3L14 3C14.5523 3 15 3.44772 15 4V7H9V4C9 3.44772 9.44772 3 10 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;

  rowDiv.querySelector(".btn-remove-row").addEventListener("click", () => {
    rowDiv.remove();
  });

  container.appendChild(rowDiv);
}

function renderManualIndiaQueryRows() {
  if (!elManualIndiaQueryRowsContainer) return;
  elManualIndiaQueryRowsContainer.innerHTML = "";
  const rows = (state.indiaOptions && state.indiaOptions.rows) || [{ field: "TI", text: "", logic: "AND" }];
  rows.forEach(row => addRowToUi(elManualIndiaQueryRowsContainer, row.field, row.text, row.logic));
}

function saveIndiaOptions(e) {
  if (e) e.preventDefault();

  const published = elIndiaOptPublished.checked;
  const granted = elIndiaOptGranted.checked;
  if (!published && !granted) {
    alert("At least one publication type (Published or Granted) must be selected.");
    return;
  }

  // Keep rows from the manual panel if it has any, otherwise use active options
  const rows = [];
  if (elManualIndiaQueryRowsContainer) {
    elManualIndiaQueryRowsContainer.querySelectorAll(".india-query-row").forEach(rowDiv => {
      const field = rowDiv.querySelector(".row-field").value;
      const text = rowDiv.querySelector(".row-text").value.trim();
      const logic = rowDiv.querySelector(".row-logic").value;
      rows.push({ field, text, logic });
    });
  }

  state.indiaOptions = {
    published,
    granted,
    date_field: elIndiaOptDateField.value,
    from_date: elIndiaOptFromDate.value.trim() || "01/01/2020",
    to_date: elIndiaOptToDate.value.trim() || getYesterdayDateString(),
    logic_field: elIndiaOptLogicField.value,
    rows: rows.length > 0 ? rows : (state.indiaOptions.rows || [{ field: "TI", text: "", logic: "AND" }])
  };

  localStorage.setItem("indiaOptions", JSON.stringify(state.indiaOptions));
  elModalIndiaOptions.classList.add("hidden");
}

async function handleCaptchaSubmit(e) {
  e.preventDefault();
  const answer = elCaptchaInput.value.trim();
  const taskId = state.activeCaptchaTaskId;
  if (!answer || !taskId) return;

  elBtnCaptchaSubmit.disabled = true;
  elBtnCaptchaSubmit.innerText = "Verifying...";

  try {
    const res = await fetch(`/api/captcha/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "CAPTCHA submission failed");
    }
    writeLogLine("Submitted CAPTCHA answer. Waiting for verification...", "info");
    elModalCaptcha.classList.add("hidden");
  } catch (err) {
    alert(`Error submitting CAPTCHA: ${err.message}`);
  } finally {
    elBtnCaptchaSubmit.disabled = false;
    elBtnCaptchaSubmit.innerText = "Verify CAPTCHA";
  }
}

function updateGlobalSelectAllState() {
  if (!elSelectAllHistoryCheckbox) return;
  const allKeywordCbs = document.querySelectorAll(".keyword-select-checkbox");
  if (allKeywordCbs.length === 0) {
    elSelectAllHistoryCheckbox.checked = false;
    return;
  }
  const allChecked = Array.from(allKeywordCbs).every(cb => cb.checked);
  elSelectAllHistoryCheckbox.checked = allChecked;
}

function getSelectedItemsToDelete() {
  const searchIds = [];
  const patentIds = [];
  const displayItems = [];

  const cards = document.querySelectorAll(".query-card");
  cards.forEach(card => {
    const headerCb = card.querySelector(".keyword-select-checkbox");
    if (!headerCb) return;
    const searchId = parseInt(headerCb.dataset.searchId, 10);
    const searchQuery = card.querySelector(".query-text").textContent.trim();

    if (headerCb.checked) {
      searchIds.push(searchId);
      // Show just the keyword text
      displayItems.push(searchQuery);
    } else {
      const patentCbs = card.querySelectorAll(".patent-select-checkbox:checked");
      patentCbs.forEach(cb => {
        const patentId = parseInt(cb.dataset.patentId, 10);
        const titleEl = cb.closest(".patent-card").querySelector(".patent-title");
        const titleText = titleEl ? titleEl.textContent.trim() : "";
        patentIds.push(patentId);
        // Show just the patent title (or ID if no title)
        displayItems.push(titleText || `Patent #${patentId}`);
      });
    }
  });

  return { searchIds, patentIds, displayItems };
}



