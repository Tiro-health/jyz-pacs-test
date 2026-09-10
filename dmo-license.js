/* ============================================================================
 * dmo-license.js — Dragon Medical One met een eigen (ziekenhuis-)licentie
 * ----------------------------------------------------------------------------
 * Doel: de DMO-licentie van het eigen ziekenhuis hergebruiken in
 * radiology.tiro.health, zonder afhankelijk te zijn van de Tiro-side
 * "Endpoint/dmsk"-licentie.
 *
 * Werkwijze: de gebruiker importeert zijn SoD.exe.config (het configuratie-
 * bestand van de DMO-desktopapplicatie). Daaruit halen we de SAS-server en de
 * organization token. Samen met een partner GUID en de DMO-gebruikersnaam
 * openen we in de browser een Dragon Medical SpeechKit-sessie (Browser edition).
 *
 * Documentatie (Microsoft Learn):
 *   Browser edition          learn.microsoft.com/industry/healthcare/speechkit/browser/
 *   Speech-enable your app   .../browser/implement/speech-enable
 *   Organization token       .../speechkit/concepts/license-guid
 *   Partner GUID             .../speechkit/concepts/partner-guid
 *   Release channels         .../browser/release-channels
 *
 * Wat de SpeechKit-API van ons verwacht (gedocumenteerd):
 *   - cookie  NUSA_Guids = <organization token>/<partner GUID>
 *   - globals NUSA_userId, NUSA_applicationName, NUSA_ServerURL
 *   - functie NUSA_configure()  — wordt door de SDK aangeroepen bij het laden
 *   - functie NUSA_initialize(container|elementen) — speech-enabled de velden
 *   - functie NUSA_reinitializeVuiForm() — na het toevoegen/verwijderen van velden
 *
 * BELANGRIJK — de organization token is een credential. Die wordt uitsluitend
 * in de localStorage van deze browser bewaard, gaat nooit naar een server van
 * ons en hoort niet in git. "Wissen" in de UI verwijdert hem volledig.
 *
 * Geen DOM-opbouw hier: de UI leeft in launch.html, dit bestand doet parsing,
 * opslag en het opzetten/afbreken van de sessie.
 * ==========================================================================*/
