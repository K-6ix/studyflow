// js/dates.js : outils pour les dates ('YYYY-MM-DD') et les heures ('HH:MM').
// Tout est calculé en heure LOCALE. On n'utilise jamais new Date('YYYY-MM-DD') ni toISOString()
// pour une date seule, car ils peuvent donner le mauvais jour selon le fuseau horaire.
// Une date ou une heure invalide ne fait jamais planter : les fonctions renvoient
// '' (texte), NaN (nombre) ou une Date invalide (pour fromISO).
(function () {
  'use strict';
  window.SF = window.SF || {};

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  let frenchFormatter = null; // créé au premier appel de formatFR

  // Ajoute un zéro devant un nombre à un seul chiffre (5 donne '05').
  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }

  // Découpe 'YYYY-MM-DD' en [année, mois, jour]. Renvoie null si ce n'est pas une vraie date.
  function splitISO(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return null;
    }
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(5, 7));
    const day = Number(text.slice(8, 10));
    const date = new Date(year, month - 1, day);
    // JavaScript transforme le 30 février en 2 mars : si la date a changé, elle était fausse.
    const isReal = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    return isReal ? [year, month, day] : null;
  }

  // Renvoie l'objet Date donné s'il est valide, sinon la date et l'heure de maintenant.
  function getNow(now) {
    return (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
  }

  // Dit si un texte est une vraie date du calendrier (par exemple '2026-02-30' donne false).
  function isValidISO(text) {
    return splitISO(text) !== null;
  }

  // Dit si un texte est une heure 'HH:MM' valide, de '00:00' à '23:59'.
  function isValidTime(text) {
    return typeof text === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  }

  // Transforme un objet Date en 'YYYY-MM-DD' (heure locale). Renvoie '' si la Date est invalide.
  function toISO(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return '';
    }
    const year = String(date.getFullYear()).padStart(4, '0');
    return year + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  // Transforme 'YYYY-MM-DD' en objet Date à minuit, heure locale (Date invalide si le texte est faux).
  function fromISO(iso) {
    const parts = splitISO(iso);
    if (parts === null) {
      return new Date(NaN);
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  // Renvoie la date d'aujourd'hui (ou celle de l'objet Date donné) au format 'YYYY-MM-DD'.
  function todayISO(now) {
    return toISO(getNow(now));
  }

  // Ajoute n jours (négatif pour reculer) à une date. Renvoie '' si la date est invalide.
  function addDays(iso, n) {
    const date = fromISO(iso);
    date.setDate(date.getDate() + Number(n));
    return toISO(date);
  }

  // Compte les jours de isoA à isoB (positif si isoB est après isoA). Renvoie NaN si une date est invalide.
  function diffDays(isoA, isoB) {
    const a = splitISO(isoA);
    const b = splitISO(isoB);
    if (a === null || b === null) {
      return NaN;
    }
    // Date.UTC ignore l'heure d'été : chaque jour dure toujours exactement 24 h.
    return (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / MS_PER_DAY;
  }

  // Renvoie le jour de la semaine : 1 = lundi ... 7 = dimanche (NaN si la date est invalide).
  function isoWeekday(iso) {
    const day = fromISO(iso).getDay(); // JavaScript : 0 = dimanche ... 6 = samedi
    return day === 0 ? 7 : day;
  }

  // Renvoie le lundi de la semaine qui contient la date donnée.
  function startOfWeek(iso) {
    return addDays(iso, 1 - isoWeekday(iso));
  }

  // Renvoie le premier jour du mois de la date donnée.
  function startOfMonth(iso) {
    const date = fromISO(iso);
    return toISO(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  // Renvoie le dernier jour du mois (28, 29, 30 ou 31) : c'est le "jour 0" du mois suivant.
  function endOfMonth(iso) {
    const date = fromISO(iso);
    return toISO(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  }

  // Transforme 'HH:MM' en minutes depuis minuit ('08:30' donne 510). Renvoie NaN si l'heure est invalide.
  function timeToMinutes(hhmm) {
    if (!isValidTime(hhmm)) {
      return NaN;
    }
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  }

  // Transforme des minutes depuis minuit en 'HH:MM' (510 donne '08:30'), bloqué entre '00:00' et '23:59'.
  function minutesToTime(n) {
    const minutes = Math.round(Number(n));
    if (isNaN(minutes)) {
      return '';
    }
    const total = Math.min(Math.max(minutes, 0), 1439);
    return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
  }

  // Renvoie l'heure actuelle (ou celle de l'objet Date donné) au format 'HH:MM'.
  function nowHHMM(now) {
    const date = getNow(now);
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // Écrit une date en français, par exemple 'samedi 14 novembre 2026'. Renvoie '' si la date est invalide.
  function formatFR(iso) {
    const date = fromISO(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    try {
      if (frenchFormatter === null) {
        frenchFormatter = new Intl.DateTimeFormat('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }
      return frenchFormatter.format(date);
    } catch (error) {
      return iso; // Intl indisponible : on affiche la date telle quelle
    }
  }

  SF.dates = {
    todayISO: todayISO,
    toISO: toISO,
    fromISO: fromISO,
    addDays: addDays,
    diffDays: diffDays,
    isoWeekday: isoWeekday,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    endOfMonth: endOfMonth,
    isValidISO: isValidISO,
    isValidTime: isValidTime,
    timeToMinutes: timeToMinutes,
    minutesToTime: minutesToTime,
    nowHHMM: nowHHMM,
    formatFR: formatFR
  };
})();
