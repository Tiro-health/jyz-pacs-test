#!/usr/bin/env python3
"""Bouwt de Corti-keyterms uit alle bronnen.

Fase 1 — master-lijst.tsv: alles samengevoegd, ontdubbeld, getagd en gescoord.
Fase 2 — top-1000.txt / top-1000.json: de 1000 termen met de hoogste score,
binnen de Corti-limieten (max. 1000 keyterms per verbinding, max. 50 tekens).

Gebruik:  python3 corti-keyterms/build.py
Externe bronnen worden één keer gedownload naar corti-keyterms/.cache/.
"""
import collections
import json
import math
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
BRONNEN = os.path.join(HERE, "bronnen")

MAX_TERMS = 1000
MAX_LEN = 50

RAW = "https://raw.githubusercontent.com"
DOWNLOADS = {
    "opentaal.txt": RAW + "/OpenTaal/opentaal-wordlist/master/wordlist.txt",
    "uberon.obo": RAW + "/obophenotype/uberon/master/src/ontology/uberon-edit.obo",
    "telnyx.txt": RAW + "/team-telnyx/medical-pronunciation-dictionary/main/providers/stt/keyterms.txt",
    # Enkel als signaal gebruikt (GPL v3): de woorden zelf komen niet in de lijsten.
    "med_en.txt": RAW + "/glutanimate/wordlist-medicalterms-en/master/wordlist.txt",
}

# Quota per categorie in de top-1000, zodat geen enkele bron de lijst opslokt.
QUOTA = {
    "template": 380,
    "anatomie-la": 140,
    "anatomie-en": 20,
    "latijn-msk-kern": 130,
    "afkortingen": 60,
    "classificaties-scores": 70,
    "tekens-eponiemen": 70,
    "telnyx-en": 10,
    "opentaal-medisch": 40,
}

# Woorden die een spraakherkenner zonder hulp al kent: nooit in de top-1000.
STOP = set("""
de het een en of van in op aan met voor door bij uit naar tot als dan dat die dit deze
er is zijn was werd werden wordt worden geen niet ook nog wel al te om over onder
hier daar zoals indien alsook eventuele eventueel andere ander overige bovenstaande
beschrijf beschrijving bespreek vermeld vermelden beschreven input puntjes zaken
xxx wat welke hoe waar wanneer mogelijk inclusief alle elke meer minder zeer
normaal normale geen goed klein kleine groot grote links rechts hoog laag
type graad niveau zijde kant deel delen status meting aanwezigheid
""".split())

MED_AFFIX = re.compile(
    r"(itis|itiden|oom|omen|osen?|ectomie|otomie|ostomie|grafie|grafisch|scopie|pathie|"
    r"plastie|algie|emie|coele|cele|fyse|lyse|trofie|plasie|ectasie|stenose|sclerose|"
    r"genesie|megalie|lithiasis|rrhagie|rragie|edeem|oedeem|thorax|cardie|ectopie|"
    r"aal|air|eus|ieel)$|"
    r"^(hepat|nefr|neur|cardi|oste|chondr|arthr|artr|spondyl|myel|encefal|cerebr|pulmo|"
    r"bronch|gastr|enter|col|cyst|hem|haem|angi|fleb|lymf|aden|derm|hyper|hypo|peri|para|"
    r"intra|extra|retro|sub|supra|trans|endo|epi|meta|pyel|uret|vesic|hyster|ovari|mamm|"
    r"thyr|laryng|faryng|oesof|duoden|ile|jejun|lapar|cholecyst|choledoch|pancrea|splen|"
    r"radi|tomo|echo|mr-|ct-|rx-)", re.I)

# Template-woorden die geen goede keyterm zijn (Engels, te gewoon, of tikfout).
BLOCK = set("""
angle critical support beta radio voorkomen echo allignatie formamina kapsulitis
shoulder cuff
""".split())

# Termen die (na opschonen) als fout of te generiek uit de templates komen.
TEMPLATE_FIELD = re.compile(r"\[-\s*([^\]:]{3,48}):?\]")


def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("download", DOWNLOADS[name], file=sys.stderr)
        urllib.request.urlretrieve(DOWNLOADS[name], path)
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


class Lexicon:
    def __init__(self):
        self.rows = {}  # sleutel (lowercase) -> rij

    def add(self, term, lang, cat, source, core=False, freq=0):
        term = re.sub(r"\s+", " ", term.strip().strip(",;"))
        if len(term) < 2:
            return
        key = term.lower()
        row = self.rows.get(key)
        if row is None:
            row = self.rows[key] = {
                "term": term, "taal": lang, "categorie": cat,
                "bronnen": set(), "kern": False, "freq": 0,
            }
        elif row["term"].islower() and not term.islower() and source == "gecureerd":
            row["term"] = term  # gecureerde schrijfwijze (hoofdletters) wint
        row["bronnen"].add(source)
        row["kern"] = row["kern"] or core
        row["freq"] = max(row["freq"], freq)
        # Gecureerde categorie wint van automatische
        if source == "gecureerd" and "gecureerd" not in row.get("_catsrc", ""):
            row["categorie"], row["taal"], row["_catsrc"] = cat, lang, "gecureerd"