(function () {
    "use strict";

    const STORAGE_KEY = "dmoLicense";
    const APP_NAME = "Tiro Radiology";
    const COOKIE = "NUSA_Guids";

    // Regio-hosts van Nuance/Microsoft. De SAS-host uit SoD.exe.config bepaalt
    // de regio; de bijhorende resource-host levert Nuance.SpeechAnywhere.js.
    // Alleen 'sas.nuancehdp.com' (globaal) en 'uk' staan met naam in de publieke
    // docs; de overige volgen hetzelfde patroon. Klopt de afgeleide URL niet,
    // dan overschrijft de gebruiker ze in de UI met de URL uit "Release channels".
    const RESOURCE_HOSTS = {
        "": "speechanywhere.nuancehdp.com",
        uk: "speechanywhere-prod-uk.nuancehdp.com",
        de: "speechanywhere-prod-de.nuancehdp.com",
        fr: "speechanywhere-prod-fr.nuancehdp.com",
        nl: "speechanywhere-prod-nl.nuancehdp.com",
        ca: "speechanywhere-prod-ca.nuancehdp.com",
        au: "speechanywhere-prod-au.nuancehdp.com",
        ch: "speechanywhere-prod-ch.nuancehdp.com",
    };

    const CHANNELS = ["mainline", "delayed", "beta"];

    // ── SoD.exe.config uitlezen ─────────────────────────────────────────────

    /**
     * Parse een SoD.exe.config (XML). Geeft de velden terug die we nodig
     * hebben, plus wat we enkel tonen ter controle. Gooit bij ongeldige XML of
     * wanneer het duidelijk geen DMO-configuratie is.
     */
    function parseSodConfig(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        if (doc.querySelector("parsererror")) {
            throw new Error("Dit is geen geldig XML-bestand.");
        }

        const settings = doc.querySelector("applicationSettings > SoD\\.Settings")
            || Array.from(doc.querySelectorAll("applicationSettings > *"))
                .find((n) => n.nodeName === "SoD.Settings");
        if (!settings) {
            throw new Error("Geen SoD.Settings-sectie gevonden — is dit wel een SoD.exe.config?");
        }

        const get = (name) => {
            const node = Array.from(settings.querySelectorAll("setting"))
                .find((s) => s.getAttribute("name") === name);
            const value = node && node.querySelector("value");
            return value ? (value.textContent || "").trim() : "";
        };

        const serverUrl = get("ServerURL");
        const organizationToken = get("OrganizationToken");
        if (!serverUrl && !organizationToken) {
            throw new Error("Geen ServerURL en OrganizationToken in het bestand gevonden.");
        }

        // Versiecommentaar staat als eerste node in het bestand: <!-- Version: 26.1.60348.0 -->
        const versionComment = Array.from(doc.childNodes)
            .filter((n) => n.nodeType === Node.COMMENT_NODE)
            .map((n) => /Version:\s*([\d.]+)/.exec(n.textContent || ""))
            .find(Boolean);

        return {
            serverUrl,
            organizationToken,
            authentication: get("Authentication") || "none",
            languages: splitList(get("SupportedLanguages")),
            topics: splitList(get("SupportedTopics")),
            flavor: get("Flavor"),
            systemGuid: get("SystemGUID"),
            sodVersion: versionComment ? versionComment[1] : "",
        };
    }

    function splitList(value) {
        return String(value || "")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    // ── URL's afleiden ──────────────────────────────────────────────────────

    /** 'https://sas-fr.nuancehdp.com/basic' → 'fr'. Onbekend/on-premise → null. */
    function regionFromServerUrl(serverUrl) {
        let host;
        try { host = new URL(serverUrl).hostname.toLowerCase(); }
        catch { return null; }
        const m = /^sas(?:-([a-z0-9]+))?\.nuancehdp\.com$/.exec(host);
        if (!m) return null;          // eigen/on-premise server
        return m[1] || "";            // '' = de globale instance
    }

    /**
     * NUSA_ServerURL wil de host zonder het /basic-pad, met expliciete poort
     * (zo staat het ook in de voorbeelden van de docs).
     */
    function nusaServerUrl(serverUrl) {
        try {
            const u = new URL(serverUrl);
            return `${u.protocol}//${u.hostname}:${u.port || "443"}`;
        } catch {
            return String(serverUrl || "").trim();
        }
    }

    /** Resource-URL van Nuance.SpeechAnywhere.js voor deze regio en kanaal. */
    function resourceUrl(serverUrl, channel) {
        const region = regionFromServerUrl(serverUrl);
        const host = region === null ? null : RESOURCE_HOSTS[region];
        if (!host) return "";         // onbekende regio → gebruiker vult in
        const ch = CHANNELS.includes(channel) ? channel : "mainline";
        return `https://${host}/${ch}/scripts/Nuance.SpeechAnywhere.js`;
    }

    // ── Opslag (uitsluitend lokaal in deze browser) ─────────────────────────

    function load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
        catch { return null; }
    }

    function save(cfg) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        return cfg;
    }

    function clear() {
        localStorage.removeItem(STORAGE_KEY);
    }

    /** Token nooit voluit tonen in de UI. */
    function mask(token) {
        const t = String(token || "");
        if (t.length <= 8) return t ? "••••" : "";
        return `${t.slice(0, 4)}…${t.slice(-4)}`;
    }

    /**
     * Controleer of de configuratie compleet genoeg is om te verbinden.
     * Geeft een lijst met ontbrekende zaken terug (leeg = klaar).
     */
    function validate(cfg) {
        const missing = [];
        if (!cfg) return ["configuratie"];
        if (!cfg.organizationToken) missing.push("organization token (uit SoD.exe.config)");
        if (!cfg.partnerGuid)       missing.push("partner GUID (van de SpeechKit-licentie)");
        if (!cfg.userId)            missing.push("DMO-gebruikersnaam");
        if (!cfg.serverUrl)         missing.push("SAS-server URL");
        if (!cfg.resourceUrl)       missing.push("resource-URL van Nuance.SpeechAnywhere.js");
        return missing;
    }

    // ── Sessie opzetten ─────────────────────────────────────────────────────

    let _state = "idle";       // idle | connecting | connected | error
    let _error = "";
    let _scriptEl = null;
    const _listeners = new Set();

    function onStateChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

    function setState(state, error) {
        _state = state;
        _error = error || "";
        _listeners.forEach((fn) => { try { fn(_state, _error); } catch (_) {} });
    }

    function state() { return { state: _state, error: _error }; }

    /**
     * Open een SpeechKit-sessie met de opgeslagen configuratie en speech-enable
     * de meegegeven velden.
     *
     * @param {Object}  cfg      configuratie zoals bewaard door save()
     * @param {Array}   elements velden die DMO mag vullen (input/textarea)
     */
    async function connect(cfg, elements) {
        const missing = validate(cfg);
        if (missing.length) {
            setState("error", `Nog niet volledig: ${missing.join(", ")}.`);
            return false;
        }
        if (!window.isSecureContext) {
            setState("error", "SpeechKit werkt enkel op een https-pagina (niet via file://).");
            return false;
        }

        setState("connecting");

        // 1. GUIDs-cookie. Volgens de docs hoort die van de webserver te komen;
        //    dat kan hier niet, dus zetten we hem in JS — de docs vermelden dit
        //    expliciet als (afgeraden maar werkende) alternatief.
        try {
            document.cookie = `${COOKIE}=${cfg.organizationToken}/${cfg.partnerGuid}; path=/; secure; samesite=none`;
        } catch (e) {
            setState("error", "De browser weigert de NUSA_Guids-cookie te zetten.");
            return false;
        }

        // 2. Configuratie klaarzetten. De SDK roept NUSA_configure() zelf aan
        //    zodra het script geladen is.
        window.NUSA_configure = function () {
            window.NUSA_userId = cfg.userId;
            window.NUSA_applicationName = cfg.applicationName || APP_NAME;
            window.NUSA_ServerURL = nusaServerUrl(cfg.serverUrl);
            window.NUSA_ResourceURL = cfg.resourceUrl;
            // Taal en topic staan niet in de publieke API-lijst; kent de SDK ze
            // niet, dan blijven ze zonder effect en beslist het gebruikersprofiel.
            if (cfg.language) window.NUSA_language = cfg.language;
            if (cfg.topic)    window.NUSA_topic = cfg.topic;
        };

        // 3. Script inladen (eenmalig).
        try {
            await loadScript(cfg.resourceUrl);
        } catch (e) {
            setState("error", `Nuance.SpeechAnywhere.js kon niet geladen worden (${cfg.resourceUrl}). Klopt de resource-URL en laat het netwerk nuancehdp.com toe?`);
            return false;
        }

        // 4. Velden speech-enabled maken. NUSA_initialize() aanvaardt een
        //    container of een array van velden; auto-init bij het laden van het
        //    script kan er al gebeurd zijn, een tweede aanroep is toegestaan.
        if (typeof window.NUSA_initialize !== "function") {
            setState("error", "Het script is geladen maar NUSA_initialize() ontbreekt — vermoedelijk een verkeerde resource-URL.");
            return false;
        }
        try {
            window.NUSA_initialize(elements && elements.length ? elements : undefined);
        } catch (e) {
            setState("error", `Initialiseren mislukt: ${e && e.message ? e.message : e}`);
            return false;
        }

        setState("connected");
        return true;
    }

    /** Na het toevoegen of verwijderen van speech-enabled velden. */
    function refresh(elements) {
        if (_state !== "connected") return;
        try {
            if (typeof window.NUSA_reinitializeVuiForm === "function") {
                window.NUSA_reinitializeVuiForm();
            } else if (typeof window.NUSA_initialize === "function") {
                window.NUSA_initialize(elements && elements.length ? elements : undefined);
            }
        } catch (_) { /* zonder sessie is dit niet kritisch */ }
    }

    /**
     * Sessie loslaten. De SDK biedt geen gedocumenteerde terminate; we wissen de
     * cookie en zetten de status terug. Volledig opruimen = pagina herladen.
     */
    function disconnect() {
        try {
            document.cookie = `${COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; secure; samesite=none`;
        } catch (_) {}
        setState("idle");
    }

    function loadScript(url) {
        if (_scriptEl && _scriptEl.dataset.url === url) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = url;
            s.async = true;
            s.dataset.url = url;
            s.addEventListener("load", () => { _scriptEl = s; resolve(); });
            s.addEventListener("error", () => { s.remove(); reject(new Error("script load error")); });
            document.head.appendChild(s);
        });
    }

    window.DMOLicense = {
        STORAGE_KEY,
        CHANNELS,
        parseSodConfig,
        regionFromServerUrl,
        nusaServerUrl,
        resourceUrl,
        load,
        save,
        clear,
        mask,
        validate,
        connect,
        refresh,
        disconnect,
        state,
        onStateChange,
    };
})();
