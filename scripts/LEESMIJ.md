# Standaardinhoud buiten de pagina's

De verslagtemplates, de AI-prompts en de DICOM-codes zitten niet meer in
`flow.html`, `launch.html`, `prompts.html`, `qc.html` en `forms-shared.js`.
Ze staan in **`flow.json`**: één versleuteld blok dat de site pas ophaalt
wanneer je op de QC-pagina, achter de pincode, op *Standaardtemplates en
prompts* klikt.

## Wat dit wel en niet doet

Het houdt de inhoud weg uit de broncode van de pagina's en uit een
rechtstreekse blik op `flow.json`. **Het is geen bescherming**: de pincode
staat in `qc.html`, dus wie de pagina leest kan het bestand openen. En deze
repository is publiek, dus de git-geschiedenis bevat de oude versies met de
volledige inhoud in platte tekst.

Wil je er echt iets aan doen, dan is de volgorde: repository op privé, daarna
de geschiedenis opschonen.

## Opnieuw opbouwen

De leesbare bron (`flow-defaults.json`) staat bewust niet in git. Bewaar hem
lokaal; je hebt hem nodig om `flow.json` opnieuw te maken.

```sh
# 1. (eenmalig, uit een oudere commit) de inhoud uit de pagina's halen
node scripts/extraheer-defaults.mjs > flow-defaults.json

# 2. versleutelen naar het bestand dat de site ophaalt
node scripts/versleutel-flow-json.mjs flow-defaults.json 9000 > flow.json
```

Heb je de templates via de flow-pagina aangepast, dan exporteer je ze op de
QC-pagina, werk je `flow-defaults.json` bij en draai je stap 2 opnieuw.

Verander je de pincode in `qc.html`, dan moet `flow.json` met diezelfde code
opnieuw versleuteld worden.
