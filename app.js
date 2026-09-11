/* ============================================================
 * app.js - Relie index.html au module WASM (calcul.js/calcul.wasm
 * generes par Emscripten a partir de calcul.c + web_api.c).
 * ============================================================ */

const CLE_STOCKAGE = "comptes_donnees";

let categoriesJson, paiementsJson, postesJson;
let dateDuJour, periodeDeDate;
let listeTransactionsPeriodeJson, ajouterTransaction, modifierTransaction, supprimerTransaction;
let bilanPosteJson, definirBudget;
let exporterTxt, importerTxt;

let indexEnEdition = null; /* null = mode "ajout", sinon index de la transaction modifiee */

/* ---------------------------------------------------------- *
 *  Utilitaires de dates : l'API C encode une date en un seul
 *  entier "jour*1000000 + mois*10000 + annee".
 * ---------------------------------------------------------- */
function encoderDate(jour, mois, annee) {
    return jour * 1000000 + mois * 10000 + annee;
}
function decoderDate(valeur) {
    return {
        jour: Math.floor(valeur / 1000000),
        mois: Math.floor(valeur / 10000) % 100,
        annee: valeur % 10000,
    };
}
/* input[type=date] utilise le format AAAA-MM-JJ */
function inputVersDate(valeurInput) {
    const [a, m, j] = valeurInput.split("-").map(Number);
    return { jour: j, mois: m, annee: a };
}
function dateVersInput(jour, mois, annee) {
    const p2 = (n) => String(n).padStart(2, "0");
    return `${annee}-${p2(mois)}-${p2(jour)}`;
}

/* ---------------------------------------------------------- *
 *  Persistance dans le localStorage du navigateur
 * ---------------------------------------------------------- */
function sauvegarder() {
    const donnees = exporterTxt();
    localStorage.setItem(CLE_STOCKAGE, donnees);
}
function chargerDepuisStockage() {
    const donnees = localStorage.getItem(CLE_STOCKAGE);
    if (donnees) {
        importerTxt(donnees);
    }
}

/* ---------------------------------------------------------- *
 *  Remplissage des listes deroulantes (categories / paiements)
 * ---------------------------------------------------------- */
function remplirSelect(select, valeurs, valeurSelectionnee) {
    select.innerHTML = "";
    for (const v of valeurs) {
        const option = document.createElement("option");
        option.value = v;
        option.textContent = v;
        if (v === valeurSelectionnee) option.selected = true;
        select.appendChild(option);
    }
}

/* ---------------------------------------------------------- *
 *  Formulaire d'ajout / modification
 * ---------------------------------------------------------- */
function reinitialiserFormulaire() {
    indexEnEdition = null;
    document.getElementById("btn-ajouter").textContent = "Ajouter";
    const j = decoderDate(dateDuJour());
    document.getElementById("f-date").value = dateVersInput(j.jour, j.mois, j.annee);
    document.getElementById("f-libelle").value = "";
    document.getElementById("f-somme").value = "";
}

function chargerTransactionDansFormulaire(t) {
    indexEnEdition = t.index;
    document.getElementById("btn-ajouter").textContent = "Enregistrer les modifications";
    const d = decoderDate(t.date);
    document.getElementById("f-date").value = dateVersInput(d.jour, d.mois, d.annee);
    document.getElementById("f-libelle").value = t.libelle;
    document.getElementById("f-categorie").value = t.categorie;
    document.getElementById("f-paiement").value = t.paiement;
    document.getElementById("f-somme").value = t.somme;
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function validerFormulaire() {
    const { jour, mois, annee } = inputVersDate(document.getElementById("f-date").value);
    const libelle = document.getElementById("f-libelle").value.trim();
    const categorie = document.getElementById("f-categorie").value;
    const paiement = document.getElementById("f-paiement").value;
    const somme = parseFloat(document.getElementById("f-somme").value);

    if (!libelle) { alert("Merci de saisir un libelle."); return; }
    if (isNaN(somme) || somme === 0) { alert("Merci de saisir un montant (positif = credit, negatif = debit)."); return; }

    if (indexEnEdition === null) {
        ajouterTransaction(jour, mois, annee, libelle, categorie, paiement, somme);
    } else {
        modifierTransaction(indexEnEdition, jour, mois, annee, libelle, categorie, paiement, somme);
    }

    sauvegarder();
    reinitialiserFormulaire();
    actualiserPeriodeAffichee();
}

/* ---------------------------------------------------------- *
 *  Affichage des transactions d'une periode + bilan par poste
 * ---------------------------------------------------------- */
function actualiserPeriodeAffichee() {
    const mois = parseInt(document.getElementById("f-mois").value, 10);
    const annee = parseInt(document.getElementById("f-annee").value, 10);
    if (!mois || !annee) return;

    const donnees = JSON.parse(listeTransactionsPeriodeJson(mois, annee));
    const tbody = document.querySelector("#table-transactions tbody");
    tbody.innerHTML = "";

    for (const t of donnees.transactions) {
        const d = decoderDate(t.date);
        const tr = document.createElement("tr");
        const classeSomme = t.somme >= 0 ? "positif" : "negatif";
        tr.innerHTML = `
            <td>${String(d.jour).padStart(2, "0")}/${String(d.mois).padStart(2, "0")}/${d.annee}</td>
            <td>${t.libelle}</td>
            <td>${t.categorie}</td>
            <td>${t.paiement}</td>
            <td class="${classeSomme}">${t.somme.toFixed(2)}</td>
            <td>
                <button data-action="modifier" data-index="${t.index}">Modifier</button>
                <button data-action="supprimer" data-index="${t.index}">Supprimer</button>
            </td>`;
        tbody.appendChild(tr);
    }

    document.getElementById("solde-periode").textContent =
        `Solde de la periode : ${donnees.solde.toFixed(2)}`;

    tbody.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            if (btn.dataset.action === "supprimer") {
                if (confirm("Supprimer cette transaction ?")) {
                    supprimerTransaction(idx);
                    sauvegarder();
                    actualiserPeriodeAffichee();
                    actualiserBudgets();
                }
            } else {
                const t = donnees.transactions.find((x) => x.index === idx);
                chargerTransactionDansFormulaire(t);
            }
        });
    });

    actualiserBudgets(mois, annee);
}

