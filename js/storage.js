// js/storage.js : constantes, petit système d'événements et sauvegarde des données.
// Ce fichier crée trois modules : SF.constants, SF.events et SF.storage.
// Il faut charger dates.js AVANT ce fichier (SF.dates sert à vérifier les heures des réglages).
(function () {
  'use strict';
  window.SF = window.SF || {};

  // ===================================================================
  // 1) SF.constants : valeurs autorisées et libellés français
  // ===================================================================

  SF.constants = {
    TYPES: ['homework', 'exam', 'revision', 'project'],
    PRIORITIES: ['low', 'medium', 'high'],
    STATUSES: ['pending', 'done'], // 'overdue' n'est jamais stocké : il est calculé ailleurs
    TARGET_TYPES: ['minutes', 'sessions'],
    LABELS: {
      homework: 'Devoir',
      exam: 'Examen',
      revision: 'Révision',
      project: 'Projet',
      low: 'Basse',
      medium: 'Moyenne',
      high: 'Haute',
      pending: 'À faire',
      done: 'Terminée',
      overdue: 'En retard',
      minutes: 'Minutes',
      sessions: 'Séances'
    }
  };

  // ===================================================================
  // 2) SF.events : prévenir les autres modules quand les données changent
  // ===================================================================

  const listeners = new Map(); // nom de l'événement -> liste de fonctions

  // Enregistre une fonction appelée à chaque émission de l'événement (la même fonction n'est ajoutée qu'une fois).
  function on(name, fn) {
    if (typeof fn !== 'function') {
      return;
    }
    const list = listeners.get(name) || [];
    if (list.indexOf(fn) === -1) {
      list.push(fn);
    }
    listeners.set(name, list);
  }

  // Retire une fonction enregistrée avec on().
  function off(name, fn) {
    const list = listeners.get(name) || [];
    listeners.set(name, list.filter(function (item) { return item !== fn; }));
  }

  // Prévient tous les écouteurs de l'événement. L'erreur de l'un n'empêche pas les autres de s'exécuter.
  function emit(name, payload) {
    const list = (listeners.get(name) || []).slice(); // copie, au cas où un écouteur s'abonne pendant l'émission
    list.forEach(function (fn) {
      try {
        fn(payload);
      } catch (error) {
        // On signale l'erreur dans la console (F12), puis on continue avec les écouteurs suivants.
        console.error('StudyFlow : erreur dans un écouteur de "' + name + '"', error);
      }
    });
  }

  SF.events = { on: on, off: off, emit: emit };

  // ===================================================================
  // 3) SF.storage : lecture et écriture dans localStorage
  // ===================================================================

  const PREFIX = 'studyflow.v1.';
  // 'sessions' = journal du temps d'étude (un tableau, comme 'activities').
  const COLLECTIONS = ['courses', 'activities', 'goals', 'sessions', 'settings'];
  // dailyGoalMinutes = objectif d'étude par jour, en minutes (entier de 15 à 720).
  const DEFAULT_SETTINGS = { dayStart: '08:00', dayEnd: '21:00', minSessionMinutes: 30, maxSessionMinutes: 90, dailyGoalMinutes: 120 };

  const memory = new Map();             // stockage de secours : clé -> texte
  let useMemory = !checkLocalStorage(); // true si localStorage est bloqué ou refuse d'écrire

  // ----- Accès "bruts" au stockage (ces fonctions ne plantent jamais) -----

  // Teste si localStorage accepte vraiment d'écrire (il peut être bloqué : navigation privée, réglages du navigateur).
  function checkLocalStorage() {
    try {
      const testKey = PREFIX + 'test';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Lit le texte d'une clé. Renvoie null si la clé n'existe pas ou n'est pas lisible.
  function readRaw(key) {
    if (useMemory) {
      return memory.has(key) ? memory.get(key) : null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  // Écrit un texte dans une clé. Renvoie true si ça a marché, false sinon (espace plein, accès bloqué).
  function writeRaw(key, text) {
    if (useMemory) {
      memory.set(key, text);
      return true;
    }
    try {
      window.localStorage.setItem(key, text);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Supprime une clé. Renvoie true si ça a marché.
  function removeRaw(key) {
    if (useMemory) {
      memory.delete(key);
      return true;
    }
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Liste toutes les clés du stockage utilisé.
  function listKeys() {
    if (useMemory) {
      return Array.from(memory.keys());
    }
    const keys = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (typeof key === 'string') {
          keys.push(key);
        }
      }
    } catch (error) {
      // stockage bloqué : on renvoie ce qu'on a trouvé
    }
    return keys;
  }

  // ----- Petits outils -----

  // Dit si une valeur est un objet "normal" (ni null, ni tableau).
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // Dit si une valeur est un entier strictement positif.
  function isPositiveInt(value) {
    return Number.isInteger(value) && value > 0;
  }

  // Dit si une valeur est un entier compris entre min et max (bornes comprises).
  function isIntBetween(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  // Dit si un objet d'erreurs contient au moins une erreur.
  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  // Renvoie une copie des réglages par défaut.
  function defaultSettings() {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  // Garde une copie du texte abîmé dans 'studyflow.v1.corrupt.<collection>' : on ne perd rien en silence.
  function keepCorruptCopy(collection, text) {
    const key = PREFIX + 'corrupt.' + collection;
    if (readRaw(key) !== text) {
      writeRaw(key, text);
    }
  }

  // Vérifie des réglages complets. Renvoie un objet d'erreurs { champ: 'message' } (vide si tout est correct).
  function checkSettings(settings) {
    const errors = {};
    const startIsValid = SF.dates.isValidTime(settings.dayStart);
    const endIsValid = SF.dates.isValidTime(settings.dayEnd);
    if (!startIsValid) {
      errors.dayStart = "L'heure de début n'est pas valide (format HH:MM).";
    }
    if (!endIsValid) {
      errors.dayEnd = "L'heure de fin n'est pas valide (format HH:MM).";
    }
    if (startIsValid && endIsValid && SF.dates.timeToMinutes(settings.dayStart) >= SF.dates.timeToMinutes(settings.dayEnd)) {
      errors.dayEnd = "L'heure de fin doit être après l'heure de début.";
    }
    if (!isPositiveInt(settings.minSessionMinutes)) {
      errors.minSessionMinutes = 'La durée minimale doit être un nombre entier de minutes supérieur à 0.';
    }
    if (!isPositiveInt(settings.maxSessionMinutes)) {
      errors.maxSessionMinutes = 'La durée maximale doit être un nombre entier de minutes supérieur à 0.';
    }
    if (!errors.minSessionMinutes && !errors.maxSessionMinutes && settings.minSessionMinutes > settings.maxSessionMinutes) {
      errors.maxSessionMinutes = 'La durée maximale doit être supérieure ou égale à la durée minimale.';
    }
    if (!isIntBetween(settings.dailyGoalMinutes, 15, 720)) {
      errors.dailyGoalMinutes = "L'objectif doit être compris entre 15 et 720 minutes.";
    }
    return errors;
  }

  // ----- Fonctions publiques de SF.storage -----

  // Dit si localStorage fonctionne (false = les données restent en mémoire et seront perdues au rechargement).
  function isAvailable() {
    return !useMemory;
  }

  // Crée un identifiant unique (texte) : crypto.randomUUID() s'il existe, sinon l'heure + du hasard.
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Lit une collection : un tableau pour 'courses', 'activities', 'goals', 'sessions' et un objet pour 'settings'.
  function load(collection) {
    const fallback = collection === 'settings' ? defaultSettings() : [];
    if (COLLECTIONS.indexOf(collection) === -1) {
      return fallback;
    }
    const text = readRaw(PREFIX + collection);
    if (text === null) {
      return fallback; // rien n'a encore été sauvegardé
    }

    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      keepCorruptCopy(collection, text); // JSON illisible : on garde le texte abîmé
      return fallback;
    }

    if (collection === 'settings') {
      if (!isObject(value)) {
        keepCorruptCopy(collection, text);
        return fallback;
      }
      const settings = Object.assign({}, DEFAULT_SETTINGS, value); // valeurs par défaut + valeurs sauvegardées
      if (hasErrors(checkSettings(settings))) {
        keepCorruptCopy(collection, text);
        return fallback;
      }
      return settings;
    }

    if (!Array.isArray(value)) {
      keepCorruptCopy(collection, text);
      return fallback;
    }
    const items = value.filter(isObject);
    if (items.length !== value.length) {
      keepCorruptCopy(collection, text); // on a enlevé des éléments inutilisables : on garde l'original
    }
    return items;
  }

  // Enregistre une collection (elle remplace l'ancienne). Renvoie true si c'est réussi, false sinon.
  function save(collection, data) {
    const hasRightShape = collection === 'settings' ? isObject(data) : Array.isArray(data);
    if (COLLECTIONS.indexOf(collection) === -1 || !hasRightShape) {
      return false;
    }
    let text;
    try {
      text = JSON.stringify(data);
    } catch (error) {
      return false;
    }
    if (!writeRaw(PREFIX + collection, text)) {
      return false; // espace plein ou stockage bloqué : rien n'est annoncé
    }
    emit('data:changed', { collection: collection }); // un seul événement par sauvegarde réussie
    return true;
  }

  // Renvoie les réglages (valeurs par défaut + valeurs sauvegardées).
  function getSettings() {
    return load('settings');
  }

  // Modifie les réglages après vérification. Renvoie { ok: true, item } ou { ok: false, errors }.
  function updateSettings(patch) {
    const changes = isObject(patch) ? patch : {};
    const settings = getSettings();
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      if (changes[key] !== undefined) {
        settings[key] = changes[key];
      }
    });
    // Un champ de formulaire donne un texte ('45') : on le transforme en nombre.
    ['minSessionMinutes', 'maxSessionMinutes', 'dailyGoalMinutes'].forEach(function (key) {
      if (typeof settings[key] === 'string' && settings[key].trim() !== '') {
        settings[key] = Number(settings[key]);
      }
    });

    const errors = checkSettings(settings);
    if (hasErrors(errors)) {
      return { ok: false, errors: errors };
    }
    if (!save('settings', settings)) {
      return { ok: false, errors: { general: "Impossible d'enregistrer les réglages (espace de stockage plein ou bloqué)." } };
    }
    return { ok: true, item: settings };
  }

  // Renvoie toutes les données sous forme de texte JSON (pour les sauvegarder dans un fichier).
  function exportJSON() {
    return JSON.stringify({
      app: 'StudyFlow',
      version: 1,
      exportedAt: new Date().toISOString(), // date-heure complète : ici toISOString() est voulu
      courses: load('courses'),
      activities: load('activities'),
      goals: load('goals'),
      sessions: load('sessions'),
      settings: load('settings')
    }, null, 2);
  }

  // Vérifie la structure d'une sauvegarde AVANT de rien remplacer. Renvoie un message d'erreur, ou '' si tout va bien.
  function findImportProblem(data) {
    if (!isObject(data) || data.app !== 'StudyFlow') {
      return "Ce fichier n'est pas une sauvegarde StudyFlow.";
    }
    if (data.version !== 1) {
      return "Cette sauvegarde vient d'une autre version de StudyFlow.";
    }
    const listNames = { courses: 'cours', activities: 'activités', goals: 'objectifs' };
    for (const key of Object.keys(listNames)) {
      const list = data[key];
      const everyItemHasId = Array.isArray(list) && list.every(function (item) {
        return isObject(item) && typeof item.id === 'string' && item.id !== '';
      });
      if (!everyItemHasId) {
        return 'Les ' + listNames[key] + ' de ce fichier sont absents ou incorrects.';
      }
    }
    // 'sessions' est facultatif : un ancien export n'en contient pas (importJSON mettra alors un tableau vide).
    if (data.sessions !== undefined) {
      const sessionsAreValid = Array.isArray(data.sessions) && data.sessions.every(function (item) {
        return isObject(item) && typeof item.id === 'string' && item.id !== '';
      });
      if (!sessionsAreValid) {
        return 'Les séances de ce fichier sont incorrectes.';
      }
    }
    if (!isObject(data.settings) || hasErrors(checkSettings(Object.assign({}, DEFAULT_SETTINGS, data.settings)))) {
      return 'Les réglages de ce fichier sont absents ou incorrects.';
    }
    return '';
  }

  // Remplace toutes les données par celles d'une sauvegarde. Renvoie { ok: true, counts } ou { ok: false, error }.
  function importJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: "Ce fichier n'est pas du JSON valide." };
    }
    const problem = findImportProblem(data);
    if (problem !== '') {
      return { ok: false, error: problem };
    }

    // Un ancien export n'a pas de 'sessions' : on utilise alors un tableau vide.
    const sessions = data.sessions === undefined ? [] : data.sessions;

    // Les nouveaux textes à écrire, et les anciens (pour tout remettre comme avant si l'écriture échoue).
    const newTexts = {
      courses: JSON.stringify(data.courses),
      activities: JSON.stringify(data.activities),
      goals: JSON.stringify(data.goals),
      sessions: JSON.stringify(sessions),
      settings: JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, data.settings))
    };
    const oldTexts = {};
    COLLECTIONS.forEach(function (name) {
      oldTexts[name] = readRaw(PREFIX + name);
    });

    const allWritten = COLLECTIONS.every(function (name) {
      return writeRaw(PREFIX + name, newTexts[name]);
    });
    if (!allWritten) {
      COLLECTIONS.forEach(function (name) {
        if (oldTexts[name] === null) {
          removeRaw(PREFIX + name);
        } else {
          writeRaw(PREFIX + name, oldTexts[name]);
        }
      });
      return { ok: false, error: "Impossible d'enregistrer les données (espace de stockage plein ou bloqué). Rien n'a été modifié." };
    }

    COLLECTIONS.forEach(function (name) {
      emit('data:changed', { collection: name });
    });
    return {
      ok: true,
      counts: { courses: data.courses.length, activities: data.activities.length, goals: data.goals.length, sessions: sessions.length }
    };
  }

  // Supprime toutes les données StudyFlow (seulement les clés 'studyflow.v1.', jamais localStorage.clear()).
  function clearAll() {
    let allRemoved = true;
    listKeys().forEach(function (key) {
      if (key.indexOf(PREFIX) === 0 && !removeRaw(key)) {
        allRemoved = false;
      }
    });
    COLLECTIONS.forEach(function (name) {
      emit('data:changed', { collection: name }); // l'interface doit se mettre à jour
    });
    return allRemoved;
  }

  SF.storage = {
    isAvailable: isAvailable,
    newId: newId,
    load: load,
    save: save,
    getSettings: getSettings,
    updateSettings: updateSettings,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll
  };
})();
