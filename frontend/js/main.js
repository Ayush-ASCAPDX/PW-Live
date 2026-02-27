AOS.init();
const BACKEND_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.backendOrigin) || "http://localhost:5000";

const text = ["Innovating Digital Experience", "Building Modern Solutions"];
let index = 0;
let char = 0;
const speed = 100;
const target = document.querySelector(".typing-text");

function typeEffect() {
  if (char < text[index].length) {
    target.textContent += text[index].charAt(char);
    char++;
    setTimeout(typeEffect, speed);
  } else {
    setTimeout(eraseEffect, 2000);
  }
}

function eraseEffect() {
  if (char > 0) {
    target.textContent = text[index].substring(0, char - 1);
    char--;
    setTimeout(eraseEffect, 60);
  } else {
    index = (index + 1) % text.length;
    setTimeout(typeEffect, 500);
  }
}

typeEffect();
const searchInput = document.querySelector(".search-input");
const noResult = document.getElementById("no-result");

function updateHomeEntryPoints({ loggedIn, displayName, username }) {
  const heroPrimaryCta = document.getElementById("heroPrimaryCta");
  const heroStatusLine = document.getElementById("heroStatusLine");
  const hubWelcome = document.getElementById("hubWelcome");
  const hubProfileLink = document.getElementById("hubProfileLink");

  if (!heroPrimaryCta && !heroStatusLine && !hubWelcome) return;

  if (loggedIn) {
    if (heroPrimaryCta) {
      heroPrimaryCta.textContent = "Go To Feed";
      heroPrimaryCta.setAttribute("href", "posts.html");
    }
    if (heroStatusLine) {
      const label = displayName || username || "there";
      heroStatusLine.textContent = `Welcome back, ${label}. Continue your conversations and posts.`;
    }
    if (hubWelcome) {
      hubWelcome.textContent = "You are signed in. Jump directly into the features below.";
    }
    if (hubProfileLink) {
      hubProfileLink.setAttribute("href", "profile.html");
    }
  } else {
    if (heroPrimaryCta) {
      heroPrimaryCta.textContent = "Create Account";
      heroPrimaryCta.setAttribute("href", "signup.html");
    }
    if (heroStatusLine) {
      heroStatusLine.textContent = "Start with signup, then jump into chat and posts.";
    }
    if (hubWelcome) {
      hubWelcome.textContent = "Everything is connected: your profile, feed, messages, and calls.";
    }
    if (hubProfileLink) {
      hubProfileLink.setAttribute("href", "login.html");
    }
  }
}

function highlightText(element, value) {
  const text = element.innerText;
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  element.innerHTML = value
    ? text.replace(regex, `<span class="highlight">$1</span>`)
    : text;
}

if (searchInput && noResult) {
  searchInput.addEventListener("keyup", function () {
    const value = this.value.toLowerCase();
    let found = false;

    // PROJECT SEARCH
    document.querySelectorAll("#projects .project").forEach(project => {
      const match = project.innerText.toLowerCase().includes(value);
      project.style.display = match ? "block" : "none";
      if (match && value) {
        highlightText(project, value);
        found = true;
      }
    });

    // TEAM SEARCH
    document.querySelectorAll(".team-card").forEach(member => {
      const match = member.innerText.toLowerCase().includes(value);
      member.style.display = match ? "block" : "none";
      if (match && value) {
        highlightText(member, value);
        found = true;
      }
    });

    // Reset highlight if input empty
    if (!value) {
      document.querySelectorAll(".project, .team-card").forEach(el => {
        el.innerHTML = el.innerText;
        el.style.display = "block";
      });
      noResult.style.display = "none";
      return;
    }

    // NO RESULT MESSAGE
    noResult.style.display = found ? "none" : "block";
  });
}
function scrollToFirstMatch(selector) {
  const firstMatch = document.querySelector(selector);
  if (firstMatch) {
    firstMatch.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
}
window.addEventListener("load", () => {
  const loader = document.getElementById("page-loader");
  document.body.classList.add("page-loaded");

  setTimeout(() => {
    loader.classList.add("hidden");
  }, 1800);
});

/* PAGE TRANSITION ON LINK CLICK */
document.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", e => {
    const href = link.getAttribute("href");

    if (href && href.startsWith("#")) return; // allow same-page scroll

    e.preventDefault();
    document.body.classList.remove("page-loaded");

    setTimeout(() => {
      window.location.href = href;
    }, 400);
  });
});
const contactForm = document.getElementById("contactForm");
if (contactForm) {
  contactForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const status = document.getElementById("form-status");
    status.textContent = "Sending...";
    status.style.color = "#fff";

    const btn = contactForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const formData = new FormData(contactForm);
    const payload = {
      name: formData.get('from_name'),
      email: formData.get('from_email'),
      message: formData.get('message')
    };

    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        status.textContent = data.message || 'Failed to send message';
        status.style.color = 'red';
      } else {
        status.textContent = data.message || 'Message received. Thank you!';
        status.style.color = 'lime';
        contactForm.reset();
      }
    } catch (err) {
      console.error(err);
      status.textContent = 'Server error. Try again later.';
      status.style.color = 'red';
    } finally {
      if (btn) btn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  });
}

