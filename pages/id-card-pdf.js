// Correctif P26 (B13-Q2, Master Context §7) — 3/4 : génération de la fiche
// PDF (jsPDF). Fichier déjà largement autonome avant la scission (talent et
// poste reçus en paramètres de exportTalentCardPDF(), pas via l'état de
// page) — seuls passageDateMs()/normalizePassageComment() (id-card.js)
// passent désormais par IdCardPage. Voir id-card.js pour l'explication.
(() => {
        // ============================================================================
        // GÉNÉRATION PDF — FICHE D'IDENTITÉ TALENT
        // Retranscription HTML/JS natif de la logique originale Hercules
        // (pdf-talent-card.ts, cf. Mon_code_hercules.txt), adaptée aux colonnes
        // Supabase réelles (snake_case). jsPDF + jspdf-autotable via CDN (UMD).
        // Aucune donnée "availability" / "project_status" : ces champs ne sont
        // pas dans notre schéma/formulaire validés (voir Master Context §0/§3).
        // ============================================================================
        const PDF_ALIMA_BLUE = [29, 78, 216]; // #1d4ed8 — primary Cap Huma

        function pdfFormatExpAlima(months) {
            const m = Number(months) || 0;
            const y = Math.floor(m / 12);
            const rem = m % 12;
            return `${y} an${y !== 1 ? "s" : ""} ${rem} mois`;
        }

        function pdfFormatMissions(count) {
            const map = { three_plus: "3+", two: "2", one: "1", none: "0" };
            return (count && map[count]) || "0";
        }

        function pdfFormatLanguages(languages) {
            if (Array.isArray(languages)) return languages.join(", ") || "N/A";
            if (typeof languages === 'string' && languages.trim()) return languages;
            return "N/A";
        }

        function pdfDrawHeader(doc, talent, fName, lName, fFunction) {
            const pageW = doc.internal.pageSize.getWidth();
            doc.setFillColor(...PDF_ALIMA_BLUE);
            doc.rect(0, 0, pageW, 42, "F");

            doc.setFontSize(8);
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "normal");
            doc.text("ALIMA TalentHub", 14, 10);

            doc.setFontSize(20);
            doc.setFont("helvetica", "bold");
            doc.text(`${fName} ${lName}`.trim() || "N/A", 14, 20);

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text(fFunction, 14, 27);

            doc.setFontSize(9);
            doc.text(`Pool : ${talent.pool || "—"}`, 14, 33);

            doc.setTextColor(30, 30, 30);
            return 50;
        }

        function pdfDrawSectionTitle(doc, title, y) {
            const pageW = doc.internal.pageSize.getWidth();
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(30, 30, 30);
            doc.text(title, 14, y);

            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.3);
            doc.line(14, y + 2, pageW - 14, y + 2);

            return y + 8;
        }

        function pdfDrawField(doc, label, value, x, y, maxWidth = 80) {
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100, 100, 100);
            doc.text(label, x, y);

            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(30, 30, 30);

            const lines = doc.splitTextToSize(String(value ?? "N/A"), maxWidth);
            doc.text(lines, x, y + 5);

            return y + 5 + lines.length * 5;
        }

        function pdfEnsureSpace(doc, y, needed) {
            const pageH = doc.internal.pageSize.getHeight();
            if (y + needed > pageH - 20) {
                doc.addPage();
                return 20;
            }
            return y;
        }

        // Dessine une rangée de badges (retour à la ligne automatique)
        function pdfDrawBadgeRow(doc, items, y, pageW, fill, stroke, textColor, fontSize) {
            let bx = 14;
            const bPaddingX = 3;
            const bHeight = fontSize + 2;
            const bMargin = 2;

            doc.setFontSize(fontSize);
            doc.setFont("helvetica", "normal");

            items.forEach(label => {
                const tw = doc.getTextWidth(String(label)) + bPaddingX * 2;
                if (bx + tw > pageW - 14) {
                    bx = 14;
                    y += bHeight + bMargin + 1;
                }
                doc.setFillColor(...fill);
                doc.setDrawColor(...stroke);
                doc.setLineWidth(0.2);
                doc.roundedRect(bx, y - 4, tw, bHeight, 1.5, 1.5, "FD");
                doc.setTextColor(...textColor);
                doc.text(String(label), bx + bPaddingX, y);
                bx += tw + bMargin;
            });

            return y + bHeight + 4;
        }

        /**
         * Génère et télécharge le PDF de la carte d'identité talent.
         * @param {object} talent - Ligne Supabase brute de la table `talents`.
         * @param {object|null} currentPosition - Mission active (table `missions`), si présente.
         */
        // ============================================================================
        // Correctif P27 (B13-Q3, Master Context §7) — exportTalentCardPDF() décomposée
        // en une fonction par section de contenu, sur le modèle des helpers pdfDraw*
        // déjà en place (pdfDrawHeader, pdfDrawField, pdfDrawSectionTitle,
        // pdfDrawBadgeRow). Chaque section reçoit `y` en paramètre et renvoie le `y`
        // mis à jour, exactement comme ces helpers — composées séquentiellement dans
        // exportTalentCardPDF() qui devient un simple orchestrateur. Comportement
        // strictement inchangé : même contenu, même mise en page, mêmes calculs.
        // ============================================================================

        // ── Section 1 : Informations Générales ───────────────────────────────
        function pdfDrawGeneralInfoSection(doc, y, talent, COL_LEFT, COL_MID) {
            y = pdfDrawSectionTitle(doc, "Informations Générales", y);
            const l1 = pdfDrawField(doc, "Email", talent.email || "N/A", COL_LEFT, y, 85);
            const m1 = pdfDrawField(doc, "Statut", talent.status || "N/A", COL_MID, y, 80);
            y = Math.max(l1, m1) + 3;

            const genderLabel = talent.gender === "H" ? "Homme" : talent.gender === "F" ? "Femme" : "N/A";
            const l2 = pdfDrawField(doc, "Genre", genderLabel, COL_LEFT, y, 85);
            const m2 = pdfDrawField(doc, "Pool", talent.pool || "N/A", COL_MID, y, 80);
            y = Math.max(l2, m2) + 6;

            return y;
        }

        // ── Section 2 : Expérience ────────────────────────────────────────────
        function pdfDrawExperienceSection(doc, y, COL_LEFT, COL_MID, expAlima, expHum, nbMissions, intDate) {
            y = pdfEnsureSpace(doc, y, 30);
            y = pdfDrawSectionTitle(doc, "Expérience", y);
            const l3 = pdfDrawField(doc, "Expérience ALIMA", pdfFormatExpAlima(expAlima), COL_LEFT, y, 85);
            const m3 = pdfDrawField(doc, "Expérience Humanitaire", pdfFormatExpAlima(expHum), COL_MID, y, 80);
            y = Math.max(l3, m3) + 3;

            const l4 = pdfDrawField(doc, "Missions ALIMA", MISSION_COUNT_LABELS[nbMissions] || pdfFormatMissions(nbMissions), COL_LEFT, y, 85);
            const m4 = pdfDrawField(doc, "Date d'intégration pool", intDate ? new Date(intDate).toLocaleDateString('fr-FR') : "N/A", COL_MID, y, 80);
            y = Math.max(l4, m4) + 6;

            return y;
        }

        // ── Section 3 : Formation & Compétences ──────────────────────────────
        function pdfDrawEducationSection(doc, y, pageW, COL_LEFT, COL_MID, eduLvl, eduSpec, keySkills) {
            y = pdfEnsureSpace(doc, y, 30);
            y = pdfDrawSectionTitle(doc, "Formation & Compétences", y);
            const l5 = pdfDrawField(doc, "Niveau d'études", EDU_LEVEL_LABELS[eduLvl] || "N/A", COL_LEFT, y, 85);
            const m5 = pdfDrawField(doc, "Spécialité", eduSpec, COL_MID, y, 80);
            y = Math.max(l5, m5) + 6;

            if (keySkills.length > 0) {
                y = pdfEnsureSpace(doc, y, 20);
                y = pdfDrawSectionTitle(doc, "Compétences clés", y);
                y = pdfDrawBadgeRow(doc, keySkills, y, pageW, [219, 234, 254], [147, 197, 253], [30, 64, 175], 9);
            }

            return y;
        }

        // ── Section 4 : Géographie & Langues ─────────────────────────────────
        function pdfDrawGeoLanguagesSection(doc, y, pageW, COL_LEFT, COL_MID, talent, cRes) {
            y = pdfEnsureSpace(doc, y, 30);
            y = pdfDrawSectionTitle(doc, "Géographie & Langues", y);
            const l7 = pdfDrawField(doc, "Nationalité", talent.nationality || "N/A", COL_LEFT, y, 85);
            const m7 = pdfDrawField(doc, "Pays de résidence", cRes, COL_MID, y, 80);
            y = Math.max(l7, m7) + 3;

            const l8 = pdfDrawField(doc, "Langues", pdfFormatLanguages(talent.languages), COL_LEFT, y, pageW - 28);
            y = l8 + 6;

            return y;
        }

        // ── Section 5 : Contextes & Zones d'intervention ─────────────────────
        function pdfDrawInterventionSection(doc, y, pageW, contexts, zones) {
            if (contexts.length > 0 || zones.length > 0) {
                y = pdfEnsureSpace(doc, y, 30);
                y = pdfDrawSectionTitle(doc, "Contextes & Zones d'intervention", y);

                if (contexts.length > 0) {
                    y = pdfEnsureSpace(doc, y, 20);
                    doc.setFontSize(8);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(60, 60, 60);
                    doc.text("Types de contextes vécus :", 14, y);
                    y += 5;
                    y = pdfDrawBadgeRow(doc, contexts, y, pageW, [219, 234, 254], [147, 197, 253], [30, 64, 175], 8);
                }

                if (zones.length > 0) {
                    y = pdfEnsureSpace(doc, y, 20);
                    doc.setFontSize(8);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(60, 60, 60);
                    doc.text("Zones géographiques :", 14, y);
                    y += 5;
                    y = pdfDrawBadgeRow(doc, zones, y, pageW, [220, 252, 231], [134, 239, 172], [21, 128, 61], 7.5);
                }
                y += 2;
            }

            return y;
        }

        // ── Section 6 : Parcours de missions ALIMA ───────────────────────────
        function pdfDrawMissionHistorySection(doc, y, pageW, talent, currentPosition) {
            let passages = [];
            try {
                const rawPassages = talent.archived_position_passages || talent.archivedPositionPassages;
                if (Array.isArray(rawPassages)) {
                    passages = rawPassages;
                } else if (typeof rawPassages === 'string' && rawPassages.trim()) {
                    passages = JSON.parse(rawPassages);
                }
            } catch (e) {
                console.error("Erreur de parsing des passages (PDF) :", e);
            }

            if (currentPosition || passages.length > 0) {
                y = pdfEnsureSpace(doc, y, 20);
                y = pdfDrawSectionTitle(doc, "Parcours de missions ALIMA", y);

                if (currentPosition) {
                    y = pdfEnsureSpace(doc, y, 20);
                    doc.setFillColor(240, 253, 244);
                    doc.setDrawColor(134, 239, 172);
                    doc.roundedRect(14, y - 2, pageW - 28, 18, 2, 2, "FD");

                    doc.setFontSize(8);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(21, 128, 61);
                    doc.text("● EN COURS", 18, y + 4);

                    doc.setFontSize(9);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(30, 30, 30);
                    doc.text(currentPosition.title || "Mission ALIMA", 46, y + 4);

                    doc.setFontSize(8);
                    doc.setFont("helvetica", "normal");
                    doc.setTextColor(80, 80, 80);
                    const details = [];
                    if (currentPosition.pool_id || currentPosition.pool) details.push(currentPosition.pool_id || currentPosition.pool);
                    if (currentPosition.country) details.push(currentPosition.country);
                    const startD = currentPosition.contract_start_date || currentPosition.contractStartDate;
                    if (startD) details.push(`Depuis ${new Date(startD).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`);
                    doc.text(details.join("  |  "), 18, y + 11);

                    y += 24;
                }

                const sortedPassages = [...passages].sort((a, b) => (IdCardPage.passageDateMs(b.startDate) || 0) - (IdCardPage.passageDateMs(a.startDate) || 0));

                sortedPassages.forEach(passage => {
                    const comments = (passage.comments || []).map(IdCardPage.normalizePassageComment);
                    let neededH = 28;
                    comments.forEach(c => {
                        if (c.context) neededH += 12;
                        if (c.positivePoints) neededH += 12;
                        if (c.negativePoints) neededH += 12;
                        if (c.legacyContent) neededH += 10;
                        neededH += 6; // ligne "Évaluation par ..." de chaque commentaire
                    });
                    y = pdfEnsureSpace(doc, y, neededH);

                    doc.setFillColor(248, 250, 252);
                    doc.setDrawColor(210, 210, 220);
                    doc.setLineWidth(0.3);
                    doc.roundedRect(14, y - 2, pageW - 28, neededH, 2, 2, "FD");

                    doc.setFontSize(10);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(30, 30, 30);
                    doc.text(passage.positionTitle || "Mission ALIMA", 18, y + 5);

                    doc.setFontSize(8);
                    doc.setFont("helvetica", "normal");
                    doc.setTextColor(100, 100, 100);
                    const startMs = IdCardPage.passageDateMs(passage.startDate);
                    const endMs = IdCardPage.passageDateMs(passage.endDate);
                    const dateStr = `${startMs !== null ? new Date(startMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?'} → ${endMs !== null ? new Date(endMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?'}`;
                    const durationMonths = (startMs !== null && endMs !== null) ? Math.round((endMs - startMs) / (1000 * 60 * 60 * 24 * 30)) : null;
                    const metaLine = [passage.country || "", dateStr, durationMonths !== null ? `(${durationMonths} mois)` : ''].filter(Boolean).join("  |  ");
                    doc.text(metaLine, 18, y + 11);

                    const firstRating = comments[0] ? comments[0].rating : null;
                    if (firstRating !== null) {
                        doc.setFontSize(10);
                        doc.setFont("helvetica", "bold");
                        doc.setTextColor(...PDF_ALIMA_BLUE);
                        doc.text(`★ ${firstRating}/10`, pageW - 18, y + 5, { align: "right" });
                    }

                    let cy = y + 17;
                    comments.forEach(comment => {
                        if (comment.context) {
                            cy = pdfEnsureSpace(doc, cy, 10);
                            doc.setFontSize(7.5);
                            doc.setFont("helvetica", "bold");
                            doc.setTextColor(60, 60, 60);
                            doc.text("Contexte :", 18, cy);
                            doc.setFont("helvetica", "normal");
                            const lines = doc.splitTextToSize(comment.context, pageW - 40);
                            doc.text(lines, 18, cy + 4);
                            cy += 4 + lines.length * 4;
                        }
                        if (comment.positivePoints) {
                            cy = pdfEnsureSpace(doc, cy, 10);
                            doc.setFontSize(7.5);
                            doc.setFont("helvetica", "bold");
                            doc.setTextColor(21, 128, 61);
                            doc.text("Points forts :", 18, cy);
                            doc.setFont("helvetica", "normal");
                            doc.setTextColor(30, 80, 30);
                            const lines = doc.splitTextToSize(comment.positivePoints, pageW - 40);
                            doc.text(lines, 18, cy + 4);
                            cy += 4 + lines.length * 4;
                        }
                        if (comment.negativePoints) {
                            cy = pdfEnsureSpace(doc, cy, 10);
                            doc.setFontSize(7.5);
                            doc.setFont("helvetica", "bold");
                            doc.setTextColor(194, 65, 12);
                            doc.text("Axes d'amélioration :", 18, cy);
                            doc.setFont("helvetica", "normal");
                            doc.setTextColor(80, 30, 10);
                            const lines = doc.splitTextToSize(comment.negativePoints, pageW - 40);
                            doc.text(lines, 18, cy + 4);
                            cy += 4 + lines.length * 4;
                        }
                        if (comment.legacyContent) {
                            cy = pdfEnsureSpace(doc, cy, 10);
                            doc.setFontSize(8);
                            doc.setFont("helvetica", "normal");
                            doc.setTextColor(80, 80, 80);
                            const lines = doc.splitTextToSize(comment.legacyContent, pageW - 40);
                            doc.text(lines, 18, cy);
                            cy += lines.length * 4;
                        }

                        doc.setFontSize(7);
                        doc.setFont("helvetica", "italic");
                        doc.setTextColor(130, 130, 130);
                        doc.text(
                            `Évaluation par ${comment.authorLabel || "N/A"}`,
                            pageW - 18, cy + 3, { align: "right" }
                        );
                        cy += 6;
                    });

                    y = cy + 8;
                });
            }

            return y;
        }

        // ── Tableau récapitulatif ─────────────────────────────────────────────
        function pdfDrawRecapTable(doc, y, expAlima, expHum, nbMissions, eduLvl, keySkills, contexts, zones) {
            y = pdfEnsureSpace(doc, y, 40);
            y = pdfDrawSectionTitle(doc, "Récapitulatif Expérience", y);

            const recapBody = [
                ["Expérience ALIMA", pdfFormatExpAlima(expAlima)],
                ["Expérience humanitaire", pdfFormatExpAlima(expHum)],
                ["Nombre de missions ALIMA", MISSION_COUNT_LABELS[nbMissions] || pdfFormatMissions(nbMissions)],
                ["Niveau d'études", EDU_LEVEL_LABELS[eduLvl] || "N/A"],
            ];
            if (keySkills.length > 0) recapBody.push(["Compétences clés", keySkills.join(", ")]);
            if (contexts.length > 0) recapBody.push(["Contextes d'intervention", contexts.join(", ")]);
            if (zones.length > 0) recapBody.push(["Zones géographiques", zones.join(", ")]);

            doc.autoTable({
                startY: y,
                head: [["Critère", "Valeur"]],
                body: recapBody,
                theme: "striped",
                headStyles: { fillColor: PDF_ALIMA_BLUE, textColor: 255, fontStyle: "bold", fontSize: 9 },
                bodyStyles: { fontSize: 9 },
                columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 90 } },
                margin: { left: 14, right: 14 }
            });

            y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y + 40) + 8;

            return y;
        }

        // ── Pied de page ───────────────────────────────────────────────────
        function pdfDrawFooter(doc, y, pageW) {
            y = pdfEnsureSpace(doc, y, 20);
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.3);
            doc.line(14, y, pageW - 14, y);
            y += 5;

            doc.setFontSize(8);
            doc.setFont("helvetica", "italic");
            doc.setTextColor(130, 130, 130);
            const generatedDate = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
            doc.text(`Carte générée le ${generatedDate} — ALIMA TalentHub`, pageW / 2, y, { align: "center" });

            const totalPages = doc.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(7);
                doc.setFont("helvetica", "normal");
                doc.setTextColor(150, 150, 150);
                doc.text(`Page ${i}/${totalPages}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" });
            }

            return y;
        }

        function exportTalentCardPDF(talent, currentPosition) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
            const pageW = doc.internal.pageSize.getWidth();
            const COL_LEFT = 14;
            const COL_MID = pageW / 2 + 4;

            // Lecture robuste snake_case / camelCase, cohérente avec IdCardPage.renderTalentCard()
            const fName = talent.first_name || talent.firstName || "";
            const lName = talent.last_name || talent.lastName || "";
            const fFunction = talent.current_function || talent.currentFunction || "N/A";
            const expAlima = talent.experience_months_alima || talent.experienceMonthsAlima || 0;
            const expHum = talent.experience_months_humanitarian || talent.experienceMonthsHumanitarian || 0;
            const eduLvl = talent.education_level || talent.educationLevel || "none";
            const eduSpec = talent.education_specialty || talent.educationSpecialty || "N/A";
            const intDate = talent.pool_integration_date || talent.poolIntegrationDate;
            const nbMissions = talent.number_of_alima_missions || talent.numberOfAlimaMissions || "none";
            const cRes = talent.country_of_residence || talent.countryOfResidence || "N/A";
            const keySkills = talent.key_skills || talent.keySkills || [];
            const contexts = talent.intervention_contexts || talent.interventionContexts || [];
            const zones = talent.intervention_zones || talent.interventionZones || [];

            // Correctif P11 (B13-Q4, 28/08/2026) : EDU_LEVEL_LABELS/
            // MISSION_COUNT_LABELS viennent désormais de shared/caphuma-utils.js
            // — voir IdCardPage.renderTalentCard() plus haut pour le même correctif.

            let y = pdfDrawHeader(doc, talent, fName, lName, fFunction);

            y = pdfDrawGeneralInfoSection(doc, y, talent, COL_LEFT, COL_MID);
            y = pdfDrawExperienceSection(doc, y, COL_LEFT, COL_MID, expAlima, expHum, nbMissions, intDate);
            y = pdfDrawEducationSection(doc, y, pageW, COL_LEFT, COL_MID, eduLvl, eduSpec, keySkills);
            y = pdfDrawGeoLanguagesSection(doc, y, pageW, COL_LEFT, COL_MID, talent, cRes);
            y = pdfDrawInterventionSection(doc, y, pageW, contexts, zones);
            y = pdfDrawMissionHistorySection(doc, y, pageW, talent, currentPosition);
            y = pdfDrawRecapTable(doc, y, expAlima, expHum, nbMissions, eduLvl, keySkills, contexts, zones);
            y = pdfDrawFooter(doc, y, pageW);

            const safeFirst = (fName || "talent").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const safeLast = (lName || "").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const fileName = `talent-${safeFirst}${safeLast ? '-' + safeLast : ''}.pdf`;
            doc.save(fileName);
        }


        // Exposé sur IdCardPage pour appel depuis un autre fichier de la page
        IdCardPage.exportTalentCardPDF = exportTalentCardPDF;
})();
