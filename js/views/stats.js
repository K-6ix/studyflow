(function () {
    'use strict';
    window.SF = window.SF || {};

    var PERIODS = [7, 30, 90];
    var PERIOD_KEY = 'studyflow.v1.statsPeriod';
    var period = 30;          // période choisie (en jours)
    var built = false;        // la page est-elle construite ?
    var chartsChecked = false;
    var barChart = null;      // graphique en barres
    var donutChart = null;    // graphique en anneau
    var els = {};             // références vers les éléments de la page

    // ----- Petits outils -----

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // Exécute une fonction sans jamais laisser une erreur remonter
    function safe(fn) {
        try { fn(); } catch (e) { /* on ignore */ }
    }

    function fm(minutes) { return SF.app.formatMinutes(minutes); }

    // Lit une variable CSS (ex. --accent) sur la page
    function cssVar(name, fallback) {
        try {
            var value = getComputedStyle(els.page).getPropertyValue(name).trim();
            return value || fallback;
        } catch (e) { return fallback; }
    }

    // '2026-11-21' -> '21/11'
    function shortDate(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

    // Minutes -> heures lisibles pour l'axe (90 -> '1,5 h')
    function formatHours(minutes) {
        if (!minutes) return '0';
        return String(Math.round(minutes / 6) / 10).replace('.', ',') + ' h';
    }

    function readPeriod() {
        try {
            var saved = parseInt(localStorage.getItem(PERIOD_KEY), 10);
            if (PERIODS.indexOf(saved) !== -1) return saved;
        } catch (e) { /* stockage bloqué */ }
        return 30;
    }

    function savePeriod() {
        try { localStorage.setItem(PERIOD_KEY, String(period)); } catch (e) { /* on ignore */ }
    }

    // ----- Calculs -----

    // Somme des minutes entre deux dates (incluses)
    function sumMinutes(startISO, endISO) {
        var total = 0;
        SF.sessions.getDayTotals(startISO, endISO).forEach(function (d) { total += d.minutes; });
        return total;
    }

    // Chiffres des quatre cartes
    function computeStats(startISO, todayISO, days) {
        var total = 0, bestMinutes = 0, bestDate = '';
        SF.sessions.getDayTotals(startISO, todayISO).forEach(function (d) {
            total += d.minutes;
            if (d.minutes > bestMinutes) { bestMinutes = d.minutes; bestDate = d.date; }
        });
        return {
            total: total,
            sessions: SF.sessions.getByRange(startISO, todayISO).length,
            average: Math.round(total / days),
            bestMinutes: bestMinutes,
            bestDate: bestDate
        };
    }

    // Phrase « Cette semaine : ... » (lundi -> dimanche)
    function weekText(todayISO) {
        var thisStart = SF.dates.startOfWeek(todayISO);
        var thisEnd = SF.dates.addDays(thisStart, 6);
        var lastStart = SF.dates.addDays(thisStart, -7);
        var lastEnd = SF.dates.addDays(thisStart, -1);
        var thisMinutes = sumMinutes(thisStart, thisEnd);
        var lastMinutes = sumMinutes(lastStart, lastEnd);
        var text = 'Cette semaine : ' + fm(thisMinutes);
        if (lastMinutes > 0) {
            var percent = Math.round((thisMinutes - lastMinutes) / lastMinutes * 100);
            text += ', ' + (percent > 0 ? '+' : '') + percent + ' % par rapport à la semaine dernière';
        }
        return text + '.';
    }

    // Données du graphique en barres : par jour, ou par semaine pour 90 jours
    function buildSeries(startISO, todayISO, days) {
        var map = {};
        SF.sessions.getDayTotals(startISO, todayISO).forEach(function (d) { map[d.date] = d.minutes; });
        var labels = [], values = [], i;

        if (days <= 30) {
            for (i = 0; i < days; i++) {
                var iso = SF.dates.addDays(startISO, i);
                labels.push(shortDate(iso));
                values.push(map[iso] || 0);
            }
        } else {
            var weekStart = SF.dates.startOfWeek(startISO);
            while (SF.dates.diffDays(weekStart, todayISO) >= 0) {
                var weekTotal = 0;
                for (i = 0; i < 7; i++) {
                    var day = SF.dates.addDays(weekStart, i);
                    if (day >= startISO && day <= todayISO) weekTotal += map[day] || 0;
                }
                labels.push('Sem. ' + shortDate(weekStart));
                values.push(weekTotal);
                weekStart = SF.dates.addDays(weekStart, 7);
            }
        }
        // la dernière barre (aujourd'hui ou la semaine en cours) est mise en évidence
        return { labels: labels, values: values, highlight: values.length - 1 };
    }

    // ----- Graphiques Chart.js (créés une seule fois) -----

    function setChartsAvailable(ok) {
        els.barCanvas.hidden = !ok;
        els.donutCanvas.hidden = !ok;
        els.barFallback.hidden = ok;
        els.donutFallback.hidden = ok;
    }

    function chartOptions(extra) {
        var base = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        };
        Object.keys(extra).forEach(function (key) { base[key] = extra[key]; });
        return base;
    }

    function createBarChart() {
        var muted = cssVar('--muted', '#9aa3b2');
        return new Chart(els.barCanvas, {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4 }] },
            options: chartOptions({
                scales: {
                    x: { ticks: { color: muted, maxRotation: 0, autoSkip: true }, grid: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { color: muted, callback: function (value) { return formatHours(value); } },
                        grid: { color: muted, lineWidth: 0.3 }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function (ctx) { return fm(ctx.parsed.y); } } }
                }
            })
        });
    }

    function createDonutChart() {
        return new Chart(els.donutCanvas, {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
            options: chartOptions({
                cutout: '60%',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function (ctx) { return ctx.label + ' : ' + fm(ctx.parsed); } } }
                }
            })
        });
    }

    // Crée les graphiques à la première utilisation (Chart peut être absent)
    function ensureCharts() {
        if (chartsChecked) return;
        chartsChecked = true;
        if (typeof Chart === 'undefined') { setChartsAvailable(false); return; }
        try {
            barChart = createBarChart();
            donutChart = createDonutChart();
            setChartsAvailable(true);
        } catch (e) {
            barChart = null;
            donutChart = null;
            setChartsAvailable(false);
        }
    }

    // ----- Mise à jour de l'affichage -----

    function updateCards(startISO, todayISO, days) {
        var s = computeStats(startISO, todayISO, days);
        els.total.textContent = fm(s.total);
        els.sessions.textContent = String(s.sessions);
        els.average.textContent = fm(s.average);
        els.best.textContent = s.bestMinutes > 0 ? fm(s.bestMinutes) : '—';
        els.bestSub.textContent = s.bestMinutes > 0 ? 'le ' + shortDate(s.bestDate) : '';
        els.week.textContent = weekText(todayISO);
    }

    function updateBar(startISO, todayISO, days) {
        els.barTitle.textContent = days > 30
            ? 'Temps d’étude par semaine (en heures)'
            : 'Temps d’étude par jour (en heures)';
        if (!barChart) return;
        var series = buildSeries(startISO, todayISO, days);
        var normal = cssVar('--info', '#4aa3ff');
        var strong = cssVar('--accent', '#8b5cf6');
        barChart.data.labels = series.labels;
        barChart.data.datasets[0].data = series.values;
        barChart.data.datasets[0].backgroundColor = series.values.map(function (v, i) {
            return i === series.highlight ? strong : normal;
        });
        barChart.update();
    }

    function updateDonut(startISO, todayISO) {
        var totals = SF.sessions.getSubjectTotals(startISO, todayISO)
            .filter(function (t) { return t.minutes > 0; })
            .sort(function (a, b) { return b.minutes - a.minutes; });
        var colors = totals.map(function (t) { return SF.app.subjectColor(t.subject); });

        if (donutChart) {
            donutChart.data.labels = totals.map(function (t) { return t.subject; });
            donutChart.data.datasets[0].data = totals.map(function (t) { return t.minutes; });
            donutChart.data.datasets[0].backgroundColor = colors;
            donutChart.update();
        }

        // légende : couleur + matière + durée
        els.legend.textContent = '';
        if (!totals.length) {
            els.legend.appendChild(el('li', 'stats-legend-item', 'Aucune séance sur cette période.'));
            return;
        }
        totals.forEach(function (t, i) {
            var item = el('li', 'stats-legend-item');
            var dot = el('span', 'stats-legend-dot');
            dot.style.backgroundColor = colors[i];
            item.appendChild(dot);
            item.appendChild(el('span', 'stats-legend-name', t.subject));
            item.appendChild(el('span', 'stats-legend-time', fm(t.minutes)));
            els.legend.appendChild(item);
        });
    }

    function updatePeriodButtons() {
        els.periodButtons.forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(Number(btn.getAttribute('data-days')) === period));
        });
    }

    // Peut être appelée à tout moment, même vue masquée
    function render() {
        if (!built) return;
        safe(function () {
            var todayISO = SF.dates.todayISO();
            var days = period;
            var startISO = SF.dates.addDays(todayISO, -(days - 1));
            var hasSessions = SF.sessions.getRecent(1).length > 0;

            els.empty.hidden = hasSessions;
            els.content.hidden = !hasSessions;
            updatePeriodButtons();
            if (!hasSessions) return;

            ensureCharts();
            safe(function () { updateCards(startISO, todayISO, days); });
            safe(function () { updateBar(startISO, todayISO, days); });
            safe(function () { updateDonut(startISO, todayISO); });
        });
    }

    // ----- Construction de la page (une seule fois) -----

    function addStatCard(parent, valueId, label) {
        var card = el('div', 'stat stats-stat');
        var value = el('span', 'stats-stat-value', '—');
        if (valueId) value.id = valueId;
        card.appendChild(value);
        card.appendChild(el('span', 'stats-stat-label', label));
        var sub = el('span', 'stats-stat-sub');
        card.appendChild(sub);
        parent.appendChild(card);
        return { value: value, sub: sub };
    }

    // Un bloc de graphique : titre + canvas + message de secours
    function addChartBlock(parent, title) {
        var block = el('div', 'stats-chart');
        var heading = el('h4', 'stats-chart-title', title);
        var box = el('div', 'stats-chart-box');
        var canvas = el('canvas');
        var fallback = el('p', 'stats-unavailable', 'Graphiques indisponibles.');
        fallback.hidden = true;
        box.appendChild(canvas);
        box.appendChild(fallback);
        block.appendChild(heading);
        block.appendChild(box);
        parent.appendChild(block);
        return { block: block, heading: heading, canvas: canvas, fallback: fallback };
    }

    function buildTimeCard(page) {
        var card = el('section', 'card stats-section');
        var head = el('div', 'stats-head');
        head.appendChild(el('h3', 'card-title', 'Temps d’étude'));

        var periods = el('div', 'stats-periods');
        periods.setAttribute('role', 'group');
        periods.setAttribute('aria-label', 'Période');
        els.periodButtons = [];
        PERIODS.forEach(function (days) {
            var btn = el('button', 'stats-period-btn', days + ' jours');
            btn.type = 'button';
            btn.setAttribute('data-days', String(days));
            btn.addEventListener('click', function () {
                period = days;
                savePeriod();
                render();
            });
            periods.appendChild(btn);
            els.periodButtons.push(btn);
        });
        head.appendChild(periods);
        card.appendChild(head);

        // état vide : aucune session
        els.empty = el('div', 'empty stats-empty');
        els.empty.appendChild(el('p', '', 'Aucune session pour l’instant. Lance un chrono ou ajoute une session depuis l’Accueil.'));
        var goTimer = el('button', 'btn btn-primary', 'Lancer un chrono');
        goTimer.type = 'button';
        goTimer.addEventListener('click', function () { safe(function () { SF.app.navigate('timer'); }); });
        els.empty.appendChild(goTimer);
        card.appendChild(els.empty);

        // contenu : cartes + graphiques
        els.content = el('div', 'stats-content');
        var grid = el('div', 'stats-grid');
        els.total = addStatCard(grid, '', 'Temps total').value;
        els.sessions = addStatCard(grid, '', 'Séances').value;
        els.average = addStatCard(grid, '', 'Moyenne par jour').value;
        var best = addStatCard(grid, '', 'Meilleur jour');
        els.best = best.value;
        els.bestSub = best.sub;
        els.content.appendChild(grid);

        els.week = el('p', 'stats-week');
        els.content.appendChild(els.week);

        var charts = el('div', 'stats-charts');
        var bar = addChartBlock(charts, 'Temps d’étude par jour (en heures)');
        bar.canvas.className = 'stats-bar-canvas';
        bar.canvas.setAttribute('role', 'img');
        bar.canvas.setAttribute('aria-label', 'Graphique du temps d’étude');
        els.barTitle = bar.heading;
        els.barCanvas = bar.canvas;
        els.barFallback = bar.fallback;

        var donut = addChartBlock(charts, 'Temps par matière');
        donut.canvas.className = 'stats-donut-canvas';
        donut.canvas.setAttribute('role', 'img');
        donut.canvas.setAttribute('aria-label', 'Répartition du temps par matière');
        els.donutCanvas = donut.canvas;
        els.donutFallback = donut.fallback;
        els.legend = el('ul', 'stats-legend');
        donut.block.appendChild(els.legend);

        els.content.appendChild(charts);
        card.appendChild(els.content);
        page.appendChild(card);
    }

    // Section 2 : les ids sont imposés car SF.dashboard les cherche
    function buildActivitiesCard(page) {
        var card = el('section', 'card stats-section');
        card.appendChild(el('h3', 'card-title', 'Avancement des activités'));

        var grid = el('div', 'stats-grid');
        addStatCard(grid, 'stat-total', 'Total');
        addStatCard(grid, 'stat-done', 'Terminées');
        addStatCard(grid, 'stat-pending', 'En attente');
        addStatCard(grid, 'stat-overdue', 'En retard');
        card.appendChild(grid);

        card.appendChild(el('h4', 'stats-subtitle', 'Prochaines échéances'));
        var upcoming = el('ul', 'stats-upcoming');
        upcoming.id = 'upcoming-list';
        card.appendChild(upcoming);

        var empty = el('p', 'empty stats-empty', 'Aucune activité pour l’instant.');
        empty.id = 'dashboard-empty';
        empty.hidden = true;
        card.appendChild(empty);

        var charts = el('div', 'stats-charts');
        charts.id = 'dashboard-charts';
        var progress = el('div', 'stats-chart');
        progress.appendChild(el('h4', 'stats-chart-title', 'Progression'));
        var boxA = el('div', 'stats-chart-box');
        var canvasA = el('canvas');
        canvasA.id = 'chart-progress';
        boxA.appendChild(canvasA);
        progress.appendChild(boxA);
        var types = el('div', 'stats-chart');
        types.appendChild(el('h4', 'stats-chart-title', 'Répartition par type'));
        var boxB = el('div', 'stats-chart-box');
        var canvasB = el('canvas');
        canvasB.id = 'chart-types';
        boxB.appendChild(canvasB);
        types.appendChild(boxB);
        charts.appendChild(progress);
        charts.appendChild(types);
        card.appendChild(charts);
        page.appendChild(card);
    }

    function mount(container) {
        period = readPeriod();
        var page = el('div', 'stats-page');
        els.page = page;
        page.appendChild(el('h2', 'stats-title', 'Statistiques'));
        buildTimeCard(page);
        buildActivitiesCard(page);
        container.appendChild(page);
        built = true;

        // la section 2 est gérée par SF.dashboard (init UNE seule fois)
        safe(function () { SF.dashboard.init(); });
        SF.events.on('data:changed', render);
        render();
    }

    function onShow() {
        render();
        // un graphique créé dans une vue masquée a une taille nulle : on le redimensionne
        safe(function () { if (barChart) barChart.resize(); });
        safe(function () { if (donutChart) donutChart.resize(); });
        safe(function () { SF.dashboard.onShow(); });
    }

    SF.app.registerView('stats', { mount: mount, onShow: onShow });
})();