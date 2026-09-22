(async () => {
  const root = document.documentElement;
  // Mermaid measures the visible DOM. Keep theme, language and tab changes
  // together with their render so a later click cannot hide an active diagram.
  let diagramUpdates = Promise.resolve();
  const queueDiagramUpdate = (update) => {
    diagramUpdates = diagramUpdates.then(update).catch((error) => {
      console.error("Diagram update failed:", error);
    });
    return diagramUpdates;
  };
  const savedTheme = localStorage.getItem("direct-c9s-theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    root.dataset.theme = savedTheme;
  } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    root.dataset.theme = "light";
  }

  // Language toggle: every translated block carries data-lang="en" or data-lang="de";
  // CSS hides whichever language is not selected on <html data-lang="…">.
  const langButton = document.getElementById("langButton");
  const savedLang = localStorage.getItem("direct-c9s-lang");
  const applyLang = (lang) => {
    root.dataset.lang = lang;
    root.lang = lang;
    langButton.textContent = lang === "de" ? "EN" : "DE";
  };
  applyLang(
    savedLang === "de" || savedLang === "en"
      ? savedLang
      : (navigator.language || "").toLowerCase().startsWith("de")
        ? "de"
        : "en",
  );
  langButton.addEventListener("click", () => {
    queueDiagramUpdate(async () => {
      const next = root.dataset.lang === "de" ? "en" : "de";
      localStorage.setItem("direct-c9s-lang", next);
      applyLang(next);
      updateScrollState();
      await renderVisibleNodes();
    });
  });

  document.getElementById("pageSelect").addEventListener("change", (event) => {
    window.location.assign(event.currentTarget.value);
  });

  const mermaidNodes = [...document.querySelectorAll(".mermaid")];
  mermaidNodes.forEach((node) => {
    node.dataset.source = node.textContent.trim();
  });

  let mermaid;
  function mermaidConfig() {
    const dark = root.dataset.theme === "dark";
    return {
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },
      sequence: {
        useMaxWidth: true,
        wrap: true,
        diagramMarginX: 20,
        diagramMarginY: 20,
      },
      themeVariables: dark
        ? {
            background: "#0f1f2d",
            primaryColor: "#12364a",
            primaryTextColor: "#edf7f8",
            primaryBorderColor: "#69a9ff",
            lineColor: "#83a5b3",
            secondaryColor: "#173a34",
            tertiaryColor: "#2d2449",
            noteBkgColor: "#2f2b20",
            noteTextColor: "#edf7f8",
            noteBorderColor: "#ffc56b",
            actorBkg: "#12364a",
            actorBorder: "#69a9ff",
            actorTextColor: "#edf7f8",
            signalColor: "#9eb3bf",
            signalTextColor: "#edf7f8",
            labelBoxBkgColor: "#0f1f2d",
            labelBoxBorderColor: "#61e6cf",
            labelTextColor: "#edf7f8",
            clusterBkg: "#0b1723",
            clusterBorder: "#365767",
            fontFamily: "Inter, system-ui, sans-serif",
          }
        : {
            background: "#ffffff",
            primaryColor: "#e7f2f7",
            primaryTextColor: "#102c34",
            primaryBorderColor: "#1769c7",
            lineColor: "#526e78",
            secondaryColor: "#e4f5ef",
            tertiaryColor: "#eee8fa",
            noteBkgColor: "#fff4d9",
            noteTextColor: "#102c34",
            noteBorderColor: "#a85f00",
            actorBkg: "#e7f2f7",
            actorBorder: "#1769c7",
            actorTextColor: "#102c34",
            signalColor: "#526e78",
            signalTextColor: "#102c34",
            labelBoxBkgColor: "#ffffff",
            labelBoxBorderColor: "#007e70",
            labelTextColor: "#102c34",
            clusterBkg: "#f4faf9",
            clusterBorder: "#9eb5bb",
            fontFamily: "Inter, system-ui, sans-serif",
          },
    };
  }

  function setupDiagramControls(node) {
    const svg = node.querySelector("svg");
    const viewBoxAttr = svg?.getAttribute("viewBox");
    if (!viewBoxAttr) return;
    const home = viewBoxAttr.split(/[\s,]+/).map(Number);
    let view = [...home];
    const apply = () => svg.setAttribute("viewBox", view.join(" "));

    // cx/cy are the zoom focus as fractions of the svg element (0..1).
    const zoomAt = (factor, cx, cy) => {
      const width = Math.max(
        home[2] / 20,
        Math.min(home[2] * 8, view[2] / factor),
      );
      const height = view[3] * (width / view[2]);
      view = [
        view[0] + (view[2] - width) * cx,
        view[1] + (view[3] - height) * cy,
        width,
        height,
      ];
      apply();
    };
    const focus = (event) => {
      const rect = svg.getBoundingClientRect();
      return [
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      ];
    };

    let drag = null;
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, view: [...view] };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const rect = svg.getBoundingClientRect();
      view[0] =
        drag.view[0] - (event.clientX - drag.x) * (view[2] / rect.width);
      view[1] =
        drag.view[1] - (event.clientY - drag.y) * (view[3] / rect.height);
      apply();
    });
    const endDrag = () => {
      drag = null;
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    // Plain scroll keeps scrolling the page; ctrl/cmd+wheel (and trackpad pinch) zooms.
    svg.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, ...focus(event));
      },
      { passive: false },
    );
    svg.addEventListener("dblclick", (event) => {
      event.preventDefault();
      zoomAt(1.6, ...focus(event));
    });

    const title = node.closest(".diagram")?.querySelector(".diagram-title");
    if (!title) return;
    title.querySelector(".diagram-tools")?.remove();
    const tools = document.createElement("div");
    tools.className = "diagram-tools";
    for (const [label, hint, action] of [
      [
        "+",
        "Zoom in (ctrl+scroll or double-click the diagram)",
        () => zoomAt(1.3, 0.5, 0.5),
      ],
      ["−", "Zoom out", () => zoomAt(1 / 1.3, 0.5, 0.5)],
      [
        "⟲",
        "Reset view (drag the diagram to pan)",
        () => {
          view = [...home];
          apply();
        },
      ],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = hint;
      button.setAttribute("aria-label", hint);
      button.addEventListener("click", action);
      tools.append(button);
    }
    title.append(tools);
  }

  // Renders only diagrams that are pending AND visible. Diagrams inside a hidden tab panel
  // would be measured against a display:none container and come out broken, so they wait
  // until their tab is shown.
  async function renderVisibleNodes() {
    const pending = mermaidNodes.filter(
      (node) => node.dataset.rendered !== "yes" && node.offsetParent !== null,
    );
    if (!mermaid || !pending.length) return;
    for (const node of pending) {
      node.removeAttribute("data-processed");
      node.innerHTML = node.dataset.source;
    }
    try {
      await mermaid.run({ nodes: pending, suppressErrors: false });
      for (const node of pending) {
        node.dataset.rendered = "yes";
        setupDiagramControls(node);
      }
    } catch (error) {
      console.error("Mermaid rendering failed:", error);
    }
  }

  async function renderMermaid() {
    if (!mermaid) return;
    mermaid.initialize(mermaidConfig());
    for (const node of mermaidNodes) {
      node.dataset.rendered = "no";
      node.removeAttribute("data-processed");
      node.innerHTML = node.dataset.source;
    }
    await renderVisibleNodes();
    if (location.hash) {
      setTimeout(() => {
        const target = document.getElementById(location.hash.slice(1));
        if (target) {
          window.scrollTo({
            top: Math.max(0, target.offsetTop - 78),
            behavior: "instant",
          });
        }
      }, 50);
    }
  }

  document.getElementById("themeButton").addEventListener("click", () => {
    queueDiagramUpdate(async () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("direct-c9s-theme", root.dataset.theme);
      await renderMermaid();
    });
  });

  document.querySelectorAll("[data-tabs]").forEach((tabs) => {
    const buttons = [...tabs.querySelectorAll("[data-tab]")];
    const panels = [...tabs.querySelectorAll("[data-panel]")];
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        queueDiagramUpdate(async () => {
          buttons.forEach((item) =>
            item.setAttribute("aria-selected", String(item === button)),
          );
          panels.forEach((panel) =>
            panel.classList.toggle(
              "active",
              panel.dataset.panel === button.dataset.tab,
            ),
          );
          await renderVisibleNodes();
        });
      });
    });
  });

  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button
        .closest(".code-block")
        .querySelector("code").textContent;
      try {
        await navigator.clipboard.writeText(code);
        const previous = button.textContent;
        button.textContent = "copied";
        setTimeout(() => {
          button.textContent = previous;
        }, 1200);
      } catch {
        button.textContent = "select text";
      }
    });
  });

  const sections = [...document.querySelectorAll("section[id], div.wrap[id]")];
  const navLinks = [...document.querySelectorAll(".topnav a")];
  const updateScrollState = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    document.getElementById("progress").style.width =
      `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 115) current = section.id;
    }
    navLinks.forEach((link) =>
      link.classList.toggle("active", link.hash === `#${current}`),
    );
  };
  addEventListener("scroll", updateScrollState, { passive: true });
  addEventListener("resize", updateScrollState, { passive: true });
  updateScrollState();

  if (mermaidNodes.length) {
    try {
      ({ default: mermaid } =
        await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"));
      await queueDiagramUpdate(renderMermaid);
    } catch (error) {
      console.warn(
        "Mermaid could not be loaded; diagram source remains visible.",
        error,
      );
    }
  }
})();
