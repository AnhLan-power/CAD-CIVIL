        /* =========================================================================================
         * CORRIDOR (kiểu Civil3D, rút gọn): đùn Assembly (mặt cắt ngang) dọc theo Alignment, lấy cao
         * độ tim tuyến từ Profile FG đã thiết kế (nếu có) hoặc từ Surface EG (nếu chưa), nối các mặt
         * cắt liền kề thành 1 mặt lưới 3D tô màu theo từng thành phần (làn/bó vỉa/vỉa hè...).
         * =========================================================================================
         */

        // Quy đổi Assembly thành danh sách điểm offset ngang (âm=trái, dương=phải) kèm chênh cao tích luỹ
        // Mỗi thành phần Assembly có thể có "height" (bậc đứng, vd mặt bó vỉa) áp dụng NGAY tại vị trí
        // hiện tại trước khi trải rộng theo width/slope — tạo hình chữ L (đứng rồi mới nằm) đúng kiểu
        // bó vỉa thật, thay vì chỉ 1 đoạn phẳng nối liền như trước.
        function computeCrossSectionOffsets(assembly) {
            const rightPts = [{ offset: 0, elevDelta: 0, type: 'centerline' }];
            let curOffset = 0, curElev = 0;
            assembly.filter(c => c.side === 'right' || c.side === 'both').forEach(c => {
                if (c.height) { curElev += c.height; rightPts.push({ offset: curOffset, elevDelta: curElev, type: c.type, color: c.color }); }
                curElev += c.width * (c.slope / 100);
                curOffset += c.width;
                rightPts.push({ offset: curOffset, elevDelta: curElev, type: c.type, color: c.color });
            });
            const leftPts = [{ offset: 0, elevDelta: 0, type: 'centerline' }];
            let curOffsetL = 0, curElevL = 0;
            assembly.filter(c => c.side === 'left' || c.side === 'both').forEach(c => {
                if (c.height) { curElevL += c.height; leftPts.push({ offset: curOffsetL, elevDelta: curElevL, type: c.type, color: c.color }); }
                curElevL += c.width * (c.slope / 100);
                curOffsetL -= c.width;
                leftPts.push({ offset: curOffsetL, elevDelta: curElevL, type: c.type, color: c.color });
            });
            return leftPts.slice(1).reverse().concat([{ offset: 0, elevDelta: 0, type: 'centerline' }], rightPts.slice(1));
        }

        // Phạm vi offset (tính từ tim tuyến) mà mỗi LOẠI thành phần Assembly chiếm giữ — dùng để scope
        // kết cấu áo đường theo đúng loại (VD: "chỉ trong Làn xe" hay "chỉ trong Vỉa hè"), thay vì chỉ
        // có 2 lựa chọn "toàn bộ nền" / "toàn bộ mặt đường" như trước (khiến kết cấu mặt đường lỡ tay
        // trải luôn dưới vỉa hè). innerAbs/outerAbs tính 1 bên (giả định đối xứng 'both').
        function computeAssemblyTypeRanges(assembly) {
            const ranges = {};
            let curOffset = 0;
            assembly.filter(c => c.side === 'right' || c.side === 'both').forEach(c => {
                const start = curOffset;
                curOffset += c.width;
                const end = curOffset;
                if (!ranges[c.type]) ranges[c.type] = { innerAbs: start, outerAbs: end };
                else {
                    ranges[c.type].innerAbs = Math.min(ranges[c.type].innerAbs, start);
                    ranges[c.type].outerAbs = Math.max(ranges[c.type].outerAbs, end);
                }
            });
            return ranges;
        }

        // Lọc các điểm của templatePts nằm trong đúng phạm vi (range) của 1 "scope" (loại thành phần),
        // giới hạn theo 1 bên (sideSign: -1 trái / +1 phải / 0 = cả 2 bên nối liền qua tim).
        // QUAN TRỌNG: 1 thành phần có "height" (VD bó vỉa) tạo ra 2 điểm CÙNG offset (điểm chân bậc
        // đứng + điểm đỉnh bậc), và điểm chân bậc đứng đó lại trùng offset với điểm MÉP của thành phần
        // LIỀN KỀ bên trong (VD mép Làn xe). Nếu chỉ "lấy điểm đầu tiên gặp theo thứ tự mảng" khi khử
        // trùng offset (như cách làm cũ), sẽ có lúc vô tình lấy nhầm điểm của thành phần bên cạnh —
        // gây "gãy khúc" lệch cao độ đột ngột ở 1 bên (khác bên kia), tạo hình chữ X kỳ dị khi vẽ. Nên
        // PHẢI ưu tiên chọn đúng điểm có type === scope tại mỗi offset trùng nhau.
        function filterPointsInScope(pts, scope, range, sideSign) {
            const byOffset = new Map();
            pts.forEach(pt => {
                if (sideSign < 0 && pt.offset > 1e-6) return;
                if (sideSign > 0 && pt.offset < -1e-6) return;
                const a = Math.abs(pt.offset);
                if (a < range.innerAbs - 1e-6 || a > range.outerAbs + 1e-6) return;
                const key = pt.offset.toFixed(6);
                if (!byOffset.has(key)) byOffset.set(key, []);
                byOffset.get(key).push(pt);
            });
            const result = [];
            byOffset.forEach(group => {
                result.push(group.find(p => p.type === scope) || group[0]);
            });
            return result.sort((a, b) => a.offset - b.offset);
        }

        // Toạ độ 3D của toàn bộ mặt cắt ngang tại 1 điểm tim tuyến (center) theo hướng tiến (dir)
        function computeStationCrossSection(center, dir, crossSectionOffsets) {
            const perp = new THREE.Vector3(-dir.y, dir.x, 0);
            return crossSectionOffsets.map(pt => ({
                pos: new THREE.Vector3(center.x + perp.x * pt.offset, center.y + perp.y * pt.offset, center.z + pt.elevDelta),
                type: pt.type
            }));
        }

        // Tìm nguồn cao độ tim tuyến: ưu tiên FG (đường đỏ) từ 1 Profile View đã thiết kế cho đúng
        // Alignment này, nếu chưa có thì lấy EG trực tiếp từ Surface
        function findBaselineProfileForAlignment(alignmentEntity, interval) {
            const targetName = alignmentEntity.object.userData.alignmentInfo.name;
            let foundFG = null;
            entities.forEach(e => {
                if (e.type === 'PROFILEVIEW' && e.object.userData.profileInfo &&
                    e.object.userData.profileInfo.alignmentName === targetName &&
                    e.object.userData.fgRendered && e.object.userData.fgRendered.length > 1) {
                    foundFG = e.object.userData.fgRendered;
                }
            });
            if (foundFG) return { path: foundFG, source: 'FG (đường đỏ đã thiết kế)' };
            return { path: extractEGProfile(alignmentEntity, interval), source: 'EG (mặt đất tự nhiên từ Surface)' };
        }

        function createCorridorEntity(alignmentEntity, assembly, interval, taluyRatio, excludeStationRanges) {
            const info = alignmentEntity.object.userData.alignmentInfo;
            const piPoints = alignmentEntity.object.userData.boundaryPts;
            const { path } = buildAlignmentPath(piPoints, info.radius);
            const { stations } = computeStations(path, interval, 0);
            const { path: baseline, source } = findBaselineProfileForAlignment(alignmentEntity, interval);
            if (baseline.length < 2) return { error: 'Không tìm được dữ liệu cao độ (cần có Surface hoặc Profile FG cho Alignment này).' };

            const crossSectionOffsets = computeCrossSectionOffsets(assembly);
            if (crossSectionOffsets.length < 2) return { error: 'Assembly chưa có thành phần nào.' };

            const ratio = taluyRatio > 0 ? taluyRatio : defaultTaluyRatio;
            const maxAsmOffset = Math.max(...crossSectionOffsets.map(p => Math.abs(p.offset)), 1);
            const halfWidthForCorridor = maxAsmOffset + 10; // đủ rộng để dò taluy chạm EG

            // Dùng LẠI đúng hàm tính mặt cắt của Trắc ngang cho từng cọc dọc Corridor, để có luôn cả
            // taluy 2 bên (daylight) chứ không dừng đột ngột ở mép mặt đường như phiên bản trước.
            const sectionDataList = stations.map(st => computeSectionAtStation(st, assembly, baseline, halfWidthForCorridor, ratio));

            // Các cọc rơi vào phạm vi 1 Intersection (nếu có) — dùng để "cắt" Corridor dừng lại đúng
            // tại biên vùng giao, thay vì chạy xuyên qua Intersection (xem excludeStationRanges, được
            // tự tính khi tạo Intersection và lưu lại trong corridorInfo để rebuild vẫn giữ đúng chỗ cắt).
            const ranges = excludeStationRanges || [];
            const stationInGap = stations.map(st => ranges.some(r => st.station >= r[0] && st.station <= r[1]));
            const skipConnection = i => stationInGap[i] || stationInGap[i + 1];

            const group = new THREE.Group();
            group.userData.isCorridor = true;

            // Vị trí 3D của 1 điểm THUỘC MẶT ĐƯỜNG/KẾT CẤU (không phải điểm chân taluy lấy từ EG):
            // z = (cao độ TIM TUYẾN quy đổi theo tỉ lệ Surface) + (độ lệch THẬT so với tim tuyến).
            // QUAN TRỌNG: "độ lệch so với tim" ở đây gồm dốc ngang (%), chiều cao bậc bó vỉa, VÀ độ
            // dày kết cấu áo đường — đều là kích thước kỹ thuật nhỏ, chính xác, không được nhân thêm
            // hệ số phóng đại địa hình của Surface (nếu không, dốc 2% hay bó vỉa 15cm sẽ bị thổi phồng
            // thành vách dựng đứng/gai nhọn khi Surface đang phóng đại cao độ ×10-20 lần). Chỉ RIÊNG
            // cao độ tim tuyến (gắn với địa hình dọc tuyến) mới cần quy đổi theo Surface.
            function worldAtDelta(st, data, offset, deltaFromCenter) {
                const perp = new THREE.Vector3(-st.dir.y, st.dir.x, 0);
                const z = elevationToDisplayZ(data.centerElev) + deltaFromCenter;
                return new THREE.Vector3(st.pos.x + perp.x * offset, st.pos.y + perp.y * offset, z);
            }
            // Vị trí 3D của điểm chân taluy (lấy từ giao với EG thật) — đây LÀ 1 đặc điểm địa hình
            // thật (có thể chênh cao vài mét do đào/đắp), nên áp đúng tỉ lệ phóng đại của Surface như
            // các điểm EG khác, để khớp trực quan với địa hình xung quanh.
            function worldAtTaluy(st, offset, realElev) {
                const perp = new THREE.Vector3(-st.dir.y, st.dir.x, 0);
                return new THREE.Vector3(st.pos.x + perp.x * offset, st.pos.y + perp.y * offset, elevationToDisplayZ(realElev));
            }
            // colorFn có thể là hàm 2 tham số (a,b) như pickSegmentColor, hoặc hàm 0 tham số trả màu cố
            // định — skip là hàm(i) trả true nếu KHÔNG nối cọc i với cọc i+1 (dùng để cắt tại Intersection).
            function buildStripGeometry(rows, colorFn, skip) {
                const positions = [], colors = [];
                const nCols = rows[0].length;
                for (let i = 0; i < rows.length - 1; i++) {
                    if (skip && skip(i)) continue; // bỏ nối 2 cọc này (VD: rơi vào vùng giao Intersection)
                    for (let j = 0; j < nCols - 1; j++) {
                        const p1 = rows[i][j].pos, p2 = rows[i][j + 1].pos;
                        const p3 = rows[i + 1][j + 1].pos, p4 = rows[i + 1][j].pos;
                        // Truyền CẢ 2 đầu đoạn (a, b) cho colorFn tự chọn, thay vì luôn lấy đầu "b" —
                        // vì đúng tại tim tuyến, điểm "centerline" (chỉ dùng làm mốc, không phải màu
                        // thật) có thể rơi vào vị trí "b" của đoạn làn bên trái, khiến bên trái bị
                        // nhuộm nhầm màu tim tuyến trong khi bên phải thì không (xem colorFn dưới).
                        const c = new THREE.Color(colorFn(rows[i][j], rows[i][j + 1], j));
                        [p1, p2, p3, p1, p3, p4].forEach(p => positions.push(p.x, p.y, p.z));
                        for (let k = 0; k < 6; k++) colors.push(c.r, c.g, c.b);
                    }
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                geo.computeVertexNormals();
                return geo;
            }
            // Lấy màu 1 đoạn mặt trên: mỗi thành phần Assembly (làn/bó vỉa/vỉa hè...) được định
            // nghĩa "từ mép trong ra mép ngoài", nên đầu mút NẰM XA TIM TUYẾN HƠN mới đúng là điểm
            // đại diện cho loại vật liệu của cả đoạn đó — áp dụng ĐÚNG NHƯ NHAU cho cả 2 bên (khác với
            // cách cũ luôn lấy đầu "b", chỉ đúng cho bên phải vì mảng bên trái bị đảo ngược thứ tự khi
            // ghép lại, khiến đoạn vỉa hè/bó vỉa bên trái từng bị lệch sang màu của thành phần liền kề).
            // CHỈ "centerline" mới là mốc ảo (không có màu vật liệu thật, offset luôn = 0 nên không
            // bao giờ là điểm "xa hơn" thực sự — chừa lại để phòng trường hợp 2 điểm cùng offset=0).
            // "taluy" KHÔNG PHẢI mốc ảo — đó là mặt dốc thật (đất tự nhiên), cần giữ đúng màu riêng
            // của nó (không được "mượn" màu của mép mặt đường/vỉa hè liền kề, đây chính là lỗi khiến
            // cả 2 bên taluy bị nhuộm nhầm theo màu vỉa hè vừa đổi).
            function pickSegmentColor(a, b) {
                const isMeta = t => t === 'centerline';
                const farther = Math.abs(a.offset) >= Math.abs(b.offset) ? a : b;
                const nearer = farther === a ? b : a;
                const chosen = isMeta(farther.type) && !isMeta(nearer.type) ? nearer : farther;
                return chosen.color || ASSEMBLY_TYPE_COLORS[chosen.type] || 0x888888;
            }

            // 1) MẶT TRÊN cùng — Template (mặt đường/lề, dốc ngang + bó vỉa đúng tỉ lệ thật) NỐI LIỀN
            // 2 bên taluy xuống/lên đúng EG (data.fullTemplate), thay vì dừng đột ngột ở mép mặt đường.
            const topRows = sectionDataList.map((data, idx) =>
                data.fullTemplate.map(pt => ({
                    pos: pt.type === 'taluy'
                        ? worldAtTaluy(stations[idx], pt.offset, pt.elev)
                        : worldAtDelta(stations[idx], data, pt.offset, pt.elev - data.centerElev),
                    type: pt.type,
                    color: pt.color
                }))
            );
            const topGeo = buildStripGeometry(topRows, pickSegmentColor, skipConnection);
            const topMesh = new THREE.Mesh(topGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
            topMesh.userData.isCorridorMesh = true;
            group.add(topMesh);
            const wireGeo = new THREE.WireframeGeometry(topGeo);
            const wireframe = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.45 }));
            wireframe.userData.isCorridorWireframe = true;
            group.add(wireframe);

            // 2) KẾT CẤU: mỗi lớp (chiều dày + màu + PHẠM VI khai báo trong Assembly Editor, mục "Kết
            // cấu áo đường") được dựng thành 1 lớp mặt đáy + 2 mép cạnh, CHỈ trong đúng phạm vi offset
            // của loại đó (VD: BTXM chỉ trải trong Làn xe, không lan sang Vỉa hè) — mỗi phạm vi
            // (scope) có chồng lớp (cumThickness) riêng, độc lập với phạm vi khác.
            const typeRanges = computeAssemblyTypeRanges(assembly);
            const cumThicknessByScope = {};
            pavementLayers.filter(l => l.appliesTo !== 'full' && l.unit === 'area').forEach(layer => {
                const scope = layer.appliesTo;
                const range = typeRanges[scope];
                if (!range) return; // Assembly hiện tại không có thành phần loại này -> bỏ qua lớp này
                const cum = cumThicknessByScope[scope] || 0;
                const topOffset = cum, botOffset = cum + layer.thickness;
                const color = layer.color !== undefined ? layer.color : 0x888888;

                // QUAN TRỌNG: nếu range.innerAbs > 0 (VD vỉa hè: 3.7 -> 5.2), 2 bên trái/phải KHÔNG
                // nối liền qua tim tuyến — phải dựng thành 2 dải RIÊNG BIỆT (trái, phải). Nếu chỉ lọc
                // điểm theo |offset| rồi dựng 1 dải duy nhất, hàm buildStripGeometry sẽ nối lụa 2 đầu
                // gần tim lại với nhau, tạo ra 1 tấm bắc ngang xuyên suốt QUA CẢ LÀN ĐƯỜNG — đây chính
                // là lỗi "kết cấu vỉa hè lấn vào làn đường" đã gặp. Chỉ khi range.innerAbs === 0 (VD
                // làn xe, nối liền qua tim) thì mới dựng 1 dải liên tục duy nhất.
                const sideSigns = range.innerAbs > 0 ? [-1, 1] : [0];
                sideSigns.forEach(sideSign => {
                    const layerTopRows = sectionDataList.map((data, idx) =>
                        filterPointsInScope(data.templatePts, scope, range, sideSign).map(pt => ({ pos: worldAtDelta(stations[idx], data, pt.offset, (pt.elev - data.centerElev) - topOffset) }))
                    );
                    const layerBotRows = sectionDataList.map((data, idx) =>
                        filterPointsInScope(data.templatePts, scope, range, sideSign).map(pt => ({ pos: worldAtDelta(stations[idx], data, pt.offset, (pt.elev - data.centerElev) - botOffset) }))
                    );
                    if (layerTopRows[0].length < 2) return; // phạm vi quá hẹp, không đủ điểm để dựng

                    // Mặt đáy của lớp (đường phân cách với lớp bên dưới)
                    const botGeo = buildStripGeometry(layerBotRows, () => color, skipConnection);
                    const botMesh = new THREE.Mesh(botGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
                    botMesh.userData.isCorridorMesh = true;
                    group.add(botMesh);

                    // 2 mép cạnh trái/phải nối mặt trên-đáy của lớp, dọc suốt chiều dài Corridor
                    const nCols = layerTopRows[0].length;
                    [0, nCols - 1].forEach(j => {
                        const edgeRows = [];
                        for (let i = 0; i < layerTopRows.length; i++) {
                            edgeRows.push([{ pos: layerTopRows[i][j].pos }, { pos: layerBotRows[i][j].pos }]);
                        }
                        const edgeGeo = buildStripGeometry(edgeRows, () => color, skipConnection);
                        const edgeMesh = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
                        edgeMesh.userData.isCorridorMesh = true;
                        group.add(edgeMesh);
                    });
                });

                cumThicknessByScope[scope] = botOffset;
            });

            // Lớp áp dụng "Toàn bộ bề rộng nền" (VD Bóc hữu cơ): dựng NGAY DƯỚI mặt EG (mặt đất tự
            // nhiên) thật, trải từ chân taluy trái đến chân taluy phải — dùng cao độ EG thật (đúng tỉ
            // lệ địa hình qua worldAtTaluy), khác với các lớp kết cấu áo đường (nằm dưới Template, tỉ
            // lệ thật qua worldAtDelta).
            pavementLayers.filter(l => l.appliesTo === 'full' && l.unit === 'area').forEach(layer => {
                const color = layer.color !== undefined ? layer.color : 0x888888;
                const layerTopRows = sectionDataList.map((data, idx) => {
                    const leftOff = data.fullTemplate[0].offset, rightOff = data.fullTemplate[data.fullTemplate.length - 1].offset;
                    return data.egSamples.filter(p => p.offset >= leftOff - 1e-6 && p.offset <= rightOff + 1e-6)
                        .map(p => ({ pos: worldAtTaluy(stations[idx], p.offset, p.elev) }));
                });
                const layerBotRows = sectionDataList.map((data, idx) => {
                    const leftOff = data.fullTemplate[0].offset, rightOff = data.fullTemplate[data.fullTemplate.length - 1].offset;
                    return data.egSamples.filter(p => p.offset >= leftOff - 1e-6 && p.offset <= rightOff + 1e-6)
                        .map(p => ({ pos: worldAtTaluy(stations[idx], p.offset, p.elev - layer.thickness) }));
                });
                if (layerTopRows.some(r => r.length < 2)) return; // hụt điểm ở cọc nào đó (EG bất thường) -> bỏ qua lớp này để tránh méo hình
                const nColsFirst = layerTopRows[0].length;
                if (layerTopRows.some(r => r.length !== nColsFirst)) return; // số cột lệch nhau giữa các cọc (do chân taluy dịch chuyển theo địa hình) -> bỏ qua để tránh méo hình, thay vì vẽ sai

                const botGeo = buildStripGeometry(layerBotRows, () => color, skipConnection);
                const botMesh = new THREE.Mesh(botGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
                botMesh.userData.isCorridorMesh = true;
                group.add(botMesh);

                [0, layerTopRows[0].length - 1].forEach(j => {
                    const edgeRows = [];
                    for (let i = 0; i < layerTopRows.length; i++) {
                        if (j >= layerTopRows[i].length) return; // số điểm khác nhau giữa các cọc -> bỏ qua mép này
                        edgeRows.push([{ pos: layerTopRows[i][j].pos }, { pos: layerBotRows[i][j].pos }]);
                    }
                    if (edgeRows.length < 2) return;
                    const edgeGeo = buildStripGeometry(edgeRows, () => color, skipConnection);
                    const edgeMesh = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
                    edgeMesh.userData.isCorridorMesh = true;
                    group.add(edgeMesh);
                });
            });

            // Nhãn lý trình dọc tim tuyến (thưa hơn interval gốc để đỡ dày đặc)
            const labelH = Math.max(info.totalLength * 0.004, 0.2);
            const labelEvery = Math.max(1, Math.round(stations.length / 12));
            stations.forEach((st, i) => {
                if (i % labelEvery !== 0) return;
                const elev = interpolateAlongProfilePath(baseline, st.station) || 0;
                const labelPos = new THREE.Vector3(st.pos.x, st.pos.y, elevationToDisplayZ(elev)).add(new THREE.Vector3(0, 0, labelH * 3));
                group.add(createTextSprite('KM: ' + formatStation(st.station), labelPos, labelH));
            });

            // Điểm góc bao quanh dùng cho OSNAP/box-select (không duyệt vào mesh dày đặc bên trong)
            const allPts = topRows.flat().map(s => s.pos);
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            allPts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
            group.userData.boundaryPts = [
                new THREE.Vector3(minX, minY, 0), new THREE.Vector3(maxX, minY, 0),
                new THREE.Vector3(maxX, maxY, 0), new THREE.Vector3(minX, maxY, 0)
            ];
            group.userData.corridorInfo = { alignmentName: info.name, totalLength: info.totalLength, stationCount: stations.length, baselineSource: source, interval, taluyRatio: ratio, excludeStationRanges: ranges };
            return { group };
        }

        // Corridor là snapshot tĩnh (không tự liên kết động như Civil3D thật) — hàm này build lại từ
        // dữ liệu MỚI NHẤT (Alignment cùng tên, Assembly hiện tại, Profile FG/Surface hiện tại) rồi
        // thay thế trực tiếp nội dung bên trong entity đang có, giữ nguyên ID/Layer.
        function rebuildCorridor(entity) {
            const info = entity.object.userData.corridorInfo;
            if (!info) return;
            let alignmentEntity = null;
            entities.forEach(e => { if (e.type === 'ALIGNMENT' && e.object.userData.alignmentInfo.name === info.alignmentName) alignmentEntity = e; });
            if (!alignmentEntity) {
                setCommandText(`Command: Không tìm thấy Alignment "${info.alignmentName}" (có thể đã bị xoá).`);
                return;
            }
            const result = createCorridorEntity(alignmentEntity, currentAssembly, info.interval || 10, info.taluyRatio || defaultTaluyRatio, info.excludeStationRanges || []);
            if (result.error) { setCommandText('Command: ' + result.error); return; }

            while (entity.object.children.length) entity.object.remove(entity.object.children[0]);
            result.group.children.slice().forEach(child => entity.object.add(child));
            entity.object.userData.boundaryPts = result.group.userData.boundaryPts;
            entity.object.userData.corridorInfo = result.group.userData.corridorInfo;

            rebuildSnapCandidates();
            updatePropertiesPanel();
            setCommandText(`Command: Đã rebuild Corridor — cao độ lấy từ ${entity.object.userData.corridorInfo.baselineSource}.`);
        }

        let pendingCorridorAlignment = null;

        function pickAlignmentForCorridor(hit) {
            if (currentAssembly.length === 0) {
                setCommandText('Command: Assembly chưa có thành phần nào — mở "Assembly" để thêm trước khi tạo Corridor.');
                setTool('select');
                return;
            }
            pendingCorridorAlignment = hit;
            setTool('corridor-interval');
            openCorridorIntervalPopup();
        }

        function openCorridorIntervalPopup() {
            document.getElementById('corridor-interval-popup').style.display = 'flex';
            const field = document.getElementById('corridor-interval-field');
            field.value = '10';
            document.getElementById('corridor-taluy-field').value = defaultTaluyRatio;
            field.focus();
            field.select();
        }
        function closeCorridorIntervalPopup() {
            document.getElementById('corridor-interval-popup').style.display = 'none';
        }

        function confirmCorridorInterval() {
            const interval = parseFloat(document.getElementById('corridor-interval-field').value);
            const taluyRatio = parseFloat(document.getElementById('corridor-taluy-field').value);
            if (isNaN(interval) || interval <= 0 || isNaN(taluyRatio) || taluyRatio < 0) {
                setCommandText('Command: Thông số không hợp lệ.');
                return;
            }
            defaultTaluyRatio = taluyRatio; // nhớ lại cho lần sau
            closeCorridorIntervalPopup();
            const result = createCorridorEntity(pendingCorridorAlignment, currentAssembly, interval, taluyRatio);
            if (result.error) {
                setCommandText('Command: ' + result.error);
            } else {
                execute(makeAddCommand('CORRIDOR', result.group));
                const ci = result.group.userData.corridorInfo;
                setCommandText(`Command: Đã tạo Corridor "${ci.alignmentName}" — ${ci.stationCount} mặt cắt, cao độ lấy từ ${ci.baselineSource}.`);
            }
            pendingCorridorAlignment = null;
            setTool('select');
        }
        document.getElementById('corridor-interval-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { confirmCorridorInterval(); }
            else if (event.key === 'Escape') { closeCorridorIntervalPopup(); pendingCorridorAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Corridor.'); }
        });
        document.getElementById('corridor-taluy-field').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { confirmCorridorInterval(); }
            else if (event.key === 'Escape') { closeCorridorIntervalPopup(); pendingCorridorAlignment = null; setTool('select'); setCommandText('Command: Đã huỷ Corridor.'); }
        });