function actualiserBudgets(mois, annee) {
    if (mois === undefined) mois = parseInt(document.getElementById("f-mois").value, 10);
    if (annee === undefined) annee = parseInt(document.getElementById("f-annee").value, 10);
    if (!mois || !annee) return;

    const bilan = JSON.parse(bilanPosteJson(mois, annee));
    const tbody = document.querySelector("#table-budgets tbody");
    tbody.innerHTML = "";

    for (const p of bilan.postes) {
        const tr = document.createElement("tr");
        const depasse = p.reste < 0;
        tr.innerHTML = `
            <td>${p.nom}</td>
            <td><input type="number" step="0.01" value="${p.budget.toFixed(2)}" data-poste="${p.nom}" style="width:90px"></td>
            <td>${p.depense.toFixed(2)}</td>
            <td class="${depasse ? "depasse" : ""}">${p.reste.toFixed(2)}${depasse ? " (depasse)" : ""}</td>`;
        tbody.appendChild(tr);
    }

    tbody.querySelectorAll("input[data-poste]").forEach((input, idx) => {
        input.addEventListener("change", () => {
            const valeur = parseFloat(input.value);
            if (!isNaN(valeur) && valeur >= 0) {
                definirBudget(idx, valeur);
                sauvegarder();
                actualiserBudgets(mois, annee);
            }
        });
    });
}

/* ---------------------------------------------------------- *
 *  Initialisation au chargement du module WASM
 * ---------------------------------------------------------- */
Module.onRuntimeInitialized = function () {
    categoriesJson = Module.cwrap("web_categories_json", "string", []);
    paiementsJson = Module.cwrap("web_paiements_json", "string", []);
    dateDuJour = Module.cwrap("web_date_du_jour", "number", []);
    periodeDeDate = Module.cwrap("web_periode_de_date", "number", ["number", "number", "number"]);
    listeTransactionsPeriodeJson = Module.cwrap("web_transactions_periode_json", "string", ["number", "number"]);
    ajouterTransaction = Module.cwrap("web_ajouter_transaction", "number",
        ["number", "number", "number", "string", "string", "string", "number"]);
    modifierTransaction = Module.cwrap("web_modifier_transaction", "number",
        ["number", "number", "number", "number", "string", "string", "string", "number"]);
    supprimerTransaction = Module.cwrap("web_supprimer_transaction", "number", ["number"]);
    bilanPosteJson = Module.cwrap("web_bilan_poste_json", "string", ["number", "number"]);
    definirBudget = Module.cwrap("web_definir_budget", null, ["number", "number"]);
    exporterTxt = Module.cwrap("web_exporter", "string", []);
    importerTxt = Module.cwrap("web_importer", "number", ["string"]);

    chargerDepuisStockage();

    remplirSelect(document.getElementById("f-categorie"), JSON.parse(categoriesJson()));
    remplirSelect(document.getElementById("f-paiement"), JSON.parse(paiementsJson()));

    const j = decoderDate(dateDuJour());
    const mp_ap = periodeDeDate(j.jour, j.mois, j.annee);
    document.getElementById("f-mois").value = Math.floor(mp_ap / 10000);
    document.getElementById("f-annee").value = mp_ap % 10000;

    reinitialiserFormulaire();

    document.getElementById("btn-ajouter").addEventListener("click", validerFormulaire);
    document.getElementById("btn-periode").addEventListener("click", actualiserPeriodeAffichee);
    document.getElementById("btn-telecharger").addEventListener("click", telechargerSauvegarde);
    document.getElementById("f-fichier-import").addEventListener("change", importerSauvegarde);

    document.getElementById("etat-chargement").style.display = "none";
    document.getElementById("section-ajout").style.display = "block";
    document.getElementById("section-periode").style.display = "block";
    document.getElementById("section-budgets").style.display = "block";
    document.getElementById("section-sauvegarde").style.display = "block";

    actualiserPeriodeAffichee();
};

/* ---------------------------------------------------------- *
 *  Telechargement / rechargement d'une sauvegarde (fichier .txt)
 * ---------------------------------------------------------- */
function telechargerSauvegarde() {
    const donnees = exporterTxt();
    const blob = new Blob([donnees], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const aujourdhui = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comptes_sauvegarde_${aujourdhui}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function importerSauvegarde(evenement) {
    const fichier = evenement.target.files[0];
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
        const ok = importerTxt(lecteur.result);
        if (ok) {
            sauvegarder();
            remplirSelect(document.getElementById("f-categorie"), JSON.parse(categoriesJson()));
            remplirSelect(document.getElementById("f-paiement"), JSON.parse(paiementsJson()));
            actualiserPeriodeAffichee();
            alert("Sauvegarde rechargee avec succes.");
        } else {
            alert("Ce fichier ne semble pas etre une sauvegarde valide.");
        }
    };
    lecteur.readAsText(fichier);
    evenement.target.value = "";
}
