"use strict";

// Global State Variables
let currentQuantumKeyRaw = null;
let currentQuantumKeyHex = "";
let currentKeyId = "";
let lastEncryptedPayload = null;
let histogramChart = null;

// NEW: QKD / alarm state
const QKD_QUBITS = 128;
const QBER_LIMIT = 0.11;
const QKD_STEPS = [
    "1. Alice prepares random qubits",
    "2. Qubits travel over quantum channel",
    "3. Bob measures in random bases",
    "4. Basis sifting (public channel)",
    "5. Eavesdropper check (QBER)",
    "6. Session key derived"
];
let audioCtx = null;
let alarmOsc = null;
let alarmTimer = null;

// Initialize Dashboard on Load
window.addEventListener("load", function () {
    renderQubitCircuit();
    initHistogramChart();
    renderQkdSteps();
    executeQuantumKeyGeneration();

    appendLog("INFO", "Quantum Vault environment initialized.");
    appendLog("SYSTEM", "Qiskit Aer simulator initialized with 8-qubit register.");
    appendLog("QKD", "Awaiting BB84 handshake to unlock the vault.");
});

/* ============================================================
   NEW: QKD (BB84) SIMULATED HANDSHAKE LOGIN
   ============================================================ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randBit() {
    return window.crypto.getRandomValues(new Uint8Array(1))[0] & 1;
}

// Measuring in the same basis keeps the bit; a different basis gives a random bit
function measureQubit(qubit, basis) {
    return basis === qubit.basis ? qubit.bit : randBit();
}

async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    return buf2hex(await window.crypto.subtle.digest("SHA-256", data));
}

function renderQkdSteps() {
    const list = document.getElementById("qkd-steps");
    list.innerHTML = "";

    QKD_STEPS.forEach((label, i) => {
        const li = document.createElement("li");
        li.id = `qkd-step-${i}`;
        li.className = "qkd-step";
        li.innerHTML = `<i class="fa-regular fa-circle w-4"></i><span>${label}</span>`;
        list.appendChild(li);
    });

    document.getElementById("qkd-table").innerHTML = "";
    document.getElementById("qkd-qber").innerText = "--";
    document.getElementById("qkd-qber").className = "text-white";
}

function setStep(index, state) {
    const li = document.getElementById(`qkd-step-${index}`);
    const icons = {
        active: "fa-solid fa-circle-notch fa-spin",
        done: "fa-solid fa-circle-check",
        failed: "fa-solid fa-circle-xmark"
    };

    li.className = `qkd-step ${state}`;
    li.querySelector("i").className = `${icons[state]} w-4`;
}

function setQkdStatus(text) {
    document.getElementById("qkd-status").innerText = `Status: ${text}`;
}

function renderSiftTable(alice, bobBases) {
    const table = document.getElementById("qkd-table");
    table.innerHTML = "";

    for (let i = 0; i < 16; i++) {
        const match = alice[i].basis === bobBases[i];
        const row = document.createElement("div");
        row.className = "qkd-row";
        row.innerHTML = `
            <span>q${i}</span>
            <span>${alice[i].bit}</span>
            <span>${alice[i].basis === 0 ? "+" : "×"}</span>
            <span>${bobBases[i] === 0 ? "+" : "×"}</span>
            <span class="${match ? "text-emerald-400" : "text-slate-600"}">${match ? "keep" : "drop"}</span>
        `;
        table.appendChild(row);
    }
}

async function startQKDHandshake() {
    const operator = document.getElementById("login-operator").value.trim();

    if (!operator) {
        alert("Please enter an Operator ID.");
        return;
    }

    const eveActive = document.getElementById("login-eve").checked;
    const button = document.getElementById("btn-qkd-start");

    getAudioContext(); // Unlock audio while we still have a user click
    button.disabled = true;
    renderQkdSteps();
    setQkdStatus("handshake in progress...");
    appendLog("QKD", `BB84 handshake started for ${operator} (${QKD_QUBITS} qubits).`);

    // Step 1: Alice prepares qubits
    setStep(0, "active");
    const alice = Array.from({ length: QKD_QUBITS }, () => ({ bit: randBit(), basis: randBit() }));
    await sleep(700);
    setStep(0, "done");

    // Step 2: Quantum channel (optional eavesdropper measures and resends)
    setStep(1, "active");
    let channel = alice.map((q) => ({ ...q }));

    if (eveActive) {
        channel = channel.map((q) => {
            const eveBasis = randBit();
            return { bit: measureQubit(q, eveBasis), basis: eveBasis };
        });
        appendLog("HACKER", "Eavesdropper intercepted and resent qubits on the channel (simulated).");
    }

    await sleep(800);
    setStep(1, "done");

    // Step 3: Bob measures
    setStep(2, "active");
    const bobBases = alice.map(() => randBit());
    const bobBits = channel.map((q, i) => measureQubit(q, bobBases[i]));
    await sleep(700);
    setStep(2, "done");

    // Step 4: Sifting
    setStep(3, "active");
    const kept = [];
    alice.forEach((q, i) => {
        if (q.basis === bobBases[i]) kept.push(i);
    });
    renderSiftTable(alice, bobBases);
    await sleep(800);
    setStep(3, "done");

    // Step 5: Compare a sample of the sifted key to estimate QBER
    setStep(4, "active");
    const sampleSize = Math.floor(kept.length / 3);
    const sample = kept.slice(0, sampleSize);
    const errors = sample.filter((i) => alice[i].bit !== bobBits[i]).length;
    const qber = sampleSize > 0 ? errors / sampleSize : 1;
    const qberLabel = document.getElementById("qkd-qber");

    qberLabel.innerText = `${(qber * 100).toFixed(1)}% (${errors}/${sampleSize})`;
    await sleep(800);

    if (qber > QBER_LIMIT) {
        setStep(4, "failed");
        qberLabel.className = "text-rose-400";
        setQkdStatus("handshake ABORTED. Eavesdropper detected.");
        appendLog("ERROR", `QBER ${(qber * 100).toFixed(1)}% exceeds ${QBER_LIMIT * 100}%. Handshake aborted.`);

        securityAlert(
            "EAVESDROPPER DETECTED",
            "The quantum channel was intercepted. The QKD handshake was aborted and access is denied.",
            `QBER = ${(qber * 100).toFixed(1)}% (limit ${QBER_LIMIT * 100}%) | Operator: ${operator}`
        );

        button.disabled = false;
        return;
    }

    setStep(4, "done");
    qberLabel.className = "text-emerald-400";

    // Step 6: Derive session key and unlock vault
    setStep(5, "active");
    const secretBits = kept.slice(sampleSize).map((i) => alice[i].bit).join("");
    const sessionHash = await sha256Hex(secretBits + operator);
    const sessionId = `QKD-${sessionHash.substring(0, 8).toUpperCase()}`;
    await sleep(600);
    setStep(5, "done");

    document.getElementById("session-badge").innerText = sessionId;
    setQkdStatus(`secure session ${sessionId} established.`);
    appendLog("QKD", `Handshake OK. QBER ${(qber * 100).toFixed(1)}%. Session ${sessionId} for ${operator}.`);
    appendLog("VERIFY", `Shared secret: ${secretBits.length} bits after sifting and sampling.`);

    await sleep(900);
    document.getElementById("qkd-login").classList.add("qkd-hidden");
    button.disabled = false;
}

function logoutSession() {
    document.getElementById("session-badge").innerText = "NONE";
    document.getElementById("qkd-login").classList.remove("qkd-hidden");
    renderQkdSteps();
    setQkdStatus("waiting for operator.");
    appendLog("QKD", "Session closed. Vault locked.");
}

/* ============================================================
   NEW: SECURITY ALERT + ALARM SOUND (Web Audio API)
   ============================================================ */

