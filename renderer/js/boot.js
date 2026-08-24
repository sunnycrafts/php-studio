/* PHP Studio — bootstrap. */
'use strict';

(async function boot() {
  S.info = await studio.appInfo();
  S.settings = await studio.getSettings() || {};

  AppInit.setThemeAttr(S.info.dark);
  studio.onThemeChanged((dark) => AppInit.setThemeAttr(dark));

  $('#sbVersion').textContent = 'v' + S.info.version;

  AppInit.buildMenubar();
  AppInit.buildToolbar();
  AppInit.initSplitters();
  AppInit.initShortcuts();
  restoreLayout(S.settings.layout);
  setView(S.settings.view || 'design');

  Project.initTabs();
  Project.initSearch();
  Project.buildComponents();
  Preview.initDevices();

  await Editor.initMonaco(S.info.monacoBase);

  studio.onPhpLog((s) => {
    if (/Fatal error|Parse error/i.test(s)) toast('err', 'PHP error', s.slice(0, 200), 5000);
  });

  Home.build();
  Home.setUIMode(S.settings.uiMode || 'simple', false);

  if (S.uiMode === 'simple') {
    // layperson flow: land on the Home screen and choose what to do
    Home.show();
  } else {
    // full editor: restore the last project like an IDE would
    const last = S.settings.lastProject;
    if (last && await studio.exists(last)) await Project.openProject(last);
    else await Project.openSamples();
    if (!S.settings.seenWelcome) {
      studio.setSettings({ seenWelcome: true });
      toast('info', 'Welcome to PHP Studio',
        'Just click anything on the page to change it — text, colors, sizes. Use Add to drag new pieces onto the page, Save when you like it, Publish to put it on your website.', 9000);
    }
  }
})();
