/* ============================================================
 * app.js - Relie index.html au module WASM (calcul.js/calcul.wasm
 * generes par Emscripten a partir de calcul.c + web_api.c).
 * ============================================================ */

const CLE_STOCKAGE = "comptes_donnees";

let categoriesJson, paiementsJson, postesJson;
let dateDuJour, periodeDeDate;
let listeTransactionsPeriodeJson, ajouterTransaction, modifierTransaction, supprimerTransaction;
let bilanCategorieJson, bilanPosteJson, definirBudget;
let evaluerExpression;
let listeRecurrentesJson, ajouterRecurrente, modifierRecurrente, supprimerRecurrente;
let appliquerRecurrente;
let listeChequesJson, ajouterCheque, modifierCheque, supprimerCheque;
let basculerTireCheque, totalChequesNonTires;
let exporterTxt, importerTxt;

let indexEnEdition = null; /* null = mode "ajout", sinon index de la transaction modifiee */
let indexRecurrenteEnEdition = null; /* idem pour le formulaire "modeles recurrents" */
let indexChequeEnEdition = null; /* idem pour le formulaire "cheques" */

/* Construit au demarrage a partir de web_postes_json() : associe
 * chaque nom de categorie au nom de son poste (ex: "loyer" -> "LOGEMENT"),
 * pour appliquer la meme couleur dans les transactions et les bilans. */
let CATEGORIE_VERS_POSTE = {};

/* Renvoie la classe CSS de couleur pour un poste donne (ou grise si
 * inconnu, cas de la categorie "autre" qui n'appartient a aucun poste). */
function classePoste(nomPoste) {
    return nomPoste ? `poste-${nomPoste}` : "poste-AUTRE";
}
function classePosteDeCategorie(nomCategorie) {
    return classePoste(CATEGORIE_VERS_POSTE[nomCategorie]);
}

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
    const somme = evaluerExpression(document.getElementById("f-somme").value.trim());

    if (!libelle) { alert("Merci de saisir un libelle."); return; }
    if (isNaN(somme) || somme === 0) { alert("Montant invalide (nombre ou calcul attendu, ex: 12.50+3.20 ; positif = credit, negatif = debit)."); return; }

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

    /* Les plus recentes en premier : le JSON arrive trie par date
     * croissante (calcul_trier_transactions), on inverse juste pour
     * l'affichage. Les lookups (modifier/supprimer) continuent a
     * utiliser donnees.transactions (ordre d'origine, peu importe). */
    const transactionsAffichees = donnees.transactions.slice().reverse();

    for (const t of transactionsAffichees) {
        const d = decoderDate(t.date);
        const tr = document.createElement("tr");
        const classeSomme = t.somme >= 0 ? "positif" : "negatif";
        const classePosteCourant = classePosteDeCategorie(t.categorie);
        tr.innerHTML = `
            <td class="${classePosteCourant}">${String(d.jour).padStart(2, "0")}/${String(d.mois).padStart(2, "0")}/${d.annee}</td>
            <td class="${classePosteCourant}">${t.libelle}</td>
            <td class="${classePosteCourant}">${t.categorie}</td>
            <td class="${classePosteCourant}">${t.paiement}</td>
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

    actualiserBilanCategorie(mois, annee);
    actualiserBudgets(mois, annee);
}

function actualiserBilanCategorie(mois, annee) {
    const bilan = JSON.parse(bilanCategorieJson(mois, annee));
    const tbody = document.querySelector("#table-bilan-categorie tbody");
    tbody.innerHTML = "";

    for (const c of bilan.categories) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="${classePosteDeCategorie(c.categorie)}">${c.categorie}</td><td>${c.nb}</td><td>${c.total.toFixed(2)}</td>`;
        tbody.appendChild(tr);
    }

    document.getElementById("totaux-categorie").textContent =
        bilan.categories.length === 0
            ? "(aucune transaction sur cette periode)"
            : `Total credits : ${bilan.total_credit.toFixed(2)}   |   ` +
              `Total debits : ${bilan.total_debit.toFixed(2)}   |   ` +
              `Solde : ${(bilan.total_credit + bilan.total_debit).toFixed(2)}`;
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
            <td class="${classePoste(p.nom)}">${p.nom}</td>
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
 *  Transactions recurrentes (salaire, loyer...)
 * ---------------------------------------------------------- */
