'use strict';
(() => {
  var storage = browserApi.storage;
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('toggleEnabled');
    const reloadNote = document.getElementById('reloadNote');
    const scanLimitInput = document.getElementById('pref-scanLimit');
    const scanIntervalInput = document.getElementById('pref-scanInterval');
    const mainContent = document.getElementById('mainContent');
    const emptyState = document.getElementById('emptyState');
    const cacheCountLabel = document.getElementById('cacheCountLabel');
    const btnClearCache = document.getElementById('btnClearCache');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnSelectNone = document.getElementById('btnSelectNone');

    function flashCheckIcon(btn) {
      const orig = btn.textContent;
      btn.textContent = '';
      if (typeof ICONS !== 'undefined' && ICONS.check) {
        const img = document.createElement('img');
        img.src = ICONS.check;
        img.alt = '';
        img.className = 'popup-btn-icon';
        btn.appendChild(img);
      }
      setTimeout(() => {
        btn.textContent = orig;
      }, 800);
    }

    let prefs = { ...DEFAULT_BADGE_PREFS };

    async function loadSettings() {
      if (browserApi.tabs) {
        browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const url = tabs[0]?.url || '';
          if (url.includes('indeed.com') || url.includes('indeed.')) {
            mainContent.style.display = 'block';
            emptyState.style.display = 'none';
          } else {
            mainContent.style.display = 'none';
            emptyState.style.display = 'block';
          }
        });
      }

      try {
        const res = await storage.local.get(['extensionEnabled', 'badgePrefs', 'nizViewerCache']);
        toggle.checked = res.extensionEnabled !== false;

        if (res.badgePrefs) prefs = { ...DEFAULT_BADGE_PREFS, ...res.badgePrefs };

        document.querySelectorAll('.pref-toggle').forEach((t) => {
          const prefKey = t.getAttribute('data-pref');
          t.checked = prefs[prefKey] !== false;
        });

        if (scanLimitInput) scanLimitInput.value = prefs.scanLimit ?? 5;
        if (scanIntervalInput) scanIntervalInput.value = prefs.scanInterval ?? 1500;

        if (cacheCountLabel) {
          const count = res.nizViewerCache ? Object.keys(res.nizViewerCache).length : 0;
          cacheCountLabel.textContent = `${count} job${count === 1 ? '' : 's'} cached`;
        }
      } catch (e) {
        console.error('Failed to load settings', e);
        if (reloadNote) {
          reloadNote.textContent = 'Error loading settings.';
          reloadNote.style.color = 'red';
          reloadNote.style.display = 'block';
        }
      }
    }

    async function saveAndBroadcast() {
      try {
        await storage.local.set({ badgePrefs: prefs });
        if (browserApi.tabs) {
          browserApi.tabs.query({ url: ['*://*.indeed.com/*', '*://*.indeed.*/*'] }, (tabs) => {
            if (tabs)
              tabs.forEach((t) => {
                try {
                  browserApi.tabs.sendMessage(t.id, { type: 'PREFS_CHANGED', prefs });
                } catch (e) {}
              });
          });
        }
      } catch (e) {
        if (reloadNote) {
          reloadNote.textContent = 'Failed to save preference.';
          reloadNote.style.display = 'block';
        }
      }
    }

    async function updatePref(key, value) {
      prefs[key] = value;
      await saveAndBroadcast();
    }

    document.querySelectorAll('.pref-toggle').forEach((t) => {
      t.addEventListener('change', () => updatePref(t.getAttribute('data-pref'), t.checked));
    });

    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', async () => {
        document.querySelectorAll('.pref-toggle').forEach((t) => {
          t.checked = true;
          prefs[t.getAttribute('data-pref')] = true;
        });
        await saveAndBroadcast();
        flashCheckIcon(btnSelectAll);
      });
    }

    if (btnSelectNone) {
      btnSelectNone.addEventListener('click', async () => {
        document.querySelectorAll('.pref-toggle').forEach((t) => {
          t.checked = false;
          prefs[t.getAttribute('data-pref')] = false;
        });
        await saveAndBroadcast();
        flashCheckIcon(btnSelectNone);
      });
    }

    if (btnClearCache) {
      btnClearCache.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear all extracted job data?')) return;
        try {
          await storage.local.remove('nizViewerCache');
          cacheCountLabel.textContent = '0 jobs cached';
          if (browserApi.tabs) {
            browserApi.tabs.query({ url: ['*://*.indeed.com/*', '*://*.indeed.*/*'] }, (tabs) => {
              if (tabs)
                tabs.forEach((t) => {
                  try {
                    browserApi.tabs.sendMessage(t.id, { type: 'CACHE_CLEARED' });
                  } catch (e) {}
                });
            });
          }
        } catch (e) {
          console.error(e);
        }
      });
    }

    if (scanLimitInput) {
      scanLimitInput.addEventListener('change', () => {
        const val = Math.max(0, parseInt(scanLimitInput.value, 10) || 0);
        scanLimitInput.value = val;
        updatePref('scanLimit', val);
      });
    }

    if (scanIntervalInput) {
      scanIntervalInput.addEventListener('change', () => {
        const val = Math.max(500, parseInt(scanIntervalInput.value, 10) || 1500);
        scanIntervalInput.value = val;
        updatePref('scanInterval', val);
      });
    }

    toggle.addEventListener('change', async () => {
      const isEnabled = toggle.checked;
      try {
        await storage.local.set({ extensionEnabled: isEnabled });
        if (browserApi.tabs) {
          browserApi.tabs.query({ url: ['*://*.indeed.com/*', '*://*.indeed.*/*'] }, (tabs) => {
            if (tabs)
              tabs.forEach((t) => {
                try {
                  browserApi.tabs.sendMessage(t.id, {
                    type: 'EXTENSION_STATE_CHANGED',
                    enabled: isEnabled,
                  });
                } catch (e) {}
              });
          });
        }
      } catch (e) {
        if (reloadNote) {
          reloadNote.textContent = 'Failed to toggle extension.';
          reloadNote.style.color = 'red';
          reloadNote.style.display = 'block';
        }
      }
    });

    loadSettings();
  });
})();
