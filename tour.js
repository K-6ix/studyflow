/* =========================================================
   StudyFlow — SF.tour : visite guidée interactive « projecteur »

   Navigue automatiquement vers chaque page (SF.app.navigate),
   éclaire les éléments clés (attributs data-tour="...") et affiche
   une bulle explicative juste à côté (collée en bas sur mobile).

   - S'ouvre toute seule au premier lancement.
   - Un bouton « ? » dans la barre latérale permet de la revoir.
   - readSeen() / writeSeen() inchangées (aucune donnée utilisateur écrite).
   - Retour automatique sur la page Accueil à la fin ou à la sortie.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  var SEEN_KEY = 'studyflow.v1.tourSeen';
  var MOBILE_BREAKPOINT = 640;
  var WAIT_TIMEOUT_MS = 1500;
  var WAIT_INTERVAL_MS = 80;
  var SPOTLIGHT_PAD = 8;
  var BUBBLE_GAP = 14;
  var VIEWPORT_MARGIN = 12;

  // ----- Repérage des éléments de la VRAIE appli --------------------------
  // Les étapes ci-dessous visent des attributs data-tour="...". La vraie appli
  // construit ses pages en JavaScript sans ces attributs : on les pose donc ici,
  // au moment où la visite cherche un élément (aucun autre fichier à modifier).
  //   css  : où chercher dans la vraie appli
  //   text : (facultatif) le texte doit commencer ainsi, pour choisir le bon élément
  var TARGET_RULES = [
    { name: 'home-progress',          css: '#view-home .home-progress' },
    { name: 'home-recent',            css: '#view-home .home-recent' },
    { name: 'home-calendar',          css: '#view-home .home-month' },
    { name: 'agenda-course',          css: '#view-agenda .agenda-actions button', text: /^\+\s*Cours/ },
    { name: 'agenda-activity',        css: '#view-agenda .agenda-actions button', text: /^\+\s*Activit/ },
    { name: 'agenda-import',          css: '#view-agenda .agenda-actions button', text: /^Importer un emploi/ },
    { name: 'tasks-name',             css: '#view-tasks .tasks-quick' },
    { name: 'tasks-filters',          css: '#view-tasks .tasks-filters' },
    { name: 'revisions-create',       css: '#view-revisions .rev-head button', text: /Nouvel objectif|Cr\u00e9er un objectif/ },
    { name: 'revisions-suggestions',  css: '#view-revisions .card', text: /^Suggestions de r\u00e9vision/ },
    { name: 'timer-main',             css: '#view-timer .timer-panel' },
    { name: 'stats-charts',           css: '#view-stats .stats-charts' },
    { name: 'settings-account',       css: '#view-settings .auth-account-card' },
    { name: 'settings-backup',        css: '#view-settings .settings-section', text: /^Mes donn\u00e9es/ }
  ];

  function markTargets() {
    for (var r = 0; r < TARGET_RULES.length; r++) {
      var rule = TARGET_RULES[r];
      var nodes;
      try {
        nodes = document.querySelectorAll(rule.css);
      } catch (error) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (rule.text && !rule.text.test((node.textContent || '').replace(/^\s+/, ''))) continue;
        if (node.getAttribute('data-tour') !== rule.name) node.setAttribute('data-tour', rule.name);
      }
    }
  }

  // ----- Étapes de la visite --------------------------------------------
  // view      : identifiant passé à SF.app.navigate(id)
  // target    : sélecteur CSS (attributs data-tour) à éclairer
  // badge     : texte affiché dans le badge de marque (Bienvenue)
  // available : si présent, l'étape n'est montrée que si elle renvoie true
  var STEPS = [
    {
      id: 'welcome',
      view: 'home',
      badge: 'StudyFlow',
      title: 'Bienvenue dans StudyFlow',
      text: 'StudyFlow rassemble tes cours, tes devoirs, tes révisions et ton temps d\u2019étude au même endroit. Découvre chaque outil en quelques étapes.'
    },
    {
      id: 'home-progress',
      view: 'home',
      target: '[data-tour="home-progress"]',
      title: 'Progression du jour',
      text: 'Choisis ton objectif quotidien (1 h à 4 h ou personnalisé). Le cercle se remplit au fil de tes séances d\u2019étude.'
    },
    {
      id: 'home-recent',
      view: 'home',
      target: '[data-tour="home-recent"]',
      title: 'Activité récente',
      text: 'Retrouve ici tes dernières séances d\u2019étude. Clique sur « + » pour ajouter manuellement une séance déjà faite.'
    },
    {
      id: 'home-calendar',
      view: 'home',
      target: '[data-tour="home-calendar"]',
      title: 'Calendrier du mois',
      text: 'Clique sur un jour du calendrier du mois pour consulter les séances et les activités de cette journée.'
    },
    {
      id: 'agenda-actions',
      view: 'agenda',
      target: '[data-tour="agenda-course"], [data-tour="agenda-activity"]',
      title: 'Ajouter un cours ou une activité',
      text: '« + Cours » crée un cours hebdomadaire avec ses horaires. « + Activité » ajoute un devoir, un examen, une révision ou un projet.'
    },
    {
      id: 'agenda-import',
      view: 'agenda',
      target: '[data-tour="agenda-import"]',
      title: 'Importer un emploi du temps',
      text: 'Envoie une photo, une capture ou un PDF de ton emploi du temps. Vérifie les cours trouvés puis valide pour remplir ta semaine.'
    },
    {
      id: 'tasks-name',
      view: 'tasks',
      target: '[data-tour="tasks-name"]',
      title: 'Ajouter une tâche',
      text: 'Écris le nom de ta tâche dans le champ « Nom » (ex. « Lire chapitre 5 »), puis clique sur « Ajouter ». « Plus d\u2019options » règle la date, le type et la priorité.'
    },
    {
      id: 'tasks-filters',
      view: 'tasks',
      target: '[data-tour="tasks-filters"]',
      title: 'Filtrer tes tâches',
      text: 'Retrouve rapidement tes activités par mot-clé, matière, type, priorité ou statut (à faire, terminée ou en retard).'
    },
    {
      id: 'revisions-create',
      view: 'revisions',
      target: '[data-tour="revisions-create"]',
      title: 'Créer un objectif',
      text: 'Fixe-toi une cible en minutes ou en nombre de séances sur la période de ton choix, par exemple « 3 séances de maths cette semaine ».'
    },
    {
      id: 'revisions-suggestions',
      view: 'revisions',
      target: '[data-tour="revisions-suggestions"]',
      title: 'Séances suggérées',
      text: 'Des séances de révision te sont proposées automatiquement : tu peux les accepter dans ton agenda, modifier l\u2019heure ou la durée, ou les refuser.'
    },
    {
      id: 'timer-main',
      view: 'timer',
      target: '[data-tour="timer-main"]',
      title: 'Chronomètre et Pomodoro',
      text: 'Choisis le mode Chrono ou Pomodoro, indique ta matière puis clique sur « Démarrer » (ou barre Espace). Chaque séance terminée est enregistrée.'
    },
    {
      id: 'stats-charts',
      view: 'stats',
      target: '[data-tour="stats-charts"]',
      title: 'Graphiques principaux',
      text: 'Suis ton temps d\u2019étude par jour ou par semaine ainsi que le graphique « Temps par matière » sur la période choisie.'
    },
    {
      id: 'settings-account',
      view: 'settings',
      icon: 'user',
      target: '[data-tour="settings-account"]',
      title: 'Créer un compte',
      text: 'Crée un compte avec ton e-mail, un nom d\u2019utilisateur et un mot de passe pour sauvegarder tes données. Tu pourras ensuite te connecter avec ton e-mail ou ton nom d\u2019utilisateur.',
      available: function () { return !!window.SF.auth; }
    },
    {
      id: 'settings-backup',
      view: 'settings',
      target: '[data-tour="settings-backup"]',
      title: 'Importer et exporter tes données',
      text: 'Clique sur « Exporter mes données » pour garder une copie de sauvegarde, ou importe un fichier pour tout restaurer. Le bouton « ? » relance cette visite.'
    }
  ];

  // Icône « personne » pour l'étape Compte (les autres icônes viennent du menu du bas).
  var USER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  var backdrop = null;
  var spotlight = null;
  var bubble = null;
  var parts = null;
  var steps = [];
  var index = 0;
  var isOpen = false;
  var opener = null;
  var currentTargetSelector = null;
  var navToken = 0;
  var pollTimer = null;
  var settleTimer = null;
  var rafId = 0;
  var memorySeen = false;

  // ----- Petits utilitaires ---------------------------------------------

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

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

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (error) {
      return false;
    }
  }

  function navigateTo(viewId) {
    if (!viewId) return;
    try {
      if (window.SF && window.SF.app && typeof window.SF.app.navigate === 'function') {
        window.SF.app.navigate(viewId);
      }
    } catch (error) {
      // Ne jamais bloquer la visite si la navigation échoue.
    }
  }

  // ----- « Visite déjà vue » (SEUL endroit qui touche au stockage) -------

  function readSeen() {
    try {
      return window.localStorage.getItem(SEEN_KEY) === '1';
    } catch (error) {
      return memorySeen;
    }
  }

  function writeSeen(value) {
    memorySeen = value;
    try {
      if (value) window.localStorage.setItem(SEEN_KEY, '1');
      else window.localStorage.removeItem(SEEN_KEY);
    } catch (error) {
      // Stockage bloqué : on garde seulement la copie en mémoire.
    }
  }

  // ----- Construction de l'interface projecteur -------------------------

  function buildIcon(step) {
    if (step.badge) {
      return el('span', { class: 'tour-badge', text: step.badge, 'aria-hidden': 'true' });
    }
    var box = el('div', { class: 'tour-icon', 'aria-hidden': 'true' });
    if (step.icon === 'user') {
      box.innerHTML = USER_ICON;
    } else if (step.view) {
      var link = document.querySelector('.dock a[href="#/' + step.view + '"]');
      if (link) box.innerHTML = link.innerHTML;
    }
    if (!box.firstChild) return null;
    return box;
  }

  function ensureUI() {
    if (bubble) return;

    backdrop = el('div', { class: 'tour-backdrop', hidden: '' });
    spotlight = el('div', { class: 'tour-spotlight', hidden: '', 'aria-hidden': 'true' });
    bubble = el('section', {
      class: 'tour-bubble',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'tour-title',
      hidden: ''
    });

    parts = {};
    parts.progress = el('span', { class: 'tour-progress', 'aria-live': 'polite' });
    parts.barFill = el('div', { class: 'tour-bar-fill' });
    parts.bar = el('div', { class: 'tour-bar', 'aria-hidden': 'true' }, [parts.barFill]);
    parts.head = el('div', { class: 'tour-head' });
    parts.title = el('h2', { class: 'tour-title', id: 'tour-title', tabindex: '-1' });
    parts.text = el('p', { class: 'tour-text' });

    parts.skip = el('button', { class: 'tour-skip', type: 'button', text: 'Passer la visite' });
    parts.back = el('button', { class: 'btn btn-ghost tour-back', type: 'button', text: 'Précédent' });
    parts.next = el('button', { class: 'btn btn-primary tour-next', type: 'button', text: 'Suivant' });

    var top = el('div', { class: 'tour-top' }, [parts.progress, parts.bar]);
    var actions = el('div', { class: 'tour-actions' }, [
      parts.skip,
      el('div', { class: 'tour-actions-right' }, [parts.back, parts.next])
    ]);

    bubble.appendChild(top);
    bubble.appendChild(parts.head);
    bubble.appendChild(parts.text);
    bubble.appendChild(actions);

    document.body.appendChild(backdrop);
    document.body.appendChild(spotlight);
    document.body.appendChild(bubble);

    parts.skip.addEventListener('click', function () { close(); });
    parts.back.addEventListener('click', function () { go(index - 1); });
    parts.next.addEventListener('click', function () {
      if (index >= steps.length - 1) close();
      else go(index + 1);
    });

    // Empêche tout clic ou interaction sur le fond de sortir du tour.
    backdrop.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  // ----- Recherche et positionnement projecteur + bulle -----------------

  function getVisibleTargets(selector) {
    if (!selector) return [];
    markTargets();
    var list;
    try {
      list = document.querySelectorAll(selector);
    } catch (error) {
      return [];
    }
    var visible = [];
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      var rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible.push(node);
      }
    }
    return visible;
  }

  function getCombinedRect(nodes) {
    var first = nodes[0].getBoundingClientRect();
    var left = first.left;
    var top = first.top;
    var right = first.right;
    var bottom = first.bottom;
    for (var i = 1; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function placeCentered() {
    spotlight.hidden = true;
    backdrop.classList.add('is-dimmed');
    bubble.classList.add('is-centered');

    if (isMobile()) {
      bubble.style.left = '';
      bubble.style.top = '';
      return;
    }

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var rect = bubble.getBoundingClientRect();
    var left = clamp(Math.round((vw - rect.width) / 2), VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    var top = clamp(Math.round((vh - rect.height) / 2), VIEWPORT_MARGIN, vh - rect.height - VIEWPORT_MARGIN);
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  function placeAroundTarget(targetRect) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var spotLeft = clamp(targetRect.left - SPOTLIGHT_PAD, 4, vw - 8);
    var spotTop = clamp(targetRect.top - SPOTLIGHT_PAD, 4, vh - 8);
    var spotRight = clamp(targetRect.right + SPOTLIGHT_PAD, spotLeft + 8, vw - 4);
    var spotBottom = clamp(targetRect.bottom + SPOTLIGHT_PAD, spotTop + 8, vh - 4);
    var spotWidth = spotRight - spotLeft;
    var spotHeight = spotBottom - spotTop;

    backdrop.classList.remove('is-dimmed');
    spotlight.hidden = false;
    spotlight.style.left = Math.round(spotLeft) + 'px';
    spotlight.style.top = Math.round(spotTop) + 'px';
    spotlight.style.width = Math.round(spotWidth) + 'px';
    spotlight.style.height = Math.round(spotHeight) + 'px';

    bubble.classList.remove('is-centered');

    if (isMobile()) {
      bubble.style.left = '';
      bubble.style.top = '';
      return;
    }

    var bRect = bubble.getBoundingClientRect();
    var bw = bRect.width;
    var bh = bRect.height;

    var spaceRight = vw - spotRight - BUBBLE_GAP - VIEWPORT_MARGIN;
    var spaceLeft = spotLeft - BUBBLE_GAP - VIEWPORT_MARGIN;
    var spaceBottom = vh - spotBottom - BUBBLE_GAP - VIEWPORT_MARGIN;
    var spaceTop = spotTop - BUBBLE_GAP - VIEWPORT_MARGIN;

    var candidates = [
      { dir: 'right', space: spaceRight, fits: spaceRight >= bw },
      { dir: 'bottom', space: spaceBottom, fits: spaceBottom >= bh },
      { dir: 'left', space: spaceLeft, fits: spaceLeft >= bw },
      { dir: 'top', space: spaceTop, fits: spaceTop >= bh }
    ];

    var chosen = null;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].fits) {
        chosen = candidates[i].dir;
        break;
      }
    }

    if (!chosen) {
      // Aucun côté ne contient totalement la bulle : on prend le côté avec le plus de place.
      var bestScore = -Infinity;
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        var need = (c.dir === 'left' || c.dir === 'right') ? bw : bh;
        var score = c.space / Math.max(need, 1);
        if (score > bestScore) {
          bestScore = score;
          chosen = c.dir;
        }
      }
    }

    var centerX = spotLeft + spotWidth / 2;
    var centerY = spotTop + spotHeight / 2;
    var left = VIEWPORT_MARGIN;
    var top = VIEWPORT_MARGIN;

    if (chosen === 'right') {
      left = spotRight + BUBBLE_GAP;
      top = centerY - bh / 2;
    } else if (chosen === 'left') {
      left = spotLeft - BUBBLE_GAP - bw;
      top = centerY - bh / 2;
    } else if (chosen === 'bottom') {
      left = centerX - bw / 2;
      top = spotBottom + BUBBLE_GAP;
    } else {
      left = centerX - bw / 2;
      top = spotTop - BUBBLE_GAP - bh;
    }

    left = clamp(Math.round(left), VIEWPORT_MARGIN, vw - bw - VIEWPORT_MARGIN);
    top = clamp(Math.round(top), VIEWPORT_MARGIN, vh - bh - VIEWPORT_MARGIN);

    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  function reposition() {
    if (!isOpen || !bubble) return;
    if (!currentTargetSelector) {
      placeCentered();
      return;
    }
    var targets = getVisibleTargets(currentTargetSelector);
    if (!targets.length) {
      placeCentered();
      return;
    }
    placeAroundTarget(getCombinedRect(targets));
  }

  function scheduleReposition() {
    if (!isOpen || rafId) return;
    rafId = window.requestAnimationFrame(function () {
      rafId = 0;
      reposition();
    });
  }

  function adjustMobileScrollOverlap(targetEl) {
    if (!isMobile() || !targetEl) return;
    var bRect = bubble.getBoundingClientRect();
    var tRect = targetEl.getBoundingClientRect();
    var safeBottom = window.innerHeight - bRect.height - 16;
    if (tRect.bottom > safeBottom && tRect.top > 16) {
      var delta = Math.min(tRect.bottom - safeBottom, tRect.top - 16);
      var parent = targetEl.parentElement;
      while (parent && parent !== document.body) {
        var style = window.getComputedStyle(parent);
        var overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
          parent.scrollTop += delta;
          return;
        }
        parent = parent.parentElement;
      }
      window.scrollBy(0, delta);
    }
  }

  function clearAsyncTimers() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ----- Navigation d'étape ---------------------------------------------

  function waitForTargetAndShow(selector, token) {
    var startTime = Date.now();
    spotlight.hidden = true;
    backdrop.classList.add('is-dimmed');

    function attempt() {
      if (token !== navToken || !isOpen) return;
      var targets = getVisibleTargets(selector);
      if (targets.length) {
        currentTargetSelector = selector;
        try {
          targets[0].scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        } catch (error) {
          targets[0].scrollIntoView();
        }
        reposition();

        // Laisse le défilement doux se terminer avant le placement final.
        var settleDelay = prefersReducedMotion() ? 20 : 280;
        settleTimer = setTimeout(function () {
          settleTimer = null;
          if (token !== navToken || !isOpen) return;
          adjustMobileScrollOverlap(targets[0]);
          reposition();
        }, settleDelay);
        return;
      }

      if (Date.now() - startTime >= WAIT_TIMEOUT_MS) {
        // Élément introuvable : bulle centrée sans éclairage, sans planter.
        currentTargetSelector = null;
        placeCentered();
        return;
      }

      if (!bubble.classList.contains('is-centered')) {
        placeCentered();
      }
      pollTimer = setTimeout(attempt, WAIT_INTERVAL_MS);
    }

    // Attend une frame pour laisser la vue rendue par navigate() s'afficher.
    window.requestAnimationFrame(attempt);
  }

  function go(n) {
    if (n < 0 || n >= steps.length) return;
    navToken += 1;
    var token = navToken;
    clearAsyncTimers();

    index = n;
    var step = steps[n];
    var isLast = n === steps.length - 1;

    parts.progress.textContent = 'Étape ' + (n + 1) + ' sur ' + steps.length;
    parts.barFill.style.width = Math.round(((n + 1) / steps.length) * 100) + '%';

    clear(parts.head);
    parts.head.className = 'tour-head' + (step.badge ? ' is-welcome' : '');
    var badgeOrIcon = buildIcon(step);
    if (badgeOrIcon) parts.head.appendChild(badgeOrIcon);
    parts.head.appendChild(parts.title);

    parts.title.textContent = step.title;
    parts.text.textContent = step.text;

    parts.back.hidden = n === 0;
    parts.skip.hidden = isLast;
    parts.next.textContent = isLast ? 'Terminer' : 'Suivant';

    navigateTo(step.view);

    if (!step.target) {
      currentTargetSelector = null;
      placeCentered();
    } else {
      currentTargetSelector = null;
      waitForTargetAndShow(step.target, token);
    }

    parts.title.focus({ preventScroll: true });
  }

  // ----- Clavier (Flèches, Échap, Tab piégé dans la bulle) --------------

  function getFocusableButtons() {
    var list = [parts.skip, parts.back, parts.next];
    return list.filter(function (btn) {
      return btn && !btn.hidden && !btn.disabled;
    });
  }

  function onKeyDown(event) {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      if (index < steps.length - 1) go(index + 1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      if (index > 0) go(index - 1);
      return;
    }

    if (event.key === 'Tab') {
      var focusables = getFocusableButtons();
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;

      if (!bubble.contains(active) || active === parts.title) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  // ----- Fonctions publiques ----------------------------------------------

  function open() {
    ensureUI();
    if (isOpen) return;

    steps = STEPS.filter(function (step) {
      return typeof step.available !== 'function' || step.available();
    });
    if (!steps.length) return;

    opener = document.activeElement;
    isOpen = true;

    backdrop.hidden = false;
    bubble.hidden = false;
    spotlight.hidden = true;

    window.addEventListener('resize', scheduleReposition, { passive: true });
    window.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
    document.addEventListener('keydown', onKeyDown, true);

    go(0);
  }

  function close() {
    if (!isOpen) return;
    navToken += 1;
    clearAsyncTimers();
    isOpen = false;
    currentTargetSelector = null;

    if (backdrop) backdrop.hidden = true;
    if (spotlight) spotlight.hidden = true;
    if (bubble) bubble.hidden = true;

    window.removeEventListener('resize', scheduleReposition, { passive: true });
    window.removeEventListener('scroll', scheduleReposition, { capture: true, passive: true });
    document.removeEventListener('keydown', onKeyDown, true);

    writeSeen(true);
    navigateTo('home');
    try {
      document.dispatchEvent(new CustomEvent('sf:tour-closed'));
    } catch (error) {
      // pas vital
    }

    if (opener && opener.focus) {
      try { opener.focus(); } catch (error) { /* rien */ }
    }
    opener = null;
  }

  function reset() {
    writeSeen(false);
  }

  // Bouton « ? » dans la barre latérale, juste avant Réglages.
  function addHelpButton() {
    var rail = document.querySelector('.rail');
    if (!rail || document.getElementById('tour-help')) return;
    var button = el('button', {
      class: 'tour-help', id: 'tour-help', type: 'button',
      'aria-label': 'Visite guidée', title: 'Visite guidée'
    });
    button.textContent = '?';
    button.addEventListener('click', open);
    rail.insertBefore(button, rail.querySelector('.rail-settings') || null);
  }

  function init() {
    addHelpButton();
    // Premier lancement : on ouvre la visite un instant après l'affichage de la page.
    if (!readSeen()) setTimeout(open, 350);
  }

  SF.tour = {
    open: open,
    close: close,
    reset: reset,
    hasSeen: readSeen
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
