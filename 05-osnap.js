        /* =========================================================================================
         * OBJECT SNAP (OSNAP) — bắt điểm Endpoint/Midpoint giống AutoCAD
         * Danh sách điểm bắt được dựng lại (cache) mỗi khi dữ liệu thay đổi (thêm/xoá/sửa entity,
         * import file mới) thay vì quét lại toàn bộ mỗi lần rê chuột, để giữ hiệu năng ổn định.
         * =========================================================================================
         */
        let snapEnabled = true;
        let snapCandidates = []; // điểm cố định: Endpoint/Midpoint
        let snapSegments = [];   // các cạnh [a,b] để tính Nearest (điểm gần nhất TRÊN cạnh, không chỉ ở đỉnh)
        const SNAP_PIXEL_THRESHOLD = 10;
        const snapMarkerEl = document.getElementById('snap-marker');

        function collectSnapPointsFromObject3D(obj, list) {
            // Hatch: chỉ lấy các điểm biên (đã lưu sẵn), KHÔNG duyệt vào hàng trăm đường gạch bên trong
            if (obj.userData && obj.userData.isHatch) {
                (obj.userData.boundaryPts || []).forEach(p => list.push(p));
                return;
            }
            // Alignment: chỉ lấy các điểm PI (đã lưu sẵn), KHÔNG duyệt vào hàng chục tick trạm/label bên trong
            if (obj.userData && obj.userData.isAlignment) {
                (obj.userData.boundaryPts || []).forEach(p => list.push(p));
                return;
            }
            // Profile View: chỉ lấy vài điểm góc (đã lưu sẵn), KHÔNG duyệt vào hàng trăm ô bảng/nhãn bên trong
            if (obj.userData && obj.userData.isProfileView) {
                (obj.userData.boundaryPts || []).forEach(p => list.push(p));
                return;
            }
            // Corridor: chỉ lấy 4 điểm góc bao quanh (đã lưu sẵn), KHÔNG duyệt vào mesh dày đặc bên trong
            if (obj.userData && obj.userData.isCorridor) {
                (obj.userData.boundaryPts || []).forEach(p => list.push(p));
                return;
            }
            // Point: bắt điểm ngay tại vị trí đặt điểm
            if (obj.userData && obj.userData.isPoint && obj.userData.pointXY) {
                list.push(new THREE.Vector3(obj.userData.pointXY.x, obj.userData.pointXY.y, 0));
                return;
            }
            if (obj.isGroup) {
                obj.children.forEach(child => collectSnapPointsFromObject3D(child, list));
                return;
            }
            if (obj.isSprite) {
                list.push(obj.position.clone());
                return;
            }
            if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
                const posAttr = obj.geometry.attributes.position;
                const pts = [];
                for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
                for (let i = 0; i < pts.length; i++) {
                    list.push(pts[i]);
                    if (pts[i + 1]) list.push(pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5)); // midpoint
                }
                if (obj.type === 'LineLoop' && pts.length > 1) {
                    list.push(pts[pts.length - 1].clone().add(pts[0]).multiplyScalar(0.5));
                }
            }
        }

        // Thu thập từng CẠNH (không chỉ điểm) để phục vụ Nearest-snap — quan trọng với Circle vì
        // đường tròn chỉ là đa giác xấp xỉ 64 cạnh, không phải mọi điểm trên viền đều trùng 1 đỉnh.
        function collectSnapSegmentsFromObject3D(obj, list) {
            if (obj.userData && (obj.userData.isHatch || obj.userData.isAlignment || obj.userData.isProfileView || obj.userData.isCorridor)) return;
            if (obj.isGroup) {
                obj.children.forEach(child => collectSnapSegmentsFromObject3D(child, list));
                return;
            }
            if (obj.isSprite || obj.isMesh) return; // text và mesh (mũi tên dimension...) không cần nearest-snap
            if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
                const posAttr = obj.geometry.attributes.position;
                const pts = [];
                for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
                const segCount = obj.type === 'LineLoop' ? pts.length : pts.length - 1;
                for (let i = 0; i < segCount; i++) list.push([pts[i], pts[(i + 1) % pts.length]]);
            }
        }

        // Lưới khảo sát import từ DXF là 1 LineSegments duy nhất (từng cặp đỉnh = 1 đoạn độc lập,
        // KHÔNG nối tiếp như Polyline) nên phải xử lý riêng, đồng thời quy đổi sang toạ độ world
        // (đối tượng import bị dịch theo group.position để căn giữa màn hình).
        function collectSnapPointsFromLineSegments(obj, list) {
            obj.updateWorldMatrix(true, false);
            const posAttr = obj.geometry.attributes.position;
            for (let i = 0; i < posAttr.count; i += 2) {
                if (i + 1 >= posAttr.count) break;
                const a = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(obj.matrixWorld);
                const b = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(obj.matrixWorld);
                list.push(a, b, a.clone().add(b).multiplyScalar(0.5));
            }
        }

        function collectSnapSegmentsFromLineSegments(obj, list) {
            obj.updateWorldMatrix(true, false);
            const posAttr = obj.geometry.attributes.position;
            for (let i = 0; i + 1 < posAttr.count; i += 2) {
                const a = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(obj.matrixWorld);
                const b = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(obj.matrixWorld);
                list.push([a, b]);
            }
        }

        function rebuildSnapCandidates() {
            const list = [];
            const segList = [];
            entities.forEach(e => {
                if (!e.object.visible) return;
                collectSnapPointsFromObject3D(e.object, list);
                collectSnapSegmentsFromObject3D(e.object, segList);
            });
            if (currentModel) {
                currentModel.traverse(obj => {
                    if (obj.isLineSegments && obj.visible) {
                        collectSnapPointsFromLineSegments(obj, list);
                        collectSnapSegmentsFromLineSegments(obj, segList);
                    }
                });
            }
            snapCandidates = list;
            snapSegments = segList;
        }

        // Tham số t (0..1) của điểm gần nhất trên đoạn màn hình a-b so với con trỏ (px,py)
        function nearestParamOnScreenSegment(a, b, px, py) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-9) return 0;
            const t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
            return Math.max(0, Math.min(1, t));
        }

        function findSnapPoint(event) {
            if (!snapEnabled) return null;

            // Ưu tiên 1: Endpoint/Midpoint (điểm cố định) trong ngưỡng pixel — giống AutoCAD ưu tiên
            // các OSNAP "chính xác" hơn trước.
            if (snapCandidates.length > 0) {
                let best = null, bestDist = SNAP_PIXEL_THRESHOLD;
                for (let i = 0; i < snapCandidates.length; i++) {
                    const s = worldToScreen(snapCandidates[i]);
                    const d = Math.hypot(s.x - event.clientX, s.y - event.clientY);
                    if (d < bestDist) { bestDist = d; best = snapCandidates[i]; }
                }
                if (best) return best;
            }

            // Ưu tiên 2 (fallback): Nearest — điểm gần nhất TRÊN bất kỳ cạnh nào, kể cả giữa 2 đỉnh.
            // Quan trọng với Circle: đường tròn chỉ là đa giác xấp xỉ 64 cạnh, không phải điểm nào
            // trên viền cũng trùng đúng 1 đỉnh, nên cần fallback này để bắt được ở bất kỳ đâu trên viền.
            if (snapSegments.length > 0) {
                let best = null, bestDist = SNAP_PIXEL_THRESHOLD;
                for (let i = 0; i < snapSegments.length; i++) {
                    const [a, b] = snapSegments[i];
                    const sa = worldToScreen(a), sb = worldToScreen(b);
                    const t = nearestParamOnScreenSegment(sa, sb, event.clientX, event.clientY);
                    const sx = sa.x + (sb.x - sa.x) * t, sy = sa.y + (sb.y - sa.y) * t;
                    const d = Math.hypot(sx - event.clientX, sy - event.clientY);
                    if (d < bestDist) { bestDist = d; best = new THREE.Vector3().lerpVectors(a, b, t); }
                }
                if (best) return best;
            }

            return null;
        }

        function showSnapMarker(worldPos) {
            const s = worldToScreen(worldPos);
            snapMarkerEl.style.left = s.x + 'px';
            snapMarkerEl.style.top = s.y + 'px';
            snapMarkerEl.style.display = 'block';
        }
        function hideSnapMarker() {
            snapMarkerEl.style.display = 'none';
        }

        function toggleSnap() {
            snapEnabled = !snapEnabled;
            const btn = document.getElementById('osnap-toggle');
            btn.innerText = snapEnabled ? 'OSNAP: ON (F3)' : 'OSNAP: OFF (F3)';
            btn.style.background = snapEnabled ? '#0098ff' : '#555';
            if (!snapEnabled) hideSnapMarker();
        }

        function pickEntityAt(event) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, camera);
            // recursive=true để bắt được cả các entity dạng Group (VD: Dimension gồm nhiều Line + Text con)
            const hits = raycaster.intersectObjects(drawEntitiesGroup.children, true);
            if (hits.length === 0) return null;
            // Đi ngược lên cha cho tới khi gặp object có gắn entityId (object gốc được add vào drawEntitiesGroup)
            let obj = hits[0].object;
            while (obj && obj.userData.entityId === undefined && obj !== drawEntitiesGroup) {
                obj = obj.parent;
            }
            const id = obj ? obj.userData.entityId : undefined;
            const entity = entities.get(id);
            if (entity && layers.get(entity.layerName)?.locked) return null; // layer bị khoá -> không cho chọn
            return entity || null;
        }

        // Giống pickEntityAt, nhưng CHỈ nhận entity đúng loại "type" — bỏ qua các object khác loại
        // đang che phủ gần camera hơn (vd: Corridor/Profile View dựng trên 1 Alignment sẽ che mất
        // đường Alignment mỏng bên dưới nếu dùng pickEntityAt thường, khiến không click chọn được
        // Alignment nữa). Duyệt qua TẤT CẢ điểm giao cắt theo thứ tự gần->xa, lấy cái đầu tiên đúng loại.
        function pickEntityOfTypeAt(event, type) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, camera);
            const hits = raycaster.intersectObjects(drawEntitiesGroup.children, true);
            for (const hit of hits) {
                let obj = hit.object;
                while (obj && obj.userData.entityId === undefined && obj !== drawEntitiesGroup) {
                    obj = obj.parent;
                }
                const id = obj ? obj.userData.entityId : undefined;
                const entity = entities.get(id);
                if (entity && entity.type === type) {
                    if (layers.get(entity.layerName)?.locked) continue;
                    return entity;
                }
            }
            return null;
        }

        // --- Lệnh (command pattern) cho Undo/Redo ---
        function execute(cmd) {
            cmd.do();
            undoStack.push(cmd);
            redoStack.length = 0;
            rebuildSnapCandidates();
        }
        function undoAction() {
            const cmd = undoStack.pop();
            if (!cmd) { setCommandText('Không còn thao tác để Undo.'); return; }
            cmd.undo();
            redoStack.push(cmd);
            setCommandText('Command: UNDO');
            rebuildSnapCandidates();
        }
        function redoAction() {
            const cmd = redoStack.pop();
            if (!cmd) { setCommandText('Không còn thao tác để Redo.'); return; }
            cmd.do();
            undoStack.push(cmd);
            setCommandText('Command: REDO');
            rebuildSnapCandidates();
        }

        function makeAddCommand(type, object3D, layerNameOverride) {
            let id = null;
            const layerName = layerNameOverride || currentLayerName; // chốt layer ngay lúc tạo lệnh
            return {
                do() {
                    if (id === null) id = nextEntityId++;
                    object3D.userData.entityId = id;
                    drawEntitiesGroup.add(object3D);
                    entities.set(id, { id, type, object: object3D, layerName });
                },
                undo() {
                    drawEntitiesGroup.remove(object3D);
                    entities.delete(id);
                    selectedIds.delete(id);
                }
            };
        }

        function makeDeleteCommand(ids) {
            const removed = ids.map(id => entities.get(id)).filter(Boolean);
            return {
                do() {
                    removed.forEach(e => {
                        drawEntitiesGroup.remove(e.object);
                        entities.delete(e.id);
                        selectedIds.delete(e.id);
                    });
                },
                undo() {
                    removed.forEach(e => {
                        drawEntitiesGroup.add(e.object);
                        entities.set(e.id, e);
                    });
                }
            };
        }

        // Tự động rebuild mọi Corridor đang tham chiếu tới 1 Alignment cụ thể — gọi hàm này mỗi khi
        // Alignment hoặc Profile View (FG) liên quan bị chỉnh sửa, để Corridor luôn "bám" theo đúng
        // đường đỏ/tim tuyến mới nhất thay vì phải bấm tay nút Rebuild trong Properties panel.
        function syncCorridorsForAlignment(alignmentName) {
            if (!alignmentName) return;
            entities.forEach(e => {
                if (e.type === 'CORRIDOR' && e.object.userData.corridorInfo &&
                    e.object.userData.corridorInfo.alignmentName === alignmentName) {
                    rebuildCorridor(e);
                }
            });
        }

        function makeTransformCommand(ids, matrix) {
            const invMatrix = matrix.clone().invert();
            const list = ids.map(id => entities.get(id)).filter(Boolean);
            // Danh sách tên Alignment bị ảnh hưởng bởi phép biến đổi này (bản thân Alignment bị
            // Move/Rotate/Scale, HOẶC 1 Profile View gắn với Alignment đó bị di chuyển) -> mọi
            // Corridor tham chiếu tới các Alignment này cần được rebuild lại sau khi transform xong.
            const affectedAlignmentNames = new Set();
            list.forEach(e => {
                if (e.type === 'ALIGNMENT' && e.object.userData.alignmentInfo) {
                    affectedAlignmentNames.add(e.object.userData.alignmentInfo.name);
                } else if (e.type === 'PROFILEVIEW' && e.object.userData.profileInfo) {
                    affectedAlignmentNames.add(e.object.userData.profileInfo.alignmentName);
                }
            });
            return {
                do() {
                    list.forEach(e => applyMatrixToEntity(e.object, matrix));
                    affectedAlignmentNames.forEach(name => syncCorridorsForAlignment(name));
                },
                undo() {
                    list.forEach(e => applyMatrixToEntity(e.object, invMatrix));
                    affectedAlignmentNames.forEach(name => syncCorridorsForAlignment(name));
                }
            };
        }

        // Thay toàn bộ điểm geometry của 1 entity (dùng cho Trim) — hỗ trợ Undo/Redo bằng cách lưu lại
        // các điểm cũ trước khi ghi đè.
        function makeGeometryReplaceCommand(entityId, newPoints) {
            const entity = entities.get(entityId);
            const oldPosAttr = entity.object.geometry.attributes.position;
            const oldPoints = [];
            for (let i = 0; i < oldPosAttr.count; i++) oldPoints.push(new THREE.Vector3().fromBufferAttribute(oldPosAttr, i));
            return {
                do() {
                    entity.object.geometry.dispose();
                    entity.object.geometry = new THREE.BufferGeometry().setFromPoints(newPoints);
                },
                undo() {
                    entity.object.geometry.dispose();
                    entity.object.geometry = new THREE.BufferGeometry().setFromPoints(oldPoints);
                }
            };
        }

        function applyMatrixToEntity(object3D, matrix) {
            // Hatch: điểm biên lưu riêng trong userData, cần biến đổi song song với geometry bên trong
            if (object3D.userData && object3D.userData.isHatch && object3D.userData.boundaryPts) {
                object3D.userData.boundaryPts = object3D.userData.boundaryPts.map(p => p.clone().applyMatrix4(matrix));
            }
            // Alignment: các điểm PI lưu riêng trong userData, cần biến đổi song song với geometry bên trong
            if (object3D.userData && object3D.userData.isAlignment && object3D.userData.boundaryPts) {
                object3D.userData.boundaryPts = object3D.userData.boundaryPts.map(p => p.clone().applyMatrix4(matrix));
            }
            // Profile View: các điểm góc lưu riêng trong userData, cần biến đổi song song với geometry bên trong
            if (object3D.userData && object3D.userData.isProfileView && object3D.userData.boundaryPts) {
                object3D.userData.boundaryPts = object3D.userData.boundaryPts.map(p => p.clone().applyMatrix4(matrix));
            }
            // Corridor: 4 điểm góc bao quanh lưu riêng trong userData, cần biến đổi song song với mesh bên trong
            if (object3D.userData && object3D.userData.isCorridor && object3D.userData.boundaryPts) {
                object3D.userData.boundaryPts = object3D.userData.boundaryPts.map(p => p.clone().applyMatrix4(matrix));
            }
            // Point: toạ độ lưu riêng trong userData, cần biến đổi song song với geometry bên trong
            if (object3D.userData && object3D.userData.isPoint && object3D.userData.pointXY) {
                const p = new THREE.Vector3(object3D.userData.pointXY.x, object3D.userData.pointXY.y, 0).applyMatrix4(matrix);
                object3D.userData.pointXY = { x: p.x, y: p.y };
            }
            if (object3D.isGroup) {
                object3D.children.forEach(child => applyMatrixToEntity(child, matrix));
                return;
            }
            if (object3D.isSprite) {
                // Sprite (Text) không có vertex geometry để biến đổi -> áp ma trận trực tiếp lên vị trí
                object3D.position.applyMatrix4(matrix);
                return;
            }
            const posAttr = object3D.geometry.attributes.position;
            const v = new THREE.Vector3();
            for (let i = 0; i < posAttr.count; i++) {
                v.fromBufferAttribute(posAttr, i);
                v.applyMatrix4(matrix);
                posAttr.setXYZ(i, v.x, v.y, v.z);
            }
            posAttr.needsUpdate = true;
            object3D.geometry.computeBoundingSphere();
        }

        // Nhân bản 1 entity object3D (Line/LineLoop/Sprite/Group) để phục vụ lệnh Copy
        function cloneEntityObject3D(obj) {
            if (obj.isGroup) {
                const g = new THREE.Group();
                obj.children.forEach(child => g.add(cloneEntityObject3D(child)));
                if (obj.userData && obj.userData.isHatch) {
                    g.userData.isHatch = true;
                    g.userData.boundaryPts = (obj.userData.boundaryPts || []).map(p => p.clone());
                }
                if (obj.userData && obj.userData.isAlignment) {
                    g.userData.isAlignment = true;
                    g.userData.boundaryPts = (obj.userData.boundaryPts || []).map(p => p.clone());
                    g.userData.alignmentInfo = obj.userData.alignmentInfo;
                }
                if (obj.userData && obj.userData.isProfileView) {
                    g.userData.isProfileView = true;
                    g.userData.boundaryPts = (obj.userData.boundaryPts || []).map(p => p.clone());
                    g.userData.profileInfo = obj.userData.profileInfo;
                }
                if (obj.userData && obj.userData.isCorridor) {
                    g.userData.isCorridor = true;
                    g.userData.boundaryPts = (obj.userData.boundaryPts || []).map(p => p.clone());
                    g.userData.corridorInfo = obj.userData.corridorInfo;
                }
                if (obj.userData && obj.userData.isPoint) {
                    g.userData.isPoint = true;
                    g.userData.elevation = obj.userData.elevation;
                    g.userData.pointXY = { ...obj.userData.pointXY };
                }
                return g;
            }
            if (obj.isSprite) {
                const s = new THREE.Sprite(obj.material.clone());
                s.position.copy(obj.position);
                s.scale.copy(obj.scale);
                s.userData.text = obj.userData.text;
                return s;
            }
            if (obj.isMesh) {
                // Mũi tên đặc (arrowhead) của Dimension
                return new THREE.Mesh(obj.geometry.clone(), obj.material.clone());
            }
            const geo = obj.geometry.clone();
            const mat = obj.material.clone();
            return obj.type === 'LineLoop' ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
        }

        // Đổi màu toàn bộ entity (kể cả các con bên trong Group) — dùng khi chọn/bỏ chọn
        function setEntityColor(object3D, color) {
            if (object3D.material) object3D.material.color.set(color);
            if (object3D.children) object3D.children.forEach(child => setEntityColor(child, color));
        }

        // --- Tạo hình học từ danh sách điểm ---
        function buildLineObject(points, closed) {
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({ color: currentDrawColor });
            return closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
        }

        function buildCirclePoints(center, radiusPoint, segments) {
            segments = segments || 64;
            const radius = center.distanceTo(radiusPoint);
            const pts = [];
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                pts.push(new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, 0));
            }
            return pts;
        }

        function buildRectanglePoints(p1, p2) {
            return [
                new THREE.Vector3(p1.x, p1.y, 0),
                new THREE.Vector3(p2.x, p1.y, 0),
                new THREE.Vector3(p2.x, p2.y, 0),
                new THREE.Vector3(p1.x, p2.y, 0)
            ];
        }

        // --- Xử lý 1 điểm được xác định cho tool đang vẽ (dùng chung cho cả click chuột lẫn nhập số) ---
        function handleLinePoint(p) {
            tempPoints.push(p.clone());
            if (tempPoints.length === 2) {
                const obj = buildLineObject(tempPoints, false);
                execute(makeAddCommand('LINE', obj));
                // AutoCAD-style: tiếp tục vẽ đoạn kế tiếp từ điểm cuối
                tempPoints = [tempPoints[1]];
                setCommandText('Command: Chỉ định điểm tiếp theo (gõ số để nhập khoảng cách/góc, Esc để kết thúc):');
            } else {
                setCommandText('Command: Chỉ định điểm tiếp theo:');
            }
        }

        function handlePolylinePoint(p) {
            tempPoints.push(p.clone());
            setCommandText('Command: Chỉ định điểm tiếp theo (gõ số để nhập khoảng cách/góc, Enter để kết thúc, Esc để huỷ):');
        }

        function handleCirclePoint(p) {
            tempPoints.push(p.clone());
            if (tempPoints.length === 2) {
                const pts = buildCirclePoints(tempPoints[0], tempPoints[1]);
                const obj = buildLineObject(pts, true);
                execute(makeAddCommand('CIRCLE', obj));
                tempPoints = [];
                clearPreview();
                setCommandText('Command: Chỉ định tâm đường tròn:');
            } else {
                setCommandText('Command: Chỉ định điểm bán kính (gõ số để nhập bán kính trực tiếp):');
            }
        }

        function handleRectanglePoint(p) {
            tempPoints.push(p.clone());
            if (tempPoints.length === 2) {
                const pts = buildRectanglePoints(tempPoints[0], tempPoints[1]);
                const obj = buildLineObject(pts, true);
                execute(makeAddCommand('RECTANGLE', obj));
                tempPoints = [];
                clearPreview();
                setCommandText('Command: Chỉ định góc thứ nhất của hình chữ nhật:');
            } else {
                setCommandText('Command: Chỉ định góc đối diện (gõ số để nhập chiều rộng/chiều cao):');
            }
        }

        // --- Text (Sprite luôn quay mặt về camera, dùng canvas 2D để vẽ chữ rồi map làm texture) ---
        function createTextSprite(text, worldPos, worldHeight) {
            const canvasEl = document.createElement('canvas');
            const ctx = canvasEl.getContext('2d');
            const fontPx = 64;
            ctx.font = `${fontPx}px Consolas, monospace`;
            const metrics = ctx.measureText(text);
            const padding = 12;
            canvasEl.width = Math.max(1, Math.ceil(metrics.width) + padding * 2);
            canvasEl.height = fontPx + padding * 2;
            // Phải set lại font sau khi đổi kích thước canvas (canvas reset context khi resize)
            ctx.font = `${fontPx}px Consolas, monospace`;
            ctx.fillStyle = '#7fffd4';
            ctx.textBaseline = 'top';
            ctx.fillText(text, padding, padding);

            const texture = new THREE.CanvasTexture(canvasEl);
            const material = new THREE.SpriteMaterial({ map: texture, color: currentDrawColor, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(material);

            if (worldHeight === undefined) {
                const dist = camera.position.distanceTo(controls.target) || 1000;
                worldHeight = dist * 0.03;
            }
            const aspect = canvasEl.width / canvasEl.height;
            sprite.scale.set(worldHeight * aspect, worldHeight, 1);
            sprite.position.copy(worldPos);
            sprite.userData.text = text;
            return sprite;
        }

