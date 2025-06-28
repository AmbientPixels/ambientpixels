// /auth/authUI.js
// /auth/authUI.js (UMD build, uses window.login/logout/getAccount)
document.addEventListener("DOMContentLoaded", function() {
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const userGreeting = document.getElementById("user-greeting");

  function updateUI() {
    const user = window.getAccount();
    if (user) {
      loginBtn.style.display = "none";
      logoutBtn.style.display = "";
      userGreeting.style.display = "";
      userGreeting.textContent = `Welcome, ${user.name || user.username || user.localAccountId}`;
    } else {
      loginBtn.style.display = "";
      logoutBtn.style.display = "none";
      userGreeting.style.display = "none";
    }
  }

  if (loginBtn) loginBtn.onclick = window.login;
  if (logoutBtn) logoutBtn.onclick = window.logout;
  updateUI();

  // Optionally, listen for MSAL events to update UI after login/logout
  window.addEventListener("msal:login", updateUI);
  window.addEventListener("msal:logout", updateUI);
});
