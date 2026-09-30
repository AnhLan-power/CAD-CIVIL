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
            for (let i = 0; i < pathA.length - 1; i++) {
                for (let j = 0; j < pathB.length - 1; j++) {
                    const hit = segmentIntersection2D(pathA[i], pathA[i + 1], pathB[j], pathB[j + 1]);
                    if (!hit) continue;
                    let stationA = 0;
                    for (let k = 0; k < i; k++) stationA += pathA[k].distanceTo(pathA[k + 1]);
                    stationA += pathA[i].distanceTo(pathA[i + 1]) * hit.t;
                    let stationB = 0;
                    for (let k = 0; k < j; k++) stationB += pathB[k].distanceTo(pathB[k + 1]);
                    stationB += pathB[j].distanceTo(pathB[j + 1]) * hit.u;
                    return {
                        point: new THREE.Vector3(hit.x, hit.y, 0),
                        stationA, stationB,
                        dirA: pathA[i + 1].clone().sub(pathA[i]).normalize(),
                        dirB: pathB[j + 1].clone().sub(pathB[j]).normalize()
                    };
                }
            }
            return null;
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

        function createIntersectionEntity(alignA, alignB, cornerRadius) {
            const crossing = findAlignmentsCrossing(alignA, alignB);
            if (!crossing) return { error: 'Alignment không cắt nhau trong bản vẽ hiện tại.' };

            const w = getRoadEdgeWidth(currentAssembly);
            const getPerp = d => new THREE.Vector3(-d.y, d.x, 0);

            // Tự phát hiện NGÃ BA: nếu điểm giao nằm ngay ĐẦU hoặc CUỐI của 1 trong 2 Alignment (thay
            // vì cắt ngang giữa tuyến), tuyến đó COI NHƯ KẾT THÚC tại đây — chỉ lấy 1 nhánh (hướng còn
            // tiếp tục), không lấy cả 2 hướng như tuyến cắt ngang qua (ngã tư). Nhờ vậy code bên dưới
            // dùng chung được cho cả ngã ba (3 nhánh) lẫn ngã tư (4 nhánh).
            const infoA = alignA.object.userData.alignmentInfo, infoB = alignB.object.userData.alignmentInfo;
            const endTol = Math.max(w * 1.5, 5);
            function branchesFor(key, dir, station, totalLength) {
                const atStart = station <= endTol, atEnd = station >= totalLength - endTol;
                if (atStart && !atEnd) return [{ key: key + '+', dir, width: w }];
                if (atEnd && !atStart) return [{ key: key + '-', dir: dir.clone().negate(), width: w }];
                return [{ key: key + '+', dir, width: w }, { key: key + '-', dir: dir.clone().negate(), width: w }];
            }
            const rays = [
                ...branchesFor('A', crossing.dirA, crossing.stationA, infoA.totalLength),
                ...branchesFor('B', crossing.dirB, crossing.stationB, infoB.totalLength)
            ].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
            if (rays.length < 3) return { error: 'Cả 2 Alignment đều kết thúc ngay tại điểm giao — không đủ nhánh để tạo Intersection (cần ít nhất 1 tuyến chạy xuyên qua, hoặc cả 2 tuyến cùng có 1 đoạn tiếp diễn).' };

            // Bo góc mép NGOÀI (Vỉa hè) — với ngã ba, cặp nhánh CÙNG 1 tuyến (VD A+ và A- của tuyến
            // chạy xuyên qua) không cần bo (đó là cạnh thẳng tự nhiên của tuyến, không có tuyến kia
            // chắn ngang) — bỏ qua, KHÔNG báo lỗi. Chỉ báo lỗi khi 2 tuyến KHÁC NHAU gần như song song.
            const maxTangentDist = Math.min(cornerRadius * 3 + w * 2, 25);
            function buildFillets(width, radius) {
                const list = [];
                for (let i = 0; i < rays.length; i++) {
                    const r1 = rays[i], r2 = rays[(i + 1) % rays.length];
                    const sameAlignment = r1.key[0] === r2.key[0];
                    const offsetVec1 = getPerp(r1.dir).multiplyScalar(width);
                    const offsetVec2 = getPerp(r2.dir).multiplyScalar(-width);
                    const fillet = computeQuadrantFillet(crossing.point, r1.dir, offsetVec1, r2.dir, offsetVec2, radius, maxTangentDist);
                    if (!fillet) {
                        if (sameAlignment) continue; // cạnh thẳng tự nhiên (ngã ba) -> bỏ qua, không lỗi
                        return { error: 'Không bo góc được — 2 tuyến gần như song song/thẳng hàng tại điểm giao, hoặc bán kính bo góc quá lớn so với bề rộng đường.' };
                    }
                    list.push({ ...fillet, r1, r2 });
                }
                return { list };
            }

            const outerRes = buildFillets(w, cornerRadius);
            if (outerRes.error) return { error: outerRes.error };
            const fillets = outerRes.list;
            let anyClamped = fillets.some(f => f.clamped);

            // Khoảng cách tiếp tuyến (tangentDist) lớn nhất theo từng hướng — dùng để biết Corridor
            // cần "cắt" (bỏ dựng hình) từ điểm giao ra xa bao nhiêu mét mỗi phía, sao cho vùng cắt đủ
            // rộng để chứa TRỌN cả 2 cung bo góc liền kề hướng đó (mỗi hướng có thể chạm 2 cung khác nhau).
            const maxTangentByKey = { 'A+': 0, 'A-': 0, 'B+': 0, 'B-': 0 };
            fillets.forEach(f => {
                maxTangentByKey[f.r1.key] = Math.max(maxTangentByKey[f.r1.key], f.tangentDist);
                maxTangentByKey[f.r2.key] = Math.max(maxTangentByKey[f.r2.key], f.tangentDist);
            });

            // Bo góc lần 2 theo mép TRONG (lòng đường xe chạy, trong Bó vỉa) — dùng bán kính bo NHỎ
            // HƠN theo đúng tỉ lệ (bo góc lòng đường luôn nhỏ hơn bo góc mép ngoài cùng 1 khoảng =
            // hiệu 2 bề rộng), để tạo biên trong cho vùng "lòng đường". Vỉa hè (viền giữa biên trong
            // và biên ngoài) CHỈ dựng ở đúng từng góc bo (dạng "múi"), KHÔNG kéo dài dọc theo đoạn
            // thẳng nối 2 góc bo liền kề — đoạn thẳng đó là phần vỉa hè của CHÍNH Corridor (đã cắt lùi
            // đúng tới đây), Intersection không vẽ chồng lên để tránh 2 lớp vỉa hè chồng nhau.
            const wInner = getInnerRoadWidth(currentAssembly);
            const innerRadius = Math.max(cornerRadius - (w - wInner), 0.5);
            const hasInnerRing = wInner < w - 1e-3;
            let innerFillets = [];
            if (hasInnerRing) {
                const innerRes = buildFillets(wInner, innerRadius);
                if (!innerRes.error) innerFillets = innerRes.list;
            }
            // Ghép mỗi góc bo NGOÀI với đúng góc bo TRONG cùng cặp nhánh (r1.key+r2.key) để dựng "múi"
            // vỉa hè riêng cho từng góc — không dùng chỉ số mảng (index) vì số lượng góc bo ngoài/trong
            // có thể lệch nhau nếu 1 trong 2 lần bo gặp trường hợp góc quá xiên phải bỏ qua.
            const cornerPairs = fillets.map(fOuter => {
                const fInner = innerFillets.find(fi => fi.r1.key === fOuter.r1.key && fi.r2.key === fOuter.r2.key);
                return { outer: fOuter, inner: fInner || null };
            });

            // Cao độ "làm phẳng" cả vùng giao — lấy theo tuyến ƯU TIÊN (tuyến click đầu tiên: alignA)
            const { path: pathA } = buildAlignmentPath(alignA.object.userData.boundaryPts, infoA.radius);
            const { stations: stationsA } = computeStations(pathA, 5, 0);
            const { path: baselineA, source } = findBaselineProfileForAlignment(alignA, 5);
            const realElevAtCrossing = interpolateAlongProfilePath(baselineA, crossing.stationA);
            const dispElev = elevationToDisplayZ(realElevAtCrossing !== null ? realElevAtCrossing : 0);

            // Phạm vi lý trình cần "cắt" trên mỗi tuyến — cộng thêm 1 chút dư (0.3m) để mép Corridor
            // nằm gọn KHUẤT dưới mảng Intersection, không hở khe do sai số làm tròn. Với nhánh KHÔNG
            // tồn tại (tuyến kết thúc tại đây — ngã ba), maxTangentByKey giữ nguyên 0, exclude range
            // thu về đúng 1 phía (không cắt "quá" đầu/cuối tuyến vốn đã không có gì ở đó).
            const marginExtra = 0.3;
            const excludeRangeA = [crossing.stationA - maxTangentByKey['A-'] - marginExtra, crossing.stationA + maxTangentByKey['A+'] + marginExtra];
            const excludeRangeB = [crossing.stationB - maxTangentByKey['B-'] - marginExtra, crossing.stationB + maxTangentByKey['B+'] + marginExtra];

            const group = new THREE.Group();
            group.userData.isIntersection = true;

            // Đường biên vùng giao (mép ngoài) = nối liên tiếp các cung bo góc theo đúng thứ tự nhánh
            // (giữa 2 cung liền kề tự động là đoạn thẳng — phần mép đường thẳng chưa bị bo, hoặc cạnh
            // thẳng tự nhiên phía sau ở ngã ba — không cần vẽ riêng, tự nối do các điểm liền nhau).
            const boundary = [];
            fillets.forEach(f => boundary.push(...f.arcPts));
            const boundaryFlat = boundary.map(p => new THREE.Vector3(p.x, p.y, dispElev));

            // Biên trong (lòng đường xe chạy) — dùng để tô Làn xe + dựng kết cấu áo đường
            const innerBoundary = [];
            cornerPairs.forEach(({ inner }) => { if (inner) innerBoundary.push(...inner.arcPts); });
            const innerBoundaryFlat = innerBoundary.map(p => new THREE.Vector3(p.x, p.y, dispElev));
            const drivableBoundaryFlat = innerBoundaryFlat.length >= 3 ? innerBoundaryFlat : boundaryFlat;

            // Vỉa hè: mỗi góc bo dựng RIÊNG 1 "múi" (mặt cắt hình quạt giữa cung ngoài và cung trong
            // của ĐÚNG góc đó, khép kín bằng 2 đoạn thẳng nối 2 đầu tương ứng) — không nối liền các múi
            // với nhau, để không lan ra đoạn thẳng giữa 2 góc.
            const sidewalkColor = ASSEMBLY_TYPE_COLORS.sidewalk || 0x9a6b3a;
            cornerPairs.forEach(({ outer, inner }) => {
                if (!inner) return; // góc này không tách được biên trong (VD bo góc trong bị lỗi) -> bỏ qua, không vẽ vỉa hè ở đây
                const wedgePts2D = [
                    ...outer.arcPts.map(p => new THREE.Vector2(p.x, p.y)),
                    ...inner.arcPts.slice().reverse().map(p => new THREE.Vector2(p.x, p.y))
                ];
                const wedgeShape = new THREE.Shape(wedgePts2D);
                const wedgeGeo = new THREE.ShapeGeometry(wedgeShape);
                wedgeGeo.translate(0, 0, dispElev);
                const wedgeMesh = new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({ color: sidewalkColor, side: THREE.DoubleSide }));
                wedgeMesh.userData.isIntersectionMesh = true;
                group.add(wedgeMesh);
            });
            if (innerBoundaryFlat.length >= 3) {
                group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(innerBoundaryFlat), new THREE.LineBasicMaterial({ color: 0xffffff })));
            }

            // Mặt lòng đường (Làn xe)
            const fillMat = new THREE.MeshBasicMaterial({ color: ASSEMBLY_TYPE_COLORS.lane || 0x555560, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
            const shape = new THREE.Shape(drivableBoundaryFlat.map(p => new THREE.Vector2(p.x, p.y)));
            const geo = new THREE.ShapeGeometry(shape);
            // ShapeGeometry dựng trên mặt phẳng XY tại z=0 -> dịch lên đúng cao độ đã tính
            geo.translate(0, 0, dispElev);
            const mesh = new THREE.Mesh(geo, fillMat);
            mesh.userData.isIntersectionMesh = true;
            group.add(mesh);

            // Viền ngoài cùng + nhãn
            const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(boundaryFlat), new THREE.LineBasicMaterial({ color: 0xffffff }));
            group.add(outline);
            const labelH = Math.max(cornerRadius * 0.35, 0.3);
            group.add(createTextSprite(
                `Intersection: ${alignA.object.userData.alignmentInfo.name} x ${alignB.object.userData.alignmentInfo.name}`,
                crossing.point.clone().setZ(dispElev + labelH * 2), labelH
            ));

            // Kết cấu áo đường cho phần LÒNG ĐƯỜNG — lấy đúng các lớp khai báo phạm vi "Làn xe" (BTXM,
            // CPĐD...) trong Assembly Editor. Vỉa hè bao quanh góc bo (nếu có) hiện chỉ tô màu phẳng,
            // chưa có kết cấu riêng theo lớp (dải vỉa hè mỏng, ít ảnh hưởng hình dạng tổng thể).
            let cumThickness = 0;
            pavementLayers.filter(l => l.appliesTo === 'lane' && l.unit === 'area').forEach(layer => {
                const color = layer.color !== undefined ? layer.color : 0x888888;
                group.add(buildFlatLayerVolume(drivableBoundaryFlat, dispElev - cumThickness, layer.thickness, color));
                cumThickness += layer.thickness;
            });

            group.userData.boundaryPts = boundaryFlat;
            group.userData.intersectionInfo = {
                alignmentA: alignA.object.userData.alignmentInfo.name,
                alignmentB: alignB.object.userData.alignmentInfo.name,
                cornerRadius, roadEdgeWidth: w,
                flattenElevSource: source,
                anyClamped
            };

            // Tự tìm Corridor ĐÃ CÓ SẴN của 2 tuyến này (nếu có) và rebuild lại với vùng cắt vừa tính,
            // để Corridor dừng lại đúng tại biên vùng giao thay vì chạy xuyên qua — đây là chỗ khiến
            // Intersection trước đây trông "rời rạc", không liền mạch với Corridor.
            [{ entityRef: alignA, range: excludeRangeA }, { entityRef: alignB, range: excludeRangeB }].forEach(({ entityRef, range }) => {
                const name = entityRef.object.userData.alignmentInfo.name;
                entities.forEach(e => {
                    if (e.type !== 'CORRIDOR' || e.object.userData.corridorInfo.alignmentName !== name) return;
                    const existingRanges = (e.object.userData.corridorInfo.excludeStationRanges || []).slice();
                    existingRanges.push(range);
                    const rebuilt = createCorridorEntity(entityRef, currentAssembly, e.object.userData.corridorInfo.interval || 10, e.object.userData.corridorInfo.taluyRatio || defaultTaluyRatio, existingRanges);
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

