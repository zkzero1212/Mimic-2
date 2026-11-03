// --- Cloud Sync Bridge ---
        window.getGameState = () => {
            return {
                currentFloor, maxFloor, permCurses, eventState, statementLinks, selectedLinkColor,
                bossRewardRulesVersion: 3,
                segmentChestBonus, segmentMimicBonus, bossRewardsClaimedFloors,
                chestsData, currentGridLayout, totalOpened, totalTrueChests, isGameOver, isFloorCleared,
                currentTempCurses, tempBuffs, currentEventLogs, isRandomMode, isLuckEvent,
                restVisitedForCurrentFloor
            };
        };

        window.loadGameState = (data) => {
            // 구버전 [발언, 상자] 연결 기록은 금색 선으로 복원합니다.
            const savedLinks = Array.isArray(data.statementLinks)
                ? data.statementLinks : Object.values(data.statementLinks || {});
            statementLinks = savedLinks.map(link => {
                if (!link || typeof link !== "object") return null;
                const from = Number(link[0]);
                const to = Number(link[1]);
                if (!Number.isInteger(from) || from < 0 || !Number.isInteger(to) || to < 0) return null;
                const color = Object.hasOwn(LINK_COLORS, link[2]) ? link[2] : "gold";
                return [from, to, color];
            }).filter(Boolean);
            selectedLinkColor = Object.hasOwn(LINK_COLORS, data.selectedLinkColor) ? data.selectedLinkColor : "gold";
            linkRecolorPending = false;
            refreshLinkColorPicker();
            selectedStatementIdx = null;
            selectedLineLink = null;
            markToolbarActiveIdx = null;
            closeStatementContextPalette();
            currentFloor = Math.max(1, Number(data.currentFloor) || 1);
            maxFloor = Math.max(1, Number(data.maxFloor) || 1);
            permCurses = data.permCurses || { random: false, sleepLevel: 0, addChests: 0, addMimics: 0 };
            eventState = data.eventState || { initialChance: 25, chance: 25, triggerCount: 0, missCount: 0 };
            eventState.triggerCount = Math.max(0, Number(eventState.triggerCount) || 0);
            eventState.missCount = Math.max(0, Number(eventState.missCount) || 0);
            eventState.initialChance = 25;
            eventState.chance = getEventChance(currentFloor);

            // 구버전 저장 데이터의 보스 보너스도 새 규칙에서는 제거합니다.
            segmentChestBonus = 0;
            segmentMimicBonus = 0;
            bossRewardsClaimedFloors = [];
            localStorage.setItem('mimic2MaxFloor', maxFloor);
            
            const savedChests = data.chestsData || [];
            chestsData = Array.isArray(savedChests)
                ? savedChests
                : Object.keys(savedChests).sort((a, b) => Number(a) - Number(b)).map(key => savedChests[key]);
            // Firebase RTDB can deserialize indexed arrays as objects and omit empty memo arrays.
            chestsData.forEach(c => {
                if (!Array.isArray(c.memo)) c.memo = [];
            });
            currentGridLayout = data.currentGridLayout || chestsData[0]?.gridLayout || null;
            if (!currentGridLayout && chestsData.length) {
                currentGridLayout = getGridLayout(chestsData.length);
                chestsData.forEach(c => { c.gridLayout = currentGridLayout; });
            }
            totalOpened = data.totalOpened || 0;
            totalTrueChests = data.totalTrueChests || 0;
            isGameOver = data.isGameOver || false;
            isFloorCleared = data.isFloorCleared || false;
            currentTempCurses = data.currentTempCurses || {};
            tempBuffs = data.tempBuffs || { preventRandom: false, reduceSleep: 0 };
            currentEventLogs = data.currentEventLogs || [];
            isRandomMode = data.isRandomMode || false;
            isLuckEvent = data.isLuckEvent || false;
            restVisitedForCurrentFloor = data.restVisitedForCurrentFloor || false;
            
            if (chestsData && chestsData.length > 0) {
                let calcChests = chestsData.length;
                let calcMimics = chestsData.filter(c => c.role === 'M').length;
                let sleepCount = chestsData.filter(c => c.isSleeping).length;
                let isBoss = isBossFloor(currentFloor);
                
                let currentTreasuresSummary = {};
                chestsData.forEach((c) => {
                    if (c.role === 'T' && !c.isTrickster && c.treasure !== '흉내쟁이') {
                        currentTreasuresSummary[c.treasure] = (currentTreasuresSummary[c.treasure] || 0) + 1;
                    }
                });
                
                updateUI(calcChests, isRandomMode, calcMimics, sleepCount, isBoss, currentTreasuresSummary);
                renderChests();
                
                if (isGameOver) {
                    showFloorResult(isFloorCleared);
                    if (isFloorCleared) {
                        document.getElementById('btn-next-floor').classList.remove('hidden');
                        document.getElementById('btn-restart').classList.add('hidden');
                    } else {
                        document.getElementById('btn-restart').classList.remove('hidden');
                        document.getElementById('btn-next-floor').classList.add('hidden');
                    }
                }
            } else {
                initFloor();
            }
        };

        window.startClimb = startClimb; // Expose startClimb to global for selectSlot
        
        // --- Game State ---
        let currentFloor = 1;
        let maxFloor = localStorage.getItem('mimic2MaxFloor') || 1;

        let baseChests = 4;
        let baseMimics = 2;
        function isBossFloor(floor) {
            return floor >= 4 && (floor - 4) % 5 === 0;
        }
        function isRestFloor(floor) {
            return floor > 0 && floor % 5 === 0;
        }
        function getNextBossFloor(floor) {
            if (floor < 4) return 4;
            return 4 + (Math.floor((floor - 4) / 5) + 1) * 5;
        }
        // 기본 상자 수: 1~3층은 4, 5, 6개이며 4층 이후는 6개부터 시작합니다.
        let segmentChestBonus = 0;
        let segmentMimicBonus = 0;
        let bossRewardsClaimedFloors = [];

        let permCurses = {
            random: false,
            sleepLevel: 0,
            addChests: 0,
            addMimics: 0
        };

        let tempBuffs = {
            preventRandom: false,
            reduceSleep: 0
        };

        let eventState = {
            initialChance: 25,
            chance: 25,
            triggerCount: 0,
            missCount: 0
        };

        // 기본 25% + 구간별 10%p, 발생 누적 +5%p, 미발생 누적은 구간당 +10%p.
        function getEventChance(floor = currentFloor) {
            const segmentNumber = Math.max(2, Math.floor((floor - 1) / 5) + 1);
            const baseChance = 25 + (segmentNumber - 2) * 10;
            const triggerBonus = eventState.triggerCount * 5;
            const missBonus = eventState.missCount * 10 * (segmentNumber - 1);
            return Math.min(100, baseChance + triggerBonus + missBonus);
        }

        let currentTempCurses = {};
        let currentEventLogs = [];
        let isLuckEvent = false;

        let isFloorCleared = false;
        let restVisitedForCurrentFloor = false;
        let isRandomMode = false;
        let isGameOver = false;

        let chestsData = []; 
        let currentGridLayout = null;
        let totalOpened = 0;
        let totalTrueChests = 0;
        let hoveredChestIdx = null;
        let markToolbarActiveIdx = null;
        const LINK_COLORS = Object.freeze({
            gold: "#ffe18a",
            mint: "#5eead4",
            violet: "#c4b5fd",
            coral: "#fb7185"
        });
        let statementLinks = [];
        let selectedStatementIdx = null;
        let selectedLineLink = null; // [발언, 대상 상자] — 시각적 선택만 유지
        let recentRevealIdx = null; // Animation only; not part of save state.
        let selectedLinkColor = "gold";
        // 색상 선택 직후의 다음 선 클릭 한 번만 색상 변경으로 처리합니다.
        // 기본적으로 선을 클릭하면 해당 연결 하나를 삭제합니다.
        let linkRecolorPending = false;
        function refreshLinkColorPicker() {
            document.querySelectorAll("#link-color-picker [data-link-color]").forEach(button => {
                const active = button.dataset.linkColor === selectedLinkColor;
                button.classList.toggle("is-active", active);
                button.classList.toggle("is-recolor-pending", active && linkRecolorPending);
                button.setAttribute("aria-pressed", String(active));
            });
            const hint = document.getElementById("link-color-mode-hint");
            if (hint) {
                if (linkRecolorPending) {
                    hint.textContent = "색상 변경 대기 · 선 클릭으로 적용 (Esc 취소)";
                } else if (selectedLineLink && currentGridLayout
                    && statementLinks.some(([from, to]) =>
                        from === selectedLineLink[0] && to === selectedLineLink[1])) {
                    const from = getCoord(selectedLineLink[0], currentGridLayout).name;
                    const to = getCoord(selectedLineLink[1], currentGridLayout).name;
                    hint.textContent = `선 선택: ${from} → ${to} · 우클릭: 색상/지우개 · Delete: 선 삭제`;
                } else if (selectedStatementIdx !== null && currentGridLayout) {
                    const source = getCoord(selectedStatementIdx, currentGridLayout).name;
                    hint.textContent = `발언 선택: ${source} · 연결할 발언/상자 클릭 · Esc 해제`;
                } else {
                    hint.textContent = "선 클릭: 선택 · 선 우클릭: 색상/지우개 · 발언 클릭: 연결 시작";
                }
            }
        }
        document.querySelectorAll("#link-color-picker [data-link-color]").forEach(button => {
            button.addEventListener("click", () => {
                const color = button.dataset.linkColor;
                if (!Object.hasOwn(LINK_COLORS, color)) return;
                // 같은 색상 버튼을 한 번 더 누르면 색상 변경 모드를 취소합니다.
                const cancelRecolor = linkRecolorPending && selectedLinkColor === color;
                selectedLinkColor = color;
                linkRecolorPending = !cancelRecolor;
                refreshLinkColorPicker();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
            });
        });

        const colors = ['red', 'blue', 'green', 'yellow', 'purple'];
        const colorHex = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', purple: '#a855f7' };
        
        let treasureColorMap = {};
        const treasurePalette = [
            { text: 'text-rose-600', bg: 'bg-rose-100' }, { text: 'text-indigo-600', bg: 'bg-indigo-100' },
            { text: 'text-teal-600', bg: 'bg-teal-100' }, { text: 'text-amber-600', bg: 'bg-amber-100' },
            { text: 'text-fuchsia-600', bg: 'bg-fuchsia-100' }, { text: 'text-cyan-600', bg: 'bg-cyan-100' }
        ];
        const rawTreasures = ['골드', '아이템', '장비', '유물', '보석'];

        const EVENT_TYPES = [
            { id: 'TEMP_CHESTS', type: 'temp', text: '이번 층 상자 +1' },
            { id: 'TEMP_MIMICS', type: 'temp', text: '이번 층 미믹 +1' },
            { id: 'TEMP_SLEEP', type: 'temp', text: '이번 층 수면 상자 +1' },
            { id: 'TEMP_RANDOM', type: 'temp', text: '이번 층 미믹 수 랜덤화' },
            { id: 'TRICKSTER', type: 'temp', text: '⚠️ 흉내쟁이 출현! 이번 층에 정체를 숨긴 흉내쟁이가 있습니다.' },
            { id: 'PERM_CHESTS', type: 'perm', text: '영구 상자 +1' },
            { id: 'PERM_MIMICS', type: 'perm', text: '영구 미믹 +1' },
            { id: 'PERM_SLEEP', type: 'perm', text: '영구 수면 저주 +1' },
            { id: 'PERM_RANDOM', type: 'perm', text: '영구 미믹 랜덤화 활성' }
        ];

        // DOM
        const container = document.getElementById('chests-container');
        const statusMsg = document.getElementById('status-message');
        const genWarning = document.getElementById('gen-warning');
        
        const btnNextFloor = document.getElementById('btn-next-floor');
        const btnRestart = document.getElementById('btn-restart');
        const btnOpenO = document.getElementById('btn-open-o');
        const btnClearMarks = document.getElementById('btn-clear-marks');

        // --- v0.06 Mark and Memo Toolbar ---
        function updateMarkToolbar() {
            const panel = document.getElementById("mark-tools");
            if (!panel) return;
            const target = markToolbarActiveIdx === null ? null : chestsData[markToolbarActiveIdx];
            const usable = !!target && !target.isOpen && !isGameOver;
            const label = document.getElementById("mark-target-label");
            if (label) label.textContent = usable
                ? `선택: ${getCoord(markToolbarActiveIdx, currentGridLayout).name}`
                : "상자 아래 표시를 선택하세요";
            panel.querySelectorAll("[data-mark-value]").forEach(button => {
                button.disabled = !usable;
                button.setAttribute("aria-pressed", String(usable && target.mark === button.dataset.markValue));
            });
            panel.querySelectorAll("[data-memo-value]").forEach(button => {
                button.disabled = !usable;
                button.setAttribute("aria-pressed", String(usable && Array.isArray(target.memo)
                    && target.memo.includes(Number(button.dataset.memoValue))));
            });
        }
        document.querySelectorAll("#mark-tools [data-mark-value]").forEach(button => {
            button.addEventListener("click", () => {
                if (markToolbarActiveIdx === null) return;
                toggleMark(markToolbarActiveIdx, button.dataset.markValue);
            });
        });
        document.querySelectorAll("#mark-tools [data-memo-value]").forEach(button => {
            button.addEventListener("click", () => {
                if (markToolbarActiveIdx === null) return;
                toggleMemo(markToolbarActiveIdx, Number(button.dataset.memoValue));
            });
        });

        // --- Utils ---
        function shuffleArray(array) {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        }

        // --- Core Climbing System ---
        function startClimb() {
            currentFloor = 1;
            statementLinks = [];
            selectedStatementIdx = null;
            selectedLineLink = null;
            recentRevealIdx = null;
            currentGridLayout = null;
            baseChests = 4;
            baseMimics = 2;
            segmentChestBonus = 0;
            segmentMimicBonus = 0;
            bossRewardsClaimedFloors = [];
            permCurses = { random: false, sleepLevel: 0, addChests: 0, addMimics: 0 };
            eventState = { initialChance: 15, chance: 15, triggerCount: 0, missCount: 0 };
            restVisitedForCurrentFloor = false;
            initFloor();
        }

        function drawEvent() {
            const poolType = Math.random() < 0.9 ? 'temp' : 'perm';
            const pool = EVENT_TYPES.filter(event =>
                event.type === poolType &&
                (event.id !== 'TRICKSTER' || (currentFloor >= 6 && currentFloor <= 10))
            );
            if (!pool.length) return null;
            return pool[Math.floor(Math.random() * pool.length)];
        }

        function applyEvent(ev) {
            if (!ev) return;
            currentEventLogs.push(`⚠️ [이벤트] ${ev.text}`);

            switch (ev.id) {
                case 'TEMP_CHESTS':
                    currentTempCurses.addChests = (currentTempCurses.addChests || 0) + 1;
                    break;
                case 'TEMP_MIMICS':
                    currentTempCurses.addMimics = (currentTempCurses.addMimics || 0) + 1;
                    break;
                case 'TEMP_SLEEP':
                    currentTempCurses.addSleep = (currentTempCurses.addSleep || 0) + 1;
                    break;
                case 'TEMP_RANDOM':
                    currentTempCurses.random = true;
                    break;
                case 'TRICKSTER':
                    currentTempCurses.trickster = true;
                    break;
                case 'PERM_CHESTS':
                    permCurses.addChests += 1;
                    break;
                case 'PERM_MIMICS':
                    permCurses.addMimics += 1;
                    break;
                case 'PERM_SLEEP':
                    permCurses.sleepLevel += 1;
                    break;
                case 'PERM_RANDOM':
                    permCurses.random = true;
                    break;
            }
        }

        function showRestArea() {
            let overlay = document.getElementById('rest-area-overlay');
            let optionsContainer = document.getElementById('rest-options');
            optionsContainer.innerHTML = '';
            
            let possibleOptions = [];
            possibleOptions.push({ text: "수면 저주 일시 완화 (이번 층 수면 2개 감소)", action: () => { tempBuffs.reduceSleep = 2; }});
            possibleOptions.push({ text: "혼돈 차단 (이번 층 미믹 랜덤화 방지)", action: () => { tempBuffs.preventRandom = true; }});
            possibleOptions.push({ text: "이벤트 억제 (일반 이벤트 확률 초기화)", action: () => { eventState.missCount = 0; eventState.chance = getEventChance(); }});
            
            if (permCurses.random) possibleOptions.push({ text: "✨ 영구 랜덤 저주 완전 정화", action: () => { permCurses.random = false; }});
            if (permCurses.addMimics > 0) possibleOptions.push({ text: "✨ 영구 미믹 증식 저주 1단계 정화", action: () => { permCurses.addMimics = 0; }});
            if (permCurses.addChests > 0) possibleOptions.push({ text: "✨ 영구 상자 증식 저주 1단계 정화", action: () => { permCurses.addChests = 0; }});
            if (permCurses.sleepLevel > 0) possibleOptions.push({ text: "✨ 영구 수면 저주 1단계 정화", action: () => { permCurses.sleepLevel = 0; }});
            
            let choices = shuffleArray(possibleOptions).slice(0, 3);
            choices.forEach(c => {
                let btn = document.createElement('button');
                btn.className = "w-full bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-900 border border-indigo-200 font-extrabold py-3.5 px-4 rounded-xl shadow-sm transition-all text-sm text-left break-keep";
                btn.innerText = c.text;
                btn.onclick = () => {
                    c.action();
                    overlay.classList.add('hidden');
                    restVisitedForCurrentFloor = false;
                    currentFloor++;
                    if (currentFloor > maxFloor) {
                        maxFloor = currentFloor;
                        localStorage.setItem('mimic2MaxFloor', maxFloor);
                    }
                    initFloor();
                };
                optionsContainer.appendChild(btn);
            });
            overlay.classList.remove('hidden');
        }

        // v0.07h: visual progress derives from existing chest counters; no new cloud fields.
        function updateClimbProgress() {
            const total = Math.max(0, Number(totalTrueChests) || 0);
            const opened = Math.max(0, Math.min(total, Number(totalOpened) || 0));
            const pct = total ? Math.round(opened / total * 100) : 0;
            const value = document.getElementById("ui-progress-value");
            const bar = document.getElementById("ui-progress-bar");
            const track = document.getElementById("ui-progress-track");
            const state = document.getElementById("ui-floor-state");
            if (value) value.textContent = `${opened} / ${total}`;
            if (bar) bar.style.width = pct + "%";
            if (track) track.setAttribute("aria-valuenow", String(pct));
            if (state) {
                const phase = isFloorCleared ? "cleared" : isGameOver ? "failed" : "playing";
                state.dataset.state = phase;
                state.textContent = phase === "cleared" ? "층 클리어" : phase === "failed" ? "탐험 실패" : "탐색 중";
            }
        }

        function updateUI(calcChests, isRandom, calcMimics, sleepCount, isBoss, treasuresSummary = {}) {
            document.getElementById('ui-floor').innerText = `${currentFloor}F`;
            document.getElementById('ui-max-floor').innerText = `${maxFloor}`;
            
            let nextRest = isRestFloor(currentFloor) ? 0 : 5 - (currentFloor % 5);
            document.getElementById('ui-next-rest').innerText = nextRest === 0 ? "현재 층" : `${nextRest}층 남음`;
            
            const nextBossFloor = isBossFloor(currentFloor) ? currentFloor : getNextBossFloor(currentFloor);
            const nextBoss = nextBossFloor - currentFloor;
            document.getElementById('ui-next-boss').innerText = nextBoss === 0 ? "현재 층" : `${nextBoss}층 남음`;
            
            document.getElementById('info-total-chests').innerText = `${calcChests}개`;
            document.getElementById('info-mimics').innerText = isRandom ? '? 마리' : `${calcMimics}마리`;
            document.getElementById('ui-segment-chest-bonus').innerText = segmentChestBonus;
            document.getElementById('ui-segment-mimic-bonus').innerText = segmentMimicBonus;
            document.getElementById('info-sleep').innerText = `${sleepCount}개`;
            
            document.getElementById('ui-event-chance').innerText = currentFloor >= 6 ? `${Math.floor(getEventChance(currentFloor))}%` : `(6F부터)`;
            
            let permList = [];
            if (permCurses.addChests > 0) permList.push(`상자 증식 +${permCurses.addChests}`);
            if (permCurses.addMimics > 0) permList.push(`미믹 증식 +${permCurses.addMimics}`);
            if (permCurses.random) permList.push(`미믹 랜덤화`);
            if (permCurses.sleepLevel > 0) permList.push(`수면 저주 Lv.${permCurses.sleepLevel}`);
            
            document.getElementById('ui-perm-curses').innerHTML = permList.length > 0 
                ? permList.map(c => `<span class="bg-red-100 text-red-800 px-2 py-1 rounded text-[10px] font-extrabold shadow-sm">${c}</span>`).join(' ')
                : '<span class="text-slate-400 text-xs font-bold px-1">활성화된 영구 저주가 없습니다.</span>';
                
            let infoTreasuresList = document.getElementById('info-treasures-list');
            if (infoTreasuresList) {
                infoTreasuresList.innerHTML = '';
                if (isRandom) {
                    const unknown = document.createElement('div');
                    unknown.className = "flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-full border border-slate-200 shadow-2xs";
                    unknown.innerHTML = '<span class="font-bold text-xs text-slate-500">구성품 종류</span><span class="font-extrabold text-slate-800 text-xs">?</span><span class="font-bold text-xs text-slate-500 ml-2">구성품 수</span><span class="font-extrabold text-slate-800 text-xs">?개</span>';
                    infoTreasuresList.appendChild(unknown);
                } else {
                    Object.entries(treasuresSummary).forEach(([trName, count]) => {
                        const tCol = treasureColorMap[trName] || treasurePalette[0];
                        let item = document.createElement('div');
                        item.className = "flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-full border border-slate-200 shadow-2xs";
                        item.innerHTML = `<span class="font-bold text-xs ${tCol.text}">• ${trName}</span><span class="font-extrabold text-slate-800 text-xs">${count}개</span>`;
                        infoTreasuresList.appendChild(item);
                    });
                }
            }

            let logContainer = document.getElementById('ui-event-logs');
            logContainer.innerHTML = '';
            currentEventLogs.forEach(log => {
                let div = document.createElement('div');
                div.className = log.includes('흉내쟁이')
                    ? 'text-sm font-black text-violet-950 bg-gradient-to-r from-amber-100 via-fuchsia-100 to-violet-100 px-3 py-2 rounded-lg border-2 border-fuchsia-400 shadow-md mt-1 ring-1 ring-fuchsia-200'
                    : 'text-xs font-extrabold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 shadow-sm mt-1';
                div.innerText = log;
                logContainer.appendChild(div);
            });
            
            const boardStage = document.getElementById('board-stage');
            if (boardStage) {
                boardStage.classList.toggle("v2-boss-floor", isBoss);
                const plaque = boardStage.querySelector(".v2-dungeon-marquee-label");
                if (plaque) plaque.textContent = isBoss ? "심연의 군주 · 결전" : "봉인된 보물의 방";
            }
            let mainPanel = document.getElementById('left-info-panel');
            if (mainPanel) mainPanel.classList.toggle("v2-boss-floor", isBoss);
            if (isBoss) {
                mainPanel.classList.add('border-red-400', 'bg-red-50');
                mainPanel.classList.remove('border-slate-200', 'bg-white');
            } else {
                mainPanel.classList.remove('border-red-400', 'bg-red-50');
                mainPanel.classList.add('border-slate-200', 'bg-white');
            }

            genWarning.classList.add('invisible');
            statusMsg.innerText = isBoss ? "보스 층입니다! 보스의 저주를 극복하고 추리하세요." : "단서를 종합해 추리를 시작하세요!";
            statusMsg.className = `text-center text-lg md:text-xl font-extrabold mb-4 h-7 drop-shadow-sm ${isBoss ? 'text-red-600' : 'text-indigo-700'}`;
            
            btnNextFloor.classList.add('hidden');
            btnRestart.classList.add('hidden');
        }

        function initFloor() {
            isGameOver = false;
            isFloorCleared = false;
            statementLinks = [];
            selectedStatementIdx = null;
            selectedLineLink = null;
            recentRevealIdx = null;
            markToolbarActiveIdx = null;
            closeStatementContextPalette();
            closeFloorResult();
            currentTempCurses = {};
            currentEventLogs = [];
            isLuckEvent = false;
            container.innerHTML = '';
            
            if (isRestFloor(currentFloor) && !restVisitedForCurrentFloor) {
                showRestArea();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
                return;
            }
            restVisitedForCurrentFloor = false; 
            
            let isBoss = isBossFloor(currentFloor);
            
            if (currentFloor >= 6 && !isBoss) {
                if (Math.random() < 0.01) {
                    isLuckEvent = true;
                    currentEventLogs.push("🍀 [희귀 행운] 상자가 4개, 미믹이 1개로 고정됩니다!");
                } else {
                    eventState.chance = getEventChance(currentFloor);
                    const isEvent = Math.random() * 100 < eventState.chance;

                    if (isEvent) {
                        applyEvent(drawEvent());
                        // 발생 횟수는 영구 누적하고, 미발생 누적만 초기화합니다.
                        eventState.triggerCount++;
                        eventState.missCount = 0;
                    } else {
                        // 미발생 보너스는 다음 층 확률에만 반영되며 이벤트 발생 시 초기화됩니다.
                        eventState.missCount++;
                    }
                    eventState.chance = getEventChance(currentFloor);
                }
            }
            
            const tricksterSegment = Math.floor((currentFloor - 1) / 5) + 1;
            let tricksterMode = 'none';
            if (tricksterSegment === 2 && currentTempCurses.trickster) {
                tricksterMode = 'required';
            } else if (tricksterSegment === 3) {
                tricksterMode = 'optional';
            } else if (tricksterSegment >= 4) {
                tricksterMode = 'required';
            }

            const baseChestCount = currentFloor <= 3 ? [4, 5, 6][currentFloor - 1] : 6;
            let calcChests = baseChestCount +
                permCurses.addChests + (currentTempCurses.addChests || 0);
            // 1~3층은 기본 미믹 1마리, 4층부터는 기본 미믹 2마리입니다.
            let calcMimics = (currentFloor <= 3 ? 1 : baseMimics) +
                permCurses.addMimics + (currentTempCurses.addMimics || 0);
            
            let isRandom = (permCurses.random || currentTempCurses.random || isBoss) && !tempBuffs.preventRandom;
            
            if (isBoss) {
                currentEventLogs.push("💀 [구간 보스] 수면 확정, 미믹 랜덤화, 연관성 감소!");
            }
            
            if (isLuckEvent) {
                calcChests = 4;
                calcMimics = 1;
                isRandom = false;
            }
            
            calcChests = Math.min(9, Math.max(3, calcChests));
            let maxMimics = Math.max(1, Math.min(4, Math.floor(calcChests / 2)));
            if (isRandom) { calcMimics = Math.floor(Math.random() * maxMimics) + 1; } 
            else { calcMimics = Math.min(maxMimics, calcMimics); }
            
            let sleepCount = permCurses.sleepLevel + (currentTempCurses.addSleep || 0) + (isBoss ? 1 : 0) - (tempBuffs.reduceSleep || 0);
            sleepCount = Math.max(0, Math.min(calcChests, sleepCount));
            if (tricksterMode !== 'none') sleepCount = Math.min(sleepCount, calcChests - 2);
            const sleepIndices = shuffleArray(Array.from({ length: calcChests }, (_, i) => i)).slice(0, sleepCount);
            tempBuffs = { preventRandom: false, reduceSleep: 0 }; 
            
            genWarning.classList.remove('invisible');
            statusMsg.innerText = "맵 생성 중...";
            statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-indigo-700 drop-shadow-sm";
            
            setTimeout(() => {
                let shuffledPalette = shuffleArray(treasurePalette);
                rawTreasures.forEach((tr, idx) => { treasureColorMap[tr] = shuffledPalette[idx % shuffledPalette.length]; });
                
                isRandomMode = isRandom;
                let actualTricksterMode = tricksterMode;
                if (tricksterSegment === 3) {
                    actualTricksterMode = Math.random() < 0.05 ? 'hidden-present' : 'hidden-absent';
                }
                let puzzle = generatePuzzle(calcChests, calcMimics, rawTreasures, isBoss, sleepIndices, actualTricksterMode);
                if (!puzzle) {
                    // Keep the current floor/progression if randomized clue generation exhausts its attempts.
                    genWarning.classList.add('invisible');
                    statusMsg.innerText = "퍼즐 생성에 실패했습니다. 현재 층을 다시 생성합니다.";
                    statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-red-600 drop-shadow-sm";
                    setTimeout(() => initFloor(), 250);
                    return;
                }
                
                if (puzzle.tricksterIdx < 0 &&
                    currentEventLogs.some(log => log.includes('이번 층에 흉내쟁이가 있습니다'))) {
                    currentEventLogs = currentEventLogs.filter(log => !log.includes('이번 층에 흉내쟁이가 있습니다'));
                    currentEventLogs.push('⚠️ [생성 대체] 흉내쟁이 조건을 제외한 일반 퍼즐로 생성되었습니다.');
                }
                currentGridLayout = puzzle.layout;
                chestsData = [];
                for (let i = 0; i < calcChests; i++) {
                    chestsData.push({
                        gridLayout: puzzle.layout,
                        role: puzzle.roles[i],
                        originalStatement: puzzle.statements[i].text,
                        statement: puzzle.statements[i].text,
                        color: puzzle.colors[i],
                        treasure: i === puzzle.tricksterIdx ? '흉내쟁이' : (puzzle.roles[i] === 'T' ? puzzle.treasures[i] : '미믹 (꽝)'),
                        isTrickster: i === puzzle.tricksterIdx,
                        isTricksterMimickingMimic: i === puzzle.tricksterIdx && puzzle.copyTargetIdx >= 0 && puzzle.roles[puzzle.copyTargetIdx] === 'M',
                        isOpen: false,
                        isSleeping: false,
                        mark: null,
                        memo: []
                    });
                }
                
                if (sleepCount > 0) {
                    sleepIndices.forEach(idx => {
                        chestsData[idx].isSleeping = true;
                        chestsData[idx].statement = 'zzZ';
                    });
                }
                
                totalOpened = 0;
                const tricksterMimickingMimic = puzzle.tricksterIdx >= 0 && puzzle.copyTargetIdx >= 0 && puzzle.roles[puzzle.copyTargetIdx] === 'M';
                totalTrueChests = calcChests - calcMimics - (tricksterMimickingMimic ? 1 : 0);
                
                let currentTreasuresSummary = {};
                puzzle.roles.forEach((role, idx) => {
                    if (role === 'T' && idx !== puzzle.tricksterIdx) {
                        let tr = puzzle.treasures[idx];
                        currentTreasuresSummary[tr] = (currentTreasuresSummary[tr] || 0) + 1;
                    }
                });
                
                updateUI(calcChests, isRandom, calcMimics, sleepCount, isBoss, currentTreasuresSummary);
                renderChests();
                if(window.autoSaveToCloud) window.autoSaveToCloud();
            }, 50);
        }

        // --- Generation Engine (Preserved logic with weight adjustments) ---
        function getGridLayout(n) {
            // 벌집형은 행 사이에 공백 셀이 있어도 실제 상자 사이의 이웃 관계를 유지합니다.
            const layouts = {
                3: { honeycomb: false, pos: [[0, 0], [0, 1], [0, 2]] },
                4: { honeycomb: false, pos: [[0, 0], [0, 1], [1, 0], [1, 1]] },
                5: { honeycomb: true, pos: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]] },
                6: Math.random() < 0.5
                    ? { honeycomb: false, pos: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] }
                    : { honeycomb: false, pos: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
                7: { honeycomb: true, pos: [[0, 1], [0, 3], [1, 0], [1, 2], [1, 4], [2, 1], [2, 3]] },
                8: Math.random() < 0.5
                    ? { honeycomb: false, pos: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]] }
                    : { honeycomb: true, pos: [[0, 0], [0, 2], [0, 4], [1, 1], [1, 3], [2, 0], [2, 2], [2, 4]] },
                9: { honeycomb: false, pos: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] }
            };
            let selected = layouts[Math.min(9, Math.max(1, n))];
            if (!selected) selected = layouts[9];
            const pos = selected.pos.map(([r, c]) => [r, c]);
            const rows = Math.max(...pos.map(([row]) => row)) + 1;
            const cols = Math.max(...pos.map(([, col]) => col)) + 1;
            const rowCounts = Array.from({ length: rows }, (_, row) => pos.filter(([r]) => r === row).length);
            return { cols, rows, rowCounts, pos, honeycomb: selected.honeycomb };
        }

        function generateRoles(n, m) {
            let arr = Array(n).fill('T');
            for(let i=0; i<m; i++) arr[i] = 'M';
            return shuffleArray(arr);
        }

        function getRandomColors(n) {
            let maxColors = Math.min(5, Math.max(2, Math.floor(n/2)));
            let shuffledColors = shuffleArray(colors);
            let usedColors = shuffledColors.slice(0, maxColors);
            let resultColors = [];
            for (let i = 0; i < n; i++) resultColors.push(usedColors[Math.floor(Math.random() * usedColors.length)]);
            return resultColors;
        }

        function getCoord(idx, layout) {
            const [row, col] = layout.pos[idx];
            return { colName: String.fromCharCode(65 + col), rowName: (row + 1).toString(), name: `${String.fromCharCode(65 + col)}${row + 1}` };
        }

        // 공백 셀은 건너뜁니다. 벌집형의 같은 행에서는 실제 상자 기준 좌우 이웃을 찾습니다.
        function getAdjacentNeighbors(layout, index) {
            const [row, col] = layout.pos[index];
            const result = [];
            if (layout.honeycomb) {
                const sameRow = layout.pos.map(([r, c], i) => ({ r, c, i }))
                    .filter(p => p.r === row && p.i !== index)
                    .sort((a, b) => a.c - b.c);
                const left = sameRow.filter(p => p.c < col).pop();
                const right = sameRow.find(p => p.c > col);
                if (left) result.push(left.i);
                if (right) result.push(right.i);
                // 벌집형에서 같은 열의 상하는 십자 방향에 해당합니다.
                layout.pos.forEach(([r, c], i) => {
                    if (i !== index && c === col && Math.abs(r - row) === 1) result.push(i);
                });
            } else {
                layout.pos.forEach(([r, c], i) => {
                    if (i !== index && ((r === row && Math.abs(c - col) === 1) ||
                        (c === col && Math.abs(r - row) === 1))) result.push(i);
                });
            }
            return [...new Set(result)];
        }

        function getDiagonalNeighbors(layout, index) {
            const [row, col] = layout.pos[index];
            return layout.pos.map(([r, c], i) => ({ r, c, i }))
                .filter(p => p.i !== index && Math.abs(p.r - row) === 1 &&
                    (layout.honeycomb ? Math.abs(p.c - col) === 1 : Math.abs(p.c - col) === 1))
                .map(p => p.i);
        }

        // 상하좌우는 공백 셀을 건너 가장 가까운 상자를 찾고, 대각선은 바로 인접한 셀만 찾습니다.
        function getDirectionalNeighbor(layout, index, dr, dc, skipEmpty = false) {
            const [row, col] = layout.pos[index];
            let nextRow = row + dr;
            let nextCol = col + dc;
            while (nextRow >= 0 && nextRow < layout.rows && nextCol >= 0 && nextCol < layout.cols) {
                const found = layout.pos.findIndex(([r, c]) => r === nextRow && c === nextCol);
                if (found >= 0) return found;
                if (!skipEmpty) return -1;
                nextRow += dr;
                nextCol += dc;
            }
            return -1;
        }

        // 주위는 좌우의 가장 가까운 상자와 네 대각선의 바로 인접한 상자로 구성합니다.
        // 수직 상하 방향은 제외하며, 모든 배치도에서 동일한 6방향 규칙을 적용합니다.
        function getHexNeighbors(layout, index) {
            const directions = [
                [0, -1, true], [0, 1, true],
                [-1, -1, false], [-1, 1, false],
                [1, -1, false], [1, 1, false]
            ];
            return [...new Set(directions
                .map(([dr, dc, skipEmpty]) => getDirectionalNeighbor(layout, index, dr, dc, skipEmpty))
                .filter(neighbor => neighbor >= 0 && neighbor !== index))];
        }

        function checkAdjacency(combo, layout) {
            for (let i = 0; i < combo.length; i++) {
                if (combo[i] !== 'M') continue;
                if (getAdjacentNeighbors(layout, i).some(j => combo[j] === 'M')) return true;
            }
            return false;
        }

        function getMirrorPairs(layout) {
            const rows = Array.from({ length: layout.rows }, () => []);
            layout.pos.forEach(([row], idx) => rows[row].push(idx));
            const pairs = [];
            for (const row of rows) {
                if (!row.length) return null;
                for (let i = 0; i < Math.floor(row.length / 2); i++) pairs.push([row[i], row[row.length - 1 - i]]);
            }
            return pairs.length ? pairs : null;
        }

        function isMirrorSymmetric(combo, layout) {
            const pairs = getMirrorPairs(layout);
            return Array.isArray(pairs) && pairs.length > 0 &&
                pairs.every(([a, b]) => (combo[a] === 'M') === (combo[b] === 'M'));
        }

        function escapeStatementText(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        function subjectParticle(word) {
            const chars = [...String(word).trim()]; if (!chars.length) return '가';
            const code = chars[chars.length - 1].charCodeAt(0);
            return code >= 0xAC00 && code <= 0xD7A3 && ((code - 0xAC00) % 28) !== 0 ? '이' : '가';
        }
        function buildTreasurePlan(numChests, rawTreasures) {
            let plan = shuffleArray([...rawTreasures]);
            while (plan.length < numChests) plan.push(rawTreasures[Math.floor(Math.random() * rawTreasures.length)]);
            return shuffleArray(plan);
        }
        function mapTreasuresToRoles(roles, treasurePlan) {
            const map = Array(roles.length).fill(null); let ordinal = 0;
            roles.forEach((role, idx) => { if (role === 'T') map[idx] = treasurePlan[ordinal++]; });
            return map;
        }
        function evaluateOp(left, op, right) {
            switch(op) { case '==': return left === right; case '!=': return left !== right; case '>': return left > right; case '<': return left < right; case '>=': return left >= right; case '<=': return left <= right; default: return false; }
        }

        function generatePossibleStatements(speakerIdx, roles, chestColors, layout, treasureByChest) {
            const num = roles.length; const cols = layout.cols; const rows = layout.rows;
            const [row, col] = layout.pos[speakerIdx]; const totalM = roles.filter(r => r === 'M').length;
            let colorCounts = {}; for(let c of colors) colorCounts[c] = { T: 0, M: 0 };
            for(let i = 0; i < num; i++) colorCounts[chestColors[i]][roles[i]]++;
            let stmts = [];

            const addStmt = (assumesTruth, type, text, data = {}, weight = 10, tags = []) => {
                let certaintyIndices = []; let countGroup = null; let countOp = null; let countValue = null;
                if (type === 'RANDOM_MIMIC_COUNT' && data.kind === 'count') { countGroup = Array.from({ length: num }, (_, i) => i); countOp = data.op; countValue = data.count; }
                else if (type === 'COLOR_M') { countGroup = chestColors.map((v, i) => v === data.color ? i : -1).filter(i => i >= 0); countOp = data.op; countValue = data.count; }
                else if (type === 'GROUP_M_COUNT') { countGroup = [...(data.group || [])]; countOp = data.op; countValue = data.count; }
                else if (type === 'GROUP_M_EXIST') { countGroup = [...(data.group || [])]; countOp = data.hasMimic ? '>' : '=='; countValue = 0; }
                else if (type === 'NOT_COLOR_M') { countGroup = chestColors.map((v, i) => v !== data.color ? i : -1).filter(i => i >= 0); countOp = data.hasMimic ? '>' : '=='; countValue = 0; }

                if (countGroup && countGroup.length && countOp) {
                    const possibleCounts = [];
                    for (let count = 0; count <= countGroup.length; count++) if (evaluateOp(count, countOp, countValue) === assumesTruth) possibleCounts.push(count);
                    if (possibleCounts.length === 1 && (possibleCounts[0] === 0 || possibleCounts[0] === countGroup.length)) certaintyIndices = [...countGroup];
                }
                stmts.push({ type, text, assumesTruth, weightBase: weight, tags, certaintyIndices, ...data });
            };

            const presentColors = [...new Set(chestColors)];
            const shortColorNames = { red: '빨간', blue: '파란', green: '초록', yellow: '노란', purple: '보라' };
            // 부정형 동등 표현은 6층부터 등장하며, 20층에 기본 표현과 같은 가중치가 된 뒤 고정됩니다.
            const highFloorVariantWeight = Math.max(0, Math.min(1, (currentFloor - 5) / 15));
            const addEqualityVariants = (truth, type, firstText, secondText, data, weight, tags) => {
                const totalVariantWeight = 1 + highFloorVariantWeight;
                addStmt(truth, type, firstText, data, weight / totalVariantWeight, tags);
                if (highFloorVariantWeight > 0) {
                    addStmt(truth, type, secondText, data, weight * highFloorVariantWeight / totalVariantWeight, tags);
                }
            };

            const addCountStmts = (actualCount, maxCount, type, prefixText, dataTemplate, weight = 10, tags = []) => {
                // Standard mode uses the disclosed mimic count; random mode uses the board's maximum possible count.
                const publicMaxMimics = isRandomMode ? Math.max(1, Math.floor(num / 2)) : totalM;
                const boundedMax = Math.min(maxCount, publicMaxMimics);
                const variants = [];
                for (let n = 0; n <= boundedMax; n++) variants.push({
                    truth: actualCount === n,
                    text: n === 0 ? `${prefixText} 미믹이 없어.` : `${prefixText} 미믹은 정확히 ${n}마리야.`,
                    data: { op: '==', count: n },
                    decisiveMaximum: n === publicMaxMimics && publicMaxMimics > 0
                });
                for (let n = 1; n <= boundedMax; n++) variants.push({
                    truth: actualCount >= n,
                    text: `${prefixText} 미믹은 ${n}마리 이상이야.`,
                    data: { op: '>=', count: n },
                    decisiveMaximum: n === publicMaxMimics
                });
                // Do not emit a tautological 'maximum or fewer' clue.
                for (let n = 1; n < boundedMax; n++) variants.push({
                    truth: actualCount <= n,
                    text: `${prefixText} 미믹은 ${n}마리 이하야.`,
                    data: { op: '<=', count: n }
                });
                const baseWeight = weight / Math.max(1, variants.length);
                for (const variant of variants) {
                    // Boundary clues are rare in standard mode; random mode keeps normal frequency.
                    const variantWeight = variant.decisiveMaximum && !isRandomMode ? baseWeight * 0.12 : baseWeight;
                    addStmt(variant.truth, type, variant.text, { ...variant.data, ...dataTemplate }, variantWeight, tags);
                }
            };

            if (isRandomMode) {
                const maxMimics = Math.max(1, Math.floor(num / 2));
                const countWeight = 10;
                const colorTypeCount = presentColors.length;
                const randomCountPredicateKeys = new Set();
                const addRandomCount = (truth, text, data) => {
                    // 1..maxMimics 범위에서 동일한 진위 패턴을 갖는 발언은 한 번만 허용합니다.
                    const trueCounts = [];
                    for (let count = 1; count <= maxMimics; count++) {
                        const result = data.kind === 'count'
                            ? evaluateOp(count, data.op, data.count)
                            : data.kind === 'parity'
                                ? count % 2 === data.parity
                                : evaluateOp(data.colorCount, data.op, count);
                        if (result) trueCounts.push(count);
                    }
                    // 항상 참/거짓인 발언은 힌트 가치가 없으므로 제외합니다.
                    if (trueCounts.length === 0 || trueCounts.length === maxMimics) return;
                    const signature = trueCounts.join(',');
                    if (randomCountPredicateKeys.has(signature)) return;
                    randomCountPredicateKeys.add(signature);
                    const texts = Array.isArray(text) ? text : [text];
                    const variantWeights = Array.isArray(data.variantWeights) ? data.variantWeights : texts.map(() => 1);
                    const totalVariantWeight = variantWeights.reduce((sum, value) => sum + value, 0);
                    texts.forEach((statementText, index) => {
                        const variantWeight = variantWeights[index] || 0;
                        if (variantWeight > 0) {
                            const statementData = { ...data };
                            delete statementData.variantWeights;
                            addStmt(truth, 'RANDOM_MIMIC_COUNT', statementText, statementData, countWeight * variantWeight / totalVariantWeight, ['random_mimic_count']);
                        }
                    });
                };

                // 미믹 수 문구를 하나의 문장 형식으로 통일합니다.
                for (let n = 1; n <= maxMimics; n++) {
                    addRandomCount(totalM === n, `미믹의 수는 정확히 ${n}마리야.`, { kind: 'count', op: '==', count: n });
                }
                for (let n = 1; n <= maxMimics; n++) {
                    addRandomCount(totalM >= n, `미믹의 수는 ${n}마리 이상이야.`, { kind: 'count', op: '>=', count: n });
                }
                for (let n = 1; n < maxMimics; n++) {
                    addRandomCount(totalM <= n, `미믹의 수는 ${n}마리 이하야.`, { kind: 'count', op: '<=', count: n });
                }
                const isEven = totalM % 2 === 0;
                addRandomCount(isEven, '미믹의 수는 짝수야.', { kind: 'parity', parity: 0 });
                addRandomCount(!isEven, '미믹의 수는 홀수야.', { kind: 'parity', parity: 1 });

                // 각 색상 상자의 개수와 전체 미믹 수를 비교합니다.
                for (const color of presentColors) {
                    const colorBoxCount = chestColors.filter(value => value === color).length;
                    const colorLabel = `${shortColorNames[color]}색 상자`;
                    addRandomCount(colorBoxCount === totalM, [`${colorLabel}는 미믹의 수와 같아.`, `${colorLabel}는 미믹의 수와 다르지 않아.`], { kind: 'color_compare', op: '==', colorCount: colorBoxCount, variantWeights: [1, highFloorVariantWeight] });
                    addRandomCount(colorBoxCount !== totalM, [`${colorLabel}는 미믹의 수와 달라.`, `${colorLabel}는 미믹의 수와 같지 않아.`], { kind: 'color_compare', op: '!=', colorCount: colorBoxCount, variantWeights: [1, highFloorVariantWeight] });
                    addRandomCount(colorBoxCount >= totalM, `${colorLabel}는 미믹의 수 이상이야.`, { kind: 'color_compare', op: '>=', colorCount: colorBoxCount });
                    addRandomCount(colorBoxCount <= totalM, `${colorLabel}는 미믹의 수 이하야.`, { kind: 'color_compare', op: '<=', colorCount: colorBoxCount });
                }
            }

            const actualAdj = checkAdjacency(roles, layout);
            addStmt(actualAdj === true, 'ADJACENCY_M', '인접한 미믹이 있어.', { hasAdj: true }, 10, ['global']);
            addStmt(actualAdj === false, 'ADJACENCY_M', '인접한 미믹이 없어.', { hasAdj: false }, 10, ['global']);

            // 주위 발언은 상하좌우의 다음 상자(공백 셀 건너뜀)와 네 대각선의 인접 상자를 포함합니다.
            const peerGroup = getHexNeighbors(layout, speakerIdx);
            if (peerGroup.length > 0) {
                const peerMimicCount = peerGroup.filter(idx => roles[idx] === 'M').length;
                addStmt(peerMimicCount > 0, 'GROUP_M_EXIST', '내 주위에는 미믹이 있어.',
                    { group: peerGroup, hasMimic: true }, 10, ['peer:hex']);
                addStmt(peerMimicCount === 0, 'GROUP_M_EXIST', '내 주위에는 미믹이 없어.',
                    { group: peerGroup, hasMimic: false }, 10, ['peer:hex']);
            }

            // 방향별 발언: 상하좌우는 공백 셀을 건너 다음 상자를 찾고, 대각선은 바로 옆 셀만 확인합니다.
            const directionStatements = [
                { label: '왼쪽', dr: 0, dc: -1, skipEmpty: true },
                { label: '오른쪽', dr: 0, dc: 1, skipEmpty: true },
                { label: '위', dr: -1, dc: 0, skipEmpty: true },
                { label: '아래', dr: 1, dc: 0, skipEmpty: true },
                { label: '왼쪽위', dr: -1, dc: -1, skipEmpty: false },
                { label: '왼쪽아래', dr: 1, dc: -1, skipEmpty: false },
                { label: '오른쪽위', dr: -1, dc: 1, skipEmpty: false },
                { label: '오른쪽아래', dr: 1, dc: 1, skipEmpty: false }
            ];
            for (const direction of directionStatements) {
                const neighbor = getDirectionalNeighbor(layout, speakerIdx, direction.dr, direction.dc, direction.skipEmpty);
                if (neighbor < 0) continue;
                const hasMimic = roles[neighbor] === 'M';
                addStmt(hasMimic, 'GROUP_M_EXIST', `내 ${direction.label} 상자에는 미믹이 있어.`,
                    { group: [neighbor], hasMimic: true }, 10, [`direction:${direction.label}`]);
                addStmt(!hasMimic, 'GROUP_M_EXIST', `내 ${direction.label} 상자에는 미믹이 없어.`,
                    { group: [neighbor], hasMimic: false }, 10, [`direction:${direction.label}`]);
            }

            // Chain Logic: count mimics along the speaker's complete row and column.
            const chainGroups = [
                { label: '내 행의 상자 줄', group: layout.pos.map(([r], i) => r === row ? i : -1).filter(i => i >= 0) },
                { label: '내 열의 상자 줄', group: layout.pos.map(([, c], i) => c === col ? i : -1).filter(i => i >= 0) }
            ];
            for (const chain of chainGroups) {
                if (chain.group.length > 1) {
                    const count = chain.group.filter(idx => roles[idx] === 'M').length;
                    addCountStmts(count, chain.group.length, 'GROUP_M_COUNT', chain.label, { group: chain.group }, 4, ['chain']);
                }
            }

            // Symmetry is evaluated by mirrored coordinates in the actual board layout.
            const mirrorPairs = getMirrorPairs(layout);
            if (Array.isArray(mirrorPairs) && mirrorPairs.length > 0) {
                const symmetric = isMirrorSymmetric(roles, layout);
                addStmt(symmetric, 'SYMMETRY_M', '미믹 배치가 좌우 대칭이야.', { isSymmetric: true }, 4, ['symmetry']);
                addStmt(!symmetric, 'SYMMETRY_M', '미믹 배치가 좌우 대칭이 아니야.', { isSymmetric: false }, 4, ['symmetry']);
            }

            for (let c of presentColors) {
                let mM = colorCounts[c].M; let colorGroup = [];
                for (let i = 0; i < num; i++) if (chestColors[i] === c) colorGroup.push(i);
                let t = [`color:${c}`];
                addCountStmts(mM, colorGroup.length, 'COLOR_M', `${shortColorNames[c]}색 상자에는`, { color: c }, 10, t);
                addStmt((mM % 2 === 0), 'COLOR_PARITY', `${shortColorNames[c]}색 상자의 미믹 개수는 짝수(0 포함)야.`, { color: c, parity: 0 }, 10, t);
                addStmt(!(mM % 2 === 0), 'COLOR_PARITY', `${shortColorNames[c]}색 상자의 미믹 개수는 홀수야.`, { color: c, parity: 1 }, 10, t);
                let notGroupSize = num - colorGroup.length;
                if (notGroupSize > 0) {
                    let notGroupM = totalM - mM;
                    addStmt(notGroupM > 0, 'NOT_COLOR_M', `${shortColorNames[c]}색이 아닌 상자에는 미믹이 있어.`, { color: c, hasMimic: true }, 10, t);
                    addStmt(notGroupM === 0, 'NOT_COLOR_M', `${shortColorNames[c]}색이 아닌 상자에는 미믹이 없어.`, { color: c, hasMimic: false }, 10, t);
                }
                if (presentColors.length > 1) {
                    let maxM = Math.max(...presentColors.map(col => colorCounts[col].M));
                    let minM = Math.min(...presentColors.map(col => colorCounts[col].M));
                    const maxColorCount = presentColors.filter(col => colorCounts[col].M === maxM).length;
                    const minColorCount = presentColors.filter(col => colorCounts[col].M === minM).length;
                    // 최다/최소 색상은 공동 1위·공동 꼴찌를 허용하지 않습니다.
                    addStmt(mM === maxM && maxColorCount === 1, 'COLOR_EXTREME', `미믹이 가장 많은 색상은 ${shortColorNames[c]}색이야.`, { color: c, isMax: true }, 3, t);
                    addStmt(mM === minM && minColorCount === 1, 'COLOR_EXTREME', `미믹이 가장 적은 색상은 ${shortColorNames[c]}색이야.`, { color: c, isMax: false }, 3, t);
                }
            }

            const myColor = chestColors[speakerIdx];
            let sameColorGroup = []; let diffColorGroup = [];
            for (let i = 0; i < num; i++) { if (i === speakerIdx) continue; if (chestColors[i] === myColor) sameColorGroup.push(i); else diffColorGroup.push(i); }
            const allSameColorGroup = chestColors.map((color, idx) => color === myColor ? idx : -1).filter(idx => idx >= 0);

            if (presentColors.length >= 2) {
                for(let i=0; i<presentColors.length; i++){
                    for(let j=i+1; j<presentColors.length; j++){
                        let c1 = presentColors[i]; let c2 = presentColors[j];
                        let m1 = colorCounts[c1].M; let m2 = colorCounts[c2].M; let t = [`color:${c1}`, `color:${c2}`];
                        const compare = (m1, m2, c1, c2) => {
                            addStmt(m1 < m2, 'COLOR_CMP', `${shortColorNames[c1]}색 상자가 ${shortColorNames[c2]}색 상자보다 미믹이 적어.`, { c1, c2, op: '<' }, 10, t);
                            addStmt(m1 > m2, 'COLOR_CMP', `${shortColorNames[c1]}색 상자가 ${shortColorNames[c2]}색 상자보다 미믹이 많아.`, { c1, c2, op: '>' }, 10, t);
                            addEqualityVariants(m1 === m2, 'COLOR_CMP', `${shortColorNames[c1]}색과 ${shortColorNames[c2]}색의 미믹 수가 같아.`, `${shortColorNames[c1]}색과 ${shortColorNames[c2]}색의 미믹 수가 다르지 않아.`, { c1, c2, op: '==' }, 10, t);
                        };
                        compare(m1, m2, c1, c2); compare(m2, m1, c2, c1); 
                        let unionGroup = []; for(let k=0; k<num; k++) if (chestColors[k] === c1 || chestColors[k] === c2) unionGroup.push(k);
                        let unionM = unionGroup.filter(idx => roles[idx] === 'M').length;
                        addCountStmts(unionM, unionGroup.length, 'GROUP_M_COUNT', `${shortColorNames[c1]}색과 ${shortColorNames[c2]}색을 합친 상자에는`, { group: unionGroup }, 1.5, []);
                    }
                }
            }

            const spatialGroups = [];
            const addSpatialGroup = (key, labels, group, weight = 10) => {
                const unique = [...new Set(group)]; if (!unique.length) return;
                const signature = [...unique].sort((a, b) => a - b).join(',');
                if (spatialGroups.some(entry => entry.signature === signature && entry.key === key)) return;
                spatialGroups.push({ key, labels: Array.isArray(labels) ? labels : [labels], group: unique, weight, signature });
            };
            const rowGroups = Array.from({ length: rows }, (_, r) => layout.pos.map(([rr], i) => rr === r ? i : -1).filter(i => i >= 0));
            const colGroups = Array.from({ length: cols }, (_, c) => layout.pos.map(([, cc], i) => cc === c ? i : -1).filter(i => i >= 0));
            
            for (let r = 0; r < rows; r++) addSpatialGroup(`row:${r}`, [`${r + 1}행`, ...(r === row ? ['내가 있는 행'] : [])], rowGroups[r], 10);
            for (let c = 0; c < cols; c++) addSpatialGroup(`col:${c}`, [`${String.fromCharCode(65 + c)}열`, ...(c === col ? ['내가 있는 열'] : [])], colGroups[c], 10);
            
            addSpatialGroup('edge:top', ['가장 위쪽 행'], rowGroups[0], 10);
            addSpatialGroup('edge:bottom', ['가장 아래쪽 행'], rowGroups[rows - 1], 10);
            addSpatialGroup('edge:left', ['가장 왼쪽 열'], colGroups[0], 10);
            addSpatialGroup('edge:right', ['가장 오른쪽 열'], colGroups[cols - 1], 10);
            addSpatialGroup('row:even', '짝수 행', layout.pos.map(([r], i) => r % 2 === 1 ? i : -1).filter(i => i >= 0), 10);
            addSpatialGroup('row:odd', '홀수 행', layout.pos.map(([r], i) => r % 2 === 0 ? i : -1).filter(i => i >= 0), 10);

            for (const color of presentColors) addSpatialGroup(`color:${color}`, [`${shortColorNames[color]}색 상자`], chestColors.map((v, i) => v === color ? i : -1).filter(i => i >= 0), 8);
            addSpatialGroup('self-color:others', ['나와 같은 색의 다른 상자'], sameColorGroup, 10);
            addSpatialGroup('self-color:all', ['나와 같은 색의 상자'], allSameColorGroup, 10);
            addSpatialGroup('self-color:different', ['나와 다른 색의 상자'], diffColorGroup, 10);

            const sameRow = rowGroups[row]; const rowM = sameRow.filter(idx => roles[idx] === 'M').length;
            if (rows > 1) {
                const targetRow = (row + 1) % rows; const targetM = rowGroups[targetRow].filter(idx => roles[idx] === 'M').length;
                addStmt(rowM > targetM, 'ROW_CMP', `${row + 1}행의 미믹 수가 ${targetRow + 1}행보다 많아.`, { r1: row, r2: targetRow, op: '>' }, 10, []);
                addStmt(rowM < targetM, 'ROW_CMP', `${row + 1}행의 미믹 수가 ${targetRow + 1}행보다 적어.`, { r1: row, r2: targetRow, op: '<' }, 10, []);
                addEqualityVariants(rowM === targetM, 'ROW_CMP', `${row + 1}행과 ${targetRow + 1}행의 미믹 수가 같아.`, `${row + 1}행과 ${targetRow + 1}행의 미믹 수가 다르지 않아.`, { r1: row, r2: targetRow, op: '==' }, 10, []);
            }
            if (totalM > 1) {
                const mRows = new Set(); roles.forEach((r, i) => { if (r === 'M') mRows.add(layout.pos[i][0]); });
                const mCols = new Set(); roles.forEach((r, i) => { if (r === 'M') mCols.add(layout.pos[i][1]); });
                const rowAdjacentPairs = [];
                const colAdjacentPairs = [];
                for (let i = 0; i < num; i++) {
                    for (const j of getAdjacentNeighbors(layout, i)) {
                        if (j <= i) continue;
                        const [ri, ci] = layout.pos[i];
                        const [rj, cj] = layout.pos[j];
                        if (ri === rj) rowAdjacentPairs.push([i, j]);
                        if (ci === cj) colAdjacentPairs.push([i, j]);
                    }
                }
                const rowHasAdjacentMimics = rowAdjacentPairs.some(([a, b]) => roles[a] === 'M' && roles[b] === 'M');
                const colHasAdjacentMimics = colAdjacentPairs.some(([a, b]) => roles[a] === 'M' && roles[b] === 'M');
                const highFloorStatementWeight = 4 * highFloorVariantWeight;

                addStmt(rowHasAdjacentMimics, 'ROW_ADJACENT_M', '같은 행에 인접한 미믹이 있어.', { hasAdj: true }, 4, ['global']);
                addStmt(!rowHasAdjacentMimics, 'ROW_ADJACENT_M', '같은 행에 인접한 미믹이 없어.', { hasAdj: false }, 4, ['global']);
                addStmt(colHasAdjacentMimics, 'COL_ADJACENT_M', '같은 열에 인접한 미믹이 있어.', { hasAdj: true }, 4, ['global']);
                addStmt(!colHasAdjacentMimics, 'COL_ADJACENT_M', '같은 열에 인접한 미믹이 없어.', { hasAdj: false }, 4, ['global']);

                if (highFloorStatementWeight > 0) {
                    addStmt(mRows.size < totalM, 'ROW_MULTI_M', '같은 행에 미믹이 2마리 이상 모인 곳이 있어.', { hasMultiple: true }, highFloorStatementWeight, ['global']);
                    addStmt(mRows.size === totalM, 'ROW_MULTI_M', '같은 행에 미믹이 2마리 이상 모인 곳이 없어.', { hasMultiple: false }, highFloorStatementWeight, ['global']);
                    addStmt(mCols.size < totalM, 'COL_MULTI_M', '같은 열에 미믹이 2마리 이상 모인 곳이 있어.', { hasMultiple: true }, highFloorStatementWeight, ['global']);
                    addStmt(mCols.size === totalM, 'COL_MULTI_M', '같은 열에 미믹이 2마리 이상 모인 곳이 없어.', { hasMultiple: false }, highFloorStatementWeight, ['global']);
                }
            }

            const itemGroups = [];
            for (const entry of spatialGroups) {
                const mimicCount = entry.group.filter(idx => roles[idx] === 'M').length;
                for (const label of entry.labels) {
                    addStmt(mimicCount > 0, 'GROUP_M_EXIST', `${label}에는 미믹이 있어.`, { group: entry.group, hasMimic: true }, entry.weight, [entry.key]);
                    addStmt(mimicCount === 0, 'GROUP_M_EXIST', `${label}에는 미믹이 없어.`, { group: entry.group, hasMimic: false }, entry.weight, [entry.key]);
                }
                if (!entry.key.startsWith('row:even') && !entry.key.startsWith('row:odd') && !entry.key.startsWith('color:') && !entry.key.startsWith('self-color:')) {
                    if (entry.key.startsWith('row:') || entry.key.startsWith('col:') || entry.key.startsWith('edge:')) {
                        for (const label of entry.labels) itemGroups.push({ label, group: entry.group, tag: entry.key });
                    }
                }
            }
            const dirGroups = [
                { key: 'item-direction:up-column', label: '내 위쪽 열', group: layout.pos.map(([r, c], i) => c === col && r < row ? i : -1).filter(i => i >= 0) },
                { key: 'item-direction:down-column', label: '내 아래쪽 열', group: layout.pos.map(([r, c], i) => c === col && r > row ? i : -1).filter(i => i >= 0) },
                { key: 'item-direction:left-row', label: '내 왼쪽 행', group: layout.pos.map(([r, c], i) => r === row && c < col ? i : -1).filter(i => i >= 0) },
                { key: 'item-direction:right-row', label: '내 오른쪽 행', group: layout.pos.map(([r, c], i) => r === row && c > col ? i : -1).filter(i => i >= 0) }
            ];
            for (const entry of dirGroups) if (entry.group.length) itemGroups.push(entry);

            const itemNames = [...new Set(treasureByChest.filter(Boolean))];
            for (const item of itemNames) {
                const safeItem = escapeStatementText(item); const particle = subjectParticle(item);
                for (const entry of itemGroups) {
                    const count = entry.group.filter(idx => treasureByChest[idx] === item).length;
                    addStmt(count > 0, 'ITEM_GROUP_EXIST', `${entry.label}에는 ${safeItem}${particle} 있어.`, { group: entry.group, item, hasItem: true }, 0.65, [entry.tag, `item:${item}`]);
                    addStmt(count === 0, 'ITEM_GROUP_EXIST', `${entry.label}에는 ${safeItem}${particle} 없어.`, { group: entry.group, item, hasItem: false }, 0.65, [entry.tag, `item:${item}`]);
                }
            }

            return { truthCandidates: stmts.filter(stmt => stmt.assumesTruth === true), falseCandidates: stmts.filter(stmt => stmt.assumesTruth === false) };
        }

        function findComplementaryStatement(stmt, falseCandidates) {
            const inverseOp = { '==': '!=', '!=': '==', '>': '<=', '<=': '>', '<': '>=', '>=': '<' };
            const fieldsByType = {
                RANDOM_MIMIC_COUNT: ['kind', 'op', 'count', 'parity', 'colorCount'],
                COLOR_M: ['color', 'op', 'count'],
                GROUP_M_COUNT: ['group', 'op', 'count'],
                COLOR_PARITY: ['color', 'parity'],
                COLOR_CMP: ['c1', 'c2', 'op'],
                NOT_COLOR_M: ['color', 'hasMimic'],
                GROUP_M_EXIST: ['group', 'hasMimic'],
                ITEM_GROUP_EXIST: ['group', 'item', 'hasItem'],
                ROW_CMP: ['r1', 'r2', 'op'],
                ROW_ADJACENT_M: ['hasAdj'],
                COL_ADJACENT_M: ['hasAdj'],
                ADJACENCY_M: ['hasAdj'],
                ROW_MULTI_M: ['hasMultiple'],
                COL_MULTI_M: ['hasMultiple'],
                SYMMETRY_M: ['isSymmetric']
            };
            const fields = fieldsByType[stmt.type];
            if (!fields) return null;
            const inverse = { ...stmt };
            if (Object.prototype.hasOwnProperty.call(stmt, 'op')) {
                inverse.op = inverseOp[stmt.op];
                if (!inverse.op) return null;
            }
            for (const key of ['hasMimic', 'hasAdj', 'hasMultiple', 'hasItem', 'isSymmetric']) {
                if (Object.prototype.hasOwnProperty.call(stmt, key)) inverse[key] = !stmt[key];
            }
            if (Object.prototype.hasOwnProperty.call(stmt, 'parity')) inverse.parity = 1 - stmt.parity;
            const sameValue = (a, b) => Array.isArray(a) && Array.isArray(b)
                ? a.length === b.length && a.every((value, index) => value === b[index])
                : a === b;
            return falseCandidates.find(candidate =>
                candidate.type === stmt.type &&
                candidate.assumesTruth === false &&
                fields.every(key => sameValue(inverse[key], candidate[key]))
            ) || null;
        }

        function testStatementsCombination(
            statements, combo, chestColors, layout, treasurePlan,
            sleepIndices = [], tricksterIdx = -1, copyTargetIdx = -1
        ) {
            const num = combo.length;
            const colorCounts = {};
            for (const c of colors) colorCounts[c] = { M: 0 };
            for (let i = 0; i < num; i++) if (combo[i] === 'M') colorCounts[chestColors[i]].M++;
            const presentColors = [...new Set(chestColors)];
            const candidateTreasures = mapTreasuresToRoles(combo, treasurePlan);
            const totalMimics = combo.filter(role => role === 'M').length;

            for (let i = 0; i < num; i++) {
                if (sleepIndices.includes(i)) continue;
                const stmt = statements[i];
                if (!stmt) return false;
                const expectedTruth = i === tricksterIdx
                    ? (copyTargetIdx >= 0 && combo[copyTargetIdx] === 'T')
                    : combo[i] === 'T';
                let isTrue = false;
                switch(stmt.type) {
                    case 'RANDOM_MIMIC_COUNT':
                        if (stmt.kind === 'count') isTrue = evaluateOp(totalMimics, stmt.op, stmt.count);
                        else if (stmt.kind === 'parity') isTrue = (totalMimics % 2 === stmt.parity);
                        else if (stmt.kind === 'color_compare') isTrue = evaluateOp(stmt.colorCount, stmt.op, totalMimics);
                        break;
                    case 'COLOR_M':
                    case 'GROUP_M_COUNT': {
                        const gCount = stmt.type === 'COLOR_M'
                            ? colorCounts[stmt.color].M
                            : stmt.group.filter(idx => combo[idx] === 'M').length;
                        isTrue = evaluateOp(gCount, stmt.op, stmt.count);
                        break;
                    }
                    case 'COLOR_PARITY':
                        isTrue = (colorCounts[stmt.color].M % 2 === stmt.parity);
                        break;
                    case 'COLOR_CMP':
                        isTrue = evaluateOp(colorCounts[stmt.c1].M, stmt.op, colorCounts[stmt.c2].M);
                        break;
                    case 'NOT_COLOR_M': {
                        const count = combo.filter((role, idx) => role === 'M' && chestColors[idx] !== stmt.color).length;
                        isTrue = stmt.hasMimic ? count > 0 : count === 0;
                        break;
                    }
                    case 'COLOR_EXTREME': {
                        const allM = presentColors.map(col => colorCounts[col].M);
                        const extremeVal = stmt.isMax ? Math.max(...allM) : Math.min(...allM);
                        const extremeCount = allM.filter(count => count === extremeVal).length;
                        isTrue = extremeCount === 1 && colorCounts[stmt.color].M === extremeVal;
                        break;
                    }
                    case 'GROUP_M_EXIST': {
                        const count = stmt.group.filter(idx => combo[idx] === 'M').length;
                        isTrue = stmt.hasMimic ? count > 0 : count === 0;
                        break;
                    }
                    case 'ITEM_GROUP_EXIST': {
                        const count = stmt.group.filter(idx => candidateTreasures[idx] === stmt.item).length;
                        isTrue = stmt.hasItem ? count > 0 : count === 0;
                        break;
                    }
                    case 'ROW_CMP': {
                        let r1M = 0, r2M = 0;
                        layout.pos.forEach(([r], idx) => {
                            if (r === stmt.r1 && combo[idx] === 'M') r1M++;
                            if (r === stmt.r2 && combo[idx] === 'M') r2M++;
                        });
                        isTrue = evaluateOp(r1M, stmt.op, r2M);
                        break;
                    }
                    case 'ROW_ADJACENT_M':
                    case 'COL_ADJACENT_M': {
                        const axis = stmt.type === 'ROW_ADJACENT_M' ? 0 : 1;
                        let found = false;
                        for (let idx = 0; idx < num && !found; idx++) {
                            if (combo[idx] !== 'M') continue;
                            found = getAdjacentNeighbors(layout, idx).some(other =>
                                other > idx && combo[other] === 'M' &&
                                layout.pos[other][axis] === layout.pos[idx][axis]);
                        }
                        isTrue = found === stmt.hasAdj;
                        break;
                    }
                    case 'ROW_MULTI_M':
                    case 'COL_MULTI_M': {
                        const axis = stmt.type === 'ROW_MULTI_M' ? 0 : 1;
                        const occupied = new Set();
                        combo.forEach((role, idx) => { if (role === 'M') occupied.add(layout.pos[idx][axis]); });
                        isTrue = (occupied.size < totalMimics) === stmt.hasMultiple;
                        break;
                    }
                    case 'ADJACENCY_M':
                        isTrue = checkAdjacency(combo, layout) === stmt.hasAdj;
                        break;
                    case 'SYMMETRY_M':
                        isTrue = isMirrorSymmetric(combo, layout) === stmt.isSymmetric;
                        break;
                }
                if (expectedTruth !== isTrue) return false;
            }
            return true;
        }

        function weightedRandomSelect(statements, historyTags, confirmedIndices, totalChests, isBoss) {
            let totalWeight = 0;
            let bossFactor = isBoss ? Math.min(0.8, 0.15 * Math.floor(currentFloor / 4)) : 0; // Correlation reduction
            
            let weightedStmts = statements.map(stmt => {
                let w = stmt.weightBase || 10;
                const certainty = stmt.certaintyIndices || [];
                if (stmt.type === 'RANDOM_MIMIC_COUNT') w *= 0.5;
                if (stmt.type === 'ITEM_GROUP_EXIST') {
                    const confirmedOverlap = (stmt.group || []).filter(idx => confirmedIndices.has(idx)).length;
                    if (confirmedOverlap > 0) w *= Math.min(2.4, 1.8 + (confirmedOverlap - 1) * 0.2);
                }
                if (stmt.type !== 'ITEM_GROUP_EXIST' && !certainty.length && stmt.tags && historyTags.length > 0) {
                    stmt.tags.forEach(tag => { if (historyTags.includes(tag)) w += 5; });
                }
                if (certainty.length) {
                    const newlyConfirmed = certainty.filter(idx => !confirmedIndices.has(idx)).length;
                    const overHalf = Math.max(0, (confirmedIndices.size + newlyConfirmed) - Math.max(1, totalChests / 2));
                    w *= (1 / (1 + 0.35 * newlyConfirmed)) * Math.max(0.03, Math.exp(-5 * Math.pow(overHalf / Math.max(1, totalChests * 0.2), 2)));
                }
                
                // Apply Boss rules (flattens probabilities)
                if (bossFactor > 0) w = w * (1 - bossFactor) + 10 * bossFactor;
                
                totalWeight += w; return { stmt, weight: w };
            });
            const randomCountWeight = weightedStmts.filter(ws => ws.stmt.type === 'RANDOM_MIMIC_COUNT').reduce((sum, ws) => sum + ws.weight, 0);
            const nonRandomCountWeight = weightedStmts.filter(ws => ws.stmt.type !== 'RANDOM_MIMIC_COUNT' && ws.stmt.type !== 'ITEM_GROUP_EXIST').reduce((sum, ws) => sum + ws.weight, 0);
            const randomCountWeightCap = nonRandomCountWeight * 0.5;
            if (randomCountWeight > randomCountWeightCap && randomCountWeight > 0) {
                const scale = randomCountWeightCap / randomCountWeight;
                weightedStmts.forEach(ws => { if (ws.stmt.type === 'RANDOM_MIMIC_COUNT') ws.weight *= scale; });
                totalWeight = weightedStmts.reduce((sum, ws) => sum + ws.weight, 0);
            }
            const itemWeight = weightedStmts.filter(ws => ws.stmt.type === 'ITEM_GROUP_EXIST').reduce((sum, ws) => sum + ws.weight, 0);
            const otherWeight = weightedStmts.filter(ws => ws.stmt.type !== 'ITEM_GROUP_EXIST').reduce((sum, ws) => sum + ws.weight, 0);
            const itemWeightCap = otherWeight * 0.05;
            if (itemWeight > itemWeightCap && itemWeight > 0) {
                const scale = itemWeightCap / itemWeight;
                weightedStmts.forEach(ws => { if (ws.stmt.type === 'ITEM_GROUP_EXIST') ws.weight *= scale; });
                totalWeight = weightedStmts.reduce((sum, ws) => sum + ws.weight, 0);
            }
            let r = Math.random() * totalWeight;
            for (let ws of weightedStmts) { r -= ws.weight; if (r <= 0) return ws.stmt; }
            return weightedStmts[weightedStmts.length - 1].stmt;
        }

        function getCombinations(n, m) {
            let results = [];
            function recurse(arr, onesLeft) {
                if (arr.length === n) { if (onesLeft === 0) results.push([...arr]); return; }
                if (onesLeft > 0) { arr.push('M'); recurse(arr, onesLeft - 1); arr.pop(); }
                if (n - arr.length > onesLeft) { arr.push('T'); recurse(arr, onesLeft); arr.pop(); }
            }
            recurse([], m); return results;
        }
        function getAllCombinations(n, maxM) {
            let results = []; for (let m = 1; m <= maxM; m++) results.push(...getCombinations(n, m)); return results;
        }

        function generatePuzzle(
            numChests, numMimics, rawTreasures, isBoss,
            sleepIndices = [], tricksterMode = 'none'
        ) {
            const layout = getGridLayout(numChests);
            const awakeIndices = Array.from({ length: numChests }, (_, i) => i)
                .filter(i => !sleepIndices.includes(i));
            const maxM = Math.max(1, Math.floor(numChests / 2));
            const combos = isRandomMode
                ? getAllCombinations(numChests, maxM)
                : getCombinations(numChests, numMimics);
            const needsTrickster = ['required', 'optional', 'hidden-present', 'hidden-absent'].includes(tricksterMode);
            if (needsTrickster && awakeIndices.length < 2) return null;

            const generateAttempts = (withTrickster, validateNoTrickster, validateTrickster) => {
                for (let attempt = 0; attempt < 500; attempt++) {
                    const actualRoles = generateRoles(numChests, numMimics);
                    const actualColors = getRandomColors(numChests);
                    const treasurePlan = buildTreasurePlan(numChests, rawTreasures);
                    const actualTreasures = mapTreasuresToRoles(actualRoles, treasurePlan);

                    let tricksterIdx = -1;
                    let copyTargetIdx = -1;
                    if (withTrickster) {
                        const eligible = awakeIndices.filter(i => actualRoles[i] === 'T');
                        if (!eligible.length) continue;
                        tricksterIdx = eligible[Math.floor(Math.random() * eligible.length)];
                        const targets = Array.from({ length: numChests }, (_, i) => i)
                            .filter(i => i !== tricksterIdx);
                        copyTargetIdx = targets[Math.floor(Math.random() * targets.length)];
                    }

                    const selectedStatements = [];
                    const historyTags = [];
                    const confirmedIndices = new Set();
                    let success = true;

                    for (let i = 0; i < numChests; i++) {
                        const pools = generatePossibleStatements(
                            i, actualRoles, actualColors, layout, actualTreasures
                        );
                        const isTrickster = i === tricksterIdx;
                        const targetIsMimic = isTrickster && actualRoles[copyTargetIdx] === 'M';
                        let possible = actualRoles[i] === 'T'
                            ? pools.truthCandidates
                            : pools.falseCandidates;

                        if (isTrickster && targetIsMimic) {
                            possible = possible.filter(stmt =>
                                findComplementaryStatement(stmt, pools.falseCandidates) !== null
                            );
                        }
                        if (!possible.length) { success = false; break; }
                        let picked = weightedRandomSelect(
                            possible, historyTags, confirmedIndices, numChests, isBoss
                        );

                        if (isTrickster && targetIsMimic) {
                            picked = findComplementaryStatement(picked, pools.falseCandidates);
                            if (!picked) { success = false; break; }
                        }

                        selectedStatements.push(picked);
                        (picked.certaintyIndices || []).forEach(idx => confirmedIndices.add(idx));
                        if (picked.tags) picked.tags.forEach(tag => {
                            if (!historyTags.includes(tag)) historyTags.push(tag);
                        });
                    }

                    if (!success || selectedStatements.length !== numChests) continue;

                    const solutionKeys = new Set();
                    const checkScenario = (candidateTrickster) => {
                        for (const combo of combos) {
                            if (candidateTrickster >= 0 && combo[candidateTrickster] !== 'T') continue;

                            const candidateTargets = candidateTrickster < 0
                                ? [-1]
                                : [
                                    combo.findIndex((role, idx) =>
                                        idx !== candidateTrickster && role === 'T'
                                    ),
                                    combo.findIndex((role, idx) =>
                                        idx !== candidateTrickster && role === 'M'
                                    )
                                ].filter(idx => idx >= 0);

                            let scenarioMatches = false;
                            for (const candidateTarget of candidateTargets) {
                                if (testStatementsCombination(
                                    selectedStatements, combo, actualColors, layout, treasurePlan,
                                    sleepIndices, candidateTrickster, candidateTarget
                                )) {
                                    scenarioMatches = true;
                                    break;
                                }
                            }

                            if (scenarioMatches) {
                                solutionKeys.add(
                                    `${combo.join('')}: ${candidateTrickster < 0 ? 'none' : candidateTrickster}`
                                );
                                if (solutionKeys.size > 1) return false;
                            }
                        }
                        return true;
                    };

                    if (validateNoTrickster && !checkScenario(-1)) continue;
                    if (validateTrickster) {
                        let multipleSolutions = false;
                        for (const candidateIdx of awakeIndices) {
                            if (!checkScenario(candidateIdx)) {
                                multipleSolutions = true;
                                break;
                            }
                        }
                        if (multipleSolutions) continue;
                    }

                    if (solutionKeys.size === 1) {
                        return {
                            roles: actualRoles,
                            statements: selectedStatements,
                            colors: actualColors,
                            treasures: actualTreasures,
                            layout: {
                                cols: layout.cols, rows: layout.rows,
                                rowCounts: layout.rowCounts, pos: layout.pos,
                                honeycomb: layout.honeycomb
                            },
                            tricksterIdx,
                            copyTargetIdx
                        };
                    }
                }
                return null;
            };

            const actualWithTrickster =
                tricksterMode === 'required' || tricksterMode === 'hidden-present';
            const validateNoTrickster =
                tricksterMode === 'none' || tricksterMode === 'hidden-present' || tricksterMode === 'hidden-absent';
            const validateTrickster =
                tricksterMode === 'required' || tricksterMode === 'hidden-present' || tricksterMode === 'hidden-absent';

            const primary = generateAttempts(
                actualWithTrickster, validateNoTrickster, validateTrickster
            );
            if (primary) return primary;

            // 흉내쟁이 조건 생성이 500회 안에 실패하면 일반 퍼즐로 안전하게 대체합니다.
            if (tricksterMode !== 'none') {
                return generateAttempts(false, true, false);
            }
            return null;
        }

        // --- Render UI ---
        // v0.07j — chest artwork is loaded only from the verified five-color sprite set.
        const CHEST_SPRITE_COLORS = new Set(["yellow", "blue", "red", "green", "purple"]);
        function getChestSpritePath(colorKey, isOpen, isMimic, isSleeping) {
            const color = CHEST_SPRITE_COLORS.has(colorKey) ? colorKey : "yellow";
            const state = isOpen ? (isMimic ? "mimic" : "open")
                : (isSleeping ? "sleeping" : "closed");
            return `assets/chests/chest_${color}_${state}.png`;
        }

        function renderChests(targetContainer = container, boardData = chestsData, isPreview = false) {
            targetContainer.innerHTML = '';
            targetContainer.style.overflow = 'visible';
            targetContainer.style.maxWidth = '100%';
            const horizontalScroller = document.createElement('div');
            horizontalScroller.className = "w-full max-w-full overflow-x-auto overflow-y-visible pt-4 pb-2";
            const rowsWrapper = document.createElement('div');
            rowsWrapper.className = "flex flex-col gap-1 items-center w-max min-w-0 mx-auto";
            rowsWrapper.style.position = "relative";
            horizontalScroller.appendChild(rowsWrapper);
            targetContainer.appendChild(horizontalScroller);
            const numChests = boardData.length;
            let layout;
            if (boardData === chestsData) {
                // 실제 게임판 배치는 층 생성 시 한 번만 추첨하고 모든 재렌더링에서 재사용합니다.
                if (!currentGridLayout) currentGridLayout = boardData[0]?.gridLayout || getGridLayout(numChests);
                layout = currentGridLayout;
                boardData.forEach(chest => { chest.gridLayout = layout; });
            } else {
                layout = boardData[0]?.gridLayout || getGridLayout(numChests);
            }
            const rows = layout.rows;
            const rowGroups = Array.from({length: rows}, () => []); layout.pos.forEach(([r, c], idx) => { rowGroups[r].push(idx); });

            for (let r = 0; r < rows; r++) {
                if (rowGroups[r].length === 0) continue;
                const rowContainer = document.createElement('div');
                rowContainer.className = "grid justify-center items-start w-max mx-auto shrink-0";
                const isWideScreen = window.matchMedia('(min-width: 768px)').matches;
                // 실제 상자 래퍼 폭(8rem)에 맞춰 트랙을 줄여 화면에서 상자 사이 간격을 축소합니다.
                // 벌집형은 상자당 2트랙이므로 4rem, 일반형은 8.5rem으로 설정합니다.
                const gridTrack = layout.honeycomb ? 2.5 : 8.5;
                rowContainer.style.gridTemplateColumns = `repeat(${layout.honeycomb ? layout.cols * 2 : layout.cols}, ${gridTrack}rem)`;
                rowContainer.style.columnGap = '0px';
                rowContainer.style.flexShrink = "0";
                rowGroups[r].sort((a, b) => layout.pos[a][1] - layout.pos[b][1]);

                for (let idx of rowGroups[r]) {
                    const chest = boardData[idx];
                    const chestWrap = document.createElement('div'); chestWrap.className = `v2-board-item flex flex-col items-center w-32 relative mt-0 shrink-0`;
                    if (!isPreview) { chestWrap.onmouseenter = () => { hoveredChestIdx = idx; }; chestWrap.onmouseleave = () => { if (hoveredChestIdx === idx) hoveredChestIdx = null; }; }

                    const coord = getCoord(idx, layout);
                    const coordBadge = document.createElement('div'); coordBadge.className = "absolute -top-2 -left-2 md:-left-3 bg-indigo-900 text-amber-400 font-extrabold px-1 py-0.5 rounded border border-indigo-700 shadow-sm z-10 text-[9px]";
                    coordBadge.innerText = coord.name; chestWrap.appendChild(coordBadge);

                    const bubble = document.createElement('div');
                    bubble.className = `v2-speech-card relative bg-white border ${chest.isOpen && chest.role === 'M' ? 'border-red-300 text-red-600' : chest.isOpen && chest.role === 'T' ? 'border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-700'} 
                                        text-[11px] md:text-xs px-2.5 py-1.5 rounded-xl mb-1.5 w-full text-center shadow-sm bubble-arrow font-medium break-keep h-[58px] md:h-[68px] flex items-center justify-center leading-snug overflow-hidden`;
                    
                    if (chest.isSleeping) bubble.innerHTML = `<span class="text-xl font-bold tracking-widest text-slate-400 animate-pulse">zzZ</span>`;
                    else bubble.innerHTML = `<span>${chest.statement}</span>`;
                    
                    bubble.dataset.statementIndex = String(idx);
                    bubble.classList.toggle("v2-link-source-selected", !isPreview &&
                        (selectedStatementIdx === idx || selectedLineLink?.[0] === idx));
                    if (!isPreview) {
                        bubble.title = "좌클릭: 연결 출발·도착 선택 / 우클릭: 선 색상·지우개";
                        // 우클릭은 상위 게임판에서 처리합니다.
                        // SVG 연결선이 발언 위를 지나가도 원래 발언 카드를 찾기 위함입니다.
                        bubble.addEventListener("click", event => {
                            event.stopPropagation();
                            if (isGameOver) return;
                            // 다른 발언을 선택한 상태라면 이 발언을 연결 대상으로 취급합니다.
                            // 상자 그림을 클릭했을 때와 같은 연결 로직을 사용합니다.
                            if (selectedStatementIdx !== null && selectedStatementIdx !== idx) {
                                toggleStatementLink(selectedStatementIdx, idx);
                                return;
                            }
                            selectedStatementIdx = selectedStatementIdx === idx ? null : idx;
                            selectedLineLink = null;
                            statusMsg.innerText = selectedStatementIdx === null
                                ? "발언 선택을 해제했습니다."
                                : `${getCoord(idx, layout).name} 발언 선택됨 — 연결할 상자 또는 발언문구를 클릭하세요.`;
                            statusMsg.className = "text-center text-sm font-bold mb-3 h-6 text-amber-300 drop-shadow-sm";
                            renderChests();
                        });
                    }
                    chestWrap.appendChild(bubble);

                    let boxShadows = [];
                    if (!chest.isOpen) {
                        if (chest.mark === 'O') boxShadows.push('0 0 15px 2px rgba(16,185,129,0.5), 0 0 0 3px #10b981');
                        if (chest.mark === 'X') boxShadows.push('0 0 15px 2px rgba(239,68,68,0.5), 0 0 0 3px #ef4444');
                        if (chest.mark === '?') boxShadows.push('0 0 15px 2px rgba(245,158,11,0.5), 0 0 0 3px #f59e0b');

                        const memoColorsObj = { 1: '#ec4899', 2: '#a855f7', 3: '#06b6d4', 4: '#f97316', 5: '#84cc16' };
                        let memoOffset = chest.mark ? 6 : 3;
                        let sortedMemos = [...chest.memo].sort((a,b) => a - b);
                        sortedMemos.forEach(m => { boxShadows.push(`0 0 0 ${memoOffset}px ${memoColorsObj[m]}`); memoOffset += 3; });
                    }

                    const displayAsMimic = chest.role === 'M' || chest.isTricksterMimickingMimic;
                    // Keep the original clickable button, coordinate and annotation logic intact.
                    const btnChest = document.createElement('button');
                    btnChest.type = "button";
                    btnChest.className = `v2-chest-sprite relative flex items-center justify-center transition-all duration-300 ${chest.isOpen ? 'cursor-default' : 'hover:-translate-y-1.5 cursor-pointer'}`;
                    if (!chest.isOpen && boxShadows.length > 0) {
                        btnChest.style.boxShadow = boxShadows.join(", ");
                    }
                    const sprite = document.createElement("img");
                    sprite.src = getChestSpritePath(chest.color, chest.isOpen, displayAsMimic, chest.isSleeping);
                    sprite.className = `v2-chest-pixel-art ${chest.isOpen ? (displayAsMimic ? "mimic-shake" : "chest-bounce") : ""}`;
                    sprite.alt = "";
                    sprite.width = 64;
                    sprite.height = 64;
                    sprite.decoding = "async";
                    sprite.draggable = false;
                    btnChest.appendChild(sprite);
                    const chestColorName = {yellow:"노란색",blue:"파란색",red:"빨간색",green:"초록색",purple:"보라색"}[chest.color] || "노란색";
                    const chestStateName = chest.isOpen ? (displayAsMimic ? "미믹" : "열린 상자")
                        : (chest.isSleeping ? "잠자는 상자" : "닫힌 상자");
                    btnChest.setAttribute("aria-label", `${coord.name} ${chestColorName} ${chestStateName}`);
                    if (isGameOver && chest.isOpen) btnChest.classList.add(displayAsMimic ? 'mimic-result-reveal' : 'treasure-result-reveal');
                    
                    btnChest.dataset.chestIndex = String(idx);
                    if (!isPreview && chest.isOpen && recentRevealIdx === idx) {
                        btnChest.classList.add("v2-chest-reveal-flash");
                    }
                    if (!isPreview) btnChest.title = "좌클릭: 상자 열기 또는 선 연결 / 우클릭: 마킹·메모";
                    if (!isPreview) btnChest.onclick = () => {
                        if (selectedStatementIdx !== null) {
                            toggleStatementLink(selectedStatementIdx, idx);
                            return;
                        }
                        if (!chest.isOpen) openChest(idx);
                    };
                    chestWrap.appendChild(btnChest);

                    const actionWrap = document.createElement('div');
                    actionWrap.className = "mt-1 w-full h-[18px] flex items-center justify-center";
                    if (chest.isOpen) {
                        const resultBadge = document.createElement('div');
                        resultBadge.className = `w-full min-h-[18px] px-1 py-0.5 rounded-lg bg-white shadow-xs text-[9px] leading-tight font-bold text-center flex items-center justify-center break-keep ${displayAsMimic ? 'text-red-600' : (chest.isTrickster || chest.treasure === '흉내쟁이' ? 'text-violet-700' : (treasureColorMap[chest.treasure] || { text: 'text-emerald-700' }).text)}`;
                        resultBadge.innerText = displayAsMimic ? (chest.isTricksterMimickingMimic ? '흉내쟁이(미믹)!' : '미믹!') : chest.treasure;
                        actionWrap.appendChild(resultBadge);
                    } else {
                        // 마킹과 숫자 메모를 별도로 표시하므로 둘 다 동시에 확인할 수 있습니다.
                        const editButton = document.createElement('button');
                        editButton.type = "button";
                        editButton.className = "v2-chest-mark-select";
                        if (!isPreview && markToolbarActiveIdx === idx) {
                            editButton.classList.add("is-selected");
                        }
                        editButton.title = "클릭해서 이 상자의 마킹·메모를 수정하세요.";
                        editButton.setAttribute("aria-label", `${coord.name} 상자 마킹·메모 편집`);
                        const markBadge = document.createElement('span');
                        markBadge.className = "w-[18px] h-[18px] shrink-0 rounded-sm border-2 border-slate-300 bg-white shadow-sm flex items-center justify-center text-[9px] font-extrabold";
                        const markStyles = {
                            O: "text-emerald-600 border-emerald-400",
                            X: "text-red-600 border-red-400",
                            "?": "text-amber-500 border-amber-400"
                        };
                        if (chest.mark) {
                            markBadge.className += " " + markStyles[chest.mark];
                            markBadge.textContent = chest.mark;
                        } else {
                            markBadge.textContent = " ";
                        }
                        editButton.appendChild(markBadge);
                        if (Array.isArray(chest.memo) && chest.memo.length) {
                            const memoList = document.createElement("span");
                            memoList.className = "v2-mark-memo-readout";
                            [...chest.memo].sort((a,b) => a-b).forEach(num => {
                                const digit = document.createElement("span");
                                digit.textContent = String(num);
                                memoList.appendChild(digit);
                            });
                            editButton.appendChild(memoList);
                        }
                        if (!isPreview) editButton.addEventListener("click", event => {
                            event.stopPropagation();
                            if (isGameOver) return;
                            markToolbarActiveIdx = markToolbarActiveIdx === idx ? null : idx;
                            renderChests();
                        });
                        else editButton.disabled = true;
                        actionWrap.appendChild(editButton);
                    }
                    chestWrap.appendChild(actionWrap); chestWrap.style.gridColumnStart = String(layout.honeycomb ? layout.pos[idx][1] * 2 + 1 : layout.pos[idx][1] + 1);
                    chestWrap.style.gridColumnEnd = layout.honeycomb ? 'span 2' : 'span 1';
                    rowContainer.appendChild(chestWrap);
                }
                rowsWrapper.appendChild(rowContainer);
            }
            if (!isPreview && statementLinks.length) drawStatementLinks(rowsWrapper);
            if (!isPreview) {
                // 큰 상자 배치가 하단 HUD와 겹칠 때만 팔레트를 게임판 아래로 내립니다.
                // 판 크기와 상자 중앙정렬은 변경하지 않습니다.
                const stage = targetContainer.closest(".v2-board-stage");
                if (stage) {
                    stage.classList.remove("v2-palette-inline");
                    const palette = stage.querySelector("#game-tool-palette");
                    if (palette) {
                        const boardBounds = rowsWrapper.getBoundingClientRect();
                        const paletteBounds = palette.getBoundingClientRect();
                        const overlaps = boardBounds.left < paletteBounds.right - 6
                            && boardBounds.right > paletteBounds.left + 6
                            && boardBounds.top < paletteBounds.bottom - 6
                            && boardBounds.bottom > paletteBounds.top + 6;
                        stage.classList.toggle("v2-palette-inline", overlaps);
                    }
                }
                recentRevealIdx = null; // one visual burst only, not on subsequent renders
                refreshLinkColorPicker();
                updateMarkToolbar();
                updateClimbProgress();
            }
        }

        function drawStatementLinks(rowsWrapper) {
            const ns = "http://www.w3.org/2000/svg";
            const wrapper = rowsWrapper.getBoundingClientRect();
            const width = Math.max(rowsWrapper.scrollWidth, rowsWrapper.offsetWidth);
            const height = Math.max(rowsWrapper.scrollHeight, rowsWrapper.offsetHeight);
            const svg = document.createElementNS(ns, "svg");
            svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
            svg.setAttribute("role", "group");
            svg.setAttribute("aria-label", "발언에서 상자로 흰색 빛이 주기적으로 흐르는 연결선");
            svg.classList.add("v2-statement-links-layer");

            // 흰색 빛이 출발점에서 도착점까지 진행하므로 화살표는 사용하지 않습니다.

            statementLinks.forEach(([from, to, savedColor = "gold"]) => {
                const source = rowsWrapper.querySelector(`.v2-speech-card[data-statement-index="${from}"]`);
                const target = rowsWrapper.querySelector(`.v2-chest-sprite[data-chest-index="${to}"]`);
                if (!source || !target) return;
                const a = source.getBoundingClientRect();
                const b = target.getBoundingClientRect();
                const x1 = a.left + a.width / 2 - wrapper.left;
                const y1 = a.bottom - wrapper.top;
                const x2 = b.left + b.width / 2 - wrapper.left;
                const y2 = b.top - wrapper.top;
                // 대상이 위쪽에 있으면 곡선도 위로 진입하도록 제어점을 전환합니다.
                // 움직이는 펄스의 진행 방향은 SVG 경로의 시작(발언)→끝(상자)입니다.
                const verticalDelta = y2 - y1;
                const bend = Math.max(24, Math.abs(verticalDelta) * .45)
                    * (verticalDelta < 0 ? -1 : 1);
                const d = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
                const color = Object.hasOwn(LINK_COLORS, savedColor) ? savedColor : "gold";
                const isSelected = selectedLineLink?.[0] === from && selectedLineLink?.[1] === to;

                // Solid black outline underneath each colored connection (both normal and selected).
                const outline = document.createElementNS(ns, "path");
                outline.setAttribute("d", d);
                outline.setAttribute("fill", "none");
                outline.setAttribute("stroke", "#0b0a0e");
                outline.setAttribute("stroke-width", isSelected ? "7.5" : "5");
                outline.setAttribute("stroke-linecap", "round");
                outline.setAttribute("pointer-events", "none");
                outline.classList.add("v2-statement-link-outline");
                if (isSelected) outline.classList.add("is-selected");
                svg.appendChild(outline);

                const origin = document.createElementNS(ns, "circle");
                origin.setAttribute("cx", String(x1));
                origin.setAttribute("cy", String(y1));
                origin.setAttribute("r", isSelected ? "4.5" : "3.5");
                origin.setAttribute("fill", LINK_COLORS[color]);
                origin.setAttribute("stroke", "#24191d");
                origin.setAttribute("stroke-width", "1.5");
                origin.setAttribute("pointer-events", "none");
                svg.appendChild(origin);

                const line = document.createElementNS(ns, "path");
                line.setAttribute("d", d);
                line.setAttribute("fill", "none");
                line.setAttribute("stroke", LINK_COLORS[color]);
                line.setAttribute("stroke-width", isSelected ? "5.5" : "3");
                line.setAttribute("stroke-linecap", "round");
                line.style.color = LINK_COLORS[color];
                line.classList.add("v2-statement-link-visible");
                if (isSelected) line.classList.add("is-selected");
                svg.appendChild(line);

                // pathLength=100으로 경로 길이에 상관없이 빛이 발언→상자 방향으로 통과합니다.
                // 짧은 흰색 구간만 이동하고 다음 주기까지 쉬어 심박 신호 같은 리듬을 만듭니다.
                const pulse = document.createElementNS(ns, "path");
                pulse.setAttribute("d", d);
                pulse.setAttribute("pathLength", "100");
                pulse.setAttribute("fill", "none");
                pulse.setAttribute("stroke", "#fffdf4");
                pulse.setAttribute("stroke-width", isSelected ? "3.2" : "2.5");
                pulse.setAttribute("stroke-linecap", "round");
                pulse.setAttribute("stroke-dasharray", "5 120");
                pulse.setAttribute("stroke-dashoffset", "5");
                pulse.setAttribute("pointer-events", "none");
                pulse.classList.add("v2-statement-link-pulse");
                // 다수의 선이 동시에 번쩍이지 않도록 간단한 시간차만 적용합니다.
                pulse.style.animationDelay = `-${((from * 7 + to * 11) % 9 * 0.17).toFixed(2)}s`;
                if (isSelected) pulse.classList.add("is-selected");
                svg.appendChild(pulse);

                // 16px의 투명 클릭 영역은 별개이므로 선 위에 올리기 편합니다.
                const hit = document.createElementNS(ns, "path");
                hit.setAttribute("d", d);
                hit.setAttribute("fill", "none");
                hit.setAttribute("stroke", "transparent");
                hit.setAttribute("stroke-width", "16");
                hit.setAttribute("stroke-linecap", "round");
                hit.setAttribute("tabindex", "0");
                hit.setAttribute("role", "button");
                hit.setAttribute("aria-label", `발언 ${from + 1}에서 상자 ${to + 1}로 흰 빛이 흐르는 연결선 선택`);
                hit.classList.add("v2-statement-link-hit");
                hit.dataset.linkFrom = String(from);
                hit.dataset.linkTo = String(to);

                const selectLine = event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const index = statementLinks.findIndex(link => link[0] === from && link[1] === to);
                    if (index < 0) return;
                    let colorChanged = false;
                    if (linkRecolorPending) {
                        statementLinks[index][2] = selectedLinkColor;
                        linkRecolorPending = false;
                        refreshLinkColorPicker();
                        colorChanged = true;
                    }
                    const same = selectedLineLink?.[0] === from && selectedLineLink?.[1] === to;
                    selectedLineLink = !colorChanged && same ? null : [from, to];
                    selectedStatementIdx = null;
                    renderChests();
                    if (colorChanged && window.autoSaveToCloud) window.autoSaveToCloud();
                };
                hit.addEventListener("click", selectLine);
                hit.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") selectLine(event);
                });
                const setLineHover = isHovered => {
                    line.classList.toggle("is-hovered", isHovered);
                    outline.classList.toggle("is-hovered", isHovered);
                };
                hit.addEventListener("pointerenter", () => setLineHover(true));
                hit.addEventListener("pointerleave", () => setLineHover(false));
                hit.addEventListener("focus", () => setLineHover(true));
                hit.addEventListener("blur", () => setLineHover(false));
                svg.appendChild(hit);
            });
            rowsWrapper.appendChild(svg);
        }

        // DEBUG CHEST LAYOUT PREVIEW: remove this isolated block to roll back the feature.
        function renderDebugChestPreview(count) {
            const preview = document.getElementById('debug-layout-preview');
            const countLabel = document.getElementById('debug-chest-count');
            if (!preview || !countLabel) return;
            countLabel.textContent = count + '개';
            const mockChests = Array.from({ length: count }, (_, idx) => ({
                color: colors[idx % colors.length],
                role: idx === count - 1 ? 'M' : 'T',
                treasure: rawTreasures[idx % rawTreasures.length],
                isOpen: false, isSleeping: false,
                statement: idx === count - 1 ? '내 안에는 미믹이 있어.' : '진짜 보물 상자입니다.',
                originalStatement: '', mark: null, memo: []
            }));
            renderChests(preview, mockChests, true);
        }
        (function initDebugChestPreview() {
            const panel = document.getElementById('debug-layout-panel');
            const toggle = document.getElementById('debug-layout-toggle');
            const slider = document.getElementById('debug-chest-slider');
            if (panel && toggle && slider) toggle.addEventListener('click', () => {
                const opening = panel.classList.contains('hidden');
                panel.classList.toggle('hidden', !opening);
                toggle.textContent = opening ? '디버그 모드 닫기' : '디버그 모드 열기';
                if (opening) renderDebugChestPreview(Number(slider.value));
            });
            if (slider) slider.addEventListener('input', () => renderDebugChestPreview(Number(slider.value)));
            const floorInput = document.getElementById('debug-floor-number');
            const goFloor = document.getElementById('debug-go-floor');
            const clearFloor = document.getElementById('debug-clear-floor');
            if (goFloor && floorInput) goFloor.addEventListener('click', () => {
                const targetFloor = Math.max(1, Math.min(999, Math.floor(Number(floorInput.value) || 1)));
                currentFloor = targetFloor;
                if (currentFloor > maxFloor) maxFloor = currentFloor;
                localStorage.setItem('mimic2MaxFloor', maxFloor);
                restVisitedForCurrentFloor = currentFloor % 5 === 0;
                const restOverlay = document.getElementById('rest-area-overlay');
                if (restOverlay) restOverlay.classList.add('hidden');
                initFloor();
                setTimeout(() => { if (window.autoSaveToCloud) window.autoSaveToCloud(); }, 700);
            });
            if (clearFloor) clearFloor.addEventListener('click', () => {
                if (!chestsData.length) return;
                isGameOver = true;
                isFloorCleared = true;
                const bossReward = awardSegmentBossRewards();
                totalOpened = totalTrueChests;
                chestsData.forEach(chest => {
                    if (chest.isSleeping) chest.statement = chest.originalStatement;
                    chest.isSleeping = false;
                    if (chest.role === 'T') chest.isOpen = true;
                });
                statusMsg.innerText = bossReward
                    ? `[디버그] 층 클리어. ${bossReward} 보상을 획득했습니다.`
                    : '[디버그] 미믹을 제외한 모든 상자를 개방했습니다.';
                statusMsg.className = 'text-center text-lg font-bold mb-4 h-7 text-emerald-700 drop-shadow-sm';
                btnNextFloor.classList.remove('hidden');
                btnRestart.classList.add('hidden');
                renderChests();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
            });
        })();
        
        // --- User Interaction ---
        // SVG 연결선이 발언을 덮어도, 포인터 아래의 실제 발언문구를 찾습니다.
        function findStatementAtPointer(event) {
            const elements = document.elementsFromPoint
                ? document.elementsFromPoint(event.clientX, event.clientY)
                : [event.target];
            for (const element of elements) {
                if (!(element instanceof Element)) continue;
                const bubble = element.closest(".v2-speech-card[data-statement-index]");
                if (!bubble || !container.contains(bubble)) continue;
                const idx = Number(bubble.dataset.statementIndex);
                if (Number.isInteger(idx) && idx >= 0 && idx < chestsData.length) return idx;
            }
            return null;
        }

        function removeOutgoingStatementLinks(idx) {
            const previousCount = statementLinks.length;
            statementLinks = statementLinks.filter(([from]) => from !== idx);
            const removed = previousCount - statementLinks.length;
            const hadSelection = selectedStatementIdx === idx;
            const hadSelectedLine = selectedLineLink?.[0] === idx;
            if (hadSelection) selectedStatementIdx = null;
            if (hadSelectedLine) selectedLineLink = null;
            if (!removed && !hadSelection && !hadSelectedLine) return;
            if (removed > 0) {
                statusMsg.innerText = `발언 ${idx + 1}의 연결선 ${removed}개를 삭제했습니다.`;
                statusMsg.className = "text-center text-sm font-bold mb-3 h-6 text-amber-300 drop-shadow-sm";
            }
            renderChests();
            if (removed > 0 && window.autoSaveToCloud) window.autoSaveToCloud();
        }

        const gameMapArea = container.parentElement || container;
        const contextPalette = document.getElementById("statement-context-palette");
        let contextTarget = null; // {kind:"statement"|"chest", idx}
        let lastPaletteRightClick = null;

        function closeStatementContextPalette() {
            if (!contextPalette) return;
            contextPalette.hidden = true;
            contextTarget = null;
        }

        function clearActiveStatementSelection() {
            if (selectedStatementIdx === null && selectedLineLink === null) return;
            selectedStatementIdx = null;
            selectedLineLink = null;
            renderChests();
        }

        // SVG 선과 겹치는 경우에도 눈에 보이는 발언/상자를 기준으로 대상 판별.
        function findContextTargetAtPointer(event) {
            // 호버 레이어 뒤에 숨어 있는 객체가 우클릭 대상이 되지 않도록
            // 실제 이벤트 대상이 말풍선/상자/선 중 하나면 우선 사용합니다.
            const direct = event.target instanceof Element ? event.target : null;
            if (direct && container.contains(direct)) {
                const directBubble = direct.closest(".v2-speech-card[data-statement-index]");
                if (directBubble) {
                    const idx = Number(directBubble.dataset.statementIndex);
                    if (Number.isInteger(idx) && idx >= 0 && idx < chestsData.length)
                        return {kind:"statement", idx};
                }
                const directChest = direct.closest(".v2-chest-sprite[data-chest-index]");
                if (directChest) {
                    const idx = Number(directChest.dataset.chestIndex);
                    if (Number.isInteger(idx) && idx >= 0 && idx < chestsData.length)
                        return {kind:"chest", idx};
                }
                const directHit = direct.closest(".v2-statement-link-hit[data-link-from][data-link-to]");
                if (directHit) {
                    const from = Number(directHit.dataset.linkFrom);
                    const to = Number(directHit.dataset.linkTo);
                    if (Number.isInteger(from) && Number.isInteger(to)
                        && statementLinks.some(([a, b]) => a === from && b === to))
                        return {kind:"line", idx:from, to};
                }
            }
            const elements = document.elementsFromPoint
                ? document.elementsFromPoint(event.clientX, event.clientY)
                : [event.target];
            // DOM이 변경되어 원래 요소가 사라졌다면 포인터 아래 실제 요소를 찾습니다.
            for (const element of elements) {
                if (!(element instanceof Element) || !container.contains(element)) continue;
                const lineHit = element.closest(".v2-statement-link-hit[data-link-from][data-link-to]");
                if (!lineHit) continue;
                const from = Number(lineHit.dataset.linkFrom);
                const to = Number(lineHit.dataset.linkTo);
                if (Number.isInteger(from) && Number.isInteger(to)
                    && statementLinks.some(link => link[0] === from && link[1] === to)) {
                    return {kind:"line", idx:from, to};
                }
            }
            for (const element of elements) {
                if (!(element instanceof Element) || !container.contains(element)) continue;
                const bubble = element.closest(".v2-speech-card[data-statement-index]");
                if (bubble) {
                    const idx = Number(bubble.dataset.statementIndex);
                    if (Number.isInteger(idx) && idx >= 0 && idx < chestsData.length) {
                        return {kind:"statement", idx};
                    }
                }
                const chest = element.closest(".v2-chest-sprite[data-chest-index]");
                if (chest) {
                    const idx = Number(chest.dataset.chestIndex);
                    if (Number.isInteger(idx) && idx >= 0 && idx < chestsData.length) {
                        return {kind:"chest", idx};
                    }
                }
            }
            return null;
        }

        function updateStatementContextPalette() {
            if (!contextPalette || !contextTarget) return;
            const {kind, idx} = contextTarget;
            const chest = chestsData[idx];
            if (!chest) { closeStatementContextPalette(); return; }
            const coordinate = getCoord(idx, currentGridLayout);
            document.getElementById("context-chest-name").textContent = kind === "line"
                ? `${coordinate.name} → ${getCoord(contextTarget.to, currentGridLayout).name} 연결선`
                : `${coordinate.name} · ${kind === "statement" ? "발언 연결선" : "상자 마킹·메모"}`;

            contextPalette.querySelectorAll("[data-context-mode]").forEach(group => {
                group.hidden = group.dataset.contextMode !== kind;
            });
            contextPalette.setAttribute("aria-label", kind === "line"
                ? "선택한 연결선 색상 즉시 변경·개별 지우개"
                : kind === "statement" ? "발언 연결선 색상·지우개" : "상자 마킹·메모·지우개");

            contextPalette.querySelectorAll("[data-context-color]").forEach(button => {
                // 발언용 색상은 새 연결선의 색상입니다.
                // 이미 선택된 선의 색상과는 분리해 우클릭 메뉴가 오작동하지 않도록 합니다.
                button.setAttribute("aria-pressed", String(selectedLinkColor === button.dataset.contextColor));
                button.disabled = isGameOver;
            });

            const targetLine = kind === "line"
                ? statementLinks.find(link => link[0] === idx && link[1] === contextTarget.to)
                : null;
            contextPalette.querySelectorAll("[data-context-line-color]").forEach(button => {
                button.setAttribute("aria-pressed", String(!!targetLine && targetLine[2] === button.dataset.contextLineColor));
                button.disabled = !targetLine || isGameOver;
            });
            document.getElementById("context-clear-line").disabled = !targetLine;

            const canMark = !isGameOver && !chest.isOpen;
            contextPalette.querySelectorAll("[data-context-mark]").forEach(button => {
                button.disabled = !canMark;
                button.setAttribute("aria-pressed", String(canMark && chest.mark === button.dataset.contextMark));
            });
            contextPalette.querySelectorAll("[data-context-memo]").forEach(button => {
                button.disabled = !canMark;
                button.setAttribute("aria-pressed", String(canMark && Array.isArray(chest.memo)
                    && chest.memo.includes(Number(button.dataset.contextMemo))));
            });

            const matchingLinks = statementLinks.filter(([from]) => from === idx).length;
            const clearLinks = document.getElementById("context-clear-links");
            clearLinks.disabled = matchingLinks === 0;
            clearLinks.textContent = `연결선 지우개 (${matchingLinks})`;
            document.getElementById("context-clear-marks").disabled =
                !canMark || (!chest.mark && (!Array.isArray(chest.memo) || chest.memo.length === 0));
        }

        function openStatementContextPalette(kind, idx, x, y, to = null) {
            if (!contextPalette || !chestsData[idx]) return;
            if (kind === "line") {
                if (!statementLinks.some(link => link[0] === idx && link[1] === to)) return;
                selectedLineLink = [idx, to];
                selectedStatementIdx = null;
                renderChests();
            }
            contextTarget = {kind, idx, to};
            if (kind === "chest") {
                markToolbarActiveIdx = idx;
                updateMarkToolbar();
            }
            updateStatementContextPalette();
            contextPalette.hidden = false;
            contextPalette.style.visibility = "hidden";
            const width = contextPalette.offsetWidth;
            const height = contextPalette.offsetHeight;
            const margin = 8;
            // 보이는 화면 안에서 커서의 좌·우/위·아래 공간에 맞춰 메뉴를 배치합니다.
            // 화면이 좁아도 팔레트의 바깥 부분이 잘리지 않도록 위치를 보정합니다.
            const viewport = window.visualViewport;
            const viewLeft = viewport ? viewport.offsetLeft : 0;
            const viewTop = viewport ? viewport.offsetTop : 0;
            const viewRight = viewLeft + (viewport ? viewport.width : window.innerWidth);
            const viewBottom = viewTop + (viewport ? viewport.height : window.innerHeight);
            const roomRight = viewRight - x;
            const roomLeft = x - viewLeft;
            const preferredX = roomRight >= width + 12 + margin
                ? x + 12
                : roomLeft >= width + 12 + margin ? x - width - 12 : x - width / 2;
            const left = Math.max(viewLeft + margin,
                Math.min(preferredX, Math.max(viewLeft + margin, viewRight - width - margin)));
            const roomAbove = y - viewTop;
            const roomBelow = viewBottom - y;
            const preferredY = roomAbove >= height + 12 + margin || roomAbove > roomBelow
                ? y - height - 12 : y + 12;
            const top = Math.max(viewTop + margin,
                Math.min(preferredY, Math.max(viewTop + margin, viewBottom - height - margin)));
            contextPalette.style.left = Math.round(left) + "px";
            contextPalette.style.top = Math.round(top) + "px";
            contextPalette.style.visibility = "";
        }

        document.getElementById("context-palette-close").addEventListener("click", closeStatementContextPalette);

        // 발언 우클릭 색상은 항상 '새 연결 출발'만 담당합니다.
        // 기존 선의 개별 색 변경은 선 자체를 우클릭해야 합니다.
        contextPalette.querySelectorAll("[data-context-color]").forEach(button => {
            button.addEventListener("click", () => {
                if (!contextTarget || contextTarget.kind !== "statement" || isGameOver) return;
                const {idx} = contextTarget;
                const color = button.dataset.contextColor;
                if (!Object.hasOwn(LINK_COLORS, color)) return;
                selectedLinkColor = color;
                linkRecolorPending = false;
                selectedStatementIdx = idx;
                selectedLineLink = null;
                closeStatementContextPalette();
                renderChests();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
            });
        });
        document.getElementById("context-clear-links").addEventListener("click", () => {
            if (!contextTarget || contextTarget.kind !== "statement") return;
            removeOutgoingStatementLinks(contextTarget.idx);
            closeStatementContextPalette();
        });

        // 연결선 우클릭: 바로 그 선 하나를 재색칠하거나 삭제합니다.
        contextPalette.querySelectorAll("[data-context-line-color]").forEach(button => {
            button.addEventListener("click", () => {
                if (!contextTarget || contextTarget.kind !== "line" || isGameOver) return;
                const {idx:from, to} = contextTarget;
                const link = statementLinks.find(item => item[0] === from && item[1] === to);
                const color = button.dataset.contextLineColor;
                if (!link || !Object.hasOwn(LINK_COLORS, color)) return;
                link[2] = color;
                selectedLinkColor = color;
                selectedLineLink = [from, to];
                selectedStatementIdx = null;
                linkRecolorPending = false;
                refreshLinkColorPicker();
                closeStatementContextPalette();
                renderChests();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
            });
        });
        document.getElementById("context-clear-line").addEventListener("click", () => {
            if (!contextTarget || contextTarget.kind !== "line") return;
            const {idx:from, to} = contextTarget;
            const oldCount = statementLinks.length;
            statementLinks = statementLinks.filter(link => !(link[0] === from && link[1] === to));
            if (statementLinks.length === oldCount) return;
            if (selectedLineLink?.[0] === from && selectedLineLink?.[1] === to) selectedLineLink = null;
            closeStatementContextPalette();
            renderChests();
            if (window.autoSaveToCloud) window.autoSaveToCloud();
        });

        // 상자 우클릭: 선택한 상자만 마킹/메모 수정 및 지우기.
        contextPalette.querySelectorAll("[data-context-mark]").forEach(button => {
            button.addEventListener("click", () => {
                if (!contextTarget || contextTarget.kind !== "chest" || button.disabled) return;
                toggleMark(contextTarget.idx, button.dataset.contextMark);
                updateStatementContextPalette();
            });
        });
        contextPalette.querySelectorAll("[data-context-memo]").forEach(button => {
            button.addEventListener("click", () => {
                if (!contextTarget || contextTarget.kind !== "chest" || button.disabled) return;
                toggleMemo(contextTarget.idx, Number(button.dataset.contextMemo));
                updateStatementContextPalette();
            });
        });
        document.getElementById("context-clear-marks").addEventListener("click", () => {
            if (!contextTarget || contextTarget.kind !== "chest") return;
            const chest = chestsData[contextTarget.idx];
            if (!chest || chest.isOpen || isGameOver) return;
            chest.mark = null;
            chest.memo = [];
            renderChests();
            updateStatementContextPalette();
            if (window.autoSaveToCloud) window.autoSaveToCloud();
        });

        // 마우스가 게임판에 있을 때만 기본 브라우저 우클릭 메뉴를 차단합니다.
        // 다른 곳을 클릭하면 출발점/선택선 강조를 해제하지만, 도구 사용 중에는 유지합니다.
        document.addEventListener("pointerdown", event => {
            if (event.button !== 0 && event.button !== 2) return;
            if (contextPalette.contains(event.target)) return;
            // 플로팅 도구 위 우클릭이 그 뒤의 말풍선/연결선을 선택하지 않게 합니다.
            if (event.target instanceof Element && event.target.closest("#game-tool-palette")) {
                closeStatementContextPalette();
                return;
            }
            const target = findContextTargetAtPointer(event);
            if (event.button === 2) {
                closeStatementContextPalette();
                if (target) {
                    event.preventDefault();
                    event.stopPropagation();
                    lastPaletteRightClick = {x:event.clientX, y:event.clientY, at:Date.now()};
                    openStatementContextPalette(target.kind, target.idx, event.clientX, event.clientY, target.to);
                } else {
                    lastPaletteRightClick = null;
                    clearActiveStatementSelection();
                }
                return;
            }

            if (!target && !event.target.closest(".v2-statement-link-hit")) {
                closeStatementContextPalette();
                clearActiveStatementSelection();
            } else if (target || event.target.closest(".v2-statement-link-hit")) {
                closeStatementContextPalette();
            }
        }, true);

        document.addEventListener("contextmenu", event => {
            const rect = gameMapArea.getBoundingClientRect();
            const insideRect = event.clientX >= rect.left && event.clientX <= rect.right
                && event.clientY >= rect.top && event.clientY <= rect.bottom;
            if (!gameMapArea.contains(event.target) && !insideRect && !contextPalette.contains(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            if (contextPalette.contains(event.target)) return;
            if (event.target instanceof Element && event.target.closest("#game-tool-palette")) {
                closeStatementContextPalette();
                lastPaletteRightClick = null;
                return;
            }

            const last = lastPaletteRightClick;
            const alreadyHandled = last && Date.now() - last.at < 1500
                && Math.abs(last.x - event.clientX) < 12
                && Math.abs(last.y - event.clientY) < 12;
            lastPaletteRightClick = null;
            if (alreadyHandled) return;
            const target = findContextTargetAtPointer(event);
            if (target) openStatementContextPalette(target.kind, target.idx, event.clientX, event.clientY, target.to);
            else {
                closeStatementContextPalette();
                clearActiveStatementSelection();
            }
        }, true);

        window.addEventListener("resize", closeStatementContextPalette);
        window.addEventListener("scroll", event => {
            if (!contextPalette.contains(event.target)) closeStatementContextPalette();
        }, true);

        function toggleStatementLink(from, to) {
            if (isGameOver || from === to || !chestsData[from] || !chestsData[to]) return;
            const existing = statementLinks.findIndex(link => link[0] === from && link[1] === to);
            let message;
            let changed = false;
            if (existing >= 0) {
                if (statementLinks[existing][2] !== selectedLinkColor) {
                    statementLinks[existing][2] = selectedLinkColor;
                    message = "기존 연결선의 색상을 변경했습니다.";
                    changed = true;
                } else {
                    // 같은 연결을 다시 누르는 경우에는 삭제 대신 선택만 수행합니다.
                    message = "기존 연결선을 선택했습니다. Delete 또는 우클릭 지우개로 삭제할 수 있습니다.";
                }
            } else {
                statementLinks.push([from, to, selectedLinkColor]);
                message = "선택한 색상으로 발언과 상자를 연결했습니다.";
                changed = true;
            }
            selectedStatementIdx = null;
            selectedLineLink = [from, to];
            linkRecolorPending = false;
            renderChests();
            statusMsg.innerText = message;
            statusMsg.className = "text-center text-sm font-bold mb-3 h-6 text-amber-300 drop-shadow-sm";
            if (changed && window.autoSaveToCloud) window.autoSaveToCloud();
        }

        function toggleMark(idx, markType) { if (isGameOver || chestsData[idx].isOpen) return; chestsData[idx].mark = (chestsData[idx].mark === markType) ? null : markType; renderChests(); if(window.autoSaveToCloud) window.autoSaveToCloud(); }
        function toggleMemo(idx, num) {
            if (isGameOver || chestsData[idx].isOpen) return;
            const memoArr = chestsData[idx].memo; const numIdx = memoArr.indexOf(num);
            if (numIdx > -1) memoArr.splice(numIdx, 1); else memoArr.push(num); renderChests(); if(window.autoSaveToCloud) window.autoSaveToCloud();
        }

        function openChest(idx) {
            if (isGameOver || chestsData[idx].isOpen) return;
            const chest = chestsData[idx];
            const wasSleeping = chest.isSleeping;
            if (wasSleeping) {
                chest.isSleeping = false;
                chest.isOpen = true;
                if (chest.role === 'M') {
                    gameOver(false);
                    statusMsg.innerText = '잠자는 미믹을 열었습니다! 즉시 게임 오버입니다.';
                    statusMsg.className = 'text-center text-lg font-bold mb-4 h-7 text-red-600 drop-shadow-sm scale-105';
                } else {
                    chest.statement = chest.originalStatement;
                    if (!chest.isTricksterMimickingMimic) totalOpened++;
                    if (totalOpened === totalTrueChests) {
                        gameOver(true);
                    } else {
                        statusMsg.innerText = '잠자는 진짜 상자를 열었습니다. 발언이 공개되었습니다.';
                        statusMsg.className = 'text-center text-lg font-bold mb-4 h-7 text-emerald-600 drop-shadow-sm';
                    }
                }
                if (!isGameOver) recentRevealIdx = idx;
                renderChests();
                if (window.autoSaveToCloud) window.autoSaveToCloud();
                return;
            }
            if (chest.mark === 'X') { statusMsg.innerText = '미믹으로 표시한 상자입니다! 해제 후 여세요.'; return; }
            chest.isOpen = true;
            if (chest.role === 'M') { gameOver(false); }
            else {
                if (!chest.isTricksterMimickingMimic) totalOpened++;
                if (totalOpened === totalTrueChests) { gameOver(true); }
                else {
                    statusMsg.innerText = isRandomMode ? '진짜 상자를 찾았습니다! 계속 추리하세요.' : `진짜를 찾았습니다! 남은 진짜 보물: ${totalTrueChests - totalOpened}개`;
                    statusMsg.className = 'text-center text-lg font-bold mb-4 h-7 text-emerald-600 drop-shadow-sm';
                }
            }
            if (!isGameOver) recentRevealIdx = idx;
            renderChests(); if (window.autoSaveToCloud) window.autoSaveToCloud();
        }

        function awardSegmentBossRewards() {
            // 보스 클리어는 상자/미믹 기본 개수에 영구 보너스를 부여하지 않습니다.
            return null;
        }

        function triggerScreenEffect(type) {
            const overlay = document.createElement('div');
            overlay.className = `screen-effect-overlay ${type}`;
            const palette = type === 'clear'
                ? ['#86efac', '#ffffff', '#4ade80', '#bbf7d0']
                : ['#fecaca', '#ef4444', '#991b1b', '#ffffff'];
            for (let i = 0; i < 38; i++) {
                const particle = document.createElement('span');
                particle.className = 'screen-effect-particle';
                const angle = Math.random() * Math.PI * 2;
                const distance = 70 + Math.random() * 230;
                particle.style.setProperty('--x', (8 + Math.random() * 84) + 'vw');
                particle.style.setProperty('--y', (8 + Math.random() * 84) + 'vh');
                particle.style.setProperty('--dx', (Math.cos(angle) * distance) + 'px');
                particle.style.setProperty('--dy', (Math.sin(angle) * distance) + 'px');
                particle.style.setProperty('--size', (3 + Math.random() * 7) + 'px');
                particle.style.setProperty('--particle-color', palette[Math.floor(Math.random() * palette.length)]);
                particle.style.animationDelay = (Math.random() * 0.05) + 's';
                overlay.appendChild(particle);
            }
            document.body.appendChild(overlay);
            overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
        }

        // v0.07i: Visible victory/defeat controls, without changing any floor logic.
        const resultOverlay = document.getElementById("floor-result-overlay");
        function closeFloorResult() {
            if (resultOverlay) resultOverlay.hidden = true;
        }
        function showFloorResult(isWin) {
            if (!resultOverlay) return;
            resultOverlay.querySelector(".v2-floor-result-card").dataset.result = isWin ? "clear" : "mimic";
            document.getElementById("floor-result-eyebrow").textContent =
                isWin ? "FLOOR CLEARED" : "EXPEDITION FAILED";
            document.getElementById("floor-result-title").textContent =
                isWin ? `${currentFloor}F · 층 클리어` : `${currentFloor}F · 탐험 실패`;
            document.getElementById("floor-result-description").textContent = isWin
                ? "진짜 보물을 모두 찾았습니다. 다음 층으로 이동할 수 있습니다."
                : "미믹에게 발각됐습니다. 공개된 정답을 확인하거나 처음부터 도전하세요.";
            document.getElementById("floor-result-primary").textContent = isWin ? "다음 층으로" : "다시 도전";
            resultOverlay.hidden = false;
            document.getElementById("floor-result-primary").focus({preventScroll:true});
        }
        document.getElementById("floor-result-primary").addEventListener("click", () => {
            closeFloorResult();
            if (isFloorCleared) btnNextFloor.click();
            else btnRestart.click();
        });
        document.getElementById("floor-result-review").addEventListener("click", closeFloorResult);

        function gameOver(isWin) {
            isGameOver = true;
            if (isWin) {
                triggerScreenEffect('clear');
                isFloorCleared = true;
                const bossReward = awardSegmentBossRewards();
                statusMsg.innerText = bossReward
                    ? `층 클리어! ${bossReward} 보상을 획득했습니다.`
                    : "층 클리어! 모든 진짜 보물을 찾아냈습니다! 🎉";
                statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-indigo-600 drop-shadow-sm scale-105 transition-transform";
                btnNextFloor.classList.remove('hidden'); btnRestart.classList.add('hidden');
            } else {
                triggerScreenEffect('mimic');
                isFloorCleared = false;
                statusMsg.innerText = "미믹에게 먹혔습니다! 게임 오버... ☠️";
                statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-red-600 drop-shadow-sm scale-105 transition-transform animate-pulse";
                btnRestart.classList.remove('hidden'); btnNextFloor.classList.add('hidden');
            }
            
            // 승패에 관계없이 모든 상자의 상태를 열림으로 강제 변환하여 정답 공개
            chestsData.forEach(c => {
                if (c.isSleeping) c.statement = c.originalStatement; // 잠든 상자의 원래 힌트를 복구
                c.isSleeping = false;
                c.isOpen = true;
            });
            renderChests();
            showFloorResult(isWin);
            if(window.autoSaveToCloud) window.autoSaveToCloud();
        }

        // Action Buttons
        btnNextFloor.addEventListener('click', () => {
            if (isFloorCleared) {
                currentFloor++;
                if (currentFloor > maxFloor) { maxFloor = currentFloor; localStorage.setItem('mimic2MaxFloor', maxFloor); }
                initFloor();
            }
        });
        btnRestart.addEventListener('click', () => startClimb());
        
        btnOpenO.addEventListener('click', () => {
            if (isGameOver) return;
            let oChests = []; chestsData.forEach((c, idx) => { if (c.mark === 'O' && !c.isOpen) oChests.push(idx); });
            if (oChests.length === 0) { statusMsg.innerText = "⭕(진짜)로 마킹된 상자가 없습니다!"; return; }
            for (let idx of oChests) { if (isGameOver) break; openChest(idx); }
        });
        btnClearMarks.addEventListener('click', () => {
            // X 초기화: O/X/? 표시, 숫자 메모, 모든 연결선을 함께 지웁니다.
            // 게임 종료 후에도 추리용 표시만 지울 수 있습니다.
            chestsData.forEach(c => { c.mark = null; c.memo = []; });
            statementLinks = [];
            selectedStatementIdx = null;
            selectedLineLink = null;
            markToolbarActiveIdx = null;
            closeStatementContextPalette();
            linkRecolorPending = false;
            refreshLinkColorPicker();
            renderChests();
            if (!isGameOver) {
                statusMsg.innerText = "모든 마킹, 메모, 연결선을 초기화했습니다.";
            }
            if(window.autoSaveToCloud) window.autoSaveToCloud();
        });

        // Key bindings
        let lastCKeyTime = 0;
        window.addEventListener('keydown', (e) => {
            // 운영체제/브라우저 단축키와 글 작성 중 키 입력은 절대로 게임 조작으로 취급하지 않습니다.
            // 특히 Ctrl+X가 전체 추리 표시 초기화로 이어지지 않게 합니다.
            const focused = e.target instanceof Element ? e.target : document.activeElement;
            if (e.isComposing || e.key === 'Process' || e.ctrlKey || e.metaKey || e.altKey) return;
            if (focused && (
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)
                || focused.isContentEditable
                || focused.closest('[role="textbox"]')
            )) return;
            const pressedKey = e.key.toLowerCase();

            if (resultOverlay && !resultOverlay.hidden) {
                if (pressedKey === 'escape') {
                    e.preventDefault();
                    closeFloorResult();
                }
                return; // No gameplay hotkeys while result controls are open.
            }

            if (pressedKey === 'escape' && contextPalette && !contextPalette.hidden) {
                e.preventDefault();
                closeStatementContextPalette();
                return;
            }

            // 우클릭 팔레트가 열려 있으면 전역 X(모두 초기화), C, Z, R 등은 실행하지 않습니다.
            // 상자 팔레트에서는 Q/W/E와 1~5만 그 상자에 직접 적용합니다.
            if (contextPalette && !contextPalette.hidden) {
                if (!e.repeat && contextTarget?.kind === 'chest' && !isGameOver) {
                    const idx = contextTarget.idx;
                    const chest = chestsData[idx];
                    if (chest && !chest.isOpen) {
                        const markKeys = { q: 'O', w: 'X', e: '?' };
                        if (Object.hasOwn(markKeys, pressedKey)) {
                            e.preventDefault();
                            toggleMark(idx, markKeys[pressedKey]);
                            updateStatementContextPalette();
                            return;
                        }
                        if (['1','2','3','4','5'].includes(pressedKey)) {
                            e.preventDefault();
                            toggleMemo(idx, Number(pressedKey));
                            updateStatementContextPalette();
                            return;
                        }
                    }
                }
                return;
            }
            if (pressedKey === 'escape' && linkRecolorPending) {
                e.preventDefault();
                linkRecolorPending = false;
                refreshLinkColorPicker();
                return;
            }
            if (pressedKey === 'escape' && (selectedStatementIdx !== null || selectedLineLink !== null)) {
                e.preventDefault();
                clearActiveStatementSelection();
                return;
            }

            // 선택된 연결선 하나만 Delete/Backspace로 지웁니다. 전체 초기화 X는 그대로 유지.
            if ((pressedKey === 'delete' || pressedKey === 'backspace')
                && selectedLineLink && (!contextPalette || contextPalette.hidden)) {
                e.preventDefault();
                const [from, to] = selectedLineLink;
                const oldCount = statementLinks.length;
                statementLinks = statementLinks.filter(link => !(link[0] === from && link[1] === to));
                selectedLineLink = null;
                selectedStatementIdx = null;
                renderChests();
                if (oldCount !== statementLinks.length) {
                    statusMsg.innerText = "선택한 연결선 하나를 삭제했습니다.";
                    statusMsg.className = "text-center text-sm font-bold mb-3 h-6 text-amber-300 drop-shadow-sm";
                    if (window.autoSaveToCloud) window.autoSaveToCloud();
                }
                return;
            }

            if (pressedKey === 'r') {
                if (e.repeat) return;
                e.preventDefault(); e.stopPropagation();
                if (isGameOver) {
                    if (isFloorCleared) btnNextFloor.click(); else btnRestart.click();
                }
                return;
            }
            if (pressedKey === 'z') { e.preventDefault(); if (!e.repeat) btnOpenO.click(); return; }
            if (pressedKey === 'x') { e.preventDefault(); if (!e.repeat) btnClearMarks.click(); return; }
            
            if (pressedKey === 'c') {
                e.preventDefault(); if (e.repeat) return;
                const now = Date.now();
                if (now - lastCKeyTime <= 400) {
                    lastCKeyTime = 0;
                    if (isGameOver) return;
                    let targets = []; chestsData.forEach((c, i) => { if (!c.isOpen && c.mark !== 'X') targets.push(i); });
                    if (targets.length === 0) { statusMsg.innerText = "열 수 있는 상자가 없습니다."; return; }
                    for (const idx of targets) { if (isGameOver) break; openChest(idx); }
                } else {
                    lastCKeyTime = now;
                    statusMsg.innerText = "X 표시 상자를 제외하고 열려면 C를 한 번 더 누르세요.";
                    statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-amber-600 drop-shadow-sm";
                }
                return;
            }

            if (!e.repeat && hoveredChestIdx !== null && !isGameOver && !chestsData[hoveredChestIdx].isOpen) {
                if (pressedKey === 'q') { e.preventDefault(); toggleMark(hoveredChestIdx, 'O'); }
                else if (pressedKey === 'w') { e.preventDefault(); toggleMark(hoveredChestIdx, 'X'); }
                else if (pressedKey === 'e') { e.preventDefault(); toggleMark(hoveredChestIdx, '?'); }
                else if (['1','2','3','4','5'].includes(e.key)) { e.preventDefault(); toggleMemo(hoveredChestIdx, parseInt(e.key)); }
            }
        });

        window.onload = () => { if(window.initialSlotLoad) window.initialSlotLoad(); else startClimb(); };