def load_curated(lex):
    for fn in sorted(os.listdir(BRONNEN)):
        if not fn.endswith(".txt"):
            continue
        cat = re.sub(r"^\d+-", "", fn[:-4])
        lang = "nl"
        with open(os.path.join(BRONNEN, fn), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("@"):
                    lang = line[1:]
                    continue
                core = line.startswith("!")
                term = line.lstrip("!")
                c = "afkortingen" if lang == "afk" else cat
                lex.add(term, lang, c, "gecureerd", core=core)


def template_texts():
    texts = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if isinstance(v, str) and k in ("textTemplate", "userTextTemplate", "name"):
                    texts.append(v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for fn in ("templates_json_huidig.json", "templates_notion_huidig.json",
               "templates_artefacten.json", "gesprek-database-radiologie-templates.json"):
        p = os.path.join(REPO, fn)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                walk(json.load(fh))
    p = os.path.join(REPO, "flow.html")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as fh:
            h = fh.read()
        for m in re.finditer(r'(?:textTemplate|userTextTemplate)\s*:\s*(`[^`]*`|"(?:[^"\\]|\\.)*")', h):
            texts.append(m.group(1))
    return [t.replace("\\n", "\n").replace('\\"', '"') for t in texts]


def load_templates(lex, nl_common):
    # Dezelfde templates staan in meerdere bestanden: tel per unieke template
    # in hoeveel templates een woord voorkomt (documentfrequentie).
    texts = sorted(set(template_texts()))
    df = collections.Counter()
    forms = collections.defaultdict(collections.Counter)
    for t in texts:
        # commentaar na // is instructie voor het model, niet gedicteerde tekst
        body = "\n".join(l.split("//")[0] for l in t.splitlines())
        seen = set()
        for w in re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*[A-Za-zÀ-ÿ]", body):
            k = w.lower()
            forms[k][w] += 1
            seen.add(k)
        df.update(seen)
    curated = {k for k, r in lex.rows.items() if "gecureerd" in r["bronnen"]}
    for k, n in df.items():
        if k in STOP or k in BLOCK or n < 2 or len(k) < 4:
            continue
        if k not in nl_common and k not in curated and _likely_typo(k, n, df, curated | nl_common):
            continue
        # Hoofdletters komen meestal van een zinsbegin of een titel in kapitalen;
        # behoud ze alleen voor korte afkortingen die geen gewoon woord zijn.
        best = forms[k].most_common(1)[0][0]
        term = best if best.isupper() and len(best) <= 5 and k not in nl_common else k
        lang = "la" if re.search(r"(us|um|ae|is|ii|ior|ius)$", k) and k not in nl_common else "nl"
        lex.add(term, lang, "template", "templates", freq=n)
    # veldnamen als woordgroepen ("Atlantodentale verhoudingen")
    labels = collections.Counter()
    for t in texts:
        for lab in {m.group(1).strip().lower() for m in TEMPLATE_FIELD.finditer(t)}:
            if 1 < len(lab.split()) <= 5 and not re.search(r"[().]", lab) \
                and not set(lab.split()) & BLOCK:
                labels[lab] += 1
    for lab, n in labels.items():
        if n >= 2:
            lex.add(lab, "nl", "template", "templates-veld", freq=n)
    return df


def _likely_typo(k, n, df, known):
    """Eén letter verschil met een bekend woord dat vaker voorkomt: tikfout."""
    alphabet = "abcdefghijklmnopqrstuvwxyzëéèïö-"
    cands = {k[:i] + k[i + 1:] for i in range(len(k))}
    cands |= {k[:i] + c + k[i + 1:] for i in range(len(k)) for c in alphabet}
    cands |= {k[:i] + k[i + 1] + k[i] + k[i + 2:] for i in range(len(k) - 1)}
    cands.discard(k)
    return any(c in known and df.get(c, 0) >= n for c in cands)


def load_uberon(lex):
    text = fetch("uberon.obo")
    for stanza in text.split("\n[Term]\n")[1:]:
        if "is_obsolete: true" in stanza:
            continue
        human = "FMA:" in stanza or "HUMAN_PREFERRED" in stanza
        name = re.search(r"^name: (.+)$", stanza, re.M)
        for m in re.finditer(r'^synonym: "([^"]+)" \w+ OMO:0003011', stanza, re.M):
            lex.add(m.group(1), "la", "anatomie-la", "uberon")
        if human and name:
            lex.add(name.group(1), "en", "anatomie-en", "uberon")


def load_telnyx(lex):
    for t in fetch("telnyx.txt").split(","):
        if t.strip():
            lex.add(t, "en", "telnyx-en", "telnyx")


def load_opentaal_medical(lex, nl_words):
    """Nederlandstalige medische woorden uit OpenTaal, herkend op medische affixen."""
    for w in nl_words:
        if " " in w or len(w) < 7 or not w.islower():
            continue
        if MED_AFFIX.search(w) and re.search(
                r"(itis|oom|ose|ectomie|otomie|grafie|scopie|pathie|plastie|ectasie|"
                r"stenose|megalie|lithiasis|coele|trofie|plasie|algie|emie)$", w):
            lex.add(w, "nl", "opentaal-medisch", "opentaal")


def score(row, med_en, nl_common):
    t = row["term"]
    k = t.lower()
    s = 0.0
    if row["freq"]:
        s += 3.5 * math.log1p(row["freq"])          # in hoeveel eigen templates
    if row["taal"] == "afk":
        s += 4.0                                     # afkortingen: ASR schrijft ze uit of fout
    if row["taal"] == "en" and not row["freq"]:
        s -= 4.0                                     # er wordt in het Nederlands gedicteerd
    if row["kern"]:
        s += 9.0                                     # door ons als kernterm gemarkeerd
    if "gecureerd" in row["bronnen"]:
        s += 4.0
    s += 1.0 * (len(row["bronnen"]) - 1)             # meerdere bronnen bevestigen
    if row["taal"] in ("la",):
        s += 2.0                                     # Latijn: moeilijk voor generieke ASR
    if row["categorie"] in ("tekens-eponiemen", "classificaties-scores"):
        s += 3.0                                     # eponiemen/scores: typisch fout herkend
    if MED_AFFIX.search(k):
        s += 1.0
    if k in nl_common and not row["kern"] and not MED_AFFIX.search(k):
        s -= 6.0                                     # gewoon Nederlands: ASR kent het al
    if " " not in k and k in med_en:
        s += 0.5
    if " " in k:
        s -= 0.5 * max(0, len(k.split()) - 2)        # lange zinsdelen minder nuttig
    return round(s, 2)


def eligible(row, nl_common):
    t = row["term"]
    k = t.lower()
    if len(t) > MAX_LEN or t.endswith(".") or k in STOP:
        return False
    if row["taal"] == "afk" and len(t) < 2:
        return False
    # gewone Nederlandse woorden zonder medische inslag hebben geen keyterm nodig
    if k in nl_common and not row["kern"] and not MED_AFFIX.search(k) \
            and row["categorie"] not in ("tekens-eponiemen", "afkortingen", "classificaties-scores"):
        return False
    return True


def main():
    nl_words = set(fetch("opentaal.txt").split("\n"))
    nl_common = {w.lower() for w in nl_words}
    med_en = {w.strip().lower() for w in fetch("med_en.txt").split("\n")}

    lex = Lexicon()
    load_curated(lex)
    load_templates(lex, nl_common)
    load_uberon(lex)
    load_telnyx(lex)
    load_opentaal_medical(lex, nl_words)

    rows = list(lex.rows.values())
    for r in rows:
        r["score"] = score(r, med_en, nl_common)
    rows.sort(key=lambda r: (-r["score"], r["term"].lower()))

    with open(os.path.join(HERE, "master-lijst.tsv"), "w", encoding="utf-8") as fh:
        fh.write("term\ttaal\tcategorie\tbronnen\ttemplate_freq\tkern\tscore\n")
        for r in rows:
            fh.write("\t".join([
                r["term"], r["taal"], r["categorie"], ",".join(sorted(r["bronnen"])),
                str(r["freq"]), "ja" if r["kern"] else "", str(r["score"]),
            ]) + "\n")

    top, used = [], collections.Counter()
    for r in rows:
        if len(top) >= MAX_TERMS:
            break
        if not eligible(r, nl_common):
            continue
        cat = r["categorie"]
        if cat in QUOTA and used[cat] >= QUOTA[cat] and not r["kern"]:
            continue
        used[cat] += 1
        top.append(r)

    with open(os.path.join(HERE, "top-1000.txt"), "w", encoding="utf-8") as fh:
        for r in top:
            fh.write(r["term"] + "\n")
    with open(os.path.join(HERE, "top-1000.json"), "w", encoding="utf-8") as fh:
        json.dump({"keyterms": [r["term"] for r in top]}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"master: {len(rows)} termen; top: {len(top)}", file=sys.stderr)
    print("top per categorie:", dict(used.most_common()), file=sys.stderr)
    print("master per bron:", dict(collections.Counter(
        b for r in rows for b in r["bronnen"]).most_common()), file=sys.stderr)


if __name__ == "__main__":
    main()
