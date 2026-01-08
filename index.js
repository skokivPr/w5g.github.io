// --- CONSTANTS & STATE ---
const LS_KEYS = {
    CONFIG: 'w5g_sys_cfg_v2',
    DATA: 'w5g_sys_data_v2',
    ACTIVE_MODULE: 'w5g_active_module',
    GROUPS: 'w5g_sys_groups_v2'
};

// PROTOCOL: GROUP_IDENTIFICATION_MATRIX
// UPDATED: Icons are now raw SVG URLs (no color params needed)
const defaultGroupSettings = {
    D: { from: 0, label: 'D', cssVar: 'bg-d', colorDark: '#cc8a28', colorLight: '#d35400', icon: 'https://api.iconify.design/game-icons:rank-3.svg' },
    S: { from: 5, label: 'S', cssVar: 'bg-s', colorDark: '#0052cc', colorLight: '#0056b3', icon: 'https://api.iconify.design/game-icons:rank-2.svg' },
    L: { from: 10, label: 'L', cssVar: 'bg-l', colorDark: '#5981cc', colorLight: '#3178c6', icon: 'https://api.iconify.design/game-icons:rank-1.svg' },
    K: { from: 12, label: 'K', cssVar: 'bg-k', colorDark: '#cc6f44', colorLight: '#c0392b', icon: 'https://api.iconify.design/game-icons:rank-1.svg' },
    M: { from: 25, label: 'M', cssVar: 'bg-m', colorDark: '#cccc00', colorLight: '#b7950b', icon: 'https://api.iconify.design/game-icons:rank-1.svg' },
    Y: { from: 37, label: 'Y', cssVar: 'bg-y', colorDark: '#00cc00', colorLight: '#196f3d', icon: 'https://api.iconify.design/game-icons:rank-1.svg' }
};

// === DYNAMIC DATA STREAMS CONFIGURATION ===
// System automatically scans the repo for files matching 'w5g-*.json' pattern.
let DATA_MODULES = [];

let sys_config = {
    token: '',
    owner: 'skokivpr',
    repo: 'w5g.github.io',
    path: 'w5g-grudzien.json', // Default fallback
    branch: 'main'
};

let sys_state = {
    data: null,
    sha: null,
    isLocked: true,
    currentDayIdx: 0,
    activeWorker: null,
    monthRanges: []
};

const SHIFT_MAP = {
    '1': 'DZIEN_06-18',
    '2': 'NOC_18-06',
    'P1': 'PARKING_D1',
    'P2': 'PARKING_D2',
    'N1': 'NAGODZINY_N1',
    'N2': 'NAGODZINY_N2',
    'NP1': 'NAGODZINY_P1',
    'NP2': 'NAGODZINY_P2',
    'X': 'ABSENCJA_CRITICAL',
    'U': 'URLOP_WYPEŁNIONY',
    'S1': 'SZKOLENIE_TECH',
    'S2': 'SZKOLENIE_TECH',
    'ZW': 'ZWOLNIENIE_LEK',
    "W": "WOLNE_WEEKEND"
};

const WEEKDAYS_MAP = { 'PN': 0, 'WT': 1, 'ŚR': 2, 'CZ': 3, 'PT': 4, 'SO': 5, 'ND': 6 };
const WEEKDAYS_HEADER = ['PN', 'WT', 'ŚR', 'CZ', 'PT', 'SO', 'ND'];
const VALID_SHIFT_CODES = Object.keys(SHIFT_MAP);

// --- CORE UTILS ---

/**
 * PROTOCOL: INJECT_CSS_MASKING_ENGINE
 * Injects required styles for the masking protocol directly into DOM.
 */
const injectCoreStyles = () => {
    const styleId = 'sys-core-styles-v2';
    if (document.getElementById(styleId)) return;


    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = '';
    document.head.appendChild(style);
};

/**
 * Returns the current active theme color for a specific group.
 * Resolves based on 'data-theme' attribute.
 */
const getGroupColorForTheme = (group) => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    return currentTheme === 'light' ? group.colorLight : group.colorDark;
};


// --- CORE FUNCTIONS ---
async function init() {
    injectCoreStyles(); // <--- CRITICAL: Load CSS Engine
    loadConfig();
    loadGroupSettings();

    // 1. AUTO-DISCOVERY PROTOCOL
    await discoverDataStreams();

    // 2. Restore last active module or default
    const lastModule = localStorage.getItem(LS_KEYS.ACTIVE_MODULE);
    if (lastModule && DATA_MODULES.some(m => m.file === lastModule)) {
        sys_config.path = lastModule;
    } else if (DATA_MODULES.length > 0) {
        sys_config.path = DATA_MODULES[0].file;
    }

    loadCachedData();
    startClock();
    injectDataModuleSelector();
    updateFooter();

    if (!sys_state.data) {
        sys_state.currentDayIdx = 0;
    } else {
        identifyMonths();
        const today = new Date().getDate();
        const idx = sys_state.data.meta.days.findIndex(d => parseInt(d) === today);
        sys_state.currentDayIdx = idx !== -1 ? idx : 0;
        refreshUI();
    }

    document.getElementById('staff-search').addEventListener('input', (e) => renderStaffList(e.target.value));

    // Setup modal background click handlers
    setupModalBackgroundHandlers();
}

// === LOGIC REPAIRED: DYNAMIC GROUP RANGES ===
let groupSettings = { ...defaultGroupSettings };

