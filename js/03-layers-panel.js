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
            e.target.value = ''; // cho phép chọn lại đúng file đó lần sau (File đã giữ trong biến `file`)

            document.getElementById('command-line').innerText = `Command: Loading and processing ${file.name}...`;
            const isDWG = file.name.toLowerCase().endsWith('.dwg');

            if (isDWG) {
                // Đọc DWG ngay trong trình duyệt bằng WebAssembly (Rust + thư viện acadrust) -> ra chuỗi
                // DXF -> dùng lại đúng luồng nhập DXF bên dưới. Không cần server (xem js/15-dwg-wasm.js).
                try {
                    const mb = (file.size / 1048576).toFixed(1);
                    document.getElementById('command-line').innerText = `Command: Đang đọc DWG "${file.name}" (${mb} MB)...`;
                    await new Promise(r => setTimeout(r, 30)); // nhường trình duyệt vẽ lại dòng trạng thái trước khi xử lý nặng
                    const result = await DwgWasm.convert(await file.arrayBuffer());
                    if (result.notes.length) console.warn('Cảnh báo khi đọc DWG:\n' + result.notes.join('\n'));
                    const note = `DWG: ${result.entityCount.toLocaleString()} đối tượng` + (result.notes.length ? `, ${result.notes.length} cảnh báo (xem Console F12)` : '');
                    parseAndRenderDXF(result.dxfText, file.name, true, note);
                } catch (err) {
                    console.error(err);
                    document.getElementById('command-line').innerText = `Command: Lỗi đọc DWG - ${err.message}`;
                }
            } else {
                const reader = new FileReader();
                reader.onload = function(evt) {
                    parseAndRenderDXF(evt.target.result, file.name);
                };
                reader.readAsText(file);
            }
        });

        function parseAndRenderDXF(fileText, filename, fromDwg, extraNote) {
            try {
                const parser = new DxfParser();
                const dxf = parser.parseSync(fileText);
                renderOptimized2D(dxf, filename, fileText, extraNote);
            } catch (err) {
                console.error(err);
                alert(fromDwg ? "Đã đọc được DWG nhưng không dựng được bản vẽ — xem chi tiết ở Console (F12)." : "Lỗi đọc file DXF!");
            }
        }

        // renderOptimized2D() và updateTextPositions() nằm ở js/16-import-model.js

        function resetCamera() {
            if (currentModel) {
                const box = new THREE.Box3().setFromObject(currentModel);
                resetCameraToModel(box.getSize(new THREE.Vector3()));
            }
        }

        function resetCameraToModel(size) {
            const maxDim = Math.max(size.x, size.y) || 1000;
            // Khoảng cách camera để TOÀN BỘ bản vẽ lọt vừa khung nhìn (xét cả chiều cao lẫn chiều rộng theo
            // tỉ lệ màn hình, chừa lề 20%) — bản cũ chỉ lấy kích thước lớn nhất nên bản vẽ cao có thể bị cắt.
            const tanHalf = Math.tan(camera.fov * Math.PI / 360);
            const aspect = window.innerWidth / Math.max(1, window.innerHeight);
            const dist = Math.max((size.y || 1) / 2 / tanHalf, (size.x || 1) / 2 / (tanHalf * aspect)) * 1.2;
            // Nhích nhẹ theo Y để tránh suy biến toán học khi up cũng là Z (xem giải thích ở khai báo camera)
            camera.position.set(0, -maxDim * 0.0001, dist || 1000);
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