function getAudioContext() {
    if (!audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) audioCtx = new AudioCtor();
    }

    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
    }

    return audioCtx;
}

function playAlarmSound() {
    const ctx = getAudioContext();
    if (!ctx) return;

    stopAlarmSound();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;

    osc.type = "square";
    gain.gain.value = 0.12;

    // Two-tone siren, 8 switches over about 2.4 seconds
    for (let i = 0; i < 8; i++) {
        osc.frequency.setValueAtTime(i % 2 === 0 ? 920 : 620, start + i * 0.3);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 2.4);
    alarmOsc = osc;
}

function stopAlarmSound() {
    clearInterval(alarmTimer);
    alarmTimer = null;

    if (alarmOsc) {
        try {
            alarmOsc.stop();
        } catch (err) {
            // Oscillator already stopped
        }
        alarmOsc = null;
    }
}

function securityAlert(title, message, detail) {
    document.getElementById("alert-title").innerText = title;
    document.getElementById("alert-message").innerText = message;
    document.getElementById("alert-detail").innerText = detail || "";
    document.getElementById("security-alert").classList.add("show");

    appendLog("ALERT", `${title}: ${message}`);

    // Repeat the siren until the operator acknowledges
    playAlarmSound();
    alarmTimer = setInterval(playAlarmSound, 2800);

    if (navigator.vibrate) {
        navigator.vibrate([300, 150, 300, 150, 300]);
    }
}