function loadGroupSettings() {
    const saved = localStorage.getItem(LS_KEYS.GROUPS);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.keys(defaultGroupSettings).forEach(key => {
                if (parsed[key]) {
                    groupSettings[key] = { ...defaultGroupSettings[key], ...parsed[key] };

                    if (!groupSettings[key].colorLight) {
                        groupSettings[key].colorLight = parsed[key].color || defaultGroupSettings[key].colorLight;
                    }
                    if (!groupSettings[key].colorDark) {
                        groupSettings[key].colorDark = parsed[key].color || defaultGroupSettings[key].colorDark;
                    }
                }
            });
        } catch (e) {
            console.error("GROUP_CONFIG_LOAD_FAIL", e);
        }
    }
    applyThemeSpecificColors();
}

function applyThemeSpecificColors() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    Object.values(groupSettings).forEach(g => {
        const color = currentTheme === 'light' ? g.colorLight : g.colorDark;
        if (color) {
            document.documentElement.style.setProperty(`--${g.cssVar}`, color);
        }
    });
}

// === CRITICAL LOGIC FIX: SEQUENTIAL RANGES ===
function getWorkerGroup(id) {
    const pid = parseInt(id, 10);
    if (isNaN(pid)) return null;

    const sortedKeys = Object.keys(groupSettings).sort((a, b) => groupSettings[a].from - groupSettings[b].from);

    for (let i = 0; i < sortedKeys.length; i++) {
        const key = sortedKeys[i];
        const currentGrp = groupSettings[key];

        const nextKey = sortedKeys[i + 1];
        const nextFrom = nextKey ? groupSettings[nextKey].from : Infinity;

        if (pid >= currentGrp.from && pid < nextFrom) {
            return { ...currentGrp, id: key };
        }
    }
    return null;
}

