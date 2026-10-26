/* App listing, filtering and launching on top of tizen.application. */
(function () {
    'use strict';

    // Samsung's `show` flag still lets many services through (e.g. ep-dataservice-app).
    // Store apps have ids like "AbCdEfGhIj.Name"; a few consumer apps ship preinstalled with system ids.
    var STORE_ID = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/;
    var NUMERIC_ID = /^\d{9,13}$/;             // older store apps (e.g. Hulu, ESPN) use numeric ids
    // Consumer apps that ship with system-style ids and would otherwise fail STORE_ID.
    var PRELOADED = [
        'org.tizen.netflix-app', 'org.tizen.primevideo', 'org.tizen.apple.apple-music',
        'org.tizen.browser', 'com.samsung.tv.aria-video'
    ];
    // Store-style ids that are really Samsung system screens; never shown in All apps.
    var INTERNAL = [
        'adplatform.ADPlayer', 'WykOS4t4F0.cmsWebApp', '25emanual3.emanual',
        'ZODRT12q2l.WebAccountExtension', 'ByJlgt0XeD.CastSettingsApp', 'tv6pbVMQFF.PrivacyChoices',
        '2022ePop01.SmartTV', 'w2VwCK465D.OTApp', 'J9fZJDMi1v.SecurityCenter'
    ];
    // Words in a name/id that mark background helpers rather than apps a person would open.
    var NOISE = /service|worker|preview|promotion|plugin|launcher|test|sdk|^ep[ -]|factory|daemon|dummy|agent|e-?manual|account|adplayer|privacy|security/i;

    // Tizen callbacks sometimes never fire; this turns a hang into a readable error after `ms`.
    function withTimeout(promise, ms, what) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(new Error(what + ': the TV did not respond')); }, ms);
            promise.then(function (v) { clearTimeout(timer); resolve(v); },
                function (e) { clearTimeout(timer); reject(e); });
        });
    }

    // The launcher's own id (Arn0Lnchr0.Launcher), so it never lists itself.
    function selfAppId() {
        try {
            return tizen.application.getCurrentApplication().appInfo.id;
        } catch (e) {
            return null;
        }
    }

    // Every installed application (~450 on a Samsung TV, most of them system services).
    function getInstalledApps() {
        return withTimeout(new Promise(function (resolve, reject) {
            tizen.application.getAppsInfo(resolve, reject);
        }), 8000, 'App list');
    }

    // Opens an app by id; the launcher moves to the background while it runs.
    function launch(appId) {
        return withTimeout(new Promise(function (resolve, reject) {
            tizen.application.launch(appId, resolve, reject);
        }), 8000, 'Launch');
    }

    // True for apps a person would want in All apps (Netflix), false for system plumbing.
    function isConsumer(app) {
        if (PRELOADED.indexOf(app.id) >= 0) return true;
        if (!app.show || INTERNAL.indexOf(app.id) >= 0) return false;
        if (!STORE_ID.test(app.id) && !NUMERIC_ID.test(app.id)) return false;
        return !NOISE.test(app.name + ' ' + app.id);
    }

    // Everything launchable with a name, minus ourselves. Curated entries match against this,
    // so any app can still be pinned by id even if the consumer filter hides it.
    function launchable(apps) {
        var self = selfAppId();
        var seen = {};
        return apps.filter(function (a) {
            if (!a.name || a.id === self || seen[a.id]) return false;
            seen[a.id] = true;
            return true;
        });
    }

    // Resolves config/Prefs entries ({ id } or { match }) to installed apps, in entry order.
    // `used` stops two entries claiming the same app (e.g. "youtube" grabbing YouTube TV).
    function curated(apps, cfg) {
        var used = {};
        var out = [];
        (cfg.apps || []).forEach(function (entry) {
            var re = entry.match ? new RegExp(entry.match, 'i') : null;
            var candidates = apps.filter(function (a) {
                if (used[a.id]) return false;
                if (entry.id) return a.id === entry.id;
                return re && (re.test(a.id) || re.test(a.name));
            });
            // Prefer a visible consumer app when several match (e.g. Netflix and a Netflix service).
            var app = candidates.find(isConsumer) || candidates[0];
            if (app) {
                used[app.id] = true;
                out.push(toItem(app, entry));
            }
        });
        return out;
    }

    // All apps grid contents, A-Z. showEverything relaxes the filter to Samsung's own `show` flag.
    function allSorted(apps, showEverything) {
        return apps
            .filter(function (a) { return showEverything ? a.show : isConsumer(a); })
            .map(function (a) { return toItem(a, {}); })
            .sort(function (x, y) { return x.label.localeCompare(y.label); });
    }

    // Store names often carry a tagline: "Spotify - Music and Podcasts", "TF1+ : Streaming, …"
    function shortName(name) {
        return name.split(/\s+[-:|–]\s+/)[0].trim() || name;
    }

    // The tile model used by home.js: config label/brand win over what the TV reports.
    function toItem(app, entry) {
        return {
            kind: 'app',
            id: app.id,
            label: entry.label || shortName(app.name),
            brand: entry.brand ? findBrand(entry.brand) : findBrand(app),
            iconPath: app.iconPath || ''
        };
    }

    // Plain-object dump of an app for the Lab log (Tizen objects do not JSON-serialise cleanly).
    function describe(app) {
        return {
            id: app.id, name: app.name, show: app.show, packageId: app.packageId,
            categories: app.categories ? Array.prototype.slice.call(app.categories) : [],
            iconPath: app.iconPath, version: app.version, consumer: isConsumer(app)
        };
    }

    window.Apps = {
        getInstalledApps: getInstalledApps,
        launchable: launchable,
        curated: curated,
        allSorted: allSorted,
        describe: describe,
        launch: launch,
        withTimeout: withTimeout
    };
})();
