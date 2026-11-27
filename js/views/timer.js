/* ============================================================================
   StudyFlow — vue « Chrono » (id : 'timer')

   Deux outils pour mesurer le temps d'étude :
     - un chronomètre (il compte depuis 0) ;
     - un minuteur pomodoro (travail, pause, longue pause).
   Le temps travaillé est enregistré dans le journal d'étude (SF.sessions).

   IDÉE IMPORTANTE : on ne compte pas les secondes une par une.
   On note l'heure de début (Date.now()) et, à chaque affichage, on calcule
   « heure actuelle - heure de début - durée des pauses ».
   Le chrono reste donc juste même si l'onglet est en arrière-plan.
   Le setInterval ne sert qu'à rafraîchir l'écran.
   ============================================================================ */
(function () {
  'use strict';
  window.SF = window.SF || {};

  /* ======================= 1. RÉGLAGES FIXES ======================= */

  const STORAGE_KEY = 'studyflow.v1.timer';      // où l'état du chrono est gardé
  const REFRESH_MS = 250;                        // l'écran est rafraîchi 4 fois par seconde
  const CYCLE_LENGTH = 4;                        // 4 périodes de travail, puis la longue pause
  const SUBJECT_MAX = 60;                        // longueur maximale d'un nom de matière
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RING_RADIUS = 54;                        // rayon de l'anneau (dessin de 120 x 120)
  const RING_LENGTH = 2 * Math.PI * RING_RADIUS; // longueur du cercle

  // Durées du pomodoro modifiables : [minimum, maximum] en minutes
  const RANGES = { workMin: [1, 120], breakMin: [1, 60], longMin: [1, 60] };

  // État par défaut (utilisé aussi quand la sauvegarde est vide ou illisible)
  const DEFAULTS = {
    mode: 'stopwatch',  // 'stopwatch' (chronomètre) ou 'pomodoro'
    subject: '',        // matière en cours, ou dernière matière utilisée
    status: 'idle',     // 'idle' (repos) | 'running' | 'paused' | 'waiting' (étape suivante du pomodoro en attente)
    startedAt: 0,       // début de l'étape en cours, en millisecondes (Date.now())
    pausedAt: 0,        // début de la pause en cours (0 s'il n'y en a pas)
    pausedTotal: 0,     // durée cumulée des pauses de l'étape en cours (ms)
    phase: 'work',      // étape du pomodoro : 'work' | 'break' | 'long'
    cycle: 1,           // numéro de la période de travail (de 1 à 4)
    workMin: 25,        // durée du travail (minutes)
    breakMin: 5,        // durée de la pause (minutes)
    longMin: 15,        // durée de la longue pause (minutes)
    sound: true         // bip à la fin de chaque étape
  };

  let state = null;     // l'état courant (même forme que DEFAULTS)
  let root = null;      // élément racine de la page
  const els = {};       // les éléments de la page dont on a besoin
  let tickId = null;    // identifiant du setInterval (null = il ne tourne pas)
  let audioCtx = null;  // contexte Web Audio, créé quand on en a besoin


  /* ======================= 2. PETITS OUTILS ======================= */

  // Crée un élément HTML. Le texte est posé avec textContent (jamais innerHTML).
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  // Crée un bouton (type="button" : il ne soumet jamais de formulaire)
  function button(label, className) {
    const node = el('button', className, label);
    node.type = 'button';
    return node;
  }

  // Crée un élément SVG (il faut createElementNS, et setAttribute pour la classe)
  function svgEl(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    return node;
  }

  // Change le texte seulement s'il est différent (évite des mises à jour inutiles)
  function setText(node, text) {
    if (node.textContent !== text) { node.textContent = text; }
  }

  // 5 -> « 05 »
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Chronomètre : 3725000 ms -> « 01:02:05 »
  function formatStopwatch(ms) {
    const total = Math.floor(ms / 1000);
    return pad(Math.floor(total / 3600)) + ':' + pad(Math.floor(total / 60) % 60) + ':' + pad(total % 60);
  }

  // Compte à rebours : 90000 ms -> « 01:30 » (arrondi vers le haut : « 00:00 » veut dire terminé)
  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
  }

  // Convertit en entier compris entre min et max (valeur de secours si ce n'est pas un nombre)
  function toInt(value, min, max, fallback) {
    if (value === '' || value === null || value === undefined) { return fallback; }
    const n = Math.round(Number(value));
    if (!isFinite(n)) { return fallback; }
    return Math.min(max, Math.max(min, n));
  }

  // Date du jour en heure LOCALE, au format 'YYYY-MM-DD'
  function todayISO() {
    return SF.dates.toISO(new Date());
  }

  // Heure locale « HH:MM » d'une date-heure UTC (createdAt)
  function clockTime(isoDateTime) {
    if (!isoDateTime) { return ''; }
    const date = new Date(isoDateTime);
    if (isNaN(date.getTime())) { return ''; }
    return SF.dates.minutesToTime(date.getHours() * 60 + date.getMinutes());
  }

  // Affiche un message (toast) sans jamais faire planter la page
  function notify(message, type) {
    try {
      SF.app.toast(message, type);
    } catch (e) {
      /* le message n'est pas vital */
    }
  }

  // Ouvre la boîte de confirmation commune ; onYes() n'est appelée que si on confirme
  function askConfirm(options, onYes) {
    try {
      Promise.resolve(SF.forms.confirm(options)).then(function (yes) {
        if (yes) { onYes(); }
      }).catch(function () { /* boîte fermée ou en erreur : on ne fait rien */ });
    } catch (e) {
      /* la boîte n'a pas pu s'ouvrir : on ne fait rien */
    }
  }

  // Premier message d'erreur d'une réponse { ok: false, errors: { champ: 'message' } }
  function firstError(result) {
    const errors = result && result.errors;
    const keys = errors ? Object.keys(errors) : [];
    return keys.length > 0 ? String(errors[keys[0]]) : "Impossible d'enregistrer la session.";
  }


  /* ======================= 3. ÉTAT (sauvegardé) ======================= */

  // Un nombre qui peut être une date en millisecondes
  function isTime(value) {
    return typeof value === 'number' && isFinite(value) && value > 0;
  }

  // Lit la sauvegarde. Si elle est illisible, on l'ignore et on repart de zéro.
  function loadState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      raw = null;
    }
    return cleanState(raw);
  }

  // Vérifie chaque champ : ce qui est invalide est remplacé par la valeur par défaut
  function cleanState(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') { return s; }

    // Réglages
    if (raw.mode === 'pomodoro') { s.mode = 'pomodoro'; }
    if (typeof raw.subject === 'string') { s.subject = raw.subject.trim().slice(0, SUBJECT_MAX); }
    s.sound = raw.sound !== false;
    Object.keys(RANGES).forEach(function (key) {
      s[key] = toInt(raw[key], RANGES[key][0], RANGES[key][1], DEFAULTS[key]);
    });

    // Un chrono en cours n'est repris que s'il est cohérent
    const now = Date.now();
    const hasSubject = s.subject !== '';
    const startedOk = isTime(raw.startedAt) && raw.startedAt <= now + 5000;

    if (raw.status === 'running' && hasSubject && startedOk) {
      s.status = 'running';
    } else if (raw.status === 'paused' && hasSubject && startedOk &&
               isTime(raw.pausedAt) && raw.pausedAt >= raw.startedAt && raw.pausedAt <= now + 5000) {
      s.status = 'paused';
      s.pausedAt = raw.pausedAt;
    } else if (raw.status === 'waiting' && hasSubject && s.mode === 'pomodoro') {
      s.status = 'waiting';
    }

    if (s.status === 'running' || s.status === 'paused') {
      s.startedAt = raw.startedAt;
      s.pausedTotal = (typeof raw.pausedTotal === 'number' && raw.pausedTotal >= 0) ? raw.pausedTotal : 0;
    }
    if (s.status !== 'idle') {
      if (raw.phase === 'break' || raw.phase === 'long') { s.phase = raw.phase; }
      s.cycle = toInt(raw.cycle, 1, CYCLE_LENGTH, 1);
    }
    return s;
  }

  // Sauvegarde l'état (si le stockage est plein ou interdit, on continue sans)
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* pas de sauvegarde possible */
    }
  }


  /* ======================= 4. CALCUL DU TEMPS ======================= */

  // Durée de l'étape en cours (pomodoro), en minutes puis en millisecondes
  function getPhaseMinutes() {
    if (state.phase === 'break') { return state.breakMin; }
    if (state.phase === 'long') { return state.longMin; }
    return state.workMin;
  }

  function getPhaseMs() {
    return getPhaseMinutes() * 60000;
  }

  // Temps écoulé dans l'étape en cours, PAUSES EXCLUES, en millisecondes
  function getElapsedMs(now) {
    if (state.status !== 'running' && state.status !== 'paused') { return 0; }
    const end = (state.status === 'paused') ? state.pausedAt : now;
    return Math.max(0, end - state.startedAt - state.pausedTotal);
  }


  /* ======================= 5. ACTIONS ======================= */

  // Démarrer : la matière est obligatoire
  function start() {
    if (state.status !== 'idle') { return; }
    const subject = els.subject.value.trim();
    if (subject === '') {
      showSubjectError(true);
      els.subject.focus();
      return;
    }
    showSubjectError(false);
    els.subject.value = subject;   // on garde le texte nettoyé (sans espaces autour)
    state.subject = subject;
    state.status = 'running';
    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.pausedTotal = 0;
    state.phase = 'work';
    state.cycle = 1;
    saveState();
    prepareAudio();
    startTicking();
    refreshAll();
  }

  // Pause : on note le moment où elle commence
  function pause() {
    if (state.status !== 'running') { return; }
    state.status = 'paused';
    state.pausedAt = Date.now();
    saveState();
    stopTicking();
    refreshAll();
  }

  // Reprendre : soit après une pause, soit pour lancer l'étape suivante du pomodoro
  function resume() {
    if (state.status === 'paused') {
      state.pausedTotal += Date.now() - state.pausedAt; // on ajoute la durée de cette pause
      state.pausedAt = 0;
    } else if (state.status === 'waiting') {
      state.startedAt = Date.now();                      // nouvelle étape : on repart de zéro
      state.pausedAt = 0;
      state.pausedTotal = 0;
    } else {
      return;
    }
    state.status = 'running';
    saveState();
    prepareAudio();
    startTicking();
    refreshAll();
  }

  // Le bouton « Pause / Reprendre »
  function toggle() {
    if (state.status === 'running') {
      pause();
    } else {
      resume();
    }
  }

  // Terminer : on enregistre le temps travaillé (arrondi à la minute)
  function finish() {
    if (state.status === 'idle') { return; }
    const hasTime = state.status === 'running' || state.status === 'paused';
    const isWork = state.mode === 'stopwatch' || state.phase === 'work';

    if (hasTime && isWork) {
      let worked = getElapsedMs(Date.now());
      if (state.mode === 'pomodoro') { worked = Math.min(worked, getPhaseMs()); }
      const minutes = Math.round(worked / 60000);

      if (minutes < 1) {
        notify("Moins d'une minute : rien à enregistrer.", 'info');
      } else if (recordSession(minutes, state.startedAt)) {
        notify('Session enregistrée : ' + SF.app.formatMinutes(minutes) + ' de ' + state.subject + '.', 'success');
      } else {
        return; // l'enregistrement a échoué : on garde le chrono pour ne rien perdre
      }
    } else {
      notify('Pomodoro terminé.', 'info'); // pause ou attente : il n'y a rien à enregistrer
    }
    resetTimer();
  }

  // Abandonner : on jette le temps en cours, après confirmation
  function abandon() {
    if (state.status !== 'running' && state.status !== 'paused') { return; }
    const message = state.mode === 'pomodoro'
      ? 'La période en cours sera jetée. Les périodes déjà enregistrées restent dans le journal.'
      : 'Le temps écoulé sera jeté : rien ne sera enregistré.';

    askConfirm({
      title: 'Abandonner ce chrono ?',
      message: message,
      confirmLabel: 'Abandonner',
      danger: true
    }, function () {
      if (state.status === 'idle') { return; }
      resetTimer();
      notify('Chrono abandonné.', 'info');
    });
  }

  // Remise à zéro : on garde la matière (c'est la dernière utilisée) et les réglages
  function resetTimer() {
    state.status = 'idle';
    state.startedAt = 0;
    state.pausedAt = 0;
    state.pausedTotal = 0;
    state.phase = 'work';
    state.cycle = 1;
    saveState();
    stopTicking();
    refreshAll();
  }

  // Ajoute une session au journal. Renvoie true si c'est réussi.
  function recordSession(minutes, startMs) {
    let result = null;
    try {
      result = SF.sessions.add({
        date: SF.dates.toISO(new Date(startMs)), // date locale du DÉBUT
        subject: state.subject,
        minutes: minutes,
        source: 'timer'
      });
    } catch (e) {
      result = null;
    }
    if (!result || !result.ok) {
      notify(firstError(result), 'error');
      return false;
    }
    return true;
  }

  // Pomodoro : une étape vient de se terminer (le temps est écoulé)
  function completePhase() {
    if (state.phase === 'work') {
      // Seules les périodes de travail sont enregistrées : jamais les pauses
      const minutes = state.workMin;
      if (recordSession(minutes, state.startedAt)) {
        notify('Période terminée : ' + SF.app.formatMinutes(minutes) + ' de ' + state.subject + ' enregistrées.', 'success');
      }
    } else {
      notify('Pause terminée : prêt pour la prochaine période.', 'info');
    }
    beep();
    goToNextPhase();
    saveState();
    stopTicking();
    refreshAll();
  }

  // Travail 1 -> Pause -> Travail 2 -> Pause -> Travail 3 -> Pause -> Travail 4 -> Longue pause -> Travail 1...
  // L'étape suivante attend que l'on clique sur « Reprendre ».
  function goToNextPhase() {
    if (state.phase === 'work') {
      state.phase = (state.cycle >= CYCLE_LENGTH) ? 'long' : 'break';
    } else {
      state.cycle = (state.phase === 'long') ? 1 : state.cycle + 1;
      state.phase = 'work';
    }
    state.status = 'waiting';
    state.startedAt = 0;
    state.pausedAt = 0;
    state.pausedTotal = 0;
  }

  // Changer de mode (seulement au repos)
  function setMode(mode) {
    if (state.status !== 'idle' || state.mode === mode) { return; }
    state.mode = mode;
    saveState();
    refreshAll();
  }

  // Les trois champs de durée : on remet chaque valeur dans sa limite
  function onDurationChange() {
    Object.keys(RANGES).forEach(function (key) {
      state[key] = toInt(els[key].value, RANGES[key][0], RANGES[key][1], state[key]);
      els[key].value = state[key];
    });
    saveState();
    updateTime();
  }

  function onSoundChange() {
    state.sound = els.sound.checked;
    saveState();
    prepareAudio();
  }

  // Message sous le champ « Matière »
  function showSubjectError(show) {
    els.subjectError.hidden = !show;
    if (show) {
      els.subject.setAttribute('aria-invalid', 'true');
    } else {
      els.subject.removeAttribute('aria-invalid');
    }
  }


  /* ======================= 6. RAFRAÎCHISSEMENT DE L'ÉCRAN ======================= */

  function startTicking() {
    if (tickId === null) { tickId = setInterval(tick, REFRESH_MS); }
  }

  function stopTicking() {
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
  }

  // Appelée 4 fois par seconde tant que le chrono tourne
  function tick() {
    if (!state) { return; }
    if (state.status !== 'running') {
      stopTicking();
    } else if (state.mode === 'pomodoro' && getElapsedMs(Date.now()) >= getPhaseMs()) {
      completePhase();
      return;
    }
    updateTime();
  }

  // Met à jour le grand affichage et l'anneau (ce qui change à chaque tick)
  function updateTime() {
    if (!root) { return; }
    const elapsed = getElapsedMs(Date.now());
    let text;
    let progress;

    if (state.mode === 'pomodoro') {
      text = formatCountdown(getPhaseMs() - elapsed);   // compte à rebours MM:SS
      progress = Math.min(1, elapsed / getPhaseMs());   // 0 = début, 1 = étape terminée
    } else {
      text = formatStopwatch(elapsed);                  // chronomètre HH:MM:SS
      progress = (elapsed % 60000) / 60000;             // un tour d'anneau par minute
    }

    setText(els.display, text);
    els.arc.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - progress)).toFixed(2));
    els.arc.setAttribute('opacity', progress > 0 ? '1' : '0');
  }

  function getStepLabel() {
    if (state.mode !== 'pomodoro') { return 'Chronomètre'; }
    if (state.phase === 'break') { return 'Pause'; }
    if (state.phase === 'long') { return 'Longue pause'; }
    return 'Travail ' + state.cycle + ' / ' + CYCLE_LENGTH;
  }

  function getHintText() {
    if (state.status === 'running') { return 'En cours'; }
    if (state.status === 'paused') { return 'En pause'; }
    if (state.status === 'waiting') { return 'En attente : appuyer sur Reprendre.'; }
    return 'Prêt à démarrer.';
  }

  // Met à jour les boutons, les champs et les textes (ce qui change quand l'état change)
  function updateControls() {
    if (!root) { return; }
    const active = document.activeElement;
    const idle = state.status === 'idle';
    const running = state.status === 'running';
    const pomodoro = state.mode === 'pomodoro';

    // Seuls les boutons utiles sont actifs
    els.start.disabled = !idle;
    els.toggle.disabled = idle;
    setText(els.toggle, running ? 'Pause' : 'Reprendre');
    els.finish.disabled = idle;
    els.abandon.disabled = !(running || state.status === 'paused');

    // Le mode, la matière et les durées ne se changent qu'au repos
    els.modeStopwatch.disabled = !idle;
    els.modePomodoro.disabled = !idle;
    els.subject.disabled = !idle;
    els.workMin.disabled = !idle;
    els.breakMin.disabled = !idle;
    els.longMin.disabled = !idle;
    els.modeStopwatch.setAttribute('aria-pressed', pomodoro ? 'false' : 'true');
    els.modePomodoro.setAttribute('aria-pressed', pomodoro ? 'true' : 'false');
    els.options.hidden = !pomodoro;

    // Textes, et attributs utilisés par le CSS pour les couleurs
    setText(els.step, getStepLabel());
    setText(els.hint, getHintText());
    root.setAttribute('data-status', state.status);
    root.setAttribute('data-phase', pomodoro ? state.phase : 'work');

    // Si le bouton qui avait le focus vient d'être désactivé, on donne le focus au bon bouton
    if (active && active.disabled && root.contains(active)) {
      (idle ? els.start : els.toggle).focus();
    }
  }

  function refreshAll() {
    updateControls();
    updateTime();
  }


  /* ======================= 7. SON (bip de fin d'étape) ======================= */

  function getAudioContext() {
    if (audioCtx) { return audioCtx; }
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (AudioClass) { audioCtx = new AudioClass(); }
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  // Un navigateur autorise le son seulement après un clic : on le « réveille » au clic sur Démarrer / Reprendre
  function wakeAudio(ctx) {
    try {
      if (ctx && ctx.state === 'suspended') {
        const promise = ctx.resume();
        if (promise && promise.catch) { promise.catch(function () {}); }
      }
    } catch (e) {
      /* pas de son possible */
    }
  }

  function prepareAudio() {
    if (state.sound) { wakeAudio(getAudioContext()); }
  }

  // Bip court de 0,4 seconde (une note à 880 Hz)
  function beep() {
    if (!state.sound) { return; }
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') { return; }
    try {
      const begin = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const volume = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      volume.gain.setValueAtTime(0.0001, begin);
      volume.gain.exponentialRampToValueAtTime(0.25, begin + 0.02); // montée rapide (évite le « clic »)
      volume.gain.exponentialRampToValueAtTime(0.0001, begin + 0.35);
      oscillator.connect(volume);
      volume.connect(ctx.destination);
      oscillator.start(begin);
      oscillator.stop(begin + 0.4);
    } catch (e) {
      /* pas de son possible */
    }
  }


  /* ======================= 8. JOURNAL DU JOUR ======================= */

  // Met à jour la liste de matières, le total et la liste des sessions du jour.
  // Peut être appelée à tout moment, même page masquée ou pas encore construite.
  function render() {
    if (!root) { return; }
    try {
      renderSubjects();
      renderToday();
    } catch (e) {
      /* une erreur d'affichage ne doit jamais remonter à l'utilisateur */
    }
  }

  // Les matières connues, proposées dans le champ « Matière »
  function renderSubjects() {
    const subjects = SF.filters.getSubjects() || [];
    els.datalist.textContent = '';
    subjects.forEach(function (name) {
      const option = document.createElement('option');
      option.value = String(name);
      els.datalist.appendChild(option);
    });
  }

  function renderToday() {
    const stats = SF.sessions.getStats() || {};
    setText(els.todayTitle, "Aujourd'hui : " + SF.app.formatMinutes(Number(stats.todayMinutes) || 0));

    // La plus récente en premier (createdAt est une date-heure : on peut comparer les textes)
    const sessions = (SF.sessions.getByDate(todayISO()) || []).slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    els.list.textContent = '';
    sessions.forEach(function (session) {
      els.list.appendChild(buildItem(session));
    });
    els.list.hidden = sessions.length === 0;
    els.empty.hidden = sessions.length > 0;
  }

  // Une ligne de la liste : pastille de couleur, matière, durée, bouton Supprimer
  function buildItem(session) {
    const item = el('li', 'timer-item');

    const dot = el('span', 'dot timer-dot');
    dot.style.background = SF.app.subjectColor(session.subject);
    dot.setAttribute('aria-hidden', 'true');

    const main = el('span', 'timer-item-main');
    main.appendChild(el('span', 'timer-item-subject', session.subject));
    const time = clockTime(session.createdAt);
    if (time) { main.appendChild(el('span', 'timer-item-meta', 'à ' + time)); }
    if (session.note) { main.appendChild(el('span', 'timer-item-meta', session.note)); }

    const duration = SF.app.formatMinutes(session.minutes);
    const remove = button('Supprimer', 'btn btn-ghost timer-item-delete');
    remove.setAttribute('aria-label', 'Supprimer la session de ' + session.subject + ' (' + duration + ')');
    remove.addEventListener('click', function () { deleteSession(session); });

    item.appendChild(dot);
    item.appendChild(main);
    item.appendChild(el('span', 'timer-item-minutes', duration));
    item.appendChild(remove);
    return item;
  }

  // Supprimer : confirmation, puis SF.sessions.remove (la liste se met à jour toute seule)
  function deleteSession(session) {
    askConfirm({
      title: 'Supprimer cette session ?',
      message: 'La session de ' + SF.app.formatMinutes(session.minutes) + ' de ' + session.subject + ' sera supprimée du journal.',
      confirmLabel: 'Supprimer',
      danger: true
    }, function () {
      const result = SF.sessions.remove(session.id);
      if (result === false || (result && result.ok === false)) {
        notify('Suppression impossible.', 'error');
      } else {
        notify('Session supprimée.', 'info');
      }
    });
  }


  /* ======================= 9. CONSTRUCTION DE LA PAGE ======================= */

  function buildHeader() {
    const head = el('header', 'timer-head');
    head.appendChild(el('h2', 'timer-title', 'Chrono'));
    head.appendChild(el('p', 'timer-lead', "Chronomètre ou pomodoro : le temps travaillé est enregistré dans le journal d'étude."));
    return head;
  }

  // Deux boutons segmentés : Chronomètre / Pomodoro
  function buildModes() {
    const box = el('div', 'timer-modes');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Mode');
    els.modeStopwatch = button('Chronomètre', 'timer-mode');
    els.modePomodoro = button('Pomodoro', 'timer-mode');
    box.appendChild(els.modeStopwatch);
    box.appendChild(els.modePomodoro);
    return box;
  }

  // Champ « Matière » avec sa liste de suggestions et son message d'erreur
  function buildSubjectField() {
    const box = el('div', 'timer-field');

    const label = el('label', 'timer-label', 'Matière');
    label.setAttribute('for', 'timer-subject');

    els.subject = el('input', 'timer-input timer-subject-input');
    els.subject.id = 'timer-subject';
    els.subject.type = 'text';
    els.subject.maxLength = SUBJECT_MAX;
    els.subject.placeholder = 'Ex. : Maths';
    els.subject.setAttribute('list', 'timer-subject-list');
    els.subject.setAttribute('autocomplete', 'off');
    els.subject.setAttribute('aria-describedby', 'timer-subject-error');

    els.datalist = el('datalist');
    els.datalist.id = 'timer-subject-list';

    els.subjectError = el('p', 'timer-error', 'Matière manquante : saisir ou choisir une matière pour démarrer.');
    els.subjectError.id = 'timer-subject-error';
    els.subjectError.setAttribute('role', 'alert');
    els.subjectError.hidden = true;

    box.appendChild(label);
    box.appendChild(els.subject);
    box.appendChild(els.datalist);
    box.appendChild(els.subjectError);
    return box;
  }

  // Un petit champ de durée (en minutes)
  function buildDuration(key, text) {
    const box = el('div', 'timer-duration');
    const label = el('label', 'timer-label', text);
    label.setAttribute('for', 'timer-' + key);

    els[key] = el('input', 'timer-input timer-duration-input');
    els[key].id = 'timer-' + key;
    els[key].type = 'number';
    els[key].min = RANGES[key][0];
    els[key].max = RANGES[key][1];
    els[key].step = 1;
    els[key].setAttribute('inputmode', 'numeric');

    box.appendChild(label);
    box.appendChild(els[key]);
    return box;
  }

  // Réglages du pomodoro : trois durées et la case « Son » (visibles seulement en mode Pomodoro)
  function buildOptions() {
    els.options = el('div', 'timer-options');

    const title = el('p', 'timer-label', 'Durées en minutes (travail : 1 à 120, pauses : 1 à 60)');
    title.id = 'timer-durations-title';

    const group = el('div', 'timer-durations');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', 'timer-durations-title');
    group.appendChild(buildDuration('workMin', 'Travail'));
    group.appendChild(buildDuration('breakMin', 'Pause'));
    group.appendChild(buildDuration('longMin', 'Longue pause'));

    const soundLabel = el('label', 'timer-sound');
    els.sound = el('input', 'timer-sound-input');
    els.sound.type = 'checkbox';
    soundLabel.appendChild(els.sound);
    soundLabel.appendChild(el('span', '', 'Son'));

    els.options.appendChild(title);
    els.options.appendChild(group);
    els.options.appendChild(soundLabel);
    return els.options;
  }

  // Le cadran : un anneau SVG de progression, avec le temps et l'étape au centre
  function buildDial() {
    const dial = el('div', 'timer-dial');

    const svg = svgEl('svg', { 'class': 'timer-ring', 'viewBox': '0 0 120 120', 'aria-hidden': 'true', 'focusable': 'false' });
    svg.appendChild(svgEl('circle', { 'class': 'timer-ring-track', 'cx': 60, 'cy': 60, 'r': RING_RADIUS }));
    els.arc = svgEl('circle', {
      'class': 'timer-ring-arc',
      'cx': 60,
      'cy': 60,
      'r': RING_RADIUS,
      'transform': 'rotate(-90 60 60)',                      // l'anneau commence en haut
      'stroke-dasharray': RING_LENGTH.toFixed(2),
      'stroke-dashoffset': RING_LENGTH.toFixed(2),
      'opacity': '0'
    });
    svg.appendChild(els.arc);

    const center = el('div', 'timer-dial-text');
    els.display = el('div', 'timer-display', '00:00:00');
    els.display.setAttribute('role', 'timer');
    els.display.setAttribute('aria-label', 'Temps du chrono');
    els.step = el('div', 'timer-step');
    center.appendChild(els.display);
    center.appendChild(els.step);

    dial.appendChild(svg);
    dial.appendChild(center);
    return dial;
  }

  // Démarrer / Pause-Reprendre / Terminer / Abandonner
  function buildActions() {
    const box = el('div', 'timer-actions');
    els.start = button('Démarrer', 'btn btn-primary timer-btn timer-btn-start');
    els.toggle = button('Pause', 'btn timer-btn timer-btn-toggle');
    els.finish = button('Terminer', 'btn timer-btn timer-btn-finish');
    els.abandon = button('Abandonner', 'btn btn-ghost timer-btn timer-btn-abandon');
    box.appendChild(els.start);
    box.appendChild(els.toggle);
    box.appendChild(els.finish);
    box.appendChild(els.abandon);
    return box;
  }

  function buildShortcutNote() {
    const note = el('p', 'timer-shortcut');
    note.appendChild(el('kbd', 'timer-kbd', 'Espace'));
    note.appendChild(document.createTextNode(' : démarrer ou mettre en pause'));
    return note;
  }

  // La carte du chrono
  function buildPanel() {
    const panel = el('section', 'card timer-panel');
    panel.setAttribute('aria-label', 'Chronomètre et pomodoro');
    els.hint = el('p', 'timer-hint');
    els.hint.setAttribute('role', 'status');

    panel.appendChild(buildModes());
    panel.appendChild(buildSubjectField());
    panel.appendChild(buildOptions());
    panel.appendChild(buildDial());
    panel.appendChild(els.hint);
    panel.appendChild(buildActions());
    panel.appendChild(buildShortcutNote());
    return panel;
  }

  // La carte « Aujourd'hui »
  function buildToday() {
    const card = el('section', 'card timer-today');
    card.setAttribute('aria-label', 'Sessions du jour');
    els.todayTitle = el('h3', 'card-title timer-today-title', "Aujourd'hui : 0 min");
    els.list = el('ul', 'timer-list');
    els.empty = el('p', 'empty timer-empty', "Aucune session enregistrée aujourd'hui.");
    card.appendChild(els.todayTitle);
    card.appendChild(els.list);
    card.appendChild(els.empty);
    return card;
  }

  // Remplit les champs avec l'état sauvegardé (dernière matière, durées, son)
  function fillFields() {
    els.subject.value = state.subject;
    els.workMin.value = state.workMin;
    els.breakMin.value = state.breakMin;
    els.longMin.value = state.longMin;
    els.sound.checked = state.sound;
  }

  function bindEvents() {
    els.modeStopwatch.addEventListener('click', function () { setMode('stopwatch'); });
    els.modePomodoro.addEventListener('click', function () { setMode('pomodoro'); });
    els.subject.addEventListener('input', function () { showSubjectError(false); });
    Object.keys(RANGES).forEach(function (key) {
      els[key].addEventListener('change', onDurationChange);
    });
    els.sound.addEventListener('change', onSoundChange);
    els.start.addEventListener('click', start);
    els.toggle.addEventListener('click', toggle);
    els.finish.addEventListener('click', finish);
    els.abandon.addEventListener('click', abandon);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    SF.events.on('data:changed', render);
  }


  /* ======================= 10. CLAVIER ET ONGLET ======================= */

  // La page Chrono est-elle affichée ? (une page masquée n'a aucun rectangle à l'écran)
  function isShown() {
    return !!root && root.getClientRects().length > 0;
  }

  // Champs et boutons gardent leur propre comportement avec la barre d'espace
  function usesSpaceKey(node) {
    if (!node || !node.tagName) { return false; }
    const tag = node.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
           tag === 'button' || tag === 'a' || node.isContentEditable === true;
  }

  // Barre d'espace : démarrer, mettre en pause ou reprendre (si le focus n'est pas dans un champ)
  function onKeyDown(event) {
    if (event.code !== 'Space' && event.key !== ' ') { return; }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) { return; }
    if (!isShown() || document.querySelector('dialog[open]')) { return; }
    if (usesSpaceKey(event.target)) { return; }
    event.preventDefault(); // évite que la page défile
    if (state.status === 'idle') {
      start();
    } else {
      toggle();
    }
  }

  // Quand on revient sur l'onglet, on met tout de suite l'affichage à jour
  function onVisibilityChange() {
    if (!document.hidden) { tick(); }
  }


  /* ======================= 11. MONTAGE ET AFFICHAGE ======================= */

  // Appelée UNE seule fois : construit la page
  function mount(container) {
    if (root) { return; }
    state = loadState();

    root = el('div', 'timer-page');
    root.appendChild(buildHeader());
    root.appendChild(buildPanel());
    root.appendChild(buildToday());
    container.appendChild(root);

    fillFields();
    bindEvents();
    render();
    refreshAll();
    if (state.status === 'running') { startTicking(); } // un chrono en cours est repris
  }

  // Appelée à chaque fois que la page est affichée
  function onShow() {
    if (!root) { return; }
    render();
    refreshAll();
  }

  SF.app.registerView('timer', { mount: mount, onShow: onShow });
})();