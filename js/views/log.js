/* =========================================================
   StudyFlow — Vue « log » : journal des connexions
   Page cachée (adresse #/log), ouverte depuis Réglages > Compte.
   Les données viennent du serveur (api/log_get.php) via SF.auth.fetchLoginLog().
   Tout texte venant du serveur est affiché avec textContent.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};

  // Texte affiché pour chaque type d'événement.
  var EVENT_LABELS = {
    register: 'Compte créé',
    success: 'Connexion réussie',
    failure: 'Échec de connexion (mot de passe incorrect)',
    locked: 'Échec de connexion : compte bloqué quelques minutes'
  };

  var listHost = null;    // zone qui change (chargement, erreur, liste)
  var lastUserId = null;  // pour savoir si le compte connecté a changé
  var loadCounter = 0;    // ignore les réponses trop anciennes

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function currentUserId() {
    var st = SF.auth ? SF.auth.getState() : null;
    return st && st.authenticated && st.user ? st.user.id : null;
  }

  function showMessage(text, isError) {
    listHost.innerHTML = '';
    listHost.appendChild(el('p', 'log-message' + (isError ? ' log-message-error' : ''), text));
  }

  // Date lisible en heure locale : « 24 nov. 2026, 09:15 »
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function buildItem(entry) {
    var event = EVENT_LABELS[entry.event] ? entry.event : 'other';
    var li = el('li', 'log-item');
    li.setAttribute('data-event', event);
    li.appendChild(el('span', 'log-dot'));

    var main = el('div', 'log-main');
    main.appendChild(el('span', 'log-label', EVENT_LABELS[entry.event] || 'Événement'));
    var detail = entry.device || 'Appareil inconnu';
    if (entry.ip) detail += ' · IP ' + entry.ip;
    main.appendChild(el('span', 'log-detail', detail));
    li.appendChild(main);

    var when = el('span', 'log-when', formatDate(entry.createdAt));
    var relative = '';
    try { relative = SF.app.relativeTime(entry.createdAt); } catch (e) { relative = ''; }
    if (relative) when.title = relative;
    li.appendChild(when);
    return li;
  }

  function renderEntries(entries) {
    listHost.innerHTML = '';
    if (!entries.length) {
      showMessage('Aucun événement enregistré pour l\'instant.', false);
      return;
    }
    var ul = el('ul', 'log-list');
    entries.forEach(function (entry) { ul.appendChild(buildItem(entry)); });
    listHost.appendChild(ul);
    listHost.appendChild(el('p', 'log-note', 'Les ' + entries.length + ' derniers événements sont affichés (le serveur n\'en garde pas plus). Les heures sont celles de cet appareil.'));
  }

  // Remplit la page : message « connecte-toi » ou chargement du journal.
  function render() {
    if (!listHost) return;
    lastUserId = currentUserId();

    if (lastUserId === null) {
      listHost.innerHTML = '';
      var wrap = el('div', 'empty');
      wrap.appendChild(el('p', '', 'Connecte-toi pour voir le journal de ton compte.'));
      var btn = el('button', 'btn btn-primary', 'Connexion / Créer un compte');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (SF.auth) SF.auth.openAuthModal('login');
      });
      wrap.appendChild(btn);
      listHost.appendChild(wrap);
      return;
    }

    var myLoad = ++loadCounter;
    showMessage('Chargement…', false);
    SF.auth.fetchLoginLog().then(function (result) {
      if (myLoad !== loadCounter) return; // une requête plus récente a pris la suite
      if (result.ok) renderEntries(result.entries);
      else showMessage(result.error, true);
    });
  }

  function mount(container) {
    var page = el('div', 'log-page');

    var head = el('div', 'log-head');
    var titles = el('div', '');
    titles.appendChild(el('h2', 'log-title', 'Journal des connexions'));
    titles.appendChild(el('p', 'log-intro', 'Quand quelqu\'un s\'est connecté à ton compte, depuis quel appareil, et les essais ratés.'));
    head.appendChild(titles);

    var actions = el('div', 'log-actions');
    var back = el('a', 'btn', '← Réglages');
    back.href = '#/settings';
    var refresh = el('button', 'btn', 'Actualiser');
    refresh.type = 'button';
    refresh.addEventListener('click', render);
    actions.appendChild(back);
    actions.appendChild(refresh);
    head.appendChild(actions);
    page.appendChild(head);

    var card = el('section', 'card');
    listHost = el('div', 'log-body');
    card.appendChild(listHost);
    page.appendChild(card);
    container.appendChild(page);

    // Si on se connecte ou se déconnecte pendant que la page est ouverte, on la refait.
    // (On compare le numéro du compte : l'état « synchro » change souvent et ne doit pas recharger.)
    if (SF.auth) {
      SF.auth.onChange(function () {
        if (location.hash === '#/log' && currentUserId() !== lastUserId) render();
      });
    }
    render();
  }

  // À chaque affichage de la page : on recharge le journal pour qu'il soit à jour.
  function onShow() { render(); }

  SF.app.registerView('log', { mount: mount, onShow: onShow });
})();
