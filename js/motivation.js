// js/motivation.js : badges de série et bilan de la semaine (SF.motivation).
// Il lit le journal d'étude (SF.sessions) et remplit deux blocs de l'accueil :
//   1) les badges de série : 3, 7 et 30 jours d'étude de suite ;
//   2) le bilan de la semaine : le temps par matière, comparé à la semaine d'avant.
// Ce fichier crée un seul module : SF.motivation.
// Il faut charger dates.js, storage.js, sessions.js et app.js AVANT ce fichier.
// Les textes saisis par l'utilisateur (matières) sont toujours écrits avec textContent.
(function () {
  'use strict';
  window.SF = window.SF || {};

  // ===================================================================
  // 1) Constantes
  // ===================================================================

  const BADGE_DAYS = [3, 7, 30];       // les séries qui donnent un badge
  const STREAK_MINUTES = 10;           // comme dans sessions.js : un jour compte à partir de 10 minutes d'étude
  const SEEN_KEY = 'studyflow.v1.badgesSeen'; // les badges déjà fêtés (une liste de nombres de jours)
  const MAX_SUBJECT_ROWS = 5;          // matières montrées dans le bilan (les autres sont regroupées)
  const SUNDAY = 7;                    // SF.dates.isoWeekday : 7 = dimanche

  // Icône de flamme (du SVG écrit ici, jamais du texte saisi par l'utilisateur).
  const FLAME_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2c1.5 3 3 4.5 3 7a3 3 0 0 1-6 0c0-1 .5-2 1-2.5C9 8 8 9 8 11a4 4 0 0 0 8 0c0-3-2-5-4-9z"/></svg>';

  // ===================================================================
  // 2) Petits outils
  // ===================================================================

  // Renvoie la Date donnée si elle est valide, sinon maintenant ("now" sert surtout aux tests).
  function realDate(now) {
    return (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
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

  // Clé de regroupement d'une matière : sans majuscules ni accents (comme dans sessions.js).
  function normalizeSubject(subject) {
    return String(subject || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Écrit un nombre de jours : « 1 jour », « 12 jours ».
  function countDays(n) {
    return n + (n > 1 ? ' jours' : ' jour');
  }

  // Écrit une différence de minutes avec son signe : « +1 h 15 », « −40 min » ou « = ».
  function formatDelta(diffMinutes) {
    if (diffMinutes > 0) {
      return '+' + SF.app.formatMinutes(diffMinutes);
    }
    if (diffMinutes < 0) {
      return '−' + SF.app.formatMinutes(-diffMinutes);
    }
    return '=';
  }

  // ===================================================================
  // 3) Badges de série
  // ===================================================================

  // La plus longue série de toute l'histoire : le plus grand nombre de jours de suite avec 10 minutes d'étude ou plus.
  function getBestStreak() {
    const minutesByDay = {};
    SF.sessions.getAll().forEach(function (session) {
      if (session && typeof session.date === 'string' && typeof session.minutes === 'number') {
        minutesByDay[session.date] = (minutesByDay[session.date] || 0) + session.minutes;
      }
    });
    // Les jours qui comptent, du plus ancien au plus récent (les dates 'AAAA-MM-JJ' se trient comme du texte).
    const days = Object.keys(minutesByDay).filter(function (day) {
      return minutesByDay[day] >= STREAK_MINUTES;
    }).sort();

    let best = 0;
    let run = 0;
    let previous = '';
    days.forEach(function (day) {
      if (previous !== '' && SF.dates.diffDays(previous, day) === 1) {
        run += 1; // le jour suivant : la série continue
      } else {
        run = 1;  // un jour d'écart : nouvelle série
      }
      best = Math.max(best, run);
      previous = day;
    });
    return best;
  }

  // Les badges : [{ days, label, unlocked, remaining }].
  // unlocked = la meilleure série a déjà atteint ce nombre de jours (un badge gagné reste gagné).
  // remaining = jours qu'il manque à la série ACTUELLE pour l'obtenir (0 si déjà obtenu).
  function getBadges(now) {
    const best = getBestStreak();
    const current = SF.sessions.getStats(realDate(now)).streakDays;
    return BADGE_DAYS.map(function (days) {
      const unlocked = best >= days;
      return {
        days: days,
        label: days + ' jours',
        unlocked: unlocked,
        remaining: unlocked ? 0 : days - current
      };
    });
  }

  // Lit la liste des badges déjà fêtés. Renvoie null si elle n'a jamais été enregistrée.
  function readSeen() {
    try {
      const text = window.localStorage.getItem(SEEN_KEY);
      if (text === null) {
        return null;
      }
      const list = JSON.parse(text);
      return Array.isArray(list) ? list : null;
    } catch (error) {
      return null;
    }
  }

  // Enregistre la liste des badges déjà fêtés.
  function writeSeen(list) {
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(list));
    } catch (error) {
      // stockage bloqué : on ne pourra pas se souvenir des badges fêtés, ce n'est pas grave
    }
  }

  // Cherche les badges gagnés depuis la dernière fois et affiche un message pour le plus grand.
  // Renvoie la liste des nouveaux badges (en nombre de jours), par exemple [3] ou [] s'il n'y en a pas.
  // La toute première fois, on note seulement les badges déjà gagnés, sans les fêter.
  // Si "silent" vaut true, les nouveaux badges sont notés mais aucun message n'est affiché.
  function checkNewBadges(now, silent) {
    const unlockedDays = getBadges(now).filter(function (badge) {
      return badge.unlocked;
    }).map(function (badge) {
      return badge.days;
    });

    const seen = readSeen();
    if (seen === null || unlockedDays.length === 0) {
      writeSeen(unlockedDays); // première fois, ou plus aucune série : on repart de l'état actuel
      return [];
    }

    const fresh = unlockedDays.filter(function (days) {
      return seen.indexOf(days) === -1;
    });
    if (fresh.length === 0) {
      return [];
    }
    writeSeen(seen.concat(fresh));
    if (!silent && SF.app && typeof SF.app.toast === 'function') {
      SF.app.toast('Nouveau badge : ' + Math.max.apply(null, fresh) + ' jours de suite !', 'success');
    }
    return fresh;
  }

  // ===================================================================
  // 4) Bilan de la semaine
  // ===================================================================

  // Dit si on est dimanche : le jour du bilan.
  function isRecapDay(now) {
    return SF.dates.isoWeekday(SF.dates.todayISO(realDate(now))) === SUNDAY;
  }

  // Réunit les matières des deux semaines : [{ subject, thisMinutes, lastMinutes, diffMinutes }], les plus étudiées d'abord.
  function mergeSubjects(thisList, lastList) {
    const rows = new Map(); // clé de regroupement -> ligne
    function getRow(subject) {
      const key = normalizeSubject(subject);
      if (!rows.has(key)) {
        rows.set(key, { subject: subject, thisMinutes: 0, lastMinutes: 0, diffMinutes: 0 });
      }
      return rows.get(key);
    }
    thisList.forEach(function (item) {
      getRow(item.subject).thisMinutes += item.minutes;
    });
    lastList.forEach(function (item) {
      getRow(item.subject).lastMinutes += item.minutes;
    });

    const result = Array.from(rows.values());
    result.forEach(function (row) {
      row.diffMinutes = row.thisMinutes - row.lastMinutes;
    });
    result.sort(function (a, b) {
      if (b.thisMinutes !== a.thisMinutes) {
        return b.thisMinutes - a.thisMinutes;
      }
      return b.lastMinutes - a.lastMinutes;
    });
    return result;
  }

  // Compare la semaine en cours (du lundi à aujourd'hui) aux MÊMES jours de la semaine d'avant.
  // Le dimanche, c'est donc la semaine entière contre la semaine entière.
  function getWeeklyRecap(now) {
    const today = SF.dates.todayISO(realDate(now));
    const monday = SF.dates.startOfWeek(today);
    const elapsed = SF.dates.diffDays(monday, today);       // 0 le lundi ... 6 le dimanche
    const lastMonday = SF.dates.addDays(monday, -7);
    const lastEnd = SF.dates.addDays(lastMonday, elapsed);  // mêmes jours, une semaine plus tôt

    const subjects = mergeSubjects(
      SF.sessions.getSubjectTotals(monday, today),
      SF.sessions.getSubjectTotals(lastMonday, lastEnd)
    );
    let thisMinutes = 0;
    let lastMinutes = 0;
    subjects.forEach(function (row) {
      thisMinutes += row.thisMinutes;
      lastMinutes += row.lastMinutes;
    });

    return {
      isSunday: isRecapDay(now),
      from: monday,
      to: today,
      lastFrom: lastMonday,
      lastTo: lastEnd,
      thisMinutes: thisMinutes,
      lastMinutes: lastMinutes,
      diffMinutes: thisMinutes - lastMinutes,
      subjects: subjects
    };
  }

  // Une phrase d'encouragement qui dépend du bilan.
  function getRecapMessage(recap) {
    if (recap.thisMinutes === 0 && recap.lastMinutes === 0) {
      return "Pas encore de séance ces deux dernières semaines. Lance le chrono pour démarrer ton bilan !";
    }
    if (recap.thisMinutes === 0) {
      return "Pas encore de séance cette semaine. Un petit créneau aujourd'hui pour bien démarrer ?";
    }
    if (recap.lastMinutes === 0) {
      return "Belle reprise : rien la semaine d'avant, et déjà " + SF.app.formatMinutes(recap.thisMinutes) + " d'étude !";
    }
    if (recap.diffMinutes > 0) {
      return "Bravo : " + formatDelta(recap.diffMinutes) + " par rapport à la semaine d'avant !";
    }
    if (recap.diffMinutes === 0) {
      return "Exactement le même temps que la semaine d'avant. Belle régularité !";
    }
    return "Un peu moins que la semaine d'avant (" + formatDelta(recap.diffMinutes) + "). " +
      (recap.isSunday ? "Vise un peu plus la semaine prochaine !" : "Tu peux encore te rattraper !");
  }

  // ===================================================================
  // 5) Dessiner les blocs de l'accueil
  // ===================================================================

  // Une pastille avec la différence : verte si on a progressé, orange si on a baissé, grise si c'est égal.
  function buildDelta(diffMinutes) {
    const kind = diffMinutes > 0 ? 'up' : (diffMinutes < 0 ? 'down' : 'same');
    return el('span', { class: 'moti-delta moti-' + kind, text: formatDelta(diffMinutes) });
  }

  // Un gros chiffre avec sa légende (« 5 h 20 » / « cette semaine »).
  function buildTotal(minutes, label) {
    const total = el('div', { class: 'moti-total' });
    total.appendChild(el('span', { class: 'moti-total-value', text: SF.app.formatMinutes(minutes) }));
    total.appendChild(el('span', { class: 'moti-total-label', text: label }));
    return total;
  }

  // Garde les premières matières et regroupe les suivantes sous « Autres matières ».
  function limitRows(rows) {
    if (rows.length <= MAX_SUBJECT_ROWS) {
      return rows;
    }
    const shown = rows.slice(0, MAX_SUBJECT_ROWS);
    const other = { subject: 'Autres matières', thisMinutes: 0, lastMinutes: 0, diffMinutes: 0, isOther: true };
    rows.slice(MAX_SUBJECT_ROWS).forEach(function (row) {
      other.thisMinutes += row.thisMinutes;
      other.lastMinutes += row.lastMinutes;
    });
    other.diffMinutes = other.thisMinutes - other.lastMinutes;
    shown.push(other);
    return shown;
  }

  // Une barre dont la largeur est proportionnelle au temps (0 minute : pas de barre).
  function buildBar(className, minutes, maxMinutes) {
    const bar = el('div', { class: 'moti-bar ' + className });
    const width = minutes > 0 ? Math.max(3, Math.round(minutes / maxMinutes * 100)) : 0;
    bar.style.width = width + '%';
    return bar;
  }

  // Une ligne du bilan : la matière, le temps de la semaine, la différence et deux barres.
  function buildRow(row, maxMinutes) {
    const item = el('li', { class: 'moti-row' });

    const head = el('div', { class: 'moti-row-head' });
    const dot = el('span', { class: 'dot', 'aria-hidden': 'true' });
    dot.style.background = row.isOther ? 'rgba(255, 255, 255, .35)' : SF.app.subjectColor(row.subject);
    head.appendChild(dot);
    head.appendChild(el('span', { class: 'moti-row-subject', text: row.subject }));
    head.appendChild(el('span', { class: 'moti-row-time', text: SF.app.formatMinutes(row.thisMinutes) }));
    head.appendChild(el('span', {
      class: 'sr-only',
      text: ' cette semaine, ' + SF.app.formatMinutes(row.lastMinutes) + " la semaine d'avant"
    }));
    head.appendChild(buildDelta(row.diffMinutes));
    item.appendChild(head);

    const bars = el('div', { class: 'moti-bars', 'aria-hidden': 'true' });
    bars.appendChild(buildBar('moti-bar-now', row.thisMinutes, maxMinutes));
    bars.appendChild(buildBar('moti-bar-before', row.lastMinutes, maxMinutes));
    item.appendChild(bars);
    return item;
  }

  // Remplit la carte « Bilan de la semaine ». Le dimanche, elle est mise en valeur.
  function renderRecap(container, now) {
    if (!container) {
      return;
    }
    clear(container);
    const recap = getWeeklyRecap(now);
    container.classList.toggle('moti-recap-sunday', recap.isSunday);

    // En-tête : titre, explication et pastille « Dimanche ».
    const head = el('div', { class: 'moti-recap-head' });
    const titles = el('div', {});
    titles.appendChild(el('h2', {
      class: 'card-title moti-recap-title',
      text: recap.isSunday ? 'Bilan de la semaine' : 'Semaine en cours'
    }));
    titles.appendChild(el('p', {
      class: 'muted-text',
      text: recap.isSunday
        ? "Du lundi au dimanche, comparé à la semaine d'avant."
        : "Depuis lundi, comparé aux mêmes jours de la semaine d'avant."
    }));
    head.appendChild(titles);
    if (recap.isSunday) {
      head.appendChild(el('span', { class: 'chip moti-tag', text: 'Dimanche' }));
    }
    container.appendChild(head);

    // Aucune séance sur les deux périodes : un message et un bouton pour démarrer.
    if (recap.thisMinutes === 0 && recap.lastMinutes === 0) {
      const empty = el('div', { class: 'moti-empty' });
      empty.appendChild(el('p', { class: 'muted-text', text: getRecapMessage(recap) }));
      empty.appendChild(el('a', { class: 'btn', href: '#/timer', text: 'Lancer le chrono' }));
      container.appendChild(empty);
      return;
    }

    // Les deux totaux et leur différence.
    const totals = el('div', { class: 'moti-totals' });
    totals.appendChild(buildTotal(recap.thisMinutes, 'cette semaine'));
    totals.appendChild(buildTotal(recap.lastMinutes, "semaine d'avant"));
    totals.appendChild(buildDelta(recap.diffMinutes));
    container.appendChild(totals);

    // La légende des barres, puis une ligne par matière.
    const legend = el('div', { class: 'moti-legend', 'aria-hidden': 'true' });
    const legendNow = el('span', {});
    legendNow.appendChild(el('span', { class: 'moti-swatch moti-bar-now' }));
    legendNow.appendChild(document.createTextNode('Cette semaine'));
    const legendBefore = el('span', {});
    legendBefore.appendChild(el('span', { class: 'moti-swatch moti-bar-before' }));
    legendBefore.appendChild(document.createTextNode("Semaine d'avant"));
    legend.appendChild(legendNow);
    legend.appendChild(legendBefore);
    container.appendChild(legend);

    const rows = limitRows(recap.subjects);
    const biggest = rows.reduce(function (max, row) {
      return Math.max(max, row.thisMinutes, row.lastMinutes);
    }, 1);
    const list = el('ul', { class: 'moti-rows' });
    rows.forEach(function (row) {
      list.appendChild(buildRow(row, biggest));
    });
    container.appendChild(list);

    container.appendChild(el('p', { class: 'moti-message', text: getRecapMessage(recap) }));
  }

  // Un badge : la flamme, le nombre de jours et son état (« Obtenu » ou « Encore 3 jours »).
  function buildBadge(badge, index) {
    const tier = Math.min(index + 1, 3); // 3 couleurs de badge
    const item = el('li', {
      class: 'moti-badge moti-tier-' + tier + (badge.unlocked ? ' moti-badge-unlocked' : ' moti-badge-locked')
    });
    item.appendChild(el('span', { class: 'moti-badge-icon', 'aria-hidden': 'true', html: FLAME_ICON }));
    item.appendChild(el('span', { class: 'moti-badge-days', text: badge.label }));
    item.appendChild(el('span', {
      class: 'moti-badge-state',
      text: badge.unlocked ? 'Obtenu' : 'Encore ' + countDays(badge.remaining)
    }));
    return item;
  }

  // Remplit la carte « Badges de série ».
  function renderBadges(container, now) {
    if (!container) {
      return;
    }
    clear(container);
    container.appendChild(el('h2', { class: 'card-title', text: 'Badges de série' }));

    const current = SF.sessions.getStats(realDate(now)).streakDays;
    container.appendChild(el('p', {
      class: 'muted-text moti-streak-line',
      text: 'Série actuelle : ' + countDays(current) + ' · Meilleure série : ' + countDays(getBestStreak())
    }));

    const badges = getBadges(now);
    const list = el('ul', { class: 'moti-badges' });
    badges.forEach(function (badge, index) {
      list.appendChild(buildBadge(badge, index));
    });
    container.appendChild(list);

    // Une barre de progression vers le prochain badge (ou un compliment s'ils sont tous gagnés).
    const next = badges.filter(function (badge) {
      return !badge.unlocked;
    })[0];
    if (next) {
      const progress = el('div', { class: 'moti-progress' });
      progress.appendChild(el('div', {
        class: 'moti-progress-label',
        text: 'Prochain badge : ' + next.label + ' (encore ' + countDays(next.remaining) + ')'
      }));
      const track = el('div', { class: 'moti-progress-track', 'aria-hidden': 'true' });
      const fill = el('div', { class: 'moti-progress-fill' });
      fill.style.width = Math.max(0, Math.min(100, Math.round(current / next.days * 100))) + '%';
      track.appendChild(fill);
      progress.appendChild(track);
      container.appendChild(progress);
    } else {
      container.appendChild(el('p', { class: 'moti-progress-label', text: 'Tous les badges sont gagnés. Bravo !' }));
    }
    container.appendChild(el('p', {
      class: 'muted-text moti-rule',
      text: 'Un jour compte à partir de ' + STREAK_MINUTES + " minutes d'étude."
    }));
  }

  // ===================================================================
  // 6) Fêter les nouveaux badges
  // ===================================================================

  let knownCount = SF.sessions.getAll().length; // nombre de sessions au dernier contrôle
  let checkTimer = null;

  // Appelée quand le journal d'étude change. On attend la fin des changements (setTimeout 0)
  // pour ne contrôler qu'une fois, même si 70 sessions arrivent d'un coup (données de démo, import).
  // On ne fête un badge que si UNE seule session vient d'être ajoutée (chrono ou saisie à la main).
  function scheduleCheck() {
    if (checkTimer !== null) {
      return;
    }
    checkTimer = setTimeout(function () {
      checkTimer = null;
      const count = SF.sessions.getAll().length;
      const addedOne = (count === knownCount + 1);
      knownCount = count;
      checkNewBadges(undefined, !addedOne);
    }, 0);
  }

  if (SF.events && typeof SF.events.on === 'function') {
    SF.events.on('data:changed', function (info) {
      if (info && info.collection === 'sessions') {
        scheduleCheck();
      }
    });
  }

  // Au chargement : on note les badges déjà gagnés, pour ne pas les fêter à tort au prochain changement.
  try {
    checkNewBadges();
  } catch (error) {
    // un problème ici ne doit jamais empêcher l'appli de démarrer
  }

  SF.motivation = {
    getBestStreak: getBestStreak,
    getBadges: getBadges,
    checkNewBadges: checkNewBadges,
    isRecapDay: isRecapDay,
    getWeeklyRecap: getWeeklyRecap,
    getRecapMessage: getRecapMessage,
    renderBadges: renderBadges,
    renderRecap: renderRecap
  };
})();
