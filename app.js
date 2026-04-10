import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const { React, motion, AnimatePresence } = window.__TRS__;
const { useEffect, useMemo, useRef, useState } = React;

const STORAGE_KEY = "teacher-race-system-zones-v1";
const ZONE_STORAGE_KEY = "teacher-race-zones-v1";
const CLOUD_CONFIG_KEY = "teacher-race-cloud-config-v1";
const DEFAULT_ROOM_ID = "main";
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyChxWXds0BtVtgVW5udWIi9Nmr0uyFTUWE",
  authDomain: "teacher-race-system.firebaseapp.com",
  projectId: "teacher-race-system",
  storageBucket: "teacher-race-system.firebasestorage.app",
  messagingSenderId: "655026908184",
  appId: "1:655026908184:web:72cc703ad9a2586eb9676d",
  measurementId: "G-NE26FCWD5R",
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(v) {
  return v.trim().replace(/\s+/g, " ");
}

function clampScore(score) {
  return Math.max(0, score);
}

function getZone(score, thresholds) {
  if (score >= thresholds.greenMin) return "green";
  if (score >= thresholds.yellowMin) return "yellow";
  return "red";
}

function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export function App() {
  const [participants, setParticipants] = usePersistentState(STORAGE_KEY, []);
  const [thresholds, setThresholds] = usePersistentState(ZONE_STORAGE_KEY, {
    yellowMin: 50,
    greenMin: 120,
  });
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState("");
  const [scorePops, setScorePops] = useState([]);
  const [importInfo, setImportInfo] = useState("");
  const [roomId, setRoomId] = usePersistentState("teacher-race-room-id-v1", DEFAULT_ROOM_ID);
  const [cloudConfigText, setCloudConfigText] = usePersistentState(
    CLOUD_CONFIG_KEY,
    JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2)
  );
  const [cloudEnabled, setCloudEnabled] = usePersistentState("teacher-race-cloud-enabled-v1", false);
  const [cloudStatus, setCloudStatus] = useState("Локальный режим");
  const dbRef = useRef(null);
  const suppressCloudWriteRef = useRef(false);

  const sorted = useMemo(
    () => [...participants].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    [participants]
  );

  const zoneGroups = useMemo(() => {
    const groups = { green: [], yellow: [], red: [] };
    sorted.forEach((p) => groups[getZone(p.score, thresholds)].push(p));
    return groups;
  }, [sorted, thresholds]);

  useEffect(() => {
    if (!cloudEnabled) {
      setCloudStatus("Локальный режим");
      return undefined;
    }
    try {
      const parsedConfig = JSON.parse(cloudConfigText || "{}");
      if (!parsedConfig.projectId || !parsedConfig.apiKey || !parsedConfig.appId) {
        setCloudStatus("Ошибка: вставь корректный firebaseConfig");
        return undefined;
      }
      const app = initializeApp(parsedConfig, `teacher-race-${parsedConfig.projectId}`);
      const db = getFirestore(app);
      dbRef.current = db;
      setCloudStatus(`Cloud sync: подключено (room: ${roomId})`);
      const ref = doc(db, "teacherRaceRooms", roomId);
      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.data();
        if (!data) return;
        suppressCloudWriteRef.current = true;
        if (Array.isArray(data.participants)) setParticipants(data.participants);
        if (data.thresholds) setThresholds(data.thresholds);
        suppressCloudWriteRef.current = false;
      });
      return () => unsub();
    } catch {
      setCloudStatus("Ошибка подключения Firebase");
      return undefined;
    }
  }, [cloudEnabled, cloudConfigText, roomId]);

  useEffect(() => {
    if (!cloudEnabled || !dbRef.current || suppressCloudWriteRef.current) return;
    const ref = doc(dbRef.current, "teacherRaceRooms", roomId);
    setDoc(
      ref,
      {
        participants,
        thresholds,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {
      setCloudStatus("Ошибка записи в Firestore");
    });
  }, [participants, thresholds, cloudEnabled, roomId]);

  function addParticipant() {
    const name = normalizeName(nameInput);
    if (!name) return setError("Введите имя преподавателя.");
    if (participants.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return setError("Такое имя уже есть.");
    }
    setParticipants((prev) => [...prev, { id: uid(), name, score: 0, warnings: 0 }]);
    setNameInput("");
    setError("");
  }

  function removeParticipant(id) {
    const target = participants.find((p) => p.id === id);
    if (!target) return;
    if (!window.confirm(`Удалить ${target.name}?`)) return;
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  }

  function updateScore(id, delta) {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, score: clampScore(p.score + delta) } : p))
    );
    const pid = uid();
    setScorePops((prev) => [...prev, { id: pid, targetId: id, text: `${delta > 0 ? "+" : ""}${delta}` }]);
    setTimeout(() => setScorePops((prev) => prev.filter((x) => x.id !== pid)), 650);
  }

  function updateThreshold(key, rawValue) {
    const value = Math.max(0, Number(rawValue) || 0);
    setThresholds((prev) => {
      let next = { ...prev, [key]: value };
      if (next.greenMin < next.yellowMin) {
        if (key === "greenMin") next.yellowMin = next.greenMin;
        else next.greenMin = next.yellowMin;
      }
      return next;
    });
  }

  function handleEnableCloudSync() {
    try {
      JSON.parse(cloudConfigText || "{}");
      setCloudEnabled(true);
    } catch {
      setCloudStatus("JSON в firebaseConfig невалидный");
    }
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      participants,
      thresholds,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `teacher-race-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importDataFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.participants) || !parsed.thresholds) {
        setImportInfo("Неверный формат файла.");
        return;
      }
      const nextParticipants = parsed.participants
        .filter((p) => p && typeof p.name === "string")
        .map((p) => ({
          id: typeof p.id === "string" ? p.id : uid(),
          name: normalizeName(p.name),
          score: clampScore(Number(p.score) || 0),
          warnings: Number(p.warnings) || 0,
        }));

      const nextThresholds = {
        yellowMin: Math.max(0, Number(parsed.thresholds.yellowMin) || 0),
        greenMin: Math.max(0, Number(parsed.thresholds.greenMin) || 0),
      };
      if (nextThresholds.greenMin < nextThresholds.yellowMin) {
        nextThresholds.greenMin = nextThresholds.yellowMin;
      }

      setParticipants(nextParticipants);
      setThresholds(nextThresholds);
      setImportInfo(`Импортировано: ${nextParticipants.length} участников.`);
      setError("");
    } catch {
      setImportInfo("Ошибка импорта. Проверь файл JSON.");
    }
  }

  return React.createElement(
    "div",
    { className: "app" },
    React.createElement("div", { className: "bg-ambient", "aria-hidden": true }),
    React.createElement(
      "div",
      { className: "title-wrap" },
      React.createElement("h1", { className: "title" }, "Teacher Race System"),
      React.createElement("p", { className: "subtitle" }, "Зоны производительности с настраиваемыми лимитами.")
    ),
    React.createElement(
      "section",
      { className: "control-panel glass" },
      React.createElement(
        "div",
        { className: "input-row" },
        React.createElement("input", {
          className: "input",
          value: nameInput,
          placeholder: "Добавить преподавателя...",
          onChange: (e) => setNameInput(e.target.value),
          onKeyDown: (e) => e.key === "Enter" && addParticipant(),
        }),
        React.createElement("button", { className: "btn btn-primary", onClick: addParticipant }, "Добавить")
      ),
      error && React.createElement("div", { className: "error-text" }, error)
    ),
    React.createElement(
      "section",
      { className: "zone-settings glass" },
      React.createElement("h3", { className: "panel-title" }, "Настройка зон"),
      React.createElement(
        "div",
        { className: "zone-inputs" },
        React.createElement(
          "label",
          { className: "zone-input" },
          React.createElement("span", null, "Желтая зона от"),
          React.createElement("input", {
            className: "input",
            type: "number",
            min: 0,
            value: thresholds.yellowMin,
            onChange: (e) => updateThreshold("yellowMin", e.target.value),
          })
        ),
        React.createElement(
          "label",
          { className: "zone-input" },
          React.createElement("span", null, "Зеленая зона от"),
          React.createElement("input", {
            className: "input",
            type: "number",
            min: 0,
            value: thresholds.greenMin,
            onChange: (e) => updateThreshold("greenMin", e.target.value),
          })
        )
      ),
      React.createElement(
        "p",
        { className: "zone-help" },
        `Красная: < ${thresholds.yellowMin} | Желтая: ${thresholds.yellowMin}–${thresholds.greenMin - 1} | Зеленая: >= ${thresholds.greenMin}`
      ),
      React.createElement(
        "div",
        { className: "data-actions" },
        React.createElement(
          "button",
          { className: "btn btn-primary", onClick: exportData },
          "Export JSON"
        ),
        React.createElement("input", {
          className: "input file-input",
          type: "file",
          accept: "application/json,.json",
          onChange: (e) => {
            const file = e.target.files?.[0];
            if (file) importDataFromFile(file);
            e.target.value = "";
          },
        })
      )
    ),
    React.createElement(
      "section",
      { className: "zone-settings glass" },
      React.createElement("h3", { className: "panel-title" }, "Общая синхронизация через ссылку"),
      React.createElement(
        "label",
        { className: "zone-input" },
        React.createElement("span", null, "Room ID (одинаковый у всех)"),
        React.createElement("input", {
          className: "input",
          value: roomId,
          onChange: (e) => setRoomId(normalizeName(e.target.value || DEFAULT_ROOM_ID)),
          placeholder: "main",
        })
      ),
      React.createElement(
        "label",
        { className: "zone-input" },
        React.createElement("span", null, "firebaseConfig (JSON из Firebase)"),
        React.createElement("textarea", {
          className: "input config-area",
          value: cloudConfigText,
          onChange: (e) => setCloudConfigText(e.target.value),
          placeholder:
            '{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}',
        })
      ),
      React.createElement(
        "div",
        { className: "data-actions" },
        React.createElement(
          "button",
          { className: "btn btn-primary", onClick: handleEnableCloudSync },
          "Включить Cloud Sync"
        ),
        React.createElement(
          "button",
          { className: "btn btn-danger", onClick: () => setCloudEnabled(false) },
          "Выключить Cloud Sync"
        )
      ),
      React.createElement("p", { className: "zone-help" }, cloudStatus)
    ),
    importInfo && React.createElement("div", { className: "import-info" }, importInfo),
    React.createElement(
      "section",
      { className: "zones-grid" },
      React.createElement(ZoneColumn, {
        title: "🟢 Зеленая зона",
        zone: "green",
        participants: zoneGroups.green,
        scorePops,
        onScore: updateScore,
        onRemove: removeParticipant,
      }),
      React.createElement(ZoneColumn, {
        title: "🟡 Желтая зона",
        zone: "yellow",
        participants: zoneGroups.yellow,
        scorePops,
        onScore: updateScore,
        onRemove: removeParticipant,
      }),
      React.createElement(ZoneColumn, {
        title: "🔴 Красная зона",
        zone: "red",
        participants: zoneGroups.red,
        scorePops,
        onScore: updateScore,
        onRemove: removeParticipant,
      })
    )
  );
}

function ZoneColumn({ title, zone, participants, scorePops, onScore, onRemove }) {
  return React.createElement(
    "article",
    { className: `zone-column glass zone-${zone}` },
    React.createElement("h4", { className: "zone-title" }, title),
    participants.length === 0
      ? React.createElement("div", { className: "empty" }, "Пусто")
      : React.createElement(
          AnimatePresence,
          { initial: false },
          participants.map((p, idx) =>
            React.createElement(
              motion.div,
              {
                key: p.id,
                className: "participant-card",
                layout: true,
                initial: { opacity: 0, y: 8 },
                animate: { opacity: 1, y: 0 },
                exit: { opacity: 0, y: -8 },
              },
              React.createElement("div", { className: "name-row" }, `#${idx + 1} ${p.name}`),
              React.createElement("div", { className: "score-row" }, `${p.score} pts`),
              React.createElement(
                "div",
                { className: "actions" },
                React.createElement("button", { className: "btn btn-score btn-plus", onClick: () => onScore(p.id, 5) }, "+5"),
                React.createElement("button", { className: "btn btn-score btn-plus", onClick: () => onScore(p.id, 10) }, "+10"),
                React.createElement("button", { className: "btn btn-score btn-minus", onClick: () => onScore(p.id, -5) }, "-5"),
                React.createElement("button", { className: "btn btn-score btn-danger", onClick: () => onRemove(p.id) }, "Удалить")
              ),
              React.createElement(
                AnimatePresence,
                null,
                scorePops
                  .filter((x) => x.targetId === p.id)
                  .map((x) =>
                    React.createElement(
                      motion.span,
                      {
                        key: x.id,
                        className: `score-pop ${x.text.startsWith("-") ? "minus" : "plus"}`,
                        initial: { opacity: 0, y: 6 },
                        animate: { opacity: 1, y: -12 },
                        exit: { opacity: 0, y: -18 },
                      },
                      x.text
                    )
                  )
              )
            )
          )
        )
  );
}
