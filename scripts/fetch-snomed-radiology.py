#!/usr/bin/env python3
"""
Fetch SNOMED CT radiology concepts from the public HL7 FHIR terminology server
and write them to snomed-radiology.json for offline/client-side lookup.

Usage:
    python3 scripts/fetch-snomed-radiology.py

Requirements:
    pip install requests

Output:
    snomed-radiology.json  (place in project root, loaded by launch.html)
"""

import json
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests first:  pip install requests")
    sys.exit(1)

FHIR_BASE = "https://tx.fhir.org/r4"
OUT_FILE   = Path(__file__).parent.parent / "snomed-radiology.json"
PAGE_SIZE  = 200
DELAY_S    = 0.3   # polite pause between requests

# ─── ECL queries covering radiology-relevant SNOMED CT hierarchies ────────────
#  Each tuple: (label, ECL expression)
ECL_QUERIES = [
    ("radiological findings",        "<< 12220008"),       # Radiological finding
    ("fractures",                     "<< 125605004"),      # Fracture
    ("dislocations",                  "<< 57383000"),       # Dislocation
    ("degenerative joint disorders",  "<< 396275006"),      # Osteoarthritis
    ("spondylosis / disc",            "<< 76107001"),       # Intervertebral disc degeneration
    ("disc herniation",               "<< 73589001"),       # Prolapse of intervertebral disc
    ("bone findings",                 "<< 272379006"),      # Bone structure finding
    ("chest / pulmonary findings",    "<< 413839001"),      # Chronic lung disease — and subtype
    ("pleural effusion",              "<< 60046008"),       # Pleural effusion
    ("pneumothorax",                  "<< 36118008"),       # Pneumothorax
    ("pneumonia",                     "<< 233604007"),      # Pneumonia
    ("atelectasis",                   "<< 46621007"),       # Atelectasis
    ("cardiomegaly",                  "<< 8186001"),        # Cardiomegaly
    ("vascular calcification",        "<< 396336006"),      # Calcification of artery
    ("soft tissue findings",          "<< 300848003"),      # Mass of body region
    ("osteophyte",                    "<< 80248007"),       # Osteophyte
    ("osteoporosis",                  "<< 64859006"),       # Osteoporosis
    ("scoliosis",                     "<< 298382003"),      # Scoliosis
    ("tumour / neoplasm",             "<< 363346000"),      # Malignant neoplastic disease
    ("benign neoplasm",               "<< 92491005"),       # Benign neoplasm of bone
    ("joint effusion",                "<< 416940007"),      # Joint effusion
    ("tendon pathology",              "<< 202856008"),      # Disorder of tendon
    ("bursa pathology",               "<< 43499008"),       # Bursitis
    ("rotator cuff tear",             "<< 57773001"),       # Tear of rotator cuff
    ("gallstone",                     "<< 370474003"),      # Gallstone
    ("renal calculus",                "<< 95570007"),       # Kidney stone
    ("liver findings",                "<< 32381004"),       # Hepatomegaly
    ("abdominal mass",                "<< 197907003"),      # Intra-abdominal mass
    ("lymphadenopathy",               "<< 30746006"),       # Lymphadenopathy
    ("normal / no abnormality",       "<< 281302008"),      # No abnormality detected
    ("imaging procedures",            "<< 363679005"),      # Imaging procedure
]


def expand_ecl(label: str, ecl: str) -> list[dict]:
    """Fetch all concepts matching an ECL expression via ValueSet/$expand pagination."""
    concepts = []
    offset = 0
    url = f"{FHIR_BASE}/ValueSet/$expand"
    params_base = {
        "url":    f"http://snomed.info/sct?fhir_vs=ecl/{ecl}",
        "count":  PAGE_SIZE,
        "includeDesignations": "false",
        "activeOnly": "true",
    }

    while True:
        params = {**params_base, "offset": offset}
        try:
            r = requests.get(url, params=params,
                             headers={"Accept": "application/fhir+json"},
                             timeout=30)
        except requests.RequestException as e:
            print(f"  ✗ network error: {e}")
            break

        if not r.ok:
            print(f"  ✗ HTTP {r.status_code} for '{label}'")
            break

        data = r.json()
        items = data.get("expansion", {}).get("contains", [])
        if not items:
            break

        for item in items:
            if item.get("code") and item.get("display"):
                concepts.append({
                    "id":   item["code"],
                    "term": item["display"].strip(),
                })

        total   = data.get("expansion", {}).get("total", 0)
        offset += len(items)
        print(f"  {offset}/{total or '?'} concepts fetched for '{label}'")

        if offset >= (total or offset):
            break
        time.sleep(DELAY_S)

    return concepts


def main():
    all_concepts: dict[str, dict] = {}   # keyed by concept ID (deduplicates)

    print(f"Fetching SNOMED CT radiology concepts from {FHIR_BASE}\n")

    for label, ecl in ECL_QUERIES:
        print(f"▶ {label}  ({ecl})")
        batch = expand_ecl(label, ecl)
        before = len(all_concepts)
        for c in batch:
            all_concepts[c["id"]] = c
        print(f"  → {len(batch)} fetched, {len(all_concepts) - before} new\n")
        time.sleep(DELAY_S)

    concepts_list = sorted(all_concepts.values(), key=lambda c: c["term"].lower())

    result = {
        "version":  time.strftime("%Y-%m"),
        "source":   FHIR_BASE,
        "count":    len(concepts_list),
        "concepts": concepts_list,
    }

    OUT_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=None,
                                   separators=(",", ":")), encoding="utf-8")
    print(f"✓ Wrote {len(concepts_list)} concepts to {OUT_FILE}")


if __name__ == "__main__":
    main()
