// ----------------------
// Cloudinary config
// ----------------------
const cloudName = "de9ugpvam";           // Your Cloudinary cloud name
const unsignedUploadPreset = "Ascapdx";  // Your unsigned upload preset

// ----------------------
// Firebase config
// ----------------------
const firebaseConfig = {
  apiKey: "AIzaSyB2qm48FSeNRieuFAvnlDAXnTUw_7La0No",
  authDomain: "pwpw-2ccd3.firebaseapp.com",
  projectId: "pwpw-2ccd3",
  storageBucket: "pwpw-2ccd3.firebasestorage.app",
  messagingSenderId: "676504583768",
  appId: "1:676504583768:web:0957273a909b199ff2d42d",
  measurementId: "G-S1KCZN47L5"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ----------------------
// DOM elements
// ----------------------
const addBtn = document.getElementById('add-video-btn');
const videoFileInput = document.getElementById('video-file');
const videoNameInput = document.getElementById('video-name');
const videoList = document.getElementById('video-list');
const mainVideo = document.getElementById('main-video');
const videoTitle = document.getElementById('video-title');

// ----------------------
// Load all videos from Firestore on page load
// ----------------------
async function loadVideos() {
  videoList.innerHTML = '';
  const snapshot = await db.collection('videos').orderBy('createdAt', 'desc').get();
  snapshot.forEach(doc => {
    const { title, url } = doc.data();
    addVideoToUI(title, url, doc.id);
  });
}


loadVideos();

// ----------------------
// Upload new video
// ----------------------
addBtn.addEventListener('click', async () => {
  const file = videoFileInput.files[0];
  const title = videoNameInput.value.trim();
  if (!file || !title) return alert('Select a video and enter a title');

  try {
    // Upload to Cloudinary
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', unsignedUploadPreset);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    const url = data.secure_url;

    // Save metadata to Firestore
    await db.collection('videos').add({
      title,
      url,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Add video to UI
    addVideoToUI(title, url);

    videoFileInput.value = '';
    videoNameInput.value = '';
  } catch (err) {
    console.error(err);
    alert('Upload failed! Check console.');
  }
});

// ----------------------
// Add video element to UI
// ----------------------
function addVideoToUI(title, url, docId = null) {
  const div = document.createElement('div');
  div.classList.add('video-item');
  div.innerHTML = `
    <video src="${url}" muted></video>
    <p>${title}</p>
    <button class="delete-btn">Delete</button>
  `;

  // Play video on click
  div.querySelector('video').addEventListener('click', () => {
    mainVideo.src = url;
    videoTitle.textContent = title;
    mainVideo.play();
  });

  // Delete button
  div.querySelector('.delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this video?')) return;

    try {
      // Delete Firestore document
      if (docId) {
        await db.collection('videos').doc(docId).delete();
      }

      // Delete from Cloudinary using Fetch API (unsigned delete is limited)
      // Note: For real deletion, Cloudinary recommends using server-side API with API Key & Secret
      // Here we’ll just remove from UI for simplicity
      div.remove();
    } catch (err) {
      console.error(err);
      alert('Failed to delete video');
    }
  });

  videoList.appendChild(div);
}