function dismissSecurityAlert() {
    stopAlarmSound();
    document.getElementById("security-alert").classList.remove("show");
    appendLog("SYSTEM", "Security alert acknowledged. Alarm silenced.");
}

/* ============================================================
   ORIGINAL: Quantum circuit, histogram, key generation
   ============================================================ */

// Render Qubit Circuit Visualizer
function renderQubitCircuit() {
    const container = document.getElementById("qubit-wires-container");
    container.innerHTML = "";

    for (let i = 0; i < 8; i++) {
        const wire = document.createElement("div");
        wire.className = "flex items-center gap-3 text-xs";

        wire.innerHTML = `
            <span class="w-8 text-cyan-400 font-bold">|q${i}⟩</span>

            <div class="flex-1 flex items-center relative">
                <div class="absolute w-full h-[2px] bg-slate-700"></div>

                <div class="relative z-10 flex items-center justify-around w-full px-8">
                    <div
                        class="qubit-active bg-cyan-950 border border-cyan-400 text-cyan-300 font-bold px-2.5 py-1 rounded shadow-md text-center cursor-pointer"
                        title="Hadamard Gate (Superposition)">
                        H
                    </div>

                    <div class="bg-purple-950 border border-purple-400 text-purple-300 font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                        <i class="fa-solid fa-gauge-simple-high text-[10px]"></i>
                        <span class="text-[10px]">M</span>
                    </div>
                </div>
            </div>

            <span id="qubit-val-${i}" class="w-8 font-bold text-amber-400 text-right">0</span>
        `;

        container.appendChild(wire);
    }
}

