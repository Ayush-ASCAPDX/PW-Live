const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
const socket = io(BACKEND_ORIGIN, (window.APP_CONFIG && window.APP_CONFIG.getSocketOptions && window.APP_CONFIG.getSocketOptions()) || { withCredentials: true });
const uiFeedback = window.UIFeedback || null;

const session = (window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth()) || null;
const username = session ? session.username : "";
const userId = session ? session.userId : "";

const usernameDisplay = document.getElementById("usernameDisplay");
const callState = document.getElementById("callState");
const statusBox = document.getElementById("statusBox");
const targetUserInput = document.getElementById("targetUser");
const callBtn = document.getElementById("callBtn");
const muteBtn = document.getElementById("muteBtn");
const hangupBtn = document.getElementById("hangupBtn");
const remoteAudio = document.getElementById("remoteAudio");
const localAudio = document.getElementById("localAudio");
const callTimer = document.getElementById("callTimer");
const audioQualitySelect = document.getElementById("audioQuality");
const targetUserLabel = document.getElementById("targetUserLabel");
const targetUserChip = document.getElementById("targetUserChip");
const targetUserText = document.getElementById("targetUserText");
const targetChangeBtn = document.getElementById("targetChangeBtn");
const incomingCard = document.getElementById("incomingCard");
const incomingText = document.getElementById("incomingText");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");
const callHistoryList = document.getElementById("callHistory");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
const historySearchInput = document.getElementById("historySearchInput");
const missedSeenKey = `missed_calls_seen_at_${username}`;

function uiConfirm(message, options = {}) {
  if (uiFeedback && typeof uiFeedback.confirm === "function") {
    return uiFeedback.confirm(String(message || "Are you sure?"), options);
  }
  return Promise.resolve(window.confirm(String(message || "Are you sure?")));
}

usernameDisplay.textContent = username;

let localStream = null;
let peerConnection = null;
let activePeer = "";
let pendingOffer = null;
let isMuted = false;
let isRingingOutgoing = false;
let ringTimeoutId = null;
let callStartedAt = null;
let timerIntervalId = null;
let audioCtx = null;
let incomingRingInterval = null;
let outgoingRingInterval = null;
let callHistoryItems = [];
let activeHistoryFilter = "all";
let activeHistorySearch = "";
const urlParams = new URLSearchParams(window.location.search);
const prefilledTarget = String(urlParams.get("u") || "").trim();
const PENDING_VOICE_CALL_KEY = "ascapdx_pending_call_offer";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const AUDIO_QUALITY_PRESETS = {
  best: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16
  },
  standard: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  }
};

let currentAudioQuality = "best";

function setStatus(message) {
  statusBox.textContent = message;
}

function setCallState(state) {
  callState.textContent = state;
}

function setInCallUI(inCall) {
  muteBtn.disabled = !inCall;
  hangupBtn.disabled = !inCall;
}

function updateTargetUserUi() {
  const target = String((targetUserInput && targetUserInput.value) || "").trim();
  const hasTarget = !!target;
  if (targetUserChip) targetUserChip.classList.toggle("show", hasTarget);
  if (targetUserText) targetUserText.textContent = hasTarget ? `Calling @${target}` : "Target";
  if (targetUserInput) targetUserInput.style.display = hasTarget ? "none" : "";
  if (targetUserLabel) targetUserLabel.style.display = hasTarget ? "none" : "";
}

function consumePendingIncomingOffer() {
  let payload = null;
  try {
    const raw = sessionStorage.getItem(PENDING_VOICE_CALL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_VOICE_CALL_KEY);
    payload = JSON.parse(raw);
  } catch (err) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return null;
  const createdAt = Number(payload.createdAt || 0);
  if (createdAt && (Date.now() - createdAt > 2 * 60 * 1000)) return null;
  const from = String(payload.from || "").trim();
  const callType = String(payload.callType || "voice").toLowerCase();
  const offer = payload.offer;
  if (!from || !offer) return null;
  if (callType !== "voice") return null;
  return {
    from,
    offer,
    autoAnswer: payload.autoAnswer === true
  };
}

function formatHistoryTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function formatHistoryDuration(durationSec) {
  const sec = Number(durationSec || 0);
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function renderHistoryItem(item) {
  const li = document.createElement("li");
  li.className = "history-item";
  const direction = item.direction === "outgoing" ? "Outgoing" : "Incoming";
  const status = item.status || "unknown";
  const duration = formatHistoryDuration(item.durationSec);
  li.innerHTML = `
    <strong>${direction} - ${item.peer || "Unknown"}</strong>
    <div class="history-meta">${status} - ${duration} - ${formatHistoryTime(item.createdAt)}</div>
  `;
  return li;
}

function markMissedCallsSeen() {
  localStorage.setItem(missedSeenKey, String(Date.now()));
  window.dispatchEvent(new Event("missed-calls-updated"));
}

function getFilteredHistoryItems() {
  const byStatus = activeHistoryFilter === "all"
    ? callHistoryItems
    : callHistoryItems.filter((item) => item.status === activeHistoryFilter);

  if (!activeHistorySearch) return byStatus;
  const query = activeHistorySearch.toLowerCase();
  return byStatus.filter((item) => {
    const peer = (item.peer || "").toLowerCase();
    const caller = (item.caller || "").toLowerCase();
    const receiver = (item.receiver || "").toLowerCase();
    return peer.includes(query) || caller.includes(query) || receiver.includes(query);
  });
}

function renderCallHistoryList() {
  if (!callHistoryList) return;
  callHistoryList.innerHTML = "";
  const filtered = getFilteredHistoryItems();

  if (!Array.isArray(filtered) || filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-item";
    empty.innerHTML = `<strong>No calls in this filter</strong><div class="history-meta">Try another filter.</div>`;
    callHistoryList.appendChild(empty);
    return;
  }

  filtered.forEach((item) => callHistoryList.appendChild(renderHistoryItem(item)));
}

async function loadCallHistory() {
  if (!callHistoryList || !username) return;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/calls/history`)
      : fetch(`${BACKEND_ORIGIN}/api/calls/history`));
    if (!res.ok) throw new Error("History fetch failed");
    const items = await res.json();
    callHistoryItems = Array.isArray(items) ? items : [];
    if (callHistoryItems.length === 0) {
      callHistoryList.innerHTML = "";
      const empty = document.createElement("li");
      empty.className = "history-item";
      empty.innerHTML = `<strong>No call history</strong><div class="history-meta">Your recent calls will appear here.</div>`;
      callHistoryList.appendChild(empty);
      markMissedCallsSeen();
      return;
    }
    renderCallHistoryList();
    markMissedCallsSeen();
  } catch (err) {
    callHistoryList.innerHTML = "";
    const errorItem = document.createElement("li");
    errorItem.className = "history-item";
    errorItem.innerHTML = `<strong>History unavailable</strong><div class="history-meta">${err.message}</div>`;
    callHistoryList.appendChild(errorItem);
  }
}

function setHistoryFilter(filterValue) {
  activeHistoryFilter = filterValue;
  filterButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filterValue);
  });
  renderCallHistoryList();
}

async function clearCallHistory() {
  const ok = await uiConfirm("Clear all your call history?", { tone: "danger", okText: "Clear" });
  if (!ok) return;
  try {
    const res = await (window.APP_CONFIG && window.APP_CONFIG.authFetch
      ? window.APP_CONFIG.authFetch(`${BACKEND_ORIGIN}/api/calls/history`, { method: "DELETE" })
      : fetch(`${BACKEND_ORIGIN}/api/calls/history`, { method: "DELETE" }));
    if (!res.ok) throw new Error("Could not clear call history");
    setStatus("Call history cleared.");
    callHistoryItems = [];
    renderCallHistoryList();
    markMissedCallsSeen();
  } catch (err) {
    setStatus(`Clear history failed: ${err.message}`);
  }
}

function exportCallHistoryCsv() {
  const rows = getFilteredHistoryItems();
  if (!rows.length) {
    setStatus("No call history to export.");
    return;
  }

  const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["direction", "peer", "status", "duration_sec", "created_at", "started_at", "ended_at", "end_reason"];
  const lines = [header.map(esc).join(",")];
  rows.forEach((item) => {
    lines.push([
      item.direction,
      item.peer,
      item.status,
      item.durationSec ?? 0,
      item.createdAt || "",
      item.startedAt || "",
      item.endedAt || "",
      item.endReason || ""
    ].map(esc).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `ascapdx-call-history-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Call history exported.");
}

function setRingingUI(ringing) {
  isRingingOutgoing = ringing;
  callBtn.disabled = ringing;
  if (ringing) {
    hangupBtn.disabled = false;
  }
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const secs = String(totalSec % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function startTimer() {
  stopTimer();
  callStartedAt = Date.now();
  callTimer.textContent = "Duration: 00:00";
  timerIntervalId = setInterval(() => {
    callTimer.textContent = `Duration: ${formatDuration(Date.now() - callStartedAt)}`;
  }, 1000);
}

function stopTimer() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = null;
  callStartedAt = null;
  callTimer.textContent = "Duration: 00:00";
}

function showIncoming(from) {
  incomingText.textContent = `Incoming voice call from ${from}`;
  incomingCard.classList.add("show");
}

function hideIncoming() {
  incomingCard.classList.remove("show");
  pendingOffer = null;
}

function clearRingTimeout() {
  if (ringTimeoutId) clearTimeout(ringTimeoutId);
  ringTimeoutId = null;
}

function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function attachRemoteStream(stream) {
  if (!stream) return;
  remoteAudio.srcObject = stream;
  remoteAudio.volume = 1;
  remoteAudio.muted = false;
  const playPromise = remoteAudio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

async function tuneAudioSender(sender) {
  if (!sender || typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") {
    return;
  }
  try {
    const params = sender.getParameters() || {};
    if (!Array.isArray(params.encodings) || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = 64000;
    params.encodings[0].maxFramerate = undefined;
    params.encodings[0].dtx = "disabled";
    if (!params.degradationPreference) {
      params.degradationPreference = "maintain-resolution";
    }
    await sender.setParameters(params);
  } catch (error) {}
}

function preferOpusCodec(pc) {
  if (!pc || typeof pc.getTransceivers !== "function") return;
  if (typeof RTCRtpSender === "undefined" || typeof RTCRtpSender.getCapabilities !== "function") return;

  try {
    const caps = RTCRtpSender.getCapabilities("audio");
    if (!caps || !Array.isArray(caps.codecs) || caps.codecs.length === 0) return;

    const opus = caps.codecs.filter((c) => String(c.mimeType || "").toLowerCase() === "audio/opus");
    if (!opus.length) return;
    const rest = caps.codecs.filter((c) => String(c.mimeType || "").toLowerCase() !== "audio/opus");
    const ordered = [...opus, ...rest];

    pc.getTransceivers().forEach((t) => {
      const senderTrack = t && t.sender ? t.sender.track : null;
      if (!senderTrack || senderTrack.kind !== "audio") return;
      if (typeof t.setCodecPreferences === "function") {
        t.setCodecPreferences(ordered);
      }
    });
  } catch (error) {}
}

async function addLocalAudioTracks(pc) {
  if (!pc || !localStream) return;
  const tracks = localStream.getAudioTracks();
  for (const track of tracks) {
    const sender = pc.addTrack(track, localStream);
    await tuneAudioSender(sender);
  }
  preferOpusCodec(pc);
}

function playTone(frequency, durationMs, gainValue = 0.035) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.value = gainValue;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  setTimeout(() => {
    osc.stop();
    osc.disconnect();
    gain.disconnect();
  }, durationMs);
}

function startOutgoingRing() {
  stopRingingSounds();
  playTone(620, 150);
  setTimeout(() => playTone(760, 180), 220);
  outgoingRingInterval = setInterval(() => {
    playTone(620, 150);
    setTimeout(() => playTone(760, 180), 220);
  }, 2300);
}

function startIncomingRing() {
  stopRingingSounds();
  playTone(540, 280, 0.042);
  incomingRingInterval = setInterval(() => {
    playTone(540, 280, 0.042);
  }, 1250);
}

function stopRingingSounds() {
  if (incomingRingInterval) clearInterval(incomingRingInterval);
  if (outgoingRingInterval) clearInterval(outgoingRingInterval);
  incomingRingInterval = null;
  outgoingRingInterval = null;
}

function beginRingTimeout() {
  clearRingTimeout();
  ringTimeoutId = setTimeout(() => {
    if (!isRingingOutgoing || !activePeer) return;
    socket.emit("voice:hangup", {
      from: username,
      to: activePeer,
      reason: "no-answer"
    });
    setStatus(`${activePeer} did not answer.`);
    cleanupCall("No answer");
  }, 30000);
}

async function ensureLocalStream() {
  if (localStream) return localStream;
  const constraints = AUDIO_QUALITY_PRESETS[currentAudioQuality] || AUDIO_QUALITY_PRESETS.best;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: constraints,
    video: false
  });
  const [track] = localStream.getAudioTracks();
  if (track && typeof track.applyConstraints === "function") {
    track.applyConstraints(constraints).catch(() => {});
  }
  localAudio.srcObject = localStream;
  return localStream;
}

async function replaceLocalAudioTrack(nextTrack) {
  if (!peerConnection || !nextTrack) return;
  const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "audio");
  if (!sender) return;
  await sender.replaceTrack(nextTrack);
  await tuneAudioSender(sender);
}

