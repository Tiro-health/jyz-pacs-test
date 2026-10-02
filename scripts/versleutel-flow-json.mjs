#!/usr/bin/env node
/* ============================================================================
 * scripts/versleutel-flow-json.mjs
 * ----------------------------------------------------------------------------
 * Zet de uitgehaalde standaardinhoud om naar flow.json: één base64-blok van
 * salt (16) + iv (12) + AES-GCM-cijfertekst, met de sleutel afgeleid via
 * PBKDF2 (100.000 ronden, SHA-256) uit de pincode.
 *
 * Exact hetzelfde schema als decrypt() in qc.html, zodat de pagina het bestand
 * met de bestaande code kan openen.
 *
 * Let wel: de pincode staat in de broncode van de pagina. Dit houdt het
 * bestand weg bij wie er toevallig langs surft of het indexeert — het is geen
 * bescherming tegen iemand die de pagina leest.
 *
 * Gebruik:  node scripts/versleutel-flow-json.mjs flow-defaults.json 8800 > flow.json
 * ==========================================================================*/
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const [, , bestand, pin] = process.argv;
if (!bestand || !pin) {
    console.error("gebruik: node scripts/versleutel-flow-json.mjs <bestand.json> <pincode>");
    process.exit(1);
}

const klaartekst = readFileSync(bestand, "utf8");
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));

const basis = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
const sleutel = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    basis, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);

const cijfer = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv }, sleutel, new TextEncoder().encode(klaartekst)));

const alles = new Uint8Array(salt.length + iv.length + cijfer.length);
alles.set(salt, 0);
alles.set(iv, salt.length);
alles.set(cijfer, salt.length + iv.length);

console.error(`klaartekst ${klaartekst.length.toLocaleString()} tekens → blok ${alles.length.toLocaleString()} bytes`);
process.stdout.write(Buffer.from(alles).toString("base64"));