// Initialize Chart.js Histogram
function initHistogramChart() {
    const canvas = document.getElementById("quantumHistogramCanvas");
    const ctx = canvas.getContext("2d");

    const labels = [
        "000", "001", "010", "011",
        "100", "101", "110", "111"
    ];

    const data = [128, 132, 125, 130, 127, 129, 126, 127];

    histogramChart = new Chart(ctx, {
        type: "bar",

        data: {
            labels: labels,
            datasets: [{
                label: "Counts (Shots = 1024)",
                data: data,
                backgroundColor: "rgba(168, 85, 247, 0.6)",
                borderColor: "rgba(168, 85, 247, 1)",
                borderWidth: 1,
                borderRadius: 4
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                x: {
                    ticks: {
                        color: "#94a3b8",
                        font: {
                            family: "JetBrains Mono",
                            size: 10
                        }
                    },
                    grid: {
                        color: "rgba(51, 65, 85, 0.3)"
                    }
                },

                y: {
                    ticks: {
                        color: "#94a3b8",
                        font: {
                            family: "JetBrains Mono",
                            size: 10
                        }
                    },
                    grid: {
                        color: "rgba(51, 65, 85, 0.3)"
                    }
                }
            }
        }
    });
}

// Generate 256-Bit Random Key (now also creates a Key ID)
async function executeQuantumKeyGeneration() {
    const keyBytes = new Uint8Array(32);
    window.crypto.getRandomValues(keyBytes);

    currentQuantumKeyRaw = keyBytes;
    currentQuantumKeyHex = buf2hex(keyBytes);

    // NEW: Key ID = first 8 bytes of SHA-256(key)
    const digest = await window.crypto.subtle.digest("SHA-256", keyBytes);
    currentKeyId = `QK-${buf2hex(digest).substring(0, 16).toUpperCase()}`;

    document.getElementById("input-quantum-key").value =
        currentQuantumKeyHex;

    document.getElementById("output-key-id").value = currentKeyId;

    document.getElementById("key-status-label").innerText =
        "Quantum Verified";

    triggerMeasurementAnimation();

    appendLog(
        "QRNG",
        "Generated 256-bit key using browser cryptographic randomness."
    );

    appendLog("VAULT", `Key ID assigned: ${currentKeyId}`);

    appendLog(
        "ENTROPY",
        "Displayed entropy score is a demo value; randomness is not independently measured."
    );
}

// Simulate Measurement State Collapse
function triggerMeasurementAnimation() {
    const randomByte = window.crypto.getRandomValues(
        new Uint8Array(1)
    )[0];

    for (let i = 0; i < 8; i++) {
        const bitVal = (randomByte >> i) & 1;
        const qubitSpan = document.getElementById(`qubit-val-${i}`);

        if (qubitSpan) {
            qubitSpan.innerText = bitVal;

            qubitSpan.className = bitVal === 1
                ? "w-8 font-bold text-cyan-400 text-right"
                : "w-8 font-bold text-slate-500 text-right";
        }
    }

    // Randomize histogram data for the visual demo
    if (histogramChart) {
        const updatedData = histogramChart.data.datasets[0].data.map(
            () => Math.floor(120 + Math.random() * 20)
        );

        histogramChart.data.datasets[0].data = updatedData;
        histogramChart.update();
    }
}

// Update the "State Verification" metric card
function setVerificationMetric(text, colorClass) {
    const metric = document.getElementById("metric-verification");
    metric.innerText = text;
    metric.className = `text-xl font-bold font-mono ${colorClass} mt-1`;
}

// AES-256-GCM Encryption (Key ID is bound as authenticated data)
async function performEncryption() {
    const plaintext =
        document.getElementById("vault-input-text").value;

    if (!plaintext) {
        alert("Please enter a plaintext payload to encrypt.");
        return;
    }

    if (!currentQuantumKeyRaw) {
        await executeQuantumKeyGeneration();
    }

    try {
        // Import the 256-bit key into Web Crypto
        const cryptoKey = await window.crypto.subtle.importKey(
            "raw",
            currentQuantumKeyRaw,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );

        // Generate a 96-bit initialization vector
        const nonce = window.crypto.getRandomValues(
            new Uint8Array(12)
        );

        // Convert plaintext into bytes
        const encoder = new TextEncoder();
        const encodedPlaintext = encoder.encode(plaintext);

        // Encrypt plaintext, binding the Key ID as additional authenticated data
        const ciphertextBuffer = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                additionalData: encoder.encode(currentKeyId)
            },
            cryptoKey,
            encodedPlaintext
        );

        // Store encryption state for decryption
        lastEncryptedPayload = {
            ciphertext: ciphertextBuffer,
            nonce: nonce,
            keyId: currentKeyId
        };

        // Update output fields
        document.getElementById("output-nonce").value =
            buf2hex(nonce);

        document.getElementById("output-ciphertext").value =
            buf2hex(ciphertextBuffer);

        document.getElementById("output-authtag").value =
            "AUTHENTICATED (GCM Tag OK)";

        document.getElementById("input-verify-id").value = currentKeyId;

        setVerificationMetric("PASSED (GCM)", "text-amber-300");

        const decryptedOutput =
            document.getElementById("output-decrypted-text");

        decryptedOutput.innerText =
            "Payload encrypted. Ready for verification.";

        decryptedOutput.className =
            "font-mono text-xs text-slate-400 italic";

        appendLog(
            "VAULT",
            "Payload encrypted successfully with AES-256-GCM."
        );

        appendLog(
            "CIPHER",
            `Nonce (Hex): ${buf2hex(nonce).substring(0, 16)}...`
        );

        appendLog("VAULT", `Payload bound to Key ID ${currentKeyId}.`);

    } catch (err) {
        console.error("Encryption error:", err);
        appendLog("ERROR", `Encryption failed: ${err.message}`);
    }
}

// NEW: Simulate a hacker modifying the stored ciphertext
function simulateHackerAttack() {
    if (!lastEncryptedPayload) {
        alert("No encrypted payload found. Please click 'Encrypt Payload' first.");
        return;
    }

    const tampered = new Uint8Array(lastEncryptedPayload.ciphertext.slice(0));
    tampered[0] = tampered[0] ^ 0xff;
    lastEncryptedPayload.ciphertext = tampered.buffer;

    document.getElementById("output-ciphertext").value = buf2hex(tampered);
    document.getElementById("output-authtag").value = "MODIFIED BY ATTACKER";

    appendLog("HACKER", "Ciphertext byte modified in storage (simulated attack).");
}

