// js/reminders.js : compte à rebours des examens et bandeau de rappel (SF.reminders).
// Il lit les activités (SF.activities) et remplit deux blocs de l'accueil :
//   1) le compte à rebours : « Examen partiel Maths · dans 4 jours » ;
//   2) le bandeau de rappel : retards, tâches d'aujourd'hui et de demain, examens proches.
// Ce fichier crée un seul module : SF.reminders.
// Il faut charger dates.js, storage.js, activities.js et app.js AVANT ce fichier.
// Les textes saisis par l'utilisateur (titres, matières) sont toujours écrits avec textContent.
(function () {
  'use strict';
  window.SF = window.SF || {};

  // ===================================================================
  // 1) Constantes
  // ===================================================================

  const EXAM_TYPE = 'exam';        // seul ce type d'activité apparaît dans le compte à rebours
  const COUNTDOWN_LIMIT = 3;       // nombre d'examens montrés dans le compte à rebours
  const EXAM_WARNING_DAYS = 7;     // un examen entre dans le bandeau s'il a lieu dans 7 jours ou moins
  const MAX_TITLES_PER_LINE = 2;   // titres cités par ligne du bandeau (les autres sont comptés)
  const URGENT_DAYS = 1;           // aujourd'hui ou demain : rouge
  const SOON_DAYS = 3;             // dans 2 ou 3 jours : orange (plus loin : bleu)
  const CLOSED_KEY = 'studyflow.v1.reminderClosed'; // le jour où le bandeau a été fermé

  const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // Icône de cloche (du SVG écrit ici, jamais du texte saisi par l'utilisateur).
  const BELL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  // ===================================================================
  // 2) Petits outils
  // ===================================================================

  // Renvoie la Date donnée si elle est valide, sinon maintenant ("now" sert surtout aux tests).
  function realDate(now) {
    return (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
  }

  // Un texte sans espaces autour ('' si la valeur n'est pas un texte).
  function toText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // Met la première lettre en majuscule.
  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Supprime tous les enfants d'un élément.
  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  // Crée un élément. Dans attrs : 'class', 'text' (texte sûr) et 'html' (réservé aux icônes écrites dans ce fichier).
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        if (name === 'class') {
          node.className = attrs[name];
        } else if (name === 'text') {
          node.textContent = attrs[name];
        } else if (name === 'html') {
          node.innerHTML = attrs[name];
        } else {
          node.setAttribute(name, attrs[name]);
        }
      });
    }
    if (children) {
      children.forEach(function (child) {
        node.appendChild(child);
      });
    }
    return node;
  }

  // Dit en français où en est une date : 0 donne « aujourd'hui », 1 « demain », 4 « dans 4 jours », -1 « hier ».
  function describeDays(daysLeft) {
    if (!Number.isInteger(daysLeft)) {
      return '';
    }
    if (daysLeft === 0) {
      return "aujourd'hui";
    }
    if (daysLeft === 1) {
      return 'demain';
    }
    if (daysLeft === -1) {
      return 'hier';
    }
    if (daysLeft > 1) {
      return 'dans ' + daysLeft + ' jours';
    }
    return 'il y a ' + Math.abs(daysLeft) + ' jours';
  }

  // Écrit une date courte en français : '2026-11-27' donne 'vendredi 27 novembre'.
  function shortDate(iso) {
    if (!SF.dates.isValidISO(iso)) {
      return '';
    }
    const day = Number(iso.slice(8, 10));
    const month = Number(iso.slice(5, 7));
    const weekday = SF.dates.isoWeekday(iso); // 1 = lundi ... 7 = dimanche
    return DAY_NAMES[weekday - 1] + ' ' + (day === 1 ? '1er' : day) + ' ' + MONTH_NAMES[month - 1];
  }

  // Compare deux éléments : par date, puis sans heure d'abord, puis par heure croissante.
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

  // Résume une activité en un petit objet simple, avec le nombre de jours qui restent.
  function makeItem(activity, today) {
    const daysLeft = SF.dates.diffDays(today, activity.date);
    return {
      id: activity.id,
      title: toText(activity.title),
      subject: toText(activity.subject),
      type: activity.type,
      date: activity.date,
      time: activity.time || null,
      daysLeft: daysLeft,
      text: describeDays(daysLeft)
    };
  }

  // Donne le niveau d'urgence d'un examen : 'urgent' (aujourd'hui, demain), 'soon' (2 à 3 jours) ou 'later'.
  function getUrgency(daysLeft) {
    if (daysLeft <= URGENT_DAYS) {
      return 'urgent';
    }
    if (daysLeft <= SOON_DAYS) {
      return 'soon';
    }
    return 'later';
  }

  // ===================================================================
  // 3) Lire les données
  // ===================================================================

  // Les activités non terminées qui ont une vraie date.
  function getPendingActivities() {
    return SF.activities.getAll().filter(function (activity) {
      return activity.status !== 'done' && SF.dates.isValidISO(activity.date);
    });
  }

  // Les prochains examens (pas terminés, pas passés), les plus proches d'abord : [{ id, title, subject, date, time, daysLeft, text }].
  // "limit" = nombre maximum d'examens (3 par défaut), "now" (un objet Date) est facultatif : il sert aux tests.
  function getCountdowns(limit, now) {
    const current = realDate(now);
    const today = SF.dates.todayISO(current);
    const max = Number.isInteger(limit) && limit >= 0 ? limit : COUNTDOWN_LIMIT;
    return getPendingActivities()
      .filter(function (activity) {
        return activity.type === EXAM_TYPE && !SF.activities.isOverdue(activity, current);
      })
      .sort(compareByDateAndTime)
      .slice(0, max)
      .map(function (activity) {
        return makeItem(activity, today);
      });
  }

  // Les choses à rappeler, rangées en 4 listes d'éléments (même forme que getCountdowns) :
  // overdue = en retard, today = aujourd'hui, tomorrow = demain, exams = examens dans 2 à 7 jours.
  // Un examen d'aujourd'hui ou de demain est dans today ou tomorrow, jamais dans exams (pas de doublon).
  function getReminders(now) {
    const current = realDate(now);
    const today = SF.dates.todayISO(current);
    const tomorrow = SF.dates.addDays(today, 1);
    const result = { overdue: [], today: [], tomorrow: [], exams: [] };

    getPendingActivities().sort(compareByDateAndTime).forEach(function (activity) {
      const item = makeItem(activity, today);
      if (SF.activities.isOverdue(activity, current)) {
        result.overdue.push(item);
      } else if (activity.date === today) {
        result.today.push(item);
      } else if (activity.date === tomorrow) {
        result.tomorrow.push(item);
      } else if (activity.type === EXAM_TYPE && item.daysLeft <= EXAM_WARNING_DAYS) {
        result.exams.push(item);
      }
    });
    return result;
  }

  // Écrit les éléments d'une liste : « A, B et 2 autres » (2 titres cités au maximum).
  function joinItems(items, describeItem) {
    const shown = items.slice(0, MAX_TITLES_PER_LINE).map(describeItem);
    const rest = items.length - shown.length;
    let text = shown.join(', ');
    if (rest > 0) {
      text += ' et ' + rest + (rest === 1 ? ' autre' : ' autres');
    }
    return text;
  }

  function describeTitle(item) {
    return item.title;
  }

  function describeTitleAndTime(item) {
    return item.time ? item.title + ' (' + item.time + ')' : item.title;
  }

  function describeTitleAndDays(item) {
    return item.title + ' ' + item.text;
  }

  // Les lignes du bandeau : [{ kind, label, text }]. Renvoie [] s'il n'y a rien à rappeler.
  function getBannerLines(now) {
    const reminders = getReminders(now);
    const lines = [];
    if (reminders.overdue.length > 0) {
      lines.push({ kind: 'overdue', label: 'En retard', text: joinItems(reminders.overdue, describeTitle) });
    }
    if (reminders.today.length > 0) {
      lines.push({ kind: 'today', label: "Aujourd'hui", text: joinItems(reminders.today, describeTitleAndTime) });
    }
    if (reminders.tomorrow.length > 0) {
      lines.push({ kind: 'tomorrow', label: 'Demain', text: joinItems(reminders.tomorrow, describeTitleAndTime) });
    }
    if (reminders.exams.length > 0) {
      lines.push({ kind: 'exam', label: '', text: joinItems(reminders.exams, describeTitleAndDays) });
    }
    return lines;
  }

  // ===================================================================
  // 4) Fermer le bandeau pour la journée
  // ===================================================================

  // Lit le jour où le bandeau a été fermé ('' si jamais ou si le stockage est bloqué).
  function readClosedDay() {
    try {
      return window.localStorage.getItem(CLOSED_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  // Dit si le bandeau a été fermé aujourd'hui (il revient demain).
  function isBannerClosed(now) {
    return readClosedDay() === SF.dates.todayISO(realDate(now));
  }

  // Ferme le bandeau jusqu'à demain.
  function closeBanner(now) {
    try {
      window.localStorage.setItem(CLOSED_KEY, SF.dates.todayISO(realDate(now)));
    } catch (error) {
      // stockage bloqué : le bandeau reviendra au prochain affichage, ce n'est pas grave
    }
  }

  // Remet le bandeau (utile pour les tests).
  function reopenBanner() {
    try {
      window.localStorage.removeItem(CLOSED_KEY);
    } catch (error) {
      // rien à faire
    }
  }

  // ===================================================================
  // 5) Dessiner les blocs de l'accueil
  // ===================================================================

  // Remplit le conteneur donné avec le bandeau de rappel (ou le vide s'il n'y a rien à dire).
  function renderBanner(container, now) {
    if (!container) {
      return;
    }
    clear(container);
    if (isBannerClosed(now)) {
      return;
    }
    const lines = getBannerLines(now);
    if (lines.length === 0) {
      return;
    }

    const banner = el('section', { class: 'remind-banner', 'aria-label': 'Rappels' });
    banner.appendChild(el('div', { class: 'remind-banner-icon', 'aria-hidden': 'true', html: BELL_ICON }));

    const body = el('div', { class: 'remind-banner-body' });
    body.appendChild(el('h2', { class: 'remind-banner-title', text: 'À ne pas oublier' }));
    const list = el('ul', { class: 'remind-lines' });
    lines.forEach(function (line) {
      const item = el('li', { class: 'remind-line remind-line-' + line.kind });
      if (line.label !== '') {
        item.appendChild(el('span', { class: 'remind-line-label', text: line.label }));
      }
      item.appendChild(el('span', { class: 'remind-line-text', text: line.text }));
      list.appendChild(item);
    });
    body.appendChild(list);
    body.appendChild(el('a', { class: 'remind-link', href: '#/tasks', text: 'Voir mes tâches' }));
    banner.appendChild(body);

    const closeButton = el('button', {
      class: 'remind-close',
      type: 'button',
      'aria-label': "Fermer les rappels jusqu'à demain",
      title: "Fermer jusqu'à demain",
      text: '×'
    });
    closeButton.addEventListener('click', function () {
      closeBanner(now);
      clear(container);
    });
    banner.appendChild(closeButton);

    container.appendChild(banner);
  }

  // Ouvre le formulaire « Nouvelle activité » avec le type « examen » déjà choisi.
  function openExamForm() {
    if (SF.forms && typeof SF.forms.openActivity === 'function') {
      SF.forms.openActivity({ defaults: { type: EXAM_TYPE } });
    }
  }

  // Écrit « Maths · vendredi 27 novembre à 09:00 » (matière, date, heure si elle existe).
  function describeMeta(item) {
    const when = shortDate(item.date) + (item.time ? ' à ' + item.time : '');
    return item.subject !== '' ? item.subject + ' · ' + when : when;
  }

  // Une tuile du compte à rebours : la pastille « dans 4 jours », le titre, la matière et la date.
  function buildTile(item) {
    const tile = el('li', { class: 'remind-tile remind-' + getUrgency(item.daysLeft) });
    tile.appendChild(el('span', { class: 'remind-pill', text: capitalize(item.text) }));
    tile.appendChild(el('div', { class: 'remind-tile-title', text: item.title }));

    const meta = el('div', { class: 'remind-tile-meta' });
    const dot = el('span', { class: 'dot', 'aria-hidden': 'true' });
    dot.style.background = item.subject !== '' ? SF.app.subjectColor(item.subject) : 'rgba(255, 255, 255, .35)';
    meta.appendChild(dot);
    meta.appendChild(el('span', { text: describeMeta(item) }));
    tile.appendChild(meta);
    return tile;
  }

  // Remplit la carte « Compte à rebours » avec les prochains examens.
  function renderCountdown(container, now) {
    if (!container) {
      return;
    }
    clear(container);
    container.appendChild(el('h2', { class: 'card-title', text: 'Compte à rebours' }));

    const items = getCountdowns(COUNTDOWN_LIMIT, now);
    if (items.length === 0) {
      const empty = el('div', { class: 'remind-empty' });
      empty.appendChild(el('p', { class: 'muted-text', text: 'Aucun examen à venir.' }));
      const addButton = el('button', { class: 'btn', type: 'button', text: 'Ajouter un examen' });
      addButton.addEventListener('click', openExamForm);
      empty.appendChild(addButton);
      container.appendChild(empty);
      return;
    }

    const tiles = el('ul', { class: 'remind-tiles' });
    items.forEach(function (item) {
      tiles.appendChild(buildTile(item));
    });
    container.appendChild(tiles);
  }

  SF.reminders = {
    describeDays: describeDays,
    getCountdowns: getCountdowns,
    getReminders: getReminders,
    getBannerLines: getBannerLines,
    isBannerClosed: isBannerClosed,
    closeBanner: closeBanner,
    reopenBanner: reopenBanner,
    renderBanner: renderBanner,
    renderCountdown: renderCountdown
  };
})();
