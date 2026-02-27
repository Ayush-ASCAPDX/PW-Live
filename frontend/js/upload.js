const session = (window.APP_CONFIG && window.APP_CONFIG.requireAuth && window.APP_CONFIG.requireAuth()) || null;
const username = session ? session.username : "";
const userId = session ? session.userId : "";

const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";
const POSTS_API = `${BACKEND_ORIGIN}/api/posts`;
const STORIES_API = `${BACKEND_ORIGIN}/api/stories`;

const postUploadForm = document.getElementById("postUploadForm");
const postMediaInput = document.getElementById("postMediaInput");
const postCaptionInput = document.getElementById("postCaptionInput");
const postPrivacyInput = document.getElementById("postPrivacyInput");
const postPublishAtInput = document.getElementById("postPublishAtInput");
const postUploadBtn = document.getElementById("postUploadBtn");
const saveDraftBtn = document.getElementById("saveDraftBtn");
const loadDraftBtn = document.getElementById("loadDraftBtn");
const clearDraftBtn = document.getElementById("clearDraftBtn");
const draftStatus = document.getElementById("draftStatus");
const postProgressWrap = document.getElementById("postProgressWrap");
const postProgressBar = document.getElementById("postProgressBar");
const postProgressText = document.getElementById("postProgressText");
const postStatus = document.getElementById("postStatus");

const storyUploadForm = document.getElementById("storyUploadForm");
const storyMediaInput = document.getElementById("storyMediaInputPage");
const storyUploadBtn = document.getElementById("storyUploadBtn");
const storyProgressWrap = document.getElementById("storyProgressWrapPage");
const storyProgressBar = document.getElementById("storyProgressBarPage");
const storyProgressText = document.getElementById("storyProgressTextPage");
const storyStatus = document.getElementById("storyStatusPage");
const postUploadSection = document.getElementById("postUploadSection");
const storyUploadSection = document.getElementById("storyUploadSection");

const mode = String(new URLSearchParams(window.location.search).get("mode") || "").toLowerCase();
const draftStorageKey = `upload_post_draft_${username || "guest"}`;
if (mode === "story") {
  if (postUploadSection) postUploadSection.style.display = "none";
  document.title = "Upload Story | ASCAPDX Digital";
} else if (mode === "post") {
  if (storyUploadSection) storyUploadSection.style.display = "none";
  document.title = "Upload Post | ASCAPDX Digital";
}

function setProgress(wrap, bar, textEl, percent, label) {
  if (wrap) wrap.classList.add("show");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (textEl) textEl.textContent = `${label} ${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
}

function resetProgress(wrap, bar, textEl, label) {
  if (wrap) wrap.classList.remove("show");
  if (bar) bar.style.width = "0%";
  if (textEl) textEl.textContent = `${label} 0%`;
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      if (typeof onProgress === "function") onProgress(percent);
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (err) {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      reject(new Error(data.message || "Upload failed."));
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(formData);
  });
}

function setDraftStatus(message) {
  if (!draftStatus) return;
  draftStatus.textContent = String(message || "");
}

function readDraft() {
  const raw = localStorage.getItem(draftStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function saveDraft(options = {}) {
  const payload = {
    caption: String((postCaptionInput && postCaptionInput.value) || ""),
    privacy: String((postPrivacyInput && postPrivacyInput.value) || "public"),
    publishAt: String((postPublishAtInput && postPublishAtInput.value) || ""),
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(draftStorageKey, JSON.stringify(payload));
  if (!options.silent) setDraftStatus("Draft saved.");
}

function loadDraft() {
  const draft = readDraft();
  if (!draft) {
    setDraftStatus("No saved draft.");
    return;
  }
  if (postCaptionInput) postCaptionInput.value = String(draft.caption || "");
  if (postPrivacyInput) {
    const nextPrivacy = String(draft.privacy || "public");
    postPrivacyInput.value = ["public", "followers", "private"].includes(nextPrivacy) ? nextPrivacy : "public";
  }
  if (postPublishAtInput) postPublishAtInput.value = String(draft.publishAt || "");
  setDraftStatus("Draft loaded.");
}

function clearDraft() {
  localStorage.removeItem(draftStorageKey);
  setDraftStatus("Draft cleared.");
}

postUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = postMediaInput.files && postMediaInput.files[0];
  if (!file) {
    postStatus.textContent = "Please choose a media file.";
    return;
  }

  postUploadBtn.disabled = true;
  postStatus.textContent = "";
  setProgress(postProgressWrap, postProgressBar, postProgressText, 0, "Uploading...");

  const formData = new FormData();
  formData.append("username", username);
  formData.append("caption", postCaptionInput.value || "");
  formData.append("privacy", postPrivacyInput.value || "public");
  formData.append("publishAt", (postPublishAtInput && postPublishAtInput.value) ? postPublishAtInput.value : "");
  formData.append("media", file);

  try {
    await uploadWithProgress(`${POSTS_API}/upload`, formData, (percent) => {
      setProgress(postProgressWrap, postProgressBar, postProgressText, percent, "Uploading...");
    });
    postStatus.textContent = "Post uploaded successfully.";
    postUploadForm.reset();
    clearDraft();
  } catch (err) {
    postStatus.textContent = err.message || "Could not upload post.";
  } finally {
    postUploadBtn.disabled = false;
    setTimeout(() => {
      resetProgress(postProgressWrap, postProgressBar, postProgressText, "Uploading...");
    }, 700);
  }
});

if (saveDraftBtn) {
  saveDraftBtn.addEventListener("click", () => saveDraft());
}
if (loadDraftBtn) {
  loadDraftBtn.addEventListener("click", loadDraft);
}
if (clearDraftBtn) {
  clearDraftBtn.addEventListener("click", clearDraft);
}
if (postCaptionInput) {
  postCaptionInput.addEventListener("input", () => {
    saveDraft({ silent: true });
  });
}
if (postPrivacyInput) {
  postPrivacyInput.addEventListener("change", () => {
    saveDraft({ silent: true });
  });
}
if (postPublishAtInput) {
  postPublishAtInput.addEventListener("change", () => {
    saveDraft({ silent: true });
  });
}

loadDraft();

storyUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = storyMediaInput.files && storyMediaInput.files[0];
  if (!file) {
    storyStatus.textContent = "Please choose a media file.";
    return;
  }

  storyUploadBtn.disabled = true;
  storyStatus.textContent = "";
  setProgress(storyProgressWrap, storyProgressBar, storyProgressText, 0, "Uploading...");

  const formData = new FormData();
  formData.append("media", file);

  try {
    await uploadWithProgress(`${STORIES_API}/upload`, formData, (percent) => {
      setProgress(storyProgressWrap, storyProgressBar, storyProgressText, percent, "Uploading...");
    });
    storyStatus.textContent = "Story uploaded successfully.";
    storyUploadForm.reset();
  } catch (err) {
    storyStatus.textContent = err.message || "Could not upload story.";
  } finally {
    storyUploadBtn.disabled = false;
    setTimeout(() => {
      resetProgress(storyProgressWrap, storyProgressBar, storyProgressText, "Uploading...");
    }, 700);
  }
});
