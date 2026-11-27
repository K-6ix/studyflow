// js/filters.js — Recherche, filtres et tris des activités : SF.filters
// À charger après dates.js, storage.js, activities.js et timetable.js.
// Ce fichier ne modifie jamais les données : il les lit, puis renvoie des résultats.
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Rang de chaque priorité pour le tri (0 = la plus importante).
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  // ---------- Petites fonctions privées (utilisées seulement dans ce fichier) ----------

  // Renvoie le texte sans espaces autour, ou '' si la valeur n'est pas un texte.
  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // Met un texte en minuscules et retire les accents : « Révision » devient « revision ».
  function normalizeText(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Clé de comparaison d'une matière : 'Maths', 'maths' et ' MATHS ' donnent la même clé.
  function makeKey(value) {
    return normalizeText(value).trim();
  }

  // Renvoie la date si elle est valide ('YYYY-MM-DD'), sinon '' (= pas de borne).
  function cleanDate(value) {
    const text = cleanString(value);
    if (text === '') {
      return '';
    }
    try {
      return SF.dates.isValidISO(text) ? text : '';
    } catch (error) {
      return '';
    }
  }

  // Complète les critères : un champ absent ou invalide devient '' (= pas de filtre).
  function cleanCriteria(criteria) {
    const source = criteria && typeof criteria === 'object' ? criteria : {};
    return {
      text: cleanString(source.text),
      subject: cleanString(source.subject),
      type: cleanString(source.type),
      priority: cleanString(source.priority),
      status: cleanString(source.status),
      fromDate: cleanDate(source.fromDate),
      toDate: cleanDate(source.toDate)
    };
  }

  // Découpe la recherche en mots normalisés ; les espaces en trop sont ignorés.
  function splitWords(text) {
    return normalizeText(text)
      .split(/\s+/)
      .filter((word) => word !== '');
  }

  // Vrai si TOUS les mots se trouvent dans le titre, la description ou la matière.
  function containsAllWords(activity, words) {
    const allText = [activity.title, activity.description, activity.subject]
      .map((value) => normalizeText(value))
      .join(' ');
    return words.every((word) => allText.includes(word));
  }

  // Vrai si la date est entre les deux bornes (incluses) ; '' = pas de borne.
  // Si fromDate est après toDate, aucune date ne convient : le résultat est vide.
  function isInDateRange(date, fromDate, toDate) {
    if (fromDate !== '' && date < fromDate) {
      return false;
    }
    if (toDate !== '' && date > toDate) {
      return false;
    }
    return true;
  }

  // Renvoie le statut affiché de l'activité : 'pending', 'done' ou 'overdue'.
  function getStatus(activity) {
    // Une activité terminée n'est JAMAIS en retard.
    if (activity.status === 'done') {
      return 'done';
    }
    try {
      return SF.activities.getDisplayStatus(activity);
    } catch (error) {
      return activity.status;
    }
  }

  // Lit toutes les données d'un module (activités ou cours) ; renvoie [] en cas de problème.
  function readAll(moduleObject) {
    try {
      const list = moduleObject.getAll();
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  // Compare deux textes dans l'ordre alphabétique français (majuscules et accents ignorés).
  function compareText(textA, textB) {
    return textA.localeCompare(textB, 'fr', { sensitivity: 'base' });
  }

  // Compare deux activités par titre.
  function compareByTitle(a, b) {
    return compareText(cleanString(a.title), cleanString(b.title));
  }

  // Compare deux activités : date, puis heure (les activités sans heure d'abord), puis titre.
  function compareByDate(a, b) {
    const dateA = cleanString(a.date);
    const dateB = cleanString(b.date);
    if (dateA !== dateB) {
      return dateA < dateB ? -1 : 1;
    }
    // '' (pas d'heure) est plus petit que '08:30' : les activités sans heure passent donc d'abord.
    const timeA = cleanString(a.time);
    const timeB = cleanString(b.time);
    if (timeA !== timeB) {
      return timeA < timeB ? -1 : 1;
    }
    return compareByTitle(a, b);
  }

  // Renvoie le rang d'une priorité (high = 0, medium = 1, low = 2, inconnue = 3).
  function getPriorityRank(priority) {
    const rank = PRIORITY_RANK[priority];
    return typeof rank === 'number' ? rank : 3;
  }

  // Compare deux activités : priorité ('high' d'abord), puis comme le tri par date.
  function compareByPriority(a, b) {
    const difference = getPriorityRank(a.priority) - getPriorityRank(b.priority);
    if (difference !== 0) {
      return difference;
    }
    return compareByDate(a, b);
  }

  // ---------- Fonctions publiques (elles forment SF.filters) ----------

  // Renvoie des critères tous vides ('' = pas de filtre) : c'est le bouton « Réinitialiser ».
  function emptyCriteria() {
    return { text: '', subject: '', type: '', priority: '', status: '', fromDate: '', toDate: '' };
  }

  // Dit si UNE activité respecte TOUS les critères renseignés (renvoie true ou false).
  function matches(activity, criteria) {
    if (!activity || typeof activity !== 'object') {
      return false;
    }
    const wanted = cleanCriteria(criteria);

    if (wanted.type !== '' && activity.type !== wanted.type) {
      return false;
    }
    if (wanted.priority !== '' && activity.priority !== wanted.priority) {
      return false;
    }
    if (wanted.subject !== '' && makeKey(activity.subject) !== makeKey(wanted.subject)) {
      return false;
    }
    if (!isInDateRange(cleanString(activity.date), wanted.fromDate, wanted.toDate)) {
      return false;
    }
    if (wanted.status !== '' && getStatus(activity) !== wanted.status) {
      return false;
    }
    return containsAllWords(activity, splitWords(wanted.text));
  }

  // Renvoie une COPIE triée (by : 'date', 'priority' ou 'title' ; direction : 'asc' ou 'desc').
  function sort(list, by, direction) {
    if (!Array.isArray(list)) {
      return [];
    }
    let compare = compareByDate; // tri par défaut
    if (by === 'priority') {
      compare = compareByPriority;
    } else if (by === 'title') {
      compare = compareByTitle;
    }
    const sign = direction === 'desc' ? -1 : 1; // 'desc' inverse tout l'ordre
    try {
      // slice() fait une copie : la liste d'origine n'est jamais modifiée.
      // sort() est stable : deux éléments égaux gardent leur ordre d'origine.
      return list.slice().sort((a, b) => sign * compare(a, b));
    } catch (error) {
      return list.slice();
    }
  }

  // Prend toutes les activités, garde celles qui respectent les critères, puis les trie.
  function apply(criteria, by, direction) {
    const kept = readAll(SF.activities).filter((activity) => matches(activity, criteria));
    return sort(kept, by, direction);
  }

  // Renvoie les matières des activités et des cours : sans doublons, triées de A à Z.
  function getSubjects() {
    const items = readAll(SF.activities).concat(readAll(SF.timetable));
    const seenKeys = new Set();
    const subjects = [];
    items.forEach((item) => {
      const name = item ? cleanString(item.subject) : '';
      const key = makeKey(name);
      if (name !== '' && !seenKeys.has(key)) {
        seenKeys.add(key); // on garde la première écriture rencontrée
        subjects.push(name);
      }
    });
    return subjects.sort(compareText);
  }

  SF.filters = {
    emptyCriteria: emptyCriteria,
    matches: matches,
    sort: sort,
    apply: apply,
    getSubjects: getSubjects
  };
})();
