// js/activities.js — Module SF.activities : devoirs, examens, révisions et projets.
// Utilise SF.dates, SF.constants et SF.storage (chargés avant ce fichier).
// Pas de cache : chaque fonction relit les données avec SF.storage.load('activities').
(function () {
  'use strict';

  window.SF = window.SF || {};

  const COLLECTION = 'activities';
  const DEFAULT_PRIORITY = 'medium';
  const DEFAULT_UPCOMING_LIMIT = 5;

  // Champs que update() peut modifier (id, createdAt et completedAt ne sont jamais modifiés à la main).
  const CHANGEABLE_FIELDS = [
    'title', 'description', 'subject', 'type', 'date',
    'time', 'priority', 'estimatedMinutes', 'status'
  ];

  // ---------- Fonctions privées ----------

  // Transforme une valeur en texte sans espaces autour ('' si la valeur est absente).
  function toText(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  // Dit si la valeur fait partie d'une liste de SF.constants (TYPES, PRIORITIES, STATUSES).
  function isInList(list, value) {
    return Array.isArray(list) && list.indexOf(value) !== -1;
  }

  // Dit si l'objet d'erreurs contient au moins une erreur.
  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  // Dit si la valeur est une date 'YYYY-MM-DD' valide.
  function isValidDate(value) {
    return typeof value === 'string' && SF.dates.isValidISO(value);
  }

  // Dit si la durée est un entier entre 5 et 600 minutes.
  function isValidMinutes(minutes) {
    return Number.isInteger(minutes) && minutes >= 5 && minutes <= 600;
  }

  // Nettoie les champs saisis : textes sans espaces, '' devient null (heure, durée), durée en nombre.
  // Seuls les champs saisissables sont gardés : id, status, createdAt et completedAt sont ignorés.
  function cleanFields(data) {
    const time = toText(data.time);
    const minutes = toText(data.estimatedMinutes);
    return {
      title: toText(data.title),
      description: toText(data.description),
      subject: toText(data.subject),
      type: toText(data.type),
      date: toText(data.date),
      time: time === '' ? null : time,
      priority: toText(data.priority) || DEFAULT_PRIORITY,
      estimatedMinutes: minutes === '' ? null : Number(minutes)
    };
  }

  // Assemble une activité complète, avec les champs dans l'ordre du contrat.
  function buildActivity(fields, id, status, createdAt, completedAt) {
    return {
      id: id,
      title: fields.title,
      description: fields.description,
      subject: fields.subject,
      type: fields.type,
      date: fields.date,
      time: fields.time,
      priority: fields.priority,
      status: status,
      estimatedMinutes: fields.estimatedMinutes,
      createdAt: createdAt,
      completedAt: completedAt
    };
  }

  // Compare deux activités : par date, puis sans heure d'abord, puis par heure croissante.
  function compareByDateAndTime(a, b) {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    const timeA = a.time || '';
    const timeB = b.time || '';
    if (timeA === timeB) {
      return 0;
    }
    return timeA < timeB ? -1 : 1;
  }

  // Enregistre la liste dans localStorage ; renvoie true si la sauvegarde a réussi.
  function saveAll(list) {
    try {
      const result = SF.storage.save(COLLECTION, list);
      if (result === false) {
        return false;
      }
      if (result && result.ok === false) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Résultat à renvoyer quand la sauvegarde a échoué.
  function saveFailed() {
    return {
      ok: false,
      errors: { general: 'La sauvegarde a échoué (stockage plein ou indisponible).' }
    };
  }

  // ---------- Lecture ----------

  // Renvoie toutes les activités enregistrées (tableau vide s'il n'y en a pas).
  function getAll() {
    try {
      const list = SF.storage.load(COLLECTION);
      if (!Array.isArray(list)) {
        return [];
      }
      return list.filter((activity) => activity && typeof activity === 'object');
    } catch (error) {
      return [];
    }
  }

  // Renvoie l'activité qui a cet id, ou null si elle n'existe pas.
  function getById(id) {
    const found = getAll().find((activity) => activity.id === id);
    return found || null;
  }

  // ---------- Validation ----------

  // Vérifie les données d'une activité ; renvoie { champ: message } ({} si tout est bon).
  function validate(data) {
    const input = data || {};
    const fields = cleanFields(input);
    const errors = {};

    if (fields.title === '') {
      errors.title = 'Le titre est obligatoire.';
    } else if (fields.title.length > 100) {
      errors.title = 'Le titre ne doit pas dépasser 100 caractères.';
    }

    if (fields.subject === '') {
      errors.subject = 'La matière est obligatoire.';
    } else if (fields.subject.length > 60) {
      errors.subject = 'La matière ne doit pas dépasser 60 caractères.';
    }

    if (fields.description.length > 500) {
      errors.description = 'La description ne doit pas dépasser 500 caractères.';
    }

    if (!isInList(SF.constants.TYPES, fields.type)) {
      errors.type = "Le type n'est pas valide.";
    }

    if (!isInList(SF.constants.PRIORITIES, fields.priority)) {
      errors.priority = "La priorité n'est pas valide.";
    }

    // Le statut n'est vérifié que s'il est fourni.
    if (input.status !== undefined && input.status !== null &&
        !isInList(SF.constants.STATUSES, input.status)) {
      errors.status = "Le statut n'est pas valide.";
    }

    if (fields.date === '') {
      errors.date = 'La date est obligatoire.';
    } else if (!isValidDate(fields.date)) {
      errors.date = "La date n'est pas valide.";
    }

    if (fields.time !== null && !SF.dates.isValidTime(fields.time)) {
      errors.time = "L'heure n'est pas valide (format HH:MM, par exemple 08:30).";
    }

    if (fields.estimatedMinutes !== null && !isValidMinutes(fields.estimatedMinutes)) {
      errors.estimatedMinutes = 'La durée estimée doit être un nombre entier de minutes, entre 5 et 600.';
    }

    return errors;
  }

  // ---------- Écriture ----------

  // Ajoute une activité (statut 'pending') ; renvoie { ok: true, item } ou { ok: false, errors }.
  function add(data) {
    const fields = cleanFields(data || {});
    const errors = validate(fields);
    if (hasErrors(errors)) {
      return { ok: false, errors: errors };
    }

    const item = buildActivity(fields, SF.storage.newId(), 'pending', new Date().toISOString(), null);
    const list = getAll();
    list.push(item);
    if (!saveAll(list)) {
      return saveFailed();
    }
    return { ok: true, item: item };
  }

  // Modifie une activité : fusionne avec l'existante, revalide tout, met à jour completedAt.
  function update(id, patch) {
    const list = getAll();
    const index = list.findIndex((activity) => activity.id === id);
    if (index === -1) {
      return { ok: false, errors: { id: 'Activité introuvable.' } };
    }
    const old = list[index];

    // On part de l'activité existante, puis on applique les champs du patch.
    const changes = patch || {};
    const merged = {};
    CHANGEABLE_FIELDS.forEach((field) => {
      merged[field] = changes[field] !== undefined ? changes[field] : old[field];
    });

    const errors = validate(merged);
    if (hasErrors(errors)) {
      return { ok: false, errors: errors };
    }

    // completedAt vaut null, sauf si l'activité est terminée.
    const status = merged.status === 'done' ? 'done' : 'pending';
    let completedAt = null;
    if (status === 'done') {
      completedAt = new Date().toISOString();
      // Si elle était déjà terminée, on garde sa date de fin d'origine.
      if (old.status === 'done' && old.completedAt) {
        completedAt = old.completedAt;
      }
    }

    const item = buildActivity(cleanFields(merged), old.id, status, old.createdAt, completedAt);
    list[index] = item;
    if (!saveAll(list)) {
      return saveFailed();
    }
    return { ok: true, item: item };
  }

  // Supprime une activité ; renvoie true si elle a été supprimée, false sinon.
  function remove(id) {
    const list = getAll();
    const remaining = list.filter((activity) => activity.id !== id);
    if (remaining.length === list.length) {
      return false;
    }
    return saveAll(remaining);
  }

  // Marque une activité comme terminée (même retour que update).
  function complete(id) {
    return update(id, { status: 'done' });
  }

  // Remet une activité à faire (même retour que update).
  function reopen(id) {
    return update(id, { status: 'pending' });
  }

  // ---------- Statut ----------

  // Dit si l'activité est en retard : non terminée ET (date passée OU aujourd'hui avec une heure passée).
  function isOverdue(activity, now) {
    if (!activity || activity.status === 'done') {
      return false;
    }
    const current = now || new Date();
    const today = SF.dates.todayISO(current);
    if (activity.date < today) {
      return true;
    }
    if (activity.date === today && activity.time) {
      return activity.time < SF.dates.nowHHMM(current);
    }
    return false;
  }

  // Renvoie le statut à afficher : 'done', 'overdue' ou 'pending'.
  function getDisplayStatus(activity, now) {
    if (activity && activity.status === 'done') {
      return 'done';
    }
    if (isOverdue(activity, now)) {
      return 'overdue';
    }
    return 'pending';
  }

  // ---------- Listes triées ----------

  // Renvoie les activités entre deux dates (bornes incluses), triées par date puis par heure.
  function getByRange(startISO, endISO) {
    if (!isValidDate(startISO) || !isValidDate(endISO)) {
      return [];
    }
    const result = getAll().filter((activity) => {
      return activity.date >= startISO && activity.date <= endISO;
    });
    result.sort(compareByDateAndTime);
    return result;
  }

  // Renvoie les activités d'un jour, triées (sans heure d'abord, puis par heure).
  function getByDate(iso) {
    return getByRange(iso, iso);
  }

  // Renvoie les prochaines activités à faire (non terminées, pas en retard), les plus proches d'abord.
  function getUpcoming(limit) {
    let max = DEFAULT_UPCOMING_LIMIT;
    if (typeof limit === 'number' && limit >= 0) {
      max = limit;
    }
    const now = new Date();
    const today = SF.dates.todayISO(now);
    const upcoming = getAll().filter((activity) => {
      return activity.status !== 'done' && activity.date >= today && !isOverdue(activity, now);
    });
    upcoming.sort(compareByDateAndTime);
    return upcoming.slice(0, max);
  }

  // Renvoie les activités en retard, la plus ancienne d'abord.
  function getOverdue() {
    const now = new Date();
    const overdue = getAll().filter((activity) => isOverdue(activity, now));
    overdue.sort(compareByDateAndTime);
    return overdue;
  }

  SF.activities = {
    getAll: getAll,
    getById: getById,
    validate: validate,
    add: add,
    update: update,
    remove: remove,
    complete: complete,
    reopen: reopen,
    isOverdue: isOverdue,
    getDisplayStatus: getDisplayStatus,
    getByDate: getByDate,
    getByRange: getByRange,
    getUpcoming: getUpcoming,
    getOverdue: getOverdue
  };
})();
