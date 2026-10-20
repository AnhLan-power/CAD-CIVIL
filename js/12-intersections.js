        /* =========================================================================================
         * INTERSECTIONS (nút giao 2 Alignment, kiểu Civil3D rút gọn):
         * - Bo góc vỉa hè/mép đường tại 4 góc giao nhau, bán kính tự chọn.
         * - "Làm phẳng" mặt đường trong phạm vi giao nhau: toàn bộ mảng giao được dựng ở 1 cao độ
         *   duy nhất, lấy theo cao độ thiết kế (FG) của tuyến ƯU TIÊN (tuyến click đầu tiên) tại đúng
         *   điểm giao — cách làm phổ biến cho nút giao đường nhỏ/khu dân cư.
         * GIỚI HẠN: dùng chung Assembly hiện tại (currentAssembly) để lấy bề rộng mép đường cho CẢ
         * 2 tuyến (app hiện chưa lưu riêng Assembly cho từng Alignment/Corridor); chỉ xử lý đúng 1 cặp
         * tuyến cắt nhau kiểu ngã tư/ngã ba đơn giản (không hỗ trợ nhiều tuyến giao cùng 1 điểm).
         * =========================================================================================
         */

        // Giao điểm 2 đoạn thẳng (2D), trả về null nếu không cắt nhau trong đúng phạm vi 2 đoạn
        function segmentIntersection2D(p1, p2, p3, p4) {
            const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
            const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
            const denom = d1x * d2y - d1y * d2x;
            if (Math.abs(denom) < 1e-9) return null;
            const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
            const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
            if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
            return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
        }

        // Tìm điểm giao nhau giữa 2 Alignment (dò từng cặp đoạn trên đường polyline thật, gồm cả cung
        // tròn) — trả về điểm giao + lý trình + hướng tiếp tuyến của mỗi tuyến ngay tại điểm đó.
        function findAlignmentsCrossing(alignA, alignB) {
            const infoA = alignA.object.userData.alignmentInfo, infoB = alignB.object.userData.alignmentInfo;
            const { path: pathA } = buildAlignmentPath(alignA.object.userData.boundaryPts, infoA.radius);
            const { path: pathB } = buildAlignmentPath(alignB.object.userData.boundaryPts, infoB.radius);

            // offA/offB: phần kéo dài thêm ở ĐẦU mỗi tuyến (để trừ ra khi tính lý trình thật)
            function tryFind(pA, pB, offA, offB) {
                for (let i = 0; i < pA.length - 1; i++) {
                    for (let j = 0; j < pB.length - 1; j++) {
                        const hit = segmentIntersection2D(pA[i], pA[i + 1], pB[j], pB[j + 1]);
                        if (!hit) continue;
                        let stationA = 0;
                        for (let k = 0; k < i; k++) stationA += pA[k].distanceTo(pA[k + 1]);
                        stationA += pA[i].distanceTo(pA[i + 1]) * hit.t;
                        let stationB = 0;
                        for (let k = 0; k < j; k++) stationB += pB[k].distanceTo(pB[k + 1]);
                        stationB += pB[j].distanceTo(pB[j + 1]) * hit.u;
                        return {
                            point: new THREE.Vector3(hit.x, hit.y, 0),
                            stationA: stationA - offA, stationB: stationB - offB,
                            dirA: pA[i + 1].clone().sub(pA[i]).normalize(),
                            dirB: pB[j + 1].clone().sub(pB[j]).normalize()
                        };
                    }
                }
                return null;
            }

            const direct = tryFind(pathA, pathB, 0, 0);
            if (direct) return direct;

            // Không cắt nhau trực tiếp: thử KÉO DÀI 2 đầu mỗi tuyến thêm một đoạn ngắn theo hướng tiếp
            // tuyến — bắt được ngã ba vẽ tay (nhánh phụ dừng sát/ngay trước tuyến chính, không chạm hẳn).
            const ext = 15;
            const extend = p => {
                const dS = p[0].clone().sub(p[1]).normalize();
                const dE = p[p.length - 1].clone().sub(p[p.length - 2]).normalize();
                return [p[0].clone().add(dS.multiplyScalar(ext)), ...p, p[p.length - 1].clone().add(dE.multiplyScalar(ext))];
            };
            return tryFind(extend(pathA), extend(pathB), ext, ext);
        }

        function lineLineIntersection(P1, d1, P2, d2) {
            const denom = d1.x * d2.y - d1.y * d2.x;
            if (Math.abs(denom) < 1e-9) return null;
            const dx = P2.x - P1.x, dy = P2.y - P1.y;
            const t = (dx * d2.y - dy * d2.x) / denom;
            return new THREE.Vector3(P1.x + t * d1.x, P1.y + t * d1.y, 0);
        }

        // Bo góc 1 trong 4 "quadrant" tạo bởi 2 tia hướng ra khỏi điểm giao (d1, d2), với vector lệch
        // mép đường (offsetVec1, offsetVec2) đã tính sẵn dấu đúng bên trong quadrant.
        // maxTangentDist: giới hạn khoảng chạy đà tối đa — với góc giao quá xiên (gần thẳng hàng),
        // công thức bo góc chuẩn (tangentDist = radius/tan(angle/2)) có thể đòi hỏi chạy đà dài bất
        // thường (hàng chục mét) để giữ đúng bán kính yêu cầu, khiến cung bo văng ra rất xa điểm giao
        // và trông như "gãy khúc"/hở ra so với phần còn lại. Khi vượt giới hạn, TỰ ĐỘNG giảm bán kính
        // hiệu dụng cho riêng góc đó (vẫn bo tròn, chỉ nhỏ hơn yêu cầu) để chạy đà không vượt quá mức.
        function computeQuadrantFillet(P, d1, offsetVec1, d2, offsetVec2, radius, maxTangentDist) {
            const A1 = P.clone().add(offsetVec1), A2 = P.clone().add(offsetVec2);
            const corner = lineLineIntersection(A1, d1, A2, d2);
            if (!corner) return null;
            const angle = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
            if (angle < 1e-3 || angle > Math.PI - 1e-3) return null; // gần song song/thẳng hàng -> bỏ qua

            // QUAN TRỌNG: với góc giao quá XIÊN (rất nhọn), chính ĐIỂM GÓC (nơi 2 đường mép kéo dài
            // gặp nhau) đã nằm rất xa điểm giao P — đây là hệ quả hình học tất yếu (2 đường gần song
            // song thì kéo dài ra rất lâu mới cắt nhau), KHÔNG PHỤ THUỘC bán kính bo. Giảm bán kính bo
            // không giải quyết được vấn đề này (chỉ giảm được tangentDist TỪ điểm góc, không kéo điểm
            // góc lại gần). Nên khi điểm góc đã quá xa P, phải bỏ cách bo tiếp tuyến "đúng nghĩa" và
            // chuyển sang VÁT GÓC đơn giản (nối thẳng 2 điểm gần P trên 2 mép đường) cho hình không bị
            // "văng" ra xa — đây chính là nguyên nhân gây hiện tượng "khe hở/ăn sâu vào đường" khi giao
            // ở góc xiên.
            const cornerDistFromP = corner.distanceTo(P);
            const uncappedTangentDist = radius / Math.tan(angle / 2);
            // Kiểm tra TỔNG khoảng cách từ P (qua điểm góc rồi chạy đà ra tới điểm tiếp tuyến) — không
            // chỉ riêng điểm góc, vì có trường hợp điểm góc không quá xa nhưng CỘNG THÊM chạy đà thì
            // tổng lại vượt xa mức hợp lý (đúng trường hợp gây lỗi ở góc giao ~40°).
            if (maxTangentDist && cornerDistFromP + uncappedTangentDist > maxTangentDist) {
                const chamferDist = Math.min(radius * 2, maxTangentDist * 0.6);
                const pt1 = A1.clone().add(d1.clone().multiplyScalar(chamferDist));
                const pt2 = A2.clone().add(d2.clone().multiplyScalar(chamferDist));
                return { corner: null, center: null, tangentPt1: pt1, tangentPt2: pt2, arcPts: [pt1, pt2], tangentDist: chamferDist, effectiveRadius: 0, clamped: true, isChamfer: true };
            }

            let effectiveRadius = radius;
            let tangentDist = uncappedTangentDist;
            let clamped = false;
            if (maxTangentDist && tangentDist > maxTangentDist) {
                tangentDist = maxTangentDist;
                effectiveRadius = tangentDist * Math.tan(angle / 2);
                clamped = true;
            }
            const centerDist = effectiveRadius / Math.sin(angle / 2);
            const bisector = d1.clone().add(d2).normalize();
            const center = corner.clone().add(bisector.clone().multiplyScalar(centerDist));
            const tangentPt1 = corner.clone().add(d1.clone().multiplyScalar(tangentDist));
            const tangentPt2 = corner.clone().add(d2.clone().multiplyScalar(tangentDist));
            const startAngle = Math.atan2(tangentPt1.y - center.y, tangentPt1.x - center.x);
            const endAngle = Math.atan2(tangentPt2.y - center.y, tangentPt2.x - center.x);
            let delta = endAngle - startAngle;
            while (delta <= -Math.PI) delta += Math.PI * 2;
            while (delta > Math.PI) delta -= Math.PI * 2;
            const segs = 16;
            const arcPts = [];
            for (let i = 0; i <= segs; i++) {
                const a = startAngle + delta * (i / segs);
                arcPts.push(new THREE.Vector3(center.x + effectiveRadius * Math.cos(a), center.y + effectiveRadius * Math.sin(a), 0));
            }
            return { corner, center, tangentPt1, tangentPt2, arcPts, tangentDist, effectiveRadius, clamped };
        }

        // Bề rộng mép đường (tính từ tim) dùng để bo góc — lấy đúng bằng bề rộng NGOÀI CÙNG của
        // Corridor (Vỉa hè, nếu không có thì Bó vỉa, không có nữa thì Làn xe) — KHÔNG dùng mép Bó vỉa
        // như trước, vì Corridor bị cắt tới sát điểm giao vẫn còn NGUYÊN cả phần Vỉa hè phía ngoài Bó
        // vỉa; nếu mảng Intersection chỉ rộng bằng Bó vỉa sẽ hẹp hơn Corridor, để hở 1 khoảng trống
        // hình tam giác ở góc (đúng lỗi "khoảng hở" đã gặp).
        function getRoadEdgeWidth(assembly) {
            const ranges = computeAssemblyTypeRanges(assembly);
            if (ranges.sidewalk) return ranges.sidewalk.outerAbs;
            if (ranges.curb) return ranges.curb.outerAbs;
            if (ranges.lane) return ranges.lane.outerAbs;
            return 3.5;
        }

        // Dựng 1 khối kết cấu phẳng (mặt đáy + mép bên quanh biên) từ 1 đa giác biên cho trước — dùng
        // cho kết cấu áo đường của Intersection (đơn giản hơn Corridor vì chỉ có 1 mặt cắt duy nhất,
        // không phải nối dọc theo nhiều cọc).
        function buildFlatLayerVolume(boundaryFlat, topZ, thickness, color) {
            const group = new THREE.Group();
            const topPts = boundaryFlat.map(p => new THREE.Vector3(p.x, p.y, topZ));
            const botPts = boundaryFlat.map(p => new THREE.Vector3(p.x, p.y, topZ - thickness));

            const shape = new THREE.Shape(botPts.map(p => new THREE.Vector2(p.x, p.y)));
            const geoBot = new THREE.ShapeGeometry(shape);
            geoBot.translate(0, 0, topZ - thickness);
            group.add(new THREE.Mesh(geoBot, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));

            const positions = [], colors = [];
            const c = new THREE.Color(color);
            for (let i = 0; i < topPts.length; i++) {
                const j = (i + 1) % topPts.length;
                const p1 = topPts[i], p2 = topPts[j], p3 = botPts[j], p4 = botPts[i];
                [p1, p2, p3, p1, p3, p4].forEach(p => positions.push(p.x, p.y, p.z));
                for (let k = 0; k < 6; k++) colors.push(c.r, c.g, c.b);
            }
            const sideGeo = new THREE.BufferGeometry();
            sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            sideGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            sideGeo.computeVertexNormals();
            group.add(new THREE.Mesh(sideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

            return group;
        }

        // Bề rộng mép LÒNG ĐƯỜNG XE CHẠY (trong Bó vỉa, chưa tính Vỉa hè) — dùng làm biên TRONG của
        // vùng giao, để tách riêng phần "lòng đường" (giữa) khỏi phần "vỉa hè bao quanh góc bo" (viền
        // ngoài) — nếu không, cả mảng giao chỉ có 1 màu duy nhất, không thấy vỉa hè đâu.
        function getInnerRoadWidth(assembly) {
            const ranges = computeAssemblyTypeRanges(assembly);
            if (ranges.curb) return ranges.curb.innerAbs;
            if (ranges.lane) return ranges.lane.outerAbs;
            return 3.5;
        }

        // Các vùng cắt (theo lý trình) mà những Intersection đang có trong bản vẽ yêu cầu trên 1 Alignment —
        // Corridor tạo MỚI (sau khi đã có Intersection) dùng hàm này để tự dừng đúng tại mép mảng giao.
        function collectIntersectionExcludeRanges(alignmentName) {
            const out = [];
            entities.forEach(e => {
                if (e.type !== 'INTERSECTION') return;
                const info = e.object.userData.intersectionInfo;
                const r = info && info.excludeRanges && info.excludeRanges[alignmentName];
                if (r) out.push(r);
            });
            return out;
        }

        // Dải tường đứng (không khép kín) nối các điểm liên tiếp từ cao độ zBottom lên zTop — dùng vẽ
        // mặt đứng bó vỉa dọc ranh giới lòng đường / vỉa hè trong mảng giao.
        function buildWallStrip(pts, zBottom, zTop, color) {
            const positions = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                const p1 = [a.x, a.y, zBottom], p2 = [b.x, b.y, zBottom], p3 = [b.x, b.y, zTop], p4 = [a.x, a.y, zTop];
                [p1, p2, p3, p1, p3, p4].forEach(p => positions.push(...p));
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.computeVertexNormals();
            return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        }

        function createIntersectionEntity(alignA, alignB, cornerRadius) {
            const crossing = findAlignmentsCrossing(alignA, alignB);
            if (!crossing) return { error: 'Alignment không cắt nhau (kể cả khi kéo dài đầu tuyến thêm 15m) trong bản vẽ hiện tại.' };
            const infoA = alignA.object.userData.alignmentInfo, infoB = alignB.object.userData.alignmentInfo;

            const P = crossing.point;
            const w = getRoadEdgeWidth(currentAssembly);        // mép NGOÀI cùng (ngoài vỉa hè)
            const wInner = getInnerRoadWidth(currentAssembly);  // mép làn xe (trong bó vỉa)
            const hasSidewalkBand = wInner < w - 1e-3;
            const delta = hasSidewalkBand ? (w - wInner) : 0;
            // Dải đỉnh bó vỉa (xám sáng) nằm giữa lòng đường và vỉa hè, y như trên Corridor
            const _ranges = computeAssemblyTypeRanges(currentAssembly);
            const curbW = _ranges.curb ? (_ranges.curb.outerAbs - _ranges.curb.innerAbs) : 0;
            const wMid = wInner + curbW;                       // mép ngoài bó vỉa = mép trong vỉa hè
            const hasCurbStrip = hasSidewalkBand && curbW > 0.02 && wMid < w - 0.02;
            const getPerp = d => new THREE.Vector3(-d.y, d.x, 0);

            // --- Xác định các NHÁNH thật sự tồn tại tại điểm giao ---
            // Tuyến nào bắt đầu/kết thúc ngay tại điểm giao (trong phạm vi endTol) thì chỉ có 1 nhánh
            // (ngã ba); tuyến đi xuyên qua có 2 nhánh. Không tạo nhánh "ảo" ở phía tuyến đã kết thúc.
            const endTol = Math.max(w * 1.5, 5);
            function branchesFor(key, dir, station, totalLength) {
                const atStart = station <= endTol, atEnd = station >= totalLength - endTol;
                if (atStart && atEnd) return [];
                if (atStart) return [{ key: key + '+', dir: dir.clone() }];
                if (atEnd) return [{ key: key + '-', dir: dir.clone().negate() }];
                return [{ key: key + '+', dir: dir.clone() }, { key: key + '-', dir: dir.clone().negate() }];
            }
            const rays = [
                ...branchesFor('A', crossing.dirA, crossing.stationA, infoA.totalLength),
                ...branchesFor('B', crossing.dirB, crossing.stationB, infoB.totalLength)
            ].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
            const n = rays.length;
            if (n < 3) return { error: 'Điểm giao không đủ 3 nhánh đường để tạo nút giao (cần ngã ba hoặc ngã tư).' };

            // --- Bo góc ---
            // Cung biên NGOÀI (mép vỉa hè) và biên TRONG (mép làn xe) PHẢI ĐỒNG TÂM: bán kính ngoài nhỏ
            // hơn trong đúng bằng bề rộng dải vỉa hè+bó vỉa (delta). Nhờ đó điểm tiếp tuyến của 2 cung trên
            // cùng 1 nhánh nằm cùng khoảng cách dọc tuyến -> đầu mảng vỉa hè vuông góc với tuyến, khớp
            // phẳng với mép cắt Corridor (trước đây tính độc lập với bán kính ngược chiều nên bị XÉO).
            // cornerRadius = bán kính bo tại mép làn xe (bó vỉa), đúng cách gọi thông thường.
            const rOut = Math.max(cornerRadius - delta, 0.5);
            const maxTangentDist = Math.min(cornerRadius * 3 + w * 2, 25);
            let anyClamped = false;
            const slots = []; // slots[i] = góc bo giữa rays[i] và rays[i+1], hoặc null nếu cùng 1 tuyến (phía "đường thẳng")
            for (let i = 0; i < n; i++) {
                const r1 = rays[i], r2 = rays[(i + 1) % n];
                if (r1.key[0] === r2.key[0]) { slots.push(null); continue; }
                const off1 = getPerp(r1.dir).multiplyScalar(w);
                const off2 = getPerp(r2.dir).multiplyScalar(-w);
                const outer = computeQuadrantFillet(P, r1.dir, off1, r2.dir, off2, rOut, maxTangentDist);
                if (!outer) return { error: 'Không bo góc được — 2 tuyến gần như song song/thẳng hàng tại điểm giao.' };
                if (outer.clamped) anyClamped = true;
                // Dịch cung ngoài vào phía tim đường 1 đoạn shift (đồng tâm với cung ngoài)
                const deriveShift = shift => {
                    if (outer.isChamfer) {
                        const p1 = outer.arcPts[0].clone().sub(getPerp(r1.dir).multiplyScalar(shift));
                        const p2 = outer.arcPts[outer.arcPts.length - 1].clone().add(getPerp(r2.dir).multiplyScalar(shift));
                        return { arcPts: [p1, p2], isChamfer: true };
                    }
                    const c = outer.center;
                    return { arcPts: outer.arcPts.map(p => { const v = p.clone().sub(c); const len = v.length() || 1; return c.clone().add(v.multiplyScalar((len + shift) / len)); }) };
                };
                const inner = hasSidewalkBand ? deriveShift(delta) : outer;
                const mid = hasCurbStrip ? deriveShift(w - wMid) : null;
                slots.push({ r1, r2, outer, mid, inner });
            }

            // --- Khoảng cách dọc tuyến D của "cửa" mỗi nhánh (tính từ tim giao P) ---
            // Mảng giao kết thúc đúng tại D (cạnh cửa VUÔNG GÓC tuyến) và Corridor bị cắt đúng tại D.
            const D = {};
            slots.forEach(s => {
                if (!s) return;
                s.a1 = s.outer.arcPts[0].clone().sub(P).dot(s.r1.dir);
                s.a2 = s.outer.arcPts[s.outer.arcPts.length - 1].clone().sub(P).dot(s.r2.dir);
                D[s.r1.key] = Math.max(D[s.r1.key] || 0, s.a1);
                D[s.r2.key] = Math.max(D[s.r2.key] || 0, s.a2);
            });
            rays.forEach(r => { if (!D[r.key]) D[r.key] = w; });
            // Ngã ba vẽ tay: nhánh phụ có thể dừng CÁCH tuyến chính 1 đoạn nhỏ (điểm giao tìm được nhờ
            // kéo dài đầu tuyến). Khi đó phải kéo cửa nhánh tới đúng điểm bắt đầu thật của nhánh phụ,
            // để mảng giao nối liền vào Corridor nhánh phụ, không để lại khe hở.
            rays.forEach(r => {
                const st = r.key[0] === 'A' ? crossing.stationA : crossing.stationB;
                const total = r.key[0] === 'A' ? infoA.totalLength : infoB.totalLength;
                const gap = r.key.endsWith('+') ? Math.max(0, -st) : Math.max(0, st - total);
                if (gap > D[r.key]) D[r.key] = gap;
            });

            function slotPoints(s, variant) {
                const arc = s[variant].arcPts;
                const out = [];
                const ext1 = D[s.r1.key] - s.a1, ext2 = D[s.r2.key] - s.a2;
                if (ext1 > 1e-3) out.push(arc[0].clone().add(s.r1.dir.clone().multiplyScalar(ext1)));
                arc.forEach(p => out.push(p.clone()));
                if (ext2 > 1e-3) out.push(arc[arc.length - 1].clone().add(s.r2.dir.clone().multiplyScalar(ext2)));
                return out;
            }
            // Phía "đường thẳng" của ngã ba (2 nhánh cùng 1 tuyến kề nhau, không có đường nhánh ở giữa):
            // biên chạy dọc MÉP ĐỐI DIỆN của tuyến chính, nối 2 cửa — nhờ đó dải đường chính giữa vùng
            // cắt được lấp đủ (trước đây thiếu dải này nên "đường đi qua ngã 3 bị mất").
            function farPoints(i, width) {
                const ri = rays[i], rj = rays[(i + 1) % n];
                return [
                    P.clone().add(getPerp(ri.dir).multiplyScalar(width)).add(ri.dir.clone().multiplyScalar(D[ri.key])),
                    P.clone().sub(getPerp(rj.dir).multiplyScalar(width)).add(rj.dir.clone().multiplyScalar(D[rj.key]))
                ];
            }
            function buildLoop(variant, width) {
                const pts = [];
                for (let i = 0; i < n; i++) {
                    if (slots[i]) pts.push(...slotPoints(slots[i], variant));
                    else pts.push(...farPoints(i, width));
                }
                return pts;
            }

            // --- Cao độ ---
            const { path: baselineA, source } = findBaselineProfileForAlignment(alignA, 5);
            const realElevAtCrossing = interpolateAlongProfilePath(baselineA, crossing.stationA);
            const dispElev = elevationToDisplayZ(realElevAtCrossing !== null ? realElevAtCrossing : 0);
            const offs = computeCrossSectionOffsets(currentAssembly);
            const outermost = type => offs.filter(p => p.type === type && p.offset > 0).sort((a, b) => b.offset - a.offset)[0];
            const laneEdgeDelta = outermost('lane') ? outermost('lane').elevDelta : 0;
            const sidewalkDelta = outermost('sidewalk') ? outermost('sidewalk').elevDelta : laneEdgeDelta;
            const zLane = dispElev + laneEdgeDelta * 0.5;               // mặt lòng đường (phẳng, ~giữa vồng/dốc ngang)
            const zSidewalk = hasSidewalkBand ? dispElev + sidewalkDelta : zLane; // mặt vỉa hè (cao hơn lòng đường bằng chiều cao bó vỉa)

            // --- Vùng cắt Corridor: đúng bằng D mỗi phía của mỗi tuyến ---
            const rangeFor = (k, station) => [Math.max(0, station - (D[k + '-'] || 0)), station + (D[k + '+'] || 0)];
            const excludeRangeA = rangeFor('A', crossing.stationA);
            const excludeRangeB = rangeFor('B', crossing.stationB);

            const group = new THREE.Group();
            group.userData.isIntersection = true;
            const toFlat = (pts, z) => pts.map(p => new THREE.Vector3(p.x, p.y, z));
            const laneColor = ASSEMBLY_TYPE_COLORS.lane || 0x555560;
            const sidewalkColor = ASSEMBLY_TYPE_COLORS.sidewalk || 0x9a6b3a;
            const curbColor = ASSEMBLY_TYPE_COLORS.curb || 0xcccccc;

            const outerLoop = buildLoop('outer', w);
            const innerLoop = hasSidewalkBand ? buildLoop('inner', wInner) : outerLoop;
            const outerFlat = toFlat(outerLoop, hasSidewalkBand ? zSidewalk : zLane);
            const innerFlat = toFlat(innerLoop, zLane);

            const addFill = (pts, z, color, transparent) => {
                const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.y))));
                geo.translate(0, 0, z);
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: !!transparent, opacity: transparent ? 0.95 : 1 }));
                mesh.userData.isIntersectionMesh = true;
                group.add(mesh);
            };

            // Mặt lòng đường (Làn xe) — gồm cả dải đường chính giữa vùng cắt ở ngã ba
            addFill(innerFlat, zLane, laneColor, true);

            // Vỉa hè: từng mảnh ở mỗi góc bo (giữa cung ngoài và cung trong) + dải vỉa hè phía "đường
            // thẳng" của ngã ba. Mỗi mảnh có đầu vuông góc tuyến, khớp phẳng với vỉa hè Corridor.
            const sidewalkPolys = [], curbPolys = [];
            if (hasSidewalkBand) {
                const swVariant = hasCurbStrip ? 'mid' : 'inner';       // vỉa hè = từ cung ngoài tới cung mid (hoặc inner nếu không có bó vỉa riêng)
                const swWidth = hasCurbStrip ? wMid : wInner;
                for (let i = 0; i < n; i++) {
                    if (slots[i]) {
                        const o = slotPoints(slots[i], 'outer'), m = slotPoints(slots[i], swVariant).reverse();
                        sidewalkPolys.push([...o, ...m]);
                        if (hasCurbStrip) curbPolys.push([...slotPoints(slots[i], 'mid'), ...slotPoints(slots[i], 'inner').reverse()]);
                    } else {
                        const fo = farPoints(i, w), fm = farPoints(i, swWidth);
                        sidewalkPolys.push([fo[0], fo[1], fm[1], fm[0]]);
                        if (hasCurbStrip) { const fi = farPoints(i, wInner); curbPolys.push([fm[0], fm[1], fi[1], fi[0]]); }
                    }
                }
                curbPolys.forEach(poly => addFill(poly, zSidewalk, curbColor, false));
                sidewalkPolys.forEach(poly => addFill(poly, zSidewalk, sidewalkColor, false));

                // Mặt đứng bó vỉa dọc ranh giới lòng đường / vỉa hè
                if (zSidewalk - zLane > 0.005) {
                        for (let i = 0; i < n; i++) {
                        if (slots[i]) {
                            group.add(buildWallStrip(slotPoints(slots[i], 'inner'), zLane, zSidewalk, curbColor));
                        } else {
                            group.add(buildWallStrip(farPoints(i, wInner), zLane, zSidewalk, curbColor));
                        }
                    }
                }
            }

            // Viền + nhãn
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outerFlat), new THREE.LineBasicMaterial({ color: 0xffffff })));
            if (hasSidewalkBand) group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(innerFlat), new THREE.LineBasicMaterial({ color: 0xcccccc })));
            const labelH = Math.max(cornerRadius * 0.35, 0.3);
            group.add(createTextSprite(
                `Intersection: ${infoA.name} x ${infoB.name}`,
                P.clone().setZ(zLane + labelH * 2), labelH
            ));

            // --- Kết cấu ---
            // Lòng đường: các lớp phạm vi "Làn xe" (BTXM, CPĐD...). Vỉa hè: các lớp phạm vi "Vỉa hè"
            // (gạch lát, lớp lót...) — dựng cho TỪNG mảnh vỉa hè, khớp kết cấu với đường đi tới.
            let cumLane = 0;
            pavementLayers.filter(l => l.appliesTo === 'lane' && l.unit === 'area').forEach(layer => {
                const color = layer.color !== undefined ? layer.color : 0x888888;
                group.add(buildFlatLayerVolume(innerFlat, zLane - cumLane, layer.thickness, color));
                cumLane += layer.thickness;
            });
            if (hasSidewalkBand) {
                sidewalkPolys.forEach(poly => {
                    let cum = 0;
                    pavementLayers.filter(l => l.appliesTo === 'sidewalk' && l.unit === 'area').forEach(layer => {
                        const color = layer.color !== undefined ? layer.color : 0x888888;
                        group.add(buildFlatLayerVolume(poly, zSidewalk - cum, layer.thickness, color));
                        cum += layer.thickness;
                    });
                });
            }

            group.userData.boundaryPts = outerFlat;
            group.userData.innerBoundaryPts = innerFlat;
            group.userData.sidewalkPolys = sidewalkPolys;
            group.userData.curbPolys = curbPolys;
            group.userData.intersectionInfo = {
                alignmentA: infoA.name, alignmentB: infoB.name,
                cornerRadius, roadEdgeWidth: w,
                branchCount: n,
                flattenElevSource: source,
                anyClamped,
                excludeRanges: { [infoA.name]: excludeRangeA, [infoB.name]: excludeRangeB }
            };

            // Tự tìm Corridor ĐÃ CÓ SẴN của 2 tuyến và rebuild với vùng cắt vừa tính, để Corridor dừng
            // đúng tại mép mảng giao thay vì chạy xuyên qua.
            [{ entityRef: alignA, range: excludeRangeA }, { entityRef: alignB, range: excludeRangeB }].forEach(({ entityRef, range }) => {
                const name = entityRef.object.userData.alignmentInfo.name;
                entities.forEach(e => {
                    if (e.type !== 'CORRIDOR' || e.object.userData.corridorInfo.alignmentName !== name) return;
                    const merged = (e.object.userData.corridorInfo.excludeStationRanges || []).filter(r => Math.abs(r[0] - range[0]) > 0.01 || Math.abs(r[1] - range[1]) > 0.01);
                    merged.push(range);
                    const rebuilt = createCorridorEntity(entityRef, currentAssembly, e.object.userData.corridorInfo.interval || 10, e.object.userData.corridorInfo.taluyRatio || defaultTaluyRatio, merged);
                    if (rebuilt.error) return;
                    while (e.object.children.length) e.object.remove(e.object.children[0]);
                    rebuilt.group.children.slice().forEach(child => e.object.add(child));
                    e.object.userData.boundaryPts = rebuilt.group.userData.boundaryPts;
                    e.object.userData.corridorInfo = rebuilt.group.userData.corridorInfo;
                });
            });

            return { group };
        }

        let pendingIntersectionAlignA = null;
        let pendingIntersectionAlignB = null;
        let defaultIntersectionRadius = 8;

        function pickAlignmentForIntersection1(hit) {
            pendingIntersectionAlignA = hit;
            setTool('intersection-pick2');
            setCommandText(`Command: Đã chọn tuyến ưu tiên "${hit.object.userData.alignmentInfo.name}". Click tiếp vào tuyến giao thứ 2:`);
        }
        function pickAlignmentForIntersection2(hit) {
            if (hit.id === pendingIntersectionAlignA.id) {
                setCommandText('Command: Phải chọn 2 Alignment khác nhau.');
                return;
            }
            pendingIntersectionAlignB = hit;
            openIntersectionRadiusPopup();
        }
        function openIntersectionRadiusPopup() {
            document.getElementById('intersection-radius-popup').style.display = 'flex';
            const field = document.getElementById('intersection-radius-field');
            field.value = defaultIntersectionRadius;
            field.focus(); field.select();
            setTool('intersection-radius');
        }
        function closeIntersectionRadiusPopup() {
            document.getElementById('intersection-radius-popup').style.display = 'none';
        }
        function confirmIntersectionRadius() {
            const radius = parseFloat(document.getElementById('intersection-radius-field').value);
            if (isNaN(radius) || radius <= 0) {
                setCommandText('Command: Bán kính bo góc không hợp lệ.');
                return;
            }
            defaultIntersectionRadius = radius;
            closeIntersectionRadiusPopup();
            const result = createIntersectionEntity(pendingIntersectionAlignA, pendingIntersectionAlignB, radius);
            if (result.error) {
                setCommandText('Command: ' + result.error);
            } else {
                execute(makeAddCommand('INTERSECTION', result.group));
                const clampNote = result.group.userData.intersectionInfo.anyClamped
                    ? ' (Lưu ý: góc giao khá xiên nên 1 vài góc bo đã tự giảm bán kính nhỏ hơn yêu cầu để tránh cung bo văng ra quá xa.)'
                    : '';
                setCommandText(`Command: Đã tạo Intersection giữa "${result.group.userData.intersectionInfo.alignmentA}" và "${result.group.userData.intersectionInfo.alignmentB}".${clampNote}`);
            }
            pendingIntersectionAlignA = null; pendingIntersectionAlignB = null;
            setTool('select');
        }
        document.getElementById('intersection-radius-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmIntersectionRadius();
            else if (event.key === 'Escape') { closeIntersectionRadiusPopup(); pendingIntersectionAlignA = null; pendingIntersectionAlignB = null; setTool('select'); setCommandText('Command: Đã huỷ Intersection.'); }
        });