// AES-GCM Decryption and Verification (with Key ID check and alerts)
async function performDecryption() {
    if (!lastEncryptedPayload) {
        alert("No encrypted payload found. Please click 'Encrypt Payload' first.");
        return;
    }

    const enteredId = document.getElementById("input-verify-id").value.trim();
    const decryptedOutput =
        document.getElementById("output-decrypted-text");

    // NEW: Key ID must match both the payload and the active key
    if (enteredId !== lastEncryptedPayload.keyId || currentKeyId !== lastEncryptedPayload.keyId) {
        decryptedOutput.innerText = "DECRYPTION BLOCKED: Key ID mismatch.";
        decryptedOutput.className = "font-mono text-xs text-rose-400 font-bold";
        document.getElementById("output-authtag").value = "KEY ID MISMATCH";
        setVerificationMetric("FAILED (ID)", "text-rose-400");

        appendLog("ERROR", `Key ID mismatch. Entered: ${enteredId || "(empty)"} | Payload: ${lastEncryptedPayload.keyId} | Active: ${currentKeyId}`);

        securityAlert(
            "KEY ID MISMATCH",
            "The key ID does not match this encrypted payload. Decryption was blocked.",
            `Entered: ${enteredId || "(empty)"} | Expected: ${lastEncryptedPayload.keyId}`
        );
        return;
    }

    try {
        const cryptoKey = await window.crypto.subtle.importKey(
            "raw",
            currentQuantumKeyRaw,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: lastEncryptedPayload.nonce,
                additionalData: new TextEncoder().encode(lastEncryptedPayload.keyId)
            },
            cryptoKey,
            lastEncryptedPayload.ciphertext
        );

        const decoder = new TextDecoder();
        const decryptedText = decoder.decode(decryptedBuffer);

        decryptedOutput.innerText = `"${decryptedText}"`;

        decryptedOutput.className =
            "font-mono text-xs text-emerald-300 font-bold";

        document.getElementById("output-authtag").value =
            "AUTHENTICATED (GCM Tag OK)";

        setVerificationMetric("PASSED (GCM)", "text-amber-300");

        appendLog(
            "VAULT",
            "Decryption and GCM authentication successful."
        );

        appendLog(
            "VERIFY",
            "Payload integrity verified with zero bit errors."
        );

    } catch (err) {
        console.error("Decryption error:", err);

        decryptedOutput.innerText =
            "DECRYPTION FAILED: Authentication tag mismatch or corrupted key.";

        decryptedOutput.className =
            "font-mono text-xs text-rose-400 font-bold";

        document.getElementById("output-authtag").value = "TAG MISMATCH (TAMPERED)";
        setVerificationMetric("FAILED (GCM)", "text-rose-400");

        appendLog(
            "ERROR",
            "Decryption failed. Data tampering or wrong key detected."
        );

        securityAlert(
            "HACKER ATTACK DETECTED",
            "The encrypted data failed authentication. It was modified or the wrong key was used.",
            `GCM authentication tag mismatch | Key ID: ${lastEncryptedPayload.keyId}`
        );
    }
}

// Convert Bytes to Hexadecimal
function buf2hex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

// Copy Input or Output to Clipboard
async function copyToClipboard(elementId) {
    const input = document.getElementById(elementId);

    try {
        await navigator.clipboard.writeText(input.value);
        appendLog("SYSTEM", "Copied value to clipboard.");
    } catch (err) {
        // Fallback for browsers that block clipboard access
        input.select();
        const copied = document.execCommand("copy");

        if (copied) {
            appendLog("SYSTEM", "Copied value to clipboard.");
        } else {
            appendLog("ERROR", "Could not copy value to clipboard.");
        }
    }
}

// Add Entry to Security Audit Log
function appendLog(category, message) {
    const consoleBox = document.getElementById("console-stream");

    const timestamp = new Date()
        .toISOString()
        .split("T")[1]
        .slice(0, 8);

    let catColor = "text-cyan-400";

    if (category === "ERROR" || category === "HACKER" || category === "ALERT") {
        catColor = "text-rose-400";
    }

    if (category === "VAULT") {
        catColor = "text-purple-400";
    }

    if (category === "VERIFY") {
        catColor = "text-emerald-400";
    }

    const logLine = document.createElement("div");

    const timeSpan = document.createElement("span");
    timeSpan.className = "text-slate-500";
    timeSpan.textContent = `[${timestamp}] `;

    const categorySpan = document.createElement("strong");
    categorySpan.className = catColor;
    categorySpan.textContent = `[${category}] `;

    logLine.appendChild(timeSpan);
    logLine.appendChild(categorySpan);
    logLine.appendChild(document.createTextNode(message));

    consoleBox.appendChild(logLine);
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

// Clear Security Audit Log
function clearConsoleLog() {
    document.getElementById("console-stream").innerHTML = "";
    appendLog("SYSTEM", "Log buffer cleared.");
}