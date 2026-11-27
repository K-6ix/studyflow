(function () {
    'use strict';

    window.SF = window.SF || {};
    var SF = window.SF;

    var MAX_FILE_SIZE = 20 * 1024 * 1024;
    var WEEKDAYS = [
        'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'
    ];

    var state = {
        dialog: null,
        created: false,
        opener: null,
        screen: 'choose',
        activeTab: 'file',
        file: null,
        previewUrl: '',
        fileError: '',
        textError: '',
        text: '',
        sourceKind: 'file',
        useAI: false,
        extraction: null,
        parseResult: null,
        mode: 'weekly',
        validFrom: '',
        validTo: '',
        weekStart: '',
        weekStartError: '',
        needsWeekStart: false,
        rows: [],
        progressLabel: 'Chargement de la bibliothèque…',
        progressPercent: 0,
        analysisError: '',
        importErrors: [],
        pendingRowIndexes: [],
        requestToken: 0
    };

    // Crée un élément HTML sans interpréter le texte reçu.
    function makeElement(tagName, className, text) {
        var node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    // Crée un bouton accessible avec une action déléguée.
    function makeButton(label, action, className) {
        var button = makeElement('button', className || 'imp-button', label);
        button.type = 'button';
        button.dataset.action = action;
        return button;
    }

    // Affiche un message via le système de notifications de StudyFlow.
    function toast(message) {
        try {
            if (SF.app && typeof SF.app.toast === 'function') {
                SF.app.toast(message);
            }
        } catch (error) {
            // Une notification ne doit jamais empêcher l'assistant de fonctionner.
        }
    }

    // Renvoie la date locale du jour au format ISO.
    function todayISO() {
        if (SF.dates && typeof SF.dates.todayISO === 'function') {
            return SF.dates.todayISO();
        }
        var now = new Date();
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var day = String(now.getDate()).padStart(2, '0');
        return now.getFullYear() + '-' + month + '-' + day;
    }

    // Calcule le prochain lundi en utilisant les fonctions de dates de StudyFlow.
    function nextMondayISO() {
        var today = todayISO();
        var monday = SF.dates.startOfWeek(today);
        return SF.dates.addDays(monday, 7);
    }

    // Libère l'aperçu temporaire de l'image sélectionnée.
    function releasePreview() {
        if (state.previewUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
            try {
                window.URL.revokeObjectURL(state.previewUrl);
            } catch (error) {
                // L'URL peut déjà avoir été libérée par le navigateur.
            }
        }
        state.previewUrl = '';
    }

    // Réinitialise toutes les données propres à une ouverture.
    function resetState() {
        state.requestToken += 1;
        releasePreview();
        state.screen = 'choose';
        state.activeTab = 'file';
        state.file = null;
        state.fileError = '';
        state.textError = '';
        state.text = '';
        state.sourceKind = 'file';
        state.useAI = false;
        state.extraction = null;
        state.parseResult = null;
        state.mode = 'weekly';
        state.validFrom = '';
        state.validTo = '';
        state.weekStart = nextMondayISO();
        state.weekStartError = '';
        state.needsWeekStart = false;
        state.rows = [];
        state.progressLabel = 'Chargement de la bibliothèque…';
        state.progressPercent = 0;
        state.analysisError = '';
        state.importErrors = [];
        state.pendingRowIndexes = [];
    }

    // Construit le dialogue natif une seule fois et installe ses écouteurs.
    function ensureDialog() {
        if (state.created && state.dialog) return;

        var dialog = document.createElement('dialog');
        dialog.className = 'imp-dialog';
        dialog.id = 'sf-import-dialog';
        dialog.setAttribute('aria-labelledby', 'imp-dialog-title');
        dialog.addEventListener('click', handleClick);
        dialog.addEventListener('input', handleInput);
        dialog.addEventListener('change', handleChange);
        dialog.addEventListener('keydown', handleKeydown);
        dialog.addEventListener('dragover', handleDragOver);
        dialog.addEventListener('dragleave', handleDragLeave);
        dialog.addEventListener('drop', handleDrop);
        dialog.addEventListener('cancel', function () {
            state.requestToken += 1;
        });
        dialog.addEventListener('close', handleDialogClose);

        document.addEventListener('paste', handlePaste);
        (document.body || document.documentElement).appendChild(dialog);

        state.dialog = dialog;
        state.created = true;
    }

    // Restaure le focus et libère les ressources lorsque le dialogue se ferme.
    function handleDialogClose() {
        state.requestToken += 1;
        releasePreview();
        var opener = state.opener;
        state.opener = null;
        if (opener && typeof opener.focus === 'function' && opener.isConnected) {
            opener.focus();
        }
    }

    // Prépare la structure commune d'un écran de l'assistant.
    function renderFrame(title, step) {
        var shell = makeElement('div', 'imp-shell');
        var header = makeElement('header', 'imp-header');
        var headingGroup = makeElement('div', 'imp-header-text');
        var heading = makeElement('h2', 'imp-title', title);
        heading.id = 'imp-dialog-title';
        var stepText = makeElement('p', 'imp-step', step + ' / 4');
        headingGroup.appendChild(heading);
        headingGroup.appendChild(stepText);
        header.appendChild(headingGroup);
        header.appendChild(makeButton('Fermer', 'cancel', 'imp-close-button'));

        var body = makeElement('main', 'imp-body');
        var footer = makeElement('footer', 'imp-footer');
        // Mise en page forcée ici : l'en-tête et le pied restent visibles, seul le corps défile.
        state.dialog.style.colorScheme = 'light';
        shell.style.cssText = 'display:flex;flex-direction:column;width:100%;min-height:0;max-height:min(90vh,900px);overflow:hidden';
        header.style.flex = '0 0 auto';
        body.style.cssText = 'display:block;flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:16px 24px 20px';
        footer.style.cssText = 'display:flex;flex:0 0 auto;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;padding:14px 24px;border-top:1px solid #dce2e9;background:#fff';
        shell.appendChild(header);
        shell.appendChild(body);
        shell.appendChild(footer);
        state.dialog.replaceChildren(shell);
        return { body: body, footer: footer };
    }

    // Affiche l'écran de choix du fichier ou de saisie d'un texte.
    function renderChoose() {
        state.screen = 'choose';
        var frame = renderFrame('Importer un emploi du temps', 1);
        var tabs = makeElement('div', 'imp-tabs');
        tabs.setAttribute('role', 'tablist');

        var fileTab = makeButton('Fichier ou image', 'tab-file', 'imp-tab-button');
        fileTab.setAttribute('role', 'tab');
        fileTab.setAttribute('aria-selected', state.activeTab === 'file' ? 'true' : 'false');
        fileTab.classList.toggle('imp-is-active', state.activeTab === 'file');
        var textTab = makeButton('Coller du texte', 'tab-text', 'imp-tab-button');
        textTab.setAttribute('role', 'tab');
        textTab.setAttribute('aria-selected', state.activeTab === 'text' ? 'true' : 'false');
        textTab.classList.toggle('imp-is-active', state.activeTab === 'text');
        tabs.appendChild(fileTab);
        tabs.appendChild(textTab);
        frame.body.appendChild(tabs);

        if (state.activeTab === 'file') {
            renderFilePanel(frame.body);
        } else {
            renderTextPanel(frame.body);
        }

        frame.footer.appendChild(makeButton('Annuler', 'cancel', 'imp-button imp-button-secondary'));
        var focusTarget = frame.body.querySelector('button, textarea, input');
        if (focusTarget) focusTarget.focus();
    }

    // Construit la zone de dépôt, le sélecteur de fichier et l'aperçu.
    function renderFilePanel(parent) {
        var panel = makeElement('section', 'imp-file-panel');
        var zone = makeElement('div', 'imp-dropzone');
        zone.dataset.role = 'dropzone';
        zone.tabIndex = 0;
        zone.setAttribute('role', 'button');
        zone.setAttribute('aria-label', 'Déposer un fichier ou choisir un fichier');
        var icon = makeElement('span', 'imp-drop-icon', '↥');
        icon.setAttribute('aria-hidden', 'true');
        var title = makeElement('strong', 'imp-drop-title', 'Dépose ton emploi du temps ici');
        var help = makeElement('p', 'imp-help', 'Une capture d’écran, une photo ou un PDF de ton emploi du temps.');
        var chooseButton = makeButton('Choisir un fichier', 'choose-file', 'imp-button imp-button-primary');
        zone.appendChild(icon);
        zone.appendChild(title);
        zone.appendChild(help);
        zone.appendChild(chooseButton);
        panel.appendChild(zone);

        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,.pdf,application/pdf';
        fileInput.className = 'imp-file-input';
        fileInput.setAttribute('aria-label', 'Choisir une image ou un PDF');
        fileInput.dataset.role = 'file-input';
        panel.appendChild(fileInput);

        if (state.file) {
            var preview = makeElement('div', 'imp-file-preview');
            if (state.previewUrl) {
                var image = makeElement('img', 'imp-preview-image');
                image.src = state.previewUrl;
                image.alt = 'Aperçu du fichier ' + state.file.name;
                preview.appendChild(image);
            } else {
                var pdfIcon = makeElement('span', 'imp-file-type-icon', 'PDF');
                pdfIcon.setAttribute('aria-hidden', 'true');
                preview.appendChild(pdfIcon);
            }
            var fileInfo = makeElement('div', 'imp-file-info');
            fileInfo.appendChild(makeElement('strong', 'imp-file-name', state.file.name));
            fileInfo.appendChild(makeElement('span', 'imp-file-size', formatFileSize(state.file.size)));
            preview.appendChild(fileInfo);
            preview.appendChild(makeButton('Retirer', 'remove-file', 'imp-button imp-button-quiet'));
            panel.appendChild(preview);
            var aiReady = !!(SF.aiReader && SF.aiReader.hasKey());
            if (aiReady) {
                panel.appendChild(makeButton('Lire avec l’IA (recommandé)', 'analyze-ai', 'imp-button imp-button-primary imp-analyze-button'));
                panel.appendChild(makeButton('Analyser sans IA', 'analyze-file', 'imp-button imp-button-secondary imp-analyze-button'));
            } else {
                panel.appendChild(makeButton('Analyser le fichier', 'analyze-file', 'imp-button imp-button-primary imp-analyze-button'));
                if (SF.aiReader) {
                    var aiHint = makeElement('p', 'imp-help', 'Pour une lecture bien plus fiable des photos et captures, ajoute une clé API gratuite (Gemini) dans les Réglages.');
                    panel.appendChild(aiHint);
                    panel.appendChild(makeButton('Ajouter ma clé dans Réglages', 'goto-settings', 'imp-button imp-button-quiet'));
                }
            }
        }

        var error = makeElement('p', 'imp-error', state.fileError);
        error.setAttribute('role', 'alert');
        error.hidden = !state.fileError;
        panel.appendChild(error);
        parent.appendChild(panel);
    }

    // Construit le secours par collage de texte.
    function renderTextPanel(parent) {
        var panel = makeElement('section', 'imp-text-panel');
        var label = makeElement('label', 'imp-field-label', 'Texte de ton emploi du temps');
        label.htmlFor = 'imp-source-text';
        var area = makeElement('textarea', 'imp-textarea');
        area.id = 'imp-source-text';
        area.rows = 9;
        area.placeholder = 'Exemple :\nLundi 08:00-10:00 Mathématiques Salle A\nMardi 10:00-12:00 Informatique Salle B';
        area.value = state.text;
        area.setAttribute('aria-describedby', 'imp-text-help');
        var help = makeElement('p', 'imp-help', 'Colle ici le texte copié depuis ton emploi du temps ou saisis les cours ligne par ligne.');
        help.id = 'imp-text-help';
        panel.appendChild(label);
        panel.appendChild(area);
        panel.appendChild(help);
        var error = makeElement('p', 'imp-error', state.textError);
        error.setAttribute('role', 'alert');
        error.hidden = !state.textError;
        panel.appendChild(error);
        panel.appendChild(makeButton('Analyser', 'analyze-text', 'imp-button imp-button-primary imp-analyze-button'));
        parent.appendChild(panel);
    }

    // Affiche l'écran de progression de l'extraction.
    function renderAnalysis() {
        state.screen = 'analysis';
        var frame = renderFrame('Analyse de ton emploi du temps', 2);
        if (state.analysisError) {
            var errorBox = makeElement('section', 'imp-analysis-error');
            errorBox.appendChild(makeElement('h3', 'imp-section-title', 'Impossible de lire ce fichier'));
            var message = makeElement('p', 'imp-error', state.analysisError);
            message.setAttribute('role', 'alert');
            errorBox.appendChild(message);
            errorBox.appendChild(makeElement('p', 'imp-help', 'Hors connexion ? Utilise Coller du texte ou ajoute les cours à la main dans l’Agenda.'));
            var actions = makeElement('div', 'imp-actions-row');
            actions.appendChild(makeButton('Réessayer', 'retry', 'imp-button imp-button-primary'));
            actions.appendChild(makeButton('Coller du texte', 'fallback-text', 'imp-button imp-button-secondary'));
            errorBox.appendChild(actions);
            frame.body.appendChild(errorBox);
        } else {
            var progressBox = makeElement('section', 'imp-progress-box');
            var label = makeElement('p', 'imp-progress-label', state.progressLabel);
            label.dataset.role = 'progress-label';
            var progress = document.createElement('progress');
            progress.className = 'imp-progress';
            progress.max = 100;
            progress.value = state.progressPercent;
            progress.setAttribute('aria-label', 'Progression de l’analyse');
            var percent = makeElement('p', 'imp-progress-percent', Math.round(state.progressPercent) + ' %');
            percent.dataset.role = 'progress-percent';
            progressBox.appendChild(label);
            progressBox.appendChild(progress);
            progressBox.appendChild(percent);
            frame.body.appendChild(progressBox);
        }
        frame.footer.appendChild(makeButton('Annuler', 'cancel', 'imp-button imp-button-secondary'));
    }

    // Met à jour la progression sans reconstruire l'écran.
    function updateProgress(label, percent) {
        state.progressLabel = label || 'Analyse en cours…';
        var number = Number(percent);
        state.progressPercent = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : state.progressPercent;
        if (!state.dialog || state.screen !== 'analysis') return;
        var labelNode = state.dialog.querySelector('[data-role="progress-label"]');
        var progressNode = state.dialog.querySelector('progress.imp-progress');
        var percentNode = state.dialog.querySelector('[data-role="progress-percent"]');
        if (labelNode) labelNode.textContent = state.progressLabel;
        if (progressNode) progressNode.value = state.progressPercent;
        if (percentNode) percentNode.textContent = Math.round(state.progressPercent) + ' %';
    }

    // Vérifie le format, le poids et le type du fichier choisi.
    function validateFile(file) {
        if (!file) return 'Choisis un fichier avant de continuer.';
        if (file.size > MAX_FILE_SIZE) return 'Le fichier dépasse la taille maximale de 20 Mo.';
        if (file.size <= 0) return 'Le fichier est vide.';

        var name = String(file.name || '').toLowerCase();
        var type = String(file.type || '').toLowerCase();
        var isPdf = type === 'application/pdf' || name.endsWith('.pdf');
        var isPng = type === 'image/png' || name.endsWith('.png');
        var isJpeg = type === 'image/jpeg' || type === 'image/jpg' || name.endsWith('.jpg') || name.endsWith('.jpeg');
        var isWebp = type === 'image/webp' || name.endsWith('.webp');
        if (!isPdf && !isPng && !isJpeg && !isWebp) {
            return 'Format refusé. Choisis une image PNG, JPEG, WebP ou un PDF.';
        }
        return '';
    }

    // Formate la taille d'un fichier pour l'aperçu.
    function formatFileSize(size) {
        if (size < 1024) return size + ' octets';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' Ko';
        return (size / (1024 * 1024)).toFixed(1) + ' Mo';
    }

    // Enregistre le fichier choisi et crée son aperçu si c'est une image.
    function setFile(file) {
        releasePreview();
        state.file = null;
        state.fileError = validateFile(file);
        if (!state.fileError) {
            state.file = file;
            var name = String(file.name || '').toLowerCase();
            var type = String(file.type || '').toLowerCase();
            var isImage = type.indexOf('image/') === 0 || /\.(png|jpe?g|webp)$/.test(name);
            if (isImage && window.URL && typeof window.URL.createObjectURL === 'function') {
                try {
                    state.previewUrl = window.URL.createObjectURL(file);
                } catch (error) {
                    state.previewUrl = '';
                }
            }
        }
        renderChoose();
    }

    // Démarre l'extraction du fichier et ignore un résultat devenu obsolète.
    async function startExtraction() {
        if (state.useAI && !(SF.aiReader && SF.aiReader.hasKey())) {
            state.analysisError = 'Aucune clé API. Ajoute ta clé gratuite Gemini dans Réglages.';
            renderAnalysis();
            return;
        }
        if (!state.useAI && (!SF.importer || typeof SF.importer.extract !== 'function')) {
            state.analysisError = 'Le module de lecture des fichiers n’est pas disponible.';
            renderAnalysis();
            return;
        }
        if (!state.file) {
            state.screen = 'choose';
            state.fileError = 'Choisis un fichier avant de continuer.';
            renderChoose();
            return;
        }

        var token = ++state.requestToken;
        state.analysisError = '';
        state.progressLabel = state.useAI ? 'Envoi à l’IA…' : 'Chargement de la bibliothèque…';
        state.progressPercent = 0;
        renderAnalysis();

        try {
            var reader = state.useAI ? SF.aiReader : SF.importer;
            var extraction = await reader.extract(state.file, {
                onProgress: function (label, percent) {
                    if (token !== state.requestToken || !state.dialog.open) return;
                    updateProgress(label, percent);
                }
            });
            if (token !== state.requestToken || !state.dialog.open) return;
            if (!extraction) throw new Error('Aucun contenu n’a pu être extrait du fichier.');
            state.extraction = extraction;
            state.sourceKind = 'file';
            var result = SF.importer.parse(extraction, { referenceDate: todayISO() });
            prepareReviewResult(result, 'file', true);
        } catch (error) {
            if (token !== state.requestToken || !state.dialog.open) return;
            state.analysisError = error && error.message ? error.message : 'Une erreur inconnue est survenue pendant la lecture.';
            renderAnalysis();
        }
    }

    // Analyse le texte collé sans charger de bibliothèque externe.
    function analyzeText() {
        var area = state.dialog.querySelector('#imp-source-text');
        state.text = area ? area.value : state.text;
        state.textError = '';
        if (!state.text.trim()) {
            state.textError = 'Colle ou saisis le texte de ton emploi du temps.';
            renderChoose();
            state.activeTab = 'text';
            return;
        }
        if (!SF.importer || typeof SF.importer.parseText !== 'function') {
            state.textError = 'Le module d’analyse du texte n’est pas disponible.';
            renderChoose();
            state.activeTab = 'text';
            return;
        }
        try {
            var result = SF.importer.parseText(state.text, { referenceDate: todayISO() });
            state.sourceKind = 'text';
            state.extraction = null;
            prepareReviewResult(result, 'text', true);
        } catch (error) {
            state.textError = error && error.message ? error.message : 'Le texte n’a pas pu être analysé.';
            state.activeTab = 'text';
            renderChoose();
        }
    }

    // Prépare les lignes et relance une fois l'analyse si des dates sont absentes.
    function prepareReviewResult(result, sourceKind, allowDefaultWeek) {
        if (!result || !Array.isArray(result.entries)) {
            throw new Error('Le résultat de l’analyse est incomplet.');
        }
        var missingDates = result.entries.some(function (entry) {
            return !entry.date || !SF.dates.isValidISO(entry.date);
        });
        var datedCount = result.entries.filter(function (entry) {
            return entry.date && SF.dates.isValidISO(entry.date);
        }).length;
        var defaultMode = result.entries.length > 0 && datedCount * 2 >= result.entries.length ? 'dated' : 'weekly';
        state.needsWeekStart = missingDates;
        if (missingDates && allowDefaultWeek) {
            state.weekStart = nextMondayISO();
            var options = { referenceDate: todayISO(), weekStart: state.weekStart };
            try {
                if (sourceKind === 'text') {
                    result = SF.importer.parseText(state.text, options);
                } else {
                    result = SF.importer.parse(state.extraction, options);
                }
            } catch (error) {
                // Le premier résultat reste utilisable si l'analyse avec semaine échoue.
            }
        }
        showReviewResult(result, false, defaultMode);
    }

    // Transforme les entrées du parseur en lignes modifiables.
    function makeRows(entries) {
        return entries.map(function (entry) {
            var weekday = Number(entry.weekday);
            if ((!Number.isInteger(weekday) || weekday < 1 || weekday > 7) && entry.date && SF.dates.isValidISO(entry.date)) {
                weekday = SF.dates.isoWeekday(entry.date);
            }
            if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) weekday = '';
            var date = entry.date && SF.dates.isValidISO(entry.date) ? entry.date : '';
            if (!date && state.weekStart && weekday) {
                date = SF.dates.addDays(state.weekStart, weekday - 1);
            }
            var confidence = Number(entry.confidence);
            if (!Number.isFinite(confidence)) confidence = 0;
            confidence = Math.max(0, Math.min(1, confidence));
            return {
                subject: String(entry.subject || ''),
                date: date,
                weekday: weekday,
                startTime: String(entry.startTime || ''),
                endTime: String(entry.endTime || ''),
                room: String(entry.room || ''),
                teacher: String(entry.teacher || ''),
                raw: String(entry.raw || ''),
                confidence: confidence,
                include: confidence >= 0.5,
                duplicate: false
            };
        });
    }

    // Affiche l'écran de vérification avec les cours détectés.
    function showReviewResult(result, keepMode, modeOverride) {
        if (!result || !Array.isArray(result.entries)) {
            throw new Error('Aucun cours exploitable n’a été renvoyé par l’analyse.');
        }
        state.parseResult = result;
        if (!keepMode) {
            if (modeOverride) {
                state.mode = modeOverride;
            } else {
                var datedCount = result.entries.filter(function (entry) {
                    return entry.date && SF.dates.isValidISO(entry.date);
                }).length;
                state.mode = result.entries.length > 0 && datedCount * 2 >= result.entries.length ? 'dated' : 'weekly';
            }
        }
        state.rows = makeRows(result.entries);
        state.validFrom = state.validFrom || '';
        state.validTo = state.validTo || '';
        state.importErrors = [];
        state.screen = 'review';
        renderReview();
    }

    // Renvoie le libellé français d'un jour de la semaine.
    function weekdayLabel(day) {
        var labels = SF.constants && SF.constants.LABELS ? SF.constants.LABELS.weekdays : null;
        if (Array.isArray(labels) && labels[day - 1]) return labels[day - 1];
        if (labels && labels[day]) return labels[day];
        return WEEKDAYS[day - 1] || 'Jour inconnu';
    }

    // Crée un champ de formulaire avec son libellé accessible.
    function makeField(labelText, input, className) {
        var wrap = makeElement('div', className || 'imp-field');
        var label = makeElement('label', 'imp-field-label', labelText);
        if (input.id) label.htmlFor = input.id;
        wrap.appendChild(label);
        wrap.appendChild(input);
        return wrap;
    }

    // Crée un champ date ou texte pour les options du mode d'import.
    function makeSimpleInput(type, value, label, name) {
        var input = document.createElement('input');
        input.type = type;
        input.className = 'imp-input';
        input.value = value || '';
        input.dataset.field = name;
        input.id = 'imp-' + name;
        input.setAttribute('aria-label', label);
        return input;
    }

    // Affiche le tableau, les options de période et le texte reconnu.
    function renderReview() {
        state.screen = 'review';
        var frame = renderFrame('Vérifier les cours détectés', 3);
        var intro = makeElement('p', 'imp-help', 'Vérifie les matières, les jours et les horaires. Rien ne sera ajouté avant ta validation.');
        frame.body.appendChild(intro);

        var modeFieldset = makeElement('fieldset', 'imp-mode-fieldset');
        modeFieldset.appendChild(makeElement('legend', 'imp-field-label', 'Type d’emploi du temps'));
        var datedLabel = makeElement('label', 'imp-radio-label');
        var datedRadio = document.createElement('input');
        datedRadio.type = 'radio';
        datedRadio.name = 'imp-mode';
        datedRadio.value = 'dated';
        datedRadio.checked = state.mode === 'dated';
        datedRadio.dataset.field = 'mode';
        datedLabel.appendChild(datedRadio);
        datedLabel.appendChild(makeElement('span', '', 'Séances à des dates précises (emploi du temps du mois)'));
        var weeklyLabel = makeElement('label', 'imp-radio-label');
        var weeklyRadio = document.createElement('input');
        weeklyRadio.type = 'radio';
        weeklyRadio.name = 'imp-mode';
        weeklyRadio.value = 'weekly';
        weeklyRadio.checked = state.mode === 'weekly';
        weeklyRadio.dataset.field = 'mode';
        weeklyLabel.appendChild(weeklyRadio);
        weeklyLabel.appendChild(makeElement('span', '', 'Cours qui se répètent chaque semaine'));
        modeFieldset.appendChild(datedLabel);
        modeFieldset.appendChild(weeklyLabel);
        frame.body.appendChild(modeFieldset);

        var periodFields = makeElement('div', 'imp-period-fields');
        if (state.mode === 'weekly') {
            periodFields.appendChild(makeField('Valable du (facultatif)', makeSimpleInput('date', state.validFrom, 'Date de début de validité', 'validFrom')));
            periodFields.appendChild(makeField('Jusqu’au (facultatif)', makeSimpleInput('date', state.validTo, 'Date de fin de validité', 'validTo')));
        } else if (state.needsWeekStart) {
            periodFields.appendChild(makeField('Lundi de la semaine concernée', makeSimpleInput('date', state.weekStart, 'Lundi de la semaine concernée', 'weekStart')));
            if (state.weekStartError) {
                var weekError = makeElement('p', 'imp-error', state.weekStartError);
                weekError.setAttribute('role', 'alert');
                periodFields.appendChild(weekError);
            }
        }
        frame.body.appendChild(periodFields);

        var tableHeader = makeElement('div', 'imp-table-heading');
        tableHeader.appendChild(makeElement('h3', 'imp-section-title', 'Cours détectés (' + state.rows.length + ')'));
        tableHeader.appendChild(makeButton('Ajouter une ligne', 'add-row', 'imp-button imp-button-secondary'));
        var topImportButton = makeButton('Importer 0 cours', 'begin-import', 'imp-button imp-button-primary');
        topImportButton.dataset.role = 'import-button-top';
        topImportButton.disabled = true;
        tableHeader.appendChild(topImportButton);
        frame.body.appendChild(tableHeader);

        if (state.rows.length === 0) {
            frame.body.appendChild(makeElement('p', 'imp-empty', 'Aucun cours détecté. Tu peux ajouter une ligne manuellement ou revenir à Coller du texte.'));
        }

        var tableScroll = makeElement('div', 'imp-table-scroll');
        tableScroll.setAttribute('role', 'region');
        tableScroll.setAttribute('aria-label', 'Tableau modifiable des cours détectés');
        tableScroll.tabIndex = 0;
        var table = makeElement('table', 'imp-table');
        var thead = document.createElement('thead');
        var headingRow = document.createElement('tr');
        [
            'Inclure', 'Matière', state.mode === 'dated' ? 'Date' : 'Jour de la semaine',
            'Début', 'Fin', 'Salle', 'Enseignant', 'Confiance / état', 'Action'
        ].forEach(function (label) {
            var th = makeElement('th', '', label);
            th.scope = 'col';
            headingRow.appendChild(th);
        });
        thead.appendChild(headingRow);
        var tbody = document.createElement('tbody');
        tbody.dataset.role = 'rows';
        table.appendChild(thead);
        table.appendChild(tbody);
        tableScroll.appendChild(table);
        frame.body.appendChild(tableScroll);

        state.rows.forEach(function (row, index) {
            tbody.appendChild(renderRow(row, index));
        });

        renderDetectedText(frame.body);
        var status = makeElement('p', 'imp-review-status');
        status.dataset.role = 'review-status';
        status.setAttribute('aria-live', 'polite');
        frame.body.appendChild(status);

        frame.footer.appendChild(makeButton('Retour', 'back-choose', 'imp-button imp-button-secondary'));
        frame.footer.appendChild(makeButton('Annuler', 'cancel', 'imp-button imp-button-quiet'));
        var importButton = makeButton('Importer 0 cours', 'begin-import', 'imp-button imp-button-primary');
        importButton.dataset.role = 'import-button';
        importButton.disabled = true;
        frame.footer.appendChild(importButton);
        updateReviewStatus();

        var firstInput = frame.body.querySelector('input:not([type="radio"]), select');
        if (firstInput) firstInput.focus();
    }

    // Construit une ligne modifiable du tableau.
    function renderRow(row, index) {
        var tr = document.createElement('tr');
        tr.dataset.rowIndex = String(index);

        var includeCell = document.createElement('td');
        var include = document.createElement('input');
        include.type = 'checkbox';
        include.checked = row.include;
        include.dataset.field = 'include';
        include.setAttribute('aria-label', 'Inclure le cours de la ligne ' + (index + 1));
        includeCell.appendChild(include);
        tr.appendChild(includeCell);

        tr.appendChild(makeInputCell('text', row.subject, 'subject', 'Matière', index, 60));
        if (state.mode === 'dated') {
            tr.appendChild(makeInputCell('date', row.date, 'date', 'Date', index));
        } else {
            var dayCell = document.createElement('td');
            var select = document.createElement('select');
            select.className = 'imp-cell-input';
            select.dataset.field = 'weekday';
            select.setAttribute('aria-label', 'Jour de la semaine, ligne ' + (index + 1));
            var emptyOption = makeElement('option', '', 'Choisir un jour');
            emptyOption.value = '';
            select.appendChild(emptyOption);
            for (var day = 1; day <= 7; day += 1) {
                var option = makeElement('option', '', weekdayLabel(day));
                option.value = String(day);
                select.appendChild(option);
            }
            select.value = row.weekday ? String(row.weekday) : '';
            dayCell.appendChild(select);
            tr.appendChild(dayCell);
        }
        tr.appendChild(makeInputCell('time', row.startTime, 'startTime', 'Heure de début', index));
        tr.appendChild(makeInputCell('time', row.endTime, 'endTime', 'Heure de fin', index));
        tr.appendChild(makeInputCell('text', row.room, 'room', 'Salle', index, 60));
        tr.appendChild(makeInputCell('text', row.teacher, 'teacher', 'Enseignant', index, 60));

        var confidenceCell = makeElement('td', 'imp-confidence-cell');
        var confidence = confidenceDetails(row.confidence);
        var badge = makeElement('span', 'imp-confidence-badge ' + confidence.className, confidence.label);
        badge.setAttribute('aria-label', confidence.label + ' (' + Math.round(row.confidence * 100) + ' %)');
        confidenceCell.appendChild(badge);
        var duplicate = makeElement('span', 'imp-duplicate-label', 'Déjà dans l’agenda');
        duplicate.dataset.role = 'duplicate';
        duplicate.hidden = true;
        confidenceCell.appendChild(duplicate);
        var feedback = makeElement('div', 'imp-row-feedback');
        feedback.dataset.role = 'row-feedback';
        feedback.setAttribute('aria-live', 'polite');
        confidenceCell.appendChild(feedback);
        tr.appendChild(confidenceCell);

        var actionCell = document.createElement('td');
        var remove = makeButton('Supprimer', 'remove-row', 'imp-button imp-button-small imp-button-danger');
        remove.dataset.index = String(index);
        remove.setAttribute('aria-label', 'Supprimer la ligne ' + (index + 1));
        actionCell.appendChild(remove);
        tr.appendChild(actionCell);
        return tr;
    }

    // Crée une cellule avec un champ de saisie.
    function makeInputCell(type, value, field, label, index, maxLength) {
        var cell = document.createElement('td');
        var input = document.createElement('input');
        input.type = type;
        input.className = 'imp-cell-input';
        input.value = value || '';
        input.dataset.field = field;
        input.setAttribute('aria-label', label + ', ligne ' + (index + 1));
        if (maxLength) input.maxLength = maxLength;
        cell.appendChild(input);
        return cell;
    }

    // Choisit le badge de confiance et son niveau visuel.
    function confidenceDetails(value) {
        if (value >= 0.8) return { label: 'Fiable', className: 'imp-is-good' };
        if (value >= 0.5) return { label: 'À vérifier', className: 'imp-is-medium' };
        return { label: 'Douteux', className: 'imp-is-low' };
    }

    // Affiche le texte brut reconnu et les avertissements du parseur.
    function renderDetectedText(parent) {
        var details = makeElement('details', 'imp-detected-details');
        var summary = makeElement('summary', '', 'Voir le texte détecté');
        details.appendChild(summary);
        var result = state.parseResult || {};
        var warnings = Array.isArray(result.warnings) ? result.warnings : [];
        if (warnings.length) {
            var warningBox = makeElement('div', 'imp-warnings');
            warningBox.appendChild(makeElement('strong', '', 'Avertissements'));
            var list = document.createElement('ul');
            warnings.forEach(function (warning) {
                list.appendChild(makeElement('li', '', warning));
            });
            warningBox.appendChild(list);
            details.appendChild(warningBox);
        }
        var lines = result.lines;
        var lineText = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
        var pre = makeElement('pre', 'imp-detected-text', lineText || 'Aucun texte brut disponible.');
        details.appendChild(pre);
        parent.appendChild(details);
    }

    // Convertit une ligne en cours et appelle la validation métier.
    function evaluateRow(row) {
        var entry = {
            subject: String(row.subject || '').trim(),
            date: state.mode === 'dated' ? String(row.date || '') : String(row.date || ''),
            weekday: row.weekday === '' ? '' : Number(row.weekday),
            startTime: String(row.startTime || ''),
            endTime: String(row.endTime || ''),
            room: String(row.room || '').trim(),
            teacher: String(row.teacher || '').trim(),
            raw: String(row.raw || ''),
            confidence: row.confidence
        };
        var options = {
            mode: state.mode,
            validFrom: state.validFrom || '',
            validTo: state.validTo || ''
        };
        var converted = [];
        var errors = {};

        try {
            converted = SF.importer.toCourses([entry], options);
            if (!Array.isArray(converted)) converted = [];
        } catch (error) {
            errors.conversion = error && error.message ? error.message : 'La ligne ne peut pas être convertie en cours.';
        }

        var course = converted.length ? converted[0] : {
            subject: entry.subject,
            weekday: entry.weekday,
            startTime: entry.startTime,
            endTime: entry.endTime,
            room: entry.room,
            teacher: entry.teacher,
            validFrom: state.mode === 'dated' ? entry.date : (state.validFrom || null),
            validTo: state.mode === 'dated' ? entry.date : (state.validTo || null)
        };

        if (state.mode === 'dated') {
            if (!entry.date || !SF.dates.isValidISO(entry.date)) {
                errors.date = 'Choisis une date précise pour ce cours.';
            } else {
                course.weekday = SF.dates.isoWeekday(entry.date);
                course.validFrom = entry.date;
                course.validTo = entry.date;
            }
        } else {
            if (!Number.isInteger(entry.weekday) || entry.weekday < 1 || entry.weekday > 7) {
                errors.weekday = 'Choisis un jour de la semaine.';
            } else {
                course.weekday = entry.weekday;
            }
            course.validFrom = state.validFrom || null;
            course.validTo = state.validTo || null;
        }
        course.subject = entry.subject;
        course.startTime = entry.startTime;
        course.endTime = entry.endTime;
        course.room = entry.room;
        course.teacher = entry.teacher;

        try {
            if (SF.timetable && typeof SF.timetable.validate === 'function') {
                var validationErrors = SF.timetable.validate(course) || {};
                Object.keys(validationErrors).forEach(function (key) {
                    errors[key] = validationErrors[key];
                });
            } else {
                errors.general = 'La validation des cours n’est pas disponible.';
            }
        } catch (error) {
            errors.general = error && error.message ? error.message : 'La validation de cette ligne a échoué.';
        }

        if (!converted.length && Object.keys(errors).length === 0) {
            errors.conversion = 'Cette ligne n’a pas pu être convertie en cours.';
        }
        var skipped = converted.skipped || 0;
        if (skipped > 0 && Object.keys(errors).length === 0) {
            errors.conversion = 'Cette ligne n’a pas pu être convertie en cours.';
        }
        return { course: course, errors: errors };
    }

    // Normalise le nom d'une matière pour comparer les doublons.
    function normalizeSubject(value) {
        return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Compare les champs qui définissent un doublon de cours.
    function sameCoursePeriod(a, b) {
        return normalizeSubject(a.subject) === normalizeSubject(b.subject) &&
            Number(a.weekday) === Number(b.weekday) &&
            a.startTime === b.startTime &&
            a.endTime === b.endTime &&
            (a.validFrom || null) === (b.validFrom || null) &&
            (a.validTo || null) === (b.validTo || null);
    }

    // Renvoie les cours existants pour détecter les doublons avant l'import.
    function getExistingCourses() {
        try {
            if (SF.timetable && typeof SF.timetable.getAll === 'function') {
                return SF.timetable.getAll() || [];
            }
        } catch (error) {
            return [];
        }
        return [];
    }

    // Affiche les erreurs et compte les lignes sélectionnées qui peuvent être importées.
    function updateReviewStatus() {
        if (!state.dialog || state.screen !== 'review') return { courses: [], rowIndexes: [], blocked: false };
        var existing = getExistingCourses();
        var courses = [];
        var rowIndexes = [];
        var blocked = false;
        var checkedCount = 0;

        state.rows.forEach(function (row, index) {
            var result = evaluateRow(row);
            var duplicate = result.course && Object.keys(result.errors).length === 0 && existing.some(function (course) {
                return sameCoursePeriod(result.course, course);
            });
            row.duplicate = Boolean(duplicate);
            var tr = state.dialog.querySelector('tr[data-row-index="' + index + '"]');
            if (duplicate && row.include) row.include = false;
            if (tr) {
                var checkbox = tr.querySelector('input[data-field="include"]');
                if (checkbox) checkbox.checked = row.include;
                var duplicateNode = tr.querySelector('[data-role="duplicate"]');
                if (duplicateNode) duplicateNode.hidden = !duplicate;
                var feedback = tr.querySelector('[data-role="row-feedback"]');
                if (feedback) {
                    feedback.replaceChildren();
                    if (row.include && Object.keys(result.errors).length) {
                        Object.keys(result.errors).forEach(function (key) {
                            var message = result.errors[key];
                            var line = makeElement('p', 'imp-row-error', message);
                            feedback.appendChild(line);
                        });
                    }
                }
            }

            if (row.include) {
                checkedCount += 1;
                if (Object.keys(result.errors).length) {
                    blocked = true;
                } else {
                    courses.push(result.course);
                    rowIndexes.push(index);
                }
            }
        });

        ['import-button', 'import-button-top'].forEach(function (role) {
            var importBtn = state.dialog.querySelector('[data-role="' + role + '"]');
            if (importBtn) {
                importBtn.textContent = 'Importer ' + courses.length + ' cours';
                importBtn.disabled = courses.length === 0 || blocked;
            }
        });
        var status = state.dialog.querySelector('[data-role="review-status"]');
        if (status) {
            if (blocked) {
                status.textContent = 'Corrige les erreurs des lignes cochées pour pouvoir importer.';
                status.className = 'imp-review-status imp-is-error';
            } else if (courses.length === 0) {
                status.textContent = 'Coche au moins un cours valide pour continuer.';
                status.className = 'imp-review-status';
            } else {
                status.textContent = courses.length + ' cours sélectionné(s) et valide(s).' + (checkedCount > courses.length ? ' Certaines lignes doivent être corrigées.' : '');
                status.className = 'imp-review-status imp-is-ready';
            }
        }
        return { courses: courses, rowIndexes: rowIndexes, blocked: blocked };
    }

    // Relance l'analyse quand le lundi de référence change.
    function reparseWithWeekStart(value) {
        if (!value || !SF.dates.isValidISO(value)) {
            state.weekStartError = 'Choisis une date valide.';
            renderReview();
            return;
        }
        if (SF.dates.isoWeekday(value) !== 1) {
            state.weekStartError = 'La date choisie doit être un lundi.';
            renderReview();
            return;
        }
        state.weekStart = value;
        state.weekStartError = '';
        var options = { referenceDate: todayISO(), weekStart: value };
        try {
            var result = state.sourceKind === 'text'
                ? SF.importer.parseText(state.text, options)
                : SF.importer.parse(state.extraction, options);
            if (!result || !Array.isArray(result.entries)) throw new Error('L’analyse n’a pas renvoyé de lignes.');
            showReviewResult(result, true);
        } catch (error) {
            state.weekStartError = error && error.message ? error.message : 'Impossible de relancer l’analyse avec cette semaine.';
            renderReview();
        }
    }

    // Demande une confirmation avant d'écrire les cours dans les données.
    function askConfirmation(count) {
        var message = 'Ajouter ' + count + ' cours à l’Agenda ?';
        if (SF.forms && typeof SF.forms.confirm === 'function') {
            try {
                var answer = SF.forms.confirm({ title: 'Ajouter les cours', message: message, confirmLabel: 'Ajouter' });
                if (answer && typeof answer.then === 'function') {
                    return answer.then(normalizeConfirmation).catch(function () { return false; });
                }
                return Promise.resolve(normalizeConfirmation(answer));
            } catch (error) {
                return Promise.resolve(window.confirm(message));
            }
        }
        return Promise.resolve(window.confirm(message));
    }

    // Interprète les principaux formats de retour du formulaire de confirmation.
    function normalizeConfirmation(answer) {
        if (answer === true) return true;
        if (answer && typeof answer === 'object') {
            if (answer.confirmed === true || answer.ok === true) return true;
        }
        return false;
    }

    // Lance l'import après confirmation et conserve les erreurs en cas d'échec.
    async function beginImport() {
        var summary = updateReviewStatus();
        if (summary.blocked || summary.courses.length === 0) return;
        var confirmed = await askConfirmation(summary.courses.length);
        if (!confirmed || !state.dialog || !state.dialog.open || state.screen !== 'review') return;

        summary = updateReviewStatus();
        if (summary.blocked || summary.courses.length === 0) return;
        state.pendingRowIndexes = summary.rowIndexes.slice();
        state.importErrors = [];
        state.screen = 'import';
        renderImport(false);

        var result;
        try {
            if (!SF.timetable || typeof SF.timetable.addMany !== 'function') {
                throw new Error('L’ajout groupé des cours n’est pas disponible.');
            }
            result = SF.timetable.addMany(summary.courses);
        } catch (error) {
            state.importErrors = [{ index: -1, message: error && error.message ? error.message : 'L’ajout des cours a échoué.' }];
            renderImport(true);
            return;
        }

        if (result && result.ok) {
            var count = typeof result.count === 'number' && Number.isFinite(result.count) ? result.count : summary.courses.length;
            closeDialog();
            toast(count + ' cours ajoutés à l’Agenda.');
            try {
                if (SF.app && typeof SF.app.navigate === 'function') SF.app.navigate('agenda');
            } catch (error) {
                // Les cours sont déjà enregistrés ; une erreur de navigation ne doit pas masquer le succès.
            }
            return;
        }

        state.importErrors = formatImportErrors(result, summary.rowIndexes);
        renderImport(true);
    }

    // Convertit les erreurs de addMany en messages associés aux lignes du tableau.
    function formatImportErrors(result, rowIndexes) {
        var output = [];
        var errors = result && Array.isArray(result.errors) ? result.errors : [];
        errors.forEach(function (item) {
            var sourceIndex = Number(item.index);
            var rowIndex = Number.isInteger(sourceIndex) ? rowIndexes[sourceIndex] : undefined;
            var messages = [];
            if (item.errors && typeof item.errors === 'object') {
                Object.keys(item.errors).forEach(function (key) {
                    messages.push(String(item.errors[key]));
                });
            } else if (item.message) {
                messages.push(String(item.message));
            }
            output.push({
                index: Number.isInteger(rowIndex) ? rowIndex : sourceIndex,
                message: messages.join(' ' ) || 'Cette ligne a été refusée.'
            });
        });
        if (!output.length) {
            output.push({
                index: -1,
                message: result && result.message ? String(result.message) : 'Aucun cours n’a été ajouté. Vérifie les lignes puis réessaie.'
            });
        }
        return output;
    }

    // Affiche l'écran final et les éventuelles erreurs retournées par addMany.
    function renderImport(hasError) {
        state.screen = 'import';
        var frame = renderFrame('Ajout des cours', 4);
        if (!hasError) {
            var progress = makeElement('section', 'imp-progress-box');
            progress.appendChild(makeElement('p', 'imp-progress-label', 'Ajout des cours à l’Agenda…'));
            var bar = document.createElement('progress');
            bar.className = 'imp-progress';
            bar.max = 100;
            bar.value = 100;
            bar.setAttribute('aria-label', 'Ajout des cours');
            progress.appendChild(bar);
            frame.body.appendChild(progress);
            return;
        }

        var errorBox = makeElement('section', 'imp-analysis-error');
        errorBox.appendChild(makeElement('h3', 'imp-section-title', 'Les cours n’ont pas été ajoutés'));
        var intro = makeElement('p', 'imp-help', 'Aucune donnée n’a été enregistrée. Corrige les lignes indiquées puis relance l’import.');
        errorBox.appendChild(intro);
        var list = document.createElement('ul');
        list.className = 'imp-import-errors';
        state.importErrors.forEach(function (item) {
            var label = item.index >= 0 ? 'Ligne ' + (item.index + 1) + ' : ' : '';
            list.appendChild(makeElement('li', '', label + item.message));
        });
        errorBox.appendChild(list);
        frame.body.appendChild(errorBox);
        frame.footer.appendChild(makeButton('Retour à la vérification', 'back-review', 'imp-button imp-button-secondary'));
        frame.footer.appendChild(makeButton('Annuler', 'cancel', 'imp-button imp-button-quiet'));
    }

    // Ferme l'assistant sans effectuer d'écriture supplémentaire.
    function closeDialog() {
        if (state.dialog && state.dialog.open) state.dialog.close();
    }

    // Gère les clics des boutons par délégation d'événements.
    function handleClick(event) {
        var actionNode = event.target.closest ? event.target.closest('[data-action]') : null;
        if (!actionNode) {
            var dropzone = event.target.closest ? event.target.closest('[data-role="dropzone"]') : null;
            if (dropzone) {
                var chooser = state.dialog.querySelector('[data-role="file-input"]');
                if (chooser) chooser.click();
            }
            return;
        }
        if (!state.dialog.contains(actionNode)) return;
        var action = actionNode.dataset.action;

        if (action === 'cancel') {
            closeDialog();
        } else if (action === 'choose-file') {
            var fileInput = state.dialog.querySelector('[data-role="file-input"]');
            if (fileInput) fileInput.click();
        } else if (action === 'tab-file') {
            state.activeTab = 'file';
            renderChoose();
        } else if (action === 'tab-text') {
            state.activeTab = 'text';
            renderChoose();
        } else if (action === 'remove-file') {
            releasePreview();
            state.file = null;
            state.fileError = '';
            renderChoose();
        } else if (action === 'analyze-file') {
            state.useAI = false;
            startExtraction();
        } else if (action === 'analyze-ai') {
            state.useAI = true;
            startExtraction();
        } else if (action === 'goto-settings') {
            closeDialog();
            window.location.hash = '#/settings';
        } else if (action === 'analyze-text') {
            analyzeText();
        } else if (action === 'retry') {
            startExtraction();
        } else if (action === 'fallback-text') {
            state.activeTab = 'text';
            state.analysisError = '';
            state.textError = '';
            state.screen = 'choose';
            renderChoose();
        } else if (action === 'back-choose') {
            state.screen = 'choose';
            state.activeTab = 'file';
            renderChoose();
        } else if (action === 'add-row') {
            state.rows.push({
                subject: '', date: '', weekday: '', startTime: '', endTime: '',
                room: '', teacher: '', raw: 'Ligne ajoutée manuellement', confidence: 1,
                include: true, duplicate: false
            });
            renderReview();
        } else if (action === 'remove-row') {
            var index = Number(actionNode.dataset.index);
            if (Number.isInteger(index) && index >= 0 && index < state.rows.length) {
                state.rows.splice(index, 1);
                renderReview();
            }
        } else if (action === 'begin-import') {
            beginImport();
        } else if (action === 'back-review') {
            renderReview();
        }
    }

    // Met à jour une valeur de ligne sans reconstruire le tableau ni perdre le focus.
    function handleInput(event) {
        var field = event.target.dataset ? event.target.dataset.field : '';
        var rowNode = event.target.closest ? event.target.closest('tr[data-row-index]') : null;
        if (rowNode && field) {
            updateRowFromControl(rowNode, event.target, field);
            updateReviewStatus();
        } else if (field === 'validFrom' || field === 'validTo') {
            state[field] = event.target.value;
            updateReviewStatus();
        } else if (event.target.id === 'imp-source-text') {
            state.text = event.target.value;
        }
    }

    // Traite les champs qui déclenchent un changement de mode ou de semaine.
    function handleChange(event) {
        var field = event.target.dataset ? event.target.dataset.field : '';
        if (field === 'mode') {
            state.mode = event.target.value;
            if (state.mode === 'dated' && state.needsWeekStart && !state.weekStart) state.weekStart = nextMondayISO();
            state.rows = state.rows.map(function (row) {
                if (state.mode === 'dated' && !row.date && row.weekday && state.weekStart) {
                    row.date = SF.dates.addDays(state.weekStart, Number(row.weekday) - 1);
                }
                if (state.mode === 'weekly' && (!row.weekday || row.weekday < 1 || row.weekday > 7) && row.date && SF.dates.isValidISO(row.date)) {
                    row.weekday = SF.dates.isoWeekday(row.date);
                }
                return row;
            });
            renderReview();
            return;
        }
        if (field === 'weekStart') {
            reparseWithWeekStart(event.target.value);
            return;
        }
        var rowNode = event.target.closest ? event.target.closest('tr[data-row-index]') : null;
        if (rowNode && field) {
            updateRowFromControl(rowNode, event.target, field);
            updateReviewStatus();
            return;
        }
        if (field === 'validFrom' || field === 'validTo') {
            state[field] = event.target.value;
            updateReviewStatus();
        }
        if (event.target.dataset && event.target.dataset.role === 'file-input') {
            if (event.target.files && event.target.files[0]) setFile(event.target.files[0]);
        }
    }

    // Copie la valeur d'un champ HTML dans la ligne correspondante.
    function updateRowFromControl(rowNode, control, field) {
        var index = Number(rowNode.dataset.rowIndex);
        if (!Number.isInteger(index) || !state.rows[index]) return;
        if (field === 'include') {
            state.rows[index].include = Boolean(control.checked);
        } else if (field === 'weekday') {
            state.rows[index].weekday = control.value === '' ? '' : Number(control.value);
            if (state.mode === 'dated' && state.weekStart && state.rows[index].weekday) {
                state.rows[index].date = SF.dates.addDays(state.weekStart, state.rows[index].weekday - 1);
            }
        } else {
            state.rows[index][field] = control.value;
            if (field === 'date' && control.value && SF.dates.isValidISO(control.value)) {
                state.rows[index].weekday = SF.dates.isoWeekday(control.value);
            }
        }
    }

    // Active la sélection au clavier de la zone de dépôt.
    function handleKeydown(event) {
        var dropzone = event.target.closest ? event.target.closest('[data-role="dropzone"]') : null;
        if (dropzone && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            var input = state.dialog.querySelector('[data-role="file-input"]');
            if (input) input.click();
        }
    }

    // Active le style de dépôt lorsque le curseur passe sur la zone.
    function handleDragOver(event) {
        var zone = event.target.closest ? event.target.closest('[data-role="dropzone"]') : null;
        if (!zone) return;
        event.preventDefault();
        zone.classList.add('imp-is-dragover');
    }

    // Retire le style de dépôt lorsque le curseur quitte la zone.
    function handleDragLeave(event) {
        var zone = event.target.closest ? event.target.closest('[data-role="dropzone"]') : null;
        if (!zone) return;
        if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
        zone.classList.remove('imp-is-dragover');
    }

    // Traite un fichier déposé dans la zone.
    function handleDrop(event) {
        var zone = event.target.closest ? event.target.closest('[data-role="dropzone"]') : null;
        if (!zone) return;
        event.preventDefault();
        zone.classList.remove('imp-is-dragover');
        var files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) setFile(files[0]);
    }

    // Accepte une image copiée dans le presse-papiers avec Ctrl+V.
    function handlePaste(event) {
        if (!state.dialog || !state.dialog.open || state.screen !== 'choose' || state.activeTab !== 'file') return;
        var items = event.clipboardData && event.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i += 1) {
            var item = items[i];
            if (item.kind === 'file' && /^image\/(png|jpeg|webp)$/i.test(item.type)) {
                var file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    setFile(file);
                    return;
                }
            }
        }
    }

    // Ouvre l'assistant après avoir vérifié que le module d'import existe.
    function open() {
        if (!SF.importer) {
            toast('L’import n’est pas disponible.');
            return;
        }
        if (!SF.dates || !SF.constants || !SF.timetable) {
            toast('Les modules nécessaires à l’import ne sont pas disponibles.');
            return;
        }
        ensureDialog();
        var wasAlreadyOpen = state.dialog.open;
        if (!wasAlreadyOpen) state.opener = document.activeElement;
        resetState();
        renderChoose();
        if (!wasAlreadyOpen) {
            try {
                state.dialog.showModal();
            } catch (error) {
                state.dialog.setAttribute('open', '');
            }
        }
        var firstControl = state.dialog.querySelector('button, input, textarea');
        if (firstControl) firstControl.focus();
    }

    SF.importerUI = {
        // Ouvre l'assistant d'import de l'emploi du temps.
        open: open
    };
}());