(function () {
    'use strict';

    window.SF = window.SF || {};

    const refusedKeys = [];
    const GOALS_COLLECTION = 'goals';

    function getDates() {
        return window.SF.dates;
    }

    function getStorage() {
        return window.SF.storage;
    }

    function getActivities() {
        return window.SF.activities;
    }

    function getTimetable() {
        return window.SF.timetable;
    }

    function isValidISO(value) {
        try {
            return typeof value === 'string' && !!getDates() && getDates().isValidISO(value);
        } catch (error) {
            return false;
        }
    }

    function isValidTime(value) {
        try {
            return typeof value === 'string' && !!getDates() && getDates().isValidTime(value);
        } catch (error) {
            return false;
        }
    }

    function normalizeText(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function cleanSubject(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function readGoals() {
        try {
            const storage = getStorage();
            if (!storage || typeof storage.load !== 'function') {
                return { ok: false, items: [] };
            }
            const data = storage.load(GOALS_COLLECTION);
            return { ok: true, items: Array.isArray(data) ? data : [] };
        } catch (error) {
            return { ok: false, items: [] };
        }
    }

    function saveGoals(goals) {
        try {
            const storage = getStorage();
            if (!storage || typeof storage.save !== 'function') {
                return false;
            }
            if (typeof storage.isAvailable === 'function' && storage.isAvailable() === false) {
                return false;
            }
            const result = storage.save(GOALS_COLLECTION, goals);
            return result !== false && !(result && result.ok === false);
        } catch (error) {
            return false;
        }
    }

    function getAllowedTargetTypes() {
        const constants = window.SF.constants || {};
        const values = constants.TARGET_TYPES;
        if (Array.isArray(values)) {
            return values;
        }
        if (values && typeof values === 'object') {
            return Object.keys(values).concat(Object.values(values));
        }
        return ['minutes', 'sessions'];
    }

    function getSettings() {
        const defaults = {
            dayStart: '08:00',
            dayEnd: '21:00',
            minSessionMinutes: 30,
            maxSessionMinutes: 90
        };
        try {
            const storage = getStorage();
            const settings = storage && typeof storage.getSettings === 'function'
                ? storage.getSettings()
                : null;
            return Object.assign({}, defaults, settings && typeof settings === 'object' ? settings : {});
        } catch (error) {
            return defaults;
        }
    }

    function getPositiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
    }

    function readActivities() {
        try {
            const activities = getActivities();
            if (!activities || typeof activities.getAll !== 'function') {
                return [];
            }
            const data = activities.getAll();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            return [];
        }
    }

    function readGoalsWithProgress() {
        const result = readGoals();
        if (!result.ok) {
            return [];
        }
        return result.items.map(function (goal) {
            return {
                goal: goal,
                reached: getGoalProgress(goal).reached
            };
        });
    }

    function getPriorityWeight(priority) {
        if (priority === 'high') {
            return 3;
        }
        if (priority === 'low') {
            return 1;
        }
        return 2;
    }

    function getPriorityLabel(priority) {
        if (priority === 'high') {
            return 'priorité haute';
        }
        if (priority === 'low') {
            return 'priorité basse';
        }
        return 'priorité moyenne';
    }

    function getTypeLabel(type) {
        const labels = window.SF.constants && window.SF.constants.LABELS;
        if (labels && typeof labels[type] === 'string' && labels[type].trim()) {
            return labels[type];
        }
        const defaults = {
            homework: 'Devoir',
            exam: 'Examen',
            project: 'Projet'
        };
        return defaults[type] || 'Travail';
    }

    function getDeadlineDistance(fromDate, toDate) {
        try {
            return getDates().diffDays(fromDate, toDate);
        } catch (error) {
            return 0;
        }
    }

    function getUrgency(daysLeft) {
        if (daysLeft <= 3) {
            return 3;
        }
        if (daysLeft <= 7) {
            return 2;
        }
        return 1;
    }

    function compareSources(a, b) {
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        if (a.dueDate !== b.dueDate) {
            return a.dueDate < b.dueDate ? -1 : 1;
        }
        const subjectA = normalizeText(a.subject);
        const subjectB = normalizeText(b.subject);
        if (subjectA !== subjectB) {
            return subjectA < subjectB ? -1 : 1;
        }
        const idA = a.activity ? String(a.activity.id || '') : String(a.goalId || '');
        const idB = b.activity ? String(b.activity.id || '') : String(b.goalId || '');
        return idA < idB ? -1 : (idA > idB ? 1 : 0);
    }

    function buildSourcesForDay(day, activities, goals, today, lastSourceDate) {
        const sources = [];
        const activeGoalsBySubject = Object.create(null);

        goals.forEach(function (entry) {
            const goal = entry.goal;
            if (entry.reached || !goal || !goal.subject || goal.startDate > day || goal.endDate < day) {
                return;
            }
            const subjectKey = normalizeText(goal.subject);
            if (!activeGoalsBySubject[subjectKey]) {
                activeGoalsBySubject[subjectKey] = [];
            }
            activeGoalsBySubject[subjectKey].push(goal);
        });

        activities.forEach(function (activity) {
            if (!activity || activity.status === 'done') {
                return;
            }
            if (activity.type !== 'homework' && activity.type !== 'exam' && activity.type !== 'project') {
                return;
            }
            if (!isValidISO(activity.date) || activity.date < today || activity.date > lastSourceDate) {
                return;
            }

            const subject = cleanSubject(activity.subject);
            const subjectKey = normalizeText(subject);
            const matchingGoals = activeGoalsBySubject[subjectKey] || [];
            const daysLeft = getDeadlineDistance(today, activity.date);
            const urgency = getUrgency(daysLeft);
            const score = getPriorityWeight(activity.priority) * urgency * (activity.type === 'exam' ? 2 : 1) +
                (matchingGoals.length > 0 ? 2 : 0);
            const relatedGoal = matchingGoals.slice().sort(function (a, b) {
                if (a.endDate !== b.endDate) {
                    return a.endDate < b.endDate ? -1 : 1;
                }
                const idA = String(a.id || '');
                const idB = String(b.id || '');
                return idA < idB ? -1 : (idA > idB ? 1 : 0);
            })[0];

            sources.push({
                kind: 'activity',
                subject: subject,
                priority: activity.priority || 'medium',
                score: score,
                dueDate: activity.date,
                activity: activity,
                goalId: relatedGoal ? relatedGoal.id : null
            });
        });

        Object.keys(activeGoalsBySubject).forEach(function (subjectKey) {
            activeGoalsBySubject[subjectKey].forEach(function (goal) {
                sources.push({
                    kind: 'goal',
                    subject: cleanSubject(goal.subject),
                    priority: 'medium',
                    score: 2 * 1 + 2,
                    dueDate: goal.endDate,
                    activity: null,
                    goalId: goal.id
                });
            });
        });

        const bestBySubject = Object.create(null);
        sources.sort(compareSources).forEach(function (source) {
            const key = normalizeText(source.subject);
            if (!Object.prototype.hasOwnProperty.call(bestBySubject, key)) {
                bestBySubject[key] = source;
            }
        });

        return Object.keys(bestBySubject).map(function (key) {
            return bestBySubject[key];
        }).sort(compareSources);
    }

    function hasRevisionForSubject(activities, day, subject) {
        const wanted = normalizeText(subject);
        return activities.some(function (activity) {
            return activity && activity.type === 'revision' && activity.date === day &&
                normalizeText(activity.subject) === wanted;
        });
    }

    function getAllowedEnd(source, day, slotEnd) {
        if (source.kind !== 'activity' || !source.activity) {
            return slotEnd;
        }
        const activity = source.activity;
        if (activity.type === 'exam' || activity.date !== day || !isValidTime(activity.time)) {
            return slotEnd;
        }
        return Math.min(slotEnd, getDates().timeToMinutes(activity.time) - 1);
    }

    function canScheduleSource(source, day, sessionEnd) {
        if (source.kind === 'goal') {
            return true;
        }

        const activity = source.activity;
        if (!activity) {
            return false;
        }
        if (activity.type === 'exam') {
            return day < activity.date;
        }
        if (day > activity.date) {
            return false;
        }
        if (day === activity.date && isValidTime(activity.time)) {
            return sessionEnd < getDates().timeToMinutes(activity.time);
        }
        return true;
    }

    function makeReason(source, day) {
        if (source.kind === 'goal') {
            return 'Objectif de révision en ' + (source.subject || 'matière générale') + ' — ' +
                getPriorityLabel(source.priority);
        }
        const activity = source.activity;
        const typeLabel = getTypeLabel(activity.type);
        const distance = getDeadlineDistance(day, activity.date);
        let deadlineText = 'aujourd’hui';
        if (distance === 1) {
            deadlineText = 'dans 1 jour';
        } else if (distance > 1) {
            deadlineText = 'dans ' + distance + ' jours';
        }
        const subjectText = source.subject ? ' de ' + source.subject : '';
        return typeLabel + subjectText + ' ' + deadlineText + ' — ' + getPriorityLabel(source.priority);
    }

    function buildSuggestion(source, day, startMinute, duration, reason) {
        const startTime = getDates().minutesToTime(startMinute);
        const key = day + '|' + startTime + '|' + source.subject;
        return {
            key: key,
            subject: source.subject,
            date: day,
            startTime: startTime,
            endTime: getDates().minutesToTime(startMinute + duration),
            durationMinutes: duration,
            priority: source.priority,
            reason: reason,
            goalId: source.goalId || null,
            basedOnActivityId: source.activity ? source.activity.id : null
        };
    }

    // Renvoie la liste des objectifs enregistrés.
    function getGoals() {
        const result = readGoals();
        return result.ok ? result.items : [];
    }

    // Vérifie les champs et renvoie les erreurs de validation d'un objectif.
    function validateGoal(data) {
        try {
            const errors = {};
            const item = data && typeof data === 'object' ? data : {};
            const title = typeof item.title === 'string' ? item.title.trim() : '';

            if (!title) {
                errors.title = 'Le titre est obligatoire.';
            } else if (title.length > 100) {
                errors.title = 'Le titre ne doit pas dépasser 100 caractères.';
            }

            if (item.subject !== undefined && item.subject !== null && typeof item.subject !== 'string') {
                errors.subject = 'La matière doit être un texte.';
            }

            const targetTypes = getAllowedTargetTypes();
            if (!targetTypes.includes(item.targetType)) {
                errors.targetType = 'Le type de cible doit être « minutes » ou « sessions ».';
            }

            const targetValue = Number(item.targetValue);
            if (!Number.isFinite(targetValue) || targetValue <= 0) {
                errors.targetValue = 'La valeur cible doit être un nombre supérieur à 0.';
            } else if (item.targetType === 'sessions' && !Number.isInteger(targetValue)) {
                errors.targetValue = 'La cible en séances doit être un nombre entier.';
            }

            if (!isValidISO(item.startDate)) {
                errors.startDate = 'La date de début est invalide.';
            }
            if (!isValidISO(item.endDate)) {
                errors.endDate = 'La date de fin est invalide.';
            }
            if (isValidISO(item.startDate) && isValidISO(item.endDate) && item.startDate > item.endDate) {
                errors.endDate = 'La date de fin doit être égale ou postérieure à la date de début.';
            }

            return errors;
        } catch (error) {
            return { general: 'Les données de l’objectif ne peuvent pas être vérifiées.' };
        }
    }

    // Ajoute un objectif valide dans le stockage.
    function addGoal(data) {
        try {
            const errors = validateGoal(data);
            if (Object.keys(errors).length > 0) {
                return { ok: false, errors: errors };
            }
            const loaded = readGoals();
            if (!loaded.ok) {
                return { ok: false, errors: { storage: 'Impossible de lire les objectifs enregistrés.' } };
            }
            const storage = getStorage();
            const id = storage && typeof storage.newId === 'function' ? storage.newId() : null;
            if (!id) {
                return { ok: false, errors: { storage: 'Impossible de créer l’identifiant de l’objectif.' } };
            }
            const item = {
                id: id,
                title: data.title.trim(),
                subject: cleanSubject(data.subject) || null,
                targetType: data.targetType,
                targetValue: Number(data.targetValue),
                startDate: data.startDate,
                endDate: data.endDate
            };
            loaded.items.push(item);
            if (!saveGoals(loaded.items)) {
                return { ok: false, errors: { storage: 'Impossible de sauvegarder l’objectif.' } };
            }
            return { ok: true, item: item };
        } catch (error) {
            return { ok: false, errors: { general: 'Une erreur a empêché l’ajout de l’objectif.' } };
        }
    }

    // Modifie un objectif existant après validation de ses nouvelles données.
    function updateGoal(id, patch) {
        try {
            const loaded = readGoals();
            if (!loaded.ok) {
                return { ok: false, errors: { storage: 'Impossible de lire les objectifs enregistrés.' } };
            }
            const index = loaded.items.findIndex(function (goal) {
                return goal && goal.id === id;
            });
            if (index === -1) {
                return { ok: false, errors: { id: 'Objectif introuvable.' } };
            }
            const current = loaded.items[index];
            const changes = patch && typeof patch === 'object' ? patch : {};
            const data = {
                title: changes.title === undefined ? current.title : changes.title,
                subject: changes.subject === undefined ? current.subject : changes.subject,
                targetType: changes.targetType === undefined ? current.targetType : changes.targetType,
                targetValue: changes.targetValue === undefined ? current.targetValue : changes.targetValue,
                startDate: changes.startDate === undefined ? current.startDate : changes.startDate,
                endDate: changes.endDate === undefined ? current.endDate : changes.endDate
            };
            const errors = validateGoal(data);
            if (Object.keys(errors).length > 0) {
                return { ok: false, errors: errors };
            }
            const item = {
                id: current.id,
                title: data.title.trim(),
                subject: cleanSubject(data.subject) || null,
                targetType: data.targetType,
                targetValue: Number(data.targetValue),
                startDate: data.startDate,
                endDate: data.endDate
            };
            loaded.items[index] = item;
            if (!saveGoals(loaded.items)) {
                return { ok: false, errors: { storage: 'Impossible de sauvegarder l’objectif.' } };
            }
            return { ok: true, item: item };
        } catch (error) {
            return { ok: false, errors: { general: 'Une erreur a empêché la modification de l’objectif.' } };
        }
    }

    // Supprime un objectif et renvoie vrai si la sauvegarde a réussi.
    function removeGoal(id) {
        try {
            const loaded = readGoals();
            if (!loaded.ok) {
                return false;
            }
            const index = loaded.items.findIndex(function (goal) {
                return goal && goal.id === id;
            });
            if (index === -1) {
                return false;
            }
            loaded.items.splice(index, 1);
            return saveGoals(loaded.items);
        } catch (error) {
            return false;
        }
    }

    // Calcule la progression d'un objectif à partir des révisions terminées.
    function getGoalProgress(goalOrId) {
        const empty = { current: 0, target: 0, percent: 0, unit: 'min', reached: false };
        try {
            let goal = goalOrId;
            if (typeof goalOrId === 'string') {
                goal = getGoals().find(function (item) {
                    return item && item.id === goalOrId;
                });
            }
            if (!goal || typeof goal !== 'object') {
                return empty;
            }

            const target = Number(goal.targetValue);
            const isSessions = goal.targetType === 'sessions';
            const activities = readActivities();
            let current = 0;

            activities.forEach(function (activity) {
                if (!activity || activity.type !== 'revision' || activity.status !== 'done') {
                    return;
                }
                if (!isValidISO(activity.date) || activity.date < goal.startDate || activity.date > goal.endDate) {
                    return;
                }
                if (goal.subject && normalizeText(activity.subject) !== normalizeText(goal.subject)) {
                    return;
                }
                if (isSessions) {
                    current += 1;
                } else {
                    const minutes = Number(activity.estimatedMinutes);
                    if (Number.isFinite(minutes) && minutes > 0) {
                        current += minutes;
                    }
                }
            });

            const validTarget = Number.isFinite(target) && target > 0;
            const percent = validTarget ? Math.min(100, Math.round((current / target) * 100)) : 0;
            return {
                current: current,
                target: validTarget ? target : 0,
                percent: percent,
                unit: isSessions ? 'séances' : 'min',
                reached: validTarget && current >= target
            };
        } catch (error) {
            return empty;
        }
    }

    // Calcule les créneaux libres d'une journée en retirant les cours et activités horaires.
    function getFreeSlots(iso) {
        try {
            if (!isValidISO(iso)) {
                return [];
            }
            const dates = getDates();
            const settings = getSettings();
            const dayStart = isValidTime(settings.dayStart) ? dates.timeToMinutes(settings.dayStart) : 480;
            const dayEnd = isValidTime(settings.dayEnd) ? dates.timeToMinutes(settings.dayEnd) : 1260;
            const minSession = getPositiveInteger(settings.minSessionMinutes, 30);
            if (dayEnd <= dayStart) {
                return [];
            }

            let openingStart = dayStart;
            if (iso === dates.todayISO()) {
                const currentTime = dates.nowHHMM();
                if (isValidTime(currentTime)) {
                    const currentMinutes = dates.timeToMinutes(currentTime);
                    openingStart = Math.max(openingStart, Math.ceil(currentMinutes / 15) * 15);
                }
            }
            if (openingStart >= dayEnd) {
                return [];
            }

            const busy = [];
            const timetable = getTimetable();
            const courses = timetable && typeof timetable.getForDate === 'function'
                ? timetable.getForDate(iso)
                : [];
            (Array.isArray(courses) ? courses : []).forEach(function (course) {
                if (!course || !isValidTime(course.startTime) || !isValidTime(course.endTime)) {
                    return;
                }
                const start = dates.timeToMinutes(course.startTime);
                const end = dates.timeToMinutes(course.endTime);
                if (end > start) {
                    busy.push({ start: Math.max(dayStart, start), end: Math.min(dayEnd, end) });
                }
            });

            const activities = getActivities();
            const dayActivities = activities && typeof activities.getByDate === 'function'
                ? activities.getByDate(iso)
                : readActivities().filter(function (activity) {
                    return activity && activity.date === iso;
                });
            (Array.isArray(dayActivities) ? dayActivities : []).forEach(function (activity) {
                if (!activity || !isValidTime(activity.time)) {
                    return;
                }
                const start = dates.timeToMinutes(activity.time);
                const rawDuration = Number(activity.estimatedMinutes);
                const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60;
                const end = start + duration;
                if (end > start) {
                    busy.push({ start: Math.max(dayStart, start), end: Math.min(dayEnd, end) });
                }
            });

            const intervals = busy.filter(function (period) {
                return period.end > period.start && period.end > dayStart && period.start < dayEnd;
            }).sort(function (a, b) {
                return a.start - b.start || a.end - b.end;
            });

            const merged = [];
            intervals.forEach(function (period) {
                const last = merged[merged.length - 1];
                if (!last || period.start > last.end) {
                    merged.push({ start: period.start, end: period.end });
                } else {
                    last.end = Math.max(last.end, period.end);
                }
            });

            const slots = [];
            let cursor = openingStart;
            merged.forEach(function (period) {
                const busyStart = Math.max(openingStart, period.start);
                const busyEnd = Math.min(dayEnd, period.end);
                if (busyStart > cursor && busyStart - cursor >= minSession) {
                    slots.push({
                        start: dates.minutesToTime(cursor),
                        end: dates.minutesToTime(busyStart),
                        minutes: busyStart - cursor
                    });
                }
                cursor = Math.max(cursor, busyEnd);
            });
            if (dayEnd - cursor >= minSession) {
                slots.push({
                    start: dates.minutesToTime(cursor),
                    end: dates.minutesToTime(dayEnd),
                    minutes: dayEnd - cursor
                });
            }
            return slots;
        } catch (error) {
            return [];
        }
    }

    // Génère des séances de révision déterministes à partir des activités, objectifs et créneaux libres.
    function generateSuggestions(options) {
        try {
            const dates = getDates();
            if (!dates || !getStorage() || !getActivities()) {
                return [];
            }
            const settings = getSettings();
            const today = dates.todayISO();
            const optionsValue = options && typeof options === 'object' ? options : {};
            const fromDate = optionsValue.fromISO === undefined ? today : optionsValue.fromISO;
            const toDate = optionsValue.toISO === undefined ? dates.addDays(today, 6) : optionsValue.toISO;
            const maxPerDayValue = optionsValue.maxPerDay === undefined ? 2 : Number(optionsValue.maxPerDay);
            const maxPerDay = Number.isFinite(maxPerDayValue) ? Math.max(0, Math.floor(maxPerDayValue)) : 2;
            const minSession = getPositiveInteger(settings.minSessionMinutes, 30);
            const maxSession = getPositiveInteger(settings.maxSessionMinutes, 90);

            if (!isValidISO(fromDate) || !isValidISO(toDate) || fromDate > toDate || maxPerDay === 0) {
                return [];
            }
            const totalDays = dates.diffDays(fromDate, toDate);
            if (!Number.isFinite(totalDays) || totalDays < 0) {
                return [];
            }

            const activities = readActivities();
            const lastSourceDate = dates.addDays(today, 14);
            const goalStates = readGoalsWithProgress();
            const suggestions = [];

            for (let dayOffset = 0; dayOffset <= totalDays; dayOffset += 1) {
                const day = dates.addDays(fromDate, dayOffset);
                if (day < today) {
                    continue;
                }

                const slots = getFreeSlots(day);
                if (slots.length === 0) {
                    continue;
                }
                const sources = buildSourcesForDay(day, activities, goalStates, today, lastSourceDate);
                if (sources.length === 0) {
                    continue;
                }

                const scheduledSubjects = [];
                const usedRevisions = activities.filter(function (activity) {
                    return activity && activity.type === 'revision' && activity.date === day;
                });
                let sessionsCount = 0;

                for (let slotIndex = 0; slotIndex < slots.length && sessionsCount < maxPerDay; slotIndex += 1) {
                    const slot = slots[slotIndex];
                    let cursor = dates.timeToMinutes(slot.start);
                    const slotEnd = dates.timeToMinutes(slot.end);

                    while (cursor < slotEnd && sessionsCount < maxPerDay) {
                        let selected = null;
                        let selectedDuration = 0;
                        let selectedEnd = 0;
                        const startTime = dates.minutesToTime(cursor);

                        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
                            const source = sources[sourceIndex];
                            const subjectKey = normalizeText(source.subject);
                            if (scheduledSubjects.includes(subjectKey)) {
                                continue;
                            }
                            if (hasRevisionForSubject(usedRevisions, day, source.subject)) {
                                continue;
                            }
                            const allowedEnd = getAllowedEnd(source, day, slotEnd);
                            const availableMinutes = allowedEnd - cursor;
                            const duration = Math.floor(Math.min(availableMinutes, maxSession) / 15) * 15;
                            if (duration < minSession) {
                                continue;
                            }
                            const endMinute = cursor + duration;
                            if (!canScheduleSource(source, day, endMinute)) {
                                continue;
                            }
                            const key = day + '|' + startTime + '|' + source.subject;
                            if (refusedKeys.includes(key)) {
                                continue;
                            }
                            selected = source;
                            selectedDuration = duration;
                            selectedEnd = endMinute;
                            break;
                        }

                        if (!selected) {
                            break;
                        }

                        const suggestion = buildSuggestion(
                            selected,
                            day,
                            cursor,
                            selectedDuration,
                            makeReason(selected, day)
                        );
                        suggestions.push(suggestion);
                        scheduledSubjects.push(normalizeText(selected.subject));
                        sessionsCount += 1;
                        cursor = selectedEnd + 10;
                    }
                }
            }

            return suggestions.sort(function (a, b) {
                if (a.date !== b.date) {
                    return a.date < b.date ? -1 : 1;
                }
                if (a.startTime !== b.startTime) {
                    return a.startTime < b.startTime ? -1 : 1;
                }
                const subjectA = normalizeText(a.subject);
                const subjectB = normalizeText(b.subject);
                return subjectA < subjectB ? -1 : (subjectA > subjectB ? 1 : 0);
            });
        } catch (error) {
            return [];
        }
    }

    // Crée une activité de révision à partir de la suggestion reçue, même si elle a été modifiée.
    function acceptSuggestion(suggestion) {
        try {
            const activities = getActivities();
            if (!activities || typeof activities.add !== 'function') {
                return { ok: false, errors: { general: 'Le module des activités est indisponible.' } };
            }
            const item = suggestion && typeof suggestion === 'object' ? suggestion : {};
            return activities.add({
                title: 'Révision — ' + cleanSubject(item.subject),
                subject: cleanSubject(item.subject),
                type: 'revision',
                date: item.date,
                time: item.startTime,
                priority: item.priority,
                estimatedMinutes: item.durationMinutes,
                description: item.reason
            });
        } catch (error) {
            return { ok: false, errors: { general: 'Impossible d’accepter cette suggestion.' } };
        }
    }

    // Mémorise la clé d'une suggestion refusée pendant la session en cours.
    function refuseSuggestion(suggestion) {
        try {
            const item = suggestion && typeof suggestion === 'object' ? suggestion : {};
            const key = typeof item.key === 'string' && item.key
                ? item.key
                : (item.date + '|' + item.startTime + '|' + cleanSubject(item.subject));
            if (key && !refusedKeys.includes(key)) {
                refusedKeys.push(key);
            }
        } catch (error) {
            // Le refus reste sans effet si la suggestion reçue est invalide.
        }
        return true;
    }

    window.SF.planner = {
        getGoals: getGoals,
        validateGoal: validateGoal,
        addGoal: addGoal,
        updateGoal: updateGoal,
        removeGoal: removeGoal,
        getGoalProgress: getGoalProgress,
        getFreeSlots: getFreeSlots,
        generateSuggestions: generateSuggestions,
        acceptSuggestion: acceptSuggestion,
        refuseSuggestion: refuseSuggestion
    };
}());
