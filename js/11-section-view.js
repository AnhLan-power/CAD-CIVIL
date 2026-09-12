        /* =========================================================================================
         * TRẮC NGANG (Section View, kiểu Civil3D "Sample Line + Section View", rút gọn): tại mỗi cọc
         * dọc Alignment, cắt 1 mặt cắt vuông góc gồm EG (nội suy từ Surface tại nhiều offset 2 bên
         * tim) và Template thiết kế (từ Assembly hiện tại, đặt tại đúng cao độ tim tuyến FG/EG của
         * cọc đó). Mỗi mặt cắt được vẽ thành 1 "tờ" nhỏ kèm bảng Cao độ/Khoảng cách lẻ (tự nhiên +
         * thiết kế), nhiều tờ xếp thành lưới tại vị trí người dùng chọn — giống 1 "Section View
         * Group" thật. (Khối lượng đào/đắp/kết cấu áo đường sẽ làm ở giai đoạn sau.)
         * =========================================================================================
         */

        // Nội suy tuyến tính theo "offset" (thay vì "station" như interpolateAlongProfilePath)
        function interpolateByOffset(points, offset) {
            if (!points || points.length === 0) return null;
            if (offset <= points[0].offset) return points[0].elev;
            for (let i = 0; i < points.length - 1; i++) {
                if (offset >= points[i].offset && offset <= points[i + 1].offset) {
                    const span = points[i + 1].offset - points[i].offset;
                    const t = span > 1e-9 ? (offset - points[i].offset) / span : 0;
                    return points[i].elev + (points[i + 1].elev - points[i].elev) * t;
                }
            }
            return points[points.length - 1].elev;
        }

        // Dữ liệu 1 mặt cắt ngang tại 1 cọc: mẫu EG ở nhiều offset (gồm cả các mốc gãy của Template)
        // + biên ngoài halfWidth, và Template thiết kế đặt đúng cao độ tim tuyến (FG/EG) tại cọc đó.
        // Dò điểm chân taluy (daylight point): từ mép Template, kẻ 1 đường thẳng dốc theo hệ số
        // taluyRatio (1:m) ra phía ngoài — đắp thì đi xuống, đào thì đi lên — cho tới khi cắt đúng
        // đường EG (nội suy tuyến tính từng đoạn mẫu). sideSign: -1 = bên trái, +1 = bên phải.
        function findDaylightPoint(edgeOffset, edgeElev, egSamples, taluyRatio, sideSign) {
            const egAtEdge = interpolateByOffset(egSamples, edgeOffset);
            if (egAtEdge === null || taluyRatio <= 0) return { offset: edgeOffset, elev: edgeElev };
            const isFill = edgeElev >= egAtEdge;
            const dirSign = isFill ? -1 : 1; // đắp: taluy hạ dần ra ngoài; đào: taluy nâng dần ra ngoài
            const samples = egSamples
                .filter(p => sideSign > 0 ? p.offset >= edgeOffset : p.offset <= edgeOffset)
                .sort((a, b) => sideSign > 0 ? a.offset - b.offset : b.offset - a.offset);
            let prevOffset = edgeOffset, prevTaluyElev = edgeElev, prevDiff = edgeElev - egAtEdge;
            for (let i = 0; i < samples.length; i++) {
                const o = samples[i].offset;
                if (Math.abs(o - prevOffset) < 1e-9) continue;
                const dist = Math.abs(o - edgeOffset);
                const taluyElev = edgeElev + dirSign * dist / taluyRatio;
                const diff = taluyElev - samples[i].elev;
                if ((prevDiff >= 0 && diff <= 0) || (prevDiff <= 0 && diff >= 0)) {
                    const t = Math.abs(prevDiff) / (Math.abs(prevDiff) + Math.abs(diff) || 1);
                    return { offset: prevOffset + (o - prevOffset) * t, elev: prevTaluyElev + (taluyElev - prevTaluyElev) * t };
                }
                prevOffset = o; prevTaluyElev = taluyElev; prevDiff = diff;
            }
            // Không cắt được trong phạm vi đã lấy mẫu -> dừng tại mép ngoài cùng đã lấy mẫu
            return { offset: prevOffset, elev: prevTaluyElev };
        }

        function computeSectionAtStation(st, assembly, baseline, halfWidth, taluyRatio) {
            const centerElevReal = interpolateAlongProfilePath(baseline, st.station);
            const centerElev = centerElevReal !== null ? centerElevReal : 0;
            const perp = new THREE.Vector3(-st.dir.y, st.dir.x, 0);
            const asmOffsets = computeCrossSectionOffsets(assembly);
            const maxAsmOffset = Math.max(...asmOffsets.map(p => Math.abs(p.offset)), 1);
            const outerHalf = Math.max(halfWidth, maxAsmOffset + 2);
            // Lấy mẫu EG dày hơn ở vùng ngoài mép Template (để dò giao điểm taluy chính xác), không
            // chỉ 1 điểm biên ngoài cùng như trước.
            const sampleStep = Math.max((outerHalf - maxAsmOffset) / 10, 0.5);
            const extraOffsets = [];
            for (let o = maxAsmOffset + sampleStep; o < outerHalf; o += sampleStep) { extraOffsets.push(o); extraOffsets.push(-o); }
            const egOffsets = Array.from(new Set([-outerHalf, ...asmOffsets.map(p => p.offset), ...extraOffsets, outerHalf])).sort((a, b) => a - b);
            const egSamples = egOffsets.map(o => {
                const wp = st.pos.clone().addScaledVector(perp, o);
                const elev = sampleSurfaceElevationAt(wp.x, wp.y);
                return { offset: o, elev: elev !== null ? elev : centerElev };
            });
            const templatePts = asmOffsets.map(p => ({ offset: p.offset, elev: centerElev + p.elevDelta, type: p.type, color: p.color }));

            // Bộ mẫu EG THƯA dùng riêng cho BẢNG SỐ LIỆU (Cao độ/Khoảng cách lẻ tự nhiên) — chỉ gồm 2
            // điểm biên ngoài + các mốc gãy của Template, KHÔNG dùng bộ mẫu dày ở trên (vốn chỉ để dò
            // taluy cho chính xác) — nếu không bảng sẽ có quá nhiều cột sát nhau, chữ đè lên nhau.
            const sparseOffsets = Array.from(new Set([-outerHalf, ...asmOffsets.map(p => p.offset), outerHalf])).sort((a, b) => a - b);
            const egSamplesSparse = sparseOffsets.map(o => ({ offset: o, elev: interpolateByOffset(egSamples, o) }));

            // Điểm chân taluy 2 bên + đường thiết kế đầy đủ (taluy trái + Template + taluy phải) —
            // dùng để vẽ hình VÀ tính khối lượng Đào/Đắp cho đúng (thay vì dừng ở mép Template).
            const ratio = taluyRatio > 0 ? taluyRatio : 1.5;
            const leftEdge = templatePts[0], rightEdge = templatePts[templatePts.length - 1];
            const daylightLeft = findDaylightPoint(leftEdge.offset, leftEdge.elev, egSamples, ratio, -1);
            const daylightRight = findDaylightPoint(rightEdge.offset, rightEdge.elev, egSamples, ratio, 1);
            const fullTemplate = [{ ...daylightLeft, type: 'taluy' }, ...templatePts, { ...daylightRight, type: 'taluy' }];

            return { station: st.station, centerElev, egSamples, egSamplesSparse, templatePts, daylightLeft, daylightRight, fullTemplate, taluyRatio: ratio };
        }

        // Bóc khối lượng tại 1 mặt cắt: diện tích Đào/Đắp (giữa toàn bộ đường thiết kế — gồm cả 2
        // bên taluy — và EG, phương pháp hình thang từng đoạn offset) + diện tích/chiều dài từng lớp
        // kết cấu áo đường. "Đắp nền" = diện tích đắp trừ đi phần đã quy vào kết cấu áo đường.
        function computeStationQuantities(data, layers, typeRanges) {
            const allOffsets = Array.from(new Set([
                ...data.fullTemplate.map(p => p.offset),
                ...data.egSamples.filter(p => p.offset >= data.fullTemplate[0].offset && p.offset <= data.fullTemplate[data.fullTemplate.length - 1].offset).map(p => p.offset)
            ])).sort((a, b) => a - b);
            let fillArea = 0, cutArea = 0;
            for (let i = 0; i < allOffsets.length - 1; i++) {
                const o1 = allOffsets[i], o2 = allOffsets[i + 1];
                const eg1 = interpolateByOffset(data.egSamples, o1), eg2 = interpolateByOffset(data.egSamples, o2);
                const tp1 = interpolateByOffset(data.fullTemplate, o1), tp2 = interpolateByOffset(data.fullTemplate, o2);
                const d1 = tp1 - eg1, d2 = tp2 - eg2; // >0: đắp (fill), <0: đào (cut)
                const width = o2 - o1;
                if (d1 >= 0 && d2 >= 0) {
                    fillArea += (d1 + d2) / 2 * width;
                } else if (d1 <= 0 && d2 <= 0) {
                    cutArea += (-d1 - d2) / 2 * width;
                } else {
                    const t = d1 / (d1 - d2); // điểm cắt qua 0 (giao EG-Template) trong đoạn
                    const wa = width * t, wb = width - wa;
                    if (d1 > 0) { fillArea += d1 * wa / 2; cutArea += -d2 * wb / 2; }
                    else { cutArea += -d1 * wa / 2; fillArea += d2 * wb / 2; }
                }
            }

            const pavedWidth = data.templatePts[data.templatePts.length - 1].offset - data.templatePts[0].offset;
            // "Toàn bộ bề rộng nền" = từ chân taluy trái đến chân taluy phải (đúng phạm vi thi công
            // thật), KHÔNG phải phạm vi lấy mẫu EG tuỳ ý người dùng chọn.
            const fullWidth = data.fullTemplate[data.fullTemplate.length - 1].offset - data.fullTemplate[0].offset;
            // Bề rộng riêng của TỪNG LOẠI thành phần (làn xe / bó vỉa / vỉa hè...) — để mỗi lớp kết
            // cấu chỉ tính đúng trong phạm vi loại nó khai báo (VD: BTXM chỉ tính theo bề rộng Làn xe,
            // không tính lan sang Vỉa hè).
            const scopeWidth = (scope) => {
                if (scope === 'full') return fullWidth;
                const r = typeRanges && typeRanges[scope];
                return r ? 2 * (r.outerAbs - r.innerAbs) : 0;
            };
            const layerValues = {};
            let pavementStructureArea = 0;
            layers.forEach(layer => {
                const width = scopeWidth(layer.appliesTo);
                if (layer.unit === 'length') {
                    layerValues[layer.code] = { name: layer.name, value: width, unit: 'm' };
                } else {
                    const area = width * layer.thickness;
                    layerValues[layer.code] = { name: layer.name, value: area, unit: 'm2' };
                    if (layer.appliesTo !== 'full') pavementStructureArea += area;
                }
            });
            const embankmentFillArea = Math.max(0, fillArea - pavementStructureArea);
            return { cutArea, fillArea, embankmentFillArea, layerValues, pavedWidth, fullWidth };
        }

        // Tính 1 hệ tỉ lệ (scale) DÙNG CHUNG cho toàn bộ các mặt cắt trong 1 lần chạy, để các tờ
        // trong cùng 1 Section View Group so sánh được với nhau (giống cách Civil3D thật làm).
        function computeSectionSheetScale(sectionDataList, manualExaggeration) {
            let minOffset = Infinity, maxOffset = -Infinity, minElev = Infinity, maxElev = -Infinity;
            sectionDataList.forEach(d => {
                d.egSamples.forEach(p => {
                    minOffset = Math.min(minOffset, p.offset); maxOffset = Math.max(maxOffset, p.offset);
                    minElev = Math.min(minElev, p.elev); maxElev = Math.max(maxElev, p.elev);
                });
                d.templatePts.forEach(p => { minElev = Math.min(minElev, p.elev); maxElev = Math.max(maxElev, p.elev); });
            });
            const elevPad = Math.max((maxElev - minElev) * 0.25, 0.3);
            minElev -= elevPad; maxElev += elevPad;
            const plotWidth = Math.max(maxOffset - minOffset, 1);
            const elevSpan = Math.max(maxElev - minElev, 0.05);
            // Nếu người dùng tự nhập hệ số phóng đại đứng (ô "Phóng đại đứng" khi chạy Trắc ngang) thì
            // dùng đúng số đó — mỗi bản vẽ/mỗi người có thể muốn tỉ lệ khác nhau, tự chỉnh sẽ chính xác
            // hơn là đoán 1 công thức chung cho mọi trường hợp. Nếu để 0/không nhập, tự tính vừa phải.
            const vertExaggeration = (manualExaggeration && manualExaggeration > 0)
                ? manualExaggeration
                : Math.max(1, Math.min(10, (plotWidth * 0.5) / elevSpan));
            return { minOffset, maxOffset, minElev, maxElev, plotWidth, elevSpan, vertExaggeration, plotHeight: elevSpan * vertExaggeration };
        }

        // Dựng hình học 1 tờ mặt cắt ngang (EG + Template + cọc tim + bảng số liệu bên dưới)
        function buildSectionSheetGeometry(data, scale, plotBottomLeft, sheetTitle) {
            const group = new THREE.Group();
            const toWorld = (offset, elev) => new THREE.Vector3(
                plotBottomLeft.x + (offset - scale.minOffset),
                plotBottomLeft.y + (elev - scale.minElev) * scale.vertExaggeration,
                0
            );
            const labelH = Math.max(scale.plotHeight * 0.05, scale.plotWidth * 0.035, 0.12);
            const lineMat = () => new THREE.LineBasicMaterial({ color: currentDrawColor });
            const gridMat = () => new THREE.LineBasicMaterial({ color: 0x333333 });

            // EG (mặt đất tự nhiên) - nâu
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
                data.egSamples.map(p => toWorld(p.offset, p.elev))
            ), new THREE.LineBasicMaterial({ color: 0xd2a679 })));

            // Đường chuẩn ngang qua toàn bộ chiều rộng tại cao độ tim tuyến
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
                toWorld(scale.minOffset, data.centerElev), toWorld(scale.maxOffset, data.centerElev)
            ]), new THREE.LineBasicMaterial({ color: 0x00cc44 })));

            // Template thiết kế (mặt cắt điển hình từ Assembly)
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
                data.templatePts.map(p => toWorld(p.offset, p.elev))
            ), new THREE.LineBasicMaterial({ color: 0xffffff })));

            // Kết cấu: các dải mỏng xếp chồng ngay dưới mặt Template, CHỈ trong đúng phạm vi offset
            // của loại thành phần đã khai báo (VD: BTXM chỉ trải trong Làn xe) — mỗi phạm vi (scope)
            // chồng lớp độc lập với phạm vi khác. Nếu phạm vi không nối liền qua tim (VD vỉa hè), vẽ
            // thành 2 đường RIÊNG (trái/phải), không nối 1 đường bắc ngang qua cả làn đường.
            if (data.qty && data.typeRanges) {
                const cumByScope = {};
                pavementLayers.filter(l => l.appliesTo !== 'full' && l.unit === 'area').forEach(layer => {
                    const scope = layer.appliesTo;
                    const range = data.typeRanges[scope];
                    if (!range) return;
                    const cumThickness = cumByScope[scope] || 0;
                    const color = layer.color !== undefined ? layer.color : 0x888888;
                    const sideSigns = range.innerAbs > 0 ? [-1, 1] : [0];
                    sideSigns.forEach(sideSign => {
                        const scopedPts = filterPointsInScope(data.templatePts, scope, range, sideSign);
                        if (scopedPts.length < 2) return;
                        const pLeft = scopedPts[0].offset, pRight = scopedPts[scopedPts.length - 1].offset;
                        const topPts = scopedPts.map(p => ({ offset: p.offset, elev: p.elev - cumThickness }));
                        const botPts = scopedPts.map(p => ({ offset: p.offset, elev: p.elev - cumThickness - layer.thickness }));
                        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts.map(p => toWorld(p.offset, p.elev))), new THREE.LineBasicMaterial({ color })));
                        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(botPts.map(p => toWorld(p.offset, p.elev))), new THREE.LineBasicMaterial({ color })));
                        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(pLeft, topPts[0].elev), toWorld(pLeft, botPts[0].elev)]), new THREE.LineBasicMaterial({ color })));
                        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(pRight, topPts[topPts.length - 1].elev), toWorld(pRight, botPts[botPts.length - 1].elev)]), new THREE.LineBasicMaterial({ color })));
                    });
                    cumByScope[scope] = cumThickness + layer.thickness;
                });
            }

            // Lớp áp dụng "Toàn bộ bề rộng nền" (VD Bóc hữu cơ): vẽ NGAY DƯỚI đường EG (mặt đất tự
            // nhiên) — khác với các lớp kết cấu áo đường (nằm dưới Template) — vì bóc hữu cơ là lớp
            // đất mặt bóc đi khỏi mặt đất tự nhiên gốc, trải suốt từ chân taluy trái đến chân taluy phải.
            if (data.qty) {
                pavementLayers.filter(l => l.appliesTo === 'full' && l.unit === 'area').forEach(layer => {
                    const leftOff = data.fullTemplate[0].offset, rightOff = data.fullTemplate[data.fullTemplate.length - 1].offset;
                    const egPtsInRange = data.egSamples.filter(p => p.offset >= leftOff - 1e-6 && p.offset <= rightOff + 1e-6);
                    if (egPtsInRange.length < 2) return;
                    const color = layer.color !== undefined ? layer.color : 0x888888;
                    const topPts = egPtsInRange.map(p => ({ offset: p.offset, elev: p.elev }));
                    const botPts = egPtsInRange.map(p => ({ offset: p.offset, elev: p.elev - layer.thickness }));
                    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts.map(p => toWorld(p.offset, p.elev))), new THREE.LineBasicMaterial({ color })));
                    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(botPts.map(p => toWorld(p.offset, p.elev))), new THREE.LineBasicMaterial({ color })));
                    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(leftOff, topPts[0].elev), toWorld(leftOff, botPts[0].elev)]), new THREE.LineBasicMaterial({ color })));
                    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(rightOff, topPts[topPts.length - 1].elev), toWorld(rightOff, botPts[botPts.length - 1].elev)]), new THREE.LineBasicMaterial({ color })));
                });
            }

            // Nhãn % dốc cho từng đoạn (bỏ đoạn ngay tại tim, bỏ các đoạn bậc đứng bề rộng ~0 như mặt
            // bó vỉa (chia cho 0 ra "Infinity%"), và bỏ luôn các đoạn thuộc loại "curb" nói chung —
            // đây là các đoạn tạo hình khối bó vỉa (lên/xuống trong phạm vi rất hẹp), % độ dốc ở đây
            // không có ý nghĩa như dốc ngang mặt đường, hiển thị ra chỉ gây rối mắt (VD: "300%").
            for (let i = 0; i < data.templatePts.length - 1; i++) {
                const a = data.templatePts[i], b = data.templatePts[i + 1];
                const segWidth = b.offset - a.offset;
                if (a.offset === 0 || b.offset === 0 || Math.abs(segWidth) < 0.02) continue;
                if (a.type === 'curb' || b.type === 'curb') continue;
                const slopePct = ((b.elev - a.elev) / segWidth) * 100;
                const midOffset = (a.offset + b.offset) / 2, midElev = Math.max(a.elev, b.elev);
                const labelPos = toWorld(midOffset, midElev).add(new THREE.Vector3(0, labelH * 1.6, 0));
                group.add(createTextSprite(Math.abs(slopePct).toFixed(0) + '%', labelPos, labelH * 0.9));
            }

            // Taluy 2 bên: nối từ mép ngoài Template tới đúng điểm chân taluy đã dò (giao với EG),
            // theo hệ số taluyRatio (1:m) — thay cho vách đứng "1:0" trước đây.
            [
                { edge: data.templatePts[0], daylight: data.daylightLeft },
                { edge: data.templatePts[data.templatePts.length - 1], daylight: data.daylightRight }
            ].forEach(({ edge, daylight }) => {
                if (!daylight || Math.abs(daylight.offset - edge.offset) < 0.05) return; // gần như trùng mép, khỏi vẽ/ghi nhãn
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
                    toWorld(edge.offset, edge.elev), toWorld(daylight.offset, daylight.elev)
                ]), new THREE.LineBasicMaterial({ color: 0x999999 })));
                const midPt = toWorld((edge.offset + daylight.offset) / 2, (edge.elev + daylight.elev) / 2);
                const ratioLabel = '1:' + (data.taluyRatio % 1 === 0 ? data.taluyRatio.toFixed(0) : data.taluyRatio.toFixed(1));
                group.add(createTextSprite(ratioLabel, midPt.clone().add(new THREE.Vector3(0, labelH * 1.2, 0)), labelH * 0.85));
            });

            // Cọc tim tuyến: vạch đứng xanh lá + ký hiệu cờ (2 tam giác chụm đầu, kiểu mốc trắc địa) + nhãn lý trình
            const centerTop = toWorld(0, scale.maxElev).add(new THREE.Vector3(0, labelH * 2, 0));
            const centerBottom = toWorld(0, scale.minElev);
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([centerBottom, centerTop]), new THREE.LineBasicMaterial({ color: 0x00cc44 })));
            const triSize = labelH * 0.7;
            const flagMat = new THREE.LineBasicMaterial({ color: 0x00cc44 });
            // Cánh trái
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                centerTop.clone(),
                centerTop.clone().add(new THREE.Vector3(-triSize * 2, triSize * 0.9, 0)),
                centerTop.clone().add(new THREE.Vector3(-triSize * 2, -triSize * 0.9, 0))
            ]), flagMat));
            // Cánh phải
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                centerTop.clone(),
                centerTop.clone().add(new THREE.Vector3(triSize * 2, triSize * 0.9, 0)),
                centerTop.clone().add(new THREE.Vector3(triSize * 2, -triSize * 0.9, 0))
            ]), flagMat));
            group.add(createTextSprite('Lý trình: ' + formatStation(data.station), centerTop.clone().add(new THREE.Vector3(0, labelH * 2, 0)), labelH * 1.1));
            if (sheetTitle) group.add(createTextSprite(sheetTitle, centerTop.clone().add(new THREE.Vector3(0, labelH * 3.6, 0)), labelH * 1.1));

            // Bảng khối lượng (Đào/Đắp nền + từng lớp kết cấu áo đường) — đặt phía trên bên phải mặt cắt
            if (data.qty) {
                const qtyLines = [];
                if (data.qty.cutArea > 0.001) qtyLines.push(['Đào nền', data.qty.cutArea, 'm2']);
                if (data.qty.embankmentFillArea > 0.001) qtyLines.push(['Đắp nền', data.qty.embankmentFillArea, 'm2']);
                Object.values(data.qty.layerValues).forEach(lv => qtyLines.push([lv.name, lv.value, lv.unit === 'm2' ? 'm2' : 'm']));
                const qtyAnchor = toWorld(scale.maxOffset, scale.maxElev).add(new THREE.Vector3(-labelH * 2, labelH * (2.5 + qtyLines.length * 1.4), 0));
                qtyLines.forEach(([name, val, unit], i) => {
                    const y = qtyAnchor.y - i * labelH * 1.4;
                    group.add(createTextSprite(`${name}: ${val.toFixed(3)} ${unit}`, new THREE.Vector3(qtyAnchor.x, y, 0), labelH * 0.85));
                });
            }

            /* --- Bảng Cao độ/Khoảng cách lẻ (tự nhiên + thiết kế) bên dưới --- */
            const rowLabels = ['Cao độ tự nhiên (m)', 'K.cách lẻ tự nhiên (m)', 'Cao độ thiết kế (m)', 'K.cách lẻ thiết kế (m)'];
            const rowH = labelH * 1.8;
            const labelColWidth = Math.max(scale.plotWidth * 0.35, labelH * 9);
            const tableTop = plotBottomLeft.y - labelH * 1.2;
            const tableBottom = tableTop - rowLabels.length * rowH;
            const tableLeft = plotBottomLeft.x - labelColWidth;
            const tableRight = plotBottomLeft.x + scale.plotWidth;

            for (let r = 0; r <= rowLabels.length; r++) {
                const y = tableTop - r * rowH;
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(tableLeft, y, 0), new THREE.Vector3(tableRight, y, 0)]), gridMat()));
            }
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(plotBottomLeft.x, tableTop, 0), new THREE.Vector3(plotBottomLeft.x, tableBottom, 0)]), lineMat()));
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(tableLeft, tableTop, 0), new THREE.Vector3(tableRight, tableTop, 0),
                new THREE.Vector3(tableRight, tableBottom, 0), new THREE.Vector3(tableLeft, tableBottom, 0)
            ]), lineMat()));
            rowLabels.forEach((label, r) => {
                const y = tableTop - r * rowH - rowH / 2;
                group.add(createTextSprite(label, new THREE.Vector3(tableLeft + labelH * 0.5, y, 0), labelH * 0.8));
            });

            // Cột theo offset TỰ NHIÊN (dùng bộ mẫu EG THƯA, xem giải thích ở computeSectionAtStation)
            let prevOff = null;
            data.egSamplesSparse.forEach((p, i) => {
                const x = plotBottomLeft.x + (p.offset - scale.minOffset);
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, tableTop, 0), new THREE.Vector3(x, tableTop - rowH * 2, 0)]), gridMat()));
                const kc = prevOff !== null ? (p.offset - prevOff) : null;
                prevOff = p.offset;
                group.add(createTextSprite(p.elev.toFixed(2), new THREE.Vector3(x, tableTop - rowH * 0.5, 0), labelH * 0.75));
                if (kc !== null) group.add(createTextSprite(kc.toFixed(2), new THREE.Vector3(x, tableTop - rowH * 1.5, 0), labelH * 0.75));
            });

            // Cột theo offset THIẾT KẾ (dùng các mốc gãy của Template) — 2 hàng cuối bảng. Khử trùng
            // theo offset trước khi vẽ: 1 thành phần có "height" (VD bó vỉa) tạo 2 điểm CÙNG offset
            // (chân bậc đứng + đỉnh bậc) — nếu vẽ cả 2, chữ số sẽ chồng đè lên nhau tại cùng 1 vị trí.
            // Giữ điểm SAU CÙNG tại mỗi offset (đại diện cao độ "chốt" ngay tại điểm gãy đó).
            const templatePtsForTable = [];
            const seenTableOffsets = new Map();
            data.templatePts.forEach(p => seenTableOffsets.set(p.offset.toFixed(6), p));
            Array.from(seenTableOffsets.values()).sort((a, b) => a.offset - b.offset).forEach(p => templatePtsForTable.push(p));

            let prevOffT = null;
            templatePtsForTable.forEach((p, i) => {
                const x = plotBottomLeft.x + (p.offset - scale.minOffset);
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, tableTop - rowH * 2, 0), new THREE.Vector3(x, tableBottom, 0)]), gridMat()));
                const kc = prevOffT !== null ? (p.offset - prevOffT) : null;
                prevOffT = p.offset;
                group.add(createTextSprite(p.elev.toFixed(2), new THREE.Vector3(x, tableTop - rowH * 2.5, 0), labelH * 0.75));
                if (kc !== null) group.add(createTextSprite(kc.toFixed(2), new THREE.Vector3(x, tableTop - rowH * 3.5, 0), labelH * 0.75));
            });

            return group;
        }

        // Tạo cả bộ mặt cắt ngang cho 1 Alignment, xếp thành lưới tại insertionPoint người dùng chọn
        function createSectionViewsEntity(alignmentEntity, assembly, interval, halfWidth, taluyRatio, vertExaggerationOverride, insertionPoint) {
            const info = alignmentEntity.object.userData.alignmentInfo;
            const piPoints = alignmentEntity.object.userData.boundaryPts;
            const { path } = buildAlignmentPath(piPoints, info.radius);
            const { stations } = computeStations(path, interval, 0);
            const { path: baseline, source } = findBaselineProfileForAlignment(alignmentEntity, interval);
            if (baseline.length < 2) return { error: 'Không tìm được dữ liệu cao độ (cần có Surface hoặc Profile FG cho Alignment này).' };
            if (computeCrossSectionOffsets(assembly).length < 2) return { error: 'Assembly chưa có thành phần nào.' };

            const sectionDataList = stations.map(st => computeSectionAtStation(st, assembly, baseline, halfWidth, taluyRatio));
            const typeRanges = computeAssemblyTypeRanges(assembly);
            sectionDataList.forEach(data => { data.qty = computeStationQuantities(data, pavementLayers, typeRanges); data.typeRanges = typeRanges; });
            const scale = computeSectionSheetScale(sectionDataList, vertExaggerationOverride);

            const group = new THREE.Group();
            group.userData.isSectionViews = true;

            const cols = 4;
            const labelColWidth = Math.max(scale.plotWidth * 0.35, Math.max(scale.plotHeight * 0.05, scale.plotWidth * 0.035, 0.12) * 9);
            const rowH = Math.max(scale.plotHeight * 0.05, scale.plotWidth * 0.035, 0.12) * 1.8;
            const gapX = scale.plotWidth * 0.3 + 2;
            const sheetStepX = scale.plotWidth + labelColWidth + gapX;
            const qtyLineCount = 2 + pavementLayers.length; // Đắp nền + Đào + từng lớp kết cấu
            const sheetStepY = scale.plotHeight + rowH * 6 + rowH * (6 + qtyLineCount); // chart + bảng (4 hàng) + tiêu đề/khối lượng/khoảng đệm

            sectionDataList.forEach((data, i) => {
                const col = i % cols, row = Math.floor(i / cols);
                const plotBottomLeft = new THREE.Vector3(
                    insertionPoint.x + labelColWidth + col * sheetStepX,
                    insertionPoint.y - row * sheetStepY,
                    0
                );
                group.add(buildSectionSheetGeometry(data, scale, plotBottomLeft, i === 0 ? ('Trắc ngang — ' + info.name) : null));
            });

            const totalRows = Math.max(Math.ceil(sectionDataList.length / cols), Math.floor(sectionDataList.length / cols) + 1);
            group.userData.boundaryPts = [
                insertionPoint.clone(),
                new THREE.Vector3(insertionPoint.x + cols * sheetStepX, insertionPoint.y, 0),
                new THREE.Vector3(insertionPoint.x, insertionPoint.y - totalRows * sheetStepY, 0)
            ];
            group.userData.sectionInfo = { alignmentName: info.name, count: sectionDataList.length, interval, halfWidth, baselineSource: source };

            // Tổng hợp khối lượng toàn tuyến (phương pháp trung bình 2 mặt cắt liền kề × khoảng cách cọc)
            let totalCutVol = 0, totalFillVol = 0, totalEmbankVol = 0;
            const totalLayerValues = {};
            pavementLayers.forEach(l => { totalLayerValues[l.code] = { name: l.name, unit: l.unit === 'length' ? 'm2' : 'm2', value: 0 }; });
            for (let i = 0; i < sectionDataList.length - 1; i++) {
                const d = interval; // khoảng cách giữa 2 cọc liền kề (đều nhau theo interval đã chọn)
                const q1 = sectionDataList[i].qty, q2 = sectionDataList[i + 1].qty;
                totalCutVol += (q1.cutArea + q2.cutArea) / 2 * d;
                totalFillVol += (q1.fillArea + q2.fillArea) / 2 * d;
                totalEmbankVol += (q1.embankmentFillArea + q2.embankmentFillArea) / 2 * d;
                pavementLayers.forEach(l => {
                    const v1 = q1.layerValues[l.code].value, v2 = q2.layerValues[l.code].value;
                    // Lớp "length" (vd bạt nhựa) x khoảng cách -> ra diện tích tấm trải (m2); lớp "area" x khoảng cách -> ra thể tích (m3)
                    totalLayerValues[l.code].value += (v1 + v2) / 2 * d;
                    totalLayerValues[l.code].unit = l.unit === 'length' ? 'm2' : 'm3';
                });
            }
            group.userData.sectionTotals = { totalCutVol, totalFillVol, totalEmbankVol, totalLayerValues, stationCount: sectionDataList.length };

            // Thêm 1 tờ "Tổng hợp khối lượng toàn tuyến" vào cuối lưới (phương pháp trung bình 2 mặt cắt)
            const totalsLabelH = Math.max(scale.plotHeight * 0.05, scale.plotWidth * 0.035, 0.12);
            const totalsCol = sectionDataList.length % cols, totalsRow = Math.floor(sectionDataList.length / cols);
            const totalsOrigin = new THREE.Vector3(
                insertionPoint.x + labelColWidth + totalsCol * sheetStepX,
                insertionPoint.y - totalsRow * sheetStepY,
                0
            );
            group.add(buildSectionTotalsSheet(group.userData.sectionTotals, info, totalsOrigin, totalsLabelH));

            return { group, count: sectionDataList.length };
        }

        // Dựng 1 "tờ" văn bản tổng hợp khối lượng toàn tuyến (Đào/Đắp nền theo m3, từng lớp kết cấu)
        function buildSectionTotalsSheet(totals, alignmentInfo, origin, labelH) {
            const group = new THREE.Group();
            const lines = [
                `TỔNG HỢP KHỐI LƯỢNG — ${alignmentInfo.name}`,
                `(Phương pháp trung bình 2 mặt cắt liền kề, ${totals.stationCount} mặt cắt)`,
                '',
                `Đào nền: ${totals.totalCutVol.toFixed(2)} m3`,
                `Đắp nền: ${totals.totalEmbankVol.toFixed(2)} m3`,
                ''
            ];
            Object.values(totals.totalLayerValues).forEach(lv => lines.push(`${lv.name}: ${lv.value.toFixed(2)} ${lv.unit}`));
            lines.forEach((line, i) => {
                if (!line) return;
                group.add(createTextSprite(line, new THREE.Vector3(origin.x, origin.y - i * labelH * 1.6, 0), labelH * (i === 0 ? 1.3 : 1.0)));
            });
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(origin.x - labelH, origin.y + labelH, 0),
                new THREE.Vector3(origin.x + labelH * 16, origin.y + labelH, 0),
                new THREE.Vector3(origin.x + labelH * 16, origin.y - lines.length * labelH * 1.6, 0),
                new THREE.Vector3(origin.x - labelH, origin.y - lines.length * labelH * 1.6, 0)
            ]), new THREE.LineBasicMaterial({ color: currentDrawColor })));
            return group;
        }

        let pendingSectionAlignment = null;
        let pendingSectionInterval = 20;
        let pendingSectionHalfWidth = 15;
        let pendingSectionTaluyRatio = 1.5;
        let pendingSectionVertExaggeration = 0; // 0 = tự động tính

        function pickAlignmentForSection(hit) {
            if (currentAssembly.length === 0) {
                setCommandText('Command: Assembly chưa có thành phần nào — mở "Assembly" để thêm trước khi chạy Trắc ngang.');
                setTool('select');
                return;
            }
            pendingSectionAlignment = hit;
            setTool('section-interval');
            openSectionIntervalPopup();
        }

        let defaultSectionVertExaggeration = 1; // mặc định 1 (đúng tỉ lệ thật) — theo phản hồi thực tế nhìn chuẩn nhất

        function openSectionIntervalPopup() {
            document.getElementById('section-interval-popup').style.display = 'flex';
            document.getElementById('section-interval-field').value = '20';
            document.getElementById('section-halfwidth-field').value = '15';
            document.getElementById('section-taluy-field').value = defaultTaluyRatio;
            document.getElementById('section-vertexag-field').value = defaultSectionVertExaggeration || '';
            const field = document.getElementById('section-interval-field');
            field.focus(); field.select();
        }
        function closeSectionIntervalPopup() {
            document.getElementById('section-interval-popup').style.display = 'none';
        }
        function confirmSectionInterval() {
            const interval = parseFloat(document.getElementById('section-interval-field').value);
            const halfWidth = parseFloat(document.getElementById('section-halfwidth-field').value);
            const taluyRatio = parseFloat(document.getElementById('section-taluy-field').value);
            const vertExagRaw = document.getElementById('section-vertexag-field').value.trim();
            const vertExag = vertExagRaw === '' ? 0 : parseFloat(vertExagRaw);
            if (isNaN(interval) || interval <= 0 || isNaN(halfWidth) || halfWidth <= 0 || isNaN(taluyRatio) || taluyRatio < 0 || isNaN(vertExag) || vertExag < 0) {
                setCommandText('Command: Thông số không hợp lệ.');
                return;
            }
            pendingSectionInterval = interval;
            pendingSectionHalfWidth = halfWidth;
            pendingSectionTaluyRatio = taluyRatio;
            pendingSectionVertExaggeration = vertExag;
            defaultTaluyRatio = taluyRatio; // nhớ lại cho lần sau
            defaultSectionVertExaggeration = vertExag;
            closeSectionIntervalPopup();
            setTool('section-place');
        }
        document.getElementById('section-interval-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmSectionInterval();
            else if (event.key === 'Escape') { closeSectionIntervalPopup(); pendingSectionAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Trắc ngang.'); }
        });
        document.getElementById('section-halfwidth-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmSectionInterval();
            else if (event.key === 'Escape') { closeSectionIntervalPopup(); pendingSectionAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Trắc ngang.'); }
        });
        document.getElementById('section-vertexag-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmSectionInterval();
            else if (event.key === 'Escape') { closeSectionIntervalPopup(); pendingSectionAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Trắc ngang.'); }
        });
        document.getElementById('section-taluy-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmSectionInterval();
            else if (event.key === 'Escape') { closeSectionIntervalPopup(); pendingSectionAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Trắc ngang.'); }
        });

        function getBoundaryPolygonFromEntity(entity) {
            if (!entity || !entity.object || entity.object.type !== 'LineLoop') return null;
            const posAttr = entity.object.geometry.attributes.position;
            const pts = [];
            for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
            return pts.length >= 3 ? pts : null;
        }