async function profile() {
  const username = localStorage.getItem('username');
  const userId = localStorage.getItem('userId');
  const savedProfileRaw = username ? localStorage.getItem(`profile_${username}`) : null;
  let savedProfile = null;

  if (savedProfileRaw) {
    try {
      savedProfile = JSON.parse(savedProfileRaw);
    } catch (err) {
      savedProfile = null;
    }
  }

  const usernameDisplay = document.getElementById('usernameDisplay');
  const profileAvatar = document.getElementById('profileAvatar');
  const logoutBtn = document.getElementById('logoutBtn');
  const menuProfileBtn = document.getElementById('menuProfileBtn');
  const loginLink = document.getElementById('loginLink');
  const userDisplay = document.getElementById('userDisplay');
  const userDropdown = document.getElementById('userDropdown');
  const userMenuItem = document.querySelector('.user-menu-item');
  const displayName = (savedProfile && savedProfile.name) ? savedProfile.name : username;

  function closeUserDropdown() {
    if (userDropdown) {
      userDropdown.classList.remove('show');
      userDropdown.setAttribute('aria-hidden', 'true');
    }
    if (userDisplay) userDisplay.setAttribute('aria-expanded', 'false');
  }

  function openUserDropdown() {
    if (userDropdown) {
      userDropdown.classList.add('show');
      userDropdown.setAttribute('aria-hidden', 'false');
    }
    if (userDisplay) userDisplay.setAttribute('aria-expanded', 'true');
  }

  if (username && userId) {
    const knownUsersRaw = localStorage.getItem('known_users');
    let knownUsers = [];
    if (knownUsersRaw) {
      try {
        knownUsers = JSON.parse(knownUsersRaw);
      } catch (err) {
        knownUsers = [];
      }
    }
    if (!knownUsers.includes(username)) {
      knownUsers.push(username);
      localStorage.setItem('known_users', JSON.stringify(knownUsers));
    }

    if (usernameDisplay) usernameDisplay.innerText = displayName || username;
    updateHomeEntryPoints({
      loggedIn: true,
      displayName: displayName || username,
      username
    });
    if (userDisplay) userDisplay.setAttribute('href', '#');
    if (profileAvatar) {
      profileAvatar.src = (savedProfile && savedProfile.avatarUrl) ? savedProfile.avatarUrl : 'assets/default-avatar.svg';
      profileAvatar.alt = `${displayName || username} profile`;
    }
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
    if (loginLink) loginLink.style.display = 'none';
    if (userDisplay) userDisplay.style.display = 'inline-block';
    closeUserDropdown();

    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/users/profile/${encodeURIComponent(username)}`);
      if (res.ok) {
        const profileData = await res.json();
        localStorage.setItem(`profile_${username}`, JSON.stringify({
          name: profileData.name || username,
          bio: profileData.bio || "",
          avatarUrl: profileData.avatarUrl || ""
        }));

        if (usernameDisplay) usernameDisplay.innerText = profileData.name || username;
        updateHomeEntryPoints({
          loggedIn: true,
          displayName: profileData.name || username,
          username
        });
        if (profileAvatar) {
          profileAvatar.src = profileData.avatarUrl || 'assets/default-avatar.svg';
          profileAvatar.alt = `${profileData.name || username} profile`;
        }
      }
    } catch (err) {
      // keep local fallback when backend is not reachable
    }

    if (userDisplay) {
      userDisplay.onclick = (event) => {
        event.preventDefault();
        if (userDropdown && userDropdown.classList.contains('show')) {
          closeUserDropdown();
        } else {
          openUserDropdown();
        }
      };
    }

    if (menuProfileBtn) {
      menuProfileBtn.onclick = () => {
        closeUserDropdown();
      };
    }

    if (logoutBtn) {
      logoutBtn.onclick = () => {
        if (window.APP_CONFIG && window.APP_CONFIG.clearSession) {
          window.APP_CONFIG.clearSession({ skipServerLogout: true });
        } else {
          localStorage.removeItem('username');
          localStorage.removeItem('userId');
          localStorage.removeItem('userRole');
          localStorage.removeItem('authToken');
        }
        closeUserDropdown();
        window.location.href = 'login.html';
      };
    }

    document.addEventListener('click', (event) => {
      if (!userMenuItem) return;
      if (!userMenuItem.contains(event.target)) {
        closeUserDropdown();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeUserDropdown();
    });
  } else {
    updateHomeEntryPoints({ loggedIn: false, displayName: "", username: "" });
    if (usernameDisplay) usernameDisplay.innerText = '';
    if (profileAvatar) {
      profileAvatar.removeAttribute('src');
      profileAvatar.alt = 'Profile';
    }
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (loginLink) loginLink.style.display = 'inline-block';
    if (userDisplay) userDisplay.style.display = 'none';
    if (userDropdown) {
      userDropdown.classList.remove('show');
      userDropdown.setAttribute('aria-hidden', 'true');
    }
  }
}

profile();
