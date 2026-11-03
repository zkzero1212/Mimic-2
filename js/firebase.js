import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
      import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

      // 사용자의 Realtime Database 링크를 기반으로 한 설정
      // 주소 뒤에 -default-rtdb 가 붙지 않는 구형/특정 리전 주소 규칙을 반영했습니다.
      const firebaseConfig = {
        databaseURL: "https://hwanhyang-b1d4e.firebaseio.com",
        projectId: "hwanhyang-b1d4e"
      };

      // 무한 로딩 방지용 타임아웃 함수
      const withTimeout = (promise, ms) => {
          return Promise.race([
              promise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('서버 응답 지연 (데이터베이스 권한 규칙이나 링크를 다시 확인해주세요)')), ms))
          ]);
      };

      const app = initializeApp(firebaseConfig);
      const db = getDatabase(app);

      window.currentSaveSlot = 'Mimic1';
      const V2_SAVE_ROOT = 'mimic2Saves';

      window.selectSlot = async (slotId) => {
          window.currentSaveSlot = slotId;
          // Update UI buttons
          ['Mimic1', 'Mimic2', 'Mimic3'].forEach(id => {
              const btn = document.getElementById('slot-' + id);
              if (btn) {
                  if(id === slotId) {
                      btn.className = "flex-1 bg-indigo-600 text-white ring-2 ring-indigo-300 font-extrabold py-2 px-1 rounded text-[11px] shadow-sm transition-all";
                  } else {
                      btn.className = "flex-1 bg-white hover:bg-indigo-50 text-slate-600 border border-slate-300 font-extrabold py-2 px-1 rounded text-[11px] shadow-sm transition-all";
                  }
              }
          });

          const statusMsg = document.getElementById('status-message');
          statusMsg.innerText = `☁️ [${slotId}] 슬롯 불러오는 중...`;
          
          try {
              const dbRef = ref(db);
              const snapshot = await withTimeout(get(child(dbRef, `${V2_SAVE_ROOT}/${slotId}`)), 4000);
              if (snapshot.exists()) {
                  const data = snapshot.val();
                  window.loadGameState(data);
                  statusMsg.innerText = `☁️ [${slotId}] 슬롯에서 진행 상황을 불러왔습니다!`;
              } else {
                  statusMsg.innerText = `☁️ [${slotId}] 빈 슬롯입니다. 새 등반을 시작합니다.`;
                  statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-indigo-700 drop-shadow-sm";
                  window.startClimb(); // Reset game for new slot
              }
          } catch(e) {
               statusMsg.innerText = `불러오기 실패: ${e.message}`;
               statusMsg.className = "text-center text-lg font-bold mb-4 h-7 text-red-600 drop-shadow-sm";
          }
      };

      window.autoSaveToCloud = () => {
          if (!window.currentSaveSlot) return;
          const saveData = window.getGameState();
          saveData.timestamp = new Date().toISOString();
          
          set(ref(db, V2_SAVE_ROOT + '/' + window.currentSaveSlot), saveData).then(() => {
              const saveIndicator = document.getElementById('save-indicator');
              if(saveIndicator) {
                  saveIndicator.innerText = "💾 자동 저장됨";
                  saveIndicator.classList.remove('opacity-0');
                  setTimeout(() => saveIndicator.classList.add('opacity-0'), 2000);
              }
          }).catch(e => console.error("Auto-save failed", e));
      };
      
      // 페이지 로드 시 초기 슬롯 로드 (startClimb 대신 window.onload에서 호출될 수 있도록 대기)
      window.initialSlotLoad = () => {
          window.selectSlot('Mimic1');
      };
