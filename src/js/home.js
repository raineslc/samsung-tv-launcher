/* Home, All apps and Lab screens; app list loading, launching and HDMI inputs. */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.apps.v1';            // localStorage key for the last app list seen
    var REFRESH_AFTER_MS = 5 * 60 * 1000;      // re-read the app list at most every 5 minutes
    var GRID_COLS = 5;                         // columns in the "All apps" grid

    var cfg = window.LAUNCHER_CONFIG;
    var log = DevLog.log;
    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;

    var state = {
        apps: [],              // launchable apps from the TV (or the cache)
        appsSig: null,
        lastFetch: 0,
        showEverything: false, // All apps: bypass the consumer filter
        tvMode: false,         // HDMI shown inside the launcher
        hdmi: {}               // last known { port: connected }
    };

    // ---------- Tiles

    // Pre-coloured by scripts/build-marks.mjs
    function markEl(brand) {
        var m = new Image();
        m.className = 'mark';
        m.src = 'img/tiles/' + brand.key + '.svg';
        if (brand.pad) {
            m.style.top = brand.pad[0] + '%';
            m.style.height = (100 - 2 * brand.pad[0]) + '%';
            m.style.left = brand.pad[1] + '%';
            m.style.width = (100 - 2 * brand.pad[1]) + '%';
        }
        return m;
    }

    // Fallback tile text for apps with no brand: first letter of the first two words ("Apple TV" -> "AT").
    function initials(label) {
        var words = label.replace(/[^\w\s+]/g, ' ').trim().split(/\s+/);
        return (words[0] ? words[0][0] : '?') + (words[1] ? words[1][0] : '');
    }

    // Stable colour per app name, so an unbranded tile keeps the same colour across restarts.
    function hue(text) {
        var h = 0;
        for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
        return h;
    }

    // Installed apps report a native path; it may or may not be readable from a web app.
    function tryIcon(tile, mono, path) {
        var img = new Image();
        img.className = 'icon';
        img.onload = function () {
            mono.style.display = 'none';
            tile.appendChild(img);
        };
        img.src = path.charAt(0) === '/' ? 'file://' + path : path;
    }

    // The coloured square of a tile: brand logo, brand wordmark, or initials on a hashed colour.
    function tileFace(item) {
        var tile = el('div', 'tile');
        if (item.brand) {
            tile.style.background = item.brand.bg;
            // Text wordmark (YouTube TV, Paramount+, Hulu, ESPN have no SVG mark in img/marks/).
            if (item.brand.text) {
                var word = el('div', 'wordmark', item.brand.text);
                word.style.color = item.brand.fg;
                if (item.brand.size) word.style.setProperty('--wordmark-size', item.brand.size + 'px');
                tile.appendChild(word);
            } else {
                tile.appendChild(markEl(item.brand));
            }
        } else {
            tile.style.background = 'hsl(' + hue(item.label) + ',32%,24%)';
            var mono = el('div', 'mono', initials(item.label).toUpperCase());
            tile.appendChild(mono);
            if (item.iconPath) tryIcon(tile, mono, item.iconPath);
        }
        return tile;
    }

    // Full Home/All-apps tile: face + label. `_item` is what UI hands back to activate() on OK.
    function appTile(item) {
        var wrap = el('div', 'app');
        wrap.appendChild(tileFace(item));
        wrap.appendChild(el('div', 'label', item.label));
        wrap._item = item;
        return wrap;
    }

    // Small tile used in Settings lists.
    function miniTile(item) {
        var wrap = el('div', 'mini');
        wrap.appendChild(tileFace(item));
        return wrap;
    }

    // Last tile on the Home row: opens the All apps grid.
    function allAppsTile() {
        var wrap = el('div', 'app');
        var tile = el('div', 'tile all-tile');
        tile.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>' +
            '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>';
        wrap.appendChild(tile);
        wrap.appendChild(el('div', 'label', 'All apps'));
        wrap._item = { kind: 'all' };
        return wrap;
    }

    // Wide tile for an HDMI device (second Home row). The dot lights when the port reports a signal.
    function inputTile(input) {
        var brand = findBrand(input.brand || '') || { bg: '#2a2f3a', fg: '#fff', mark: null };
        var wrap = el('div', 'input');
        var tile = el('div', 'tile');
        tile.style.background = brand.bg;
        if (brand.mark) tile.appendChild(markEl(brand));
        var meta = el('div', 'meta');
        meta.appendChild(el('div', 'name', input.label));
        var port = el('div', 'port');
        var dot = el('span', 'dot');
        port.appendChild(dot);
        port.appendChild(document.createTextNode('HDMI ' + input.hdmi));
        meta.appendChild(port);
        tile.appendChild(meta);
        wrap.appendChild(tile);
        wrap._item = { kind: 'input', hdmi: input.hdmi, label: input.label, method: input.method };
        wrap._dot = dot;
        return wrap;
    }

    // Console tile for Settings lists: brand colours and logo only.
    function miniInputTile(input) {
        var brand = findBrand(input.brand || '');
        return miniTile({ label: input.label, brand: brand && { key: brand.key, bg: brand.bg, fg: brand.fg, mark: brand.mark } });
    }

    // ---------- Home content

    // Consoles: edited list from Settings, else config.js.
    function inputs() {
        return Prefs.get().inputs || cfg.inputs || [];
    }

    // Saves an edited console list (from Settings) and redraws Home.
    function setInputs(list) {
        Prefs.get().inputs = list;
        Prefs.save();
        renderHome();
    }

    // Entries shown on Home: edited list from Settings, else config.js.
    function homeEntries() {
        return Prefs.get().home || cfg.apps || [];
    }

    // Resolves the Home entries against what is actually installed; entries with no match drop out.
    function homeItems() {
        return Apps.curated(state.apps, { apps: homeEntries() });
    }

    // Saves the Home row as exact app ids, so a later rename on the TV does not break the match.
    function setHomeItems(items) {
        Prefs.get().home = items.map(function (i) {
            var entry = { id: i.id, label: i.label };
            if (i.brand) entry.brand = i.brand.key;
            return entry;
        });
        Prefs.save();
        renderHome();
    }

    // Rebuilds both Home rows: apps (plus All apps) and HDMI inputs.
    function renderHome() {
        var row = $('apps-row');
        row.innerHTML = '';
        var items = homeItems();
        // Nothing in the config matched (e.g. first boot before the app list loads): show any 8 apps.
        if (!items.length) items = Apps.allSorted(state.apps, false).slice(0, 8);
        items.forEach(function (item) { row.appendChild(appTile(item)); });
        row.appendChild(allAppsTile());

        var row2 = $('inputs-row');
        row2.innerHTML = '';
        inputs().forEach(function (input) {
            if (!input.hidden) row2.appendChild(inputTile(input));
        });
        $('inputs-section').classList.toggle('hidden', !row2.children.length);
        applyInputStatus();
        if (UI.isVisible('home')) UI.refresh();
    }

    // Lights the "connected" dot on each input tile from the last known HDMI status.
    function applyInputStatus() {
        UI.children($('inputs-row')).forEach(function (tile) {
            tile._dot.classList.toggle('on', state.hdmi[tile._item.hdmi] === true);
        });
    }

    // Asks the TV which HDMI ports have a signal (async), then updates the dots.
    function refreshInputStatus() {
        if (!inputs().length) return;
        Inputs.hdmiStatus().then(function (status) {
            state.hdmi = status;
            applyInputStatus();
        }).catch(function (err) {
            log('Input status unavailable: ' + DevLog.errorText(err));
        });
    }

    // All apps grid. Yellow toggles showEverything to include system apps the filter hides.
    function renderAll() {
        var grid = $('all-grid');
        grid.innerHTML = '';
        UI.resetScroll(grid);
        var items = Apps.allSorted(state.apps, state.showEverything);
        items.forEach(function (item) { grid.appendChild(appTile(item)); });
        $('all-count').textContent = items.length + ' apps';
    }

    // Lab (Blue key): developer test actions plus a live tail of the dev log.
    function renderLab() {
        var actions = [
            { label: 'Send installed app list to log', run: labDumpApps },
            { label: 'Read inputs', run: labReadInputs },
            { label: 'Open Samsung TV viewer only', run: function () { runLogged('Open TV viewer', Inputs.openViewer()); } }
        ];
        if (window.Sound) actions = actions.concat(Sound.actions());
        if (window.Weather) actions = actions.concat(Weather.actions());
        if (window.RenderProbe) actions = actions.concat(RenderProbe.actions());
        if (window.PlatformProbe) actions = actions.concat(PlatformProbe.actions());
        inputs().forEach(function (input) {
            var item = { kind: 'input', hdmi: input.hdmi, label: input.label };
            var name = input.label + ' (HDMI ' + input.hdmi + ')';
            actions.push({ label: name + ': switch + viewer', run: function () { openInput(item, 'switch+viewer'); } });
            actions.push({ label: name + ': switch only', run: function () { openInput(item, 'switch'); } });
            actions.push({ label: name + ': inside launcher', run: function () { openInput(item, 'inapp'); } });
        });
        var list = $('lab-list');
        list.innerHTML = '';
        actions.forEach(function (a) {
            var li = el('li', '', a.label);
            li._item = { kind: 'lab', run: a.run };
            list.appendChild(li);
        });
        DevLog.onLine(function () {
            $('lab-log').textContent = DevLog.lines().slice(-26).join('\n');
        });
    }

    // ---------- Actions

    // Logs start / ok / FAILED around a promise and passes its result (or error) through.
    function runLogged(what, promise) {
        log(what + '…');
        return promise.then(function (v) {
            log(what + ': ok');
            return v;
        }, function (err) {
            log(what + ': FAILED ' + DevLog.errorText(err));
            throw err;
        });
    }

    // OK on an app tile. Failures show as a toast instead of silently doing nothing.
    function launchApp(item) {
        runLogged('Launch ' + item.id, Apps.launch(item.id)).catch(function (err) {
            UI.toast('Could not open ' + item.label + ': ' + DevLog.errorText(err));
        });
    }

    // OK on an input tile. Method order: the tile's own, then config.inputMethod (see inputs.js).
    function openInput(item, method) {
        method = method || item.method || cfg.inputMethod;
        UI.toast('Switching to ' + item.label + '…');
        runLogged('Input HDMI ' + item.hdmi + ' via ' + method, Inputs.open(item.hdmi, method)).then(function (result) {
            log('Current source now: ' + Inputs.describeSource(Inputs.current()));
            if (result === 'inapp') enterTvMode();
        }).catch(function (err) {
            UI.toast('Could not switch to ' + item.label + ': ' + DevLog.errorText(err));
        });
    }

    // "Inside the launcher" mode: the HDMI picture is drawn full screen and the UI is hidden by CSS.
    function enterTvMode() {
        state.tvMode = true;
        document.documentElement.classList.add('tv-mode');
    }

    function exitTvMode() {
        state.tvMode = false;
        document.documentElement.classList.remove('tv-mode');
        Inputs.hide().catch(function (err) { log('Hide input failed: ' + DevLog.errorText(err)); });
    }

    // Lab: writes every installed app (id, name, show flag) to the log — how to find real app ids.
    function labDumpApps() {
        runLogged('App list', Apps.getInstalledApps()).then(function (apps) {
            log('apps: ' + apps.length + ' total, ' + apps.filter(function (a) { return a.show; }).length + ' with show=true',
                apps.map(Apps.describe));
            UI.toast('Sent ' + apps.length + ' apps to the log');
        }).catch(function () {});
    }

    // Lab: logs connected / disconnected HDMI ports — how to confirm which port the PS4 is on.
    function labReadInputs() {
        runLogged('Inputs', Inputs.sources()).then(function (info) {
            var fmt = function (list) { return (list || []).map(Inputs.describeSource).join(', ') || 'none'; };
            log('connected: ' + fmt(info.connected));
            log('disconnected: ' + fmt(info.disconnected));
            log('current: ' + Inputs.describeSource(Inputs.current()));
        }).catch(function () {});
    }

    // Green key: next wallpaper, with its title and photo credit as a toast.
    function nextWallpaper() {
        var w = Wallpaper.next();
        if (w) UI.toast(w.title + (w.credit ? ' · ' + w.credit : ''));
    }

    // Colour keys are hidden shortcuts; everything is also reachable from Settings.
    // Play is the way out to Samsung's own Home (the Home button itself is left to the TV).
    function colourKey(k, view) {
        if (k === KEY.PLAY || k === KEY.PLAY_PAUSE || k === KEY.P) {
            Settings.openSamsungHome();
        } else if (k === KEY.RED || k === KEY.R) {
            UI.show(view === 'all' ? 'home' : 'all');
        } else if (k === KEY.GREEN || k === KEY.G) {
            if (view === 'home') nextWallpaper();
        } else if (k === KEY.BLUE || k === KEY.B) {
            UI.show(view === 'lab' ? 'home' : 'lab');
        } else if (k === KEY.YELLOW || k === KEY.Y) {
            if (view === 'all') {
                state.showEverything = !state.showEverything;
                UI.show('all', { back: true });
            } else if (view === 'home' && window.RunnerGame) {
                RunnerGame.open();
            } else return false;
        } else {
            return false;
        }
        return true;
    }

    // ---------- Clock, data, lifecycle

    // Top-right clock and date; formats come from Settings > Appearance.
    function updateClock() {
        var d = new Date();
        var t = Appearance.time(d);
        $('time-main').textContent = t.time;
        $('time-suffix').textContent = t.suffix;
        $('date').textContent = Appearance.date(d);
    }

    // The TV takes ~4 s to list its ~450 apps, so Home is drawn from the last list we saw
    // and only redrawn if a fresh list differs.
    function readCache() {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY));
        } catch (e) {
            return null;
        }
    }

    function writeCache(apps) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(apps));
        } catch (e) {
            // Without the cache we only lose the fast start.
        }
    }

    var listeners = [];
    /*
     * Hidden game code: Left and Right alternating three times.
     *
     * Two properties matter on a remote. It is matched against the tail of the last few keys,
     * not with a position counter, because a held key repeats and one extra press would
     * otherwise reset progress so the code could never complete. And it alternates rather than
     * repeating a key, because both auto-repeat and sweeping along a row produce runs of the
     * same key — a code made of runs fires by accident during ordinary browsing.
     */
    var gameCode = [KEY.LEFT, KEY.RIGHT, KEY.LEFT, KEY.RIGHT, KEY.LEFT, KEY.RIGHT];
    var recentKeys = [];

    function gameCodeEntered(k) {
        recentKeys.push(k);
        if (recentKeys.length > gameCode.length) recentKeys.shift();
        if (recentKeys.length < gameCode.length) return false;
        for (var i = 0; i < gameCode.length; i++) {
            if (recentKeys[i] !== gameCode[i]) return false;
        }
        recentKeys.length = 0;
        return true;
    }

    // Takes a new app list; redraws only if something changed (cheap signature over id/name/show).
    function setApps(apps) {
        var sig = apps.map(function (a) { return a.id + '|' + a.name + '|' + a.show; }).join(',');
        if (sig === state.appsSig) return;
        state.appsSig = sig;
        state.apps = apps;
        renderHome();
        if (UI.isVisible('all')) UI.show('all', { back: true });
        listeners.forEach(function (fn) { fn(); });
    }

    // Reads the installed apps from the TV (slow), caches them, then hands them to setApps().
    function loadApps() {
        state.lastFetch = Date.now();
        return Apps.getInstalledApps().then(function (apps) {
            var list = Apps.launchable(apps).map(function (a) {
                return { id: a.id, name: a.name, show: a.show, iconPath: a.iconPath || '' };
            });
            writeCache(list);
            setApps(list);
        }).catch(function (err) {
            UI.toast('Could not list apps: ' + DevLog.errorText(err));
            log('App list failed: ' + DevLog.errorText(err));
        });
    }

    // Tizen only delivers non-navigation keys (colour, media) to apps that register them.
    function registerKeys() {
        try {
            tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']);
        } catch (e) {
            log('Colour keys unavailable: ' + DevLog.errorText(e));
        }
        // Separate batch so a remote without media keys still gets its colour keys.
        try {
            tizen.tvinputdevice.registerKeyBatch(['MediaPlay', 'MediaPlayPause']);
        } catch (e) {
            log('Play keys unavailable: ' + DevLog.errorText(e));
        }
    }

    // Screens owned by this file. Focus rows on Home: [gear], [apps…], [inputs…].
    function registerViews() {
        UI.register('home', {
            el: $('home'),
            startRow: 1,                 // start focus on the apps row, not the gear
            hints: [['OK', 'Open'], ['▲', 'Settings'], ['▶', 'Samsung Home']],
            rows: function () {
                return [[$('gear')], UI.children($('apps-row')), UI.children($('inputs-row'))];
            },
            activate: function (item) {
                if (item.kind === 'app') launchApp(item);
                else if (item.kind === 'all') UI.show('all');
                else if (item.kind === 'input') openInput(item);
                else if (item.kind === 'settings') UI.show('settings');
            },
            // Home is the root: Back does nothing.
            onBack: function () { return true; }
        });
        $('gear')._item = { kind: 'settings' };

        UI.register('all', {
            el: $('all'),
            rows: function () { return UI.chunk(UI.children($('all-grid')), GRID_COLS); },
            onShow: renderAll,
            activate: launchApp,
            hints: [['OK', 'Open'], ['Back', 'Home']]
        });

        UI.register('lab', {
            el: $('lab'),
            rows: function () { return UI.children($('lab-list')).map(function (li) { return [li]; }); },
            activate: function (item) { item.run(); },
            hints: [['OK', 'Run'], ['Back', 'Home']]
        });
    }

    // Called once from boot.js: wire keys and screens, draw from cache, then load the real app list.
    function init() {
        registerKeys();
        registerViews();
        UI.setColourKey(colourKey);
        // Runs before normal navigation: swallows keys while an HDMI input is shown in-app,
        // and watches for the hidden game code on Home.
        UI.setKeyHook(function (k) {
            if (state.tvMode) {
                if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) exitTvMode();
                return true;
            }
            if (!UI.isVisible('home')) { recentKeys.length = 0; return false; }
            if (gameCodeEntered(k)) {
                if (window.RunnerGame) RunnerGame.open(true);
                return true;
            }
            return false;
        });
        Appearance.apply();
        updateClock();
        setInterval(updateClock, 10000);
        renderLab();
        var cached = readCache();
        if (cached && cached.length) setApps(cached);
        else renderHome();
        UI.show('home');
        Wallpaper.start();

        // Fires when the launcher goes to the background (an app opened) or comes back to the front.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (state.tvMode) exitTvMode();
                return;
            }
            updateClock();
            refreshInputStatus();
            if (UI.isVisible('home')) Wallpaper.homeShown();
            if (Date.now() - state.lastFetch > REFRESH_AFTER_MS) setTimeout(loadApps, 1500);
        });
        // With a cache, let the first frames and key presses through before the slow app list.
        setTimeout(loadApps, cached ? 2000 : 0);
        refreshInputStatus();
        log('Launcher started');
    }

    // Public API, used mainly by settings.js and screensaver.js.
    window.Home = {
        init: init,
        apps: function () { return state.apps; },
        homeItems: homeItems,
        setHomeItems: setHomeItems,
        inputs: inputs,
        setInputs: setInputs,
        hdmiStatus: function () { return state.hdmi; },
        // An HDMI input shown inside the launcher: no screen saver over it.
        tvMode: function () { return state.tvMode; },
        refreshInputStatus: refreshInputStatus,
        renderLab: renderLab,
        updateClock: updateClock,
        reloadApps: loadApps,
        miniTile: miniTile,
        miniInputTile: miniInputTile,
        onAppsChanged: function (fn) { listeners.push(fn); }
    };
})();