function reinitialiserFormulaireRecurrente() {
    indexRecurrenteEnEdition = null;
    document.getElementById("btn-recurrente-valider").textContent = "Ajouter le modele";
    document.getElementById("btn-recurrente-annuler").style.display = "none";
    document.getElementById("r-libelle").value = "";
    document.getElementById("r-jour").value = 1;
    document.getElementById("r-montant").value = "";
    document.getElementById("r-actif").checked = true;
}

function chargerRecurrenteDansFormulaire(r) {
    indexRecurrenteEnEdition = r.index;
    document.getElementById("btn-recurrente-valider").textContent = "Enregistrer les modifications";
    document.getElementById("btn-recurrente-annuler").style.display = "inline-block";
    document.getElementById("r-libelle").value = r.libelle;
    document.getElementById("r-categorie").value = r.categorie;
    document.getElementById("r-paiement").value = r.paiement;
    document.getElementById("r-jour").value = r.jour;
    document.getElementById("r-montant").value = r.montant;
    document.getElementById("r-actif").checked = !!r.actif;
    window.scrollTo({ top: document.getElementById("section-recurrentes").offsetTop, behavior: "smooth" });
}

function validerFormulaireRecurrente() {
    const libelle = document.getElementById("r-libelle").value.trim();
    const categorie = document.getElementById("r-categorie").value;
    const paiement = document.getElementById("r-paiement").value;
    const jour = parseInt(document.getElementById("r-jour").value, 10);
    const montant = evaluerExpression(document.getElementById("r-montant").value.trim());
    const actif = document.getElementById("r-actif").checked ? 1 : 0;

    if (!libelle) { alert("Merci de saisir un libelle."); return; }
    if (isNaN(jour) || jour < 1 || jour > 31) { alert("Jour invalide (1-31)."); return; }
    if (isNaN(montant) || montant === 0) { alert("Montant invalide (nombre ou calcul attendu, ex: 2000+200)."); return; }

    if (indexRecurrenteEnEdition === null) {
        ajouterRecurrente(libelle, categorie, paiement, jour, montant, actif);
    } else {
        modifierRecurrente(indexRecurrenteEnEdition, libelle, categorie, paiement, jour, montant, actif);
    }

    sauvegarder();
    reinitialiserFormulaireRecurrente();
    actualiserListeRecurrentes();
}

function actualiserListeRecurrentes() {
    const liste = JSON.parse(listeRecurrentesJson());
    const tbody = document.querySelector("#table-recurrentes tbody");
    tbody.innerHTML = "";

    for (const r of liste) {
        const tr = document.createElement("tr");
        const classePosteCourant = classePosteDeCategorie(r.categorie);
        tr.innerHTML = `
            <td class="${classePosteCourant}">${r.libelle}</td>
            <td class="${classePosteCourant}">${r.categorie}</td>
            <td class="${classePosteCourant}">${r.paiement}</td>
            <td class="${classePosteCourant}">${r.jour}</td>
            <td>${r.montant.toFixed(2)}</td>
            <td>${r.actif ? "actif" : "suspendu"}</td>
            <td>
                <button data-action="modifier" data-index="${r.index}">Modifier</button>
                <button data-action="supprimer" data-index="${r.index}">Supprimer</button>
            </td>`;
        tbody.appendChild(tr);
    }

    tbody.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            if (btn.dataset.action === "supprimer") {
                if (confirm("Supprimer ce modele recurrent ?")) {
                    supprimerRecurrente(idx);
                    sauvegarder();
                    actualiserListeRecurrentes();
                }
            } else {
                const r = liste.find((x) => x.index === idx);
                chargerRecurrenteDansFormulaire(r);
            }
        });
    });
}

/* Appelle web_preparer_generation, qui a un parametre de sortie
 * (index_existant) fourni via un pointeur : on l'alloue nous-memes
 * dans la memoire WASM (Module._malloc), on lit le resultat avec
 * Module.getValue (plus fiable que Module.HEAP32, qui n'est pas
 * expose sur Module dans toutes les versions d'Emscripten), puis on
 * le libere (Module._free). */
function preparerGeneration(indexRecurrente, mois, annee) {
    const ptr = Module._malloc(4);
    const dateEncodee = Module.ccall(
        "web_preparer_generation", "number",
        ["number", "number", "number", "number"],
        [indexRecurrente, mois, annee, ptr]
    );
    const indexExistant = Module.getValue(ptr, "i32");
    Module._free(ptr);
    return { dateEncodee, indexExistant };
}

