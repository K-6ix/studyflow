/* =========================================================
   StudyFlow — SF.auth : comptes utilisateurs & sauvegarde en ligne
   IIFE ES5, localStorage reste la source locale, debounce 2 s.
   La clé Gemini ("studyflow.ai.key") n'est JAMAIS envoyée au serveur.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  var API_BASE = 'api/';
  var DEBOUNCE_MS = 2000;
  var LOCAL_CHOICE_KEY = 'studyflow.auth.localMode';

  var state = {
    checked: false,
    authenticated: false,
    user: null,             // { id, email, username } ou null
    csrfToken: '',
    serverVersion: 0,
    syncStatus: 'local',    // 'local' | 'synced' | 'syncing' | 'offline' | 'conflict'
    localOnly: false
  };

  var debounceTimer = null;
  var isApplyingRemote = false;
  var conflictOpen = false;
  var syncPill = null;
  var authListeners = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function notify() {
    renderSyncPill();
    authListeners.forEach(function (fn) {
      try { fn(getState()); } catch (e) { /* ignore */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === 'function' && authListeners.indexOf(fn) === -1) {
      authListeners.push(fn);
    }
  }

  function getState() {
    return {
      checked: state.checked,
      authenticated: state.authenticated,
      user: state.user ? { id: state.user.id, email: state.user.email, username: state.user.username } : null,
      serverVersion: state.serverVersion,
      syncStatus: state.syncStatus,
      localOnly: state.localOnly
    };
  }

  function statusText(status) {
    if (status === 'synced') return 'Synchronisé';
    if (status === 'syncing') return 'Envoi…';
    if (status === 'offline') return 'Hors ligne';
    if (status === 'conflict') return 'Conflit';
    return 'Mode local';
  }

  function ensureSyncPill() {
    if (syncPill) return syncPill;
    var topbar = document.querySelector('.topbar');
    if (!topbar) return null;

    var btn = el('button', 'auth-sync-pill');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'État de la synchronisation et du compte');
    btn.appendChild(el('span', 'auth-sync-dot'));
    btn.appendChild(el('span', 'auth-sync-label', 'Mode local'));
    btn.addEventListener('click', function () {
      if (state.authenticated) {
        SF.app.navigate('settings');
      } else {
        openAuthModal('login');
      }
    });
    topbar.appendChild(btn);
    syncPill = btn;
    return syncPill;
  }

  function renderSyncPill() {
    var pill = ensureSyncPill();
    if (!pill) return;
    var label = pill.querySelector('.auth-sync-label');
    pill.setAttribute('data-status', state.syncStatus);
    if (label) label.textContent = statusText(state.syncStatus);
    if (state.authenticated && state.user) {
      pill.title = (state.user.username || state.user.email) + ' · ' + statusText(state.syncStatus);
    } else {
      pill.title = 'Mode local · Cliquez pour vous connecter';
    }
  }

  // Requête JSON vers /api/*.php avec cookies + CSRF sur POST/PUT
  function apiFetch(endpoint, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var headers = { 'Accept': 'application/json' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if ((method === 'POST' || method === 'PUT') && state.csrfToken) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }

    return fetch(API_BASE + endpoint, {
      method: method,
      credentials: 'same-origin',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var json = null;
        try { json = txt ? JSON.parse(txt) : {}; } catch (e) { json = { ok: false }; }
        if (json && typeof json.csrfToken === 'string' && json.csrfToken) {
          state.csrfToken = json.csrfToken;
        }
        return { status: res.status, ok: res.ok, data: json || {} };
      });
    });
  }

  // Vérifie si un export StudyFlow contient au moins une donnée utilisateur
  function parseExport(jsonText) {
    try {
      var obj = JSON.parse(jsonText);
      if (!obj || obj.app !== 'StudyFlow') return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function countItems(obj) {
    if (!obj) return { courses: 0, activities: 0, goals: 0, sessions: 0, total: 0 };
    var c = Array.isArray(obj.courses) ? obj.courses.length : 0;
    var a = Array.isArray(obj.activities) ? obj.activities.length : 0;
    var g = Array.isArray(obj.goals) ? obj.goals.length : 0;
    var s = Array.isArray(obj.sessions) ? obj.sessions.length : 0;
    return { courses: c, activities: a, goals: g, sessions: s, total: c + a + g + s };
  }

  function hasMeaningfulData(jsonText) {
    var obj = parseExport(jsonText);
    return countItems(obj).total > 0;
  }

  // Compare deux sauvegardes en ignorant le horodatage exportedAt
  function semanticEqual(aText, bText) {
    var a = parseExport(aText);
    var b = parseExport(bText);
    if (!a || !b) return false;
    var normA = JSON.stringify({
      courses: a.courses || [],
      activities: a.activities || [],
      goals: a.goals || [],
      sessions: a.sessions || [],
      settings: a.settings || {}
    });
    var normB = JSON.stringify({
      courses: b.courses || [],
      activities: b.activities || [],
      goals: b.goals || [],
      sessions: b.sessions || [],
      settings: b.settings || {}
    });
    return normA === normB;
  }

  // Applique une sauvegarde distante dans localStorage sans redéclencher d'envoi auto
  function applyRemoteData(jsonText, version) {
    isApplyingRemote = true;
    try {
      var res = SF.storage.importJSON(jsonText);
      if (res && res.ok) {
        state.serverVersion = Number(version) || 0;
        state.syncStatus = 'synced';
        notify();
        return true;
      }
      return false;
    } finally {
      isApplyingRemote = false;
    }
  }

  // Boîte de dialogue en cas de conflit (connexion ou HTTP 409)
  function openConflictModal(serverDataText, serverVersion) {
    if (conflictOpen) return;
    conflictOpen = true;
    state.syncStatus = 'conflict';
    notify();

    var localText = SF.storage.exportJSON();
    var localCounts = countItems(parseExport(localText));
    var serverCounts = countItems(parseExport(serverDataText));

    var dialog = el('dialog', 'auth-dialog');
    var head = el('div', 'auth-head');
    head.appendChild(el('h2', 'auth-title', 'Données différentes détectées'));
    head.appendChild(el('p', 'auth-sub', 'Choisissez quelle version conserver entre cet appareil et le serveur.'));
    dialog.appendChild(head);

    var boxes = el('div', 'auth-conflict-boxes');
    var bLocal = el('div', 'auth-conflict-box');
    bLocal.appendChild(el('strong', '', 'Cet appareil'));
    bLocal.appendChild(el('span', '', localCounts.activities + ' activités · ' + localCounts.courses + ' cours'));
    bLocal.appendChild(el('span', '', localCounts.sessions + ' séances · ' + localCounts.goals + ' objectifs'));

    var bServer = el('div', 'auth-conflict-box');
    bServer.appendChild(el('strong', '', 'Serveur'));
    bServer.appendChild(el('span', '', serverCounts.activities + ' activités · ' + serverCounts.courses + ' cours'));
    bServer.appendChild(el('span', '', serverCounts.sessions + ' séances · ' + serverCounts.goals + ' objectifs'));

    boxes.appendChild(bLocal);
    boxes.appendChild(bServer);
    dialog.appendChild(boxes);

    var errP = el('p', 'auth-error');
    errP.hidden = true;
    dialog.appendChild(errP);

    var actions = el('div', 'auth-conflict-actions');
    var keepLocalBtn = el('button', 'btn', 'Garder cet appareil');
    keepLocalBtn.type = 'button';
    var keepServerBtn = el('button', 'btn btn-primary', 'Garder le serveur');
    keepServerBtn.type = 'button';

    function close() {
      conflictOpen = false;
      try { if (dialog.open) dialog.close(); } catch (e) {}
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }

    keepServerBtn.addEventListener('click', function () {
      if (applyRemoteData(serverDataText, serverVersion)) {
        close();
        SF.app.toast('Données du serveur chargées.', 'success');
      } else {
        errP.textContent = 'La sauvegarde du serveur est invalide.';
        errP.hidden = false;
      }
    });

    keepLocalBtn.addEventListener('click', function () {
      keepLocalBtn.disabled = true;
      keepServerBtn.disabled = true;
      errP.hidden = true;
      pushData(Number(serverVersion) || 0).then(function (ok) {
        if (ok) {
          close();
          SF.app.toast('Données locales enregistrées sur le serveur.', 'success');
        } else {
          keepLocalBtn.disabled = false;
          keepServerBtn.disabled = false;
          errP.textContent = 'Impossible d\'envoyer les données pour le moment.';
          errP.hidden = false;
        }
      });
    });

    dialog.addEventListener('cancel', function (e) { e.preventDefault(); });
    actions.appendChild(keepLocalBtn);
    actions.appendChild(keepServerBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  // Envoie SF.storage.exportJSON() (jamais studyflow.ai.key) au serveur
  function pushData(overrideBaseVersion) {
    if (!state.authenticated) return Promise.resolve(false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.syncStatus = 'offline';
      notify();
      return Promise.resolve(false);
    }

    var baseVersion = overrideBaseVersion !== undefined ? overrideBaseVersion : state.serverVersion;
    var payloadText = SF.storage.exportJSON();

    state.syncStatus = 'syncing';
    notify();

    return apiFetch('data_put.php', {
      method: 'POST',
      body: {
        data: payloadText,
        base_version: baseVersion
      }
    }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        state.serverVersion = Number(res.data.version) || (baseVersion + 1);
        state.syncStatus = 'synced';
        notify();
        return true;
      }
      if (res.status === 409 && res.data) {
        if (res.data.server_data) {
          openConflictModal(res.data.server_data, res.data.server_version);
        } else {
          state.serverVersion = Number(res.data.server_version) || 0;
        }
        return false;
      }
      if (res.status === 401) {
        state.authenticated = false;
        state.user = null;
        state.syncStatus = 'local';
        notify();
        return false;
      }
      state.syncStatus = 'offline';
      notify();
      return false;
    }).catch(function () {
      state.syncStatus = 'offline';
      notify();
      return false;
    });
  }

  // Synchronisation initiale après connexion / au démarrage
  function syncOnLogin() {
    if (!state.authenticated) return Promise.resolve();
    state.syncStatus = 'syncing';
    notify();

    return apiFetch('data_get.php', { method: 'GET' }).then(function (res) {
      if (!res.ok) {
        if (res.status === 401) {
          state.authenticated = false;
          state.user = null;
          state.syncStatus = 'local';
          notify();
          return;
        }
        state.syncStatus = 'offline';
        notify();
        return;
      }

      var localText = SF.storage.exportJSON();
      var serverEmpty = Boolean(res.data.empty) || !res.data.data;
      var serverVersion = Number(res.data.version) || 0;

      if (serverEmpty) {
        // Serveur vide : on envoie les données locales
        return pushData(0);
      }

      if (!hasMeaningfulData(localText)) {
        // Appareil vide : on importe les données du serveur
        applyRemoteData(res.data.data, serverVersion);
        return;
      }

      if (semanticEqual(localText, res.data.data)) {
        state.serverVersion = serverVersion;
        state.syncStatus = 'synced';
        notify();
        return;
      }

      // Les deux ont des données différentes : choix utilisateur
      openConflictModal(res.data.data, serverVersion);
    }).catch(function () {
      state.syncStatus = 'offline';
      notify();
    });
  }

  function scheduleSync() {
    if (isApplyingRemote || !state.authenticated || state.localOnly) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      pushData();
    }, DEBOUNCE_MS);
  }

  // Règles du nom d'utilisateur (les mêmes que dans api/register.php) :
  // 3 à 30 caractères, uniquement lettres, chiffres, _ . -
  var USERNAME_RE = /^[A-Za-z0-9_.\-]{3,30}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function openAuthModal(initialMode) {
    var mode = initialMode === 'register' ? 'register' : 'login';

    var dialog = el('dialog', 'auth-dialog');
    var head = el('div', 'auth-head');
    head.appendChild(el('h2', 'auth-title', 'Compte StudyFlow'));
    head.appendChild(el('p', 'auth-sub', 'Sauvegardez vos cours, tâches et révisions en ligne sur tous vos appareils.'));
    dialog.appendChild(head);

    var tabs = el('div', 'auth-tabs');
    tabs.setAttribute('role', 'tablist');
    var tabLogin = el('button', 'auth-tab', 'Connexion');
    tabLogin.type = 'button';
    var tabReg = el('button', 'auth-tab', 'Créer un compte');
    tabReg.type = 'button';
    tabs.appendChild(tabLogin);
    tabs.appendChild(tabReg);
    dialog.appendChild(tabs);

    var form = el('form', 'auth-form');
    form.noValidate = true;

    // Petit outil : un champ = un bloc (label + input), relié par id / for.
    function makeField(id, labelText, type, autocomplete, placeholder) {
      var wrap = el('div', 'auth-field');
      var label = el('label', 'auth-label', labelText);
      label.htmlFor = id;
      var input = el('input', 'auth-input');
      input.id = id;
      input.type = type;
      input.autocomplete = autocomplete;
      if (placeholder) input.placeholder = placeholder;
      wrap.appendChild(label);
      wrap.appendChild(input);
      return { wrap: wrap, label: label, input: input };
    }

    // Connexion : un seul champ « e-mail ou nom d'utilisateur »
    var fIdentifier = makeField('auth-identifier', 'E-mail ou nom d\'utilisateur', 'text', 'username', 'etudiant@exemple.fr ou etudiant42');
    fIdentifier.input.setAttribute('autocapitalize', 'none');
    fIdentifier.input.setAttribute('spellcheck', 'false');

    // Inscription : e-mail + nom d'utilisateur
    var fEmail = makeField('auth-email', 'Adresse e-mail', 'email', 'email', 'etudiant@exemple.fr');
    var fUser = makeField('auth-username', 'Nom d\'utilisateur (3 à 30 caractères : lettres, chiffres, _ . -)', 'text', 'username', 'etudiant42');
    fUser.input.maxLength = 30;
    fUser.input.setAttribute('autocapitalize', 'none');
    fUser.input.setAttribute('spellcheck', 'false');

    // Mot de passe (commun aux deux modes)
    var fPass = makeField('auth-password', 'Mot de passe', 'password', 'current-password', '••••••••');

    var errP = el('p', 'auth-error');
    errP.hidden = true;

    var actions = el('div', 'auth-actions');
    var submitBtn = el('button', 'btn btn-primary', 'Se connecter');
    submitBtn.type = 'submit';
    var localBtn = el('button', 'btn btn-ghost', 'Continuer sans compte (mode local)');
    localBtn.type = 'button';
    actions.appendChild(submitBtn);
    actions.appendChild(localBtn);

    form.appendChild(fIdentifier.wrap);
    form.appendChild(fEmail.wrap);
    form.appendChild(fUser.wrap);
    form.appendChild(fPass.wrap);
    form.appendChild(errP);
    form.appendChild(actions);
    dialog.appendChild(form);
    dialog.appendChild(el('p', 'auth-note', 'Vos données restent toujours disponibles hors ligne sur cet appareil.'));
    document.body.appendChild(dialog);

    // Affiche les bons champs selon l'onglet choisi.
    function refreshMode() {
      var isLogin = mode === 'login';
      tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
      tabReg.setAttribute('aria-selected', isLogin ? 'false' : 'true');

      fIdentifier.wrap.hidden = !isLogin;
      fEmail.wrap.hidden = isLogin;
      fUser.wrap.hidden = isLogin;

      fPass.label.textContent = isLogin ? 'Mot de passe' : 'Mot de passe (8 caractères minimum)';
      fPass.input.autocomplete = isLogin ? 'current-password' : 'new-password';
      submitBtn.textContent = isLogin ? 'Se connecter' : 'Créer mon compte';
      errP.hidden = true;
    }

    function focusFirstField() {
      (mode === 'login' ? fIdentifier.input : fEmail.input).focus();
    }

    function close() {
      try { if (dialog.open) dialog.close(); } catch (e) {}
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }

    function showError(message) {
      errP.textContent = message;
      errP.hidden = false;
    }

    tabLogin.addEventListener('click', function () { mode = 'login'; refreshMode(); focusFirstField(); });
    tabReg.addEventListener('click', function () { mode = 'register'; refreshMode(); focusFirstField(); });

    localBtn.addEventListener('click', function () {
      state.localOnly = true;
      state.syncStatus = 'local';
      try { window.sessionStorage.setItem(LOCAL_CHOICE_KEY, '1'); } catch (e) {}
      notify();
      close();
    });

    dialog.addEventListener('cancel', function (e) {
      e.preventDefault();
      localBtn.click();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errP.hidden = true;
      var password = fPass.input.value;
      var body;

      if (mode === 'register') {
        var email = fEmail.input.value.trim();
        var username = fUser.input.value.trim();

        if (!EMAIL_RE.test(email)) {
          showError('Veuillez saisir une adresse e-mail valide.');
          return;
        }
        if (!USERNAME_RE.test(username)) {
          showError('Le nom d\'utilisateur doit faire 3 à 30 caractères : lettres, chiffres, _ . - uniquement.');
          return;
        }
        if (password.length < 8) {
          showError('Le mot de passe doit contenir au moins 8 caractères.');
          return;
        }
        body = { email: email, username: username, password: password };
      } else {
        var identifier = fIdentifier.input.value.trim();
        if (!identifier || !password) {
          showError('Veuillez saisir votre e-mail ou nom d\'utilisateur et votre mot de passe.');
          return;
        }
        body = { identifier: identifier, password: password };
      }

      submitBtn.disabled = true;
      var endpoint = mode === 'register' ? 'register.php' : 'login.php';
      apiFetch(endpoint, {
        method: 'POST',
        body: body
      }).then(function (res) {
        submitBtn.disabled = false;
        if (!res.ok || !res.data || !res.data.ok) {
          showError((res.data && res.data.error) || 'Échec de l\'authentification.');
          return;
        }
        state.authenticated = true;
        state.localOnly = false;
        state.user = res.data.user;
        try { window.sessionStorage.removeItem(LOCAL_CHOICE_KEY); } catch (ex) {}
        close();
        SF.app.toast(mode === 'register' ? 'Compte créé !' : 'Connexion réussie.', 'success');
        syncOnLogin();
      }).catch(function () {
        submitBtn.disabled = false;
        showError('Serveur injoignable. Utilisez le mode local pour continuer hors ligne.');
      });
    });

    refreshMode();
    dialog.showModal();
    focusFirstField();
  }

  // Va chercher le journal des connexions du compte (utilisé par la page « Journal »).
  // Renvoie toujours { ok: true, entries: [...] } ou { ok: false, error: '...' }.
  function fetchLoginLog() {
    if (!state.authenticated) {
      return Promise.resolve({ ok: false, error: 'Connectez-vous pour voir le journal.' });
    }
    return apiFetch('log_get.php', { method: 'GET' }).then(function (res) {
      if (res.ok && res.data && res.data.ok && Array.isArray(res.data.entries)) {
        return { ok: true, entries: res.data.entries };
      }
      if (res.status === 401) {
        state.authenticated = false;
        state.user = null;
        state.syncStatus = 'local';
        notify();
        return { ok: false, error: 'Vous n\'êtes plus connecté.' };
      }
      return { ok: false, error: (res.data && res.data.error) || 'Impossible de charger le journal.' };
    }).catch(function () {
      return { ok: false, error: 'Serveur injoignable.' };
    });
  }

  function logout() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return apiFetch('logout.php', { method: 'POST', body: {} }).catch(function () {
      return { ok: true };
    }).then(function () {
      state.authenticated = false;
      state.user = null;
      state.serverVersion = 0;
      state.localOnly = true;
      state.syncStatus = 'local';
      notify();
      SF.app.toast('Déconnecté.', 'info');
    });
  }

  function init() {
    ensureSyncPill();
    SF.events.on('data:changed', scheduleSync);

    window.addEventListener('online', function () {
      if (state.authenticated) pushData();
    });
    window.addEventListener('offline', function () {
      if (state.authenticated) {
        state.syncStatus = 'offline';
        notify();
      }
    });

    var dismissedBefore = false;
    try {
      dismissedBefore = window.sessionStorage.getItem(LOCAL_CHOICE_KEY) === '1';
    } catch (e) { /* ignore */ }

    return apiFetch('me.php', { method: 'GET' }).then(function (res) {
      state.checked = true;
      if (res.ok && res.data && res.data.authenticated && res.data.user) {
        state.authenticated = true;
        state.localOnly = false;
        state.user = res.data.user;
        notify();
        return syncOnLogin();
      }
      state.authenticated = false;
      state.user = null;
      state.syncStatus = 'local';
      notify();
      if (!dismissedBefore) {
        openAuthModal('login');
      }
    }).catch(function () {
      state.checked = true;
      state.authenticated = false;
      state.syncStatus = 'offline';
      notify();
    });
  }

  function buildSettingsCard() {
    var authState = getState();
    var accCard = el('section', 'card auth-account-card');
    accCard.appendChild(el('h2', 'card-title', 'Compte et sauvegarde en ligne'));

    var accRow = el('div', 'auth-account-row');
    var accInfo = el('div', 'auth-account-info');

    if (authState.authenticated && authState.user) {
      // Ligne en gras : le pseudo (ou l'e-mail si un vieux compte n'en avait pas) ; dessous : l'e-mail.
      accInfo.appendChild(el('span', 'auth-account-email', authState.user.username || authState.user.email));
      if (authState.user.username) {
        accInfo.appendChild(el('span', 'auth-account-status', authState.user.email));
      }
      var statusLabel = authState.syncStatus === 'synced' ? 'Synchronisé'
        : authState.syncStatus === 'syncing' ? 'Envoi en cours…'
        : authState.syncStatus === 'offline' ? 'Hors ligne (sauvegarde locale active)'
        : 'Conflit à résoudre';
      accInfo.appendChild(el('span', 'auth-account-status', 'État : ' + statusLabel));
      accRow.appendChild(accInfo);

      var accBtns = el('div', 'settings-actions');
      var syncBtn = el('button', 'btn', 'Synchroniser');
      syncBtn.type = 'button';
      syncBtn.addEventListener('click', function () {
        pushData().then(function (ok) {
          if (ok) SF.app.toast('Sauvegarde synchronisée.', 'success');
        });
      });
      var outBtn = el('button', 'btn', 'Se déconnecter');
      outBtn.type = 'button';
      outBtn.addEventListener('click', function () {
        logout();
      });
      var logBtn = el('button', 'btn', 'Journal des connexions');
      logBtn.type = 'button';
      logBtn.addEventListener('click', function () {
        SF.app.navigate('log');
      });
      accBtns.appendChild(syncBtn);
      accBtns.appendChild(logBtn);
      accBtns.appendChild(outBtn);
      accRow.appendChild(accBtns);
    } else {
      accInfo.appendChild(el('span', 'auth-account-email', 'Mode local uniquement'));
      accInfo.appendChild(el('span', 'auth-account-status', 'Connectez-vous pour sauvegarder vos données en ligne et les retrouver sur d\'autres appareils.'));
      accRow.appendChild(accInfo);

      var loginBtn = el('button', 'btn btn-primary', 'Connexion / Créer un compte');
      loginBtn.type = 'button';
      loginBtn.addEventListener('click', function () {
        openAuthModal('login');
      });
      accRow.appendChild(loginBtn);
    }

    accCard.appendChild(accRow);
    return accCard;
  }

  SF.auth = {
    init: init,
    getState: getState,
    openAuthModal: openAuthModal,
    logout: logout,
    syncNow: function () { return pushData(); },
    fetchLoginLog: fetchLoginLog,
    onChange: onChange,
    buildSettingsCard: buildSettingsCard
  };
})();