async function syncGroupSettingsToGithub() {
    if (!sys_config.token) return;

    const fileName = 'ustawienia.json';
    const url = `https://api.github.com/repos/${sys_config.owner}/${sys_config.repo}/contents/${fileName}`;

    notify("INITIATING UPLINK: settings sync...", "info");

    try {
        // 1. Get SHA (if file exists)
        let sha = null;
        try {
            const getRes = await fetch(`${url}?ref=${sys_config.branch}`, {
                headers: { 'Authorization': `token ${sys_config.token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (getRes.ok) {
                const json = await getRes.json();
                sha = json.sha;
            }
        } catch (e) { /* Ignore 404 */ }

        // 2. Prepare Payload
        const contentStr = JSON.stringify(groupSettings, null, 2);
        const encoded = btoa(unescape(encodeURIComponent(contentStr)));

        const bodyPayload = {
            message: `SYS_MATRIX_CONFIG_UPDATE_${new Date().getTime()}`,
            content: encoded,
            branch: sys_config.branch
        };
        if (sha) bodyPayload.sha = sha;

        // 3. Push
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${sys_config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });

        if (!res.ok) throw new Error(`HTTP_${res.status}`);

        notify("REMOTE_CONFIG_SAVED: ustawienia.json", "success");

    } catch (err) {
        console.error("SETTINGS_SYNC_ERROR", err);
        notify(`SYNC_FAIL: ${err.message}`, "error");
    }
}

async function saveGroupConfig() {
    const container = document.getElementById('groups-editor-container');
    if (!container) return;

    const rows = container.querySelectorAll('.group-row');

    rows.forEach(row => {
        const id = row.dataset.id;
        const fromInput = row.querySelector('.inp-from');
        const colorDarkInput = row.querySelector('.inp-color-dark');
        const colorLightInput = row.querySelector('.inp-color-light');

        if (groupSettings[id]) {
            if (fromInput) {
                const val = parseInt(fromInput.value);
                if (!isNaN(val)) groupSettings[id].from = val;
            }
            if (colorDarkInput) {
                groupSettings[id].colorDark = colorDarkInput.value;
            }
            if (colorLightInput) {
                groupSettings[id].colorLight = colorLightInput.value;
            }
        }
    });

    localStorage.setItem(LS_KEYS.GROUPS, JSON.stringify(groupSettings));
    applyThemeSpecificColors();

    // Trigger remote sync
    await syncGroupSettingsToGithub();

    toggleModal('modal-groups', false);
    notify("MATRIX_UPDATED: Colors & Ranges Synced", "success");
    refreshUI();
}

function renderGroupConfigModal() {
    const container = document.getElementById('groups-editor-container');
    if (!container) return;

    const sortedEntries = Object.entries(groupSettings).sort((a, b) => a[1].from - b[1].from);

    container.innerHTML = `
                <form id="groups-form" style="display: flex; flex-direction: column; gap: 10px;">
                    <div style="font-size:10px; color:var(--text-secondary); margin-bottom:10px;">
                        SYSTEM AUTO-CALCULATES RANGES: [FROM] -> [NEXT_FROM - 1]
                    </div>
                    <div style="display:grid; grid-template-columns: 40px 1fr 1fr 60px 60px; gap:10px; font-size:14px; font-weight:bold; color:var(--text-secondary); padding: 0 12px;">
                        <span>ID</span>
                        <span>FROM (ID)</span>
                        <span>TO (AUTO)</span>
                        <span>NIGHT</span>
                        <span>DAY</span>
                    </div>
                    ${sortedEntries.map(([key, conf], index) => {
        const nextEntry = sortedEntries[index + 1];
        const endRange = nextEntry ? (nextEntry[1].from - 1) : '∞';

        return `
                        <div class="group-row" data-id="${key}" style="display:grid; grid-template-columns: 40px 1fr 1fr 60px 60px; gap:10px; align-items:center; background:var(--bg-input); padding:12px; border:1px solid var(--border-color);">
                            <div class="group-id-badge" style="background:var(--${conf.cssVar}); color:var(--text-badge); font-weight:bold; text-align:center; padding:2px;">${key}</div>

                            <div>
                                <input type="number" class="inp-from cell-input" value="${conf.from}" style="width: 100%; border:1px solid var(--border-color); background:var(--bg-card); text-align: left; padding-left: 5px;">
                            </div>

                            <div style="font-size:12px; font-weight:bold; color:var(--text-secondary); opacity: 0.7; padding-left:5px;">
                                -> ${endRange}
                            </div>

                            <!-- DARK MODE COLOR -->
                            <div style="display:flex; justify-content:center;">
                                <input type="color" class="inp-color-dark" value="${conf.colorDark}" title="NIGHT MODE (Dark Theme)" style="border:none; background:none; width:30px; height:30px; cursor:pointer;">
                            </div>

                            <!-- LIGHT MODE COLOR -->
                            <div style="display:flex; justify-content:center;">
                                <input type="color" class="inp-color-light" value="${conf.colorLight}" title="DAY MODE (Light Theme)" style="border:none; background:none; width:30px; height:30px; cursor:pointer;">
                            </div>
                        </div>
                    `;
    }).join('')}
                </form>
            `;
}

async function discoverDataStreams() {
    const apiUrl = `https://api.github.com/repos/${sys_config.owner}/${sys_config.repo}/contents/`;

    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (sys_config.token) {
            headers['Authorization'] = `token ${sys_config.token}`;
        }

        const res = await fetch(apiUrl, { headers });
        if (!res.ok) {
            console.warn(`[DISCOVERY_FAIL] HTTP ${res.status}`);
            DATA_MODULES = [
                { id: 'LOCAL_DEC', label: 'GRUDZIEN (OFFLINE)', file: 'w5g-grudzien.json' },
                { id: 'LOCAL_JAN', label: 'STYCZEN (OFFLINE)', file: 'w5g-styczen.json' }
            ];
            return;
        }

        const files = await res.json();
        if (!Array.isArray(files)) throw new Error("INVALID_REPO_STRUCTURE");

        const cycleFiles = files.filter(f =>
            f.name.startsWith('w5g-') &&
            f.name.endsWith('.json') &&
            f.name !== 'w5g.json'
        );

        DATA_MODULES = cycleFiles.map(f => {
            const coreName = f.name.replace(/^w5g-|.json$/g, '').toUpperCase();
            return {
                id: coreName,
                label: `${coreName}`,
                file: f.name
            };
        });

        DATA_MODULES.sort((a, b) => a.id.localeCompare(b.id));

        if (DATA_MODULES.length > 0) {
            notify(`DISCOVERED ${DATA_MODULES.length} DATA_STREAMS`, "success");
        }

    } catch (e) {
        console.error("DISCOVERY_ERROR:", e);
        DATA_MODULES = [
            { id: 'FALLBACK', label: 'SYSTEM_OFFLINE', file: 'w5g-grudzien.json' }
        ];
    }
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('system-clock').textContent = now.toTimeString().split(' ')[0];
    }, 1000);
}

function injectDataModuleSelector() {
    const container = document.querySelector('.top-bar-right');
    if (!container) return;

    const existing = document.getElementById('data-module-wrapper');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'data-module-wrapper';
    wrapper.className = 'custom-select';

    const label = document.createElement('span');
    label.innerText = "DATA_STREAM:";
    label.style.fontSize = "10px";
    label.style.color = "var(--text-secondary)";
    label.style.fontWeight = "bold";
    label.style.marginRight = "8px";

    const trigger = document.createElement('div');
    trigger.className = 'select-trigger';
    trigger.innerHTML = '<span id="selected-module-text">SELECT</span><i class="fas fa-chevron-down"></i>';

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'select-options';

    DATA_MODULES.forEach(mod => {
        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.value = mod.file;
        option.innerHTML = `<i class="fas fa-database"></i>${mod.label}`;
        if (mod.file === sys_config.path) {
            option.classList.add('selected');
            trigger.querySelector('#selected-module-text').textContent = mod.label;
        }
        option.addEventListener('click', () => {
            document.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            trigger.querySelector('#selected-module-text').textContent = mod.label;
            optionsContainer.classList.remove('show');
            trigger.classList.remove('active');
            switchDataModule(mod.file);
        });
        optionsContainer.appendChild(option);
    });

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        trigger.classList.toggle('active');
        optionsContainer.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        optionsContainer.classList.remove('show');
        trigger.classList.remove('active');
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);

    const labelWrapper = document.createElement('div');
    labelWrapper.style.display = 'flex';
    labelWrapper.style.alignItems = 'center';
    labelWrapper.style.gap = '8px';
    labelWrapper.appendChild(label);
    labelWrapper.appendChild(wrapper);

    container.insertBefore(labelWrapper, container.firstChild);
}

async function switchDataModule(newPath) {
    if (newPath === sys_config.path) return;

    notify(`MOUNTING_STREAM: ${newPath}...`, "info");
    sys_config.path = newPath;
    localStorage.setItem(LS_KEYS.ACTIVE_MODULE, newPath);

    sys_state.data = null;
    sys_state.sha = null;

    await syncData('pull');
}

function updateFooter() {
    if (sys_state.sha) document.getElementById('footer-sha').textContent = sys_state.sha.substring(0, 7);
    if (sys_config.path) document.getElementById('footer-path').textContent = sys_config.path;
    const now = new Date();
    document.getElementById('footer-sync').textContent = now.toTimeString().split(' ')[0];
}

// === LOGIC: DETECT MONTHS ===
function identifyMonths() {
    if (!sys_state.data) return;
    const { days, months } = sys_state.data.meta;
    sys_state.monthRanges = [];

    const activeMod = DATA_MODULES.find(m => m.file === sys_config.path);
    const defaultName = activeMod ? activeMod.label.replace('', '') : 'UNKNOWN_CYCLE';

    let rangeStart = 0;
    let monthIdx = 0;

    for (let i = 1; i < days.length; i++) {
        if (days[i] < days[i - 1]) {
            const metaName = (months && months[monthIdx]) ? months[monthIdx] : null;
            const finalName = metaName || `${defaultName} ${monthIdx + 1}`;

            sys_state.monthRanges.push({
                start: rangeStart,
                end: i - 1,
                name: finalName
            });
            rangeStart = i;
            monthIdx++;
        }
    }

    const metaName = (months && months[monthIdx]) ? months[monthIdx] : null;
    const finalName = metaName || (monthIdx === 0 ? defaultName : `${defaultName} ${monthIdx + 1}`);

    sys_state.monthRanges.push({
        start: rangeStart,
        end: days.length - 1,
        name: finalName
    });
}

function getCurrentMonthInfo() {
    const idx = sys_state.currentDayIdx;
    return sys_state.monthRanges.find(m => idx >= m.start && idx <= m.end);
}

// === NAVIGATION ===
function stepDay(delta) {
    if (!sys_state.data) return;
    const newIdx = sys_state.currentDayIdx + delta;
    if (newIdx >= 0 && newIdx < sys_state.data.meta.days.length) {
        sys_state.currentDayIdx = newIdx;
        renderDashboard();
    }
}

function stepMonth(delta) {
    if (!sys_state.data) return;
    const currentMonth = getCurrentMonthInfo();
    if (!currentMonth) return;

    const mIdx = sys_state.monthRanges.indexOf(currentMonth);
    if (mIdx === -1) return;

    const nextMIdx = mIdx + delta;

    if (nextMIdx >= 0 && nextMIdx < sys_state.monthRanges.length) {
        sys_state.currentDayIdx = sys_state.monthRanges[nextMIdx].start;
        renderDashboard();
    } else {
        notify("END_OF_DATA_STREAM. CHECK_DATA_STREAM_SELECTOR", "warning");
        const selector = document.getElementById('module-selector');
        if (selector) {
            selector.style.borderColor = 'var(--status-error)';
            setTimeout(() => selector.style.borderColor = 'var(--border-color)', 1000);
        }
    }
}

function jumpToDay(absIdx) {
    sys_state.currentDayIdx = absIdx;
    renderDashboard();
}

async function syncData(mode) {
    if (!sys_config.token) return toggleModal('modal-config', true);
    setLoader(true);
    const url = `https://api.github.com/repos/${sys_config.owner}/${sys_config.repo}/contents/${sys_config.path}`;
    try {
        if (mode === 'pull') {
            const res = await fetch(`${url}?ref=${sys_config.branch}`, {
                headers: { 'Authorization': `token ${sys_config.token}`, 'Accept': 'application/vnd.github.v3+json' }
            });

            // ERROR HANDLING UPGRADE: 404/422
            if (res.status === 404 || res.status === 422) {
                console.warn(`[SYNC_FAIL] File '${sys_config.path}' on branch '${sys_config.branch}' unreachable (HTTP ${res.status}).`);
                notify(`REMOTE_FILE_INVALID: ${sys_config.path} (Check Branch?)`, "error");
                // Stop here to prevent crashing
                throw new Error(`REMOTE_REF_INVALID_OR_MISSING (${res.status})`);
            }

            if (!res.ok) throw new Error(`HTTP_${res.status}`);

            const json = await res.json();
            const content = decodeURIComponent(atob(json.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
            sys_state.sha = json.sha;
            sys_state.data = JSON.parse(content);
            localStorage.setItem(LS_KEYS.DATA, content);
            identifyMonths();
            notify("DATA_PULL_SUCCESSFUL", "success");
            updateFooter();
            refreshUI();

            await new Promise(resolve => setTimeout(resolve, 3000));

        } else {
            if (!sys_state.data) throw new Error("NO_DATA_TO_PUSH");
            const contentStr = JSON.stringify(sys_state.data, null, 2);
            const encoded = btoa(unescape(encodeURIComponent(contentStr)));

            const bodyPayload = {
                message: `SYS_SYNC_${new Date().getTime()}`,
                content: encoded,
                branch: sys_config.branch
            };
            if (sys_state.sha) bodyPayload.sha = sys_state.sha;

            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${sys_config.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });
            if (!res.ok) throw new Error("PUSH_FAILED");
            const result = await res.json();
            sys_state.sha = result.content.sha;
            updateFooter();
            notify("REMOTE_STORAGE_UPDATED", "success");

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } catch (err) {
        if (!err.message.includes("REMOTE_REF")) {
            notify(`ERROR: ${err.message}`, "error");
        }
    } finally {
        setLoader(false);
    }
}

function refreshUI() {
    if (!sys_state.data) return;
    updateStats();
    renderDashboard();
    renderScheduleTable();
    renderStaffList();
    document.getElementById('json-editor').value = JSON.stringify(sys_state.data, null, 2);
}

function updateStats() {
    if (!sys_state.data) return;
    document.getElementById('val-workers').textContent = sys_state.data.workers.length;
    document.getElementById('val-days').textContent = sys_state.data.meta.days.length;
    let totalHours = 0;
    sys_state.data.workers.forEach(w => {
        w.shifts.forEach(s => {
            if (['1', '2', 'P1', 'P2', 'N1', 'N2'].includes(String(s).toUpperCase())) totalHours += 12;
        });
    });
    const avg = (totalHours / sys_state.data.workers.length).toFixed(1);
    document.getElementById('val-avg-hours').textContent = `${avg} H`;
}

// === VIEW: DASHBOARD HUD ===
// REFACTORED: Now aggregates Overtime (N1/N2/P1/P2) into main Day/Night cards
function renderDashboard() {
    if (!sys_state.data) return;
    const { meta, workers } = sys_state.data;
    const idx = sys_state.currentDayIdx;

    const curMonth = getCurrentMonthInfo();
    const monthName = curMonth ? curMonth.name : 'SECTOR_UNKNOWN';
    const weekday = meta.weekdays[idx];
    const dayNum = meta.days[idx];

    const activeMod = DATA_MODULES.find(m => m.file === sys_config.path);
    const moduleLabel = activeMod ? activeMod.label : sys_config.path;

    document.getElementById('day-counter').textContent = `DZIEŃ ROBOCZY [${idx + 1}/${meta.days.length}]`;
    document.getElementById('current-date-display').textContent = `${monthName} ${dayNum} [${weekday}]`;

    renderMiniCalendar(curMonth, moduleLabel);

    // LOGIC: AGGREGATION MAP
    // Defines which raw codes should merge into which Display Card
    const dayCodes = ['1', 'N1', 'NP1', 'P1'];
    const nightCodes = ['2', 'N2', 'NP2', 'P2'];

    const grouped = {};

    workers.forEach(w => {
        const rawCode = (w.shifts[idx] || '').trim().toUpperCase();

        if (rawCode.length > 0) {
            let cardKey = rawCode;

            // Aggregation Logic
            if (dayCodes.includes(rawCode)) cardKey = '1';
            else if (nightCodes.includes(rawCode)) cardKey = '2';

            if (!grouped[cardKey]) grouped[cardKey] = [];

            // Push structured object to keep track of original code
            grouped[cardKey].push({ worker: w, code: rawCode });
        }
    });

    const sortedCodes = Object.keys(grouped).sort();

    let html = '';
    sortedCodes.forEach(cardKey => {
        const count = grouped[cardKey].length;

        // Determine Card Styling based on Key
        const badgeClass = getTagClass(cardKey);

        let shiftLabel = SHIFT_MAP[cardKey] || `STATUS_${cardKey}`;
        // Custom Labels for Aggregated Cards
        if (cardKey === '1') shiftLabel = "DZIEN_06-18 [+P1]";
        if (cardKey === '2') shiftLabel = "NOC_18-06 [+P2]";

        html += `
            <div class="shift-card">
                <div class="shift-header">
                    <span class="shift-tag tag ${badgeClass}">${cardKey}</span>
                    <span class="shift-label">${shiftLabel}</span>
                    <span class="shift-count" style="margin-left: auto; font-weight: bold; color: var(--primary);">${count}</span>
                </div>
                <div class="shift-body">
                    ${grouped[cardKey].map(item => {
            const w = item.worker;
            const originalCode = item.code;
            const grp = getWorkerGroup(w.id);

            // LOGIC: CSS MASKING PROTOCOL
            let iconHtml = '';
            if (grp) {
                const themeColor = getGroupColorForTheme(grp);
                if (grp.icon) {
                    // MASKING: Using div with mask-image instead of img tag
                    iconHtml = `<div class="sys-icon-mask" style="--icon-url: url('${grp.icon}'); --icon-color: ${themeColor}; width: 25px; height: 25px; margin-right: 8px;"></div>`;
                } else {
                    iconHtml = `<i class="fas fa-circle" style="color:${themeColor}"></i>`;
                }
            }

            // SUB-BADGE Logic: Show original code if it differs from Card Key (e.g. N1 inside 1)
            // UPDATED: Now fetches mapped color class for the sub-badge
            let subBadge = '';
            if (originalCode !== cardKey) {
                let subBadgeClass = getTagClass(originalCode);
                // Specific Overtime Color Logic: Force 'sb-n' for N-codes to differentiate from Day color
                if (originalCode.startsWith('N')) subBadgeClass = 'sb-n';

                subBadge = `<span class="sys-mini-badge ${subBadgeClass}">${originalCode}</span>`;
            }

            return `
                            <div class="worker-entry">
                                ${iconHtml}
                                <span>${w.name}${subBadge}</span>
                            </div>
                        `
        }).join('')}
                </div>
            </div>`;
    });

    document.getElementById('shifts-grid').innerHTML = html || '<div style="color:var(--text-secondary); padding: 20px; border: 1px dashed var(--border-color);">NO_ACTIVE_SHIFTS // SYSTEM IDLE</div>';
}

function renderMiniCalendar(monthRange, moduleLabel) {
    const container = document.getElementById('mini-calendar');
    if (!container || !monthRange || !sys_state.data) return;

    const { meta } = sys_state.data;
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'mini-cal-header';
    const headerSpan = document.createElement('span');
    headerSpan.id = 'mini-calendar-month-name';
    headerSpan.textContent = `[ ${moduleLabel} ]`;
    header.appendChild(headerSpan);
    container.appendChild(header);

    const wrapper = document.createElement('div');
    wrapper.className = 'day-selector-wrapper';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.style.marginBottom = '5px';
    label.textContent = 'DZIEŃ ROBOCZY:';

    const customSelect = document.createElement('div');
    customSelect.className = 'custom-select';
    customSelect.style.width = '100%';

    const trigger = document.createElement('div');
    trigger.className = 'select-trigger';

    const selectedText = document.createElement('span');
    selectedText.id = 'selected-day-text';
    const currentDay = meta.days[sys_state.currentDayIdx];
    const currentWeekday = meta.weekdays[sys_state.currentDayIdx];
    selectedText.textContent = `${currentDay} (${currentWeekday})`;

    const icon = document.createElement('i');
    icon.className = 'fas fa-chevron-down';

    trigger.appendChild(selectedText);
    trigger.appendChild(icon);

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'select-options';

    for (let i = 0; i < meta.days.length; i++) {
        const dayVal = meta.days[i];
        const weekday = meta.weekdays[i];

        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.value = i;

        const optionIcon = document.createElement('i');
        optionIcon.className = 'fas fa-calendar-day';

        const optionText = document.createTextNode(`${dayVal} (${weekday})`);

        option.appendChild(optionIcon);
        option.appendChild(optionText);

        if (i === sys_state.currentDayIdx) {
            option.classList.add('selected');
        }

        const isWeekend = weekday === 'SO' || weekday === 'ND';
        if (isWeekend) {
            option.style.color = 'var(--primary)';
        }

        option.addEventListener('click', () => {
            document.querySelectorAll('.select-options .option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            selectedText.textContent = `${dayVal} (${weekday})`;
            optionsContainer.classList.remove('show');
            trigger.classList.remove('active');
            jumpToDay(i);
        });

        optionsContainer.appendChild(option);
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        trigger.classList.toggle('active');
        optionsContainer.classList.toggle('show');
    });

    const closeDropdown = (e) => {
        if (!customSelect.contains(e.target)) {
            optionsContainer.classList.remove('show');
            trigger.classList.remove('active');
        }
    };

    document.removeEventListener('click', closeDropdown);
    document.addEventListener('click', closeDropdown);

    customSelect.appendChild(trigger);
    customSelect.appendChild(optionsContainer);

    wrapper.appendChild(label);
    wrapper.appendChild(customSelect);
    container.appendChild(wrapper);
}

// === VIEW: SCHEDULE HUD (TABLE) ===
function renderScheduleTable() {
    if (!sys_state.data) return;
    const { meta, workers } = sys_state.data;
    const locked = sys_state.isLocked ? 'disabled' : '';

    let html = `<thead><tr><th width="40">ID</th><th width="200" style="text-align:left;">OPERATOR</th>`;
    meta.days.forEach((d, i) => {
        const weekend = meta.weekdays[i] === 'SO' || meta.weekdays[i] === 'ND';
        html += `<th class="${weekend ? 'highlight' : ''}">${d}<br>${meta.weekdays[i]}</th>`;
    });
    html += `<th>Σ</th></thead><tbody>`;

    workers.forEach((w, wIdx) => {
        let hrs = 0;
        const grp = getWorkerGroup(w.id);
        const themeColor = grp ? getGroupColorForTheme(grp) : 'inherit';

        const idStyle = grp ? `style="color:${themeColor}; font-weight:bold; opacity:0.7;"` : `style="opacity:0.5;"`;
        const nameStyle = grp
            ? `style="text-align:left; font-weight:bold; border-left: 2px solid ${themeColor}; padding-left: 8px; background: linear-gradient(90deg, ${themeColor}15, transparent);"`
            : `style="text-align:left; font-weight:bold;"`;

        html += `<tr><td ${idStyle}>${w.id}</td><td ${nameStyle}>${w.name}</td>`;

        w.shifts.forEach((s, dIdx) => {
            if (['1', '2', 'P1', 'P2', 'N1', 'N2'].includes(String(s).toUpperCase())) hrs += 12;

            const cellClass = getCellClass(s);
            html += `<td class="${cellClass}"><input type="text" class="cell-input" value="${s}" ${locked} onchange="modifyShift(${wIdx}, ${dIdx}, this.value)"></td>`;
        });
        html += `<td class="highlight">${hrs}H</td></tr>`;
    });
    document.getElementById('main-schedule-table').innerHTML = html + `</tbody>`;
}

function renderStaffList(filter = '') {
    if (!sys_state.data) return;
    const list = document.getElementById('staff-list');

    list.innerHTML = sys_state.data.workers
        .filter(w => w.name.toLowerCase().includes(filter.toLowerCase()))
        .map((w, idx) => {
            const grp = getWorkerGroup(w.id);
            let borderStyle = '';
            let backgroundStyle = '';

            let grpBadge = '';
            if (grp) {
                const themeColor = getGroupColorForTheme(grp);
                borderStyle = `border-left-color: ${themeColor} !important; border-left-width: 3px !important;`;
                backgroundStyle = `background: linear-gradient(90deg, ${themeColor}20, transparent);`;

                if (grp.icon) {
                    // MASKING
                    grpBadge = `<div class="sys-icon-mask" style="--icon-url: url('${grp.icon}'); --icon-color: ${themeColor}; width: 25px; height: 25px; margin-left: 6px;"></div>`;
                } else {
                    grpBadge = `<span style="font-size:14px; background:${themeColor}; color:var(--text-badge); padding:1px 4px; margin-left:6px; font-weight:bold; border-radius:0;">${grp.label}</span>`;
                }
            }

            return `
                <div class="nav-link" style="border-left-width: 2px; ${borderStyle} ${backgroundStyle}" onclick="viewStaffDetails(${idx})">
                    <div style="width:100%">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="font-weight:bold;">${w.name}</div>
                            ${grpBadge}
                        </div>
                        <div style="font-size:14px; opacity:0.5;">UID: ${w.id}</div>
                    </div>
                </div>
            `;
        }).join('');
}

function viewStaffDetails(idx) {
    if (!sys_state.data) return;
    sys_state.activeWorker = idx;
    const w = sys_state.data.workers[idx];
    const meta = sys_state.data.meta;
    const grp = getWorkerGroup(w.id);

    document.querySelectorAll('#staff-list .nav-link').forEach((el, i) => {
        if (el.textContent.includes(w.name)) el.classList.add('active');
        else el.classList.remove('active');
    });

    let total = 0;
    const shiftCounts = {};
    VALID_SHIFT_CODES.forEach(code => shiftCounts[code] = 0);
    ['X', 'U', 'S', 'ZW'].forEach(c => { if (!shiftCounts[c]) shiftCounts[c] = 0; });

    let calendarGridHtml = '';

    WEEKDAYS_HEADER.forEach(day => calendarGridHtml += `<div class="calendar-header-cell">${day}</div>`);

    const firstDayWeekday = meta.weekdays[0];
    let paddingDays = WEEKDAYS_MAP[firstDayWeekday];
    if (paddingDays === undefined) paddingDays = 0;

    for (let i = 0; i < paddingDays; i++) calendarGridHtml += `<div class="calendar-day-cell empty"></div>`;

    meta.days.forEach((d, i) => {
        const s = (w.shifts[i] || '').toUpperCase();
        const isWeekend = meta.weekdays[i] === 'SO' || meta.weekdays[i] === 'ND';

        if (['1', '2', 'P1', 'P2', 'N1', 'N2'].includes(s)) total += 12;

        if (shiftCounts.hasOwnProperty(s)) shiftCounts[s]++;
        else if (s) {
            if (!shiftCounts[s]) shiftCounts[s] = 1;
            else shiftCounts[s]++;
        }

        const badgeClass = getTagClass(s);
        const shiftDisplay = s ? `<span class="shift-tag ${badgeClass}">${s}</span>` : '';

        calendarGridHtml += `
            <div class="calendar-day-cell ${isWeekend ? 'weekend' : ''}">
                <div class="calendar-day-num">${d}</div>
                <div class="calendar-shift-code">${shiftDisplay}</div>
                <div style="font-size:7px; opacity:0.4; text-align:right;">${meta.weekdays[i]}</div>
            </div>`;
    });

    let statsHtml = `<div class="shift-stats-box"><div style="font-size:10px; font-weight:bold; color:var(--primary); margin-bottom:10px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">SHIFT_ANALYTICS</div>`;

    Object.keys(shiftCounts).sort().forEach(code => {
        if (shiftCounts[code] > 0) {
            const badgeClass = getTagClass(code);
            statsHtml += `<div class="stat-item"><span class="shift-tag ${badgeClass}" style="font-size:14px; width:25px; text-align:center;">${code}</span><span class="highlight">${shiftCounts[code]}x</span></div>`;
        }
    });
    statsHtml += `</div>`;

    let groupBadge = '';
    if (grp) {
        const themeColor = getGroupColorForTheme(grp);
        if (grp.icon) {
            // MASKING
            const iconMask = `<div class="sys-icon-mask" style="--icon-url: url('${grp.icon}'); --icon-color: var(--text-badge); width: 20px; height: 20px;"></div>`;
            groupBadge = `<div style="display:inline-flex; align-items:center; gap:8px; background:${themeColor}; color:var(--text-badge); padding:4px 10px; font-weight:bold; font-size:10px; margin-bottom:5px;">
                ${iconMask}
                <span>GROUP_${grp.label}</span>
            </div>`;
        } else {
            groupBadge = `<div style="display:inline-block; background:${themeColor}; color:var(--text-badge); padding:2px 8px; font-weight:bold; font-size:10px; margin-bottom:5px;">GROUP_${grp.label}</div>`;
        }
    }

    document.getElementById('staff-details').innerHTML = `
        <div class="staff-details-header">
            <div class="staff-details-info">${groupBadge}<div class="staff-details-label">OPERATOR_PROFILE</div><h1 class="highlight staff-details-name">${w.name}</h1><div class="staff-details-id">IDENTIFIER: ${w.id}</div></div>
            <div class="staff-details-hours-card"><div class="staff-details-hours-label">TOTAL_DUTY_HOURS</div><div class="staff-details-hours-value">${total} H</div></div>
        </div>
        <div class="staff-details-legend">
            <i class="fas fa-calendar-alt"></i> HARMONOGRAM_INDYWIDUALNY [ LEGENDA: ]
            <span class="staff-details-legend-items">[  <span class="shift-tag sb-1 day">D</span> <span class="shift-tag sb-2 night">N</span> <span class="shift-tag sb-x critical">X</span> <span class="shift-tag sb-u vacation">U</span> <span class="shift-tag sb-s training">S</span> ]</span>
        </div>
        <div class="calendar-layout"><div class="calendar-grid">${calendarGridHtml}</div>${statsHtml}</div>
        <div class="staff-details-status"><span class="highlight">STATUS:</span> Podmiot aktywny w systemie.</div>
    `;
}

window.modifyShift = (wIdx, dIdx, val) => {
    if (!sys_state.data) return;
    sys_state.data.workers[wIdx].shifts[dIdx] = val.toUpperCase();
    localStorage.setItem(LS_KEYS.DATA, JSON.stringify(sys_state.data));
    updateStats();
    renderDashboard();
};

function switchView(view, el) {
    document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    el.classList.add('active');
    document.getElementById('current-view-name').textContent = `${view.toUpperCase()}_HUD`;
}

function toggleSecurityLock() {
    sys_state.isLocked = !sys_state.isLocked;
    document.getElementById('access-mode').textContent = sys_state.isLocked ? 'READ_ONLY' : 'EDIT_MODE';
    document.getElementById('btn-lock').innerHTML = sys_state.isLocked ? '<i class="fas fa-lock"></i> ODBLOKUJ' : '<i class="fas fa-lock-open"></i> ZABLOKUJ';
    renderScheduleTable();
    notify(sys_state.isLocked ? "ACCESS_RESTRICTED" : "WRITE_ACCESS_GRANTED", sys_state.isLocked ? "info" : "warning");
}

function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);

    // Update button icon
    const themeBtn = document.querySelector('.btn-theme');
    if (themeBtn) {
        const icon = themeBtn.querySelector('i');
        if (icon) {
            icon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    applyThemeSpecificColors();
    refreshUI();
}

function notify(msg, type) {
    const el = document.getElementById('sys-notify');
    el.textContent = `> ${msg}`;
    el.style.borderLeftColor = type === 'error' ? 'var(--status-error)' : 'var(--primary)';
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 3000);
}

function setLoader(val) { document.getElementById('loader').style.display = val ? 'flex' : 'none'; }

function toggleModal(id, val) {
    // REPAIRED LOGIC: Auto-recover if modal missing
    let modal = document.getElementById(id);

    if (!modal && id === 'modal-groups') {
        createGroupsModal();
        modal = document.getElementById(id); // Try getting again
    }

    if (!modal) {
        console.error(`[MODAL_ERROR] Element with id '${id}' not found`);
        notify(`MODAL_SYSTEM_ERROR: ${id} NOT_FOUND`, "error");

        // Still try to init specific modals if creation function exists
        if (id === 'modal-groups') {
            createGroupsModal();
            // Don't recursive loop, just return. Next click should work if DOM updates.
        }
        return;
    }

    modal.style.display = val ? 'flex' : 'none';
    if (id === 'modal-groups' && val) {
        renderGroupConfigModal();
    }
}

function setupModalBackgroundHandlers() {
    // Setup click handlers for all modals with class 'sys-overlay'
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('sys-overlay')) {
            const modalId = e.target.id;
            if (modalId) {
                toggleModal(modalId, false);
            }
        }
    });
}

