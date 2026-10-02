#!/usr/bin/env node
/* ============================================================================
 * scripts/extraheer-defaults.mjs
 * ----------------------------------------------------------------------------
 * Haalt de standaardinhoud uit de pagina's en zet ze in één JSON:
 *
 *   examTypes        de verslagtemplates (DEFAULT_EXAM_TYPES uit flow.html)
 *   dicomCodesBase   de JYZ DICOM-codes (JYZ_DICOM_CODES uit flow.html)
 *   prompts          de AI-prompts (DEFAULT_*_PROMPT uit launch.html)
 *
 * De blokken worden geëvalueerd in plaats van met een reguliere expressie
 * uitgelezen: het zijn template-literals met aanhalingstekens en regeleindes
 * erin, en die moeten letterlijk overeind blijven.
 *
 * Gebruik:  node scripts/extraheer-defaults.mjs > flow-defaults.json
 * ==========================================================================*/
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const wortel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lees = (naam) => readFileSync(join(wortel, naam), "utf8");

/** Het letterlijke blok tussen de haakjes na `naam = `, op haakjesniveau. */
function blok(bron, naam, open = "[", sluit = "]") {
    const start = bron.indexOf(naam);
    if (start < 0) throw new Error(`niet gevonden: ${naam}`);
    let i = bron.indexOf(open, start);
    let diep = 0, j = i;
    for (; j < bron.length; j++) {
        if (bron[j] === open) diep++;
        else if (bron[j] === sluit) { diep--; if (diep === 0) break; }
    }
    return bron.slice(i, j + 1);
}

const flow = lees("flow.html");
const launch = lees("launch.html");
const formsShared = lees("forms-shared.js");

const examTypes = eval(blok(flow, "const DEFAULT_EXAM_TYPES = "));
const dicomCodesBase = eval(blok(flow, "const JYZ_DICOM_CODES = "));

// De prompts staan als `const DEFAULT_X = \`...\`;` in launch.html, op één na:
// het invulprompt voor de formulieren woont in forms-shared.js. Per prompt de
// opslagsleutel waaronder de pagina's hem verwachten.
const PROMPTS = [
    ["DEFAULT_TRANSLATE_PROMPT",     "dictationActionUrl",  "dictationActionVersion", "launch"],
    ["DEFAULT_KIDV_PROMPT",          "kidvActionUrl",       null,                     "launch"],
    ["DEFAULT_AI_CONSULT_PROMPT",    "aiConsultUrl",        "aiConsultPromptVersion", "launch"],
    ["DEFAULT_VERSLAG_CHECK_PROMPT", "verslagCheckUrl",     "verslagCheckVersion",    "launch"],
    ["DEFAULT_INLINE_CHECK_PROMPT",  "inlineCheckUrl",      "inlineCheckVersion",     "launch"],
    ["DEFAULT_SNOMED_CT_PROMPT",     "snomedCtActionUrl",   "snomedCtPromptVersion",  "launch"],
    ["DEFAULT_AUTOFILL_BACKUP_PROMPT", "autofillBackupUrl", "autofillBackupVersion",  "launch"],
    ["DEFAULT_MEDGEMMA_PROMPT",      "medgemmaActionUrl",   "medgemmaPromptVersion",  "launch"],
    ["DEFAULT_FORM_FILL_PROMPT",     "formFillActionUrl",   "formFillPromptVersion",  "forms"],
];

/** De template-literal die aan `const <naam> = ` hangt, tot de afsluitende `;`. */
function literal(bron, naam) {
    const re = new RegExp(`const\\s+${naam}\\s*=\\s*`);
    const m = re.exec(bron);
    if (!m) return null;
    let i = m.index + m[0].length;
    if (bron[i] !== "`") return null;
    let j = i + 1;
    while (j < bron.length) {
        if (bron[j] === "\\") { j += 2; continue; }
        if (bron[j] === "`") break;
        j++;
    }
    return eval(bron.slice(i, j + 1));
}

const prompts = {};
const ontbreekt = [];
for (const [naam, sleutel, , bestand] of PROMPTS) {
    const tekst = literal(bestand === "forms" ? formsShared : launch, naam);
    if (tekst == null) { ontbreekt.push(naam); continue; }
    prompts[sleutel] = tekst;
}
if (ontbreekt.length) {
    console.error("WAARSCHUWING, niet gevonden: " + ontbreekt.join(", "));
}

// De pagina's verwerpen een bewaarde prompt waarvan het versienummer niet
// klopt, en vallen dan terug op de (nu lege) standaard. De versies moeten dus
// mee, met exact de opslagsleutels die launch.html gebruikt.
const VERSIES = [
    ["dictationActionVersion", "TRANSLATE_PROMPT_VERSION"],
    ["kidvActionVersion",      "KIDV_PROMPT_VERSION"],
    ["aiConsultVersion",       "AI_CONSULT_PROMPT_VERSION"],
    ["verslagCheckVersion",    "VERSLAG_CHECK_VERSION"],
    ["inlineCheckVersion",     "INLINE_CHECK_VERSION"],
    ["snomedCtPromptVersion",  "SNOMED_CT_PROMPT_VERSION"],
    ["medgemmaPromptVersion",  "MEDGEMMA_PROMPT_VERSION"],
];
// Deze twee hebben geen constante in launch.html; prompts.html verwacht "1".
const VASTE_VERSIES = { autofillBackupVersion: "1", formFillPromptVersion: "1" };
const versies = { ...VASTE_VERSIES };
for (const [sleutel, naam] of VERSIES) {
    const m = new RegExp(`const\\s+${naam}\\s*=\\s*"([^"]*)"`).exec(launch);
    if (!m) { console.error(`WAARSCHUWING: versie niet gevonden voor ${naam}`); continue; }
    versies[sleutel] = m[1];
}

const uit = {
    kind: "flow-defaults",
    version: "1.0",
    gegenereerd: new Date().toISOString(),
    examTypes,
    dicomCodesBase,
    prompts,
    promptVersions: versies,
};

console.error(
    `examTypes: ${examTypes.length} · dicomCodesBase: ${dicomCodesBase.length} · ` +
    `prompts: ${Object.keys(prompts).length} · versies: ${Object.keys(versies).length}`
);
process.stdout.write(JSON.stringify(uit, null, 2));
