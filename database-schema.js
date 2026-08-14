/*
 * database-schema.js — velddefinities voor de niet-template mode van database.html
 *
 * Overgenomen uit de Tiro-templates "Study and patient information" en
 * "Database Radiologie". Labels, optieteksten en volgorde staan hier exact
 * zoals ze in de Tiro-formulieren verschijnen.
 *
 * De twee casustypes zijn aparte groepen in het Tiro-formulier en hebben
 * daarom ook hier elk hun eigen velden, ook waar het label hetzelfde is.
 *
 * Pathologie is dynamisch: de opties komen uit de SNOMED CT-analyse op de
 * hoofdpagina (hoofddiagnose en bijdiagnose). Staat er niets, of ontbreekt
 * een bevinding, dan voeg je die toe via "Andere toevoegen".
 */
(function (global) {
    "use strict";

    const CASUS_TYPE = ["Interessante casus", "Op te volgen casus"];

    /** Dossier gegevens — identiek aan de QC-pagina, zelfde Tiro-template. */
    const STUDY_SCHEMA = {
        id: "study",
        title: "Study and patient information",
        store: "database",
        questionnaire: "http://templates.tiro.health/templates/dd231d6f2ccf4685afa5347afdab9f72|2.0.0",
        fields: [
            { id: "dossier", label: "Dossier gegevens", type: "section" },
            { id: "pacsnummer",           label: "PACSNUMMER",           type: "text", fromParam: "accessionNumber",    hint: "DICOM 0008,0050" },
            { id: "onderzoek_datum",      label: "ONDERZOEK DATUM",      type: "text", fromParam: "studyDate",          hint: "DICOM 0008,0021 – 0008,0030" },
            { id: "aanvrager",            label: "AANVRAGER",            type: "text", fromParam: "referringPhysician", hint: "DICOM 0008,0090" },
            { id: "onderzoek_modaliteit", label: "ONDERZOEK MODALITEIT", type: "text", fromParam: "modality",           hint: "DICOM 0008,0060" },
            { id: "onderzoek_type",       label: "ONDERZOEK TYPE",       type: "text", fromParam: "type_onderzoek",     hint: "DICOM 0008,1030" },
            { id: "snelkoppeling",        label: "Snelkoppeling",        type: "text" },
            // Standaard de gebruiker die in Namenlijsten is aangeduid als
            // "gebruiker van dit profiel"; een radioloog uit de URL gaat voor.
            { id: "radioloog_dossier",    label: "Radioloog",            type: "text", fromParam: "radioloog", defaultFrom: "currentUser", placeholder: "User" },
        ],
    };

    const DATABASE_SCHEMA = {
        id: "database",
        title: "Database Radiologie",
        store: "database",
        questionnaire: "http://templates.tiro.health/templates/69bd126892b44111bc3d7ec5fb712b00|1.0.1",
        fields: [
            { id: "casus_type", label: "Casus type", type: "radio", options: CASUS_TYPE, required: true },

            // ── Interessante casus ───────────────────────────────────────
            { id: "sec_interessant", label: "Interessante casus", type: "section", showWhen: { field: "casus_type", equals: "Interessante casus" } },
            {
                id: "int_pathologie", label: "Pathologie", type: "dynamicCheckboxes",
                optionsFrom: "snomed", addLabel: "Andere toevoegen", required: true,
                showWhen: { field: "casus_type", equals: "Interessante casus" },
            },
            {
                id: "int_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "casus_type", equals: "Interessante casus" },
            },
            {
                id: "int_printscreen", label: "Printscreen", type: "printscreen", buttonLabel: "Printscreen maken",
                showWhen: { field: "casus_type", equals: "Interessante casus" },
            },
            {
                id: "int_delen", label: "Delen / Doorsturen", type: "boolean", options: ["Ja", "Nee"],
                showWhen: { field: "casus_type", equals: "Interessante casus" },
            },
            {
                id: "int_radioloog", label: "Radioloog", type: "select",
                optionsFrom: "radiologen", placeholder: "Selecteren",
                showWhen: [{ field: "casus_type", equals: "Interessante casus" }, { field: "int_delen", equals: "Ja" }],
            },

            // ── Op te volgen casus ───────────────────────────────────────
            { id: "sec_opvolgen", label: "Op te volgen casus", type: "section", showWhen: { field: "casus_type", equals: "Op te volgen casus" } },
            {
                id: "opv_pathologie", label: "Pathologie", type: "dynamicCheckboxes",
                optionsFrom: "snomed", addLabel: "Andere toevoegen", required: true,
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_opmerkingen", label: "Extra opmerkingen", type: "textarea", rows: 3,
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_printscreen", label: "Printscreen", type: "printscreen", buttonLabel: "Printscreen maken",
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_reminder", label: "Reminder sturen ?", type: "boolean", options: ["Ja", "Nee"],
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_reminder_datum", label: "Datum", type: "date",
                showWhen: [{ field: "casus_type", equals: "Op te volgen casus" }, { field: "opv_reminder", equals: "Ja" }],
            },
            {
                id: "opv_ook_interessant", label: 'Ook toevoegen aan "interessante casus"?', type: "boolean", options: ["Ja", "Nee"],
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_delen", label: "Delen / Doorsturen", type: "boolean", options: ["Ja", "Nee"],
                showWhen: { field: "casus_type", equals: "Op te volgen casus" },
            },
            {
                id: "opv_radioloog", label: "Radioloog", type: "select",
                optionsFrom: "radiologen", placeholder: "Selecteren",
                showWhen: [{ field: "casus_type", equals: "Op te volgen casus" }, { field: "opv_delen", equals: "Ja" }],
            },
        ],
    };

    global.DATABASE_SCHEMAS = { STUDY_SCHEMA, DATABASE_SCHEMA };
})(window);
