/* =========================================================
   StudyFlow — SF.onboarding : accueil guidé en 3 étapes
   1) emploi du temps  2) objectif du jour  3) première tâche

   Il s'affiche en haut de l'Accueil, seulement au premier lancement
   (aucun cours, aucune activité, aucune séance).

   POUR LA FUSION AVEC LE PHP / MySQL :
   - Ce fichier n'écrit JAMAIS lui-même dans localStorage pour les données.
     Il passe uniquement par SF.timetable.add, SF.storage.updateSettings
     et SF.activities.add. Si ces trois fonctions parlent au serveur plus tard,
     ce fichier n'a rien à changer.
   - Une seule chose est gardée dans le navigateur : l'étape en cours du guide.
     Elle est lue et écrite dans loadState() et saveState() (et nulle part
     ailleurs) : ce sont les deux seules fonctions à remplacer par un appel
     au serveur si tu veux garder l'état du guide dans la base.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  var STATE_KEY = 'studyflow.v1.onboarding';

  var STEPS = [
    { id: 1, label: 'Emploi du temps' },
    { id: 2, label: 'Objectif du jour' },
    { id: 3, label: 'Première tâche' }
  ];
  var GOAL_CHOICES = [60, 120, 180, 240];
  var WEEKDAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  var host = null;            // le conteneur donné par l'Accueil
  var state = null;           // { step, engaged, finished }
  var memoryText = null;      // copie de secours si localStorage est bloqué
  var storageWorks = true;
  var lastActive = null;      // pour savoir si le guide vient d'apparaître ou de disparaître
  var lastCourseCount = -1;   // pour redessiner l'étape 1 quand un cours est ajouté (aussi par l'import PDF)
  var wantFocus = '';         // sélecteur du champ à remettre au clair après un redessin
  var wantTitleFocus = false; // vrai juste après un changement d'étape

  // Ce que l'utilisateur a déjà saisi (on le garde si l'étape est redessinée).
  var draft = { weekday: 1, startTime: '08:30', endTime: '10:00', goal: null };

  // ----- Petits utilitaires ---------------------------------------------

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Crée un élément. Le texte passe toujours par textContent (jamais innerHTML).
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (key === 'class') node.className = attrs[key];
        else if (key === 'text') node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (child) {
        if (child == null) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  function toast(message, type) {
    if (SF.app && SF.app.toast) SF.app.toast(message, type);
  }

  // ----- État du guide (SEUL endroit qui touche au stockage) -------------

  function loadState() {
    var result = { step: 1, engaged: false, finished: false };
    var text = null;
    try {
      text = storageWorks ? window.localStorage.getItem(STATE_KEY) : memoryText;
    } catch (error) {
      storageWorks = false;
      text = memoryText;
    }
    if (!text) return result;
    try {
      var saved = JSON.parse(text);
      if (saved && typeof saved === 'object') {
        if (saved.step === 1 || saved.step === 2 || saved.step === 3) result.step = saved.step;
        result.engaged = saved.engaged === true;
        result.finished = saved.finished === true;
      }
    } catch (error) {
      // Texte abîmé : on repart du début.
    }
    return result;
  }

  function saveState() {
    var text = JSON.stringify(state);
    memoryText = text;
    try {
      window.localStorage.setItem(STATE_KEY, text);
      storageWorks = true;
    } catch (error) {
      storageWorks = false;
    }
  }

  // Change l'état, le sauvegarde et prévient l'Accueil.
  function setState(patch) {
    for (var key in patch) state[key] = patch[key];
    saveState();
  }

  function notify() {
    if (SF.events) SF.events.emit('onboarding:changed', {});
  }

  // ----- Quand afficher le guide -----------------------------------------

  function isDataEmpty() {
    try {
      return SF.timetable.getAll().length === 0 &&
        SF.activities.getAll().length === 0 &&
        SF.sessions.getAll().length === 0;
    } catch (error) {
      return false; // dans le doute, on n'embête pas l'utilisateur
    }
  }

  // Actif = pas terminé, et (déjà commencé OU première fois avec tout vide).
  function isActive() {
    if (!state) state = loadState();
    if (state.finished) return false;
    return state.engaged || isDataEmpty();
  }

  function getCourses() {
    try { return SF.timetable.getAll(); } catch (error) { return []; }
  }

  // ----- Navigation entre les étapes -------------------------------------

  function goTo(step) {
    setState({ step: step, engaged: true });
    wantTitleFocus = true;
    draw();
  }

  function finish(message) {
    setState({ finished: true });
    draw(); // cache le guide
    if (message) toast(message, 'success');
    notify(); // l'Accueil se met à jour (grille, bannière vide)
  }

  // ----- Morceaux d'interface communs ------------------------------------

  function buildHeader() {
    var head = el('div', { class: 'onb-head' });
    var text = el('div', { class: 'onb-head-text' });
    text.appendChild(el('h2', { class: 'onb-title', id: 'onb-title', text: 'Bienvenue dans StudyFlow' }));
    text.appendChild(el('p', { class: 'onb-sub', text: '3 petites étapes pour bien démarrer. Ça prend environ une minute.' }));
    head.appendChild(text);

    var skip = el('button', { class: 'btn btn-ghost onb-skip', type: 'button', text: 'Passer le guide' });
    skip.addEventListener('click', function () {
      finish('Guide masqué. Tu peux ajouter tes cours dans l\u2019Agenda.');
    });
    head.appendChild(skip);
    return head;
  }

  function buildStepper() {
    var list = el('ol', { class: 'onb-steps', 'aria-label': 'Progression du guide' });
    STEPS.forEach(function (step) {
      var cls = 'onb-step';
      var mark = String(step.id);
      if (step.id < state.step) { cls += ' is-done'; mark = '\u2713'; }
      if (step.id === state.step) cls += ' is-current';
      var item = el('li', { class: cls }, [
        el('span', { class: 'onb-step-dot', 'aria-hidden': 'true', text: mark }),
        el('span', { class: 'onb-step-label', text: step.label })
      ]);
      if (step.id === state.step) item.setAttribute('aria-current', 'step');
      list.appendChild(item);
    });
    return list;
  }

  // Champ de formulaire : étiquette + contrôle + zone d'erreur.
  function buildField(id, labelText, control, extraClass) {
    control.id = id;
    var error = el('div', { class: 'onb-error', id: id + '-error' });
    control.setAttribute('aria-describedby', id + '-error');
    return {
      node: el('div', { class: 'onb-field' + (extraClass ? ' ' + extraClass : '') }, [
        el('label', { class: 'onb-label', for: id, text: labelText }),
        control,
        error
      ]),
      control: control,
      error: error
    };
  }

  // Affiche les erreurs { champ: message } renvoyées par SF.*.add.
  function showErrors(fields, errors) {
    var general = '';
    Object.keys(fields).forEach(function (name) {
      var field = fields[name];
      field.error.textContent = (errors && errors[name]) || '';
      if (errors && errors[name]) field.control.setAttribute('aria-invalid', 'true');
      else field.control.removeAttribute('aria-invalid');
    });
    if (errors && errors.general) general = errors.general;
    return general;
  }

  function buildTitle(text, hint) {
    var wrap = el('div', {});
    wrap.appendChild(el('h3', { class: 'onb-step-title', id: 'onb-step-title', tabindex: '-1', text: text }));
    wrap.appendChild(el('p', { class: 'onb-hint', text: hint }));
    return wrap;
  }

  // ----- Étape 1 : emploi du temps ---------------------------------------

  function fillStep1(panel) {
    panel.appendChild(buildTitle(
      'Quels sont tes cours de la semaine ?',
      'Ajoute un premier cours. Tu pourras compléter le reste plus tard dans l\u2019Agenda.'
    ));

    var form = el('form', { class: 'onb-form', novalidate: 'novalidate' });
    var fields = {};

    var subjectInput = el('input', { class: 'onb-input', type: 'text', maxlength: '60', placeholder: 'Ex. Maths', autocomplete: 'off' });
    fields.subject = buildField('onb-subject', 'Matière', subjectInput, 'onb-field-wide');

    var weekdaySelect = el('select', { class: 'onb-input' });
    WEEKDAY_NAMES.forEach(function (name, index) {
      var option = el('option', { value: String(index + 1), text: name });
      if (index + 1 === draft.weekday) option.selected = true;
      weekdaySelect.appendChild(option);
    });
    fields.weekday = buildField('onb-weekday', 'Jour', weekdaySelect);

    var startInput = el('input', { class: 'onb-input', type: 'time', value: draft.startTime });
    fields.startTime = buildField('onb-start', 'Début', startInput);

    var endInput = el('input', { class: 'onb-input', type: 'time', value: draft.endTime });
    fields.endTime = buildField('onb-end', 'Fin', endInput);

    var roomInput = el('input', { class: 'onb-input', type: 'text', maxlength: '60', placeholder: 'Facultatif', autocomplete: 'off' });
    fields.room = buildField('onb-room', 'Salle', roomInput);

    var grid = el('div', { class: 'onb-grid' });
    ['subject', 'weekday', 'startTime', 'endTime', 'room'].forEach(function (name) {
      grid.appendChild(fields[name].node);
    });
    form.appendChild(grid);

    var generalError = el('div', { class: 'onb-error onb-error-general', role: 'alert' });
    form.appendChild(generalError);

    var addRow = el('div', { class: 'onb-row' });
    addRow.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', text: 'Ajouter ce cours' }));
    if (SF.importerUI && SF.importerUI.open) {
      var importBtn = el('button', { class: 'btn', type: 'button', text: 'Importer mon emploi du temps (PDF)' });
      importBtn.addEventListener('click', function () {
        setState({ engaged: true }); // important : l'import remplit les données, le guide doit rester là
        SF.importerUI.open();
      });
      addRow.appendChild(importBtn);
    }
    form.appendChild(addRow);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      // On retient les choix pour le prochain cours.
      draft.weekday = Number(weekdaySelect.value);
      draft.startTime = startInput.value;
      draft.endTime = endInput.value;
      setState({ engaged: true });
      wantFocus = '#onb-subject';
      var result = SF.timetable.add({
        subject: subjectInput.value,
        weekday: Number(weekdaySelect.value),
        startTime: startInput.value,
        endTime: endInput.value,
        room: roomInput.value,
        teacher: ''
      });
      if (result && result.ok) {
        toast('Cours ajouté.', 'success');
        // L'événement 'data:changed' redessine déjà l'étape (voir refresh).
      } else {
        wantFocus = '';
        var message = showErrors(fields, result && result.errors);
        generalError.textContent = message;
      }
    });
    panel.appendChild(form);

    // Liste des cours déjà ajoutés.
    var courses = getCourses();
    lastCourseCount = courses.length;
    var listBox = el('div', { class: 'onb-added' });
    if (courses.length === 0) {
      listBox.appendChild(el('p', { class: 'onb-muted', text: 'Aucun cours pour le moment.' }));
    } else {
      listBox.appendChild(el('p', { class: 'onb-muted', text: courses.length === 1 ? '1 cours ajouté :' : courses.length + ' cours ajoutés :' }));
      var chips = el('ul', { class: 'onb-chips' });
      courses.slice(0, 12).forEach(function (course) {
        var day = WEEKDAY_NAMES[course.weekday - 1] || '';
        var dot = el('span', { class: 'onb-chip-dot', 'aria-hidden': 'true' });
        dot.style.background = SF.app.subjectColor(course.subject);
        chips.appendChild(el('li', { class: 'onb-chip' }, [
          dot,
          el('span', { text: course.subject + ' · ' + day + ' ' + course.startTime + '\u2013' + course.endTime })
        ]));
      });
      listBox.appendChild(chips);
    }
    panel.appendChild(listBox);

    // Boutons du bas.
    var actions = el('div', { class: 'onb-actions' });
    var skipStep = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Passer cette étape' });
    skipStep.addEventListener('click', function () { goTo(2); });
    var next = el('button', { class: 'btn btn-primary', type: 'button', text: 'Continuer' });
    if (courses.length === 0) {
      next.disabled = true;
      next.title = 'Ajoute au moins un cours, ou passe cette étape.';
    }
    next.addEventListener('click', function () { goTo(2); });
    actions.appendChild(skipStep);
    actions.appendChild(next);
    panel.appendChild(actions);
  }

  // ----- Étape 2 : objectif du jour --------------------------------------

  function fillStep2(panel) {
    panel.appendChild(buildTitle(
      'Combien de temps veux-tu étudier par jour ?',
      'Ton objectif apparaît sur l\u2019Accueil et se remplit à chaque séance. Tu pourras le changer quand tu veux.'
    ));

    if (draft.goal === null) {
      var saved = SF.storage.getSettings().dailyGoalMinutes;
      draft.goal = Number(saved) || 120;
    }

    var group = el('div', { class: 'onb-goals', role: 'radiogroup', 'aria-label': 'Objectif journalier' });
    var buttons = {};
    var customInput = el('input', {
      class: 'onb-input onb-goal-custom', type: 'number', min: '15', max: '720', step: '5',
      placeholder: 'Autre', 'aria-label': 'Autre objectif, en minutes'
    });
    var summary = el('p', { class: 'onb-summary', 'aria-live': 'polite' });
    var errorBox = el('div', { class: 'onb-error', role: 'alert' });

    // Met à jour l'affichage sans tout redessiner.
    function paint() {
      GOAL_CHOICES.forEach(function (minutes) {
        var isOn = minutes === draft.goal;
        buttons[minutes].classList.toggle('is-on', isOn);
        buttons[minutes].setAttribute('aria-checked', isOn ? 'true' : 'false');
      });
      summary.textContent = 'Objectif choisi : ' + SF.app.formatMinutes(draft.goal) + ' par jour.';
    }

    GOAL_CHOICES.forEach(function (minutes) {
      var button = el('button', { class: 'btn onb-goal', type: 'button', role: 'radio', text: SF.app.formatMinutes(minutes) });
      button.addEventListener('click', function () {
        draft.goal = minutes;
        customInput.value = '';
        errorBox.textContent = '';
        paint();
      });
      buttons[minutes] = button;
      group.appendChild(button);
    });
    // Si l'objectif enregistré n'est pas un des boutons, on le montre dans la case libre.
    if (GOAL_CHOICES.indexOf(draft.goal) === -1) customInput.value = String(draft.goal);
    customInput.addEventListener('input', function () {
      var value = parseInt(customInput.value, 10);
      if (!isNaN(value)) draft.goal = value;
      errorBox.textContent = '';
      paint();
    });
    var custom = el('label', { class: 'onb-goal-custom-wrap' }, [customInput, el('span', { class: 'onb-muted', text: 'min' })]);
    group.appendChild(custom);

    panel.appendChild(group);
    panel.appendChild(summary);
    panel.appendChild(errorBox);
    paint();

    var actions = el('div', { class: 'onb-actions' });
    var back = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Retour' });
    back.addEventListener('click', function () { goTo(1); });
    var next = el('button', { class: 'btn btn-primary', type: 'button', text: 'Continuer' });
    next.addEventListener('click', function () {
      var result = SF.storage.updateSettings({ dailyGoalMinutes: draft.goal });
      if (result && result.ok) {
        goTo(3);
      } else {
        errorBox.textContent = (result && result.errors && (result.errors.dailyGoalMinutes || result.errors.general)) ||
          'Objectif invalide : choisis entre 15 et 720 minutes.';
      }
    });
    actions.appendChild(back);
    actions.appendChild(next);
    panel.appendChild(actions);
  }

  // ----- Étape 3 : première tâche ----------------------------------------

  function fillStep3(panel) {
    panel.appendChild(buildTitle(
      'Quelle est ta première tâche ?',
      'Un devoir, un examen, une révision… Une seule suffit pour commencer.'
    ));

    var form = el('form', { class: 'onb-form', novalidate: 'novalidate' });
    var fields = {};

    var titleInput = el('input', { class: 'onb-input', type: 'text', maxlength: '100', placeholder: 'Ex. Faire la série 4', autocomplete: 'off' });
    fields.title = buildField('onb-task-title', 'Titre', titleInput, 'onb-field-wide');

    // La matière propose celles des cours ajoutés à l'étape 1.
    var subjectInput = el('input', { class: 'onb-input', type: 'text', maxlength: '60', placeholder: 'Ex. Maths', autocomplete: 'off', list: 'onb-subjects' });
    var datalist = el('datalist', { id: 'onb-subjects' });
    var seen = {};
    getCourses().forEach(function (course) {
      if (!seen[course.subject]) {
        seen[course.subject] = true;
        datalist.appendChild(el('option', { value: course.subject }));
      }
    });
    fields.subject = buildField('onb-task-subject', 'Matière', subjectInput);

    var typeSelect = el('select', { class: 'onb-input' });
    SF.constants.TYPES.forEach(function (type) {
      typeSelect.appendChild(el('option', { value: type, text: SF.constants.LABELS[type] || type }));
    });
    typeSelect.value = 'homework';
    fields.type = buildField('onb-task-type', 'Type', typeSelect);

    var dateInput = el('input', { class: 'onb-input', type: 'date', value: SF.dates.todayISO() });
    fields.date = buildField('onb-task-date', 'Pour le', dateInput);

    var grid = el('div', { class: 'onb-grid' });
    ['title', 'subject', 'type', 'date'].forEach(function (name) { grid.appendChild(fields[name].node); });
    form.appendChild(grid);
    form.appendChild(datalist);

    var generalError = el('div', { class: 'onb-error onb-error-general', role: 'alert' });
    form.appendChild(generalError);

    var actions = el('div', { class: 'onb-actions' });
    var back = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Retour' });
    back.addEventListener('click', function () { goTo(2); });
    var skipStep = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Passer' });
    skipStep.addEventListener('click', function () { finish('Guide terminé. Bon courage !'); });
    var done = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Terminer' });
    actions.appendChild(back);
    actions.appendChild(skipStep);
    actions.appendChild(done);
    form.appendChild(actions);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = SF.activities.add({
        title: titleInput.value,
        subject: subjectInput.value,
        type: typeSelect.value,
        date: dateInput.value,
        priority: 'medium'
      });
      if (result && result.ok) {
        finish('C\u2019est parti ! Ta première tâche est ajoutée.');
      } else {
        generalError.textContent = showErrors(fields, result && result.errors);
      }
    });
    panel.appendChild(form);
  }

  // ----- Dessin du guide -------------------------------------------------

  function draw() {
    if (!host) return;
    clear(host);
    lastActive = isActive();
    if (!lastActive) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    var card = el('section', { class: 'card onb-card', 'aria-labelledby': 'onb-title' });
    card.appendChild(buildHeader());
    card.appendChild(buildStepper());

    var panel = el('div', { class: 'onb-panel' });
    if (state.step === 1) fillStep1(panel);
    else if (state.step === 2) fillStep2(panel);
    else fillStep3(panel);
    card.appendChild(panel);

    // Lien discret pour explorer avec des données d'exemple.
    if (SF.app && SF.app.seedDemo) {
      var demo = el('button', { class: 'onb-demo', type: 'button', text: 'Ou explorer avec des données de démo' });
      demo.addEventListener('click', function () {
        setState({ finished: true });
        SF.app.seedDemo();
        notify();
      });
      card.appendChild(demo);
    }
    host.appendChild(card);

    // Gestion du focus : titre de l'étape après un changement, ou champ demandé.
    var target = null;
    if (wantFocus) target = host.querySelector(wantFocus);
    else if (wantTitleFocus) target = host.querySelector('#onb-step-title');
    wantFocus = '';
    wantTitleFocus = false;
    if (target && target.focus) target.focus();
  }

  // Appelé à chaque 'data:changed' : on ne redessine que si c'est utile,
  // pour ne pas effacer ce que l'utilisateur est en train de taper.
  function refresh() {
    // On relit l'état enregistré : si tout a été effacé (bouton « tout effacer »), on repart de zéro.
    state = loadState();
    var active = isActive();
    var courseChanged = state.step === 1 && getCourses().length !== lastCourseCount;
    if (active !== lastActive || (active && courseChanged)) draw();
  }

  // ----- API publique ----------------------------------------------------

  // Monte le guide dans un conteneur (appelé une fois par l'Accueil).
  function mount(container) {
    host = container;
    state = loadState();
    draw();
    SF.events.on('data:changed', refresh);
  }

  // Remet le guide au début (utile pour tester : SF.onboarding.reset() dans la console).
  function reset() {
    state = { step: 1, engaged: false, finished: false };
    draft.goal = null;
    saveState();
    draw();
    notify();
  }

  SF.onboarding = {
    mount: mount,
    isActive: isActive,
    reset: reset
  };
})();