async function applyAudioQualityPreset(nextQuality, opts = {}) {
  const quality = AUDIO_QUALITY_PRESETS[nextQuality] ? nextQuality : "best";
  currentAudioQuality = quality;
  const constraints = AUDIO_QUALITY_PRESETS[quality];

  if (!localStream) {
    if (!opts.silent) setStatus(`Audio quality set: ${quality === "best" ? "Best Clarity" : "Standard"}.`);
    return;
  }

  const oldTrack = localStream.getAudioTracks()[0] || null;
  let replaced = false;

  if (oldTrack && typeof oldTrack.applyConstraints === "function") {
    try {
      await oldTrack.applyConstraints(constraints);
      replaced = true;
    } catch (error) {}
  }

  if (!replaced) {
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      const nextTrack = fresh.getAudioTracks()[0];
      if (nextTrack) {
        nextTrack.enabled = !isMuted;
        await replaceLocalAudioTrack(nextTrack);
        if (oldTrack) oldTrack.stop();
        localStream.getTracks().forEach((t) => t.stop());
        localStream = fresh;
        localAudio.srcObject = localStream;
      } else {
        fresh.getTracks().forEach((t) => t.stop());
      }
    } catch (error) {
      if (!opts.silent) setStatus(`Could not change audio quality: ${error.message}`);
      return;
    }
  }

  if (!opts.silent) setStatus(`Audio quality set: ${quality === "best" ? "Best Clarity" : "Standard"}.`);
}

