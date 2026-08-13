/*
 * qc-schema.js — velddefinities voor de niet-template mode van qc.html
 *
 * Overgenomen uit de Tiro-templates "Study and patient information" en
 * "Kwaliteitscontrole". Labels, optieteksten en volgorde staan hier exact
 * zoals ze in de Tiro-formulieren verschijnen — ook het verschil tussen
 * "ja"/"nee" (kleine letter, kwaliteitscontrole) en "Ja"/"Nee" elders.
 *
 * Wijzig hier de velden, niet de renderer in forms-shared.js.
 */
(function (global) {
    "use strict";

    const REDEN = ["Aanvraag", "Medisch - aanvrager", "Feedback radioloog", "Tweede lezing"];

    /** Dossier gegevens — in template mode gevuld uit DICOM-tags. */
    const STUDY_SCHEMA = {
        id: "study",
        title: "Study and patient information",
        store: "qc",
        questionnaire: "http://templates.tiro.health/templates/dd231d6f2ccf4685afa5347afdab9f72|2.0.0",
        fields: [
            { id: "dossier", label: "Dossier gegevens", type: "section" },
            { id: "naam_voornaam",       label: "NAAM VOORNAAM",       type: "text", fromParam: "patientName",      hint: "DICOM 0010,0010" },
            { id: "pacsnummer",          label: "PACSNUMMER",          type: "text", fromParam: "accessionNumber",  hint: "DICOM 0008,0050" },
            { id: "onderzoek_datum",     label: "ONDERZOEK DATUM",     type: "text", fromParam: "studyDate",        hint: "DICOM 0008,0021 – 0008,0030" },
            { id: "aanvrager",           label: "AANVRAGER",           type: "text", fromParam: "referringPhysician", hint: "DICOM 0008,0090" },
            { id: "onderzoek_modaliteit", label: "ONDERZOEK MODALITEIT", type: "text", fromParam: "modality",        hint: "DICOM 0008,0060" },
            { id: "onderzoek_type",      label: "ONDERZOEK TYPE",      type: "text", fromParam: "type_onderzoek",   hint: "DICOM 0008,1030" },
            { id: "snelkoppeling",       label: "Snelkoppeling",       type: "text" },
            { id: "radioloog_dossier",   label: "Radioloog",           type: "text", fromParam: "radioloog", placeholder: "User" },
        ],
    };

    /** Kwaliteitscontrole — één reden, met per reden een eigen groep velden. */
    const QC_SCHEMA = {
        id: "qc",
        title: "Kwaliteitscontrole",
        store: "qc",
        questionnaire: "http://templates.tiro.health/templates/c44199b363f649b689b80468d582d838|2.0.0",
        fields: [
            { id: "reden", label: "Reden", type: "radio", options: REDEN },

            // ── Reden: Aanvraag ──────────────────────────────────────────
            { id: "sec_aanvraag", label: "Aanvraag", type: "section", showWhen: { field: "reden", equals: "Aanvraag" } },
            {
                id: "aanvraag_soort", label: "Aanvraag", type: "radio",
                options: ["Slechte aanvraag", "Links-Rechts fout", "Verkeerde aanvraag"],
                showWhen: { field: "reden", equals: "Aanvraag" },
            },
            {
                id: "aanvraag_juiste_aanvrager", label: "Juiste aanvrager?", type: "boolean",
                options: ["ja", "nee"],
                showWhen: { field: "reden", equals: "Aanvraag" },
            },
            {
                id: "aanvraag_naam_aanvrager", label: "naam aanvrager", type: "select",
                optionsFrom: "aanvragers", placeholder: "Selecteren…",
                showWhen: [{ field: "reden", equals: "Aanvraag" }, { field: "aanvraag_juiste_aanvrager", equals: "nee" }],
            },
            {
                id: "aanvraag_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "reden", equals: "Aanvraag" },
            },
            {
                id: "aanvraag_document", label: "Document", type: "printscreen", buttonLabel: "Printscreen nemen",
                showWhen: { field: "reden", equals: "Aanvraag" },
            },

            // ── Reden: Medisch - aanvrager ───────────────────────────────
            { id: "sec_medisch", label: "Medisch - aanvrager", type: "section", showWhen: { field: "reden", equals: "Medisch - aanvrager" } },
            {
                id: "medisch_juiste_aanvrager", label: "Juiste aanvrager?", type: "boolean",
                options: ["ja", "nee"],
                showWhen: { field: "reden", equals: "Medisch - aanvrager" },
            },
            {
                id: "medisch_naam_aanvrager", label: "Naam aanvrager", type: "select",
                optionsFrom: "aanvragers", placeholder: "Selecteren…",
                showWhen: [{ field: "reden", equals: "Medisch - aanvrager" }, { field: "medisch_juiste_aanvrager", equals: "nee" }],
            },
            {
                id: "medisch_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "reden", equals: "Medisch - aanvrager" },
            },
            {
                id: "medisch_document", label: "Document", type: "printscreen", buttonLabel: "Printscreen nemen",
                showWhen: { field: "reden", equals: "Medisch - aanvrager" },
            },

            // ── Reden: Feedback radioloog ────────────────────────────────
            { id: "sec_feedback", label: "Feedback Radioloog", type: "section", showWhen: { field: "reden", equals: "Feedback radioloog" } },
            {
                id: "feedback_radioloog", label: "Radioloog", type: "select",
                optionsFrom: "radiologen", placeholder: "Selecteren…",
                showWhen: { field: "reden", equals: "Feedback radioloog" },
            },
            {
                id: "feedback_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "reden", equals: "Feedback radioloog" },
            },
            {
                id: "feedback_document", label: "Document", type: "printscreen", buttonLabel: "Printscreen nemen",
                showWhen: { field: "reden", equals: "Feedback radioloog" },
            },

            // ── Reden: Tweede lezing ─────────────────────────────────────
            { id: "sec_tweede", label: "Tweede lezing Radioloog", type: "section", showWhen: { field: "reden", equals: "Tweede lezing" } },
            {
                id: "tweede_naam_radioloog", label: "naam radioloog", type: "select",
                optionsFrom: "radiologen", placeholder: "Selecteren…",
                showWhen: { field: "reden", equals: "Tweede lezing" },
            },
            {
                id: "tweede_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "reden", equals: "Tweede lezing" },
            },
            {
                id: "tweede_document", label: "Document", type: "printscreen", buttonLabel: "Printscreen nemen",
                showWhen: { field: "reden", equals: "Tweede lezing" },
            },
        ],
    };

    global.QC_SCHEMAS = { STUDY_SCHEMA, QC_SCHEMA };
})(window);
