'use strict';
(() => {
  const storage = browserApi.storage;
  const FIELD_LABELS = {
    datePosted: 'Posting date',
    salary: 'Salary and compensation',
    shift: 'Shift schedule',
    workSetup: 'Work setup',
    experience: 'Experience requirement',
    jobType: 'Job type',
    degree: 'Education and degree',
    techStack: 'Technology stack',
    benefits: 'Benefits',
    perks: 'Allowances and perks',
    ageLimit: 'Age limits',
    gender: 'Gender specifics',
  };

  document.addEventListener('DOMContentLoaded', () => {
    const byId = (id) => document.getElementById(id);
    const toggle = byId('toggleEnabled');
    const note = byId('reloadNote');
    const main = byId('mainContent');
    const empty = byId('emptyState');
    const fieldControls = byId('fieldControls');
    const categoryControls = byId('categoryControls');
    const colorRules = byId('colorRules');
    let prefs = normalizeBadgePrefs(DEFAULT_BADGE_PREFS);

    function showNote(message, error = false) {
      note.textContent = message;
      note.style.display = 'block';
      note.style.color = error ? 'var(--danger)' : 'var(--muted)';
      window.clearTimeout(showNote.timer);
      showNote.timer = window.setTimeout(() => {
        note.style.display = 'none';
      }, 2200);
    }

    function createSwitch(id, label, prefKey) {
      const row = document.createElement('div');
      row.className = 'row';
      const text = document.createElement('label');
      text.htmlFor = id;
      text.textContent = label;
      row.appendChild(text);
      const switchLabel = document.createElement('label');
      switchLabel.className = 'switch';
      const input = document.createElement('input');
      input.id = id;
      input.type = 'checkbox';
      input.className = 'pref-toggle';
      input.dataset.pref = prefKey;
      const track = document.createElement('span');
      track.className = 'track';
      switchLabel.append(input, track);
      row.appendChild(switchLabel);
      return row;
    }

    for (const [key, label] of Object.entries(FIELD_LABELS)) {
      fieldControls.appendChild(createSwitch(`pref-${key}`, label, key));
    }

    const categories =
      typeof TECH_CATEGORIES === 'undefined'
        ? []
        : [...new Set(TECH_CATEGORIES.map((category) => category.label))];
    for (const category of categories) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.category = category;
      label.append(input, document.createTextNode(category));
      categoryControls.appendChild(label);
    }

    async function broadcast(message) {
      if (!browserApi.tabs) return;
      try {
        const tabs = await browserApi.tabs.query({});
        for (const tab of tabs || []) {
          if (!/^https?:\/\/[^/]*indeed\./i.test(tab.url || '')) continue;
          browserApi.tabs.sendMessage(tab.id, message)?.catch?.(() => {});
        }
      } catch {}
    }

    async function savePrefs(message = 'Preferences updated.') {
      try {
        await storage.local.set({ badgePrefs: prefs });
        await broadcast({ type: 'PREFS_CHANGED', prefs });
        showNote(message);
      } catch {
        showNote('Could not save preferences.', true);
      }
    }

    function syncControls() {
      document.querySelectorAll('.pref-toggle').forEach((input) => {
        input.checked = prefs[input.dataset.pref] !== false;
      });
      for (const id of ['density', 'theme', 'freshJobDays', 'oldJobDays']) {
        byId(id).value = prefs[id];
      }
      byId('hideOldJobs').checked = prefs.hideOldJobs === true;
      document.querySelectorAll('[data-category]').forEach((input) => {
        input.checked = prefs.hiddenTechCategories?.[input.dataset.category] !== true;
      });
      byId('oldJobDays').disabled = !prefs.hideOldJobs;
      byId('maxExperienceYears').disabled = !prefs.hideByExperience;
      renderColorRules();
    }

    function renderColorRules() {
      colorRules.replaceChildren();
      prefs.cardColorRules.forEach((rule, index) => {
        const row = document.createElement('div');
        row.className = 'color-rule row';
        const field = document.createElement('select');
        [['age', 'Posting age'], ['experience', 'Experience']].forEach(([v, t]) => { const option = document.createElement('option'); option.value = v; option.textContent = t; field.appendChild(option); });
        field.value = rule.field;
        const operator = document.createElement('select');
        [['lt', 'less than'], ['lte', 'at most'], ['gt', 'more than'], ['gte', 'at least'], ['eq', 'equals']].forEach(([v, t]) => { const option = document.createElement('option'); option.value = v; option.textContent = t; operator.appendChild(option); });
        operator.value = rule.operator;
        const value = document.createElement('input');
        value.type = 'number'; value.min = '0'; value.max = rule.field === 'age' ? '365' : '25'; value.step = '0.5'; value.value = rule.value;
        const color = document.createElement('input');
        color.type = 'color'; color.value = /^#[0-9a-f]{6}$/i.test(rule.color) ? rule.color : '#eaf8f1';
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.dataset.removeRule = String(index);
        row.append(field, operator, value, color, remove); colorRules.appendChild(row);
        const saveRule = () => {
          const current = prefs.cardColorRules[index]; if (!current) return;
          current.field = field.value; current.operator = operator.value;
          current.value = Math.min(Number(current.field === 'age' ? 365 : 25), Math.max(0, Number(value.value) || 0));
          current.color = /^#[0-9a-f]{6}$/i.test(color.value) ? color.value.toLowerCase() : '#eaf8f1';
          prefs.cardColorRules = normalizeCardColorRules(prefs.cardColorRules); savePrefs('Color rule saved.'); syncControls();
        };
        field.addEventListener('change', saveRule); operator.addEventListener('change', saveRule); value.addEventListener('change', saveRule); color.addEventListener('change', saveRule);
      });
      byId('addColorRule').disabled = prefs.cardColorRules.length >= 12;
    }

    async function load() {
      try {
        if (browserApi.tabs) {
          const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
          const supported = /^https?:\/\/[^/]*indeed\./i.test(tabs?.[0]?.url || '');
          main.style.display = supported ? 'block' : 'none';
          empty.style.display = supported ? 'none' : 'block';
        }
        const result = await storage.local.get([
          'extensionEnabled',
          'badgePrefs',
          'nizViewerCache',
        ]);
        toggle.checked = result.extensionEnabled !== false;
        prefs = normalizeBadgePrefs(result.badgePrefs);
        syncControls();
        const count = Object.keys(result.nizViewerCache || {}).length;
        byId('cacheCountLabel').textContent = `${count} cached job${count === 1 ? '' : 's'}`;
      } catch {
        showNote('Could not load NizViewer settings.', true);
      }
    }

    fieldControls.addEventListener('change', (event) => {
      const key = event.target?.dataset?.pref;
      if (!key) return;
      prefs[key] = event.target.checked;
      savePrefs();
    });
    categoryControls.addEventListener('change', (event) => {
      const category = event.target?.dataset?.category;
      if (!category) return;
      prefs.hiddenTechCategories[category] = !event.target.checked;
      savePrefs();
    });
    document
      .querySelectorAll('select[data-pref], input[type=number][data-pref]')
      .forEach((control) => {
        control.addEventListener('change', () => {
          const key = control.dataset.pref;
          const value = control.type === 'number' ? Number(control.value) : control.value;
          if (key === 'oldJobDays') prefs[key] = Math.min(365, Math.max(1, value || 30));
          else if (key === 'freshJobDays') prefs[key] = Math.min(90, Math.max(0, value || 0));
          else prefs[key] = value;
          if (key === 'freshJobDays' && prefs.oldJobDays <= prefs.freshJobDays) {
            prefs.oldJobDays = Math.min(365, prefs.freshJobDays + 1);
          }
          if (key === 'oldJobDays' && prefs.freshJobDays >= prefs.oldJobDays) {
            prefs.freshJobDays = Math.max(0, prefs.oldJobDays - 1);
          }
          syncControls();
          savePrefs();
        });
      });
    byId('hideOldJobs').addEventListener('change', (event) => {
      prefs.hideOldJobs = event.target.checked;
      syncControls();
      savePrefs(
        event.target.checked
          ? 'Older jobs will be hidden with a recovery control.'
          : 'Older jobs remain visible.',
      );
    });
    byId('hideByExperience').addEventListener('change', (event) => {
      prefs.hideByExperience = event.target.checked;
      syncControls();
      savePrefs(event.target.checked ? 'High-experience roles will be hidden.' : 'Experience filtering disabled.');
    });
    byId('maxExperienceYears').addEventListener('change', (event) => {
      prefs.maxExperienceYears = Math.min(25, Math.max(0, Number(event.target.value) || 0));
      syncControls(); savePrefs('Experience limit updated.');
    });
    byId('addColorRule').addEventListener('click', () => {
      if (prefs.cardColorRules.length >= 12) return;
      prefs.cardColorRules.push({ id: `rule-${Date.now()}`, field: 'age', operator: 'lt', value: 7, color: '#eaf8f1' });
      syncControls(); savePrefs('Color rule added.');
    });
    colorRules.addEventListener('click', (event) => {
      const index = Number(event.target?.dataset?.removeRule);
      if (!Number.isInteger(index) || !prefs.cardColorRules[index]) return;
      prefs.cardColorRules.splice(index, 1); syncControls(); savePrefs('Color rule removed.');
    });
    byId('btnSelectAll').addEventListener('click', () => {
      for (const key of Object.keys(FIELD_LABELS)) prefs[key] = true;
      syncControls();
      savePrefs('All fields enabled.');
    });
    byId('btnSelectNone').addEventListener('click', () => {
      for (const key of Object.keys(FIELD_LABELS)) prefs[key] = false;
      syncControls();
      savePrefs('Optional fields hidden.');
    });
    byId('btnReset').addEventListener('click', () => {
      prefs = normalizeBadgePrefs(DEFAULT_BADGE_PREFS);
      syncControls();
      savePrefs('Default preferences restored.');
    });
    byId('btnClearCache').addEventListener('click', async () => {
      if (!window.confirm('Clear all cached extracted job details?')) return;
      try {
        await storage.local.remove('nizViewerCache');
        byId('cacheCountLabel').textContent = '0 cached jobs';
        await broadcast({ type: 'CACHE_CLEARED' });
        showNote('Cached job details cleared.');
      } catch {
        showNote('Could not clear cached data.', true);
      }
    });
    toggle.addEventListener('change', async () => {
      try {
        await storage.local.set({ extensionEnabled: toggle.checked });
        await broadcast({ type: 'EXTENSION_STATE_CHANGED', enabled: toggle.checked });
        showNote(toggle.checked ? 'NizViewer enabled.' : 'NizViewer disabled.');
      } catch {
        showNote('Could not change extension state.', true);
      }
    });
    load();
  });
})();
