/* ============================================================================
 * beveiliging.js — inventaris van alle invulvelden, met PII/AI-classificatie
 * ----------------------------------------------------------------------------
 * Eén plek waar je ziet welke velden er over de hele site bestaan, en per veld
 * aanduidt of de inhoud naar een AI-model mag ("AI-veilig") of niet ("PII").
 *
 * De lijst wordt niet met de hand bijgehouden maar gescand, zodat "Scan
 * opnieuw" ook velden vindt die er later bijkomen. Gescand worden:
 *
 *   formulier   de velddefinities uit qc-schema.js en cases-schema.js
 *   tiro        veldnamen die de Tiro-formulieren in gebruik lieten zien
 *               (launch.html schrijft ze weg; zie onthoudTiroVelden)
 *   pacs        de URL-parameters waarmee het PACS de pagina opstart
 *   prompt      de {placeholders} in de prompts — dit is wat effectief in een
 *               prompt terechtkomt
 *   calculator  de invoervelden van alle calculatoren
 *   verslag     de veldnamen uit de textuele standaardverslagen, per onderzoek
 *   pagina      de overige invoervelden van de pagina's zelf
 *
 * De classificatie leeft in localStorage, per veldsleutel. Een nieuw veld
 * krijgt een voorstel op basis van zijn naam; dat voorstel ís de stand tot
 * iemand ze omzet. Fase 2 (de classificatie meenemen bij het opbouwen van
 * prompts) zit hier bewust nog niet in — dit bestand levert enkel de
 * inventaris en de keuzes.
 *
 * Pure logica, geen DOM-opbouw: de UI leeft in flow.html.
 * ==========================================================================*/
