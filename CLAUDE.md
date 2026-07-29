# Claude Code Instructions — jyz-pacs-test

## Notion ↔ flow.html template sync

### Mapping

| Notion (setup database) | flow.html |
|------------------------|-----------|
| **Nieuw prefill** code block | `textTemplate` (department/textueel verslag, met default waarden) |
| **Nieuw** code block | `userTextTemplate` (user/textueel verslag, met XXX placeholders) |

**Notion setup database page ID:** `36fbd303e1d88070a33bf6cddc502867`
**flow.html path:** `/home/user/jyz-pacs-test/flow.html`

### Template syntaxregels

**Nieuw prefill** (`textTemplate`): velden met quoted standaardwaarden
```
[- Veldnaam:] "Standaard zin." // commentaar
{[- Optioneel veld:] "Standaard."} // optioneel veld
```

**Nieuw** (`userTextTemplate`): velden met XXX als placeholder, BEHALVE velden die altijd een vaste waarde hebben (bv. `"Echografisch niet adequaat evalueerbaar."`)
```
[- Veldnaam:] XXX // commentaar
{[- Optioneel veld:] XXX} // optioneel veld
```

### Studie-headers in templates

- **CT en MRI** templates: **geen** studie-header als eerste lijn van `textTemplate`/`userTextTemplate` en de bijhorende Notion Nieuw/Nieuw prefill blokken. De header wordt automatisch toegevoegd door de auto-detect functie in flow.html.
- **ECHO en RX** templates: ook **geen** studie-header in de template zelf (zelfde reden).

### Sync richting

- **Notion → flow.html**: wanneer Notion templates werden gewijzigd, pas `textTemplate` (Nieuw prefill) en `userTextTemplate` (Nieuw) aan in flow.html.
- **flow.html → Notion**: wanneer flow.html templates werden gewijzigd, pas de Nieuw prefill en Nieuw code blokken aan in de Notion setup database pagina.

### Kritische constraint

**Verander nooit de inhoud van een template**, tenzij de gebruiker dit expliciet vraagt. Structurele aanpassingen (blank lines, headers toevoegen/verwijderen) mogen, maar veldnamen, commentaar, standaardwaarden en volgorde blijven ongewijzigd.

### Notion update_content werkwijze

Gebruik altijd `update_content` met exacte `old_str`/`new_str` — nooit `replace_content` voor de volledige pagina. Gebruik `replace_all_matches: true` wanneer Nieuw en Nieuw prefill identieke `old_str` hebben (bv. bij structurele wijzigingen die beide blokken raken).

Bij het ophalen van de Notion pagina: de dump is te groot voor directe weergave en wordt opgeslagen als bestand. Gebruik Python (`python3 -c "..."`) om specifieke secties te extraheren via `content.find(...)` of `content.split('\\\\n')`.