function createPeerConnection() {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (!event.candidate || !activePeer) return;
    socket.emit("voice:ice-candidate", {
      from: username,
      to: activePeer,
      candidate: event.candidate
    });
  };

  pc.ontrack = (event) => {
    attachRemoteStream(event.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      stopRingingSounds();
      setCallState("In Call");
      setStatus(`Connected with ${activePeer}.`);
      setInCallUI(true);
      setRingingUI(false);
      startTimer();
    }
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      cleanupCall("Idle");
      setStatus("Call ended.");
    }
  };

  return pc;
}

function stopLocalMedia() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  localAudio.srcObject = null;
}

function cleanupCall(nextState = "Idle") {
  clearRingTimeout();
  stopRingingSounds();
  stopTimer();
  hideIncoming();

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
  }

  stopLocalMedia();
  remoteAudio.srcObject = null;

  setInCallUI(false);
  setRingingUI(false);
  callBtn.disabled = false;
  setCallState(nextState);

  activePeer = "";
  isMuted = false;
  muteBtn.textContent = "Mute Mic";
  updateTargetUserUi();
  loadCallHistory();
}

async function startCall() {
  const to = targetUserInput.value.trim();
  if (!to) {
    setStatus("Enter a username to call.");
    return;
  }
  if (to === username) {
    setStatus("You cannot call yourself.");
    return;
  }
  if (activePeer || peerConnection || pendingOffer) {
    setStatus("You are already in a call flow.");
    return;
  }

  try {
    activePeer = to;
    updateTargetUserUi();
    setCallState("Ringing");
    setStatus(`Calling ${to}...`);
    setRingingUI(true);

    await ensureLocalStream();

    peerConnection = createPeerConnection();
    await addLocalAudioTracks(peerConnection);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("voice:call-offer", {
      from: username,
      to,
      offer,
      callType: "voice"
    });

    startOutgoingRing();
    beginRingTimeout();
  } catch (error) {
    setStatus(`Call failed: ${error.message}`);
    cleanupCall("Idle");
  }
}

