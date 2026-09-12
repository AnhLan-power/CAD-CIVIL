        /* =========================================================================================
         * ALIGNMENT (kiểu Civil3D): tuyến gồm các đoạn thẳng nối các điểm PI (Point of Intersection),
         * tại mỗi PI trong (không phải điểm đầu/cuối) tự chèn 1 đường cong tròn tiếp tuyến với 2 đoạn
         * thẳng liền kề (PC = Point of Curve, PT = Point of Tangent) — đúng khái niệm PI/PC/PT thật
         * của Civil3D. Sau đó gắn cọc lý trình (station) cách đều dọc theo toàn tuyến.
         * =========================================================================================
         */

        // Tính đường cong tròn tiếp tuyến tại 1 PI trong (không phải điểm đầu/cuối tuyến)
        function computeAlignmentCurve(prevPt, pi, nextPt, radius) {
            const dir1 = new THREE.Vector3().subVectors(pi, prevPt).normalize();
            const dir2 = new THREE.Vector3().subVectors(nextPt, pi).normalize();
            const cross = dir1.x * dir2.y - dir1.y * dir2.x;
            const dot = Math.max(-1, Math.min(1, dir1.dot(dir2)));
            const delta = Math.atan2(cross, dot); // góc lệch có dấu giữa 2 tiếp tuyến

            if (Math.abs(delta) < 1e-4 || Math.abs(delta) > Math.PI - 0.05) return null; // gần thẳng hàng hoặc quay đầu -> bỏ qua

            const backLen = pi.distanceTo(prevPt);
            const fwdLen = pi.distanceTo(nextPt);
            const maxT = Math.min(backLen, fwdLen) * 0.45; // chừa chỗ cho curve ở PI kế bên, tránh chồng lấn

            let T = radius * Math.tan(Math.abs(delta) / 2);
            let usedRadius = radius;
            if (T > maxT) { T = maxT; usedRadius = T / Math.tan(Math.abs(delta) / 2); } // đoạn quá ngắn -> tự thu nhỏ bán kính

            const PC = pi.clone().sub(dir1.clone().multiplyScalar(T));
            const PT = pi.clone().add(dir2.clone().multiplyScalar(T));

            const sign = Math.sign(delta);
            const perp1 = new THREE.Vector3(-dir1.y, dir1.x, 0);
            const center = PC.clone().add(perp1.clone().multiplyScalar(usedRadius * sign));

            const aStart = Math.atan2(PC.y - center.y, PC.x - center.x);
            let aEnd = Math.atan2(PT.y - center.y, PT.x - center.x);
            let sweep = aEnd - aStart;
            while (sign > 0 && sweep < 0) sweep += Math.PI * 2;
            while (sign < 0 && sweep > 0) sweep -= Math.PI * 2;

            const segCount = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
            const arcPts = [];
            for (let i = 0; i <= segCount; i++) {
                const a = aStart + sweep * (i / segCount);
                arcPts.push(new THREE.Vector3(center.x + Math.cos(a) * usedRadius, center.y + Math.sin(a) * usedRadius, 0));
            }

            return { PC, PT, center, radius: usedRadius, arcPts, arcLength: Math.abs(sweep) * usedRadius, delta };
        }

        // Ghép toàn bộ PI + curve thành 1 chuỗi điểm liên tục dọc tuyến (tangent - arc - tangent - ...)
        function buildAlignmentPath(piPoints, radius) {
            const path = [piPoints[0]];
            const curveInfos = []; // lưu lại để vẽ PC/PT/tâm cung nếu cần
            for (let i = 1; i < piPoints.length - 1; i++) {
                const curve = computeAlignmentCurve(piPoints[i - 1], piPoints[i], piPoints[i + 1], radius);
                if (curve) {
                    path.push(curve.PC, ...curve.arcPts, curve.PT);
                    curveInfos.push({ pi: piPoints[i], ...curve });
                } else {
                    path.push(piPoints[i]);
                }
            }
            path.push(piPoints[piPoints.length - 1]);
            return { path, curveInfos };
        }

        // Tính vị trí các cọc lý trình (station) cách đều `interval` dọc theo path đã ghép
        function computeStations(pathPoints, interval, startStation) {
            const cum = [0];
            for (let i = 1; i < pathPoints.length; i++) cum.push(cum[i - 1] + pathPoints[i - 1].distanceTo(pathPoints[i]));
            const totalLength = cum[cum.length - 1];
            const stations = [];
            for (let s = 0; s <= totalLength + 1e-6; s += interval) {
                let idx = 0;
                while (idx < cum.length - 2 && cum[idx + 1] < s) idx++;
                const segStart = cum[idx], segEnd = cum[idx + 1];
                const t = segEnd > segStart ? (s - segStart) / (segEnd - segStart) : 0;
                const p1 = pathPoints[idx], p2 = pathPoints[idx + 1];
                const pos = p1.clone().lerp(p2, t);
                const dir = p2.clone().sub(p1).normalize();
                stations.push({ station: s + startStation, pos, dir });
            }
            return { stations, totalLength };
        }

        // Định dạng lý trình kiểu Civil3D: XX+YY.YY (nhóm 100 đơn vị)
        function formatStation(s) {
            const whole = Math.floor(s / 100);
            const rem = s - whole * 100;
            return whole + '+' + rem.toFixed(2).padStart(5, '0');
        }

        function createAlignmentEntity(piPoints, radius, interval, name) {
            const { path, curveInfos } = buildAlignmentPath(piPoints, radius);
            const { stations, totalLength } = computeStations(path, interval, 0);

            const group = new THREE.Group();
            group.userData.isAlignment = true;
            group.userData.boundaryPts = piPoints.map(p => p.clone()); // dùng cho OSNAP/box-select (điểm PI)

            const lineMat = new THREE.LineBasicMaterial({ color: currentDrawColor });
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), lineMat));

            // Đánh dấu PI bằng ô vuông nhỏ
            const piSize = Math.max(totalLength * 0.004, 0.15);
            piPoints.forEach(pi => {
                const sq = [
                    pi.clone().add(new THREE.Vector3(-piSize, -piSize, 0)),
                    pi.clone().add(new THREE.Vector3(piSize, -piSize, 0)),
                    pi.clone().add(new THREE.Vector3(piSize, piSize, 0)),
                    pi.clone().add(new THREE.Vector3(-piSize, piSize, 0))
                ];
                group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sq), new THREE.LineBasicMaterial({ color: 0xffaa00 })));
            });

            // Cọc lý trình: tick vuông góc + label
            const tickSize = Math.max(totalLength * 0.006, 0.2);
            stations.forEach(st => {
                const perp = new THREE.Vector3(-st.dir.y, st.dir.x, 0);
                const a = st.pos.clone().addScaledVector(perp, -tickSize);
                const b = st.pos.clone().addScaledVector(perp, tickSize);
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: currentDrawColor })));
                const labelPos = st.pos.clone().addScaledVector(perp, tickSize * 1.6);
                group.add(createTextSprite(formatStation(st.station), labelPos, tickSize * 1.8));
            });

            // Label tên Alignment ở điểm đầu
            group.add(createTextSprite(name, piPoints[0].clone().addScaledVector(new THREE.Vector3(0, 1, 0), tickSize * 3), tickSize * 2.2));

            group.userData.alignmentInfo = { name, totalLength, radius, interval, piCount: piPoints.length, curveCount: curveInfos.length };
            return group;
        }

