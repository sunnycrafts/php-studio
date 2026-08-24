/* PHP Studio — FTP deploy. Connection settings are kept for the session;
 * host/user/dir can be remembered, the password is never written to disk. */
'use strict';

window.Deploy = (function () {
  let session = { host: '', port: 21, user: '', password: '', secure: false, remoteDir: '/' };

  function loadSaved() {
    const s = S.settings.ftp || {};
    session.host = s.host || '';
    session.port = s.port || 21;
    session.user = s.user || '';
    session.secure = !!s.secure;
    session.remoteDir = s.remoteDir || '/';
  }

  async function settingsDialog() {
    loadSavedIfEmpty();
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="prow"><label>Host</label><input type="text" id="ftpHost" placeholder="ftp.example.com" spellcheck="false"></div>
      <div class="prow"><label>Port</label><input type="number" id="ftpPort" min="1" max="65535"></div>
      <div class="prow"><label>Username</label><input type="text" id="ftpUser" spellcheck="false"></div>
      <div class="prow"><label>Password</label><input type="password" id="ftpPass"></div>
      <div class="prow"><label>Remote folder</label><input type="text" id="ftpDir" placeholder="/public_html" spellcheck="false"></div>
      <div class="prow"><label>FTPS (TLS)</label>
        <div class="switch"><input type="checkbox" id="ftpSecure"><span class="track"></span><span class="thumb"></span></div>
      </div>
      <p class="muted" style="font-size:11.5px;margin:12px 0 0">Host, port, username and folder are remembered. The password is kept only for this session and is never saved to disk.</p>
      <div id="ftpTestResult" style="margin-top:10px;font-size:12px"></div>`;
    $('#ftpHost', body).value = session.host;
    $('#ftpPort', body).value = session.port;
    $('#ftpUser', body).value = session.user;
    $('#ftpPass', body).value = session.password;
    $('#ftpDir', body).value = session.remoteDir;
    $('#ftpSecure', body).checked = session.secure;

    const readForm = (b) => ({
      host: $('#ftpHost', b).value.trim(),
      port: parseInt($('#ftpPort', b).value, 10) || 21,
      user: $('#ftpUser', b).value.trim(),
      password: $('#ftpPass', b).value,
      secure: $('#ftpSecure', b).checked,
      remoteDir: $('#ftpDir', b).value.trim() || '/',
    });

    await dialog({
      title: 'FTP Connection', body, width: 480,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Test Connection',
          beforeClose: async (b, btn) => {
            const cfg = readForm(b);
            const out = $('#ftpTestResult', b);
            out.innerHTML = '<span class="spin" style="display:inline-block;vertical-align:-3px"></span>  Connecting…';
            btn.disabled = true;
            try {
              const r = await studio.ftpTest(cfg);
              out.innerHTML = '';
              const ok = document.createElement('span');
              ok.style.color = 'var(--success)';
              ok.textContent = '✓ Connected — ' + (r.entries.length ? r.entries.slice(0, 5).join(', ') : 'folder is empty');
              out.appendChild(ok);
            } catch (err) {
              out.innerHTML = '';
              const bad = document.createElement('span');
              bad.style.color = 'var(--danger)';
              bad.textContent = '✗ ' + String(err.message || err).split('\n')[0];
              out.appendChild(bad);
            }
            btn.disabled = false;
            return false; // stay open
          },
        },
        {
          label: 'Save', primary: true,
          beforeClose: async (b) => {
            session = readForm(b);
            const { password, ...persist } = session;
            await studio.setSettings({ ftp: persist });
            Object.assign(S.settings, { ftp: persist });
            toast('ok', 'FTP settings saved');
            return true;
          },
        },
      ],
    });
  }

  function loadSavedIfEmpty() { if (!session.host) loadSaved(); }

  async function ensureReady() {
    loadSavedIfEmpty();
    if (!session.host || !session.user || !session.password) {
      await settingsDialog();
    }
    return !!(session.host && session.user && session.password);
  }

  function remotePath(rel) {
    const base = session.remoteDir.replace(/\/+$/, '');
    return (base || '') + '/' + rel.replace(/\\/g, '/');
  }

  async function uploadCurrent() {
    if (!S.active) { toast('warn', 'No file open'); return; }
    if (S.active.dirty) await Editor.save();
    if (!(await ensureReady())) return;
    const rel = S.project && S.active.path.startsWith(S.project)
      ? S.active.path.slice(S.project.length + 1)
      : S.active.name;
    const ok = await confirmDialog('Upload file',
      `Upload <b>${S.active.name}</b> to <b>${session.host}</b> as <span class="mono">${remotePath(rel)}</span>?`, 'Upload');
    if (!ok) return;
    await runUpload([{ local: S.active.path, remote: remotePath(rel) }]);
  }

  async function uploadProject() {
    if (!S.project) { toast('warn', 'No project open'); return; }
    if (!(await ensureReady())) return;
    const files = await studio.flatList(S.project);
    if (!files.length) { toast('warn', 'Nothing to upload'); return; }
    const ok = await confirmDialog('Upload project',
      `Upload <b>${files.length} files</b> from <b>${S.project.split(/[\\/]/).pop()}</b> to <b>${session.host}${session.remoteDir}</b>?`, 'Upload All');
    if (!ok) return;
    await runUpload(files.map((f) => ({ local: f.local, remote: remotePath(f.rel) })));
  }

  async function runUpload(jobs) {
    sbMessage(`Uploading 0/${jobs.length}…`);
    const off = studio.onFtpFileDone((p) => sbMessage(`Uploading ${p.done}/${p.total}… ${p.remote}`));
    try {
      const r = await studio.ftpUpload(session, jobs);
      sbMessage('');
      toast('ok', 'Upload completed', `${r.uploaded.length} file${r.uploaded.length === 1 ? '' : 's'} uploaded to ${session.host}`);
    } catch (e) {
      sbMessage('');
      toast('err', 'Upload failed', String(e.message || e).split('\n')[0], 6000);
    }
  }

  /* One-click install: FTP the file into wp-content/plugins/<slug>/, then
   * activate it via the WordPress REST API, then open the site. */
  /* plugin file + everything in its images/ folder */
  async function pluginJobs(f, slug) {
    const base = (session.remoteDir.replace(/\/+$/, '') || '') + '/wp-content/plugins/' + slug + '/';
    const jobs = [{ local: f.path, remote: base + f.name }];
    const all = await studio.flatList(S.project);
    for (const x of all) {
      const rel = x.rel.replace(/\\/g, '/');
      if (rel.startsWith('images/')) jobs.push({ local: x.local, remote: base + rel });
    }
    return jobs;
  }

  async function oneClickInstall(f, slug, wp) {
    if (!(await ensureReady())) return false;
    sbMessage('Uploading ' + f.name + '…');
    try {
      await studio.ftpUpload(session, await pluginJobs(f, slug));
    } catch (e) {
      sbMessage('');
      toast('err', 'Upload failed', String(e.message || e).split('\n')[0], 6000);
      return false;
    }
    sbMessage('Switching the plugin on…');
    const pluginId = slug + '/' + f.name.replace(/\.php$/i, '');
    try {
      await studio.wpActivate(wp.siteUrl, wp.user, wp.appPass, pluginId);
    } catch (e) {
      sbMessage('');
      toast('warn', 'Uploaded, but could not switch it on automatically',
        String(e.message || e).split('\n')[0] + ' — activate it in WordPress admin → Plugins instead.', 9000);
      return 'uploaded';
    }
    sbMessage('');
    toast('ok', 'Your page is live on WordPress!', 'The plugin was uploaded and switched on.', 6000);
    studio.openExternal(wp.siteUrl);
    return true;
  }

  /* Install flow: upload a plugin (and its images) into wp-content/plugins/<slug>/ */
  async function uploadPluginFile(f, slug) {
    if (!(await ensureReady())) return;
    const jobs = await pluginJobs(f, slug);
    const ok = await confirmDialog('Upload plugin',
      `Upload <b>${jobs.length} file${jobs.length === 1 ? '' : 's'}</b> to <b>${session.host}</b> under <span class="mono">wp-content/plugins/${slug}/</span>?<br><br>Afterwards, go to your WordPress admin → Plugins and click <b>Activate</b> on "${slug}".`, 'Upload');
    if (!ok) return;
    await runUpload(jobs);
  }

  /* Publish-on-save: quiet background upload of the saved file. */
  let autoQueue = Promise.resolve();
  function maybeAutoPublish(f) {
    if (!S.settings.autoPublish) return;
    loadSavedIfEmpty();
    if (!session.host || !session.user || !session.password) {
      sbMessage('Publish on save is on, but FTP is not signed in — open Deploy ▸ FTP Connection once.');
      return;
    }
    const rel = S.project && f.path.startsWith(S.project)
      ? f.path.slice(S.project.length + 1)
      : f.name;
    autoQueue = autoQueue.then(async () => {
      sbMessage('Publishing ' + f.name + '…');
      try {
        await studio.ftpUpload(session, [{ local: f.path, remote: remotePath(rel) }]);
        sbMessage('');
        toast('ok', 'Published', f.name + ' → ' + session.host, 2400);
      } catch (e) {
        sbMessage('');
        toast('err', 'Publish failed', String(e.message || e).split('\n')[0], 6000);
      }
    });
  }

  return { settingsDialog, uploadCurrent, uploadProject, maybeAutoPublish, uploadPluginFile, oneClickInstall };
})();
