/* =========================================================================================
 * LAYERS (kiểu AutoCAD): quản lý layer cho cả entity tự vẽ lẫn từng layer import từ DXF/DWG
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
    entities.forEach(e => { if (e.layerName === layerName) e.layerName = '0'; });
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
    if (!body) return;
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
    if (panel) panel.style.display = 'flex';
}

/* =========================================================================================
 * XỬ LÝ ĐỌC BẢN VẼ DWG / DXF VIA WASM
 * =========================================================================================
 */
document.getElementById('fileInput').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const cmdLine = document.getElementById('command-line');
    if (cmdLine) cmdLine.innerText = `Command: Loading and processing ${file.name}...`;

    const isDWG = file.name.toLowerCase().endsWith('.dwg');

    if (isDWG) {
        try {
            if (cmdLine) cmdLine.innerText = `Command: Parsing DWG binary file '${file.name}' with Wasm...`;

            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);

            if (typeof window.parse_dwg_bytes === 'function') {
                const result = window.parse_dwg_bytes(bytes);
                window.lastDWGResult = result;
                console.log("DWG Parsing raw result:", result);

                if (result && result.entities) {
                    const normalizedEntities = normalizeWasmEntities(result.entities);
                    renderOptimized2D({ entities: normalizedEntities }, file.name);
                } else {
                    throw new Error("Không tìm thấy thực thể hợp lệ trong file DWG.");
                }
            } else {
                throw new Error("Wasm DWG parser chưa được khởi tạo!");
            }
        } catch (err) {
            console.error(err);
            if (cmdLine) cmdLine.innerText = `Command: Error - ${err.message || err}`;
        }
    } else {
        const reader = new FileReader();
        reader.onload = function(evt) {
            parseAndRenderDXF(evt.target.result, file.name);
        };
        reader.readAsText(file);
    }
});

