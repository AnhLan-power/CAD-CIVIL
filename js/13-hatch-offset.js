        /* =========================================================================================
         * DÒ BIÊN GHÉP TỪ NHIỀU ĐOẠN RỜI (Pick Internal Point, kiểu AutoCAD HATCH/BOUNDARY):
         * Chỉ xét các entity người dùng tự vẽ (LINE/POLYLINE/CIRCLE/RECTANGLE) — không xét dữ liệu
         * import DXF (thường có hàng chục nghìn đoạn, sẽ quá chậm với thuật toán O(n²) bên dưới).
         * Thuật toán: (1) gom tất cả đoạn thẳng liên quan, (2) cắt mọi đoạn tại các giao điểm với nhau
         * để có 1 đồ thị phẳng "sạch", (3) từ điểm click, bắn tia ngang tìm cạnh gần nhất, (4) dò theo
         * cạnh đó bằng quy tắc "luôn rẽ phải nhiều nhất" tại mỗi đỉnh cho tới khi khép kín thành 1 mặt.
         * =========================================================================================
         */
        const BOUNDARY_MAX_SEGMENTS = 800; // giới hạn an toàn, tránh treo trình duyệt với thuật toán O(n²)

        function collectBoundarySegments() {
            const segs = [];
            entities.forEach(e => {
                if (!e.object.visible) return;
                if (e.type !== 'LINE' && e.type !== 'POLYLINE' && e.type !== 'CIRCLE' && e.type !== 'RECTANGLE') return;
                const posAttr = e.object.geometry && e.object.geometry.attributes && e.object.geometry.attributes.position;
                if (!posAttr) return;
                const pts = [];
                for (let i = 0; i < posAttr.count; i++) {
                    const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                    pts.push({ x: v.x, y: v.y });
                }
                const closed = e.object.type === 'LineLoop';
                const segCount = closed ? pts.length : pts.length - 1;
                for (let i = 0; i < segCount; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
            });
            return segs;
        }

        function pointKey(pt) {
            return Math.round(pt.x * 10000) + ',' + Math.round(pt.y * 10000);
        }

        // Giao giữa 2 đoạn thẳng a1-a2 và b1-b2 (kể cả giao ở giữa đoạn), trả về {x,y} hoặc null
        function segSegIntersection(a1, a2, b1, b2) {
            const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
            const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
            const denom = d1x * d2y - d1y * d2x;
            if (Math.abs(denom) < 1e-9) return null;
            const dx = b1.x - a1.x, dy = b1.y - a1.y;
            const t = (dx * d2y - dy * d2x) / denom;
            const u = (dx * d1y - dy * d1x) / denom;
            if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
            return { x: a1.x + d1x * t, y: a1.y + d1y * t };
        }

        // Cắt tất cả đoạn thẳng tại các giao điểm lẫn nhau để có đồ thị phẳng "sạch" (mỗi đoạn con
        // không còn cắt ngang đoạn con nào khác nữa, chỉ chạm nhau ở đỉnh)
        function splitSegmentsAtIntersections(segs) {
            const extraPts = segs.map(() => []);
            for (let i = 0; i < segs.length; i++) {
                for (let j = i + 1; j < segs.length; j++) {
                    const p = segSegIntersection(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
                    if (p) { extraPts[i].push(p); extraPts[j].push(p); }
                }
            }
            const result = [];
            segs.forEach((seg, i) => {
                const [a, b] = seg;
                const dx = b.x - a.x, dy = b.y - a.y;
                const len2 = dx * dx + dy * dy || 1;
                const pts = [a, ...extraPts[i], b];
                pts.sort((p1, p2) => {
                    const t1 = ((p1.x - a.x) * dx + (p1.y - a.y) * dy) / len2;
                    const t2 = ((p2.x - a.x) * dx + (p2.y - a.y) * dy) / len2;
                    return t1 - t2;
                });
                const dedup = [pts[0]];
                for (let k = 1; k < pts.length; k++) {
                    const last = dedup[dedup.length - 1];
                    if (Math.hypot(pts[k].x - last.x, pts[k].y - last.y) > 1e-5) dedup.push(pts[k]);
                }
                for (let k = 0; k < dedup.length - 1; k++) result.push([dedup[k], dedup[k + 1]]);
            });
            return result;
        }

        function buildAdjacency(segments) {
            const adj = new Map();   // key -> Set(key hàng xóm)
            const nodeOf = new Map(); // key -> {x,y}
            const getKey = (pt) => {
                const k = pointKey(pt);
                if (!nodeOf.has(k)) nodeOf.set(k, pt);
                return k;
            };
            segments.forEach(([a, b]) => {
                const ka = getKey(a), kb = getKey(b);
                if (ka === kb) return;
                if (!adj.has(ka)) adj.set(ka, new Set());
                if (!adj.has(kb)) adj.set(kb, new Set());
                adj.get(ka).add(kb);
                adj.get(kb).add(ka);
            });
            return { adj, nodeOf };
        }

        function angleOf(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }

        function pointInPolygon2D(pt, poly) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
                const hit = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
                if (hit) inside = !inside;
            }
            return inside;
        }

        // Dò theo cạnh (startKey -> nextKey), tại mỗi đỉnh luôn chọn cạnh "rẽ phải nhiều nhất" so với
        // hướng vừa đi tới, cho đến khi quay lại đúng startKey -> khép thành 1 vòng kín (1 mặt của đồ thị)
        function traceFace(startKey, nextKey, adj, nodeOf, maxSteps) {
            const path = [startKey];
            let prevKey = startKey, curKey = nextKey, steps = 0;
            while (curKey !== startKey && steps < maxSteps) {
                path.push(curKey);
                const curPt = nodeOf.get(curKey), prevPt = nodeOf.get(prevKey);
                const reverseAngle = angleOf(prevPt, curPt) + Math.PI;
                const neighbors = Array.from(adj.get(curKey) || []);
                if (neighbors.length === 0) return null;
                let bestKey = null, bestDiff = Infinity;
                neighbors.forEach(nKey => {
                    if (nKey === prevKey && neighbors.length > 1) return; // tránh quay lui trừ khi ngõ cụt
                    let diff = reverseAngle - angleOf(curPt, nodeOf.get(nKey));
                    diff = ((diff % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                    if (diff < bestDiff) { bestDiff = diff; bestKey = nKey; }
                });
                if (bestKey === null) bestKey = prevKey; // ngõ cụt thật sự -> quay lui
                prevKey = curKey;
                curKey = bestKey;
                steps++;
            }
            if (curKey !== startKey) return null;
            return path.map(k => nodeOf.get(k));
        }

        function findEnclosingBoundary(queryPoint) {
            const rawSegs = collectBoundarySegments();
            if (rawSegs.length === 0 || rawSegs.length > BOUNDARY_MAX_SEGMENTS) return null;
            const splitSegs = splitSegmentsAtIntersections(rawSegs);
            const { adj, nodeOf } = buildAdjacency(splitSegs);

            // Bắn tia ngang (+X) từ điểm click, tìm cạnh gần nhất mà tia này cắt qua
            let bestDist = Infinity, bestEdge = null;
            adj.forEach((neighbors, kA) => {
                const a = nodeOf.get(kA);
                neighbors.forEach(kB => {
                    const b = nodeOf.get(kB);
                    const y1 = a.y - queryPoint.y, y2 = b.y - queryPoint.y;
                    if ((y1 > 0) === (y2 > 0)) return;
                    const t = y1 / (y1 - y2);
                    const xCross = a.x + (b.x - a.x) * t;
                    const dist = xCross - queryPoint.x;
                    if (dist > 0 && dist < bestDist) { bestDist = dist; bestEdge = [kA, kB]; }
                });
            });
            if (!bestEdge) return null;

            const maxSteps = splitSegs.length * 4 + 20;
            let poly = traceFace(bestEdge[0], bestEdge[1], adj, nodeOf, maxSteps);
            if (poly && poly.length >= 3 && pointInPolygon2D(queryPoint, poly)) return poly;
            poly = traceFace(bestEdge[1], bestEdge[0], adj, nodeOf, maxSteps);
            if (poly && poly.length >= 3 && pointInPolygon2D(queryPoint, poly)) return poly;
            return null;
        }

        // Giao giữa đường thẳng vô hạn (base + t*dir) và đoạn thẳng p1-p2. Trả về t nếu có giao trong đoạn, null nếu không.
        function intersectLineSegment(base, dir, p1, p2) {
            const ex = p2.x - p1.x, ey = p2.y - p1.y;
            const dx = p1.x - base.x, dy = p1.y - base.y;
            const denom = ex * dir.y - ey * dir.x;
            if (Math.abs(denom) < 1e-9) return null; // song song
            const t = (ex * dy - ey * dx) / denom;
            const u = (dir.x * dy - dir.y * dx) / denom;
            if (u < -1e-6 || u > 1 + 1e-6) return null;
            return t;
        }

        /* =========================================================================================
         * OFFSET (kiểu AutoCAD): tạo bản sao song song cách 1 khoảng cố định, về phía người dùng click.
         * - Circle/Rectangle: tính lại trực tiếp (tăng/giảm bán kính, hoặc inset/outset các cạnh).
         * - Line/Polyline (đường hở): dùng công thức miter-offset (dịch mỗi đỉnh theo pháp tuyến trung
         *   bình của 2 cạnh kề, có bù độ dài theo góc để giữ đúng khoảng cách vuông góc).
         * =========================================================================================
         */
        function offsetPolyline(points, closed, distance) {
            const n = points.length;
            const result = [];
            for (let i = 0; i < n; i++) {
                const normals = [];
                if (closed || i > 0) {
                    const prev = points[closed ? (i - 1 + n) % n : i - 1];
                    const d1 = new THREE.Vector3().subVectors(points[i], prev).normalize();
                    normals.push(new THREE.Vector3(-d1.y, d1.x, 0));
                }
                if (closed || i < n - 1) {
                    const next = points[closed ? (i + 1) % n : i + 1];
                    const d2 = new THREE.Vector3().subVectors(next, points[i]).normalize();
                    normals.push(new THREE.Vector3(-d2.y, d2.x, 0));
                }
                const sum = normals.reduce((acc, v) => acc.add(v), new THREE.Vector3());
                if (sum.length() < 1e-6) {
                    result.push(points[i].clone().addScaledVector(normals[0] || new THREE.Vector3(), distance));
                    continue;
                }
                const avgDir = sum.clone().normalize();
                let scale = 1;
                if (normals.length === 2) {
                    const cosHalf = normals[0].dot(avgDir);
                    scale = Math.abs(cosHalf) > 0.15 ? 1 / cosHalf : 1 / 0.15;
                }
                result.push(points[i].clone().addScaledVector(avgDir, distance * scale));
            }
            return result;
        }

        // Xác định click ở bên trái (+1) hay bên phải (-1) của đoạn GẦN NHẤT trong 1 đường hở
        function computeOpenLineSide(points, clickPt) {
            let bestDist = Infinity, bestSide = 1;
            for (let i = 0; i < points.length - 1; i++) {
                const a = points[i], b = points[i + 1];
                const dir = new THREE.Vector3().subVectors(b, a);
                const len2 = dir.lengthSq() || 1;
                const toClick = new THREE.Vector3().subVectors(clickPt, a);
                const t = Math.max(0, Math.min(1, toClick.dot(dir) / len2));
                const proj = a.clone().addScaledVector(dir, t);
                const d = proj.distanceTo(clickPt);
                if (d < bestDist) {
                    bestDist = d;
                    const cross = dir.x * toClick.y - dir.y * toClick.x;
                    bestSide = cross >= 0 ? 1 : -1;
                }
            }
            return bestSide;
        }

        function createOffsetEntity(entity, distance, clickPt) {
            if (entity.type === 'CIRCLE') {
                const { center, radius } = estimateCircleFromEntity(entity.object);
                const inside = center.distanceTo(clickPt) < radius;
                const newRadius = Math.max(radius + (inside ? -distance : distance), 0.001);
                const pts = buildCirclePoints(center, center.clone().add(new THREE.Vector3(newRadius, 0, 0)));
                return buildLineObject(pts, true);
            }
            if (entity.type === 'RECTANGLE') {
                const posAttr = entity.object.geometry.attributes.position;
                const pts = [];
                for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
                const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                const inside = clickPt.x > minX && clickPt.x < maxX && clickPt.y > minY && clickPt.y < maxY;
                const d = inside ? -distance : distance;
                const nMinX = minX - d, nMaxX = maxX + d, nMinY = minY - d, nMaxY = maxY + d;
                if (nMaxX - nMinX < 0.001 || nMaxY - nMinY < 0.001) return null;
                return buildLineObject(buildRectanglePoints(new THREE.Vector3(nMinX, nMinY, 0), new THREE.Vector3(nMaxX, nMaxY, 0)), true);
            }
            // LINE / POLYLINE (đường hở)
            const posAttr = entity.object.geometry.attributes.position;
            const pts = [];
            for (let i = 0; i < posAttr.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
            const side = computeOpenLineSide(pts, clickPt);
            return buildLineObject(offsetPolyline(pts, false, distance * side), false);
        }