async function acceptIncoming() {
  if (!pendingOffer) return;
  const { from, offer } = pendingOffer;
  stopRingingSounds();
  hideIncoming();

  try {
    activePeer = from;
    targetUserInput.value = from;
    updateTargetUserUi();
    setCallState("Connecting");
    setStatus(`Connecting with ${from}...`);

    await ensureLocalStream();

    peerConnection = createPeerConnection();
    await addLocalAudioTracks(peerConnection);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("voice:call-answer", {
      from: username,
      to: from,
      answer
    });
  } catch (error) {
    setStatus(`Could not accept: ${error.message}`);
    socket.emit("voice:call-reject", {
      from: username,
      to: from,
      reason: "error"
    });
    cleanupCall("Idle");
  }
}

function rejectIncoming(reason = "rejected") {
  if (!pendingOffer) return;
  const from = pendingOffer.from;
  socket.emit("voice:call-reject", {
    from: username,
    to: from,
    reason
  });
  setStatus(`Call from ${from} rejected.`);
  stopRingingSounds();
  cleanupCall("Idle");
}

function endCallByUser() {
  if (!activePeer) return;
  socket.emit("voice:hangup", {
    from: username,
    to: activePeer,
    reason: "ended"
  });
  cleanupCall("Idle");
  setStatus("Call ended.");
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });
  muteBtn.textContent = isMuted ? "Unmute Mic" : "Mute Mic";
  setStatus(isMuted ? "Microphone muted." : "Microphone active.");
}

socket.on("connect", () => {
  socket.emit("userOnline", username);
});

socket.on("voice:user-unavailable", (data) => {
  if (activePeer !== data.to) return;
  setStatus(`${data.to} is not online.`);
  cleanupCall("Idle");
});

socket.on("voice:busy", (data) => {
  if (activePeer !== data.to) return;
  setStatus(`${data.to} is busy.`);
  cleanupCall("Idle");
});

socket.on("voice:call-offer", async (payload) => {
  if (!payload || !payload.from || !payload.offer) return;

  if (activePeer || peerConnection || pendingOffer) {
    socket.emit("voice:call-reject", {
      from: username,
      to: payload.from,
      reason: "busy"
    });
    return;
  }

  pendingOffer = payload;
  setCallState("Incoming");
  setStatus(`Incoming call from ${payload.from}.`);
  showIncoming(payload.from);
  startIncomingRing();
});

