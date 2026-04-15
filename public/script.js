(function () {
  // Algorand / blockchain compatibility
  window.global = window;
  window.globalThis = window;

  var loadingScreen = document.getElementById("loading-screen");
  var skipButton = document.getElementById("skip-loading");

  function hideLoadingScreen() {
    if (!loadingScreen) {
      return;
    }

    loadingScreen.classList.add("is-hidden");

    window.setTimeout(function () {
      if (loadingScreen) {
        loadingScreen.remove();
      }
    }, 380);
  }

  // Standard hide behavior once app scripts are loaded.
  window.addEventListener("load", function () {
    window.setTimeout(hideLoadingScreen, 180);
  });

  // Fallback for slow or failed module load.
  window.setTimeout(hideLoadingScreen, 6000);

  if (skipButton) {
    skipButton.addEventListener("click", hideLoadingScreen);
  }
})();
