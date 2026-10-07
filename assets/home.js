// Fills the 365 teaser on the home page from the same data file the gallery uses.
(() => {
  const data = window.CHALLENGE;
  const target = document.getElementById("home-status");
  if (!data || !target) return;
  const built = data.projects.filter((p) => p.built);
  if (!built.length) return;
  const latest = built[built.length - 1];
  target.textContent = `${built.length} of ${data.projects.length} built. Latest: ${latest.title}.`;
})();