function genererRecurrentesPeriode() {
    const mois = parseInt(document.getElementById("f-mois").value, 10);
    const annee = parseInt(document.getElementById("f-annee").value, 10);
    if (!mois || !annee) { alert("Choisissez d'abord une periode (section Transactions de la periode)."); return; }

    const recurrentes = JSON.parse(listeRecurrentesJson());
    let nbTraites = 0;

    for (const r of recurrentes) {
        if (!r.actif) continue;

        const { dateEncodee, indexExistant } = preparerGeneration(r.index, mois, annee);
        const dateProposee = decoderDate(dateEncodee);
        const dateProposeeTexte =
            `${String(dateProposee.jour).padStart(2, "0")}/${String(dateProposee.mois).padStart(2, "0")}/${dateProposee.annee}`;

        let remplacer = false;
        if (indexExistant !== -1) {
            const choix = prompt(
                `"${r.libelle}" (${r.categorie}) existe deja pour cette periode.\n` +
                `i = ignorer, r = remplacer, a = ajouter quand meme`, "i");
            if (choix === null) continue;
            const c = choix.trim().toLowerCase();
            if (c === "i" || c === "") continue;
            remplacer = c === "r";
        }

        const montantSaisi = prompt(`Montant pour "${r.libelle}" (nombre ou calcul, ex: 2000+200) :`, r.montant);
        if (montantSaisi === null) continue;
        const montant = evaluerExpression(montantSaisi.trim());
        if (isNaN(montant)) { alert("Montant invalide, transaction ignoree."); continue; }

        const dateSaisie = prompt(`Date pour "${r.libelle}" (JJ/MM/AAAA) :`, dateProposeeTexte);
        if (dateSaisie === null) continue;
        const morceaux = dateSaisie.split("/").map(Number);
        if (morceaux.length !== 3 || morceaux.some(isNaN)) { alert("Date invalide, transaction ignoree."); continue; }
        const [jj, mm, aa] = morceaux;

        appliquerRecurrente(r.index, jj, mm, aa, montant, indexExistant, remplacer ? 1 : 0);
        nbTraites++;
    }

    sauvegarder();
    actualiserPeriodeAffichee();
    alert(`${nbTraites} transaction(s) recurrente(s) traitee(s) pour ${mois}/${annee}.`);
}

/* ---------------------------------------------------------- *
 *  Suivi des cheques (numero, tire ou non, total en suspens)
 * ---------------------------------------------------------- */
function reinitialiserFormulaireCheque() {
    indexChequeEnEdition = null;
    document.getElementById("btn-cheque-valider").textContent = "Ajouter le cheque";
    document.getElementById("btn-cheque-annuler").style.display = "none";
    document.getElementById("ch-numero").value = "";
    document.getElementById("ch-libelle").value = "";
    const j = decoderDate(dateDuJour());
    document.getElementById("ch-date").value = dateVersInput(j.jour, j.mois, j.annee);
    document.getElementById("ch-montant").value = "";
    document.getElementById("ch-tire").checked = false;
}

function chargerChequeDansFormulaire(c) {
    indexChequeEnEdition = c.index;
    document.getElementById("btn-cheque-valider").textContent = "Enregistrer les modifications";
    document.getElementById("btn-cheque-annuler").style.display = "inline-block";
    document.getElementById("ch-numero").value = c.numero;
    document.getElementById("ch-libelle").value = c.libelle;
    const d = decoderDate(c.date_emission);
    document.getElementById("ch-date").value = dateVersInput(d.jour, d.mois, d.annee);
    document.getElementById("ch-montant").value = c.montant;
    document.getElementById("ch-tire").checked = !!c.tire;
    window.scrollTo({ top: document.getElementById("section-cheques").offsetTop, behavior: "smooth" });
}

function validerFormulaireCheque() {
    const numero = document.getElementById("ch-numero").value.trim();
    const libelle = document.getElementById("ch-libelle").value.trim();
    const { jour, mois, annee } = inputVersDate(document.getElementById("ch-date").value);
    const montant = evaluerExpression(document.getElementById("ch-montant").value.trim());
    const tire = document.getElementById("ch-tire").checked ? 1 : 0;

    if (!numero) { alert("Merci de saisir le numero du cheque."); return; }
    if (isNaN(montant) || montant === 0) { alert("Montant invalide (nombre ou calcul attendu)."); return; }

    if (indexChequeEnEdition === null) {
        ajouterCheque(numero, libelle, montant, jour, mois, annee, tire);
    } else {
        modifierCheque(indexChequeEnEdition, numero, libelle, montant, jour, mois, annee, tire);
    }

    sauvegarder();
    reinitialiserFormulaireCheque();
    actualiserListeCheques();
}