socket.on("voice:call-answer", async (payload) => {
  if (!peerConnection || !payload || !payload.answer) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
    setCallState("Connecting");
    setStatus(`Call accepted by ${payload.from}. Connecting...`);
    clearRingTimeout();
    stopRingingSounds();
    setRingingUI(false);
  } catch (error) {
    setStatus(`Answer error: ${error.message}`);
    cleanupCall("Idle");
  }
});

socket.on("voice:call-reject", (payload) => {
  const reason = payload && payload.reason ? payload.reason : "rejected";
  const from = payload && payload.from ? payload.from : "User";
  let text = `${from} rejected your call.`;
  if (reason === "busy") text = `${from} is busy.`;
  if (reason === "offline") text = `${from} went offline.`;
  if (reason === "no-answer") text = `${from} did not answer.`;
  setStatus(text);
  cleanupCall("Idle");
});

socket.on("voice:ice-candidate", async (payload) => {
  if (!peerConnection || !payload || !payload.candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
  } catch (error) {
    setStatus(`ICE error: ${error.message}`);
  }
});

socket.on("voice:hangup", (payload) => {
  const reason = payload && payload.reason ? payload.reason : "ended";
  const from = payload && payload.from ? payload.from : "Remote user";
  let text = `${from} ended the call.`;
  if (reason === "offline") text = `${from} went offline.`;
  if (reason === "no-answer") text = `${from} did not answer.`;
  if (reason === "busy") text = `${from} is busy.`;
  setStatus(text);
  cleanupCall("Idle");
});

if (audioQualitySelect) {
  audioQualitySelect.value = currentAudioQuality;
  audioQualitySelect.addEventListener("change", async (event) => {
    const value = event.target.value || "best";
    await applyAudioQualityPreset(value);
  });
}

callBtn.addEventListener("click", startCall);
hangupBtn.addEventListener("click", endCallByUser);
muteBtn.addEventListener("click", toggleMute);
acceptBtn.addEventListener("click", acceptIncoming);
rejectBtn.addEventListener("click", () => rejectIncoming("rejected"));

targetUserInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  startCall();
});

targetUserInput.addEventListener("input", () => {
  updateTargetUserUi();
});

if (targetChangeBtn) {
  targetChangeBtn.addEventListener("click", () => {
    if (targetUserInput) {
      targetUserInput.value = "";
      targetUserInput.focus();
    }
    updateTargetUserUi();
  });
}

if (prefilledTarget && prefilledTarget !== username && targetUserInput) {
  targetUserInput.value = prefilledTarget;
}

const pendingFromStorage = consumePendingIncomingOffer();
if (pendingFromStorage && !activePeer && !peerConnection && !pendingOffer) {
  pendingOffer = {
    from: pendingFromStorage.from,
    offer: pendingFromStorage.offer
  };
  if (targetUserInput) targetUserInput.value = pendingFromStorage.from;
  setCallState("Incoming");
  setStatus(`Incoming call from ${pendingFromStorage.from}.`);
  showIncoming(pendingFromStorage.from);
  if (pendingFromStorage.autoAnswer) {
    const runAnswer = () => acceptIncoming();
    if (socket.connected) runAnswer();
    else socket.once("connect", runAnswer);
  }
}

updateTargetUserUi();

window.addEventListener("beforeunload", () => {
  if (activePeer) {
    socket.emit("voice:hangup", {
      from: username,
      to: activePeer,
      reason: "offline"
    });
  }
});

loadCallHistory();
setInterval(loadCallHistory, 15000);

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const filterValue = btn.dataset.filter || "all";
    setHistoryFilter(filterValue);
  });
});

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", clearCallHistory);
}

if (exportHistoryBtn) {
  exportHistoryBtn.addEventListener("click", exportCallHistoryCsv);
}

if (historySearchInput) {
  historySearchInput.addEventListener("input", (event) => {
    activeHistorySearch = (event.target.value || "").trim();
    renderCallHistoryList();
  });
}