function createGroupsModal() {
    const modalHtml = `
        <div id="modal-groups" class="sys-overlay">
            <div class="sys-modal">
                <div class="sys-modal-header">
                    <span>GROUP_PROTOCOLS_EDITOR</span>
                    <i class="fas fa-times modal-close" onclick="toggleModal('modal-groups', false)"></i>
                </div>
                <div class="sys-modal-body">
                    <div id="groups-editor-container"></div>
                    <div class="button-group" style="margin-top:20px;">
                        <button class="btn btn-active" onclick="saveGroupConfig()">SAVE_MATRIX</button>
                        <button class="btn" onclick="toggleModal('modal-groups', false)">CANCEL</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function saveConfiguration() {
    sys_config.token = document.getElementById('cfg-token').value;
    sys_config.repo = document.getElementById('cfg-repo').value || 'skokivpr/w5g.github.io';
    if (sys_config.repo.includes('/')) {
        const parts = sys_config.repo.split('/');
        sys_config.owner = parts[0];
        sys_config.repo = parts[1];
    }
    localStorage.setItem(LS_KEYS.CONFIG, JSON.stringify(sys_config));
    toggleModal('modal-config', false);
    notify("CONFIG_UPDATED", "success");
}

function loadConfig() {
    const saved = localStorage.getItem(LS_KEYS.CONFIG);
    if (saved) {
        sys_config = JSON.parse(saved);
        document.getElementById('cfg-token').value = sys_config.token;
        document.getElementById('cfg-repo').value = `${sys_config.owner}/${sys_config.repo}`;
    }
}

function loadCachedData() {
    const saved = localStorage.getItem(LS_KEYS.DATA);
    if (saved) {
        sys_state.data = JSON.parse(saved);
        if (sys_state.data._sha) sys_state.sha = sys_state.data._sha;
        identifyMonths();
    }
}

window.onload = init;

// === HELPER FUNCTIONS: VISUAL CLASSIFICATION ===
function getTagClass(c) {
    c = (c || "").toUpperCase();
    if (c === "1") return "sb-1";
    if (c === "2") return "sb-2";
    if (c.startsWith("P")) return "sb-p";
    if (c.startsWith("N")) return "sb-1"; // N mapped to day style or sb-n

    if (c === "X") return "sb-x";
    if (c === "U" || c === "ZW") return "sb-u";
    if (c === "S") return "sb-s";

    return "sb-x";
}

function getCellClass(c) {
    c = (c || "").toUpperCase();
    if (c === "1") return "cell-1";
    if (c === "2") return "cell-2";
    if (c.startsWith("P")) return "cell-p";
    if (c.startsWith("N")) return "cell-n";

    if (c === "X") return "cell-x";
    if (c === "U" || c === "ZW") return "cell-u";
    if (c === "S") return "cell-s";

    return "";
}


