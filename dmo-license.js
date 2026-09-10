/* ============================================================================
 * dmo-license.js — Dragon Medical One met een eigen (ziekenhuis-)licentie
 * ----------------------------------------------------------------------------
 * Doel: de DMO-licentie van het eigen ziekenhuis hergebruiken in
 * radiology.tiro.health, zonder afhankelijk te zijn van de Tiro-side
 * "Endpoint/dmsk"-licentie.
 *
 * Werkwijze: de gebruiker levert zijn gegevens aan via een bestand — een JSON
 * met de licentiegegevens, of rechtstreeks het SoD.exe.config van de
 * DMO-desktopapplicatie. Dat bestand wordt geïmporteerd op qc.html, achter de
 * pincode van Export / Import. Met die gegevens openen we in de browser een
 * Dragon Medical SpeechKit-sessie (Browser edition).
 *
 * Er staan dus GEEN organization token, gebruikersnaam of wachtwoord in de
 * code van dit project — die komen uitsluitend uit het bestand dat de
 * gebruiker zelf inleest, en blijven in de localStorage van zijn browser.
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

    // ── Licentiebestand inlezen (JSON of SoD.exe.config) ────────────────────

    const FILE_KIND = "dmo-licentie";

    /** Velden die uit een JSON-licentiebestand overgenomen worden. */
    const JSON_FIELDS = [
        "serverUrl", "organizationToken", "partnerGuid", "userId", "password",
        "applicationName", "language", "topic", "channel", "resourceUrl",
        "authentication",
    ];

    /**
     * Leest een aangeleverd bestand: JSON met licentiegegevens, of het
     * SoD.exe.config van de DMO-desktop. Geeft {cfg, source} terug.
     */
    function parseLicenseFile(text) {
        const trimmed = String(text || "").trim();
        if (!trimmed) throw new Error("Het bestand is leeg.");
        if (trimmed[0] === "{") {
            return { cfg: parseLicenseJson(JSON.parse(trimmed)), source: "json" };
        }
        return { cfg: parseSodConfig(trimmed), source: "config" };
    }

    /** JSON-licentiebestand → configuratie. Onbekende velden worden genegeerd. */
    function parseLicenseJson(obj) {
        if (!obj || typeof obj !== "object") throw new Error("Ongeldig JSON-bestand.");
        if (obj.kind && obj.kind !== FILE_KIND) {
            throw new Error(`Dit bestand is van het type "${obj.kind}" — verwacht "${FILE_KIND}".`);
        }
        const cfg = {};
        JSON_FIELDS.forEach((k) => {
            if (typeof obj[k] === "string" && obj[k].trim()) cfg[k] = obj[k].trim();
        });
        if (Array.isArray(obj.languages)) cfg.languages = obj.languages.filter((s) => typeof s === "string");
        if (Array.isArray(obj.topics))    cfg.topics    = obj.topics.filter((s) => typeof s === "string");
        // Een bestand mag aanvullend zijn: de SoD.exe.config levert de token en
        // de server, een JSON daarnaast de partner GUID en de aanmeldgegevens.
        // Enkel een bestand zonder één enkel bruikbaar veld is een fout.
        if (!Object.keys(cfg).length) {
            throw new Error("Geen bruikbare velden in het bestand gevonden (verwacht bv. organizationToken, partnerGuid, userId).");
        }
        if (!cfg.resourceUrl && cfg.serverUrl) {
            cfg.resourceUrl = resourceUrl(cfg.serverUrl, cfg.channel);
        }
        return cfg;
    }

    /** Leeg voorbeeldbestand, zodat het formaat duidelijk is. */
    function template() {
        return {
            kind: FILE_KIND,
            version: "1.0",
            _uitleg: "Vul de waarden in en importeer dit bestand op qc.html via Export / Import. Bewaar het lokaal — het bevat je licentiegegevens.",
            serverUrl: "https://sas-xx.nuancehdp.com/basic",
            organizationToken: "",
            partnerGuid: "",
            userId: "",
            password: "",
            applicationName: APP_NAME,
            language: "nl-NL",
            topic: "GeneralMedicine",
            channel: "mainline",
            resourceUrl: "",
        };
    }

    /** Huidige configuratie als JSON-bestand (bevat de credentials). */
    function exportPayload(cfg) {
        const c = cfg || load() || {};
        const out = { kind: FILE_KIND, version: "1.0" };
        JSON_FIELDS.forEach((k) => { if (c[k]) out[k] = c[k]; });
        if (c.languages && c.languages.length) out.languages = c.languages;
        if (c.topics && c.topics.length) out.topics = c.topics;
        return out;
    }

    /** Wat de UI mag tonen: nooit de token, nooit het wachtwoord. */
    function summary(cfg) {
        const c = cfg || load();
        if (!c) return null;
        const region = regionFromServerUrl(c.serverUrl);
        return {
            serverUrl: c.serverUrl || "",
            region: region === null ? "eigen/on-premise" : (region || "globaal"),
            organizationToken: mask(c.organizationToken),
            partnerGuid: mask(c.partnerGuid),
            userId: c.userId || "",
            password: c.password ? "ingesteld" : "geen",
            authentication: c.authentication || "none",
            language: c.language || (c.languages || [])[0] || "",
            topic: c.topic || "",
            channel: c.channel || "mainline",
            resourceUrl: c.resourceUrl || "",
            sodVersion: c.sodVersion || "",
        };
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
            // Taal, topic en wachtwoord staan niet in de publieke API-lijst;
            // kent de SDK ze niet, dan blijven ze zonder effect en beslist het
            // gebruikersprofiel (of toont de SDK zelf een aanmeldscherm).
            if (cfg.language) window.NUSA_language = cfg.language;
            if (cfg.topic)    window.NUSA_topic = cfg.topic;
            if (cfg.password) window.NUSA_password = cfg.password;
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
            (elements || []).forEach((el) => { if (el) _attached.add(el); });
        } catch (e) {
            setState("error", `Initialiseren mislukt: ${e && e.message ? e.message : e}`);
            return false;
        }

        setState("connected");
        return true;
    }

    // Velden die al speech-enabled zijn. Een WeakSet, zodat velden uit een
    // gesloten PiP-venster vanzelf opgeruimd worden.
    const _attached = new WeakSet();

    /**
     * Eén veld alsnog speech-enabled maken — bijvoorbeeld het veld waar de
     * gebruiker net in klikt. Doet niets zonder actieve sessie, en elk veld
     * wordt hoogstens één keer aangemeld.
     *
     * Werkt ook voor velden in een Document Picture-in-Picture-venster: dat is
     * hetzelfde origin en dezelfde JS-omgeving. Of SpeechKit daar effectief mee
     * overweg kan, hangt van de SDK af — vandaar de try/catch.
     */
    function attach(el) {
        if (!el || _state !== "connected") return false;
        if (_attached.has(el)) return true;
        if (typeof window.NUSA_initialize !== "function") return false;
        try {
            window.NUSA_initialize([el]);
            _attached.add(el);
            return true;
        } catch (e) {
            return false;
        }
    }

    /** Is dit een veld waar gedicteerd kan worden? */
    function isDictatable(el) {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName;
        if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
        if (tag === "INPUT") {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            return ["text", "search", "url", "email", "tel", ""].includes(type) && !el.readOnly && !el.disabled;
        }
        return el.isContentEditable === true;
    }

    // ── Diagnose ────────────────────────────────────────────────────────────

    /**
     * Loopt alles na wat we zonder geldige licentie al kunnen controleren, zodat
     * duidelijk is wat er nog ontbreekt zodra de partner GUID er is. Elke regel:
     * { label, ok: true|false|null, detail }. null = niet automatisch te testen.
     */
    async function diagnose(cfg) {
        const c = cfg || load();
        const out = [];

        const missing = validate(c);
        out.push({
            label: "Licentiebestand",
            ok: !missing.length,
            detail: missing.length ? `ontbreekt: ${missing.join(", ")}` : "volledig",
        });

        out.push({
            label: "Beveiligde verbinding (https)",
            ok: !!window.isSecureContext,
            detail: !window.isSecureContext
                ? `${location.protocol}// — SpeechKit vereist https`
                : (location.protocol === "https:" ? "https" : "localhost (geldt als beveiligd)"),
        });

        // Cookies moeten schrijfbaar zijn: de GUIDs reizen als cookie mee.
        let cookieOk = false;
        try {
            document.cookie = "NUSA_test=1; path=/";
            cookieOk = document.cookie.includes("NUSA_test=1");
            document.cookie = "NUSA_test=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        } catch (_) { cookieOk = false; }
        out.push({
            label: "Cookies schrijfbaar",
            ok: cookieOk,
            detail: cookieOk ? "NUSA_Guids kan gezet worden" : "de browser weigert cookies te zetten",
        });

        // Microfoon: SpeechKit heeft 16-bit / minstens 16 kHz nodig.
        let mic = null, micDetail = "kon niet opgevraagd worden";
        try {
            const st = await navigator.permissions.query({ name: "microphone" });
            mic = st.state === "granted" ? true : (st.state === "denied" ? false : null);
            micDetail = st.state;
        } catch (_) { /* niet elke browser kent deze permissie-naam */ }
        out.push({ label: "Microfoontoegang", ok: mic, detail: micDetail });

        // Resource-URL: laadt Nuance.SpeechAnywhere.js en levert dat de API?
        if (c && c.resourceUrl) {
            let scriptOk = false, scriptDetail = "";
            try {
                await loadScript(c.resourceUrl);
                scriptOk = typeof window.NUSA_initialize === "function";
                scriptDetail = scriptOk ? "geladen, API aanwezig" : "geladen, maar NUSA_initialize ontbreekt";
            } catch (_) {
                scriptDetail = "niet bereikbaar — klopt de URL en laat het netwerk nuancehdp.com toe?";
            }
            out.push({ label: "Nuance.SpeechAnywhere.js", ok: scriptOk, detail: scriptDetail });
        } else {
            out.push({ label: "Nuance.SpeechAnywhere.js", ok: false, detail: "geen resource-URL in het licentiebestand" });
        }

        // Deze twee staan als vereiste in de docs maar zijn niet betrouwbaar
        // vanuit de pagina te meten.
        out.push({ label: "Derde-partij-cookies toegestaan", ok: null, detail: "handmatig na te kijken in de browserinstellingen" });
        out.push({ label: "Pop-ups toegestaan", ok: null, detail: "handmatig na te kijken; SpeechKit opent een aanmeld-/hulpvenster" });

        return out;
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
        FILE_KIND,
        parseLicenseFile,
        parseLicenseJson,
        parseSodConfig,
        template,
        exportPayload,
        summary,
        attach,
        isDictatable,
        diagnose,
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
