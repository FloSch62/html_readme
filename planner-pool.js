(() => {
  const count = document.getElementById("workerCount");
  const advance = document.getElementById("advance");
  const workers = document.getElementById("workers");
  const status = document.getElementById("poolStatus");
  const total = 12;
  let started = 0;
  let completed = 0;
  let slots = [];

  function paint() {
    const de = document.documentElement.dataset.lang === "de";
    workers.replaceChildren(
      ...slots.map((slot, i) => {
        const box = document.createElement("div");
        box.className = `worker${slot.node ? " busy" : ""}`;
        const title = document.createElement("b");
        title.textContent = `Worker ${i + 1}`;
        const task = document.createElement("span");
        task.textContent = slot.node
          ? `${de ? "Plant" : "Planning"} r${slot.node}`
          : de
            ? "Verfügbar"
            : "Available";
        const process = document.createElement("span");
        process.textContent = slot.node
          ? `${de ? "Frischer Prozess" : "Fresh process"} ${slot.process}`
          : `${slot.process} ${de ? "Prozesse beendet" : "processes finished"}`;
        box.append(title, task, process);
        return box;
      }),
    );
    const busy = slots.filter((slot) => slot.node).length;
    status.textContent = de
      ? `${total - started} wartend · ${busy} in Arbeit · ${completed} fertig. Dieselben ${slots.length} Worker-Pods bleiben bestehen.`
      : `${total - started} waiting · ${busy} planning · ${completed} complete. The same ${slots.length} worker Pods remain.`;
    advance.disabled = completed === total;
  }
  function reset() {
    started = 0;
    completed = 0;
    slots = Array.from({ length: Number(count.value) }, () => ({
      node: null,
      process: 0,
    }));
    paint();
  }
  advance.addEventListener("click", () => {
    for (const slot of slots) {
      if (slot.node) completed++;
      slot.node = null;
      if (started < total) {
        slot.node = ++started;
        slot.process++;
      }
    }
    paint();
  });
  count.addEventListener("change", reset);
  document.getElementById("reset").addEventListener("click", reset);
  new MutationObserver(paint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-lang"],
  });
  reset();
})();
