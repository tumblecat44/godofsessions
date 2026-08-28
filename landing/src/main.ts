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
