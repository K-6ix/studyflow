/* =========================================================
   StudyFlow — SF.app : cadre de l'application
   Routeur de vues, dock, toasts, outils partagés, démo.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Les 7 vues prévues, avec leur icône SVG en ligne (trait currentColor).
  var VIEWS = [
    { id: 'home',       label: 'Accueil',      icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>' },
    { id: 'agenda',     label: 'Agenda',       icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' },
    { id: 'tasks',      label: 'Tâches',       icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' },
    { id: 'revisions',  label: 'Révisions',    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
    { id: 'timer',      label: 'Chrono',       icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>' },
    { id: 'stats',      label: 'Statistiques', icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12" y="7" width="3" height="11"/><rect x="17" y="13" width="3" height="5"/></svg>' },
    { id: 'settings',   label: 'Réglages',     icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' }
  ];

  // Pages « cachées » : elles existent (adresse #/log) mais n'ont pas d'icône dans la dock.
  // On y arrive par un bouton (ici : depuis Réglages > Compte).
  VIEWS.push({
    id: 'log',
    label: 'Journal des connexions',
    hidden: true,
    icon: ''
  });

  var byId = {};
  VIEWS.forEach(function (v) { byId[v.id] = v; });

  var registered = {};   // id -> { mount, onShow }
  var currentId = null;

  // ----- Outils partagés -------------------------------------------------

  // '1 h 08', '44 min', '2 h', '0 min'
  function formatMinutes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return '0 min';
    n = Math.round(n);
    if (n < 60) return n + ' min';
    var h = Math.floor(n / 60);
    var m = n % 60;
    if (m === 0) return h + ' h';
    return h + ' h ' + (m < 10 ? '0' + m : m);
  }

  // « à l'instant », « il y a 12 min », « il y a 4 h », « hier », « il y a 3 jours », puis date FR.
  function relativeTime(isoDateTime) {
    var then;
    var text = String(isoDateTime || '');
    if (text.length === 10 && SF.dates.isValidISO(text)) {
      // Date seule (YYYY-MM-DD) : on la lit en heure locale (jamais new Date('YYYY-MM-DD')).
      var p = text.split('-');
      then = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    } else {
      // Date-heure complète (ex. createdAt, qui finit par Z = heure UTC) : new Date la convertit correctement.
      then = new Date(text);
    }
    var now = new Date();
    var diff = now - then;
    if (isNaN(diff)) return '';
    var mins = Math.floor(diff / 60000);

    if (mins < 1) return 'à l\'instant';
    if (mins < 60) return 'il y a ' + mins + ' min';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return 'il y a ' + hours + ' h';

    var todayISO = SF.dates.todayISO(now);
    var thenDate = SF.dates.toISO(then);
    var days = SF.dates.diffDays(thenDate, todayISO);
    if (days === 1) return 'hier';
    if (days < 30) return 'il y a ' + days + ' jours';
    return SF.dates.formatFR(thenDate);
  }

  // Retire les accents pour une teinte stable par matière.
  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function subjectColor(subject) {
    var s = normalize(subject);
    var hash = 0;
    for (var i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    var h = ((hash % 360) + 360) % 360;
    return 'hsl(' + h + ', 70%, 62%)';
  }

  // ----- Toasts ----------------------------------------------------------

  function toast(message, type) {
    type = type || 'info';
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    host.appendChild(el);
    // Disparaît seule après 3 s.
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3000);
  }

  // ----- Routeur ---------------------------------------------------------

  function registerView(id, def) {
    if (!byId[id]) {
      // id inconnu du contrat -> ignoré + avertissement.
      console.warn('[SF.app] Vue inconnue, ignorée :', id);
      return;
    }
    registered[id] = def || {};
  }

  function navigate(id) {
    if (!registered[id]) id = 'home';
    if (location.hash !== '#/' + id) {
      location.hash = '#/' + id;
    } else {
      show(id);
    }
  }

  function show(id) {
    if (!registered[id]) id = 'home';
    var def = registered[id];

    // Masque toutes les sections, affiche la bonne.
    var sections = document.querySelectorAll('#views > .view');
    for (var i = 0; i < sections.length; i++) {
      sections[i].hidden = (sections[i].id !== 'view-' + id);
    }

    // Marque le lien actif dans la dock.
    var links = document.querySelectorAll('.dock a');
    for (var j = 0; j < links.length; j++) {
      if (links[j].getAttribute('href') === '#/' + id) {
        links[j].setAttribute('aria-current', 'page');
      } else {
        links[j].removeAttribute('aria-current');
      }
    }

    currentId = id;
    document.title = byId[id].label + ' · StudyFlow';

    if (def && typeof def.onShow === 'function') {
      try { def.onShow(); }
      catch (e) { console.error('[SF.app] onShow a planté pour "' + id + '" :', e); }
    }
  }

  function onHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var id = raw && registered[raw] ? raw : 'home';
    show(id);
  }

  // ----- Démarrage -------------------------------------------------------

  function start() {
    var viewsHost = document.getElementById('views');
    if (!viewsHost) return;

    // Crée une section par vue prévue et monte les vues enregistrées.
    VIEWS.forEach(function (v) {
      var section = document.getElementById('view-' + v.id);
      if (!section) {
        section = document.createElement('section');
        section.id = 'view-' + v.id;
        section.className = 'view';
        section.hidden = true;
        viewsHost.appendChild(section);
      }
      var def = registered[v.id];
      if (def && typeof def.mount === 'function') {
        try { def.mount(section); }
        catch (e) {
          console.error('[SF.app] mount a planté pour "' + v.id + '" :', e);
          section.innerHTML = '';
          var empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'Cette page n\'a pas pu se charger.';
          section.appendChild(empty);
        }
      } else {
        // Vue non enregistrée : état vide par défaut.
        var ph = document.createElement('div');
        ph.className = 'empty';
        ph.textContent = 'Bientôt disponible.';
        section.appendChild(ph);
      }
    });

    buildDock();

    // Routage par hash.
    window.addEventListener('hashchange', onHash);
    if (!location.hash) location.hash = '#/home';
    onHash();

    // Raccourci Ctrl+K / Cmd+K sur la recherche.
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        var s = document.getElementById('search-input');
        if (s) s.focus();
      }
    });
  }

  function buildDock() {
    var dock = document.querySelector('.dock');
    if (!dock) return;
    dock.innerHTML = '';
    VIEWS.forEach(function (v) {
      if (v.hidden) return; // pas d'icône dans la dock pour les pages cachées
      var a = document.createElement('a');
      a.href = '#/' + v.id;
      a.setAttribute('aria-label', v.label);
      a.innerHTML = v.icon;
      if (!registered[v.id]) {
        a.setAttribute('aria-disabled', 'true');
        a.title = 'Bientôt';
        a.addEventListener('click', function (e) {
          e.preventDefault(); // clic sans effet sur vue non enregistrée
        });
      } else {
        a.title = v.label;
      }
      dock.appendChild(a);
    });
  }

  // ----- Données de démonstration ---------------------------------------

  function seedDemo() {
    var D = SF.dates;
    var today = D.todayISO();
    var subjects = ['Maths', 'Physique', 'Algorithmique', 'Anglais', 'Droit civil', 'Biologie'];

    // ~40 jours de sessions d'étude jusqu'à aujourd'hui compris.
    // Quelques jours sans session, mais seulement au-delà des 10 derniers jours (pour avoir une belle série).
    for (var i = 0; i <= 40; i++) {
      var ago = 40 - i;                       // jours avant aujourd'hui (0 = aujourd'hui)
      if (ago > 10 && i % 5 === 3) continue;  // jour sans session
      var date = D.addDays(today, -ago);
      var nbSessions = ago === 0 ? 2 : 1 + (i % 3); // aujourd'hui : 2 sessions ; sinon 1 à 3
      var longDay = ago > 0 && i % 7 === 4;          // quelques journées « à fond » (plus de 3 h) : teinte la plus foncée
      if (longDay) nbSessions = 3;
      for (var s = 0; s < nbSessions; s++) {
        SF.sessions.add({
          date: date,
          subject: subjects[(i + s) % subjects.length],
          minutes: ago === 0 ? [40, 28][s] : (longDay ? [90, 60, 45][s] : [25, 30, 45, 50, 60, 90][((i + s) % 6)]),
          note: 'Révision ' + (s + 1),
          source: 'manual'
        });
      }
    }

    // Une dizaine d'activités autour d'aujourd'hui.
    SF.activities.add({
      title: 'Examen partiel Maths', subject: 'Maths', type: 'exam',
      date: D.addDays(today, 4), time: '09:00', priority: 'high',
      estimatedMinutes: 120, description: 'Salle A12 — tout le programme.'
    });
    SF.activities.add({
      title: 'DM Physique', subject: 'Physique', type: 'homework',
      date: D.addDays(today, 2), time: '18:00', priority: 'medium',
      estimatedMinutes: 90, description: 'Exercices 3 et 4.'
    });
    SF.activities.add({
      title: 'Rendre projet Algorithmique', subject: 'Algorithmique', type: 'project',
      date: D.addDays(today, 6), priority: 'high', estimatedMinutes: 180,
      description: 'Dépôt Git + rapport.'
    });
    SF.activities.add({
      title: 'Lire chapitre Droit', subject: 'Droit civil', type: 'revision',
      date: D.addDays(today, 1), priority: 'low', estimatedMinutes: 40,
      description: 'Chapitre 5 — contrats.'
    });
    // Une activité en retard (non terminée, date passée).
    SF.activities.add({
      title: 'Fiche Anglais', subject: 'Anglais', type: 'revision',
      date: D.addDays(today, -3), priority: 'medium', estimatedMinutes: 30,
      description: 'Vocabulaire unité 7.'
    });
    // Une activité terminée.
    SF.activities.add({
      title: 'TD Biologie', subject: 'Biologie', type: 'homework',
      date: D.addDays(today, -1), priority: 'low', estimatedMinutes: 45,
      description: 'Compte-rendu.'
    });
    SF.activities.add({
      title: 'Préparer exposé Anglais', subject: 'Anglais', type: 'project',
      date: D.addDays(today, 8), priority: 'medium', estimatedMinutes: 60,
      description: 'Slides + notes.'
    });
    SF.activities.add({
      title: 'Exercices Maths', subject: 'Maths', type: 'revision',
      date: D.addDays(today, 3), priority: 'medium', estimatedMinutes: 50,
      description: 'Série 4.'
    });
    SF.activities.add({
      title: 'Lecture Biologie', subject: 'Biologie', type: 'revision',
      date: D.addDays(today, 5), priority: 'low', estimatedMinutes: 35,
      description: 'Chapitre 8.'
    });
    SF.activities.add({
      title: 'Réviser Droit', subject: 'Droit civil', type: 'revision',
      date: D.addDays(today, 7), priority: 'high', estimatedMinutes: 75,
      description: 'Préparer l\'examen.'
    });

    // Termine l'activité « TD Biologie ».
    var all = SF.activities.getAll();
    for (var k = 0; k < all.length; k++) {
      if (all[k].title === 'TD Biologie') { SF.activities.complete(all[k].id); break; }
    }

    // 3 cours dans la semaine (jours 1, 3, 4 de la semaine courante).
    var monday = D.startOfWeek(today);
    SF.timetable.addMany([
      { weekday: 1, subject: 'Maths',     startTime: '08:30', endTime: '10:00', room: 'A12', teacher: 'M. Bernard' },
      { weekday: 3, subject: 'Physique',  startTime: '10:15', endTime: '12:00', room: 'B04', teacher: 'Mme Leroy' },
      { weekday: 4, subject: 'Anglais',   startTime: '14:00', endTime: '15:30', room: 'C21', teacher: 'Ms Carter' }
    ]);

    // Un objectif de démonstration (page Révisions) : 3 séances de maths sur les 2 prochaines semaines.
    if (SF.planner && SF.planner.addGoal) {
      SF.planner.addGoal({
        title: '3 séances de maths',
        subject: 'Maths',
        targetType: 'sessions',
        targetValue: 3,
        startDate: today,
        endDate: D.addDays(today, 14)
      });
    }

    SF.events.emit('data:changed', { collection: 'sessions' });
    SF.events.emit('data:changed', { collection: 'activities' });
    SF.events.emit('data:changed', { collection: 'timetable' });

    toast('Données de démonstration ajoutées.', 'success');
  }

  // ----- Démo cachée : à lancer depuis la console du navigateur ----------
  // Aucun bouton ni texte ne la montre : on tape demo() dans la console (F12).

  function hasAnyData() {
    try {
      return SF.sessions.getAll().length > 0 ||
             SF.activities.getAll().length > 0 ||
             SF.timetable.getAll().length > 0 ||
             SF.planner.getGoals().length > 0;
    } catch (e) {
      return false;
    }
  }

  window.demo = function () {
    // S'il y a déjà des données, on demande d'abord confirmation.
    if (hasAnyData()) {
      var ok = window.confirm('Tu as déjà des données. Les exemples vont s\'ajouter aux tiennes. Continuer ?');
      if (!ok) {
        console.log('Démo annulée');
        return;
      }
    }

    try {
      seedDemo();
    } catch (e) {
      console.error('Impossible de charger la démo :', e);
      return;
    }

    // Rafraîchit la page affichée : seedDemo prévient déjà les vues (data:changed),
    // et on relance aussi onShow de la vue courante pour être sûr.
    var id = location.hash.replace(/^#\/?/, '') || 'home';
    navigate(id);

    console.log('Démo chargée');
  };

  // ----- API publique ----------------------------------------------------

  SF.app = {
    registerView: registerView,
    navigate: navigate,
    start: start,
    toast: toast,
    formatMinutes: formatMinutes,
    relativeTime: relativeTime,
    subjectColor: subjectColor,
    seedDemo: seedDemo
  };
})();
