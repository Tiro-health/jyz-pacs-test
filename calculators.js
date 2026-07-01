/* ============================================================================
 * calculators.js — Radiologie-calculatoren catalogus
 * ----------------------------------------------------------------------------
 * Single source of truth voor radiology.tiro.health.
 * Geladen door flow.html (koppeling per examentype) en launch.html (gebruik).
 *
 * Pure data + logica — GEEN DOM-afhankelijkheden. De render-engine en het
 * resultaatvenster leven in launch.html.
 *
 * Elke calculator:
 *   {
 *     id            : uniek, stabiel (gebruikt in flowConfig)
 *     naam          : weergavenaam
 *     categorie     : groepering
 *     modaliteit    : ['CT','MR','ECHO',...]  (voor filtering/auto-koppeling)
 *     bron          : richtlijn/publicatie
 *     beschrijving  : korte uitleg
 *     triggerKeywords: [] termen waarop de tekstscan deze calc voorstelt
 *     inputs        : [ {id,label,type,eenheid?,opties?,min?,max?,step?,default?,help?} ]
 *                     type ∈ 'number' | 'select' | 'radio' | 'checkbox'
 *     compute(v)    : v = {inputId: waarde}; returnt resultaatobject (zie hieronder)
 *   }
 *
 * compute() resultaatobject:
 *   {
 *     ok      : boolean        // false bij ontbrekende/ongeldige invoer
 *     fout    : string         // melding indien !ok
 *     titel   : string         // kop
 *     klasse  : string|null    // headline classificatie (bv. "Categorie 4A")
 *     items   : [{label,waarde}] // tussenresultaten voor weergave
 *     advies  : string|null    // management/aanbeveling
 *     tekst   : string         // kant-en-klare verslagsnippet (kopieer/naar dictaat)
 *   }
 * ========================================================================== */