(function () {
    "use strict";

    const KEY = "veldBeveiliging";          // { veldsleutel: "pii" | "ai" }
    const SCAN_KEY = "veldBeveiligingScan"; // laatste scan, zodat de lijst er meteen staat
    const TIRO_KEY = "veldBeveiligingTiro"; // veldnamen die de Tiro-formulieren toonden

    const PII = "pii";
    const AI = "ai";

    // Volgorde waarin de groepen getoond worden; de bovenste zijn de groepen
    // waar persoonsgegevens in kunnen zitten.
    //
    // niveau = wie de keuze maakt. "organisatie" zijn de velden die centraal
    // vastliggen — het ziekenhuis bepaalt wat daarvan naar een model mag.
    // "gebruiker" zijn de tekstvelden waarin de radioloog zelf schrijft: die
    // staan standaard op AI-veilig, maar hij kan er gericht velden uithalen.
    const GROEPEN = [
        { id: "formulier",  niveau: "organisatie", naam: "Formuliervelden",        uitleg: "Uit de velddefinities van de QC- en casusformulieren." },
        { id: "tiro",       niveau: "organisatie", naam: "Tiro-templatevelden",    uitleg: "Veldnamen die de Tiro-formulieren in gebruik lieten zien. Groeit aan naarmate je de formulieren gebruikt." },
        { id: "pacs",       niveau: "organisatie", naam: "PACS-parameters",        uitleg: "Waarmee het PACS de pagina opstart." },
        { id: "prompt",     niveau: "organisatie", naam: "Prompt-placeholders",    uitleg: "Wat letterlijk in een prompt ingevuld wordt — hier telt de keuze het zwaarst." },
        { id: "calculator", niveau: "organisatie", naam: "Calculator-invoer",      uitleg: "Metingen en scores uit de calculatoren." },
        { id: "verslag",    niveau: "gebruiker",   naam: "Textuele verslagvelden", uitleg: "Veldnamen uit de standaardverslagen, per onderzoekstype. Staan standaard op AI-veilig; zet hier zelf de velden om die patiëntgegevens kunnen bevatten." },
        { id: "pagina",     niveau: "gebruiker",   naam: "Overige invoervelden",   uitleg: "Invoervelden van de pagina's zelf: instellingen, zoekbalken, sleutels." },
    ];

    const NIVEAUS = {
        organisatie: { label: "Organisatie", icoon: "🏛", uitleg: "Centraal vastgelegd door het ziekenhuis." },
        gebruiker:   { label: "Gebruiker",   icoon: "👤", uitleg: "Door de radioloog zelf te kiezen." },
    };

    // Pagina's die meegescand worden voor losse invoervelden. Het zijn statische
    // bestanden op dezelfde host, dus ophalen en uitlezen kan gewoon.
    const PAGINAS = [
        "index.html", "launch.html", "flow.html", "qc.html", "cases.html",
        "db.html", "patient_letter.html", "prompts.html", "dictation-popup.html",
    ];

    // ── Voorstel op basis van de veldnaam ───────────────────────────────────

    // Woorden die een veld tot persoonsgegeven maken, in beide talen. Let op de
    // spaties in sommige termen: "datum onderzoek" is een quasi-identificator,
    // het losse "datum" niet — anders wordt elk verslagveld met een datum erin
    // als PII gemarkeerd.
    const PII_WOORDEN = [
        "naam", "name", "patiënt", "patient", "voornaam", "achternaam", "initialen",
        "geboortedatum", "geboorte", "birth", "leeftijd", "age",
        "rijksregister", "bsn", "insz", "mutualiteit", "verzekering",
        "adres", "address", "straat", "postcode", "woonplaats",
        "telefoon", "phone", "gsm", "e-mail", "email", "mail",
        "aanvrager", "referring", "verwijzer", "huisarts", "radioloog", "arts", "dokter",
        "pacsnummer", "accession", "dossier", "patientid", "patient_info",
        "datum onderzoek", "onderzoek datum", "onderzoeksdatum", "studydate",
        "uur onderzoek", "geslacht", "gender", "sexe",
    ];

    // In de inhoudsgroepen gelden alleen de ondubbelzinnige termen: een
    // verslagveld "Lever" of een calculatorveld "Rechts — lengte" is geen
    // persoonsgegeven, ook al staat er een naam van een arts elders in beeld.
    const INHOUD_GROEPEN = ["calculator", "verslag"];
    const PII_WOORDEN_STRIKT = [
        "naam", "name", "patiënt", "patient", "geboortedatum", "birth",
        "rijksregister", "bsn", "insz", "adres", "telefoon", "e-mail", "email",
        "aanvrager", "radioloog", "huisarts", "verwijzer", "accession", "pacsnummer",
    ];

    /** Voorgestelde stand voor een veld dat we nog niet kennen. */
    function voorstel(label, groep) {
        const t = String(label || "").toLowerCase();
        const lijst = INHOUD_GROEPEN.includes(groep) ? PII_WOORDEN_STRIKT : PII_WOORDEN;
        return lijst.some((w) => t.includes(w)) ? PII : AI;
    }

    // ── Opslag ──────────────────────────────────────────────────────────────

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
        catch { return {}; }
    }

    function save(map) {
        try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) {}
        return map;
    }

    /** De stand van één veld: bewaarde keuze, anders het voorstel. */
    function klasse(veld, map) {
        const m = map || load();
        return m[veld.key] || voorstel(veld.label, veld.groep);
    }

    function zet(key, waarde) {
        const m = load();
        m[key] = waarde === PII ? PII : AI;
        return save(m);
    }

    /** Alle velden van een groep in één keer omzetten. */
    function zetVeel(velden, waarde) {
        const m = load();
        velden.forEach((v) => { m[v.key] = waarde === PII ? PII : AI; });
        return save(m);
    }

    function tel(velden, map) {
        const m = map || load();
        let pii = 0, ai = 0;
        velden.forEach((v) => { klasse(v, m) === PII ? pii++ : ai++; });
        return { pii, ai, totaal: velden.length };
    }

    // ── Tiro-velden onthouden ───────────────────────────────────────────────

    /**
     * De Tiro-formulieren worden door de SDK opgebouwd; hun veldnamen staan
     * nergens in dit project. launch.html geeft ze door zodra een formulier een
     * antwoord oplevert, zodat de scan ze daarna kent.
     */
    function onthoudTiroVelden(formulier, namen) {
        if (!namen || !namen.length) return;
        let bestaand;
        try { bestaand = JSON.parse(localStorage.getItem(TIRO_KEY) || "{}") || {}; }
        catch { bestaand = {}; }
        const lijst = new Set(bestaand[formulier] || []);
        const voor = lijst.size;
        namen.forEach((n) => { const s = String(n || "").trim(); if (s) lijst.add(s); });
        if (lijst.size === voor) return;              // niets nieuws
        bestaand[formulier] = [...lijst];
        try { localStorage.setItem(TIRO_KEY, JSON.stringify(bestaand)); } catch (_) {}
    }

    /** Alle item-teksten uit een QuestionnaireResponse, ook de geneste. */
    function veldnamenUitResponse(response) {
        const uit = [];
        (function loop(items) {
            (items || []).forEach((item) => {
                if (item.text) uit.push(item.text);
                loop(item.item);
            });
        })(response && response.item);
        return uit;
    }

    // ── Scannen ─────────────────────────────────────────────────────────────

    function veld(key, label, groep, detail) {
        return { key, label: String(label || "").trim(), groep, detail: detail || "" };
    }

    function uitSchemas() {
        const uit = [];
        const bronnen = [
            ["qc", window.QC_SCHEMAS],
            ["cases", window.CASES_SCHEMAS],
        ];
        bronnen.forEach(([prefix, schemas]) => {
            Object.values(schemas || {}).forEach((schema) => {
                (schema.fields || []).forEach((f) => {
                    if (f.type === "section") return;   // kopjes zijn geen invulveld
                    uit.push(veld(`schema:${prefix}.${schema.id}.${f.id}`, f.label || f.id,
                                  "formulier", schema.title || schema.id));
                });
            });
        });
        return uit;
    }

    function uitTiro() {
        let opgeslagen;
        try { opgeslagen = JSON.parse(localStorage.getItem(TIRO_KEY) || "{}") || {}; }
        catch { return []; }
        const uit = [];
        Object.entries(opgeslagen).forEach(([formulier, namen]) => {
            (namen || []).forEach((naam) => {
                uit.push(veld(`tiro:${formulier}.${naam}`, naam, "tiro", formulier));
            });
        });
        return uit;
    }

    function uitCalculatoren() {
        const uit = [];
        const alle = (window.RADCALC && window.RADCALC.all()) || [];
        alle.forEach((calc) => {
            (calc.inputs || []).forEach((inp) => {
                uit.push(veld(`calc:${calc.id}.${inp.id}`, inp.label || inp.id,
                              "calculator", calc.naam || calc.id));
            });
        });
        return uit;
    }

    /**
     * Veldnamen uit een textuele template: [- Naam:] en {[- Naam:]}. De naam is
     * alles voor de dubbele punt; commentaar en standaardwaarden blijven buiten.
     */
    function veldnamenUitTemplate(tekst) {
        const uit = [];
        const re = /\[-?\s*([^\]:]+?)\s*:?\s*\]/g;
        let m;
        while ((m = re.exec(String(tekst || "")))) {
            const naam = m[1].trim();
            if (naam && naam !== "br") uit.push(naam);
        }
        return uit;
    }

    function uitVerslagtemplates(examTypes) {
        const uit = [];
        const gezien = new Set();
        (examTypes || []).forEach((et) => {
            const namen = [
                ...veldnamenUitTemplate(et.textTemplate),
                ...veldnamenUitTemplate(et.userTextTemplate),
            ];
            namen.forEach((naam) => {
                const key = `tekst:${et.id}.${naam}`;
                if (gezien.has(key)) return;
                gezien.add(key);
                uit.push(veld(key, naam, "verslag", et.name || et.id));
            });
        });
        return uit;
    }

    /** {placeholders} uit de prompts die in localStorage staan. */
    function uitPrompts() {
        const promptSleutels = [
            "dictationActionUrl", "kidvActionUrl", "aiConsultUrl", "verslagCheckUrl",
            "inlineCheckUrl", "snomedCtActionUrl", "autofillBackupUrl",
            "medgemmaActionUrl", "formFillActionUrl",
        ];
        const gevonden = new Map();
        promptSleutels.forEach((sleutel) => {
            let tekst = "";
            try { tekst = localStorage.getItem(sleutel) || ""; } catch (_) {}
            const re = /\{([a-zA-Z_][a-zA-Z0-9_ ]*)\}/g;
            let m;
            while ((m = re.exec(tekst))) {
                const naam = m[1].trim();
                if (!naam) continue;
                if (!gevonden.has(naam)) gevonden.set(naam, new Set());
                gevonden.get(naam).add(sleutel);
            }
        });
        return gevonden;
    }

    /**
     * De placeholders die de code effectief invult. fillPrompt() krijgt op elke
     * aanroepplaats een object mee met precies die sleutels, dus dat is de
     * betrouwbaarste bron — ook wanneer de prompts in localStorage nog leeg zijn
     * of de gebruiker ze heeft aangepast.
     */
    function uitFillPrompt(launchTekst) {
        const gevonden = new Set();
        const re = /fillPrompt\s*\([^,]+,\s*\{([^{}]*)\}/g;
        let m;
        while ((m = re.exec(launchTekst || ""))) {
            m[1].split(",").forEach((stuk) => {
                // "tekst" of "type_onderzoek: typeOnderzoek" of '"Procedure template": x'
                const naam = stuk.split(":")[0].trim().replace(/^["']|["']$/g, "");
                if (/^[a-zA-Z_][a-zA-Z0-9_ ]*$/.test(naam)) gevonden.add(naam);
            });
        }
        return gevonden;
    }

    /** De URL-parameters die launch.html uitleest. */
    function uitPacs(launchTekst) {
        const re = /params\.get\(\s*["']([a-zA-Z_][\w-]*)["']\s*\)/g;
        const namen = new Set();
        let m;
        while ((m = re.exec(launchTekst || ""))) namen.add(m[1]);
        return [...namen].map((n) => veld(`pacs:${n}`, n, "pacs", "launch.html"));
    }

    /** Invoervelden van een opgehaalde pagina. */
    function uitPagina(pagina, html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const uit = [];
        const gezien = new Set();
        doc.querySelectorAll("input, textarea, select").forEach((el) => {
            const type = (el.getAttribute("type") || "").toLowerCase();
            if (["submit", "button", "hidden", "reset", "image"].includes(type)) return;
            const id = el.id || el.getAttribute("name") || "";
            const naam = labelVoor(doc, el) || el.getAttribute("placeholder") || id;
            if (!naam) return;
            const key = `html:${pagina}#${id || naam}`;
            if (gezien.has(key)) return;
            gezien.add(key);
            uit.push(veld(key, naam, "pagina", pagina));
        });
        return uit;
    }

    function labelVoor(doc, el) {
        if (el.id) {
            const lab = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (lab) return lab.textContent.trim();
        }
        const ouder = el.closest("label");
        if (ouder) return ouder.textContent.trim();
        return "";
    }

    /**
     * Alles scannen. examTypes geeft de aanroeper mee (flow.html heeft ze al
     * in geheugen); ontbreken ze, dan vallen we terug op localStorage.
     */
    async function scan(opties) {
        const o = opties || {};
        let examTypes = o.examTypes;
        if (!examTypes) {
            try { examTypes = (JSON.parse(localStorage.getItem("flowConfig_v1") || "null") || {}).examTypes; }
            catch { examTypes = []; }
        }

        const velden = [
            ...uitSchemas(),
            ...uitTiro(),
            ...uitCalculatoren(),
            ...uitVerslagtemplates(examTypes),
        ];

        // De pagina's parallel ophalen. Een pagina die niet laadt slaan we over
        // in plaats van de hele scan te laten mislukken.
        const paginas = await Promise.all(PAGINAS.map(async (p) => {
            try {
                const res = await fetch(p, { cache: "no-store" });
                if (!res.ok) return null;
                return [p, await res.text()];
            } catch { return null; }
        }));

        const promptVelden = uitPrompts();   // uit de (eventueel aangepaste) prompts
        paginas.filter(Boolean).forEach(([pagina, html]) => {
            if (pagina === "launch.html") {
                velden.push(...uitPacs(html));
                uitFillPrompt(html).forEach((naam) => {
                    if (!promptVelden.has(naam)) promptVelden.set(naam, new Set());
                    promptVelden.get(naam).add("code");
                });
            }
            velden.push(...uitPagina(pagina, html));
        });

        promptVelden.forEach((bronnen, naam) => {
            velden.push(veld(`prompt:${naam}`, `{${naam}}`, "prompt",
                             [...bronnen].includes("code") ? "ingevuld door de code" : [...bronnen].join(", ")));
        });

        // Dubbels eruit; de eerste bron wint.
        const gezien = new Set();
        const uniek = velden.filter((v) => {
            if (!v.label || gezien.has(v.key)) return false;
            gezien.add(v.key);
            return true;
        });

        const resultaat = { ts: new Date().toISOString(), velden: uniek };
        try { localStorage.setItem(SCAN_KEY, JSON.stringify(resultaat)); } catch (_) {}
        return resultaat;
    }

    /** Laatste scanresultaat, zodat de lijst er bij het openen meteen staat. */
    function laatsteScan() {
        try { return JSON.parse(localStorage.getItem(SCAN_KEY) || "null"); }
        catch { return null; }
    }

    /**
     * Wat een AI-model in de plaats van de waarde te zien krijgt wanneer een
     * veld als PII gemarkeerd staat: de veldnaam tussen vierkante haken, niet
     * de inhoud. Vandaag enkel ter illustratie in het overzicht.
     */
    function vervanging(label) {
        return "[" + String(label || "veld").trim() + "]";
    }

    window.VELDBEVEILIGING = {
        KEY, SCAN_KEY, TIRO_KEY, PII, AI, GROEPEN, NIVEAUS,
        scan, laatsteScan,
        load, save, klasse, zet, zetVeel, tel, voorstel, vervanging,
        onthoudTiroVelden, veldnamenUitResponse,
        veldnamenUitTemplate,
    };
})();
