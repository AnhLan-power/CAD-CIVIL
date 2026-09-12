        /* =========================================================================================
         * ASSEMBLY (kiểu Civil3D, rút gọn): mặt cắt ngang điển hình gồm các "thành phần" tính từ tim
         * tuyến ra 2 bên, mỗi thành phần chỉ cần Rộng + Dốc% (giống nhóm subassembly "Basic" của
         * Civil3D thật) — dùng làm khuôn để Corridor đùn dọc theo Alignment.
         * =========================================================================================
         */
        const ASSEMBLY_TYPE_COLORS = {
            lane: 0x555560, curb: 0xcccccc, sidewalk: 0x9a6b3a, shoulder: 0x726f60, median: 0x4a7a4a, centerline: 0xffff00, taluy: 0x7a6a4a
        };
        const ASSEMBLY_TYPE_LABELS = { lane: 'Làn xe', curb: 'Bó vỉa', sidewalk: 'Vỉa hè', shoulder: 'Lề đường', median: 'Dải phân cách' };

        // Vài mẫu mặt cắt điển hình dựng sẵn, tương tự nhóm "Common Assemblies" của Civil3D thật
        // (bản rút gọn theo Rộng+Dốc, không phải catalog hình dạng subassembly đầy đủ)
        const ASSEMBLY_PRESETS = {
            basic: [
                { side: 'both', type: 'lane', width: 3.5, slope: -2 },
                { side: 'both', type: 'shoulder', width: 1.0, slope: -4 }
            ],
            urban: [
                { side: 'both', type: 'lane', width: 3.5, slope: -2 },
                // Bó vỉa 1 bậc lên (0.15m) — vỉa hè đứng CÙNG cao độ với đỉnh bó vỉa (xem giải thích ở
                // currentAssembly mặc định).
                { side: 'both', type: 'curb', width: 0.2, slope: 0, height: 0.15 },
                { side: 'both', type: 'sidewalk', width: 1.5, slope: -2 }
            ],
            divided: [
                { side: 'both', type: 'median', width: 1.5, slope: 0 },
                { side: 'both', type: 'lane', width: 3.5, slope: -2 },
                { side: 'both', type: 'shoulder', width: 1.0, slope: -4 }
            ],
            rural: [
                { side: 'both', type: 'lane', width: 3.0, slope: -2.5 },
                { side: 'both', type: 'shoulder', width: 0.5, slope: -6 }
            ]
        };

        let currentAssembly = [
            { side: 'both', type: 'lane', width: 3.5, slope: -2 },
            // Bó vỉa: chỉ 1 bậc lên (0.15m). Vỉa hè PHẢI đứng cùng cao độ với đỉnh bó vỉa (bó vỉa chỉ là
            // mặt đứng chuyển tiếp từ mặt đường lên vỉa hè) — không "lên rồi xuống lại", nếu không vỉa
            // hè sẽ tụt xuống ngang mặt đường, kéo kết cấu bên dưới vỉa hè lệch chồng vào kết cấu mặt
            // đường (đúng lỗi đã gặp khi thử với bản "lên-xuống" trước đó).
            { side: 'both', type: 'curb', width: 0.2, slope: 0, height: 0.15 },
            { side: 'both', type: 'sidewalk', width: 1.5, slope: -2 }
        ];

        // Hệ số mái dốc taluy mặc định (1:m, m = số này) — nối từ mép ngoài Template xuống/lên đúng
        // EG (thay vì vách đứng "1:0" như trước). Có thể chỉnh khi chạy Trắc ngang (ô "Taluy").
        let defaultTaluyRatio = 1.5;

        // Kết cấu áo đường mặc định (dùng để bóc khối lượng Trắc ngang) — mô phỏng theo mẫu TCVN
        // thường gặp: Bóc hữu cơ (toàn bộ bề rộng nền) + các lớp áo đường (chỉ trong phạm vi mặt
        // đường). "Đắp nền" KHÔNG có trong danh sách này vì là diện tích TÍNH TỰ ĐỘNG = diện tích đắp
        // (giữa Template và EG) trừ đi phần đã quy vào kết cấu áo đường bên trên.
        // "appliesTo": 'full' = toàn bộ bề rộng nền (cả taluy tính vào Bóc hữu cơ); hoặc đúng TÊN LOẠI
        // thành phần Assembly (lane/curb/sidewalk/shoulder/median) để kết cấu chỉ trải trong đúng
        // phạm vi loại đó — nhờ vậy kết cấu mặt đường (BTXM/CPĐD) và kết cấu vỉa hè có thể KHÁC NHAU,
        // không còn bị gộp chung 1 dải "paved" trải hết cả làn xe lẫn vỉa hè như trước.
        let pavementLayers = [
            { code: 'HUUCO', name: 'Bóc hữu cơ', thickness: 0.20, unit: 'area', appliesTo: 'full', color: 0x7a6a4a },
            { code: 'BTXM', name: 'Mặt đường BTXM', thickness: 0.22, unit: 'area', appliesTo: 'lane', color: 0xff5555 },
            { code: 'CPSDK98', name: 'CPĐD K98', thickness: 0.18, unit: 'area', appliesTo: 'lane', color: 0xffcc55 },
            { code: 'BATNHUA', name: 'Bạt nhựa (vải ĐKT)', thickness: 0.005, unit: 'length', appliesTo: 'lane', color: 0x55ccff },
            { code: 'GACHVIA', name: 'Gạch lát vỉa hè', thickness: 0.04, unit: 'area', appliesTo: 'sidewalk', color: 0xcc88ff },
            { code: 'CATLOT', name: 'Lớp lót cát vỉa hè', thickness: 0.05, unit: 'area', appliesTo: 'sidewalk', color: 0xf0e0a0 }
        ];

        function applyAssemblyPreset(name) {
            const preset = ASSEMBLY_PRESETS[name];
            if (!preset) return;
            currentAssembly = preset.map(c => ({ ...c }));
            renderAssemblyPanel();
        }

        function toggleAssemblyPanel() {
            const panel = document.getElementById('assembly-panel');
            const willShow = panel.style.display === 'none';
            panel.style.display = willShow ? 'flex' : 'none';
            if (willShow) renderAssemblyPanel();
        }

        function addAssemblyComponent() {
            currentAssembly.push({ side: 'both', type: 'lane', width: 3.0, slope: -2, height: 0 });
            renderAssemblyPanel();
        }
        function removeAssemblyComponent(idx) {
            currentAssembly.splice(idx, 1);
            renderAssemblyPanel();
        }
        function updateAssemblyComponent(idx, field, value) {
            if (field === 'width' || field === 'slope' || field === 'height') value = parseFloat(value) || 0;
            currentAssembly[idx][field] = value;
            if (field === 'type') renderAssemblyPanel(); // đổi type -> đổi màu ô mẫu, render lại cho đúng
        }

        function renderAssemblyPanel() {
            const body = document.getElementById('assembly-panel-body');
            body.innerHTML = '';
            currentAssembly.forEach((comp, idx) => {
                const row = document.createElement('div');
                row.className = 'assembly-row';

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.className = 'assembly-swatch';
                colorInput.style.cssText = 'width:22px; height:22px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer; background:none;';
                colorInput.title = 'Màu hiển thị (tuỳ chỉnh) — mặc định theo loại thành phần';
                colorInput.value = '#' + (comp.color || ASSEMBLY_TYPE_COLORS[comp.type] || 0x888888).toString(16).padStart(6, '0');
                colorInput.onchange = () => updateAssemblyComponent(idx, 'color', parseInt(colorInput.value.slice(1), 16));
                row.appendChild(colorInput);

                const sideSel = document.createElement('select');
                [['both', 'Cả 2 bên'], ['left', 'Trái'], ['right', 'Phải']].forEach(([v, l]) => {
                    const o = document.createElement('option'); o.value = v; o.innerText = l;
                    if (comp.side === v) o.selected = true;
                    sideSel.appendChild(o);
                });
                sideSel.onchange = () => updateAssemblyComponent(idx, 'side', sideSel.value);
                row.appendChild(sideSel);

                const typeSel = document.createElement('select');
                Object.keys(ASSEMBLY_TYPE_LABELS).forEach(v => {
                    const o = document.createElement('option'); o.value = v; o.innerText = ASSEMBLY_TYPE_LABELS[v];
                    if (comp.type === v) o.selected = true;
                    typeSel.appendChild(o);
                });
                typeSel.onchange = () => updateAssemblyComponent(idx, 'type', typeSel.value);
                row.appendChild(typeSel);

                const widthInput = document.createElement('input');
                widthInput.type = 'text'; widthInput.style.width = '55px'; widthInput.value = comp.width;
                widthInput.title = 'Rộng (m)';
                widthInput.onchange = () => updateAssemblyComponent(idx, 'width', widthInput.value);
                row.appendChild(widthInput);

                const slopeInput = document.createElement('input');
                slopeInput.type = 'text'; slopeInput.style.width = '50px'; slopeInput.value = comp.slope;
                slopeInput.title = 'Dốc ngang (%)';
                slopeInput.onchange = () => updateAssemblyComponent(idx, 'slope', slopeInput.value);
                row.appendChild(slopeInput);

                const heightInput = document.createElement('input');
                heightInput.type = 'text'; heightInput.style.width = '50px'; heightInput.value = comp.height || 0;
                heightInput.title = 'Cao bậc đứng (m) — vd bó vỉa, 0 = không có bậc';
                heightInput.onchange = () => updateAssemblyComponent(idx, 'height', heightInput.value);
                row.appendChild(heightInput);

                const delBtn = document.createElement('button');
                delBtn.className = 'layer-icon-btn';
                delBtn.innerText = '🗑';
                delBtn.title = 'Xoá thành phần';
                delBtn.onclick = () => removeAssemblyComponent(idx);
                row.appendChild(delBtn);

                body.appendChild(row);
            });
            if (currentAssembly.length === 0) {
                body.innerHTML = '<p style="color:#777; padding:8px;">Chưa có thành phần nào. Bấm "Thêm thành phần" để bắt đầu.</p>';
            }
            renderPavementLayersPanel();
        }

        function addPavementLayer() {
            const palette = [0xff5555, 0xffcc55, 0x55ccff, 0xcc88ff, 0x88ff88, 0xff9955];
            pavementLayers.push({ code: 'LOP' + (pavementLayers.length + 1), name: 'Lớp mới', thickness: 0.1, unit: 'area', appliesTo: 'lane', color: palette[pavementLayers.length % palette.length] });
            renderPavementLayersPanel();
        }
        function removePavementLayer(idx) {
            pavementLayers.splice(idx, 1);
            renderPavementLayersPanel();
        }
        function updatePavementLayer(idx, field, value) {
            if (field === 'thickness') value = parseFloat(value) || 0;
            pavementLayers[idx][field] = value;
            if (field === 'unit' || field === 'appliesTo') renderPavementLayersPanel();
        }

        function movePavementLayer(idx, dir) {
            const j = idx + dir;
            if (j < 0 || j >= pavementLayers.length) return;
            [pavementLayers[idx], pavementLayers[j]] = [pavementLayers[j], pavementLayers[idx]];
            renderPavementLayersPanel();
        }

        function renderPavementLayersPanel() {
            const body = document.getElementById('pavement-layers-body');
            if (!body) return;
            body.innerHTML = '';
            pavementLayers.forEach((layer, idx) => {
                const row = document.createElement('div');
                row.className = 'assembly-row';

                const moveWrap = document.createElement('span');
                moveWrap.style.display = 'flex'; moveWrap.style.flexDirection = 'column';
                const upBtn = document.createElement('button');
                upBtn.className = 'layer-icon-btn'; upBtn.innerText = '▲'; upBtn.title = 'Đưa lên (nằm gần mặt đường hơn)';
                upBtn.style.fontSize = '9px'; upBtn.onclick = () => movePavementLayer(idx, -1);
                const downBtn = document.createElement('button');
                downBtn.className = 'layer-icon-btn'; downBtn.innerText = '▼'; downBtn.title = 'Đưa xuống (nằm sâu hơn)';
                downBtn.style.fontSize = '9px'; downBtn.onclick = () => movePavementLayer(idx, 1);
                moveWrap.appendChild(upBtn); moveWrap.appendChild(downBtn);
                row.appendChild(moveWrap);

                const nameInput = document.createElement('input');
                nameInput.type = 'text'; nameInput.style.width = '110px'; nameInput.value = layer.name;
                nameInput.title = 'Tên lớp (hiện trên bảng khối lượng)';
                nameInput.onchange = () => updatePavementLayer(idx, 'name', nameInput.value);
                row.appendChild(nameInput);

                const unitSel = document.createElement('select');
                [['area', 'Diện tích (m²)'], ['length', 'Chiều dài (m)']].forEach(([v, l]) => {
                    const o = document.createElement('option'); o.value = v; o.innerText = l;
                    if (layer.unit === v) o.selected = true;
                    unitSel.appendChild(o);
                });
                unitSel.onchange = () => updatePavementLayer(idx, 'unit', unitSel.value);
                row.appendChild(unitSel);

                const scopeSel = document.createElement('select');
                [
                    ['full', 'Toàn bộ bề rộng nền'],
                    ['lane', 'Chỉ trong Làn xe'],
                    ['curb', 'Chỉ trong Bó vỉa'],
                    ['sidewalk', 'Chỉ trong Vỉa hè'],
                    ['shoulder', 'Chỉ trong Lề đường'],
                    ['median', 'Chỉ trong Dải phân cách']
                ].forEach(([v, l]) => {
                    const o = document.createElement('option'); o.value = v; o.innerText = l;
                    if (layer.appliesTo === v) o.selected = true;
                    scopeSel.appendChild(o);
                });
                scopeSel.onchange = () => updatePavementLayer(idx, 'appliesTo', scopeSel.value);
                row.appendChild(scopeSel);

                const thickInput = document.createElement('input');
                thickInput.type = 'text'; thickInput.style.width = '55px'; thickInput.value = layer.thickness;
                thickInput.title = 'Chiều dày (m)';
                thickInput.onchange = () => updatePavementLayer(idx, 'thickness', thickInput.value);
                row.appendChild(thickInput);

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.style.cssText = 'width:22px; height:22px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer; background:none;';
                colorInput.title = 'Màu hiển thị trên Corridor 3D';
                colorInput.value = '#' + (layer.color !== undefined ? layer.color : 0x888888).toString(16).padStart(6, '0');
                colorInput.onchange = () => updatePavementLayer(idx, 'color', parseInt(colorInput.value.slice(1), 16));
                row.appendChild(colorInput);

                const delBtn = document.createElement('button');
                delBtn.className = 'layer-icon-btn';
                delBtn.innerText = '🗑';
                delBtn.title = 'Xoá lớp';
                delBtn.onclick = () => removePavementLayer(idx);
                row.appendChild(delBtn);

                body.appendChild(row);
            });
            if (pavementLayers.length === 0) {
                body.innerHTML = '<p style="color:#777; padding:4px 0;">Chưa có lớp kết cấu nào — sẽ chỉ tính Đào/Đắp, không tách được BTXM/CPSĐK98...</p>';
            }
        }

