        /* =========================================================================================
         * PROFILE (kiểu Civil3D): trích "mặt đất tự nhiên" (EG - Existing Ground) bằng cách nội suy
         * cao độ từ Surface (TIN) dọc theo 1 Alignment, cho phép thiết kế "đường đỏ" (FG - Finish
         * Ground) bằng cách click các điểm PVI trực tiếp trên bản vẽ. Profile View được VẼ THẲNG
         * LÊN bản vẽ như 1 entity thật tại vị trí người dùng chọn (giống Civil3D thật), kèm theo
         * bảng trắc dọc bên dưới biểu đồ — không phải panel xem riêng.
         * =========================================================================================
         */

        // Nội suy cao độ tại (x,y) bất kỳ bằng toạ độ trọng tâm (barycentric) trong tam giác TIN chứa nó
        function baryInterpolate(p, a, b, c) {
            const v0x = b.x - a.x, v0y = b.y - a.y;
            const v1x = c.x - a.x, v1y = c.y - a.y;
            const v2x = p.x - a.x, v2y = p.y - a.y;
            const d00 = v0x * v0x + v0y * v0y;
            const d01 = v0x * v1x + v0y * v1y;
            const d11 = v1x * v1x + v1y * v1y;
            const d20 = v2x * v0x + v2y * v0y;
            const d21 = v2x * v1x + v2y * v1y;
            const denom = d00 * d11 - d01 * d01;
            if (Math.abs(denom) < 1e-12) return null;
            const v = (d11 * d20 - d01 * d21) / denom;
            const w = (d00 * d21 - d01 * d20) / denom;
            const u = 1 - v - w;
            if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null; // ngoài tam giác
            return u * a.z + v * b.z + w * c.z;
        }

        function sampleSurfaceElevationAt(x, y) {
            if (!currentSurface || !currentSurface.userData.triangulation) return null;
            const { points, triangles } = currentSurface.userData.triangulation;
            for (let i = 0; i < triangles.length; i++) {
                const tri = triangles[i];
                const z = baryInterpolate({ x, y }, points[tri[0]], points[tri[1]], points[tri[2]]);
                if (z !== null) return z;
            }
            return null; // điểm nằm ngoài phạm vi Surface
        }

        // Trích profile mặt đất tự nhiên (EG) dọc theo 1 Alignment, lấy mẫu theo đúng khoảng station của nó
        function extractEGProfile(alignmentEntity, interval) {
            const info = alignmentEntity.object.userData.alignmentInfo;
            const piPoints = alignmentEntity.object.userData.boundaryPts;
            const { path } = buildAlignmentPath(piPoints, info.radius);
            const { stations } = computeStations(path, interval, 0);
            return stations
                .map(st => ({ station: st.station, elevation: sampleSurfaceElevationAt(st.pos.x, st.pos.y) }))
                .filter(p => p.elevation !== null);
        }

        // Đường cong đứng PARABOL tại 1 PVI trong (BVC = Begin Vertical Curve, EVC = End Vertical Curve)
        function computeVerticalCurve(prevPVI, pvi, nextPVI, length) {
            const g1 = (pvi.elevation - prevPVI.elevation) / (pvi.station - prevPVI.station);
            const g2 = (nextPVI.elevation - pvi.elevation) / (nextPVI.station - pvi.station);
            if (Math.abs(g2 - g1) < 1e-9) return null; // grade không đổi -> không cần curve

            const backLen = pvi.station - prevPVI.station;
            const fwdLen = nextPVI.station - pvi.station;
            const maxHalfLen = Math.min(backLen, fwdLen) * 0.45;
            let halfLen = length / 2;
            let usedLength = length;
            if (halfLen > maxHalfLen) { halfLen = maxHalfLen; usedLength = halfLen * 2; }

            const BVC = { station: pvi.station - halfLen, elevation: pvi.elevation - g1 * halfLen };
            const EVC = { station: pvi.station + halfLen, elevation: pvi.elevation + g2 * halfLen };

            const segCount = 20;
            const curvePts = [];
            for (let i = 0; i <= segCount; i++) {
                const x = usedLength * (i / segCount);
                const elev = BVC.elevation + g1 * x + ((g2 - g1) / (2 * usedLength)) * x * x;
                curvePts.push({ station: BVC.station + x, elevation: elev });
            }
            return { BVC, EVC, curvePts, length: usedLength, g1, g2 };
        }

        // Ghép các PVI + đường cong đứng thành 1 chuỗi điểm liên tục để vẽ đường đỏ (FG) hoàn chỉnh
        function buildDesignProfilePath(pviList, curveLength) {
            if (pviList.length < 2) return pviList.slice();
            const rendered = [pviList[0]];
            for (let i = 1; i < pviList.length - 1; i++) {
                const curve = computeVerticalCurve(pviList[i - 1], pviList[i], pviList[i + 1], curveLength);
                if (curve) rendered.push(curve.BVC, ...curve.curvePts, curve.EVC);
                else rendered.push(pviList[i]);
            }
            rendered.push(pviList[pviList.length - 1]);
            return rendered;
        }

        // Nội suy cao độ FG tại 1 station bất kỳ dọc theo path (tangent+curve) đã ghép sẵn — dùng để
        // lấy giá trị FG đúng tại từng cột station của bảng trắc dọc (vốn lấy theo mốc của EG)
        function interpolateAlongProfilePath(path, station) {
            if (!path || path.length === 0) return null;
            if (station <= path[0].station) return path[0].elevation;
            for (let i = 0; i < path.length - 1; i++) {
                if (station >= path[i].station && station <= path[i + 1].station) {
                    const span = path[i + 1].station - path[i].station;
                    const t = span > 1e-9 ? (station - path[i].station) / span : 0;
                    return path[i].elevation + (path[i + 1].elevation - path[i].elevation) * t;
                }
            }
            return path[path.length - 1].elevation;
        }

        // Tính tỉ lệ quy đổi station/cao độ <-> toạ độ bản vẽ, CHỐT 1 LẦN tại thời điểm đặt vị trí
        // (không đổi khi thêm PVI sau đó, để biểu đồ không bị dịch/co giãn liên tục khi đang thiết kế FG)
        function computeProfileScale(insertion, egData) {
            const stations = egData.map(p => p.station);
            const elevations = egData.map(p => p.elevation);
            const minSta = Math.min(...stations), maxSta = Math.max(...stations);
            let minElev = Math.min(...elevations), maxElev = Math.max(...elevations);
            const elevPad = Math.max((maxElev - minElev) * 0.15, 0.3);
            minElev -= elevPad; maxElev += elevPad;
            const plotWidth = Math.max(maxSta - minSta, 1); // horizScale = 1 (1 đơn vị bản vẽ = 1 đơn vị station)
            const elevSpan = Math.max(maxElev - minElev, 0.1);
            // Phóng đại cao độ để nhìn rõ hình dạng (chỉ để hiển thị) — tự tính theo tỉ lệ ~28% chiều rộng
            const vertExaggeration = Math.max(1, Math.min(200, (plotWidth * 0.28) / elevSpan));
            return { insertion, minSta, maxSta, minElev, maxElev, horizScale: 1, vertExaggeration, plotWidth, plotHeight: elevSpan * vertExaggeration };
        }
        function profileScaleToWorld(scale, station, elevation) {
            return new THREE.Vector3(
                scale.insertion.x + (station - scale.minSta) * scale.horizScale,
                scale.insertion.y + (elevation - scale.minElev) * scale.vertExaggeration, 0
            );
        }
        function profileScaleFromWorld(scale, worldPt) {
            return {
                station: scale.minSta + (worldPt.x - scale.insertion.x) / scale.horizScale,
                elevation: scale.minElev + (worldPt.y - scale.insertion.y) / scale.vertExaggeration
            };
        }

        // Dựng toàn bộ hình học Profile View (biểu đồ + bảng trắc dọc) — dùng chung lúc tạo mới lẫn
        // lúc rebuild preview khi đang thiết kế PVI
        function buildProfileViewGeometry(scale, egData, fgPVIs, fgRendered, alignmentName) {
            const group = new THREE.Group();
            group.userData.isProfileView = true;

            const toWorld = (sta, elev) => profileScaleToWorld(scale, sta, elev);
            const { minSta, maxSta, minElev, maxElev, plotWidth, plotHeight, insertion } = scale;
            const lineMat = () => new THREE.LineBasicMaterial({ color: currentDrawColor });
            const gridMat = () => new THREE.LineBasicMaterial({ color: 0x333333 });
            const labelH = Math.max(plotHeight * 0.028, plotWidth * 0.007, 0.12);

            // Nền mờ phía sau (tách biệt khỏi bản vẽ chính, giống nền profile sheet thật)
            const rowLabels = ['Lý trình', 'Khoảng cách lẻ', 'Cao độ tự nhiên', 'Cao độ thiết kế', 'Chênh cao'];
            const rowH = labelH * 1.9;
            const tableTop = insertion.y - labelH * 1.6;
            const tableBottom = tableTop - rowLabels.length * rowH;
            const labelColWidth = Math.max(plotWidth * 0.1, labelH * 7);
            const bgShape = new THREE.Shape([
                new THREE.Vector2(insertion.x - labelColWidth - 4, tableBottom - 4),
                new THREE.Vector2(insertion.x + plotWidth + 4, tableBottom - 4),
                new THREE.Vector2(insertion.x + plotWidth + 4, insertion.y + plotHeight + labelH * 4),
                new THREE.Vector2(insertion.x - labelColWidth - 4, insertion.y + plotHeight + labelH * 4)
            ]);
            group.add(new THREE.Mesh(new THREE.ShapeGeometry(bgShape), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.6, depthWrite: false })));

            // Khung viền biểu đồ
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                toWorld(minSta, minElev), toWorld(maxSta, minElev), toWorld(maxSta, maxElev), toWorld(minSta, maxElev)
            ]), lineMat()));

            // Lưới + nhãn trục cao độ (bên trái)
            const elevStep = niceStep((maxElev - minElev) / 6) || 1;
            for (let e = Math.ceil(minElev / elevStep) * elevStep; e <= maxElev; e += elevStep) {
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(minSta, e), toWorld(maxSta, e)]), gridMat()));
                group.add(createTextSprite(e.toFixed(2), toWorld(minSta, e).add(new THREE.Vector3(-labelH * 2.4, 0, 0)), labelH));
            }

            // Lưới đứng theo từng cọc station (cũng chính là các cột của bảng trắc dọc bên dưới)
            const stationTicks = egData.map(p => p.station);
            stationTicks.forEach(sta => {
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toWorld(sta, minElev), toWorld(sta, maxElev)]), gridMat()));
            });

            // Đường EG (mặt đất tự nhiên)
            if (egData.length > 1) {
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(egData.map(p => toWorld(p.station, p.elevation))), new THREE.LineBasicMaterial({ color: 0xd2a679 })));
            }
            // Đường FG (thiết kế, đã gồm đường cong đứng)
            if (fgRendered && fgRendered.length > 1) {
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(fgRendered.map(p => toWorld(p.station, p.elevation))), new THREE.LineBasicMaterial({ color: 0xe04040 })));
            }
            // Đánh dấu PVI
            (fgPVIs || []).forEach(pvi => {
                const c = toWorld(pvi.station, pvi.elevation);
                const r = labelH * 0.6, pts = [];
                for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0)); }
                group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffaa00 })));
            });

            // Tiêu đề + chú giải
            group.add(createTextSprite('Profile View — ' + alignmentName, toWorld(minSta, maxElev).add(new THREE.Vector3(0, labelH * 2.2, 0)), labelH * 1.4));
            const legendPt = toWorld(minSta, maxElev).add(new THREE.Vector3(plotWidth * 0.45, labelH * 2.2, 0));
            group.add(createTextSprite('— EG (tự nhiên)   — FG (thiết kế)', legendPt, labelH * 0.9));

            /* --- BẢNG TRẮC DỌC bên dưới biểu đồ, các cột thẳng hàng với lưới station phía trên --- */
            const tableLeft = insertion.x - labelColWidth;
            const tableRight = insertion.x + plotWidth;
            for (let r = 0; r <= rowLabels.length; r++) {
                const y = tableTop - r * rowH;
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(tableLeft, y, 0), new THREE.Vector3(tableRight, y, 0)]), gridMat()));
            }
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(insertion.x, tableTop, 0), new THREE.Vector3(insertion.x, tableBottom, 0)]), lineMat()));
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(tableLeft, tableTop, 0), new THREE.Vector3(tableRight, tableTop, 0),
                new THREE.Vector3(tableRight, tableBottom, 0), new THREE.Vector3(tableLeft, tableBottom, 0)
            ]), lineMat()));

            rowLabels.forEach((label, r) => {
                const y = tableTop - r * rowH - rowH / 2;
                group.add(createTextSprite(label, new THREE.Vector3(tableLeft + labelColWidth * 0.5, y, 0), labelH * 0.85));
            });

            let prevSta = null;
            stationTicks.forEach((sta, i) => {
                const x = insertion.x + (sta - minSta) * scale.horizScale;
                const egElev = egData[i].elevation;
                const fgElev = fgRendered && fgRendered.length > 1 ? interpolateAlongProfilePath(fgRendered, sta) : null;
                const diff = fgElev !== null ? fgElev - egElev : null;
                const khoangCachLe = prevSta !== null ? (sta - prevSta) : 0;
                prevSta = sta;
                const values = [
                    formatStation(sta), khoangCachLe.toFixed(2), egElev.toFixed(2),
                    fgElev !== null ? fgElev.toFixed(2) : '—',
                    diff !== null ? (diff >= 0 ? '+' : '') + diff.toFixed(2) : '—'
                ];
                values.forEach((val, r) => {
                    const y = tableTop - r * rowH - rowH / 2;
                    group.add(createTextSprite(val, new THREE.Vector3(x, y, 0), labelH * 0.8));
                });
            });

            // Chỉ dùng vài điểm góc làm mốc OSNAP/box-select (không duyệt vào hàng trăm sprite bên trong)
            group.userData.boundaryPts = [
                new THREE.Vector3(tableLeft, tableTop, 0), new THREE.Vector3(tableRight, tableTop, 0),
                toWorld(minSta, minElev), toWorld(maxSta, maxElev), new THREE.Vector3(tableLeft, tableBottom, 0)
            ];
            group.userData.profileInfo = { alignmentName, minSta, maxSta, minElev, maxElev, pointCount: egData.length };
            // Lưu thêm dữ liệu FG (nếu có) để Corridor có thể tái sử dụng làm cao độ tim tuyến
            group.userData.fgPVIs = fgPVIs || [];
            group.userData.fgRendered = fgRendered || [];
            // Lưu thêm scale/egData để có thể SỬA LẠI (kéo hoặc nhập số) từng điểm PVI sau khi đã
            // hoàn tất Profile View, mà không cần vẽ lại từ đầu (xem rebuildProfileViewEntity).
            group.userData.profileScale = scale;
            group.userData.egData = egData;
            return group;
        }


        function niceStep(rough) {
            if (!isFinite(rough) || rough <= 0) return 1;
            const mag = Math.pow(10, Math.floor(Math.log10(rough)));
            const norm = rough / mag;
            let step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
            return step * mag;
        }

        // --- Trạng thái đang thao tác tạo Profile View (chọn Alignment -> đặt vị trí -> click PVI) ---
        let pendingProfileAlignment = null;
        let pendingProfileEG = [];
        let pendingProfileScale = null;
        let pendingProfileFGWorld = [];       // các điểm PVI đã click, lưu dạng world Vector3
        let pendingProfilePreviewGroup = null; // preview hiển thị trực tiếp trong lúc đang click PVI
        let profileCurveLength = 20;

        function pickAlignmentForProfile(hit) {
            const info = hit.object.userData.alignmentInfo;
            const eg = extractEGProfile(hit, info.interval || 20);
            if (eg.length === 0) {
                setCommandText('Command: Alignment này không có điểm nào nằm trong phạm vi Surface hiện tại — hãy tạo Surface trước.');
                setTool('select');
                return;
            }
            pendingProfileAlignment = hit;
            pendingProfileEG = eg;
            setTool('profile-place');
        }

        function openProfileCurvePopup() {
            const popup = document.getElementById('profile-curve-popup');
            const field = document.getElementById('profile-curve-length-field');
            popup.style.display = 'flex';
            field.value = String(profileCurveLength);
            field.focus();
            field.select();
        }
        function closeProfileCurvePopup() {
            document.getElementById('profile-curve-popup').style.display = 'none';
        }

        function rebuildPendingProfilePreview() {
            if (pendingProfilePreviewGroup) { scene.remove(pendingProfilePreviewGroup); pendingProfilePreviewGroup = null; }
            if (!pendingProfileScale) return;
            const fgPVIs = pendingProfileFGWorld.map(wp => profileScaleFromWorld(pendingProfileScale, wp)).sort((a, b) => a.station - b.station);
            const fgRendered = buildDesignProfilePath(fgPVIs, profileCurveLength);
            pendingProfilePreviewGroup = buildProfileViewGeometry(
                pendingProfileScale, pendingProfileEG, fgPVIs, fgRendered,
                pendingProfileAlignment.object.userData.alignmentInfo.name
            );
            scene.add(pendingProfilePreviewGroup);
        }

        function finishProfileView() {
            if (pendingProfilePreviewGroup) { scene.remove(pendingProfilePreviewGroup); pendingProfilePreviewGroup = null; }
            closeProfileCurvePopup();
            if (!pendingProfileScale) { setTool('select'); return; }
            const fgPVIs = pendingProfileFGWorld.map(wp => profileScaleFromWorld(pendingProfileScale, wp)).sort((a, b) => a.station - b.station);
            const fgRendered = buildDesignProfilePath(fgPVIs, profileCurveLength);
            const finalGroup = buildProfileViewGeometry(
                pendingProfileScale, pendingProfileEG, fgPVIs, fgRendered,
                pendingProfileAlignment.object.userData.alignmentInfo.name
            );
            execute(makeAddCommand('PROFILEVIEW', finalGroup));
            finalGroup.userData.curveLength = profileCurveLength; // để rebuild sau khi sửa PVI dùng đúng bán kính đường cong đứng
            // Nếu Alignment này đã có sẵn Corridor, rebuild lại ngay để Corridor bám theo đường đỏ
            // (FG) vừa thiết kế lại, thay vì phải bấm tay nút Rebuild.
            syncCorridorsForAlignment(pendingProfileAlignment.object.userData.alignmentInfo.name);
            pendingProfileAlignment = null; pendingProfileEG = []; pendingProfileScale = null; pendingProfileFGWorld = [];
            tempPoints = [];
            setCommandText('Command: Đã tạo Profile View' + (fgPVIs.length > 0 ? ' kèm thiết kế FG.' : ' (chỉ EG).'));
            setTool('select');
        }

        // Rebuild lại 1 Profile View đã có, với danh sách PVI mới (do kéo hoặc nhập số sửa) — giữ
        // nguyên object3D hiện có (id, layer, lựa chọn...) chỉ thay children + userData bên trong.
        function rebuildProfileViewEntity(entity, newFgPVIs) {
            const ud = entity.object.userData;
            if (!ud.profileScale || !ud.egData) {
                setCommandText('Command: Profile View này được tạo bằng bản cũ, chưa có đủ dữ liệu để sửa lại — hãy tạo Profile View mới.');
                return;
            }
            const sortedPVIs = newFgPVIs.slice().sort((a, b) => a.station - b.station);
            const fgRendered = buildDesignProfilePath(sortedPVIs, ud.curveLength || profileCurveLength);
            const newGroup = buildProfileViewGeometry(
                ud.profileScale, ud.egData, sortedPVIs, fgRendered, ud.profileInfo.alignmentName
            );
            while (entity.object.children.length) entity.object.remove(entity.object.children[0]);
            newGroup.children.slice().forEach(child => entity.object.add(child));
            entity.object.userData.boundaryPts = newGroup.userData.boundaryPts;
            entity.object.userData.profileInfo = newGroup.userData.profileInfo;
            entity.object.userData.fgPVIs = newGroup.userData.fgPVIs;
            entity.object.userData.fgRendered = newGroup.userData.fgRendered;
            // profileScale/egData/curveLength giữ nguyên (không đổi khi chỉ sửa vị trí PVI)
            rebuildSnapCandidates();
            syncCorridorsForAlignment(ud.profileInfo.alignmentName);
        }

        // --- Sửa PVI trực tiếp trên Profile View: kéo điểm vàng hoặc click để hiện ô nhập số ---
        let editingProfileEntity = null; // entity PROFILEVIEW đang ở chế độ sửa PVI
        let draggingPVIIndex = null;     // index PVI đang kéo (chỉ để hiển thị, không dùng để tra cứu)
        let draggingPVIRef = null;       // tham chiếu trực tiếp tới object PVI đang kéo (bền vững qua các lần sort lại)
        let pviPointerDownPos = null;    // vị trí client lúc pointerdown, để phân biệt click vs kéo

        function startEditProfilePVI(entity) {
            if (!entity) return;
            if (!entity.object.userData.profileScale) {
                setCommandText('Command: Profile View này được tạo bằng bản cũ, chưa có đủ dữ liệu để sửa lại — hãy tạo Profile View mới.');
                return;
            }
            editingProfileEntity = entity;
            draggingPVIIndex = null;
            setTool('profile-edit-pvi');
            setCommandText('Command: Kéo 1 điểm PVI (vòng tròn vàng) trên trắc dọc để sửa vị trí, hoặc bấm đúng vào điểm để nhập số chính xác. Esc để xong.');
        }

        // Tìm PVI gần con trỏ nhất trong ngưỡng pixel, trả về index trong fgPVIs (đã sort theo station)
        function findNearestPVIAt(entity, event) {
            const pvis = entity.object.userData.fgPVIs || [];
            const scale = entity.object.userData.profileScale;
            let best = -1, bestDist = SNAP_PIXEL_THRESHOLD * 1.6;
            pvis.forEach((pvi, i) => {
                const s = worldToScreen(profileScaleToWorld(scale, pvi.station, pvi.elevation));
                const d = Math.hypot(s.x - event.clientX, s.y - event.clientY);
                if (d < bestDist) { bestDist = d; best = i; }
            });
            return best;
        }

        document.getElementById('profile-curve-length-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                profileCurveLength = parseFloat(event.target.value) || 20;
                closeProfileCurvePopup();
                pendingProfileFGWorld = [];
                activeTool = 'profile-pvi';
                rebuildPendingProfilePreview();
                setCommandText('Command: Click các điểm PVI để thiết kế đường đỏ FG (Enter/Esc để hoàn tất):');
            } else if (event.key === 'Escape') {
                finishProfileView(); // bỏ qua FG, chỉ tạo Profile View với EG
            }
        });

