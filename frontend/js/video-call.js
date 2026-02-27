const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
const socket = io(BACKEND_ORIGIN, (window.APP_CONFIG && window.APP_CONFIG.getSocketOptions && window.APP_CONFIG.getSocketOptions()) || { withCredentials: true });

const session = (window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth()) || null;
const username = session ? session.username : "";
const userId = session ? session.userId : "";

const usernameDisplay = document.getElementById("usernameDisplay");
const callState = document.getElementById("callState");
const statusBox = document.getElementById("statusBox");
const targetUserInput = document.getElementById("targetUser");
const targetUserLabel = document.getElementById("targetUserLabel");
const targetUserChip = document.getElementById("targetUserChip");
const targetUserText = document.getElementById("targetUserText");
const targetChangeBtn = document.getElementById("targetChangeBtn");
const callBtn = document.getElementById("callBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const hangupBtn = document.getElementById("hangupBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const incomingCard = document.getElementById("incomingCard");
const incomingText = document.getElementById("incomingText");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");

usernameDisplay.textContent = username;

let localStream = null;
let peerConnection = null;
let activePeer = "";
let pendingOffer = null;
let isMuted = false;
let isCameraOff = false;
let ringTimeoutId = null;
let isRingingOutgoing = false;
const urlParams = new URLSearchParams(window.location.search);
const prefilledTarget = String(urlParams.get("u") || "").trim();
const PENDING_VIDEO_CALL_KEY = "ascapdx_pending_call_offer";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setStatus(message) {
  statusBox.textContent = message;
}

function setCallState(state) {
  callState.textContent = state;
}

function setInCallUI(inCall) {
  muteBtn.disabled = !inCall;
  cameraBtn.disabled = !inCall;
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
    const raw = sessionStorage.getItem(PENDING_VIDEO_CALL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_VIDEO_CALL_KEY);
    payload = JSON.parse(raw);
  } catch (err) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return null;
  const createdAt = Number(payload.createdAt || 0);
  if (createdAt && (Date.now() - createdAt > 2 * 60 * 1000)) return null;
  const from = String(payload.from || "").trim();
  const callType = String(payload.callType || "video").toLowerCase();
  const offer = payload.offer;
  if (!from || !offer) return null;
  if (callType !== "video") return null;
  return {
    from,
    offer,
    callType,
    autoAnswer: payload.autoAnswer === true
  };
}

function setRingingUI(ringing) {
  isRingingOutgoing = ringing;
  callBtn.disabled = ringing;
  if (ringing) {
    hangupBtn.disabled = false;
  }
}

function showIncoming(from) {
  incomingText.textContent = `Incoming video call from ${from}`;
  incomingCard.classList.add("show");
}

function hideIncoming() {
  incomingCard.classList.remove("show");
  pendingOffer = null;
}

function clearRingTimeout() {
  if (ringTimeoutId) {
    clearTimeout(ringTimeoutId);
  }
  ringTimeoutId = null;
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
    cleanupCall("Idle");
  }, 30000);
}

async function ensureLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: "user"
    }
  });
  localVideo.srcObject = localStream;
  return localStream;
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
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setCallState("In Call");
      setStatus(`Connected with ${activePeer}.`);
      setInCallUI(true);
      setRingingUI(false);
      clearRingTimeout();
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
  localVideo.srcObject = null;
}

function cleanupCall(nextState = "Idle") {
  clearRingTimeout();
  hideIncoming();

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
  }

  stopLocalMedia();
  remoteVideo.srcObject = null;

  setInCallUI(false);
  setRingingUI(false);
  callBtn.disabled = false;
  setCallState(nextState);

  activePeer = "";
  isMuted = false;
  isCameraOff = false;
  muteBtn.textContent = "Mute Mic";
  cameraBtn.textContent = "Turn Camera Off";
  updateTargetUserUi();
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
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("voice:call-offer", {
      from: username,
      to,
      offer,
      callType: "video"
    });

    beginRingTimeout();
  } catch (error) {
    setStatus(`Call failed: ${error.message}`);
    cleanupCall("Idle");
  }
}

async function acceptIncoming() {
  if (!pendingOffer) return;
  const { from, offer } = pendingOffer;
  hideIncoming();

  try {
    activePeer = from;
    targetUserInput.value = from;
    updateTargetUserUi();
    setCallState("Connecting");
    setStatus(`Connecting with ${from}...`);

    await ensureLocalStream();
    peerConnection = createPeerConnection();
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

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

function toggleCamera() {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = !isCameraOff;
  });
  cameraBtn.textContent = isCameraOff ? "Turn Camera On" : "Turn Camera Off";
  setStatus(isCameraOff ? "Camera turned off." : "Camera turned on.");
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
});

socket.on("voice:call-answer", async (payload) => {
  if (!peerConnection || !payload || !payload.answer) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
    setCallState("Connecting");
    setStatus(`Call accepted by ${payload.from}. Connecting...`);
    clearRingTimeout();
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

callBtn.addEventListener("click", startCall);
muteBtn.addEventListener("click", toggleMute);
cameraBtn.addEventListener("click", toggleCamera);
hangupBtn.addEventListener("click", endCallByUser);
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
