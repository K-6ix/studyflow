/* =========================================================
   StudyFlow — SF.aiReader : lecture de l'emploi du temps par une IA (Gemini)
   ---------------------------------------------------------
   Rôle : envoyer une image ou un PDF à l'IA Gemini de Google, récupérer la
   liste des cours, et la rendre dans le même format que SF.importer.parse().
   La clé API est collée par l'utilisateur dans Réglages. Elle reste dans le
   navigateur (localStorage), sous une clé qui n'est PAS exportée avec les données.
   Aucune bibliothèque externe : un simple fetch vers l'API de Google.
   Charger APRÈS dates.js, AVANT importer-ui.js.
   ========================================================= */
(function () {
  'use strict';
  window.SF = window.SF || {};
  var SF = window.SF;

  // --- Configuration (modifiable : les noms de modèles changent avec le temps) ---
  var config = {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    // On essaie le premier ; s'il n'existe pas pour ta clé (404) ou si son quota est atteint (429), le suivant.
    // (Les modèles 2.5 sont réservés aux anciens utilisateurs : une clé neuve doit utiliser les 3.x.)
    models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'],
    timeoutMs: 60000,
    maxImageSide: 2000,          // les photos plus grandes sont réduites avant l'envoi
    maxPdfBytes: 14 * 1024 * 1024
  };

  var KEY_STORAGE = 'studyflow.ai.key';      // volontairement hors du préfixe « studyflow.v1. »
  var MODEL_STORAGE = 'studyflow.ai.model';
  var memory = { key: '', model: '' };       // secours si localStorage est indisponible

  // --- Stockage de la clé et du modèle ---
  function readStore(name, fallback) {
    try {
      var v = window.localStorage.getItem(name);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeStore(name, value) {
    try {
      if (value) window.localStorage.setItem(name, value);
      else window.localStorage.removeItem(name);
      return true;
    } catch (e) { return false; }
  }

  function getKey() { return (readStore(KEY_STORAGE, memory.key) || '').trim(); }
  function setKey(key) {
    key = String(key || '').trim();
    memory.key = key;
    writeStore(KEY_STORAGE, key);
  }
  function clearKey() { setKey(''); }
  function hasKey() { return getKey().length > 0; }
  function maskedKey() {
    var k = getKey();
    if (!k) return '';
    return k.length <= 8 ? '••••' : '••••••••' + k.slice(-4);
  }

  function getModel() { return (readStore(MODEL_STORAGE, memory.model) || '').trim(); }
  function setModel(name) {
    name = String(name || '').trim();
    memory.model = name;
    writeStore(MODEL_STORAGE, name);
  }
  function modelList() {
    var chosen = getModel();
    return chosen ? [chosen] : config.models.slice();
  }

  // --- Outils ---
  function progress(opts, label, percent) {
    if (opts && typeof opts.onProgress === 'function') opts.onProgress(label, percent);
  }

  function todayYear() { return new Date().getFullYear(); }

  function readAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var i = text.indexOf(',');
        resolve(i >= 0 ? text.slice(i + 1) : text);
      };
      reader.onerror = function () { reject(new Error('Impossible de lire le fichier.')); };
      reader.readAsDataURL(blob);
    });
  }

  // Réduit une grande photo (côté max 2000 px) pour un envoi plus rapide. En cas de souci : fichier d'origine.
  function shrinkImage(file) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var big = Math.max(w, h);
            if (!w || !h || (big <= config.maxImageSide && file.size < 4 * 1024 * 1024)) {
              URL.revokeObjectURL(url); resolve(file); return;
            }
            var scale = Math.min(1, config.maxImageSide / big);
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.88);
          } catch (e) { URL.revokeObjectURL(url); resolve(file); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      } catch (e) { resolve(file); }
    });
  }

  function mimeOf(file) {
    var type = String(file.type || '').toLowerCase();
    var name = String(file.name || '').toLowerCase();
    if (type === 'application/pdf' || /\.pdf$/.test(name)) return 'application/pdf';
    if (type.indexOf('image/') === 0) return type === 'image/jpg' ? 'image/jpeg' : type;
    if (/\.png$/.test(name)) return 'image/png';
    if (/\.jpe?g$/.test(name)) return 'image/jpeg';
    if (/\.webp$/.test(name)) return 'image/webp';
    return type || 'application/octet-stream';
  }

  function buildPrompt() {
    return [
      "Tu lis un emploi du temps d'étudiant (image ou PDF). Extrais TOUS les cours et réponds UNIQUEMENT avec du JSON valide, sans aucun texte autour, de cette forme :",
      '{"courses":[{"subject":"Maths","day":1,"date":null,"start":"08:30","end":"10:00","room":"B12","teacher":"M. Dupont"}],"notes":""}',
      'Règles :',
      '- "day" : numéro du jour, lundi = 1, mardi = 2, ... dimanche = 7.',
      '- "date" : "AAAA-MM-JJ" seulement si une date précise est écrite pour ce cours, sinon null. Si l\'année n\'est pas écrite, utilise ' + todayYear() + '.',
      '- "start" et "end" : heures au format 24 h "HH:MM".',
      '- "room" et "teacher" : chaîne vide "" si absents.',
      '- N\'invente rien. Si une information est illisible, mets "" (ou null pour day et date) et explique-le en une phrase dans "notes".',
      '- Un cours présent sur plusieurs jours = une entrée par jour.',
      '- Ignore les pauses, les cases vides et les en-têtes.',
      '- Garde les noms de matières tels qu\'ils sont écrits.'
    ].join('\n');
  }

  // --- Appel à Gemini (un modèle) ---
  function callModel(model, parts, key) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, config.timeoutMs) : null;
    return fetch(config.endpoint + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 }
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      var e = new Error(err && err.name === 'AbortError'
        ? 'L’IA met trop de temps à répondre. Réessaie.'
        : 'Impossible de joindre l’IA. Vérifie ta connexion (ou si Google est accessible depuis ton réseau).');
      e.network = true;
      throw e;
    });
  }

  function explainHttp(status, data) {
    var detail = data && data.error && data.error.message ? String(data.error.message) : '';
    if (status === 400 && /api key/i.test(detail)) return 'La clé API est refusée. Vérifie-la dans Réglages.';
    if (status === 401 || status === 403) return 'Accès refusé par Google (clé invalide, ou service non disponible dans ta région).';
    if (status === 404) return 'Modèle introuvable (son nom a peut-être changé).';
    if (status === 429) return 'Limite gratuite atteinte pour le moment. Attends un peu ou réessaie demain.';
    if (status >= 500) return 'Le service de Google a un problème. Réessaie dans un instant.';
    return 'Erreur de l’IA (' + status + ')' + (detail ? ' : ' + detail.slice(0, 160) : '.');
  }

  // Essaie les modèles dans l'ordre. Passe au suivant sur 404 ou 429.
  function generate(parts, key) {
    var models = modelList();
    var lastMessage = '';
    function attempt(i) {
      if (i >= models.length) return Promise.reject(new Error(lastMessage || 'Aucun modèle disponible.'));
      return callModel(models[i], parts, key).then(function (r) {
        if (r.ok) return r.data;
        lastMessage = explainHttp(r.status, r.data);
        if ((r.status === 404 || r.status === 429) && i + 1 < models.length) return attempt(i + 1);
        throw new Error(lastMessage);
      });
    }
    return attempt(0);
  }

  function textOf(data) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('L’IA a refusé de lire ce fichier (' + data.promptFeedback.blockReason + ').');
    }
    var cand = data && data.candidates && data.candidates[0];
    var parts = cand && cand.content && cand.content.parts ? cand.content.parts : [];
    var text = parts.map(function (p) { return p.text || ''; }).join('').trim();
    if (!text) throw new Error('L’IA n’a rien renvoyé. Essaie une image plus nette.');
    return text;
  }

  function parseJsonLoose(text) {
    var clean = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(clean); } catch (e) { /* on tente d'isoler l'objet */ }
    var a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(clean.slice(a, b + 1)); } catch (e2) { /* échec */ }
    }
    throw new Error('La réponse de l’IA n’a pas pu être comprise. Réessaie.');
  }

  // --- Nettoyage des valeurs renvoyées ---
  function cleanTime(value) {
    var m = String(value == null ? '' : value).trim().toLowerCase()
      .match(/^(\d{1,2})\s*(?:[:h.]\s*(\d{2})?)?(?::\d{2})?$/);
    if (!m) return '';
    var h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return '';
    return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
  }

  function cleanDate(value) {
    var s = String(value == null ? '' : value).trim();
    return s && SF.dates && SF.dates.isValidISO(s) ? s : '';
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  var DAY_NAMES = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // Transforme la réponse JSON de l'IA en « entrées » (même forme que SF.importer.parse).
  function toEntries(payload) {
    var list = payload && Array.isArray(payload.courses) ? payload.courses : [];
    return list.map(function (c) {
      c = c || {};
      var date = cleanDate(c.date);
      var weekday = Number(c.day);
      if (date) weekday = SF.dates.isoWeekday(date);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) weekday = 0;
      var start = cleanTime(c.start), end = cleanTime(c.end);
      var subject = cleanText(c.subject);
      var confidence = 0.9;
      if (!subject) confidence = 0.3;
      else if (!start || !end) confidence = 0.4;
      else if (end <= start) confidence = 0.45;
      else if (!weekday && !date) confidence = 0.45;
      var rawParts = [DAY_NAMES[weekday] || '', date, start && end ? start + '-' + end : start, subject, cleanText(c.room), cleanText(c.teacher)];
      return {
        subject: subject,
        date: date,
        weekday: weekday,
        startTime: start,
        endTime: end,
        room: cleanText(c.room),
        teacher: cleanText(c.teacher),
        raw: '(IA) ' + rawParts.filter(Boolean).join(' · '),
        confidence: confidence
      };
    });
  }

  // --- Lecture d'un fichier : renvoie une « extraction » de type ai ---
  function extract(file, opts) {
    opts = opts || {};
    var key = getKey();
    if (!key) return Promise.reject(new Error('Aucune clé API. Ajoute ta clé gratuite Gemini dans Réglages.'));
    if (!file) return Promise.reject(new Error('Aucun fichier à lire.'));

    var mime = mimeOf(file);
    if (mime === 'application/pdf' && file.size > config.maxPdfBytes) {
      return Promise.reject(new Error('Ce PDF est trop lourd pour l’IA (max 14 Mo). Envoie plutôt une capture d’écran.'));
    }

    progress(opts, 'Préparation du fichier…', 10);
    var prepared = mime === 'application/pdf' ? Promise.resolve(file) : shrinkImage(file);
    return prepared.then(function (blob) {
      var sendMime = blob === file ? mime : 'image/jpeg';
      return readAsBase64(blob).then(function (b64) {
        progress(opts, 'Envoi à l’IA…', 35);
        var parts = [{ text: buildPrompt() }, { inline_data: { mime_type: sendMime, data: b64 } }];
        return generate(parts, key);
      });
    }).then(function (data) {
      progress(opts, 'Lecture de l’emploi du temps…', 85);
      var payload = parseJsonLoose(textOf(data));
      var entries = toEntries(payload);
      progress(opts, 'Terminé', 100);
      return {
        source: 'ai',
        pages: [],
        aiEntries: entries,
        notes: cleanText(payload && payload.notes),
        text: entries.map(function (e) { return e.raw; }).join('\n')
      };
    });
  }

  // --- Même rôle que SF.importer.parse, pour une extraction de type ai ---
  function parse(extraction, options) {
    options = options || {};
    var entries = ((extraction && extraction.aiEntries) || []).map(function (e) {
      var copy = {};
      Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
      if (!copy.date && copy.weekday && options.weekStart && SF.dates && SF.dates.isValidISO(options.weekStart)) {
        copy.date = SF.dates.addDays(options.weekStart, copy.weekday - 1);
      }
      return copy;
    });

    var warnings = [];
    if (!entries.length) warnings.push('L’IA n’a trouvé aucun cours : vérifie l’image ou ajoute-les à la main.');
    var noDate = entries.filter(function (e) { return !e.date; }).length;
    if (noDate > 0) warnings.push(noDate + ' cours sans date : indique la semaine concernée.');
    if (extraction && extraction.notes) warnings.push('Remarque de l’IA : ' + extraction.notes);
    if (entries.length) warnings.push('Lecture faite par une IA : vérifie chaque ligne avant d’importer.');

    return {
      entries: entries,
      warnings: warnings,
      lines: entries.map(function (e) { return e.raw; })
    };
  }

  // --- Test de la clé (utilisé par le bouton de Réglages) ---
  function testKey(keyOverride) {
    var key = String(keyOverride || getKey()).trim();
    if (!key) return Promise.reject(new Error('Colle d’abord ta clé API.'));
    return generate([{ text: 'Réponds uniquement par le mot : OK' }], key).then(function (data) {
      textOf(data);
      return true;
    });
  }

  SF.aiReader = {
    config: config,
    getKey: getKey,
    setKey: setKey,
    clearKey: clearKey,
    hasKey: hasKey,
    maskedKey: maskedKey,
    getModel: getModel,
    setModel: setModel,
    extract: extract,
    parse: parse,
    testKey: testKey,
    // exposés pour les tests
    _toEntries: toEntries,
    _cleanTime: cleanTime
  };
})();
