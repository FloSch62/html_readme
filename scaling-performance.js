(() => {
  const metric = document.getElementById("metric");
  // September 2026 measurements from docs/guides/scaling-performance.md.
  // The comparison includes both controller changes and startup batching.
  const measurements = {
    ready: {
      before: 789.9,
      after: 314.9,
      label: ["Topology Ready", "Topology Ready"],
      note: [
        "Observed Topology readiness; network verification is timed separately.",
        "Beobachtete Topology-Bereitschaft; die Netzwerkprüfung wird separat gemessen.",
      ],
    },
    plans: {
      before: 338,
      after: 267,
      label: ["Last plan applied", "Letzter Plan angewendet"],
      note: [
        "Time to the last applied plan includes waiting for earlier batches. It is not pure planner execution time.",
        "Die Zeit bis zum letzten angewendeten Plan enthält das Warten auf frühere Batches. Sie ist keine reine Planner-Laufzeit.",
      ],
    },
    pods: {
      before: 340,
      after: 290,
      label: ["Last Pod created", "Letzter Pod erzeugt"],
      note: [
        "Pod creation is separate from Deployment and ReplicaSet creation, scheduling, sandbox preparation and readiness.",
        "Die Pod-Erzeugung ist getrennt von Deployment- und ReplicaSet-Erzeugung, Einplanung, Sandbox-Vorbereitung und Bereitschaft.",
      ],
    },
    podReady: {
      before: 774,
      after: 311,
      label: ["Last Pod Ready", "Letzter Pod Ready"],
      note: [
        "Server-relative Pod Ready timestamps. The controller observes and aggregates readiness afterward.",
        "Serverrelative Pod-Ready-Zeitstempel. Der Controller beobachtet und bündelt die Bereitschaft anschließend.",
      ],
    },
    sandbox: {
      before: 430,
      after: 4,
      label: ["Sandbox p95", "Sandbox p95"],
      note: [
        "p95 of the interval from PodScheduled to PodReadyToStartContainers. This includes kubelet, volumes and runtime network setup; it is not a pure CNI timer.",
        "p95 des Intervalls von PodScheduled bis PodReadyToStartContainers. Es umfasst Kubelet, Volumes und Runtime-Netzaufbau; es ist kein reiner CNI-Zeitwert.",
      ],
    },
  };

  function render() {
    const de = document.documentElement.dataset.lang === "de";
    const language = de ? 1 : 0;
    const current = measurements[metric.value];
    for (const option of metric.options) {
      option.textContent = measurements[option.value].label[language];
    }
    for (const key of ["before", "after"]) {
      document.getElementById(`${key}Value`).textContent =
        `${current[key].toLocaleString(de ? "de-DE" : "en-US")}s`;
      document.getElementById(`${key}Bar`).style.width =
        `${(current[key] / current.before) * 100}%`;
    }
    const notes = document.querySelectorAll(".metric-note");
    notes[0].textContent = current.note[0];
    notes[1].textContent = current.note[1];
  }

  metric.addEventListener("change", render);
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-lang"],
  });
  render();
})();
