/* =========================================================
   StudyFlow — Vue « Agenda »
   Jour / Semaine / Mois.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Libellés français.
  var WD_ABBR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  var WD_FULL = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var TYPE_LABELS = { homework: 'Devoir', exam: 'Examen', revision: 'Révision', project: 'Projet' };

  // Couleurs par type.
  var TYPE_COLOR = {
    course: 'var(--info)',
    exam: 'var(--danger)',
    homework: 'var(--warn)',
    revision: 'var(--ok)',
    project: 'var(--accent)'
  };

  // État interne.
  var mode = 'week';       // 'day' | 'week' | 'month'
  var cursor = null;       // date ISO au centre de la période affichée.

  // Références DOM.
  var root = null;
  var segDayBtn = null, segWeekBtn = null, segMonthBtn = null;
  var titleEl = null;
  var dayViewEl = null, weekViewEl = null, monthViewEl = null;
  var freeSlotsCbx = null;

  // ----- Petits utilitaires ---------------------------------------------

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Heure « HH:MM » -> minutes depuis minuit.
  function toMin(hhmm) { return SF.dates.timeToMinutes(hhmm); }

  // Minutes depuis minuit -> « HH h MM ».
  function minToLabel(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return h + ' h ' + (mm < 10 ? '0' + mm : mm);
  }

  // Arrondit des minutes au quart d'heure le plus proche.
  function roundToQuarter(m) { return Math.round(m / 15) * 15; }

  // ----- Montage (une seule fois) ---------------------------------------

  function mount(container) {
    root = container;
    root.innerHTML = '';

    root.appendChild(buildToolbar());

    dayViewEl = el('div', { class: 'agenda-view agenda-day-view' });
    weekViewEl = el('div', { class: 'agenda-view agenda-week-view' });
    monthViewEl = el('div', { class: 'agenda-view agenda-month-view' });
    root.appendChild(dayViewEl);
    root.appendChild(weekViewEl);
    root.appendChild(monthViewEl);

    // État initial.
    cursor = SF.dates.todayISO();
    // Vue par défaut : Semaine sur grand écran, Jour sous 700 px.
    if (window.matchMedia && window.matchMedia('(max-width: 699px)').matches) {
      mode = 'day';
    } else {
      mode = 'week';
    }

    SF.events.on('data:changed', render);
  }

  // --- Barre d'outils ---

  function buildToolbar() {
    var card = el('div', { class: 'card agenda-toolbar' });

    // Ligne 1 : navigation + titre.
    var navRow = el('div', { class: 'agenda-nav' });

    var prevBtn = el('button', { class: 'btn btn-ghost agenda-nav-btn', type: 'button', 'aria-label': 'Période précédente' }, '‹');
    prevBtn.addEventListener('click', function () { shiftPeriod(-1); });

    var todayBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, "Aujourd'hui");
    todayBtn.addEventListener('click', function () {
      cursor = SF.dates.todayISO();
      render();
    });

    var nextBtn = el('button', { class: 'btn btn-ghost agenda-nav-btn', type: 'button', 'aria-label': 'Période suivante' }, '›');
    nextBtn.addEventListener('click', function () { shiftPeriod(1); });

    titleEl = el('div', { class: 'agenda-period-title', text: '' });

    navRow.appendChild(prevBtn);
    navRow.appendChild(todayBtn);
    navRow.appendChild(nextBtn);
    navRow.appendChild(titleEl);
    card.appendChild(navRow);

    // Ligne 2 : sélecteur segmenté + actions.
    var actionsRow = el('div', { class: 'agenda-actions' });

    var seg = el('div', { class: 'agenda-segmented', role: 'group', 'aria-label': "Mode d'affichage" });
    segDayBtn = el('button', { class: 'btn agenda-seg', type: 'button', 'aria-pressed': 'false' }, 'Jour');
    segWeekBtn = el('button', { class: 'btn agenda-seg', type: 'button', 'aria-pressed': 'false' }, 'Semaine');
    segMonthBtn = el('button', { class: 'btn agenda-seg', type: 'button', 'aria-pressed': 'false' }, 'Mois');
    segDayBtn.addEventListener('click', function () { setMode('day'); });
    segWeekBtn.addEventListener('click', function () { setMode('week'); });
    segMonthBtn.addEventListener('click', function () { setMode('month'); });
    seg.appendChild(segDayBtn);
    seg.appendChild(segWeekBtn);
    seg.appendChild(segMonthBtn);
    actionsRow.appendChild(seg);

    var actAdd = el('button', { class: 'btn btn-primary', type: 'button' }, '+ Activité');
    actAdd.addEventListener('click', function () {
      openActivityForm({ date: cursor });
    });
    actionsRow.appendChild(actAdd);

    var courseAdd = el('button', { class: 'btn btn-ghost', type: 'button' }, '+ Cours');
    courseAdd.addEventListener('click', function () {
      openCourseForm({ date: cursor });
    });
    actionsRow.appendChild(courseAdd);

    // Le bouton s'active dès que le module d'import (Lot 4 : js/importer-ui.js) est chargé.
    var importReady = !!(SF.importerUI && typeof SF.importerUI.open === 'function');
    var importBtn = el('button', { class: 'btn btn-ghost', type: 'button', title: importReady ? 'Importer une capture, une photo ou un PDF' : 'Bientôt' }, 'Importer un emploi du temps');
    if (!importReady) importBtn.disabled = true;
    importBtn.addEventListener('click', function () {
      if (SF.importerUI && typeof SF.importerUI.open === 'function') SF.importerUI.open();
    });
    actionsRow.appendChild(importBtn);

    card.appendChild(actionsRow);

    // Case à cocher « créneaux libres » (vue jour).
    var freeRow = el('div', { class: 'agenda-free-row' });
    freeSlotsCbx = el('input', { type: 'checkbox', id: 'agenda-free-slots' });
    freeSlotsCbx.addEventListener('change', render);
    freeRow.appendChild(el('label', { for: 'agenda-free-slots', text: 'Afficher les créneaux libres' }));
    freeRow.insertBefore(freeSlotsCbx, freeRow.firstChild);
    card.appendChild(freeRow);

    return card;
  }

  function setMode(m) {
    mode = m;
    render();
  }

  function shiftPeriod(delta) {
    if (mode === 'day') cursor = SF.dates.addDays(cursor, delta);
    else if (mode === 'week') cursor = SF.dates.addDays(cursor, delta * 7);
    else {
      var d = SF.dates.fromISO(cursor);
      var nm = d.getMonth() + delta;
      var ny = d.getFullYear();
      while (nm < 0) { nm += 12; ny--; }
      while (nm > 11) { nm -= 12; ny++; }
      var nd = Math.min(d.getDate(), 28);
      cursor = SF.dates.toISO(new Date(ny, nm, nd));
    }
    render();
  }

  // ----- Rendu principal ------------------------------------------------

  function render() {
    if (!root) return;

    // Met à jour les boutons du sélecteur segmenté.
    segDayBtn.setAttribute('aria-pressed', String(mode === 'day'));
    segWeekBtn.setAttribute('aria-pressed', String(mode === 'week'));
    segMonthBtn.setAttribute('aria-pressed', String(mode === 'month'));
    [segDayBtn, segWeekBtn, segMonthBtn].forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('aria-pressed') === 'true');
    });

    // Affiche le bon conteneur.
    dayViewEl.style.display = mode === 'day' ? '' : 'none';
    weekViewEl.style.display = mode === 'week' ? '' : 'none';
    monthViewEl.style.display = mode === 'month' ? '' : 'none';

    // Titre de la période.
    titleEl.textContent = periodTitle();

    // État vide global.
    var hasData = SF.timetable.getAll().length > 0 || SF.activities.getAll().length > 0;

    if (mode === 'day') renderDay(hasData);
    else if (mode === 'week') renderWeek(hasData);
    else renderMonth(hasData);
  }

  function periodTitle() {
    if (mode === 'day') {
      return cap(SF.dates.formatFR(cursor));
    }
    if (mode === 'week') {
      var start = SF.dates.startOfWeek(cursor);
      var end = SF.dates.addDays(start, 6);
      var sd = SF.dates.fromISO(start), ed = SF.dates.fromISO(end);
      var sDay = sd.getDate(), eDay = ed.getDate();
      var sMonth = MONTHS[sd.getMonth()], eMonth = MONTHS[ed.getMonth()];
      if (sd.getMonth() === ed.getMonth()) {
        return sDay + ' – ' + eDay + ' ' + sMonth + ' ' + sd.getFullYear();
      }
      return sDay + ' ' + sMonth + ' – ' + eDay + ' ' + eMonth + ' ' + ed.getFullYear();
    }
    var d = SF.dates.fromISO(cursor);
    return cap(MONTHS[d.getMonth()]) + ' ' + d.getFullYear();
  }

  // ----- Données d'une période ------------------------------------------

  // Renvoie { start, end } en ISO pour la période courante.
  function periodRange() {
    if (mode === 'day') return { start: cursor, end: cursor };
    if (mode === 'week') {
      var s = SF.dates.startOfWeek(cursor);
      return { start: s, end: SF.dates.addDays(s, 6) };
    }
    var d = SF.dates.fromISO(cursor);
    var first = new Date(d.getFullYear(), d.getMonth(), 1);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: SF.dates.toISO(first), end: SF.dates.toISO(last) };
  }

  // Rassemble les blocs d'un jour : occurrences de cours + activités.
  // Chaque bloc : { kind, id, title, subject, start, end, minutes, color, data, allDay, overdue, done }.
  function blocksForDay(iso) {
    var blocks = [];
    var now = new Date();

    // Cours.
    SF.timetable.getForDate(iso).forEach(function (occ) {
      blocks.push({
        kind: 'course',
        id: occ.courseId,
        title: occ.subject,
        subject: occ.subject,
        start: toMin(occ.startTime),
        end: toMin(occ.endTime),
        minutes: toMin(occ.endTime) - toMin(occ.startTime),
        color: TYPE_COLOR.course,
        room: occ.room,
        data: occ
      });
    });

    // Activités.
    SF.activities.getByDate(iso).forEach(function (a) {
      var display = SF.activities.getDisplayStatus(a, now);
      if (a.time) {
        var start = toMin(a.time);
        var dur = a.estimatedMinutes || 60;
        blocks.push({
          kind: 'activity',
          id: a.id,
          title: a.title,
          subject: a.subject,
          start: start,
          end: start + dur,
          minutes: dur,
          color: TYPE_COLOR[a.type] || 'var(--accent)',
          data: a,
          overdue: display === 'overdue',
          done: a.status === 'done'
        });
      } else {
        blocks.push({
          kind: 'activity',
          id: a.id,
          title: a.title,
          subject: a.subject,
          start: null,
          end: null,
          minutes: 0,
          color: TYPE_COLOR[a.type] || 'var(--accent)',
          data: a,
          allDay: true,
          overdue: display === 'overdue',
          done: a.status === 'done'
        });
      }
    });

    return blocks;
  }

  // ----- Vue Jour -------------------------------------------------------

  function renderDay(hasData) {
    clear(dayViewEl);
    if (!hasData) {
      dayViewEl.appendChild(emptyState());
      return;
    }

    var settings = SF.storage.getSettings();
    var dayStart = toMin(settings.dayStart || '08:00');
    var dayEnd = toMin(settings.dayEnd || '20:00');
    // dayStart et dayEnd sont en MINUTES : on compte ici des heures entières (une ligne par heure).
    var hours = Math.ceil((dayEnd - dayStart) / 60);
    if (hours <= 0) hours = 12;

    var blocks = blocksForDay(cursor);
    var timed = blocks.filter(function (b) { return !b.allDay; });
    var allDay = blocks.filter(function (b) { return b.allDay; });

    // Ligne « Toute la journée ».
    dayViewEl.appendChild(buildAllDayRow(allDay, 1));

    // Grille horaire.
    var gridWrap = el('div', { class: 'agenda-time-grid-wrap' });
    var grid = el('div', { class: 'agenda-time-grid', 'data-mode': 'day' });

    // Colonne des heures.
    var hourCol = el('div', { class: 'agenda-hour-col' });
    for (var h = 0; h < hours; h++) {
      var hm = dayStart + h * 60;
      var label = minToLabel(hm);
      var cell = el('div', { class: 'agenda-hour-cell' });
      cell.appendChild(el('span', { class: 'agenda-hour-label', text: label }));
      hourCol.appendChild(cell);
    }
    grid.appendChild(hourCol);

    // Colonne du jour.
    var dayCol = el('div', { class: 'agenda-day-col', 'data-iso': cursor });
    // Lignes d'heure (cliquables).
    for (var hh = 0; hh < hours; hh++) {
      var line = el('div', { class: 'agenda-hour-line', 'data-min': String(dayStart + hh * 60) });
      dayCol.appendChild(line);
    }

    // Créneaux libres.
    if (freeSlotsCbx.checked) {
      var slots = [];
      try { slots = SF.planner.getFreeSlots(cursor) || []; } catch (e) { slots = []; }
      slots.forEach(function (s) {
        var sMin = toMin(s.start);
        var eMin = toMin(s.end);
        var top = ((sMin - dayStart) / 60) * 60;
        var hgt = ((eMin - sMin) / 60) * 60;
        var fs = el('div', { class: 'agenda-free-slot', 'aria-hidden': 'true' });
        fs.style.top = top + 'px';
        fs.style.height = hgt + 'px';
        dayCol.appendChild(fs);
      });
    }

    // Blocs (chevauchements côte à côte).
    placeTimedBlocks(timed, dayCol, dayStart);

    // Ligne « maintenant ».
    var todayISO = SF.dates.todayISO();
    if (cursor === todayISO) {
      var nowMin = currentMinutes();
      if (nowMin >= dayStart && nowMin <= dayEnd) {
        var nowLine = el('div', { class: 'agenda-now-line', 'aria-hidden': 'true' });
        nowLine.style.top = ((nowMin - dayStart) / 60) * 60 + 'px';
        dayCol.appendChild(nowLine);
      }
    }

    // Clic sur une zone vide.
    dayCol.addEventListener('click', function (e) {
      if (e.target !== dayCol && !e.target.classList.contains('agenda-hour-line')) return;
      var rect = dayCol.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var clickedMin = dayStart + y; // une heure = 60 px, donc 1 px = 1 minute
      var rounded = roundToQuarter(clickedMin);
      if (rounded < dayStart) rounded = dayStart;
      if (rounded > dayEnd) return;
      openActivityForm({ date: cursor, time: SF.dates.minutesToTime(rounded) });
    });

    grid.appendChild(dayCol);
    gridWrap.appendChild(grid);
    dayViewEl.appendChild(gridWrap);
  }

  // Positionne les blocs horaires dans une colonne (chevauchements côte à côte).
  function placeTimedBlocks(blocks, col, dayStart) {
    if (!blocks.length) return;
    // Trie par début.
    var sorted = blocks.slice().sort(function (a, b) { return a.start - b.start; });

    // Calcule les « colonnes » de chevauchement.
    var placed = []; // { block, col, cols }
    var lanes = [];   // fin actuelle de chaque lane (en minutes).

    sorted.forEach(function (b) {
      var lane = -1;
      for (var i = 0; i < lanes.length; i++) {
        if (lanes[i] <= b.start) { lane = i; break; }
      }
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = b.end;
      placed.push({ block: b, lane: lane });
    });

    // Calcule le nombre total de lanes qui se chevauchent pour chaque groupe.
    // Approche simple : largeur = 100 / nombre de lanes simultanées au maximum local.
    // On regroupe les blocs en clusters de chevauchement.
    var clusters = clusterBlocks(placed);

    clusters.forEach(function (cluster) {
      var maxLane = 0;
      cluster.forEach(function (p) { if (p.lane > maxLane) maxLane = p.lane; });
      var totalLanes = maxLane + 1;
      cluster.forEach(function (p) {
        var b = p.block;
        var top = ((b.start - dayStart) / 60) * 60;
        var hgt = Math.max(20, ((b.end - b.start) / 60) * 60);
        var widthPct = (100 / totalLanes);
        var leftPct = p.lane * widthPct;
        var btn = buildBlockButton(b);
        btn.style.position = 'absolute';
        btn.style.top = top + 'px';
        btn.style.height = hgt + 'px';
        btn.style.left = 'calc(' + leftPct + '% + 4px)';
        btn.style.width = 'calc(' + widthPct + '% - 8px)';
        col.appendChild(btn);
      });
    });
  }

  // Regroupe les blocs placés en clusters de chevauchement.
  function clusterBlocks(placed) {
    var clusters = [];
    var current = [];
    var currentEnd = -1;
    placed.forEach(function (p) {
      if (p.block.start >= currentEnd && current.length) {
        clusters.push(current);
        current = [];
        currentEnd = -1;
      }
      current.push(p);
      if (p.block.end > currentEnd) currentEnd = p.block.end;
    });
    if (current.length) clusters.push(current);
    return clusters;
  }

  function currentMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  // ----- Vue Semaine ----------------------------------------------------

  function renderWeek(hasData) {
    clear(weekViewEl);
    if (!hasData) {
      weekViewEl.appendChild(emptyState());
      return;
    }

    var settings = SF.storage.getSettings();
    var dayStart = toMin(settings.dayStart || '08:00');
    var dayEnd = toMin(settings.dayEnd || '20:00');
    // dayStart et dayEnd sont en MINUTES : on compte ici des heures entières (une ligne par heure).
    var hours = Math.ceil((dayEnd - dayStart) / 60);
    if (hours <= 0) hours = 12;

    var start = SF.dates.startOfWeek(cursor);
    var todayISO = SF.dates.todayISO();
    var days = [];
    for (var i = 0; i < 7; i++) days.push(SF.dates.addDays(start, i));

    // Blocs par jour.
    var dayBlocks = days.map(function (iso) { return blocksForDay(iso); });

    // Ligne « Toute la journée ».
    var allDayRow = el('div', { class: 'agenda-allday-row' });
    allDayRow.appendChild(el('div', { class: 'agenda-allday-spacer' }));
    days.forEach(function (iso, i) {
      var cell = el('div', { class: 'agenda-allday-cell' });
      var ads = dayBlocks[i].filter(function (b) { return b.allDay; });
      ads.forEach(function (b) {
        cell.appendChild(buildAllDayChip(b));
      });
      allDayRow.appendChild(cell);
    });
    weekViewEl.appendChild(allDayRow);

    // En-têtes des jours.
    var headerRow = el('div', { class: 'agenda-week-header' });
    headerRow.appendChild(el('div', { class: 'agenda-hour-spacer' }));
    days.forEach(function (iso) {
      var d = SF.dates.fromISO(iso);
      var isToday = iso === todayISO;
      var cls = 'agenda-week-head' + (isToday ? ' today' : '');
      var head = el('div', { class: cls });
      head.appendChild(el('span', { class: 'agenda-wd-abbr', text: WD_ABBR[SF.dates.isoWeekday(iso) - 1] }));
      head.appendChild(el('span', { class: 'agenda-wd-num', text: String(d.getDate()) }));
      headerRow.appendChild(head);
    });
    weekViewEl.appendChild(headerRow);

    // Grille.
    var gridWrap = el('div', { class: 'agenda-time-grid-wrap agenda-week-scroll' });
    var grid = el('div', { class: 'agenda-time-grid', 'data-mode': 'week' });

    // Colonne des heures.
    var hourCol = el('div', { class: 'agenda-hour-col' });
    for (var h = 0; h < hours; h++) {
      var hm = dayStart + h * 60;
      var cell = el('div', { class: 'agenda-hour-cell' });
      cell.appendChild(el('span', { class: 'agenda-hour-label', text: minToLabel(hm) }));
      hourCol.appendChild(cell);
    }
    grid.appendChild(hourCol);

    // Colonnes des jours.
    days.forEach(function (iso, i) {
      var isToday = iso === todayISO;
      var col = el('div', { class: 'agenda-day-col' + (isToday ? ' today' : ''), 'data-iso': iso });
      for (var hh = 0; hh < hours; hh++) {
        col.appendChild(el('div', { class: 'agenda-hour-line', 'data-min': String(dayStart + hh * 60) }));
      }
      var timed = dayBlocks[i].filter(function (b) { return !b.allDay; });
      placeTimedBlocks(timed, col, dayStart);

      // Ligne maintenant.
      if (isToday) {
        var nowMin = currentMinutes();
        if (nowMin >= dayStart && nowMin <= dayEnd) {
          var nowLine = el('div', { class: 'agenda-now-line', 'aria-hidden': 'true' });
          nowLine.style.top = ((nowMin - dayStart) / 60) * 60 + 'px';
          col.appendChild(nowLine);
        }
      }

      grid.appendChild(col);
    });

    gridWrap.appendChild(grid);
    weekViewEl.appendChild(gridWrap);
  }

  // Ligne « Toute la journée » pour la vue jour.
  function buildAllDayRow(allDayBlocks, dummyCols) {
    var row = el('div', { class: 'agenda-allday-row' });
    row.appendChild(el('div', { class: 'agenda-allday-spacer', text: 'Journée' }));
    var cell = el('div', { class: 'agenda-allday-cell' });
    if (allDayBlocks.length === 0) {
      cell.appendChild(el('span', { class: 'agenda-allday-empty muted-text', text: 'Aucune activité toute la journée' }));
    } else {
      allDayBlocks.forEach(function (b) { cell.appendChild(buildAllDayChip(b)); });
    }
    row.appendChild(cell);
    return row;
  }

  function buildAllDayChip(block) {
    var chip = el('button', {
      class: 'agenda-allday-chip' + (block.done ? ' done' : '') + (block.overdue ? ' overdue' : ''),
      type: 'button'
    });
    chip.style.borderLeftColor = block.color;
    chip.setAttribute('aria-label', blockAriaLabel(block));
    chip.appendChild(el('span', { class: 'agenda-chip-title', text: block.title }));
    chip.addEventListener('click', function () { openBlockForm(block); });
    return chip;
  }

  // ----- Vue Mois -------------------------------------------------------

  function renderMonth(hasData) {
    clear(monthViewEl);
    if (!hasData) {
      monthViewEl.appendChild(emptyState());
      return;
    }

    var d = SF.dates.fromISO(cursor);
    var year = d.getFullYear(), month = d.getMonth();
    var first = new Date(year, month, 1);
    var firstWD = (first.getDay() + 6) % 7; // 0 = lundi
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayISO = SF.dates.todayISO();

    // En-têtes des jours.
    var wdRow = el('div', { class: 'agenda-month-wd-row' });
    WD_ABBR.forEach(function (w) { wdRow.appendChild(el('div', { class: 'agenda-month-wd', text: w })); });
    monthViewEl.appendChild(wdRow);

    var grid = el('div', { class: 'agenda-month-grid' });

    // Jours du mois précédent (grisés).
    var prevDays = new Date(year, month, 0).getDate();
    for (var p = firstWD - 1; p >= 0; p--) {
      grid.appendChild(buildMonthCell(null, prevDays - p, false));
    }

    // Jours du mois.
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = SF.dates.toISO(new Date(year, month, day));
      var cell = buildMonthCell(iso, day, iso === todayISO);
      var blocks = blocksForDay(iso);
      var tags = el('div', { class: 'agenda-month-tags' });
      var shown = blocks.slice(0, 3);
      shown.forEach(function (b) {
        var tag = el('div', { class: 'agenda-month-tag' });
        tag.style.borderLeftColor = b.color;
        if (b.done) tag.classList.add('done');
        if (b.overdue) tag.classList.add('overdue');
        tag.appendChild(el('span', { text: b.title }));
        tags.appendChild(tag);
      });
      if (blocks.length > 3) {
        tags.appendChild(el('div', { class: 'agenda-month-more', text: '+' + (blocks.length - 3) }));
      }
      cell.appendChild(tags);
      grid.appendChild(cell);
    }

    // Jours du mois suivant (grisés).
    var total = firstWD + daysInMonth;
    var trailing = (7 - (total % 7)) % 7;
    for (var t = 1; t <= trailing; t++) {
      grid.appendChild(buildMonthCell(null, t, false));
    }

    monthViewEl.appendChild(grid);
  }

  function buildMonthCell(iso, dayNum, isToday) {
    var cls = 'agenda-month-cell';
    if (!iso) cls += ' out';
    if (isToday) cls += ' today';
    var cell = el('div', { class: cls });
    cell.appendChild(el('div', { class: 'agenda-month-num', text: String(dayNum) }));
    if (iso) {
      cell.setAttribute('data-iso', iso);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', cap(SF.dates.formatFR(iso)));
      cell.addEventListener('click', function () {
        cursor = iso;
        setMode('day');
      });
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cursor = iso;
          setMode('day');
        }
      });
    }
    return cell;
  }

  // ----- Un bloc horaire (button) ---------------------------------------

  function buildBlockButton(block) {
    var cls = 'agenda-block';
    if (block.kind === 'course') cls += ' agenda-block-course';
    if (block.done) cls += ' done';
    if (block.overdue) cls += ' overdue';

    var btn = el('button', { class: cls, type: 'button' });
    btn.style.borderLeftColor = block.color;
    btn.style.background = blockColorBg(block.color);
    btn.setAttribute('aria-label', blockAriaLabel(block));

    btn.appendChild(el('span', { class: 'agenda-block-time', text: minToLabel(block.start) + ' – ' + minToLabel(block.end) }));
    var titleNode = el('span', { class: 'agenda-block-title', text: block.title });
    if (block.done) titleNode.classList.add('done-title');
    btn.appendChild(titleNode);
    if (block.kind === 'course' && block.room) {
      btn.appendChild(el('span', { class: 'agenda-block-room', text: block.room }));
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openBlockForm(block);
    });

    return btn;
  }

  // Couleur de fond semi-transparente à partir d'une couleur CSS.
  function blockColorBg(color) {
    // On utilise une teinte légère : on ne peut pas convertir var(--x) en rgba,
    // donc on superpose un overlay via background avec opacity via CSS.
    return ''; // la classe gère le fond ; la bordure gauche porte la couleur.
  }

  function blockAriaLabel(block) {
    if (block.kind === 'course') {
      var parts = ['Cours de ' + block.subject];
      if (block.data && block.data.date) {
        var wd = WD_FULL[SF.dates.isoWeekday(block.data.date) - 1];
        parts.push(wd);
      }
      parts.push('de ' + minToLabel(block.start) + ' à ' + minToLabel(block.end));
      if (block.room) parts.push('salle ' + block.room);
      return parts.join(', ');
    }
    // Activité.
    var label = (TYPE_LABELS[block.data.type] || 'Activité') + ' : ' + block.title;
    if (block.allDay) return label + ' (toute la journée)';
    return label + ', de ' + minToLabel(block.start) + ' à ' + minToLabel(block.end);
  }

  // ----- Ouverture des formulaires --------------------------------------

  function openBlockForm(block) {
    if (block.kind === 'course') {
      openCourseForm({ courseId: block.id });
    } else {
      openActivityForm({ activityId: block.id });
    }
  }

  function openActivityForm(opts) {
    if (!SF.forms || !SF.forms.openActivity) {
      SF.app.toast('Formulaire détaillé indisponible.', 'error');
      return;
    }
    var params = {};
    if (opts.activityId) {
      var a = SF.activities.getById(opts.activityId);
      if (a) params.activity = a;
    } else {
      params.defaults = { date: opts.date || cursor };
      if (opts.time) params.defaults.time = opts.time;
    }
    SF.forms.openActivity(params);
  }

  function openCourseForm(opts) {
    if (!SF.forms || !SF.forms.openCourse) {
      SF.app.toast('Formulaire détaillé indisponible.', 'error');
      return;
    }
    var params = {};
    if (opts.courseId) {
      var c = SF.timetable.getById(opts.courseId);
      if (c) params.course = c;
    } else {
      var wd = SF.dates.isoWeekday(opts.date || cursor);
      params.defaults = { weekday: wd };
    }
    SF.forms.openCourse(params);
  }

  // ----- État vide ------------------------------------------------------

  function emptyState() {
    var wrap = el('div', { class: 'empty agenda-empty' });
    wrap.appendChild(el('p', { text: 'Ton agenda est vide' }));
    var btnCourse = el('button', { class: 'btn btn-primary', type: 'button' }, 'Ajouter un cours');
    btnCourse.addEventListener('click', function () { openCourseForm({ date: cursor }); });
    var btnActivity = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Ajouter une activité');
    btnActivity.addEventListener('click', function () { openActivityForm({ date: cursor }); });
    wrap.appendChild(btnCourse);
    wrap.appendChild(btnActivity);
    return wrap;
  }

  // ----- API de la vue --------------------------------------------------

  function onShow() { render(); }

  SF.app.registerView('agenda', { mount: mount, onShow: onShow });
})();
