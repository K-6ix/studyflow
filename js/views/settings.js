(function () {
    'use strict';
    window.SF = window.SF || {};

    // Valeurs par défaut (bouton « Valeurs par défaut »)
    var DEFAULTS = { dailyGoalMinutes: 120, dayStart: '08:00', dayEnd: '21:00', minSessionMinutes: 30, maxSessionMinutes: 90 };

    // Champs du formulaire : nom du réglage -> clé interne
    var KEYS = { dailyGoalMinutes: 'goal', dayStart: 'start', dayEnd: 'end', minSessionMinutes: 'min', maxSessionMinutes: 'max' };

    var inputs = {};      // les <input> du formulaire
    var errorEls = {};    // les messages d'erreur sous chaque champ
    var countEls = {};    // les compteurs du résumé
    var formError, banner, importError, fileInput;
    var aiKeyInput, aiModelInput, aiStatus, aiMessage;   // carte « Lecture par IA »
    var dirty = false;    // vrai si l'utilisateur a modifié un champ sans enregistrer

    // Petit outil pour créer un élément
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function toast(message, type) {
        try { SF.app.toast(message, type || 'info'); } catch (e) { /* on ignore */ }
    }

    // Confirmation : SF.forms.confirm, ou confirm() du navigateur en secours
    function askConfirm(options) {
        try {
            if (SF.forms && SF.forms.confirm) return SF.forms.confirm(options);
        } catch (e) { /* on passe au secours */ }
        return Promise.resolve(window.confirm(options.message));
    }

    // Nombre d'éléments d'une collection (0 si erreur)
    function countOf(getter) {
        try { return getter().length; } catch (e) { return 0; }
    }

    function getCounts() {
        return {
            courses: countOf(function () { return SF.timetable.getAll(); }),
            activities: countOf(function () { return SF.activities.getAll(); }),
            goals: countOf(function () { return SF.planner.getGoals(); }),
            sessions: countOf(function () { return SF.storage.load('sessions'); })
        };
    }

    // Crée un champ (label + input + message d'erreur)
    function addField(parent, key, label, attrs) {
        var wrap = el('div', 'settings-field');
        var id = 'settings-' + key;
        var lab = el('label', 'settings-label', label);
        lab.setAttribute('for', id);
        var input = el('input', 'settings-input');
        input.id = id;
        Object.keys(attrs).forEach(function (name) { input.setAttribute(name, attrs[name]); });
        input.setAttribute('aria-describedby', id + '-error');
        input.addEventListener('input', function () { dirty = true; });
        var err = el('p', 'settings-error');
        err.id = id + '-error';
        wrap.appendChild(lab); wrap.appendChild(input); wrap.appendChild(err);
        parent.appendChild(wrap);
        inputs[key] = input;
        errorEls[key] = err;
    }

    function clearErrors() {
        Object.keys(errorEls).forEach(function (key) {
            errorEls[key].textContent = '';
            inputs[key].removeAttribute('aria-invalid');
        });
        formError.textContent = '';
    }

    // Affiche les erreurs { champ: message } sous les bons champs
    function showErrors(errors) {
        clearErrors();
        Object.keys(errors).forEach(function (name) {
            var key = KEYS[name];
            if (key) {
                errorEls[key].textContent = errors[name];
                inputs[key].setAttribute('aria-invalid', 'true');
            } else {
                formError.textContent = errors[name];
            }
        });
    }

    // Lit le formulaire et vérifie les cas simples ; renvoie { patch, errors }
    function readForm() {
        var errors = {};
        var patch = {};
        var hours = parseFloat(String(inputs.goal.value).replace(',', '.'));
        var min = parseInt(inputs.min.value, 10);
        var max = parseInt(inputs.max.value, 10);

        if (isNaN(hours) || hours <= 0) errors.dailyGoalMinutes = "L'objectif doit être supérieur à 0 h.";
        else patch.dailyGoalMinutes = Math.round(hours * 60);

        if (!SF.dates.isValidTime(inputs.start.value)) errors.dayStart = 'Choisis une heure de début.';
        if (!SF.dates.isValidTime(inputs.end.value)) errors.dayEnd = 'Choisis une heure de fin.';
        if (!errors.dayStart && !errors.dayEnd &&
            SF.dates.timeToMinutes(inputs.start.value) >= SF.dates.timeToMinutes(inputs.end.value)) {
            errors.dayEnd = 'La fin de journée doit être après le début.';
        }
        patch.dayStart = inputs.start.value;
        patch.dayEnd = inputs.end.value;

        if (isNaN(min) || min <= 0) errors.minSessionMinutes = 'Entre une durée en minutes (au moins 1).';
        else patch.minSessionMinutes = min;
        if (isNaN(max) || max <= 0) errors.maxSessionMinutes = 'Entre une durée en minutes (au moins 1).';
        else patch.maxSessionMinutes = max;
        if (!errors.minSessionMinutes && !errors.maxSessionMinutes && min > max) {
            errors.maxSessionMinutes = 'La durée maximale doit être supérieure ou égale à la minimale.';
        }
        return { patch: patch, errors: errors };
    }

    function saveSettings(event) {
        event.preventDefault();
        try {
            var data = readForm();
            if (Object.keys(data.errors).length) { showErrors(data.errors); return; }
            var result = SF.storage.updateSettings(data.patch);
            if (!result.ok) { showErrors(result.errors || {}); return; }
            clearErrors();
            dirty = false;
            render();
            toast('Réglages enregistrés.', 'success');
        } catch (e) {
            toast("Impossible d'enregistrer les réglages.", 'error');
        }
    }

    function resetSettings() {
        askConfirm({
            title: 'Valeurs par défaut ?',
            message: 'Remettre 2 h, 08:00, 21:00, 30 min et 90 min ?',
            confirmLabel: 'Remettre'
        }).then(function (yes) {
            if (!yes) return;
            var result = SF.storage.updateSettings(DEFAULTS);
            if (!result.ok) { showErrors(result.errors || {}); return; }
            clearErrors();
            dirty = false;
            render();
            toast('Valeurs par défaut rétablies.', 'success');
        }).catch(function () { toast('Une erreur est survenue.', 'error'); });
    }

    // ----- Données -----

    function exportData() {
        try {
            var text = SF.storage.exportJSON();
            if (typeof text !== 'string') text = JSON.stringify(text, null, 2);
            var blob = new Blob([text], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'studyflow-' + SF.dates.todayISO() + '.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            toast('Export terminé.', 'success');
        } catch (e) {
            toast("L'export a échoué.", 'error');
        }
    }

    function showImportError(message) {
        importError.textContent = message;
        fileInput.value = '';
    }

    function runImport(text) {
        askConfirm({
            title: 'Remplacer mes données ?',
            message: "L'import remplace toutes les données actuelles.",
            confirmLabel: 'Importer',
            danger: true
        }).then(function (yes) {
            if (!yes) { fileInput.value = ''; return; }
            var result = SF.storage.importJSON(text);
            if (!result || !result.ok) {
                showImportError((result && result.error) || "Ce fichier n'est pas une sauvegarde StudyFlow.");
                return;
            }
            fileInput.value = '';
            var c = result.counts || {};
            toast('Import réussi : ' + (c.courses || 0) + ' cours, ' + (c.activities || 0) +
                ' activités, ' + (c.goals || 0) + ' objectifs, ' + (c.sessions || 0) + ' sessions.', 'success');
            render();
        }).catch(function () { showImportError("L'import a échoué."); });
    }

    function onFileChosen() {
        importError.textContent = '';
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
            var reader = new FileReader();
            reader.onload = function () { runImport(String(reader.result || '')); };
            reader.onerror = function () { showImportError('Impossible de lire ce fichier.'); };
            reader.readAsText(file);
        } catch (e) {
            showImportError('Impossible de lire ce fichier.');
        }
    }

    function clearData() {
        askConfirm({
            title: 'Tout effacer ?',
            message: 'Cette action supprime tous tes cours, activités, objectifs et sessions.',
            confirmLabel: 'Tout effacer',
            danger: true
        }).then(function (yes) {
            if (!yes) return;
            SF.storage.clearAll();
            toast('Toutes les données ont été effacées.', 'success');
            render();
        }).catch(function () { toast('Une erreur est survenue.', 'error'); });
    }

    // ----- Affichage -----

    // Met à jour le résumé et les champs (sans écraser une saisie en cours)
    function render() {
        try {
            if (!banner) return; // la vue n'est pas encore construite
            var c = getCounts();
            countEls.courses.textContent = c.courses;
            countEls.activities.textContent = c.activities;
            countEls.goals.textContent = c.goals;
            countEls.sessions.textContent = c.sessions;
            banner.hidden = SF.storage.isAvailable();

            if (dirty) return;
            var s = SF.storage.getSettings();
            inputs.goal.value = String(Math.round(s.dailyGoalMinutes / 60 * 100) / 100);
            inputs.start.value = s.dayStart;
            inputs.end.value = s.dayEnd;
            inputs.min.value = s.minSessionMinutes;
            inputs.max.value = s.maxSessionMinutes;
        } catch (e) { /* jamais d'erreur visible */ }
    }

    function addCount(list, key, label) {
        var item = el('li', 'settings-summary-item');
        countEls[key] = el('span', 'settings-count', '0');
        item.appendChild(countEls[key]);
        item.appendChild(el('span', 'settings-count-label', label));
        list.appendChild(item);
    }

    function addButton(parent, className, text, handler) {
        var btn = el('button', className, text);
        btn.type = 'button';
        btn.addEventListener('click', handler);
        parent.appendChild(btn);
        return btn;
    }

    function buildGoalCard(page) {
        var card = el('section', 'card settings-section');
        card.appendChild(el('h3', 'card-title', 'Objectif et horaires'));
        var form = el('form', 'settings-form');
        form.noValidate = true;
        form.addEventListener('submit', saveSettings);

        var grid = el('div', 'settings-grid');
        addField(grid, 'goal', 'Objectif par jour (heures)', { type: 'number', step: '0.25', min: '0' });
        addField(grid, 'start', "Début de la journée d'étude", { type: 'time' });
        addField(grid, 'end', "Fin de la journée d'étude", { type: 'time' });
        addField(grid, 'min', 'Durée minimale (min)', { type: 'number', step: '5', min: '1' });
        addField(grid, 'max', 'Durée maximale (min)', { type: 'number', step: '5', min: '1' });
        form.appendChild(grid);

        formError = el('p', 'settings-error');
        formError.setAttribute('role', 'alert');
        form.appendChild(formError);

        var actions = el('div', 'settings-actions');
        var save = el('button', 'btn btn-primary', 'Enregistrer');
        save.type = 'submit';
        actions.appendChild(save);
        addButton(actions, 'btn btn-ghost', 'Valeurs par défaut', resetSettings);
        form.appendChild(actions);
        card.appendChild(form);
        page.appendChild(card);
    }

    // ----- Carte « Lecture par IA (Gemini) » -----
    function refreshAiStatus() {
        if (!aiStatus || !SF.aiReader) return;
        aiStatus.textContent = SF.aiReader.hasKey()
            ? 'Clé enregistrée : ' + SF.aiReader.maskedKey()
            : 'Aucune clé enregistrée.';
        if (aiModelInput) aiModelInput.value = SF.aiReader.getModel();
    }

    function setAiMessage(text, isError) {
        if (!aiMessage) return;
        aiMessage.textContent = text || '';
        aiMessage.className = isError ? 'settings-error' : 'settings-ai-ok';
    }

    function saveAiKey() {
        var value = aiKeyInput.value.trim();
        if (value && value.length < 20) {
            setAiMessage('Cette clé semble trop courte. Copie-la en entier depuis Google AI Studio.', true);
            return;
        }
        if (value) SF.aiReader.setKey(value);
        SF.aiReader.setModel(aiModelInput.value);
        aiKeyInput.value = '';
        refreshAiStatus();
        if (!value && !SF.aiReader.hasKey()) {
            setAiMessage('Colle ta clé dans le champ avant d’enregistrer.', true);
            return;
        }
        setAiMessage('Enregistré. Tu peux tester la clé.', false);
        toast('Réglages IA enregistrés.', 'success');
    }

    function testAiKey(button) {
        var typed = aiKeyInput.value.trim();
        if (!typed && !SF.aiReader.hasKey()) {
            setAiMessage('Colle d’abord ta clé API.', true);
            return;
        }
        var oldText = button.textContent;
        button.disabled = true;
        button.textContent = 'Test en cours…';
        setAiMessage('', false);
        SF.aiReader.testKey(typed || undefined).then(function () {
            setAiMessage('La clé fonctionne.', false);
            toast('La clé fonctionne.', 'success');
        }).catch(function (error) {
            setAiMessage(error && error.message ? error.message : 'Le test a échoué.', true);
        }).then(function () {
            button.disabled = false;
            button.textContent = oldText;
        });
    }

    function removeAiKey() {
        askConfirm({
            title: 'Supprimer la clé ?',
            message: 'La clé sera retirée de ce navigateur. Tu pourras en coller une autre quand tu veux.',
            confirmLabel: 'Supprimer',
            danger: true
        }).then(function (yes) {
            if (!yes) return;
            SF.aiReader.clearKey();
            aiKeyInput.value = '';
            refreshAiStatus();
            setAiMessage('Clé supprimée.', false);
        }).catch(function () { toast('Une erreur est survenue.', 'error'); });
    }

    function buildAiCard(page) {
        if (!SF.aiReader) return;
        var card = el('section', 'card settings-section');
        card.appendChild(el('h3', 'card-title', 'Lecture par IA (Gemini)'));
        card.appendChild(el('p', 'settings-help', "Colle ici ta clé API gratuite : l'import d'emploi du temps lira tes photos, captures et PDF avec l'IA de Google."));

        var link = el('a', 'settings-link', 'Obtenir une clé gratuite (Google AI Studio)');
        link.href = 'https://aistudio.google.com/apikey';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        card.appendChild(link);

        aiStatus = el('p', 'settings-ai-status');
        card.appendChild(aiStatus);

        var wrap = el('div', 'settings-field');
        var lab = el('label', 'settings-label', 'Clé API');
        lab.setAttribute('for', 'settings-ai-key');
        aiKeyInput = el('input', 'settings-input');
        aiKeyInput.id = 'settings-ai-key';
        aiKeyInput.type = 'password';
        aiKeyInput.autocomplete = 'off';
        aiKeyInput.spellcheck = false;
        aiKeyInput.placeholder = 'Colle ta clé ici';
        wrap.appendChild(lab);
        wrap.appendChild(aiKeyInput);
        card.appendChild(wrap);

        var details = el('details', 'settings-ai-details');
        details.appendChild(el('summary', '', 'Options avancées'));
        var mwrap = el('div', 'settings-field');
        var mlab = el('label', 'settings-label', "Nom du modèle (laisse vide pour le choix automatique)");
        mlab.setAttribute('for', 'settings-ai-model');
        aiModelInput = el('input', 'settings-input');
        aiModelInput.id = 'settings-ai-model';
        aiModelInput.type = 'text';
        aiModelInput.placeholder = 'gemini-3.5-flash-lite';
        mwrap.appendChild(mlab);
        mwrap.appendChild(aiModelInput);
        details.appendChild(mwrap);
        card.appendChild(details);

        aiMessage = el('p', 'settings-ai-ok');
        aiMessage.setAttribute('role', 'alert');
        card.appendChild(aiMessage);

        var actions = el('div', 'settings-actions');
        addButton(actions, 'btn btn-primary', 'Enregistrer', saveAiKey);
        var testBtn = addButton(actions, 'btn btn-ghost', 'Tester la clé', function () { testAiKey(testBtn); });
        addButton(actions, 'btn btn-ghost', 'Supprimer la clé', removeAiKey);
        card.appendChild(actions);

        card.appendChild(el('p', 'settings-help', "La clé reste sur cet appareil et n'est jamais exportée avec tes données. Ne la partage avec personne. Sur l'offre gratuite, Google peut utiliser les fichiers envoyés pour améliorer ses produits."));
        page.appendChild(card);
        refreshAiStatus();
    }

    function buildDataCard(page) {
        var card = el('section', 'card settings-section');
        card.appendChild(el('h3', 'card-title', 'Mes données'));

        banner = el('div', 'settings-banner', 'Le stockage du navigateur est bloqué : tes données seront perdues à la fermeture de la page.');
        banner.setAttribute('role', 'alert');
        banner.hidden = true;
        card.appendChild(banner);

        var list = el('ul', 'settings-summary');
        addCount(list, 'courses', 'Cours');
        addCount(list, 'activities', 'Activités');
        addCount(list, 'goals', 'Objectifs');
        addCount(list, 'sessions', 'Sessions');
        card.appendChild(list);

        var exp = el('div', 'settings-block');
        exp.appendChild(el('h4', 'settings-block-title', 'Exporter'));
        exp.appendChild(el('p', 'settings-help', 'Télécharge une sauvegarde de toutes tes données.'));
        var expActions = el('div', 'settings-actions');
        addButton(expActions, 'btn', 'Exporter mes données', exportData);
        exp.appendChild(expActions);
        card.appendChild(exp);

        var imp = el('div', 'settings-block');
        imp.appendChild(el('h4', 'settings-block-title', 'Importer'));
        imp.appendChild(el('p', 'settings-help', 'Choisis un fichier .json exporté depuis StudyFlow.'));
        fileInput = el('input', 'settings-file');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.setAttribute('aria-label', 'Importer un fichier de sauvegarde');
        fileInput.addEventListener('change', onFileChosen);
        imp.appendChild(fileInput);
        importError = el('p', 'settings-error');
        importError.setAttribute('role', 'alert');
        imp.appendChild(importError);
        card.appendChild(imp);

        page.appendChild(card);
    }

    function buildDangerCard(page) {
        var card = el('section', 'card settings-section settings-danger');
        card.appendChild(el('h3', 'card-title settings-danger-title', 'Zone dangereuse'));
        card.appendChild(el('p', 'settings-help', 'Supprime définitivement tout ce que tu as enregistré.'));
        var actions = el('div', 'settings-actions');
        addButton(actions, 'settings-danger-btn', 'Tout effacer', clearData);
        card.appendChild(actions);
        page.appendChild(card);
    }

    function buildAboutCard(page) {
        var card = el('section', 'card settings-section settings-about');
        card.appendChild(el('h3', 'card-title', 'À propos'));
        card.appendChild(el('p', '', 'StudyFlow · Version 2'));
        card.appendChild(el('p', '', 'Tes données restent dans ce navigateur.'));
        var tip = el('p', '', 'Raccourci : ');
        tip.appendChild(el('kbd', 'settings-kbd', 'Ctrl+K'));
        card.appendChild(tip);
        page.appendChild(card);
    }

    // Carte « Compte et sauvegarde en ligne » (fournie par js/auth.js), tout en haut de la page.
    // Elle est refaite à chaque changement (connexion, déconnexion, état de synchro).
    function buildAuthCard(page) {
        if (!SF.auth || typeof SF.auth.buildSettingsCard !== 'function') return;
        var host = el('div', 'settings-auth-host');
        page.appendChild(host);

        function renderAuthCard() {
            host.innerHTML = '';
            try { host.appendChild(SF.auth.buildSettingsCard()); }
            catch (e) { /* si la carte plante, le reste des réglages continue de marcher */ }
        }

        renderAuthCard();
        SF.auth.onChange(renderAuthCard);
    }

    // Construit la page UNE seule fois
    function mount(container) {
        var page = el('div', 'settings-page');
        var head = el('div', '');
        head.appendChild(el('h2', 'settings-title', 'Réglages'));
        head.appendChild(el('p', 'settings-intro', "Ton objectif, tes horaires et tes données."));
        page.appendChild(head);

        buildAuthCard(page);
        buildGoalCard(page);
        buildAiCard(page);
        buildDataCard(page);
        buildDangerCard(page);
        buildAboutCard(page);
        container.appendChild(page);

        SF.events.on('data:changed', render);
        render();
    }

    function onShow() { render(); }

    SF.app.registerView('settings', { mount: mount, onShow: onShow });
})();