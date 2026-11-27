/* =========================================================
   StudyFlow — Vue « Tâches »
   To-do des activités : ajout rapide, onglets, filtres, tri.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Libellés français (si SF.constants.LABELS est absent).
  var TYPE_LABELS = { homework: 'Devoir', exam: 'Examen', revision: 'Révision', project: 'Projet' };
  var PRIORITY_LABELS = { low: 'Basse', medium: 'Moyenne', high: 'Haute' };
  var STATUS_LABELS = { pending: 'Non faite', done: 'Faite' };

  // Onglets, dans l'ordre.
  var TABS = [
    { id: 'today',    label: "Aujourd'hui" },
    { id: 'overdue',  label: 'En retard' },
    { id: 'upcoming', label: 'À venir' },
    { id: 'all',      label: 'Toutes' }
  ];

  // Références DOM.
  var root = null;
  var tabButtonsEl = null;
  var quickNameInput = null;
  var quickInfoInput = null;
  var quickSubjectInput = null;
  var quickSubjectDatalist = null;
  var quickErrorEl = null;
  var filtersToggleBtn = null;
  var filtersPanel = null;
  var fText = null, fSubject = null, fType = null, fPriority = null, fStatus = null;
  var fSortBy = null, fSortDir = null;
  var listEl = null;
  var countLineEl = null;
  var resultAnnounceEl = null;

  // État interne.
  var currentTab = 'today';
  var editingId = null;
  var filtersOpen = false;

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

  // Détecte le mot-clé « urgent » (sans tenir compte de la casse).
  function hasUrgentKeyword(text) {
    return String(text || '').toLowerCase().indexOf('urgent') !== -1;
  }

  // ----- Montage (une seule fois) ---------------------------------------

  function mount(container) {
    root = container;
    root.innerHTML = '';
    root.appendChild(el('h2', { class: 'card-title tasks-title', text: 'Tâches' }));

    // Onglets.
    tabButtonsEl = el('div', { class: 'tasks-tabs', role: 'tablist' });
    TABS.forEach(function (t) {
      var btn = el('button', {
        class: 'tasks-tab', role: 'tab', type: 'button',
        id: 'tasks-tab-' + t.id, 'aria-selected': 'false',
        'data-tab': t.id, text: t.label + ' (0)'
      });
      btn.addEventListener('click', function () { switchTab(t.id); });
      tabButtonsEl.appendChild(btn);
    });
    root.appendChild(tabButtonsEl);

    // Ajout rapide.
    root.appendChild(buildQuickAdd());

    // Filtres.
    root.appendChild(buildFilters());

    // Ligne de compteurs + résultats.
    countLineEl = el('div', { class: 'tasks-count', text: 'Total : 0 | Terminées : 0 | Restantes : 0' });
    root.appendChild(countLineEl);
    resultAnnounceEl = el('div', { class: 'sr-only', 'aria-live': 'polite' });
    root.appendChild(resultAnnounceEl);

    // Liste.
    listEl = el('div', { class: 'tasks-list' });
    root.appendChild(listEl);

    SF.events.on('data:changed', render);
  }

  // --- Ajout rapide ---

  function buildQuickAdd() {
    var card = el('div', { class: 'tasks-quick card' });

    quickErrorEl = el('div', { class: 'tasks-quick-error', role: 'alert' });
    card.appendChild(quickErrorEl);

    var row = el('div', { class: 'tasks-quick-row' });

    var nameField = el('div', { class: 'tasks-field' });
    nameField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-quick-name', text: 'Nom' }));
    quickNameInput = el('input', { class: 'tasks-input', id: 'tasks-quick-name', type: 'text', placeholder: 'Ex : Lire chapitre 5' });
    nameField.appendChild(quickNameInput);
    row.appendChild(nameField);

    var subjectField = el('div', { class: 'tasks-field' });
    subjectField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-quick-subject', text: 'Matière' }));
    quickSubjectDatalist = el('datalist', { id: 'tasks-dl-subjects' });
    quickSubjectInput = el('input', { class: 'tasks-input', id: 'tasks-quick-subject', type: 'text', list: 'tasks-dl-subjects', placeholder: 'Général' });
    subjectField.appendChild(quickSubjectInput);
    subjectField.appendChild(quickSubjectDatalist);
    row.appendChild(subjectField);

    var infoField = el('div', { class: 'tasks-field' });
    infoField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-quick-info', text: 'Information extra (facultatif)' }));
    quickInfoInput = el('input', { class: 'tasks-input', id: 'tasks-quick-info', type: 'text', placeholder: 'Détail complémentaire' });
    infoField.appendChild(quickInfoInput);
    row.appendChild(infoField);

    card.appendChild(row);

    var actions = el('div', { class: 'tasks-quick-actions' });
    var addBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Ajouter');
    addBtn.addEventListener('click', quickAdd);
    actions.appendChild(addBtn);

    var moreLink = el('button', { class: 'btn btn-ghost tasks-more-link', type: 'button' }, 'Plus d\u2019options');
    moreLink.addEventListener('click', openMoreOptions);
    actions.appendChild(moreLink);

    card.appendChild(actions);
    return card;
  }

  function quickAdd() {
    var name = quickNameInput.value.trim();
    var info = quickInfoInput.value.trim();
    var subject = quickSubjectInput.value.trim();

    if (!name) {
      quickErrorEl.textContent = 'Veuillez entrer une tâche.';
      quickNameInput.focus();
      return;
    }
    quickErrorEl.textContent = '';

    var urgent = hasUrgentKeyword(name) || hasUrgentKeyword(info);
    var today = SF.dates.todayISO();
    var date = today;
    if (currentTab === 'upcoming') date = SF.dates.addDays(today, 1);

    var data = {
      title: name,
      description: info,
      subject: subject || 'Général',
      type: 'homework',
      priority: urgent ? 'high' : 'medium',
      date: date
    };

    var res = SF.activities.add(data);
    if (res && res.ok) {
      quickNameInput.value = '';
      quickInfoInput.value = '';
      quickNameInput.focus();
      if (urgent) SF.app.toast('Tâche urgente ajoutée.', 'success');
    } else {
      SF.app.toast('Impossible d\u2019ajouter la tâche.', 'error');
    }
  }

  function openMoreOptions() {
    if (!SF.forms || !SF.forms.openActivity) {
      SF.app.toast('Formulaire détaillé indisponible.', 'error');
      return;
    }
    var name = quickNameInput.value.trim();
    var info = quickInfoInput.value.trim();
    var subject = quickSubjectInput.value.trim();
    var today = SF.dates.todayISO();
    var date = (currentTab === 'upcoming') ? SF.dates.addDays(today, 1) : today;
    var urgent = hasUrgentKeyword(name) || hasUrgentKeyword(info);

    SF.forms.openActivity({
      defaults: {
        title: name,
        description: info,
        subject: subject,
        type: 'homework',
        priority: urgent ? 'high' : 'medium',
        date: date
      },
      onDone: function () {
        quickNameInput.value = '';
        quickInfoInput.value = '';
      }
    });
  }

  // --- Filtres ---

  function buildFilters() {
    var wrap = el('div', { class: 'tasks-filters' });

    filtersToggleBtn = el('button', { class: 'btn btn-ghost tasks-filters-toggle', type: 'button', 'aria-expanded': 'false' }, 'Filtres');
    filtersToggleBtn.addEventListener('click', toggleFilters);
    wrap.appendChild(filtersToggleBtn);

    filtersPanel = el('div', { class: 'tasks-filters-panel' });

    var row1 = el('div', { class: 'tasks-filters-row' });

    var fTextField = el('div', { class: 'tasks-field' });
    fTextField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-text', text: 'Recherche' }));
    fText = el('input', { class: 'tasks-input', id: 'tasks-f-text', type: 'search', placeholder: 'Rechercher…' });
    fText.addEventListener('input', render);
    fTextField.appendChild(fText);
    row1.appendChild(fTextField);

    var fSubjectField = el('div', { class: 'tasks-field' });
    fSubjectField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-subject', text: 'Matière' }));
    fSubject = el('select', { class: 'tasks-select', id: 'tasks-f-subject' });
    fSubject.appendChild(el('option', { value: '', text: 'Toutes' }));
    fSubject.addEventListener('change', render);
    fSubjectField.appendChild(fSubject);
    row1.appendChild(fSubjectField);

    var fTypeField = el('div', { class: 'tasks-field' });
    fTypeField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-type', text: 'Type' }));
    fType = el('select', { class: 'tasks-select', id: 'tasks-f-type' });
    fType.appendChild(el('option', { value: '', text: 'Tous' }));
    ['homework', 'exam', 'revision', 'project'].forEach(function (t) {
      fType.appendChild(el('option', { value: t, text: TYPE_LABELS[t] }));
    });
    fType.addEventListener('change', render);
    fTypeField.appendChild(fType);
    row1.appendChild(fTypeField);

    filtersPanel.appendChild(row1);

    var row2 = el('div', { class: 'tasks-filters-row' });

    var fPriorityField = el('div', { class: 'tasks-field' });
    fPriorityField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-priority', text: 'Priorité' }));
    fPriority = el('select', { class: 'tasks-select', id: 'tasks-f-priority' });
    fPriority.appendChild(el('option', { value: '', text: 'Toutes' }));
    ['low', 'medium', 'high'].forEach(function (p) {
      fPriority.appendChild(el('option', { value: p, text: PRIORITY_LABELS[p] }));
    });
    fPriority.addEventListener('change', render);
    fPriorityField.appendChild(fPriority);
    row2.appendChild(fPriorityField);

    var fStatusField = el('div', { class: 'tasks-field' });
    fStatusField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-status', text: 'Statut' }));
    fStatus = el('select', { class: 'tasks-select', id: 'tasks-f-status' });
    fStatus.appendChild(el('option', { value: '', text: 'Tous' }));
    fStatus.appendChild(el('option', { value: 'pending', text: 'En attente' }));
    fStatus.appendChild(el('option', { value: 'done', text: 'Terminée' }));
    fStatus.appendChild(el('option', { value: 'overdue', text: 'En retard' }));
    fStatus.addEventListener('change', render);
    fStatusField.appendChild(fStatus);
    row2.appendChild(fStatusField);

    var fSortField = el('div', { class: 'tasks-field' });
    fSortField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-sortby', text: 'Trier par' }));
    fSortBy = el('select', { class: 'tasks-select', id: 'tasks-f-sortby' });
    fSortBy.appendChild(el('option', { value: 'date', text: 'Date' }));
    fSortBy.appendChild(el('option', { value: 'priority', text: 'Priorité' }));
    fSortBy.appendChild(el('option', { value: 'title', text: 'Titre' }));
    fSortBy.addEventListener('change', render);
    fSortField.appendChild(fSortBy);
    row2.appendChild(fSortField);

    var fDirField = el('div', { class: 'tasks-field' });
    fDirField.appendChild(el('label', { class: 'tasks-field-label', for: 'tasks-f-sortdir', text: 'Sens' }));
    fSortDir = el('select', { class: 'tasks-select', id: 'tasks-f-sortdir' });
    fSortDir.appendChild(el('option', { value: 'asc', text: 'Croissant' }));
    fSortDir.appendChild(el('option', { value: 'desc', text: 'Décroissant' }));
    fSortDir.addEventListener('change', render);
    fDirField.appendChild(fSortDir);
    row2.appendChild(fDirField);

    filtersPanel.appendChild(row2);

    var resetBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Réinitialiser');
    resetBtn.addEventListener('click', resetFilters);
    filtersPanel.appendChild(resetBtn);

    wrap.appendChild(filtersPanel);
    return wrap;
  }

  function toggleFilters() {
    filtersOpen = !filtersOpen;
    filtersPanel.classList.toggle('open', filtersOpen);
    filtersToggleBtn.setAttribute('aria-expanded', String(filtersOpen));
  }

  function resetFilters() {
    fText.value = '';
    fSubject.value = '';
    fType.value = '';
    fPriority.value = '';
    fStatus.value = '';
    fSortBy.value = 'date';
    fSortDir.value = 'asc';
    render();
  }

  function currentCriteria() {
    return {
      text: fText.value.trim(),
      subject: fSubject.value,
      type: fType.value,
      priority: fPriority.value,
      status: fStatus.value,
      fromDate: '',
      toDate: ''
    };
  }

  // --- Onglets ---

  function switchTab(id) {
    currentTab = id;
    render();
  }

  function updateTabButtons(counts) {
    var btns = tabButtonsEl.querySelectorAll('.tasks-tab');
    for (var i = 0; i < btns.length; i++) {
      var tabId = btns[i].getAttribute('data-tab');
      var label = tabLabelById(tabId);
      btns[i].textContent = label + ' (' + (counts[tabId] || 0) + ')';
      if (tabId === currentTab) {
        btns[i].setAttribute('aria-selected', 'true');
        btns[i].classList.add('active');
      } else {
        btns[i].setAttribute('aria-selected', 'false');
        btns[i].classList.remove('active');
      }
    }
  }

  function tabLabelById(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i].label;
    return id;
  }

  // ----- Sélection des données par onglet --------------------------------

  function activitiesForTab(tab, today) {
    if (tab === 'today') return SF.activities.getByDate(today);
    if (tab === 'overdue') return SF.activities.getOverdue();
    if (tab === 'upcoming') {
      var all = SF.activities.getAll().filter(function (a) {
        if (a.status === 'done') return false;
        if (SF.dates.diffDays(today, a.date) <= 0) return false;
        return true;
      });
      return SF.filters.sort(all, 'date', 'asc');
    }
    return SF.activities.getAll();
  }

  // ----- Rendu ----------------------------------------------------------

  function render() {
    if (!root) return;

    var today = SF.dates.todayISO();
    var now = new Date();

    // Compteurs par onglet.
    var counts = {
      today: SF.activities.getByDate(today).length,
      overdue: SF.activities.getOverdue().length,
      upcoming: activitiesForTab('upcoming', today).length,
      all: SF.activities.getAll().length
    };

    // Onglet par défaut : « En retard » s'il y en a et rien aujourd'hui.
    if (counts.today === 0 && counts.overdue > 0 && currentTab === 'today') {
      currentTab = 'overdue';
    }

    updateTabButtons(counts);

    // Alimente la datalist des matières.
    clear(quickSubjectDatalist);
    SF.filters.getSubjects().forEach(function (s) {
      quickSubjectDatalist.appendChild(el('option', { value: s }));
    });

    // Alimente le select des matières dans les filtres.
    var currentSubjectVal = fSubject.value;
    clear(fSubject);
    fSubject.appendChild(el('option', { value: '', text: 'Toutes' }));
    SF.filters.getSubjects().forEach(function (s) {
      var opt = el('option', { value: s, text: s });
      if (s === currentSubjectVal) opt.selected = true;
      fSubject.appendChild(opt);
    });

    // Liste de l'onglet courant.
    var list = activitiesForTab(currentTab, today);

    // Applique les filtres EN PLUS de l'onglet.
    var criteria = currentCriteria();
    var filtered = list.filter(function (a) { return SF.filters.matches(a, criteria); });

    // Tri (urgent d'abord, puis tri choisi).
    var by = fSortBy.value || 'date';
    var dir = fSortDir.value || 'asc';
    filtered = SF.filters.sort(filtered, by, dir);

    // Urgentes en premier, quel que soit le tri.
    filtered.sort(function (a, b) {
      var au = hasUrgentKeyword(a.title) || hasUrgentKeyword(a.description) ? 1 : 0;
      var bu = hasUrgentKeyword(b.title) || hasUrgentKeyword(b.description) ? 1 : 0;
      return bu - au;
    });

    // Compteurs de la liste affichée.
    var total = filtered.length;
    var done = filtered.filter(function (a) { return a.status === 'done'; }).length;
    var remaining = total - done;
    countLineEl.textContent = 'Total : ' + total + ' | Terminées : ' + done + ' | Restantes : ' + remaining;
    resultAnnounceEl.textContent = total + ' résultat' + (total > 1 ? 's' : '');

    renderList(filtered, today, now);
  }

  function renderList(list, today, now) {
    clear(listEl);

    if (SF.activities.getAll().length === 0) {
      listEl.appendChild(emptyState('Aucune activité.'));
      return;
    }

    if (list.length === 0) {
      // Soit l'onglet est vide, soit les filtres masquent tout.
      if (hasActiveFilters()) {
        var wrap = el('div', { class: 'tasks-empty' });
        wrap.appendChild(el('p', { class: 'muted-text', text: 'Aucun résultat pour ces filtres.' }));
        var btn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Réinitialiser');
        btn.addEventListener('click', resetFilters);
        wrap.appendChild(btn);
        listEl.appendChild(wrap);
      } else {
        listEl.appendChild(emptyState(emptyMessageForTab(currentTab)));
      }
      return;
    }

    // « Aujourd'hui » : deux groupes, À faire puis Terminées.
    if (currentTab === 'today') {
      var todo = list.filter(function (a) { return a.status !== 'done'; });
      var done = list.filter(function (a) { return a.status === 'done'; });
      if (todo.length) {
        listEl.appendChild(el('div', { class: 'tasks-group-title', text: 'À faire' }));
        todo.forEach(function (a) { listEl.appendChild(buildRow(a, today, now)); });
      }
      if (done.length) {
        listEl.appendChild(el('div', { class: 'tasks-group-title', text: 'Terminées' }));
        done.forEach(function (a) { listEl.appendChild(buildRow(a, today, now)); });
      }
    } else {
      list.forEach(function (a) { listEl.appendChild(buildRow(a, today, now)); });
    }
  }

  function emptyState(message) {
    var wrap = el('div', { class: 'tasks-empty' });
    wrap.appendChild(el('p', { class: 'muted-text', text: message }));
    return wrap;
  }

  function emptyMessageForTab(tab) {
    if (tab === 'today') return 'Rien de prévu aujourd\u2019hui.';
    if (tab === 'overdue') return 'Aucune tâche en retard, bravo.';
    if (tab === 'upcoming') return 'Rien à venir.';
    return 'Aucune activité.';
  }

  function hasActiveFilters() {
    return !!(fText.value || fSubject.value || fType.value || fPriority.value || fStatus.value);
  }

  // --- Une ligne de tâche ---

  function buildRow(activity, today, now) {
    var displayStatus = SF.activities.getDisplayStatus(activity, now);
    var isDone = activity.status === 'done';
    var isOverdue = displayStatus === 'overdue';
    var urgent = hasUrgentKeyword(activity.title) || hasUrgentKeyword(activity.description);

    var cls = 'tasks-row';
    if (isDone) cls += ' tasks-row-done';
    if (isOverdue && !isDone) cls += ' tasks-row-overdue';
    if (urgent) cls += ' tasks-row-urgent';

    var row = el('div', { class: cls, 'data-id': activity.id });

    // Étiquette URGENT.
    if (urgent) {
      row.appendChild(el('span', { class: 'tasks-urgent-tag', text: 'URGENT' }));
    }

    // Texte principal.
    var body = el('div', { class: 'tasks-row-body' });

    if (editingId === activity.id) {
      body.appendChild(buildInlineEdit(activity, row));
    } else {
      body.appendChild(buildRowText(activity, isDone));
    }

    row.appendChild(body);

    // Actions (sauf en mode édition).
    if (editingId !== activity.id) {
      row.appendChild(buildRowActions(activity, isDone));
    }

    return row;
  }

  function buildRowText(activity, isDone) {
    var wrap = el('div', { class: 'tasks-row-text' });

    var nameEl = el('div', { class: 'tasks-row-name' });
    if (isDone) nameEl.className = 'tasks-row-name tasks-row-name-done';
    nameEl.textContent = activity.title;
    wrap.appendChild(nameEl);

    var info = activity.description && activity.description.trim();
    var infoEl = el('div', { class: 'tasks-row-info' });
    infoEl.textContent = info ? info : 'Aucune information extra';
    if (!info) infoEl.classList.add('muted-text');
    wrap.appendChild(infoEl);

    wrap.appendChild(el('div', { class: 'tasks-row-status', text: 'Statut : ' + (isDone ? 'Faite' : 'Non faite') }));

    // Métadonnées (matière, type, date).
    var meta = [];
    if (activity.subject) meta.push(activity.subject);
    if (activity.type) meta.push(TYPE_LABELS[activity.type] || activity.type);
    if (activity.date) meta.push(SF.dates.formatFR(activity.date));
    if (meta.length) {
      wrap.appendChild(el('div', { class: 'tasks-row-meta', text: meta.join(' · ') }));
    }

    return wrap;
  }

  function buildRowActions(activity, isDone) {
    var actions = el('div', { class: 'tasks-row-actions' });

    // Terminer / Rouvrir.
    if (!isDone) {
      var completeBtn = el('button', { class: 'btn btn-ghost tasks-action', type: 'button', 'aria-label': 'Terminer' }, 'Terminer');
      completeBtn.addEventListener('click', function () {
        SF.activities.complete(activity.id);
      });
      actions.appendChild(completeBtn);
    } else {
      var reopenBtn = el('button', { class: 'btn btn-ghost tasks-action', type: 'button', 'aria-label': 'Rouvrir' }, 'Rouvrir');
      reopenBtn.addEventListener('click', function () {
        SF.activities.reopen(activity.id);
      });
      actions.appendChild(reopenBtn);
    }

    // Modifier (édition en ligne).
    var editBtn = el('button', { class: 'btn btn-ghost tasks-action', type: 'button', 'aria-label': 'Modifier' }, 'Modifier');
    editBtn.addEventListener('click', function () {
      editingId = activity.id;
      render();
    });
    actions.appendChild(editBtn);

    // Détails (formulaire complet).
    var detailsBtn = el('button', { class: 'btn btn-ghost tasks-action', type: 'button', 'aria-label': 'Détails' }, 'Détails');
    detailsBtn.addEventListener('click', function () {
      if (!SF.forms || !SF.forms.openActivity) {
        SF.app.toast('Formulaire détaillé indisponible.', 'error');
        return;
      }
      SF.forms.openActivity({ activity: activity });
    });
    actions.appendChild(detailsBtn);

    // Supprimer (avec confirmation).
    var delBtn = el('button', { class: 'btn btn-ghost tasks-action tasks-action-danger', type: 'button', 'aria-label': 'Supprimer' }, 'Supprimer');
    delBtn.addEventListener('click', function () {
      if (!SF.forms || !SF.forms.confirm) {
        // Retombée : confirmation native.
        if (window.confirm('Supprimer cette tâche ?')) SF.activities.remove(activity.id);
        return;
      }
      SF.forms.confirm({
        title: 'Supprimer la tâche ?',
        message: 'Cette action est irréversible.',
        confirmLabel: 'Supprimer',
        danger: true
      }).then(function (ok) {
        if (ok) SF.activities.remove(activity.id);
      });
    });
    actions.appendChild(delBtn);

    return actions;
  }

  // --- Édition en ligne ---

  function buildInlineEdit(activity, rowEl) {
    var form = el('div', { class: 'tasks-inline-edit' });

    var errorEl = el('div', { class: 'tasks-quick-error', role: 'alert' });

    var nameField = el('div', { class: 'tasks-field' });
    var nameInput = el('input', { class: 'tasks-input', type: 'text', value: activity.title || '', 'aria-label': 'Nom de la tâche' });
    nameField.appendChild(nameInput);

    var infoField = el('div', { class: 'tasks-field' });
    var infoInput = el('input', { class: 'tasks-input', type: 'text', value: activity.description || '', 'aria-label': 'Information extra' });
    infoField.appendChild(infoInput);

    var actions = el('div', { class: 'tasks-inline-actions' });
    var saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Enregistrer');
    var cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Annuler');

    saveBtn.addEventListener('click', function () {
      var newName = nameInput.value.trim();
      if (!newName) {
        errorEl.textContent = 'Le nom de la tâche ne peut pas être vide.';
        nameInput.focus();
        return;
      }
      SF.activities.update(activity.id, {
        title: newName,
        description: infoInput.value.trim()
      });
      editingId = null;
      render();
    });

    cancelBtn.addEventListener('click', function () {
      editingId = null;
      render();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.appendChild(errorEl);
    form.appendChild(nameField);
    form.appendChild(infoField);
    form.appendChild(actions);

    // Focus sur le nom au prochain cycle.
    setTimeout(function () { nameInput.focus(); }, 0);

    return form;
  }

  // ----- API de la vue --------------------------------------------------

  function onShow() { render(); }

  SF.app.registerView('tasks', { mount: mount, onShow: onShow });
})();
