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

        // Các hàm thao tác layer (setCurrentLayer, setLayerVisible/Frozen/Locked/Color..., renderLayersPanel...) nằm ở js/19-layer-model.js

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

