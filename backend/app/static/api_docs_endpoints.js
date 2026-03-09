(function () {
  const input = document.getElementById("endpointSearch");
  const cards = Array.from(document.querySelectorAll(".endpoint-card"));
  const list = document.querySelector(".endpoint-list");
  const noResults = document.getElementById("endpointNoResults");
  if (!input || !cards.length || !list) return;

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^\w/{}-]+/g, " ")
      .trim();

  const index = cards.map((card) => {
    const method = normalize(card.dataset.method);
    const path = normalize(card.dataset.path);
    const keywords = normalize(card.dataset.search);
    const description = normalize(card.querySelector("p")?.textContent);
    return { card, method, path, keywords, description };
  });

  input.addEventListener("input", (e) => {
    const rawQuery = normalize(e.target.value);
    const terms = rawQuery.split(/\s+/).filter(Boolean);

    let visibleCount = 0;
    const scored = [];

    index.forEach((entry) => {
      const searchable = `${entry.method} ${entry.path} ${entry.keywords} ${entry.description}`;
      const matchesAllTerms = terms.every((term) => searchable.includes(term));

      if (!terms.length || matchesAllTerms) {
        let score = 0;
        terms.forEach((term) => {
          if (entry.path.includes(term)) score += 4;
          if (entry.method.includes(term)) score += 3;
          if (entry.keywords.includes(term)) score += 2;
          if (entry.description.includes(term)) score += 1;
        });
        scored.push({ ...entry, score });
        entry.card.style.display = "";
        visibleCount += 1;
      } else {
        entry.card.style.display = "none";
      }
    });

    if (terms.length) {
      scored
        .sort((a, b) => b.score - a.score)
        .forEach((entry) => list.appendChild(entry.card));
    }

    if (noResults) {
      noResults.hidden = visibleCount !== 0;
    }
  });
})();
