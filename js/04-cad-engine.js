        /* =========================================================================================
         * CAD ENGINE — DRAW / MODIFY / SELECT / UNDO-REDO
         * Ghi chú kiến trúc:
         * - Dữ liệu DXF import (LƯỚI KHẢO SÁT) vẫn giữ nguyên cách render cũ: gộp vào 1 buffer
         *   LineSegments duy nhất để hiển thị hàng chục nghìn đoạn thẳng cực nhanh, KHÔNG chỉnh sửa
         *   từng đoạn được (giữ hiệu năng cho bản vẽ khảo sát lớn).
         * - Các đối tượng do người dùng TỰ VẼ (Line/Polyline/Circle/Rectangle) được tạo thành từng
         *   THREE.Object3D riêng biệt trong "drawEntitiesGroup", có thể chọn / di chuyển / xoay /
         *   copy / xoá / undo-redo — giống cách CAD thật quản lý entity.
         * =========================================================================================
         */

        const drawEntitiesGroup = new THREE.Group();
        scene.add(drawEntitiesGroup);

        const entities = new Map(); // id -> { id, type, object, layerName }
        let nextEntityId = 1;
        const selectedIds = new Set();

        const SELECT_COLOR = 0xffff00;
        const DRAW_COLOR = 0xffffff;

        /* --- LAYERS (kiểu AutoCAD): mỗi layer có tên/màu/ẩn-hiện/khoá riêng ---
         * - Layer '0' là layer mặc định, không xoá/đổi tên được (giống AutoCAD).
         * - Entity người dùng tự vẽ lưu layerName; import DXF được nhóm theo layer riêng
         *   (mỗi layer trong DXF -> 1 THREE.LineSegments riêng, lưu ở layer.importObject3D). */
        const layers = new Map(); // name -> { name, color(hex number), visible, locked, importObject3D }
        layers.set('0', { name: '0', color: DRAW_COLOR, visible: true, locked: false, importObject3D: null });
        let currentLayerName = '0';
        let currentDrawColor = DRAW_COLOR; // màu dùng khi tạo entity mới = màu của layer hiện hành
        let layerCounter = 1;

        let activeTool = 'select';
        let tempPoints = [];      // các điểm đã chọn cho lệnh đang thực hiện
        let previewObject = null; // đường/khối xem trước (rubber-band) khi rê chuột

        const undoStack = [];
        const redoStack = [];

        // --- Raycasting trên mặt phẳng Z=0 (mặt phẳng vẽ) ---
        const raycaster = new THREE.Raycaster();
        raycaster.params.Line.threshold = 6;
        const mouseNDC = new THREE.Vector2();
        const drawPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

        function getWorldPoint(event) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, camera);
            const point = new THREE.Vector3();
            const hit = raycaster.ray.intersectPlane(drawPlane, point);
            if (!hit) { hideSnapMarker(); return null; }

            const snapped = findSnapPoint(event);
            if (snapped) {
                showSnapMarker(snapped); // OSNAP ưu tiên hơn ORTHO, giống hành vi AutoCAD thật
                return snapped.clone();
            }
            hideSnapMarker();

            // ORTHO (F8): ép điểm về ngang/dọc so với điểm mốc trước đó, áp dụng cho các lệnh nối tiếp điểm
            if (orthoEnabled && tempPoints.length > 0) {
                if (activeTool === 'line' || activeTool === 'polyline' || activeTool === 'move' || activeTool === 'copy') {
                    return applyOrthoConstraint(tempPoints[tempPoints.length - 1], point);
                }
                if (activeTool === 'rotate') {
                    // Luôn lấy tâm xoay (điểm đầu tiên) làm gốc, không phải điểm vừa click gần nhất
                    // -> giúp chọn điểm tham chiếu/điểm đích theo đúng bội số 90° quanh tâm xoay
                    return applyOrthoConstraint(tempPoints[0], point);
                }
            }
            return point;
        }

        // --- ORTHO (F8): ép hướng vẽ/di chuyển theo trục ngang hoặc dọc ---
        let orthoEnabled = false;
        function applyOrthoConstraint(base, point) {
            const dx = point.x - base.x;
            const dy = point.y - base.y;
            return Math.abs(dx) >= Math.abs(dy)
                ? new THREE.Vector3(point.x, base.y, 0)
                : new THREE.Vector3(base.x, point.y, 0);
        }
        function toggleOrtho() {
            orthoEnabled = !orthoEnabled;
            const btn = document.getElementById('ortho-toggle');
            btn.innerText = orthoEnabled ? 'ORTHO: ON (F8)' : 'ORTHO: OFF (F8)';
            btn.style.background = orthoEnabled ? '#0098ff' : '#555';
        }

