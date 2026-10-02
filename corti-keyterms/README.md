# Corti keyterms — radiologische woordenschat

Extra woorden voor Corti, zodat die beter herkent wat in Dragon Medical One al
in de radiologiebibliotheek zit: Nederlands, Engels en Latijn door elkaar,
plus eponiemen, scores en afkortingen.

## Corti-limieten (bepalen het ontwerp)

- maximaal **1.000 keyterms per verbinding**
- maximaal **50 tekens** per term
- hoofdlettergevoelig: de schrijfwijze van de term wordt overgenomen in de transcriptie

Bron: [Corti docs — Keyterms](https://docs.corti.ai/stt/keyterms.md)

Daarom bestaat dit uit twee bestanden:

| Bestand | Inhoud |
|---|---|
| `master-lijst.tsv` | **Fase 1.** Alles samengevoegd (~16.000 termen), ontdubbeld, met taal, categorie, bronnen, frequentie in de eigen templates en een score. |
| `top-1000.txt` / `top-1000.json` | **Fase 2.** De 1.000 termen met de hoogste score, binnen de Corti-limieten. `top-1000.json` heeft de vorm `{"keyterms": [...]}`. |

## Bronnen

| Bron | Wat | Licentie |
|---|---|---|
| `bronnen/*.txt` (gecureerd) | 11 radiologische lexicons, ~3.200 termen: technieken en sequenties, descriptoren, anatomie NL, classificaties en scores, tekens en eponiemen, materiaal en interventies, contrast, afkortingen, pathologie per orgaansysteem, Latijnse spieren/pezen/ligamenten/zenuwen, verslagtaal | dit project |
| Eigen templates | woorden en veldnamen uit `templates_*.json`, `gesprek-database-radiologie-templates.json` en `flow.html` | dit project |
| [Uberon](https://github.com/obophenotype/uberon) | ~3.600 Latijnse anatomische termen (veelal uit Terminologia Anatomica/FMA) en Engelse humane anatomie | CC BY 3.0 |
| [OpenTaal](https://github.com/OpenTaal/opentaal-wordlist) | Nederlandse medische woorden (herkend op medische uitgangen) en als filter voor "gewoon Nederlands" | BSD / CC BY 3.0 |
| [Telnyx medical pronunciation dictionary](https://github.com/team-telnyx/medical-pronunciation-dictionary) | ~960 algemene Engelse medische termen, vooral medicatie | MIT |
| [wordlist-medicalterms-en](https://github.com/glutanimate/wordlist-medicalterms-en) | alleen als signaal bij het scoren; de woorden zelf staan **niet** in de lijsten (GPL v3, dit project is Apache 2.0) | GPL v3 |

Niet bereikbaar vanuit de omgeving waarin dit gebouwd is, en dus nog niet opgenomen:
**RadLex** (RSNA, ~46.000 termen, CSV via [BioPortal](https://bioportal.bioontology.org/ontologies/RADLEX)),
**TA2** ([FIPAT](https://fipat.library.dal.ca/ta2/)) en **SNOMED CT** (Belgische release, licentie via eHealth).
Dat zijn de logische uitbreidingen voor de masterlijst.

## Hoe de top-1000 gekozen wordt

Corti kent gewone woorden al. Een keyterm helpt pas bij een woord dat de
spraakherkenner anders fout schrijft én dat je echt dicteert. De score combineert:

- **in hoeveel eigen templates** de term voorkomt (sterkste signaal)
- **kernterm** (`!` in `bronnen/*.txt`): handmatig als belangrijk gemarkeerd
- gecureerd, en door meerdere bronnen bevestigd
- **Latijn, afkortingen, eponiemen en scores** krijgen extra gewicht, omdat generieke ASR daar het vaakst misgaat
- **gewoon Nederlands** (in OpenTaal, zonder medische uitgang) valt weg: dat herkent Corti al
- Engelse termen die niet in de eigen templates staan krijgen minder gewicht: er wordt in het Nederlands gedicteerd

Per categorie geldt een quotum (zie `QUOTA` in `build.py`), zodat bijvoorbeeld
de 10.000 Uberon-termen de lijst niet overnemen. Tikfouten uit de templates
(één letter verschil met een bekend woord dat vaker voorkomt, zoals
"allignatie") worden geweerd, want een keyterm zou de fout juist versterken.

## Aanpassen en opnieuw bouwen

```sh
python3 corti-keyterms/build.py
```

- Term toevoegen: zet hem in het passende `bronnen/*.txt`-bestand. `@nl`, `@en`, `@la` of `@afk` zet de taal; een `!` vooraan maakt er een kernterm van.
- Term weren: voeg hem toe aan `BLOCK` in `build.py`.
- Externe bronnen worden één keer gedownload naar `corti-keyterms/.cache/` (staat niet in git).

## Volgende stap

Corti krijgt deze termen via het Tiro-endpoint (`Endpoint/corti` in
`launch.html`). De keyterms moeten dus bij het openen van de Corti-verbinding
aan de serverkant meegegeven worden. Dat zit niet in deze repo.
Omdat de limiet per verbinding geldt, kan je ook per modaliteit of regio een
eigen set van 1.000 kiezen, bijvoorbeeld MSK, neuro of abdomen.
