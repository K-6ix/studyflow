/* =========================================================
   StudyFlow — Vue « Accueil »
   Tableau de bord : progression, stats, activité récente,
   carte de chaleur du mois, rythme de la semaine.
   Blocs ajoutés (remplis par SF.reminders et SF.motivation) :
   bandeau de rappel, compte à rebours, badges de série, bilan de la semaine.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Jours de la semaine (la semaine commence lundi).
  var WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  var WEEKDAYS_FULL = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // Références DOM (renseignées dans mount).
  var root = null;
  var ringFg = null;
  var ringPctText = null;
  var ringTimeText = null;
  var goalButtons = null;
  var goalInput = null;
  var taskCountEl = null;
  var taskListEl = null;
  var statTotalEl = null;
  var statSessionsEl = null;
  var statAvgEl = null;
  var statStreakEl = null;
  var recentListEl = null;
  var recentSubjectDatalist = null;
  var monthTitleEl = null;
  var monthGridEl = null;
  var selectedDateEl = null;
  var selectedTimeEl = null;
  var selectedTasksEl = null;
  var weekGridEl = null;
  var emptyBannerEl = null;
  var onboardingEl = null;  // accueil guidé en 3 étapes (SF.onboarding)
  var gridEl = null;        // la grille principale
  var reminderEl = null;    // bandeau de rappel (SF.reminders)
  var countdownEl = null;   // carte « Compte à rebours » (SF.reminders)
  var badgesEl = null;      // carte « Badges de série » (SF.motivation)
  var recapEl = null;       // carte « Bilan de la semaine » (SF.motivation)

  // État interne.
  var viewedYear = 0;     // mois affiché dans la carte de chaleur
  var viewedMonth = 0;    // 0-11
  var selectedISO = null; // jour sélectionné (dans la vue du mois)

  // ----- Petits utilitaires ---------------------------------------------

  // Version « capitalisée » d'un texte.
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Supprime tous les enfants d'un élément.
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // Crée un élément avec des attributs et des enfants.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = { svg: true, circle: true, path: true, g: true, line: true, rect: true };

  function el(tag, attrs, children) {
    // Les éléments SVG doivent être créés dans l'espace de noms SVG : sinon le navigateur ne les dessine pas.
    var isSvg = SVG_TAGS[tag] === true;
    var node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') {
          if (isSvg) node.setAttribute('class', attrs[k]); // className est en lecture seule sur un élément SVG
          else node.className = attrs[k];
        }
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k]; // uniquement pour des icônes SVG écrites dans ce fichier
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  // Niveau d'intensité (0-4) pour la carte de chaleur.
  function heatLevel(minutes) {
    if (!minutes || minutes <= 0) return 0;
    if (minutes < 60) return 1;
    if (minutes < 120) return 2;
    if (minutes < 180) return 3;
    return 4;
  }

  // ----- Montage (une seule fois) ---------------------------------------

  function mount(container) {
    root = container;
    root.innerHTML = '';

    // Bannière d'état vide global.
    emptyBannerEl = el('div', { class: 'empty home-empty', style: 'display:none' });
    emptyBannerEl.appendChild(el('p', { text: 'Ton tableau de bord est vide.' }));
    root.appendChild(emptyBannerEl);

    // Accueil guidé en 3 étapes (premier lancement) : géré par SF.onboarding.
    if (SF.onboarding) {
      onboardingEl = el('div', { class: 'onb-host' });
      root.appendChild(onboardingEl);
      SF.onboarding.mount(onboardingEl);
      SF.events.on('onboarding:changed', render);
    }

    // Bandeau de rappel (rempli dans render par SF.reminders).
    if (SF.reminders) {
      reminderEl = el('div', { class: 'remind-host' });
      root.appendChild(reminderEl);
    }

    // Grille principale.
    var grid = el('div', { class: 'home-grid' });
    root.appendChild(grid);
    gridEl = grid;

    grid.appendChild(buildProgressCard());
    grid.appendChild(buildStatsCard());
    grid.appendChild(buildRecentCard());
    grid.appendChild(buildMonthCard());
    grid.appendChild(buildWeekCard());

    // Cartes ajoutées : compte à rebours, badges de série, bilan de la semaine.
    if (SF.reminders) {
      countdownEl = el('section', { class: 'card home-countdown' });
      grid.appendChild(countdownEl);
    }
    if (SF.motivation) {
      badgesEl = el('section', { class: 'card home-badges' });
      recapEl = el('section', { class: 'card home-recap' });
      grid.appendChild(badgesEl);
      grid.appendChild(recapEl);
    }

    // Dialog d'ajout de session (en dehors de la grille).
    root.appendChild(buildDialog());

    // Init de l'état.
    var today = SF.dates.todayISO();
    selectedISO = today;
    var d = SF.dates.fromISO(today);
    viewedYear = d.getFullYear();
    viewedMonth = d.getMonth();

    // Anim de l'anneau : on prépare le cercle.
    setupRing();

    // Branchement global.
    SF.events.on('data:changed', render);
  }

  // --- Carte Progression du jour ---

  function buildProgressCard() {
    var card = el('section', { class: 'card home-progress' });

    card.appendChild(el('h2', { class: 'card-title', text: 'Progression du jour' }));

    var body = el('div', { class: 'progress-body' });

    // Anneau SVG.
    var ringWrap = el('div', { class: 'ring-wrap' });
    var size = 130, stroke = 10, r = (size - stroke) / 2;
    var circ = 2 * Math.PI * r;
    var svg = el('svg', { class: 'ring-svg', width: String(size), height: String(size), viewBox: '0 0 ' + size + ' ' + size });
    var bg = el('circle', { class: 'ring-bg', cx: String(size / 2), cy: String(size / 2), r: String(r), fill: 'none', 'stroke-width': String(stroke) });
    ringFg = el('circle', { class: 'ring-fg', cx: String(size / 2), cy: String(size / 2), r: String(r), fill: 'none', 'stroke-width': String(stroke), 'stroke-linecap': 'round' });
    ringFg.style.strokeDasharray = String(circ);
    ringFg.style.strokeDashoffset = String(circ);
    ringFg.style.transform = 'rotate(-90deg)';
    ringFg.style.transformOrigin = '50% 50%';
    svg.appendChild(bg);
    svg.appendChild(ringFg);
    ringWrap.appendChild(svg);

    var center = el('div', { class: 'ring-center' });
    ringTimeText = el('div', { class: 'ring-time', text: '0 min' });
    ringPctText = el('div', { class: 'ring-pct', text: '0 % de l\'objectif' });
    center.appendChild(ringTimeText);
    center.appendChild(ringPctText);
    ringWrap.appendChild(center);

    body.appendChild(ringWrap);

    // Côté droit : objectif + tâches.
    var side = el('div', { class: 'progress-side' });

    var goalBlock = el('div', {});
    goalBlock.appendChild(el('div', { class: 'goal-label', text: 'Objectif journalier' }));
    var btnRow = el('div', { class: 'goal-buttons' });
    goalButtons = {};
    [60, 120, 180, 240].forEach(function (mins) {
      var b = el('button', { class: 'btn goal-btn', type: 'button', 'data-min': String(mins) }, SF.app.formatMinutes(mins));
      b.addEventListener('click', function () { setGoal(mins); });
      goalButtons[mins] = b;
      btnRow.appendChild(b);
    });
    var inputWrap = el('div', { class: 'goal-input-wrap' });
    goalInput = el('input', { class: 'goal-input', type: 'number', min: '1', step: '1', 'aria-label': 'Objectif en heures' });
    goalInput.addEventListener('change', function () {
      var h = parseInt(goalInput.value, 10);
      if (isNaN(h) || h < 1) { SF.app.toast('Entre un nombre d\'heures valide.', 'error'); return; }
      setGoal(h * 60);
    });
    inputWrap.appendChild(goalInput);
    inputWrap.appendChild(el('span', { class: 'goal-input-unit', text: 'h' }));
    btnRow.appendChild(inputWrap);
    goalBlock.appendChild(btnRow);
    side.appendChild(goalBlock);

    // Bloc tâches du jour.
    var taskSection = el('div', { class: 'task-section' });
    taskCountEl = el('div', { class: 'task-count', text: "Tâches terminées aujourd'hui : 0/0" });
    taskSection.appendChild(taskCountEl);
    taskListEl = el('div', { class: 'task-list' });
    taskSection.appendChild(taskListEl);
    side.appendChild(taskSection);

    body.appendChild(side);
    card.appendChild(body);
    return card;
  }

  function setGoal(minutes) {
    var res = SF.storage.updateSettings({ dailyGoalMinutes: minutes });
    if (!res || !res.ok) {
      SF.app.toast('Objectif invalide.', 'error');
      return;
    }
    SF.events.emit('data:changed', { collection: 'settings' });
  }

  function setupRing() {
    // Rien à faire de spécial : l'anim se fait via CSS transition sur ringFg.
  }

  // Met à jour l'anneau (appelé dans render).
  function updateRing(percent, timeText, pctText) {
    var size = 130, stroke = 10, r = (size - stroke) / 2;
    var circ = 2 * Math.PI * r;
    var pct = Math.max(0, Math.min(100, percent));
    ringFg.style.strokeDashoffset = String(circ * (1 - pct / 100));
    ringTimeText.textContent = timeText;
    ringPctText.textContent = pctText;
  }

  // --- Carte Stats ---

  function buildStatsCard() {
    var card = el('section', { class: 'home-stats' });
    card.appendChild(buildStatBox('home-stat stat-total', 'Heures totales'));
    card.appendChild(buildStatBox('home-stat stat-sessions', 'Séances'));
    card.appendChild(buildStatBox('home-stat stat-avg', 'Moyenne / jour'));
    card.appendChild(buildStatBox('home-stat stat-streak', 'Série'));
    return card;
  }

  function buildStatBox(cls, label) {
    var box = el('div', { class: cls });
    var v = el('div', { class: 'stat-value', text: '0' });
    var l = el('div', { class: 'stat-label', text: label });
    box.appendChild(v);
    box.appendChild(l);
    return box;
  }

  // --- Carte Activité récente ---

  function buildRecentCard() {
    var card = el('section', { class: 'card home-recent' });
    var header = el('div', { class: 'recent-header' });
    header.appendChild(el('h2', { class: 'card-title', text: 'Activité récente' }));
    var addBtn = el('button', {
      class: 'btn btn-ghost recent-add', type: 'button', 'aria-label': 'Ajouter une session'
    }, '+');
    addBtn.addEventListener('click', openDialog);
    header.appendChild(addBtn);
    card.appendChild(header);

    recentListEl = el('div', { class: 'recent-list' });
    card.appendChild(recentListEl);
    return card;
  }

  // --- Carte Vue du mois ---

  function buildMonthCard() {
    var card = el('section', { class: 'card home-month' });

    var header = el('div', { class: 'month-header' });
    var prev = el('button', { class: 'month-nav', type: 'button', 'aria-label': 'Mois précédent' }, '‹');
    prev.addEventListener('click', function () { shiftMonth(-1); });
    monthTitleEl = el('div', { class: 'month-title', text: '' });
    var next = el('button', { class: 'month-nav', type: 'button', 'aria-label': 'Mois suivant' }, '›');
    next.addEventListener('click', function () { shiftMonth(1); });
    header.appendChild(prev);
    header.appendChild(monthTitleEl);
    header.appendChild(next);
    card.appendChild(header);

    var wdRow = el('div', { class: 'month-weekdays' });
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (l) {
      wdRow.appendChild(el('span', { text: l }));
    });
    card.appendChild(wdRow);

    monthGridEl = el('div', { class: 'month-grid' });
    card.appendChild(monthGridEl);

    var legend = el('div', { class: 'month-legend' });
    legend.appendChild(el('span', { text: 'Moins' }));
    legend.appendChild(el('span', { class: 'legend-box l1' }));
    legend.appendChild(el('span', { class: 'legend-box l2' }));
    legend.appendChild(el('span', { class: 'legend-box l3' }));
    legend.appendChild(el('span', { class: 'legend-box l4' }));
    legend.appendChild(el('span', { text: 'Plus' }));
    card.appendChild(legend);

    var sel = el('div', { class: 'month-selected' });
    selectedDateEl = el('div', { class: 'selected-date', text: '' });
    selectedTimeEl = el('div', { class: 'selected-time', text: '' });
    selectedTasksEl = el('div', { class: 'selected-tasks', text: '' });
    sel.appendChild(selectedDateEl);
    sel.appendChild(selectedTimeEl);
    sel.appendChild(selectedTasksEl);
    card.appendChild(sel);

    return card;
  }

  function shiftMonth(delta) {
    viewedMonth += delta;
    if (viewedMonth < 0) { viewedMonth = 11; viewedYear--; }
    if (viewedMonth > 11) { viewedMonth = 0; viewedYear++; }
    renderMonth();
  }

  // --- Carte Rythme de la semaine ---

  function buildWeekCard() {
    var card = el('section', { class: 'card home-week' });
    card.appendChild(el('h2', { class: 'card-title', text: 'Rythme de la semaine' }));
    weekGridEl = el('div', { class: 'week-grid' });
    card.appendChild(weekGridEl);
    return card;
  }

  // --- Dialog d'ajout de session ---

  var dialogEl = null;
  var fSubject = null, fMinutes = null, fDate = null, fNote = null;
  var fErrSubject = null, fErrMinutes = null, fErrDate = null;

  function buildDialog() {
    dialogEl = el('dialog', { class: 'session-dialog', 'aria-label': 'Ajouter une session' });
    dialogEl.appendChild(el('h2', { class: 'dialog-title', text: 'Ajouter une session' }));

    var form = el('form', { class: 'session-form' });

    // Matière (avec datalist).
    recentSubjectDatalist = el('datalist', { id: 'dl-subjects' });
    var fSubjectWrap = el('div', { class: 'field' });
    fSubjectWrap.appendChild(el('label', { class: 'field-label', for: 'sf-subject', text: 'Matière' }));
    fSubject = el('input', { class: 'field-input', id: 'sf-subject', type: 'text', list: 'dl-subjects', placeholder: 'ex. Maths' });
    fSubjectWrap.appendChild(fSubject);
    fSubjectWrap.appendChild(recentSubjectDatalist);
    fErrSubject = el('div', { class: 'field-error' });
    fSubjectWrap.appendChild(fErrSubject);
    form.appendChild(fSubjectWrap);

    // Minutes.
    var fMinWrap = el('div', { class: 'field' });
    fMinWrap.appendChild(el('label', { class: 'field-label', for: 'sf-minutes', text: 'Durée (minutes)' }));
    fMinutes = el('input', { class: 'field-input', id: 'sf-minutes', type: 'number', min: '1', step: '1', placeholder: '45' });
    fMinWrap.appendChild(fMinutes);
    fErrMinutes = el('div', { class: 'field-error' });
    fMinWrap.appendChild(fErrMinutes);
    form.appendChild(fMinWrap);

    // Date.
    var fDateWrap = el('div', { class: 'field' });
    fDateWrap.appendChild(el('label', { class: 'field-label', for: 'sf-date', text: 'Date' }));
    fDate = el('input', { class: 'field-input', id: 'sf-date', type: 'date' });
    fDateWrap.appendChild(fDate);
    fErrDate = el('div', { class: 'field-error' });
    fDateWrap.appendChild(fErrDate);
    form.appendChild(fDateWrap);

    // Note.
    var fNoteWrap = el('div', { class: 'field' });
    fNoteWrap.appendChild(el('label', { class: 'field-label', for: 'sf-note', text: 'Note (facultatif)' }));
    fNote = el('input', { class: 'field-input', id: 'sf-note', type: 'text', placeholder: 'Un détail…' });
    fNoteWrap.appendChild(fNote);
    form.appendChild(fNoteWrap);

    // Actions.
    var actions = el('div', { class: 'dialog-actions' });
    var cancel = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Annuler');
    cancel.addEventListener('click', closeDialog);
    var submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Ajouter');
    actions.appendChild(cancel);
    actions.appendChild(submit);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitSession();
    });

    dialogEl.appendChild(form);
    return dialogEl;
  }

  function openDialog() {
    fSubject.value = '';
    fMinutes.value = '';
    fDate.value = SF.dates.todayISO();
    fNote.value = '';
    fErrSubject.textContent = '';
    fErrMinutes.textContent = '';
    fErrDate.textContent = '';

    // Alimente la datalist des matières.
    clear(recentSubjectDatalist);
    var subjects = SF.filters.getSubjects();
    subjects.forEach(function (s) {
      var o = el('option', { value: s });
      recentSubjectDatalist.appendChild(o);
    });

    if (typeof dialogEl.showModal === 'function') {
      dialogEl.showModal();
    } else {
      dialogEl.setAttribute('open', '');
    }
    fSubject.focus();
  }

  function closeDialog() {
    if (typeof dialogEl.close === 'function') {
      dialogEl.close();
    } else {
      dialogEl.removeAttribute('open');
    }
  }

  function submitSession() {
    fErrSubject.textContent = '';
    fErrMinutes.textContent = '';
    fErrDate.textContent = '';

    var data = {
      subject: fSubject.value.trim(),
      minutes: parseInt(fMinutes.value, 10),
      date: fDate.value,
      note: fNote.value.trim(),
      source: 'manual'
    };

    var res = SF.sessions.add(data);
    if (res && res.ok) {
      closeDialog();
      SF.app.toast('Session ajoutée.', 'success');
    } else if (res && res.errors) {
      if (res.errors.subject) fErrSubject.textContent = res.errors.subject;
      if (res.errors.minutes) fErrMinutes.textContent = res.errors.minutes;
      if (res.errors.date) fErrDate.textContent = res.errors.date;
    } else {
      SF.app.toast('Impossible d\'ajouter la session.', 'error');
    }
  }

  // ----- Rendu (mise à jour des données) --------------------------------

  function render() {
    if (!root) return;

    var today = SF.dates.todayISO();
    var stats = SF.sessions.getStats ? SF.sessions.getStats() : {
      totalMinutes: 0, sessionsCount: 0, avgMinutesPerDay: 0,
      streakDays: 0, todayMinutes: 0, goalMinutes: 120, goalPercent: 0
    };

    // État vide global.
    var hasData = SF.sessions.getAll().length > 0 || SF.activities.getAll().length > 0;
    // Pendant le guide, on cache la bannière « vide » et la grille (le guide prend la place).
    var guideActive = !!(SF.onboarding && SF.onboarding.isActive());
    emptyBannerEl.style.display = (hasData || guideActive) ? 'none' : '';
    gridEl.style.display = guideActive ? 'none' : '';

    renderProgress(stats, today);
    renderStats(stats);
    renderRecent();
    renderMonth();
    renderWeek(today);
    renderExtras();
  }

  // Blocs ajoutés par SF.reminders et SF.motivation.
  // Chaque bloc est protégé : une erreur dans l'un d'eux ne doit jamais casser le reste de l'accueil.
  function safely(draw) {
    try {
      draw();
    } catch (e) {
      if (window.console) console.error("Accueil : un bloc n'a pas pu s'afficher.", e);
    }
  }

  function renderExtras() {
    if (reminderEl) safely(function () { SF.reminders.renderBanner(reminderEl); });
    if (countdownEl) safely(function () { SF.reminders.renderCountdown(countdownEl); });
    if (badgesEl) safely(function () { SF.motivation.renderBadges(badgesEl); });
    if (recapEl) {
      safely(function () { SF.motivation.renderRecap(recapEl); });
      // Le dimanche, le bilan de la semaine monte en haut de la grille (voir home.css).
      safely(function () { gridEl.classList.toggle('is-recap-day', SF.motivation.isRecapDay()); });
    }
  }

  function renderProgress(stats, today) {
    // Anneau.
    var pct = stats.goalPercent || 0;
    var timeText = SF.app.formatMinutes(stats.todayMinutes || 0);
    var pctText = Math.round(pct) + ' % de l\'objectif de ' + SF.app.formatMinutes(stats.goalMinutes || 120);
    updateRing(pct, timeText, pctText);

    // Objectif journalier : bouton actif.
    var goal = stats.goalMinutes || 120;
    [60, 120, 180, 240].forEach(function (mins) {
      if (mins === goal) goalButtons[mins].classList.add('active');
      else goalButtons[mins].classList.remove('active');
    });
    if (goal % 60 === 0 && goal >= 60 && goal <= 240) {
      goalInput.value = String(goal / 60);
    } else {
      goalInput.value = '';
    }

    // Tâches du jour.
    var tasks = SF.activities.getByDate(today);
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    taskCountEl.textContent = "Tâches terminées aujourd'hui : " + done + '/' + tasks.length;

    clear(taskListEl);
    if (tasks.length === 0) {
      taskListEl.appendChild(el('p', { class: 'muted-text', text: "Aucune tâche pour aujourd'hui." }));
    } else {
      var pending = tasks.filter(function (t) { return t.status !== 'done'; }).slice(0, 3);
      pending.forEach(function (t) {
        var item = el('div', { class: 'task-item' });
        var cb = el('input', { type: 'checkbox', id: 'tk-' + t.id, 'aria-label': 'Terminer : ' + t.title });
        cb.addEventListener('change', function () {
          SF.activities.complete(t.id);
        });
        var label = el('label', { for: 'tk-' + t.id, text: t.title });
        item.appendChild(cb);
        item.appendChild(label);
        taskListEl.appendChild(item);
      });
    }
  }

  function renderStats(stats) {
    var totalEl = root.querySelector('.stat-total .stat-value');
    var sessEl = root.querySelector('.stat-sessions .stat-value');
    var avgEl = root.querySelector('.stat-avg .stat-value');
    var streakEl = root.querySelector('.stat-streak .stat-value');

    // Heures totales (1 décimale).
    var hours = (stats.totalMinutes || 0) / 60;
    totalEl.textContent = hours.toFixed(1).replace('.', ',') + ' h';
    sessEl.textContent = String(stats.sessionsCount || 0);
    avgEl.textContent = SF.app.formatMinutes(stats.avgMinutesPerDay || 0);

    // Série + flamme.
    clear(streakEl);
    streakEl.appendChild(document.createTextNode(String(stats.streakDays || 0) + ' j'));
    streakEl.appendChild(el('span', { class: 'stat-flame', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.5 3 3 4.5 3 7a3 3 0 0 1-6 0c0-1 .5-2 1-2.5C9 8 8 9 8 11a4 4 0 0 0 8 0c0-3-2-5-4-9z"/></svg>' }));
  }

  function renderRecent() {
    clear(recentListEl);
    var sessions = SF.sessions.getRecent(5);
    if (sessions.length === 0) {
      var p = el('p', { class: 'muted-text', text: "Aucune session pour l'instant. Ajoute ta première séance d'étude." });
      recentListEl.appendChild(p);
      return;
    }
    sessions.forEach(function (s) {
      var item = el('div', { class: 'recent-item' });
      var dot = el('span', { class: 'dot' });
      dot.style.background = SF.app.subjectColor(s.subject);
      item.appendChild(dot);
      item.appendChild(el('span', { class: 'recent-subject', text: s.subject }));
      item.appendChild(el('span', { class: 'recent-time', text: SF.app.relativeTime(s.createdAt) }));
      item.appendChild(el('span', { class: 'recent-duration', text: SF.app.formatMinutes(s.minutes) }));
      recentListEl.appendChild(item);
    });
  }

  function renderMonth() {
    monthTitleEl.textContent = cap(MONTHS[viewedMonth]) + ' ' + viewedYear;

    var first = new Date(viewedYear, viewedMonth, 1);
    var firstWeekday = (first.getDay() + 6) % 7; // 0 = lundi
    var daysInMonth = new Date(viewedYear, viewedMonth + 1, 0).getDate();
    var daysInPrev = new Date(viewedYear, viewedMonth, 0).getDate();

    // Totaux du mois affiché.
    var startISO = SF.dates.toISO(first);
    var endISO = SF.dates.toISO(new Date(viewedYear, viewedMonth + 1, 0));
    var totals = SF.sessions.getDayTotals(startISO, endISO);
    var map = {};
    totals.forEach(function (t) { map[t.date] = t.minutes; });

    var today = SF.dates.todayISO();

    clear(monthGridEl);

    // Jours du mois précédent (grisés).
    for (var i = firstWeekday - 1; i >= 0; i--) {
      var out = el('div', { class: 'day-out', text: String(daysInPrev - i) });
      monthGridEl.appendChild(out);
    }

    // Jours du mois courant.
    for (var d = 1; d <= daysInMonth; d++) {
      var dateObj = new Date(viewedYear, viewedMonth, d);
      var iso = SF.dates.toISO(dateObj);
      var mins = map[iso] || 0;
      var lvl = heatLevel(mins);

      var label = d + ' ' + MONTHS[viewedMonth] + ' ' + viewedYear;
      if (mins > 0) label += ', ' + SF.app.formatMinutes(mins) + ' d\'étude';
      else label += ', pas d\'étude';

      var btn = el('button', {
        class: 'day day-' + lvl,
        type: 'button',
        'aria-label': label,
        'data-iso': iso,
        text: String(d)
      });

      if (iso === today) btn.classList.add('day-today');
      if (iso === selectedISO) btn.classList.add('day-selected');

      btn.addEventListener('click', function (isoVal) {
        return function () { selectDay(isoVal); };
      }(iso));

      monthGridEl.appendChild(btn);
    }

    // Jours du mois suivant (grisés) pour compléter la grille.
    var totalCells = firstWeekday + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var j = 1; j <= trailing; j++) {
      monthGridEl.appendChild(el('div', { class: 'day-out', text: String(j) }));
    }

    renderSelectedDay();
  }

  function selectDay(iso) {
    selectedISO = iso;
    renderMonth();
  }

  function renderSelectedDay() {
    selectedDateEl.textContent = cap(SF.dates.formatFR(selectedISO));

    // Temps d'etude total ce jour.
    var sessions = SF.sessions.getByDate(selectedISO);
    var totalMin = 0;
    sessions.forEach(function (s) { totalMin += s.minutes; });
    selectedTimeEl.textContent = "Temps d'étude total : " + SF.app.formatMinutes(totalMin);

    // Tâches terminées ce jour.
    var tasks = SF.activities.getByDate(selectedISO);
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    selectedTasksEl.textContent = 'Tâches terminées : ' + done + '/' + tasks.length;
  }

  function renderWeek(today) {
    clear(weekGridEl);
    var monday = SF.dates.startOfWeek(today);
    var goal = (SF.storage.getSettings().dailyGoalMinutes) || 120;

    for (var i = 0; i < 7; i++) {
      var iso = SF.dates.addDays(monday, i);
      var sessions = SF.sessions.getByDate(iso);
      var mins = 0;
      sessions.forEach(function (s) { mins += s.minutes; });

      var tasks = SF.activities.getByDate(iso);
      var done = tasks.filter(function (t) { return t.status === 'done'; }).length;

      var isToday = (iso === today);
      var cls = 'week-day' + (isToday ? ' today' : '');

      var box = el('div', { class: cls });
      box.appendChild(el('div', { class: 'week-day-name', text: WEEKDAYS[i] }));
      box.appendChild(el('div', { class: 'week-day-time', text: SF.app.formatMinutes(mins) }));
      box.appendChild(el('div', { class: 'week-day-tasks', text: done + '/' + tasks.length + ' tâches' }));

      // Mini-barre proportionnelle au temps (max = objectif).
      var barWrap = el('div', { class: 'week-bar-wrap' });
      var bar = el('div', { class: 'week-bar' });
      var h = Math.min(100, (mins / goal) * 100);
      bar.style.height = h + '%';
      barWrap.appendChild(bar);
      box.appendChild(barWrap);

      weekGridEl.appendChild(box);
    }
  }

  // ----- API de la vue --------------------------------------------------

  function onShow() {
    render();
  }

  SF.app.registerView('home', { mount: mount, onShow: onShow });
})();
