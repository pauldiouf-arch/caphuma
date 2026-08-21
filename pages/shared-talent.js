        // CONFIGURATION SUPABASE — vient désormais de shared/caphuma-config.js
        // (chargé dans le <head>), qui est la source unique pour les 15 pages.
        // Voir MC13 Addendum §1.5 (U3) : ceci remplace l'ancienne copie
        // indépendante qui existait ici (cette page ne pouvait pas compter sur
        // le pont localStorage — elle a maintenant le même fichier partagé que
        // toutes les autres pages).
        const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


        function renderBadges(containerId, list) {
            const container = document.getElementById(containerId);
            let items = [];
            if (Array.isArray(list)) {
                items = list;
            } else if (typeof list === 'string' && list.trim()) {
                items = list.split(',').map(s => s.trim()).filter(Boolean);
            }
            if (items.length === 0) {
                container.innerHTML = `<span class="text-xs text-slate-400 italic">Non spécifié</span>`;
                return;
            }
            container.innerHTML = items.map(item =>
                `<span class="text-xs font-semibold px-2.5 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200">${escapeHtml(item)}</span>`
            ).join('');
        }

        function showError(title, message) {
            document.getElementById('loading-state').classList.add('hidden');
            document.getElementById('talent-card').classList.add('hidden');
            document.getElementById('error-title').textContent = title;
            document.getElementById('error-message').textContent = message;
            document.getElementById('error-state').classList.remove('hidden');
        }

        const ERROR_MESSAGES = {
            invalid_token: ["Lien introuvable", "Ce lien de partage n'existe pas ou a été supprimé."],
            revoked: ["Lien révoqué", "Ce lien de partage a été désactivé par son créateur."],
            expired: ["Lien expiré", "Ce lien de partage n'est plus valide (durée de validité dépassée)."],
            talent_not_found: ["Profil introuvable", "Le profil associé à ce lien n'est plus disponible."]
        };

        function renderTalent(payload) {
            const talent = payload.talent;
            const mission = payload.mission;

            document.getElementById('loading-state').classList.add('hidden');
            document.getElementById('talent-card').classList.remove('hidden');

            const fName = talent.first_name || "";
            const lName = talent.last_name || "";
            document.getElementById('talent-fullname').textContent = `${fName} ${lName}`.trim() || "N/A";
            document.getElementById('talent-function').textContent = talent.current_function || "N/A";
            document.getElementById('talent-pool-display').textContent = `Pool : ${talent.pool || '—'}`;

            const statusBadge = document.getElementById('talent-status-badge');
            statusBadge.textContent = talent.status || "N/A";
            if (talent.status === 'En poste ALIMA') {
                statusBadge.classList.add('bg-green-600');
            }

            document.getElementById('info-email').textContent = talent.email || "N/A";
            document.getElementById('info-gender').textContent = talent.gender === "H" ? "Homme" : talent.gender === "F" ? "Femme" : "N/A";
            document.getElementById('info-nationality').textContent = talent.nationality || "N/A";
            document.getElementById('info-residence').textContent = talent.country_of_residence || "N/A";
            document.getElementById('info-visa').textContent = talent.has_visa ? "Valide" : "Non valide / N/A";
            const langs = Array.isArray(talent.languages) ? talent.languages.join(", ") : (talent.languages || "N/A");
            document.getElementById('info-languages').textContent = langs;

            const eduLevels = {
                none: "Néant", bac: "Bac", "bac+1": "Bac+1", "bac+2": "Bac+2",
                "bac+3": "Bac+3 (Licence)", "bac+4": "Bac+4", "bac+5": "Bac+5 (Master)",
                "bac+6": "Bac+6", "bac+7": "Bac+7", "bac+8+": "Bac+8+ (Doctorat)"
            };
            document.getElementById('info-edu-level').textContent = eduLevels[talent.education_level] || "N/A";
            document.getElementById('info-edu-specialty').textContent = talent.education_specialty || "N/A";
            document.getElementById('info-integration-date').textContent = talent.pool_integration_date
                ? new Date(talent.pool_integration_date).toLocaleDateString('fr-FR') : "N/A";

            const expHum = talent.experience_months_humanitarian || 0;
            document.getElementById('info-exp-humanitarian').textContent = `${Math.floor(expHum / 12)}a ${expHum % 12}m`;

            const expAlima = talent.experience_months_alima || 0;
            document.getElementById('info-exp-alima').textContent = `${Math.floor(expAlima / 12)}a ${expAlima % 12}m`;

            const missionCountLabels = { none: "0 mission", one: "1 mission", two: "2 missions", three_plus: "3 missions et +" };
            document.getElementById('info-alima-missions').textContent = missionCountLabels[talent.number_of_alima_missions] || "0";

            renderBadges('skills-badges-container', talent.key_skills);
            renderBadges('contexts-badges-container', talent.intervention_contexts);
            renderBadges('zones-badges-container', talent.intervention_zones);

            // Timeline (parcours de missions) — informations professionnelles
            // uniquement, jamais les commentaires/évaluations internes.
            const timeline = document.getElementById('timeline-container');
            timeline.innerHTML = "";
            let hasTimelineElements = false;

            if (mission) {
                hasTimelineElements = true;
                const startStr = mission.contract_start_date
                    ? new Date(mission.contract_start_date).toLocaleDateString('fr-FR')
                    : "En cours";
                timeline.innerHTML += `
                    <div class="relative pl-6 border-l-2 border-green-500">
                        <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow"></div>
                        <div class="space-y-1">
                            <span class="inline-block text-[10px] uppercase font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">En cours</span>
                            <h4 class="font-bold text-slate-900">${escapeHtml(mission.title)}</h4>
                            <p class="text-xs text-slate-500">${escapeHtml(mission.country)} • Prise de poste le ${startStr}</p>
                        </div>
                    </div>
                `;
            }

            let passages = [];
            try {
                const rawPassages = talent.archived_position_passages;
                if (Array.isArray(rawPassages)) {
                    passages = rawPassages;
                } else if (typeof rawPassages === 'string' && rawPassages.trim()) {
                    passages = JSON.parse(rawPassages);
                }
            } catch (e) {
                console.error("Erreur de parsing des passages :", e);
            }

            if (passages.length > 0) {
                hasTimelineElements = true;
                const dateMs = (d) => { const t = d ? new Date(d).getTime() : NaN; return isNaN(t) ? null : t; };
                const sortedPassages = [...passages].sort((a, b) => (dateMs(b.startDate) || 0) - (dateMs(a.startDate) || 0));
                sortedPassages.forEach(p => {
                    const startMs = dateMs(p.startDate);
                    const endMs = dateMs(p.endDate);
                    const durationMonths = (startMs !== null && endMs !== null)
                        ? Math.round((endMs - startMs) / (1000 * 60 * 60 * 24 * 30)) : null;
                    const startStr = startMs !== null ? new Date(startMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?';
                    const endStr = endMs !== null ? new Date(endMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?';

                    timeline.innerHTML += `
                        <div class="relative pl-6 border-l-2 border-slate-200">
                            <div class="absolute -left-[6px] top-1 w-3 h-3 rounded-full bg-slate-300 border-2 border-white shadow"></div>
                            <div class="space-y-1">
                                <span class="text-xs font-semibold text-slate-400">${startStr} – ${endStr}${durationMonths !== null ? ` (${durationMonths} m)` : ''}</span>
                                <h4 class="font-bold text-slate-800">${escapeHtml(p.positionTitle)}</h4>
                                <p class="text-xs text-slate-500">${escapeHtml(p.country || "Mission ALIMA")}</p>
                            </div>
                        </div>
                    `;
                });
            }

            if (!hasTimelineElements) {
                timeline.innerHTML = `<p class="text-sm text-slate-400 italic">Aucun parcours de mission ALIMA archivé.</p>`;
            }
        }

        async function loadSharedTalent() {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');

            if (!token) {
                showError("Lien invalide", "Aucun jeton de partage fourni dans ce lien.");
                return;
            }

            try {
                const { data, error } = await supabaseClient.rpc('get_shared_talent', { p_token: token });
                if (error) throw error;

                if (data && data.error) {
                    const [title, message] = ERROR_MESSAGES[data.error] || ["Lien indisponible", "Ce lien de partage n'est plus valide."];
                    showError(title, message);
                    return;
                }

                renderTalent(data);
            } catch (err) {
                console.error(err);
                showError("Erreur", "Impossible de charger ce profil pour le moment. Réessayez plus tard.");
            }
        }

        window.addEventListener('DOMContentLoaded', loadSharedTalent);