function actualiserListeCheques() {
    const liste = JSON.parse(listeChequesJson());
    const tbody = document.querySelector("#table-cheques tbody");
    tbody.innerHTML = "";

    for (const c of liste) {
        const d = decoderDate(c.date_emission);
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${echapperHTML(c.numero)}</td>
            <td>${echapperHTML(c.libelle)}</td>
            <td>${c.montant.toFixed(2)}</td>
            <td>${String(d.jour).padStart(2, "0")}/${String(d.mois).padStart(2, "0")}/${d.annee}</td>
            <td class="${c.tire ? "tire" : "non-tire"}">${c.tire ? "tire" : "NON TIRE"}</td>
            <td>
                <button data-action="basculer" data-index="${c.index}">${c.tire ? "Marquer non tire" : "Marquer tire"}</button>
                <button data-action="modifier" data-index="${c.index}">Modifier</button>
                <button data-action="supprimer" data-index="${c.index}">Supprimer</button>
            </td>`;
        tbody.appendChild(tr);
    }

    tbody.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            if (btn.dataset.action === "supprimer") {
                if (confirm("Supprimer ce cheque ?")) {
                    supprimerCheque(idx);
                    sauvegarder();
                    actualiserListeCheques();
                }
            } else if (btn.dataset.action === "basculer") {
                basculerTireCheque(idx);
                sauvegarder();
                actualiserListeCheques();
            } else {
                const c = liste.find((x) => x.index === idx);
                chargerChequeDansFormulaire(c);
            }
        });
    });

    document.getElementById("total-cheques-suspens").textContent =
        `Total des cheques non tires (en suspens sur le compte) : ${totalChequesNonTires().toFixed(2)}`;
}

/* ---------------------------------------------------------- *
 *  Initialisation au chargement du module WASM
 * ---------------------------------------------------------- */
Module.onRuntimeInitialized = function () {
    categoriesJson = Module.cwrap("web_categories_json", "string", []);
    paiementsJson = Module.cwrap("web_paiements_json", "string", []);
    postesJson = Module.cwrap("web_postes_json", "string", []);
    dateDuJour = Module.cwrap("web_date_du_jour", "number", []);
    periodeDeDate = Module.cwrap("web_periode_de_date", "number", ["number", "number", "number"]);
    listeTransactionsPeriodeJson = Module.cwrap("web_transactions_periode_json", "string", ["number", "number"]);
    ajouterTransaction = Module.cwrap("web_ajouter_transaction", "number",
        ["number", "number", "number", "string", "string", "string", "number"]);
    modifierTransaction = Module.cwrap("web_modifier_transaction", "number",
        ["number", "number", "number", "number", "string", "string", "string", "number"]);
    supprimerTransaction = Module.cwrap("web_supprimer_transaction", "number", ["number"]);
    bilanCategorieJson = Module.cwrap("web_bilan_categorie_json", "string", ["number", "number"]);
    bilanPosteJson = Module.cwrap("web_bilan_poste_json", "string", ["number", "number"]);
    definirBudget = Module.cwrap("web_definir_budget", null, ["number", "number"]);
    listeRecurrentesJson = Module.cwrap("web_liste_recurrentes_json", "string", []);
    ajouterRecurrente = Module.cwrap("web_ajouter_recurrente", "number",
        ["string", "string", "string", "number", "number", "number"]);
    modifierRecurrente = Module.cwrap("web_modifier_recurrente", "number",
        ["number", "string", "string", "string", "number", "number", "number"]);
    supprimerRecurrente = Module.cwrap("web_supprimer_recurrente", "number", ["number"]);
    appliquerRecurrente = Module.cwrap("web_appliquer_recurrente", "number",
        ["number", "number", "number", "number", "number", "number", "number"]);
    listeChequesJson = Module.cwrap("web_liste_cheques_json", "string", []);
    ajouterCheque = Module.cwrap("web_ajouter_cheque", "number",
        ["string", "string", "number", "number", "number", "number", "number"]);
    modifierCheque = Module.cwrap("web_modifier_cheque", "number",
        ["number", "string", "string", "number", "number", "number", "number", "number"]);
    supprimerCheque = Module.cwrap("web_supprimer_cheque", "number", ["number"]);
    basculerTireCheque = Module.cwrap("web_basculer_tire_cheque", "number", ["number"]);
    totalChequesNonTires = Module.cwrap("web_total_cheques_non_tires", "number", []);
    exporterTxt = Module.cwrap("web_exporter", "string", []);
    importerTxt = Module.cwrap("web_importer", "number", ["string"]);
    evaluerExpression = Module.cwrap("web_evaluer_expression", "number", ["string"]);

    chargerDepuisStockage();

    remplirSelect(document.getElementById("f-categorie"), JSON.parse(categoriesJson()));
    remplirSelect(document.getElementById("f-paiement"), JSON.parse(paiementsJson()));
    remplirSelect(document.getElementById("r-categorie"), JSON.parse(categoriesJson()));
    remplirSelect(document.getElementById("r-paiement"), JSON.parse(paiementsJson()));

    /* Construit la correspondance categorie -> poste (utilisee pour
     * colorer les tableaux) a partir de la liste des postes. */
    CATEGORIE_VERS_POSTE = {};
    for (const p of JSON.parse(postesJson())) {
        for (const c of p.categories) CATEGORIE_VERS_POSTE[c] = p.nom;
    }

    const j = decoderDate(dateDuJour());
    const mp_ap = periodeDeDate(j.jour, j.mois, j.annee);
    document.getElementById("f-mois").value = Math.floor(mp_ap / 10000);
    document.getElementById("f-annee").value = mp_ap % 10000;

    reinitialiserFormulaire();
    reinitialiserFormulaireRecurrente();
    reinitialiserFormulaireCheque();

    document.getElementById("btn-ajouter").addEventListener("click", validerFormulaire);
    document.getElementById("btn-periode").addEventListener("click", actualiserPeriodeAffichee);
    document.getElementById("btn-telecharger").addEventListener("click", telechargerSauvegarde);
    document.getElementById("f-fichier-import").addEventListener("change", importerSauvegarde);
    document.getElementById("btn-apercu-html").addEventListener("click", genererApercuHTML);
    document.getElementById("btn-recurrente-valider").addEventListener("click", validerFormulaireRecurrente);
    document.getElementById("btn-recurrente-annuler").addEventListener("click", reinitialiserFormulaireRecurrente);
    document.getElementById("btn-generer-recurrentes").addEventListener("click", genererRecurrentesPeriode);
    document.getElementById("btn-cheque-valider").addEventListener("click", validerFormulaireCheque);
    document.getElementById("btn-cheque-annuler").addEventListener("click", reinitialiserFormulaireCheque);

    document.getElementById("etat-chargement").style.display = "none";
    document.getElementById("section-ajout").style.display = "block";
    document.getElementById("section-periode").style.display = "block";
    document.getElementById("section-bilan-categorie").style.display = "block";
    document.getElementById("section-budgets").style.display = "block";
    document.getElementById("section-recurrentes").style.display = "block";
    document.getElementById("section-cheques").style.display = "block";
    document.getElementById("section-sauvegarde").style.display = "block";

    actualiserPeriodeAffichee();
    actualiserListeRecurrentes();
    actualiserListeCheques();
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

/* ---------------------------------------------------------- *
 *  Aperçu HTML autonome (transactions + budget par poste + bilan
 *  par categorie de la periode affichee), a partager sans serveur
 *  ni WASM : un seul fichier, ouvrable par simple double-clic.
 * ---------------------------------------------------------- */
function echapperHTML(texte) {
    const div = document.createElement("div");
    div.textContent = String(texte);
    return div.innerHTML;
}

function genererApercuHTML() {
    const mois = parseInt(document.getElementById("f-mois").value, 10);
    const annee = parseInt(document.getElementById("f-annee").value, 10);
    if (!mois || !annee) { alert("Choisissez d'abord une periode (section Transactions de la periode)."); return; }

    const donneesTransactions = JSON.parse(listeTransactionsPeriodeJson(mois, annee));
    const transactionsRecentesDabord = donneesTransactions.transactions.slice().reverse();
    const bilanPoste = JSON.parse(bilanPosteJson(mois, annee));
    const bilanCategorie = JSON.parse(bilanCategorieJson(mois, annee));

    let lignesTransactions = "";
    for (const t of transactionsRecentesDabord) {
        const d = decoderDate(t.date);
        const cls = classePosteDeCategorie(t.categorie);
        const classeSomme = t.somme >= 0 ? "positif" : "negatif";
        lignesTransactions += `<tr>
            <td class="${cls}">${String(d.jour).padStart(2, "0")}/${String(d.mois).padStart(2, "0")}/${d.annee}</td>
            <td class="${cls}">${echapperHTML(t.libelle)}</td>
            <td class="${cls}">${echapperHTML(t.categorie)}</td>
            <td class="${cls}">${echapperHTML(t.paiement)}</td>
            <td class="${classeSomme}">${t.somme.toFixed(2)}</td>
        </tr>`;
    }
    if (!lignesTransactions) lignesTransactions = '<tr><td colspan="5">Aucune transaction sur cette periode</td></tr>';

    let lignesBudget = "";
    for (const p of bilanPoste.postes) {
        const depasse = p.reste < 0;
        lignesBudget += `<tr>
            <td class="${classePoste(p.nom)}">${p.nom}</td>
            <td>${p.budget.toFixed(2)}</td>
            <td>${p.depense.toFixed(2)}</td>
            <td class="${depasse ? "depasse" : ""}">${p.reste.toFixed(2)}${depasse ? " (depasse)" : ""}</td>
        </tr>`;
    }

    let lignesCategorie = "";
    for (const c of bilanCategorie.categories) {
        lignesCategorie += `<tr>
            <td class="${classePosteDeCategorie(c.categorie)}">${echapperHTML(c.categorie)}</td>
            <td>${c.nb}</td>
            <td>${c.total.toFixed(2)}</td>
        </tr>`;
    }
    if (!lignesCategorie) lignesCategorie = '<tr><td colspan="3">Aucune transaction sur cette periode</td></tr>';

    const genereLe = new Date().toLocaleString("fr-FR");

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bilan des comptes - ${String(mois).padStart(2, "0")}/${annee}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 20px auto; padding: 0 12px; }
  h1 { font-size: 1.3em; text-align: center; }
  h2 { font-size: 1.05em; margin-top: 28px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; font-size: 0.9em; }
  thead th { background-color: #ddd; }
  .negatif { color: #b00020; }
  .positif { color: #1b7a1b; }
  .depasse { color: #b00020; font-weight: bold; }
  .info { color: #888; font-size: 0.85em; text-align: center; }
  .poste-LOGEMENT     { background-color: #f5a3a3; }
  .poste-TRANSPORT    { background-color: #f7c08a; }
  .poste-ALIMENTATION { background-color: #f5e07a; }
  .poste-SOINS_PERSO  { background-color: #b8f0c9; }
  .poste-QUOTIDIEN    { background-color: #4f9e6b; color: #fff; }
  .poste-EPARGNE      { background-color: #b3d9f7; }
  .poste-LOISIRS      { background-color: #4472c4; color: #fff; }
  .poste-DONS         { background-color: #cfa8e0; }
  .poste-BANQUE       { background-color: #c9a37a; }
  .poste-AUTRE        { background-color: #e5e5e5; }
</style>
</head>
<body>
  <h1>Bilan des comptes - ${String(mois).padStart(2, "0")}/${annee}</h1>
  <p class="info">Genere le ${genereLe}</p>

  <h2>Transactions de la periode (solde : ${donneesTransactions.solde.toFixed(2)})</h2>
  <table>
    <thead><tr><th>Date</th><th>Libelle</th><th>Categorie</th><th>Paiement</th><th>Somme</th></tr></thead>
    <tbody>${lignesTransactions}</tbody>
  </table>

  <h2>Budget par poste</h2>
  <table>
    <thead><tr><th>Poste</th><th>Budget</th><th>Depense</th><th>Reste</th></tr></thead>
    <tbody>${lignesBudget}</tbody>
  </table>

  <h2>Depenses par categorie</h2>
  <table>
    <thead><tr><th>Categorie</th><th>Nb</th><th>Total</th></tr></thead>
    <tbody>${lignesCategorie}</tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bilan_${String(mois).padStart(2, "0")}_${annee}.html`;
    a.click();
    URL.revokeObjectURL(url);
}
