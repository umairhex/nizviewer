'use strict';
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;

  api.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      const url = api.runtime.getURL('features.html');
      await api.tabs.create({ url });
    }
  });
})();