// Hàm hỗ trợ chuẩn hóa thực thể từ Wasm sang dạng DXF tiêu chuẩn
function normalizeWasmEntities(wasmEntities) {
    if (!Array.isArray(wasmEntities)) return [];

    return wasmEntities.map(rawEnt => {
        if (!rawEnt) return { type: 'LINE', layer: '0', vertices: [] };

        const ent = {};
        for (let k in rawEnt) {
            ent[k.toLowerCase()] = rawEnt[k];
        }

        const type = String(ent.type || ent.entity_type || ent.kind || 'LINE').toUpperCase();
        const layer = String(ent.layer || ent.layer_name || '0');
        let vertices = [];

        // Trích xuất các tập hợp tọa độ
        const rawPts = ent.vertices || ent.points || ent.path || ent.coordinates || ent.pts;
        if (Array.isArray(rawPts) && rawPts.length > 0) {
            vertices = rawPts.map(v => {
                if (Array.isArray(v)) {
                    return { x: Number(v[0]) || 0, y: Number(v[1]) || 0, z: Number(v[2]) || 0 };
                } else if (typeof v === 'object' && v !== null) {
                    return { x: Number(v.x ?? v.X) || 0, y: Number(v.y ?? v.Y) || 0, z: Number(v.z ?? v.Z) || 0 };
                }
                return { x: 0, y: 0, z: 0 };
            });
        } else {
            const p1 = ent.start_point || ent.startpoint || ent.start || ent.p1 || ent.v1 || ent.from;
            const p2 = ent.end_point || ent.endpoint || ent.end || ent.p2 || ent.v2 || ent.to;
            if (p1 && p2) {
                vertices = [
                    { x: Number(p1.x ?? p1.X ?? p1[0]) || 0, y: Number(p1.y ?? p1.Y ?? p1[1]) || 0, z: Number(p1.z ?? p1.Z ?? p1[2]) || 0 },
                    { x: Number(p2.x ?? p2.X ?? p2[0]) || 0, y: Number(p2.y ?? p2.Y ?? p2[1]) || 0, z: Number(p2.z ?? p2.Z ?? p2[2]) || 0 }
                ];
            } else if (ent.x1 !== undefined && ent.y1 !== undefined) {
                vertices = [
                    { x: Number(ent.x1) || 0, y: Number(ent.y1) || 0, z: Number(ent.z1) || 0 },
                    { x: Number(ent.x2 ?? ent.x1) || 0, y: Number(ent.y2 ?? ent.y1) || 0, z: Number(ent.z2) || 0 }
                ];
            }
        }

        // Vị trí điểm chèn / Tâm
        let position = null;
        const pos = ent.position || ent.center || ent.insertionpoint || ent.location;
        if (pos) {
            position = {
                x: Number(pos.x ?? pos.X ?? pos[0]) || 0,
                y: Number(pos.y ?? pos.Y ?? pos[1]) || 0,
                z: Number(pos.z ?? pos.Z ?? pos[2]) || 0
            };
        } else if (ent.x !== undefined && ent.y !== undefined) {
            position = { x: Number(ent.x) || 0, y: Number(ent.y) || 0, z: Number(ent.z) || 0 };
        }

        return {
            type: type,
            layer: layer,
            vertices: vertices,
            position: position,
            radius: Number(ent.radius || ent.r) || 0,
            text: ent.text || ent.string_value || ent.value || ent.contents || ''
        };
    });
}

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
    if (typeof textOverlay !== 'undefined' && textOverlay) textOverlay.innerHTML = '';
    textElements = [];

    // 1. Xử lý vẽ các đoạn tuyến đường, GIỮ NGUYÊN TỌA ĐỘ GỐC
    const layerBuffers = new Map();
    const pushSeg = (layerName, p1, p2) => {
        if (!layerBuffers.has(layerName)) layerBuffers.set(layerName, []);
        layerBuffers.get(layerName).push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    };

    if (dxf.entities) {
        dxf.entities.forEach(entity => {
            const layerName = entity.layer || '0';
            const verts = entity.vertices;

            // Xử lý tất cả thực thể có từ 2 đỉnh trở lên
            if (verts && verts.length >= 2) {
                for (let i = 0; i < verts.length - 1; i++) {
                    const p1 = new THREE.Vector3(verts[i].x, verts[i].y, verts[i].z || 0);
                    const p2 = new THREE.Vector3(verts[i+1].x, verts[i+1].y, verts[i+1].z || 0);
                    pushSeg(layerName, p1, p2);
                }
            } 
            // Xử lý CIRCLE và ARC
            else if ((entity.type === 'CIRCLE' || entity.type === 'ARC') && entity.position && entity.radius) {
                const segs = 32;
                const cx = entity.position.x, cy = entity.position.y, cz = entity.position.z || 0;
                const r = entity.radius;
                for (let i = 0; i < segs; i++) {
                    const a1 = (i / segs) * Math.PI * 2;
                    const a2 = ((i + 1) / segs) * Math.PI * 2;
                    const p1 = new THREE.Vector3(cx + r * Math.cos(a1), cy + r * Math.sin(a1), cz);
                    const p2 = new THREE.Vector3(cx + r * Math.cos(a2), cy + r * Math.sin(a2), cz);
                    pushSeg(layerName, p1, p2);
                }
            }
        });
    }

    let totalSegmentCount = 0;
    const group = new THREE.Group();

    layers.forEach(l => { l.importObject3D = null; });

    layerBuffers.forEach((posArray, layerName) => {
        let layer = layers.get(layerName);
        if (!layer) {
            layer = { name: layerName, color: 0x00e5ff, visible: true, locked: false, importObject3D: null };
            layers.set(layerName, layer);
        }
        totalSegmentCount += posArray.length / 6;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
        const mat = new THREE.LineBasicMaterial({ color: layer.color });
        const lineSegments = new THREE.LineSegments(geo, mat);
        lineSegments.visible = layer.visible;
        layer.importObject3D = lineSegments;
        group.add(lineSegments);
    });
    renderLayersPanel();

    // Thêm Group vào scene
    scene.add(group);
    currentModel = group;

    // Tính toán khung bao (Bounding Box) thực
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // 2. BỘ TRÍCH XUẤT TEXT SÂU
    importedElevationPoints = [];
    const parseTextEntity = (ent) => {
        let textVal = ent.text || ent.string || ent.value;
        let posVal = ent.position || ent.insertionPoint;
        if (textVal && posVal && posVal.x !== undefined) {
            const pos = new THREE.Vector3(posVal.x, posVal.y, posVal.z || 0);

            if (typeof textOverlay !== 'undefined' && textOverlay) {
                const div = document.createElement('div');
                div.className = 'cad-text';
                div.innerText = String(textVal).trim();
                textOverlay.appendChild(div);
                textElements.push({ element: div, position: pos });
            }

            const trimmed = String(textVal).trim();
            if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
                const z = parseFloat(trimmed.replace(',', '.'));
                if (!isNaN(z)) importedElevationPoints.push({ x: pos.x, y: pos.y, z });
            }
        }
    };

    const scanForTexts = (entityList) => {
        if (!entityList) return;
        entityList.forEach(entity => {
            if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
                parseTextEntity(entity);
            } else if (entity.type === 'INSERT') {
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

    // Đưa Camera hướng thẳng vào trung tâm bản vẽ
    resetCameraToModel(center, size);
    rebuildSnapCandidates();

    const cmdLine = document.getElementById('command-line');
    if (cmdLine) {
        cmdLine.innerText = `Command: Loaded ${filename}. Lines: ${totalSegmentCount}, Texts: ${textElements.length}, Điểm cao độ: ${importedElevationPoints.length}`;
    }

    const propContent = document.getElementById('prop-content');
    if (propContent) {
        propContent.innerHTML = `
            <b>Bản vẽ:</b> ${filename}<br>
            <b>Số đoạn đường:</b> ${totalSegmentCount.toLocaleString()}<br>
            <b>Số nhãn cao độ:</b> ${textElements.length.toLocaleString()}<br>
            <b>Điểm từ DXF dùng được cho Surface:</b> ${importedElevationPoints.length.toLocaleString()}<br>
            <b>Kích thước X:</b> ${size.x.toFixed(1)}m<br>
            <b>Kích thước Y:</b> ${size.y.toFixed(1)}m<br>
            <b>Tâm X:</b> ${center.x.toFixed(2)}m<br>
            <b>Tâm Y:</b> ${center.y.toFixed(2)}m
        `;
    }

    if (typeof renderSurfacePanel === 'function') renderSurfacePanel();
    if (typeof renderPointsPanel === 'function') renderPointsPanel();
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
        resetCameraToModel(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));
    }
}

// Hàm đặt Camera tập trung vào tọa độ thực của mô hình
function resetCameraToModel(center, size) {
    const maxDim = Math.max(size.x, size.y, 100);
    
    controls.target.copy(center);
    camera.position.set(center.x, center.y - maxDim * 0.0001, center.z + maxDim * 1.5);
    camera.up.set(0, 0, 1);
    
    controls.update();
    camera.updateProjectionMatrix();
}

function toggleGrid() {
    if (typeof gridHelper !== 'undefined' && gridHelper) {
        gridHelper.visible = !gridHelper.visible;
    }
}

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
    camera.position.set(controls.target.x, controls.target.y - dist * 0.0001, controls.target.z + dist);
    camera.up.set(0, 0, 1);
    camera.lookAt(controls.target);
    controls.update();
}

window.addEventListener('resize', () => {
    if (typeof camera !== 'undefined' && camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }
    if (typeof renderer !== 'undefined' && renderer) {
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
