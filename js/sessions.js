// js/sessions.js : le journal du temps d'étude (SF.sessions).
// Une session = un bloc de temps travaillé sur une matière : { id, date, subject, minutes, note, source, createdAt }.
// Ce fichier crée un seul module : SF.sessions.
// Il faut charger dates.js et storage.js AVANT ce fichier.
(function () {
  'use strict';
  window.SF = window.SF || {};

  // ===================================================================
  // 1) Constantes : limites et valeurs autorisées
  // ===================================================================

  const SOURCES = ['manual', 'timer'];                                       // 'manual' = saisie à la main, 'timer' = chrono
  const EDITABLE_FIELDS = ['date', 'subject', 'minutes', 'note', 'source']; // les champs que update() peut modifier
  const MAX_SUBJECT_LENGTH = 60;
  const MAX_NOTE_LENGTH = 200;
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 720;
  const MAX_RANGE_DAYS = 400;        // getDayTotals refuse les plages plus longues
  const STREAK_MINUTES = 10;         // minutes minimum pour qu'un jour compte dans la série
  const DEFAULT_GOAL_MINUTES = 120;  // objectif utilisé si le réglage dailyGoalMinutes manque
  const DEFAULT_RECENT_LIMIT = 5;    // nombre de sessions renvoyées par getRecent() si on ne précise rien

  // ===================================================================
  // 2) Petits outils
  // ===================================================================

  // Dit si une valeur est un objet "normal" (ni null, ni tableau).
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // Dit si un objet d'erreurs contient au moins une erreur.
  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  // Dit si une valeur est absente : rien, null ou texte vide (des espaces seuls comptent comme vide).
  function isMissing(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  }

  // Transforme une durée en nombre : un nombre reste tel quel, un texte comme '45' devient 45, le reste donne NaN.
  function toMinutes(value) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return Number(value);
    }
    return NaN;
  }

  // Dit si une valeur est un vrai objet Date (et pas "Invalid Date").
  function isRealDate(value) {
    return value instanceof Date && !isNaN(value.getTime());
  }

  // Dit si deux dates ISO valides forment une plage (le début est avant la fin, ou le même jour).
  function isValidRange(startISO, endISO) {
    return typeof startISO === 'string' && typeof endISO === 'string' &&
      SF.dates.isValidISO(startISO) && SF.dates.isValidISO(endISO) && startISO <= endISO;
  }

  // Le résultat renvoyé quand la sauvegarde échoue (espace plein ou stockage bloqué).
  function saveFailed() {
    return { ok: false, errors: { general: "Impossible d'enregistrer la session (espace de stockage plein ou bloqué)." } };
  }

  // ===================================================================
  // 3) Vérifier et nettoyer les données d'une session
  // ===================================================================

  // Vérifie les données d'une session. Renvoie un objet d'erreurs { champ: 'message' } (vide si tout est correct).
  function validate(data) {
    const input = isObject(data) ? data : {};
    const errors = {};

    // Matière : obligatoire, 1 à 60 caractères.
    if (isMissing(input.subject)) {
      errors.subject = 'La matière est obligatoire.';
    } else if (typeof input.subject !== 'string') {
      errors.subject = 'La matière doit être un texte.';
    } else if (input.subject.trim().length > MAX_SUBJECT_LENGTH) {
      errors.subject = 'La matière ne doit pas dépasser ' + MAX_SUBJECT_LENGTH + ' caractères.';
    }

    // Durée : nombre entier de minutes entre 1 et 720 (un texte comme '45' est accepté).
    const minutes = toMinutes(input.minutes);
    if (isMissing(input.minutes)) {
      errors.minutes = 'La durée est obligatoire.';
    } else if (!Number.isInteger(minutes)) {
      errors.minutes = 'La durée doit être un nombre entier de minutes.';
    } else if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      errors.minutes = 'La durée doit être comprise entre ' + MIN_MINUTES + ' et ' + MAX_MINUTES + ' minutes.';
    }

    // Date : obligatoire, valide, et pas dans le futur (deux dates ISO se comparent comme du texte).
    if (isMissing(input.date)) {
      errors.date = 'La date est obligatoire.';
    } else if (typeof input.date !== 'string' || !SF.dates.isValidISO(input.date.trim())) {
      errors.date = "La date n'est pas valide (format AAAA-MM-JJ).";
    } else if (input.date.trim() > SF.dates.todayISO()) {
      errors.date = 'La date ne peut pas être dans le futur.';
    }

    // Note : facultative, 200 caractères au maximum.
    if (!isMissing(input.note)) {
      if (typeof input.note !== 'string') {
        errors.note = 'La note doit être un texte.';
      } else if (input.note.trim().length > MAX_NOTE_LENGTH) {
        errors.note = 'La note ne doit pas dépasser ' + MAX_NOTE_LENGTH + ' caractères.';
      }
    }

    // Source : 'manual' (valeur par défaut) ou 'timer'.
    if (!isMissing(input.source) && SOURCES.indexOf(input.source) === -1) {
      errors.source = 'La source doit être « manual » ou « timer ».';
    }

    return errors;
  }

  // Prépare les données d'une session DÉJÀ vérifiée : texte nettoyé, durée en nombre, valeurs par défaut.
  function clean(data) {
    return {
      date: data.date.trim(),
      subject: data.subject.trim(),
      minutes: toMinutes(data.minutes),
      note: typeof data.note === 'string' ? data.note.trim() : '',
      source: isMissing(data.source) ? 'manual' : data.source
    };
  }

  // ===================================================================
  // 4) Lire les sessions
  // ===================================================================

  // Lit les sessions utilisables : on ignore celles dont la date, la matière ou la durée est abîmée.
  function loadUsable() {
    return SF.storage.load('sessions').filter(function (session) {
      return typeof session.date === 'string' && SF.dates.isValidISO(session.date) &&
        typeof session.subject === 'string' && session.subject.trim() !== '' &&
        typeof session.minutes === 'number' && Number.isFinite(session.minutes) && session.minutes > 0;
    });
  }

  // Trie une copie de la liste par date puis par heure de création, de la plus ancienne à la plus récente.
  function sortOldestFirst(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) {
        return a.date < b.date ? -1 : 1;
      }
      const createdA = typeof a.createdAt === 'string' ? a.createdAt : '';
      const createdB = typeof b.createdAt === 'string' ? b.createdAt : '';
      if (createdA === createdB) {
        return 0; // égalité : on garde l'ordre d'ajout
      }
      return createdA < createdB ? -1 : 1;
    });
  }

  // Cherche la position d'une session dans la liste grâce à son id (-1 si elle n'existe pas).
  function findIndexById(list, id) {
    if (typeof id !== 'string' || id === '') {
      return -1;
    }
    return list.findIndex(function (session) {
      return session.id === id;
    });
  }

  // Toutes les sessions sauvegardées, dans l'ordre où elles ont été ajoutées.
  function getAll() {
    return SF.storage.load('sessions');
  }

  // Une session grâce à son id (null si elle n'existe pas).
  function getById(id) {
    const list = SF.storage.load('sessions');
    const index = findIndexById(list, id);
    return index === -1 ? null : list[index];
  }

  // Les sessions d'une plage de dates (bornes comprises), de la plus ancienne à la plus récente.
  function getByRange(startISO, endISO) {
    if (!isValidRange(startISO, endISO)) {
      return [];
    }
    const inRange = loadUsable().filter(function (session) {
      return session.date >= startISO && session.date <= endISO;
    });
    return sortOldestFirst(inRange);
  }

  // Les sessions d'un jour, dans l'ordre où elles ont été créées.
  function getByDate(iso) {
    return getByRange(iso, iso);
  }

  // Les dernières sessions, la plus récente d'abord (5 par défaut si "limit" n'est pas un nombre entier positif).
  function getRecent(limit) {
    const count = Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_RECENT_LIMIT;
    return sortOldestFirst(loadUsable()).reverse().slice(0, count);
  }

  // ===================================================================
  // 5) Ajouter, modifier, supprimer
  // ===================================================================

  // Ajoute une session. Renvoie { ok: true, item } ou { ok: false, errors }.
  function add(data) {
    const errors = validate(data);
    if (hasErrors(errors)) {
      return { ok: false, errors: errors };
    }
    const cleaned = clean(data);
    const session = {
      id: SF.storage.newId(),
      date: cleaned.date,
      subject: cleaned.subject,
      minutes: cleaned.minutes,
      note: cleaned.note,
      source: cleaned.source,
      createdAt: new Date().toISOString() // date-heure complète : ici toISOString() est voulu
    };
    const list = SF.storage.load('sessions');
    list.push(session);
    if (!SF.storage.save('sessions', list)) {
      return saveFailed();
    }
    return { ok: true, item: session };
  }

  // Modifie une session (seuls les champs présents dans "patch" changent). Renvoie { ok: true, item } ou { ok: false, errors }.
  function update(id, patch) {
    const list = SF.storage.load('sessions');
    const index = findIndexById(list, id);
    if (index === -1) {
      return { ok: false, errors: { general: "Cette session n'existe pas." } };
    }

    const changes = isObject(patch) ? patch : {};
    const merged = Object.assign({}, list[index]); // la session actuelle + les changements demandés
    EDITABLE_FIELDS.forEach(function (key) {
      if (changes[key] !== undefined) {
        merged[key] = changes[key];
      }
    });

    const errors = validate(merged);
    if (hasErrors(errors)) {
      return { ok: false, errors: errors };
    }
    const updated = Object.assign({}, list[index], clean(merged)); // l'id et createdAt ne changent jamais
    list[index] = updated;
    if (!SF.storage.save('sessions', list)) {
      return saveFailed();
    }
    return { ok: true, item: updated };
  }

  // Supprime une session. Renvoie true si elle a été supprimée, false sinon (id inconnu ou sauvegarde impossible).
  function remove(id) {
    const list = SF.storage.load('sessions');
    const index = findIndexById(list, id);
    if (index === -1) {
      return false;
    }
    list.splice(index, 1);
    return SF.storage.save('sessions', list);
  }

  // ===================================================================
  // 6) Totaux par jour et par matière
  // ===================================================================

  // Liste toutes les dates d'une plage, bornes comprises. Renvoie [] si la plage est invalide ou dépasse 400 jours.
  function listDays(startISO, endISO) {
    if (!isValidRange(startISO, endISO)) {
      return [];
    }
    const days = [];
    let day = startISO;
    while (day <= endISO && days.length <= MAX_RANGE_DAYS) {
      days.push(day);
      day = SF.dates.addDays(day, 1);
    }
    return days.length > MAX_RANGE_DAYS ? [] : days;
  }

  // Additionne les minutes et compte les sessions de chaque jour : { 'AAAA-MM-JJ': { minutes, count } }.
  function totalsByDate(list) {
    const totals = {};
    list.forEach(function (session) {
      if (!totals[session.date]) {
        totals[session.date] = { minutes: 0, count: 0 };
      }
      totals[session.date].minutes += session.minutes;
      totals[session.date].count += 1;
    });
    return totals;
  }

  // Un élément PAR JOUR de la plage (même les jours sans étude) : [{ date, minutes, count }].
  function getDayTotals(startISO, endISO) {
    const days = listDays(startISO, endISO);
    if (days.length === 0) {
      return [];
    }
    const totals = totalsByDate(getByRange(startISO, endISO));
    return days.map(function (date) {
      const total = totals[date] || { minutes: 0, count: 0 };
      return { date: date, minutes: total.minutes, count: total.count };
    });
  }

  // Clé de regroupement d'une matière : sans majuscules ni accents ('Mathématiques' et 'mathematiques' sont identiques).
  function subjectKey(subject) {
    return subject.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Les minutes de chaque matière sur une plage, de la plus grande à la plus petite : [{ subject, minutes }].
  // Deux matières qui ne diffèrent que par la casse ou les accents sont regroupées sous la première écriture rencontrée.
  function getSubjectTotals(startISO, endISO) {
    const groups = new Map(); // clé de regroupement -> { subject, minutes }
    getByRange(startISO, endISO).forEach(function (session) {
      const key = subjectKey(session.subject);
      if (!groups.has(key)) {
        groups.set(key, { subject: session.subject.trim(), minutes: 0 });
      }
      groups.get(key).minutes += session.minutes;
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.minutes - a.minutes;
    });
  }

  // ===================================================================
  // 7) Statistiques
  // ===================================================================

  // Objectif d'étude par jour (réglage dailyGoalMinutes). Si le réglage manque ou est incorrect, on prend 120.
  function readGoalMinutes() {
    const goal = SF.storage.getSettings().dailyGoalMinutes;
    return Number.isInteger(goal) && goal > 0 ? goal : DEFAULT_GOAL_MINUTES;
  }

  // Dit si un jour a au moins 10 minutes d'étude ("totals" vient de totalsByDate).
  function hasEnoughMinutes(totals, date) {
    return totals[date] !== undefined && totals[date].minutes >= STREAK_MINUTES;
  }

  // Nombre de jours consécutifs avec au moins 10 minutes d'étude, en remontant depuis aujourd'hui.
  // Si aujourd'hui n'a pas encore 10 minutes, on part d'hier : la série n'est pas perdue avant la fin de la journée.
  function computeStreak(totals, today) {
    let day = today;
    if (!hasEnoughMinutes(totals, day)) {
      day = SF.dates.addDays(today, -1);
    }
    let streak = 0;
    while (hasEnoughMinutes(totals, day)) {
      streak += 1;
      day = SF.dates.addDays(day, -1);
    }
    return streak;
  }

  // Moyenne de minutes par jour, de la plus ancienne session jusqu'à aujourd'hui (aujourd'hui compris, au moins 1 jour).
  function computeAverage(list, totalMinutes, today) {
    if (list.length === 0) {
      return 0;
    }
    let oldest = list[0].date;
    list.forEach(function (session) {
      if (session.date < oldest) {
        oldest = session.date;
      }
    });
    let dayCount = 1; // jamais moins de 1 : on ne divise jamais par zéro
    if (oldest < today) {
      dayCount = Math.round(Math.abs(SF.dates.diffDays(oldest, today))) + 1;
    }
    return Math.round(totalMinutes / dayCount);
  }

  // Pourcentage de l'objectif atteint aujourd'hui : un entier, 100 au maximum.
  function computePercent(todayMinutes, goalMinutes) {
    if (goalMinutes <= 0) {
      return 0;
    }
    return Math.min(100, Math.round(todayMinutes / goalMinutes * 100));
  }

  // Les statistiques du journal. "now" (un objet Date) est facultatif : il sert surtout aux tests.
  function getStats(now) {
    const today = SF.dates.todayISO(isRealDate(now) ? now : new Date());
    const list = loadUsable();
    const totals = totalsByDate(list);
    const totalMinutes = list.reduce(function (sum, session) {
      return sum + session.minutes;
    }, 0);
    const todayMinutes = totals[today] ? totals[today].minutes : 0;
    const goalMinutes = readGoalMinutes();

    return {
      totalMinutes: totalMinutes,
      sessionsCount: list.length,
      avgMinutesPerDay: computeAverage(list, totalMinutes, today),
      streakDays: computeStreak(totals, today),
      todayMinutes: todayMinutes,
      goalMinutes: goalMinutes,
      goalPercent: computePercent(todayMinutes, goalMinutes)
    };
  }

  SF.sessions = {
    getAll: getAll,
    getById: getById,
    validate: validate,
    add: add,
    update: update,
    remove: remove,
    getByDate: getByDate,
    getByRange: getByRange,
    getRecent: getRecent,
    getDayTotals: getDayTotals,
    getSubjectTotals: getSubjectTotals,
    getStats: getStats
  };
})();
