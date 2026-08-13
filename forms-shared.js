/*
 * forms-shared.js — gedeelde laag voor qc.html en database.html
 *
 * Bevat alles wat niet afhangt van de concrete veldenlijst:
 *   RecordStore   — IndexedDB opslag van ingevulde formulieren + schermafdrukken
 *   SchemaForm    — declaratieve renderer (velden + conditionele logica)
 *   TiroFill      — schrijven in de shadow DOM van tiro-form-filler (zelfde techniek als SNOMED CT in launch.html)
 *   Screenshot    — schermafdruk vastleggen (getDisplayMedia, plakken of uploaden)
 *   Overview      — doorzoekbaar overzicht van opgeslagen records
 *   AiImageFill   — velden invullen op basis van geuploade beelden via Gemini
 *   mountFormsUI  — plaatst toggle, foto-knop, database-knop en koppelt save-acties
 *
 * De concrete velden staan in qc-schema.js en database-schema.js.
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

        save(store, record) {
            if (!record.id) record.id = this.newId();
            if (!record.createdAt) record.createdAt = new Date().toISOString();
            record.updatedAt = new Date().toISOString();
            return this._tx(store, "readwrite", (os) => os.put(record)).then(() => record);
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

        /** Records terugzetten uit een geïmporteerd JSON-bestand. */
        async importAll(data, { replace = false } = {}) {
            if (!data || typeof data !== "object") return 0;
            let n = 0;
            for (const s of this.STORES) {
                if (!Array.isArray(data[s])) continue;
                if (replace) await this._tx(s, "readwrite", (os) => os.clear());
                for (const rec of data[s]) {
                    if (rec && rec.id) { await this.save(s, rec); n++; }
                }
            }
            return n;
        },
    };

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
                    (f.options || []).forEach((o) => {
                        const opt = el("option", "", typeof o === "string" ? o : o.label);
                        opt.value = typeof o === "string" ? o : o.value;
                        input.appendChild(opt);
                    });
                    if (value != null) input.value = value;
                    break;
                }

                case "radio":
                case "boolean": {
                    const opts = f.type === "boolean" ? (f.options || ["Ja", "Nee"]) : (f.options || []);
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

                case "checkboxes": {
                    input = el("div", "flex flex-col gap-1.5");
                    const sel = Array.isArray(value) ? value.map(String) : [];
                    (f.options || []).forEach((o) => {
                        const v = typeof o === "string" ? o : o.value;
                        const text = typeof o === "string" ? o : o.label;
                        const line = el("label", "flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200 cursor-pointer");
                        const cb = el("input");
                        cb.type = "checkbox";
                        cb.value = v;
                        cb.className = "rounded border-neutral-300 dark:border-slate-700 text-cyan-600 focus:ring-cyan-500";
                        if (sel.includes(String(v))) cb.checked = true;
                        line.append(cb, el("span", "", text));
                        input.appendChild(line);
                    });
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
                } else if (f.type === "checkboxes") {
                    const vals = Array.from(row.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
                    if (vals.length) out[f.id] = vals;
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
                    row.querySelectorAll("button").forEach((b) => {
                        const want = String(b.dataset.value) === String(v);
                        const isOn = b.dataset.selected === "1";
                        if (want !== isOn) b.click();
                    });
                } else if (f.type === "checkboxes") {
                    const want = (Array.isArray(v) ? v : [v]).map(String);
                    row.querySelectorAll("input[type=checkbox]").forEach((c) => { c.checked = want.includes(c.value); });
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
                if (f.type === "section" || !(f.id in values)) return;
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
                .filter((f) => f.type !== "section")
                .map((f) => {
                    const parts = ["- " + f.id + " (" + f.label + ")", "type: " + f.type];
                    if (f.options && f.options.length) {
                        const opts = f.options.map((o) => (typeof o === "string" ? o : o.label));
                        parts.push("toegestane opties: " + opts.join(" | "));
                    }
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
    // Overview — doorzoekbaar overzicht van opgeslagen records
    // ═══════════════════════════════════════════════════════════════════════
    const Overview = {
        _modal: null,

        _build() {
            if (this._modal) return this._modal;
            const overlay = el("div", OVERLAY);
            overlay.id = "records-overview-modal";

            const panel = el("div", PANEL + " w-full max-w-3xl max-h-[85vh]");
            const head = el("div", "flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-slate-700");
            head.appendChild(el("h2", "text-sm font-semibold text-neutral-800 dark:text-neutral-100", "Database"));
            const count = el("span", "text-xs text-neutral-400 dark:text-neutral-500");
            count.id = "records-count";
            head.appendChild(count);
            const close = el("button", "ml-auto text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-lg leading-none cursor-pointer", "×");
            close.type = "button";
            close.addEventListener("click", () => this.close());
            head.appendChild(close);

            const searchWrap = el("div", "px-4 py-2 border-b border-neutral-200 dark:border-slate-700");
            const search = el("input", INPUT);
            search.type = "search";
            search.placeholder = "Zoek in alle velden…";
            search.id = "records-search";
            searchWrap.appendChild(search);

            const list = el("div", "overflow-y-auto p-3 flex flex-col gap-2");
            list.id = "records-list";

            panel.append(head, searchWrap, list);
            overlay.appendChild(panel);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) this.close(); });
            document.body.appendChild(overlay);
            this._modal = overlay;
            return overlay;
        },

        close() {
            if (this._modal) this._modal.classList.add("hidden");
        },

        async open(ctx) {
            const overlay = this._build();
            overlay.classList.remove("hidden");
            const list = overlay.querySelector("#records-list");
            const search = overlay.querySelector("#records-search");
            const count = overlay.querySelector("#records-count");

            const records = (await RecordStore.all(ctx.store)).sort(
                (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
            );
            count.textContent = records.length + (records.length === 1 ? " record" : " records");

            const draw = (query) => {
                const q = (query || "").trim().toLowerCase();
                list.innerHTML = "";
                const shown = records.filter((r) => !q || JSON.stringify(r.values || {}).toLowerCase().includes(q));
                if (!shown.length) {
                    list.appendChild(el("p", "text-sm text-neutral-400 dark:text-neutral-500 py-6 text-center",
                        records.length ? "Geen records gevonden voor deze zoekterm." : "Nog geen opgeslagen formulieren."));
                    return;
                }
                shown.forEach((r) => list.appendChild(this._card(r, ctx)));
            };

            search.value = "";
            search.oninput = () => draw(search.value);
            draw("");
            setTimeout(() => search.focus(), 50);
        },

        _card(record, ctx) {
            const card = el("div", "border border-neutral-200 dark:border-slate-700 rounded-lg overflow-hidden");
            const head = el("div", "flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-background");

            const when = new Date(record.updatedAt || record.createdAt || Date.now());
            const title = (ctx.schema.fields || [])
                .filter((f) => f.type !== "section" && record.values && record.values[f.id])
                .slice(0, 2)
                .map((f) => String(record.values[f.id]).slice(0, 40))
                .join(" · ") || "(leeg formulier)";

            head.appendChild(el("span", "text-xs font-medium text-neutral-700 dark:text-neutral-200 truncate", title));
            head.appendChild(el("span", "text-xs text-neutral-400 dark:text-neutral-500 ml-auto whitespace-nowrap",
                when.toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })));
            if (record.sent) {
                head.appendChild(el("span", "text-xs px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400", "verzonden"));
            }

            const body = el("div", "px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300 flex flex-col gap-1");
            (ctx.schema.fields || []).forEach((f) => {
                if (f.type === "section") return;
                const v = record.values && record.values[f.id];
                if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
                const line = el("div", "flex gap-2");
                line.appendChild(el("span", "text-neutral-400 dark:text-neutral-500 flex-shrink-0", f.label + ":"));
                line.appendChild(el("span", "", Array.isArray(v) ? v.join(", ") : String(v)));
                body.appendChild(line);
            });

            if (record.screenshots && record.screenshots.length) {
                const shots = el("div", "flex gap-2 flex-wrap pt-1");
                record.screenshots.forEach((src) => {
                    const img = el("img", "h-16 rounded border border-neutral-200 dark:border-slate-700 cursor-pointer");
                    img.src = src;
                    img.addEventListener("click", () => window.open(src, "_blank"));
                    shots.appendChild(img);
                });
                body.appendChild(shots);
            }

            const actions = el("div", "flex gap-2 px-3 py-2 bg-neutral-50 dark:bg-background border-t border-neutral-200 dark:border-slate-700");
            const load = el("button", BTN_SMALL, "Openen");
            load.type = "button";
            load.addEventListener("click", () => {
                ctx.onLoad(record);
                Overview.close();
            });
            const del = el("button", BTN_SMALL + " !text-red-600 dark:!text-red-400", "Verwijderen");
            del.type = "button";
            del.addEventListener("click", async () => {
                if (!confirm("Dit record definitief verwijderen?")) return;
                await RecordStore.remove(ctx.store, record.id);
                card.remove();
            });
            actions.append(load, del);

            card.append(head, body, actions);
            return card;
        },
    };

    global.JyzForms = {
        RecordStore,
        SchemaForm,
        TiroFill,
        Screenshot,
        AiImageFill,
        Overview,
        DEFAULT_FORM_FILL_PROMPT,
        styles: { BTN, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL, PANEL, OVERLAY },
        el,
    };
})(window);
