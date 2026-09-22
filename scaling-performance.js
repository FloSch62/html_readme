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

(() => {
  const form = document.getElementById("capacityCalculator");
  const fields = [...form.querySelectorAll('input[type="number"]')];
  const profiles = {
    srl: [2, 2],
    frr: [0.1, 0.25],
    srsim: [2, 4],
    busybox: [0.01, 0.03125],
  };
  const hardware = { small: [8, 32], medium: [16, 64], large: [32, 128] };
  const get = (id) => document.getElementById(id);
  const selected = (name) =>
    form.querySelector(`input[name="${name}"]:checked`)?.value;
  const set = (id, value) => {
    get(id).value = value;
  };
  const floor = (value) => Math.floor(value + 1e-9);

  function fit(slots, cpu, ram, requestCPU, requestRAM) {
    return Math.max(
      0,
      Math.min(slots, floor(cpu / requestCPU), floor(ram / requestRAM)),
    );
  }

  // Pack identical routers first, then clients into their remaining capacity.
  // Keep repeated placements as groups, so large estimates do not create huge arrays.
  function estimate(v, routers, clients) {
    const slots = v.capMaxPods - v.capReservedPods;
    const cpu = v.capCPU - v.capReservedCPU;
    const ram = v.capRAM - v.capReservedRAM;
    const routerFit = fit(slots, cpu, ram, v.capPodCPU, v.capPodRAM);
    const clientFit = fit(slots, cpu, ram, v.capClientCPU, v.capClientRAM);
    if ((routers > 0 && routerFit < 1) || (clients > 0 && clientFit < 1))
      return null;
    const base = [];
    const add = (list, workers, r, c = 0) => {
      if (workers > 0) list.push({ workers, routers: r, clients: c });
    };
    if (routers > 0) {
      add(base, Math.floor(routers / routerFit), routerFit);
      add(base, routers % routerFit ? 1 : 0, routers % routerFit);
    }
    const placement = [];
    let remaining = clients;
    for (const group of base) {
      const capacity = fit(
        slots - group.routers,
        cpu - group.routers * v.capPodCPU,
        ram - group.routers * v.capPodRAM,
        v.capClientCPU,
        v.capClientRAM,
      );
      const full =
        capacity > 0
          ? Math.min(group.workers, Math.floor(remaining / capacity))
          : 0;
      add(placement, full, group.routers, capacity);
      remaining -= full * capacity;
      let unused = group.workers - full;
      if (unused > 0 && capacity > 0 && remaining > 0) {
        const take = Math.min(remaining, capacity);
        add(placement, 1, group.routers, take);
        remaining -= take;
        unused -= 1;
      }
      add(placement, unused, group.routers);
    }
    if (remaining > 0) {
      add(placement, Math.floor(remaining / clientFit), 0, clientFit);
      add(placement, remaining % clientFit ? 1 : 0, 0, remaining % clientFit);
    }
    const workers = placement.reduce((sum, group) => sum + group.workers, 0);
    return {
      slots,
      cpu,
      ram,
      routerFit,
      routers,
      workers,
      placement,
      demandCPU: routers * v.capPodCPU + clients * v.capClientCPU,
      demandRAM: routers * v.capPodRAM + clients * v.capClientRAM,
    };
  }

  // Search the same router-first layout used by forward sizing. Adding a router
  // only removes residual client capacity, so the fit predicate is monotone.
  function capacity(v, workers, clients) {
    const empty = estimate(v, 0, clients);
    if (
      !empty ||
      empty.workers > workers ||
      empty.cpu < 0 ||
      empty.ram < 0 ||
      empty.slots < 0
    )
      return null;
    let low = 0;
    let high = workers * empty.routerFit;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      const candidate = estimate(v, count, clients);
      if (candidate && candidate.workers <= workers) low = count;
      else high = count - 1;
    }
    const result = estimate(v, low, clients);
    if (result.workers < workers)
      result.placement.push({
        workers: workers - result.workers,
        routers: 0,
        clients: 0,
      });
    result.workers = workers;
    return result;
  }

  function render() {
    const de = document.documentElement.dataset.lang === "de";
    const t = (en, german) => (de ? german : en);
    const fmt = (n) =>
      n.toLocaleString(de ? "de-DE" : "en-US", { maximumFractionDigits: 3 });
    const mode = selected("capacityMode");
    const reverse = mode === "cluster";
    get("calcClusterFields").hidden = !reverse;
    get("capWorkers").disabled = !reverse;
    get("calcResultLabel").textContent = reverse
      ? t("Your device capacity estimate", "Deine Geräte-Kapazitätsschätzung")
      : t("Your worker estimate", "Deine Worker-Schätzung");
    get("calcCountFields").hidden = mode !== "count";
    get("calcClosFields").hidden = mode !== "clos";
    get("capDevices").disabled = mode !== "count";
    for (const id of ["capGroups", "capLeaves", "capSpines", "capSupers"])
      get(id).disabled = mode !== "clos";
    get("calcCustomHardware").hidden =
      selected("capacityHardware") !== "custom";
    form.querySelectorAll("[data-router-count]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.routerCount === get("capDevices").value),
      );
    });
    const profile = selected("capacityProfile");
    const nos = profile === "srl" || profile === "srsim";
    get("calcNosBudget").hidden = !nos;
    const nosCPU = Number(selected("capacityNosCPU"));
    get("calcSrlBudget").textContent = `${fmt(nosCPU)} CPU · 2 GiB`;
    get("calcSrsimBudget").textContent = `${fmt(nosCPU)} CPU · 4 GiB`;
    get("calcProfileHint").textContent =
      profile === "custom"
        ? t(
            "Custom software selected. Set the CPU and RAM budget per device below; use the effective Pod request including helpers and init containers, then allow for operating headroom.",
            "Eigene Software gewählt. CPU- und RAM-Budget pro Gerät unten einstellen; den effektiven Pod-Request einschließlich Helfern und Init-Containern sowie Betriebsreserve berücksichtigen.",
          )
        : nos && nosCPU === 0.5
          ? t(
              "Slimmed-down benchmark CPU budget active. Use 1–2 vCPU for safer general planning, and validate your workload.",
              "Abgespecktes Benchmark-CPU-Budget aktiv. Für eine vorsichtigere allgemeine Planung 1–2 vCPU nutzen und den Workload prüfen.",
            )
          : t(
              "One device Pod per router; clients have a separate budget. Editing a router budget selects Custom software.",
              "Ein Geräte-Pod pro Router; Clients haben ein eigenes Budget. Ein geändertes Router-Budget wählt Eigene Software.",
            );
    const invalid = fields.find(
      (field) =>
        !field.disabled &&
        (!field.validity.valid || !Number.isFinite(field.valueAsNumber)),
    );
    fields.forEach((field) =>
      field.setAttribute("aria-invalid", String(field === invalid)),
    );
    const error = (message) => {
      get("capacityError").textContent = message;
      get("calcMobileEstimate").textContent = t(
        "Check inputs",
        "Eingaben prüfen",
      );
      get("capacityError").hidden = false;
      get("calcValidResult").hidden = true;
      get("calcTopologyHint").textContent = t(
        "Complete the inputs to see your topology size.",
        "Eingaben vervollständigen, um die Topologiegröße zu sehen.",
      );
      get("calcHardwareHint").textContent = "";
      for (const key of Object.keys(hardware))
        get(`calcPreview-${key}`).textContent = "—";
    };
    if (invalid) {
      if (invalid.closest("details")) invalid.closest("details").open = true;
      const label = invalid
        .closest("label")
        .querySelector(`[data-lang="${de ? "de" : "en"}"]`).textContent;
      error(
        t(
          `Check “${label}”: enter a valid ${invalid.step === "1" ? "whole " : ""}number of at least ${invalid.min}.`,
          `„${label}“ prüfen: eine gültige ${invalid.step === "1" ? "ganze " : ""}Zahl ab ${invalid.min} eingeben.`,
        ),
      );
      return;
    }
    const v = Object.fromEntries(
      fields.map((field) => [field.id, field.valueAsNumber]),
    );
    let routers =
      mode === "clos"
        ? v.capGroups * (v.capLeaves + v.capSpines) + v.capSupers
        : v.capDevices;
    const clients = v.capClients;
    const result = reverse
      ? capacity(v, v.capWorkers, clients)
      : estimate(v, routers, clients);
    if (reverse) routers = result?.routers ?? 0;
    const pods = routers + clients;
    const links =
      mode === "clos"
        ? v.capGroups * v.capLeaves * v.capSpines +
          v.capGroups * v.capSpines * v.capSupers +
          clients
        : null;
    if (
      !Number.isSafeInteger(pods) ||
      (links !== null && !Number.isSafeInteger(links))
    ) {
      error(
        t(
          "This topology is too large for the calculator. Reduce the counts.",
          "Diese Topologie ist für den Rechner zu groß. Die Anzahlen reduzieren.",
        ),
      );
      return;
    }
    if (!result || !Number.isFinite(result.workers * (v.capCPU + v.capRAM))) {
      error(
        reverse
          ? t(
              "The clients or reserves do not fit in this cluster. Reduce clients, increase workers, or review the budgets and reserves.",
              "Clients oder Reserven passen nicht in diesen Cluster. Clients reduzieren, Worker ergänzen oder Budgets und Reserven prüfen.",
            )
          : t(
              "A device cannot fit on this worker after reserves. Choose a larger worker or review the budgets and reserves below.",
              "Ein Gerät passt nach Abzug der Reserve nicht auf diesen Worker. Größeren Worker wählen oder Budgets und Reserven unten prüfen.",
            ),
      );
      return;
    }
    get("capacityError").hidden = true;
    get("calcValidResult").hidden = false;
    get("calcTopologyHint").textContent =
      mode === "clos"
        ? t(
            `${fmt(routers)} routers + ${fmt(clients)} clients = ${fmt(pods)} device Pods · ${fmt(links)} links. Each leaf connects to every spine in its group; every spine connects to all superspines; one link per client.`,
            `${fmt(routers)} Router + ${fmt(clients)} Clients = ${fmt(pods)} Geräte-Pods · ${fmt(links)} Links. Jeder Leaf verbindet sich mit allen Gruppen-Spines, jeder Spine mit allen Superspines; ein Link pro Client.`,
          )
        : t(
            `${fmt(routers)} devices + ${fmt(clients)} clients = ${fmt(pods)} device Pods. Excludes system and planner Pods, which are covered by the worker reserve.`,
            `${fmt(routers)} Geräte + ${fmt(clients)} Clients = ${fmt(pods)} Geräte-Pods. System- und Planner-Pods sind in der Worker-Reserve enthalten.`,
          );
    get("calcHardwareHint").textContent = t(
      `${fmt(result.cpu)} vCPU, ${fmt(result.ram)} GiB and ${fmt(result.slots)} Pod slots available per worker after reserves. Pod ceiling: ${fmt(v.capMaxPods)}.`,
      `Nach Reserve pro Worker verfügbar: ${fmt(result.cpu)} vCPU, ${fmt(result.ram)} GiB und ${fmt(result.slots)} Pod-Slots. Pod-Limit: ${fmt(v.capMaxPods)}.`,
    );
    const count = reverse ? routers : result.workers;
    const unit = reverse
      ? t(
          count === 1 ? "router / device" : "routers / devices",
          "Router / Geräte",
        )
      : t(count === 1 ? "worker" : "workers", "Worker");
    get("capacityResult").innerHTML =
      `<strong class="calc-worker-number">${fmt(count)}</strong><span>${unit}</span>`;
    get("capacityDetail").textContent = reverse
      ? t(
          `Plus ${fmt(clients)} clients · ${fmt(pods)} device Pods in total on ${fmt(result.workers)} workers, each ${fmt(v.capCPU)} vCPU / ${fmt(v.capRAM)} GiB`,
          `Plus ${fmt(clients)} Clients · insgesamt ${fmt(pods)} Geräte-Pods auf ${fmt(result.workers)} Workern mit je ${fmt(v.capCPU)} vCPU / ${fmt(v.capRAM)} GiB`,
        )
      : t(
          `Each with ${fmt(v.capCPU)} vCPU / ${fmt(v.capRAM)} GiB · for ${fmt(pods)} device Pods`,
          `Jeweils ${fmt(v.capCPU)} vCPU / ${fmt(v.capRAM)} GiB · für ${fmt(pods)} Geräte-Pods`,
        );
    get("calcMobileEstimate").textContent = reverse
      ? t(
          `${fmt(routers)} devices + ${fmt(clients)} clients`,
          `${fmt(routers)} Geräte + ${fmt(clients)} Clients`,
        )
      : t(
          `${fmt(result.workers)} ${result.workers === 1 ? "worker" : "workers"} estimated`,
          `${fmt(result.workers)} Worker geschätzt`,
        );
    get("calcTotalCPU").textContent = fmt(result.workers * v.capCPU);
    get("calcTotalRAM").textContent = fmt(result.workers * v.capRAM);
    const limits = [
      result.slots,
      floor(result.cpu / v.capPodCPU),
      floor(result.ram / v.capPodRAM),
    ];
    const labels = [t("Pod slots", "Pod-Slots"), "CPU", "RAM"];
    const limiting = labels
      .filter((_, i) => limits[i] === result.routerFit)
      .join(" + ");
    get("calcBottleneck").textContent = t(
      `Up to ${fmt(result.routerFit)} routers per worker. Router density is limited by ${limiting}.`,
      `Bis zu ${fmt(result.routerFit)} Router pro Worker. Die Router-Dichte wird durch ${limiting} begrenzt.`,
    );
    const resources = [
      {
        label: "CPU",
        demand: result.demandCPU,
        reserved: result.workers * v.capReservedCPU,
        total: result.workers * v.capCPU,
        unit: "vCPU",
      },
      {
        label: "RAM",
        demand: result.demandRAM,
        reserved: result.workers * v.capReservedRAM,
        total: result.workers * v.capRAM,
        unit: "GiB",
      },
      {
        label: "Pods",
        demand: pods,
        reserved: result.workers * v.capReservedPods,
        total: result.workers * v.capMaxPods,
        unit: t("slots", "Slots"),
      },
    ];
    get("calcBudgetBars").replaceChildren(
      ...resources.map((r) => {
        const node = document.createElement("div");
        node.className = "calc-resource";
        const free = Math.max(0, r.total - r.demand - r.reserved);
        node.innerHTML = `<div class="calc-resource-label"><strong>${r.label}</strong><span>${fmt(r.demand)} / ${fmt(r.total)} ${r.unit}</span></div><div class="calc-resource-track" aria-hidden="true"><span class="device" style="width:${(100 * r.demand) / r.total}%"></span><span class="reserved" style="width:${(100 * r.reserved) / r.total}%"></span></div><p>${t(`${fmt(r.reserved)} reserved · ${fmt(free)} unallocated`, `${fmt(r.reserved)} reserviert · ${fmt(free)} unverplant`)}</p>`;
        return node;
      }),
    );
    get("calcPlacement").replaceChildren(
      ...result.placement.map((group) => {
        const row = document.createElement("p");
        row.className = "calc-placement-row";
        row.textContent = t(
          `${fmt(group.workers)} × worker with ${fmt(group.routers)} routers + ${fmt(group.clients)} clients`,
          `${fmt(group.workers)} × Worker mit ${fmt(group.routers)} Routern + ${fmt(group.clients)} Clients`,
        );
        return row;
      }),
    );
    const note = document.createElement("p");
    note.className = "calc-hint";
    note.textContent = reverse
      ? t(
          "Finds the largest router count that fits this router-first layout while accommodating all clients. Other placements may fit more. This is a scheduling-budget estimate, not a measured operating limit; Kubernetes placement, boot peaks and traffic can reduce usable capacity.",
          "Ermittelt die größte Router-Anzahl für diese Router-zuerst-Verteilung einschließlich aller Clients. Andere Verteilungen können mehr ermöglichen. Dies ist eine Scheduling-Budgetschätzung, keine gemessene Betriebsgrenze; Kubernetes-Platzierung, Boot-Spitzen und Traffic können die nutzbare Kapazität reduzieren.",
        )
      : t(
          "Packs routers first, then clients into the remaining space. This is a feasible budget layout, not a prediction of Kubernetes placement or proof of the minimum worker count.",
          "Platziert zuerst Router, danach Clients im freien Budget. Dies ist eine mögliche Budgetverteilung, keine Vorhersage der Kubernetes-Platzierung oder ein Beweis der minimalen Worker-Anzahl.",
        );
    get("calcPlacement").append(note);
    get("calcNextStep").textContent = limiting.includes(labels[0])
      ? t(
          "More RAM alone will not add Pod slots. Add workers or deliberately validate a higher Pod limit.",
          "Mehr RAM allein schafft keine Pod-Slots. Worker ergänzen oder ein höheres Pod-Limit gezielt validieren.",
        )
      : t(
          "Compare the worker sizes on the left. More RAM or CPU can fit more routers, until Pod slots become the limit.",
          "Worker-Größen vergleichen. Mehr RAM oder CPU ermöglicht mehr Router, bis Pod-Slots begrenzen.",
        );
    for (const [key, [cpu, ram]] of Object.entries(hardware)) {
      const previewValues = {
        ...v,
        capCPU: cpu,
        capRAM: ram,
        capReservedCPU: cpu / 8,
        capReservedRAM: ram / 8,
      };
      const preview = reverse
        ? capacity(previewValues, v.capWorkers, clients)
        : estimate(previewValues, routers, clients);
      get(`calcPreview-${key}`).textContent = preview
        ? reverse
          ? t(
              `${fmt(preview.routers)} devices`,
              `${fmt(preview.routers)} Geräte`,
            )
          : t(
              `${fmt(preview.workers)} ${preview.workers === 1 ? "worker" : "workers"}`,
              `${fmt(preview.workers)} Worker`,
            )
        : t("Does not fit", "Passt nicht");
    }
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", (event) => {
    const field = event.target;
    if (field.name === "capacityProfile" && profiles[field.value]) {
      const [cpu, ram] = profiles[field.value];
      set(
        "capPodCPU",
        ["srl", "srsim"].includes(field.value)
          ? selected("capacityNosCPU")
          : cpu,
      );
      set("capPodRAM", ram);
    }
    if (field.name === "capacityNosCPU") set("capPodCPU", field.value);
    if (field.name === "capacityHardware" && hardware[field.value]) {
      const [cpu, ram] = hardware[field.value];
      set("capCPU", cpu);
      set("capRAM", ram);
      set("capReservedCPU", cpu / 8);
      set("capReservedRAM", ram / 8);
    }
    render();
  });
  form.addEventListener("input", (event) => {
    if (event.target.type !== "number") return;
    if (["capPodCPU", "capPodRAM"].includes(event.target.id)) {
      form.querySelectorAll('[name="capacityProfile"]').forEach((radio) => {
        radio.checked = radio.value === "custom";
      });
    }
    render();
  });
  form.querySelectorAll("[data-router-count]").forEach((button) =>
    button.addEventListener("click", () => {
      set("capDevices", button.dataset.routerCount);
      render();
    }),
  );
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    for (const input of form.querySelectorAll("input")) {
      if (input.type === "radio") input.checked = input.defaultChecked;
      else input.value = input.defaultValue;
    }
    get("calcAdvanced").open = false;
    render();
  });
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-lang"],
  });
  render();
})();
