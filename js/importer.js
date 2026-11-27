/* js/importer.js — SF.importer
 * Lot 4 : import de l'emploi du temps (PDF, image OCR, texte collé).
 * Aucune bibliothèque n'est chargée au démarrage : seulement dans loadLibrary, à la demande.
 * Dépend de SF.dates, SF.constants et SF.timetable (lots précédents) avec replis sûrs.
 */
(function (global) {
  'use strict';

  var SF = global.SF = global.SF || {};

  // --- Configuration (URL des bibliothèques, facilement changeables) ---
  var config = {
    pdfjsUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorkerUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseractUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    tesseractLang: 'fra',
    maxFileSize: 15 * 1024 * 1024,
    maxPdfPages: 6,
    ocrMinConfidence: 40,
    imageMinWidth: 1600,
    pdfScannedThreshold: 15,
    loadTimeout: 20000
  };

  // --- Tables de jours et mois (comparaison sur texte normalisé) ---
  var DAYS = {
    lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7,
    lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7
  };
  var MONTHS = {
    janvier: 1, fevrier: 2, fevr: 2, février: 2, févr: 2, mars: 3, avril: 4, avr: 4,
    mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, août: 8, septembre: 9, sep: 9,
    octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, décembre: 12, dec: 12, déc: 12,
    janv: 1, fév: 2, fev: 2
  };

  // --- Repli sur SF.dates si absent ---
  function _isoWeekday(date) {
    if (SF.dates && SF.dates.isoWeekday) return SF.dates.isoWeekday(date);
    if (!date) return 0;
    var d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return 0;
    var w = d.getDay(); // 0 = dimanche
    return w === 0 ? 7 : w;
  }
  function _addDays(date, n) {
    if (SF.dates && SF.dates.addDays) return SF.dates.addDays(date, n);
    if (!date) return '';
    var d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + n);
    return _isoDate(d);
  }

  // --- Utilitaires de date ---
  function _isoDate(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }
  function _todayIso() { return _isoDate(new Date()); }

  // Normalisation : minuscules, sans accents, pour comparer.
  function _normalize(s) {
    return (s || '').toLowerCase()
      .replace(/[àâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[îï]/g, 'i')
      .replace(/[ôö]/g, 'o').replace(/[ûüù]/g, 'u').replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function _hhmm(h, m) {
    return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
  }
  function _minutesToHHMM(m) {
    if (m == null || isNaN(m)) return '';
    m = ((m % 1440) + 1440) % 1440;
    return _hhmm(Math.floor(m / 60), m % 60);
  }
  function _roundTo5(m) { return Math.round(m / 5) * 5; }

  // =====================================================================
  // 1) loadLibrary(name)
  // =====================================================================
  var _libs = {};

  function loadLibrary(name) {
    if (_libs[name]) return _libs[name].promise;
    var url, globalVar;
    if (name === 'pdfjs') { url = config.pdfjsUrl; globalVar = 'pdfjsLib'; }
    else if (name === 'tesseract') { url = config.tesseractUrl; globalVar = 'Tesseract'; }
    else return Promise.reject(new Error('Bibliothèque inconnue : ' + name));

    var promise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('Le chargement de la bibliothèque a échoué (connexion ?).'));
        }
      }, config.loadTimeout);

      // Vérifie l'apparition de la variable globale (après onload).
      function checkGlobal(attempt) {
        if (done) return;
        if (global[globalVar]) {
          done = true;
          clearTimeout(timer);
          resolve(global[globalVar]);
        } else if (attempt < 200) {
          setTimeout(function () { checkGlobal(attempt + 1); }, 50);
        } else {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject(new Error('Le chargement de la bibliothèque a échoué (connexion ?).'));
          }
        }
      }

      script.onload = function () { checkGlobal(0); };
      script.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('Le chargement de la bibliothèque a échoué (connexion ?).'));
      };
      document.head.appendChild(script);
    });

    _libs[name] = { promise: promise };
    return promise;
  }

  // =====================================================================
  // 2) extract(file, { onProgress })
  // =====================================================================

  // Reconnaissance du format par MIME ou extension.
  function _isImage(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp';
  }
  function _isPdf(file) {
    if (file.type === 'application/pdf') return true;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return ext === 'pdf';
  }

  // Lecture du fichier en ArrayBuffer (avec repli FileReader).
  function _readArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('Ce fichier n\'est pas lisible.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  // Chargement d'une image en bitmap (repli sur Image + URL.createObjectURL).
  function _loadImage(file) {
    if (global.createImageBitmap) {
      return global.createImageBitmap(file).catch(function () { return _loadImageElement(file); });
    }
    return _loadImageElement(file);
  }
  function _loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Ce fichier n\'est pas lisible.')); };
      img.src = url;
    });
  }

  // Prétraitement canvas : agrandissement x2 si petit, niveaux de gris, contraste.
  function _preprocessImage(img) {
    var scale = (img.width < config.imageMinWidth) ? 2 : 1;
    var w = img.width * scale, h = img.height * scale;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    try {
      var imageData = ctx.getImageData(0, 0, w, h);
      var d = imageData.data;
      var contrast = 1.5;
      var intercept = 128 * (1 - contrast);
      for (var i = 0; i < d.length; i += 4) {
        var gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        var v = gray * contrast + intercept;
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(imageData, 0, 0);
    } catch (e) { /* getImageData peut échouer en cross-origin : on garde l'image brute */ }
    return canvas;
  }

  // OCR d'un canvas avec Tesseract (worker français, réutilisé, terminé à la fin).
  function _ocrCanvas(canvas, onProgress) {
    var worker = null;
    return loadLibrary('tesseract').then(function (Tesseract) {
      var opts = {};
      if (Tesseract.createWorker) {
        // API worker (5.x) : créer, reconnaître, terminer.
        return Tesseract.createWorker(config.tesseractLang, 1, {
          logger: function (m) {
            if (m && m.status === 'recognizing text' && typeof m.progress === 'number') {
              try { onProgress('Reconnaissance du texte', Math.round(m.progress * 100)); } catch (e) {}
            }
          }
        }).then(function (w) { worker = w; return worker.recognize(canvas); });
      }
      // Repli : fonction reconnaître haute niveau.
      return Tesseract.recognize(canvas, config.tesseractLang, {
        logger: function (m) {
          if (m && m.status === 'recognizing text' && typeof m.progress === 'number') {
            try { onProgress('Reconnaissance du texte', Math.round(m.progress * 100)); } catch (e) {}
          }
        }
      });
    }).then(function (result) {
      var words = [];
      var data = result && result.data ? result.data : {};
      var rawWords = data.words || [];
      rawWords.forEach(function (wd) {
        var text = (wd.text || '').trim();
        var conf = typeof wd.confidence === 'number' ? wd.confidence : 0;
        if (!text || conf < config.ocrMinConfidence) return;
        var b = wd.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
        words.push({
          text: text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, confidence: conf / 100
        });
      });
      var terminate = (worker && worker.terminate) ? worker.terminate() : Promise.resolve();
      return terminate.then(function () { worker = null; return words; });
    }).catch(function (err) {
      if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
      throw err;
    });
  }

  // Extraction depuis une image.
  function _extractImage(file, onProgress) {
    onProgress('Chargement de la bibliothèque', 0);
    return loadLibrary('tesseract').then(function () {
      return _loadImage(file);
    }).then(function (img) {
      var canvas = _preprocessImage(img);
      onProgress('Reconnaissance du texte', 0);
      return _ocrCanvas(canvas, onProgress).then(function (words) {
        return {
          source: 'ocr',
          pages: [{ width: canvas.width, height: canvas.height, words: words }],
          text: _buildTextFromWords(words, canvas.width)
        };
      });
    });
  }

  // Rendu d'une page PDF en canvas (pour OCR des pages scannées).
  function _renderPdfPageToCanvas(page, scale) {
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    var ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      return canvas;
    });
  }

  // Extraction depuis un PDF (texte natif, OCR si page scannée).
  function _extractPdf(file, onProgress) {
    onProgress('Chargement de la bibliothèque', 0);
    var pdfjsLib;
    return loadLibrary('pdfjs').then(function (lib) {
      pdfjsLib = lib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorkerUrl;
      onProgress('Lecture du PDF', 0);
      return _readArrayBuffer(file);
    }).then(function (buf) {
      return pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var numPages = Math.min(pdf.numPages, config.maxPdfPages);
      var pages = [];
      var anyOcr = false;
      var chain = Promise.resolve();
      for (var p = 1; p <= numPages; p++) {
        (function (pageNum) {
          chain = chain.then(function () {
            return pdf.getPage(pageNum).then(function (page) {
              var viewport = page.getViewport({ scale: 1 });
              var pageWidth = viewport.width, pageHeight = viewport.height;
              return page.getTextContent().then(function (content) {
                var words = [];
                (content.items || []).forEach(function (item) {
                  if (!item.str || !item.str.trim()) return;
                  var tx = item.transform[4];
                  var ty = pageHeight - item.transform[5];
                  var w = item.width || 0;
                  var h = item.height || 10;
                  var parts = item.str.trim().split(/\s+/);
                  var partW = parts.length ? w / parts.length : w;
                  parts.forEach(function (part, idx) {
                    words.push({
                      text: part,
                      x0: tx + idx * partW,
                      y0: ty - h,
                      x1: tx + (idx + 1) * partW,
                      y1: ty,
                      confidence: 1
                    });
                  });
                });
                // PDF scanné : peu d'éléments texte -> OCR de la page rendue.
                if (words.length < config.pdfScannedThreshold) {
                  anyOcr = true;
                  onProgress('Reconnaissance du texte', 0);
                  return _renderPdfPageToCanvas(page, 2).then(function (canvas) {
                    return _ocrCanvas(canvas, onProgress).then(function (ocrWords) {
                      return { width: canvas.width, height: canvas.height, words: ocrWords };
                    });
                  });
                }
                return { width: pageWidth, height: pageHeight, words: words };
              });
            });
          }).then(function (pageObj) { pages.push(pageObj); });
        })(p);
      }
      return chain.then(function () {
        return {
          source: anyOcr ? 'ocr' : 'pdf-text',
          pages: pages,
          text: pages.map(function (pg) { return _buildTextFromWords(pg.words, pg.width); }).join('\n')
        };
      });
    });
  }

  // Reconstitue le texte brut à partir des mots regroupés en lignes.
  function _buildTextFromWords(words, pageWidth) {
    var lines = _groupWordsIntoLines(words || []);
    return lines.map(function (l) { return _lineText(l); }).join('\n');
  }

  function extract(file, options) {
    options = options || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    try {
      if (!file) return Promise.reject(new Error('Ce fichier n\'est pas lisible.'));
      // Taille maximale : refuser AVANT de lire.
      if (file.size > config.maxFileSize) {
        return Promise.reject(new Error('Le fichier est trop volumineux (maximum 15 Mo).'));
      }
      if (_isPdf(file)) { return _extractPdf(file, onProgress); }
      if (_isImage(file)) { return _extractImage(file, onProgress); }
      return Promise.reject(new Error('Format non pris en charge.'));
    } catch (e) {
      return Promise.reject(new Error('Ce fichier n\'est pas lisible.'));
    }
  }

  // =====================================================================
  // 3) parse(extraction, options) et parseText(text, options)
  // =====================================================================

  // Regroupe les mots en LIGNES (tolérance verticale = 0,6 x hauteur médiane).
  function _groupWordsIntoLines(words) {
    if (!words || !words.length) return [];
    var sorted = words.slice().sort(function (a, b) {
      return ((a.y0 + a.y1) / 2) - ((b.y0 + b.y1) / 2);
    });
    var heights = sorted.map(function (w) { return (w.y1 - w.y0) || 1; }).sort(function (a, b) { return a - b; });
    var medianH = heights[Math.floor(heights.length / 2)] || 10;
    var tolerance = 0.6 * medianH;
    var lines = [];
    var current = null;
    sorted.forEach(function (w) {
      var cy = (w.y0 + w.y1) / 2;
      if (!current || Math.abs(cy - current.centerY) > tolerance) {
        current = { centerY: cy, words: [w] };
        lines.push(current);
      } else {
        current.words.push(w);
        current.centerY = (current.centerY * (current.words.length - 1) + cy) / current.words.length;
      }
    });
    // Tri de chaque ligne de gauche à droite.
    lines.forEach(function (l) { l.words.sort(function (a, b) { return a.x0 - b.x0; }); });
    return lines;
  }

  function _lineText(line) {
    if (!line || !line.words) return '';
    return line.words.map(function (w) { return w.text; }).join(' ');
  }

  // Un mot correspond-il à un nom de jour ? (normalisé, avec ou sans point)
  function _wordDayMatch(word) {
    var norm = _normalize(word.text);
    if (!norm) return null;
    var keys = Object.keys(DAYS).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (norm === k) return DAYS[k];
      // "Lun24" : le jour collé à une date.
      if (norm.indexOf(k) === 0) {
        var rest = norm.slice(k.length);
        if (rest === '' || /^[^a-z]/.test(rest)) return DAYS[k];
      }
    }
    return null;
  }

  // Une ligne contient-elle un nom de jour ?
  function _matchDay(text) {
    var norm = _normalize(text);
    if (!norm) return null;
    var keys = Object.keys(DAYS).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var re = new RegExp('\\b' + k.replace(/\./g, '\\.') + '\\b');
      if (re.test(norm)) return DAYS[k];
    }
    return null;
  }

  // Recherche d'une date : 24/11, 24.11, 24 novembre (avec ou sans année).
  function _findDate(text, referenceDate) {
    var low = (text || '').toLowerCase();
    // Date numérique dd/mm ou dd.mm (et éventuellement année).
    var m = low.match(/(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.]\s*(\d{2,4}))?/);
    if (m) {
      var d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = m[3] ? parseInt(m[3], 10) : null;
      if (y && y < 100) y += 2000;
      return _resolveDate(d, mo, y, referenceDate);
    }
    // "24 novembre" (nom de mois).
    m = low.match(/(\d{1,2})\s+([a-zàâäéèêëîïôöûüùç]+)/);
    if (m) {
      var monthName = _normalize(m[2]);
      if (MONTHS[monthName]) {
        return _resolveDate(parseInt(m[1], 10), MONTHS[monthName], null, referenceDate);
      }
    }
    return null;
  }

  // Choisit l'année (si absente) rendant la date la plus proche de referenceDate.
  function _resolveDate(day, month, year, referenceDate) {
    if (!day || !month || day > 31 || month > 12) return null;
    var ref = referenceDate || _todayIso();
    var refDate = new Date(ref + 'T00:00:00');
    if (isNaN(refDate.getTime())) refDate = new Date();
    if (year) {
      var dt = new Date(year, month - 1, day);
      if (dt.getMonth() !== month - 1) return null;
      return _isoDate(dt);
    }
    var best = null, bestDist = Infinity;
    var refYear = refDate.getFullYear();
    for (var dy = -1; dy <= 1; dy++) {
      var y = refYear + dy;
      var cand = new Date(y, month - 1, day);
      if (cand.getMonth() !== month - 1) continue; // date invalide (débordement)
      var dist = Math.abs(cand.getTime() - refDate.getTime());
      if (dist < bestDist) { bestDist = dist; best = _isoDate(cand); }
    }
    return best;
  }

  // Étiquette d'heure dans la marge ("8h", "08h00", "8:30") -> minutes.
  function _parseHourLabel(text) {
    var t = (text || '').toLowerCase();
    var m = t.match(/(\d{1,2})\s*(?:h|:)\s*(\d{0,2})/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mm = m[2] ? parseInt(m[2], 10) : 0;
    if (isNaN(h)) return null;
    return h * 60 + mm;
  }

  // Plage horaire tolérante : séparateurs h ou deux-points, tiret, « à », « au ».
  var RANGE_RE = /(\d{1,2})(?:\s*(?:h|:|H)(?:\s*(\d{1,2}))?)?\s*(?:[-–—]|à|au|jusqu['’\s]*à|\s+a\s+)\s*(\d{1,2})(?:\s*(?:h|:|H)(?:\s*(\d{1,2}))?)?/i;

  function _findTimeRange(text) {
    var m = (text || '').match(RANGE_RE);
    if (!m) return null;
    var sh = parseInt(m[1], 10);
    var sm = m[2] ? parseInt(m[2], 10) : 0;
    var eh = parseInt(m[3], 10);
    var em = m[4] ? parseInt(m[4], 10) : 0;
    if (isNaN(sh) || isNaN(eh)) return null;
    if (sh > 23 || eh > 23) return null; // pas une plage (ex. "24-11")
    return { start: _hhmm(sh, sm), end: _hhmm(eh, em), match: m[0] };
  }

  // Salle : "salle B12", "amphi 2", "lab 3", "local 04" ou code B12, A204, S3-04.
  function _findRoom(text) {
    if (!text) return null;
    var re1 = /\b(salle|amphi|laboratoire|lab|local)\s*\.?\s*([A-Za-z0-9][A-Za-z0-9\-./]*)/i;
    var m = text.match(re1);
    if (m) return { value: (m[1] + ' ' + m[2]).trim(), match: m[0] };
    var re2 = /\b([A-Za-z]{1,2}\d{1,3}(?:-\d{1,3})?)\b/;
    m = text.match(re2);
    if (m) return { value: m[1], match: m[0] };
    return null;
  }

  // Enseignant : M., Mme, Mr, Pr, Dr suivi d'un nom.
  function _findTeacher(text) {
    if (!text) return null;
    var re = /\b(M\.|Mme\.?|Mr\.?|Pr\.?|Dr\.?)\s+([A-Za-zàâäéèêëîïôöûüùç\-']{2,}(?:\s+[A-Za-zàâäéèêëîïôöûüùç\-']{2,})?)/;
    var m = text.match(re);
    if (m) return { value: (m[1] + ' ' + m[2]).trim(), match: m[0] };
    return null;
  }

  // Nettoyage de la matière : espaces multiples, ponctuation en bout.
  function _cleanStr(s) {
    return (s || '').replace(/\s+/g, ' ').replace(/[.,;:]+$/g, '').trim();
  }

  // Ignore les blocs sans lettres ou de moins de 3 caractères utiles.
  function _usefulText(text) {
    if (!text) return false;
    var letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters < 1) return false;
    return text.replace(/\s+/g, '').length >= 3;
  }

  // Confiance : 1 si plage écrite + matière >= 3 lettres ; 0,7 si heures de position ; 0,4 si peu fiable.
  function _computeConfidence(range, subject, timeFromPosition) {
    var letters = (subject.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    var strange = (subject.match(/[^A-Za-z0-9À-ÿ\s.,;:\/'\-]/g) || []).length;
    var veryShort = letters < 3;
    var manyStrange = letters > 0 && strange > letters / 2;
    if (range && letters >= 3 && !manyStrange) return 1;
    if (timeFromPosition) return 0.7;
    if (veryShort || manyStrange) return 0.4;
    if (range) return 0.7;
    return 0.4;
  }

  // Interpolation position verticale -> minutes (au moins 2 étiquettes).
  function _yToMinutes(y, labels) {
    if (!labels || labels.length < 2) return null;
    if (y <= labels[0].y) {
      var s = (labels[1].minutes - labels[0].minutes) / (labels[1].y - labels[0].y);
      return Math.round(labels[0].minutes + (y - labels[0].y) * s);
    }
    if (y >= labels[labels.length - 1].y) {
      var n = labels.length;
      var s2 = (labels[n - 1].minutes - labels[n - 2].minutes) / (labels[n - 1].y - labels[n - 2].y);
      return Math.round(labels[n - 1].minutes + (y - labels[n - 1].y) * s2);
    }
    for (var i = 0; i < labels.length - 1; i++) {
      if (y >= labels[i].y && y <= labels[i + 1].y) {
        var s3 = (labels[i + 1].minutes - labels[i].minutes) / (labels[i + 1].y - labels[i].y);
        return Math.round(labels[i].minutes + (y - labels[i].y) * s3);
      }
    }
    return null;
  }

  // Détection des en-têtes de jours alignés sur une ligne -> grille ou liste.
  function _detectDayHeaders(lines) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var matches = [];
      line.words.forEach(function (w) {
        var wd = _wordDayMatch(w);
        if (wd != null) matches.push({ weekday: wd, word: w, centerX: (w.x0 + w.x1) / 2 });
      });
      if (matches.length >= 3) {
        matches.sort(function (a, b) { return a.centerX - b.centerX; });
        // Rattache une date voisine à chaque en-tête.
        var headers = matches.map(function (m) {
          var date = null;
          line.words.forEach(function (w) {
            if (w === m.word) return;
            var wcx = (w.x0 + w.x1) / 2;
            if (Math.abs(wcx - m.centerX) < 120) {
              var d = _findDate(w.text, null);
              if (d && !date) date = d;
            }
          });
          return { weekday: m.weekday, date: date, x0: m.word.x0, x1: m.word.x1, centerX: m.centerX };
        });
        return { isGrid: true, headerLine: line, headers: headers };
      }
    }
    return { isGrid: false, headerLine: null, headers: [] };
  }

  // Regroupe les mots d'une colonne en BLOCS (écart vertical < 1,5 x hauteur de ligne).
  function _groupIntoBlocks(words) {
    if (!words.length) return [];
    var sorted = words.slice().sort(function (a, b) {
      return ((a.y0 + a.y1) / 2) - ((b.y0 + b.y1) / 2);
    });
    var hs = sorted.map(function (w) { return (w.y1 - w.y0) || 1; }).sort(function (a, b) { return a - b; });
    var medianH = hs[Math.floor(hs.length / 2)] || 10;
    var gap = 1.5 * medianH;
    var groups = [];
    var cur = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      var prev = cur[cur.length - 1];
      var w = sorted[i];
      if (w.y0 - prev.y1 > gap) { groups.push(cur); cur = [w]; }
      else cur.push(w);
    }
    groups.push(cur);
    return groups.map(function (gw) {
      var lines = _groupWordsIntoLines(gw);
      var y0 = Math.min.apply(null, gw.map(function (w) { return w.y0; }));
      var y1 = Math.max.apply(null, gw.map(function (w) { return w.y1; }));
      return { lines: lines, words: gw, y0: y0, y1: y1 };
    });
  }

  // Conversion d'un bloc (grille) en entrée de cours.
  function _blockToEntry(block, header, hourLabels, options) {
    var linesText = block.lines.map(function (l) { return _lineText(l); });
    var raw = linesText.join(' / ').trim();
    if (!_usefulText(raw)) return null;

    var range = _findTimeRange(raw);
    var startTime = range ? range.start : '';
    var endTime = range ? range.end : '';
    var timeFromPosition = false;

    // Heures de position si aucune plage écrite.
    if (!range && hourLabels && hourLabels.length >= 2) {
      var m1 = _yToMinutes(block.y0, hourLabels);
      var m2 = _yToMinutes(block.y1, hourLabels);
      if (m1 != null) startTime = _minutesToHHMM(_roundTo5(m1));
      if (m2 != null) endTime = _minutesToHHMM(_roundTo5(m2));
      timeFromPosition = !!(startTime && endTime);
    }

    var room = _findRoom(raw);
    var teacher = _findTeacher(raw);

    // Matière = texte restant, nettoyé.
    var subjectText = raw;
    if (range) subjectText = subjectText.replace(range.match, ' ');
    if (room) subjectText = subjectText.replace(room.match, ' ');
    if (teacher) subjectText = subjectText.replace(teacher.match, ' ');
    subjectText = _cleanSubject(subjectText, linesText, room, teacher, range);

    // Date / jour de semaine.
    var date = header.date || '';
    var weekday = header.weekday;
    if (date) {
      weekday = _isoWeekday(date);
    } else if (weekday && options.weekStart) {
      date = _addDays(options.weekStart, weekday - 1);
    } else {
      date = '';
    }

    return {
      subject: subjectText,
      date: date,
      weekday: weekday || 0,
      startTime: startTime,
      endTime: endTime,
      room: room ? room.value : '',
      teacher: teacher ? teacher.value : '',
      raw: raw,
      confidence: _computeConfidence(range, subjectText, timeFromPosition)
    };
  }

  // Nettoyage de la matière : si plusieurs lignes, la plus longue non salle/enseignant/horaire.
  function _cleanSubject(subjectText, linesText, room, teacher, range) {
    if (linesText && linesText.length > 1) {
      var best = '';
      linesText.forEach(function (lt) {
        if (room && room.match && lt.indexOf(room.match) !== -1) return;
        if (teacher && teacher.match && lt.indexOf(teacher.match) !== -1) return;
        if (range && range.match && lt.indexOf(range.match) !== -1) return;
        if (_findTimeRange(lt)) return;
        var cleaned = _cleanStr(lt);
        if (cleaned.length > best.length) best = cleaned;
      });
      if (best) return best;
    }
    return _cleanStr(subjectText);
  }

  // Analyse en mode GRILLE.
  function _parseGrid(lines, headersInfo, page, options) {
    var headers = headersInfo.headers;
    var n = headers.length;
    // Bornes des colonnes : milieu entre en-têtes voisins.
    var cols = [];
    for (var i = 0; i < n; i++) {
      var left = (i === 0) ? 0 : (headers[i - 1].centerX + headers[i].centerX) / 2;
      var right = (i === n - 1) ? page.width : (headers[i].centerX + headers[i + 1].centerX) / 2;
      cols.push({ left: left, right: right, header: headers[i] });
    }
    // Marge gauche = à gauche du premier en-tête.
    var marginEnd = headers[0].x0;

    // Étiquettes d'heures dans la marge gauche.
    var hourLabels = [];
    var columnWords = cols.map(function () { return []; });
    lines.forEach(function (line) {
      if (line === headersInfo.headerLine) return;
      line.words.forEach(function (w) {
        var cx = (w.x0 + w.x1) / 2;
        if (cx < marginEnd) {
          var t = _parseHourLabel(w.text);
          if (t != null) hourLabels.push({ y: (w.y0 + w.y1) / 2, minutes: t });
          return;
        }
        for (var c = 0; c < cols.length; c++) {
          if (cx >= cols[c].left && cx <= cols[c].right) { columnWords[c].push(w); break; }
        }
      });
    });
    hourLabels.sort(function (a, b) { return a.y - b.y; });

    var entries = [];
    for (var c = 0; c < cols.length; c++) {
      if (!columnWords[c].length) continue;
      var blocks = _groupIntoBlocks(columnWords[c]);
      blocks.forEach(function (block) {
        var entry = _blockToEntry(block, cols[c].header, hourLabels, options);
        if (entry) entries.push(entry);
      });
    }
    return entries;
  }

  // Conversion d'un bloc texte (mode liste) en entrée de cours.
  function _textBlockToEntry(raw, date, weekday, options) {
    raw = (raw || '').trim();
    if (!_usefulText(raw)) return null;

    var range = _findTimeRange(raw);
    var startTime = range ? range.start : '';
    var endTime = range ? range.end : '';

    var room = _findRoom(raw);
    var teacher = _findTeacher(raw);

    var subjectText = raw;
    if (range) subjectText = subjectText.replace(range.match, ' ');
    if (room) subjectText = subjectText.replace(room.match, ' ');
    if (teacher) subjectText = subjectText.replace(teacher.match, ' ');
    // Retire les mots de jour et de date en tête.
    subjectText = subjectText
      .replace(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun|mar|mer|jeu|ven|sam|dim|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b\.?/gi, ' ')
      .replace(/\b\d{1,2}\s*[\/.]\s*\d{1,2}(?:\s*[\/.]\s*\d{1,4})?\b/g, ' ')
      .replace(/\b\d{1,2}\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|janv|févr|fevr|avr|juil|sep|oct|nov|déc|dec)\b/gi, ' ');

    var linesArr = raw.split(/\s*\/\s*/);
    subjectText = _cleanSubject(subjectText, linesArr, room, teacher, range);

    var finalDate = date || '';
    var finalWeekday = weekday || 0;
    if (finalDate) finalWeekday = _isoWeekday(finalDate);
    else if (finalWeekday && options.weekStart) finalDate = _addDays(options.weekStart, finalWeekday - 1);
    else finalDate = '';

    return {
      subject: subjectText,
      date: finalDate,
      weekday: finalWeekday,
      startTime: startTime,
      endTime: endTime,
      room: room ? room.value : '',
      teacher: teacher ? teacher.value : '',
      raw: raw,
      confidence: _computeConfidence(range, subjectText, false)
    };
  }

  // Analyse en mode LISTE : un jour ouvre, les plages horaires sont des cours.
  function _parseList(lines, options) {
    var entries = [];
    var currentDate = '';
    var currentWeekday = null;
    for (var i = 0; i < lines.length; i++) {
      var text = _lineText(lines[i]).trim();
      if (!text) continue;

      var dayMatch = _matchDay(text);
      var dateMatch = _findDate(text, options.referenceDate);
      var range = _findTimeRange(text);

      // Un jour (ou une date) ouvre/met à jour le jour courant.
      if (dayMatch || dateMatch) {
        if (dateMatch) {
          currentDate = dateMatch;
          currentWeekday = _isoWeekday(dateMatch);
        } else if (dayMatch) {
          currentWeekday = dayMatch;
          if (options.weekStart) currentDate = _addDays(options.weekStart, dayMatch - 1);
        }
      }

      if (range) {
        // Cours : cette ligne + les lignes sans horaire ni jour qui suivent.
        var blockTexts = [text];
        var j = i + 1;
        while (j < lines.length) {
          var nt = _lineText(lines[j]).trim();
          if (!nt) { j++; continue; }
          if (_matchDay(nt) || _findDate(nt, options.referenceDate) || _findTimeRange(nt)) break;
          blockTexts.push(nt);
          j++;
        }
        var raw = blockTexts.join(' / ');
        var entry = _textBlockToEntry(raw, currentDate, currentWeekday, options);
        if (entry) entries.push(entry);
        i = j - 1;
      }
    }
    return entries;
  }

  // Avertissements globaux selon les entrées produites.
  function _globalWarnings(entries) {
    var warnings = [];
    if (entries.length === 0) {
      warnings.push('Aucun jour détecté : vérifie l\'image ou utilise Coller du texte.');
    }
    var noDate = entries.filter(function (e) { return !e.date; }).length;
    if (noDate > 0) {
      warnings.push(noDate + ' cours sans date : indique la semaine concernée.');
    }
    if (entries.length) {
      var avg = entries.reduce(function (s, e) { return s + (e.confidence || 0); }, 0) / entries.length;
      if (avg < 0.6) warnings.push('Lecture peu fiable : vérifie chaque ligne.');
    }
    return warnings;
  }

  function parse(extraction, options) {
    options = options || {};
    if (options.referenceDate === undefined) options.referenceDate = _todayIso();

    // Extraction faite par l'IA (SF.aiReader) : elle contient déjà les cours.
    if (extraction && extraction.source === 'ai' && SF.aiReader) {
      return SF.aiReader.parse(extraction, options);
    }

    if (!extraction || !extraction.pages || !extraction.pages.length) {
      return { entries: [], warnings: ['Aucune donnée à analyser.'], lines: [] };
    }

    var allEntries = [];
    var displayLines = [];
    extraction.pages.forEach(function (page) {
      var lines = _groupWordsIntoLines(page.words || []);
      displayLines = displayLines.concat(lines.map(function (l) { return _lineText(l); }));
      var headersInfo = _detectDayHeaders(lines);
      var entries = headersInfo.isGrid
        ? _parseGrid(lines, headersInfo, page, options)
        : _parseList(lines, options);
      allEntries = allEntries.concat(entries);
    });

    return { entries: allEntries, warnings: _globalWarnings(allEntries), lines: displayLines };
  }

  function parseText(text, options) {
    options = options || {};
    if (options.referenceDate === undefined) options.referenceDate = _todayIso();

    if (!text || !text.trim()) {
      return { entries: [], warnings: ['Aucun texte à analyser.'], lines: [] };
    }
    var rawLines = text.split(/\r?\n/);
    // Une ligne de texte = une ligne (objet pseudo-ligne à un mot).
    var lines = rawLines.map(function (t) {
      var w = { text: t, x0: 0, y0: 0, x1: 100, y1: 10, confidence: 1 };
      return { words: [w], centerY: 5 };
    });
    var displayLines = rawLines.map(function (t) { return t.trim(); }).filter(function (t) { return t.length; });
    var entries = _parseList(lines, options);
    return { entries: entries, warnings: _globalWarnings(entries), lines: displayLines };
  }

  // =====================================================================
  // 4) toCourses(entries, options)
  // =====================================================================

  function toCourses(entries, options) {
    options = options || {};
    var mode = options.mode || 'dated';
    var courses = [];
    var skipped = 0;

    (entries || []).forEach(function (e) {
      if (mode === 'dated') {
        // Mode daté : une entrée avec date devient un cours unique ce jour.
        if (!e.date) { skipped++; return; }
        courses.push({
          subject: e.subject || '',
          weekday: _isoWeekday(e.date),
          startTime: e.startTime || '',
          endTime: e.endTime || '',
          room: e.room || '',
          teacher: e.teacher || '',
          validFrom: e.date,
          validTo: e.date
        });
      } else {
        // Mode hebdomadaire : weekday + période de validité.
        if (!e.weekday || e.weekday < 1 || e.weekday > 7) { skipped++; return; }
        courses.push({
          subject: e.subject || '',
          weekday: e.weekday,
          startTime: e.startTime || '',
          endTime: e.endTime || '',
          room: e.room || '',
          teacher: e.teacher || '',
          validFrom: options.validFrom || null,
          validTo: options.validTo || null
        });
      }
    });

    courses.skipped = skipped;
    return courses;
  }

  // =====================================================================
  // 5) demoExtraction() : grille fictive de 5 jours, 6 cours.
  // =====================================================================

  function demoExtraction() {
    function w(text, x, y, width, height) {
      return { text: text, x0: x, y0: y, x1: x + width, y1: y + height, confidence: 1 };
    }
    var words = [];

    // En-têtes de jours (ligne du haut) avec date voisine.
    var cols = [
      { day: 'Lun', date: '24/11', x: 130 },
      { day: 'Mar', date: '25/11', x: 285 },
      { day: 'Mer', date: '26/11', x: 435 },
      { day: 'Jeu', date: '27/11', x: 585 },
      { day: 'Ven', date: '28/11', x: 735 }
    ];
    cols.forEach(function (c) {
      words.push(w(c.day, c.x, 20, 40, 18));
      words.push(w(c.date, c.x + 45, 20, 50, 18));
    });

    // Étiquettes d'heures dans la marge gauche (8h -> 18h).
    var hours = [
      { t: '8h', y: 75 }, { t: '10h', y: 155 }, { t: '12h', y: 235 },
      { t: '14h', y: 315 }, { t: '16h', y: 395 }, { t: '18h', y: 475 }
    ];
    hours.forEach(function (h) { words.push(w(h.t, 20, h.y, 40, 18)); });

    // Bloc 1 : Lundi 08:30-10:00 Maths Salle B12 M. Dupont.
    words.push(w('08:30-10:00', 135, 85, 80, 18));
    words.push(w('Maths', 145, 110, 50, 18));
    words.push(w('Salle', 140, 132, 40, 18));
    words.push(w('B12', 185, 132, 35, 18));
    words.push(w('M.', 140, 150, 20, 18));
    words.push(w('Dupont', 165, 150, 55, 18));

    // Bloc 2 : Lundi 14:00-16:00 Physique Amphi 2 Mme Martin.
    words.push(w('14:00-16:00', 135, 320, 80, 18));
    words.push(w('Physique', 140, 345, 60, 18));
    words.push(w('Amphi', 140, 368, 45, 18));
    words.push(w('2', 190, 368, 12, 18));
    words.push(w('Mme', 140, 388, 30, 18));
    words.push(w('Martin', 175, 388, 50, 18));

    // Bloc 3 : Mardi 10:00-12:00 Chimie Lab 3 Pr Bernard.
    words.push(w('10:00-12:00', 290, 165, 80, 18));
    words.push(w('Chimie', 295, 190, 45, 18));
    words.push(w('Lab', 290, 212, 30, 18));
    words.push(w('3', 325, 212, 12, 18));
    words.push(w('Pr', 290, 232, 20, 18));
    words.push(w('Bernard', 315, 232, 55, 18));

    // Bloc 4 : Mercredi 08:30-10:30 Histoire A204 M. Petit.
    words.push(w('08:30-10:30', 440, 105, 80, 18));
    words.push(w('Histoire', 445, 130, 55, 18));
    words.push(w('A204', 445, 155, 45, 18));
    words.push(w('M.', 445, 175, 20, 18));
    words.push(w('Petit', 470, 175, 40, 18));

    // Bloc 5 : Jeudi 16:00-18:00 Anglais S3-04 Dr Lefevre.
    words.push(w('16:00-18:00', 590, 405, 80, 18));
    words.push(w('Anglais', 595, 430, 50, 18));
    words.push(w('S3-04', 595, 455, 50, 18));
    words.push(w('Dr', 595, 475, 20, 18));
    words.push(w('Lefevre', 620, 475, 55, 18));

    // Bloc 6 : Vendredi 14:00-18:00 Informatique B12 M. Durand.
    words.push(w('14:00-18:00', 740, 325, 80, 18));
    words.push(w('Informatique', 745, 350, 80, 18));
    words.push(w('B12', 750, 380, 35, 18));
    words.push(w('M.', 750, 400, 20, 18));
    words.push(w('Durand', 775, 400, 55, 18));

    return {
      source: 'pdf-text',
      pages: [{ width: 1000, height: 600, words: words }],
      text: _buildTextFromWords(words, 1000)
    };
  }

  // --- Publication de l'API ---
  SF.importer = {
    config: config,
    loadLibrary: loadLibrary,
    extract: extract,
    parse: parse,
    parseText: parseText,
    toCourses: toCourses,
    demoExtraction: demoExtraction
  };

})(typeof window !== 'undefined' ? window : this);
