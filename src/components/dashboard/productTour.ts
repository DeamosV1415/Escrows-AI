import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import "./productTour.css";

/**
 * The guided product tour, powered by Driver.js (MIT, ~5kb, framework-agnostic so it
 * has zero React-version coupling). Steps spotlight the sidebar nav + the floating
 * Copilot; targets are matched by `data-tour="…"` attributes so markup can move freely.
 * A step whose `element` can't be found gracefully renders as a centered card.
 */

const steps: DriveStep[] = [
  {
    popover: {
      title: "Welcome to Tachikiba ✨",
      description:
        "Here's a 60-second tour of where everything lives. You can skip anytime — let's take a quick look around.",
    },
  },
  {
    element: '[data-tour="nav-dashboard"]',
    popover: {
      title: "Your dashboard",
      description:
        "Your daily command center — hot leads, next actions, pipeline and activity, all at a glance.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-clients"]',
    popover: {
      title: "Clients",
      description:
        "Every lead and deal in one place. Track intent, budget, stage and the next action for each contact.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-inventory"]',
    popover: {
      title: "Inventory",
      description:
        "Your listings and properties — ready to match against buyers and drop straight into messages.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-sequences"]',
    popover: {
      title: "Sequences — the heart of Tachikiba",
      description:
        "Build automated, multi-step follow-ups across email & WhatsApp. Set the steps, the timing and the conditions once, and every lead gets nurtured for you — on autopilot. You can even create one by just describing it to the AI.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-inbox"]',
    popover: {
      title: "Inbox",
      description:
        "Replies land right here, synced from your own Gmail — so conversations stay in one thread.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="copilot-bubble"]',
    popover: {
      title: "Your AI Copilot",
      description:
        "Available on every page. Ask it to draft a message, update a client, build a sequence or answer a question — it acts inside your workspace.",
      side: "left",
      align: "end",
    },
  },
  {
    popover: {
      title: "You're all set 🎉",
      description:
        "That's the lay of the land. Start by adding a client or launching your first sequence — and the Copilot is one click away whenever you need a hand.",
    },
  },
];

export function startProductTour(opts: { onDone?: () => void } = {}) {
  const driverObj = driver({
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Finish",
    popoverClass: "tour-popover",
    overlayColor: "#1f1b16",
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 10,
    steps,
    // Fires whether the tour completed or was closed early — either way we don't
    // want to nag again, so the caller latches it as "done".
    onDestroyed: () => opts.onDone?.(),
  });
  driverObj.drive();
  return driverObj;
}
