        /* =========================================================================================
         * TRIM (kiểu AutoCAD): chọn 1 đối tượng làm "cutting edge", sau đó click vào phần thừa của
         * đối tượng khác để cắt bỏ tới giao điểm gần nhất với cutting edge.
         * Giới hạn phạm vi: chỉ hỗ trợ Trim cho Line/Polyline (đường hở) ở đoạn ĐẦU hoặc CUỐI —
         * chưa hỗ trợ Trim đoạn giữa Polyline hay Trim trên Circle/Rectangle làm đối tượng bị cắt.
         * =========================================================================================
         */
        function getEntitySegments(entity) {
            const posAttr = entity.object.geometry.attributes.position;
            const pts = [];
            for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
            const closed = entity.object.type === 'LineLoop';
            const segCount = closed ? pts.length : pts.length - 1;
            const segs = [];
            for (let i = 0; i < segCount; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
            return segs;
        }

        function trimTargetEntity(entity, cuttingSegments, clickPt) {
            if (entity.object.type === 'LineLoop') {
                return { error: 'Chưa hỗ trợ Trim cho đối tượng khép kín (Circle/Rectangle) làm mục tiêu.' };
            }
            const posAttr = entity.object.geometry.attributes.position;
            const pts = [];
            for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
            if (pts.length < 2) return { error: 'Đối tượng không hợp lệ.' };

            let bestIdx = 0, bestDist = Infinity, bestT = 0;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                const dir = new THREE.Vector3().subVectors(b, a);
                const len2 = dir.lengthSq() || 1;
                const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(clickPt, a).dot(dir) / len2));
                const proj = a.clone().addScaledVector(dir, t);
                const d = proj.distanceTo(clickPt);
                if (d < bestDist) { bestDist = d; bestIdx = i; bestT = t; }
            }

            const isFirstSeg = bestIdx === 0;
            const isLastSeg = bestIdx === pts.length - 2;
            if (pts.length > 2 && !isFirstSeg && !isLastSeg) {
                return { error: 'Chỉ hỗ trợ Trim ở đoạn đầu hoặc đoạn cuối của Polyline (chưa hỗ trợ đoạn giữa).' };
            }

            const a = pts[bestIdx], b = pts[bestIdx + 1];
            const dir = new THREE.Vector3().subVectors(b, a);
            const len = dir.length();
            if (len < 1e-6) return { error: 'Đoạn quá ngắn để Trim.' };
            const dirN = dir.clone().normalize();

            const hits = [];
            cuttingSegments.forEach(([c, d2]) => {
                const t = intersectLineSegment(a, dirN, c, d2);
                if (t !== null && t > 1e-6 && t < len - 1e-6) hits.push(t / len);
            });
            if (hits.length === 0) return { error: 'Không tìm thấy giao điểm với đối tượng cắt trên đoạn này.' };

            hits.sort((x, y) => Math.abs(x - bestT) - Math.abs(y - bestT));
            const cutT = hits[0];
            const cutPoint = a.clone().addScaledVector(dir, cutT);

            let finalPts;
            if (bestT < cutT) {
                finalPts = [cutPoint, ...pts.slice(bestIdx + 1)];
            } else {
                finalPts = [...pts.slice(0, bestIdx + 1), cutPoint];
            }
            if (finalPts.length < 2) return { error: 'Kết quả Trim không hợp lệ.' };
            return { points: finalPts };
        }

        // Sinh các đoạn thẳng song song (cách nhau `spacing`, nghiêng góc `angleRad`) đã được CẮT theo biên đa giác
        function clipLinesToPolygon(polygon2D, angleRad, spacing) {
            const dir = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
            const normal = { x: -dir.y, y: dir.x };
            let minProj = Infinity, maxProj = -Infinity;
            polygon2D.forEach(p => {
                const proj = p.x * normal.x + p.y * normal.y;
                minProj = Math.min(minProj, proj);
                maxProj = Math.max(maxProj, proj);
            });
            const segments = [];
            const start = Math.floor(minProj / spacing) * spacing;
            for (let offset = start; offset <= maxProj; offset += spacing) {
                const base = { x: normal.x * offset, y: normal.y * offset };
                const hits = [];
                for (let i = 0; i < polygon2D.length; i++) {
                    const p1 = polygon2D[i];
                    const p2 = polygon2D[(i + 1) % polygon2D.length];
                    const t = intersectLineSegment(base, dir, p1, p2);
                    if (t !== null) hits.push(t);
                }
                hits.sort((a, b) => a - b);
                for (let i = 0; i + 1 < hits.length; i += 2) {
                    segments.push({
                        a: { x: base.x + dir.x * hits[i], y: base.y + dir.y * hits[i] },
                        b: { x: base.x + dir.x * hits[i + 1], y: base.y + dir.y * hits[i + 1] }
                    });
                }
            }
            return segments;
        }

        function createHatchEntity(boundaryPts3D, opts) {
            const polygon2D = boundaryPts3D.map(p => ({ x: p.x, y: p.y }));
            const group = new THREE.Group();
            group.userData.isHatch = true;
            group.userData.boundaryPts = boundaryPts3D.map(p => p.clone());

            if (opts.pattern === 'solid') {
                const shape = new THREE.Shape(boundaryPts3D.map(p => new THREE.Vector2(p.x, p.y)));
                const geometry = new THREE.ShapeGeometry(shape);
                const material = new THREE.MeshBasicMaterial({
                    color: opts.color, transparent: true, opacity: opts.opacity, side: THREE.DoubleSide, depthWrite: false
                });
                group.add(new THREE.Mesh(geometry, material));
            } else {
                const spacing = Math.max(opts.spacing, 0.01);
                const angleRad = THREE.MathUtils.degToRad(opts.angle);
                let segs = clipLinesToPolygon(polygon2D, angleRad, spacing);
                if (opts.pattern === 'cross') {
                    segs = segs.concat(clipLinesToPolygon(polygon2D, angleRad + Math.PI / 2, spacing));
                }
                const material = new THREE.LineBasicMaterial({ color: opts.color, transparent: true, opacity: opts.opacity });
                segs.forEach(seg => {
                    const geo = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(seg.a.x, seg.a.y, 0),
                        new THREE.Vector3(seg.b.x, seg.b.y, 0)
                    ]);
                    group.add(new THREE.Line(geo, material));
                });

                // Mesh trong suốt phủ kín vùng biên để click-chọn được ở BẤT KỲ đâu trong vùng hatch
                // (giống AutoCAD), không chỉ đúng ngay trên từng đường gạch mảnh.
                const hitShape = new THREE.Shape(boundaryPts3D.map(p => new THREE.Vector2(p.x, p.y)));
                const hitGeo = new THREE.ShapeGeometry(hitShape);
                const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
                group.add(new THREE.Mesh(hitGeo, hitMat));
            }

            return group;
        }

        // --- Preview (rubber-band) ---
        function clearPreview() {
            if (previewObject) {
                scene.remove(previewObject);
                previewObject.geometry.dispose();
                previewObject.material.dispose();
                previewObject = null;
            }
        }

        function setPreview(points, closed) {
            clearPreview();
            if (points.length < 2) return;
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineDashedMaterial({ color: 0x00e5ff, dashSize: 6, gapSize: 4 });
            previewObject = closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
            previewObject.computeLineDistances();
            scene.add(previewObject);
        }

        // --- Chọn / bỏ chọn entity ---
        function selectEntity(id, additive) {
            if (!additive) clearSelection();
            selectedIds.add(id);
            setEntityColor(entities.get(id).object, SELECT_COLOR);
            updatePropertiesPanel();
        }
        function deselectEntity(id) {
            selectedIds.delete(id);
            const e = entities.get(id);
            if (e) {
                const layer = layers.get(e.layerName);
                setEntityColor(e.object, layer ? layer.color : DRAW_COLOR);
            }
        }
        function clearSelection() {
            selectedIds.forEach(id => deselectEntity(id));
            selectedIds.clear();
            updatePropertiesPanel();
        }
        function updatePropertiesPanel() {
            const container = document.getElementById('prop-content');
            if (selectedIds.size === 0) {
                renderViewProperties(container);
                return;
            }
            if (selectedIds.size > 1) {
                renderMultiSelectionProperties(container);
                return;
            }
            const entity = entities.get(Array.from(selectedIds)[0]);
            renderSingleEntityProperties(container, entity);
        }

        // Không chọn gì -> hiện thông tin khung nhìn hiện tại (giống Properties palette AutoCAD thật)
        function renderViewProperties(container) {
            const dist = camera.position.distanceTo(controls.target) || 1000;
            const vFOV = THREE.MathUtils.degToRad(camera.fov);
            const height = 2 * Math.tan(vFOV / 2) * dist;
            const width = height * camera.aspect;
            container.innerHTML = `
                <div class="prop-section-header">View</div>
                ${propRow('Center X', controls.target.x.toFixed(4))}
                ${propRow('Center Y', controls.target.y.toFixed(4))}
                ${propRow('Center Z', controls.target.z.toFixed(4))}
                ${propRow('Height', height.toFixed(4))}
                ${propRow('Width', width.toFixed(4))}
                <div style="color:#777; font-size:11px; padding:10px 8px;">Chưa chọn đối tượng.</div>
            `;
        }

        function renderMultiSelectionProperties(container) {
            const list = Array.from(selectedIds).map(id => entities.get(id));
            container.innerHTML = `
                <div class="prop-section-header">General</div>
                ${propRow('Đối tượng', list.length + ' đã chọn')}
                <div style="max-height:110px; overflow-y:auto; padding:2px 8px; font-size:11px; color:#9cdcfe;">
                    ${list.map(e => `${e.type} (ID ${e.id})`).join('<br>')}
                </div>
                <div class="prop-row"><span class="prop-label">Layer</span><span class="prop-value" id="prop-layer-cell"></span></div>
            `;
            attachLayerDropdown(document.getElementById('prop-layer-cell'), list, () => updatePropertiesPanel());
        }

        // Tạo 1 dropdown chọn Layer, gắn vào cellEl, áp dụng cho toàn bộ entity trong list khi đổi
        function attachLayerDropdown(cellEl, list, onDone) {
            const select = document.createElement('select');
            select.style.cssText = 'width:100%; background:#2a2a2a; color:#fff; border:1px solid #444; padding:2px 4px; border-radius:2px; font-size:11px;';
            layers.forEach(layer => {
                const opt = document.createElement('option');
                opt.value = layer.name;
                opt.innerText = layer.name;
                select.appendChild(opt);
            });
            const distinctLayers = new Set(list.map(e => e.layerName));
            if (distinctLayers.size === 1) select.value = list[0].layerName;
            select.onchange = () => {
                const newLayer = layers.get(select.value);
                if (!newLayer) return;
                list.forEach(e => {
                    e.layerName = newLayer.name;
                    e.object.visible = newLayer.visible;
                    if (!newLayer.visible) deselectEntity(e.id);
                });
                rebuildSnapCandidates();
                onDone();
            };
            cellEl.appendChild(select);
        }

        function propRow(label, valueHtml) {
            return `<div class="prop-row"><span class="prop-label">${label}</span><span class="prop-value">${valueHtml}</span></div>`;
        }
        function propInputRow(label, id, value) {
            return `<div class="prop-row"><span class="prop-label">${label}</span><span class="prop-value"><input type="text" id="${id}" value="${value}"></span></div>`;
        }

        // 1 đối tượng đang chọn -> hiện General (Layer) + Geometry riêng theo loại (sửa trực tiếp được)
        function renderSingleEntityProperties(container, entity) {
            let geometryHtml = '';

            if (entity.type === 'POINT') {
                const xy = entity.object.userData.pointXY;
                const z = entity.object.userData.elevation;
                geometryHtml = `
                    <div class="prop-section-header">Geometry</div>
                    ${propInputRow('X', 'prop-field-x', xy.x.toFixed(4))}
                    ${propInputRow('Y', 'prop-field-y', xy.y.toFixed(4))}
                    ${propInputRow('Z (cao độ)', 'prop-field-z', z.toFixed(4))}
                `;
            } else if (entity.type === 'LINE') {
                const posAttr = entity.object.geometry.attributes.position;
                const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, 0);
                const p2 = new THREE.Vector3().fromBufferAttribute(posAttr, 1);
                geometryHtml = `
                    <div class="prop-section-header">Geometry</div>
                    ${propInputRow('Start X', 'prop-field-x1', p1.x.toFixed(4))}
                    ${propInputRow('Start Y', 'prop-field-y1', p1.y.toFixed(4))}
                    ${propInputRow('End X', 'prop-field-x2', p2.x.toFixed(4))}
                    ${propInputRow('End Y', 'prop-field-y2', p2.y.toFixed(4))}
                `;
            } else if (entity.type === 'CIRCLE') {
                const { center, radius } = estimateCircleFromEntity(entity.object);
                geometryHtml = `
                    <div class="prop-section-header">Geometry</div>
                    ${propInputRow('Center X', 'prop-field-cx', center.x.toFixed(4))}
                    ${propInputRow('Center Y', 'prop-field-cy', center.y.toFixed(4))}
                    ${propInputRow('Radius', 'prop-field-radius', radius.toFixed(4))}
                `;
            } else if (entity.type === 'TEXT') {
                const txt = String(entity.object.userData.text || '').replace(/"/g, '&quot;');
                geometryHtml = `
                    <div class="prop-section-header">Text</div>
                    ${propInputRow('Nội dung', 'prop-field-text', txt)}
                `;
            } else if (entity.type === 'CORRIDOR') {
                const ci = entity.object.userData.corridorInfo || {};
                geometryHtml = `
                    <div class="prop-section-header">Corridor</div>
                    ${propRow('Alignment', ci.alignmentName || '—')}
                    ${propRow('Số mặt cắt', ci.stationCount || '—')}
                    ${propRow('Cao độ theo', ci.baselineSource || '—')}
                    <div style="padding: 8px;">
                        <button class="tool-btn primary" style="min-width:auto; width:100%; flex-direction:row; gap:6px;" onclick="rebuildCorridor(entities.get(${entity.id}))">🔄 Rebuild theo dữ liệu mới nhất</button>
                    </div>
                `;
            } else if (entity.type === 'PROFILEVIEW') {
                const pi = entity.object.userData.profileInfo || {};
                const pvis = entity.object.userData.fgPVIs || [];
                const pviRowsHtml = pvis.length === 0
                    ? `<div style="color:#777; font-size:11px; padding:6px 8px;">Chưa có PVI nào (chỉ có EG).</div>`
                    : pvis.map((pvi, i) => `
                        <div class="prop-row">
                            <span class="prop-label">PVI ${i + 1}</span>
                            <span class="prop-value" style="display:flex; gap:4px;">
                                <input type="text" class="pvi-station-input" data-idx="${i}" title="Lý trình" value="${pvi.station.toFixed(2)}" style="width:50%;">
                                <input type="text" class="pvi-elev-input" data-idx="${i}" title="Cao độ" value="${pvi.elevation.toFixed(3)}" style="width:50%;">
                            </span>
                        </div>
                    `).join('');
                geometryHtml = `
                    <div class="prop-section-header">Profile View (Trắc dọc)</div>
                    ${propRow('Alignment', pi.alignmentName || '—')}
                    ${propRow('Số điểm PVI', pvis.length)}
                    <div style="padding: 8px 8px 4px;">
                        <button class="tool-btn primary" style="min-width:auto; width:100%; flex-direction:row; gap:6px;" onclick="startEditProfilePVI(entities.get(${entity.id}))">🖱️ Kéo điểm PVI trên trắc dọc</button>
                    </div>
                    <div class="prop-section-header">Sửa số trực tiếp (Lý trình / Cao độ)</div>
                    <div id="pvi-edit-rows">${pviRowsHtml}</div>
                `;
            } else if (entity.type === 'SECTIONVIEWS') {
                const si = entity.object.userData.sectionInfo || {};
                const tot = entity.object.userData.sectionTotals || null;
                const totalsRowsHtml = tot ? `
                    ${propRow('Đào nền (tổng)', tot.totalCutVol.toFixed(2) + ' m3')}
                    ${propRow('Đắp nền (tổng)', tot.totalEmbankVol.toFixed(2) + ' m3')}
                    ${Object.values(tot.totalLayerValues).map(lv => propRow(lv.name, lv.value.toFixed(2) + ' ' + lv.unit)).join('')}
                ` : '';
                geometryHtml = `
                    <div class="prop-section-header">Trắc ngang (Section Views)</div>
                    ${propRow('Alignment', si.alignmentName || '—')}
                    ${propRow('Số mặt cắt', si.count || '—')}
                    ${propRow('Khoảng cách cọc', (si.interval || '—') + ' m')}
                    ${propRow('Cao độ theo', si.baselineSource || '—')}
                    <div class="prop-section-header">Tổng hợp khối lượng toàn tuyến</div>
                    ${totalsRowsHtml}
                `;
            }

            container.innerHTML = `
                <div class="prop-section-header">General</div>
                ${propRow('Loại', entity.type + ' (ID ' + entity.id + ')')}
                ${propRow('Màu', 'ByLayer')}
                <div class="prop-row"><span class="prop-label">Layer</span><span class="prop-value" id="prop-layer-cell"></span></div>
                ${geometryHtml}
            `;

            attachLayerDropdown(document.getElementById('prop-layer-cell'), [entity], () => updatePropertiesPanel());

            container.querySelectorAll('.prop-value input').forEach(input => {
                input.addEventListener('change', () => applyPropertyEdits(entity));
                input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
            });

            // Ô nhập số riêng cho từng PVI của Profile View — sửa xong (blur/Enter) là rebuild lại ngay
            container.querySelectorAll('.pvi-station-input, .pvi-elev-input').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx, 10);
                    const val = parseFloat(input.value.replace(',', '.'));
                    if (isNaN(val) || !entity.object.userData.fgPVIs[idx]) { updatePropertiesPanel(); return; }
                    const pvis = entity.object.userData.fgPVIs.map(p => ({ ...p }));
                    if (input.classList.contains('pvi-station-input')) pvis[idx].station = val;
                    else pvis[idx].elevation = val;
                    rebuildProfileViewEntity(entity, pvis);
                    setCommandText(`Command: Đã cập nhật PVI ${idx + 1}.`);
                    updatePropertiesPanel();
                });
                input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
            });
        }

        // Đọc lại các ô input trong panel Properties và áp dụng thay đổi hình học trực tiếp lên entity
        // Lưu ý: các chỉnh sửa này KHÔNG đi qua hệ Undo/Redo (chỉ áp dụng cho thao tác vẽ/sửa bằng công cụ)
        function applyPropertyEdits(entity) {
            if (entity.type === 'POINT') {
                const x = parseFloat(document.getElementById('prop-field-x').value);
                const y = parseFloat(document.getElementById('prop-field-y').value);
                const z = parseFloat(document.getElementById('prop-field-z').value);
                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) updatePointGeometry(entity, x, y, z);
            } else if (entity.type === 'LINE') {
                const x1 = parseFloat(document.getElementById('prop-field-x1').value);
                const y1 = parseFloat(document.getElementById('prop-field-y1').value);
                const x2 = parseFloat(document.getElementById('prop-field-x2').value);
                const y2 = parseFloat(document.getElementById('prop-field-y2').value);
                if ([x1, y1, x2, y2].every(v => !isNaN(v))) updateLineGeometry(entity, x1, y1, x2, y2);
            } else if (entity.type === 'CIRCLE') {
                const cx = parseFloat(document.getElementById('prop-field-cx').value);
                const cy = parseFloat(document.getElementById('prop-field-cy').value);
                const r = parseFloat(document.getElementById('prop-field-radius').value);
                if ([cx, cy, r].every(v => !isNaN(v)) && r > 0) updateCircleGeometry(entity, cx, cy, r);
            } else if (entity.type === 'TEXT') {
                const val = document.getElementById('prop-field-text').value;
                if (val.trim() !== '') { updateTextSpriteContent(entity.object, val.trim()); rebuildSnapCandidates(); }
            }
        }

        function updatePointGeometry(entity, newX, newY, newZ) {
            const obj = entity.object;
            const oldXY = obj.userData.pointXY;
            const dx = newX - oldXY.x, dy = newY - oldXY.y;
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
                applyMatrixToEntity(obj, new THREE.Matrix4().makeTranslation(dx, dy, 0));
            }
            if (newZ !== obj.userData.elevation) {
                obj.userData.elevation = newZ;
                const oldLabel = obj.children.find(c => c.isSprite);
                if (oldLabel) {
                    const pos = oldLabel.position.clone();
                    const h = oldLabel.scale.y;
                    obj.remove(oldLabel);
                    oldLabel.material.map.dispose();
                    oldLabel.material.dispose();
                    obj.add(createTextSprite(newZ.toFixed(2), pos, h));
                }
            }
            rebuildSnapCandidates();
            renderPointsPanel();
        }

        function updateLineGeometry(entity, x1, y1, x2, y2) {
            entity.object.geometry.dispose();
            entity.object.geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x1, y1, 0), new THREE.Vector3(x2, y2, 0)
            ]);
            rebuildSnapCandidates();
        }

        function updateCircleGeometry(entity, cx, cy, radius) {
            const pts = buildCirclePoints(new THREE.Vector3(cx, cy, 0), new THREE.Vector3(cx + radius, cy, 0));
            entity.object.geometry.dispose();
            entity.object.geometry = new THREE.BufferGeometry().setFromPoints(pts);
            rebuildSnapCandidates();
        }

        // Vẽ lại canvas texture của 1 Text sprite với nội dung mới (giữ nguyên chiều cao hiển thị)
        function updateTextSpriteContent(sprite, newText) {
            const fontPx = 64, padding = 12;
            const canvasEl = document.createElement('canvas');
            const ctx = canvasEl.getContext('2d');
            ctx.font = `${fontPx}px Consolas, monospace`;
            const metrics = ctx.measureText(newText);
            canvasEl.width = Math.max(1, Math.ceil(metrics.width) + padding * 2);
            canvasEl.height = fontPx + padding * 2;
            ctx.font = `${fontPx}px Consolas, monospace`;
            ctx.fillStyle = '#7fffd4';
            ctx.textBaseline = 'top';
            ctx.fillText(newText, padding, padding);

            const oldHeight = sprite.scale.y;
            sprite.material.map.dispose();
            sprite.material.map = new THREE.CanvasTexture(canvasEl);
            const aspect = canvasEl.width / canvasEl.height;
            sprite.scale.set(oldHeight * aspect, oldHeight, 1);
            sprite.userData.text = newText;
        }

        // --- Chọn quét (Window / Crossing selection), giống AutoCAD ---
        // Kéo chuột trái sang PHẢI  -> Window: chỉ chọn đối tượng nằm TRỌN VẸN trong khung
        // Kéo chuột trái sang TRÁI  -> Crossing: chỉ cần đối tượng CHẠM khung là được chọn
        const selectionBoxEl = document.getElementById('selection-box');
        let boxSelectStart = null;   // { x, y } toạ độ client lúc mousedown
        let isBoxSelecting = false;  // đã vượt ngưỡng kéo, đang hiển thị khung chọn
        let suppressNextClick = false; // để 'click' phát sinh sau khi kéo-thả không chọn nhầm
        const BOX_SELECT_DRAG_THRESHOLD = 4; // px

        function worldToScreen(vector3) {
            const v = vector3.clone().project(camera);
            const rect = renderer.domElement.getBoundingClientRect();
            return {
                x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
                y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
            };
        }

        function updateSelectionBoxUI(start, end) {
            const isWindowMode = end.x >= start.x;
            selectionBoxEl.style.left = Math.min(start.x, end.x) + 'px';
            selectionBoxEl.style.top = Math.min(start.y, end.y) + 'px';
            selectionBoxEl.style.width = Math.abs(end.x - start.x) + 'px';
            selectionBoxEl.style.height = Math.abs(end.y - start.y) + 'px';
            selectionBoxEl.style.display = 'block';
            if (isWindowMode) {
                // Window: khung xanh dương, viền liền (giống AutoCAD)
                selectionBoxEl.style.border = '1px solid #4ea1ff';
                selectionBoxEl.style.background = 'rgba(78, 161, 255, 0.15)';
            } else {
                // Crossing: khung xanh lá, viền đứt nét
                selectionBoxEl.style.border = '1px dashed #4caf50';
                selectionBoxEl.style.background = 'rgba(76, 175, 80, 0.12)';
            }
        }

        function hideSelectionBoxUI() {
            selectionBoxEl.style.display = 'none';
        }

        // Kiểm tra 2 đoạn thẳng p1-p2 và p3-p4 (toạ độ màn hình) có cắt nhau không
        function segmentsIntersect(p1, p2, p3, p4) {
            const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
            return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
        }

        // Kiểm tra đoạn thẳng p1-p2 có cắt qua (chạm) hình chữ nhật [minX,minY]-[maxX,maxY] không
        function segmentIntersectsRect(p1, p2, minX, minY, maxX, maxY) {
            const corners = [
                { x: minX, y: minY }, { x: maxX, y: minY },
                { x: maxX, y: maxY }, { x: minX, y: maxY }
            ];
            for (let i = 0; i < 4; i++) {
                if (segmentsIntersect(p1, p2, corners[i], corners[(i + 1) % 4])) return true;
            }
            return false;
        }

        function performBoxSelection(start, end, additive) {
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            const isWindowMode = end.x >= start.x; // trái -> phải = Window (bọc kín)

            if (!additive) clearSelection();

            entities.forEach((entity) => {
                if (!entity.object.visible) return; // layer đang ẩn -> bỏ qua
                if (layers.get(entity.layerName)?.locked) return; // layer bị khoá -> không cho chọn
                const worldPts = [];
                collectSnapPointsFromObject3D(entity.object, worldPts);
                if (worldPts.length === 0) return;
                const screenPts = worldPts.map(worldToScreen);

                let match;
                if (isWindowMode) {
                    // Window: TẤT CẢ điểm phải nằm trong khung
                    match = screenPts.every(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
                } else {
                    // Crossing: chỉ cần 1 điểm nằm trong khung, hoặc 1 đoạn cắt qua khung
                    match = screenPts.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
                    // Kiểm tra đoạn cắt biên khung: chỉ áp dụng cho entity đơn (Line/LineLoop) vì với
                    // entity Group (VD: Dimension gồm nhiều Line con) các điểm không tạo thành 1 chuỗi liên tục.
                    if (!match && !entity.object.isGroup) {
                        const closed = entity.object.type === 'LineLoop';
                        const segCount = closed ? screenPts.length : screenPts.length - 1;
                        for (let i = 0; i < segCount && !match; i++) {
                            const p1 = screenPts[i];
                            const p2 = screenPts[(i + 1) % screenPts.length];
                            if (segmentIntersectsRect(p1, p2, minX, minY, maxX, maxY)) match = true;
                        }
                    }
                }

                if (match) selectEntity(entity.id, true);
            });

            setCommandText(`Command: ${isWindowMode ? 'Window' : 'Crossing'} — đã chọn ${selectedIds.size} đối tượng.`);
        }

        // --- Điều khiển công cụ (tool state machine) ---
        const TOOL_HINTS = {
            select: 'Click để chọn 1 đối tượng, Shift+Click để chọn thêm. Kéo chuột trái sang PHẢI = Window (chọn trọn vẹn), kéo sang TRÁI = Crossing (chỉ cần chạm).',
            line: 'Chỉ định điểm đầu của đoạn thẳng:',
            polyline: 'Chỉ định điểm bắt đầu polyline (Enter/Esc để kết thúc):',
            circle: 'Chỉ định tâm đường tròn:',
            rectangle: 'Chỉ định góc thứ nhất của hình chữ nhật:',
            move: 'Chọn đối tượng cần di chuyển rồi bấm Move, sau đó chỉ định điểm gốc:',
            copy: 'Chọn đối tượng cần sao chép rồi bấm Copy, sau đó chỉ định điểm gốc:',
            rotate: 'Chọn đối tượng cần xoay rồi bấm Rotate, chỉ định tâm xoay, sau đó click điểm tham chiếu HOẶC gõ số để nhập thẳng góc xoay:',
            text: 'Chỉ định điểm chèn Text (sẽ hỏi nội dung ngay sau khi click):',
            point: 'Chỉ định vị trí đặt Point (sẽ hỏi cao độ Z ngay sau khi click):',
            dimension: 'Chỉ định điểm gióng thứ nhất của Linear Dimension:',
            'dimension-angular': 'Chỉ định đỉnh góc (điểm gốc) của Angular Dimension:',
            'dimension-diameter': 'Click vào 1 đường tròn (Circle) để đo đường kính:',
            hatch: 'Click vào viền 1 vùng khép kín, HOẶC click vào bên trong vùng được bao bởi nhiều đoạn rời, để tạo Hatch:',
            scale: 'Chọn đối tượng cần scale rồi bấm Scale, chỉ định điểm gốc, sau đó click điểm tham chiếu + điểm đích HOẶC gõ số để nhập thẳng hệ số tỉ lệ:',
            offset: 'Nhập khoảng cách Offset ở ô bên dưới, sau đó click vào đối tượng cần Offset:',
            trim: 'Click vào đối tượng cắt (cutting edge) trước, sau đó click vào phần thừa của đối tượng khác để cắt bỏ:',
            alignment: 'Nhập thông số ở ô bên dưới, sau đó click các điểm PI dọc tuyến (Enter để hoàn tất, Esc để huỷ):',
            'profile-pick': 'Click vào 1 Alignment trên bản vẽ để tạo Profile View (cần có Surface trước để trích cao độ):',
            'profile-place': 'Chỉ định vị trí đặt Profile View trên bản vẽ:',
            'profile-pvi': 'Click các điểm PVI để thiết kế đường đỏ FG (Enter/Esc để hoàn tất):',
            'corridor-pick': 'Click vào 1 Alignment để tạo Corridor (dùng Assembly hiện tại, cần Surface hoặc Profile FG để có cao độ):',
            'corridor-interval': 'Nhập khoảng cách giữa các mặt cắt ở ô bên dưới:',
            'profile-edit-pvi': 'Kéo 1 điểm PVI (vòng tròn vàng) trên trắc dọc để sửa vị trí, hoặc bấm đúng vào điểm để nhập số chính xác. Esc để xong.',
            'section-pick': 'Click vào 1 Alignment để chạy Trắc ngang (cần Surface để lấy EG, dùng Assembly hiện tại):',
            'section-interval': 'Nhập khoảng cách cọc, phạm vi lấy EG mỗi bên, hệ số taluy, và phóng đại đứng (để trống = tự động) ở ô bên dưới:',
            'section-place': 'Chỉ định vị trí đặt lưới các tờ mặt cắt ngang trên bản vẽ:',
            'intersection-pick1': 'Click vào Alignment ƯU TIÊN (tuyến chính, quyết định cao độ làm phẳng tại nút giao):',
            'intersection-pick2': 'Click vào Alignment thứ 2 (tuyến giao với tuyến ưu tiên):',
            'intersection-radius': 'Nhập bán kính bo góc ở ô bên dưới:'
        };

        function setCommandText(text) {
            document.getElementById('command-line').innerText = text;
        }

        function setTool(tool) {
            // Move/Copy/Rotate/Scale cần có sẵn selection trước khi kích hoạt
            if ((tool === 'move' || tool === 'copy' || tool === 'rotate' || tool === 'scale') && selectedIds.size === 0) {
                setCommandText('Command: Hãy chọn đối tượng trước khi dùng Move/Copy/Rotate/Scale.');
                return;
            }
            clearPreview();
            tempPoints = [];
            activeTool = tool;

            if (tool !== 'trim') { trimCuttingEdge = null; trimCuttingSegments = []; }
            if (tool !== 'offset') { closeOffsetDistanceInput(); offsetPendingSource = null; }
            if (tool !== 'alignment') { closeAlignmentOptions(); alignmentParams = null; }
            if (tool !== 'profile-place' && tool !== 'profile-pvi') {
                closeProfileCurvePopup();
                if (pendingProfilePreviewGroup) { scene.remove(pendingProfilePreviewGroup); pendingProfilePreviewGroup = null; }
                if (tool !== 'profile-pick') { pendingProfileAlignment = null; pendingProfileEG = []; pendingProfileScale = null; pendingProfileFGWorld = []; }
            }
            if (tool !== 'corridor-interval') { closeCorridorIntervalPopup(); if (tool !== 'corridor-pick') pendingCorridorAlignment = null; }
            if (tool !== 'section-interval') { closeSectionIntervalPopup(); if (tool !== 'section-pick' && tool !== 'section-place') pendingSectionAlignment = null; }
            if (tool !== 'intersection-radius') { closeIntersectionRadiusPopup(); if (tool !== 'intersection-pick1' && tool !== 'intersection-pick2') { pendingIntersectionAlignA = null; pendingIntersectionAlignB = null; } }
            if (tool !== 'profile-edit-pvi') { editingProfileEntity = null; draggingPVIIndex = null; draggingPVIRef = null; }

            document.querySelectorAll('.tool-target').forEach(b => b.classList.remove('active-tool'));
            const btn = document.getElementById('tool-' + tool);
            if (btn) btn.classList.add('active-tool');

            container.classList.toggle('mode-draw', tool !== 'select');
            setCommandText('Command: ' + TOOL_HINTS[tool]);

            if (tool === 'offset') openOffsetDistanceInput(); // Offset cần khoảng cách trước khi chọn đối tượng
            if (tool === 'alignment') openAlignmentOptions(); // Alignment cần thông số trước khi click các điểm PI
        }

        function eraseSelection() {
            if (selectedIds.size === 0) {
                setCommandText('Command: Chưa có đối tượng nào được chọn để Erase.');
                return;
            }
            execute(makeDeleteCommand(Array.from(selectedIds)));
            selectedIds.clear();
            document.getElementById('prop-content').innerHTML = '<p style="color:#777;">Chưa chọn đối tượng.</p>';
            setCommandText('Command: ERASE — đã xoá đối tượng.');
            renderPointsPanel();
        }

        // --- Bắt đầu/kết thúc kéo-quét chọn đối tượng (chỉ áp dụng khi đang ở tool Select) ---
        // Lưu ý: dùng Pointer Events (không dùng mousedown/mousemove/mouseup) vì từ three.js r120
        // trở đi, OrbitControls gọi preventDefault() trên pointerdown/pointermove, việc này khiến
        // trình duyệt KHÔNG còn tự sinh ra các sự kiện mousedown/mousemove/mouseup tương ứng nữa
        // (do OrbitControls đã đăng ký capture pointer trên chính canvas này).
        renderer.domElement.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return; // chỉ chuột trái
            if (activeTool === 'profile-edit-pvi' && editingProfileEntity) {
                pviPointerDownPos = { x: event.clientX, y: event.clientY };
                const idx = findNearestPVIAt(editingProfileEntity, event);
                if (idx !== -1) {
                    draggingPVIIndex = idx;
                    draggingPVIRef = editingProfileEntity.object.userData.fgPVIs[idx];
                }
                return;
            }
            if (activeTool !== 'select') return;
            boxSelectStart = { x: event.clientX, y: event.clientY };
            isBoxSelecting = false;
        });

        renderer.domElement.addEventListener('pointermove', (event) => {
            if (activeTool === 'profile-edit-pvi' && draggingPVIRef) {
                const p = getWorldPoint(event);
                if (!p) return;
                const conv = profileScaleFromWorld(editingProfileEntity.object.userData.profileScale, p);
                draggingPVIRef.station = conv.station;
                draggingPVIRef.elevation = conv.elevation;
                rebuildProfileViewEntity(editingProfileEntity, editingProfileEntity.object.userData.fgPVIs);
                setCommandText(`Command: Đang kéo PVI — Lý trình ${formatStation(conv.station)}, Cao độ ${conv.elevation.toFixed(3)}.`);
                return;
            }
            if (activeTool !== 'select' || !boxSelectStart) return;
            const dx = event.clientX - boxSelectStart.x;
            const dy = event.clientY - boxSelectStart.y;
            if (!isBoxSelecting && Math.hypot(dx, dy) > BOX_SELECT_DRAG_THRESHOLD) {
                isBoxSelecting = true;
            }
            if (isBoxSelecting) {
                updateSelectionBoxUI(boxSelectStart, { x: event.clientX, y: event.clientY });
            }
        });

        window.addEventListener('pointerup', (event) => {
            if (event.button !== 0) return;
            if (activeTool === 'profile-edit-pvi') {
                const wasDragging = draggingPVIRef && pviPointerDownPos &&
                    Math.hypot(event.clientX - pviPointerDownPos.x, event.clientY - pviPointerDownPos.y) > BOX_SELECT_DRAG_THRESHOLD;
                if (wasDragging) {
                    setCommandText('Command: Đã sửa xong vị trí PVI. Kéo tiếp điểm khác, hoặc Esc để xong.');
                } else if (editingProfileEntity && pviPointerDownPos) {
                    // Không kéo (chỉ click) đúng vào 1 PVI -> mở sẵn ô nhập số chính xác trong Properties panel
                    const idx = findNearestPVIAt(editingProfileEntity, event);
                    if (idx !== -1) {
                        selectEntity(editingProfileEntity.id);
                        const input = document.querySelector(`.pvi-station-input[data-idx="${idx}"]`);
                        if (input) { input.focus(); input.select(); }
                        setCommandText(`Command: Nhập lý trình/cao độ chính xác cho PVI ${idx + 1} ở Properties panel bên phải, Enter để áp dụng.`);
                    }
                }
                draggingPVIIndex = null; draggingPVIRef = null; pviPointerDownPos = null;
                suppressNextClick = true; // tránh 'click' bắn tiếp gây chọn nhầm đối tượng phía dưới
            }
            if (activeTool === 'select' && boxSelectStart) {
                if (isBoxSelecting) {
                    performBoxSelection(boxSelectStart, { x: event.clientX, y: event.clientY }, event.shiftKey);
                    suppressNextClick = true; // 'click' sẽ bắn ngay sau đây, cần bỏ qua nó
                }
                hideSelectionBoxUI();
                isBoxSelecting = false;
                boxSelectStart = null;
            }
        });

        // --- Xử lý click chuột theo tool đang chọn ---
        renderer.domElement.addEventListener('click', (event) => {
            if (suppressNextClick) { suppressNextClick = false; return; }

            if (activeTool === 'select') {
                const hit = pickEntityAt(event);
                if (!hit) { clearSelection(); return; }
                selectEntity(hit.id, event.shiftKey);
                setCommandText(`Command: Đã chọn ${hit.type} (ID ${hit.id}).`);
                return;
            }

            const p = getWorldPoint(event);
            if (!p) return;

            switch (activeTool) {
                case 'line': handleLinePoint(p); break;
                case 'polyline': handlePolylinePoint(p); break;
                case 'circle': handleCirclePoint(p); break;
                case 'rectangle': handleRectanglePoint(p); break;
                case 'alignment': {
                    if (alignmentParams === null) break; // đang chờ nhập thông số ở popup
                    tempPoints.push(p.clone());
                    setCommandText(`Command: PI thứ ${tempPoints.length} đã đặt. Chỉ định PI tiếp theo (Enter để hoàn tất, Esc để huỷ):`);
                    break;
                }
                case 'profile-pick': {
                    const hit = pickEntityOfTypeAt(event, 'ALIGNMENT');
                    if (hit && hit.type === 'ALIGNMENT') {
                        pickAlignmentForProfile(hit);
                    } else {
                        setCommandText('Command: Hãy click vào 1 Alignment để tạo Profile:');
                    }
                    break;
                }
                case 'profile-place': {
                    pendingProfileScale = computeProfileScale({ x: p.x, y: p.y }, pendingProfileEG);
                    openProfileCurvePopup();
                    break;
                }
                case 'profile-pvi': {
                    pendingProfileFGWorld.push(p.clone());
                    rebuildPendingProfilePreview();
                    setCommandText(`Command: Đã đặt PVI thứ ${pendingProfileFGWorld.length}. Click tiếp, hoặc Enter/Esc để hoàn tất:`);
                    break;
                }
                case 'corridor-pick': {
                    const hit = pickEntityOfTypeAt(event, 'ALIGNMENT');
                    if (hit && hit.type === 'ALIGNMENT') {
                        pickAlignmentForCorridor(hit);
                    } else {
                        setCommandText('Command: Hãy click vào 1 Alignment để tạo Corridor:');
                    }
                    break;
                }
                case 'section-pick': {
                    const hit = pickEntityOfTypeAt(event, 'ALIGNMENT');
                    if (hit && hit.type === 'ALIGNMENT') {
                        pickAlignmentForSection(hit);
                    } else {
                        setCommandText('Command: Hãy click vào 1 Alignment để chạy Trắc ngang:');
                    }
                    break;
                }
                case 'section-place': {
                    const result = createSectionViewsEntity(pendingSectionAlignment, currentAssembly, pendingSectionInterval, pendingSectionHalfWidth, pendingSectionTaluyRatio, pendingSectionVertExaggeration, p);
                    if (result.error) {
                        setCommandText('Command: ' + result.error);
                    } else {
                        execute(makeAddCommand('SECTIONVIEWS', result.group));
                        setCommandText(`Command: Đã tạo ${result.count} mặt cắt ngang.`);
                    }
                    pendingSectionAlignment = null;
                    setTool('select');
                    break;
                }
                case 'intersection-pick1': {
                    const hit = pickEntityOfTypeAt(event, 'ALIGNMENT');
                    if (hit && hit.type === 'ALIGNMENT') {
                        pickAlignmentForIntersection1(hit);
                    } else {
                        setCommandText('Command: Click vào Alignment ƯU TIÊN (tuyến chính, sẽ quyết định cao độ làm phẳng tại nút giao):');
                    }
                    break;
                }
                case 'intersection-pick2': {
                    const hit = pickEntityOfTypeAt(event, 'ALIGNMENT');
                    if (hit && hit.type === 'ALIGNMENT') {
                        pickAlignmentForIntersection2(hit);
                    } else {
                        setCommandText('Command: Click vào Alignment thứ 2 (tuyến giao với tuyến ưu tiên):');
                    }
                    break;
                }
                case 'hatch': {
                    const hit = pickEntityAt(event);
                    let boundary = getBoundaryPolygonFromEntity(hit);
                    let boundaryLayerName = hit ? hit.layerName : null;
                    if (!boundary) {
                        // Không trúng sẵn 1 entity khép kín -> thử dò biên ghép từ nhiều đoạn rời quanh điểm click
                        const traced = findEnclosingBoundary({ x: p.x, y: p.y });
                        if (traced) {
                            boundary = traced.map(pt => new THREE.Vector3(pt.x, pt.y, 0));
                            boundaryLayerName = currentLayerName;
                        }
                    }
                    if (boundary) {
                        openHatchOptions(boundary, boundaryLayerName);
                        setCommandText('Command: Chọn Pattern/Màu rồi bấm Apply (hoặc Enter) để tạo Hatch:');
                    } else {
                        setCommandText('Command: Không tìm thấy vùng khép kín tại điểm này. Hãy click vào bên trong (hoặc lên viền) 1 vùng được bao kín:');
                    }
                    break;
                }
                case 'text': {
                    openTextInput(p);
                    setCommandText('Command: Nhập nội dung Text vào ô bên dưới rồi nhấn Enter (Esc để huỷ):');
                    break;
                }
                case 'point': {
                    openPointInput(p);
                    setCommandText('Command: Nhập cao độ (Z) cho Point vào ô bên dưới rồi nhấn Enter (Esc để huỷ):');
                    break;
                }
                case 'dimension': {
                    tempPoints.push(p.clone());
                    if (tempPoints.length === 1) {
                        setCommandText('Command: Chỉ định điểm gióng thứ hai:');
                    } else if (tempPoints.length === 2) {
                        setCommandText('Command: Chỉ định vị trí đường kích thước (offset):');
                    } else if (tempPoints.length === 3) {
                        const group = createDimensionEntity(tempPoints[0], tempPoints[1], tempPoints[2]);
                        if (group) execute(makeAddCommand('DIMENSION', group));
                        tempPoints = [];
                        clearPreview();
                        setCommandText('Command: Chỉ định điểm gióng thứ nhất của Linear Dimension:');
                    }
                    break;
                }
                case 'dimension-angular': {
                    tempPoints.push(p.clone());
                    if (tempPoints.length === 1) {
                        setCommandText('Command: Chỉ định điểm trên cạnh thứ nhất:');
                    } else if (tempPoints.length === 2) {
                        setCommandText('Command: Chỉ định điểm trên cạnh thứ hai:');
                    } else if (tempPoints.length === 3) {
                        const group = createAngularDimensionEntity(tempPoints[0], tempPoints[1], tempPoints[2]);
                        if (group) execute(makeAddCommand('DIMENSION_ANGULAR', group));
                        tempPoints = [];
                        clearPreview();
                        setCommandText('Command: Chỉ định đỉnh góc (điểm gốc) của Angular Dimension:');
                    }
                    break;
                }
                case 'dimension-diameter': {
                    const hit = pickEntityAt(event);
                    if (hit && hit.type === 'CIRCLE') {
                        const { center, radius } = estimateCircleFromEntity(hit.object);
                        execute(makeAddCommand('DIMENSION_DIAMETER', createDiameterDimensionEntity(center, radius)));
                        setCommandText('Command: Đã thêm Diameter Dimension. Click vào 1 đường tròn khác, hoặc Esc để kết thúc:');
                    } else {
                        setCommandText('Command: Hãy click vào 1 đường tròn (Circle) để đo đường kính:');
                    }
                    break;
                }
                case 'move':
                case 'copy': {
                    tempPoints.push(p.clone());
                    if (tempPoints.length === 2) {
                        const delta = tempPoints[1].clone().sub(tempPoints[0]);
                        const matrix = new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z);
                        const ids = Array.from(selectedIds);

                        if (activeTool === 'copy') {
                            // Copy: nhân bản entity (Line/LineLoop/Sprite/Group đều được) rồi áp transform
                            ids.forEach(id => {
                                const src = entities.get(id);
                                const dup = cloneEntityObject3D(src.object);
                                execute(makeAddCommand(src.type, dup, src.layerName));
                                applyMatrixToEntity(dup, matrix);
                            });
                        } else {
                            execute(makeTransformCommand(ids, matrix));
                        }

                        tempPoints = [];
                        clearPreview();
                        setTool('select');
                        setCommandText(`Command: ${activeTool.toUpperCase()} hoàn tất.`);
                    } else {
                        setCommandText('Command: Chỉ định điểm đích:');
                    }
                    break;
                }
                case 'rotate': {
                    tempPoints.push(p.clone());
                    if (tempPoints.length === 2) {
                        setCommandText('Command: Chỉ định điểm tham chiếu góc xoay (click để xác nhận):');
                    } else if (tempPoints.length === 3) {
                        const pivot = tempPoints[0];
                        const a0 = Math.atan2(tempPoints[1].y - pivot.y, tempPoints[1].x - pivot.x);
                        const a1 = Math.atan2(tempPoints[2].y - pivot.y, tempPoints[2].x - pivot.x);
                        const angle = a1 - a0;

                        const m1 = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, 0);
                        const m2 = new THREE.Matrix4().makeRotationZ(angle);
                        const m3 = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, 0);
                        const matrix = m3.multiply(m2).multiply(m1);

                        execute(makeTransformCommand(Array.from(selectedIds), matrix));

                        tempPoints = [];
                        clearPreview();
                        setTool('select');
                        setCommandText('Command: ROTATE hoàn tất.');
                    }
                    break;
                }
                case 'scale': {
                    tempPoints.push(p.clone());
                    if (tempPoints.length === 1) {
                        setCommandText('Command: Chỉ định điểm tham chiếu (hoặc gõ số để nhập thẳng hệ số tỉ lệ):');
                    } else if (tempPoints.length === 2) {
                        setCommandText('Command: Chỉ định điểm đích để xác định tỉ lệ:');
                    } else if (tempPoints.length === 3) {
                        const base = tempPoints[0];
                        const refDist = base.distanceTo(tempPoints[1]);
                        const finalDist = base.distanceTo(tempPoints[2]);
                        if (refDist > 1e-6) {
                            const factor = finalDist / refDist;
                            const m1 = new THREE.Matrix4().makeTranslation(-base.x, -base.y, 0);
                            const m2 = new THREE.Matrix4().makeScale(factor, factor, 1);
                            const m3 = new THREE.Matrix4().makeTranslation(base.x, base.y, 0);
                            const matrix = m3.multiply(m2).multiply(m1);
                            execute(makeTransformCommand(Array.from(selectedIds), matrix));
                            setCommandText(`Command: SCALE hoàn tất (hệ số ${factor.toFixed(3)}).`);
                        } else {
                            setCommandText('Command: Khoảng cách tham chiếu quá nhỏ, đã huỷ Scale.');
                        }
                        tempPoints = [];
                        clearPreview();
                        setTool('select');
                    }
                    break;
                }
                case 'offset': {
                    if (offsetDistance === null) break; // đang chờ nhập khoảng cách ở popup
                    if (!offsetPendingSource) {
                        const hit = pickEntityAt(event);
                        if (hit && (hit.type === 'LINE' || hit.type === 'POLYLINE' || hit.type === 'CIRCLE' || hit.type === 'RECTANGLE')) {
                            offsetPendingSource = hit;
                            setCommandText('Command: Click về phía muốn Offset:');
                        } else {
                            setCommandText('Command: Hãy click vào 1 Line/Polyline/Circle/Rectangle để Offset:');
                        }
                    } else {
                        const newObj = createOffsetEntity(offsetPendingSource, offsetDistance, p);
                        if (newObj) {
                            execute(makeAddCommand(offsetPendingSource.type, newObj, offsetPendingSource.layerName));
                            setCommandText('Command: Đã Offset. Click đối tượng tiếp theo (cùng khoảng cách), hoặc Esc để đổi khoảng cách:');
                        } else {
                            setCommandText('Command: Offset thất bại (khoảng cách quá lớn?). Click đối tượng khác:');
                        }
                        offsetPendingSource = null;
                    }
                    break;
                }
                case 'trim': {
                    if (!trimCuttingEdge) {
                        const hit = pickEntityAt(event);
                        if (hit && (hit.type === 'LINE' || hit.type === 'POLYLINE' || hit.type === 'CIRCLE' || hit.type === 'RECTANGLE')) {
                            trimCuttingEdge = hit;
                            trimCuttingSegments = getEntitySegments(hit);
                            setCommandText('Command: Click vào phần đối tượng cần cắt bỏ (Trim):');
                        } else {
                            setCommandText('Command: Hãy click vào đối tượng cắt (cutting edge) trước:');
                        }
                    } else {
                        const hit = pickEntityAt(event);
                        if (!hit) {
                            setCommandText('Command: Hãy click trúng 1 đối tượng để Trim:');
                        } else {
                            const result = trimTargetEntity(hit, trimCuttingSegments, p);
                            if (result.points) {
                                execute(makeGeometryReplaceCommand(hit.id, result.points));
                                setCommandText('Command: Đã Trim. Click tiếp đối tượng khác (cùng cutting edge), hoặc Esc để đổi cutting edge:');
                            } else {
                                setCommandText('Command: ' + result.error);
                            }
                        }
                    }
                    break;
                }
            }
        });

        // --- Xem trước (rubber-band) khi rê chuột ---
        renderer.domElement.addEventListener('mousemove', (event) => {
            if (activeTool === 'select') { hideSnapMarker(); return; }
            // Luôn gọi getWorldPoint để marker bắt điểm (OSNAP) hiện ngay khi rê chuột,
            // kể cả trước khi click điểm đầu tiên của lệnh vẽ
            const p = getWorldPoint(event);
            if (!p || tempPoints.length === 0) return;

            switch (activeTool) {
                case 'line':
                    setPreview([tempPoints[tempPoints.length - 1], p], false);
                    break;
                case 'polyline':
                    setPreview([...tempPoints, p], false);
                    break;
                case 'alignment':
                    if (tempPoints.length > 0) setPreview([...tempPoints, p], false);
                    break;
                case 'circle':
                    setPreview(buildCirclePoints(tempPoints[0], p), true);
                    break;
                case 'rectangle':
                    setPreview(buildRectanglePoints(tempPoints[0], p), true);
                    break;
                case 'move':
                case 'copy':
                    setPreview([tempPoints[0], p], false);
                    break;
                case 'rotate':
                    if (tempPoints.length >= 1) setPreview([tempPoints[0], p], false);
                    break;
                case 'scale':
                    if (tempPoints.length >= 1) setPreview([tempPoints[0], p], false);
                    break;
                case 'dimension':
                    if (tempPoints.length === 1) setPreview([tempPoints[0], p], false);
                    else if (tempPoints.length === 2) setPreview([tempPoints[0], p, tempPoints[1]], false);
                    break;
                case 'dimension-angular':
                    if (tempPoints.length === 1) setPreview([tempPoints[0], p], false);
                    else if (tempPoints.length === 2) setPreview([tempPoints[0], tempPoints[1], tempPoints[0], p], false);
                    break;
            }
        });

        // Ngăn OrbitControls bắt sự kiện click khi đang thao tác vẽ (double-click để orbit vẫn hoạt động bình thường)
        renderer.domElement.addEventListener('dblclick', (event) => {
            if (activeTool === 'polyline' && tempPoints.length >= 2) {
                finishPolyline();
                event.stopPropagation();
            }
        });

        function finishPolyline() {
            if (tempPoints.length >= 2) {
                const obj = buildLineObject(tempPoints, false);
                execute(makeAddCommand('POLYLINE', obj));
            }
            tempPoints = [];
            clearPreview();
            setCommandText('Command: Chỉ định điểm bắt đầu polyline (Enter/Esc để kết thúc):');
        }

        // --- Phím tắt ---
        window.addEventListener('keydown', (event) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undoAction(); return; }
            if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redoAction(); return; }

            if (event.key === 'Escape') {
                if (activeTool === 'profile-pvi') { finishProfileView(); return; }
                if (activeTool === 'profile-edit-pvi') {
                    editingProfileEntity = null; draggingPVIIndex = null; draggingPVIRef = null;
                    setTool('select');
                    setCommandText('Command: Đã thoát chế độ sửa PVI.');
                    return;
                }
                if (pendingHatchBoundary) closeHatchOptions();
                tempPoints = [];
                clearPreview();
                setTool('select');
                return;
            }
            if (event.key === 'Enter' && activeTool === 'polyline') {
                finishPolyline();
                return;
            }
            if (event.key === 'Enter' && activeTool === 'alignment') {
                finishAlignment();
                return;
            }
            if (event.key === 'Enter' && activeTool === 'profile-pvi') {
                finishProfileView();
                return;
            }
            if (event.key === 'Delete') {
                eraseSelection();
                return;
            }
            if (event.key === 'F3') {
                event.preventDefault();
                toggleSnap();
                return;
            }
            if (event.key === 'F8') {
                event.preventDefault();
                toggleOrtho();
                return;
            }
            if (/^[0-9\-.]$/.test(event.key) && tempPoints.length > 0 &&
                (activeTool === 'line' || activeTool === 'polyline' || activeTool === 'rectangle' || activeTool === 'circle' ||
                 (activeTool === 'rotate' && tempPoints.length === 1) ||
                 (activeTool === 'scale' && tempPoints.length === 1))) {
                event.preventDefault();
                openNumericInput(event.key);
                return;
            }

            switch (event.key.toLowerCase()) {
                case 'l': setTool('line'); break;
                case 'p': setTool('polyline'); break;
                case 'c': setTool('circle'); break;
                case 'r': setTool('rectangle'); break;
                case 'm': setTool('move'); break;
                case 'o': if (selectedIds.size > 0) setTool('copy'); break; // 'O' = cOpy (tránh trùng phím C=Circle)
                case 't': setTool('text'); break;
                case 'd': setTool('dimension'); break;
                case 'h': setTool('hatch'); break;
                case 's': if (selectedIds.size > 0) setTool('scale'); break;
                case 'a': setTool('alignment'); break;
            }
        });

        // Khởi động ở chế độ Select
        setTool('select');
        updatePropertiesPanel();

        // Khởi động vòng lặp render — ĐẶT Ở ĐÂY (file tải sau cùng) để đảm bảo mọi hàm animate() cần
        // dùng (VD updateTextPositions ở file 03-layers-panel.js) đã được định nghĩa đầy đủ.
        animate();
