        /* =========================================================================================
         * SURFACES (TIN) — kiểu Civil3D: tam giác hoá Delaunay từ các điểm cao độ (surveyPoints),
         * dựng mặt lưới 3D tô màu theo cao độ + đường đồng mức. Vì toàn bộ app quy ước mặt phẳng
         * vẽ là Z=0 (nhìn từ trên xuống mặc định), Surface dùng TRỤC Z THẬT = cao độ, nên ở chế độ
         * TOP view sẽ trông phẳng — nghiêng camera (Shift+chuột giữa) để thấy rõ hình khối 3D.
         * =========================================================================================
         */

        // Kiểm tra điểm d có nằm trong đường tròn ngoại tiếp tam giác (a,b,c) không — yêu cầu a,b,c
        // theo chiều CCW (ngược kim đồng hồ) để công thức determinant cho đúng dấu.
        function inCircumcircle(pts, ia, ib, ic, id) {
            const a = pts[ia], b = pts[ib], c = pts[ic], d = pts[id];
            const ax = a.x - d.x, ay = a.y - d.y, aw = ax * ax + ay * ay;
            const bx = b.x - d.x, by = b.y - d.y, bw = bx * bx + by * by;
            const cx = c.x - d.x, cy = c.y - d.y, cw = cx * cx + cy * cy;
            const det = ax * (by * cw - cy * bw) - ay * (bx * cw - cx * bw) + aw * (bx * cy - cx * by);
            return det > 1e-9;
        }

        // Tam giác hoá Delaunay (thuật toán Bowyer-Watson) — points: [{x,y,...}], trả về mảng chỉ số tam giác [[i,j,k],...]
        function delaunayTriangulate(points) {
            if (points.length < 3) return [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            points.forEach(p => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
            const spread = Math.max(maxX - minX, maxY - minY, 1) * 10;
            const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
            // Siêu tam giác bao trọn mọi điểm, PHẢI theo chiều CCW (trái-dưới -> phải-dưới -> đỉnh)
            const superPts = [
                { x: midX - spread, y: midY - spread },
                { x: midX + spread, y: midY - spread },
                { x: midX, y: midY + spread }
            ];
            const pts = points.concat(superPts);
            const s0 = points.length, s1 = points.length + 1, s2 = points.length + 2;
            let triangles = [[s0, s1, s2]];

            for (let pi = 0; pi < points.length; pi++) {
                const bad = triangles.filter(tri => inCircumcircle(pts, tri[0], tri[1], tri[2], pi));
                // Tìm các cạnh biên của vùng "bad" (cạnh chỉ thuộc đúng 1 tam giác bad)
                const edgeMap = new Map();
                bad.forEach(tri => {
                    [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach(([u, v]) => {
                        const key = u < v ? u + '_' + v : v + '_' + u;
                        if (edgeMap.has(key)) edgeMap.delete(key); // dùng chung 2 tam giác -> không phải biên
                        else edgeMap.set(key, [u, v]);
                    });
                });
                triangles = triangles.filter(tri => !bad.includes(tri));
                edgeMap.forEach(([u, v]) => triangles.push([u, v, pi]));
            }
            // Loại bỏ tam giác còn dính tới 3 đỉnh của siêu tam giác
            return triangles.filter(tri => tri[0] < points.length && tri[1] < points.length && tri[2] < points.length);
        }

        // Sinh đường đồng mức (contour) tại các mức cao độ cách đều `interval`, bằng cách cắt từng
        // tam giác qua mặt phẳng ngang Z=level (giao với 2 cạnh có 1 đỉnh trên/1 đỉnh dưới mức đó)
        function generateContours(points3D, triangles, interval) {
            if (points3D.length === 0 || triangles.length === 0 || interval <= 0) return [];
            let minZ = Infinity, maxZ = -Infinity;
            points3D.forEach(p => { minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
            const segments = [];
            const startLevel = Math.ceil(minZ / interval) * interval;
            for (let level = startLevel; level <= maxZ + 1e-9; level += interval) {
                triangles.forEach(tri => {
                    const verts = tri.map(i => points3D[i]);
                    const pts = [];
                    for (let e = 0; e < 3; e++) {
                        const p1 = verts[e], p2 = verts[(e + 1) % 3];
                        if (Math.abs(p1.z - level) < 1e-9) {
                            pts.push({ x: p1.x, y: p1.y, z: level });
                        } else if ((p1.z - level) * (p2.z - level) < 0) {
                            const t = (level - p1.z) / (p2.z - p1.z);
                            pts.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, z: level });
                        }
                    }
                    if (pts.length === 2) segments.push({ level, a: pts[0], b: pts[1] });
                });
            }
            return segments;
        }

        // Tô màu theo cao độ (hypsometric tint) kiểu bản đồ địa hình: xanh dương thấp -> xanh lá -> vàng -> nâu cao
        function elevationToColor(z, minZ, maxZ) {
            const stops = [
                [0.00, [0.16, 0.33, 0.60]],
                [0.28, [0.20, 0.55, 0.32]],
                [0.55, [0.75, 0.75, 0.30]],
                [0.80, [0.65, 0.42, 0.22]],
                [1.00, [0.55, 0.28, 0.22]]
            ];
            const t = maxZ > minZ ? (z - minZ) / (maxZ - minZ) : 0.5;
            for (let i = 0; i < stops.length - 1; i++) {
                const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
                if (t >= t0 && t <= t1) {
                    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
                    return [
                        c0[0] + (c1[0] - c0[0]) * f,
                        c0[1] + (c1[1] - c0[1]) * f,
                        c0[2] + (c1[2] - c0[2]) * f
                    ];
                }
            }
            return stops[stops.length - 1][1];
        }

        function removeSurface() {
            if (currentSurface) { scene.remove(currentSurface); currentSurface = null; }
            // Không còn Surface -> hệ số phóng đại hiển thị quay về 1:1 (thật), Corridor cần rebuild
            // lại để không còn "lệch" theo hệ quy chiếu phóng đại cũ.
            rebuildAllCorridors();
        }

        // QUAN TRỌNG: Surface được vẽ với hệ số phóng đại cao độ (exaggeration) + dịch gốc về 0
        // CHỈ ĐỂ HIỂN THỊ (xem hàm createSurfaceFromPoints), khác với cao độ thật. Bất kỳ đối tượng
        // nào khác cần đứng đúng vị trí trực quan so với Surface trong khung nhìn 3D (như Corridor)
        // PHẢI áp cùng phép biến đổi (thật -> hiển thị) này, nếu không sẽ bị lệch cao độ nghiêm
        // trọng so với địa hình (ví dụ: Corridor bị "chìm" dưới Surface dù số liệu tính đúng).
        // Nếu chưa có Surface nào, trả về nguyên cao độ thật (không phóng đại).
        function elevationToDisplayZ(realZ) {
            if (currentSurface && currentSurface.userData.stats) {
                const { minZ, exaggeration } = currentSurface.userData.stats;
                return (realZ - minZ) * exaggeration;
            }
            return realZ;
        }

        // Rebuild lại TẤT CẢ Corridor hiện có — dùng khi Surface được tạo mới/xoá (hệ số phóng đại
        // hiển thị thay đổi), vì lúc đó vị trí Z hiển thị "đúng" của mọi Corridor đều cần tính lại.
        function rebuildAllCorridors() {
            entities.forEach(e => { if (e.type === 'CORRIDOR') rebuildCorridor(e); });
        }

        function createSurfaceFromPoints() {
            removeSurface();
            const surveyPoints = collectAllSurveyPoints(); // gộp điểm import DXF + điểm Point tự đặt
            if (surveyPoints.length < 3) {
                setCommandText('Command: Cần ít nhất 3 điểm cao độ để tạo Surface (hiện có ' + surveyPoints.length + ').');
                renderSurfacePanel();
                return;
            }

            const triangles = delaunayTriangulate(surveyPoints);
            if (triangles.length === 0) {
                setCommandText('Command: Không tạo được tam giác nào (điểm có thể thẳng hàng).');
                return;
            }

            let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            surveyPoints.forEach(p => {
                minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
            // Phóng đại cao độ để hình khối rõ ràng hơn khi nghiêng camera (chỉ phục vụ hiển thị, không
            // đúng tỉ lệ thật) — tự tính sao cho biên độ cao độ ~15% chiều rộng mặt bằng, giới hạn 1-20 lần.
            const horizSpan = Math.max(maxX - minX, maxY - minY, 1);
            const vertSpan = Math.max(maxZ - minZ, 1e-6);
            const exaggeration = Math.min(20, Math.max(1, (horizSpan * 0.15) / vertSpan));

            const group = new THREE.Group();
            group.userData.isSurface = true;

            // --- Mesh mặt lưới, tô màu theo cao độ ---
            const positions = new Float32Array(surveyPoints.length * 3);
            const colors = new Float32Array(surveyPoints.length * 3);
            surveyPoints.forEach((p, i) => {
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = (p.z - minZ) * exaggeration;
                const [r, g, b] = elevationToColor(p.z, minZ, maxZ);
                colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
            });
            const indices = [];
            triangles.forEach(tri => indices.push(tri[0], tri[1], tri[2]));

            const meshGeo = new THREE.BufferGeometry();
            meshGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            meshGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            meshGeo.setIndex(indices);
            meshGeo.computeVertexNormals();
            const meshMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
            const mesh = new THREE.Mesh(meshGeo, meshMat);
            mesh.userData.isSurfaceMesh = true;
            group.add(mesh);

            // --- Lưới tam giác (wireframe TIN) ---
            const wireGeo = new THREE.WireframeGeometry(meshGeo);
            const wireMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35 });
            const wireframe = new THREE.LineSegments(wireGeo, wireMat);
            wireframe.userData.isSurfaceWireframe = true;
            group.add(wireframe);

            // --- Đường đồng mức (contours) ---
            const points3DForContour = surveyPoints.map((p, i) => ({ x: p.x, y: p.y, z: (p.z - minZ) * exaggeration, realZ: p.z }));
            const zRangeReal = maxZ - minZ;
            let interval = parseFloat(document.getElementById('surface-contour-interval').value) || 1;
            if (interval <= 0) interval = Math.max(zRangeReal / 10, 0.1);
            const contourSegs = generateContours(surveyPoints.map(p => ({ x: p.x, y: p.y, z: p.z })), triangles, interval);
            const contourPositions = [];
            contourSegs.forEach(seg => {
                const za = (seg.a.z - minZ) * exaggeration, zb = (seg.b.z - minZ) * exaggeration;
                contourPositions.push(seg.a.x, seg.a.y, za, seg.b.x, seg.b.y, zb);
            });
            const contourGeo = new THREE.BufferGeometry();
            contourGeo.setAttribute('position', new THREE.Float32BufferAttribute(contourPositions, 3));
            const contourMat = new THREE.LineBasicMaterial({ color: 0x3a2a1a });
            const contourLines = new THREE.LineSegments(contourGeo, contourMat);
            contourLines.userData.isSurfaceContours = true;
            group.add(contourLines);

            currentSurface = group;
            currentSurface.userData.stats = {
                pointCount: surveyPoints.length, triCount: triangles.length,
                minZ, maxZ, exaggeration, interval, contourCount: contourSegs.length
            };
            // Lưu lại dữ liệu tam giác hoá GỐC (chưa phóng đại) để Profile nội suy đúng cao độ thật
            currentSurface.userData.triangulation = { points: surveyPoints, triangles };
            scene.add(group);

            applySurfaceDisplayOptions();
            renderSurfacePanel();
            setCommandText(`Command: Đã tạo Surface — ${surveyPoints.length} điểm, ${triangles.length} tam giác, cao độ ${minZ.toFixed(2)}~${maxZ.toFixed(2)}.`);
            // Hệ số phóng đại hiển thị (exaggeration) có thể vừa thay đổi -> mọi Corridor hiện có cần
            // rebuild lại để tiếp tục đứng đúng vị trí trực quan so với Surface mới.
            rebuildAllCorridors();
        }

        function applySurfaceDisplayOptions() {
            if (!currentSurface) return;
            const showTin = document.getElementById('surface-show-tin').checked;
            const showContours = document.getElementById('surface-show-contours').checked;
            const showMesh = document.getElementById('surface-show-mesh').checked;
            currentSurface.children.forEach(child => {
                if (child.userData.isSurfaceWireframe) child.visible = showTin;
                if (child.userData.isSurfaceContours) child.visible = showContours;
                if (child.userData.isSurfaceMesh) child.visible = showMesh;
            });
        }

        function toggleSurfacePanel() {
            const panel = document.getElementById('surface-panel');
            const willShow = panel.style.display === 'none';
            panel.style.display = willShow ? 'flex' : 'none';
            if (willShow) renderSurfacePanel();
        }

        function renderSurfacePanel() {
            const info = document.getElementById('surface-panel-info');
            if (!info) return;
            if (currentSurface && currentSurface.userData.stats) {
                const s = currentSurface.userData.stats;
                info.innerHTML = `
                    <div>Điểm: <b>${s.pointCount}</b> — Tam giác: <b>${s.triCount}</b></div>
                    <div>Cao độ: <b>${s.minZ.toFixed(2)}</b> ~ <b>${s.maxZ.toFixed(2)}</b> (chênh ${(s.maxZ - s.minZ).toFixed(2)})</div>
                    <div>Đường đồng mức: <b>${s.contourCount}</b> đoạn, khoảng cách ${s.interval}</div>
                    <div style="color:#888; font-size:11px; margin-top:4px;">Phóng đại cao độ ×${s.exaggeration.toFixed(1)} (chỉ để hiển thị) — nghiêng camera (Shift+chuột giữa) để xem rõ hình khối.</div>
                `;
            } else {
                info.innerHTML = `<div style="color:#888;">Chưa có Surface. Có <b>${collectAllSurveyPoints().length}</b> điểm cao độ sẵn sàng (từ DXF import + Point tự đặt).</div>`;
            }
        }


        // Circle của app lưu dạng đa giác (LineLoop) chứ không có tâm/bán kính riêng, nên ước lượng
        // động từ geometry HIỆN TẠI (tránh bị lệch nếu circle đã từng bị Move/Rotate/Copy).
        function estimateCircleFromEntity(object3D) {
            const posAttr = object3D.geometry.attributes.position;
            const pts = [];
            const center = new THREE.Vector3();
            for (let i = 0; i < posAttr.count; i++) {
                const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                pts.push(v);
                center.add(v);
            }
            center.multiplyScalar(1 / pts.length);
            let radius = 0;
            pts.forEach(v => { radius += v.distanceTo(center); });
            radius /= pts.length;
            return { center, radius };
        }

        function createDiameterDimensionEntity(center, radius) {
            const dir = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0); // đường kích thước chéo 45°, giống AutoCAD
            const p1 = center.clone().addScaledVector(dir, -radius);
            const p2 = center.clone().addScaledVector(dir, radius);
            const newLine = (pts) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: currentDrawColor }));

            const group = new THREE.Group();
            const arrowSize = Math.max(radius * 0.15, 0.06);
            group.add(createArrowHead(p1, dir.clone().negate(), arrowSize));
            group.add(createArrowHead(p2, dir.clone(), arrowSize));

            const label = createTextSprite('⌀' + (radius * 2).toFixed(2), center.clone(), Math.max(radius * 0.3, 0.15));
            addLineWithLabelGap(group, p1, p2, label, newLine);

            return group;
        }

