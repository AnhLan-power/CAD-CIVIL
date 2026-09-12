        /* =========================================================================================
         * LAYERS (kiểu AutoCAD): quản lý layer cho cả entity tự vẽ lẫn từng layer import từ DXF
         * =========================================================================================
         */
        function toggleLayersPanel() {
            const panel = document.getElementById('layers-panel');
            const willShow = panel.style.display === 'none';
            panel.style.display = willShow ? 'flex' : 'none';
            if (willShow) renderLayersPanel();
        }

        function setCurrentLayer(layerName) {
            if (!layers.has(layerName)) return;
            currentLayerName = layerName;
            currentDrawColor = layers.get(layerName).color;
            renderLayersPanel();
            setCommandText(`Command: Layer hiện hành: ${layerName}`);
        }

        function setLayerVisible(layerName, visible) {
            const layer = layers.get(layerName);
            if (!layer) return;
            layer.visible = visible;
            if (layer.importObject3D) layer.importObject3D.visible = visible;
            entities.forEach(e => {
                if (e.layerName === layerName) {
                    e.object.visible = visible;
                    if (!visible && selectedIds.has(e.id)) deselectEntity(e.id);
                }
            });
            updatePropertiesPanel();
            rebuildSnapCandidates();
        }

        function setLayerLocked(layerName, locked) {
            const layer = layers.get(layerName);
            if (layer) layer.locked = locked;
        }

        function setLayerColor(layerName, hexColor) {
            const layer = layers.get(layerName);
            if (!layer) return;
            layer.color = hexColor;
            if (layer.importObject3D) setEntityColor(layer.importObject3D, hexColor);
            entities.forEach(e => {
                if (e.layerName === layerName && !selectedIds.has(e.id)) setEntityColor(e.object, hexColor);
            });
            if (layerName === currentLayerName) currentDrawColor = hexColor;
        }

        function addNewLayer() {
            let name = 'Layer' + layerCounter++;
            while (layers.has(name)) name = 'Layer' + layerCounter++;
            layers.set(name, { name, color: 0xffffff, visible: true, locked: false, importObject3D: null });
            setCurrentLayer(name);
        }

        function deleteLayer(layerName) {
            if (layerName === '0') { setCommandText('Command: Không thể xoá layer 0.'); return; }
            entities.forEach(e => { if (e.layerName === layerName) e.layerName = '0'; }); // dồn entity về layer 0
            if (currentLayerName === layerName) setCurrentLayer('0');
            layers.delete(layerName);
            renderLayersPanel();
        }

        function renameLayer(oldName, newName) {
            newName = newName.trim().replace(/['"<>]/g, '');
            if (!newName || oldName === '0' || layers.has(newName)) { renderLayersPanel(); return; }
            const layer = layers.get(oldName);
            layer.name = newName;
            layers.delete(oldName);
            layers.set(newName, layer);
            entities.forEach(e => { if (e.layerName === oldName) e.layerName = newName; });
            if (currentLayerName === oldName) currentLayerName = newName;
            renderLayersPanel();
        }

        function renderLayersPanel() {
            const body = document.getElementById('layers-panel-body');
            body.innerHTML = '';
            layers.forEach(layer => {
                const row = document.createElement('div');
                row.className = 'layer-row' + (layer.name === currentLayerName ? ' layer-row-current' : '');
                row.title = 'Click để đặt làm layer hiện hành';
                row.onclick = () => setCurrentLayer(layer.name);

                const visBtn = document.createElement('button');
                visBtn.className = 'layer-icon-btn';
                visBtn.title = layer.visible ? 'Ẩn layer' : 'Hiện layer';
                visBtn.innerText = layer.visible ? '👁' : '🚫';
                visBtn.onclick = (ev) => { ev.stopPropagation(); setLayerVisible(layer.name, !layer.visible); renderLayersPanel(); };

                const lockBtn = document.createElement('button');
                lockBtn.className = 'layer-icon-btn';
                lockBtn.title = layer.locked ? 'Mở khoá layer' : 'Khoá layer';
                lockBtn.innerText = layer.locked ? '🔒' : '🔓';
                lockBtn.onclick = (ev) => { ev.stopPropagation(); setLayerLocked(layer.name, !layer.locked); renderLayersPanel(); };

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.className = 'layer-color-swatch';
                colorInput.value = '#' + layer.color.toString(16).padStart(6, '0');
                colorInput.title = 'Đổi màu layer';
                colorInput.onclick = (ev) => ev.stopPropagation();
                colorInput.onchange = () => setLayerColor(layer.name, parseInt(colorInput.value.slice(1), 16));

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'layer-name-input';
                nameInput.value = layer.name;
                if (layer.name === '0') nameInput.disabled = true;
                nameInput.onclick = (ev) => ev.stopPropagation();
                nameInput.onchange = () => renameLayer(layer.name, nameInput.value);

                row.appendChild(visBtn);
                row.appendChild(lockBtn);
                row.appendChild(colorInput);
                row.appendChild(nameInput);

                if (layer.name !== '0') {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'layer-icon-btn';
                    delBtn.title = 'Xoá layer';
                    delBtn.innerText = '🗑';
                    delBtn.onclick = (ev) => { ev.stopPropagation(); deleteLayer(layer.name); };
                    row.appendChild(delBtn);
                } else {
                    const spacer = document.createElement('span');
                    spacer.style.cssText = 'width:22px; display:inline-block;';
                    row.appendChild(spacer);
                }

                body.appendChild(row);
            });
        }

        function switchTab(tabName) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
            document.querySelectorAll('.ribbon-panel').forEach(p => p.style.display = 'none');
            const panel = document.getElementById('ribbon-panel-' + tabName) || document.getElementById('ribbon-panel-placeholder');
            panel.style.display = 'flex';
        }

        document.getElementById('fileInput').addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;

            document.getElementById('command-line').innerText = `Command: Loading and processing ${file.name}...`;
            const isDWG = file.name.toLowerCase().endsWith('.dwg');

            if (isDWG) {
                const formData = new FormData();
                formData.append('file', file);
                try {
                    const response = await fetch('/api/convert-dwg', { method: 'POST', body: formData });
                    if (!response.ok) {
                        let msg = 'Lỗi chuyển đổi DWG';
                        try { const j = await response.json(); if (j.error) msg = j.error; } catch (_) {}
                        throw new Error(msg);
                    }
                    const fileText = await response.text();
                    parseAndRenderDXF(fileText, file.name);
                } catch (err) {
                    console.error(err);
                    document.getElementById('command-line').innerText = `Command: Error - ${err.message}`;
                }
            } else {
                const reader = new FileReader();
                reader.onload = function(evt) {
                    parseAndRenderDXF(evt.target.result, file.name);
                };
                reader.readAsText(file);
            }
        });

        function parseAndRenderDXF(fileText, filename) {
            try {
                const parser = new DxfParser();
                const dxf = parser.parseSync(fileText);
                renderOptimized2D(dxf, filename);
            } catch (err) {
                console.error(err);
                alert("Lỗi đọc file DXF!");
            }
        }

        function renderOptimized2D(dxf, filename) {
            if (currentModel) scene.remove(currentModel);
            removeSurface();
            textOverlay.innerHTML = '';
            textElements = [];

            let allPoints = [];

            // Thu thập điểm để tính tâm bản vẽ
            const collectPoints = (list) => {
                if (!list) return;
                list.forEach(ent => {
                    if (ent.vertices) {
                        ent.vertices.forEach(v => {
                            if (v.x !== undefined && v.y !== undefined) allPoints.push(new THREE.Vector3(v.x, v.y, 0));
                        });
                    }
                    if (ent.position && ent.position.x !== undefined) {
                        allPoints.push(new THREE.Vector3(ent.position.x, ent.position.y, 0));
                    }
                });
            };

            collectPoints(dxf.entities);
            if (dxf.blocks) {
                for (let b in dxf.blocks) collectPoints(dxf.blocks[b].entities);
            }

            if (allPoints.length === 0) {
                alert("Không tìm thấy dữ liệu tọa độ.");
                return;
            }

            let sumX = 0, sumY = 0;
            allPoints.forEach(p => { sumX += p.x; sumY += p.y; });
            const realCenter = new THREE.Vector3(sumX / allPoints.length, sumY / allPoints.length, 0);

            // 1. Xử lý vẽ các đoạn tuyến đường (LineSegments siêu tốc), NHÓM THEO LAYER để có thể ẩn/hiện từng layer
            const layerBuffers = new Map(); // layerName -> mảng toạ độ [x,y,z, x,y,z, ...]
            const pushSeg = (layerName, p1, p2) => {
                if (!layerBuffers.has(layerName)) layerBuffers.set(layerName, []);
                layerBuffers.get(layerName).push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
            };
            dxf.entities.forEach(entity => {
                const layerName = entity.layer || '0';
                if (entity.type === 'LINE' && entity.vertices && entity.vertices.length >= 2) {
                    const p1 = new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, 0);
                    const p2 = new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, 0);
                    if (p1.distanceTo(realCenter) < 100000 && p2.distanceTo(realCenter) < 100000) {
                        pushSeg(layerName, p1, p2);
                    }
                } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    if (entity.vertices) {
                        for (let i = 0; i < entity.vertices.length - 1; i++) {
                            const p1 = new THREE.Vector3(entity.vertices[i].x, entity.vertices[i].y, 0);
                            const p2 = new THREE.Vector3(entity.vertices[i+1].x, entity.vertices[i+1].y, 0);
                            if (p1.distanceTo(realCenter) < 100000 && p2.distanceTo(realCenter) < 100000) {
                                pushSeg(layerName, p1, p2);
                            }
                        }
                    }
                }
            });

            let positions = [];
            layerBuffers.forEach(arr => { positions = positions.concat(arr); }); // chỉ dùng để tính bounding box tổng
            const group = new THREE.Group();

            // Đánh dấu các layer cũ (nếu re-import) là "không còn được import" trước khi build lại
            layers.forEach(l => { l.importObject3D = null; });

            layerBuffers.forEach((posArray, layerName) => {
                let layer = layers.get(layerName);
                if (!layer) {
                    layer = { name: layerName, color: 0x00e5ff, visible: true, locked: false, importObject3D: null };
                    layers.set(layerName, layer);
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
                const mat = new THREE.LineBasicMaterial({ color: layer.color });
                const lineSegments = new THREE.LineSegments(geo, mat);
                lineSegments.visible = layer.visible;
                layer.importObject3D = lineSegments;
                group.add(lineSegments);
            });
            renderLayersPanel();

            const box = new THREE.Box3().setFromObject(group);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            group.position.set(-center.x, -center.y, -center.z);
            scene.add(group);
            currentModel = group;

            // 2. BỘ TRÍCH XUẤT TEXT SÂU (Quét toàn bộ entities, blocks và INSERT attributes)
            // Đồng thời thu thập các text dạng SỐ (VD "12.45") làm điểm cao độ cho tính năng Surface (TIN)
            importedElevationPoints = [];
            const parseTextEntity = (ent) => {
                let textVal = ent.text || ent.string || ent.value;
                let posVal = ent.position || ent.insertionPoint;
                if (textVal && posVal && posVal.x !== undefined) {
                    const pos = new THREE.Vector3(posVal.x, posVal.y, 0);
                    if (pos.distanceTo(realCenter) < 100000) {
                        pos.sub(center);

                        const div = document.createElement('div');
                        div.className = 'cad-text';
                        div.innerText = String(textVal).trim();
                        textOverlay.appendChild(div);

                        textElements.push({ element: div, position: pos });

                        // Text thuần số (VD "12.45", "-1.5") -> coi là điểm cao độ khảo sát
                        const trimmed = String(textVal).trim();
                        if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
                            const z = parseFloat(trimmed.replace(',', '.'));
                            if (!isNaN(z)) importedElevationPoints.push({ x: pos.x, y: pos.y, z });
                        }
                    }
                }
            };

            const scanForTexts = (entityList) => {
                if (!entityList) return;
                entityList.forEach(entity => {
                    if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
                        parseTextEntity(entity);
                    } else if (entity.type === 'INSERT') {
                        // Quét các khối chèn (Insert block thường chứa point cao độ khảo sát)
                        parseTextEntity(entity);
                        if (entity.attributes) {
                            entity.attributes.forEach(attr => parseTextEntity(attr));
                        }
                    }
                });
            };

            scanForTexts(dxf.entities);
            if (dxf.blocks) {
                for (let blockName in dxf.blocks) {
                    scanForTexts(dxf.blocks[blockName].entities);
                }
            }

            resetCameraToModel(size);
            rebuildSnapCandidates();

            document.getElementById('command-line').innerText = `Command: Loaded ${filename}. Lines: ${positions.length / 6}, Texts: ${textElements.length}, Điểm cao độ: ${importedElevationPoints.length}`;
            document.getElementById('prop-content').innerHTML = `
                <b>Bản vẽ:</b> ${filename}<br>
                <b>Số đoạn đường:</b> ${(positions.length / 6).toLocaleString()}<br>
                <b>Số nhãn cao độ:</b> ${textElements.length.toLocaleString()}<br>
                <b>Điểm từ DXF dùng được cho Surface:</b> ${importedElevationPoints.length.toLocaleString()}<br>
                <b>Kích thước X:</b> ${size.x.toFixed(1)}m<br>
                <b>Kích thước Y:</b> ${size.y.toFixed(1)}m
            `;
            renderSurfacePanel();
            renderPointsPanel();
        }

        function updateTextPositions() {
            const widthHalf = window.innerWidth / 2;
            const heightHalf = window.innerHeight / 2;

            textElements.forEach(item => {
                const vector = item.position.clone();
                vector.project(camera);

                if (vector.z < 1) {
                    const x = (vector.x * widthHalf) + widthHalf;
                    const y = -(vector.y * heightHalf) + heightHalf;
                    item.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
                    item.element.style.display = 'block';
                } else {
                    item.element.style.display = 'none';
                }
            });
        }

        function resetCamera() {
            if (currentModel) {
                const box = new THREE.Box3().setFromObject(currentModel);
                resetCameraToModel(box.getSize(new THREE.Vector3()));
            }
        }

        function resetCameraToModel(size) {
            const maxDim = Math.max(size.x, size.y);
            // Nhích nhẹ theo Y để tránh suy biến toán học khi up cũng là Z (xem giải thích ở khai báo camera)
            camera.position.set(0, -(maxDim || 1000) * 0.0001, maxDim * 1.1 || 1000);
            camera.up.set(0, 0, 1);
            controls.target.set(0, 0, 0);
            controls.update();
            camera.updateProjectionMatrix();
        }

        function toggleGrid() {
            gridHelper.visible = !gridHelper.visible;
        }

        // --- Compass điều hướng (N/S/E/W xoay quanh trục camera đang nhìn, TOP đưa về góc nhìn từ trên xuống) ---
        // Dùng trực tiếp mặt phẳng XY (mặt bằng thật của bản vẽ) để tính lại vị trí camera theo góc
        // phương vị (azimuth) — KHÔNG dùng THREE.Spherical.setFromVector3 (hàm đó mặc định trục cực
        // là Y, sai với quy ước Z-up của bản vẽ này).
        function setCompassAzimuth(deg) {
            const offset = camera.position.clone().sub(controls.target);
            const horizDist = Math.hypot(offset.x, offset.y) || 1;
            const theta = THREE.MathUtils.degToRad(deg);
            const newOffset = new THREE.Vector3(horizDist * Math.sin(theta), -horizDist * Math.cos(theta), offset.z);
            camera.position.copy(controls.target).add(newOffset);
            camera.up.set(0, 0, 1);
            camera.lookAt(controls.target);
            controls.update();
        }

        function setTopView() {
            const dist = camera.position.distanceTo(controls.target) || 1000;
            // Nhích nhẹ theo Y để camera không nằm CHÍNH XÁC trên trục up (Z) -> tránh lookAt() suy
            // biến (up song song hướng nhìn), đồng thời vẫn nhìn như đúng từ trên xuống về mặt thị giác.
            camera.position.set(controls.target.x, controls.target.y - dist * 0.0001, controls.target.z + dist);
            camera.up.set(0, 0, 1);
            camera.lookAt(controls.target);
            controls.update();
        }

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

