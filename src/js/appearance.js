/* Clock, date and font settings (Prefs.appearance). */
(function () {
    'use strict';

    // Bundled fonts (src/fonts/*.woff2, SIL Open Font Licence).
    var FONTS = [
        { key: 'manrope', label: 'Manrope', family: '"Manrope"' },
        { key: 'inter', label: 'Inter', family: '"Inter"' },
        { key: 'outfit', label: 'Outfit', family: '"Outfit"' },
        { key: 'dm-sans', label: 'DM Sans', family: '"DM Sans"' }
    ];

    // Languages offered for the date line. config.js `locale` (en-US here) is the default.
    var LOCALES = [
        { key: 'en-GB', label: 'English' },
        { key: 'es-ES', label: 'Español' },
        { key: 'fr-FR', label: 'Français' }
    ];

    // Used if a bundled font fails to load; SamsungOne is the TV's own system font.
    var FALLBACK = ', "SamsungOne", "Helvetica Neue", Arial, sans-serif';

    function prefs() { return Prefs.get().appearance; }

    // Font by key, defaulting to Manrope.
    function font(key) {
        return FONTS.find(function (f) { return f.key === key; }) || FONTS[0];
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // Returns { time: '16:05', suffix: '' } or { time: '4:05', suffix: 'PM' }.
    function time(d) {
        if (prefs().clock === '12h') {
            var h = d.getHours() % 12 || 12;
            return { time: h + ':' + pad(d.getMinutes()), suffix: d.getHours() < 12 ? 'AM' : 'PM' };
        }
        return { time: pad(d.getHours()) + ':' + pad(d.getMinutes()), suffix: '' };
    }

    // e.g. "Sunday, October 25" in the chosen locale; falls back if the locale is unsupported.
    function date(d) {
        try {
            var text = d.toLocaleDateString(prefs().locale, { weekday: 'long', day: 'numeric', month: 'long' });
            return text.charAt(0).toUpperCase() + text.slice(1);
        } catch (e) {
            return d.toDateString();
        }
    }

    // Pushes appearance prefs into CSS: font variable and classes that hide names or the date.
    function apply() {
        var p = prefs();
        document.documentElement.style.setProperty('--font', font(p.font).family + FALLBACK);
        var home = document.getElementById('home');
        home.classList.toggle('names-focused', p.names === 'focused');
        home.classList.toggle('names-never', p.names === 'never');
        home.classList.toggle('no-date', !p.showDate);
    }

    window.Appearance = {
        FONTS: FONTS,
        LOCALES: LOCALES,
        font: font,
        time: time,
        date: date,
        apply: apply
    };
})();