(function () {
  "use strict";

  // ---- kleine helpers ------------------------------------------------------
  const num = (x) => {
    if (x === "" || x === null || x === undefined) return NaN;
    return typeof x === "number" ? x : parseFloat(String(x).replace(",", "."));
  };
  const r0 = (x) => Math.round(x);
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  const fout = (msg) => ({ ok: false, fout: msg, titel: "", klasse: null, items: [], advies: null, tekst: "" });

  // ellipsoïde-volume in mL; lengtes in cm; coëfficiënt standaard 0.52 (π/6)
  const ellipsoid = (a, b, c, k = 0.52) => k * a * b * c;

  const CALCULATORS = [];

  /* ==========================================================================
   * BODY — ENDOCRIEN
   * ======================================================================== */

  CALCULATORS.push({
    id: "thyroid-volume",
    naam: "Schildkliervolume",
    categorie: "Body — endocrien",
    modaliteit: ["ECHO", "CT", "MR"],
    bron: "Ellipsoïde-methode (Brunn)",
    beschrijving: "Volume per kwab via ellipsoïde-formule (0,52 × L × B × D), som van beide kwabben.",
    triggerKeywords: ["schildklier", "thyroid", "struma", "thyreoïd", "goiter"],
    inputs: [
      { id: "rL", label: "Rechts — lengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "rB", label: "Rechts — breedte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "rD", label: "Rechts — diepte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "lL", label: "Links — lengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "lB", label: "Links — breedte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "lD", label: "Links — diepte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "geslacht", label: "Geslacht (voor referentie)", type: "select", default: "v",
        opties: [{ v: "v", l: "Vrouw (norm ≤18 mL)" }, { v: "m", l: "Man (norm ≤25 mL)" }] },
    ],
    compute(v) {
      const r = ellipsoid(num(v.rL), num(v.rB), num(v.rD));
      const l = ellipsoid(num(v.lL), num(v.lB), num(v.lD));
      if (isNaN(r) && isNaN(l)) return fout("Geef minstens de afmetingen van één kwab in.");
      const rV = isNaN(r) ? 0 : r, lV = isNaN(l) ? 0 : l;
      const tot = rV + lV;
      const grens = v.geslacht === "m" ? 25 : 18;
      const vergroot = tot > grens;
      return {
        ok: true, titel: "Schildkliervolume", klasse: vergroot ? "Vergroot" : "Normaal volume",
        items: [
          { label: "Rechter kwab", waarde: r1(rV) + " mL" },
          { label: "Linker kwab", waarde: r1(lV) + " mL" },
          { label: "Totaal volume", waarde: r1(tot) + " mL" },
          { label: "Bovengrens norm", waarde: grens + " mL" },
        ],
        advies: vergroot ? "Volume boven de referentiegrens — correleer klinisch (struma)." : null,
        tekst: `Schildkliervolume: rechts ${r1(rV)} mL, links ${r1(lV)} mL, totaal ${r1(tot)} mL (referentie ≤${grens} mL).`,
      };
    },
  });

  CALCULATORS.push({
    id: "ti-rads",
    naam: "ACR TI-RADS",
    categorie: "Body — endocrien",
    modaliteit: ["ECHO"],
    bron: "ACR TI-RADS (Tessler 2017)",
    beschrijving: "Puntensysteem voor schildkliernoduli → TR1–TR5 + FNA-/follow-up-advies op basis van grootte.",
    triggerKeywords: ["schildkliernodul", "thyroid nodule", "ti-rads", "tirads", "noduul schildklier"],
    inputs: [
      { id: "compositie", label: "Compositie (kies 1)", type: "select",
        opties: [
          { v: "0", l: "Cysteus of bijna volledig cysteus (0)" },
          { v: "0s", l: "Spongiform (0)" },
          { v: "1", l: "Gemengd cysteus-solide (1)" },
          { v: "2", l: "Solide of bijna volledig solide (2)" },
        ] },
      { id: "echo", label: "Echogeniciteit (kies 1)", type: "select",
        opties: [
          { v: "0", l: "Anechogeen (0)" },
          { v: "1", l: "Hyperechogeen / isoechogeen (1)" },
          { v: "2", l: "Hypoechogeen (2)" },
          { v: "3", l: "Zeer hypoechogeen (3)" },
        ] },
      { id: "vorm", label: "Vorm (kies 1)", type: "select",
        opties: [
          { v: "0", l: "Breder dan hoog (0)" },
          { v: "3", l: "Hoger dan breed (3)" },
        ] },
      { id: "marge", label: "Marge (kies 1)", type: "select",
        opties: [
          { v: "0", l: "Glad (0)" },
          { v: "0i", l: "Slecht afgrensbaar (0)" },
          { v: "2", l: "Gelobd / irregulair (2)" },
          { v: "3", l: "Extrathyroïdale extensie (3)" },
        ] },
      { id: "foci", label: "Echogene foci (kies alles wat van toepassing is — tellen op)", type: "checkbox-group",
        opties: [
          { v: "1", l: "Macrocalcificaties (1)" },
          { v: "2", l: "Perifere (rim) calcificaties (2)" },
          { v: "3", l: "Punctate echogene foci (3)" },
        ] },
      { id: "grootte", label: "Maximale diameter", type: "number", eenheid: "cm", min: 0, step: 0.1 },
    ],
    compute(v) {
      const comp = (v.compositie === "0s") ? 0 : num(v.compositie);
      const marge = (v.marge === "0i") ? 0 : num(v.marge);
      const fociArr = Array.isArray(v.foci) ? v.foci : (v.foci ? [v.foci] : []);
      const fociPts = fociArr.reduce((a, x) => a + (parseInt(x, 10) || 0), 0);
      const pts = comp + num(v.echo) + num(v.vorm) + marge + fociPts;
      if (isNaN(pts)) return fout("Selecteer compositie, echogeniciteit, vorm en marge.");
      let tr, label;
      if (pts === 0) { tr = "TR1"; label = "Benigne"; }
      else if (pts <= 2) { tr = "TR2"; label = "Niet verdacht"; }
      else if (pts === 3) { tr = "TR3"; label = "Mild verdacht"; }
      else if (pts <= 6) { tr = "TR4"; label = "Matig verdacht"; }
      else { tr = "TR5"; label = "Hoog verdacht"; }
      const d = num(v.grootte);
      let advies = "Geen FNA volgens grootte-criteria.";
      if (tr === "TR5") advies = !isNaN(d) && d >= 1.0 ? "FNA aanbevolen (≥1 cm)." : (!isNaN(d) && d >= 0.5 ? "Follow-up (≥0,5 cm)." : "Geen actie volgens grootte.");
      else if (tr === "TR4") advies = !isNaN(d) && d >= 1.5 ? "FNA aanbevolen (≥1,5 cm)." : (!isNaN(d) && d >= 1.0 ? "Follow-up (≥1 cm)." : "Geen actie volgens grootte.");
      else if (tr === "TR3") advies = !isNaN(d) && d >= 2.5 ? "FNA aanbevolen (≥2,5 cm)." : (!isNaN(d) && d >= 1.5 ? "Follow-up (≥1,5 cm)." : "Geen actie volgens grootte.");
      return {
        ok: true, titel: "ACR TI-RADS", klasse: tr + " — " + label,
        items: [
          { label: "Totaal punten", waarde: String(pts) },
          { label: "Categorie", waarde: tr + " (" + label + ")" },
          ...(isNaN(d) ? [] : [{ label: "Diameter", waarde: r1(d) + " cm" }]),
        ],
        advies,
        tekst: `Schildkliernodulus, ACR TI-RADS ${tr} (${pts} punt${pts === 1 ? "" : "en"}, ${label.toLowerCase()})${isNaN(d) ? "" : `, ${r1(d)} cm`}. ${advies}`,
      };
    },
  });

  CALCULATORS.push({
    id: "adrenal-washout",
    naam: "Bijniernodulus — CT washout",
    categorie: "Body — endocrien",
    modaliteit: ["CT"],
    bron: "Adrenal CT washout (Korobkin/Caoili)",
    beschrijving: "Absolute (APW) en relatieve (RPW) contrastuitwas voor karakterisatie bijnieradenoom.",
    triggerKeywords: ["bijnier", "adrenal", "bijniernodul", "adrenale", "incidentaloom bijnier"],
    inputs: [
      { id: "blanco", label: "Blanco (unenhanced)", type: "number", eenheid: "HU", help: "Laat leeg indien niet beschikbaar" },
      { id: "portaal", label: "Portaal/veneus (~60–70s)", type: "number", eenheid: "HU" },
      { id: "delayed", label: "Delayed (15 min)", type: "number", eenheid: "HU" },
    ],
    compute(v) {
      const U = num(v.blanco), E = num(v.portaal), D = num(v.delayed);
      if (isNaN(E) || isNaN(D)) return fout("Geef minstens de veneuze en delayed HU-waarden in.");
      const items = [];
      let adenoom = false, tekst = "", advies = null;
      if (!isNaN(U) && U <= 10) { adenoom = true; items.push({ label: "Blanco", waarde: r1(U) + " HU (≤10 → lipiderijk adenoom)" }); }
      else if (!isNaN(U)) items.push({ label: "Blanco", waarde: r1(U) + " HU" });
      if (!isNaN(U) && (E - U) !== 0) {
        const apw = ((E - D) / (E - U)) * 100;
        items.push({ label: "Absolute washout (APW)", waarde: r0(apw) + "%" });
        if (apw >= 60) adenoom = true;
        advies = apw >= 60 ? "APW ≥60% → consistent met adenoom." : "APW <60% → niet diagnostisch voor adenoom; verdere evaluatie.";
      }
      const rpw = (E !== 0) ? ((E - D) / E) * 100 : NaN;
      if (!isNaN(rpw)) {
        items.push({ label: "Relatieve washout (RPW)", waarde: r0(rpw) + "%" });
        if (rpw >= 40) adenoom = true;
        if (advies === null) advies = rpw >= 40 ? "RPW ≥40% → consistent met adenoom." : "RPW <40% → niet diagnostisch voor adenoom.";
      }
      tekst = `Bijnierlaesie, CT-washout: ${items.map(i => i.label + " " + i.waarde).join(", ")}. ` +
        (adenoom ? "Bevindingen consistent met een adenoom." : "Niet diagnostisch voor adenoom — overweeg verdere karakterisatie.");
      return { ok: true, titel: "Bijnier CT-washout", klasse: adenoom ? "Consistent met adenoom" : "Niet-diagnostisch", items, advies, tekst };
    },
  });

  CALCULATORS.push({
    id: "adrenal-chemical-shift",
    naam: "Bijniernodulus — chemical shift MRI",
    categorie: "Body — endocrien",
    modaliteit: ["MR"],
    bron: "Chemical shift MRI (SII / adrenal-spleen ratio)",
    beschrijving: "Signaalintensiteitsindex (SII) en adrenal-to-spleen ratio (ASR) voor lipiderijk adenoom.",
    triggerKeywords: ["bijnier", "adrenal", "chemical shift", "in-phase", "out-of-phase", "in fase", "uit fase"],
    inputs: [
      { id: "inAdr", label: "Bijnier — in-phase SI", type: "number" },
      { id: "outAdr", label: "Bijnier — out-of-phase SI", type: "number" },
      { id: "inSpl", label: "Milt — in-phase SI", type: "number", help: "Optioneel, voor ASR" },
      { id: "outSpl", label: "Milt — out-of-phase SI", type: "number", help: "Optioneel, voor ASR" },
    ],
    compute(v) {
      const iA = num(v.inAdr), oA = num(v.outAdr);
      if (isNaN(iA) || isNaN(oA) || iA === 0) return fout("Geef in- en out-of-phase SI van de bijnier in.");
      const sii = ((iA - oA) / iA) * 100;
      const items = [{ label: "Signaalintensiteitsindex (SII)", waarde: r1(sii) + "%" }];
      let adenoom = sii > 16.5;
      const iS = num(v.inSpl), oS = num(v.outSpl);
      if (!isNaN(iS) && !isNaN(oS) && iS !== 0 && oS !== 0) {
        const asr = (oA / oS) / (iA / iS);
        items.push({ label: "Adrenal-spleen ratio (ASR)", waarde: r2(asr) });
        if (asr < 0.71) adenoom = true;
      }
      return {
        ok: true, titel: "Bijnier chemical shift MRI", klasse: adenoom ? "Lipiderijk adenoom" : "Geen significant signaalverlies",
        items,
        advies: adenoom ? "Signaalverlies op out-of-phase → lipiderijk adenoom." : "Geen significant signaalverlies — geen lipiderijk adenoom; correleer/karakteriseer verder.",
        tekst: `Bijnierlaesie, chemical shift MRI: SII ${r1(sii)}%${items.length > 1 ? ", ASR " + items[1].waarde : ""}. ` +
          (adenoom ? "Significant signaalverlies, consistent met een lipiderijk adenoom." : "Geen significant signaalverlies."),
      };
    },
  });

  /* ==========================================================================
   * BODY — GENITO-URINAIR
   * ======================================================================== */

  CALCULATORS.push({
    id: "prostate-volume-psad",
    naam: "Prostaatvolume + PSA-densiteit",
    categorie: "Body — genito-urinair",
    modaliteit: ["MR", "ECHO", "CT"],
    bron: "Ellipsoïde-methode + PSA-densiteit",
    beschrijving: "Prostaatvolume (0,52 × L × B × H) en PSA-densiteit (PSA/volume; drempel 0,15 ng/mL/cc).",
    triggerKeywords: ["prostaat", "prostate", "prostaatvolume", "psa", "psa-densiteit"],
    inputs: [
      { id: "L", label: "Lengte (craniocaudaal)", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "B", label: "Breedte (transversaal)", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "H", label: "Hoogte (AP)", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "psa", label: "Serum PSA", type: "number", eenheid: "ng/mL", min: 0, step: 0.1, help: "Optioneel, voor densiteit" },
    ],
    compute(v) {
      const vol = ellipsoid(num(v.L), num(v.B), num(v.H));
      if (isNaN(vol)) return fout("Geef de drie afmetingen in.");
      const items = [{ label: "Prostaatvolume", waarde: r1(vol) + " mL" }];
      let advies = null, psadStr = "";
      const psa = num(v.psa);
      if (!isNaN(psa) && vol > 0) {
        const psad = psa / vol;
        items.push({ label: "PSA-densiteit", waarde: r2(psad) + " ng/mL/cc" });
        const hoog = psad >= 0.15;
        advies = hoog ? "PSA-densiteit ≥0,15 → verhoogd risico, correleer met PI-RADS." : "PSA-densiteit <0,15.";
        psadStr = `, PSA-densiteit ${r2(psad)} ng/mL/cc`;
      }
      return {
        ok: true, titel: "Prostaatvolume + PSA-densiteit", klasse: null, items, advies,
        tekst: `Prostaatvolume ${r1(vol)} mL (ellipsoïde)${psadStr}.`,
      };
    },
  });

  CALCULATORS.push({
    id: "bladder-volume",
    naam: "Blaasvolume",
    categorie: "Body — genito-urinair",
    modaliteit: ["ECHO", "CT"],
    bron: "Ellipsoïde-methode",
    beschrijving: "Blaasvolume via 0,52 × L × B × H; bruikbaar voor residu-bepaling.",
    triggerKeywords: ["blaas", "bladder", "residu", "mictie", "post-mictie", "retentie"],
    inputs: [
      { id: "L", label: "Lengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "B", label: "Breedte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "H", label: "Hoogte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
    ],
    compute(v) {
      const vol = ellipsoid(num(v.L), num(v.B), num(v.H));
      if (isNaN(vol)) return fout("Geef de drie afmetingen in.");
      return {
        ok: true, titel: "Blaasvolume", klasse: null,
        items: [{ label: "Geschat volume", waarde: r0(vol) + " mL" }],
        advies: vol > 100 ? "Residu >100 mL kan klinisch relevant zijn — correleer." : null,
        tekst: `Geschat blaasvolume ${r0(vol)} mL (ellipsoïde-methode).`,
      };
    },
  });

  CALCULATORS.push({
    id: "gonadal-volume",
    naam: "Gonadaal volume (testis/ovarium)",
    categorie: "Body — genito-urinair",
    modaliteit: ["ECHO", "MR"],
    bron: "Lambert (testis 0,71) / ellipsoïde (ovarium 0,52)",
    beschrijving: "Testisvolume (Lambert 0,71 × L × B × H) of ovariumvolume (0,52 × L × B × H).",
    triggerKeywords: ["testis", "testikel", "ovarium", "ovary", "gonad", "scrotaal", "adnex"],
    inputs: [
      { id: "orgaan", label: "Orgaan", type: "select", default: "testis",
        opties: [{ v: "testis", l: "Testis (×0,71)" }, { v: "ovarium", l: "Ovarium (×0,52)" }] },
      { id: "L", label: "Lengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "B", label: "Breedte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "H", label: "Hoogte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
    ],
    compute(v) {
      const k = v.orgaan === "ovarium" ? 0.52 : 0.71;
      const vol = ellipsoid(num(v.L), num(v.B), num(v.H), k);
      if (isNaN(vol)) return fout("Geef de drie afmetingen in.");
      const isOv = v.orgaan === "ovarium";
      const grens = isOv ? 10 : null; // ovarium postmenopauzaal-referentie indicatief
      return {
        ok: true, titel: "Gonadaal volume", klasse: null,
        items: [{ label: (isOv ? "Ovariumvolume" : "Testisvolume"), waarde: r1(vol) + " mL" }],
        advies: (isOv && vol > grens) ? "Ovariumvolume >10 mL — context-afhankelijk relevant." : null,
        tekst: `${isOv ? "Ovarium" : "Testis"}volume ${r1(vol)} mL (${isOv ? "ellipsoïde 0,52" : "Lambert 0,71"}).`,
      };
    },
  });

  CALCULATORS.push({
    id: "renal-resistive-index",
    naam: "Resistive index (Doppler)",
    categorie: "Body — genito-urinair",
    modaliteit: ["ECHO"],
    bron: "Resistive index (Pourcelot)",
    beschrijving: "RI = (PSV − EDV)/PSV. Renale norm <0,70.",
    triggerKeywords: ["resistive index", "doppler", "psv", "edv", "weerstandsindex", "ri "],
    inputs: [
      { id: "psv", label: "Piek-systolische snelheid (PSV)", type: "number", eenheid: "cm/s", min: 0 },
      { id: "edv", label: "Einddiastolische snelheid (EDV)", type: "number", eenheid: "cm/s", min: 0 },
    ],
    compute(v) {
      const psv = num(v.psv), edv = num(v.edv);
      if (isNaN(psv) || isNaN(edv) || psv === 0) return fout("Geef PSV en EDV in.");
      const ri = (psv - edv) / psv;
      const hoog = ri >= 0.70;
      return {
        ok: true, titel: "Resistive index", klasse: hoog ? "Verhoogd (≥0,70)" : "Normaal (<0,70)",
        items: [{ label: "RI", waarde: r2(ri) }],
        advies: hoog ? "RI ≥0,70 — verhoogde vasculaire weerstand; correleer klinisch." : null,
        tekst: `Resistive index ${r2(ri)} (PSV ${r0(psv)}, EDV ${r0(edv)} cm/s).`,
      };
    },
  });

  /* ==========================================================================
   * NEURORADIOLOGIE
   * ======================================================================== */

  CALCULATORS.push({
    id: "ich-volume-abc2",
    naam: "ICH-volume (ABC/2)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR"],
    bron: "ABC/2 (Kothari 1996)",
    beschrijving: "Geschat intracerebraal hematoomvolume = (A × B × C)/2, lengtes in cm.",
    triggerKeywords: ["bloeding", "hematoom", "ich", "intracerebraal", "hemorrhage", "haemorragie", "hersenbloeding"],
    inputs: [
      { id: "A", label: "A — grootste diameter", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "B", label: "B — loodrecht op A", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "C", label: "C — aantal coupes × coupedikte", type: "number", eenheid: "cm", min: 0, step: 0.1,
        help: "Of meet de craniocaudale uitbreiding rechtstreeks" },
    ],
    compute(v) {
      const A = num(v.A), B = num(v.B), C = num(v.C);
      if (isNaN(A) || isNaN(B) || isNaN(C)) return fout("Geef A, B en C in.");
      const vol = (A * B * C) / 2;
      return {
        ok: true, titel: "ICH-volume (ABC/2)", klasse: null,
        items: [{ label: "Geschat hematoomvolume", waarde: r1(vol) + " mL" }],
        advies: vol >= 30 ? "Volume ≥30 mL — geassocieerd met slechtere prognose." : null,
        tekst: `Geschat intracerebraal hematoomvolume ${r1(vol)} mL (ABC/2-methode).`,
      };
    },
  });

  CALCULATORS.push({
    id: "carotid-stenosis",
    naam: "Carotisstenose (NASCET/ECST)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR", "ECHO"],
    bron: "NASCET & ECST",
    beschrijving: "Stenosegraad volgens NASCET (t.o.v. distaal normaal lumen) en ECST (t.o.v. bulbus-diameter).",
    triggerKeywords: ["carotis", "carotid", "stenose", "nascet", "ecst", "ica", "arteria carotis"],
    inputs: [
      { id: "rest", label: "Residueel lumen (smalste)", type: "number", eenheid: "mm", min: 0, step: 0.1 },
      { id: "distaal", label: "Distaal normaal lumen (NASCET)", type: "number", eenheid: "mm", min: 0, step: 0.1 },
      { id: "bulbus", label: "Oorspronkelijke bulbusdiameter (ECST)", type: "number", eenheid: "mm", min: 0, step: 0.1, help: "Optioneel" },
    ],
    compute(v) {
      const rest = num(v.rest), dist = num(v.distaal), bulb = num(v.bulbus);
      if (isNaN(rest) || isNaN(dist) || dist === 0) return fout("Geef residueel en distaal normaal lumen in.");
      const nascet = (1 - rest / dist) * 100;
      const items = [{ label: "NASCET", waarde: r0(nascet) + "%" }];
      if (!isNaN(bulb) && bulb !== 0) items.push({ label: "ECST", waarde: r0((1 - rest / bulb) * 100) + "%" });
      let graad;
      if (nascet < 50) graad = "lichte stenose (<50%)";
      else if (nascet < 70) graad = "matige stenose (50–69%)";
      else if (nascet < 100) graad = "ernstige stenose (70–99%)";
      else graad = "occlusie";
      return {
        ok: true, titel: "Carotisstenose", klasse: graad,
        items,
        advies: nascet >= 70 ? "Ernstige stenose — bespreek revascularisatie bij symptomatische patiënt." : null,
        tekst: `Carotisstenose NASCET ${r0(nascet)}%${items.length > 1 ? " (ECST " + items[1].waarde + ")" : ""} — ${graad}.`,
      };
    },
  });

  CALCULATORS.push({
    id: "aspects",
    naam: "ASPECTS",
    categorie: "Neuroradiologie",
    modaliteit: ["CT"],
    bron: "Alberta Stroke Program Early CT Score",
    beschrijving: "10-puntsscore voor vroege ischemische veranderingen in het MCA-territorium; trek 1 punt af per aangetast gebied.",
    triggerKeywords: ["aspects", "infarct", "ischemie", "mca", "stroke", "cva", "beroerte"],
    inputs: [
      { id: "regios", label: "Aangetaste regio's", type: "checkbox-group",
        opties: [
          { v: "C", l: "Caudatus" }, { v: "L", l: "Lentiform nucleus" }, { v: "IC", l: "Capsula interna" },
          { v: "I", l: "Insula" }, { v: "M1", l: "M1" }, { v: "M2", l: "M2" }, { v: "M3", l: "M3" },
          { v: "M4", l: "M4" }, { v: "M5", l: "M5" }, { v: "M6", l: "M6" },
        ] },
    ],
    compute(v) {
      const arr = Array.isArray(v.regios) ? v.regios : (v.regios ? [v.regios] : []);
      const score = 10 - arr.length;
      return {
        ok: true, titel: "ASPECTS", klasse: "ASPECTS " + score + "/10",
        items: [
          { label: "Aangetaste regio's", waarde: arr.length ? arr.join(", ") : "geen" },
          { label: "Score", waarde: score + "/10" },
        ],
        advies: score <= 5 ? "ASPECTS ≤5 — uitgebreide vroege ischemie; bespreek met stroke-team." : null,
        tekst: `ASPECTS ${score}/10${arr.length ? " (aangetast: " + arr.join(", ") + ")" : ""}.`,
      };
    },
  });

  CALCULATORS.push({
    id: "sins",
    naam: "SINS (spinale instabiliteit)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR", "RX"],
    bron: "Spinal Instability Neoplastic Score (Fisher 2010)",
    beschrijving: "Som van 6 componenten (0–18) → stabiel / indeterminaat / instabiel.",
    triggerKeywords: ["sins", "spinale instabiliteit", "wervelmetastase", "vertebrale metastase", "spinal instability"],
    inputs: [
      { id: "locatie", label: "Locatie", type: "select",
        opties: [{ v: "0", l: "Rigide (S2–S5) (0)" }, { v: "1", l: "Semi-rigide (T3–T10) (1)" }, { v: "2", l: "Mobiel (C3–C6, L2–L4) (2)" }, { v: "3", l: "Junctioneel (O–C2, C7–T2, T11–L1, L5–S1) (3)" }] },
      { id: "pijn", label: "Pijn", type: "select",
        opties: [{ v: "0", l: "Geen pijn (0)" }, { v: "1", l: "Occasioneel, niet-mechanisch (1)" }, { v: "3", l: "Mechanische/houdingsgebonden pijn (3)" }] },
      { id: "bot", label: "Botlaesie", type: "select",
        opties: [{ v: "0", l: "Blastisch (0)" }, { v: "1", l: "Gemengd (1)" }, { v: "2", l: "Lytisch (2)" }] },
      { id: "alignement", label: "Radiografisch alignement", type: "select",
        opties: [{ v: "0", l: "Normaal alignement (0)" }, { v: "2", l: "De-novo deformiteit (kyfose/scoliose) (2)" }, { v: "4", l: "Subluxatie/translatie (4)" }] },
      { id: "collaps", label: "Wervelcorpuscollaps", type: "select",
        opties: [{ v: "0", l: "Geen, <50% betrokken (0)" }, { v: "1", l: ">50% betrokken zonder collaps (1)" }, { v: "2", l: "<50% collaps (2)" }, { v: "3", l: ">50% collaps (3)" }] },
      { id: "posterolat", label: "Posterolaterale betrokkenheid", type: "select",
        opties: [{ v: "0", l: "Geen (0)" }, { v: "1", l: "Unilateraal (1)" }, { v: "3", l: "Bilateraal (3)" }] },
    ],
    compute(v) {
      const keys = ["locatie", "pijn", "bot", "alignement", "collaps", "posterolat"];
      let s = 0; for (const k of keys) { const n = num(v[k]); if (isNaN(n)) return fout("Selecteer alle componenten."); s += n; }
      let klasse, advies;
      if (s <= 6) { klasse = "Stabiel (0–6)"; advies = "Stabiel."; }
      else if (s <= 12) { klasse = "Indeterminaat (7–12)"; advies = "Indeterminaat — chirurgisch advies aanbevolen."; }
      else { klasse = "Instabiel (13–18)"; advies = "Instabiel — chirurgisch advies aanbevolen."; }
      return {
        ok: true, titel: "SINS", klasse: "SINS " + s + " — " + klasse,
        items: [{ label: "Totaalscore", waarde: s + "/18" }],
        advies,
        tekst: `SINS ${s}/18 — ${klasse.toLowerCase()}. ${advies}`,
      };
    },
  });

  CALCULATORS.push({
    id: "knosp",
    naam: "Knosp-classificatie (hypofyse)",
    categorie: "Neuroradiologie",
    modaliteit: ["MR"],
    bron: "Knosp (cavernous sinus invasie)",
    beschrijving: "Graad 0–4 voor parasellaire/cavernous sinus extensie van hypofyseadenoom t.o.v. ICA-tangenten.",
    triggerKeywords: ["knosp", "hypofyse", "pituitary", "macroadenoom", "sella", "cavernous sinus"],
    inputs: [
      { id: "graad", label: "Relatie tot ICA-tangenten", type: "select",
        opties: [
          { v: "0", l: "Graad 0 — binnen mediale tangent, geen extensie" },
          { v: "1", l: "Graad 1 — tot mediane (intercarotid) lijn" },
          { v: "2", l: "Graad 2 — voorbij mediane lijn tot laterale tangent" },
          { v: "3", l: "Graad 3 — voorbij laterale tangent" },
          { v: "4", l: "Graad 4 — totale omsluiting van de ICA" },
        ] },
    ],
    compute(v) {
      const g = v.graad;
      if (g === undefined || g === "") return fout("Selecteer de graad.");
      const invasie = (g === "3" || g === "4") ? "waarschijnlijke cavernous sinus invasie" : (g === "2" ? "mogelijke invasie" : "geen invasie");
      return {
        ok: true, titel: "Knosp-classificatie", klasse: "Knosp graad " + g,
        items: [{ label: "Graad", waarde: g }, { label: "Interpretatie", waarde: invasie }],
        advies: (g === "3" || g === "4") ? "Hoge kans op cavernous sinus invasie." : null,
        tekst: `Hypofyseadenoom, Knosp graad ${g} — ${invasie}.`,
      };
    },
  });

  /* ==========================================================================
   * BODY — HEPATOBILIAIR
   * ======================================================================== */

  CALCULATORS.push({
    id: "li-rads",
    naam: "LI-RADS 2018/2024 (CT/MRI)",
    categorie: "Body — hepatobiliair",
    modaliteit: ["CT", "MR"],
    bron: "ACR LI-RADS v2018 (CT/MRI diagnostische tabel)",
    beschrijving: "Categorisering van leverobservaties bij hoog-risicopatiënten (cirrose/HCC-risico). Volgt de v2018 CT/MRI-grid: grootte × niet-rim APHE × aantal additionele major features (washout, kapsel, drempelgroei). Drempelgroei = ≥50% diametertoename in ≤6 maanden.",
    triggerKeywords: ["li-rads", "lirads", "hcc", "hepatocellulair", "cirrose", "leverlaesie", "levernodul"],
    inputs: [
      { id: "grootte", label: "Diameter", type: "number", eenheid: "mm", min: 0 },
      { id: "aps", label: "Niet-rim arteriële hyperenhancement (APHE)", type: "select",
        opties: [{ v: "ja", l: "Aanwezig" }, { v: "nee", l: "Afwezig" }] },
      { id: "washout", label: "Niet-perifere washout", type: "checkbox" },
      { id: "kapsel", label: "Enhancing kapsel", type: "checkbox" },
      { id: "drempelgroei", label: "Drempelgroei (≥50% in ≤6 mnd)", type: "checkbox" },
      { id: "tiv", label: "Tumor in vene (LR-TIV)", type: "checkbox" },
      { id: "lrm", label: "Kenmerken die niet-HCC maligniteit suggereren (rim APHE, targetoid, geleidelijke centripetale enhancement)", type: "checkbox" },
    ],
    compute(v) {
      const d = num(v.grootte);
      if (isNaN(d)) return fout("Geef de diameter in.");
      const mk = (cat, advies, extra) => ({
        ok: true, titel: "LI-RADS", klasse: cat,
        items: [{ label: "Diameter", waarde: d + " mm" }, { label: "Categorie", waarde: cat }],
        advies,
        tekst: `Leverobservatie ${d} mm, LI-RADS ${cat}.${extra ? " " + extra : ""} ${advies}`.trim(),
      });
      if (v.tiv) return mk("LR-TIV", "Tumor in vene — bespreek multidisciplinair.");
      if (v.lrm) return mk("LR-M", "Waarschijnlijk/definitief maligne, niet-HCC-specifiek — overweeg biopsie/multidisciplinair overleg.");
      const aphe = v.aps === "ja";
      const W = !!v.washout, C = !!v.kapsel, T = !!v.drempelgroei;
      const af = (W ? 1 : 0) + (C ? 1 : 0) + (T ? 1 : 0);
      let cat;
      if (!aphe) {
        if (d < 20) cat = af >= 2 ? "LR-4" : "LR-3";
        else cat = af >= 1 ? "LR-4" : "LR-3";
      } else {
        if (d < 10) cat = af >= 1 ? "LR-4" : "LR-3";
        else if (d < 20) cat = af === 0 ? "LR-3" : ((W || T) ? "LR-5" : (af >= 2 ? "LR-5" : "LR-4"));
        else cat = af >= 1 ? "LR-5" : "LR-4";
      }
      const advies = cat === "LR-5" ? "Definitief HCC — multidisciplinair bespreken (biopsie meestal niet nodig)."
        : cat === "LR-4" ? "Waarschijnlijk HCC — multidisciplinair bespreken."
        : "Intermediaire waarschijnlijkheid — follow-up / aanvullende beeldvorming.";
      const featTxt = [W && "washout", C && "kapsel", T && "drempelgroei"].filter(Boolean).join(", ") || "geen";
      return mk(cat, advies, `APHE ${aphe ? "aanwezig" : "afwezig"}; additionele major features: ${featTxt}.`);
    },
  });

  CALCULATORS.push({
    id: "liver-steatosis",
    naam: "Leversteatose (CT/MRI)",
    categorie: "Body — hepatobiliair",
    modaliteit: ["CT", "MR"],
    bron: "CT-attenuatie (L−S) / MRI proton density fat fraction",
    beschrijving: "CT: leverattenuatie en lever-milt-verschil. MRI: PDFF-gradering.",
    triggerKeywords: ["steatose", "steatosis", "leververvetting", "vette lever", "nafld", "pdff", "fat fraction"],
    inputs: [
      { id: "methode", label: "Methode", type: "select", default: "ct",
        opties: [{ v: "ct", l: "CT (HU)" }, { v: "pdff", l: "MRI PDFF (%)" }] },
      { id: "lever", label: "Leverattenuatie (CT)", type: "number", eenheid: "HU", help: "Bij CT" },
      { id: "milt", label: "Miltattenuatie (CT)", type: "number", eenheid: "HU", help: "Bij CT, optioneel" },
      { id: "pdff", label: "PDFF (MRI)", type: "number", eenheid: "%", help: "Bij MRI" },
    ],
    compute(v) {
      if (v.methode === "pdff") {
        const p = num(v.pdff);
        if (isNaN(p)) return fout("Geef de PDFF-waarde in.");
        let graad;
        if (p < 5) graad = "geen significante steatose";
        else if (p < 10) graad = "milde steatose";
        else if (p < 20) graad = "matige steatose";
        else graad = "ernstige steatose";
        return { ok: true, titel: "Leversteatose (MRI PDFF)", klasse: graad,
          items: [{ label: "PDFF", waarde: r1(p) + "%" }],
          advies: p >= 5 ? "PDFF ≥5% → hepatische steatose." : null,
          tekst: `Leversteatose op MRI: PDFF ${r1(p)}% — ${graad}.` };
      }
      const L = num(v.lever), S = num(v.milt);
      if (isNaN(L)) return fout("Geef de leverattenuatie in.");
      const items = [{ label: "Leverattenuatie", waarde: r0(L) + " HU" }];
      let steatose = L < 40;
      if (!isNaN(S)) {
        const diff = L - S;
        items.push({ label: "Milt", waarde: r0(S) + " HU" });
        items.push({ label: "Lever − milt", waarde: r0(diff) + " HU" });
        if (diff <= -10) steatose = true;
      }
      return { ok: true, titel: "Leversteatose (CT)", klasse: steatose ? "Steatose waarschijnlijk" : "Geen steatose",
        items,
        advies: steatose ? "Leverattenuatie <40 HU of lever−milt ≤−10 HU → hepatische steatose." : null,
        tekst: `Leverattenuatie ${r0(L)} HU${isNaN(S) ? "" : `, milt ${r0(S)} HU (verschil ${r0(L - S)} HU)`} — ${steatose ? "suggestief voor hepatische steatose" : "geen aanwijzing voor steatose"}.` };
    },
  });

  CALCULATORS.push({
    id: "liver-volume",
    naam: "Standaard levervolume (Vauthey)",
    categorie: "Body — hepatobiliair",
    modaliteit: ["CT", "MR"],
    bron: "Vauthey 2002 (SLV uit lichaamsoppervlak)",
    beschrijving: "Standaard levervolume = −794 + 1267 × BSA (Mosteller). Voor restlevervolume-ratio bij resectieplanning.",
    triggerKeywords: ["levervolume", "liver volume", "restlevervolume", "future liver remnant", "hepatectomie", "leverresectie"],
    inputs: [
      { id: "lengte", label: "Lengte", type: "number", eenheid: "cm", min: 0 },
      { id: "gewicht", label: "Gewicht", type: "number", eenheid: "kg", min: 0 },
      { id: "remnant", label: "Gemeten restlevervolume (optioneel)", type: "number", eenheid: "mL", help: "Voor FLR-ratio" },
    ],
    compute(v) {
      const h = num(v.lengte), w = num(v.gewicht);
      if (isNaN(h) || isNaN(w)) return fout("Geef lengte en gewicht in.");
      const bsa = Math.sqrt((h * w) / 3600); // Mosteller
      const slv = -794 + 1267 * bsa;
      const items = [
        { label: "BSA (Mosteller)", waarde: r2(bsa) + " m²" },
        { label: "Standaard levervolume", waarde: r0(slv) + " mL" },
      ];
      let advies = null;
      const rem = num(v.remnant);
      if (!isNaN(rem) && slv > 0) {
        const ratio = (rem / slv) * 100;
        items.push({ label: "FLR-ratio (gemeten/SLV)", waarde: r1(ratio) + "%" });
        advies = ratio < 20 ? "FLR <20% — verhoogd risico op leverfalen (normaal parenchym)." : null;
      }
      return { ok: true, titel: "Standaard levervolume", klasse: null, items, advies,
        tekst: `Standaard levervolume ${r0(slv)} mL (BSA ${r2(bsa)} m², Vauthey)${isNaN(rem) ? "" : `; restlevervolume-ratio ${r1((rem / slv) * 100)}%`}.` };
    },
  });

  CALCULATORS.push({
    id: "spleen-volume-index",
    naam: "Miltvolume + miltindex",
    categorie: "Body — hepatobiliair",
    modaliteit: ["CT", "MR", "ECHO"],
    bron: "Ellipsoïde-volume / miltindex",
    beschrijving: "Miltvolume (0,52 × L × B × D) en miltindex (L × B × D). Splenomegalie-referenties.",
    triggerKeywords: ["milt", "spleen", "splenomegalie", "miltvolume", "miltindex"],
    inputs: [
      { id: "L", label: "Lengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "B", label: "Breedte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "D", label: "Dikte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
    ],
    compute(v) {
      const L = num(v.L), B = num(v.B), D = num(v.D);
      if (isNaN(L) || isNaN(B) || isNaN(D)) return fout("Geef de drie afmetingen in.");
      const vol = ellipsoid(L, B, D);
      const index = L * B * D;
      const splenomeg = vol > 314; // ~bovengrens normaal volwassene
      return { ok: true, titel: "Miltvolume + index", klasse: splenomeg ? "Splenomegalie" : "Normaal",
        items: [
          { label: "Miltvolume", waarde: r0(vol) + " mL" },
          { label: "Miltindex", waarde: r0(index) + " cm³" },
        ],
        advies: splenomeg ? "Volume boven referentie (~314 mL) → splenomegalie." : null,
        tekst: `Miltvolume ${r0(vol)} mL, miltindex ${r0(index)} cm³${splenomeg ? " — splenomegalie" : ""}.` };
    },
  });

  CALCULATORS.push({
    id: "acute-cholecystitis-us",
    naam: "Acute cholecystitis (echografie)",
    categorie: "Body — hepatobiliair",
    modaliteit: ["ECHO"],
    bron: "Sonografische criteria",
    beschrijving: "Checklist van sonografische bevindingen → waarschijnlijkheid acute cholecystitis.",
    triggerKeywords: ["cholecystitis", "galblaas", "gallbladder", "galsteen", "murphy", "galblaaswand"],
    inputs: [
      { id: "stenen", label: "Galstenen / sludge", type: "checkbox" },
      { id: "wand", label: "Wandverdikking >3 mm", type: "checkbox" },
      { id: "murphy", label: "Sonografisch teken van Murphy", type: "checkbox" },
      { id: "vocht", label: "Pericholecystisch vocht", type: "checkbox" },
      { id: "distensie", label: "Hydrops/distensie (>4 cm transvers)", type: "checkbox" },
    ],
    compute(v) {
      const major = (v.stenen ? 1 : 0) + (v.murphy ? 1 : 0);
      const minor = (v.wand ? 1 : 0) + (v.vocht ? 1 : 0) + (v.distensie ? 1 : 0);
      const tot = major + minor;
      let klasse;
      if (v.stenen && v.murphy && minor >= 1) klasse = "Hoge waarschijnlijkheid";
      else if (tot >= 3) klasse = "Matige waarschijnlijkheid";
      else if (tot >= 1) klasse = "Lage-matige waarschijnlijkheid";
      else klasse = "Geen sonografische tekenen";
      const aanw = [];
      if (v.stenen) aanw.push("galstenen/sludge");
      if (v.wand) aanw.push("wandverdikking >3 mm");
      if (v.murphy) aanw.push("positief teken van Murphy");
      if (v.vocht) aanw.push("pericholecystisch vocht");
      if (v.distensie) aanw.push("distensie");
      return { ok: true, titel: "Acute cholecystitis (US)", klasse,
        items: [{ label: "Bevindingen", waarde: aanw.length ? aanw.join(", ") : "geen" }],
        advies: klasse.indexOf("Hoge") === 0 ? "Beeld consistent met acute cholecystitis — correleer klinisch/labo." : null,
        tekst: `Galblaas: ${aanw.length ? aanw.join(", ") : "geen specifieke tekenen"} — ${klasse.toLowerCase()} voor acute cholecystitis.` };
    },
  });

  /* ==========================================================================
   * BODY — GASTRO-INTESTINAAL
   * ======================================================================== */

  CALCULATORS.push({
    id: "c-rads",
    naam: "C-RADS (CT-colografie)",
    categorie: "Body — gastro-intestinaal",
    modaliteit: ["CT"],
    bron: "C-RADS v2023 (CT Colonography Reporting and Data System)",
    beschrijving: "Auto-classificatie van de colonische bevinding (C0–C4, met C2a/C2b) op basis van poliepgrootte/aantal, plus aparte extracolonische categorie (E0–E4).",
    triggerKeywords: ["c-rads", "crads", "ct-colografie", "ct colonography", "virtuele colo", "coloscopie"],
    inputs: [
      { id: "bevinding", label: "Colonische bevinding", type: "select",
        opties: [
          { v: "inadequaat", l: "Inadequaat onderzoek / in afwachting van vergelijking (C0)" },
          { v: "normaal", l: "Normaal colon / benigne (geen poliep ≥6 mm, lipoom, inverted diverticulum, nonneoplastisch)" },
          { v: "poliep", l: "Poliep(en) — classificeer op grootte/aantal" },
          { v: "diverticulair", l: "Waarschijnlijk benigne diverticulaire bevinding (mass-like myochosis/hypertrofie/strictuur)" },
          { v: "maligne", l: "Vermoedelijk maligne massa (≥30 mm polypoïd, lumencompromittering of extracolonische invasie)" },
        ] },
      { id: "grootte", label: "Grootste poliep / laesie", type: "number", eenheid: "mm", min: 0, step: 0.1 },
      { id: "aantal69", label: "Aantal poliepen van 6–9 mm", type: "select", default: "0",
        opties: [{ v: "0", l: "0" }, { v: "1-2", l: "1–2 (minder dan 3)" }, { v: "3+", l: "≥3" }] },
      { id: "c2bzeker", label: "Diverticulaire bevinding — zekerheid", type: "select", default: "benigne",
        opties: [{ v: "benigne", l: "Waarschijnlijk benigne" }, { v: "onzeker", l: "Onzeker benigne" }] },
      { id: "extra", label: "Extracolonische bevinding (E)", type: "select", default: "",
        opties: [
          { v: "", l: "Niet gescoord" },
          { v: "E0", l: "E0 — beperkt/inadequaat" },
          { v: "E1", l: "E1 — normaal / anatomische variant" },
          { v: "E2", l: "E2 — klinisch onbelangrijk" },
          { v: "E3", l: "E3 — waarschijnlijk onbelangrijk, incompleet gekarakteriseerd" },
          { v: "E4", l: "E4 — potentieel belangrijk" },
        ] },
    ],
    compute(v) {
      if (!v.bevinding) return fout("Selecteer de colonische bevinding.");
      const d = num(v.grootte);
      let c, label;
      if (v.bevinding === "inadequaat") { c = "C0"; label = "inadequaat onderzoek"; }
      else if (v.bevinding === "normaal") { c = "C1"; label = "normaal colon / benigne"; }
      else if (v.bevinding === "diverticulair") { c = "C2b"; label = "waarschijnlijk benigne diverticulaire bevinding"; }
      else if (v.bevinding === "maligne") { c = "C4"; label = "vermoedelijk maligne massa"; }
      else { // poliep
        if (!isNaN(d) && d >= 30) { c = "C4"; label = "polypoïde massa ≥30 mm"; }
        else if (!isNaN(d) && d >= 10) { c = "C3"; label = "poliep ≥10 mm"; }
        else if (!isNaN(d) && d >= 6) {
          if (v.aantal69 === "3+") { c = "C3"; label = "≥3 poliepen van 6–9 mm"; }
          else { c = "C2a"; label = "intermediaire poliep 6–9 mm, <3 in aantal"; }
        } else { c = "C1"; label = "geen poliep ≥6 mm"; }
      }
      const adviesMap = {
        C0: "In afwachting van vergelijking; herhaal CTC of overweeg alternatieve screeningstest.",
        C1: "Routine screening (elke 5–10 jaar).",
        C2a: "Herhaal CTC na 3 jaar of coloscopie-verwijzing (poliepectomie te overwegen).",
        C2b: v.c2bzeker === "onzeker" ? "Onzeker benigne: herhaal CTC binnen ≤3 jaar." : "Waarschijnlijk benigne: herhaal CTC na 5 jaar.",
        C3: "Coloscopie-verwijzing aanbevolen.",
        C4: "Coloscopie + chirurgische/oncologische verwijzing aanbevolen.",
      };
      return { ok: true, titel: "C-RADS v2023", klasse: c + (v.extra ? " / " + v.extra : ""),
        items: [
          { label: "Colon", waarde: c + " — " + label },
          ...(v.extra ? [{ label: "Extracolonisch", waarde: v.extra }] : []),
        ],
        advies: adviesMap[c] || null,
        tekst: `C-RADS ${c}${v.extra ? " / " + v.extra : ""} (${label}). ${adviesMap[c] || ""}`.trim() };
    },
  });

  CALCULATORS.push({
    id: "pancreatic-collections",
    naam: "Pancreatische collecties (Atlanta)",
    categorie: "Body — gastro-intestinaal",
    modaliteit: ["CT", "MR"],
    bron: "Herziene Atlanta-classificatie 2012",
    beschrijving: "Benoeming van peripancreatische collecties op basis van inhoud, encapsulatie en tijd.",
    triggerKeywords: ["pancreatitis", "pancreas", "collectie", "pseudocyste", "necrose", "walled-off", "won", "apfc"],
    inputs: [
      { id: "necrose", label: "Bevat necrose?", type: "select",
        opties: [{ v: "nee", l: "Nee — enkel vocht (interstitieel oedemateuze pancreatitis)" }, { v: "ja", l: "Ja — necrotiserende pancreatitis" }] },
      { id: "tijd", label: "Tijd sinds onset", type: "select",
        opties: [{ v: "vroeg", l: "≤4 weken (niet-geëncapsuleerd)" }, { v: "laat", l: ">4 weken (geëncapsuleerd)" }] },
    ],
    compute(v) {
      if (!v.necrose || !v.tijd) return fout("Selecteer beide opties.");
      let naam;
      if (v.necrose === "nee") naam = v.tijd === "vroeg" ? "Acute peripancreatische vochtcollectie (APFC)" : "Pseudocyste";
      else naam = v.tijd === "vroeg" ? "Acute necrotische collectie (ANC)" : "Walled-off necrose (WON)";
      return { ok: true, titel: "Pancreatische collectie", klasse: naam,
        items: [{ label: "Type", waarde: naam }],
        advies: null,
        tekst: `Peripancreatische collectie: ${naam} (herziene Atlanta-classificatie).` };
    },
  });

  CALCULATORS.push({
    id: "bosniak-2019",
    naam: "Bosniak 2019 (cysteuze niermassa)",
    categorie: "Body — genito-urinair",
    modaliteit: ["CT", "MR"],
    bron: "Bosniak-classificatie versie 2019 (CT)",
    beschrijving: "Feature-gebaseerde classificatie van een cysteuze niermassa (CT). De meest verdachte feature (wand, septa of noduli) bepaalt de klasse. Wanddikte: dun ≤2 mm · minimaal verdikt 3 mm · dik ≥4 mm.",
    triggerKeywords: ["bosniak", "cysteuze niermassa", "niercyste", "renale cyste", "complexe cyste"],
    inputs: [
      { id: "wand", label: "Wand", type: "visual-select", visual: "bosniak-wall",
        opties: [
          { v: "1", l: "Glad, dun (≤2 mm) — mag aankleuren" },
          { v: "iif", l: "Glad, minimaal verdikt (3 mm), aankleurend" },
          { v: "iii", l: "Dik (≥4 mm) of irregulair" },
        ] },
      { id: "septa", label: "Septa", type: "visual-select", visual: "bosniak-septa", default: "0",
        opties: [
          { v: "0", l: "Geen septa" },
          { v: "ii", l: "1–3 dunne (≤2 mm)" },
          { v: "iif4", l: "≥4 dunne (≤2 mm)" },
          { v: "iif3", l: "Glad 3 mm (minimaal verdikt)" },
          { v: "iii", l: "Dik (≥4 mm) of irregulair" },
        ] },
      { id: "nodule", label: "Noduli / protrusies", type: "visual-select", visual: "bosniak-nodule", default: "0",
        opties: [
          { v: "0", l: "Geen" },
          { v: "iii", l: "Obtuus-begrensde ≤3 mm protrusie" },
          { v: "iv", l: "Aankleurend noduul (≥4 mm / scherpe marges)" },
        ] },
      { id: "typeII", label: "Homogene type-II massa (≥70 HU blanco / 21–30 HU PVP / niet-aankleurend >20 HU / te klein te karakteriseren)", type: "checkbox" },
    ],
    compute(v) {
      if (!v.wand) return fout("Selecteer minstens de wandkenmerken.");
      // klasse-rang: I=1, II=2, IIF=2.5, III=3, IV=4 — neem de meest verdachte feature
      let rang = 1;
      const wandR = { "1": 1, "iif": 2.5, "iii": 3 }[v.wand] || 1;
      const septaR = { "0": 1, "ii": 2, "iif4": 2.5, "iif3": 2.5, "iii": 3 }[v.septa] || 1;
      const nodR = { "0": 1, "iii": 3, "iv": 4 }[v.nodule] || 1;
      rang = Math.max(wandR, septaR, nodR, v.typeII ? 2 : 1);
      const klasse = rang >= 4 ? "IV" : rang >= 3 ? "III" : rang >= 2.5 ? "IIF" : rang >= 2 ? "II" : "I";
      const map = {
        I:   { risk: "0% (benigne)", beleid: "Geen follow-up." },
        II:  { risk: "<1%", beleid: "Geen follow-up." },
        IIF: { risk: "~5% (1–10%)", beleid: "Follow-up beeldvorming (bv. 6 mnd, dan jaarlijks tot 5 jaar)." },
        III: { risk: "~50%", beleid: "Urologische verwijzing — resectie/ablatie of actieve surveillance." },
        IV:  { risk: "~90%", beleid: "Urologische verwijzing — behandeling." },
      };
      const m = map[klasse];
      return { ok: true, titel: "Bosniak 2019", klasse: "Bosniak " + klasse,
        items: [{ label: "Klasse", waarde: klasse }, { label: "Maligniteitsrisico", waarde: m.risk }],
        advies: m.beleid,
        tekst: `Cysteuze niermassa, Bosniak ${klasse} (maligniteitsrisico ${m.risk}). ${m.beleid}` };
    },
  });

  CALCULATORS.push({
    id: "o-rads-us",
    naam: "O-RADS US (2022)",
    categorie: "Body — genito-urinair",
    modaliteit: ["ECHO"],
    bron: "O-RADS US v2022 (ACR)",
    beschrijving: "Risicostratificatie van adnexiële laesies (v2022) — gemiddeld-risicopatiënt zonder acute symptomen. Kleurscore CS1 (geen) – CS4 (sterke flow). Meet de grootste enkele diameter.",
    triggerKeywords: ["o-rads", "orads", "adnex", "ovarieel", "ovariële", "adnexiële massa", "ovariumcyste"],
    inputs: [
      { id: "type", label: "Type laesie", type: "select",
        opties: [
          { v: "normaal", l: "Normaal ovarium (geen laesie / follikel ≤3 cm / corpus luteum)" },
          { v: "simple", l: "Simpele cyste" },
          { v: "smooth-uni-bi", l: "Niet-simpele gladde uniloculaire cyste OF gladde biloculaire cyste" },
          { v: "uni-irreg", l: "Uniloculaire irregulaire cyste (geen soliede component)" },
          { v: "bi-irreg", l: "Biloculaire irregulaire cyste (geen soliede component)" },
          { v: "multiloc", l: "Multiloculaire cyste, GEEN soliede component" },
          { v: "uni-solid", l: "Uniloculaire cyste MET soliede component / papillaire projecties" },
          { v: "multi-solid", l: "Bi-/multiloculaire cyste MET soliede component" },
          { v: "solid", l: "Soliede laesie (≥80% solide)" },
          { v: "classic", l: "Klassieke benigne laesie (hemorragisch/dermoid/endometrioom/paraovarieel/peritoneale inclusie/hydrosalpinx)" },
          { v: "ascites", l: "Ascites en/of peritoneale nodulariteit" },
          { v: "incompleet", l: "Incomplete evaluatie" },
        ] },
      { id: "grootte", label: "Grootste diameter", type: "number", eenheid: "cm", min: 0, step: 0.1 },
      { id: "kleur", label: "Kleurscore (CS)", type: "select",
        opties: [{ v: "1", l: "CS1 — geen flow" }, { v: "2", l: "CS2 — minimale flow" }, { v: "3", l: "CS3 — matige flow" }, { v: "4", l: "CS4 — sterke flow" }] },
      { id: "wand", label: "Binnenwand / contour", type: "select", default: "glad",
        opties: [{ v: "glad", l: "Glad" }, { v: "irreg", l: "Irregulaire binnenwand/septa of irregulaire buitencontour" }] },
      { id: "shadowing", label: "Akoestische schaduw (soliede laesie)", type: "select", default: "nee",
        opties: [{ v: "nee", l: "Geen schaduw" }, { v: "ja", l: "Schaduw aanwezig" }] },
      { id: "papillair", label: "Papillaire projecties (uniloculair met soliede component)", type: "select", default: "0",
        opties: [{ v: "0", l: "Geen / n.v.t." }, { v: "1-3", l: "1–3 papillaire projecties" }, { v: "4+", l: "≥4 papillaire projecties" }] },
      { id: "menopauze", label: "Menopauzestatus (voor follow-up)", type: "select", default: "pre",
        opties: [{ v: "pre", l: "Premenopauzaal" }, { v: "post", l: "Postmenopauzaal" }] },
    ],
    compute(v) {
      if (!v.type) return fout("Selecteer het type laesie.");
      const d = num(v.grootte);
      const cs = num(v.kleur);
      const irreg = v.wand === "irreg";
      const shadow = v.shadowing === "ja";
      let cat;
      switch (v.type) {
        case "incompleet": cat = "0"; break;
        case "normaal": cat = "1"; break;
        case "ascites": cat = "5"; break;
        case "simple": cat = (!isNaN(d) && d > 10) ? "3" : "2"; break;
        case "smooth-uni-bi": cat = (!isNaN(d) && d > 10) ? "3" : "2"; break;
        case "classic": cat = (!isNaN(d) && d >= 10) ? "3" : "2"; break;
        case "uni-irreg": cat = "3"; break;                       // uniloculaire irregulaire cyste → 3
        case "bi-irreg": cat = "4"; break;                        // biloculaire irregulaire cyste → 4
        case "multiloc":
          if (irreg || cs === 4 || (!isNaN(d) && d > 10)) cat = "4";
          else cat = "3";                                          // glad, <10 cm, CS1-3 → 3
          break;
        case "uni-solid":
          cat = (v.papillair === "4+") ? "5" : "4";                // ≥4 papillair → 5; 1-3 → 4
          break;
        case "multi-solid":
          cat = (cs >= 3) ? "5" : "4";                             // CS3-4 → 5; CS1-2 → 4
          break;
        case "solid":
          if (irreg) cat = "5";                                    // irregulaire contour → 5
          else if (cs === 4) cat = "5";                            // glad, CS4 → 5
          else if (shadow) cat = "3";                              // glad, schaduw, CS1-3 → 3
          else cat = (cs === 1) ? "3" : "4";                       // glad, non-shadowing: CS1 → 3, CS2-3 → 4
          break;
      }
      if (!cat) return fout("Vul de relevante kenmerken aan.");
      const risk = { "0": "—", "1": "n.v.t.", "2": "<1%", "3": "1–<10%", "4": "10–<50%", "5": "≥50%" }[cat];
      const adv = {
        "0": "Incomplete evaluatie — herhaal/aanvullend onderzoek.",
        "1": "Normaal ovarium — geen actie.",
        "2": "Bijna zeker benigne (<1%) — follow-up afhankelijk van type/grootte/menopauze.",
        "3": "Laag risico (1–<10%) — 6-maanden echografische follow-up; bij soliede laesie verwijzing US-specialist of MRI.",
        "4": "Intermediair risico (10–<50%) — US-specialist of MRI + gynaecoloog met gynaecologisch-oncologische ondersteuning.",
        "5": "Hoog risico (≥50%) — verwijzing gynaecologisch-oncoloog.",
      }[cat];
      // Beknopte follow-up voor categorie 2 (menopauze-afhankelijk)
      let fu = "";
      if (cat === "2" && v.type === "simple" && !isNaN(d)) {
        if (d <= 3) fu = v.menopauze === "post" ? " Geen follow-up." : " Geen follow-up (O-RADS 1-equivalent).";
        else if (d <= 5) fu = v.menopauze === "post" ? " 1-jaar follow-up echo." : " Geen follow-up.";
        else fu = " 1-jaar follow-up echo.";
      }
      return { ok: true, titel: "O-RADS US v2022", klasse: "O-RADS " + cat,
        items: [{ label: "Categorie", waarde: cat }, { label: "Maligniteitsrisico", waarde: risk }],
        advies: adv + fu,
        tekst: `Adnexiële laesie, O-RADS US ${cat} (risico ${risk}).${!isNaN(d) ? " Grootste diameter " + r1(d) + " cm." : ""} ${adv}${fu}`.trim() };
    },
  });

  CALCULATORS.push({
    id: "pi-rads",
    naam: "PI-RADS v2.1 (prostaat-MRI)",
    categorie: "Body — genito-urinair",
    modaliteit: ["MR"],
    bron: "PI-RADS v2.1",
    beschrijving: "PI-RADS-assessmentcategorie. PZ: DWI/ADC dominant (DCE-positief tilt DWI 3 → 4). TZ: T2WI dominant (DWI=5 tilt T2 3 → 4). Score 5 = zoals 4 maar ≥1,5 cm of duidelijke extraprostatische extensie.",
    triggerKeywords: ["pi-rads", "pirads", "prostaat mri", "prostaatkanker", "mpmri prostaat", "prostaatcarcinoom"],
    inputs: [
      { id: "zone", label: "Zone van de laesie", type: "select",
        opties: [{ v: "pz", l: "Perifere zone (PZ) — DWI/ADC dominant" }, { v: "tz", l: "Transitiezone (TZ) — T2WI dominant" }] },
      { id: "dwi", label: "DWI/ADC-score (perifere zone)", type: "select",
        opties: [
          { v: "1", l: "1 — DWI/ADC normaal" },
          { v: "2", l: "2 — onscherp hypointens (indistinct)" },
          { v: "3", l: "3 — ADC focaal mild/matig hypointens, DWI iso/mild hyperintens" },
          { v: "4", l: "4 — ADC focaal duidelijk hypointens, DWI duidelijk hyperintens (<1,5 cm)" },
          { v: "5", l: "5 — zoals 4 maar ≥1,5 cm of duidelijke EPE" },
        ] },
      { id: "dce", label: "DCE (enkel PZ, relevant bij DWI=3)", type: "select", default: "neg",
        opties: [{ v: "neg", l: "Negatief (DCE−)" }, { v: "pos", l: "Positief (DCE+, focale vroege enhancement)" }] },
      { id: "t2", label: "T2WI-score (transitiezone)", type: "select",
        opties: [
          { v: "1", l: "1 — normaal" },
          { v: "2", l: "2 — omschreven hypointens of heterogeen ingekapseld noduul (BPH)" },
          { v: "3", l: "3 — heterogeen signaal met onscherpe marges (valt niet in andere categorie)" },
          { v: "4", l: "4 — lenticulair/niet-omschreven, homogeen matig hypointens, <1,5 cm" },
          { v: "5", l: "5 — zoals 4 maar ≥1,5 cm of duidelijke EPE" },
        ] },
      { id: "dwiTz", label: "DWI-score (enkel TZ, relevant bij T2=3)", type: "select", default: "",
        opties: [{ v: "", l: "n.v.t." }, { v: "le4", l: "DWI ≤4" }, { v: "5", l: "DWI = 5" }] },
    ],
    compute(v) {
      let cat;
      if (v.zone === "pz") {
        const d = num(v.dwi);
        if (isNaN(d)) return fout("Geef de DWI-score in.");
        cat = d;
        if (d === 3 && v.dce === "pos") cat = 4; // DCE-positief upgradet PZ DWI3 → 4
      } else if (v.zone === "tz") {
        const t = num(v.t2);
        if (isNaN(t)) return fout("Geef de T2-score in.");
        cat = t;
        if (t === 3) cat = (v.dwiTz === "5") ? 4 : 3; // T2=3 + DWI≥5 → 4
      } else return fout("Selecteer de zone.");
      const adv = { 1: "Zeer laag — klinisch significante kanker hoogst onwaarschijnlijk.", 2: "Laag — onwaarschijnlijk.", 3: "Intermediair — equivocaal.", 4: "Hoog — waarschijnlijk; biopsie overwegen.", 5: "Zeer hoog — zeer waarschijnlijk; biopsie." };
      return { ok: true, titel: "PI-RADS v2.1", klasse: "PI-RADS " + cat,
        items: [{ label: "Zone", waarde: v.zone === "pz" ? "PZ" : "TZ" }, { label: "Assessmentcategorie", waarde: String(cat) }],
        advies: adv[cat] || null,
        tekst: `Prostaatlaesie in ${v.zone === "pz" ? "perifere zone" : "transitiezone"}, PI-RADS ${cat}. ${adv[cat] || ""}`.trim() };
    },
  });

  CALCULATORS.push({
    id: "renal-nephrometry",
    naam: "RENAL nefrometrie-score",
    categorie: "Body — genito-urinair",
    modaliteit: ["CT", "MR"],
    bron: "RENAL Nephrometry Score (Kutikov 2009)",
    beschrijving: "Complexiteit van een niertumor (R-E-N-L) → laag/matig/hoog complex.",
    triggerKeywords: ["renal score", "nefrometrie", "nephrometry", "niertumor", "renaal carcinoom", "niermassa"],
    inputs: [
      { id: "R", label: "R — maximale diameter", type: "select",
        opties: [{ v: "1", l: "≤4 cm (1)" }, { v: "2", l: ">4–7 cm (2)" }, { v: "3", l: ">7 cm (3)" }] },
      { id: "E", label: "E — exofytisch/endofytisch", type: "select",
        opties: [{ v: "1", l: "≥50% exofytisch (1)" }, { v: "2", l: "<50% exofytisch (2)" }, { v: "3", l: "Volledig endofytisch (3)" }] },
      { id: "N", label: "N — nabijheid verzamelsysteem/sinus", type: "select",
        opties: [{ v: "1", l: "≥7 mm (1)" }, { v: "2", l: ">4–<7 mm (2)" }, { v: "3", l: "≤4 mm (3)" }] },
      { id: "L", label: "L — locatie t.o.v. poollijnen", type: "select",
        opties: [{ v: "1", l: "Volledig boven/onder poollijn (1)" }, { v: "2", l: "Kruist poollijn (2)" }, { v: "3", l: ">50% kruist as / tussen poollijnen (3)" }] },
      { id: "A", label: "Suffix — ligging", type: "select", default: "x",
        opties: [{ v: "a", l: "Anterieur (a)" }, { v: "p", l: "Posterieur (p)" }, { v: "x", l: "Onbepaald (x)" }] },
      { id: "h", label: "Hilaire tumor (h-suffix)", type: "checkbox" },
    ],
    compute(v) {
      const parts = ["R", "E", "N", "L"].map((k) => num(v[k]));
      if (parts.some(isNaN)) return fout("Selecteer R, E, N en L.");
      const sum = parts.reduce((a, b) => a + b, 0);
      const suffix = (v.A || "x") + (v.h ? "h" : "");
      let cx;
      if (sum <= 6) cx = "laag complex (4–6)";
      else if (sum <= 9) cx = "matig complex (7–9)";
      else cx = "hoog complex (10–12)";
      return { ok: true, titel: "RENAL nefrometrie", klasse: sum + suffix + " — " + cx,
        items: [{ label: "Totaalscore", waarde: sum + " (" + suffix + ")" }, { label: "Complexiteit", waarde: cx }],
        advies: null,
        tekst: `RENAL nefrometrie-score ${sum}${suffix} — ${cx}.` };
    },
  });

  /* ==========================================================================
   * CARDIOTHORACAAL
   * ======================================================================== */

  CALCULATORS.push({
    id: "fleischner-2017",
    naam: "Fleischner 2017 (pulmonale noduli)",
    categorie: "Cardiothoracaal",
    modaliteit: ["CT"],
    bron: "Fleischner Society 2017",
    beschrijving: "Follow-up van incidentele pulmonale noduli (≥35 jaar, geen screening/immuun­compromis/maligniteit).",
    triggerKeywords: ["noduul", "nodulus", "nodule", "fleischner", "pulmonale nodus", "longnodul", "micronodul", "matglas", "ground glass", "ggn"],
    inputs: [
      { id: "type", label: "Type nodulus", type: "select",
        opties: [{ v: "solid", l: "Solide" }, { v: "ggn", l: "Pure matglasnodus (GGN)" }, { v: "partsolid", l: "Deels solide (part-solid)" }] },
      { id: "aantal", label: "Aantal", type: "select", opties: [{ v: "single", l: "Solitair" }, { v: "multiple", l: "Multipel" }] },
      { id: "grootte", label: "Gemiddelde diameter", type: "number", eenheid: "mm", min: 0, step: 0.1 },
      { id: "risico", label: "Risicoprofiel", type: "select", opties: [{ v: "laag", l: "Laag risico" }, { v: "hoog", l: "Hoog risico" }] },
    ],
    compute(v) {
      const d = num(v.grootte);
      if (isNaN(d)) return fout("Geef de diameter in.");
      const hoog = v.risico === "hoog";
      const mult = v.aantal === "multiple";
      let advies = "";
      if (v.type === "solid") {
        if (d < 6) advies = hoog ? "Geen routine follow-up; bij hoog risico optioneel CT na 12 mnd." : "Geen routine follow-up.";
        else if (d <= 8) advies = mult ? "CT na 3–6 mnd, dan na 18–24 mnd." : "CT na 6–12 mnd, dan na 18–24 mnd.";
        else advies = mult ? "CT na 3–6 mnd, dan na 18–24 mnd." : "CT na 3 mnd, PET-CT of biopsie overwegen.";
      } else if (v.type === "ggn") {
        if (d < 6) advies = "Geen routine follow-up.";
        else advies = "CT na 6–12 mnd, dan om de 2 jaar tot 5 jaar.";
      } else { // part-solid
        if (d < 6) advies = "Geen routine follow-up.";
        else advies = "CT na 3–6 mnd; bij persistentie en solide component ≥6 mm sterk verdacht — PET-CT/biopsie/resectie.";
      }
      const typeL = { solid: "solide", ggn: "pure matglas", partsolid: "deels solide" }[v.type];
      return { ok: true, titel: "Fleischner 2017", klasse: null,
        items: [
          { label: "Type", waarde: typeL + (mult ? ", multipel" : ", solitair") },
          { label: "Diameter", waarde: r1(d) + " mm" },
          { label: "Risico", waarde: hoog ? "hoog" : "laag" },
        ],
        advies,
        tekst: `${mult ? "Multipele" : "Solitaire"} ${typeL} pulmonale nodulus van ${r1(d)} mm (${hoog ? "hoog" : "laag"} risico). Fleischner 2017: ${advies}` };
    },
  });

  CALCULATORS.push({
    id: "lung-rads-2022",
    naam: "Lung-RADS v2022",
    categorie: "Cardiothoracaal",
    modaliteit: ["CT"],
    bron: "ACR Lung-RADS v2022",
    beschrijving: "Auto-classificatie bij low-dose CT longkankerscreening op basis van noduletype, status (baseline/nieuw/groeiend) en grootte. Grootte = gemiddelde van lange en korte as. Groei = >1,5 mm toename per 12 mnd.",
    triggerKeywords: ["lung-rads", "lungrads", "longkankerscreening", "lcs", "low-dose ct", "screening long"],
    inputs: [
      { id: "type", label: "Noduletype / bevinding", type: "visual-select", visual: "lungrads-type",
        opties: [
          { v: "geen", l: "Geen nodulus / duidelijk benigne (volledige/centrale/popcorn/concentrische calcificatie of vet)" },
          { v: "solid", l: "Solide nodulus" },
          { v: "partsolid", l: "Deels solide (part-solid) nodulus" },
          { v: "nonsolid", l: "Niet-solide / matglas (GGN)" },
          { v: "airway", l: "Airway nodulus (endobronchiaal)" },
          { v: "cyst", l: "Atypische longcyste" },
          { v: "incompleet", l: "Incompleet / infectie-inflammatie / geen vergelijking" },
        ] },
      { id: "status", label: "Status", type: "select", default: "baseline",
        opties: [{ v: "baseline", l: "Baseline (eerste screening)" }, { v: "nieuw", l: "Nieuw" }, { v: "groeiend", l: "Groeiend (>1,5 mm/12 mnd)" }, { v: "stabiel", l: "Stabiel / onveranderd" }] },
      { id: "diam", label: "Gemiddelde diameter (totaal)", type: "number", eenheid: "mm", min: 0, step: 0.1, help: "Gemiddelde van lange + korte as (solide/part-solid/GGN)" },
      { id: "solidcomp", label: "Solide component (enkel part-solid)", type: "number", eenheid: "mm", min: 0, step: 0.1 },
      { id: "juxtapleuraal", label: "Juxtapleurale typische lymfeklier (<10 mm, glad, ovaal/lentiform/triangulair)", type: "checkbox" },
      { id: "airwayLoc", label: "Airway-locatie (enkel airway nodulus)", type: "select",
        opties: [{ v: "subseg", l: "Subsegmentaal" }, { v: "segproximaal", l: "Segmentaal of meer proximaal" }] },
      { id: "cystFeat", label: "Cyste-kenmerk (enkel atypische cyste)", type: "select",
        opties: [
          { v: "enlarging", l: "Vergrotende cysteuze component (dikwandig)" },
          { v: "thickmulti", l: "Dikwandig OF multiloculair (baseline)" },
          { v: "progress", l: "Toenemende wanddikte/nodulariteit OF groeiend multiloculair" },
        ] },
      { id: "x", label: "Additionele maligne kenmerken (spiculatie, GGN-verdubbeling in 1 jaar, vergrote regionale klieren) → 4X", type: "checkbox" },
      { id: "s", label: "Klinisch (potentieel) significante niet-longkanker bevinding (modifier S)", type: "checkbox" },
    ],
    compute(v) {
      if (!v.type) return fout("Selecteer het noduletype.");
      if (v.type === "incompleet") return mkLR("0", { s: v.s });
      if (v.type === "geen") return mkLR("1", { s: v.s });
      if (v.juxtapleuraal) return mkLR("2", { s: v.s, note: "juxtapleurale typische intrapulmonale lymfeklier" });
      const d = num(v.diam);
      const sc = num(v.solidcomp);
      const baseline = v.status === "baseline" || v.status === "stabiel";
      const nieuwOfGroei = v.status === "nieuw" || v.status === "groeiend";
      let cat;
      if (v.type === "airway") {
        if (v.airwayLoc === "subseg") cat = "2";
        else cat = baseline ? "4A" : "4B"; // segmentaal/proximaal: baseline 4A; stabiel/groeiend 4B
      } else if (v.type === "cyst") {
        cat = v.cystFeat === "enlarging" ? "3" : (v.cystFeat === "thickmulti" ? "4A" : "4B");
      } else if (v.type === "solid") {
        if (isNaN(d)) return fout("Geef de diameter in.");
        if (v.status === "groeiend") cat = d < 8 ? "4A" : "4B";
        else if (baseline) { if (d < 6) cat = "2"; else if (d < 8) cat = "3"; else if (d < 15) cat = "4A"; else cat = "4B"; }
        else { if (d < 4) cat = "2"; else if (d < 6) cat = "3"; else if (d < 8) cat = "4A"; else cat = "4B"; } // nieuw
      } else if (v.type === "partsolid") {
        if (isNaN(d)) return fout("Geef de totale diameter in.");
        if (baseline) {
          if (d < 6) cat = "2";
          else if (isNaN(sc) || sc < 6) cat = "3";
          else if (sc < 8) cat = "4A";
          else cat = "4B";
        } else { // nieuw of groeiend
          if (d < 6 && (isNaN(sc) || sc === 0)) cat = "3";
          else if (isNaN(sc) || sc < 4) cat = "4A";
          else cat = "4B";
        }
      } else { // nonsolid / GGN
        if (isNaN(d)) return fout("Geef de diameter in.");
        if (d < 30) cat = "2";
        else cat = (v.status === "stabiel") ? "2" : "3"; // ≥30: stabiel/traag → 2; baseline/nieuw/groeiend → 3
      }
      // 4X: cat 3 of 4 met additionele verdachte kenmerken
      if (v.x && (cat === "3" || cat === "4A" || cat === "4B")) cat = "4X";
      return mkLR(cat, { d, sc, type: v.type, s: v.s });

      function mkLR(cat, info) {
        const adv = {
          "0": "Aanvullend onderzoek / vergelijking met eerdere CT.",
          "1": "Jaarlijkse LDCT (12 maanden).",
          "2": "Jaarlijkse LDCT (12 maanden).",
          "3": "LDCT na 6 maanden.",
          "4A": "LDCT na 3 maanden; PET-CT overwegen bij solide component ≥8 mm.",
          "4B": "Weefseldiagnose en/of PET-CT; klinische evaluatie.",
          "4X": "Verdacht met additionele kenmerken — weefseldiagnose en/of PET-CT.",
        };
        const risk = { "0": "—", "1": "<1%", "2": "<1%", "3": "1–2%", "4A": "5–15%", "4B": ">15%", "4X": ">15%" };
        const sMod = (info && info.s) ? " S" : "";
        const hasD = info && !isNaN(info.d) && (info.type === "solid" || info.type === "partsolid" || info.type === "nonsolid");
        const items = [{ label: "Categorie", waarde: "Lung-RADS " + cat + sMod }, { label: "Maligniteitsrisico", waarde: risk[cat] }];
        if (hasD) items.splice(1, 0, { label: "Diameter", waarde: r1(info.d) + " mm" + (!isNaN(info.sc) ? " (solide " + r1(info.sc) + " mm)" : "") });
        if (info && info.note) items.push({ label: "Opmerking", waarde: info.note });
        return { ok: true, titel: "Lung-RADS v2022", klasse: "Lung-RADS " + cat + sMod,
          items, advies: adv[cat],
          tekst: `Lung-RADS ${cat}${sMod}${hasD ? ` (${r1(info.d)} mm${!isNaN(info.sc) ? ", solide component " + r1(info.sc) + " mm" : ""})` : ""}${info && info.note ? " — " + info.note : ""}. ${adv[cat]}` };
      }
    },
  });

  CALCULATORS.push({
    id: "cad-rads-2022",
    naam: "CAD-RADS 2.0 (2022)",
    categorie: "Cardiothoracaal",
    modaliteit: ["CT"],
    bron: "CAD-RADS 2.0 (2022, JACC/SCCT)",
    beschrijving: "Coronaire stenosegradering op coronaire CTA met 4A/4B-onderscheid, categorie N (niet-diagnostisch) en modifiers (P plaqueburden, HRP, I ischemie, S stent, G graft, E exceptie). Interpretatie/management in de context van acute pijn op de borst (ACS).",
    triggerKeywords: ["cad-rads", "cadrads", "coronaire cta", "ccta", "coronair", "kransslagader", "stenose coronair"],
    inputs: [
      { id: "cat", label: "Maximale coronaire stenose", type: "select",
        opties: [
          { v: "0", l: "0% — geen plaque (CAD-RADS 0)" },
          { v: "1", l: "1–24% — minimaal (1)" },
          { v: "2", l: "25–49% — mild (2)" },
          { v: "3", l: "50–69% — matig (3)" },
          { v: "4A", l: "70–99% — ernstig (4A)" },
          { v: "4B", l: "Linker hoofdstam ≥50% of 3-takslijden (4B)" },
          { v: "5", l: "100% — totale occlusie (5)" },
          { v: "N", l: "Niet-diagnostisch (N)" },
        ] },
      { id: "P", label: "Plaqueburden (modifier P)", type: "select", default: "",
        opties: [{ v: "", l: "Niet bepaald" }, { v: "P1", l: "P1 — licht" }, { v: "P2", l: "P2 — matig" }, { v: "P3", l: "P3 — uitgebreid" }, { v: "P4", l: "P4 — extensief" }] },
      { id: "hrp", label: "Hoog-risico plaque (HRP)", type: "checkbox" },
      { id: "i", label: "Ischemie (I+, bv. CT-FFR/perfusie positief)", type: "checkbox" },
      { id: "s", label: "Stent aanwezig (S)", type: "checkbox" },
      { id: "g", label: "Bypassgraft aanwezig (G)", type: "checkbox" },
      { id: "e", label: "Exceptie / niet-atherosclerotisch (E)", type: "checkbox" },
    ],
    compute(v) {
      if (!v.cat) return fout("Selecteer de stenosecategorie.");
      const c = v.cat;
      const info = {
        "0":  { sten: "0%", interp: "ACS hoogst onwaarschijnlijk", mgmt: "Geruststelling; geen verdere cardiale work-up." },
        "1":  { sten: "1–24%", interp: "ACS onwaarschijnlijk", mgmt: "Ambulante follow-up voor risicofactor-modificatie en preventieve farmacotherapie (P3/P4: agressief)." },
        "2":  { sten: "25–49%", interp: "ACS minder waarschijnlijk", mgmt: "Geen verdere ACS-evaluatie vereist; preventie. Bij hoge klinische verdenking, Tn+ of HRP: overweeg opname + cardiologie." },
        "3":  { sten: "50–69%", interp: "ACS mogelijk", mgmt: "Overweeg opname + cardiologisch consult; functionele evaluatie. Bij I+: overweeg ICA. Preventieve (agressieve) farmacotherapie." },
        "4A": { sten: "70–99%", interp: "ACS waarschijnlijk", mgmt: "Opname + cardiologisch consult; overweeg ICA of functionele evaluatie. Agressieve preventie ± revascularisatie." },
        "4B": { sten: "LH ≥50% of 3-takslijden", interp: "ACS waarschijnlijk", mgmt: "Opname + cardiologisch consult; ICA aanbevolen. Agressieve preventie ± revascularisatie." },
        "5":  { sten: "100% occlusie", interp: "ACS zeer waarschijnlijk", mgmt: "Opname + cardiologisch consult; versnelde ICA en revascularisatie bij verdenking acute occlusie." },
        "N":  { sten: "niet-diagnostisch", interp: "ACS kan niet uitgesloten worden", mgmt: "Aanvullende of alternatieve evaluatie voor ACS nodig." },
      }[c];
      // modifier-string
      const mods = [];
      if (v.P) mods.push(v.P);
      if (v.hrp) mods.push("HRP");
      if (v.i) mods.push("I+");
      if (v.s) mods.push("S");
      if (v.g) mods.push("G");
      if (v.e) mods.push("E");
      const modStr = mods.length ? "/" + mods.join("/") : "";
      return { ok: true, titel: "CAD-RADS 2.0", klasse: "CAD-RADS " + c + modStr,
        items: [
          { label: "Categorie", waarde: "CAD-RADS " + c + modStr },
          { label: "Maximale stenose", waarde: info.sten },
          { label: "Interpretatie", waarde: info.interp },
        ],
        advies: info.mgmt,
        tekst: `CAD-RADS ${c}${modStr} (${info.sten}) — ${info.interp}. ${info.mgmt}` };
    },
  });

  /* ==========================================================================
   * EMERGENCY — TRAUMA (AAST 2018)
   * ======================================================================== */

  function aastCalc(cfg) {
    return {
      id: cfg.id, naam: cfg.naam, categorie: "Emergency — trauma (AAST)",
      modaliteit: ["CT"], bron: "AAST Organ Injury Scale 2018",
      beschrijving: cfg.beschrijving, triggerKeywords: cfg.keywords,
      inputs: [{ id: "graad", label: "AAST-graad", type: "select", opties: cfg.opties }],
      compute(v) {
        if (!v.graad) return fout("Selecteer de AAST-graad.");
        const label = (cfg.opties.find((o) => o.v === v.graad) || {}).l || v.graad;
        const hoog = ["IV", "V"].includes(v.graad);
        return { ok: true, titel: cfg.naam, klasse: "AAST graad " + v.graad,
          items: [{ label: "Graad", waarde: v.graad }, { label: "Criterium", waarde: label.replace(/^[IVX]+ — /, "") }],
          advies: hoog ? "Hooggradig letsel — overleg traumachirurgie/interventieradiologie." : null,
          tekst: `${cfg.orgaan}letsel, AAST graad ${v.graad}: ${label.replace(/^[IVX]+ — /, "")}.` };
      },
    };
  }

  CALCULATORS.push(aastCalc({
    id: "aast-liver", naam: "Levertrauma (AAST)", orgaan: "Lever",
    beschrijving: "AAST 2018 gradering van levertrauma op CT.",
    keywords: ["levertrauma", "leverletsel", "liver trauma", "leverlaceratie", "leverruptuur"],
    opties: [
      { v: "I", l: "I — subcapsulair hematoom <10% oppervlak; laceratie <1 cm diep" },
      { v: "II", l: "II — subcapsulair 10–50%; intraparenchymateus <10 cm; laceratie 1–3 cm diep" },
      { v: "III", l: "III — subcapsulair >50% of ruptuur; intraparenchymateus ≥10 cm; laceratie >3 cm; vasculair letsel binnen lever / actieve bloeding" },
      { v: "IV", l: "IV — parenchymdisruptie 25–75% van een lob; actieve bloeding tot in peritoneum" },
      { v: "V", l: "V — parenchymdisruptie >75% van een lob; juxtahepatisch veneus letsel" },
    ],
  }));

  CALCULATORS.push(aastCalc({
    id: "aast-spleen", naam: "Milttrauma (AAST)", orgaan: "Milt",
    beschrijving: "AAST 2018 gradering van milttrauma op CT.",
    keywords: ["milttrauma", "miltletsel", "spleen trauma", "miltlaceratie", "miltruptuur"],
    opties: [
      { v: "I", l: "I — subcapsulair hematoom <10%; laceratie <1 cm diep" },
      { v: "II", l: "II — subcapsulair 10–50%; intraparenchymateus <5 cm; laceratie 1–3 cm" },
      { v: "III", l: "III — subcapsulair >50% of ruptuur; intraparenchymateus ≥5 cm; laceratie >3 cm" },
      { v: "IV", l: "IV — vasculair letsel / actieve bloeding binnen capsule; devascularisatie >25%" },
      { v: "V", l: "V — versplinterde milt; actieve bloeding tot in peritoneum; hilair vasculair letsel met devascularisatie" },
    ],
  }));

  CALCULATORS.push(aastCalc({
    id: "aast-kidney", naam: "Niertrauma (AAST)", orgaan: "Nier",
    beschrijving: "AAST 2018 gradering van niertrauma op CT.",
    keywords: ["niertrauma", "nierletsel", "kidney trauma", "nierlaceratie", "renaal trauma"],
    opties: [
      { v: "I", l: "I — contusie en/of subcapsulair hematoom, geen laceratie" },
      { v: "II", l: "II — perirenaal hematoom binnen Gerota; laceratie ≤1 cm zonder urine-extravasatie" },
      { v: "III", l: "III — laceratie >1 cm zonder collectorsysteemruptuur; vasculair letsel/bloeding binnen Gerota" },
      { v: "IV", l: "IV — laceratie tot in collectorsysteem met urine-extravasatie; segmentaal vaatletsel/infarct; bloeding voorbij Gerota" },
      { v: "V", l: "V — versplinterde nier; hoofdvaatletsel/avulsie hilus; gedevasculariseerde nier" },
    ],
  }));

  /* ==========================================================================
   * EMERGENCY / NEURO — AO SPINE
   * ======================================================================== */

  const AO_TL_OPTS = [
    { v: "A0", l: "A0 — geen/klinisch insignificante fractuur (proc. transversus/spinosus)" },
    { v: "A1", l: "A1 — wig-impactie, één eindplaat, geen achterwand" },
    { v: "A2", l: "A2 — split/pincer, beide eindplaten, geen achterwand" },
    { v: "A3", l: "A3 — incomplete burst (één eindplaat, achterwand)" },
    { v: "A4", l: "A4 — complete burst (beide eindplaten, achterwand)" },
    { v: "B1", l: "B1 — transossale tension band (Chance)" },
    { v: "B2", l: "B2 — posterieure ligamentaire tension band-disruptie" },
    { v: "B3", l: "B3 — hyperextensie (anterieure disruptie)" },
    { v: "C", l: "C — translatie/dislocatie in elk vlak" },
  ];
  CALCULATORS.push({
    id: "ao-spine-tl",
    naam: "AO Spine (thoracolumbaal)",
    categorie: "Emergency — trauma (AAST)",
    modaliteit: ["CT", "MR", "RX"],
    bron: "AO Spine Thoracolumbar Injury Classification System",
    beschrijving: "Morfologische classificatie van thoracolumbale wervelfracturen (type A compressie / B distractie / C translatie + subtype), met optionele neurologische (N) en case-specifieke (M) modifiers.",
    triggerKeywords: ["ao spine", "wervelfractuur", "burst fractuur", "compressiefractuur", "thoracolumbaal", "vertebrale fractuur"],
    inputs: [
      { id: "type", label: "Morfologisch type / subtype", type: "visual-select", visual: "aospine-tl", opties: AO_TL_OPTS },
      { id: "n", label: "Neurologische modifier (N)", type: "select", default: "",
        opties: [
          { v: "", l: "Niet gescoord" },
          { v: "N0", l: "N0 — neurologisch intact" },
          { v: "N1", l: "N1 — voorbijgaand neurologisch deficit (hersteld)" },
          { v: "N2", l: "N2 — radiculaire symptomen" },
          { v: "N3", l: "N3 — incompleet ruggenmerg- of cauda-equina-letsel" },
          { v: "N4", l: "N4 — compleet ruggenmergletsel" },
          { v: "NX", l: "NX — niet beoordeelbaar" },
        ] },
      { id: "m1", label: "M1 — onbepaald/letsel van posterieur ligamentair complex (PLC) op MRI", type: "checkbox" },
      { id: "m2", label: "M2 — patiënt-specifieke comorbiditeit (bv. DISH, ankylose, osteoporose)", type: "checkbox" },
    ],
    compute(v) {
      if (!v.type) return fout("Selecteer type/subtype.");
      const label = (AO_TL_OPTS.find((o) => o.v === v.type) || {}).l || v.type;
      const ernstig = v.type === "C" || v.type.startsWith("B") || v.type === "A4";
      const mods = [];
      if (v.n) mods.push(v.n);
      if (v.m1) mods.push("M1");
      if (v.m2) mods.push("M2");
      const modStr = mods.length ? " " + mods.join(" ") : "";
      const ernstigN = ["N3", "N4"].includes(v.n);
      return { ok: true, titel: "AO Spine (TL)", klasse: "AO Spine " + v.type + modStr,
        items: [
          { label: "Classificatie", waarde: label },
          ...(mods.length ? [{ label: "Modifiers", waarde: mods.join(", ") }] : []),
        ],
        advies: (ernstig || ernstigN) ? "Potentieel instabiel en/of neurologisch letsel — chirurgisch advies." : (v.m1 ? "Mogelijk PLC-letsel (M1) — overleg/aanvullende evaluatie." : null),
        tekst: `Thoracolumbale fractuur, AO Spine ${v.type}${modStr} (${label.replace(/^[A-C0-9]+ — /, "")}).` };
    },
  });

  const AO_UC = {
    I:   { naam: "Occipitale condyl / craniocervicale overgang",
           A: "geïsoleerd benig letsel (condyl)",
           B: "niet-verplaatst ligamentair letsel (craniocervicaal)",
           C: "elk letsel met verplaatsing op beeldvorming" },
    II:  { naam: "C1-ring en C1–2 gewricht",
           A: "geïsoleerd benig letsel (boog)",
           B: "ligamentair letsel (lig. transversum atlantis)",
           C: "atlanto-axiale instabiliteit / translatie in elk vlak" },
    III: { naam: "C2 en C2–3 gewricht",
           A: "enkel benig letsel, zonder ligamentair/tension band/discaal letsel",
           B: "tension band / ligamentair letsel met of zonder benig letsel",
           C: "elk letsel dat leidt tot wervellichaamtranslatie in elk vlak" },
  };
  CALCULATORS.push({
    id: "ao-spine-uc",
    naam: "AO Spine (hoog-cervicaal / C0–C2)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR", "RX"],
    bron: "AO Spine Upper Cervical Injury Classification System",
    beschrijving: "Classificatie van hoog-cervicale letsels per regio (I occipitale condyl/craniocervicaal · II C1-ring/C1–2 · III C2/C2–3) en type (A benig · B ligamentair · C translatie/verplaatsing).",
    triggerKeywords: ["ao spine", "occipitale condyl", "craniocervicaal", "atlas", "axis", "c1", "c2", "densfractuur", "atlanto-axiaal", "hoog-cervicaal"],
    inputs: [
      { id: "regio", label: "Regio", type: "select",
        opties: [
          { v: "I", l: "I — occipitale condyl / craniocervicale overgang" },
          { v: "II", l: "II — C1-ring en C1–2 gewricht" },
          { v: "III", l: "III — C2 en C2–3 gewricht" },
        ] },
      { id: "type", label: "Type", type: "select",
        opties: [
          { v: "A", l: "A — benig letsel" },
          { v: "B", l: "B — ligamentair letsel" },
          { v: "C", l: "C — translatie / verplaatsing" },
        ] },
      { id: "n", label: "Neurologische modifier (N)", type: "select", default: "",
        opties: [
          { v: "", l: "Niet gescoord" },
          { v: "N0", l: "N0 — neurologisch intact" },
          { v: "N1", l: "N1 — voorbijgaand deficit (hersteld)" },
          { v: "N2", l: "N2 — radiculaire symptomen" },
          { v: "N3", l: "N3 — incompleet ruggenmerg-/cauda-letsel" },
          { v: "N4", l: "N4 — compleet ruggenmergletsel" },
          { v: "NX", l: "NX — niet beoordeelbaar" },
        ] },
    ],
    compute(v) {
      if (!v.regio || !v.type) return fout("Selecteer regio en type.");
      const reg = AO_UC[v.regio];
      const beschrijving = reg[v.type];
      const code = v.regio + v.type;
      const nStr = v.n ? " " + v.n : "";
      const ernstig = v.type === "C" || ["N3", "N4"].includes(v.n);
      return { ok: true, titel: "AO Spine (hoog-cervicaal)", klasse: "AO Spine " + code + nStr,
        items: [
          { label: "Regio", waarde: v.regio + " — " + reg.naam },
          { label: "Type", waarde: code + " — " + beschrijving },
          ...(v.n ? [{ label: "Neurologie", waarde: v.n }] : []),
        ],
        advies: ernstig ? "Potentieel instabiel en/of neurologisch letsel — chirurgisch/spine-advies." : null,
        tekst: `Hoog-cervicaal letsel, AO Spine ${code}${nStr} (${reg.naam}: ${beschrijving}).` };
    },
  });

  const AO_SUB_OPTS = [
    { v: "A0", l: "A0 — geen/klinisch insignificante fractuur" },
    { v: "A1", l: "A1 — wig-impactie" },
    { v: "A2", l: "A2 — split" },
    { v: "A3", l: "A3 — incomplete burst" },
    { v: "A4", l: "A4 — complete burst" },
    { v: "B1", l: "B1 — posterieure tension band, benig" },
    { v: "B2", l: "B2 — posterieure tension band, (capsulo)ligamentair" },
    { v: "B3", l: "B3 — anterieure tension band" },
    { v: "C", l: "C — translatie/dislocatie in elke richting" },
    { v: "F1", l: "F1 — niet-verplaatste facetfractuur" },
    { v: "F2", l: "F2 — facetfractuur met instabiliteitspotentieel" },
    { v: "F3", l: "F3 — floating lateral mass" },
    { v: "F4", l: "F4 — pathologische subluxatie of perched/geluxeerd facet" },
  ];
  CALCULATORS.push({
    id: "ao-spine-subaxial",
    naam: "AO Spine (subaxiaal cervicaal / C3–C7)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR", "RX"],
    bron: "AO Spine Subaxial Cervical Injury Classification System",
    beschrijving: "Classificatie van subaxiale cervicale letsels (C3–C7): type A compressie, B tension band, C translatie, F facetletsel; BL-modifier voor bilateraal facetletsel; optionele N-modifier.",
    triggerKeywords: ["ao spine", "subaxiaal", "cervicale fractuur", "facetfractuur", "facet", "wervelfractuur", "c3", "c4", "c5", "c6", "c7"],
    inputs: [
      { id: "type", label: "Type / subtype", type: "visual-select", visual: "aospine-subaxial", opties: AO_SUB_OPTS },
      { id: "bl", label: "BL — bilateraal letsel (bv. bilateraal facet)", type: "checkbox" },
      { id: "n", label: "Neurologische modifier (N)", type: "select", default: "",
        opties: [
          { v: "", l: "Niet gescoord" },
          { v: "N0", l: "N0 — neurologisch intact" },
          { v: "N1", l: "N1 — voorbijgaand deficit (hersteld)" },
          { v: "N2", l: "N2 — radiculaire symptomen" },
          { v: "N3", l: "N3 — incompleet ruggenmerg-/cauda-letsel" },
          { v: "N4", l: "N4 — compleet ruggenmergletsel" },
          { v: "NX", l: "NX — niet beoordeelbaar" },
        ] },
    ],
    compute(v) {
      if (!v.type) return fout("Selecteer type/subtype.");
      const label = (AO_SUB_OPTS.find((o) => o.v === v.type) || {}).l || v.type;
      const mods = [];
      if (v.bl) mods.push("BL");
      if (v.n) mods.push(v.n);
      const modStr = mods.length ? " " + mods.join(" ") : "";
      const ernstig = v.type === "C" || v.type.startsWith("B") || v.type === "A4" || ["F3", "F4"].includes(v.type) || ["N3", "N4"].includes(v.n) || v.bl;
      return { ok: true, titel: "AO Spine (subaxiaal)", klasse: "AO Spine " + v.type + modStr,
        items: [
          { label: "Classificatie", waarde: label },
          ...(mods.length ? [{ label: "Modifiers", waarde: mods.join(", ") }] : []),
        ],
        advies: ernstig ? "Potentieel instabiel en/of neurologisch letsel — chirurgisch/spine-advies." : null,
        tekst: `Subaxiaal cervicaal letsel, AO Spine ${v.type}${modStr} (${label.replace(/^[A-F0-9]+ — /, "")}).` };
    },
  });

  /* ==========================================================================
   * NEURO / HOOFD-HALS — NI-RADS
   * ======================================================================== */

  CALCULATORS.push({
    id: "ni-rads",
    naam: "NI-RADS (hoofd-hals surveillance)",
    categorie: "Neuroradiologie",
    modaliteit: ["CT", "MR"],
    bron: "ACR NI-RADS (white paper, JACR 2018)",
    beschrijving: "Surveillance van behandeld hoofd-halskanker. Aparte score voor primaire site en hals; categorie 1–4 met gekoppeld management. Categorie 2 onderverdeeld in 2a (oppervlakkig) en 2b (diep/submucosaal).",
    triggerKeywords: ["ni-rads", "nirads", "hoofd-hals", "head and neck", "post-behandeling hals", "recidief hals"],
    inputs: [
      { id: "site", label: "Compartiment", type: "select", default: "primair",
        opties: [{ v: "primair", l: "Primaire site" }, { v: "hals", l: "Hals (lymfeklieren)" }] },
      { id: "cat", label: "NI-RADS categorie", type: "select",
        opties: [
          { v: "1", l: "1 — geen aanwijzing voor recidief (verwachte post-behandelingsveranderingen)" },
          { v: "2a", l: "2a — laag verdacht, oppervlakkig/mucosaal" },
          { v: "2b", l: "2b — laag verdacht, diep/submucosaal" },
          { v: "3", l: "3 — hoog verdacht (nieuwe/groeiende massa of klier)" },
          { v: "4", l: "4 — bewezen recidief (pathologisch/definitieve progressie)" },
        ] },
    ],
    compute(v) {
      const adv = {
        "1": "Routine surveillance.",
        "2a": "Directe visuele inspectie (laryngoscopie/endoscopie) of korte-termijn follow-up.",
        "2b": "Korte-termijn follow-up beeldvorming of aanvullende modaliteit (bv. PET-CT).",
        "3": "Biopsie (eventueel met PET-CT).",
        "4": "Bewezen recidief/progressie — klinische/oncologische behandeling.",
      };
      if (!v.cat) return fout("Selecteer de categorie.");
      return { ok: true, titel: "NI-RADS", klasse: "NI-RADS " + v.cat,
        items: [{ label: "Compartiment", waarde: v.site === "hals" ? "hals" : "primaire site" }, { label: "Categorie", waarde: v.cat }],
        advies: adv[v.cat] || null,
        tekst: `NI-RADS ${v.cat} (${v.site === "hals" ? "hals" : "primaire site"}). ${adv[v.cat] || ""}`.trim() };
    },
  });

  /* ==========================================================================
   * MUSCULOSKELETAAL — BONE-RADS
   * ======================================================================== */

  CALCULATORS.push({
    id: "bone-rads",
    naam: "Bone-RADS (incidentele botlaesie)",
    categorie: "Musculoskeletaal",
    modaliteit: ["CT", "MR"],
    bron: "SSR Bone-RADS white paper (Chang et al., Skeletal Radiol 2022)",
    beschrijving: "Management van een solitaire incidentele botlaesie bij volwassenen, via de 4 Bone-RADS-flowcharts. Volgorde: agressieve kenmerken → maligniteitsvoorgeschiedenis → specifieke karakterisatie.",
    triggerKeywords: ["bone-rads", "bonerads", "botlaesie", "bone lesion", "incidentele bot", "botletsel", "botmetastase"],
    inputs: [
      { id: "algoritme", label: "Algoritme", type: "select",
        opties: [
          { v: "ct-lucent", l: "CT — lucente laesie" },
          { v: "ct-scler", l: "CT — sclerotisch/gemengd" },
          { v: "mr-hight1", l: "MRI — hoog T1-signaal" },
          { v: "mr-lowt1", l: "MRI — laag T1-signaal" },
        ] },
      { id: "aggressief", label: "Agressieve kenmerken (pijn toe te schrijven aan laesie, corticale betrokkenheid, weke-delenextensie, pathologische fractuur, agressieve periostreactie, omgevend mergoedeem, solide massa-achtige aankleuring)", type: "checkbox" },
      { id: "maligniteit", label: "Voorgeschiedenis maligniteit met propensiteit tot botmetastasen (of sternumlaesie bij borstkanker / verhoogd PSA)", type: "checkbox" },
      { id: "bevinding", label: "Specifieke karakterisatie", type: "select",
        opties: [
          { v: "fat", l: "Vet / macroscopisch vet / −120 tot −30 HU" },
          { v: "groundglass", l: "Ground glass (fibreuze dysplasie)" },
          { v: "classic", l: "Klassiek benigne morfologie (FD, NOF, enostose, hemangioom, enchondroom, subchondrale cyste/geode, osteochondroom)" },
          { v: "redmarrow", l: "Signaalverlies op in/out-of-phase (rood merg)" },
          { v: "thin-enh", l: "Geen/dunne perifere aankleuring" },
          { v: "nodular-enh", l: "Nodulaire/centrale aankleuring" },
          { v: "cortical-aggr", l: "Corticaal, consistent met osteoid osteoom/osteoblastoom/corticale metastase" },
          { v: "cart-concern", l: "Kraakbeenmatrix MÉT concerning features (endostale scalloping, expansie, corticale doorbraak, periostreactie, weke-delenmassa, incomplete mineralisatie, epifysair, axiaal)" },
          { v: "cart-benign", l: "Kraakbeenmatrix ZONDER concerning features (enchondroom)" },
          { v: "indeterm", l: "Niet eenduidig te karakteriseren" },
        ] },
      { id: "grootte", label: "Grootte (voor kraakbeenlaesie)", type: "number", eenheid: "cm", min: 0, step: 0.1, help: "Enchondroom: >5 cm → Bone-RADS 3; ≤5 cm → Bone-RADS 1" },
    ],
    compute(v) {
      if (!v.algoritme) return fout("Selecteer het algoritme.");
      const modL = { "ct-lucent": "CT lucent", "ct-scler": "CT sclerotisch/gemengd", "mr-hight1": "MRI hoog T1", "mr-lowt1": "MRI laag T1" }[v.algoritme];
      const adv = {
        "1": "Bone-RADS 1 — benigne; geen verdere beeldvorming nodig.",
        "2": "Bone-RADS 2 — aanvullende beeldvorming met andere modaliteit (bv. MRI / chemical shift / röntgen-bottscan).",
        "3": "Bone-RADS 3 — follow-up beeldvorming.",
        "4": "Bone-RADS 4 — biopsie en/of oncologische verwijzing (overweeg metastase, myeloom, primaire bottumor, infectie).",
      };
      let cat, note = "";
      if (v.aggressief) cat = "4";
      else if (v.maligniteit) { cat = "3"; note = "indeterminaat (Bone-RADS 2 of 3 — overweeg bottscan/PET + MRI)"; }
      else if (!v.bevinding) return fout("Selecteer een specifieke karakterisatie.");
      else switch (v.bevinding) {
        case "fat": case "groundglass": case "classic": case "redmarrow": case "thin-enh": cat = "1"; break;
        case "nodular-enh": case "cortical-aggr": case "cart-concern": cat = "4"; break;
        case "cart-benign": {
          const d = num(v.grootte);
          cat = (!isNaN(d) && d > 5) ? "3" : "1";
          note = (!isNaN(d) && d > 5) ? "enchondroom >5 cm" : "enchondroom ≤5 cm";
          break;
        }
        default: cat = (v.algoritme === "ct-scler") ? "3" : "2"; // niet eenduidig
      }
      return { ok: true, titel: "Bone-RADS", klasse: "Bone-RADS " + cat,
        items: [{ label: "Algoritme", waarde: modL }, { label: "Categorie", waarde: "Bone-RADS " + cat }, ...(note ? [{ label: "Toelichting", waarde: note }] : [])],
        advies: adv[cat],
        tekst: `Incidentele botlaesie (${modL}), Bone-RADS ${cat}${note ? " — " + note : ""}. ${adv[cat]}` };
    },
  });

  /* ==========================================================================
   * NUCLEAIRE GENEESKUNDE
   * ======================================================================== */

  CALCULATORS.push({
    id: "mibg-curie",
    naam: "mIBG Curie-score (neuroblastoom)",
    categorie: "Nucleaire geneeskunde",
    modaliteit: ["NM"],
    bron: "Curie-score (semikwantitatief mIBG)",
    beschrijving: "Skelet verdeeld in 9 sectoren + zachte weefsels; scoor elk 0–3. Totaal 0–30.",
    triggerKeywords: ["mibg", "curie", "neuroblastoom", "neuroblastoma", "mibg-scintigrafie"],
    inputs: [
      { id: "info", label: "Scoring per segment", type: "info",
        tekst: "0 = geen opname · 1 = één laesie · 2 = meer dan één laesie · 3 = diffuus (>50% van segment)" },
      ...["Hoofd", "Thorax", "Wervelkolom", "Bekken", "Bovenarm/schouder L", "Bovenarm/schouder R", "Onderbeen/femur L", "Onderbeen/femur R", "Overig skelet"].map((seg, i) => ({
        id: "s" + i, label: "Skelet — " + seg, type: "select", default: "0",
        opties: [{ v: "0", l: "0" }, { v: "1", l: "1" }, { v: "2", l: "2" }, { v: "3", l: "3" }],
      })),
      { id: "soft", label: "Zacht weefsel", type: "select", default: "0",
        opties: [{ v: "0", l: "0" }, { v: "1", l: "1" }, { v: "2", l: "2" }, { v: "3", l: "3" }] },
    ],
    compute(v) {
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += num(v["s" + i]) || 0;
      sum += num(v.soft) || 0;
      return { ok: true, titel: "mIBG Curie-score", klasse: "Curie-score " + sum + "/30",
        items: [{ label: "Totaalscore", waarde: sum + "/30" }],
        advies: null,
        tekst: `mIBG Curie-score ${sum}/30.` };
    },
  });

  /* ==========================================================================
   * VASCULAIR
   * ======================================================================== */

  CALCULATORS.push({
    id: "pesi",
    naam: "PESI (longembolie-ernst)",
    categorie: "Vasculair",
    modaliteit: ["CT"],
    bron: "Pulmonary Embolism Severity Index",
    beschrijving: "Risicostratificatie bij acute longembolie → klasse I–V (30-dagen­mortaliteit).",
    triggerKeywords: ["longembolie", "pulmonale embolie", "pe ", "pesi", "embool", "ctpa"],
    inputs: [
      { id: "leeftijd", label: "Leeftijd", type: "number", eenheid: "jaar", min: 0 },
      { id: "man", label: "Mannelijk geslacht (+10)", type: "checkbox" },
      { id: "kanker", label: "Kanker (+30)", type: "checkbox" },
      { id: "hartfalen", label: "Chronisch hartfalen (+10)", type: "checkbox" },
      { id: "long", label: "Chronische longziekte (+10)", type: "checkbox" },
      { id: "hr110", label: "Hartfrequentie ≥110/min (+20)", type: "checkbox" },
      { id: "sbp100", label: "Systolische BD <100 mmHg (+30)", type: "checkbox" },
      { id: "rr30", label: "Ademhalingsfrequentie ≥30/min (+20)", type: "checkbox" },
      { id: "temp36", label: "Temperatuur <36 °C (+20)", type: "checkbox" },
      { id: "ams", label: "Veranderde mentale status (+60)", type: "checkbox" },
      { id: "sao290", label: "SaO₂ <90% (+20)", type: "checkbox" },
    ],
    compute(v) {
      const age = num(v.leeftijd);
      if (isNaN(age)) return fout("Geef de leeftijd in.");
      let s = age;
      s += v.man ? 10 : 0; s += v.kanker ? 30 : 0; s += v.hartfalen ? 10 : 0; s += v.long ? 10 : 0;
      s += v.hr110 ? 20 : 0; s += v.sbp100 ? 30 : 0; s += v.rr30 ? 20 : 0; s += v.temp36 ? 20 : 0;
      s += v.ams ? 60 : 0; s += v.sao290 ? 20 : 0;
      let klasse, mort;
      if (s <= 65) { klasse = "Klasse I (zeer laag)"; mort = "0–1,6%"; }
      else if (s <= 85) { klasse = "Klasse II (laag)"; mort = "1,7–3,5%"; }
      else if (s <= 105) { klasse = "Klasse III (matig)"; mort = "3,2–7,1%"; }
      else if (s <= 125) { klasse = "Klasse IV (hoog)"; mort = "4,0–11,4%"; }
      else { klasse = "Klasse V (zeer hoog)"; mort = "10,0–24,5%"; }
      return { ok: true, titel: "PESI", klasse: klasse,
        items: [{ label: "Totaalscore", waarde: String(s) }, { label: "30-dagenmortaliteit", waarde: mort }],
        advies: s <= 85 ? "Laag risico — overweeg (ambulante) behandeling volgens beleid." : "Verhoogd risico — klinische observatie/behandeling.",
        tekst: `PESI-score ${s} — ${klasse}, geschatte 30-dagenmortaliteit ${mort}.` };
    },
  });

  CALCULATORS.push({
    id: "villalta",
    naam: "Villalta-score (PTS)",
    categorie: "Vasculair",
    modaliteit: ["ECHO"],
    bron: "Villalta-schaal (post-trombotisch syndroom)",
    beschrijving: "5 symptomen + 6 klinische tekenen (elk 0–3); ulcus = ernstig.",
    triggerKeywords: ["villalta", "post-trombotisch", "pts", "veneuze insufficiëntie", "post-thrombotic"],
    inputs: [
      ...[["pijn", "Pijn"], ["kramp", "Krampen"], ["zwaarte", "Zwaartegevoel"], ["paresthesie", "Paresthesie"], ["jeuk", "Pruritus"],
      ["oedeem", "Pretibiaal oedeem"], ["induratie", "Huidinduratie"], ["pigment", "Hyperpigmentatie"], ["roodheid", "Roodheid"], ["ectasie", "Veneuze ectasie"], ["compressie", "Pijn bij kuitcompressie"]].map(([id, label]) => ({
        id, label, type: "select", default: "0",
        opties: [{ v: "0", l: "0 — afwezig" }, { v: "1", l: "1 — mild" }, { v: "2", l: "2 — matig" }, { v: "3", l: "3 — ernstig" }],
      })),
      { id: "ulcus", label: "Veneus ulcus aanwezig", type: "checkbox" },
    ],
    compute(v) {
      const keys = ["pijn", "kramp", "zwaarte", "paresthesie", "jeuk", "oedeem", "induratie", "pigment", "roodheid", "ectasie", "compressie"];
      let s = 0; for (const k of keys) s += num(v[k]) || 0;
      let klasse;
      if (v.ulcus || s >= 15) klasse = "Ernstig PTS";
      else if (s >= 10) klasse = "Matig PTS";
      else if (s >= 5) klasse = "Mild PTS";
      else klasse = "Geen PTS";
      return { ok: true, titel: "Villalta-score", klasse: klasse + (v.ulcus ? " (ulcus)" : ""),
        items: [{ label: "Totaalscore", waarde: s + "/33" }, ...(v.ulcus ? [{ label: "Ulcus", waarde: "aanwezig" }] : [])],
        advies: null,
        tekst: `Villalta-score ${s}${v.ulcus ? " met veneus ulcus" : ""} — ${klasse.toLowerCase()}.` };
    },
  });

  /* ==========================================================================
   * PEDIATRISCH
   * ======================================================================== */

  CALCULATORS.push({
    id: "ped-spleen-length",
    naam: "Miltlengte pediatrisch (percentiel)",
    categorie: "Pediatrisch",
    modaliteit: ["ECHO"],
    bron: "Rosenberg et al. (sonografische bovengrens naar leeftijd)",
    beschrijving: "Vergelijkt gemeten miltlengte met de leeftijdsgebonden bovengrens van normaal.",
    triggerKeywords: ["milt", "spleen", "pediatrisch", "splenomegalie", "kind milt"],
    inputs: [
      { id: "leeftijd", label: "Leeftijd", type: "number", eenheid: "jaar", min: 0, step: 0.1, help: "Gebruik decimalen voor maanden (bv. 0,5)" },
      { id: "lengte", label: "Gemeten miltlengte", type: "number", eenheid: "cm", min: 0, step: 0.1 },
    ],
    compute(v) {
      const a = num(v.leeftijd), len = num(v.lengte);
      if (isNaN(a) || isNaN(len)) return fout("Geef leeftijd en miltlengte in.");
      // bovengrens normaal (cm) naar leeftijd (Rosenberg 1991)
      let uln;
      if (a < 0.25) uln = 6.0;
      else if (a < 0.5) uln = 6.5;
      else if (a < 1) uln = 7.0;
      else if (a < 2) uln = 8.0;
      else if (a < 4) uln = 9.0;
      else if (a < 6) uln = 9.5;
      else if (a < 8) uln = 10.0;
      else if (a < 10) uln = 11.0;
      else if (a < 12) uln = 11.5;
      else if (a < 15) uln = 12.0;
      else uln = 12.0; // vrouwen ~12, mannen ~13 (volwassen)
      const groot = len > uln;
      return { ok: true, titel: "Miltlengte pediatrisch", klasse: groot ? "Boven bovengrens (splenomegalie)" : "Binnen norm",
        items: [{ label: "Gemeten lengte", waarde: r1(len) + " cm" }, { label: "Bovengrens (leeftijd)", waarde: uln + " cm" }],
        advies: groot ? "Miltlengte boven leeftijdsgebonden bovengrens → splenomegalie." : null,
        tekst: `Miltlengte ${r1(len)} cm bij ${a} jaar (bovengrens ${uln} cm) — ${groot ? "splenomegalie" : "binnen de norm"}.` };
    },
  });

  // ── Schematische figuren (zelf-gegenereerde SVG, geen externe/auteursrechtelijke beelden) ──
  function aoSpineTLSvg(type) {
    const BONE = "#efe4c8", EDGE = "#a8926a", DISC = "#cfe0ea", RED = "#dc2626";
    const yT = 12, yM = 60, yB = 108, bh = 30;
    const shift = type === "C" ? 20 : 0;
    const vert = (y, dx) => {
      const bx = 14 + dx, bw = 66;
      return `<rect x="${bx}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="${BONE}" stroke="${EDGE}" stroke-width="1.5"/>` +
        `<path d="M${bx + bw} ${y + 4} h16 a4 4 0 0 1 4 4 v14 a4 4 0 0 1 -4 4 h-16 z" fill="${BONE}" stroke="${EDGE}" stroke-width="1.5"/>` +
        `<path d="M${bx + bw + 18} ${y + 12} l14 9" stroke="${EDGE}" stroke-width="3.5" stroke-linecap="round"/>`;
    };
    const p = [];
    p.push(`<rect x="14" y="${yT + bh}" width="66" height="${yM - yT - bh}" fill="${DISC}" opacity="0.7"/>`);
    p.push(`<rect x="14" y="${yM + bh}" width="66" height="${yB - yM - bh}" fill="${DISC}" opacity="0.7"/>`);
    p.push(vert(yB, 0), vert(yM, shift), vert(yT, shift));
    const cx = 14, cw = 66, mT = yM, mB = yM + bh, mMid = yM + bh / 2, post = cx + cw;
    const L = (x1, y1, x2, y2, w = 3) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${RED}" stroke-width="${w}" stroke-linecap="round"/>`;
    const r = [];
    switch (type) {
      case "A0": // minor: proc. spinosus/transversus fractuur — duidelijk fragment
        r.push(L(post + 30, mMid - 2, post + 22, mMid + 12, 3));
        r.push(`<path d="M${post + 26} ${mMid + 10} l10 3 l-4 9 z" fill="${RED}" opacity="0.85"/>`);
        break;
      case "A1":
        r.push(`<path d="M${cx} ${mT} L${cx + cw} ${mT} L${cx + cw} ${mT + 4} L${cx} ${mT + 12} Z" fill="${RED}" opacity="0.25"/>`);
        r.push(L(cx, mT + 12, cx + cw, mT + 2));
        break;
      case "A2":
        r.push(L(cx + cw / 2, mT, cx + cw / 2, mB));
        break;
      case "A3":
        r.push(L(cx, mT + 2, cx + cw, mT + 2));
        r.push(L(cx + 12, mT + 2, cx + 26, mMid, 2.5));
        r.push(`<path d="M${post - 6} ${mT + 4} l10 8 l-10 8 z" fill="${RED}" opacity="0.8"/>`);
        break;
      case "A4":
        r.push(L(cx, mT + 2, cx + cw, mT + 2));
        r.push(L(cx, mB - 2, cx + cw, mB - 2));
        r.push(L(cx + 22, mT + 4, cx + 30, mB - 4, 2));
        r.push(L(cx + 44, mT + 4, cx + 38, mB - 4, 2));
        r.push(`<path d="M${post - 6} ${mT + 6} l12 9 l-12 9 z" fill="${RED}" opacity="0.8"/>`);
        break;
      case "B1":
        r.push(L(cx - 2, mMid, post + 34, mMid, 3.2));
        break;
      case "B2": // posterieure tension band: prominente interspinale gap + gescheurd ligament
        r.push(`<path d="M${post + 24} ${yT + bh + 2} L${post + 30} ${yM + 10}" stroke="${RED}" stroke-width="2" stroke-dasharray="3 3"/>`);
        r.push(L(post + 18, yT + bh + 4, post + 30, yT + bh + 4, 3));
        r.push(L(post + 20, yM + 8, post + 32, yM + 8, 3));
        r.push(`<path d="M${post + 26} ${yT + bh + 8} l-7 5 l7 5 M${post + 26} ${yM + 4} l-7 -5 l7 -5" fill="none" stroke="${RED}" stroke-width="2"/>`);
        break;
      case "B3":
        r.push(`<path d="M${cx} ${mT} L${cx + 24} ${mT} L${cx + 6} ${mT - 12} Z" fill="${RED}" opacity="0.3"/>`);
        r.push(L(cx, mT, cx + 4, mT - 14, 3));
        break;
      case "C":
        r.push(`<path d="M${cx + 4} ${mB + 8} h${shift + 8}" stroke="${RED}" stroke-width="3" marker-end="url(#aoar)"/>`);
        break;
    }
    return `<svg viewBox="0 0 150 152" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
      `<defs><marker id="aoar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="${RED}"/></marker></defs>` +
      p.join("") + r.join("") + `</svg>`;
  }

  // Bosniak — schematische cyste-figuren per feature (cirkel = cyste; rood = verdacht kenmerk).
  function bosniakSvg(kind, value) {
    const F = "#dbeafe", B = "#3b82f6", RED = "#dc2626", AM = "#d97706";
    const cx = 75, cy = 76, R = 48;
    const wrap = (inner) => `<svg viewBox="0 0 150 152" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
    const circ = (sw, stroke) => `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${F}" stroke="${stroke}" stroke-width="${sw}"/>`;
    // chord tussen twee hoeken (graden)
    const pt = (a) => [cx + R * Math.cos(a * Math.PI / 180), cy + R * Math.sin(a * Math.PI / 180)];
    const chord = (a1, a2, w, col, dash) => {
      const [x1, y1] = pt(a1), [x2, y2] = pt(a2);
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
    };
    if (kind === "bosniak-wall") {
      if (value === "1") return wrap(circ(2, B));
      if (value === "iif") return wrap(circ(5, AM));
      // iii: dikke/irregulaire wand
      return wrap(circ(8, RED) + `<path d="M${cx + R - 4} ${cy - 14} a12 12 0 0 1 0 24" fill="${RED}" opacity="0.8"/>`);
    }
    if (kind === "bosniak-septa") {
      const base = circ(2, B);
      if (value === "0") return wrap(base);
      if (value === "ii") return wrap(base + chord(200, 340, 2, B) + chord(120, 60, 2, B));
      if (value === "iif4") return wrap(base + chord(200, 340, 2, B) + chord(120, 60, 2, B) + chord(160, 20, 2, B) + chord(250, 290, 2, B) + chord(100, 80, 2, B));
      if (value === "iif3") return wrap(base + chord(180, 0, 4.5, AM));
      // iii: dik/irregulair septum
      return wrap(base + `<path d="M${pt(180)[0]} ${pt(180)[1]} L${cx} ${cy - 8} L${cx + 10} ${cy + 6} L${pt(0)[0]} ${pt(0)[1]}" fill="none" stroke="${RED}" stroke-width="6" stroke-linejoin="round"/>`);
    }
    if (kind === "bosniak-nodule") {
      const base = circ(2, B);
      if (value === "0") return wrap(base);
      if (value === "iii") return wrap(base + `<path d="M${cx + R - 2} ${cy - 8} a7 7 0 0 1 0 16 z" fill="${AM}"/>`); // ≤3mm obtuse protrusie
      // iv: aankleurend noduul
      return wrap(base + `<circle cx="${cx + R - 6}" cy="${cy}" r="13" fill="${RED}"/>`);
    }
    return "";
  }

  // AO Spine subaxiaal: A/B/C hergebruiken TL-morfologie; F1–F4 = facetletsel-schema's.
  function aoSpineSubaxialSvg(value) {
    if (["A0", "A1", "A2", "A3", "A4", "B1", "B2", "B3", "C"].includes(value)) return aoSpineTLSvg(value);
    const BONE = "#efe4c8", EDGE = "#a8926a", RED = "#dc2626";
    const mass = (y, dx) => { const x = 52 + dx; return `<path d="M${x} ${y} L${x + 40} ${y} L${x + 32} ${y + 28} L${x - 8} ${y + 28} Z" fill="${BONE}" stroke="${EDGE}" stroke-width="1.5"/>`; };
    const L = (x1, y1, x2, y2, w = 3) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${RED}" stroke-width="${w}" stroke-linecap="round"/>`;
    const yT = 14, yM = 54, yB = 94, mh = 28, mx = 52, mw = 40;
    const shift = value === "F4" ? -16 : 0;
    const p = [mass(yB, 0), mass(yM, shift), mass(yT, shift)];
    const r = [];
    if (value === "F1") r.push(L(mx + 6, yM + 6, mx + 30, yM + 22, 3));
    else if (value === "F2") { r.push(L(mx + 4, yM + 5, mx + 28, yM + 20, 3)); r.push(`<path d="M${mx + 24} ${yM + 16} l10 2 l-3 9 z" fill="${RED}" opacity="0.85"/>`); }
    else if (value === "F3") { r.push(L(mx - 8, yM - 2, mx + 40, yM - 2, 3)); r.push(L(mx - 8, yM + mh + 2, mx + 40, yM + mh + 2, 3)); }
    else if (value === "F4") { r.push(`<path d="M${mx + 20} ${yM + mh + 6} l-${16 + 6} 0" stroke="${RED}" stroke-width="3" marker-end="url(#subar)"/>`); }
    return `<svg viewBox="0 0 150 152" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
      `<defs><marker id="subar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="${RED}"/></marker></defs>` +
      p.join("") + r.join("") + `</svg>`;
  }

  // Lung-RADS noduletypes: schematische nodule-figuren (compositie is het onderscheid).
  function lungRadsTypeSvg(value) {
    const LUNG = "#eef2f7", SOLID = "#64748b", CORE = "#334155", GGN = "#cbd5e1", WALL = "#475569";
    const cx = 75, cy = 78;
    const wrap = (inner) => `<svg viewBox="0 0 150 152" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect x="8" y="10" width="134" height="130" rx="14" fill="${LUNG}"/>${inner}</svg>`;
    switch (value) {
      case "geen": // benigne: kleine nodule met centrale/popcorn-calcificatie
        return wrap(`<circle cx="${cx}" cy="${cy}" r="17" fill="${SOLID}"/><circle cx="${cx}" cy="${cy}" r="6" fill="#f8fafc"/>`);
      case "solid":
        return wrap(`<circle cx="${cx}" cy="${cy}" r="26" fill="${SOLID}" stroke="${WALL}" stroke-width="1.5"/>`);
      case "partsolid": // matglas-halo + solide kern
        return wrap(`<circle cx="${cx}" cy="${cy}" r="32" fill="${GGN}" opacity="0.6"/><circle cx="${cx}" cy="${cy}" r="14" fill="${CORE}"/>`);
      case "nonsolid": // pure matglas (hazy, gestippeld)
        return wrap(`<circle cx="${cx}" cy="${cy}" r="30" fill="${GGN}" opacity="0.55" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 4"/>`);
      case "airway": // endobronchiale nodule in een bronchus
        return wrap(`<path d="M60 20 L60 80 M90 20 L90 80" stroke="${WALL}" stroke-width="3" fill="none"/><circle cx="${cx}" cy="86" r="18" fill="${SOLID}"/>`);
      case "cyst": // dunwandige cyste (ring)
        return wrap(`<circle cx="${cx}" cy="${cy}" r="28" fill="#ffffff" stroke="${WALL}" stroke-width="2.5"/>`);
      case "incompleet":
        return wrap(`<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="5 5"/><text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="30" fill="#94a3b8" font-family="sans-serif">?</text>`);
    }
    return wrap("");
  }

  // expose
  const api = {
    version: "1.0",
    calculators: CALCULATORS,
    all() { return CALCULATORS.slice(); },
    byId(id) { return CALCULATORS.find((c) => c.id === id) || null; },
    byModality(mod) { return CALCULATORS.filter((c) => (c.modaliteit || []).includes(mod)); },
    categories() { return [...new Set(CALCULATORS.map((c) => c.categorie))]; },
    /* Zelf-gegenereerde schematische SVG voor een visual-select optie. */
    svg(kind, value) {
      if (kind === "aospine-tl") return aoSpineTLSvg(value);
      if (kind === "aospine-subaxial") return aoSpineSubaxialSvg(value);
      if (kind === "lungrads-type") return lungRadsTypeSvg(value);
      if (kind && kind.indexOf("bosniak-") === 0) return bosniakSvg(kind, value);
      return "";
    },
    /* Tekstscan: geeft array van {calc, hits[]} terug, gesorteerd op aantal hits.
       opts.restrictIds = beperk tot deze calc-id's (bv. gekoppeld aan examentype). */
    detect(text, opts) {
      opts = opts || {};
      const t = (text || "").toLowerCase();
      if (!t.trim()) return [];
      let pool = CALCULATORS;
      if (opts.restrictIds && opts.restrictIds.length) pool = pool.filter((c) => opts.restrictIds.includes(c.id));
      const out = [];
      for (const c of pool) {
        const hits = (c.triggerKeywords || []).filter((k) => t.includes(k.toLowerCase()));
        if (hits.length) out.push({ calc: c, hits });
      }
      out.sort((a, b) => b.hits.length - a.hits.length);
      return out;
    },
  };

  if (typeof window !== "undefined") window.RADCALC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
