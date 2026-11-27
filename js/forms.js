// js/forms.js — Boîtes de dialogue partagées (SF.forms)
// Trois <dialog> natifs : activité, cours et confirmation.
// Chacun est créé une seule fois, au premier appel, puis réutilisé.
// Les pages appellent SF.forms.* et se mettent à jour toutes seules grâce à 'data:changed'.
(function () {
  'use strict';
  window.SF = window.SF || {};

  // ============================================================
  // 1. Données fixes
  // ============================================================

  var TYPES = ['homework', 'exam', 'revision', 'project'];
  var PRIORITIES = ['low', 'medium', 'high'];
  var DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // Libellés de secours si SF.constants.LABELS ne contient pas la clé
  var FALLBACK_LABELS = {
    homework: 'Devoir', exam: 'Examen', revision: 'Révision', project: 'Projet',
    low: 'Basse', medium: 'Moyenne', high: 'Haute'
  };

  var GENERIC_ERROR = 'Une erreur est survenue. Réessayez.';

  // Les trois boîtes : null tant qu'elles n'ont pas été créées
  var activityBox = null;
  var courseBox = null;
  var confirmBox = null;

  // ============================================================
  // 2. Petits outils
  // ============================================================

  // Crée un élément ; le texte est posé avec textContent, donc jamais lu comme du HTML
  function createEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Crée un bouton qui n'envoie jamais le formulaire (type="button")
  function createButton(label, className) {
    var button = createEl('button', 'btn form-btn ' + className, label);
    button.type = 'button';
    return button;
  }

  // Libellé français d'une clé : LABELS.exam ou LABELS.type.exam → 'Examen'
  function getLabel(key) {
    var labels = (SF.constants && SF.constants.LABELS) || {};
    if (typeof labels[key] === 'string') return labels[key];
    for (var group in labels) {
      if (labels[group] && typeof labels[group][key] === 'string') return labels[group][key];
    }
    return FALLBACK_LABELS[key] || key;
  }

  // Transforme une liste de clés en options { value, label }
  function labelOptions(keys) {
    return keys.map(function (key) {
      return { value: key, label: getLabel(key) };
    });
  }

  // Affiche une notification (si elle échoue, ce n'est pas grave)
  function showToast(message, type) {
    try {
      SF.app.toast(message, type);
    } catch (error) {
      // rien à faire
    }
  }

  // Appelle onDone sans jamais laisser une erreur de la page remonter
  function callDone(onDone, result) {
    if (typeof onDone !== 'function') return;
    try {
      onDone(result);
    } catch (error) {
      console.error('SF.forms : erreur dans onDone', error);
    }
  }

  // Remplit la <datalist> avec les matières déjà utilisées
  function fillSubjects(datalist) {
    var subjects = [];
    try {
      subjects = SF.filters.getSubjects();
    } catch (error) {
      subjects = [];
    }
    datalist.textContent = '';
    if (!Array.isArray(subjects)) return;
    subjects.forEach(function (subject) {
      if (typeof subject !== 'string' || subject === '') return;
      var option = document.createElement('option');
      option.value = subject;
      datalist.appendChild(option);
    });
  }

  // Redonne le focus à l'élément qui avait ouvert la boîte (s'il est encore dans la page)
  function restoreFocus(opener) {
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
      opener.focus();
    }
  }

  // Un résultat est bon si c'est { ok: true, ... } (remove peut renvoyer simplement true)
  function isSuccess(result) {
    return result === true || (!!result && result.ok === true);
  }

  // Protège une fonction publique : en cas de problème, une notification, jamais une erreur
  function safely(name, fn) {
    return function (options) {
      try {
        fn(options || {});
      } catch (error) {
        console.error('SF.forms.' + name + ' :', error);
        showToast("Impossible d'ouvrir cette fenêtre.", 'error');
      }
    };
  }

  // ============================================================
  // 3. Construction d'une boîte de formulaire (activité ou cours)
  // ============================================================

  // Crée la saisie d'un champ : <input>, <select> ou <textarea>
  function createInput(spec) {
    var input;
    if (spec.kind === 'select') {
      input = document.createElement('select');
      spec.options.forEach(function (item) {
        var option = createEl('option', '', item.label);
        option.value = item.value;
        input.appendChild(option);
      });
    } else if (spec.kind === 'textarea') {
      input = createEl('textarea', 'form-textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = spec.kind; // text, date, time ou number
    }
    input.classList.add('form-input');
    input.autocomplete = 'off';
    if (spec.required) input.required = true;
    if (spec.list) input.setAttribute('list', spec.list);
    ['min', 'max', 'step'].forEach(function (name) {
      if (spec[name] !== undefined) input.setAttribute(name, spec[name]);
    });
    return input;
  }

  // Crée un champ complet : <label> relié (for / id), saisie, zone d'erreur (aria-live)
  function buildField(prefix, spec) {
    var id = prefix + '-' + spec.name;
    var wrap = createEl('div', spec.wide ? 'form-field form-field-wide' : 'form-field');

    var label = createEl('label', 'form-label', spec.label);
    label.htmlFor = id;
    if (spec.hint) label.appendChild(createEl('span', 'form-hint', ' (' + spec.hint + ')'));

    var input = createInput(spec);
    input.id = id;
    input.name = spec.name;

    var error = createEl('p', 'form-error');
    error.id = id + '-error';
    error.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', error.id);

    // Dès que la personne corrige le champ, son message d'erreur disparaît
    input.addEventListener('input', function () {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(error);

    var datalist = null;
    if (spec.list) {
      datalist = createEl('datalist');
      datalist.id = spec.list;
      wrap.appendChild(datalist);
    }
    return { wrap: wrap, input: input, error: error, datalist: datalist };
  }

  // Construit un <dialog> de formulaire : titre, champs, erreur générale, boutons
  function createFormBox(config) {
    var box = { fields: {}, item: null, onDone: null, opener: null, toggleBtn: null };

    box.dialog = createEl('dialog', 'form-dialog ' + config.className);
    box.dialog.id = config.id;
    box.form = createEl('form', 'form-box');
    box.form.noValidate = true; // les messages d'erreur viennent de validate, pas du navigateur

    // Titre de la boîte
    box.title = createEl('h2', 'form-title');
    box.title.id = config.id + '-heading';
    box.dialog.setAttribute('aria-labelledby', box.title.id);
    var head = createEl('div', 'form-head');
    head.appendChild(box.title);

    // Champs (deux colonnes sur grand écran, une seule sous 600 px : voir forms.css)
    box.body = createEl('div', 'form-body');
    var grid = createEl('div', 'form-grid');
    config.fields.forEach(function (spec) {
      var field = buildField(config.id, spec);
      box.fields[spec.name] = field;
      grid.appendChild(field.wrap);
    });
    box.firstInput = box.fields[config.fields[0].name].input;
    box.datalist = box.fields.subject.datalist;
    box.general = createEl('p', 'form-error form-error-general');
    box.general.setAttribute('aria-live', 'polite');
    box.body.appendChild(grid);
    box.body.appendChild(box.general);

    // Boutons : Supprimer, [Marquer comme terminée], Annuler, Ajouter / Enregistrer
    var actions = createEl('div', 'form-actions');
    box.deleteBtn = createButton('Supprimer', 'btn-ghost form-delete');
    actions.appendChild(box.deleteBtn);
    if (config.hasToggle) {
      box.toggleBtn = createButton('Marquer comme terminée', 'btn-ghost form-toggle');
      actions.appendChild(box.toggleBtn);
    }
    box.cancelBtn = createButton('Annuler', 'btn-ghost form-cancel');
    box.submitBtn = createEl('button', 'btn form-btn btn-primary form-submit', 'Ajouter');
    box.submitBtn.type = 'submit';
    actions.appendChild(box.cancelBtn);
    actions.appendChild(box.submitBtn);

    box.form.appendChild(head);
    box.form.appendChild(box.body);
    box.form.appendChild(actions);
    box.dialog.appendChild(box.form);
    document.body.appendChild(box.dialog);

    // « Annuler » ferme sans rien enregistrer (Échap fait la même chose, c'est natif)
    box.cancelBtn.addEventListener('click', function () {
      box.dialog.close();
    });
    // À la fermeture, le focus revient à l'élément qui avait ouvert la boîte
    box.dialog.addEventListener('close', function () {
      if (!box.dialog.open) restoreFocus(box.opener);
    });
    return box;
  }

  // Efface tous les messages d'erreur
  function clearErrors(box) {
    Object.keys(box.fields).forEach(function (name) {
      box.fields[name].error.textContent = '';
      box.fields[name].input.removeAttribute('aria-invalid');
    });
    box.general.textContent = '';
  }

  // Affiche les erreurs { champ: message } sous les champs ; les autres vont en bas de la boîte
  function showErrors(box, errors) {
    clearErrors(box);
    var list = (errors && typeof errors === 'object') ? errors : {};
    var names = Object.keys(list);
    var others = [];
    names.forEach(function (name) {
      var field = box.fields[name];
      if (field) {
        field.error.textContent = String(list[name]);
        field.input.setAttribute('aria-invalid', 'true');
      } else {
        others.push(String(list[name]));
      }
    });
    if (names.length === 0) others.push(GENERIC_ERROR);
    box.general.textContent = others.join(' ');

    // Le focus va sur le premier champ en erreur
    var firstInvalid = box.dialog.querySelector('[aria-invalid="true"]');
    if (firstInvalid) firstInvalid.focus();
  }

  // Remplit les champs avec les valeurs données ('' quand une valeur manque)
  function fillFields(box, values) {
    Object.keys(box.fields).forEach(function (name) {
      var input = box.fields[name].input;
      var value = values[name];
      input.value = (value === undefined || value === null) ? '' : String(value);
      if (input.tagName === 'SELECT' && input.selectedIndex < 0) input.selectedIndex = 0;
    });
  }

  // Lit les champs : { nomDuChamp: texte sans espaces inutiles }
  function readFields(box) {
    var data = {};
    Object.keys(box.fields).forEach(function (name) {
      data[name] = box.fields[name].input.value.trim();
    });
    return data;
  }

  // Désactive les boutons d'action pendant un traitement (pas de double envoi)
  function setBusy(box, busy) {
    [box.submitBtn, box.deleteBtn, box.toggleBtn].forEach(function (button) {
      if (button) button.disabled = busy;
    });
  }

  // Affiche la boîte : erreurs effacées, focus sur le premier champ
  function showBox(box) {
    clearErrors(box);
    setBusy(box, false);
    if (!box.dialog.open) {
      box.opener = document.activeElement; // pour rendre le focus à la fermeture
      box.dialog.showModal();
    }
    box.body.scrollTop = 0;
    box.firstInput.focus();
  }

  // Lance une action (add, update, remove...) puis gère le résultat : erreurs ou succès
  function runAction(box, action, message, doIt) {
    setBusy(box, true);
    var result = null;
    try {
      result = doIt();
    } catch (error) {
      console.error('SF.forms :', error);
    }
    if (!isSuccess(result)) {
      showErrors(box, result && result.errors); // la boîte reste ouverte
      setBusy(box, false);
      return;
    }
    var onDone = box.onDone;
    var item = (result && result.item) || box.item;
    box.dialog.close();
    showToast(message, 'success');
    callDone(onDone, { action: action, item: item });
  }

  // Demande confirmation (SF.forms.confirm, bouton rouge), puis exécute onYes si la réponse est oui
  function askToDelete(box, title, message, onYes) {
    box.deleteBtn.focus(); // le focus reviendra sur ce bouton après la question
    Promise.resolve(SF.forms.confirm({
      title: title,
      message: message,
      confirmLabel: 'Supprimer',
      danger: true
    })).then(function (yes) {
      if (yes) onYes();
    });
  }

  // ============================================================
  // 4. Boîte « activité »
  // ============================================================

  // Crée la boîte la première fois, puis la réutilise
  function getActivityBox() {
    if (activityBox) return activityBox;
    var box = createFormBox({
      id: 'form-activity',
      className: 'form-activity',
      hasToggle: true,
      fields: [
        { name: 'title', label: 'Titre', hint: 'obligatoire', kind: 'text', wide: true, required: true },
        { name: 'type', label: 'Type', kind: 'select', options: labelOptions(TYPES) },
        { name: 'subject', label: 'Matière', kind: 'text', list: 'form-activity-subjects' },
        { name: 'date', label: 'Date', kind: 'date' },
        { name: 'time', label: 'Heure', hint: 'facultative', kind: 'time' },
        { name: 'priority', label: 'Priorité', kind: 'select', options: labelOptions(PRIORITIES) },
        { name: 'estimatedMinutes', label: 'Durée estimée', hint: 'minutes, facultative', kind: 'number', min: 5, max: 600, step: 5 },
        { name: 'description', label: 'Description', kind: 'textarea', wide: true }
      ]
    });
    box.form.addEventListener('submit', function (event) {
      event.preventDefault(); // sinon la page se rechargerait
      saveActivity(box);
    });
    box.deleteBtn.addEventListener('click', function () { deleteActivity(box); });
    box.toggleBtn.addEventListener('click', function () { toggleActivity(box); });
    activityBox = box;
    return box;
  }

  // Valeurs de départ : l'activité à modifier, sinon defaults, sinon les valeurs par défaut
  function activityValues(options) {
    var activity = options.activity;
    if (activity) {
      return {
        title: activity.title,
        type: activity.type,
        subject: activity.subject,
        date: activity.date,
        time: activity.time,
        priority: activity.priority,
        estimatedMinutes: activity.estimatedMinutes > 0 ? activity.estimatedMinutes : '',
        description: activity.description
      };
    }
    var d = options.defaults || {};
    return {
      title: d.title,
      type: d.type || 'homework',
      subject: d.subject,
      date: d.date || SF.dates.todayISO(),
      time: d.time,
      priority: d.priority || 'medium',
      estimatedMinutes: '',
      description: d.description
    };
  }

  // Ouvre la boîte « activité » (création ou modification)
  function openActivityBox(options) {
    var box = getActivityBox();
    var editing = !!options.activity;
    box.item = options.activity || null;
    box.onDone = options.onDone;
    box.title.textContent = editing ? "Modifier l'activité" : 'Nouvelle activité';
    box.submitBtn.textContent = editing ? 'Enregistrer' : 'Ajouter';
    box.deleteBtn.hidden = !editing;
    box.toggleBtn.hidden = !editing;
    if (editing) {
      box.toggleBtn.textContent = box.item.status === 'done' ? 'Rouvrir' : 'Marquer comme terminée';
    }
    fillSubjects(box.datalist);
    fillFields(box, activityValues(options));
    showBox(box);
  }

  // « Ajouter » ou « Enregistrer » : SF.activities.add ou SF.activities.update
  function saveActivity(box) {
    var data = readFields(box);
    // Durée facultative : un nombre si elle est remplie, sinon on n'envoie rien
    // (null seulement pour effacer une durée déjà enregistrée)
    if (data.estimatedMinutes !== '') {
      data.estimatedMinutes = Number(data.estimatedMinutes);
    } else if (box.item && box.item.estimatedMinutes) {
      data.estimatedMinutes = null;
    } else {
      delete data.estimatedMinutes;
    }

    if (box.item) {
      runAction(box, 'updated', 'Activité enregistrée.', function () {
        return SF.activities.update(box.item.id, data);
      });
    } else {
      runAction(box, 'created', 'Activité ajoutée.', function () {
        return SF.activities.add(data);
      });
    }
  }

  // « Marquer comme terminée » ou « Rouvrir » (les autres champs ne sont pas enregistrés)
  function toggleActivity(box) {
    if (!box.item) return;
    var id = box.item.id;
    if (box.item.status === 'done') {
      runAction(box, 'reopened', 'Activité rouverte.', function () {
        return SF.activities.reopen(id);
      });
    } else {
      runAction(box, 'completed', 'Activité terminée.', function () {
        return SF.activities.complete(id);
      });
    }
  }

  // « Supprimer » : confirmation d'abord, puis SF.activities.remove
  function deleteActivity(box) {
    if (!box.item) return;
    var id = box.item.id;
    var message = 'Supprimer « ' + box.item.title + ' » ? Cette action est définitive.';
    askToDelete(box, "Supprimer l'activité", message, function () {
      runAction(box, 'deleted', 'Activité supprimée.', function () {
        return SF.activities.remove(id);
      });
    });
  }

  // ============================================================
  // 5. Boîte « cours »
  // ============================================================

  // Crée la boîte la première fois, puis la réutilise
  function getCourseBox() {
    if (courseBox) return courseBox;
    var days = DAYS.map(function (name, index) {
      return { value: String(index + 1), label: name }; // 1 = lundi ... 7 = dimanche
    });
    var box = createFormBox({
      id: 'form-course',
      className: 'form-course',
      hasToggle: false,
      fields: [
        { name: 'subject', label: 'Matière', hint: 'obligatoire', kind: 'text', required: true, list: 'form-course-subjects' },
        { name: 'weekday', label: 'Jour', kind: 'select', options: days },
        { name: 'startTime', label: 'Début', kind: 'time' },
        { name: 'endTime', label: 'Fin', kind: 'time' },
        { name: 'room', label: 'Salle', kind: 'text' },
        { name: 'teacher', label: 'Enseignant', kind: 'text' },
        { name: 'validFrom', label: 'Valide à partir du', hint: 'facultatif', kind: 'date' },
        { name: 'validTo', label: "Jusqu'au", hint: 'facultatif', kind: 'date' }
      ]
    });
    box.form.addEventListener('submit', function (event) {
      event.preventDefault();
      saveCourse(box);
    });
    box.deleteBtn.addEventListener('click', function () { deleteCourse(box); });
    courseBox = box;
    return box;
  }

  // Valeurs de départ : le cours à modifier, sinon defaults, sinon lundi 08:00-09:00
  function courseValues(options) {
    if (options.course) return options.course; // mêmes noms que les champs
    var d = options.defaults || {};
    return {
      subject: d.subject,
      weekday: d.weekday || 1,
      startTime: d.startTime || '08:00',
      endTime: d.endTime || '09:00'
    };
  }

  // Ouvre la boîte « cours » (création ou modification)
  function openCourseBox(options) {
    var box = getCourseBox();
    var editing = !!options.course;
    box.item = options.course || null;
    box.onDone = options.onDone;
    box.title.textContent = editing ? 'Modifier le cours' : 'Nouveau cours';
    box.submitBtn.textContent = editing ? 'Enregistrer' : 'Ajouter';
    box.deleteBtn.hidden = !editing;
    fillSubjects(box.datalist);
    fillFields(box, courseValues(options));
    showBox(box);
  }

  // « Ajouter » ou « Enregistrer » : SF.timetable.add ou SF.timetable.update
  function saveCourse(box) {
    var data = readFields(box);
    data.weekday = Number(data.weekday);
    if (box.item) {
      runAction(box, 'updated', 'Cours enregistré.', function () {
        return SF.timetable.update(box.item.id, data);
      });
    } else {
      runAction(box, 'created', 'Cours ajouté.', function () {
        return SF.timetable.add(data);
      });
    }
  }

  // « Supprimer » : confirmation d'abord, puis SF.timetable.remove
  function deleteCourse(box) {
    if (!box.item) return;
    var id = box.item.id;
    askToDelete(box, 'Supprimer le cours', 'Supprimer ce cours pour toutes les semaines ?', function () {
      runAction(box, 'deleted', 'Cours supprimé.', function () {
        return SF.timetable.remove(id);
      });
    });
  }

  // ============================================================
  // 6. Boîte de confirmation
  // ============================================================

  // Crée la boîte la première fois, puis la réutilise
  function getConfirmBox() {
    if (confirmBox) return confirmBox;
    var box = { resolve: null, answer: false, opener: null };

    box.dialog = createEl('dialog', 'form-dialog form-confirm');
    box.dialog.id = 'form-confirm';
    box.dialog.setAttribute('role', 'alertdialog');
    box.title = createEl('h2', 'form-title');
    box.title.id = 'form-confirm-heading';
    box.message = createEl('p', 'form-message');
    box.message.id = 'form-confirm-message';
    box.dialog.setAttribute('aria-labelledby', box.title.id);
    box.dialog.setAttribute('aria-describedby', box.message.id);

    box.cancelBtn = createButton('Annuler', 'btn-ghost form-cancel');
    box.okBtn = createButton('Confirmer', 'form-ok btn-primary');

    var wrap = createEl('div', 'form-box');
    var head = createEl('div', 'form-head');
    var body = createEl('div', 'form-body');
    var actions = createEl('div', 'form-actions');
    head.appendChild(box.title);
    body.appendChild(box.message);
    actions.appendChild(box.cancelBtn);
    actions.appendChild(box.okBtn);
    wrap.appendChild(head);
    wrap.appendChild(body);
    wrap.appendChild(actions);
    box.dialog.appendChild(wrap);
    document.body.appendChild(box.dialog);

    box.cancelBtn.addEventListener('click', function () {
      box.dialog.close();
    });
    box.okBtn.addEventListener('click', function () {
      box.answer = true;
      box.dialog.close();
    });
    // Boîte fermée (bouton ou Échap) : on rend le focus, puis on répond à la promesse
    box.dialog.addEventListener('close', function () {
      if (box.dialog.open) return;
      var resolve = box.resolve;
      box.resolve = null;
      restoreFocus(box.opener);
      if (resolve) resolve(box.answer);
    });
    confirmBox = box;
    return box;
  }

  // SF.forms.confirm({ title, message, confirmLabel, danger }) → Promise<boolean>
  function confirmAsk(options) {
    return new Promise(function (resolve) {
      try {
        var opts = options || {};
        var box = getConfirmBox();
        if (box.resolve) box.resolve(false); // une question était déjà ouverte : on la compte refusée
        box.resolve = resolve;
        box.answer = false; // seul le bouton de confirmation met true
        box.title.textContent = opts.title || 'Confirmation';
        box.message.textContent = opts.message || '';
        box.okBtn.textContent = opts.confirmLabel || 'Confirmer';
        box.okBtn.className = 'btn form-btn form-ok ' + (opts.danger ? 'form-danger' : 'btn-primary');
        if (!box.dialog.open) {
          box.opener = document.activeElement;
          box.dialog.showModal();
        }
        // Question dangereuse : le focus est sur « Annuler »
        (opts.danger ? box.cancelBtn : box.okBtn).focus();
      } catch (error) {
        console.error('SF.forms.confirm :', error);
        resolve(false);
      }
    });
  }

  // ============================================================
  // 7. Fonctions publiques
  // ============================================================

  SF.forms = {
    openActivity: safely('openActivity', openActivityBox),
    openCourse: safely('openCourse', openCourseBox),
    confirm: confirmAsk
  };
})();