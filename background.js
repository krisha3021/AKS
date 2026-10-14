'use strict';
/* OmniConvert extension service worker:
   toolbar button opens the app; context menus send files/pages into it. */

function openApp(src) {
  const url = chrome.runtime.getURL('index.html') + (src ? '?src=' + encodeURIComponent(src) : '');
  chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => openApp());

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'omni-image', title: 'Convert image with OmniConvert', contexts: ['image'] });
  chrome.contextMenus.create({ id: 'omni-media', title: 'Convert media with OmniConvert', contexts: ['video', 'audio'] });
  chrome.contextMenus.create({ id: 'omni-link', title: 'Convert linked file with OmniConvert', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'omni-page', title: 'Convert this page with OmniConvert', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(info => {
  const src = info.srcUrl || info.linkUrl || info.pageUrl;
  if (src) openApp(src);
});
