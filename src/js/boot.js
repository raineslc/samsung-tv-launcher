/* Start-up order: UI core, Settings views, then Home (which shows itself). */
(function () {
    'use strict';

    // In a desktop browser, scale the fixed 1920x1080 stage to fit the window. No-op on the TV.
    function fitPreview() {
        if (!window.__TIZEN_MOCK__) return;
        document.documentElement.classList.add('preview');
        var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        document.getElementById('stage').style.transform = 'scale(' + scale + ')';
    }

    fitPreview();
    window.addEventListener('resize', fitPreview);

    // Order matters: UI first (key handling), Settings before Home (Home calls into Settings).
    UI.init();
    Settings.init();
    Screensaver.init();
    Weather.start();
    Home.init();

    // Preview only: open a screen directly, e.g. http://localhost:8080/#settings
    var view = location.hash.slice(1);
    if (window.__TIZEN_MOCK__ && view) {
        try {
            UI.show(view);
        } catch (e) {
            // Unknown screen name: stay on Home.
        }
    }
})();
