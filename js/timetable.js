// js/timetable.js — Emploi du temps : les cours qui se répètent chaque semaine.
//
// Deux mots à connaître :
//  - un « cours » = la règle qui se répète (ex. Maths, chaque lundi, de 08:00 à 10:00) ;
//  - une « occurrence » = ce cours posé sur une date précise (ex. le lundi 2026-11-09).
//
// Rappel : une date est un texte 'YYYY-MM-DD'. On la compare comme du texte
// ('2026-11-09' vient avant '2026-11-16') ; on ne la transforme jamais en objet Date
// (risque de décalage d’un jour à cause du fuseau horaire).
(function () {
  'use strict';
  window.SF = window.SF || {};

  var COLLECTION = 'courses'; // nom de la collection dans SF.storage
  var MAX_TEXT = 60;          // longueur maximale de la matière, de la salle et de l’enseignant
  var MAX_DAYS = 400;         // nombre maximal de jours pour getOccurrences (bornes incluses)
  var SAVE_ERROR = 'Impossible d’enregistrer les cours (stockage du navigateur indisponible ou plein).';

  /* ---------- Fonctions privées (utilisées seulement dans ce fichier) ---------- */

  // Lit les cours dans le stockage : toujours un tableau, jamais null.
  function loadCourses() {
    try {
      var list = SF.storage.load(COLLECTION);
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  // Enregistre les cours : renvoie true si c’est réussi, false sinon.
  function saveCourses(list) {
    try {
      var result = SF.storage.save(COLLECTION, list);
      // Le contrat ne dit pas ce que save() renvoie : c’est un échec si false ou { ok: false }.
      if (result === false) return false;
      if (result && result.ok === false) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  // Enlève les espaces autour d’une valeur ('' si elle est vide ou absente).
  function toText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  // Dit si value est une date 'YYYY-MM-DD' valide.
  function isDate(value) {
    return typeof value === 'string' && SF.dates.isValidISO(value);
  }

  // Dit si value est une heure 'HH:MM' valide.
  function isTime(value) {
    return typeof value === 'string' && SF.dates.isValidTime(value);
  }

  // Dit si l’objet d’erreurs contient au moins une erreur.
  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  // Donne la position d’un cours dans la liste à partir de son id (-1 s’il n’y est pas).
  function findIndex(list, id) {
    return list.findIndex(function (course) {
      return course && course.id === id;
    });
  }

  // Fabrique un cours « propre » : textes sans espaces autour, champs vides remis à '' ou null.
  function buildCourse(data, id) {
    return {
      id: id,
      subject: toText(data.subject),
      weekday: data.weekday,
      startTime: toText(data.startTime),
      endTime: toText(data.endTime),
      room: toText(data.room),
      teacher: toText(data.teacher),
      validFrom: toText(data.validFrom) || null,
      validTo: toText(data.validTo) || null
    };
  }

  // Réponse standard quand l’enregistrement échoue.
  function saveFailed() {
    return { ok: false, errors: { general: SAVE_ERROR } };
  }

  /* ---------- Vérifications (une fonction par groupe de champs) ---------- */

  // Vérifie la matière : obligatoire, 60 caractères maximum.
  function checkSubject(course, errors) {
    if (course.subject === '') {
      errors.subject = 'La matière est obligatoire.';
    } else if (course.subject.length > MAX_TEXT) {
      errors.subject = 'La matière ne doit pas dépasser ' + MAX_TEXT + ' caractères.';
    }
  }

  // Vérifie le jour de la semaine : un nombre entier de 1 (lundi) à 7 (dimanche).
  function checkWeekday(course, errors) {
    if (!Number.isInteger(course.weekday) || course.weekday < 1 || course.weekday > 7) {
      errors.weekday = 'Le jour de la semaine doit être un nombre entier de 1 (lundi) à 7 (dimanche).';
    }
  }

  // Vérifie l’heure de début et l’heure de fin (la fin doit être STRICTEMENT après le début).
  function checkTimes(course, errors) {
    if (course.startTime === '') {
      errors.startTime = 'L’heure de début est obligatoire.';
    } else if (!isTime(course.startTime)) {
      errors.startTime = 'L’heure de début n’est pas valide (format HH:MM, par exemple 08:30).';
    }

    if (course.endTime === '') {
      errors.endTime = 'L’heure de fin est obligatoire.';
    } else if (!isTime(course.endTime)) {
      errors.endTime = 'L’heure de fin n’est pas valide (format HH:MM, par exemple 10:00).';
    } else if (!errors.startTime) {
      // Les deux heures sont valides : on les compare en minutes.
      var start = SF.dates.timeToMinutes(course.startTime);
      var end = SF.dates.timeToMinutes(course.endTime);
      if (end <= start) {
        errors.endTime = 'L’heure de fin doit être après l’heure de début.';
      }
    }
  }

  // Vérifie la salle et l’enseignant : facultatifs, 60 caractères maximum.
  function checkRoomAndTeacher(course, errors) {
    if (course.room.length > MAX_TEXT) {
      errors.room = 'La salle ne doit pas dépasser ' + MAX_TEXT + ' caractères.';
    }
    if (course.teacher.length > MAX_TEXT) {
      errors.teacher = 'Le nom de l’enseignant ne doit pas dépasser ' + MAX_TEXT + ' caractères.';
    }
  }

  // Vérifie les dates de validité : facultatives, et la fin ne peut pas être avant le début.
  function checkValidityDates(course, errors) {
    if (course.validFrom !== null && !isDate(course.validFrom)) {
      errors.validFrom = 'La date de début de validité n’est pas valide (format AAAA-MM-JJ, par exemple 2026-09-14).';
    }
    if (course.validTo !== null && !isDate(course.validTo)) {
      errors.validTo = 'La date de fin de validité n’est pas valide (format AAAA-MM-JJ, par exemple 2027-01-31).';
    }

    var bothDatesAreValid = course.validFrom !== null && course.validTo !== null &&
      !errors.validFrom && !errors.validTo;
    if (bothDatesAreValid && course.validFrom > course.validTo) {
      errors.validTo = 'La date de fin de validité ne peut pas être avant la date de début.';
    }
  }

  /* ---------- Fonctions de calcul des occurrences (privées) ---------- */

  // Dit si ce cours a lieu à cette date : bon jour de la semaine ET date dans la période de validité.
  function occursOn(course, date, weekday) {
    if (!course || course.weekday !== weekday) return false;
    if (course.validFrom && date < course.validFrom) return false; // le cours n’a pas encore commencé
    if (course.validTo && date > course.validTo) return false;     // le cours est déjà terminé
    return true;
  }

  // Fabrique l’occurrence d’un cours pour une date.
  function makeOccurrence(course, date, weekday) {
    return {
      courseId: course.id,
      date: date,
      weekday: weekday,
      subject: course.subject,
      startTime: course.startTime,
      endTime: course.endTime,
      room: course.room || '',
      teacher: course.teacher || ''
    };
  }

  // Compare deux occurrences pour le tri : d’abord par date, puis par heure de début.
  function compareOccurrences(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return 0;
  }

  /* ---------- Fonctions publiques (SF.timetable) ---------- */

  // Renvoie tous les cours (un tableau, vide s’il n’y en a aucun).
  function getAll() {
    return loadCourses();
  }

  // Renvoie le cours qui a cet id, ou null s’il n’existe pas.
  function getById(id) {
    var courses = loadCourses();
    var index = findIndex(courses, id);
    return index === -1 ? null : courses[index];
  }

  // Vérifie les données d’un cours : renvoie { champ: message } ou {} si tout est correct.
  function validate(data) {
    var source = (data && typeof data === 'object') ? data : {};
    var course = buildCourse(source, null);
    var errors = {};
    checkSubject(course, errors);
    checkWeekday(course, errors);
    checkTimes(course, errors);
    checkRoomAndTeacher(course, errors);
    checkValidityDates(course, errors);
    return errors;
  }

  // Ajoute un cours : renvoie { ok: true, item } ou { ok: false, errors }.
  function add(data) {
    var errors = validate(data);
    if (hasErrors(errors)) return { ok: false, errors: errors };

    var course = buildCourse(data, SF.storage.newId());
    var courses = loadCourses();
    courses.push(course);
    if (!saveCourses(courses)) return saveFailed();
    return { ok: true, item: course };
  }

  // Ajoute plusieurs cours d’un coup (importation du PDF) : tout ou rien, avec une seule sauvegarde.
  // Si une ligne est invalide : { ok: false, errors: [{ index, errors }] } (index = position, en partant de 0).
  // Un problème qui ne vient pas d’une ligne précise est signalé avec index = -1.
  function addMany(rows) {
    if (!Array.isArray(rows)) {
      return { ok: false, errors: [{ index: -1, errors: { general: 'La liste de cours est invalide.' } }] };
    }

    // 1) On vérifie TOUTES les lignes avant de toucher au stockage.
    var problems = [];
    rows.forEach(function (row, index) {
      var errors = validate(row);
      if (hasErrors(errors)) problems.push({ index: index, errors: errors });
    });
    if (problems.length > 0) return { ok: false, errors: problems };

    // 2) Tout est valide : on ajoute les cours et on sauvegarde UNE seule fois.
    if (rows.length === 0) return { ok: true, count: 0 };
    var courses = loadCourses();
    rows.forEach(function (row) {
      courses.push(buildCourse(row, SF.storage.newId()));
    });
    if (!saveCourses(courses)) {
      return { ok: false, errors: [{ index: -1, errors: { general: SAVE_ERROR } }] };
    }
    return { ok: true, count: rows.length };
  }

  // Modifie un cours : fusionne les changements, revalide, puis enregistre (l’id ne change jamais).
  function update(id, patch) {
    var courses = loadCourses();
    var index = findIndex(courses, id);
    if (index === -1) {
      return { ok: false, errors: { id: 'Ce cours est introuvable.' } };
    }

    var merged = Object.assign({}, courses[index], patch); // ancien cours + changements
    var errors = validate(merged);
    if (hasErrors(errors)) return { ok: false, errors: errors };

    var course = buildCourse(merged, courses[index].id);
    courses[index] = course;
    if (!saveCourses(courses)) return saveFailed();
    return { ok: true, item: course };
  }

  // Supprime un cours : renvoie true si c’est fait, false sinon (id inconnu ou enregistrement raté).
  function remove(id) {
    var courses = loadCourses();
    var index = findIndex(courses, id);
    if (index === -1) return false;
    courses.splice(index, 1);
    return saveCourses(courses);
  }

  // Renvoie les occurrences des cours entre deux dates (bornes incluses), triées par date puis par heure.
  // Plage invalide, à l’envers ou de plus de 400 jours : tableau vide.
  function getOccurrences(startISO, endISO) {
    try {
      if (!isDate(startISO) || !isDate(endISO)) return [];
      if (startISO > endISO) return [];

      // Nombre de jours de la plage, bornes incluses (garde-fou : 400 maximum).
      var daysCount = Math.round(Math.abs(SF.dates.diffDays(startISO, endISO))) + 1;
      if (daysCount > MAX_DAYS) return [];

      var courses = loadCourses();
      var result = [];
      for (var i = 0; i < daysCount; i++) {
        var date = SF.dates.addDays(startISO, i);
        var weekday = SF.dates.isoWeekday(date);
        for (var j = 0; j < courses.length; j++) {
          if (occursOn(courses[j], date, weekday)) {
            result.push(makeOccurrence(courses[j], date, weekday));
          }
        }
      }
      result.sort(compareOccurrences);
      return result;
    } catch (error) {
      return [];
    }
  }

  // Renvoie les occurrences des cours pour une seule journée.
  function getForDate(iso) {
    return getOccurrences(iso, iso);
  }

  SF.timetable = {
    getAll: getAll,
    getById: getById,
    validate: validate,
    add: add,
    addMany: addMany,
    update: update,
    remove: remove,
    getOccurrences: getOccurrences,
    getForDate: getForDate
  };
})();
