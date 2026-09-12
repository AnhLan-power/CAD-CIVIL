        /* =========================================================================================
         * POINT (kiểu Civil3D "Points"): đặt điểm khảo sát kèm cao độ, dùng làm dữ liệu cho Surface.
         * Lưu toạ độ X,Y trong userData.pointXY (không dùng object3D.position vì các Line/Sprite con
         * đã dựng bằng toạ độ tuyệt đối, giống cách Hatch lưu boundaryPts).
         * =========================================================================================
         */
        function createPointEntity(pos, elevation) {
            const dist = camera.position.distanceTo(controls.target) || 1000;
            const size = dist * 0.012;
            const mat = () => new THREE.LineBasicMaterial({ color: currentDrawColor });

            const group = new THREE.Group();
            group.userData.isPoint = true;
            group.userData.elevation = elevation;
            group.userData.pointXY = { x: pos.x, y: pos.y };

            // Dấu cộng nhỏ đánh dấu vị trí điểm
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
                pos.clone().add(new THREE.Vector3(-size, 0, 0)), pos.clone().add(new THREE.Vector3(size, 0, 0))
            ]), mat()));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
                pos.clone().add(new THREE.Vector3(0, -size, 0)), pos.clone().add(new THREE.Vector3(0, size, 0))
            ]), mat()));

            // Label cao độ đặt lệch bên cạnh điểm
            const label = createTextSprite(elevation.toFixed(2), pos.clone().add(new THREE.Vector3(size * 1.8, size * 1.8, 0)), size * 2.2);
            group.add(label);

            return group;
        }

        // Gộp toàn bộ điểm cao độ kèm metadata (nguồn gốc + entityId nếu là Point tự đặt) — dùng cho
        // Points Manager panel. collectAllSurveyPoints() (dùng cho Surface) chỉ cần {x,y,z} nên gọi lại hàm này.
        function collectAllSurveyPointsWithMeta() {
            const pts = importedElevationPoints.map(p => ({ x: p.x, y: p.y, z: p.z, source: 'DXF', entityId: null }));
            entities.forEach(e => {
                if (e.type === 'POINT' && e.object.visible && e.object.userData.pointXY) {
                    pts.push({ x: e.object.userData.pointXY.x, y: e.object.userData.pointXY.y, z: e.object.userData.elevation, source: 'Point', entityId: e.id });
                }
            });
            return pts;
        }

        function collectAllSurveyPoints() {
            return collectAllSurveyPointsWithMeta().map(p => ({ x: p.x, y: p.y, z: p.z }));
        }

        function togglePointsPanel() {
            const panel = document.getElementById('points-panel');
            const willShow = panel.style.display === 'none';
            panel.style.display = willShow ? 'flex' : 'none';
            if (willShow) renderPointsPanel();
        }

        function renderPointsPanel() {
            const body = document.getElementById('points-panel-body');
            const summary = document.getElementById('points-panel-summary');
            if (!body) return;
            const pts = collectAllSurveyPointsWithMeta();
            if (summary) summary.innerText = `Tổng: ${pts.length} điểm`;

            const MAX_ROWS = 300;
            let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
            html += '<tr style="color:#999; text-align:left;"><th style="padding:3px 6px;">#</th><th style="padding:3px 6px;">X</th><th style="padding:3px 6px;">Y</th><th style="padding:3px 6px;">Z</th><th style="padding:3px 6px;">Nguồn</th></tr>';
            pts.slice(0, MAX_ROWS).forEach((p, i) => {
                const clickable = p.entityId !== null;
                const rowStyle = clickable ? 'cursor:pointer;' : '';
                const onclick = clickable ? `onclick="selectEntity(${p.entityId}, false)"` : '';
                html += `<tr style="border-top:1px solid #333; ${rowStyle}" ${onclick} title="${clickable ? 'Click để chọn Point này trên bản vẽ' : 'Điểm trích từ text DXF (không chỉnh sửa được)'}">
                    <td style="padding:3px 6px;">${i + 1}</td>
                    <td style="padding:3px 6px;">${p.x.toFixed(2)}</td>
                    <td style="padding:3px 6px;">${p.y.toFixed(2)}</td>
                    <td style="padding:3px 6px;">${p.z.toFixed(2)}</td>
                    <td style="padding:3px 6px; color:${clickable ? '#7fdbff' : '#888'};">${p.source}</td>
                </tr>`;
            });
            html += '</table>';
            if (pts.length > MAX_ROWS) html += `<div style="color:#888; padding:6px;">... và ${pts.length - MAX_ROWS} điểm khác (chỉ hiện ${MAX_ROWS} đầu tiên)</div>`;
            if (pts.length === 0) html = '<p style="color:#777;">Chưa có điểm nào. Import DXF có nhãn cao độ dạng số, hoặc dùng nút "Point" để tự đặt.</p>';
            body.innerHTML = html;
        }

        // --- Ô nhập nội dung Text (thay cho window.prompt để tránh bị trình duyệt/khung nhúng chặn) ---
        let pendingTextPoint = null;
        const textInputPopup = document.getElementById('text-input-popup');
        const textInputField = document.getElementById('text-input-field');

        function openTextInput(worldPoint) {
            pendingTextPoint = worldPoint.clone();
            textInputPopup.style.display = 'flex';
            textInputField.value = '';
            textInputField.focus();
        }
        function closeTextInput() {
            textInputPopup.style.display = 'none';
            pendingTextPoint = null;
            textInputField.blur();
        }
        textInputField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const value = textInputField.value.trim();
                if (value !== '' && pendingTextPoint) {
                    const sprite = createTextSprite(value, pendingTextPoint);
                    execute(makeAddCommand('TEXT', sprite));
                    setCommandText('Command: Đã thêm TEXT. Chỉ định điểm chèn tiếp theo (Esc để kết thúc):');
                }
                closeTextInput();
            } else if (event.key === 'Escape') {
                closeTextInput();
                setCommandText('Command: Đã huỷ. Chỉ định điểm chèn Text:');
            }
        });

        // --- Point: popup nhập cao độ ---
        let pendingPointPos = null;
        const pointElevationPopup = document.getElementById('point-elevation-popup');
        const pointElevationField = document.getElementById('point-elevation-field');

        function openPointInput(worldPoint) {
            pendingPointPos = worldPoint.clone();
            pointElevationPopup.style.display = 'flex';
            pointElevationField.value = '';
            pointElevationField.focus();
        }
        function closePointInput() {
            pointElevationPopup.style.display = 'none';
            pendingPointPos = null;
            pointElevationField.blur();
        }
        pointElevationField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const z = parseFloat(pointElevationField.value);
                if (!isNaN(z) && pendingPointPos) {
                    const point = createPointEntity(pendingPointPos, z);
                    execute(makeAddCommand('POINT', point));
                    setCommandText('Command: Đã thêm Point. Chỉ định vị trí tiếp theo (Esc để kết thúc):');
                    closePointInput();
                    renderPointsPanel();
                } else {
                    setCommandText('Command: Cao độ không hợp lệ, nhập lại:');
                }
            } else if (event.key === 'Escape') {
                closePointInput();
                setCommandText('Command: Đã huỷ. Chỉ định vị trí đặt Point:');
            }
        });

        // --- Offset: popup nhập khoảng cách + trạng thái đang chờ chọn đối tượng ---
        let offsetDistance = null;
        let offsetPendingSource = null;
        const offsetDistancePopup = document.getElementById('offset-distance-popup');
        const offsetDistanceField = document.getElementById('offset-distance-field');

        function openOffsetDistanceInput() {
            offsetDistance = null;
            offsetPendingSource = null;
            offsetDistancePopup.style.display = 'flex';
            offsetDistanceField.value = '';
            offsetDistanceField.focus();
        }
        function closeOffsetDistanceInput() {
            offsetDistancePopup.style.display = 'none';
        }
        offsetDistanceField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const v = parseFloat(offsetDistanceField.value);
                if (!isNaN(v) && v > 0) {
                    offsetDistance = v;
                    closeOffsetDistanceInput();
                    setCommandText('Command: Click vào 1 đối tượng (Line/Polyline/Circle/Rectangle) cần Offset:');
                } else {
                    setCommandText('Command: Khoảng cách không hợp lệ, nhập lại:');
                }
            } else if (event.key === 'Escape') {
                closeOffsetDistanceInput();
                setTool('select');
                setCommandText('Command: Đã huỷ Offset.');
            }
        });

        // --- Alignment: popup nhập thông số (tên/bán kính/khoảng station) trước khi click các điểm PI ---
        let alignmentParams = null; // { radius, interval, name } — null nghĩa là đang chờ nhập ở popup
        const alignmentPopup = document.getElementById('alignment-options-popup');
        const alignmentNameField = document.getElementById('alignment-name-field');
        const alignmentRadiusField = document.getElementById('alignment-radius-field');
        const alignmentIntervalField = document.getElementById('alignment-interval-field');
        const alignmentStartBtn = document.getElementById('alignment-start-btn');
        let alignmentCounter = 1;

        function openAlignmentOptions() {
            alignmentParams = null;
            alignmentNameField.value = 'Alignment-' + alignmentCounter;
            alignmentPopup.style.display = 'flex';
            alignmentNameField.focus();
            alignmentNameField.select();
        }
        function closeAlignmentOptions() {
            alignmentPopup.style.display = 'none';
        }
        function confirmAlignmentOptions() {
            const radius = parseFloat(alignmentRadiusField.value);
            const interval = parseFloat(alignmentIntervalField.value);
            const name = alignmentNameField.value.trim() || ('Alignment-' + alignmentCounter);
            if (isNaN(radius) || radius <= 0 || isNaN(interval) || interval <= 0) {
                setCommandText('Command: Bán kính hoặc khoảng cách station không hợp lệ.');
                return;
            }
            alignmentParams = { radius, interval, name };
            closeAlignmentOptions();
            setCommandText('Command: Chỉ định điểm PI đầu tiên của Alignment:');
        }
        alignmentStartBtn.addEventListener('click', confirmAlignmentOptions);
        [alignmentNameField, alignmentRadiusField, alignmentIntervalField].forEach(input => {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); confirmAlignmentOptions(); }
                else if (event.key === 'Escape') { closeAlignmentOptions(); setTool('select'); setCommandText('Command: Đã huỷ Alignment.'); }
            });
        });

        function finishAlignment() {
            if (tempPoints.length < 2) {
                setCommandText('Command: Cần ít nhất 2 điểm PI để tạo Alignment.');
                tempPoints = [];
                clearPreview();
                return;
            }
            const group = createAlignmentEntity(tempPoints, alignmentParams.radius, alignmentParams.interval, alignmentParams.name);
            execute(makeAddCommand('ALIGNMENT', group));
            alignmentCounter++;
            tempPoints = [];
            clearPreview();
            setCommandText(`Command: Đã tạo "${alignmentParams.name}". Bấm Alignment lại để vẽ tuyến tiếp theo.`);
            setTool('select');
        }

        // --- Trim: trạng thái cutting edge đang chọn ---
        let trimCuttingEdge = null;
        let trimCuttingSegments = [];

        // --- Bảng tuỳ chọn Hatch ---
        let pendingHatchBoundary = null;
        let pendingHatchLayerName = null;
        const hatchPopup = document.getElementById('hatch-options-popup');
        const hatchPatternSelect = document.getElementById('hatch-pattern-select');
        const hatchLineOptions = document.getElementById('hatch-line-options');
        const hatchColorInput = document.getElementById('hatch-color-input');
        const hatchOpacityInput = document.getElementById('hatch-opacity-input');
        const hatchAngleInput = document.getElementById('hatch-angle-input');
        const hatchSpacingInput = document.getElementById('hatch-spacing-input');
        const hatchApplyBtn = document.getElementById('hatch-apply-btn');

        function openHatchOptions(boundaryPts, layerName) {
            pendingHatchBoundary = boundaryPts;
            pendingHatchLayerName = layerName;
            hatchColorInput.value = '#' + currentDrawColor.toString(16).padStart(6, '0');
            hatchPopup.style.display = 'flex';
            hatchLineOptions.style.display = hatchPatternSelect.value === 'solid' ? 'none' : 'flex';
        }
        function closeHatchOptions() {
            hatchPopup.style.display = 'none';
            pendingHatchBoundary = null;
            pendingHatchLayerName = null;
        }
        hatchPatternSelect.addEventListener('change', () => {
            hatchLineOptions.style.display = hatchPatternSelect.value === 'solid' ? 'none' : 'flex';
        });
        function applyHatch() {
            if (!pendingHatchBoundary) return;
            const opts = {
                pattern: hatchPatternSelect.value,
                color: parseInt(hatchColorInput.value.slice(1), 16),
                opacity: parseFloat(hatchOpacityInput.value) || 0.6,
                angle: parseFloat(hatchAngleInput.value) || 0,
                spacing: parseFloat(hatchSpacingInput.value) || 1
            };
            const hatchGroup = createHatchEntity(pendingHatchBoundary, opts);
            execute(makeAddCommand('HATCH', hatchGroup, pendingHatchLayerName));
            closeHatchOptions();
            setCommandText('Command: Đã tạo Hatch. Click vào 1 vùng khép kín khác, hoặc Esc để kết thúc:');
        }
        hatchApplyBtn.addEventListener('click', applyHatch);
        [hatchAngleInput, hatchSpacingInput].forEach(input => {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); applyHatch(); }
                else if (event.key === 'Escape') { closeHatchOptions(); setCommandText('Command: Đã huỷ Hatch.'); }
            });
        });

        // --- Dynamic Input (nhập số kiểu AutoCAD): gõ số ngay sau khi chỉ định điểm đầu để
        // nhập chính xác khoảng cách/góc (Line, Polyline), chiều rộng/cao (Rectangle), bán kính (Circle)
        // thay vì phải click bằng chuột.
        let numericInputMode = null; // 'distance-angle' | 'dx-dy' | 'radius'
        const numericPopup = document.getElementById('numeric-input-popup');
        const numLabel2 = document.getElementById('numeric-input-label2');
        const numField1 = document.getElementById('numeric-input-field1');
        const numField2 = document.getElementById('numeric-input-field2');

        function openNumericInput(initialChar) {
            if (tempPoints.length === 0) return;
            if (activeTool === 'line' || activeTool === 'polyline') {
                numericInputMode = 'distance-angle';
                document.getElementById('numeric-input-label1').innerText = 'Khoảng cách:';
                numLabel2.innerText = 'Góc (°):';
                numLabel2.style.display = '';
                numField2.style.display = '';
            } else if (activeTool === 'rectangle') {
                numericInputMode = 'dx-dy';
                document.getElementById('numeric-input-label1').innerText = 'Chiều rộng (dx):';
                numLabel2.innerText = 'Chiều cao (dy):';
                numLabel2.style.display = '';
                numField2.style.display = '';
            } else if (activeTool === 'circle') {
                numericInputMode = 'radius';
                document.getElementById('numeric-input-label1').innerText = 'Bán kính:';
                numLabel2.style.display = 'none';
                numField2.style.display = 'none';
            } else if (activeTool === 'rotate') {
                numericInputMode = 'rotate-angle';
                document.getElementById('numeric-input-label1').innerText = 'Góc xoay (°):';
                numLabel2.style.display = 'none';
                numField2.style.display = 'none';
            } else if (activeTool === 'scale') {
                numericInputMode = 'scale-factor';
                document.getElementById('numeric-input-label1').innerText = 'Hệ số tỉ lệ:';
                numLabel2.style.display = 'none';
                numField2.style.display = 'none';
            } else {
                return;
            }
            numericPopup.style.display = 'flex';
            numField1.value = initialChar || '';
            numField2.value = '';
            numField1.focus();
        }

        function closeNumericInput() {
            numericPopup.style.display = 'none';
            numericInputMode = null;
            numField1.blur();
            numField2.blur();
        }

        function confirmNumericInput() {
            const base = tempPoints[tempPoints.length - 1];
            const v1 = parseFloat(numField1.value);
            if (isNaN(v1)) { setCommandText('Command: Giá trị không hợp lệ.'); return; }

            if (numericInputMode === 'distance-angle') {
                const angleDeg = parseFloat(numField2.value) || 0;
                const rad = THREE.MathUtils.degToRad(angleDeg);
                const newPoint = base.clone().add(new THREE.Vector3(Math.cos(rad) * v1, Math.sin(rad) * v1, 0));
                closeNumericInput();
                if (activeTool === 'line') handleLinePoint(newPoint); else handlePolylinePoint(newPoint);
            } else if (numericInputMode === 'dx-dy') {
                const v2 = parseFloat(numField2.value);
                if (isNaN(v2)) { setCommandText('Command: Giá trị không hợp lệ.'); return; }
                closeNumericInput();
                handleRectanglePoint(base.clone().add(new THREE.Vector3(v1, v2, 0)));
            } else if (numericInputMode === 'radius') {
                closeNumericInput();
                handleCirclePoint(base.clone().add(new THREE.Vector3(v1, 0, 0)));
            } else if (numericInputMode === 'rotate-angle') {
                const pivot = tempPoints[0];
                const angle = THREE.MathUtils.degToRad(v1);
                const m1 = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, 0);
                const m2 = new THREE.Matrix4().makeRotationZ(angle);
                const m3 = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, 0);
                const matrix = m3.multiply(m2).multiply(m1);
                execute(makeTransformCommand(Array.from(selectedIds), matrix));
                closeNumericInput();
                tempPoints = [];
                clearPreview();
                setTool('select');
                setCommandText('Command: ROTATE hoàn tất (nhập số).');
            } else if (numericInputMode === 'scale-factor') {
                const base2 = tempPoints[0];
                const m1 = new THREE.Matrix4().makeTranslation(-base2.x, -base2.y, 0);
                const m2 = new THREE.Matrix4().makeScale(v1, v1, 1);
                const m3 = new THREE.Matrix4().makeTranslation(base2.x, base2.y, 0);
                const matrix = m3.multiply(m2).multiply(m1);
                execute(makeTransformCommand(Array.from(selectedIds), matrix));
                closeNumericInput();
                tempPoints = [];
                clearPreview();
                setTool('select');
                setCommandText('Command: SCALE hoàn tất (nhập số).');
            }
        }

        numField1.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (numericInputMode === 'radius' || numericInputMode === 'rotate-angle' || numericInputMode === 'scale-factor') confirmNumericInput();
                else { numField2.focus(); numField2.select(); }
            } else if (event.key === 'Escape') {
                closeNumericInput();
                setCommandText('Command: Đã huỷ nhập số.');
            }
        });
        numField2.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                confirmNumericInput();
            } else if (event.key === 'Escape') {
                closeNumericInput();
                setCommandText('Command: Đã huỷ nhập số.');
            }
        });

        // Mũi tên đặc (tam giác) kiểu AutoCAD mặc định, tipPos = đầu mũi tên, dir = hướng trỏ tới (đã normalize)
        function createArrowHead(tipPos, dir, size) {
            const perp = new THREE.Vector3(-dir.y, dir.x, 0);
            const back = tipPos.clone().addScaledVector(dir, -size);
            const p1 = back.clone().addScaledVector(perp, size * 0.32);
            const p2 = back.clone().addScaledVector(perp, -size * 0.32);
            const geo = new THREE.BufferGeometry().setFromPoints([tipPos, p1, p2]);
            geo.setIndex([0, 1, 2]);
            geo.computeVertexNormals();
            const mat = new THREE.MeshBasicMaterial({ color: currentDrawColor, side: THREE.DoubleSide });
            return new THREE.Mesh(geo, mat);
        }

        // Chèn 1 label vào giữa đoạn a->b: nếu label đủ nhỏ so với đoạn thì "cắt" đường ra làm 2,
        // chừa khoảng trống cho label chen vào giữa (giống AutoCAD); nếu không đủ chỗ thì vẽ liền
        // và để label đè lên (fallback an toàn).
        function addLineWithLabelGap(group, a, b, label, newLine) {
            const dir = new THREE.Vector3().subVectors(b, a);
            const length = dir.length();
            const mid = a.clone().add(b).multiplyScalar(0.5);
            if (length < 1e-6) { group.add(label); return; }
            dir.normalize();
            const halfGap = label.scale.x / 2 + label.scale.y * 0.15;
            if (halfGap * 2 < length * 0.92) {
                group.add(newLine([a, mid.clone().addScaledVector(dir, -halfGap)]));
                group.add(newLine([mid.clone().addScaledVector(dir, halfGap), b]));
            } else {
                group.add(newLine([a, b]));
            }
            label.position.copy(mid);
            group.add(label);
        }

        // --- Linear Dimension (kiểu AutoCAD DIMLINEAR): p1, p2 là 2 điểm gióng, p3 định vị offset ---
        function createDimensionEntity(p1, p2, p3) {
            const baseDir = new THREE.Vector3().subVectors(p2, p1);
            const length = baseDir.length();
            if (length < 1e-6) return null;
            baseDir.normalize();
            const perp = new THREE.Vector3(-baseDir.y, baseDir.x, 0);
            const offset = new THREE.Vector3().subVectors(p3, p1).dot(perp);
            const offsetVec = perp.clone().multiplyScalar(offset);

            const d1 = p1.clone().add(offsetVec);
            const d2 = p2.clone().add(offsetVec);
            const newLine = (pts) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: currentDrawColor }));

            const group = new THREE.Group();
            group.add(newLine([p1, d1])); // đường gióng 1
            group.add(newLine([p2, d2])); // đường gióng 2

            // Mũi tên đặc quay ra ngoài 2 đầu đường kích thước
            const arrowSize = Math.max(length * 0.035, 0.06);
            group.add(createArrowHead(d1, baseDir.clone().negate(), arrowSize));
            group.add(createArrowHead(d2, baseDir.clone(), arrowSize));

            // Đường kích thước chính, chừa khoảng trống giữa cho label khoảng cách
            const label = createTextSprite(length.toFixed(2), d1, Math.max(length * 0.08, 0.15));
            addLineWithLabelGap(group, d1, d2, label, newLine);

            return group;
        }

        // --- Angular Dimension: vertex = đỉnh góc, p1/p2 = 1 điểm bất kỳ trên mỗi cạnh ---
        function createAngularDimensionEntity(vertex, p1, p2) {
            const v1 = new THREE.Vector3().subVectors(p1, vertex);
            const v2 = new THREE.Vector3().subVectors(p2, vertex);
            const d1 = v1.length(), d2 = v2.length();
            if (d1 < 1e-6 || d2 < 1e-6) return null;

            const a1 = Math.atan2(v1.y, v1.x);
            let delta = Math.atan2(v2.y, v2.x) - a1;
            while (delta <= -Math.PI) delta += Math.PI * 2;
            while (delta > Math.PI) delta -= Math.PI * 2;
            const angleDeg = Math.abs(delta * 180 / Math.PI);

            const radius = Math.min(d1, d2) * 0.6;
            const segments = 32;
            const arcPts = [];
            for (let i = 0; i <= segments; i++) {
                const t = a1 + delta * (i / segments);
                arcPts.push(new THREE.Vector3(vertex.x + Math.cos(t) * radius, vertex.y + Math.sin(t) * radius, 0));
            }
            const newLine = (pts) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: currentDrawColor }));

            const group = new THREE.Group();
            group.add(newLine(arcPts));
            group.add(newLine([vertex, arcPts[0]]));
            group.add(newLine([vertex, arcPts[arcPts.length - 1]]));

            // Mũi tên đặc tại 2 đầu cung, hướng tiếp tuyến với cung (vuông góc bán kính)
            const arrowSize = Math.max(radius * 0.12, 0.06);
            const sgn = Math.sign(delta) || 1;
            const tangentStart = new THREE.Vector3(-Math.sin(a1), Math.cos(a1), 0).multiplyScalar(sgn);
            const endAngle = a1 + delta;
            const tangentEnd = new THREE.Vector3(-Math.sin(endAngle), Math.cos(endAngle), 0).multiplyScalar(-sgn);
            group.add(createArrowHead(arcPts[0], tangentStart, arrowSize));
            group.add(createArrowHead(arcPts[arcPts.length - 1], tangentEnd, arrowSize));

            // Label góc đặt ngay phía ngoài cung, tại điểm giữa cung
            const midT = a1 + delta * 0.5;
            const labelPt = new THREE.Vector3(vertex.x + Math.cos(midT) * radius * 1.25, vertex.y + Math.sin(midT) * radius * 1.25, 0);
            group.add(createTextSprite(angleDeg.toFixed(2) + '°', labelPt, Math.max(radius * 0.22, 0.15)));

            return group;
        }

