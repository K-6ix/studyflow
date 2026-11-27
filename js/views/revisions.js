/* js/views/revisions.js
   Page « Révisions » : les objectifs de révision + les suggestions de séances.
   La vue s'enregistre avec SF.app.registerView et n'expose rien d'autre. */
(function () {
  'use strict';

  // ---------- Constantes ----------

  // Types de cible d'un objectif (à changer ici si planner.js utilise d'autres valeurs)
  var TARGET_MINUTES = 'minutes';
  var TARGET_SESSIONS = 'sessions';

  var MINUTES_PER_DAY = 24 * 60;
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var GOAL_FIELDS = ['title', 'subject', 'targetType', 'targetValue', 'startDate', 'endDate'];

  // ---------- État du module (rien n'est sauvegardé ici) ----------

  var goalsBody = null;        // zone qui contient les cartes d'objectifs
  var suggestionsBody = null;  // zone qui contient la liste de suggestions
  var horizonSelect = null;    // choix de l'horizon : 3, 7 ou 14 jours
  var maxPerDaySelect = null;  // choix du nombre max de séances par jour
  var dialog = null;           // boîte de dialogue « objectif »
  var dialogTitle = null;      // titre de cette boîte
  var subjectList = null;      // <datalist> des matières connues
  var formError = null;        // erreur générale de la boîte de dialogue
  var fields = {};             // champs de la boîte de dialogue, par nom
  var fieldErrors = {};        // messages d'erreur sous chaque champ
  var editingGoalId = null;    // id de l'objectif modifié (null = création)
  var suggestions = null;      // null = rien généré ; [] = aucun résultat
  var lastParams = { horizon: 7, maxPerDay: 2 }; // réglages de la dernière génération

  // ---------- Petits outils ----------

  // Crée un élément ; le texte est posé avec textContent (jamais innerHTML)
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Affiche un toast sans jamais planter
  function toast(message, type) {
    try {
      SF.app.toast(message, type);
    } catch (error) {
      // le toast n'est pas vital : on ignore
    }
  }

  // Écouteur protégé : si le code plante, la page continue de fonctionner
  function listen(node, eventName, handler) {
    node.addEventListener(eventName, function (event) {
      try {
        handler(event);
      } catch (error) {
        toast('Une erreur est survenue.', 'error');
      }
    });
  }

  // Bouton avec texte visible et, si besoin, un libellé complet pour les lecteurs d'écran
  function button(label, className, onClick, ariaLabel) {
    var node = el('button', 'btn ' + className, label);
    node.type = 'button';
    if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
    listen(node, 'click', onClick);
    return node;
  }

  function makeInput(type, value) {
    var input = el('input', 'rev-input');
    input.type = type;
    input.value = value === undefined ? '' : value;
    return input;
  }

  // options = [[valeur, texte], [valeur, texte], ...]
  function makeSelect(options) {
    var select = el('select', 'rev-input');
    options.forEach(function (option) {
      var node = el('option', '', option[1]);
      node.value = option[0];
      select.appendChild(node);
    });
    return select;
  }

  // Un champ = un libellé + une saisie
  function makeField(labelText, input) {
    var wrap = el('div', 'rev-field');
    var label = el('label', 'rev-field-label');
    label.appendChild(el('span', 'rev-label', labelText));
    label.appendChild(input);
    wrap.appendChild(label);
    return wrap;
  }

  // Bloc « état vide » : un texte (on peut lui ajouter un bouton ensuite)
  function emptyBox(text) {
    var box = el('div', 'empty rev-empty');
    box.appendChild(el('p', 'rev-empty-text', text));
    return box;
  }

  // Pastille de couleur + nom de la matière (ou « Toutes matières »)
  function subjectLabel(subject) {
    var label = el('span', 'rev-subject');
    if (!subject) {
      label.textContent = 'Toutes matières';
      return label;
    }
    var dot = el('span', 'dot rev-dot');
    dot.style.background = SF.app.subjectColor(subject);
    dot.setAttribute('aria-hidden', 'true');
    label.appendChild(dot);
    label.appendChild(document.createTextNode(subject));
    return label;
  }

  // Transforme { ok: false, errors: { champ: 'message' } } en liste de messages
  function errorMessages(result) {
    var messages = [];
    if (result && result.errors) {
      Object.keys(result.errors).forEach(function (key) {
        messages.push(String(result.errors[key]));
      });
    }
    return messages.length > 0 ? messages : ['Action impossible, réessaie.'];
  }

  // ---------- Partie A : les objectifs ----------

  // '2026-11-16' → { day: '16', month: 'novembre', year: '2026' }
  function splitDate(iso) {
    var parts = iso.split('-');
    var day = Number(parts[2]);
    return {
      day: day === 1 ? '1er' : String(day),
      month: MONTHS[Number(parts[1]) - 1],
      year: parts[0]
    };
  }

  // « du 16 au 30 novembre » (le mois et l'année ne sont répétés que s'ils changent)
  function formatPeriod(startISO, endISO) {
    if (!SF.dates.isValidISO(startISO) || !SF.dates.isValidISO(endISO)) return '';
    var a = splitDate(startISO);
    var b = splitDate(endISO);
    if (a.year !== b.year) {
      return 'du ' + a.day + ' ' + a.month + ' ' + a.year + ' au ' + b.day + ' ' + b.month + ' ' + b.year;
    }
    if (a.month !== b.month) {
      return 'du ' + a.day + ' ' + a.month + ' au ' + b.day + ' ' + b.month;
    }
    if (a.day === b.day) return 'le ' + a.day + ' ' + a.month;
    return 'du ' + a.day + ' au ' + b.day + ' ' + b.month;
  }

  // « 2 / 3 séances · 67 % » ou « 90 / 180 min · 50 % »
  function progressText(goal, current, target, percent) {
    var unit = 'min';
    if (goal.targetType !== TARGET_MINUTES) unit = target > 1 ? 'séances' : 'séance';
    return current + ' / ' + target + ' ' + unit + ' · ' + percent + ' %';
  }

  // Une carte d'objectif : titre, matière, période, barre de progression, boutons
  function buildGoalCard(goal) {
    var progress = SF.planner.getGoalProgress(goal) || {};
    var current = progress.current || 0;
    var target = progress.target || goal.targetValue;
    var percent = progress.reached ? 100 : Math.max(0, Math.min(100, Math.round(progress.percent || 0)));

    var card = el('article', progress.reached ? 'rev-goal rev-goal-reached' : 'rev-goal');

    var head = el('div', 'rev-goal-head');
    head.appendChild(el('h3', 'rev-goal-title', goal.title));
    if (progress.reached) head.appendChild(el('span', 'chip rev-badge', 'Atteint'));
    card.appendChild(head);

    var meta = el('p', 'rev-goal-meta');
    meta.appendChild(subjectLabel(goal.subject));
    var period = formatPeriod(goal.startDate, goal.endDate);
    if (period) meta.appendChild(el('span', 'rev-period', period));
    card.appendChild(meta);

    var bar = el('div', 'rev-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Progression de l’objectif ' + goal.title);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(percent));
    var fill = el('div', 'rev-bar-fill');
    fill.style.width = percent + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    card.appendChild(el('p', 'rev-goal-progress', progressText(goal, current, target, percent)));

    var actions = el('div', 'rev-actions');
    actions.appendChild(button('Modifier', 'btn-ghost', function () {
      openGoalDialog(goal);
    }, 'Modifier l’objectif ' + goal.title));
    actions.appendChild(button('Supprimer', 'btn-ghost rev-danger', function () {
      askDeleteGoal(goal);
    }, 'Supprimer l’objectif ' + goal.title));
    card.appendChild(actions);
    return card;
  }

  function renderGoals() {
    var goals = SF.planner.getGoals();
    goalsBody.textContent = '';

    if (goals.length === 0) {
      var empty = emptyBox('Aucun objectif. Fixe-toi une cible pour suivre ta progression.');
      empty.appendChild(button('Créer un objectif', 'btn-primary', function () {
        openGoalDialog(null);
      }));
      goalsBody.appendChild(empty);
      return;
    }

    var grid = el('div', 'rev-goals');
    goals.forEach(function (goal) {
      grid.appendChild(buildGoalCard(goal));
    });
    goalsBody.appendChild(grid);
  }

  // Redessine la page : appelable à tout moment, même vue masquée.
  // Seuls les objectifs sont recalculés ; les suggestions restent celles de la dernière génération.
  function render() {
    if (!goalsBody) return;
    try {
      renderGoals();
    } catch (error) {
      goalsBody.textContent = 'Impossible d’afficher les objectifs.';
    }
  }

  function askDeleteGoal(goal) {
    SF.forms.confirm({
      title: 'Supprimer cet objectif ?',
      message: 'L’objectif « ' + goal.title + ' » sera supprimé définitivement.',
      confirmLabel: 'Supprimer',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      if (SF.planner.removeGoal(goal.id) === false) {
        toast('Suppression impossible.', 'error');
        return;
      }
      toast('Objectif supprimé.', 'success');
    }).catch(function () {
      toast('Suppression impossible.', 'error');
    });
  }

  // ---------- La boîte de dialogue « objectif » ----------

  // Ajoute un champ (libellé + saisie + place pour le message d'erreur) au parent
  function addField(parent, name, labelText, input) {
    var wrap = makeField(labelText, input);
    var error = el('p', 'rev-error');
    error.id = 'rev-error-' + name;
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    wrap.appendChild(error);
    fields[name] = input;
    fieldErrors[name] = error;
    parent.appendChild(wrap);
  }

  function buildDialog() {
    dialog = el('dialog', 'rev-dialog');
    dialog.setAttribute('aria-labelledby', 'rev-dialog-title');

    dialogTitle = el('h2', 'rev-dialog-title', 'Nouvel objectif');
    dialogTitle.id = 'rev-dialog-title';
    dialog.appendChild(dialogTitle);

    var form = el('form', 'rev-form');
    form.noValidate = true; // les erreurs viennent de SF.planner, pas du navigateur

    subjectList = el('datalist');
    subjectList.id = 'rev-subjects';

    var subjectInput = makeInput('text', '');
    subjectInput.setAttribute('list', 'rev-subjects');
    subjectInput.placeholder = 'Toutes matières';

    var valueInput = makeInput('number', '');
    valueInput.min = '1';

    addField(form, 'title', 'Titre', makeInput('text', ''));
    addField(form, 'subject', 'Matière (vide = toutes les matières)', subjectInput);
    form.appendChild(subjectList);

    var targetRow = el('div', 'rev-form-row');
    addField(targetRow, 'targetType', 'Type de cible', makeSelect([
      [TARGET_MINUTES, 'Minutes d’étude'],
      [TARGET_SESSIONS, 'Nombre de séances']
    ]));
    addField(targetRow, 'targetValue', 'Valeur cible', valueInput);
    form.appendChild(targetRow);

    var dateRow = el('div', 'rev-form-row');
    addField(dateRow, 'startDate', 'Début', makeInput('date', ''));
    addField(dateRow, 'endDate', 'Fin', makeInput('date', ''));
    form.appendChild(dateRow);

    formError = el('p', 'rev-error');
    formError.setAttribute('role', 'alert');
    formError.hidden = true;
    form.appendChild(formError);

    var actions = el('div', 'rev-form-actions');
    actions.appendChild(button('Annuler', 'btn-ghost', function () {
      dialog.close();
    }));
    var save = el('button', 'btn btn-primary', 'Enregistrer');
    save.type = 'submit';
    actions.appendChild(save);
    form.appendChild(actions);

    listen(form, 'submit', function (event) {
      event.preventDefault();
      submitGoal();
    });

    dialog.appendChild(form);
    return dialog;
  }

  // Remplit la liste de suggestions de matières à chaque ouverture
  function fillSubjects() {
    subjectList.textContent = '';
    SF.filters.getSubjects().forEach(function (subject) {
      var option = el('option');
      option.value = subject;
      subjectList.appendChild(option);
    });
  }

  function clearErrors() {
    GOAL_FIELDS.forEach(function (name) {
      fieldErrors[name].textContent = '';
      fieldErrors[name].hidden = true;
      fields[name].removeAttribute('aria-invalid');
    });
    formError.textContent = '';
    formError.hidden = true;
  }

  // errors = { champ: 'message' } ; un message sans champ connu va dans l'erreur générale
  function showErrors(errors) {
    var others = [];
    var firstInvalid = null;
    Object.keys(errors).forEach(function (key) {
      if (!fieldErrors[key]) {
        others.push(String(errors[key]));
        return;
      }
      fieldErrors[key].textContent = String(errors[key]);
      fieldErrors[key].hidden = false;
      fields[key].setAttribute('aria-invalid', 'true');
      if (!firstInvalid) firstInvalid = fields[key];
    });
    if (others.length > 0) {
      formError.textContent = others.join(' ');
      formError.hidden = false;
    }
    if (firstInvalid) firstInvalid.focus();
  }

  // goal = objectif à modifier, ou null pour en créer un
  function openGoalDialog(goal) {
    var today = SF.dates.todayISO(new Date());
    editingGoalId = goal ? goal.id : null;
    dialogTitle.textContent = goal ? 'Modifier l’objectif' : 'Nouvel objectif';
    fields.title.value = goal ? goal.title : '';
    fields.subject.value = goal ? goal.subject || '' : '';
    fields.targetType.value = goal ? goal.targetType : TARGET_MINUTES;
    fields.targetValue.value = goal ? goal.targetValue : '';
    fields.startDate.value = goal ? goal.startDate : today;
    fields.endDate.value = goal ? goal.endDate : SF.dates.addDays(today, 6);
    clearErrors();
    fillSubjects();
    dialog.showModal();
  }

  function submitGoal() {
    clearErrors();
    var data = {
      title: fields.title.value.trim(),
      subject: fields.subject.value.trim(),
      targetType: fields.targetType.value,
      targetValue: Number(fields.targetValue.value),
      startDate: fields.startDate.value,
      endDate: fields.endDate.value
    };
    var isNew = editingGoalId === null;
    var result = isNew ? SF.planner.addGoal(data) : SF.planner.updateGoal(editingGoalId, data);

    if (!result || !result.ok) {
      showErrors(result && result.errors ? result.errors : { general: 'Enregistrement impossible.' });
      return;
    }
    dialog.close();
    toast(isNew ? 'Objectif créé.' : 'Objectif modifié.', 'success');
  }

  // ---------- Partie B : les suggestions ----------

  // Lit les réglages, mémorise-les et génère la liste
  function onGenerate() {
    lastParams = {
      horizon: Number(horizonSelect.value),
      maxPerDay: Number(maxPerDaySelect.value)
    };
    generate();
  }

  // Génère les suggestions avec les derniers réglages et redessine la liste
  function generate() {
    var today = SF.dates.todayISO(new Date());
    var list = SF.planner.generateSuggestions({
      fromISO: today,
      toISO: SF.dates.addDays(today, lastParams.horizon - 1),
      maxPerDay: lastParams.maxPerDay
    });
    suggestions = Array.isArray(list) ? list : [];
    renderSuggestions();
  }

  // Après une action, le focus clavier revient sur le premier bouton de la liste
  function focusFirstButton() {
    var first = suggestionsBody.querySelector('button');
    if (first) first.focus();
  }

  // Envoie une suggestion à SF.planner ; si c'est accepté : toast, puis nouvelle liste
  function accept(suggestion) {
    var result = SF.planner.acceptSuggestion(suggestion);
    if (result && result.ok) {
      toast('Séance ajoutée à ton agenda.', 'success');
      generate();
      focusFirstButton();
    }
    return result;
  }

  function acceptFromList(suggestion) {
    var result = accept(suggestion);
    if (!result || !result.ok) toast(errorMessages(result)[0], 'error');
  }

  function refuse(suggestion) {
    SF.planner.refuseSuggestion(suggestion);
    toast('Suggestion refusée.', 'info');
    generate();
    focusFirstButton();
  }

  // Vérifie les valeurs de l'éditeur ; renvoie la liste des problèmes (vide si tout va bien)
  function checkEdited(date, startTime, minutes) {
    var problems = [];
    if (!SF.dates.isValidISO(date)) problems.push('La date n’est pas valide.');
    if (!SF.dates.isValidTime(startTime)) problems.push('L’heure de début n’est pas valide.');
    if (!(minutes >= 1) || Math.floor(minutes) !== minutes) {
      problems.push('La durée doit être un nombre entier de minutes.');
    } else if (SF.dates.isValidTime(startTime) &&
        SF.dates.timeToMinutes(startTime) + minutes >= MINUTES_PER_DAY) {
      problems.push('La séance doit se terminer avant minuit.');
    }
    return problems;
  }

  // Petit éditeur en ligne : date, heure de début, durée
  function buildEditor(suggestion, onCancel) {
    var form = el('form', 'rev-editor');
    form.noValidate = true;

    var dateInput = makeInput('date', suggestion.date);
    var startInput = makeInput('time', suggestion.startTime);
    var minutesInput = makeInput('number', suggestion.durationMinutes);
    minutesInput.min = '5';
    minutesInput.step = '5';

    form.appendChild(makeField('Date', dateInput));
    form.appendChild(makeField('Début', startInput));
    form.appendChild(makeField('Durée (min)', minutesInput));

    var errorBox = el('p', 'rev-error rev-editor-error');
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;
    form.appendChild(errorBox);

    var actions = el('div', 'rev-actions');
    var validate = el('button', 'btn btn-primary', 'Valider');
    validate.type = 'submit';
    actions.appendChild(validate);
    actions.appendChild(button('Annuler', 'btn-ghost', onCancel));
    form.appendChild(actions);

    listen(form, 'submit', function (event) {
      event.preventDefault();
      var minutes = Number(minutesInput.value);
      var problems = checkEdited(dateInput.value, startInput.value, minutes);

      if (problems.length === 0) {
        // On copie la suggestion, puis on remplace les valeurs modifiées
        var edited = Object.assign({}, suggestion, {
          date: dateInput.value,
          startTime: startInput.value,
          durationMinutes: minutes,
          endTime: SF.dates.minutesToTime(SF.dates.timeToMinutes(startInput.value) + minutes)
        });
        var result = accept(edited);
        if (result && result.ok) return;
        problems = errorMessages(result);
      }
      errorBox.textContent = problems.join(' ');
      errorBox.hidden = false;
    });
    return form;
  }

  // Ouvre ou ferme l'éditeur d'une suggestion
  function toggleEditor(item, editButton, suggestion) {
    var opened = item.querySelector('.rev-editor');
    if (opened) {
      item.removeChild(opened);
      editButton.setAttribute('aria-expanded', 'false');
      return;
    }
    var editor = buildEditor(suggestion, function () {
      toggleEditor(item, editButton, suggestion);
      editButton.focus();
    });
    item.appendChild(editor);
    editButton.setAttribute('aria-expanded', 'true');
    editor.querySelector('input').focus();
  }

  // Une suggestion : plage horaire, durée, matière, explication, trois boutons
  function buildSuggestion(suggestion) {
    var item = el('li', 'rev-sugg');
    var when = 'la séance du ' + SF.dates.formatFR(suggestion.date) + ' à ' + suggestion.startTime;

    var main = el('div', 'rev-sugg-main');
    var line = el('div', 'rev-sugg-line');
    line.appendChild(el('strong', 'rev-time', suggestion.startTime + ' – ' + suggestion.endTime));
    line.appendChild(el('span', 'rev-duration', SF.app.formatMinutes(suggestion.durationMinutes)));
    line.appendChild(subjectLabel(suggestion.subject));
    main.appendChild(line);
    main.appendChild(el('p', 'rev-reason', suggestion.reason));
    item.appendChild(main);

    var actions = el('div', 'rev-actions');
    actions.appendChild(button('Accepter', 'btn-primary', function () {
      acceptFromList(suggestion);
    }, 'Accepter ' + when));
    var editButton = button('Modifier', 'btn-ghost', function () {
      toggleEditor(item, editButton, suggestion);
    }, 'Modifier ' + when);
    editButton.setAttribute('aria-expanded', 'false');
    actions.appendChild(editButton);
    actions.appendChild(button('Refuser', 'btn-ghost', function () {
      refuse(suggestion);
    }, 'Refuser ' + when));
    item.appendChild(actions);
    return item;
  }

  // Trie par date puis par heure, et range les suggestions jour par jour
  function groupByDay(list) {
    var sorted = list.slice().sort(function (a, b) {
      return (a.date + ' ' + a.startTime).localeCompare(b.date + ' ' + b.startTime);
    });
    var groups = [];
    sorted.forEach(function (suggestion) {
      var last = groups[groups.length - 1];
      if (!last || last.date !== suggestion.date) {
        last = { date: suggestion.date, items: [] };
        groups.push(last);
      }
      last.items.push(suggestion);
    });
    return groups;
  }

  function renderSuggestions() {
    suggestionsBody.textContent = '';

    if (suggestions === null) {
      suggestionsBody.appendChild(emptyBox('Clique sur Générer des suggestions pour voir quoi réviser.'));
      return;
    }

    if (suggestions.length === 0) {
      var empty = emptyBox('Aucune suggestion : ajoute des examens, des devoirs avec échéance ou un objectif.');
      empty.appendChild(button('Ajouter un examen', 'btn-primary', function () {
        SF.forms.openActivity({ defaults: { type: 'exam' } });
      }));
      suggestionsBody.appendChild(empty);
      return;
    }

    groupByDay(suggestions).forEach(function (group) {
      var section = el('section', 'rev-day');
      section.appendChild(el('h3', 'rev-day-title', SF.dates.formatFR(group.date)));
      var list = el('ul', 'rev-sugg-list');
      group.items.forEach(function (suggestion) {
        list.appendChild(buildSuggestion(suggestion));
      });
      section.appendChild(list);
      suggestionsBody.appendChild(section);
    });
  }

  // ---------- Construction de la page ----------

  function buildGoalsCard() {
    var card = el('section', 'card');
    card.setAttribute('aria-labelledby', 'rev-goals-title');

    var head = el('div', 'rev-head');
    var title = el('h2', 'card-title', 'Objectifs');
    title.id = 'rev-goals-title';
    head.appendChild(title);
    head.appendChild(button('+ Nouvel objectif', 'btn-primary', function () {
      openGoalDialog(null);
    }));
    card.appendChild(head);

    goalsBody = el('div', 'rev-goals-body');
    card.appendChild(goalsBody);
    return card;
  }

  function buildSuggestionsCard() {
    var card = el('section', 'card');
    card.setAttribute('aria-labelledby', 'rev-suggestions-title');

    var head = el('div', 'rev-head');
    var title = el('h2', 'card-title', 'Suggestions de révision');
    title.id = 'rev-suggestions-title';
    head.appendChild(title);
    card.appendChild(head);

    horizonSelect = makeSelect([[3, '3 jours'], [7, '7 jours'], [14, '14 jours']]);
    horizonSelect.value = '7';
    maxPerDaySelect = makeSelect([[1, '1'], [2, '2'], [3, '3']]);
    maxPerDaySelect.value = '2';

    var settings = el('div', 'rev-settings');
    settings.appendChild(makeField('Horizon', horizonSelect));
    settings.appendChild(makeField('Séances max. par jour', maxPerDaySelect));
    settings.appendChild(button('Générer des suggestions', 'btn-primary', onGenerate));
    card.appendChild(settings);

    suggestionsBody = el('div', 'rev-suggestions');
    card.appendChild(suggestionsBody);
    return card;
  }

  // Appelée UNE seule fois : construit toute la page
  function mount(container) {
    var root = el('div', 'rev-page');
    root.appendChild(buildGoalsCard());
    root.appendChild(buildSuggestionsCard());
    root.appendChild(buildDialog());
    container.appendChild(root);

    SF.events.on('data:changed', render);
    render();
    renderSuggestions();
  }

  // Appelée à chaque affichage de la page : on remet les objectifs à jour
  function onShow() {
    render();
  }

  SF.app.registerView('revisions', { mount: mount, onShow: onShow });
})();
