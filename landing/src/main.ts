import "./styles.css";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealTargets = document.querySelectorAll<HTMLElement>(
  ".timeline article, .outcome-list article, .approval > *, .open-source > *, .method > *, .final-cta > *",
);

revealTargets.forEach((element) => element.classList.add("reveal"));
if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  revealTargets.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8%" });
  revealTargets.forEach((element) => observer.observe(element));
}

const downloadLinks = document.querySelectorAll<HTMLAnchorElement>("[data-download-link]");
const artifactState = document.querySelector<HTMLElement>("[data-artifact-state]");
const firstDownload = downloadLinks[0];

if (firstDownload) {
  const artifactHref = firstDownload.dataset.artifactHref ?? "";
  fetch(`${new URL(artifactHref, window.location.href).href}.checksum.txt`, { method: "HEAD" })
    .then((response) => {
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) throw new Error("artifact unavailable");
      artifactState?.classList.add("is-ready");
    })
    .catch(() => {
      downloadLinks.forEach((link) => {
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("title", "The verified macOS build is not available yet.");
        link.addEventListener("click", (event) => event.preventDefault());
      });
    });
}
