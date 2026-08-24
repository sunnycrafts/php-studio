/* PHP Studio — Home screen, site wizard, WordPress install flow, simple mode.
 * This is the layperson-first layer: big plain choices, no jargon. */
'use strict';

window.Home = (function () {

  /* ── simple / advanced mode ─────────────────────────── */
  function setUIMode(mode, persist) {
    S.uiMode = mode;
    document.body.classList.toggle('simple', mode === 'simple');
    if (mode === 'simple') setView('design');
    const b = $('#tbAdvanced span');
    if (b) b.textContent = mode === 'simple' ? 'Advanced' : 'Simple';
    if (persist !== false) studio.setSettings({ uiMode: mode });
    if (window.Editor && Editor.layoutSoon) Editor.layoutSoon();
  }
  function toggleUIMode() { setUIMode(S.uiMode === 'simple' ? 'full' : 'simple'); }

  /* ── home screen ────────────────────────────────────── */
  function show() {
    $('#homeScreen').style.display = 'flex';
    renderRecents();
  }
  function hide() { $('#homeScreen').style.display = 'none'; }

  function build() {
    const el = $('#homeScreen');
    el.innerHTML = `
      <div class="home-inner">
        <div class="home-head">
          <div class="home-logo">P</div>
          <div>
            <div class="home-title">PHP Studio</div>
            <div class="home-sub">Your website pages — no code needed.</div>
          </div>
        </div>
        <div class="home-cards">
          <button class="home-card" id="hcEdit">
            <span class="hc-icon">${ICONS.openFolder}</span>
            <span class="hc-title">Edit a page I have</span>
            <span class="hc-desc">Open a page file that was made for you and change anything on it — words, pictures, colors.</span>
          </button>
          <button class="home-card" id="hcNew">
            <span class="hc-icon">${ICONS.newFile}</span>
            <span class="hc-title">Create a new site page</span>
            <span class="hc-desc">Answer a few plain questions and get a ready-made one-page website you can put on WordPress.</span>
          </button>
          <button class="home-card" id="hcInstall">
            <span class="hc-icon">${ICONS.upload}</span>
            <span class="hc-title">Put a page on my website</span>
            <span class="hc-desc">Package a finished page as a WordPress plugin and get simple install steps.</span>
          </button>
        </div>
        <div class="home-recents">
          <div class="home-recents-title">Recent pages</div>
          <div id="homeRecentList"></div>
        </div>
        <div class="home-foot">
          <button class="home-link" id="hcSamples">Open the sample pages</button>
          <span class="home-dot">·</span>
          <button class="home-link" id="hcAdvanced">Full editor (advanced)</button>
        </div>
      </div>`;
    $('#hcEdit').addEventListener('click', async () => { const ok = await Project.openLooseFile(); if (ok !== false && S.active) hide(); });
    $('#hcNew').addEventListener('click', createWizard);
    $('#hcInstall').addEventListener('click', async () => {
      if (!S.active) { const r = await Project.openLooseFile(); if (!S.active) return; }
      hide();
      installDialog();
    });
    $('#hcSamples').addEventListener('click', async () => { await Project.openSamples(); hide(); });
    $('#hcAdvanced').addEventListener('click', async () => {
      setUIMode('full');
      if (!S.project) await Project.openSamples();
      hide();
    });
  }

  function renderRecents() {
    const box = $('#homeRecentList');
    if (!box) return;
    box.innerHTML = '';
    const recents = (S.settings.recentFiles || []);
    if (!recents.length) {
      box.innerHTML = '<div class="muted" style="font-size:12.5px;padding:6px 2px">Pages you open will show up here.</div>';
      return;
    }
    for (const r of recents.slice(0, 6)) {
      const item = document.createElement('button');
      item.className = 'home-recent';
      item.innerHTML = `<span class="ficon" style="color:var(--accent-text)">${ICONS.filePhp}</span><span class="hr-name"></span><span class="hr-path muted"></span>`;
      $('.hr-name', item).textContent = r.name;
      $('.hr-path', item).textContent = r.path;
      item.addEventListener('click', async () => {
        if (!(await studio.exists(r.path))) { toast('warn', 'File not found', 'It may have been moved or renamed.'); addRecent(r, true); return; }
        const dir = r.path.replace(/[\\/][^\\/]+$/, '');
        if (S.project !== dir) await Project.openProject(dir);
        await Editor.openFile(r.path);
        hide();
      });
      box.appendChild(item);
    }
  }

  function addRecent(entry, remove) {
    let list = (S.settings.recentFiles || []).filter((x) => x.path !== entry.path);
    if (!remove) list.unshift({ path: entry.path, name: entry.path.split(/[\\/]/).pop() });
    list = list.slice(0, 10);
    S.settings.recentFiles = list;
    studio.setSettings({ recentFiles: list });
    renderRecents();
  }

  /* ── site wizard ────────────────────────────────────── */
  const PALETTES = {
    warm:   { label: 'Warm & earthy',  bg: '#FAF7F2', tint: '#F1EBE1', head: '#211D17', text: '#575147', acc: '#A97B4F', accDark: '#8A5F38', accText: '#FFFFFF' },
    ocean:  { label: 'Clean blue',     bg: '#F7FAFC', tint: '#EAF1F7', head: '#14212B', text: '#4A5A66', acc: '#1D6FA5', accDark: '#155378', accText: '#FFFFFF' },
    forest: { label: 'Fresh green',    bg: '#F7FAF7', tint: '#EAF2EA', head: '#1A241A', text: '#4E5A4E', acc: '#3E7C4F', accDark: '#2D5E3A', accText: '#FFFFFF' },
    slate:  { label: 'Modern dark',    bg: '#FFFFFF', tint: '#F1F2F4', head: '#191B1F', text: '#54575E', acc: '#3B4252', accDark: '#23272F', accText: '#FFFFFF' },
  };

  async function createWizard() {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="prow"><label>Name of the business or person</label><input type="text" id="wzName" placeholder="e.g. Drashti Parikh" spellcheck="false"></div>
      <div class="prow"><label>One line about it</label><input type="text" id="wzTag" placeholder="e.g. Graphic designer for businesses & startups" spellcheck="false"></div>
      <div class="prow"><label>Big button says</label><input type="text" id="wzCta" placeholder="Get in touch" spellcheck="false"></div>
      <div class="prow"><label>Email</label><input type="text" id="wzEmail" placeholder="you@example.com" spellcheck="false"></div>
      <div class="prow"><label>Phone (optional)</label><input type="text" id="wzPhone" placeholder="+91 …" spellcheck="false"></div>
      <div class="prow"><label>Logo (optional)</label><button class="btn sm" id="wzLogo">Choose…</button><span class="muted" id="wzLogoName" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis"></span></div>
      <div class="prow"><label>Big top photo (optional)</label><button class="btn sm" id="wzHero">Choose…</button><span class="muted" id="wzHeroName" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis"></span></div>
      <div class="prow"><label>Colors</label><select id="wzPalette">${Object.entries(PALETTES).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></div>
      <div class="prow"><label>Opening hours (optional)</label><input type="text" id="wzHours" placeholder="e.g. Mon–Sat 10am–7pm" spellcheck="false"></div>
      <div class="prow"><label>Instagram (optional)</label><input type="text" id="wzInsta" placeholder="https://instagram.com/…" spellcheck="false"></div>
      <div class="prow"><label>Facebook (optional)</label><input type="text" id="wzFb" placeholder="https://facebook.com/…" spellcheck="false"></div>
      <div class="prow"><label>LinkedIn (optional)</label><input type="text" id="wzLi" placeholder="https://linkedin.com/in/…" spellcheck="false"></div>
      <div style="margin-top:14px;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-2)">Which parts should the page have?</div>
      <div class="wz-sections">
        <label class="chk"><input type="checkbox" data-sec="about" checked> About</label>
        <label class="chk"><input type="checkbox" data-sec="services" checked> What I offer</label>
        <label class="chk"><input type="checkbox" data-sec="gallery" checked> Photo gallery</label>
        <label class="chk"><input type="checkbox" data-sec="testimonials"> Kind words from clients</label>
        <label class="chk"><input type="checkbox" data-sec="pricing"> Pricing</label>
        <label class="chk"><input type="checkbox" data-sec="contact" checked> Contact</label>
      </div>
      <p class="muted" style="font-size:11.5px;margin-top:12px">You get a complete one-page website as a WordPress plugin — everything on it can be changed afterwards by clicking.</p>`;
    let logoPath = null, heroPath = null;
    $('#wzLogo', body).addEventListener('click', async () => {
      logoPath = await studio.pickImagePath() || logoPath;
      $('#wzLogoName', body).textContent = logoPath ? logoPath.split(/[\\/]/).pop() : '';
    });
    $('#wzHero', body).addEventListener('click', async () => {
      heroPath = await studio.pickImagePath() || heroPath;
      $('#wzHeroName', body).textContent = heroPath ? heroPath.split(/[\\/]/).pop() : '';
    });
    await dialog({
      title: 'Create a new site page', body, width: 560,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Create My Page', primary: true,
          beforeClose: async (b) => {
            const name = $('#wzName', b).value.trim();
            if (!name) { $('#wzName', b).focus(); return false; }
            const opts = {
              name,
              tagline: $('#wzTag', b).value.trim(),
              cta: $('#wzCta', b).value.trim(),
              email: $('#wzEmail', b).value.trim(),
              phone: $('#wzPhone', b).value.trim(),
              hours: $('#wzHours', b).value.trim(),
              socials: {
                Instagram: $('#wzInsta', b).value.trim(),
                Facebook: $('#wzFb', b).value.trim(),
                LinkedIn: $('#wzLi', b).value.trim(),
              },
              logoPath, heroPath,
              palette: $('#wzPalette', b).value,
              sections: $$('.wz-sections input', b).filter((c) => c.checked).map((c) => c.dataset.sec),
            };
            try { await createFromOptions(opts); } catch (err) { toast('err', 'Could not create the page', String(err.message || err)); return false; }
            return true;
          },
        },
      ],
    });
  }

  async function createFromOptions(opts) {
    const slug = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'my-site';
    const dir = S.info.documents + '\\PHP Studio Sites\\' + slug;
    await studio.mkdir(dir);
    const file = dir + '\\' + slug + '.php';
    if (await studio.exists(file)) throw new Error('A page for "' + opts.name + '" already exists in ' + dir);
    // copy chosen pictures into the project so they travel with it
    for (const key of ['logoPath', 'heroPath']) {
      if (opts[key]) {
        const base = opts[key].split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_');
        await studio.mkdir(dir + '\\images');
        await studio.copy(opts[key], dir + '\\images\\' + base);
        opts[key.replace('Path', 'Rel')] = 'images/' + base;
      }
    }
    await studio.writeNew(file, generatePlugin(opts, slug));
    await Project.openProject(dir);
    await Editor.openFile(file);
    hide();
    toast('ok', 'Your page is ready!',
      'Click anything to change it. When you like it, use "Put a page on my website" to install it on WordPress.', 9000);
  }

  /* ── the generator: a complete single-file WP plugin ── */
  function generatePlugin(opts, slug) {
    const p = PALETTES[opts.palette] || PALETTES.warm;
    const fn = slug.replace(/-/g, '_');
    const has = (s) => opts.sections.includes(s);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const name = esc(opts.name);
    const tagline = esc(opts.tagline || 'Welcome to my website');
    const today = new Date().toISOString().slice(0, 10);
    const email = esc(opts.email || 'hello@example.com');
    const cta = esc(opts.cta || 'Get in touch');
    const socials = Object.entries(opts.socials || {}).filter(([, url]) => url);

    let sections = '';

    if (has('about')) sections += `
<section class="sw-section" id="about">
  <div class="sw-container">
    <span class="sw-label">About</span>
    <h2 class="sw-title">Who I am</h2>
    <div class="sw-bar"></div>
    <p class="sw-text">Write a couple of sentences about yourself or your business here. What do you do, who do you help, and what makes you good at it? Click this text to change it.</p>
    <p class="sw-text">You can add a second paragraph too — or delete it if one is enough.</p>
  </div>
</section>
`;

    if (has('services')) sections += `
<section class="sw-section sw-tint" id="services">
  <div class="sw-container">
    <span class="sw-label">Services</span>
    <h2 class="sw-title">What I offer</h2>
    <div class="sw-bar"></div>
    <div class="sw-cards">
      <div class="sw-card">
        <h3 class="sw-card-title">First service</h3>
        <p class="sw-card-text">Describe your first service in one or two friendly sentences.</p>
      </div>
      <div class="sw-card">
        <h3 class="sw-card-title">Second service</h3>
        <p class="sw-card-text">Describe your second service. Click any card to edit or delete it.</p>
      </div>
      <div class="sw-card">
        <h3 class="sw-card-title">Third service</h3>
        <p class="sw-card-text">Describe your third service. You can duplicate a card to add more.</p>
      </div>
    </div>
  </div>
</section>
`;

    if (has('gallery')) sections += `
<section class="sw-section" id="gallery">
  <div class="sw-container">
    <span class="sw-label">Gallery</span>
    <h2 class="sw-title">My work</h2>
    <div class="sw-bar"></div>
    <div class="sw-gallery">
      <img src="https://placehold.co/600x450/EEE9E2/999999?text=Photo+1" alt="Work sample 1" loading="lazy">
      <img src="https://placehold.co/600x450/E5E0D8/999999?text=Photo+2" alt="Work sample 2" loading="lazy">
      <img src="https://placehold.co/600x450/EEE9E2/999999?text=Photo+3" alt="Work sample 3" loading="lazy">
      <img src="https://placehold.co/600x450/E5E0D8/999999?text=Photo+4" alt="Work sample 4" loading="lazy">
      <img src="https://placehold.co/600x450/EEE9E2/999999?text=Photo+5" alt="Work sample 5" loading="lazy">
      <img src="https://placehold.co/600x450/E5E0D8/999999?text=Photo+6" alt="Work sample 6" loading="lazy">
    </div>
    <p class="sw-text sw-muted">Click a photo, then use "Choose picture…" in the panel to swap in your own.</p>
  </div>
</section>
`;

    if (has('testimonials')) sections += `
<section class="sw-section" id="testimonials">
  <div class="sw-container">
    <span class="sw-label">Testimonials</span>
    <h2 class="sw-title">Kind words from clients</h2>
    <div class="sw-bar"></div>
    <div class="sw-cards">
      <div class="sw-card sw-quote">
        <p class="sw-card-text">"Put a real quote from a happy client here — a sentence or two about what working with you was like."</p>
        <div class="sw-quote-who">— Client name, Company</div>
      </div>
      <div class="sw-card sw-quote">
        <p class="sw-card-text">"A second quote goes here. Click either card to change the words, or delete one if you only have one."</p>
        <div class="sw-quote-who">— Client name, Company</div>
      </div>
    </div>
  </div>
</section>
`;

    if (has('pricing')) sections += `
<section class="sw-section sw-tint" id="pricing">
  <div class="sw-container">
    <span class="sw-label">Pricing</span>
    <h2 class="sw-title">Plans</h2>
    <div class="sw-bar"></div>
    <div class="sw-cards">
      <div class="sw-card">
        <h3 class="sw-card-title">Basic</h3>
        <div class="sw-price">₹4,999</div>
        <p class="sw-card-text">What's included in the basic plan.</p>
      </div>
      <div class="sw-card sw-card-featured">
        <h3 class="sw-card-title">Standard</h3>
        <div class="sw-price">₹9,999</div>
        <p class="sw-card-text">What's included in the standard plan.</p>
      </div>
      <div class="sw-card">
        <h3 class="sw-card-title">Premium</h3>
        <div class="sw-price">₹14,999</div>
        <p class="sw-card-text">What's included in the premium plan.</p>
      </div>
    </div>
  </div>
</section>
`;

    if (has('contact')) sections += `
<section class="sw-section" id="contact">
  <div class="sw-container">
    <span class="sw-label">Contact</span>
    <h2 class="sw-title">Get in touch</h2>
    <div class="sw-bar"></div>
    <p class="sw-text">Have a question or want to work together? Send me a message.</p>
    <div class="sw-contact">
      <a class="sw-btn" href="mailto:${email}">Email me</a>${opts.phone ? `
      <a class="sw-btn sw-btn-outline" href="tel:${esc(opts.phone).replace(/[^0-9+]/g, '')}">Call ${esc(opts.phone)}</a>` : ''}
    </div>${opts.hours ? `
    <p class="sw-hours">Opening hours: ${esc(opts.hours)}</p>` : ''}${socials.length ? `
    <div class="sw-socials">${socials.map(([label, url]) => `
      <a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`).join('')}
    </div>` : ''}
  </div>
</section>
`;

    return `<?php
/**
 * Plugin Name: ${name} — Site
 * Description: One-page website for ${name}. Put the shortcode [${fn}_site] on any blank page.
 * Version:     1.0.0
 * Author:      ${name}
 * License:     GPL2
 */

/*
 * ─────────────────────────────────────────────────────────
 *  CHANGELOG · newest first
 * ─────────────────────────────────────────────────────────
 *  1.0.0 · ${today}
 *      - Created with PHP Studio.
 * ─────────────────────────────────────────────────────────
 */

if ( ! defined( 'ABSPATH' ) ) exit;

add_filter( 'pre_get_document_title', function ( $title ) {
    global $post;
    if ( is_a( $post, 'WP_Post' ) && has_shortcode( $post->post_content, '${fn}_site' ) ) {
        return '${name.replace(/'/g, "\\'")} | ${tagline.replace(/'/g, "\\'")}';
    }
    return $title;
}, 20 );

add_shortcode( '${fn}_site', '${fn}_site_render' );
function ${fn}_site_render() {
    ob_start(); ?>
<style>
.sw-page { --sw-bg:${p.bg}; --sw-tint:${p.tint}; --sw-head:${p.head}; --sw-text:${p.text}; --sw-acc:${p.acc}; --sw-acc-dark:${p.accDark}; }
.sw-page { background: var(--sw-bg); font-family: 'Segoe UI', system-ui, sans-serif; color: var(--sw-text); font-size: 16px; line-height: 1.7; margin: 0; }
.sw-page * { box-sizing: border-box; margin: 0; }
.sw-container { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
.sw-hero { padding: 110px 0 90px; text-align: center; background: var(--sw-tint); }
.sw-hero-name { font-size: clamp(2.2rem, 6vw, 3.6rem); font-weight: 800; color: var(--sw-head); letter-spacing: -.02em; line-height: 1.1; }
.sw-hero-tag { font-size: clamp(1rem, 2.5vw, 1.25rem); margin-top: 14px; color: var(--sw-text); }
.sw-hero .sw-btn { margin-top: 30px; }
.sw-section { padding: 80px 0; }
.sw-tint { background: var(--sw-tint); }
.sw-label { display: block; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sw-acc); }
.sw-title { font-size: clamp(1.7rem, 4vw, 2.4rem); font-weight: 800; color: var(--sw-head); margin-top: 6px; letter-spacing: -.01em; }
.sw-bar { width: 40px; height: 4px; background: var(--sw-acc); border-radius: 2px; margin: 16px 0 26px; }
.sw-text { max-width: 640px; margin-bottom: 12px; }
.sw-muted { opacity: .65; font-size: 14px; margin-top: 16px; }
.sw-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-top: 10px; }
.sw-card { background: var(--sw-bg); border: 1px solid rgba(0,0,0,.08); border-radius: 12px; padding: 26px 24px; box-shadow: 0 2px 10px rgba(0,0,0,.04); }
.sw-section:not(.sw-tint) .sw-card { background: var(--sw-tint); }
.sw-card-featured { border-color: var(--sw-acc); box-shadow: 0 6px 22px rgba(0,0,0,.08); }
.sw-card-title { font-size: 1.1rem; font-weight: 700; color: var(--sw-head); margin-bottom: 8px; }
.sw-card-text { font-size: .95rem; }
.sw-price { font-size: 2rem; font-weight: 800; color: var(--sw-acc); margin: 6px 0 10px; }
.sw-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.sw-gallery img { width: 100%; border-radius: 10px; display: block; }
.sw-contact { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
.sw-btn { display: inline-block; background: var(--sw-acc); color: ${p.accText}; padding: 13px 30px; border-radius: 8px; text-decoration: none; font-weight: 600; }
.sw-btn:hover { background: var(--sw-acc-dark); color: ${p.accText}; }
.sw-btn-outline { background: transparent; color: var(--sw-acc); border: 2px solid var(--sw-acc); }
.sw-btn-outline:hover { background: var(--sw-acc); color: ${p.accText}; }
.sw-footer { padding: 28px 0; text-align: center; font-size: 13px; background: var(--sw-tint); color: var(--sw-text); }
.sw-logo { height: 72px; width: auto; margin: 0 auto 22px; display: block; }
.sw-hero-photo { background-size: cover; background-position: center; }
.sw-hero-photo .sw-hero-name, .sw-hero-photo .sw-hero-tag { color: #fff; }
.sw-quote .sw-card-text { font-style: italic; }
.sw-quote-who { margin-top: 12px; font-weight: 600; color: var(--sw-head); font-size: .9rem; }
.sw-hours { margin-top: 18px; font-weight: 600; color: var(--sw-head); }
.sw-socials { display: flex; gap: 18px; margin-top: 14px; }
.sw-socials a { color: var(--sw-acc); font-weight: 600; text-decoration: none; }
.sw-socials a:hover { color: var(--sw-acc-dark); text-decoration: underline; }
@media (max-width: 640px) { .sw-section { padding: 54px 0; } .sw-hero { padding: 80px 0 60px; } }
</style>
<div class="sw-page">

<header class="sw-hero${opts.heroRel ? ' sw-hero-photo' : ''}" id="top"${opts.heroRel ? ` style="background-image:linear-gradient(rgba(15,17,21,.55),rgba(15,17,21,.55)),url('${opts.heroRel}')"` : ''}>
  <div class="sw-container">${opts.logoRel ? `
    <img class="sw-logo" src="${opts.logoRel}" alt="${name} logo">` : ''}
    <h1 class="sw-hero-name">${name}</h1>
    <p class="sw-hero-tag">${tagline}</p>
    <a class="sw-btn" href="#contact">${cta}</a>
  </div>
</header>
${sections}
<footer class="sw-footer">
  &copy; <?php echo date( 'Y' ); ?> ${name}
</footer>

</div>
<?php
    $html = ob_get_clean();
    // pictures live next to this file — point src/url at the plugin folder
    $img_base = plugin_dir_url( __FILE__ ) . 'images/';
    $html = str_replace( 'src="images/', 'src="' . $img_base, $html );
    $html = str_replace( "url('images/", "url('" . $img_base, $html );
    return $html;
}
`;
  }

  /* ── install on WordPress ───────────────────────────── */
  async function installDialog() {
    if (!S.active) { toast('warn', 'Open a page first'); return; }
    const f = S.active;
    if (f.dirty) await Editor.save(f);
    const isPlugin = /Plugin Name\s*:/i.test(f.model.getValue());
    const slug = f.name.replace(/\.php$/i, '');
    const body = document.createElement('div');
    body.innerHTML = `
      ${isPlugin ? '' : `<p style="color:var(--warning);margin-bottom:10px">Heads up: this file doesn't look like a plugin (no "Plugin Name" header). The steps below work for plugin files like the ones the wizard creates.</p>`}
      <p style="margin-bottom:12px">Two ways to get <b>${f.name}</b> onto your WordPress site — the first one is easiest:</p>
      <div class="inst-opt">
        <div class="inst-num">1</div>
        <div>
          <b>Upload through WordPress (recommended)</b>
          <ol class="inst-steps">
            <li>Click <b>Make the ZIP file</b> below.</li>
            <li>Log in to your site's WordPress admin (yoursite.com<span class="mono">/wp-admin</span>).</li>
            <li>Go to <b>Plugins → Add New Plugin → Upload Plugin</b>.</li>
            <li>Choose the ZIP file and click <b>Install Now</b>, then <b>Activate</b>.</li>
            <li>Edit any blank page and put this on it: <span class="mono" id="instShortcode"></span> <button class="btn sm" id="instCopySc" style="margin-left:6px">Copy</button></li>
          </ol>
          <button class="btn primary" id="instZip" style="margin-top:8px">Make the ZIP file</button>
          <span id="instZipDone" class="muted" style="margin-left:8px;font-size:12px"></span>
        </div>
      </div>
      <div class="inst-opt">
        <div class="inst-num">2</div>
        <div style="flex:1">
          <b>Do it all for me</b> — uploads the page to your site and switches it on, in one go. Needs your FTP login (one-time) plus a WordPress "application password":
          <div class="muted" style="font-size:11.5px;margin:6px 0 10px">In WordPress admin go to <b>Users → Profile</b>, scroll to <b>Application Passwords</b>, type "PHP Studio", click <b>Add</b>, and copy the password it shows you.</div>
          <div class="prow"><label>Site address</label><input type="text" id="wpSite" placeholder="https://yoursite.com" spellcheck="false"></div>
          <div class="prow"><label>WP username</label><input type="text" id="wpUser" spellcheck="false"></div>
          <div class="prow"><label>App password</label><input type="password" id="wpPass" placeholder="xxxx xxxx xxxx xxxx"></div>
          <div style="margin-top:10px"><button class="btn primary" id="instAuto">Upload &amp; switch it on</button>
          <span id="instAutoState" class="muted" style="margin-left:8px;font-size:12px"></span></div>
        </div>
      </div>`;
    const fnName = slug.replace(/-/g, '_');
    // find the real shortcode tag in the file if present
    const scMatch = /add_shortcode\(\s*'([^']+)'/.exec(f.model.getValue());
    const shortcode = '[' + (scMatch ? scMatch[1] : fnName + '_site') + ']';
    $('#instShortcode', body).textContent = shortcode;
    $('#instCopySc', body).addEventListener('click', () => { studio.copyToClipboard(shortcode); toast('ok', 'Shortcode copied', '', 1500); });
    $('#instZip', body).addEventListener('click', async () => {
      try {
        const zip = await studio.pluginZip(f.path);
        $('#instZipDone', body).textContent = '✓ Made — opening its folder…';
        studio.reveal(zip);
      } catch (err) { toast('err', 'Could not make the ZIP', String(err.message || err)); }
    });
    const wpSaved = S.settings.wp || {};
    $('#wpSite', body).value = wpSaved.siteUrl || '';
    $('#wpUser', body).value = wpSaved.user || '';
    $('#instAuto', body).addEventListener('click', async () => {
      const wp = {
        siteUrl: $('#wpSite', body).value.trim(),
        user: $('#wpUser', body).value.trim(),
        appPass: $('#wpPass', body).value.trim(),
      };
      if (!wp.siteUrl || !wp.user || !wp.appPass) {
        $('#instAutoState', body).textContent = 'Fill in all three boxes first.';
        return;
      }
      if (!/^https?:\/\//i.test(wp.siteUrl)) wp.siteUrl = 'https://' + wp.siteUrl;
      // remember the harmless parts; never the password
      S.settings.wp = { siteUrl: wp.siteUrl, user: wp.user };
      studio.setSettings({ wp: S.settings.wp });
      const btn = $('#instAuto', body);
      btn.disabled = true;
      $('#instAutoState', body).textContent = 'Working…';
      const r = await Deploy.oneClickInstall(f, slug, wp);
      btn.disabled = false;
      $('#instAutoState', body).textContent =
        r === true ? '✓ Done — your site is opening.' :
        r === 'uploaded' ? 'Uploaded — switch it on in WordPress admin → Plugins.' : '';
    });
    await dialog({
      title: 'Put this page on my website', body, width: 560,
      actions: [{ label: 'Done', primary: true, value: true }],
    });
  }

  return { build, show, hide, setUIMode, toggleUIMode, addRecent, createWizard, createFromOptions, installDialog };
})();
