/*
 * forms-shared.js — gedeelde laag voor qc.html en cases.html
 *
 * Bevat alles wat niet afhangt van de concrete veldenlijst:
 *   RecordStore   — IndexedDB opslag van ingevulde formulieren + schermafdrukken
 *   SchemaForm    — declaratieve renderer (velden + conditionele logica)
 *   TiroFill      — schrijven in de shadow DOM van tiro-form-filler (zelfde techniek als SNOMED CT in launch.html)
 *   Screenshot    — schermafdruk vastleggen (getDisplayMedia, plakken of uploaden)
 *   AiImageFill   — velden invullen op basis van geuploade beelden via Gemini
 *   mountFormsUI  — plaatst toggle, foto-knop, database-knop en koppelt save-acties
 *
 * De concrete velden staan in qc-schema.js en cases-schema.js.
 */
(function (global) {
    "use strict";

    // ── Stijlklassen, conform de bestaande pagina's ──────────────────────────
    const BTN = "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-neutral-300 dark:border-slate-700 bg-white dark:bg-muted hover:bg-neutral-100 dark:hover:bg-accent text-neutral-700 dark:text-neutral-200 transition-colors shadow-sm";
    const BTN_PRIMARY = "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-cyan-600 hover:bg-cyan-700 text-white transition-colors shadow-sm";
    const BTN_SMALL = "px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-300 dark:border-slate-700 bg-white dark:bg-muted hover:bg-neutral-100 dark:hover:bg-accent text-neutral-700 dark:text-neutral-200 transition-colors";
    const INPUT = "w-full px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-slate-700 bg-white dark:bg-background text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-cyan-500";
    const LABEL = "block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1";
    const PANEL = "bg-white dark:bg-muted rounded-lg shadow-xl flex flex-col";
    const OVERLAY = "hidden fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4";

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // RecordStore — IndexedDB
    // ═══════════════════════════════════════════════════════════════════════
    const RecordStore = {
        DB_NAME: "jyzForms",
        DB_VERSION: 1,
        STORES: ["qc", "database"],
        _db: null,

        _open() {
            if (this._db) return Promise.resolve(this._db);
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    this.STORES.forEach((s) => {
                        if (!db.objectStoreNames.contains(s)) {
                            db.createObjectStore(s, { keyPath: "id" });
                        }
                    });
                };
                req.onsuccess = () => { this._db = req.result; resolve(this._db); };
                req.onerror = () => reject(req.error);
            });
        },

        async _tx(store, mode, fn) {
            const db = await this._open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(store, mode);
                const os = tx.objectStore(store);
                let out;
                try { out = fn(os); } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
                tx.onerror = () => reject(tx.error);
            });
        },

        newId() {
            return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        },

        /** Ruwe schrijfactie; laat createdAt en updatedAt ongemoeid. Voor imports. */
        put(store, record) {
            return this._tx(store, "readwrite", (os) => os.put(record)).then(() => record);
        },

        /** Bewaren vanuit het formulier: stempelt updatedAt op nu. */
        save(store, record) {
            if (!record.id) record.id = this.newId();
            if (!record.createdAt) record.createdAt = new Date().toISOString();
            record.updatedAt = new Date().toISOString();
            return this.put(store, record);
        },

        all(store) {
            return this._tx(store, "readonly", (os) => os.getAll()).then((r) => r || []);
        },

        get(store, id) {
            return this._tx(store, "readonly", (os) => os.get(id));
        },

        remove(store, id) {
            return this._tx(store, "readwrite", (os) => os.delete(id));
        },

        /** Alle stores als plain object — voor de JSON-export op qc.html. */
        async exportAll() {
            const out = {};
            for (const s of this.STORES) out[s] = await this.all(s);
            return out;
        },

        /**
         * Voeg geïmporteerde records samen met wat er al staat, zonder nieuwer
         * werk te overschrijven en zonder de originele tijdstempels te wissen.
         *
         *   zelfde id, nieuwere versie      → bijwerken
         *   zelfde id, gelijke versie       → ongewijzigd (zelfde bestand opnieuw)
         *   zelfde id, oudere versie        → overslaan, het lokale record blijft
         *   nieuw id, gelijke vingerafdruk  → gemeld als mogelijk dubbel
         *   nieuw id, onbekend              → toevoegen
         *
         * Met dryRun verandert er niets; je krijgt enkel de telling terug, zodat
         * de gebruiker eerst kan zien wat een import zou doen.
         */
        async merge(store, records, { fingerprint = null, includeDuplicates = false, dryRun = false } = {}) {
            const existing = await this.all(store);
            const byId = new Map(existing.map((r) => [r.id, r]));
            const prints = new Map();
            if (fingerprint) {
                existing.forEach((r) => { const fp = fingerprint(r); if (fp) prints.set(fp, r); });
            }

            const added = [], updated = [], older = [], unchanged = [], duplicates = [];
            for (const rec of records || []) {
                if (!rec || !rec.id) continue;
                const mine = byId.get(rec.id);
                if (mine) {
                    const theirs = String(rec.updatedAt || rec.createdAt || "");
                    const ours = String(mine.updatedAt || mine.createdAt || "");
                    (theirs > ours ? updated : theirs === ours ? unchanged : older).push(rec);
                    continue;
                }
                const fp = fingerprint ? fingerprint(rec) : null;
                if (fp && prints.has(fp)) { duplicates.push(rec); continue; }
                added.push(rec);
                if (fp) prints.set(fp, rec);
            }

            const summary = {
                added: added.length,
                updated: updated.length,
                older: older.length,
                unchanged: unchanged.length,
                duplicates: duplicates.length,
            };
            if (dryRun) return summary;

            const write = added.concat(updated, includeDuplicates ? duplicates : []);
            for (const rec of write) await this.put(store, rec);
            summary.written = write.length;
            summary.duplicatesAdded = includeDuplicates ? duplicates.length : 0;
            return summary;
        },

        /** Records van meerdere stores terugzetten uit een geïmporteerd bestand. */
        async importAll(data, { replace = false, ...opts } = {}) {
            if (!data || typeof data !== "object") return 0;
            let n = 0;
            for (const s of this.STORES) {
                if (!Array.isArray(data[s])) continue;
                if (replace) await this._tx(s, "readwrite", (os) => os.clear());
                const r = await this.merge(s, data[s], opts);
                n += r.written || 0;
            }
            return n;
        },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // NameLists — beheerbare keuzelijsten (radiologen, aanvragers)
    // Beheerd op de flow-configuratiepagina, bewaard in localStorage en
    // meegenomen in de JSON-export.
    // ═══════════════════════════════════════════════════════════════════════
    const NameLists = {
        KEYS: { radiologen: "qcRadiologenLijst", aanvragers: "qcAanvragersLijst" },

        /**
         * Lijst van { name, email, isUser }. Oudere lijsten bevatten platte
         * strings zonder e-mailadres; die blijven leesbaar en krijgen een leeg
         * adres. isUser duidt aan wie de gebruiker van dit profiel is; dat
         * wordt later vervangen door de aanmelding.
         */
        entries(which) {
            try {
                const arr = JSON.parse(localStorage.getItem(this.KEYS[which]) || "[]");
                if (!Array.isArray(arr)) return [];
                return arr
                    .map((e) => (typeof e === "string"
                        ? { name: e.trim(), email: "", isUser: false }
                        : {
                            name: String(e?.name || "").trim(),
                            email: String(e?.email || "").trim(),
                            isUser: e?.isUser === true,
                        }))
                    .filter((e) => e.name);
            } catch { return []; }
        },

        /** De naam die als gebruiker van dit profiel is aangeduid. */
        currentUser() {
            for (const which of Object.keys(this.KEYS)) {
                const hit = this.entries(which).find((e) => e.isUser);
                if (hit) return hit.name;
            }
            return "";
        },

        /** Alleen de namen — dat is wat in de keuzelijsten en in de records staat. */
        get(which) {
            return this.entries(which).map((e) => e.name);
        },

        set(which, entries) {
            if (!this.KEYS[which]) return;
            const clean = (entries || [])
                .map((e) => (typeof e === "string"
                    ? { name: e.trim(), email: "", isUser: false }
                    : {
                        name: String(e?.name || "").trim(),
                        email: String(e?.email || "").trim(),
                        isUser: e?.isUser === true,
                    }))
                .filter((e) => e.name);
            // Hoogstens één gebruiker van dit profiel.
            let seen = false;
            clean.forEach((e) => {
                if (e.isUser && !seen) seen = true;
                else e.isUser = false;
            });
            localStorage.setItem(this.KEYS[which], JSON.stringify(clean));
        },

        /** Zoek het e-mailadres bij een naam, over alle lijsten heen. */
        emailFor(name) {
            const target = String(name || "").trim().toLowerCase();
            if (!target) return "";
            for (const which of Object.keys(this.KEYS)) {
                const hit = this.entries(which).find((e) => e.name.toLowerCase() === target);
                if (hit && hit.email) return hit.email;
            }
            return "";
        },

        all() {
            const out = {};
            Object.keys(this.KEYS).forEach((k) => { out[this.KEYS[k]] = this.entries(k); });
            return out;
        },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SnomedOptions — dynamische pathologie-opties uit de SNOMED CT analyse
    // launch.html schrijft het resultaat weg; hier lezen we het uit.
    // ═══════════════════════════════════════════════════════════════════════
    const SnomedOptions = {
        KEY: "snomedLastResult",

        /** Wordt door launch.html aangeroepen. */
        store(result) {
            try { localStorage.setItem(this.KEY, JSON.stringify({ ...result, ts: new Date().toISOString() })); }
            catch { /* opslag vol — stil negeren, de lijst is een hulpmiddel */ }
        },

        raw() {
            try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); }
            catch { return null; }
        },

        /**
         * Platte lijst met bevindingen, hoofddiagnose eerst. Negated bevindingen
         * blijven buiten de lijst: dat zijn juist de afwezige pathologieën.
         */
        options() {
            const r = this.raw();
            if (!r) return [];
            const seen = new Set();
            return [].concat(r.hoofddiagnose || [], r.bijdiagnose || [])
                .map((s) => String(s).trim())
                .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
        },
    };

    /** Los een optionsFrom-verwijzing op naar een concrete optielijst. */
    function resolveOptions(field) {
        if (field.options && field.options.length) return field.options;
        switch (field.optionsFrom) {
            case "radiologen": return NameLists.get("radiologen");
            case "aanvragers": return NameLists.get("aanvragers");
            case "snomed":     return SnomedOptions.options();
            default:           return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SchemaForm — declaratieve renderer met conditionele logica
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Schema:
    //   { id, title, questionnaire, fields: [ ...field ] }
    //
    // Veld:
    //   { id, label, type, options?, rows?, placeholder?, required?, showWhen? }
    //   type: section | text | textarea | number | date | select | radio | checkboxes | boolean
    //   showWhen: { field, equals } | { field, in: [...] } | { field, notEmpty: true }
    //
    const SchemaForm = {
        FIELD_TYPES: ["section", "text", "textarea", "number", "date", "select", "radio", "checkboxes", "boolean"],

        render(container, schema, values) {
            container.innerHTML = "";
            const wrap = el("div", "p-3 flex flex-col gap-3");
            (schema.fields || []).forEach((f) => wrap.appendChild(this._renderField(f, values && values[f.id])));
            container.appendChild(wrap);
            this._bindConditionals(container, schema);
            this.applyConditionals(container, schema);
            return container;
        },

        _renderField(f, value) {
            const row = el("div");
            row.dataset.fieldId = f.id;
            row.dataset.fieldType = f.type;
            if (f.showWhen) row.dataset.hasCondition = "1";

            if (f.type === "section") {
                row.className = "pt-2 pb-1 border-b border-neutral-200 dark:border-slate-700";
                row.appendChild(el("h3", "text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400", f.label));
                return row;
            }

            row.className = "flex flex-col";
            const lbl = el("label", LABEL, f.label + (f.required ? " *" : ""));
            lbl.setAttribute("for", "fld-" + f.id);
            row.appendChild(lbl);

            let input;
            switch (f.type) {
                case "textarea":
                    input = el("textarea", INPUT + " resize-y leading-relaxed");
                    input.rows = f.rows || 3;
                    if (value != null) input.value = value;
                    break;

                case "select": {
                    input = el("select", INPUT);
                    input.appendChild(el("option", "", f.placeholder || "—"));
                    input.firstChild.value = "";
                    resolveOptions(f).forEach((o) => {
                        const opt = el("option", "", typeof o === "string" ? o : o.label);
                        opt.value = typeof o === "string" ? o : o.value;
                        input.appendChild(opt);
                    });
                    if (value != null) input.value = value;
                    break;
                }

                case "radio":
                case "boolean": {
                    const opts = f.type === "boolean" ? (f.options || ["Ja", "Nee"]) : resolveOptions(f);
                    input = el("div", "flex flex-wrap gap-2");
                    opts.forEach((o) => {
                        const v = typeof o === "string" ? o : o.value;
                        const text = typeof o === "string" ? o : o.label;
                        const btn = el("button", "", text);
                        btn.type = "button";
                        btn.dataset.value = v;
                        btn.className = BTN_SMALL;
                        btn.addEventListener("click", () => {
                            const already = btn.dataset.selected === "1";
                            input.querySelectorAll("button").forEach((b) => {
                                b.dataset.selected = "0";
                                b.className = BTN_SMALL;
                            });
                            if (!already) {
                                btn.dataset.selected = "1";
                                btn.className = BTN_SMALL + " !bg-cyan-600 !text-white !border-cyan-600";
                            }
                            input.dispatchEvent(new Event("change", { bubbles: true }));
                        });
                        if (value != null && String(value) === String(v)) btn.click();
                        input.appendChild(btn);
                    });
                    break;
                }

                case "checkboxes":
                case "dynamicCheckboxes": {
                    // Lange lijsten krijgen een eigen schuifvlak zodat het
                    // formulier niet uit elkaar loopt.
                    const many = resolveOptions(f).length > 7;
                    input = el("div", "flex flex-col gap-1.5" + (many
                        ? " max-h-44 overflow-y-auto rounded-md border border-neutral-200 dark:border-slate-700 p-2"
                        : ""));
                    const sel = Array.isArray(value) ? value.map(String) : value != null ? [String(value)] : [];
                    const addBox = (v, text, checked) => {
                        const line = el("label", "flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200 cursor-pointer");
                        const cb = el("input");
                        cb.type = "checkbox";
                        cb.value = v;
                        cb.className = "rounded border-neutral-300 dark:border-slate-700 text-cyan-600 focus:ring-cyan-500";
                        if (checked) cb.checked = true;
                        line.append(cb, el("span", "", text));
                        input.appendChild(line);
                        return cb;
                    };

                    const known = resolveOptions(f).map((o) => (typeof o === "string" ? o : o.value));
                    known.forEach((v) => addBox(v, v, sel.includes(String(v))));
                    // Reeds bewaarde waarden die niet in de huidige optielijst zitten
                    // (bv. eerder via "Andere toevoegen" ingevoerd) blijven zichtbaar.
                    sel.filter((v) => !known.map(String).includes(v)).forEach((v) => addBox(v, v, true));

                    if (f.type === "dynamicCheckboxes") {
                        if (!known.length && !sel.length) {
                            input.appendChild(el("p", "text-xs text-neutral-400 dark:text-neutral-500",
                                "Nog geen SNOMED CT-resultaten. Gebruik “Andere toevoegen”."));
                        }
                        const add = el("button", "self-end text-xs text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer bg-transparent border-0 p-0", f.addLabel || "Andere toevoegen");
                        add.type = "button";
                        add.addEventListener("click", () => {
                            const wrap = el("div", "flex gap-2 items-center pt-1");
                            const txt = el("input", INPUT + " !py-1 text-sm");
                            txt.type = "text";
                            txt.placeholder = "Pathologie toevoegen…";
                            const ok = el("button", BTN_SMALL, "Toevoegen");
                            ok.type = "button";
                            const commit = () => {
                                const v = txt.value.trim();
                                if (!v) return;
                                addBox(v, v, true).dispatchEvent(new Event("change", { bubbles: true }));
                                wrap.remove();
                                input.appendChild(add);
                            };
                            ok.addEventListener("click", commit);
                            txt.addEventListener("keydown", (e) => {
                                if (e.key === "Enter") { e.preventDefault(); commit(); }
                                if (e.key === "Escape") { wrap.remove(); input.appendChild(add); }
                            });
                            wrap.append(txt, ok);
                            add.remove();
                            input.appendChild(wrap);
                            txt.focus();
                        });
                        input.appendChild(add);
                    }
                    break;
                }

                case "printscreen": {
                    // Illustratieve opname van de pathologie of de fout: uploaden,
                    // slepen, plakken of het scherm vastleggen. Vult geen velden in.
                    input = el("div", "flex flex-col gap-2");
                    const shots = el("div", "flex gap-2 flex-wrap");
                    shots.dataset.shots = f.id;

                    const zone = el("div", "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 dark:border-slate-600 bg-neutral-50 dark:bg-background py-4 px-3 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500");
                    zone.tabIndex = 0;
                    zone.dataset.dropzone = f.id;
                    zone.appendChild(el("p", "text-xs text-neutral-500 dark:text-neutral-400",
                        "Dubbelklik om te uploaden, sleep beelden hierheen of plak met Ctrl+V"));
                    zone.appendChild(el("p", "text-xs text-neutral-400 dark:text-neutral-500",
                        "JPEG, PNG of WEBP"));

                    const fileInput = el("input", "hidden");
                    fileInput.type = "file";
                    fileInput.accept = "image/*";
                    fileInput.multiple = true;
                    zone.appendChild(fileInput);

                    const addFiles = async (files) => {
                        for (const file of files || []) {
                            const d = await Screenshot.fromFile(file);
                            if (d) SchemaForm._thumb(shots, d);
                        }
                    };
                    // Enkelklik zet enkel de aandacht op het vlak, zodat Ctrl+V hier
                    // aankomt. Dubbelklik opent de bestandskiezer. Anders sprong die
                    // kiezer open telkens je het vlak aanklikte om te plakken.
                    zone.addEventListener("click", () => zone.focus());
                    zone.addEventListener("dblclick", (e) => { e.preventDefault(); fileInput.click(); });
                    zone.addEventListener("keydown", (e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
                    });
                    fileInput.addEventListener("change", async () => {
                        await addFiles(fileInput.files);
                        fileInput.value = "";
                    });
                    const hi = () => zone.classList.add("border-cyan-500");
                    const lo = () => zone.classList.remove("border-cyan-500");
                    zone.addEventListener("dragover", (e) => { e.preventDefault(); hi(); });
                    zone.addEventListener("dragleave", lo);
                    zone.addEventListener("drop", async (e) => {
                        e.preventDefault(); lo();
                        await addFiles(e.dataTransfer.files);
                    });

                    const capture = el("button", BTN_SMALL + " self-start", f.buttonLabel || "Scherm vastleggen");
                    capture.type = "button";
                    capture.dataset.printscreen = f.id;
                    capture.addEventListener("click", (e) => {
                        e.stopPropagation();
                        // De pagina vangt dit op en legt de schermafdruk vast.
                        row.dispatchEvent(new CustomEvent("printscreen-request", {
                            bubbles: true,
                            detail: { fieldId: f.id, button: capture },
                        }));
                    });

                    input.append(zone, capture, shots);
                    (Array.isArray(value) ? value : []).forEach((src) => this._thumb(shots, src));
                    this._bindPasteOnce();
                    break;
                }

                case "number":
                case "date":
                case "text":
                default:
                    input = el("input", INPUT);
                    input.type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
                    if (f.placeholder) input.placeholder = f.placeholder;
                    if (value != null) input.value = value;
                    break;
            }

            input.id = "fld-" + f.id;
            input.dataset.input = f.id;
            row.appendChild(input);
            if (f.hint) row.appendChild(el("p", "text-xs text-neutral-400 dark:text-neutral-500 mt-1", f.hint));
            return row;
        },

        /** Herevalueer conditionals bij elke wijziging. */
        _bindConditionals(container, schema) {
            const hasConditions = (schema.fields || []).some((f) => f.showWhen);
            if (!hasConditions) return;
            const rerun = () => this.applyConditionals(container, schema);
            container.addEventListener("change", rerun);
            container.addEventListener("input", rerun);
        },

        applyConditionals(container, schema) {
            const values = this.read(container, schema, { includeHidden: true });
            (schema.fields || []).forEach((f) => {
                if (!f.showWhen) return;
                const row = container.querySelector('[data-field-id="' + f.id + '"]');
                if (!row) return;
                row.classList.toggle("hidden", !this._matches(f.showWhen, values));
            });
        },

        _matches(cond, values) {
            const conds = Array.isArray(cond) ? cond : [cond];
            return conds.every((c) => {
                const v = values[c.field];
                if (c.notEmpty) return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
                if (c.in) return c.in.some((x) => (Array.isArray(v) ? v.includes(x) : String(v) === String(x)));
                if ("equals" in c) return Array.isArray(v) ? v.includes(c.equals) : String(v) === String(c.equals);
                return true;
            });
        },

        /**
         * Eén plak-luisteraar voor alle neerzetvlakken samen. Reageert enkel
         * wanneer de gebruiker effectief in zo'n vlak staat, zodat plakken in
         * een tekstvak niet onderschept wordt.
         */
        _bindPasteOnce() {
            if (this._pasteBound) return;
            this._pasteBound = true;
            document.addEventListener("paste", async (e) => {
                const zone = document.activeElement?.closest?.("[data-dropzone]");
                if (!zone) return;
                const row = zone.closest("[data-field-id]");
                const shots = row && row.querySelector('[data-shots="' + zone.dataset.dropzone + '"]');
                if (!shots) return;
                const images = await Screenshot.fromClipboard(e);
                if (!images.length) return;
                e.preventDefault();
                images.forEach((src) => this._thumb(shots, src));
            });
        },

        /** Voeg een miniatuur toe met een kruisje om te verwijderen. */
        _thumb(shotsEl, src) {
            const box = el("span", "relative inline-block");
            const img = el("img", "h-14 rounded border border-neutral-200 dark:border-slate-700 cursor-pointer");
            img.src = src;
            img.dataset.shot = "1";
            img.addEventListener("click", () => window.open(src, "_blank"));
            const kill = el("button", "absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-700 text-white text-[10px] leading-none flex items-center justify-center cursor-pointer border-0", "×");
            kill.type = "button";
            kill.title = "Verwijderen";
            kill.addEventListener("click", (e) => { e.stopPropagation(); box.remove(); });
            box.append(img, kill);
            shotsEl.appendChild(box);
            return box;
        },

        /** Hang een schermafdruk aan een printscreen-veld. */
        addScreenshot(container, fieldId, dataUri) {
            const shots = container.querySelector('[data-shots="' + fieldId + '"]');
            if (!shots) return false;
            this._thumb(shots, dataUri);
            return true;
        },

        /** Alle schermafdruk-data-URI's van het formulier, over alle velden heen. */
        allScreenshots(container) {
            return Array.from(container.querySelectorAll("img[data-shot]")).map((i) => i.src);
        },

        read(container, schema, { includeHidden = false } = {}) {
            const out = {};
            (schema.fields || []).forEach((f) => {
                if (f.type === "section") return;
                const row = container.querySelector('[data-field-id="' + f.id + '"]');
                if (!row) return;
                if (!includeHidden && row.classList.contains("hidden")) return;

                if (f.type === "radio" || f.type === "boolean") {
                    const on = row.querySelector('button[data-selected="1"]');
                    if (on) out[f.id] = on.dataset.value;
                } else if (f.type === "checkboxes" || f.type === "dynamicCheckboxes") {
                    const vals = Array.from(row.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
                    if (vals.length) out[f.id] = vals;
                } else if (f.type === "printscreen") {
                    const srcs = Array.from(row.querySelectorAll("img[data-shot]")).map((i) => i.src);
                    if (srcs.length) out[f.id] = srcs;
                } else {
                    const input = row.querySelector("[data-input]");
                    if (input && input.value !== "") out[f.id] = input.value;
                }
            });
            return out;
        },

        fill(container, schema, values) {
            if (!values) return;
            (schema.fields || []).forEach((f) => {
                if (f.type === "section" || !(f.id in values)) return;
                const row = container.querySelector('[data-field-id="' + f.id + '"]');
                if (!row) return;
                const v = values[f.id];

                if (f.type === "radio" || f.type === "boolean") {
                    row.querySelectorAll("button[data-value]").forEach((b) => {
                        const want = String(b.dataset.value) === String(v);
                        const isOn = b.dataset.selected === "1";
                        if (want !== isOn) b.click();
                    });
                } else if (f.type === "checkboxes" || f.type === "dynamicCheckboxes") {
                    const want = (Array.isArray(v) ? v : [v]).map(String);
                    const boxes = Array.from(row.querySelectorAll("input[type=checkbox]"));
                    boxes.forEach((c) => { c.checked = want.includes(c.value); });
                    if (f.type === "dynamicCheckboxes") {
                        // Waarden die nog geen aanvinkvakje hebben alsnog toevoegen,
                        // zodat een AI-suggestie of bewaarde waarde niet verdwijnt.
                        const present = boxes.map((c) => c.value);
                        const holder = row.querySelector("[data-input]");
                        want.filter((x) => !present.includes(x)).forEach((x) => {
                            const line = el("label", "flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200 cursor-pointer");
                            const cb = el("input");
                            cb.type = "checkbox";
                            cb.value = x;
                            cb.checked = true;
                            cb.className = "rounded border-neutral-300 dark:border-slate-700 text-cyan-600 focus:ring-cyan-500";
                            line.append(cb, el("span", "", x));
                            const addBtn = holder.querySelector("button");
                            holder.insertBefore(line, addBtn || null);
                        });
                    }
                } else if (f.type === "printscreen") {
                    const shots = row.querySelector('[data-shots="' + f.id + '"]');
                    if (shots) {
                        shots.innerHTML = "";
                        (Array.isArray(v) ? v : [v]).forEach((src) => this._thumb(shots, src));
                    }
                } else {
                    const input = row.querySelector("[data-input]");
                    if (input) input.value = v;
                }
            });
            this.applyConditionals(container, schema);
        },

        clear(container, schema) {
            this.render(container, schema, {});
        },

        /**
         * Bouw een QuestionnaireResponse uit de ingevulde waarden, zodat
         * "Save and send" hetzelfde endpoint kan gebruiken als in template mode.
         */
        toQuestionnaireResponse(schema, values) {
            const items = [];
            (schema.fields || []).forEach((f) => {
                // Schermafdrukken horen niet in de response: die zitten als
                // bijlage bij het record, niet als tekstwaarde.
                if (f.type === "section" || f.type === "printscreen" || !(f.id in values)) return;
                const v = values[f.id];
                const answers = (Array.isArray(v) ? v : [v]).map((x) => {
                    if (f.type === "number") return { valueDecimal: Number(x) };
                    if (f.type === "date") return { valueDate: String(x) };
                    if (f.type === "boolean") return { valueString: String(x) };
                    return { valueString: String(x) };
                });
                items.push({ linkId: f.id, text: f.label, answer: answers });
            });
            return {
                resourceType: "QuestionnaireResponse",
                questionnaire: schema.questionnaire || undefined,
                status: "completed",
                authored: new Date().toISOString(),
                item: items,
            };
        },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // TiroFill — schrijven in de shadow DOM van tiro-form-filler
    // Zelfde techniek als parseSnomedResult() in launch.html.
    // ═══════════════════════════════════════════════════════════════════════
    const TiroFill = {
        setNativeValue(node, value) {
            const proto = node.tagName === "TEXTAREA"
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) setter.call(node, value); else node.value = value;
            node.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
            node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        },

        _leafText(node) {
            return Array.from(node.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent.trim())
                .join(" ")
                .toLowerCase();
        },

        fillByLabel(rootEl, labelHint, value) {
            const self = this;
            function search(root) {
                if (!root) return false;
                for (const node of root.querySelectorAll("*")) {
                    if (self._leafText(node).includes(labelHint.toLowerCase())) {
                        let container = node;
                        for (let i = 0; i < 3; i++) {
                            const input = container.querySelector(
                                "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea"
                            );
                            if (input) { self.setNativeValue(input, value); return true; }
                            container = container.parentElement;
                            if (!container) break;
                        }
                    }
                    if (node.shadowRoot && search(node.shadowRoot)) return true;
                }
                return false;
            }
            return search(rootEl.shadowRoot || rootEl);
        },

        async fillDropdownByLabel(rootEl, labelHint, optionText) {
            const self = this;
            let clicked = false;
            function open(root) {
                if (!root || clicked) return;
                for (const node of root.querySelectorAll("*")) {
                    if (clicked) return;
                    if (self._leafText(node).includes(labelHint.toLowerCase())) {
                        let container = node;
                        for (let i = 0; i < 6 && container; i++) {
                            const sel = container.querySelector("select");
                            if (sel) {
                                for (const opt of sel.options) {
                                    if (opt.text.toLowerCase().includes(optionText.toLowerCase())) {
                                        sel.value = opt.value;
                                        sel.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                        clicked = true;
                                        return;
                                    }
                                }
                            }
                            const ctrl = container.querySelector("[aria-haspopup], [class*='control'], [class*='Control']");
                            if (ctrl) {
                                ctrl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0 }));
                                clicked = true;
                                return;
                            }
                            container = container.parentElement;
                        }
                    }
                    if (node.shadowRoot) open(node.shadowRoot);
                }
            }
            open(rootEl.shadowRoot || rootEl);
            if (!clicked) return false;
            await new Promise((r) => setTimeout(r, 400));

            function pick(root) {
                if (!root) return false;
                for (const node of root.querySelectorAll("[role='option'], [class*='option'], [class*='Option']")) {
                    if (node.textContent.trim().toLowerCase().includes(optionText.toLowerCase())) {
                        node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
                        node.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
                        return true;
                    }
                }
                for (const node of root.querySelectorAll("*")) {
                    if (node.shadowRoot && pick(node.shadowRoot)) return true;
                }
                return false;
            }
            return pick(rootEl.shadowRoot || rootEl) || pick(document.body);
        },

        /** Vul een set waarden in een Tiro-formulier; kiest per veldtype de juiste methode. */
        async fillValues(formEl, schema, values) {
            let n = 0;
            for (const f of schema.fields || []) {
                if (f.type === "section" || !(f.id in values)) continue;
                const v = values[f.id];
                const text = Array.isArray(v) ? v.join(", ") : String(v);
                const isChoice = ["select", "radio", "boolean", "checkboxes"].includes(f.type);
                const ok = isChoice
                    ? await this.fillDropdownByLabel(formEl, f.label, text) || this.fillByLabel(formEl, f.label, text)
                    : this.fillByLabel(formEl, f.label, text);
                if (ok) n++;
            }
            return n;
        },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // Screenshot — schermafdruk vastleggen
    // ═══════════════════════════════════════════════════════════════════════
    const Screenshot = {
        MAX_EDGE: 1600,
        QUALITY: 0.82,

        /** Verklein en comprimeer naar JPEG data-URI om de opslag beheersbaar te houden. */
        async downscale(source) {
            const bitmap = await (source instanceof Blob ? createImageBitmap(source) : source);
            const scale = Math.min(1, this.MAX_EDGE / Math.max(bitmap.width, bitmap.height));
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
            return canvas.toDataURL("image/jpeg", this.QUALITY);
        },

        /** Schermafdruk via de Screen Capture API — vraagt de gebruiker welk scherm/venster. */
        async captureScreen() {
            if (!navigator.mediaDevices?.getDisplayMedia) {
                throw new Error("Schermopname niet ondersteund in deze browser.");
            }
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            try {
                const track = stream.getVideoTracks()[0];
                // Even wachten tot het eerste frame beschikbaar is
                await new Promise((r) => setTimeout(r, 250));
                if (typeof ImageCapture !== "undefined") {
                    const bitmap = await new ImageCapture(track).grabFrame();
                    return await this.downscale(bitmap);
                }
                const video = document.createElement("video");
                video.srcObject = stream;
                video.muted = true;
                await video.play();
                await new Promise((r) => setTimeout(r, 150));
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext("2d").drawImage(video, 0, 0);
                const bmp = await createImageBitmap(canvas);
                return await this.downscale(bmp);
            } finally {
                stream.getTracks().forEach((t) => t.stop());
            }
        },

        async fromFile(file) {
            if (!file || !file.type.startsWith("image/")) return null;
            return await this.downscale(file);
        },

        /** Haal beelden uit een clipboard-paste event. */
        async fromClipboard(event) {
            const out = [];
            for (const item of event.clipboardData?.items || []) {
                if (item.type.startsWith("image/")) {
                    const f = item.getAsFile();
                    if (f) out.push(await this.downscale(f));
                }
            }
            return out;
        },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // Gemini — beeld naar veldwaarden
    // ═══════════════════════════════════════════════════════════════════════
    const DEFAULT_FORM_FILL_PROMPT = `Je bent een gespecialiseerde radiologie-assistent. Op de bijgevoegde beelden staat informatie over een radiologisch onderzoek (bijvoorbeeld een schermafdruk van een aanvraag, een verslag, een PACS-venster of een papieren document).

Lees de beelden zorgvuldig en vul daarmee de onderstaande formuliervelden in.

=== FORMULIERVELDEN ===
{velden}
=== EINDE FORMULIERVELDEN ===

REGELS:
- Geef UITSLUITEND een geldig JSON-object terug, zonder codeblok-markering en zonder uitleg
- Gebruik de veld-id als sleutel, exact zoals hierboven vermeld
- Vul een veld alleen in als de informatie werkelijk op het beeld staat; verzin NOOIT waarden
- Laat een veld volledig weg uit de JSON wanneer je de informatie niet terugvindt
- Bij een keuzeveld mag je uitsluitend één van de opgegeven opties gebruiken, letterlijk overgenomen
- Bij een meerkeuzeveld geef je een array van opties
- Datums in het formaat JJJJ-MM-DD
- Neem tekst letterlijk over uit het beeld; vertaal of herformuleer niet

Voorbeeld van een geldig antwoord:
{"veld_id_1": "waarde", "veld_id_2": ["optie a", "optie b"]}`;

    const AiImageFill = {
        PROMPT_KEY: "formFillActionUrl",
        MODEL_KEY: "geminiModelFormFill",
        DEFAULT_MODEL: "gemini-2.5-pro",
        DEFAULT_PROMPT: DEFAULT_FORM_FILL_PROMPT,

        getApiKey() {
            return localStorage.getItem("geminiApiKey") || localStorage.getItem("GEMINI_API_KEY") || "";
        },

        getPrompt() {
            return localStorage.getItem(this.PROMPT_KEY) || this.DEFAULT_PROMPT;
        },

        getModel() {
            return localStorage.getItem(this.MODEL_KEY) || this.DEFAULT_MODEL;
        },

        /** Beschrijf de velden zodat het model weet welke sleutels en opties toegelaten zijn. */
        describeFields(schema) {
            return (schema.fields || [])
                .filter((f) => f.type !== "section" && f.type !== "printscreen")
                .map((f) => {
                    const parts = ["- " + f.id + " (" + f.label + ")", "type: " + f.type];
                    const opts = resolveOptions(f).map((o) => (typeof o === "string" ? o : o.label));
                    if (opts.length) parts.push("toegestane opties: " + opts.join(" | "));
                    else if (f.type === "dynamicCheckboxes") parts.push("vrije tekst, meerdere waarden toegestaan");
                    return parts.join(" — ");
                })
                .join("\n");
        },

        async run(images, schema) {
            const key = this.getApiKey();
            if (!key) throw new Error("Geen Gemini API-sleutel ingesteld. Stel deze in via de instellingen op de hoofdpagina.");
            if (!images || !images.length) throw new Error("Geen beelden geselecteerd.");

            const prompt = this.getPrompt().replace("{velden}", this.describeFields(schema));
            const parts = [{ text: prompt }];
            images.forEach((dataUri) => {
                const [meta, b64] = dataUri.split(",");
                const mime = (meta.match(/data:([^;]+)/) || [, "image/jpeg"])[1];
                parts.push({ inlineData: { mimeType: mime, data: b64 } });
            });

            const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
                encodeURIComponent(this.getModel()) + ":generateContent?key=" + encodeURIComponent(key);
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts }] }),
            });
            if (!res.ok) throw new Error("Gemini-fout " + res.status + ": " + (await res.text()).slice(0, 200));
            const json = await res.json();
            const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
            return this.parseJson(text);
        },

        parseJson(text) {
            let t = (text || "").trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/```\s*$/, "")
                .trim();
            const start = t.indexOf("{");
            const end = t.lastIndexOf("}");
            if (start > 0 || end < t.length - 1) {
                if (start === -1 || end === -1) throw new Error("Geen JSON gevonden in het AI-antwoord.");
                t = t.slice(start, end + 1);
            }
            try { return JSON.parse(t); }
            catch { throw new Error("AI-antwoord was geen geldige JSON."); }
        },
    };


    // ═══════════════════════════════════════════════════════════════════════
    // mountFormsUI — plaatst de niet-template laag op een pagina
    // ═══════════════════════════════════════════════════════════════════════
    //
    // VERWIJDEREN VAN DE NIET-TEMPLATE MODE
    // Zodra er een echte database gekoppeld is, verdwijnt deze laag met
    // drie ingrepen per pagina, zonder de rest van de pagina te raken:
    //   1. de twee <script src="forms-shared.js"> en "<pagina>-schema.js" regels
    //   2. de JyzForms.mountFormsUI({ ... }) aanroep
    //   3. de <div data-nontemplate> containers in de twee <details> blokken
    // Alle overige code op de pagina (Tiro-formulieren, save-knoppen, export)
    // blijft ongewijzigd werken: deze laag hangt er bovenop en onderschept
    // alleen zolang de niet-template mode actief is.
    //
    const MODE_KEY_PREFIX = "templateMode_";

    function mountFormsUI(config) {
        const {
            page,                 // opslagnaam: "qc" of "database"
            sections = [],        // [{ tiro, native, schema }]
            primarySchema,        // schema voor records en overzicht
            saveBtn, saveAndSendBtn, backBtn,
            onSend,               // async (questionnaireResponse, { recipient, values }) => void
            sendWhen,             // (values) => boolean — wanneer de verstuurknop bruikbaar is
            shouldSend,           // () => boolean — false betekent bewaren zonder mail
            recipientFrom,        // (values) => naam van de ontvanger
        } = config;

        const modeKey = MODE_KEY_PREFIX + page;
        const isTemplateMode = () => localStorage.getItem(modeKey) !== "off";
        const params = new URLSearchParams(location.search);
        let currentRecordId = null;
        let _dirty = false;   // niet-bewaarde wijzigingen in het formulier

        // ── Native formulieren opbouwen ─────────────────────────────────
        function renderNative() {
            sections.forEach(({ native, schema }) => {
                if (!native) return;
                SchemaForm.render(native, schema, prefillFromParams(schema, params));
                if (!native.dataset.sendWatch) {
                    native.dataset.sendWatch = "1";
                    const touched = () => { _dirty = true; updateSendButton(); };
                    native.addEventListener("change", touched);
                    native.addEventListener("input", touched);
                }
            });
        }

        function prefillFromParams(schema, sp) {
            const out = {};
            (schema.fields || []).forEach((f) => {
                const fromUrl = f.fromParam ? sp.get(f.fromParam) : null;
                if (fromUrl) { out[f.id] = fromUrl; return; }
                // Geen waarde in de URL: val terug op de ingestelde gebruiker.
                if (f.defaultFrom === "currentUser") {
                    const user = NameLists.currentUser();
                    if (user) out[f.id] = user;
                }
            });
            return out;
        }

        /**
         * Versturen is alleen zinvol wanneer er een ontvanger is. Op de
         * databasepagina betekent dat: Delen / Doorsturen op Ja met een
         * gekozen radioloog. In template mode kan die voorwaarde niet gelezen
         * worden, dus blijft de knop daar gewoon beschikbaar.
         */
        function updateSendButton() {
            if (!saveAndSendBtn || !sendWhen) return;
            const blocked = !isTemplateMode() && !sendWhen(collect().values);
            saveAndSendBtn.disabled = blocked;
            saveAndSendBtn.classList.toggle("opacity-40", blocked);
            saveAndSendBtn.classList.toggle("cursor-not-allowed", blocked);
            saveAndSendBtn.title = blocked
                ? "Beschikbaar zodra Delen / Doorsturen op Ja staat en er een radioloog gekozen is"
                : "";
        }

        function applyMode() {
            const tpl = isTemplateMode();
            sections.forEach(({ tiro, native }) => {
                if (tiro) tiro.classList.toggle("hidden", !tpl);
                if (native) native.classList.toggle("hidden", tpl);
            });
            updateSendButton();
            toggleLabel.textContent = tpl ? "Template mode" : "Niet-template mode";
            knob.style.transform = tpl ? "translateX(0)" : "translateX(14px)";
            track.className = "relative w-9 h-5 rounded-full transition-colors flex-shrink-0 " +
                (tpl ? "bg-cyan-600" : "bg-neutral-300 dark:bg-slate-600");
        }

        // ── Toggle, links onderaan ───────────────────────────────────────
        const toggleWrap = el("div", "fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 dark:border-slate-700 bg-white dark:bg-muted shadow-lg cursor-pointer select-none");
        toggleWrap.dataset.nontemplateUi = "1";
        toggleWrap.dataset.nontemplateToggle = "1";
        toggleWrap.title = "Wissel tussen de Tiro-template en het lokale formulier";
        const track = el("div", "");
        const knob = el("div", "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform");
        track.appendChild(knob);
        const toggleLabel = el("span", "text-xs font-medium text-neutral-700 dark:text-neutral-200", "Template mode");
        toggleWrap.append(track, toggleLabel);
        toggleWrap.addEventListener("click", () => {
            localStorage.setItem(modeKey, isTemplateMode() ? "off" : "on");
            applyMode();
        });
        document.body.appendChild(toggleWrap);

        // ── Database-knop, naast Back ───────────────────────────────────
        // Gaat naar db.html, het overzicht van alle bewaarde records. Staat er
        // niet-bewaard werk in het formulier, dan eerst bevestigen.
        const dbBtn = el("button", BTN, "");
        dbBtn.type = "button";
        dbBtn.dataset.nontemplateUi = "1";
        dbBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg><span>Database</span>';
        dbBtn.addEventListener("click", () => {
            if (_dirty && !confirm("Er staat niet-bewaard werk in het formulier. Toch naar het database-overzicht gaan?")) return;
            const sp = new URLSearchParams(location.search);
            sp.set("from", page);
            location.href = "db.html?" + sp.toString();
        });
        if (backBtn && backBtn.parentElement) {
            backBtn.parentElement.classList.add("flex", "gap-2");
            backBtn.insertAdjacentElement("afterend", dbBtn);
        }

        // ── Foto-knop, rechts onderaan ──────────────────────────────────
        const photoBtn = el("button", "fixed bottom-4 right-4 z-40 inline-flex items-center justify-center w-11 h-11 rounded-full border border-neutral-300 dark:border-slate-700 bg-white dark:bg-muted hover:bg-neutral-100 dark:hover:bg-accent text-neutral-700 dark:text-neutral-200 shadow-lg cursor-pointer");
        photoBtn.type = "button";
        photoBtn.dataset.nontemplateUi = "1";
        photoBtn.title = "Printscreen maken — velden invullen uit één of meer beelden";
        photoBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
        photoBtn.addEventListener("click", () => openImageDialog());
        document.body.appendChild(photoBtn);

        // ── Beeld-dialoog: uploaden, plakken of scherm vastleggen ───────
        let dialog = null;
        function openImageDialog() {
            if (!dialog) dialog = buildImageDialog();
            dialog.images.length = 0;
            dialog.strip.innerHTML = "";
            dialog.status.textContent = "";
            dialog.overlay.classList.remove("hidden");
        }

        function buildImageDialog() {
            const overlay = el("div", OVERLAY);
            const panel = el("div", PANEL + " w-full max-w-lg");
            const head = el("div", "flex items-center px-4 py-3 border-b border-neutral-200 dark:border-slate-700");
            head.appendChild(el("h2", "text-sm font-semibold text-neutral-800 dark:text-neutral-100", "Velden invullen uit beeld"));
            const x = el("button", "ml-auto text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-lg leading-none cursor-pointer", "×");
            x.type = "button";
            x.addEventListener("click", () => overlay.classList.add("hidden"));
            head.appendChild(x);

            const body = el("div", "p-4 flex flex-col gap-3");
            const drop = el("div", "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 dark:border-slate-600 bg-neutral-50 dark:bg-background py-6 px-4 cursor-pointer text-center");
            drop.appendChild(el("p", "text-xs text-neutral-500 dark:text-neutral-400", "Klik om te uploaden, sleep beelden hierheen of plak met Ctrl+V"));
            const fileInput = el("input", "hidden");
            fileInput.type = "file";
            fileInput.accept = "image/*";
            fileInput.multiple = true;
            drop.appendChild(fileInput);
            drop.addEventListener("click", () => fileInput.click());

            const strip = el("div", "flex gap-2 flex-wrap");
            const status = el("span", "text-xs text-neutral-500 dark:text-neutral-400");

            const actions = el("div", "flex gap-2 items-center px-4 py-3 border-t border-neutral-200 dark:border-slate-700");
            const capture = el("button", BTN_SMALL, "Scherm vastleggen");
            capture.type = "button";
            const run = el("button", BTN_PRIMARY, "Velden invullen");
            run.type = "button";
            actions.append(capture, status, el("span", "flex-1"), run);

            body.append(drop, strip);
            panel.append(head, body, actions);
            overlay.appendChild(panel);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
            document.body.appendChild(overlay);

            const images = [];
            const addImage = (dataUri) => {
                images.push(dataUri);
                SchemaForm._thumb(strip, dataUri);
                status.textContent = images.length + (images.length === 1 ? " beeld" : " beelden");
            };

            fileInput.addEventListener("change", async () => {
                for (const f of fileInput.files) {
                    const d = await Screenshot.fromFile(f);
                    if (d) addImage(d);
                }
                fileInput.value = "";
            });
            drop.addEventListener("dragover", (e) => { e.preventDefault(); });
            drop.addEventListener("drop", async (e) => {
                e.preventDefault();
                for (const f of e.dataTransfer.files) {
                    const d = await Screenshot.fromFile(f);
                    if (d) addImage(d);
                }
            });
            document.addEventListener("paste", async (e) => {
                if (overlay.classList.contains("hidden")) return;
                for (const d of await Screenshot.fromClipboard(e)) addImage(d);
            });
            capture.addEventListener("click", async () => {
                try { addImage(await Screenshot.captureScreen()); }
                catch (err) { status.textContent = err.message; }
            });
            run.addEventListener("click", async () => {
                if (!images.length) { status.textContent = "Voeg eerst een beeld toe."; return; }
                run.disabled = true;
                const original = run.textContent;
                run.textContent = "Bezig…";
                status.textContent = "";
                try {
                    const n = await fillFromImages(images);
                    overlay.classList.add("hidden");
                    flash(n + (n === 1 ? " veld ingevuld" : " velden ingevuld"));
                } catch (err) {
                    status.textContent = err.message;
                } finally {
                    run.disabled = false;
                    run.textContent = original;
                }
            });

            return { overlay, strip, status, images };
        }

        /** Eén AI-aanroep over alle secties samen, daarna invullen in de actieve modus. */
        async function fillFromImages(images) {
            const merged = { id: "merged", fields: sections.flatMap((s) => s.schema.fields || []) };
            const values = await AiImageFill.run(images, merged);
            let filled = 0;
            for (const { native, tiro, schema } of sections) {
                const mine = {};
                (schema.fields || []).forEach((f) => { if (f.id in values) mine[f.id] = values[f.id]; });
                if (!Object.keys(mine).length) continue;
                if (isTemplateMode()) {
                    const formEl = tiro && tiro.querySelector("tiro-form-filler");
                    if (formEl) filled += await TiroFill.fillValues(formEl, schema, mine);
                } else if (native) {
                    SchemaForm.fill(native, schema, mine);
                    filled += Object.keys(mine).length;
                }
            }
            return filled;
        }

        // ── Printscreen in het formulier ─────────────────────────────────
        // Puur een illustratieve opname van de pathologie of de fout, die als
        // bijlage bij de casus hoort. Deze vult géén velden in — dat doet
        // alleen de knop rechts onderaan.
        sections.forEach(({ native }) => {
            if (!native) return;
            native.addEventListener("printscreen-request", async (e) => {
                const { fieldId, button } = e.detail;
                const label = button.textContent;
                button.disabled = true;
                button.textContent = "Bezig…";
                try {
                    const shot = await Screenshot.captureScreen();
                    SchemaForm.addScreenshot(native, fieldId, shot);
                    flash("Schermafdruk toegevoegd");
                } catch (err) {
                    flash(err.message, true);
                } finally {
                    button.disabled = false;
                    button.textContent = label;
                }
            });
        });

        // ── Bewaren in niet-template mode ───────────────────────────────
        function collect() {
            const values = {};
            sections.forEach(({ native, schema }) => {
                if (!native) return;
                Object.assign(values, SchemaForm.read(native, schema));
            });
            const screenshots = sections.flatMap(({ native }) => (native ? SchemaForm.allScreenshots(native) : []));
            return { values, screenshots };
        }

        async function saveRecord({ send = false } = {}) {
            const { values, screenshots } = collect();
            if (!Object.keys(values).length) { flash("Niets in te vullen gevonden.", true); return; }
            const record = await RecordStore.save(page, {
                id: currentRecordId || undefined,
                form: page,
                values,
                screenshots,
                sent: false,
            });
            currentRecordId = record.id;
            _dirty = false;
            if (!send) { flash("Bewaard in de lokale database"); updateSendButton(); return; }
            if (shouldSend && !shouldSend()) {
                flash("Bewaard, geen mail verstuurd");
                updateSendButton();
                return;
            }
            try {
                const qr = SchemaForm.toQuestionnaireResponse(primarySchema, values);
                // recipientFrom mag één naam of een lijst teruggeven.
                const namen = [].concat(recipientFrom ? recipientFrom(values) || [] : []).filter(Boolean);
                const zonderAdres = namen.filter((n) => !NameLists.emailFor(n));
                if (zonderAdres.length) {
                    throw new Error("Geen e-mailadres bekend voor " + zonderAdres.join(", ") +
                        ". Vul dat in bij Namenlijsten op de flow-pagina.");
                }
                const recipient = namen.map((n) => NameLists.emailFor(n)).join(", ");
                const naam = namen.join(", ");
                if (onSend) await onSend(qr, { recipient, naam, namen, values });
                record.sent = true;
                await RecordStore.save(page, record);
                flash(recipient ? "Bewaard en verzonden naar " + naam : "Bewaard en verzonden");
            } catch (err) {
                flash("Bewaard, maar versturen mislukte: " + err.message, true);
            }
        }

        // Onderschep de bestaande knoppen alleen in niet-template mode, in de
        // capture-fase. De eigen handlers van de pagina blijven zo onaangeroerd.
        const intercept = (btn, opts) => {
            if (!btn) return;
            btn.addEventListener("click", (e) => {
                if (isTemplateMode()) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                saveRecord(opts);
            }, true);
        };
        intercept(saveBtn, { send: false });
        intercept(saveAndSendBtn, { send: true });

        // ── Korte statusmelding ─────────────────────────────────────────
        let flashEl = null;
        function flash(message, isError) {
            if (!flashEl) {
                flashEl = el("div", "fixed bottom-20 right-4 z-50 px-3 py-2 rounded-md text-xs shadow-lg transition-opacity");
                flashEl.dataset.nontemplateUi = "1";
                document.body.appendChild(flashEl);
            }
            flashEl.className = "fixed bottom-20 right-4 z-50 px-3 py-2 rounded-md text-xs shadow-lg transition-opacity " +
                (isError ? "bg-red-600 text-white" : "bg-neutral-800 dark:bg-slate-700 text-white");
            flashEl.textContent = message;
            flashEl.style.opacity = "1";
            clearTimeout(flash._t);
            flash._t = setTimeout(() => { flashEl.style.opacity = "0"; }, 2600);
        }

        /**
         * Komt de gebruiker van db.html met "Wijzigen", dan staat het record-id
         * in de URL. Dat record inladen, naar niet-template mode gaan en het id
         * uit de adresbalk halen zodat vernieuwen geen tweede keer inlaadt.
         */
        async function loadRecordFromUrl() {
            const id = params.get("recordId");
            if (!id) return;
            const record = await RecordStore.get(page, id).catch(() => null);
            const sp = new URLSearchParams(location.search);
            sp.delete("recordId");
            history.replaceState(null, "", location.pathname + (sp.toString() ? "?" + sp : ""));
            if (!record) { flash("Dat record is niet gevonden.", true); return; }
            if (isTemplateMode()) {
                localStorage.setItem(modeKey, "off");
                applyMode();
            }
            currentRecordId = record.id;
            sections.forEach(({ native, schema }) => {
                if (native) SchemaForm.fill(native, schema, record.values || {});
            });
            _dirty = false;
            updateSendButton();
            flash("Record ingeladen");
        }

        renderNative();
        applyMode();
        loadRecordFromUrl();

        return { applyMode, renderNative, saveRecord, isTemplateMode, fillFromImages, flash, loadRecordFromUrl };
    }

    global.JyzForms = {
        RecordStore,
        SchemaForm,
        TiroFill,
        Screenshot,
        AiImageFill,
        NameLists,
        SnomedOptions,
        mountFormsUI,
        resolveOptions,
        DEFAULT_FORM_FILL_PROMPT,
        styles: { BTN, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL, PANEL, OVERLAY },
        el,
    };
})(window);
