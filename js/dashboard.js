// js/dashboard.js — Tableau de bord : statistiques et graphiques (dev 2)
// Utilise SF.activities, SF.dates, SF.constants et SF.events. Chart.js est facultatif.
(function () {
  'use strict';

  window.SF = window.SF || {};

  // Couleurs des graphiques (palette Okabe-Ito : bien distincte pour les daltoniens)
  const COLORS = {
    done: '#0072B2',     // bleu
    pending: '#F0E442',  // jaune
    overdue: '#D55E00',  // rouge-orangé
    homework: '#56B4E9', // bleu ciel
    exam: '#CC79A7',     // rose
    revision: '#009E73', // vert
    project: '#E69F00',  // orange
    border: '#FFFFFF'    // trait blanc entre les parts de l'anneau
  };

  // Les quatre types d'activité, dans l'ordre des barres
  const TYPE_KEYS = ['homework', 'exam', 'revision', 'project'];

  // Les parts de l'anneau, dans l'ordre : terminées, en attente, en retard
  const PROGRESS_LABELS = ['Terminées', 'En attente', 'En retard'];

  // Textes affichés à l'utilisateur
  const TEXTS = {
    empty: 'Ajoute une première activité pour voir tes statistiques.',
    noUpcoming: 'Aucune échéance à venir.',
    noCharts: 'Graphiques indisponibles.'
  };

  // Les deux graphiques : créés une seule fois, ensuite seulement mis à jour
  let progressChart = null;
  let typesChart = null;

  // Devient vrai après l'abonnement à 'data:changed' (on ne s'abonne qu'une fois)
  let isSubscribed = false;

  // ---------- Petits outils ----------

  // Lance une fonction sans jamais laisser une erreur remonter à l'interface
  function safely(task, data) {
    try {
      task(data);
    } catch (error) {
      // On ignore l'erreur : le tableau de bord ne doit jamais faire planter l'application
    }
  }

  // Écrit un texte dans l'élément qui a cet id (ne fait rien s'il n'existe pas)
  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = String(text);
    }
  }

  // Donne le libellé français d'un type (Devoir, Examen...) grâce à SF.constants.LABELS
  function typeLabel(type) {
    const labels = SF.constants && SF.constants.LABELS;
    return (labels && labels[type]) || type;
  }

  // ---------- Statistiques ----------

  // Donne des statistiques toutes à zéro
  function emptyStats() {
    return {
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
      byType: { homework: 0, exam: 0, revision: 0, project: 0 },
      upcoming: []
    };
  }

  // Calcule les statistiques à partir des vraies données (relues à chaque appel, sans cache)
  function getStats() {
    const stats = emptyStats();
    try {
      const now = new Date();
      SF.activities.getAll().forEach(function (activity) {
        // On regarde d'abord « terminée » : une activité terminée n'est jamais en retard
        if (activity.status === 'done') {
          stats.done++;
        } else if (SF.activities.getDisplayStatus(activity, now) === 'overdue') {
          stats.overdue++;
        } else {
          stats.pending++;
        }
        if (TYPE_KEYS.includes(activity.type)) {
          stats.byType[activity.type]++;
        }
      });
      stats.total = stats.done + stats.pending + stats.overdue;
      stats.upcoming = SF.activities.getUpcoming(5);
    } catch (error) {
      return emptyStats(); // en cas de problème, on affiche des zéros plutôt que de planter
    }
    return stats;
  }

  // ---------- Compteurs, liste des échéances, état vide ----------

  // Met à jour les quatre compteurs
  function showCounters(stats) {
    setText('stat-total', stats.total);
    setText('stat-done', stats.done);
    setText('stat-pending', stats.pending);
    setText('stat-overdue', stats.overdue);
  }

  // Ajoute une ligne <li> à une liste (texte écrit avec textContent)
  function addListItem(list, text) {
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  }

  // Écrit le texte d'une échéance : titre, matière, date et heure (si elle existe)
  function buildUpcomingText(activity) {
    let when = SF.dates.formatFR(activity.date);
    if (activity.time) {
      when += ' à ' + activity.time;
    }
    const parts = [activity.title];
    if (activity.subject) {
      parts.push(activity.subject);
    }
    parts.push(when);
    return parts.join(' — ');
  }

  // Remplit la liste des prochaines échéances (une ligne par activité)
  function showUpcoming(upcoming) {
    const list = document.getElementById('upcoming-list');
    if (!list) {
      return;
    }
    list.textContent = ''; // on vide la liste avant de la remplir
    if (upcoming.length === 0) {
      addListItem(list, TEXTS.noUpcoming);
      return;
    }
    upcoming.forEach(function (activity) {
      addListItem(list, buildUpcomingText(activity));
    });
  }

  // Montre le message « état vide » ou les graphiques, selon qu'il y a des activités ou non
  function showEmptyState(isEmpty) {
    const message = document.getElementById('dashboard-empty');
    const charts = document.getElementById('dashboard-charts');
    if (message) {
      if (isEmpty) {
        message.textContent = TEXTS.empty;
      }
      message.hidden = !isEmpty;
    }
    if (charts) {
      charts.hidden = isEmpty;
    }
  }

  // ---------- Graphiques (Chart.js) ----------

  // Remplace chaque canvas par un message quand Chart.js n'est pas chargé
  function showChartsUnavailable() {
    ['chart-progress', 'chart-types'].forEach(function (id) {
      const canvas = document.getElementById(id);
      if (canvas && canvas.parentNode) {
        const message = document.createElement('p');
        message.textContent = TEXTS.noCharts;
        canvas.parentNode.replaceChild(message, canvas);
      }
    });
  }

  // Ajoute à un canvas une description lue par les lecteurs d'écran (aria-label)
  function describeCanvas(canvas, text) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', text);
  }

  // Crée l'anneau « terminées / en attente / en retard » (données à zéro au départ)
  function createProgressChart(canvas) {
    return new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: PROGRESS_LABELS,
        datasets: [{
          data: [0, 0, 0],
          backgroundColor: [COLORS.done, COLORS.pending, COLORS.overdue],
          borderColor: COLORS.border,
          borderWidth: 2
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  // Crée les barres « activités par type » (données à zéro au départ)
  function createTypesChart(canvas) {
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: TYPE_KEYS.map(typeLabel),
        datasets: [{
          label: 'Activités',
          data: [0, 0, 0, 0],
          backgroundColor: TYPE_KEYS.map(function (type) { return COLORS[type]; })
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // Dessine l'anneau : création la première fois, simple mise à jour ensuite
  function drawProgressChart(stats) {
    const canvas = document.getElementById('chart-progress');
    if (!canvas) {
      return;
    }
    if (!progressChart) {
      progressChart = createProgressChart(canvas);
    }
    progressChart.data.datasets[0].data = [stats.done, stats.pending, stats.overdue];
    describeCanvas(canvas, 'Graphique en anneau des activités. Terminées : ' + stats.done +
      '. En attente : ' + stats.pending + '. En retard : ' + stats.overdue + '.');
    progressChart.update();
  }

  // Dessine les barres : création la première fois, simple mise à jour ensuite
  function drawTypesChart(stats) {
    const canvas = document.getElementById('chart-types');
    if (!canvas) {
      return;
    }
    if (!typesChart) {
      typesChart = createTypesChart(canvas);
    }
    typesChart.data.datasets[0].data = TYPE_KEYS.map(function (type) {
      return stats.byType[type];
    });
    const details = TYPE_KEYS.map(function (type) {
      return typeLabel(type) + ' : ' + stats.byType[type];
    });
    describeCanvas(canvas, 'Graphique en barres des activités par type. ' + details.join('. ') + '.');
    typesChart.update();
  }

  // Dessine les deux graphiques, ou prévient que Chart.js est absent (les compteurs restent affichés)
  function drawCharts(stats) {
    if (typeof window.Chart !== 'function') {
      showChartsUnavailable();
      return;
    }
    safely(drawProgressChart, stats);
    safely(drawTypesChart, stats);
  }

  // Redimensionne puis redessine un graphique (s'il existe)
  function refreshChart(chart) {
    if (chart) {
      chart.resize();
      chart.update();
    }
  }

  // ---------- Fonctions publiques ----------

  // Met à jour tout l'écran : compteurs, échéances, état vide et graphiques
  function render() {
    const stats = SF.dashboard.getStats();
    safely(showCounters, stats);
    safely(showUpcoming, stats.upcoming);
    safely(showEmptyState, stats.total === 0);
    safely(drawCharts, stats);
  }

  // Affiche le tableau de bord, puis s'abonne aux changements de données (une seule fois)
  function init() {
    render();
    if (isSubscribed) {
      return;
    }
    try {
      SF.events.on('data:changed', render);
      isSubscribed = true;
    } catch (error) {
      // Sans SF.events, l'écran reste affiché mais ne se met plus à jour tout seul
    }
  }

  // À appeler quand l'onglet devient visible : données à jour, puis graphiques redimensionnés
  function onShow() {
    render(); // relit les données : le statut « en retard » dépend de l'heure
    safely(refreshChart, progressChart);
    safely(refreshChart, typesChart);
  }

  SF.dashboard = {
    getStats: getStats,
    render: render,
    init: init,
    onShow: onShow
  };
})();
