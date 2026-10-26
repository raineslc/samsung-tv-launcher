/* HDMI inputs via tizen.systeminfo (VIDEOSOURCE) and tizen.tvwindow. */
(function () {
    'use strict';

    var VIEWER_APP = 'org.tizen.tv-viewer';         // Samsung's full-screen TV/HDMI player
    var FULL = ['0px', '0px', '1920px', '1080px'];  // tvwindow rectangle covering the whole screen

    // Wraps a callback-style Tizen call in a promise with an 8 s timeout (sync throws become rejections).
    function call(fn, what) {
        return Apps.withTimeout(new Promise(function (resolve, reject) {
            try { fn(resolve, reject); } catch (e) { reject(e); }
        }), 8000, what);
    }

    // { connected: [...], disconnected: [...] } — every source the TV knows (TV tuner, HDMI 1-4, …).
    function sources() {
        return call(function (ok, err) {
            tizen.systeminfo.getPropertyValue('VIDEOSOURCE', ok, err);
        }, 'Input list');
    }

    // "HDMI 2" / "TV" for logs.
    function describeSource(s) {
        return s ? s.type + (s.type === 'TV' ? '' : ' ' + s.number) : 'unknown';
    }

    // Source currently routed to the main window, or null if the API is unavailable.
    function current() {
        try {
            return tizen.tvwindow.getSource('MAIN');
        } catch (e) {
            return null;
        }
    }

    // Returns { 1: true, 2: false, ... } for HDMI ports the TV reports.
    function hdmiStatus() {
        return sources().then(function (info) {
            var status = {};
            (info.disconnected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = false; });
            (info.connected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = true; });
            return status;
        });
    }

    // The source object for HDMI n, connected or not (setSource needs the TV's own object).
    function findHdmi(n) {
        return sources().then(function (info) {
            var all = (info.connected || []).concat(info.disconnected || []);
            var src = all.find(function (s) { return s.type === 'HDMI' && s.number === n; });
            if (!src) throw new Error('HDMI ' + n + ' is not reported by the TV');
            return src;
        });
    }

    // Routes the source to the main window. Behind the launcher until shown or the viewer opens.
    function setSource(src) {
        return call(function (ok, err) { tizen.tvwindow.setSource(src, ok, err, 'MAIN'); }, 'Switch input');
    }

    // Draws the input full screen inside the launcher ("Inside the launcher" method).
    function showFull() {
        return call(function (ok, err) { tizen.tvwindow.show(ok, err, FULL, 'MAIN'); }, 'Show input');
    }

    // Removes the in-launcher input picture (Back from tv mode).
    function hide() {
        return call(function (ok, err) { tizen.tvwindow.hide(ok, err, 'MAIN'); }, 'Hide input');
    }

    // Hands the screen to Samsung's viewer, so Game Mode, the TV's input UI and HDMI-CEC behave normally.
    function openViewer() {
        return Apps.launch(VIEWER_APP);
    }

    // method: 'switch' = change source only; 'inapp' = show it inside the launcher;
    // anything else ('switch+viewer', the default) = change source then open Samsung's viewer.
    // Resolves to 'inapp' when the input is now showing inside the launcher, otherwise 'external'.
    function open(hdmi, method) {
        return findHdmi(hdmi).then(function (src) {
            return setSource(src).then(function () {
                if (method === 'switch') return 'external';
                if (method === 'inapp') return showFull().then(function () { return 'inapp'; });
                return openViewer().then(function () { return 'external'; });
            });
        });
    }

    window.Inputs = {
        sources: sources,
        hdmiStatus: hdmiStatus,
        current: current,
        describeSource: describeSource,
        open: open,
        hide: hide,
        openViewer: openViewer
    };
})();
